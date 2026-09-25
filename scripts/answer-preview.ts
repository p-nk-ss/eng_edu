/**
 * Acceptance tool for M3c: grade answers LIVE (Jev + Claude). NO DB WRITES.
 *   npm run answer:check                                         # list the latest lesson's exercises
 *   npm run answer:check -- --exercise 3 --answer "{\"text\":[\"colour\"]}"
 *   npm run answer:check -- --cases <file.json>
 * A cases file is an array of { "label": string, "exercise": number, "answer": object }
 * or { "label": string, "content": <exercise content>, "answer": object } (synthetic exercise).
 */
import { readFileSync } from "node:fs";
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env" });
loadEnv({ path: ".env.local", override: true });

interface Case {
  label: string;
  exercise?: number;
  content?: unknown;
  answer: unknown;
}

const argOf = (name: string): string | undefined => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

async function main() {
  if (process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is set - unset it (pay-per-token billing).");
  const { prisma } = await import("../src/lib/db");
  try {
    const { parseExercise } = await import("../src/lib/lesson/exerciseSchemas");
    const { parseAnswer } = await import("../src/lib/grading/answerSchemas");
    const { gradeLocally } = await import("../src/lib/grading/graders");
    const { runJudge } = await import("../src/lib/grading/judge");
    const { vocabOutcomes } = await import("../src/lib/grading/answerZone");
    const { checkAnswer, buildResult } = await import("../src/lib/grading/checkAnswer");
    const { liveJudgeDeps } = await import("../src/lib/grading/liveJudgeDeps");
    type Plan = { sections?: { written?: { exerciseIds?: string[] } }; meta?: { grammarTopicId?: string | null } };

    const lesson = await prisma.lesson.findFirst({ orderBy: [{ date: "desc" }, { id: "desc" }], select: { id: true, plan: true } });
    if (!lesson) throw new Error("No lesson in the DB - start one first.");
    const plan = lesson.plan as Plan;
    const ids = plan.sections?.written?.exerciseIds ?? [];
    const judge = liveJudgeDeps();

    const casesFile = argOf("--cases");
    const single = argOf("--exercise");
    if (!casesFile && !single) {
      for (const [n, id] of ids.entries()) {
        const ex = await prisma.exercise.findUnique({ where: { id }, select: { type: true, content: true } });
        console.log(`${n + 1}. ${ex?.type}  ${JSON.stringify(ex?.content).slice(0, 160)}`);
      }
      return;
    }
    const cases: Case[] = casesFile
      ? (JSON.parse(readFileSync(casesFile, "utf8")) as Case[])
      : [{ label: `exercise ${single}`, exercise: Number(single), answer: JSON.parse(argOf("--answer") ?? "{}") }];

    const topicId = plan.meta?.grammarTopicId ?? null;
    const topic = topicId ? await prisma.grammarTopic.findUnique({ where: { id: topicId } }) : null;
    const grammar = topic ? { id: topic.id, title: topic.title ?? topic.name, description: topic.description ?? "" } : null;
    const profile = await prisma.profile.findFirst({ select: { level: true } });

    for (const c of cases) {
      const started = Date.now();
      try {
        let result: unknown;
        if (c.exercise !== undefined) {
          result = await checkAnswer(ids[c.exercise - 1], c.answer, { judge, dryRun: true });
        } else {
          const parsed = parseExercise(c.content);
          if (!parsed.ok) throw new Error(`invalid synthetic content: ${parsed.reason}`);
          const ans = parseAnswer(parsed.content, c.answer);
          if (!ans.ok) throw new Error(`invalid answer: ${ans.reason}`);
          const local = gradeLocally(parsed.content, ans.answer);
          const judged = await runJudge(parsed.content, ans.answer, local, { grammar, level: profile?.level ?? "B1" }, judge);
          result = buildResult("synthetic", parsed.content.explain, local.correctAnswer, judged, vocabOutcomes(parsed.content, judged, []));
        }
        console.log(`\n=== ${c.label} (${Date.now() - started} ms)\n${JSON.stringify(result, null, 2)}`);
      } catch (e) {
        console.log(`\n=== ${c.label} FAILED: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
