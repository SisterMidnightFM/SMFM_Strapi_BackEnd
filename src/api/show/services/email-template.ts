/**
 * ═══════════════════════════════════════════════════════════════════
 *  SHOW PAGE EDIT EMAIL TEMPLATE — edit the text below freely.
 *
 *  Placeholders available in the subject and both bodies:
 *    ${showName}  — the show's name
 *    ${link}      — the magic edit link (must appear in the body!)
 *
 *  After editing: commit + push to deploy the change to Render.
 * ═══════════════════════════════════════════════════════════════════
 */

interface TemplateVars {
  showName: string;
  link: string;
}

export const subject = ({ showName }: TemplateVars) =>
  `Update the ${showName} show page on Sister Midnight FM`;

export const text = ({ showName, link }: TemplateVars) =>
  `Hi,

We'd love you to check and update the page for ${showName} on the Sister Midnight FM website.

Use the link below to edit the show name, description, Instagram and web links:

${link}

This link is valid for 30 days and only works for this show.

If there are any issues, please contact radio@sistermidnight.org.

Thanks,
Sister Midnight FM`;

export const html = ({ showName, link }: TemplateVars) => `
  <p>Hi,</p>
  <p>We'd love you to check and update the page for <strong>${showName}</strong> on the Sister Midnight FM website.</p>
  <p>Use the link below to edit the show name, description, Instagram and web links:</p>
  <p><a href="${link}">Edit your show page</a></p>
  <p>This link is valid for 30 days and only works for this show.</p>
  <p>If there are any issues, please contact <a href="mailto:radio@sistermidnight.org">radio@sistermidnight.org</a>.</p>
  <p>Thanks,<br/>Sister Midnight FM</p>
`;
