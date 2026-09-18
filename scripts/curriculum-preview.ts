/**
 * Manual check for M3a: print the deterministic selection for the next 5 lessons.
 * Theme history is simulated (each picked theme is pushed onto the history);
 * grammar/vocab statuses are NOT simulated, so those repeat unless the theme changes them.
 *   npm run curriculum:preview
 */
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env" });
loadEnv({ path: ".env.local", override: true });

async function main() {
  const { prisma } = await import("../src/lib/db");
  const { selectLessonInputs } = await import("../src/lib/curriculum/lessonInputs");
  type Db = Parameters<typeof selectLessonInputs>[0];

  const real = await prisma.lesson.findMany({
    where: { theme: { not: null } }, orderBy: { date: "desc" }, take: 100, select: { theme: true },
  });
  const history = real.map((l) => l.theme as string); // newest first

  for (let n = 1; n <= 5; n++) {
    const db = {
      profile: prisma.profile,
      grammarTopic: prisma.grammarTopic,
      vocabItem: prisma.vocabItem,
      errorRecord: prisma.errorRecord,
      lesson: { findMany: async () => history.map((theme) => ({ theme })) },
    } as unknown as Db;

    const s = await selectLessonInputs(db);
    console.log(`\nLesson +${n}  theme: ${s.theme.label} [${s.theme.key}]`);
    console.log(`  grammar : ${s.grammarTopic ? `${s.grammarTopic.name} (${s.grammarTopic.cefrLevel}, ${s.grammarTopic.status})` : "— syllabus mastered —"}`);
    console.log(`  vocab   : ${s.vocab.map((v) => `${v.headword}${v.topic === s.theme.key ? "" : `{${v.topic ?? "?"}}`}`).join(", ")}`);
    console.log(`  due errs: ${s.dueErrors.length}`);
    history.unshift(s.theme.key);
  }
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
