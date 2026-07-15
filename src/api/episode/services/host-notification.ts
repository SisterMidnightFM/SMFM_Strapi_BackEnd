/**
 * Sends the show's host(s) a magic-link email when a new episode appears,
 * so they can fill in the episode's title, description, tracklist and genres.
 */

import jwt from 'jsonwebtoken';
import type { Core } from '@strapi/strapi';

const EPISODE_UID = 'api::episode.episode';

export default ({ strapi }: { strapi: Core.Strapi }) => ({
  async maybeSend(documentId: string) {
    if (process.env.EPISODE_EDIT_NOTIFY_ENABLED !== 'true') return;

    const secret = process.env.EPISODE_EDIT_JWT_SECRET;
    if (!secret) {
      strapi.log.warn('host-notification: EPISODE_EDIT_JWT_SECRET not set, skipping email');
      return;
    }

    const episode = await strapi.documents(EPISODE_UID).findOne({
      documentId,
      populate: {
        link_episode_to_show: { populate: { Main_Host: true } },
      },
    });

    if (!episode || episode.HostNotificationSent) return;

    const show = episode.link_episode_to_show;
    if (!show) return; // no show linked yet; afterUpdate will retry

    const recipients = (show.Main_Host ?? [])
      .map((artist) => artist.ArtistEmail || artist.ArtistEmail2)
      .filter(Boolean);
    if (recipients.length === 0) return;

    const token = jwt.sign({ documentId, purpose: 'episode-edit' }, secret, {
      expiresIn: '30d',
    });
    const serverUrl = strapi.config.get('server.url', 'http://localhost:1337');
    const link = `${serverUrl}/episode-edit/index.html?token=${token}`;

    const broadcastDate = episode.BroadcastDateTime
      ? new Date(episode.BroadcastDateTime).toLocaleDateString('en-GB', {
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        })
      : 'TBC';

    const subject = `New episode of ${show.ShowName} — add your episode details`;
    const text = [
      `Hi,`,
      ``,
      `A new episode of ${show.ShowName} (broadcast ${broadcastDate}) has been added to the Sister Midnight FM website.`,
      ``,
      `Please use the link below to add or update the episode title, description, tracklist and genres:`,
      ``,
      link,
      ``,
      `This link is valid for 30 days and only works for this episode.`,
      ``,
      `Thanks,`,
      `Sister Midnight FM`,
    ].join('\n');
    const html = `
      <p>Hi,</p>
      <p>A new episode of <strong>${show.ShowName}</strong> (broadcast ${broadcastDate}) has been added to the Sister Midnight FM website.</p>
      <p>Please use the link below to add or update the episode title, description, tracklist and genres:</p>
      <p><a href="${link}">Edit your episode details</a></p>
      <p>This link is valid for 30 days and only works for this episode.</p>
      <p>Thanks,<br/>Sister Midnight FM</p>
    `;

    const results = await Promise.allSettled(
      recipients.map((to) =>
        strapi.plugin('email').service('email').send({ to, subject, text, html })
      )
    );
    results.forEach((result, i) => {
      if (result.status === 'rejected') {
        strapi.log.error(
          `host-notification: failed to email ${recipients[i]} for episode ${documentId}: ${result.reason}`
        );
      }
    });

    if (results.some((r) => r.status === 'fulfilled')) {
      // afterUpdate skips this write via its HostNotificationSent guard
      await strapi.db.query(EPISODE_UID).update({
        where: { documentId },
        data: { HostNotificationSent: true },
      });
      strapi.log.info(
        `host-notification: emailed ${recipients.length} host(s) for episode ${documentId}`
      );
    }
  },
});
