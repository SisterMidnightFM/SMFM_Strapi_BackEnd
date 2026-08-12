import fs from 'node:fs';
import type { Core } from '@strapi/strapi';
import radiocultAdminRoutes from './radiocult/admin-routes';

export default {
  /**
   * An asynchronous register function that runs before
   * your application is initialized.
   *
   * This gives you an opportunity to extend code.
   */
  register({ strapi }: { strapi: Core.Strapi }) {
    // Admin-authenticated endpoints backing the Radio Cult panel on the
    // episode edit page (src/api routes can only ever be content-api typed).
    strapi.server.routes(radiocultAdminRoutes);

    if (typeof (fs as any).openAsBlob !== 'function') {
      strapi.log.warn(
        'radiocult: fs.openAsBlob is unavailable (Node < 20) — episode uploads to Radio Cult will fail. Set NODE_VERSION=22.'
      );
    }
  },

  /**
   * An asynchronous bootstrap function that runs before
   * your application gets started.
   *
   * This gives you an opportunity to set up your data model,
   * run jobs, or perform some special logic.
   */
  async bootstrap({ strapi }: { strapi: Core.Strapi }) {
    // One-time init for the SendHostEmail field: episodes that existed
    // before the feature must start unticked, otherwise the column default
    // (true) would make any later admin save email their hosts.
    const store = strapi.store({ type: 'core', name: 'send-host-email' });
    const initialized = await store.get({ key: 'initialized' });
    if (!initialized) {
      const updated = await strapi.db.query('api::episode.episode').updateMany({
        where: {},
        data: { SendHostEmail: false },
      });
      await store.set({ key: 'initialized', value: true });
      strapi.log.info(
        `send-host-email init: unticked SendHostEmail on ${updated?.count ?? 'all'} pre-existing episode(s)`
      );
    }
  },
};
