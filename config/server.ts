module.exports = ({ env }) => ({
  host: env('HOST', '0.0.0.0'),
  port: env.int('PORT', 1337),
  url: env('PUBLIC_URL', 'https://smfm-strapi-backend.onrender.com'),
  proxy: true, // 👈 Tells Strapi it’s behind a reverse proxy (Render)
  app: { keys: env.array('APP_KEYS') },
});
