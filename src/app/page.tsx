import { SideNav } from "@/components/nav";
import { Flame } from "lucide-react";

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-card border border-border bg-surface p-5">
      <h2 className="mb-2 font-display text-lg font-bold">{title}</h2>
      {children}
    </section>
  );
}

export default function DashboardPage() {
  return (
    <div className="md:flex">
      <SideNav />
      <main className="mx-auto w-full max-w-6xl p-6">
        <header className="mb-6 flex items-center justify-between">
          <h1 className="font-display text-3xl font-extrabold">Today</h1>
          <button
            type="button"
            className="rounded-xl bg-primary px-5 py-3 font-display font-bold text-on-primary"
          >
            Start today&apos;s lesson
          </button>
        </header>

        <div className="grid gap-4 md:grid-cols-3">
          <Card title="Streak">
            <p className="flex items-center gap-2 text-2xl font-bold tabular-nums text-success">
              <Flame size={24} aria-hidden /> 0 days
            </p>
          </Card>
          <Card title="Syllabus progress">
            <p className="text-muted-foreground">No lessons yet — start your first one.</p>
          </Card>
          <Card title="Recently mastered">
            <p className="text-muted-foreground">Nothing mastered yet.</p>
          </Card>
        </div>
      </main>
    </div>
  );
}
