/**
 * Bulk Link Episode Images Script (CSV-Based)
 *
 * This script links uploaded images from the Media Library to episodes
 * by reading mappings from a CSV file.
 *
 * Usage:
 *   1. Ensure episodes_with_images.csv is in scripts/ folder
 *   2. Upload all images to "Episode Images Archive" folder in Strapi Media Library
 *   3. Run: npx strapi console
 *
 *   DRY RUN (test without making changes):
 *   process.env.DRY_RUN = 'true'
 *   await require('./scripts/link-episode-images.js')(strapi)
 *
 *   TEST ON FIRST 5 EPISODES:
 *   process.env.TEST_LIMIT = '5'
 *   await require('./scripts/link-episode-images.js')(strapi)
 *
 *   DRY RUN + TEST LIMIT:
 *   process.env.DRY_RUN = 'true'
 *   process.env.TEST_LIMIT = '5'
 *   await require('./scripts/link-episode-images.js')(strapi)
 *
 *   FULL RUN:
 *   await require('./scripts/link-episode-images.js')(strapi)
 *
 * Prerequisites:
 *   - CSV file must exist at scripts/episodes_with_images.csv
 *   - All images must be uploaded to the "Episode Images Archive" folder
 *   - CSV must have EpisodeSlug and EpisodeImageName columns
 */

const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');

