/**
 * Acceptance tool for M3b-2: generate ONE lesson live (Claude + Jev) and print it. NO DB WRITES.
 *   npm run lesson:generate            # the lesson the app would generate next
 *   npm run lesson:generate -- --n 3   # pretend it is lesson number 3 (adds OPEN_WRITING)
 */
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env" });
loadEnv({ path: ".env.local", override: true });

async function main() {
  if (process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is set - unset it (pay-per-token billing).");
  const { prisma } = await import("../src/lib/db");
  const { selectLessonInputs } = await import("../src/lib/curriculum/lessonInputs");
  const { planExerciseMix } = await import("../src/lib/lesson/exerciseMix");
  const { toGenerationInputs } = await import("../src/lib/lesson/startLesson");
  const { generateLesson, LessonGenerationError } = await import("../src/lib/lesson/generateLesson");
  const { liveGenerationDeps } = await import("../src/lib/lesson/liveDeps");

  const i = process.argv.indexOf("--n");
  const inputs = await selectLessonInputs();
  const lessonNumber = i >= 0 ? Number(process.argv[i + 1]) : (await prisma.lesson.count()) + 1;
  const mix = planExerciseMix(lessonNumber, { hasGrammar: inputs.grammarTopic !== null });

  console.log(`Lesson #${lessonNumber}  theme: ${inputs.theme.label}`);
  console.log(`grammar: ${inputs.grammarTopic ? `${inputs.grammarTopic.title ?? inputs.grammarTopic.name} (${inputs.grammarTopic.cefrLevel})` : "- none -"}`);
  console.log(`vocab  : ${inputs.vocab.map((v) => `${v.headword}[${v.id.slice(-4)}]`).join(", ")}`);
  console.log(`mix    : ${mix.join(", ")}\n`);

  const started = Date.now();
  try {
    const draft = await generateLesson(toGenerationInputs(inputs, mix, []), liveGenerationDeps());
    console.log(`generated in ${Math.round((Date.now() - started) / 1000)}s, attempts ${draft.attempts}, gate ${draft.qualityGate}, drops ${draft.drops.length}\n`);
    draft.exercises.forEach((e, n) => console.log(`--- ${n + 1}. ${e.type}\n${JSON.stringify(e.content, null, 2)}\n`));
    console.log("--- WARM-UP\n" + JSON.stringify(draft.warmup, null, 2));
    console.log("--- SCENARIO\n" + JSON.stringify(draft.scenario, null, 2));
    if (draft.drops.length) console.log("--- DROPS\n" + draft.drops.map((d) => `  attempt ${d.attempt} #${d.index} ${d.type ?? ""}: ${d.reason}`).join("\n"));
  } catch (e) {
    if (e instanceof LessonGenerationError) {
      console.error(e.message + "\n" + e.drops.map((d) => `  attempt ${d.attempt} #${d.index} ${d.type ?? ""}: ${d.reason}`).join("\n"));
      process.exitCode = 1;
    } else throw e;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
