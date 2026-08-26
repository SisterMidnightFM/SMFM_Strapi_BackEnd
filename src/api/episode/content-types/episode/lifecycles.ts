// Fields the Radio Cult Uploader plugin writes back on its own (via
// strapi.db.query, which fires these database lifecycles). Such a write is
// bookkeeping, not an editorial change, and must never trigger a host email
// — the plugin is generic and knows nothing about SendHostEmail, so the
// guard lives here. Keep in step with the plugin's link field mapping.
const RADIOCULT_WRITTEN_FIELDS = ['SoundcloudLink', 'MixCloudLink'];

const isRadiocultLinkWriteback = (data: unknown): boolean => {
  if (!data || typeof data !== 'object') return false;
  const keys = Object.keys(data as Record<string, unknown>);
  return keys.length > 0 && keys.every((key) => RADIOCULT_WRITTEN_FIELDS.includes(key));
};

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
    // Skip the plugin's link write-backs (see above).
    if (isRadiocultLinkWriteback(event.params?.data)) return;

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
