export default {
  'strapi-csv-import-export': {
    config: {
      authorizedExports: [
        'api::about-page.about-page',
        'api::artist.artist',
        'api::episode.episode',
        'api::mood-vibe-tag.mood-vibe-tag',
        'api::news.news',
        'api::schedule.schedule',
        'api::show.show',
        'api::tag.tag',
        'api::tag-location.tag-location',
        'api::tag-theme.tag-theme',
      ],
      authorizedImports: [
        'api::about-page.about-page',
        'api::artist.artist',
        'api::episode.episode',
        'api::mood-vibe-tag.mood-vibe-tag',
        'api::news.news',
        'api::schedule.schedule',
        'api::show.show',
        'api::tag.tag',
        'api::tag-location.tag-location',
        'api::tag-theme.tag-theme',
      ],
    },
  },
};