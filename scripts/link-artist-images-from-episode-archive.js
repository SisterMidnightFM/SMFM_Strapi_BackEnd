/**
 * Link Artist Images from Episode Archive (Manual Selection)
 *
 * This script helps link artists without images to images found in the
 * "Episode Images Archive" folder. You manually select the correct image
 * for each artist from suggested matches.
 *
 * Usage:
 *   1. Run: npx strapi console
 *
 *   INTERACTIVE MODE (manually select matches):
 *   const readline = require('readline');
 *   const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
 *   await require('./scripts/link-artist-images-from-episode-archive.js')(strapi, rl)
 *
 * Prerequisites:
 *   - "Episode Images Archive" folder must exist in Media Library
 *   - Images must be uploaded to this folder
 */

module.exports = async (strapi, readlineInterface) => {
  if (!readlineInterface) {
    console.error('\n❌ Error: This script requires interactive mode.');
    console.log('Please run with readline interface:');
    console.log('  const readline = require(\'readline\');');
    console.log('  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });');
    console.log('  await require(\'./scripts/link-artist-images-from-episode-archive.js\')(strapi, rl)\n');
    return { success: false, error: 'Readline interface required' };
  }

  console.log('\n🚀 Starting Artist Image Linking from Episode Archive...\n');
  console.log('🤝 INTERACTIVE MODE - You will manually select images for artists\n');

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
        .replace(/[\s_]+/g, '-')
        .replace(/[^\w\-]+/g, '')
        .replace(/\-\-+/g, '-')
        .replace(/^-+/, '')
        .replace(/-+$/, '');
    };

    // Helper function to calculate Levenshtein distance
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
    const findClosestMatches = (searchStr, imageArray, count = 5) => {
      const searchSlug = createSlug(searchStr);
      const distances = [];

      for (const image of imageArray) {
        const nameWithoutExt = image.name.replace(/\.[^/.]+$/, '');
        const imageSlug = createSlug(nameWithoutExt);
        const distance = levenshteinDistance(searchSlug, imageSlug);
        distances.push({ image, distance, nameWithoutExt });
      }

      return distances
        .sort((a, b) => a.distance - b.distance)
        .slice(0, count);
    };

    // 1. Find Episode Images Archive folder
    console.log('📁 Looking for "Episode Images Archive" folder...');
    const archiveFolder = await strapi.db.query('plugin::upload.folder').findOne({
      where: { name: 'Episode Images Archive' }
    });

    if (!archiveFolder) {
      console.error('❌ Error: "Episode Images Archive" folder not found in Media Library.');
      return { success: false, error: 'Folder not found' };
    }

    console.log(`✓ Found folder: "${archiveFolder.name}"\n`);

    // 2. Fetch images from Episode Images Archive folder
    console.log('📥 Fetching images from Episode Images Archive...');
    const allImages = await strapi.db.query('plugin::upload.file').findMany({
      where: {
        $or: [
          { folderPath: { $eq: archiveFolder.path } },
          { folderPath: { $startsWith: `${archiveFolder.path}/` } }
        ]
      }
    });

    console.log(`✓ Found ${allImages.length} images in Episode Images Archive\n`);

    if (allImages.length === 0) {
      console.log('⚠️  No images found in Episode Images Archive.');
      return { success: false, error: 'No images in folder' };
    }

    // 3. Fetch artists without images
    console.log('📥 Fetching artists without images...');
    const artistsWithoutImages = await strapi.db.query('api::artist.artist').findMany({
      where: { ArtistImage: { $null: true } },
      select: ['id', 'Artist_Slug', 'ArtistName']
    });

    console.log(`✓ Found ${artistsWithoutImages.length} artists without images\n`);

    if (artistsWithoutImages.length === 0) {
      console.log('✨ All artists already have images!\n');
      return { success: true };
    }

    // 4. Track statistics
    let matched = 0;
    let skipped = 0;

    console.log('🔗 Starting interactive image selection...\n');
    console.log('─'.repeat(80));

    // 5. Process each artist
    for (const artist of artistsWithoutImages) {
      try {
        console.log(`\n👤 Artist: "${artist.ArtistName}" (slug: ${artist.Artist_Slug})`);

        // Find closest matching images
        const closestMatches = findClosestMatches(artist.ArtistName, allImages, 5);

        console.log(`\n   Suggested images from Episode Archive:`);
        closestMatches.forEach((match, index) => {
          console.log(`   ${index + 1}. "${match.image.name}" (similarity score: ${match.distance})`);
        });

        const selection = await askForApproval('\n   Select image (1-5), Enter to skip, or q to quit: ');

        if (selection === 'q' || selection === 'quit') {
          console.log('\n⚠️  User requested quit. Stopping process...\n');
          break;
        }

        const selectedIndex = parseInt(selection) - 1;
        if (selectedIndex >= 0 && selectedIndex < closestMatches.length) {
          const selectedImage = closestMatches[selectedIndex].image;

          // Link the selected image to the artist
          await strapi.db.query('api::artist.artist').update({
            where: { id: artist.id },
            data: { ArtistImage: selectedImage.id }
          });

          console.log(`   ✅ Linked "${selectedImage.name}" to "${artist.ArtistName}"\n`);
          matched++;
        } else {
          console.log(`   ⏭️  Skipped\n`);
          skipped++;
        }

      } catch (error) {
        console.error(`⚠️  Error processing "${artist.ArtistName}":`, error.message);
      }
    }

    // 6. Print summary
    console.log('\n' + '─'.repeat(80));
    console.log('\n📊 SUMMARY\n');
    console.log('─'.repeat(80));
    console.log(`✅ Successfully linked:          ${matched}`);
    console.log(`⏭️  Skipped:                     ${skipped}`);
    console.log(`👤 Total artists processed:      ${matched + skipped}`);
    console.log(`👤 Artists still without images: ${artistsWithoutImages.length - matched}`);
    console.log('─'.repeat(80));

    // 7. Verify final state
    console.log('\n🔍 Verifying results...');
    const artistsWithImages = await strapi.db.query('api::artist.artist').count({
      where: { ArtistImage: { $notNull: true } }
    });
    console.log(`✓ Total artists with images: ${artistsWithImages}\n`);

    console.log('✨ Process complete!\n');

    return { success: true };

  } catch (error) {
    console.error('\n❌ Fatal error during artist image linking:', error);
    throw error;
  }
};
