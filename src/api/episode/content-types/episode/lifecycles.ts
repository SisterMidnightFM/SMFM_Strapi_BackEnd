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

  async afterUpdate(event) {
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
