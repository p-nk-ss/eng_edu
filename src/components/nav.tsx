import Link from "next/link";
import { LayoutDashboard, GraduationCap, CircleAlert, History } from "lucide-react";

const ITEMS = [
  { href: "/", label: "Dashboard", Icon: LayoutDashboard },
  { href: "/lesson", label: "Lesson", Icon: GraduationCap },
  { href: "/errors", label: "Errors", Icon: CircleAlert },
  { href: "/history", label: "History", Icon: History },
];

export function SideNav() {
  return (
    <nav
      aria-label="Main"
      className="flex gap-1 border-b border-border md:h-dvh md:border-b-0 md:w-56 md:flex-col md:border-r md:p-4"
    >
      {ITEMS.map(({ href, label, Icon }) => (
        <Link
          key={href}
          href={href}
          className="flex min-h-11 min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-xl px-2 py-2 text-foreground hover:bg-surface-2 md:flex-none md:flex-row md:justify-start md:gap-3 md:px-3"
        >
          <Icon size={20} aria-hidden />
          <span className="font-display text-xs font-semibold md:text-base">{label}</span>
        </Link>
      ))}
    </nav>
  );
}
