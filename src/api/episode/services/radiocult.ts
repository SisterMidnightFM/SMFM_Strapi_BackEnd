/**
 * Radio Cult integration: uploads episode audio as a station track, publishes
 * it onward to Mixcloud/SoundCloud via Radio Cult's own endpoints, keeps the
 * track title in sync with EpisodeTitle, and pulls the resulting show links
 * back onto the episode once Radio Cult's async transfers finish.
 *
 * Set RADIOCULT_ENABLED=false to switch the whole integration off.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { Core } from '@strapi/strapi';
import { embedArtworkMp3 } from './radiocult-id3';

const EPISODE_UID = 'api::episode.episode';
const RC_BASE = 'https://api.radiocult.fm';
const MAX_TRACK_BYTES = 750 * 1024 * 1024; // Radio Cult's limit
const MAX_PUBLISH_ARTWORK_BYTES = 2 * 1024 * 1024; // SoundCloud's artwork limit
const MAX_EMBED_ARTWORK_BYTES = 10 * 1024 * 1024;
const PUBLISH_RETRY_GUARD_MS = 10 * 60 * 1000;
const STALLED_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
const TRACK_LIST_CACHE_MS = 20 * 1000;

const PLATFORMS = ['mixcloud', 'soundcloud'] as const;
type Platform = (typeof PLATFORMS)[number];

const LINK_FIELD: Record<Platform, 'MixCloudLink' | 'SoundcloudLink'> = {
  mixcloud: 'MixCloudLink',
  soundcloud: 'SoundcloudLink',
};
const REQUESTED_FIELD: Record<
  Platform,
  'RadioCultMixcloudRequestedAt' | 'RadioCultSoundcloudRequestedAt'
> = {
  mixcloud: 'RadioCultMixcloudRequestedAt',
  soundcloud: 'RadioCultSoundcloudRequestedAt',
};
const RC_URL_FIELD: Record<Platform, 'mixcloudUrl' | 'soundcloudUrl'> = {
  mixcloud: 'mixcloudUrl',
  soundcloud: 'soundcloudUrl',
};

export const DESCRIPTION = `A South East London based community run radio station, brought to you by @sistermidnightldn
➡️ More info, tune in: https://radio.sistermidnight.org/
➡️ Support us by becoming a member on Patreon`;

const TRACK_ARTIST = 'Sister Midnight';

/** Album name for a track: the broadcast month, e.g. "August 2026". */
const albumFor = (episode: any): string =>
  new Date(episode.BroadcastDateTime ?? Date.now()).toLocaleDateString('en-GB', {
    month: 'long',
    year: 'numeric',
  });

/** Error with an HTTP status the admin routes pass straight to the panel. */
export class RcHttpError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
  }
}

// Module-level so every consumer (routes, cron, lifecycles) shares them.
let rateLimitedUntil = 0;
let trackListCache: { fetchedAt: number; byId: Map<string, any> } | null = null;

const isEnabled = () => process.env.RADIOCULT_ENABLED !== 'false';
const apiKey = () => process.env.RADIOCULT_API_KEY;
const stationId = () => process.env.RADIOCULT_STATION_ID;

function assertConfigured() {
  if (!isEnabled()) {
    throw new RcHttpError(503, 'Radio Cult uploads are switched off (RADIOCULT_ENABLED=false)');
  }
  if (!apiKey() || !stationId()) {
    throw new RcHttpError(
      503,
      'Radio Cult is not configured — set RADIOCULT_API_KEY and RADIOCULT_STATION_ID'
    );
  }
}

