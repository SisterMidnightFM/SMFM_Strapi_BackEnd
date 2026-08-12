export default ({ env }) => [
  'strapi::logger',
  'strapi::errors',
  // Custom middleware to trust proxy headers and force HTTPS when proxied
  'global::proxy-trust',
  'strapi::security',
  'strapi::cors',
  'strapi::poweredBy',
  'strapi::query',
  {
    name: 'strapi::body',
    config: {
      formidable: {
        // Radio Cult accepts tracks up to 750MB; formidable's default is 200MB
        maxFileSize: 800 * 1024 * 1024,
      },
    },
  },
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
