/**
 * Public, token-gated endpoints backing the show self-service edit page.
 * The JWT (emailed to the show's hosts) scopes access to a single show
 * and only the whitelisted fields below are ever read or written.
 *
 * ShowDescription is a "blocks" rich-text field; the form edits it as plain
 * text. Reading flattens blocks to paragraphs joined by blank lines; saving
 * converts paragraphs back to blocks. Rich formatting (headings, lists) is
 * flattened to plain paragraphs when a host saves.
 */

import jwt from 'jsonwebtoken';

const SHOW_UID = 'api::show.show';

const verifyToken = (token: string): string | null => {
  const secret = process.env.EPISODE_EDIT_JWT_SECRET;
  if (!secret || !token) return null;
  try {
    const payload = jwt.verify(token, secret) as jwt.JwtPayload;
    if (payload.purpose !== 'show-edit' || typeof payload.documentId !== 'string') {
      return null;
    }
    return payload.documentId;
  } catch {
    return null;
  }
};

const blockNodeText = (node: any): string => {
  if (!node) return '';
  if (typeof node.text === 'string') return node.text;
  if (Array.isArray(node.children)) return node.children.map(blockNodeText).join('');
  return '';
};

const blocksToText = (blocks: any): string => {
  if (!Array.isArray(blocks)) return '';
  return blocks
    .map((block) => {
      if (block?.type === 'list' && Array.isArray(block.children)) {
        return block.children.map((item: any) => blockNodeText(item)).join('\n');
      }
      return blockNodeText(block);
    })
    .filter((line) => line.trim() !== '')
    .join('\n\n');
};

const textToBlocks = (text: string): any[] =>
  text
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => ({
      type: 'paragraph',
      children: [{ type: 'text', text: paragraph }],
    }));

export default {
  async find(ctx) {
    const documentId = verifyToken(ctx.params.token);
    if (!documentId) return ctx.unauthorized('Link invalid or expired');

    const show = await strapi.documents(SHOW_UID).findOne({ documentId });
    if (!show) return ctx.notFound('Show not found');

    // Hand-built response: never spread the raw show
    // (StaffComments, GoogleDriveFolder must not leak)
    ctx.body = {
      show: {
        ShowName: show.ShowName,
        showDescriptionText: blocksToText(show.ShowDescription),
        Show_Instagram: show.Show_Instagram ?? '',
        WebLink1: show.WebLink1 ?? '',
        WebLink2: show.WebLink2 ?? '',
      },
    };
  },

  async update(ctx) {
    const documentId = verifyToken(ctx.params.token);
    if (!documentId) return ctx.unauthorized('Link invalid or expired');

    const body = ctx.request.body ?? {};

    const name = typeof body.ShowName === 'string' ? body.ShowName.trim() : null;
    if (!name || name.length > 255) {
      return ctx.badRequest('ShowName must be a non-empty string of at most 255 characters');
    }

    const descriptionText =
      typeof body.showDescriptionText === 'string' ? body.showDescriptionText : '';
    const instagram = typeof body.Show_Instagram === 'string' ? body.Show_Instagram.trim() : '';
    const webLink1 = typeof body.WebLink1 === 'string' ? body.WebLink1.trim() : '';
    const webLink2 = typeof body.WebLink2 === 'string' ? body.WebLink2.trim() : '';

    const exists = await strapi.documents(SHOW_UID).findOne({ documentId, fields: ['id'] });
    if (!exists) return ctx.notFound('Show not found');

    // Only these five fields are ever writable via this endpoint.
    // ShowSlug is a uid and is NOT regenerated on name change.
    try {
      await strapi.documents(SHOW_UID).update({
        documentId,
        data: {
          ShowName: name,
          ShowDescription: textToBlocks(descriptionText),
          Show_Instagram: instagram,
          WebLink1: webLink1,
          WebLink2: webLink2,
        },
      });
    } catch (error: any) {
      // ShowName is unique — surface a friendly message on collision
      const message = String(error?.message ?? '');
      if (message.toLowerCase().includes('unique') || error?.name === 'ValidationError') {
        return ctx.badRequest('A show with that name already exists');
      }
      throw error;
    }

    ctx.body = { ok: true };
  },
};