async function rcFetch(
  pathname: string,
  init: RequestInit = {},
  timeoutMs?: number
): Promise<Response> {
  const method = init.method ?? 'GET';
  if (Date.now() < rateLimitedUntil) {
    strapi.log.warn(
      `radiocult api: ${method} ${pathname} skipped — rate limited until ${new Date(rateLimitedUntil).toISOString()}`
    );
    throw new RcHttpError(
      429,
      `Radio Cult rate limit hit — try again after ${new Date(rateLimitedUntil).toLocaleTimeString('en-GB')}`
    );
  }
  let res: Response;
  try {
    res = await fetch(`${RC_BASE}/api/station/${stationId()}${pathname}`, {
      ...init,
      headers: { 'x-api-key': apiKey()!, ...(init.headers ?? {}) },
      signal: timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined,
    });
  } catch (error: any) {
    strapi.log.error(`radiocult api: ${method} ${pathname} network failure: ${error?.stack ?? error}`);
    throw new RcHttpError(502, `Could not reach Radio Cult: ${error?.message ?? error}`);
  }
  if (res.status === 429) {
    const retryAfter = Number(res.headers.get('retry-after')) || 60;
    rateLimitedUntil = Date.now() + retryAfter * 1000;
    strapi.log.warn(
      `radiocult api: ${method} ${pathname} → 429, backing off ${retryAfter}s (until ${new Date(rateLimitedUntil).toISOString()})`
    );
    throw new RcHttpError(
      429,
      `Radio Cult rate limit hit — try again after ${new Date(rateLimitedUntil).toLocaleTimeString('en-GB')}`
    );
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    strapi.log.error(`radiocult api: ${method} ${pathname} → ${res.status}: ${body.slice(0, 1000)}`);
    if (res.status === 402) {
      // Radio Cult's docs say 402 = "the key and request are both fine, but the
      // station cannot use that endpoint on its current plan". That is NOT what
      // is happening on the Mixcloud publish endpoint: it 402s with
      // {"error":"Internal server error"} before it validates anything (an
      // empty body and a non-existent track id both 402 identically), while
      // every other Connect endpoint on the same key and plan — track upload,
      // SoundCloud publish — works. So it's a fault on their side, not ours.
      const isMixcloudPublish = pathname.endsWith('/upload/mixcloud');
      throw new RcHttpError(
        402,
        isMixcloudPublish
          ? `Radio Cult's Mixcloud publish endpoint is broken — it answers 402 "${body.slice(0, 120)}" no matter what is sent (verified with an empty request and a made-up track id), while SoundCloud publishing on the same key and plan works. Nothing here can fix it. Publish this one by hand in the Radio Cult dashboard (Media → the track → Actions → Upload to Mixcloud) — the link will still land on the episode automatically — and report the endpoint to Radio Cult support.`
          : `Radio Cult refused with 402: ${body.slice(0, 200)}. Per Radio Cult's docs this means the station's plan doesn't cover this endpoint — third-party publishing needs Premium/Business or the Connect add-on.`
      );
    }
    throw new RcHttpError(
      res.status >= 500 ? 502 : res.status,
      `Radio Cult responded ${res.status}: ${body.slice(0, 300)}`
    );
  }
  strapi.log.debug(`radiocult api: ${method} ${pathname} → ${res.status}`);
  return res;
}

/**
 * Picks the episode image variant that fits maxBytes (preferring the
 * `large`/`medium` formats over the original) and returns its bytes.
 * Strapi stores file sizes in kilobytes.
 */
