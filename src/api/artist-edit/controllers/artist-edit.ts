/**
 * Public, token-gated endpoints backing the artist self-service edit page.
 * The JWT (emailed to the artist) scopes access to their single artist entry
 * and only the whitelisted fields below are ever read or written.
 */

import jwt from 'jsonwebtoken';

const ARTIST_UID = 'api::artist.artist';

const verifyToken = (token: string): string | null => {
  const secret = process.env.EPISODE_EDIT_JWT_SECRET;
  if (!secret || !token) return null;
  try {
    const payload = jwt.verify(token, secret) as jwt.JwtPayload;
    if (payload.purpose !== 'artist-edit' || typeof payload.documentId !== 'string') {
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

    const artist = await strapi.documents(ARTIST_UID).findOne({ documentId });
    if (!artist) return ctx.notFound('Artist not found');

    // Hand-built response: never spread the raw artist
    // (Real_Name, Artist_PhoneNumber etc. must not leak)
    ctx.body = {
      artist: {
        ArtistName: artist.ArtistName,
        ArtistBio: artist.ArtistBio ?? '',
        ArtistInstagram: artist.ArtistInstagram ?? '',
        ArtistWebsite: artist.ArtistWebsite ?? '',
        ArtistEmail: artist.ArtistEmail ?? '',
      },
    };
  },

  async update(ctx) {
    const documentId = verifyToken(ctx.params.token);
    if (!documentId) return ctx.unauthorized('Link invalid or expired');

    const body = ctx.request.body ?? {};

    const name = typeof body.ArtistName === 'string' ? body.ArtistName.trim() : null;
    if (!name || name.length > 255) {
      return ctx.badRequest('ArtistName must be a non-empty string of at most 255 characters');
    }

    const bio = typeof body.ArtistBio === 'string' ? body.ArtistBio : '';
    const instagram = typeof body.ArtistInstagram === 'string' ? body.ArtistInstagram.trim() : '';
    const website = typeof body.ArtistWebsite === 'string' ? body.ArtistWebsite.trim() : '';
    const email = typeof body.ArtistEmail === 'string' ? body.ArtistEmail.trim() : '';
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return ctx.badRequest('Please enter a valid email address');
    }

    const exists = await strapi.documents(ARTIST_UID).findOne({ documentId, fields: ['id'] });
    if (!exists) return ctx.notFound('Artist not found');

    // Only these five fields are ever writable via this endpoint.
    // Artist_Slug is a uid and is NOT regenerated on name change.
    await strapi.documents(ARTIST_UID).update({
      documentId,
      data: {
        ArtistName: name,
        ArtistBio: bio,
        ArtistInstagram: instagram,
        ArtistWebsite: website,
        ArtistEmail: email || null,
      },
    });

    ctx.body = { ok: true };
  },
};
