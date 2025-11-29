/**
 * Bulk Link Artists to Shows Script (CSV-Based)
 *
 * This script links artists to shows as main hosts by reading
 * mappings from a CSV file and matching by slugs.
 *
 * Usage:
 *   1. Ensure "link artists to shows.csv" is in scripts/ folder
 *   2. Run: npx strapi console
 *
 *   DRY RUN (test without making changes):
 *   process.env.DRY_RUN = 'true'
 *   await require('./scripts/link-artists-to-shows.js')(strapi)
 *
 *   TEST ON FIRST 5 SHOWS:
 *   process.env.TEST_LIMIT = '5'
 *   await require('./scripts/link-artists-to-shows.js')(strapi)
 *
 *   DRY RUN + TEST LIMIT:
 *   process.env.DRY_RUN = 'true'
 *   process.env.TEST_LIMIT = '5'
 *   await require('./scripts/link-artists-to-shows.js')(strapi)
 *
 *   FULL RUN:
 *   await require('./scripts/link-artists-to-shows.js')(strapi)
 *
 * Prerequisites:
 *   - CSV file must exist at scripts/link artists to shows.csv
 *   - Artists must exist in the database with matching Artist_Slug values
 *   - Shows must exist in the database with matching ShowSlug values
 *   - CSV must have ShowSlug and Artist_Slug columns
 */

const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');

