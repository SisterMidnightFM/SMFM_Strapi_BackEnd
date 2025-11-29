/**
 * Bulk Link Artist Images Script (Interactive)
 *
 * This script links uploaded images from the "Polaroid Pictures" folder in the Media Library
 * to artists by matching the image filename to the artist's name or slug.
 *
 * Interactive mode allows you to approve each match before linking.
 *
 * Usage:
 *   1. Upload all images to "Polaroid Pictures" folder in Strapi Media Library
 *   2. Run: npx strapi console
 *
 *   INTERACTIVE MODE (manually approve each match):
 *   const readline = require('readline');
 *   const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
 *   await require('./scripts/link-artist-images.js')(strapi, rl)
 *
 *   DRY RUN (preview all matches without changes):
 *   process.env.DRY_RUN = 'true'
 *   await require('./scripts/link-artist-images.js')(strapi)
 *
 *   AUTO MODE (automatically link all matches):
 *   await require('./scripts/link-artist-images.js')(strapi)
 *
 *   TEST ON FIRST 5 ARTISTS:
 *   process.env.TEST_LIMIT = '5'
 *   await require('./scripts/link-artist-images.js')(strapi)
 *
 * Prerequisites:
 *   - "Polaroid Pictures" folder must exist in Media Library
 *   - Images must be uploaded to this folder
 *   - Image filenames should match artist names or slugs (e.g., "artist-name.png")
 */

