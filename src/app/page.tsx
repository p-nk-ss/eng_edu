import { SideNav } from "@/components/nav";
import { StartLessonButton } from "@/components/StartLessonButton";
import { SyllabusProgress } from "@/components/syllabus-progress";
import { getSyllabusProgress } from "@/lib/curriculum/progress";
import { getStreak } from "@/lib/stats/streak";
import { Flame } from "lucide-react";

// Reads the DB at request time - never prerender at build (DB may be absent).
export const dynamic = "force-dynamic";

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-card border border-border bg-surface p-5">
      <h2 className="mb-2 font-display text-lg font-bold">{title}</h2>
      {children}
    </section>
  );
}

export default async function DashboardPage() {
  const progress = await getSyllabusProgress();
  const streak = await getStreak();
  return (
    <div className="md:flex">
      <SideNav />
      <main className="mx-auto w-full max-w-6xl p-6 pb-24 md:pb-6">
        <header className="mb-6 flex items-start justify-between gap-4">
          <h1 className="font-display text-3xl font-extrabold">Today</h1>
          <StartLessonButton />
        </header>

        <div className="grid gap-4 md:grid-cols-3">
          <Card title="Streak">
            <p className={`flex items-center gap-2 text-2xl font-bold tabular-nums ${streak?.atRisk ? "text-warning" : "text-success"}`}>
              <Flame size={24} aria-hidden /> {streak ? `${streak.days} ${streak.days === 1 ? "day" : "days"}` : "-"}
            </p>
            {streak?.atRisk && <p className="mt-1 text-sm text-muted-foreground">Answer one exercise today to keep it.</p>}
          </Card>
          <Card title="Syllabus progress">
            <SyllabusProgress data={progress} />
          </Card>
          <Card title="Recently mastered">
            <p className="text-muted-foreground">Nothing mastered yet.</p>
          </Card>
        </div>
      </main>
    </div>
  );
}
