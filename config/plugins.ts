export default ({ env }) => ({
  email: {
    config: {
      provider: 'nodemailer',
      providerOptions: {
        host: env('SMTP_HOST', 'smtp.resend.com'),
        port: env.int('SMTP_PORT', 465),
        secure: true,
        auth: {
          user: env('SMTP_USERNAME', 'resend'),
          pass: env('SMTP_PASSWORD'),
        },
      },
      settings: {
        defaultFrom: env('EMAIL_FROM'),
        defaultReplyTo: env('EMAIL_REPLY_TO', env('EMAIL_FROM')),
      },
    },
  },
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
});