module.exports = async (strapi) => {
  const DRY_RUN = process.env.DRY_RUN === 'true';
  const TEST_LIMIT = process.env.TEST_LIMIT ? parseInt(process.env.TEST_LIMIT) : null;

  console.log('\n🚀 Starting Episode Image Linking Process...\n');
  if (DRY_RUN) console.log('⚠️  DRY RUN MODE - No changes will be made\n');
  if (TEST_LIMIT) console.log(`⚠️  TEST MODE - Processing only first ${TEST_LIMIT} episodes\n`);

  try {
    // 1. Read and parse CSV file
    console.log('📄 Reading CSV file...');
    const csvPath = path.join(__dirname, 'episodes_with_images.csv');

    if (!fs.existsSync(csvPath)) {
      console.error('❌ Error: CSV file not found at:', csvPath);
      return { success: false, error: 'CSV file not found' };
    }

    const csvContent = fs.readFileSync(csvPath, 'utf-8');
    const records = parse(csvContent, {
      columns: true,
      skip_empty_lines: true
    });

    // Create mapping: EpisodeSlug → EpisodeImageName
    const csvMapping = new Map();
    records.forEach(record => {
      if (record.EpisodeSlug && record.EpisodeImageName) {
        csvMapping.set(record.EpisodeSlug, record.EpisodeImageName.trim());
      }
    });

    console.log(`✓ Loaded ${csvMapping.size} episode → image mappings from CSV`);
    console.log(`✓ Total records in CSV: ${records.length}\n`);

    // 2. Find Episode Images Archive folder
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

    // 3. Fetch images only from the Episode Images Archive folder
    console.log('📥 Fetching images from "Episode Images Archive" folder...');
    const allImages = await strapi.db.query('plugin::upload.file').findMany({
      where: {
        $or: [
          { folderPath: { $eq: archiveFolder.path } },
          { folderPath: { $startsWith: `${archiveFolder.path}/` } }
        ]
      },
      populate: { folder: true }
    });

    // Create image lookup map by filename for O(1) access
    const imageMap = new Map();
    allImages.forEach(img => {
      imageMap.set(img.name, img);
    });

    console.log(`✓ Found ${allImages.length} images in Episode Images Archive\n`);

    if (allImages.length === 0) {
      console.log('⚠️  No images found in media library. Please upload images first.');
      return { success: false, error: 'No images in folder' };
    }

    // 4. Fetch all episodes from database
    console.log('📥 Fetching episodes from database...');
    let allEpisodes = await strapi.db.query('api::episode.episode').findMany({
      select: ['id', 'EpisodeSlug', 'EpisodeTitle'],
      populate: { EpisodeImage: true }
    });

    console.log(`✓ Found ${allEpisodes.length} episodes in database\n`);

    // Apply test limit if specified
    if (TEST_LIMIT) {
      allEpisodes = allEpisodes.slice(0, TEST_LIMIT);
      console.log(`⚠️  Limited to first ${allEpisodes.length} episodes for testing\n`);
    }

    // 5. Track statistics
    let matched = 0;
    let alreadyLinked = 0;
    let noImageSpecified = 0;
    let imageNotFound = 0;
    let errors = 0;

    const matchedPairs = [];
    const notFoundImages = [];
    const skippedNoName = [];

    console.log('🔗 Starting image linking process...\n');
    console.log('─'.repeat(80));

    // 6. Process each episode
    for (const episode of allEpisodes) {
      try {
        // Look up image name from CSV mapping
        const imageNameFromCsv = csvMapping.get(episode.EpisodeSlug);

        // Skip if no image name in CSV
        if (!imageNameFromCsv || imageNameFromCsv.trim() === '') {
          console.log(`⏭️  Skip: "${episode.EpisodeTitle}" (no image name in CSV)`);
          noImageSpecified++;
          skippedNoName.push({
            episodeTitle: episode.EpisodeTitle,
            episodeSlug: episode.EpisodeSlug
          });
          continue;
        }

        // Skip if episode already has an image
        if (episode.EpisodeImage) {
          console.log(`⏭️  Skip: "${episode.EpisodeTitle}" (already has image)`);
          alreadyLinked++;
          continue;
        }

        // Find matching image by filename from CSV
        const matchedImage = imageMap.get(imageNameFromCsv);

        if (!matchedImage) {
          console.log(`❌ Image not found: "${imageNameFromCsv}" for "${episode.EpisodeTitle}"`);
          imageNotFound++;
          notFoundImages.push({
            episodeTitle: episode.EpisodeTitle,
            episodeSlug: episode.EpisodeSlug,
            imageName: imageNameFromCsv
          });
          continue;
        }

        // Link image to episode (or simulate in dry-run mode)
        if (DRY_RUN) {
          console.log(`[DRY RUN] Would link: "${imageNameFromCsv}" → "${episode.EpisodeTitle}"`);
        } else {
          await strapi.db.query('api::episode.episode').update({
            where: { id: episode.id },
            data: { EpisodeImage: matchedImage.id }
          });
          console.log(`✅ Linked: "${imageNameFromCsv}" → "${episode.EpisodeTitle}"`);
        }

        matched++;
        matchedPairs.push({
          episodeTitle: episode.EpisodeTitle,
          episodeSlug: episode.EpisodeSlug,
          imageName: imageNameFromCsv
        });

      } catch (error) {
        console.error(`⚠️  Error processing "${episode.EpisodeTitle}":`, error.message);
        errors++;
      }
    }

    // 7. Print summary
    console.log('\n' + '─'.repeat(80));
    console.log('\n📊 SUMMARY\n');
    console.log('─'.repeat(80));
    console.log(`✅ Successfully ${DRY_RUN ? 'would link' : 'linked'}:     ${matched}`);
    console.log(`⏭️  Already had images:                ${alreadyLinked}`);
    console.log(`⏭️  No image name specified:           ${noImageSpecified}`);
    console.log(`❌ Image not found in Media Library:  ${imageNotFound}`);
    console.log(`⚠️  Errors:                            ${errors}`);
    console.log(`📺 Total episodes processed:           ${allEpisodes.length}`);
    console.log('─'.repeat(80));

    // 8. Show details for images not found
    if (notFoundImages.length > 0) {
      console.log('\n⚠️  IMAGES NOT FOUND IN MEDIA LIBRARY:\n');
      notFoundImages.slice(0, 20).forEach(({ episodeTitle, imageName }) => {
        console.log(`   • "${imageName}" for "${episodeTitle}"`);
      });
      if (notFoundImages.length > 20) {
        console.log(`   ... and ${notFoundImages.length - 20} more`);
      }
      console.log('\n💡 Tip: Upload missing images to "Episode Images Archive" folder.');
    }

    // 9. Show episodes with no image name
    if (skippedNoName.length > 0 && skippedNoName.length <= 10) {
      console.log('\n⏭️  EPISODES WITH NO IMAGE NAME IN CSV:\n');
      skippedNoName.forEach(({ episodeTitle }) => {
        console.log(`   • "${episodeTitle}"`);
      });
    } else if (skippedNoName.length > 10) {
      console.log(`\n⏭️  ${skippedNoName.length} episodes have no image name specified in CSV`);
    }

    // 10. Verify final state (only if not dry run)
    if (!DRY_RUN && !TEST_LIMIT) {
      console.log('\n🔍 Verifying results...');
      const episodesWithImages = await strapi.db.query('api::episode.episode').count({
        where: { EpisodeImage: { $notNull: true } }
      });
      console.log(`✓ Total episodes with images: ${episodesWithImages}\n`);
    }

    console.log('✨ Process complete!\n');

    if (DRY_RUN) {
      console.log('💡 To run for real, unset DRY_RUN:');
      console.log('   delete process.env.DRY_RUN');
      console.log('   await require(\'./scripts/link-episode-images.js\')(strapi)\n');
    }

    return {
      success: true,
      dryRun: DRY_RUN,
      testLimit: TEST_LIMIT,
      stats: {
        matched,
        alreadyLinked,
        noImageSpecified,
        imageNotFound,
        errors,
        totalProcessed: allEpisodes.length
      },
      notFoundImages,
      skippedNoName,
      matchedPairs
    };

  } catch (error) {
    console.error('\n❌ Fatal error during image linking:', error);
    throw error;
  }
};
