export default {
  'strapi-csv-import-export': {
    config: {
      authorizedExports: [
        'api::episode.episode',
        'api::artist.artist',
        'api::show.show',
        'api::tag.tag',
      ],
      authorizedImports: [
        'api::episode.episode',
        'api::artist.artist',
        'api::show.show',
        'api::tag.tag',
      ],
    },
  },
};