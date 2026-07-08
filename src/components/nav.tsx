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
      className="flex gap-1 border-border md:h-dvh md:w-56 md:flex-col md:border-r md:p-4"
    >
      {ITEMS.map(({ href, label, Icon }) => (
        <Link
          key={href}
          href={href}
          className="flex items-center gap-3 rounded-xl px-3 py-2 text-foreground hover:bg-surface-2"
        >
          <Icon size={20} aria-hidden />
          <span className="font-display font-semibold">{label}</span>
        </Link>
      ))}
    </nav>
  );
}
