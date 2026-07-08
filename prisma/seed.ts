import "dotenv/config";
import { prisma } from "../src/lib/db";
import { loadSeedData } from "../src/lib/curriculum/load";

/**
 * Idempotent curriculum seed. Uses createMany + skipDuplicates so re-running:
 *  - never duplicates rows (GrammarTopic.name and VocabItem[headword,pos] are unique),
 *  - preserves progress (existing rows' status/correctStreak are left untouched),
 *  - adds only new items if the committed datasets grow.
 * Data + attribution: data/README.md (CEFR-J, Octanove — CC BY-SA 4.0).
 */
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
