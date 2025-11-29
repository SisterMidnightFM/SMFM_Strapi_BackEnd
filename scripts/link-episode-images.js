/**
 * Bulk Link Episode Images Script
 *
 * This script links uploaded images from the Media Library to episodes
 * by matching image filenames with episode slugs.
 *
 * Usage:
 *   1. Upload all images to "Episode Images Archive" folder in Strapi Media Library
 *   2. Run: npx strapi console
 *   3. Paste: await require('./scripts/link-episode-images.js')(strapi)
 *
 * Prerequisites:
 *   - All images must be uploaded to the "Episode Images Archive" folder
 *   - Image filenames (without extension) must match EpisodeSlug exactly
 *   - Example: "woodwork-presents-james-king.png" → EpisodeSlug: "woodwork-presents-james-king"
 */

module.exports = async (strapi) => {
  console.log('\n🚀 Starting Episode Image Linking Process...\n');

  try {
    // Find the "Episode Images Archive" folder
    console.log('📁 Looking for "Episode Images Archive" folder...');
    const archiveFolder = await strapi.db.query('plugin::upload.folder').findOne({
      where: { name: 'Episode Images Archive' }
    });

    if (!archiveFolder) {
      console.error('❌ Error: "Episode Images Archive" folder not found in Media Library.');
      console.log('💡 Please create this folder and upload your images to it first.\n');
      return { success: false, error: 'Folder not found' };
    }

    console.log(`✓ Found folder: "${archiveFolder.name}" (path: ${archiveFolder.path})\n`);

    // Fetch images only from the Episode Images Archive folder
    console.log('📥 Fetching images from "Episode Images Archive" folder...');
    const images = await strapi.db.query('plugin::upload.file').findMany({
      where: {
        $or: [
          { folderPath: { $eq: archiveFolder.path } },
          { folderPath: { $startsWith: `${archiveFolder.path}/` } }
        ]
      },
      populate: { folder: true }
    });
    console.log(`✓ Found ${images.length} images in Episode Images Archive\n`);

    if (images.length === 0) {
      console.log('⚠️  No images found in media library. Please upload images first.');
      return;
    }

    // Fetch all episodes to verify count
    console.log('📥 Fetching episodes from database...');
    const allEpisodes = await strapi.db.query('api::episode.episode').findMany({
      select: ['id', 'EpisodeSlug', 'EpisodeTitle']
    });
    console.log(`✓ Found ${allEpisodes.length} episodes in database\n`);

    // Track statistics
    let matched = 0;
    let unmatched = 0;
    let alreadyLinked = 0;
    let errors = 0;
    const unmatchedImages = [];
    const matchedEpisodes = [];

    console.log('🔗 Starting image linking process...\n');
    console.log('─'.repeat(80));

    // Process each image
    for (const img of images) {
      try {
        // Extract slug from filename (remove extension)
        const slug = img.name.replace(/\.[^/.]+$/, "");

        // Find matching episode by EpisodeSlug
        const episode = await strapi.db.query('api::episode.episode').findOne({
          where: { EpisodeSlug: slug },
          populate: { EpisodeImage: true }
        });

        if (!episode) {
          console.log(`❌ No match: "${slug}"`);
          unmatchedImages.push({ filename: img.name, slug });
          unmatched++;
          continue;
        }

        // Check if episode already has an image
        if (episode.EpisodeImage) {
          console.log(`⏭️  Skip: "${episode.EpisodeTitle}" (already has image)`);
          alreadyLinked++;
          continue;
        }

        // Link image to episode
        await strapi.db.query('api::episode.episode').update({
          where: { id: episode.id },
          data: { EpisodeImage: img.id }
        });

        console.log(`✅ Linked: "${img.name}" → "${episode.EpisodeTitle}"`);
        matched++;
        matchedEpisodes.push({
          episodeTitle: episode.EpisodeTitle,
          episodeSlug: episode.EpisodeSlug,
          imageName: img.name
        });

      } catch (error) {
        console.error(`⚠️  Error processing "${img.name}":`, error.message);
        errors++;
      }
    }

    // Print summary
    console.log('\n' + '─'.repeat(80));
    console.log('\n📊 SUMMARY\n');
    console.log('─'.repeat(80));
    console.log(`✅ Successfully linked:     ${matched}`);
    console.log(`⏭️  Already had images:     ${alreadyLinked}`);
    console.log(`❌ Unmatched images:        ${unmatched}`);
    console.log(`⚠️  Errors:                 ${errors}`);
    console.log(`📁 Total images processed:  ${images.length}`);
    console.log(`📺 Total episodes in DB:    ${allEpisodes.length}`);
    console.log('─'.repeat(80));

    // Show unmatched images if any
    if (unmatchedImages.length > 0) {
      console.log('\n⚠️  UNMATCHED IMAGES:\n');
      unmatchedImages.forEach(({ filename, slug }) => {
        console.log(`   • ${filename} (slug: "${slug}")`);
      });
      console.log('\n💡 Tip: Check if these image filenames match episode slugs exactly.');
    }

    // Verify final state
    console.log('\n🔍 Verifying results...');
    const episodesWithImages = await strapi.db.query('api::episode.episode').count({
      where: { EpisodeImage: { $notNull: true } }
    });
    console.log(`✓ Total episodes with images: ${episodesWithImages}\n`);

    console.log('✨ Process complete!\n');

    return {
      success: true,
      stats: {
        matched,
        unmatched,
        alreadyLinked,
        errors,
        totalImages: images.length,
        totalEpisodes: allEpisodes.length,
        episodesWithImages
      },
      unmatchedImages,
      matchedEpisodes
    };

  } catch (error) {
    console.error('\n❌ Fatal error during image linking:', error);
    throw error;
  }
};
