/**
 * Admin-only endpoints for the Radio Cult uploader page (and the episode
 * edit-view side panel that links to it). Registered with type 'admin' in
 * src/index.ts, which makes Strapi require a valid admin session (Bearer JWT)
 * on every call — no config needed here.
 */

import type { Core } from '@strapi/strapi';
import { RcHttpError } from '../api/episode/services/radiocult';

type Handler = (ctx: any) => Promise<unknown>;

/**
 * Wraps a handler with error → HTTP response mapping and detailed logging:
 * every failure is logged with method, path, admin user and status; 5xx also
 * get the stack trace.
 */
const respond = (fn: Handler) => async (ctx: any) => {
  try {
    ctx.body = await fn(ctx);
  } catch (error: any) {
    const status = error instanceof RcHttpError ? error.status : 500;
    const admin = ctx.state?.user?.email ?? ctx.state?.user?.id ?? 'unknown admin';
    const line = `radiocult route ${ctx.method} ${ctx.path} (${admin}) → ${status}: ${error?.message ?? error}`;
    if (status >= 500) strapi.log.error(`${line}\n${error?.stack ?? ''}`);
    else strapi.log.warn(line);
    ctx.status = status;
    ctx.body = { error: error?.message ?? 'Unexpected error' };
  }
};

const service = () => strapi.service('api::episode.radiocult') as any;

/** Edited-details fields, from either a multipart or a JSON body. */
const metaFrom = (body: any) => {
  let tags = body?.tags;
  if (typeof tags === 'string') {
    try {
      tags = JSON.parse(tags);
    } catch {
      tags = tags.split(',');
    }
  }
  return {
    title: body?.title,
    artist: body?.artist,
    album: body?.album,
    description: body?.description,
    tags,
  };
};

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
          meta: metaFrom(ctx.request.body),
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
          meta: metaFrom(ctx.request.body),
        })
      ),
    },
    {
      method: 'PUT',
      info: {},
      path: '/radiocult/episodes/:documentId/track',
      handler: respond(async (ctx) =>
        service().updateTrackMetadata({
          documentId: ctx.params.documentId,
          meta: metaFrom(ctx.request.body),
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