module.exports = async (strapi) => {
  const DRY_RUN = process.env.DRY_RUN === 'true';
  const TEST_LIMIT = process.env.TEST_LIMIT ? parseInt(process.env.TEST_LIMIT) : null;

  console.log('\n🚀 Starting Artist → Show Linking Process...\n');
  if (DRY_RUN) console.log('⚠️  DRY RUN MODE - No changes will be made\n');
  if (TEST_LIMIT) console.log(`⚠️  TEST MODE - Processing only first ${TEST_LIMIT} shows\n`);

  try {
    // 1. Read and parse CSV file
    console.log('📄 Reading CSV file...');
    const csvPath = path.join(__dirname, 'link artists to shows.csv');

    if (!fs.existsSync(csvPath)) {
      console.error('❌ Error: CSV file not found at:', csvPath);
      return { success: false, error: 'CSV file not found' };
    }

    const csvContent = fs.readFileSync(csvPath, 'utf-8');
    const records = parse(csvContent, {
      columns: true,
      skip_empty_lines: true
    });

    // Create mapping: ShowSlug → Artist_Slug
    const csvMapping = new Map();
    records.forEach(record => {
      if (record.ShowSlug && record.Artist_Slug) {
        csvMapping.set(record.ShowSlug, record.Artist_Slug.trim());
      }
    });

    console.log(`✓ Loaded ${csvMapping.size} show → artist mappings from CSV`);
    console.log(`✓ Total records in CSV: ${records.length}\n`);

    // 2. Fetch all artists and create lookup map by Artist_Slug
    console.log('📥 Fetching artists from database...');
    const allArtists = await strapi.db.query('api::artist.artist').findMany({
      select: ['id', 'ArtistName', 'Artist_Slug']
    });

    // Create artist lookup map by Artist_Slug for O(1) access
    const artistMap = new Map();
    allArtists.forEach(artist => {
      artistMap.set(artist.Artist_Slug, artist);
    });

    console.log(`✓ Found ${allArtists.length} artists in database\n`);

    if (allArtists.length === 0) {
      console.log('⚠️  No artists found in database. Please create artists first.');
      return { success: false, error: 'No artists in database' };
    }

    // 3. Fetch all shows from database
    console.log('📥 Fetching shows from database...');
    let allShows = await strapi.db.query('api::show.show').findMany({
      select: ['id', 'ShowSlug', 'ShowName'],
      populate: { Main_Host: true }
    });

    console.log(`✓ Found ${allShows.length} shows in database\n`);

    // Apply test limit if specified
    if (TEST_LIMIT) {
      allShows = allShows.slice(0, TEST_LIMIT);
      console.log(`⚠️  Limited to first ${allShows.length} shows for testing\n`);
    }

    // 4. Track statistics
    let matched = 0;
    let alreadyLinked = 0;
    let noArtistSpecified = 0;
    let artistNotFound = 0;
    let errors = 0;

    const matchedPairs = [];
    const notFoundArtists = [];
    const skippedNoArtist = [];

    console.log('🔗 Starting artist → show linking process...\n');
    console.log('─'.repeat(80));

    // 5. Process each show
    for (const show of allShows) {
      try {
        // Look up artist slug from CSV mapping
        const artistSlugFromCsv = csvMapping.get(show.ShowSlug);

        // Skip if no artist slug in CSV
        if (!artistSlugFromCsv || artistSlugFromCsv.trim() === '') {
          console.log(`⏭️  Skip: "${show.ShowName}" (no artist slug in CSV)`);
          noArtistSpecified++;
          skippedNoArtist.push({
            showName: show.ShowName,
            showSlug: show.ShowSlug
          });
          continue;
        }

        // Skip if show already has this artist linked
        const existingHosts = show.Main_Host || [];
        const alreadyHasArtist = existingHosts.some(
          host => host.Artist_Slug === artistSlugFromCsv
        );

        if (alreadyHasArtist) {
          console.log(`⏭️  Skip: "${show.ShowName}" (already linked to artist)`);
          alreadyLinked++;
          continue;
        }

        // Find matching artist by Artist_Slug from CSV
        const matchedArtist = artistMap.get(artistSlugFromCsv);

        if (!matchedArtist) {
          console.log(`❌ Artist not found: "${artistSlugFromCsv}" for "${show.ShowName}"`);
          artistNotFound++;
          notFoundArtists.push({
            showName: show.ShowName,
            showSlug: show.ShowSlug,
            artistSlug: artistSlugFromCsv
          });
          continue;
        }

        // Get existing host IDs
        const existingHostIds = existingHosts.map(host => host.id);

        // Link artist to show (or simulate in dry-run mode)
        if (DRY_RUN) {
          console.log(`[DRY RUN] Would link: "${show.ShowName}" (${show.ShowSlug}) → "${matchedArtist.ArtistName}" (${matchedArtist.Artist_Slug})`);
        } else {
          // Add the new artist to existing hosts (many-to-many)
          await strapi.db.query('api::show.show').update({
            where: { id: show.id },
            data: { Main_Host: [...existingHostIds, matchedArtist.id] }
          });
          console.log(`✅ Linked: "${show.ShowName}" (${show.ShowSlug}) → "${matchedArtist.ArtistName}" (${matchedArtist.Artist_Slug})`);
        }

        matched++;
        matchedPairs.push({
          showName: show.ShowName,
          showSlug: show.ShowSlug,
          artistName: matchedArtist.ArtistName,
          artistSlug: matchedArtist.Artist_Slug
        });

      } catch (error) {
        console.error(`⚠️  Error processing "${show.ShowName}":`, error.message);
        errors++;
      }
    }

    // 6. Print summary
    console.log('\n' + '─'.repeat(80));
    console.log('\n📊 SUMMARY\n');
    console.log('─'.repeat(80));
    console.log(`✅ Successfully ${DRY_RUN ? 'would link' : 'linked'}:     ${matched}`);
    console.log(`⏭️  Already linked to artist:           ${alreadyLinked}`);
    console.log(`⏭️  No artist specified in CSV:         ${noArtistSpecified}`);
    console.log(`❌ Artist not found in database:       ${artistNotFound}`);
    console.log(`⚠️  Errors:                            ${errors}`);
    console.log(`📺 Total shows processed:              ${allShows.length}`);
    console.log('─'.repeat(80));

    // 7. Show details for artists not found
    if (notFoundArtists.length > 0) {
      console.log('\n⚠️  ARTISTS NOT FOUND IN DATABASE:\n');

      // Get unique artist slugs
      const uniqueArtistSlugs = [...new Set(notFoundArtists.map(item => item.artistSlug))];

      uniqueArtistSlugs.slice(0, 20).forEach(artistSlug => {
        const showCount = notFoundArtists.filter(item => item.artistSlug === artistSlug).length;
        console.log(`   • "${artistSlug}" (${showCount} show${showCount > 1 ? 's' : ''})`);
      });

      if (uniqueArtistSlugs.length > 20) {
        console.log(`   ... and ${uniqueArtistSlugs.length - 20} more artists`);
      }

      console.log('\n💡 Tip: Create these artists in the database first, then re-run this script.');
    }

    // 8. Show shows with no artist specified
    if (skippedNoArtist.length > 0 && skippedNoArtist.length <= 10) {
      console.log('\n⏭️  SHOWS WITH NO ARTIST SPECIFIED IN CSV:\n');
      skippedNoArtist.forEach(({ showName }) => {
        console.log(`   • "${showName}"`);
      });
    } else if (skippedNoArtist.length > 10) {
      console.log(`\n⏭️  ${skippedNoArtist.length} shows have no artist specified in CSV`);
    }

    // 9. Verify final state (only if not dry run)
    if (!DRY_RUN && !TEST_LIMIT) {
      console.log('\n🔍 Verifying results...');
      const showsWithArtists = await strapi.db.query('api::show.show').count({
        where: { Main_Host: { $notNull: true } }
      });
      console.log(`✓ Total shows with main hosts: ${showsWithArtists}\n`);
    }

    console.log('✨ Process complete!\n');

    if (DRY_RUN) {
      console.log('💡 To run for real, unset DRY_RUN:');
      console.log('   delete process.env.DRY_RUN');
      console.log('   await require(\'./scripts/link-artists-to-shows.js\')(strapi)\n');
    }

    return { success: true };

  } catch (error) {
    console.error('\n❌ Fatal error during artist → show linking:', error);
    throw error;
  }
};