async function resolveArtwork(
  strapi: Core.Strapi,
  episode: any,
  maxBytes: number
): Promise<{ buffer: Buffer; mime: string; name: string } | null> {
  const image = episode?.EpisodeImage;
  if (!image?.url) return null;

  const candidates = [image.formats?.large, image.formats?.medium, image].filter(Boolean);
  for (const candidate of candidates) {
    const mime = candidate.mime ?? image.mime;
    if (mime !== 'image/jpeg' && mime !== 'image/png') continue;
    if (candidate.size && candidate.size * 1024 > maxBytes) continue;
    try {
      let buffer: Buffer;
      if (candidate.url.startsWith('http')) {
        const res = await fetch(candidate.url, { signal: AbortSignal.timeout(30_000) });
        if (!res.ok) continue;
        buffer = Buffer.from(await res.arrayBuffer());
      } else {
        const diskPath = path.join(strapi.dirs.static.public, candidate.url);
        try {
          buffer = await fs.promises.readFile(diskPath);
        } catch {
          const serverUrl = strapi.config.get('server.url', 'http://localhost:1337');
          const res = await fetch(`${serverUrl}${candidate.url}`, {
            signal: AbortSignal.timeout(30_000),
          });
          if (!res.ok) continue;
          buffer = Buffer.from(await res.arrayBuffer());
        }
      }
      if (buffer.length > maxBytes) continue;
      return { buffer, mime, name: candidate.name ?? image.name ?? 'artwork' };
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * Summary of the episode image for the uploader page: preview URL plus
 * whether a jpeg/png variant small enough for SoundCloud's 2MB limit exists.
 */
function describeImage(episode: any) {
  const image = episode?.EpisodeImage;
  if (!image?.url) return null;
  const usable = [image.formats?.large, image.formats?.medium, image]
    .filter(Boolean)
    .some((candidate: any) => {
      const mime = candidate.mime ?? image.mime;
      if (mime !== 'image/jpeg' && mime !== 'image/png') return false;
      return !candidate.size || candidate.size * 1024 <= MAX_PUBLISH_ARTWORK_BYTES;
    });
  return {
    name: image.name ?? 'episode image',
    previewUrl: image.formats?.small?.url ?? image.formats?.thumbnail?.url ?? image.url,
    usable,
  };
}

/** Trimmed string or undefined — treats '', null and non-strings as absent. */
const cleanString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

function platformState(episode: any, platform: Platform) {
  const link = episode[LINK_FIELD[platform]];
  const requestedAt = episode[REQUESTED_FIELD[platform]];
  let state: 'not_published' | 'publishing' | 'linked' | 'stalled' = 'not_published';
  if (link) state = 'linked';
  else if (requestedAt) {
    state =
      Date.now() - new Date(requestedAt).getTime() > STALLED_AFTER_MS ? 'stalled' : 'publishing';
  }
  return { state, requestedAt: requestedAt ?? null, link: link ?? null };
}

/**
 * Whether we should look for this platform's URL on the Radio Cult track.
 * Covers publishes we requested *and* publishes done by hand in the Radio Cult
 * dashboard (no RequestedAt stamp) — that's the fallback route while Radio
 * Cult's Mixcloud publish endpoint is broken, and the link still has to land on
 * the episode. Limited to recently uploaded tracks so idle sweeps stay free.
 */
function awaitingLink(episode: any, platform: Platform): boolean {
  if (episode[LINK_FIELD[platform]]) return false;
  const { state } = platformState(episode, platform);
  if (state === 'publishing') return true;
  if (state !== 'not_published') return false;
  const uploadedAt = episode.RadioCultUploadedAt;
  return !!uploadedAt && Date.now() - new Date(uploadedAt).getTime() < STALLED_AFTER_MS;
}

export default ({ strapi }: { strapi: Core.Strapi }) => ({
  /**
   * Receives the browser upload (a formidable temp file), embeds artwork for
   * mp3s, forwards the file to Radio Cult and stores the returned track id.
   * `meta` carries the (possibly edited) details from the uploader page;
   * anything missing falls back to the episode's own values.
   */
  async uploadTrack({
    documentId,
    file,
    force,
    meta = {},
  }: {
    documentId: string;
    file: any;
    force: boolean;
    meta?: { title?: string; artist?: string; album?: string };
  }) {
    assertConfigured();
    if (typeof (fs as any).openAsBlob !== 'function') {
      throw new RcHttpError(501, 'Server Node version too old for uploads (needs Node 20+)');
    }
    if (!file?.filepath) {
      throw new RcHttpError(400, 'No audio file received — send it as the "files" field');
    }

    const filename = file.originalFilename ?? 'episode-audio';
    const ext = path.extname(filename).toLowerCase();
    if (ext !== '.mp3' && ext !== '.m4a') {
      throw new RcHttpError(400, `Radio Cult only accepts .mp3 or .m4a files (got "${ext || 'no extension'}")`);
    }
    if (file.size > MAX_TRACK_BYTES) {
      throw new RcHttpError(413, 'File is over Radio Cult’s 750MB limit');
    }

    const episode = await strapi.documents(EPISODE_UID).findOne({
      documentId,
      populate: { EpisodeImage: true },
    });
    if (!episode) throw new RcHttpError(404, 'Episode not found');
    if (episode.RadioCultTrackId && !force) {
      throw new RcHttpError(
        409,
        `This episode already has a Radio Cult track (${episode.RadioCultTrackId})`
      );
    }

    const title = cleanString(meta.title) ?? episode.EpisodeTitle;
    const artist = cleanString(meta.artist) ?? TRACK_ARTIST;
    const album = cleanString(meta.album) ?? albumFor(episode);
    strapi.log.info(
      `radiocult: uploading "${filename}" (${Math.round(file.size / 1024 / 1024)}MB) for episode ${documentId} — title "${title}", artist "${artist}", album "${album}"${force ? ' (replacing existing track)' : ''}`
    );

    const warnings: string[] = [];
    let uploadPath = file.filepath;
    let embeddedTmpPath: string | null = null;

    if (ext === '.mp3') {
      const artwork = await resolveArtwork(strapi, episode, MAX_EMBED_ARTWORK_BYTES);
      if (artwork) {
        try {
          embeddedTmpPath = await embedArtworkMp3(file.filepath, {
            title,
            artist,
            album,
            imageBuffer: artwork.buffer,
            imageMime: artwork.mime,
          });
          uploadPath = embeddedTmpPath;
        } catch (error) {
          warnings.push('Could not embed the episode image into the mp3 — uploaded without artwork');
          strapi.log.warn(`radiocult: artwork embed failed for ${documentId}: ${error}`);
        }
      } else {
        warnings.push(
          episode.EpisodeImage
            ? 'Episode image could not be used as artwork (needs to be a jpeg/png under 10MB)'
            : 'No episode image set — track uploaded without artwork'
        );
      }
    } else {
      warnings.push('m4a file: artwork cannot be embedded, so the Radio Cult track will have no image');
    }

    try {
      const formData = new FormData();
      const mime = ext === '.mp3' ? 'audio/mpeg' : 'audio/mp4';
      formData.append('stationMedia', await (fs as any).openAsBlob(uploadPath, { type: mime }), filename);
      formData.append('metadata', JSON.stringify({ title, filename, artist, album }));

      // No timeout: large files legitimately take a long time to transfer.
      const res = await rcFetch('/media/track', { method: 'POST', body: formData });
      const body: any = await res.json().catch(() => ({}));
      const trackId = body?.track?.id;
      if (!body?.success || !trackId) {
        throw new RcHttpError(
          502,
          `Unexpected Radio Cult response: ${JSON.stringify(body).slice(0, 300)}`
        );
      }

      try {
        // SendHostEmail:false keeps the host-notification lifecycle quiet.
        await strapi.db.query(EPISODE_UID).update({
          where: { documentId },
          data: {
            RadioCultTrackId: trackId,
            RadioCultUploadedAt: new Date().toISOString(),
            SendHostEmail: false,
          },
        });
      } catch (error) {
        strapi.log.error(
          `radiocult: track ${trackId} uploaded but saving it to episode ${documentId} failed: ${error}`
        );
        throw new RcHttpError(
          500,
          `The track reached Radio Cult (id ${trackId}) but saving the id to the episode failed — note the id down, then delete the track in the Radio Cult dashboard and re-upload`
        );
      }

      strapi.log.info(`radiocult: uploaded track ${trackId} for episode ${documentId}`);
      return { trackId, warnings };
    } finally {
      if (embeddedTmpPath) await fs.promises.unlink(embeddedTmpPath).catch(() => {});
    }
  },

  /**
   * Asks Radio Cult to publish the episode's track to Mixcloud or SoundCloud.
   * Radio Cult transfers asynchronously; syncLinks picks up the URL later.
   * `meta` carries the (possibly edited) details from the uploader page.
   */
  async publish({
    documentId,
    platform,
    force,
    meta = {},
  }: {
    documentId: string;
    platform: string;
    force: boolean;
    meta?: { title?: string; tags?: unknown; description?: string };
  }) {
    assertConfigured();
    if (!PLATFORMS.includes(platform as Platform)) {
      throw new RcHttpError(400, `Unknown platform "${platform}"`);
    }
    const target = platform as Platform;

    const episode = await strapi.documents(EPISODE_UID).findOne({
      documentId,
      populate: { EpisodeImage: true, tag_genres: true },
    });
    if (!episode) throw new RcHttpError(404, 'Episode not found');
    const trackId = episode.RadioCultTrackId;
    if (!trackId) throw new RcHttpError(409, 'Upload the episode to Radio Cult first');

    const existingLink = episode[LINK_FIELD[target]];
    if (existingLink && !force) {
      throw new RcHttpError(409, `Already published — link saved: ${existingLink}`);
    }
    const requestedAt = episode[REQUESTED_FIELD[target]];
    if (
      requestedAt &&
      !existingLink &&
      Date.now() - new Date(requestedAt).getTime() < PUBLISH_RETRY_GUARD_MS &&
      !force
    ) {
      throw new RcHttpError(
        409,
        `A ${target} publish was requested less than 10 minutes ago — Radio Cult is probably still transferring`
      );
    }

    const title = cleanString(meta.title) ?? episode.EpisodeTitle;
    const description = cleanString(meta.description) ?? DESCRIPTION;
    const tags: string[] = Array.isArray(meta.tags)
      ? meta.tags.map((tag) => cleanString(tag)).filter((tag): tag is string => !!tag)
      : (episode.tag_genres ?? []).map((tag: any) => tag.Genre).filter(Boolean);
    const artwork = await resolveArtwork(strapi, episode, MAX_PUBLISH_ARTWORK_BYTES);
    strapi.log.info(
      `radiocult: requesting ${target} publish of track ${trackId} (episode ${documentId}) — title "${title}", tags [${tags.join(', ')}], artwork ${artwork ? artwork.name : 'none'}${force ? ', forced' : ''}`
    );

    // Multipart body where every non-file field value is JSON-stringified
    // individually (strings arrive quoted, tags as one JSON array) — this is
    // the encoding shown in Radio Cult's own example code. Note that
    // disableComments/hideStats/hosts are Mixcloud Pro-only and must not be
    // sent to a regular account.
    const json = (value: unknown) => JSON.stringify(value);
    const formData = new FormData();
    if (target === 'mixcloud') {
      formData.append('name', json(title));
      formData.append('tags', json(tags.slice(0, 5))); // Mixcloud max 5
      formData.append('unlisted', json(false)); // required field per RC docs
      formData.append('description', json(description));
      if (artwork) {
        formData.append('artwork', new Blob([artwork.buffer], { type: artwork.mime }), artwork.name);
      }
    } else {
      formData.append('title', json(title));
      formData.append('tags', json(tags));
      formData.append('description', json(description));
      formData.append('sharing', json('public'));
      formData.append('downloadable', 'false');
      formData.append('commentable', 'true');
      formData.append('embeddableBy', json('all'));
      if (artwork) {
        formData.append('artworkData', new Blob([artwork.buffer], { type: artwork.mime }), artwork.name);
      }
    }

    const res = await rcFetch(
      `/media/track/${trackId}/upload/${target}`,
      { method: 'POST', body: formData },
      120_000
    );
    const body: any = await res.json().catch(() => ({}));
    if (body?.success === false) {
      throw new RcHttpError(502, `Radio Cult rejected the ${target} publish request`);
    }

    const now = new Date().toISOString();
    await strapi.db.query(EPISODE_UID).update({
      where: { documentId },
      data: { [REQUESTED_FIELD[target]]: now, SendHostEmail: false },
    });
    strapi.log.info(`radiocult: requested ${target} publish of track ${trackId} (${documentId})`);
    return { requestedAt: now };
  },

  /**
   * Finds episodes whose publish was requested but whose link hasn't arrived,
   * fetches Radio Cult's track list ONCE, and writes any links that appeared.
   * Called by the cron sweep, the status endpoint and the "check now" button.
   */
  async syncLinks({
    documentIds,
    bypassCache,
  }: { documentIds?: string[]; bypassCache?: boolean } = {}) {
    if (!isEnabled() || !apiKey() || !stationId()) return { updated: 0, pending: 0 };

    const episodes = await strapi.db.query(EPISODE_UID).findMany({
      where: {
        RadioCultTrackId: { $notNull: true },
        ...(documentIds ? { documentId: { $in: documentIds } } : {}),
      },
    });

    const pending = episodes.filter((episode) =>
      PLATFORMS.some((p) => awaitingLink(episode, p))
    );
    if (pending.length === 0) return { updated: 0, pending: 0 };

    if (
      !trackListCache ||
      bypassCache ||
      Date.now() - trackListCache.fetchedAt > TRACK_LIST_CACHE_MS
    ) {
      const res = await rcFetch('/media/track', { method: 'GET' }, 60_000);
      const body: any = await res.json().catch(() => ({}));
      const tracks: any[] = Array.isArray(body)
        ? body
        : (body.tracks ?? body.results ?? body.data ?? []);
      trackListCache = {
        fetchedAt: Date.now(),
        byId: new Map(tracks.map((track) => [track.id, track])),
      };
    }

    let updated = 0;
    for (const episode of pending) {
      const track = trackListCache.byId.get(episode.RadioCultTrackId);
      if (!track) continue;
      const data: Record<string, string | boolean> = {};
      for (const platform of PLATFORMS) {
        const url = track[RC_URL_FIELD[platform]];
        if (url && awaitingLink(episode, platform)) data[LINK_FIELD[platform]] = url;
      }
      if (Object.keys(data).length > 0) {
        data.SendHostEmail = false; // keep the host-notification lifecycle quiet
        await strapi.db.query(EPISODE_UID).update({
          where: { documentId: episode.documentId },
          data,
        });
        updated += 1;
        strapi.log.info(
          `radiocult: saved ${Object.keys(data).filter((k) => k !== 'SendHostEmail').join(', ')} for episode ${episode.documentId}`
        );
      }
    }
    return { updated, pending: pending.length };
  },

  /**
   * Per-episode state for the panel and the uploader page. Includes the
   * episode details the uploader page prefills its editable form with.
   */
  async getStatus(documentId: string, { refresh }: { refresh?: boolean } = {}) {
    const loadEpisode = () =>
      strapi.documents(EPISODE_UID).findOne({
        documentId,
        populate: { EpisodeImage: true, tag_genres: true, link_episode_to_show: true },
      });
    let episode: any = await loadEpisode();
    if (!episode) throw new RcHttpError(404, 'Episode not found');

    let rateLimitMessage: string | null = null;
    const hasPending = PLATFORMS.some((p) => awaitingLink(episode, p));
    if (episode.RadioCultTrackId && (hasPending || refresh)) {
      try {
        await this.syncLinks({ documentIds: [documentId], bypassCache: refresh });
        episode = await loadEpisode();
      } catch (error) {
        if (error instanceof RcHttpError && error.status === 429) rateLimitMessage = error.message;
        else throw error;
      }
    }

    return {
      enabled: isEnabled() && !!apiKey() && !!stationId(),
      trackId: episode.RadioCultTrackId ?? null,
      uploadedAt: episode.RadioCultUploadedAt ?? null,
      platforms: {
        mixcloud: platformState(episode, 'mixcloud'),
        soundcloud: platformState(episode, 'soundcloud'),
      },
      rateLimitMessage,
      // Prefill values for the uploader page's editable form.
      details: {
        title: episode.EpisodeTitle ?? '',
        // The show this episode belongs to — the uploader page uses it as the
        // browser tab title so several open tabs stay tellable apart.
        showName: episode.link_episode_to_show?.ShowName ?? '',
        artist: TRACK_ARTIST,
        album: albumFor(episode),
        description: DESCRIPTION,
        genres: (episode.tag_genres ?? []).map((tag: any) => tag.Genre).filter(Boolean),
        image: describeImage(episode),
      },
    };
  },

  /**
   * Pushes edited title/artist/album to an already-uploaded Radio Cult track
   * (the uploader page's "Save details to Radio Cult" button).
   */
  async updateTrackMetadata({
    documentId,
    meta,
  }: {
    documentId: string;
    meta: { title?: string; artist?: string; album?: string };
  }) {
    assertConfigured();
    const episode = await strapi.db.query(EPISODE_UID).findOne({ where: { documentId } });
    if (!episode) throw new RcHttpError(404, 'Episode not found');
    if (!episode.RadioCultTrackId) {
      throw new RcHttpError(409, 'Upload the episode to Radio Cult first');
    }

    const data: Record<string, string> = {};
    if (cleanString(meta.title)) data.title = cleanString(meta.title)!;
    if (cleanString(meta.artist)) data.artist = cleanString(meta.artist)!;
    if (cleanString(meta.album)) data.album = cleanString(meta.album)!;
    if (Object.keys(data).length === 0) {
      throw new RcHttpError(400, 'Nothing to update — title, artist and album are all empty');
    }

    await rcFetch(
      `/media/track/${episode.RadioCultTrackId}`,
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(data),
      },
      60_000
    );
    strapi.log.info(
      `radiocult: updated track ${episode.RadioCultTrackId} details for episode ${documentId} (${Object.keys(data).join(', ')})`
    );
    return { updated: Object.keys(data) };
  },

  /**
   * Lifecycle hook body: pushes a changed EpisodeTitle to the Radio Cult
   * track. Only fires when the title actually changed (beforeUpdate stashes
   * the previous value) — the track title can be customised on the uploader
   * page, and an unrelated episode save must not overwrite it.
   */
  async maybeSyncTitle(event: any) {
    if (!isEnabled() || !apiKey() || !stationId()) return;
    const title = event.params?.data?.EpisodeTitle;
    if (typeof title !== 'string' || !title.trim()) return;
    const previousTitle = event.state?.radiocultPreviousTitle;
    if (typeof previousTitle === 'string' && previousTitle === title) return;
    const documentId = event.result?.documentId;
    if (!documentId) return;

    const episode = await strapi.db.query(EPISODE_UID).findOne({ where: { documentId } });
    if (!episode?.RadioCultTrackId) return;

    await rcFetch(
      `/media/track/${episode.RadioCultTrackId}`,
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title }),
      },
      60_000
    );
    strapi.log.info(
      `radiocult: synced title of track ${episode.RadioCultTrackId} for episode ${documentId}`
    );
  },
});
