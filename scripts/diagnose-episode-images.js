/**
 * Diagnostic Script for Episode Image Matching
 *
 * This script helps identify why images aren't matching with episodes.
 * It compares image filenames with episode slugs and shows discrepancies.
 *
 * Usage:
 *   npx strapi console
 *   await require('./scripts/diagnose-episode-images.js')(strapi)
 */

module.exports = async (strapi) => {
  console.log('\n🔍 Episode Image Matching Diagnostic\n');
  console.log('─'.repeat(80));

  try {
    // Count total episodes
    const totalEpisodes = await strapi.db.query('api::episode.episode').count();
    console.log(`\n📊 Total episodes in database: ${totalEpisodes}`);

    // Find the Episode Images Archive folder
    console.log('\n📁 Looking for "Episode Images Archive" folder...');
    const archiveFolder = await strapi.db.query('plugin::upload.folder').findOne({
      where: { name: 'Episode Images Archive' }
    });

    if (!archiveFolder) {
      console.error('❌ "Episode Images Archive" folder not found!');
      return;
    }

    console.log(`✓ Found folder: "${archiveFolder.name}"`);

    // Get all images from the folder
    const images = await strapi.db.query('plugin::upload.file').findMany({
      where: {
        $or: [
          { folderPath: { $eq: archiveFolder.path } },
          { folderPath: { $startsWith: `${archiveFolder.path}/` } }
        ]
      }
    });

    console.log(`✓ Found ${images.length} images in folder\n`);

    // Get all episodes with their slugs
    console.log('📥 Fetching all episodes...');
    const episodes = await strapi.db.query('api::episode.episode').findMany({
      select: ['id', 'EpisodeSlug', 'EpisodeTitle'],
      populate: { EpisodeImage: true }
    });

    console.log(`✓ Found ${episodes.length} episodes\n`);
    console.log('─'.repeat(80));

    // Create a map of episode slugs for easy lookup
    const episodeMap = new Map();
    episodes.forEach(ep => {
      episodeMap.set(ep.EpisodeSlug, ep);
    });

    // Analyze first 10 images in detail
    console.log('\n📋 DETAILED ANALYSIS - First 10 Images:\n');
    const sampleImages = images.slice(0, 10);

    for (const img of sampleImages) {
      const slug = img.name.replace(/\.[^/.]+$/, "");
      const episode = episodeMap.get(slug);

      console.log(`\nImage: "${img.name}"`);
      console.log(`  Extracted slug: "${slug}"`);
      console.log(`  Slug length: ${slug.length} chars`);
      console.log(`  Match found: ${episode ? '✅ YES' : '❌ NO'}`);

      if (episode) {
        console.log(`  Episode: "${episode.EpisodeTitle}"`);
        console.log(`  Episode slug: "${episode.EpisodeSlug}"`);
        console.log(`  Has image: ${episode.EpisodeImage ? 'Yes' : 'No'}`);
      } else {
        // Try to find similar slugs
        const similarSlugs = episodes
          .filter(ep => ep.EpisodeSlug.includes(slug) || slug.includes(ep.EpisodeSlug))
          .slice(0, 3);

        if (similarSlugs.length > 0) {
          console.log(`  🔍 Similar episode slugs found:`);
          similarSlugs.forEach(ep => {
            console.log(`     - "${ep.EpisodeSlug}" (${ep.EpisodeTitle})`);
          });
        }
      }
    }

    // Summary statistics
    console.log('\n' + '─'.repeat(80));
    console.log('\n📊 MATCHING STATISTICS:\n');

    let wouldMatch = 0;
    let wouldNotMatch = 0;
    const unmatchedSamples = [];

    for (const img of images) {
      const slug = img.name.replace(/\.[^/.]+$/, "");
      if (episodeMap.has(slug)) {
        wouldMatch++;
      } else {
        wouldNotMatch++;
        if (unmatchedSamples.length < 20) {
          unmatchedSamples.push({ filename: img.name, slug });
        }
      }
    }

    console.log(`Total images: ${images.length}`);
    console.log(`Would match: ${wouldMatch} (${((wouldMatch/images.length)*100).toFixed(1)}%)`);
    console.log(`Would NOT match: ${wouldNotMatch} (${((wouldNotMatch/images.length)*100).toFixed(1)}%)`);

    // Show sample of unmatched
    if (unmatchedSamples.length > 0) {
      console.log(`\n⚠️  Sample of unmatched images (first 20):\n`);
      unmatchedSamples.forEach(({ filename, slug }) => {
        console.log(`   "${filename}" → slug: "${slug}"`);
      });
    }

    // Check for episodes with images
    const episodesWithImages = episodes.filter(ep => ep.EpisodeImage);
    console.log(`\n📷 Episodes currently with images: ${episodesWithImages.length}`);

    // Sample of episodes with images
    if (episodesWithImages.length > 0) {
      console.log(`\nFirst 5 episodes with images:`);
      episodesWithImages.slice(0, 5).forEach(ep => {
        console.log(`   - "${ep.EpisodeTitle}" (slug: "${ep.EpisodeSlug}")`);
      });
    }

    // Sample of episode slugs for comparison
    console.log('\n📋 Sample of episode slugs in database (first 10):\n');
    episodes.slice(0, 10).forEach(ep => {
      console.log(`   "${ep.EpisodeSlug}" - ${ep.EpisodeTitle}`);
    });

    console.log('\n' + '─'.repeat(80));
    console.log('\n✅ Diagnostic complete!\n');

    return {
      totalEpisodes,
      totalImages: images.length,
      wouldMatch,
      wouldNotMatch,
      episodesWithImages: episodesWithImages.length,
      unmatchedSamples
    };

  } catch (error) {
    console.error('\n❌ Error during diagnostic:', error);
    throw error;
  }
};
