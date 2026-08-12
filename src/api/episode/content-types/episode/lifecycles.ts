export default {
  async afterCreate(event) {
    const documentId = event.result?.documentId;
    if (!documentId) return;
    try {
      await strapi.service('api::episode.host-notification').maybeSend(documentId);
    } catch (error) {
      strapi.log.error(`host-notification afterCreate failed: ${error}`);
    }
  },

  async beforeUpdate(event) {
    // Stash the pre-save title so afterUpdate can tell whether it actually
    // changed — the Radio Cult track title may be customised on the uploader
    // page and must not be overwritten by unrelated episode saves.
    if (typeof event.params?.data?.EpisodeTitle !== 'string') return;
    try {
      const current = await strapi.db
        .query('api::episode.episode')
        .findOne({ where: event.params.where, select: ['EpisodeTitle'] });
      event.state.radiocultPreviousTitle = current?.EpisodeTitle ?? null;
    } catch (error) {
      strapi.log.warn(`radiocult beforeUpdate title stash failed: ${error}`);
    }
  },

  async afterUpdate(event) {
    // Keep the Radio Cult track title in step with EpisodeTitle. Must run
    // before the SendHostEmail guard below — normal admin saves include
    // SendHostEmail:false in the payload and would skip it otherwise.
    try {
      await strapi.service('api::episode.radiocult').maybeSyncTitle(event);
    } catch (error) {
      strapi.log.error(`radiocult title sync afterUpdate failed: ${error}`);
    }

    // Skip writes that untick the box (the notification service's own
    // post-send write, or an admin turning emails off). A save with the
    // box ticked means "send" — maybeSend re-checks and handles the rest.
    if (event.params?.data?.SendHostEmail === false) return;
    const documentId = event.result?.documentId;
    if (!documentId) return;
    try {
      await strapi.service('api::episode.host-notification').maybeSend(documentId);
    } catch (error) {
      strapi.log.error(`host-notification afterUpdate failed: ${error}`);
    }
  },
};
