/**
 * Embeds artwork into an mp3's ID3v2 tag without loading the audio into
 * memory. Radio Cult has no artwork API — it only reads the art embedded in
 * the uploaded file — so this runs on every mp3 upload that has an episode
 * image. Any existing ID3v2 tag is replaced (audio frames are untouched).
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import NodeID3 from 'node-id3';

/**
 * Returns the byte offset where the audio starts, i.e. the length of the
 * existing ID3v2 tag (0 if there isn't one).
 */
async function existingTagLength(filePath: string): Promise<number> {
  const handle = await fs.promises.open(filePath, 'r');
  try {
    const header = Buffer.alloc(10);
    const { bytesRead } = await handle.read(header, 0, 10, 0);
    if (bytesRead < 10 || header.toString('latin1', 0, 3) !== 'ID3') return 0;
    // Tag size is a syncsafe integer in bytes 6-9 (7 bits per byte),
    // excluding the 10-byte header and optional 10-byte footer.
    const size =
      ((header[6] & 0x7f) << 21) |
      ((header[7] & 0x7f) << 14) |
      ((header[8] & 0x7f) << 7) |
      (header[9] & 0x7f);
    const hasFooter = (header[5] & 0x10) !== 0;
    return 10 + size + (hasFooter ? 10 : 0);
  } finally {
    await handle.close();
  }
}

/**
 * Writes a copy of `srcPath` with a fresh ID3v2 tag (title + front-cover
 * artwork) into the OS temp dir and returns the new file's path. The caller
 * is responsible for deleting the returned file.
 */
export async function embedArtworkMp3(
  srcPath: string,
  opts: { title: string; imageBuffer: Buffer; imageMime: string }
): Promise<string> {
  const tagBuffer = NodeID3.create({
    title: opts.title,
    image: {
      mime: opts.imageMime,
      type: { id: 3, name: 'front cover' },
      description: 'cover',
      imageBuffer: opts.imageBuffer,
    },
  });

  const audioStart = await existingTagLength(srcPath);
  const outPath = path.join(
    os.tmpdir(),
    `radiocult-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.mp3`
  );

  await fs.promises.writeFile(outPath, tagBuffer);
  await pipeline(
    fs.createReadStream(srcPath, { start: audioStart }),
    fs.createWriteStream(outPath, { flags: 'a' })
  );
  return outPath;
}
