/**
 * Public, token-gated endpoints backing the host self-service edit page.
 * The JWT (emailed to the show's hosts) scopes access to a single episode
 * and only the whitelisted fields below are ever read or written.
 */

import jwt from 'jsonwebtoken';

const EPISODE_UID = 'api::episode.episode';
const TAG_UID = 'api::tag.tag';

const verifyToken = (token: string): string | null => {
  const secret = process.env.EPISODE_EDIT_JWT_SECRET;
  if (!secret || !token) return null;
  try {
    const payload = jwt.verify(token, secret) as jwt.JwtPayload;
    if (payload.purpose !== 'episode-edit' || typeof payload.documentId !== 'string') {
      return null;
    }
    return payload.documentId;
  } catch {
    return null;
  }
};

export default {
  async find(ctx) {
    const documentId = verifyToken(ctx.params.token);
    if (!documentId) return ctx.unauthorized('Link invalid or expired');

    const episode = await strapi.documents(EPISODE_UID).findOne({
      documentId,
      populate: {
        Tracklist: true,
        tag_genres: true,
        link_episode_to_show: true,
      },
    });
    if (!episode) return ctx.notFound('Episode not found');

    const allGenres = await strapi.documents(TAG_UID).findMany({
      fields: ['Genre'],
      sort: 'Genre:asc',
      limit: 500,
    });

    // Hand-built response: never spread the raw episode (private fields must not leak)
    ctx.body = {
      episode: {
        EpisodeTitle: episode.EpisodeTitle,
        EpisodeDescription: episode.EpisodeDescription ?? '',
        BroadcastDateTime: episode.BroadcastDateTime,
        showName: episode.link_episode_to_show?.ShowName ?? '',
        Tracklist: (episode.Tracklist ?? []).map((t) => ({
          Artist: t.Artist ?? '',
          Track_Title: t.Track_Title ?? '',
        })),
        tagGenreDocumentIds: (episode.tag_genres ?? []).map((t) => t.documentId),
      },
      allGenres: allGenres.map((t) => ({ documentId: t.documentId, Genre: t.Genre })),
    };
  },

  async update(ctx) {
    const documentId = verifyToken(ctx.params.token);
    if (!documentId) return ctx.unauthorized('Link invalid or expired');

    const body = ctx.request.body ?? {};

    const title = typeof body.EpisodeTitle === 'string' ? body.EpisodeTitle.trim() : null;
    if (!title || title.length > 255) {
      return ctx.badRequest('EpisodeTitle must be a non-empty string of at most 255 characters');
    }

    const description =
      typeof body.EpisodeDescription === 'string' ? body.EpisodeDescription : '';

    if (!Array.isArray(body.Tracklist)) {
      return ctx.badRequest('Tracklist must be an array');
    }
    const tracklist = body.Tracklist.filter(
      (t) => t && typeof t === 'object'
    ).map((t) => ({
      Artist: typeof t.Artist === 'string' ? t.Artist.trim() : '',
      Track_Title: typeof t.Track_Title === 'string' ? t.Track_Title.trim() : '',
    })).filter((t) => t.Artist || t.Track_Title);

    if (!Array.isArray(body.tagGenreDocumentIds)) {
      return ctx.badRequest('tagGenreDocumentIds must be an array');
    }
    const rawIds: unknown[] = body.tagGenreDocumentIds;
    const requestedIds = [
      ...new Set(rawIds.filter((id): id is string => typeof id === 'string')),
    ];
    let genreIds: string[] = [];
    if (requestedIds.length > 0) {
      const found = await strapi.documents(TAG_UID).findMany({
        filters: { documentId: { $in: requestedIds } },
        fields: ['id'],
        limit: 500,
      });
      genreIds = found.map((t) => t.documentId);
      if (genreIds.length !== requestedIds.length) {
        return ctx.badRequest('One or more genres do not exist');
      }
    }

    const exists = await strapi.documents(EPISODE_UID).findOne({ documentId, fields: ['id'] });
    if (!exists) return ctx.notFound('Episode not found');

    // Only these four fields are ever writable via this endpoint.
    // Note: EpisodeSlug is a uid and is NOT regenerated on title change,
    // so public site links stay stable.
    await strapi.documents(EPISODE_UID).update({
      documentId,
      data: {
        EpisodeTitle: title,
        EpisodeDescription: description,
        Tracklist: tracklist,
        tag_genres: { set: genreIds },
      },
    });

    ctx.body = { ok: true };
  },
};
