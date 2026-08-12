export default {
  // Fills in MixCloudLink/SoundcloudLink for episodes whose Radio Cult track
  // has been published but whose links haven't been picked up yet (e.g. the
  // admin closed the tab before the transfer finished). One Radio Cult list
  // call per sweep at most — syncLinks makes no call when nothing is pending.
  radiocultLinkSync: {
    task: async ({ strapi }) => {
      try {
        await strapi.service('api::episode.radiocult').syncLinks();
      } catch (error) {
        strapi.log.error(`radiocult cron link sync failed: ${error}`);
      }
    },
    options: {
      rule: '*/10 * * * *',
    },
  },
};
