/**
 * Interactive Artist → Show Linking Script
 *
 * This script:
 * - Finds shows with NO Main_Host linked
 * - Suggests 7 matching artists using hybrid matching:
 *      1. Substring match (ShowName contains ArtistName)
 *      2. Levenshtein distance on slugs
 *      3. Alphabetical fallback
 * - Option 8: Enter Artist_Slug manually
 * - Option 0: Skip
 *
 * Supports:
 * - DRY RUN: process.env.DRY_RUN = 'true'
 * - TEST LIMIT: process.env.TEST_LIMIT = '5'
 *
 * Interactive usage:
 * const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
 * await require('./scripts/link-artists-to-shows.js')(strapi, rl)
 */

const readline = require('readline');

// Simple slug function
const createSlug = (str) =>
  str
    .toLowerCase()
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/[^\w-]+/g, '')
    .replace(/--+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');

// Levenshtein distance
function levenshtein(a, b) {
  const m = [];

  for (let i = 0; i <= b.length; i++) m[i] = [i];
  for (let j = 0; j <= a.length; j++) m[0][j] = j;

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      m[i][j] =
        b.charAt(i - 1) === a.charAt(j - 1)
          ? m[i - 1][j - 1]
          : Math.min(
              m[i - 1][j - 1] + 1,
              m[i][j - 1] + 1,
              m[i - 1][j] + 1
            );
    }
  }

  return m[b.length][a.length];
}

module.exports = async (strapi, rl = null) => {
  const DRY_RUN = process.env.DRY_RUN === "true";
  const TEST_LIMIT = process.env.TEST_LIMIT ? parseInt(process.env.TEST_LIMIT) : null;
  const INTERACTIVE = rl !== null && !DRY_RUN;

  if (DRY_RUN) console.log("⚠️ DRY RUN ENABLED — No changes will be saved.");
  if (INTERACTIVE) console.log("🤝 INTERACTIVE MODE ENABLED");
  if (TEST_LIMIT) console.log(`⚠️ TEST LIMIT: Only processing first ${TEST_LIMIT} shows.`);

  const ask = (q) =>
    new Promise((resolve) => rl.question(q, (a) => resolve(a.trim())));

  try {
    console.log("\n📥 Fetching artists...");
    const allArtists = await strapi.db.query("api::artist.artist").findMany({
      select: ["id", "ArtistName", "Artist_Slug"],
    });

    console.log(`✓ Loaded ${allArtists.length} artists`);

    const artistMap = new Map();
    allArtists.forEach((a) => artistMap.set(a.Artist_Slug, a));

    console.log("\n📥 Fetching shows...");
    let shows = await strapi.db.query("api::show.show").findMany({
      select: ["id", "ShowName", "ShowSlug"],
      populate: { Main_Host: true },
    });

    // Keep only shows missing hosts
    shows = shows.filter((s) => !s.Main_Host || s.Main_Host.length === 0);

    if (TEST_LIMIT) shows = shows.slice(0, TEST_LIMIT);

    console.log(`✓ Found ${shows.length} shows with NO main host.\n`);

    let linked = 0;
    let skipped = 0;

    for (const show of shows) {
      console.log("\n" + "─".repeat(80));
      console.log(`📺 Show: ${show.ShowName}`);

      const showSlug = createSlug(show.ShowName);

      // 1. Substring matches (highest priority)
      const substringMatches = allArtists.filter((artist) =>
        show.ShowName.toLowerCase().includes(artist.ArtistName.toLowerCase())
      );

      // 2. Levenshtein fallback
      const levenshteinMatches = allArtists
        .map((artist) => ({
          artist,
          dist: levenshtein(showSlug, createSlug(artist.Artist_Slug)),
        }))
        .sort((a, b) => a.dist - b.dist)
        .map((o) => o.artist);

      // 3. Merge intelligently
      const combined = [
        ...substringMatches,
        ...levenshteinMatches.filter((a) => !substringMatches.includes(a)),
      ];

      // 4. Add alphabetical fallback
      const alphabetical = allArtists
        .filter((a) => !combined.includes(a))
        .sort((a, b) => a.ArtistName.localeCompare(b.ArtistName));

      const finalSuggestions = [...combined, ...alphabetical].slice(0, 7);

      console.log("\n📌 Suggestions:");
      finalSuggestions.forEach((artist, idx) =>
        console.log(`${idx + 1}. ${artist.ArtistName} (${artist.Artist_Slug})`)
      );
      console.log("8. Enter Artist_Slug manually");
      console.log("0. Skip");

      if (!INTERACTIVE) {
        console.log("⏭️ Skipping (not interactive)");
        skipped++;
        continue;
      }

      const choice = await ask("\nSelect an option (1-8, 0 to skip): ");

      if (choice === "0" || choice === "") {
        console.log("⏭️ Skipped.");
        skipped++;
        continue;
      }

      let selectedArtist = null;

      if (choice === "8") {
        const manualSlug = await ask("Enter Artist_Slug: ");

        if (!artistMap.has(manualSlug)) {
          console.log("❌ Artist not found — skipping.");
          skipped++;
          continue;
        }

        selectedArtist = artistMap.get(manualSlug);
      } else {
        const index = parseInt(choice, 10) - 1;
        if (index < 0 || index >= finalSuggestions.length) {
          console.log("❌ Invalid option — skipping.");
          skipped++;
          continue;
        }

        selectedArtist = finalSuggestions[index];
      }

      if (!selectedArtist) {
        console.log("❌ No artist selected — skipped.");
        skipped++;
        continue;
      }

      if (DRY_RUN) {
        console.log(`[DRY RUN] Would link show → ${selectedArtist.ArtistName}`);
      } else {
        await strapi.db.query("api::show.show").update({
          where: { id: show.id },
          data: { Main_Host: [selectedArtist.id] },
        });
        console.log(`✅ Linked: ${show.ShowName} → ${selectedArtist.ArtistName}`);
      }

      linked++;
    }

    console.log("\n" + "─".repeat(80));
    console.log("📊 SUMMARY");
    console.log(`✓ Linked: ${linked}`);
    console.log(`⏭️ Skipped: ${skipped}`);
    console.log("─".repeat(80));

    if (DRY_RUN) console.log("💡 DRY RUN complete — no changes saved.");
  } catch (err) {
    console.error("❌ Fatal error:", err);
  }
};