module.exports = async (strapi, readlineInterface = null) => {
  const DRY_RUN = process.env.DRY_RUN === 'true';
  const TEST_LIMIT = process.env.TEST_LIMIT ? parseInt(process.env.TEST_LIMIT) : null;
  const INTERACTIVE = readlineInterface !== null && !DRY_RUN;

  console.log('\n🚀 Starting Artist Image Linking Process...\n');
  if (DRY_RUN) console.log('⚠️  DRY RUN MODE - No changes will be made\n');
  if (INTERACTIVE) console.log('🤝 INTERACTIVE MODE - You will approve each match\n');
  if (TEST_LIMIT) console.log(`⚠️  TEST MODE - Processing only first ${TEST_LIMIT} artists\n`);

  // Helper function to prompt user for approval
  const askForApproval = (question) => {
    return new Promise((resolve) => {
      readlineInterface.question(question, (answer) => {
        resolve(answer.toLowerCase().trim());
      });
    });
  };

  try {
    // Helper function to create slug from string
    const createSlug = (str) => {
      return str
        .toLowerCase()
        .trim()
        .replace(/[\s_]+/g, '-')           // Replace spaces and underscores with hyphens
        .replace(/[^\w\-]+/g, '')          // Remove all non-word chars except hyphens
        .replace(/\-\-+/g, '-')            // Replace multiple hyphens with single hyphen
        .replace(/^-+/, '')                // Trim hyphens from start
        .replace(/-+$/, '');               // Trim hyphens from end
    };

    // Helper function to calculate Levenshtein distance (string similarity)
    const levenshteinDistance = (str1, str2) => {
      const matrix = [];

      for (let i = 0; i <= str2.length; i++) {
        matrix[i] = [i];
      }

      for (let j = 0; j <= str1.length; j++) {
        matrix[0][j] = j;
      }

      for (let i = 1; i <= str2.length; i++) {
        for (let j = 1; j <= str1.length; j++) {
          if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
            matrix[i][j] = matrix[i - 1][j - 1];
          } else {
            matrix[i][j] = Math.min(
              matrix[i - 1][j - 1] + 1,
              matrix[i][j - 1] + 1,
              matrix[i - 1][j] + 1
            );
          }
        }
      }

      return matrix[str2.length][str1.length];
    };

    // Helper function to find closest matches
    const findClosestMatches = (searchStr, imageMap, count = 3) => {
      const searchSlug = createSlug(searchStr);
      const distances = [];

      for (const [key, image] of imageMap.entries()) {
        const distance = levenshteinDistance(searchSlug, key);
        distances.push({ key, image, distance });
      }

      return distances
        .sort((a, b) => a.distance - b.distance)
        .slice(0, count);
    };

    // 1. Find Polaroid Pictures folder
    console.log('📁 Looking for "Polaroid Pictures" folder...');
    const polaroidFolder = await strapi.db.query('plugin::upload.folder').findOne({
      where: { name: 'Polaroid Pictures' }
    });

    if (!polaroidFolder) {
      console.error('❌ Error: "Polaroid Pictures" folder not found in Media Library.');
      console.log('💡 Please create this folder and upload your images to it first.\n');
      return { success: false, error: 'Folder not found' };
    }

    console.log(`✓ Found folder: "${polaroidFolder.name}" (path: ${polaroidFolder.path})\n`);

    // 2. Fetch images only from the Polaroid Pictures folder
    console.log('📥 Fetching images from "Polaroid Pictures" folder...');
    const allImages = await strapi.db.query('plugin::upload.file').findMany({
      where: {
        $or: [
          { folderPath: { $eq: polaroidFolder.path } },
          { folderPath: { $startsWith: `${polaroidFolder.path}/` } }
        ]
      },
      populate: { folder: true }
    });

    console.log(`✓ Found ${allImages.length} images in Polaroid Pictures\n`);

    if (allImages.length === 0) {
      console.log('⚠️  No images found in media library. Please upload images first.');
      return { success: false, error: 'No images in folder' };
    }

    // Create image lookup maps
    // Map 1: By filename without extension (slug format)
    // Map 2: By filename without extension (original case)
    const imageMapBySlug = new Map();
    const imageMapByName = new Map();

    allImages.forEach(img => {
      // Remove file extension
      const nameWithoutExt = img.name.replace(/\.[^/.]+$/, '');

      // Store by slug version
      const slug = createSlug(nameWithoutExt);
      imageMapBySlug.set(slug, img);

      // Store by original name (case-insensitive)
      imageMapByName.set(nameWithoutExt.toLowerCase(), img);
    });

    console.log(`✓ Created image lookup maps\n`);

    // 3. Fetch all artists from database
    console.log('📥 Fetching artists from database...');
    let allArtists = await strapi.db.query('api::artist.artist').findMany({
      select: ['id', 'Artist_Slug', 'ArtistName'],
      populate: { ArtistImage: true }
    });

    console.log(`✓ Found ${allArtists.length} artists in database\n`);

    // Apply test limit if specified
    if (TEST_LIMIT) {
      allArtists = allArtists.slice(0, TEST_LIMIT);
      console.log(`⚠️  Limited to first ${allArtists.length} artists for testing\n`);
    }

    // 4. Track statistics
    let matched = 0;
    let alreadyLinked = 0;
    let imageNotFound = 0;
    let errors = 0;

    const matchedPairs = [];
    const notFoundImages = [];

    console.log('🔗 Starting image linking process...\n');
    console.log('─'.repeat(80));

    // 5. Process each artist
    for (const artist of allArtists) {
      try {
        // Skip if artist already has an image
        if (artist.ArtistImage) {
          console.log(`⏭️  Skip: "${artist.ArtistName}" (already has image)`);
          alreadyLinked++;
          continue;
        }

        // Try to find matching image
        let matchedImage = null;
        let matchMethod = '';

        // Method 1: Try matching by Artist_Slug
        matchedImage = imageMapBySlug.get(artist.Artist_Slug);
        if (matchedImage) {
          matchMethod = 'slug';
        }

        // Method 2: Try matching by ArtistName (slugified)
        if (!matchedImage) {
          const nameSlug = createSlug(artist.ArtistName);
          matchedImage = imageMapBySlug.get(nameSlug);
          if (matchedImage) {
            matchMethod = 'name-slug';
          }
        }

        // Method 3: Try matching by ArtistName (case-insensitive, exact)
        if (!matchedImage) {
          matchedImage = imageMapByName.get(artist.ArtistName.toLowerCase());
          if (matchedImage) {
            matchMethod = 'name-exact';
          }
        }

        if (!matchedImage) {
          // No exact match found - suggest closest matches in interactive mode
          if (INTERACTIVE) {
            console.log(`\n❌ No exact match found for: "${artist.ArtistName}" (slug: ${artist.Artist_Slug})`);

            // Find 3 closest matches
            const closestMatches = findClosestMatches(artist.ArtistName, imageMapBySlug, 3);

            console.log(`\n   Suggested matches:`);
            closestMatches.forEach((match, index) => {
              console.log(`   ${index + 1}. "${match.image.name}" (distance: ${match.distance})`);
            });

            const selection = await askForApproval('\n   Select image (1-3), or press Enter to skip: ');

            const selectedIndex = parseInt(selection) - 1;
            if (selectedIndex >= 0 && selectedIndex < closestMatches.length) {
              matchedImage = closestMatches[selectedIndex].image;
              matchMethod = 'manual-selection';
              console.log(`   ✓ Selected: "${matchedImage.name}"\n`);
            } else {
              console.log(`   ⏭️  Skipped\n`);
              imageNotFound++;
              notFoundImages.push({
                artistName: artist.ArtistName,
                artistSlug: artist.Artist_Slug
              });
              continue;
            }
          } else {
            console.log(`❌ Image not found for: "${artist.ArtistName}" (slug: ${artist.Artist_Slug})`);
            imageNotFound++;
            notFoundImages.push({
              artistName: artist.ArtistName,
              artistSlug: artist.Artist_Slug
            });
            continue;
          }
        }

        // In interactive mode, ask for approval
        if (INTERACTIVE) {
          console.log(`\n📸 Match found:`);
          console.log(`   Image: "${matchedImage.name}"`);
          console.log(`   Artist: "${artist.ArtistName}"`);
          console.log(`   Matched by: ${matchMethod}`);

          const approval = await askForApproval('   Link this image? (y/n/q to quit): ');

          if (approval === 'q' || approval === 'quit') {
            console.log('\n⚠️  User requested quit. Stopping process...\n');
            break;
          }

          if (approval !== 'y' && approval !== 'yes') {
            console.log('   ⏭️  Skipped by user\n');
            continue;
          }
        }

        // Link image to artist (or simulate in dry-run mode)
        if (DRY_RUN) {
          console.log(`[DRY RUN] Would link: "${matchedImage.name}" → "${artist.ArtistName}" (matched by: ${matchMethod})`);
        } else {
          await strapi.db.query('api::artist.artist').update({
            where: { id: artist.id },
            data: { ArtistImage: matchedImage.id }
          });
          if (INTERACTIVE) {
            console.log(`   ✅ Linked successfully!\n`);
          } else {
            console.log(`✅ Linked: "${matchedImage.name}" → "${artist.ArtistName}" (matched by: ${matchMethod})`);
          }
        }

        matched++;
        matchedPairs.push({
          artistName: artist.ArtistName,
          artistSlug: artist.Artist_Slug,
          imageName: matchedImage.name,
          matchMethod
        });

      } catch (error) {
        console.error(`⚠️  Error processing "${artist.ArtistName}":`, error.message);
        errors++;
      }
    }

    // 6. Print summary
    console.log('\n' + '─'.repeat(80));
    console.log('\n📊 SUMMARY\n');
    console.log('─'.repeat(80));
    console.log(`✅ Successfully ${DRY_RUN ? 'would link' : 'linked'}:     ${matched}`);
    console.log(`⏭️  Already had images:                ${alreadyLinked}`);
    console.log(`❌ Image not found in Media Library:  ${imageNotFound}`);
    console.log(`⚠️  Errors:                            ${errors}`);
    console.log(`👤 Total artists processed:            ${allArtists.length}`);
    console.log('─'.repeat(80));

    // 7. Show details for images not found
    if (notFoundImages.length > 0) {
      console.log('\n⚠️  IMAGES NOT FOUND IN MEDIA LIBRARY:\n');
      notFoundImages.slice(0, 20).forEach(({ artistName, artistSlug }) => {
        console.log(`   • Artist: "${artistName}" (slug: ${artistSlug})`);
        console.log(`     Expected filename: "${artistSlug}.png" or "${artistName}.png"`);
      });
      if (notFoundImages.length > 20) {
        console.log(`   ... and ${notFoundImages.length - 20} more`);
      }
      console.log('\n💡 Tip: Upload missing images to "Polaroid Pictures" folder.');
      console.log('💡 Image filenames should match artist slugs or names.');
    }

    // 8. Verify final state (only if not dry run)
    if (!DRY_RUN && !TEST_LIMIT) {
      console.log('\n🔍 Verifying results...');
      const artistsWithImages = await strapi.db.query('api::artist.artist').count({
        where: { ArtistImage: { $notNull: true } }
      });
      console.log(`✓ Total artists with images: ${artistsWithImages}\n`);
    }

    console.log('✨ Process complete!\n');

    if (DRY_RUN) {
      console.log('💡 To run for real, unset DRY_RUN:');
      console.log('   delete process.env.DRY_RUN');
      console.log('   await require(\'./scripts/link-artist-images.js\')(strapi)\n');
    }

    return { success: true };

  } catch (error) {
    console.error('\n❌ Fatal error during artist image linking:', error);
    throw error;
  }
};
