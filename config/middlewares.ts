module.exports = [
  'strapi::errors',
  'strapi::security',
  'strapi::cors',
  'strapi::poweredBy',
  'strapi::logger',
  'strapi::query',
  'strapi::body',
  'strapi::session', // Add this
  'strapi::favicon',
  'strapi::public',
  {
    name: 'strapi::session',
    config: {
      cookie: {
        secure: false, // 👈 allow cookies over HTTP
      },
    },
  },
];
