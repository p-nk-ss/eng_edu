import "dotenv/config";
import { prisma } from "../src/lib/db";
import { loadSeedData } from "../src/lib/curriculum/load";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { buildGrammarEnrichment, buildTopicAssignments, parseProfile } from "../src/lib/curriculum/seedExtras";

/**
 * Idempotent curriculum seed. Uses createMany + skipDuplicates so re-running:
 *  - never duplicates rows (GrammarTopic.name and VocabItem[headword,pos] are unique),
 *  - preserves progress (existing rows' status/correctStreak are left untouched),
 *  - adds only new items if the committed datasets grow.
 * Data + attribution: data/README.md (CEFR-J, Octanove — CC BY-SA 4.0).
 *  - applies data/vocab-topics.csv to VocabItem.topic and creates the Profile if missing.
 *  - applies data/grammar-topics.json (title, description, example, teachable, importance) to GrammarTopic.
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

/** Apply data/grammar-topics.json to GrammarTopic. One bulk UPDATE; only changed rows are touched. */
async function seedGrammarEnrichment() {
  const file = path.join(DATA_DIR, "grammar-topics.json");
  if (!existsSync(file)) return console.warn("data/grammar-topics.json missing - grammar topics keep their raw names (teachable, importance 2).");
  const known = new Set((await prisma.grammarTopic.findMany({ select: { name: true } })).map((t) => t.name));
  const rows = buildGrammarEnrichment(readFileSync(file, "utf8"), known);
  const names = rows.map((r) => r.name);
  const titles = rows.map((r) => r.title);
  const descriptions = rows.map((r) => r.description);
  const examples = rows.map((r) => r.example);
  // booleans/ints travel as text[] and are cast in SQL - avoids driver-specific array typing
  const teachables = rows.map((r) => String(r.teachable));
  const importances = rows.map((r) => String(r.importance));
  const updated = await prisma.$executeRaw`
    UPDATE "GrammarTopic" AS g
    SET "title" = d.title, "description" = d.description, "example" = d.example,
        "teachable" = d.teachable::boolean, "importance" = d.importance::int
    FROM unnest(${names}::text[], ${titles}::text[], ${descriptions}::text[], ${examples}::text[],
                ${teachables}::text[], ${importances}::text[])
         AS d(name, title, description, example, teachable, importance)
    WHERE g."name" = d.name
      AND (g."title", g."description", g."example", g."teachable", g."importance")
          IS DISTINCT FROM (d.title, d.description, d.example, d.teachable::boolean, d.importance::int)`;
  console.log(`Grammar enrichment: ${rows.length} records in JSON, ${updated} rows updated.`);
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

  await seedGrammarEnrichment();

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
