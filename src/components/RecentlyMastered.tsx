import { formatDay } from "@/lib/errors/due";

export interface MasteredItem {
  kind: "grammar" | "word" | "mistake";
  label: string;
  at: Date;
}

const KIND_LABELS: Record<MasteredItem["kind"], string> = {
  grammar: "Grammar",
  word: "Word",
  mistake: "Mistake",
};

export function RecentlyMastered({ items }: { items: MasteredItem[] | null }) {
  if (!items) return <p className="text-muted-foreground">-</p>;
  if (items.length === 0) return <p className="text-muted-foreground">Nothing mastered yet.</p>;

  return (
    <ul className="flex flex-col gap-2 text-sm">
      {items.map((item, i) => (
        <li key={i} className="flex items-center justify-between gap-2">
          <span className="font-semibold">{item.label}</span>
          <span className="flex items-center gap-2 text-muted-foreground">
            <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs font-semibold">{KIND_LABELS[item.kind]}</span>
            <span className="tabular-nums">{formatDay(item.at)}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
