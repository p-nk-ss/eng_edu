import type { SyllabusLevel } from "@/lib/curriculum/progress";

function Bar({ value, inProgress, total }: { value: number; inProgress: number; total: number }) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  const progressPct = total > 0 ? Math.round((inProgress / total) * 100) : 0;
  return (
    <div className="flex h-2 w-full overflow-hidden rounded-full bg-surface-2">
      <div className="h-full bg-success" style={{ width: `${pct}%` }} />
      <div className="h-full bg-success opacity-40" style={{ width: `${progressPct}%` }} />
    </div>
  );
}

export function SyllabusProgress({ data }: { data: SyllabusLevel[] | null }) {
  if (!data || data.length === 0) {
    return (
      <p className="text-muted-foreground">
        Curriculum not seeded yet — run <code>npx prisma db seed</code>.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-3">
      {data.map((lvl) => (
        <li key={lvl.level}>
          <div className="mb-1 flex items-center justify-between text-sm">
            <span className="font-display font-bold">{lvl.level}</span>
            <span className="tabular-nums text-muted-foreground">
              grammar {lvl.grammarMastered}/{lvl.grammarTotal}
              {lvl.grammarInProgress > 0 && ` (${lvl.grammarInProgress} in progress)`} · vocab{" "}
              {lvl.vocabKnown}/{lvl.vocabTotal}
              {lvl.vocabLearning > 0 && ` (${lvl.vocabLearning} learning)`}
            </span>
          </div>
          <Bar value={lvl.grammarMastered} inProgress={lvl.grammarInProgress} total={lvl.grammarTotal} />
        </li>
      ))}
    </ul>
  );
}
