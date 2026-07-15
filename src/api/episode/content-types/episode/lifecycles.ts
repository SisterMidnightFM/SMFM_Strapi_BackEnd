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
    // Skip the flag-setting write made by the notification service itself
    if (event.params?.data && 'HostNotificationSent' in event.params.data) return;
    const documentId = event.result?.documentId;
    if (!documentId) return;
    try {
      await strapi.service('api::episode.host-notification').maybeSend(documentId);
    } catch (error) {
      strapi.log.error(`host-notification afterUpdate failed: ${error}`);
    }
  },
};
