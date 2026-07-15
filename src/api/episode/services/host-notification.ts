/**
 * Sends the show's host(s) a magic-link email when a new episode appears,
 * so they can fill in the episode's title, description, tracklist and genres.
 */

import jwt from 'jsonwebtoken';
import type { Core } from '@strapi/strapi';
import * as template from './email-template';

const EPISODE_UID = 'api::episode.episode';

export default ({ strapi }: { strapi: Core.Strapi }) => ({
  async maybeSend(documentId: string) {
    // Notifications are ON by default; set EPISODE_EDIT_NOTIFY_ENABLED=false
    // to pause them (e.g. during CSV bulk imports).
    if (process.env.EPISODE_EDIT_NOTIFY_ENABLED === 'false') {
      strapi.log.info('host-notification: EPISODE_EDIT_NOTIFY_ENABLED=false, skipping email');
      return;
    }

    const secret = process.env.EPISODE_EDIT_JWT_SECRET;
    if (!secret) {
      strapi.log.warn('host-notification: EPISODE_EDIT_JWT_SECRET not set, skipping email');
      return;
    }

    const episode = await strapi.documents(EPISODE_UID).findOne({
      documentId,
      populate: {
        link_episode_to_show: { populate: { Main_Host: true } },
        guest_artists: true,
      },
    });

    if (!episode) return;
    if (!episode.SendHostEmail) {
      strapi.log.info(`host-notification: skipping ${documentId} — SendHostEmail is unticked`);
      return;
    }

    const show = episode.link_episode_to_show;
    if (!show) {
      strapi.log.info(`host-notification: skipping ${documentId} — no show linked yet`);
      return; // afterUpdate will retry once a show is linked
    }

    // Hosts + guest artists, de-duplicated so nobody gets two copies
    const seen = new Set<string>();
    const recipients = [...(show.Main_Host ?? []), ...(episode.guest_artists ?? [])]
      .map((artist) => artist.ArtistEmail || artist.ArtistEmail2)
      .filter((email): email is string => {
        if (!email || seen.has(email.toLowerCase())) return false;
        seen.add(email.toLowerCase());
        return true;
      });
    if (recipients.length === 0) {
      strapi.log.info(
        `host-notification: skipping ${documentId} — no host or guest artist has an email address`
      );
      return;
    }

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

    const vars = {
      showName: show.ShowName,
      episodeTitle: episode.EpisodeTitle,
      broadcastDate,
      link,
    };
    const subject = template.subject(vars);
    const text = template.text(vars);
    const html = template.html(vars);

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
      // Untick the box after sending so later saves don't re-email.
      // afterUpdate skips this write via its SendHostEmail=false guard.
      await strapi.db.query(EPISODE_UID).update({
        where: { documentId },
        data: { SendHostEmail: false },
      });
      strapi.log.info(
        `host-notification: emailed ${recipients.length} host(s) for episode ${documentId}`
      );
    }
  },
});
