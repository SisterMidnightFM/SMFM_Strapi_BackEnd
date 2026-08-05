/**
 * Admin-only endpoints for the Radio Cult panel on the episode edit page.
 * Registered with type 'admin' in src/index.ts, which makes Strapi require a
 * valid admin session (Bearer JWT) on every call — no config needed here.
 */

import type { Core } from '@strapi/strapi';
import { RcHttpError } from '../api/episode/services/radiocult';

type Handler = (ctx: any) => Promise<unknown>;

const respond = (fn: Handler) => async (ctx: any) => {
  try {
    ctx.body = await fn(ctx);
  } catch (error: any) {
    const status = error instanceof RcHttpError ? error.status : 500;
    if (status >= 500) {
      strapi.log.error(`radiocult route ${ctx.path}: ${error?.stack ?? error}`);
    }
    ctx.status = status;
    ctx.body = { error: error?.message ?? 'Unexpected error' };
  }
};

const service = () => strapi.service('api::episode.radiocult') as any;

const routes: Core.Router = {
  type: 'admin',
  prefix: '',
  routes: [
    {
      method: 'POST',
      info: {},
      path: '/radiocult/episodes/:documentId/upload',
      handler: respond(async (ctx) => {
        const filesField = ctx.request.files?.files;
        const file = Array.isArray(filesField) ? filesField[0] : filesField;
        return service().uploadTrack({
          documentId: ctx.params.documentId,
          file,
          force: ctx.query.force === 'true',
        });
      }),
    },
    {
      method: 'POST',
      info: {},
      path: '/radiocult/episodes/:documentId/publish/:platform',
      handler: respond(async (ctx) =>
        service().publish({
          documentId: ctx.params.documentId,
          platform: ctx.params.platform,
          force: ctx.query.force === 'true',
        })
      ),
    },
    {
      method: 'GET',
      info: {},
      path: '/radiocult/episodes/:documentId/status',
      handler: respond(async (ctx) =>
        service().getStatus(ctx.params.documentId, { refresh: ctx.query.refresh === 'true' })
      ),
    },
  ],
};

export default routes;
