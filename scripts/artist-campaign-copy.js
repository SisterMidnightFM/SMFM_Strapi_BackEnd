/**
 * ═══════════════════════════════════════════════════════════════════
 *  ONE-OFF ARTIST CAMPAIGN EMAIL COPY — edit the text below freely.
 *
 *  Plain JS on purpose: no build step, so what you edit here is exactly
 *  what goes out. Used by scripts/send-artist-campaign.js.
 *
 *  Placeholders available in the bodies:
 *    ${artistName}  — the artist's name
 *    ${link}        — the private edit link (must appear in the body!)
 * ═══════════════════════════════════════════════════════════════════
 */

const ARTISTS_PAGE = 'https://radio.sistermidnight.org/artists';

exports.subject = () => `Please update your artist page on Sister Midnight FM`;

exports.text = ({ artistName, link }) =>
  `Hi ${artistName},

As we build up the SMFM website (${ARTISTS_PAGE}), we want to make sure that if someone likes your show, they can find out all the important information about you that they might want.

A lot of artist pages are quite sparse at the moment, so we're sending this email round to everyone to encourage you to add some info about yourself.

You can update your name, your bio, your Instagram, your website, and the email we reach you on:

${link}

The link is private to your page and works for the next 30 days. A couple of lines about what you play is plenty — it just needs to sound like you.

Anything odd, reply to this or drop us a line at radio@sistermidnight.org. If you want to update your show page then also drop us a line.

Thanks,
Sister Midnight FM`;

exports.html = ({ artistName, link }) => `
  <p>Hi ${artistName},</p>
  <p>As we build up the <a href="${ARTISTS_PAGE}">SMFM website</a>, we want to make sure that if someone likes your show, they can find out all the important information about you that they might want.</p>
  <p>A lot of artist pages are quite sparse at the moment, so we're sending this email round to everyone to encourage you to add some info about yourself.</p>
  <p>You can update your name, your bio, your Instagram, your website, and the email we reach you on:</p>
  <p><a href="${link}">Edit your artist page</a></p>
  <p>The link is private to your page and works for the next 30 days. A couple of lines about what you play is plenty — it just needs to sound like you.</p>
  <p>Anything odd, reply to this or drop us a line at <a href="mailto:radio@sistermidnight.org">radio@sistermidnight.org</a>. If you want to update your show page then also drop us a line.</p>
  <p>Thanks,<br/>Sister Midnight FM</p>
`;
