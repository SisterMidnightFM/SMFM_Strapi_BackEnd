/**
 * Emails an artist a magic link to edit their own artist page.
 * Triggered by ticking SendEditEmail on the artist and saving;
 * the flag unticks itself after a successful send.
 */

import jwt from 'jsonwebtoken';
import type { Core } from '@strapi/strapi';
import * as template from './email-template';

const ARTIST_UID = 'api::artist.artist';

export default ({ strapi }: { strapi: Core.Strapi }) => ({
  async maybeSend(documentId: string) {
    if (process.env.EPISODE_EDIT_NOTIFY_ENABLED === 'false') {
      strapi.log.info('artist-edit-notification: EPISODE_EDIT_NOTIFY_ENABLED=false, skipping email');
      return;
    }

    const secret = process.env.EPISODE_EDIT_JWT_SECRET;
    if (!secret) {
      strapi.log.warn('artist-edit-notification: EPISODE_EDIT_JWT_SECRET not set, skipping email');
      return;
    }

    const artist = await strapi.documents(ARTIST_UID).findOne({ documentId });
    if (!artist) return;
    if (!artist.SendEditEmail) return;

    const to = artist.ArtistEmail || artist.ArtistEmail2;
    if (!to) {
      strapi.log.info(
        `artist-edit-notification: skipping ${documentId} — artist "${artist.ArtistName}" has no email address`
      );
      return;
    }

    const token = jwt.sign({ documentId, purpose: 'artist-edit' }, secret, {
      expiresIn: '30d',
    });
    const serverUrl = strapi.config.get('server.url', 'http://localhost:1337');
    const link = `${serverUrl}/artist-edit/index.html?token=${token}`;

    const vars = { artistName: artist.ArtistName, link };
    try {
      await strapi.plugin('email').service('email').send({
        to,
        subject: template.subject(vars),
        text: template.text(vars),
        html: template.html(vars),
      });
    } catch (error) {
      strapi.log.error(`artist-edit-notification: failed to email ${to} for artist ${documentId}: ${error}`);
      return;
    }

    // Untick the box after sending; afterUpdate skips this write via its guard
    await strapi.db.query(ARTIST_UID).update({
      where: { documentId },
      data: { SendEditEmail: false },
    });
    strapi.log.info(`artist-edit-notification: emailed ${to} for artist ${documentId}`);
  },
});
