/**
 * Bulk Link Episodes to Shows Script (CSV-Based)
 *
 * This script links episodes to their respective shows by reading
 * mappings from a CSV file and matching by ShowSlug.
 *
 * Usage:
 *   1. Ensure episodes_with_images_slug.csv is in scripts/ folder
 *   2. Run: npx strapi console
 *
 *   DRY RUN (test without making changes):
 *   process.env.DRY_RUN = 'true'
 *   await require('./scripts/link-episode-to-show.js')(strapi)
 *
 *   TEST ON FIRST 5 EPISODES:
 *   process.env.TEST_LIMIT = '5'
 *   await require('./scripts/link-episode-to-show.js')(strapi)
 *
 *   DRY RUN + TEST LIMIT:
 *   process.env.DRY_RUN = 'true'
 *   process.env.TEST_LIMIT = '5'
 *   await require('./scripts/link-episode-to-show.js')(strapi)
 *
 *   FULL RUN:
 *   await require('./scripts/link-episode-to-show.js')(strapi)
 *
 * Prerequisites:
 *   - CSV file must exist at scripts/episodes_with_images_slug.csv
 *   - Shows must exist in the database with matching ShowSlug values
 *   - CSV must have EpisodeSlug and ShowSlug columns
 */

const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');

module.exports = async (strapi) => {
  const DRY_RUN = process.env.DRY_RUN === 'true';
  const TEST_LIMIT = process.env.TEST_LIMIT ? parseInt(process.env.TEST_LIMIT) : null;

  console.log('\n🚀 Starting Episode → Show Linking Process...\n');
  if (DRY_RUN) console.log('⚠️  DRY RUN MODE - No changes will be made\n');
  if (TEST_LIMIT) console.log(`⚠️  TEST MODE - Processing only first ${TEST_LIMIT} episodes\n`);

  try {
    // 1. Read and parse CSV file
    console.log('📄 Reading CSV file...');
    const csvPath = path.join(__dirname, 'episodes_with_images_slug.csv');

    if (!fs.existsSync(csvPath)) {
      console.error('❌ Error: CSV file not found at:', csvPath);
      return { success: false, error: 'CSV file not found' };
    }

    const csvContent = fs.readFileSync(csvPath, 'utf-8');
    const records = parse(csvContent, {
      columns: true,
      skip_empty_lines: true
    });

    // Create mapping: EpisodeSlug → ShowSlug
    const csvMapping = new Map();
    records.forEach(record => {
      if (record.EpisodeSlug && record.ShowSlug) {
        csvMapping.set(record.EpisodeSlug, record.ShowSlug.trim());
      }
    });

    console.log(`✓ Loaded ${csvMapping.size} episode → show mappings from CSV`);
    console.log(`✓ Total records in CSV: ${records.length}\n`);

    // 2. Fetch all shows and create lookup map by ShowSlug
    console.log('📥 Fetching shows from database...');
    const allShows = await strapi.db.query('api::show.show').findMany({
      select: ['id', 'ShowName', 'ShowSlug']
    });

    // Create show lookup map by ShowSlug for O(1) access
    const showMap = new Map();
    allShows.forEach(show => {
      showMap.set(show.ShowSlug, show);
    });

    console.log(`✓ Found ${allShows.length} shows in database\n`);

    if (allShows.length === 0) {
      console.log('⚠️  No shows found in database. Please create shows first.');
      return { success: false, error: 'No shows in database' };
    }

    // 3. Fetch all episodes from database
    console.log('📥 Fetching episodes from database...');
    let allEpisodes = await strapi.db.query('api::episode.episode').findMany({
      select: ['id', 'EpisodeSlug', 'EpisodeTitle'],
      populate: { link_episode_to_show: true }
    });

    console.log(`✓ Found ${allEpisodes.length} episodes in database\n`);

    // Apply test limit if specified
    if (TEST_LIMIT) {
      allEpisodes = allEpisodes.slice(0, TEST_LIMIT);
      console.log(`⚠️  Limited to first ${allEpisodes.length} episodes for testing\n`);
    }

    // 4. Track statistics
    let matched = 0;
    let alreadyLinked = 0;
    let noShowSpecified = 0;
    let showNotFound = 0;
    let errors = 0;

    const matchedPairs = [];
    const notFoundShows = [];
    const skippedNoShow = [];

    console.log('🔗 Starting episode → show linking process...\n');
    console.log('─'.repeat(80));

    // 5. Process each episode
    for (const episode of allEpisodes) {
      try {
        // Look up show slug from CSV mapping
        const showSlugFromCsv = csvMapping.get(episode.EpisodeSlug);

        // Skip if no show slug in CSV
        if (!showSlugFromCsv || showSlugFromCsv.trim() === '') {
          console.log(`⏭️  Skip: "${episode.EpisodeTitle}" (no show slug in CSV)`);
          noShowSpecified++;
          skippedNoShow.push({
            episodeTitle: episode.EpisodeTitle,
            episodeSlug: episode.EpisodeSlug
          });
          continue;
        }

        // Skip if episode already has a show linked
        if (episode.link_episode_to_show) {
          console.log(`⏭️  Skip: "${episode.EpisodeTitle}" (already linked to show)`);
          alreadyLinked++;
          continue;
        }

        // Find matching show by ShowSlug from CSV
        const matchedShow = showMap.get(showSlugFromCsv);

        if (!matchedShow) {
          console.log(`❌ Show not found: "${showSlugFromCsv}" for "${episode.EpisodeTitle}"`);
          showNotFound++;
          notFoundShows.push({
            episodeTitle: episode.EpisodeTitle,
            episodeSlug: episode.EpisodeSlug,
            showSlug: showSlugFromCsv
          });
          continue;
        }

        // Link episode to show (or simulate in dry-run mode)
        if (DRY_RUN) {
          console.log(`[DRY RUN] Would link: "${episode.EpisodeTitle}" → "${matchedShow.ShowName}" (${matchedShow.ShowSlug})`);
        } else {
          await strapi.db.query('api::episode.episode').update({
            where: { id: episode.id },
            data: { link_episode_to_show: matchedShow.id }
          });
          console.log(`✅ Linked: "${episode.EpisodeTitle}" → "${matchedShow.ShowName}" (${matchedShow.ShowSlug})`);
        }

        matched++;
        matchedPairs.push({
          episodeTitle: episode.EpisodeTitle,
          episodeSlug: episode.EpisodeSlug,
          showName: matchedShow.ShowName,
          showSlug: matchedShow.ShowSlug
        });

      } catch (error) {
        console.error(`⚠️  Error processing "${episode.EpisodeTitle}":`, error.message);
        errors++;
      }
    }

    // 6. Print summary
    console.log('\n' + '─'.repeat(80));
    console.log('\n📊 SUMMARY\n');
    console.log('─'.repeat(80));
    console.log(`✅ Successfully ${DRY_RUN ? 'would link' : 'linked'}:     ${matched}`);
    console.log(`⏭️  Already linked to show:             ${alreadyLinked}`);
    console.log(`⏭️  No show specified in CSV:           ${noShowSpecified}`);
    console.log(`❌ Show not found in database:         ${showNotFound}`);
    console.log(`⚠️  Errors:                            ${errors}`);
    console.log(`📺 Total episodes processed:           ${allEpisodes.length}`);
    console.log('─'.repeat(80));

    // 7. Show details for shows not found
    if (notFoundShows.length > 0) {
      console.log('\n⚠️  SHOWS NOT FOUND IN DATABASE:\n');

      // Get unique show slugs
      const uniqueShowSlugs = [...new Set(notFoundShows.map(item => item.showSlug))];

      uniqueShowSlugs.slice(0, 20).forEach(showSlug => {
        const episodeCount = notFoundShows.filter(item => item.showSlug === showSlug).length;
        console.log(`   • "${showSlug}" (${episodeCount} episode${episodeCount > 1 ? 's' : ''})`);
      });

      if (uniqueShowSlugs.length > 20) {
        console.log(`   ... and ${uniqueShowSlugs.length - 20} more shows`);
      }

      console.log('\n💡 Tip: Create these shows in the database first, then re-run this script.');
    }

    // 8. Show episodes with no show specified
    if (skippedNoShow.length > 0 && skippedNoShow.length <= 10) {
      console.log('\n⏭️  EPISODES WITH NO SHOW SPECIFIED IN CSV:\n');
      skippedNoShow.forEach(({ episodeTitle }) => {
        console.log(`   • "${episodeTitle}"`);
      });
    } else if (skippedNoShow.length > 10) {
      console.log(`\n⏭️  ${skippedNoShow.length} episodes have no show specified in CSV`);
    }

    // 9. Verify final state (only if not dry run)
    if (!DRY_RUN && !TEST_LIMIT) {
      console.log('\n🔍 Verifying results...');
      const episodesWithShows = await strapi.db.query('api::episode.episode').count({
        where: { link_episode_to_show: { $notNull: true } }
      });
      console.log(`✓ Total episodes linked to shows: ${episodesWithShows}\n`);
    }

    console.log('✨ Process complete!\n');

    if (DRY_RUN) {
      console.log('💡 To run for real, unset DRY_RUN:');
      console.log('   delete process.env.DRY_RUN');
      console.log('   await require(\'./scripts/link-episode-to-show.js\')(strapi)\n');
    }

    return { success: true };

  } catch (error) {
    console.error('\n❌ Fatal error during episode → show linking:', error);
    throw error;
  }
};
