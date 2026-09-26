/**
 * M4a one-off: score lessons whose written block was completed before M4a and advance their topics.
 * Idempotent (completed lessons are skipped). Writes to the DB.  npm run lessons:backfill
 */
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env" });
loadEnv({ path: ".env.local", override: true });

async function main() {
  const { prisma } = await import("../src/lib/db");
  const { completeWrittenBlockIfDone } = await import("../src/lib/curriculum/completeLesson");
  try {
    const lessons = await prisma.lesson.findMany({
      where: { writtenCompletedAt: null },
      orderBy: [{ date: "asc" }, { id: "asc" }],
      select: { id: true },
    });
    let completed = 0;
    for (const { id } of lessons) {
      const last = await prisma.exercise.findFirst({
        where: { lessonId: id, answeredAt: { not: null } },
        orderBy: { answeredAt: "desc" },
        select: { answeredAt: true },
      });
      if (!last?.answeredAt) continue;
      const out = await prisma.$transaction((tx) => completeWrittenBlockIfDone(tx, id, last.answeredAt!));
      if (out.completed) {
        completed++;
        console.log(`lesson ${id}: written block ${Math.round((out.score ?? 0) * 100)}%`);
      }
    }
    const topics = await prisma.grammarTopic.findMany({
      where: { lessonsCompleted: { gt: 0 } },
      select: { title: true, name: true, status: true, lessonsCompleted: true, goodLessons: true },
    });
    for (const t of topics) console.log(`topic ${t.title ?? t.name}: ${t.status}, ${t.goodLessons}/${t.lessonsCompleted} good`);
    console.log(`done: ${completed} lesson(s) scored`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
