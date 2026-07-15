/**
 * ═══════════════════════════════════════════════════════════════════
 *  HOST NOTIFICATION EMAIL TEMPLATE — edit the text below freely.
 *
 *  You can use these placeholders anywhere in the subject or body:
 *    ${showName}       — the show's name, e.g. "Midnight Mixtape"
 *    ${episodeTitle}   — the episode's current title
 *    ${broadcastDate}  — the broadcast date, e.g. "20 July 2026"
 *    ${link}           — the magic edit link (must appear in the body!)
 *
 *  There are two versions of the body:
 *    text — plain-text fallback (keep it simple, line breaks are real)
 *    html — what most email apps display (basic HTML tags allowed)
 *
 *  After editing: commit + push to deploy the change to Render.
 * ═══════════════════════════════════════════════════════════════════
 */

interface TemplateVars {
  showName: string;
  episodeTitle: string;
  broadcastDate: string;
  link: string;
}

export const subject = ({ showName }: TemplateVars) =>
  `New episode of ${showName} uploaded — add your episode details`;

export const text = ({ showName, broadcastDate, link }: TemplateVars) =>
  `Hi,

A new episode of ${showName} (broadcast ${broadcastDate}) has been added to the Sister Midnight FM website.

Please use the link below to add or update the episode title, description, tracklist and genres:

${link}

This link is valid for 30 days and only works for this episode.

Thanks,
Sister Midnight FM`;

export const html = ({ showName, broadcastDate, link }: TemplateVars) => `
  <p>Hi,</p>
  <p>A new episode of <strong>${showName}</strong> (broadcast ${broadcastDate}) has been added to the Sister Midnight FM website.</p>
  <p>Please use the link below to add or update the episode title, description, tracklist and genres:</p>
  <p><a href="${link}">Edit your episode details</a></p>
  <p>This link is valid for 30 days and only works for this episode.</p>
  <p>Thanks,<br/>Sister Midnight FM</p>
`;
