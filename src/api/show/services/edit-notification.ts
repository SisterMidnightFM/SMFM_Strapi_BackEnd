/**
 * Emails a show's hosts a magic link to edit the show page.
 * Triggered by ticking SendEditEmail on the show and saving;
 * the flag unticks itself after a successful send.
 */

import jwt from 'jsonwebtoken';
import type { Core } from '@strapi/strapi';
import * as template from './email-template';

const SHOW_UID = 'api::show.show';

export default ({ strapi }: { strapi: Core.Strapi }) => ({
  async maybeSend(documentId: string) {
    if (process.env.EPISODE_EDIT_NOTIFY_ENABLED === 'false') {
      strapi.log.info('show-edit-notification: EPISODE_EDIT_NOTIFY_ENABLED=false, skipping email');
      return;
    }

    const secret = process.env.EPISODE_EDIT_JWT_SECRET;
    if (!secret) {
      strapi.log.warn('show-edit-notification: EPISODE_EDIT_JWT_SECRET not set, skipping email');
      return;
    }

    const show = await strapi.documents(SHOW_UID).findOne({
      documentId,
      populate: { Main_Host: true },
    });
    if (!show) return;
    if (!show.SendEditEmail) return;

    const seen = new Set<string>();
    const recipients = (show.Main_Host ?? [])
      .map((artist) => artist.ArtistEmail || artist.ArtistEmail2)
      .filter((email): email is string => {
        if (!email || seen.has(email.toLowerCase())) return false;
        seen.add(email.toLowerCase());
        return true;
      });
    if (recipients.length === 0) {
      strapi.log.info(
        `show-edit-notification: skipping ${documentId} — show "${show.ShowName}" has no host with an email address`
      );
      return;
    }

    const token = jwt.sign({ documentId, purpose: 'show-edit' }, secret, {
      expiresIn: '30d',
    });
    const serverUrl = strapi.config.get('server.url', 'http://localhost:1337');
    const link = `${serverUrl}/show-edit/index.html?token=${token}`;

    const vars = { showName: show.ShowName, link };
    const results = await Promise.allSettled(
      recipients.map((to) =>
        strapi.plugin('email').service('email').send({
          to,
          subject: template.subject(vars),
          text: template.text(vars),
          html: template.html(vars),
        })
      )
    );
    results.forEach((result, i) => {
      if (result.status === 'rejected') {
        strapi.log.error(
          `show-edit-notification: failed to email ${recipients[i]} for show ${documentId}: ${result.reason}`
        );
      }
    });

    if (results.some((r) => r.status === 'fulfilled')) {
      // Untick the box after sending; afterUpdate skips this write via its guard
      await strapi.db.query(SHOW_UID).update({
        where: { documentId },
        data: { SendEditEmail: false },
      });
      strapi.log.info(
        `show-edit-notification: emailed ${recipients.length} host(s) for show ${documentId}`
      );
    }
  },
});
