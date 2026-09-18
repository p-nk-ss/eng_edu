import "dotenv/config";
import { prisma } from "../src/lib/db";
import { loadSeedData } from "../src/lib/curriculum/load";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { buildTopicAssignments, parseProfile } from "../src/lib/curriculum/seedExtras";

/**
 * Idempotent curriculum seed. Uses createMany + skipDuplicates so re-running:
 *  - never duplicates rows (GrammarTopic.name and VocabItem[headword,pos] are unique),
 *  - preserves progress (existing rows' status/correctStreak are left untouched),
 *  - adds only new items if the committed datasets grow.
 * Data + attribution: data/README.md (CEFR-J, Octanove — CC BY-SA 4.0).
 *  - applies data/vocab-topics.csv to VocabItem.topic and creates the Profile if missing.
 */
const DATA_DIR = path.join(process.cwd(), "data");

/** Create the single Profile from data/profile.json — only if none exists (never overwrites edits). */
async function seedProfile() {
  if ((await prisma.profile.count()) > 0) return console.log("Profile exists — left untouched.");
  const file = path.join(DATA_DIR, "profile.json");
  if (!existsSync(file)) return console.warn("data/profile.json missing — no Profile created.");
  const p = parseProfile(readFileSync(file, "utf8"));
  await prisma.profile.create({ data: p });
  console.log(`Profile created (level ${p.level}, preferred themes: ${p.preferredThemes.join(", ") || "none"}).`);
}

/** Apply data/vocab-topics.csv to VocabItem.topic. One bulk UPDATE per chunk; only changed rows are touched. */
async function seedVocabTopics() {
  const file = path.join(DATA_DIR, "vocab-topics.csv");
  if (!existsSync(file)) return console.warn("data/vocab-topics.csv missing — VocabItem.topic stays NULL.");
  const rows = buildTopicAssignments(readFileSync(file, "utf8"));
  let updated = 0;
  // 2000: bounds the size of a single statement's array parameters (headwords/poses/topics
  // below) — not a Postgres limit, just keeps each round-trip's payload modest.
  for (let i = 0; i < rows.length; i += 2000) {
    const part = rows.slice(i, i + 2000);
    const headwords = part.map((r) => r.headword);
    const poses = part.map((r) => r.pos);
    const topics = part.map((r) => r.topic);
    updated += await prisma.$executeRaw`
      UPDATE "VocabItem" AS v SET "topic" = d.topic
      FROM unnest(${headwords}::text[], ${poses}::text[], ${topics}::text[]) AS d(headword, pos, topic)
      WHERE v."headword" = d.headword AND v."pos" = d.pos AND v."topic" IS DISTINCT FROM d.topic`;
  }
  console.log(`Vocab topics: ${rows.length} assignments in CSV, ${updated} rows updated.`);
}

async function main() {
  const { grammar, vocab } = loadSeedData();
  console.log(`Seeding ${grammar.length} grammar topics + ${vocab.length} vocab items...`);

  await prisma.grammarTopic.createMany({
    data: grammar.map((g) => ({
      name: g.name,
      cefrLevel: g.cefrLevel,
      category: g.category,
      sortOrder: g.sortOrder,
    })),
    skipDuplicates: true,
  });

  await prisma.vocabItem.createMany({
    data: vocab.map((v) => ({
      headword: v.headword,
      pos: v.pos ?? "", // avoid NULL in the [headword,pos] unique (NULL breaks dedupe)
      cefrLevel: v.cefrLevel,
      isPhrase: v.isPhrase,
      topic: v.topic,
    })),
    skipDuplicates: true,
  });

  await seedVocabTopics();
  await seedProfile();

  // Sequential (not Promise.all): the pg adapter uses a single connection and
  // warns on concurrent queries.
  const gc = await prisma.grammarTopic.count();
  const vc = await prisma.vocabItem.count();
  console.log(`Done. Database now holds ${gc} grammar topics and ${vc} vocab items.`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
