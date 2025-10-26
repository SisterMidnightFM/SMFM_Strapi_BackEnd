/**
 * Proxy Trust Middleware
 *
 * This middleware ensures that when running behind a reverse proxy (like Render.com),
 * Strapi correctly recognizes the connection as HTTPS. This fixes the "Cannot send
 * secure cookie over unencrypted connection" error.
 *
 * When IS_PROXIED environment variable is true, this middleware:
 * - Trusts the X-Forwarded-Proto header from the proxy
 * - Forces the request protocol to be recognized as HTTPS
 */

export default (config, { strapi }) => {
  return async (ctx, next) => {
    const isProxied = strapi.config.get('server.proxy', false);

    if (isProxied) {
      // Trust the X-Forwarded-Proto header from the proxy
      const forwardedProto = ctx.request.headers['x-forwarded-proto'];

      if (forwardedProto === 'https') {
        // Override the protocol to be recognized as HTTPS
        ctx.request.secure = true;
        ctx.request.protocol = 'https';
      }
    }

    await next();
  };
};
