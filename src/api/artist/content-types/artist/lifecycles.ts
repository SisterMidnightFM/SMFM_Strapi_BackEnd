export default {
  async afterCreate(event) {
    const documentId = event.result?.documentId;
    if (!documentId) return;
    try {
      await strapi.service('api::artist.edit-notification').maybeSend(documentId);
    } catch (error) {
      strapi.log.error(`artist-edit-notification afterCreate failed: ${error}`);
    }
  },

  async afterUpdate(event) {
    // Skip the notification service's own untick write (and admin unticks)
    if (event.params?.data?.SendEditEmail === false) return;
    const documentId = event.result?.documentId;
    if (!documentId) return;
    try {
      await strapi.service('api::artist.edit-notification').maybeSend(documentId);
    } catch (error) {
      strapi.log.error(`artist-edit-notification afterUpdate failed: ${error}`);
    }
  },
};
