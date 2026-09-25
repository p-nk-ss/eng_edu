"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, GraduationCap, CircleAlert, History } from "lucide-react";

const ITEMS = [
  { href: "/", label: "Dashboard", Icon: LayoutDashboard },
  { href: "/lesson", label: "Lesson", Icon: GraduationCap },
  { href: "/errors", label: "Errors", Icon: CircleAlert },
  { href: "/history", label: "History", Icon: History },
];

/** "/" matches only itself; other items match their path and anything below it. */
export function isActive(href: string, path: string): boolean {
  return href === "/" ? path === "/" : path === href || path.startsWith(`${href}/`);
}

/** Phone: bottom-fixed tab bar (icon over label). md+: left sidebar. */
export function SideNav() {
  const path = usePathname() ?? "";
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-10 flex justify-around border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] md:static md:h-dvh md:w-56 md:shrink-0 md:flex-col md:justify-start md:gap-1 md:border-r md:border-t-0 md:bg-transparent md:p-4"
    >
      {ITEMS.map(({ href, label, Icon }) => {
        const active = isActive(href, path);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={[
              "relative flex min-h-14 min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-xl px-2 py-2 hover:bg-surface-2",
              "md:min-h-11 md:flex-none md:flex-row md:justify-start md:gap-3 md:px-3",
              active ? "bg-surface-2 font-bold text-primary" : "font-semibold text-foreground",
            ].join(" ")}
          >
            {active && (
              <span
                aria-hidden
                className="absolute left-1/2 top-0 h-1 w-8 -translate-x-1/2 rounded-full bg-primary md:left-0 md:top-1/2 md:h-6 md:w-1 md:-translate-y-1/2 md:translate-x-0"
              />
            )}
            <Icon size={20} aria-hidden />
            <span className="font-display text-xs md:text-base">{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
