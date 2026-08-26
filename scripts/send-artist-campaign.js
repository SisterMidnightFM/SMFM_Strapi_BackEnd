#!/usr/bin/env node
/**
 * ONE-OFF CAMPAIGN: email every artist who has an email address on their record,
 * asking them to update their artist page. Each email carries a private 30-day
 * magic link to the existing artist-edit form.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS DOESN'T USE STRAPI
 * ─────────────────────────────────────────────────────────────────────────────
 * `strapi console` boots the whole app, and Strapi syncs content-type schema to
 * the database on boot — which against the production DB can alter or drop
 * columns. This script never boots Strapi. It opens a normal Postgres connection
 * and issues a single read-only SELECT. There is no INSERT, UPDATE, DELETE or DDL
 * anywhere in this file, so it cannot modify production data.
 *
 * It also does NOT touch the per-artist SendEditEmail tickbox, so it cannot
 * trigger the lifecycle hook or cause duplicate transactional emails.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * USAGE — runs entirely on your machine. No build step.
 * ─────────────────────────────────────────────────────────────────────────────
 *   Dry run (default) — prints recipients + a full sample email, sends nothing:
 *     node scripts/send-artist-campaign.js
 *
 *   Live test to one address first (recommended):
 *     ONLY_EMAIL=you@example.com CONFIRM=send node scripts/send-artist-campaign.js
 *
 *   Full send:
 *     CONFIRM=send node scripts/send-artist-campaign.js
 *
 *   Other switches:
 *     TEST_LIMIT=5          — only the first N recipients
 *     LINK_BASE_URL=https://…  — override the link host if it ever changes
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IMPORTANT: LINK_JWT_SECRET must match Render
 * ─────────────────────────────────────────────────────────────────────────────
 * The magic links are verified by the LIVE Strapi on Render, so they must be signed
 * with the secret RENDER uses — which is NOT the same value as the local
 * EPISODE_EDIT_JWT_SECRET in your .env. Signing with the local one produces links
 * that all fail with "This link is invalid or has expired".
 *
 * Copy EPISODE_EDIT_JWT_SECRET from the Render dashboard
 * (Service → Environment) into your .env as:
 *
 *     LINK_JWT_SECRET=<the value from Render>
 *
 * Reads DATABASE_URL, SMTP_*, and LINK_JWT_SECRET from .env.
 * Writes an audit log to claude/ (gitignored, so it stays local).
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const { Client } = require('pg');

const copy = require('./artist-campaign-copy');

// Where the magic links point. Must be the PUBLIC Strapi host, because artists
// click these from their inbox — unrelated to where this script runs. Matches the
// URL Render sets, so links are identical to the SendEditEmail tickbox's.
const PUBLIC_BASE_URL = process.env.LINK_BASE_URL || 'https://smfm-strapi-backend.onrender.com';

// The copy says "reply to this", but EMAIL_FROM is a noreply address, so point
// replies somewhere a human reads.
const REPLY_TO = process.env.EMAIL_REPLY_TO || 'radio@sistermidnight.org';

const SEND_INTERVAL_MS = 600; // Resend allows 2 requests/second

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const CONFIRM = process.env.CONFIRM === 'send';
  const ONLY_EMAIL = process.env.ONLY_EMAIL ? process.env.ONLY_EMAIL.trim().toLowerCase() : null;
  const TEST_LIMIT = process.env.TEST_LIMIT ? parseInt(process.env.TEST_LIMIT, 10) : null;

  console.log('\n📣 Artist page update campaign\n');

  // Links are VERIFIED by the live Strapi on Render, so they must be SIGNED with the
  // secret Render uses. The local EPISODE_EDIT_JWT_SECRET is a different value, and
  // signing with it produces links that Render rejects as "invalid or expired".
  // Put Render's value in LINK_JWT_SECRET (see .env comment).
  const secret = process.env.LINK_JWT_SECRET || process.env.EPISODE_EDIT_JWT_SECRET;
  if (!secret) {
    console.error('❌ No signing secret set — links would be unsignable. Aborting.');
    process.exit(1);
  }
  if (!process.env.LINK_JWT_SECRET) {
    console.log(
      '⚠️  LINK_JWT_SECRET not set — falling back to the LOCAL EPISODE_EDIT_JWT_SECRET.\n' +
        '   If that differs from the value on Render, every link will read\n' +
        '   "This link is invalid or has expired". Test with ONLY_EMAIL first.'
    );
  } else {
    console.log('🔑 Signing with LINK_JWT_SECRET (Render\'s secret)');
  }
  if (!process.env.DATABASE_URL) {
    console.error('❌ DATABASE_URL is not set. Aborting.');
    process.exit(1);
  }
  if (PUBLIC_BASE_URL.includes('localhost') || PUBLIC_BASE_URL.includes('127.0.0.1')) {
    console.error(`❌ Links would point at "${PUBLIC_BASE_URL}" — dead for every recipient. Aborting.`);
    process.exit(1);
  }
  console.log(`🔗 Links will point at ${PUBLIC_BASE_URL}`);

  // ── Read artists (SELECT only) ──────────────────────────────────────────────
  const db = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await db.connect();

  let rows;
  try {
    const result = await db.query(
      `SELECT document_id, artist_name, artist_email, artist_email_2
         FROM artists
        ORDER BY artist_name`
    );
    rows = result.rows;
  } finally {
    await db.end();
  }
  console.log(`👥 ${rows.length} artist records read`);

  // ── Build the recipient list ────────────────────────────────────────────────
  const seen = new Set();
  const recipients = [];
  const noEmail = [];
  const duplicates = [];

  for (const row of rows) {
    const email = (row.artist_email || row.artist_email_2 || '').trim();
    const name = (row.artist_name || '').trim() || 'there';
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      noEmail.push(name);
      continue;
    }
    const key = email.toLowerCase();
    if (seen.has(key)) {
      duplicates.push(`${name} <${email}>`);
      continue;
    }
    seen.add(key);
    recipients.push({ documentId: row.document_id, artistName: name, email });
  }

  console.log(`✅ ${recipients.length} unique recipients`);
  console.log(`⏭️  ${noEmail.length} skipped (no usable email on record)`);
  if (duplicates.length) {
    console.log(`♻️  ${duplicates.length} skipped as duplicate addresses:`);
    duplicates.forEach((entry) => console.log(`     ${entry}`));
  }

  let queue = recipients;
  if (ONLY_EMAIL) {
    queue = queue.filter((entry) => entry.email.toLowerCase() === ONLY_EMAIL);
    console.log(`🎯 ONLY_EMAIL=${ONLY_EMAIL} → ${queue.length} match(es)`);
    if (!queue.length) {
      console.log('   (that address is not on any artist record — nothing to send)');
    }
  }
  if (TEST_LIMIT) {
    queue = queue.slice(0, TEST_LIMIT);
    console.log(`⚠️  TEST_LIMIT — first ${queue.length} only`);
  }
  if (!queue.length) {
    console.log('\nNothing to send. Stopping.');
    return;
  }

  const linkFor = (documentId) => {
    const token = jwt.sign({ documentId, purpose: 'artist-edit' }, secret, { expiresIn: '30d' });
    return `${PUBLIC_BASE_URL}/artist-edit/index.html?token=${token}`;
  };

  // ── Dry run ─────────────────────────────────────────────────────────────────
  if (!CONFIRM) {
    const sample = queue[0];
    const vars = { artistName: sample.artistName, link: linkFor(sample.documentId) };
    console.log('\n--- DRY RUN. Sample email as it would be sent to the first recipient ---\n');
    console.log(`From:     ${process.env.EMAIL_FROM}`);
    console.log(`Reply-To: ${REPLY_TO}`);
    console.log(`To:       ${sample.email}`);
    console.log(`Subject:  ${copy.subject(vars)}\n`);
    console.log(copy.text(vars));
    console.log('\n--- Recipients ---');
    queue.forEach((entry) => console.log(`  ${entry.artistName} <${entry.email}>`));
    console.log(`\n🚫 Nothing sent. Re-run with CONFIRM=send to email these ${queue.length} people.`);
    return;
  }

  // ── Send ────────────────────────────────────────────────────────────────────
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.resend.com',
    port: parseInt(process.env.SMTP_PORT || '465', 10),
    secure: true,
    auth: { user: process.env.SMTP_USERNAME || 'resend', pass: process.env.SMTP_PASSWORD },
  });
  await transporter.verify();
  console.log('📮 SMTP connection verified');

  console.log(`\n🚀 Sending to ${queue.length} recipients...\n`);
  const results = [];
  let sent = 0;
  let failed = 0;

  for (const entry of queue) {
    const vars = { artistName: entry.artistName, link: linkFor(entry.documentId) };
    try {
      await transporter.sendMail({
        from: process.env.EMAIL_FROM,
        replyTo: REPLY_TO,
        to: entry.email,
        subject: copy.subject(vars),
        text: copy.text(vars),
        html: copy.html(vars),
      });
      sent += 1;
      results.push({ ...entry, status: 'sent' });
      console.log(`  ✅ ${entry.artistName} <${entry.email}>`);
    } catch (error) {
      failed += 1;
      results.push({ ...entry, status: 'failed', error: String(error && error.message) });
      console.log(`  ❌ ${entry.artistName} <${entry.email}> — ${error && error.message}`);
    }
    await sleep(SEND_INTERVAL_MS);
  }

  const logPath = path.join(
    __dirname,
    '..',
    'claude',
    `artist-campaign-sent-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
  );
  fs.writeFileSync(
    logPath,
    JSON.stringify({ sentAt: new Date().toISOString(), sent, failed, results }, null, 2)
  );

  console.log(`\n📊 Done — ${sent} sent, ${failed} failed`);
  console.log(`📝 Audit log: ${logPath}`);
}

main().catch((error) => {
  console.error('\n💥 Failed:', error && error.message);
  process.exit(1);
});
