/**
 * ═══════════════════════════════════════════════════════════════════
 *  ARTIST PAGE EDIT EMAIL TEMPLATE — edit the text below freely.
 *
 *  Placeholders available in the subject and both bodies:
 *    ${artistName}  — the artist's name
 *    ${link}        — the magic edit link (must appear in the body!)
 *
 *  After editing: commit + push to deploy the change to Render.
 * ═══════════════════════════════════════════════════════════════════
 */

interface TemplateVars {
  artistName: string;
  link: string;
}

export const subject = ({ artistName }: TemplateVars) =>
  `Update your artist page on Sister Midnight FM`;

export const text = ({ artistName, link }: TemplateVars) =>
  `Hi ${artistName},

We'd love you to check and update your artist page on the Sister Midnight FM website.

Use the link below to edit your name, bio, Instagram, website and contact email:

${link}

This link is valid for 30 days and only works for your page.

If there are any issues, please contact radio@sistermidnight.org.

Thanks,
Sister Midnight FM`;

export const html = ({ artistName, link }: TemplateVars) => `
  <p>Hi ${artistName},</p>
  <p>We'd love you to check and update your artist page on the Sister Midnight FM website.</p>
  <p>Use the link below to edit your name, bio, Instagram, website and contact email:</p>
  <p><a href="${link}">Edit your artist page</a></p>
  <p>This link is valid for 30 days and only works for your page.</p>
  <p>If there are any issues, please contact <a href="mailto:radio@sistermidnight.org">radio@sistermidnight.org</a>.</p>
  <p>Thanks,<br/>Sister Midnight FM</p>
`;
