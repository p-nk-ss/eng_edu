import type { ReactNode } from "react";
import Link from "next/link";
import { SideNav } from "@/components/nav";
import { ErrorCard } from "@/components/errors/ErrorCard";
import { listErrors, type StatusFilter, type GroupFilter } from "@/lib/errors/queries";
import { ERROR_GROUPS, GROUP_LABELS } from "@/lib/errors/categories";

export const dynamic = "force-dynamic";

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "mastered", label: "Mastered" },
  { value: "all", label: "All" },
];

function parseStatus(value: string | undefined): StatusFilter {
  return value === "mastered" || value === "all" ? value : "open";
}

function parseGroup(value: string | undefined): GroupFilter {
  return (ERROR_GROUPS as readonly string[]).includes(value ?? "") ? (value as GroupFilter) : "all";
}

function filterHref(status: StatusFilter, group: GroupFilter): string {
  return `/errors?status=${status}&category=${group}`;
}

function FilterLink({ href, active, children }: { href: string; active: boolean; children: ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={[
        "inline-flex min-h-11 items-center rounded-full px-4 text-sm",
        active ? "bg-surface-2 font-bold" : "font-semibold text-muted-foreground hover:bg-surface-2",
      ].join(" ")}
    >
      {children}
    </Link>
  );
}

export default async function ErrorsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; category?: string }>;
}) {
  const params = await searchParams;
  const status = parseStatus(params.status);
  const group = parseGroup(params.category);

  const { items, counts } = await listErrors({ status, group }, new Date());

  return (
    <div className="md:flex">
      <SideNav />
      <main className="mx-auto w-full max-w-3xl p-4 pb-24 md:p-6">
        <h1 className="font-display text-2xl font-bold">Mistakes</h1>

        <div role="group" aria-label="Filter by status" className="mt-4 flex flex-wrap gap-2">
          {STATUS_FILTERS.map((f) => (
            <FilterLink key={f.value} href={filterHref(f.value, group)} active={f.value === status}>
              {f.label} ({counts.status[f.value]})
            </FilterLink>
          ))}
        </div>

        <div role="group" aria-label="Filter by category" className="mt-2 flex flex-wrap gap-2">
          <FilterLink href={filterHref(status, "all")} active={group === "all"}>
            All ({counts.group.all})
          </FilterLink>
          {ERROR_GROUPS.map((g) => (
            <FilterLink key={g} href={filterHref(status, g)} active={group === g}>
              {GROUP_LABELS[g]} ({counts.group[g]})
            </FilterLink>
          ))}
        </div>

        {items.length === 0 ? (
          <p className="mt-6 text-muted-foreground">No mistakes here yet.</p>
        ) : (
          <ul className="mt-6 flex flex-col gap-4">
            {items.map((item) => (
              <li key={item.id}>
                <ErrorCard error={item} />
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
