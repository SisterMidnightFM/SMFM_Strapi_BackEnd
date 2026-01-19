/**
 * Interactive Episode → Show Linking Script
 *
 * Features:
 * - Finds episodes that DO NOT have a linked show
 * - For each episode, suggests 7 possible show matches using:
 *   (1) Title substring match → highest priority
 *   (2) Levenshtein distance on slug(episode title) vs show slug
 *   (3) Alphabetical fallback
 *
 * - Option 8: Always link to Guest Show ("guest-show")
 *
 * Supports:
 * - DRY RUN: process.env.DRY_RUN = 'true'
 * - TEST LIMIT: process.env.TEST_LIMIT = '5'
 *
 * Interactive mode:
 * const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
 * await require('./scripts/link-episode-to-show.js')(strapi, rl)
 */

const readline = require('readline');

// Simple slug function
const createSlug = (str) =>
  str
    .toLowerCase()
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/[^\w-]+/g, '')
    .replace(/--+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');

// Levenshtein distance
function levenshtein(a, b) {
  const matrix = [];

  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      matrix[i][j] = b.charAt(i - 1) === a.charAt(j - 1)
        ? matrix[i - 1][j - 1]
        : Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
    }
  }

  return matrix[b.length][a.length];
}

module.exports = async (strapi, rl = null) => {
  const DRY_RUN = process.env.DRY_RUN === 'true';
  const TEST_LIMIT = process.env.TEST_LIMIT ? parseInt(process.env.TEST_LIMIT) : null;
  const INTERACTIVE = rl !== null && !DRY_RUN;

  if (DRY_RUN) console.log("⚠️ DRY RUN ENABLED — No changes will be saved.");
  if (INTERACTIVE) console.log("🤝 INTERACTIVE MODE ENABLED");
  if (TEST_LIMIT) console.log(`⚠️ TEST LIMIT: Only processing first ${TEST_LIMIT} episodes.`);

  const ask = (q) =>
    new Promise((resolve) => rl.question(q, (a) => resolve(a.trim().toLowerCase())));

  try {
    console.log("\n📥 Loading shows...");
    const allShows = await strapi.db.query("api::show.show").findMany({
      select: ["id", "ShowName", "ShowSlug"],
    });

    if (allShows.length === 0) {
      console.log("❌ No shows found in database.");
      return;
    }

    const guestShow = allShows.find((s) => s.ShowSlug === "guest-show");
    if (!guestShow) {
      console.log('❌ "guest-show" not found — create it first.');
      return;
    }

    console.log(`✓ Loaded ${allShows.length} shows.`);

    console.log("\n📥 Loading episodes (only those WITHOUT a show)...");
    let episodes = await strapi.db.query("api::episode.episode").findMany({
      select: ["id", "EpisodeSlug", "EpisodeTitle"],
      populate: { link_episode_to_show: true },
    });

    episodes = episodes.filter((e) => !e.link_episode_to_show);

    if (TEST_LIMIT) episodes = episodes.slice(0, TEST_LIMIT);

    console.log(`✓ Found ${episodes.length} unlinked episodes.\n`);

    let linkedCount = 0;
    let skipped = 0;

    for (const ep of episodes) {
      console.log("\n" + "─".repeat(80));
      console.log(`🎙️ Episode: ${ep.EpisodeTitle}`);

      // --- HYBRID MATCHING (STRATEGY 5) ---
      const epSlug = createSlug(ep.EpisodeTitle);

      // 1. Substring match
      const substringMatches = allShows.filter((show) =>
        ep.EpisodeTitle.toLowerCase().includes(show.ShowName.toLowerCase())
      );

      // 2. Levenshtein fallback
      const levenshteinMatches = allShows
        .map((show) => ({
          show,
          dist: levenshtein(epSlug, createSlug(show.ShowSlug)),
        }))
        .sort((a, b) => a.dist - b.dist)
        .map((o) => o.show);

      // Combine unique
      const combined = [
        ...substringMatches,
        ...levenshteinMatches.filter((s) => !substringMatches.includes(s)),
      ];

      // If still not enough, alphabetical
      const alphabetical = allShows
        .filter((s) => !combined.includes(s))
        .sort((a, b) => a.ShowName.localeCompare(b.ShowName));

      const finalSuggestions = [...combined, ...alphabetical].slice(0, 7);

      console.log("\n📌 Suggestions:");
      finalSuggestions.forEach((show, idx) =>
        console.log(`${idx + 1}. ${show.ShowName}  (${show.ShowSlug})`)
      );
      console.log(`8. Guest Show (${guestShow.ShowSlug})`);
      console.log("0. Skip");

      if (!INTERACTIVE) {
        console.log("⏭️ Skipping (no interactive mode).");
        skipped++;
        continue;
      }

      const choice = await ask("Select a show (1-8) or 0 to skip: ");

      if (choice === "0" || choice === "") {
        console.log("⏭️ Skipped.");
        skipped++;
        continue;
      }

      let selectedShow = null;

      if (choice === "8") {
        selectedShow = guestShow;
      } else {
        const index = parseInt(choice, 10) - 1;
        if (index < 0 || index >= finalSuggestions.length) {
          console.log("❌ Invalid choice — skipping.");
          skipped++;
          continue;
        }
        selectedShow = finalSuggestions[index];
      }

      if (!selectedShow) {
        console.log("❌ No show selected — skipping.");
        skipped++;
        continue;
      }

      if (DRY_RUN) {
        console.log(`[DRY RUN] Would link → ${selectedShow.ShowName}`);
      } else {
        await strapi.db.query("api::episode.episode").update({
          where: { id: ep.id },
          data: { link_episode_to_show: selectedShow.id },
        });
        console.log(`✅ Linked to: ${selectedShow.ShowName}`);
      }

      linkedCount++;
    }

    console.log("\n" + "─".repeat(80));
    console.log("📊 SUMMARY");
    console.log(`✓ Linked episodes: ${linkedCount}`);
    console.log(`⏭️ Skipped: ${skipped}`);
    console.log("─".repeat(80));

    if (DRY_RUN) {
      console.log("\n💡 DRY RUN complete — No changes were saved.");
    }

  } catch (err) {
    console.error("❌ Fatal error:", err);
  }
};
