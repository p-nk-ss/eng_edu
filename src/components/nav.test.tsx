import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const nav = vi.hoisted(() => ({ path: "/" }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.path }));

import { SideNav } from "./nav";

const current = () =>
  screen.getAllByRole("link").filter((a) => a.getAttribute("aria-current") === "page").map((a) => a.textContent);

describe("SideNav", () => {
  beforeEach(() => {
    nav.path = "/";
  });

  it("marks Dashboard as the current page only on exactly /", () => {
    render(<SideNav />);
    expect(current()).toEqual(["Dashboard"]);
  });

  it("marks Lesson as current on /lesson and /lesson/<id>", () => {
    nav.path = "/lesson/abc";
    const { unmount } = render(<SideNav />);
    expect(current()).toEqual(["Lesson"]);
    unmount();
    nav.path = "/lesson";
    render(<SideNav />);
    expect(current()).toEqual(["Lesson"]);
  });

  it("marks nothing on an unknown route and does not treat /lessons as /lesson", () => {
    nav.path = "/lessons";
    render(<SideNav />);
    expect(current()).toEqual([]);
  });
});
