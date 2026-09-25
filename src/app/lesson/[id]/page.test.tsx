import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/lib/lesson/loadLesson", () => ({ loadLessonForPlayer: vi.fn() }));
vi.mock("next/navigation", () => ({ notFound: vi.fn(() => { throw new Error("NEXT_NOT_FOUND"); }), useRouter: () => ({ push: vi.fn() }), usePathname: () => "/lesson/L1" }));

import { loadLessonForPlayer } from "@/lib/lesson/loadLesson";
import { toExerciseView } from "@/lib/lesson/lessonView";
import { VALID_EXERCISES as E } from "@/lib/lesson/fixtures";
import LessonPage from "./page";

describe("/lesson/[id]", () => {
  it("renders the player for a known lesson", async () => {
    vi.mocked(loadLessonForPlayer).mockResolvedValue({
      lessonId: "L1", themeLabel: "Work & careers", grammarTitle: null,
      items: [{ view: toExerciseView("e1", E.MULTIPLE_CHOICE), result: null }],
    });
    render(await LessonPage({ params: Promise.resolve({ id: "L1" }) }));
    expect(screen.getByRole("navigation")).toBeInTheDocument();
    expect(screen.getByText("Exercise 1 of 1")).toBeInTheDocument();
    expect(loadLessonForPlayer).toHaveBeenCalledWith("L1");
  });

  it("404s for an unknown lesson", async () => {
    vi.mocked(loadLessonForPlayer).mockResolvedValue(null);
    await expect(LessonPage({ params: Promise.resolve({ id: "nope" }) })).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
