/**
 * Link Show Images Script (Automated)
 *
 * This script links images to shows that don't currently have a ShowImage by:
 * - Priority 1: Randomly selecting an episode image from the show's episodes
 * - Priority 2: Randomly selecting an artist image from the show's Main_Host artists
 * - Priority 3: Skipping and reporting shows with no available images
 *
 * Usage:
 *   1. Run: npx strapi console
 *
 *   DRY RUN (preview changes without making them):
 *   process.env.DRY_RUN = 'true'
 *   await require('./scripts/link-show-images.js')(strapi)
 *
 *   TEST LIMIT (process only first N shows):
 *   process.env.TEST_LIMIT = '5'
 *   await require('./scripts/link-show-images.js')(strapi)
 *
 *   COMBINED (dry run on first 5 shows):
 *   process.env.DRY_RUN = 'true'
 *   process.env.TEST_LIMIT = '5'
 *   await require('./scripts/link-show-images.js')(strapi)
 *
 *   FULL RUN (process all shows):
 *   await require('./scripts/link-show-images.js')(strapi)
 *
 * Prerequisites:
 *   - Episodes must have EpisodeImage field populated (if using Priority 1)
 *   - Artists must have ArtistImage field populated (if using Priority 2)
 */

module.exports = async (strapi) => {
  const DRY_RUN = process.env.DRY_RUN === 'true';
  const TEST_LIMIT = process.env.TEST_LIMIT ? parseInt(process.env.TEST_LIMIT) : null;

  console.log('\n🚀 Starting Show Image Linking Process...\n');
  if (DRY_RUN) console.log('⚠️  DRY RUN MODE - No changes will be made\n');
  if (TEST_LIMIT) console.log(`⚠️  TEST MODE - Processing only first ${TEST_LIMIT} shows\n`);

  try {
    // 1. Fetch shows without ShowImage
    console.log('📥 Fetching shows without ShowImage...');
    let shows = await strapi.db.query('api::show.show').findMany({
      where: { ShowImage: { $null: true } },
      select: ['id', 'ShowName', 'ShowSlug'],
      populate: {
        Main_Host: {
          select: ['id', 'ArtistName'],
          populate: { ArtistImage: true }
        }
      }
    });

    console.log(`✓ Found ${shows.length} shows without ShowImage\n`);

    if (shows.length === 0) {
      console.log('✨ All shows already have images!\n');
      return { success: true };
    }

    // 2. Apply test limit if specified
    if (TEST_LIMIT) {
      shows = shows.slice(0, TEST_LIMIT);
      console.log(`⚠️  Limited to first ${shows.length} shows for testing\n`);
    }

    // 3. Initialize statistics
    let linkedFromEpisodes = 0;
    let linkedFromArtists = 0;
    let noImageFound = 0;
    let errors = 0;
    const noImageShows = [];

    console.log('🔗 Starting image linking process...\n');
    console.log('─'.repeat(80));

    // 4. Process each show
    for (const show of shows) {
      try {
        console.log(`\n📺 Show: "${show.ShowName}"`);

        let selectedImage = null;
        let selectedSource = null;
        let selectedDetails = {};

        // Priority 1: Check episodes for images
        console.log('   🔍 Checking episodes for images...');
        const episodesWithImages = await strapi.db.query('api::episode.episode').findMany({
          where: {
            link_episode_to_show: { id: show.id },
            EpisodeImage: { $notNull: true }
          },
          select: ['id', 'EpisodeTitle', 'BroadcastDateTime'],
          populate: { EpisodeImage: true }
        });

        if (episodesWithImages.length > 0) {
          // Randomly select an episode
          const randomEpisode = episodesWithImages[Math.floor(Math.random() * episodesWithImages.length)];
          selectedImage = randomEpisode.EpisodeImage;
          selectedSource = 'episode';
          selectedDetails = {
            episodeTitle: randomEpisode.EpisodeTitle,
            imageName: selectedImage.name
          };
          console.log(`   ✓ Found ${episodesWithImages.length} episode(s) with images`);
          console.log(`   ✓ Randomly selected: "${selectedDetails.imageName}"`);
          console.log(`     From episode: "${selectedDetails.episodeTitle}"`);
        }

        // Priority 2: Check hosts for images (if no episode image)
        if (!selectedImage) {
          console.log('   ℹ️  No episode images found, checking hosts...');

          if (show.Main_Host && show.Main_Host.length > 0) {
            // Find all hosts with images
            const hostsWithImages = show.Main_Host.filter(host => host.ArtistImage);

            if (hostsWithImages.length > 0) {
              // Randomly select one host
              const randomHost = hostsWithImages[Math.floor(Math.random() * hostsWithImages.length)];
              selectedImage = randomHost.ArtistImage;
              selectedSource = 'artist';
              selectedDetails = {
                artistName: randomHost.ArtistName,
                imageName: selectedImage.name
              };
              console.log(`   ✓ Found ${hostsWithImages.length} host(s) with images`);
              console.log(`   ✓ Randomly selected: "${selectedDetails.imageName}"`);
              console.log(`     From host: "${selectedDetails.artistName}"`);
            } else {
              console.log(`   ℹ️  Show has ${show.Main_Host.length} host(s) but none have images`);
            }
          } else {
            console.log('   ℹ️  Show has no hosts');
          }
        }

        // Priority 3: No image found
        if (!selectedImage) {
          console.log(`❌ No image available for: "${show.ShowName}"`);
          noImageFound++;

          // Gather details for reporting
          const episodeCount = await strapi.db.query('api::episode.episode').count({
            where: { link_episode_to_show: { id: show.id } }
          });

          noImageShows.push({
            showName: show.ShowName,
            showSlug: show.ShowSlug,
            episodeCount,
            hostCount: show.Main_Host ? show.Main_Host.length : 0
          });
          continue;
        }

        // Link image to show
        if (DRY_RUN) {
          console.log(`[DRY RUN] Would link: "${selectedDetails.imageName}" → "${show.ShowName}" (from ${selectedSource})`);
        } else {
          await strapi.db.query('api::show.show').update({
            where: { id: show.id },
            data: { ShowImage: selectedImage.id }
          });
          console.log(`✅ Linked: "${selectedDetails.imageName}" → "${show.ShowName}" (from ${selectedSource})`);
        }

        // Update statistics
        if (selectedSource === 'episode') {
          linkedFromEpisodes++;
        } else {
          linkedFromArtists++;
        }

      } catch (error) {
        console.error(`⚠️  Error processing "${show.ShowName}":`, error.message);
        errors++;
      }
    }

    // 5. Print summary
    console.log('\n' + '─'.repeat(80));
    console.log('\n📊 SUMMARY\n');
    console.log('─'.repeat(80));
    console.log(`✅ Linked from episodes:              ${linkedFromEpisodes}`);
    console.log(`✅ Linked from artist images:         ${linkedFromArtists}`);
    console.log(`❌ No images found:                   ${noImageFound}`);
    console.log(`⚠️  Errors:                            ${errors}`);
    console.log(`📺 Total shows processed:             ${shows.length}`);
    console.log('─'.repeat(80));

    // 6. Show details for shows with no images
    if (noImageShows.length > 0) {
      console.log('\n⚠️  SHOWS WITH NO AVAILABLE IMAGES:\n');
      noImageShows.slice(0, 20).forEach(({ showName, episodeCount, hostCount }) => {
        console.log(`   • "${showName}"`);
        console.log(`     Episodes: ${episodeCount} (none with images) | Hosts: ${hostCount} (none with images)`);
      });
      if (noImageShows.length > 20) {
        console.log(`   ... and ${noImageShows.length - 20} more`);
      }
      console.log('\n💡 Tip: Add images to episodes or hosts for these shows.');
    }

    // 7. Verify final state (only if not dry run)
    if (!DRY_RUN && !TEST_LIMIT) {
      console.log('\n🔍 Verifying results...');
      const showsWithImages = await strapi.db.query('api::show.show').count({
        where: { ShowImage: { $notNull: true } }
      });
      console.log(`✓ Total shows with images: ${showsWithImages}\n`);
    }

    console.log('✨ Process complete!\n');

    if (DRY_RUN) {
      console.log('💡 To run for real, unset DRY_RUN:');
      console.log('   delete process.env.DRY_RUN');
      console.log('   await require(\'./scripts/link-show-images.js\')(strapi)\n');
    }

    return {
      success: true,
      stats: {
        linkedFromEpisodes,
        linkedFromArtists,
        noImageFound,
        errors,
        totalProcessed: shows.length
      }
    };

  } catch (error) {
    console.error('\n❌ Fatal error during show image linking:', error);
    throw error;
  }
};
