export default ({ env }) => [
  'strapi::logger',
  'strapi::errors',
  'strapi::security',
  'strapi::cors',
  'strapi::poweredBy',
  'strapi::query',
  'strapi::body',
  {
    name: 'strapi::session',
    config: {
      rolling: true,
      renew: true,
      cookie: {
        secure: env.bool('IS_PROXIED', false),
        sameSite: env.bool('IS_PROXIED', false) ? 'none' : 'lax',
      },
    },
  },
  'strapi::favicon',
  'strapi::public',
];
