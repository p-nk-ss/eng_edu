// @vitest-environment node
import { describe, it, expect } from "vitest";
import { VALID_EXERCISES as E } from "./fixtures";
import { TYPE_LABELS, toExerciseView } from "./lessonView";

describe("toExerciseView", () => {
  it("keeps exactly the fields the player needs, per type", () => {
    const keys = (t: keyof typeof E) => Object.keys(toExerciseView("ex1", E[t])).sort();
    expect(keys("MULTIPLE_CHOICE")).toEqual(["id", "options", "prompt", "type"]);
    expect(keys("CLOZE_DROPDOWN")).toEqual(["gaps", "id", "text", "type"]);
    expect(keys("FILL_BLANK")).toEqual(["gaps", "id", "text", "type"]);
    expect(keys("WORD_BANK")).toEqual(["id", "tiles", "type"]);
    expect(keys("MATCH")).toEqual(["id", "left", "right", "rightOrder", "type"]);
    expect(keys("DIALOGUE_GAP")).toEqual(["id", "options", "turns", "type"]);
    expect(keys("DICTATION")).toEqual(["id", "tts", "type"]);
    expect(keys("ERROR_CORRECTION")).toEqual(["id", "tokens", "type"]);
    expect(keys("TRANSLATION")).toEqual(["hint", "id", "source", "type"]);
    expect(keys("OPEN_WRITING")).toEqual(["hint", "id", "minWords", "prompt", "type"]);
  });

  it("strips nested keys (gap answers, gap accept sets)", () => {
    expect(toExerciseView("ex1", E.CLOZE_DROPDOWN)).toMatchObject({ gaps: [{ options: ["since", "for"] }, { options: ["since", "for"] }] });
    expect(Object.keys((toExerciseView("ex1", E.CLOZE_DROPDOWN) as { gaps: object[] }).gaps[0])).toEqual(["options"]);
    expect(toExerciseView("ex1", E.FILL_BLANK)).toMatchObject({ gaps: [{ root: "BEAUTY" }] });
    expect(Object.keys((toExerciseView("ex1", E.FILL_BLANK) as { gaps: object[] }).gaps[0])).toEqual(["root"]);
  });

  it("never leaks explanations, references, rationales or accept strings", () => {
    for (const [name, content] of Object.entries(E)) {
      const json = JSON.stringify(toExerciseView("ex1", content));
      const c = content as Record<string, unknown>;
      expect(json, name).not.toContain(String(c.explain));
      if (typeof c.reference === "string") expect(json, name).not.toContain(c.reference);
      for (const r of (c.rationales as string[] | undefined) ?? []) expect(json, name).not.toContain(r);
      expect(json, name).not.toMatch(/"(answer|accept|accept_alt|rationales|explain|reference|vocab)"/);
    }
    expect(JSON.stringify(toExerciseView("ex1", E.FILL_BLANK))).not.toContain("beautiful");
    expect(JSON.stringify(toExerciseView("ex1", E.ERROR_CORRECTION))).not.toContain("doesn't");
  });

  it("uses null (not undefined) for absent optional fields so the view is serializable", () => {
    expect(toExerciseView("ex1", E.TRANSLATION)).toMatchObject({ hint: null });
    expect(toExerciseView("ex1", E.OPEN_WRITING)).toMatchObject({ hint: null, minWords: 60 });
    expect(toExerciseView("ex1", { ...E.FILL_BLANK, gaps: [{ accept: ["x"] }] } as never)).toMatchObject({ gaps: [{ root: null }] });
  });

  it("shuffles word-bank tiles and match rights deterministically, keeping an index map", () => {
    const a = toExerciseView("ex-A", E.WORD_BANK);
    expect(a).toEqual(toExerciseView("ex-A", E.WORD_BANK));
    expect(a.type === "word_bank" && [...a.tiles].sort()).toEqual(["I", "go", "goes", "to", "work"]);
    const m = toExerciseView("ex-A", E.MATCH);
    if (m.type !== "match") throw new Error("type");
    const original = ["with no money", "a person you work with", "to be honest"];
    expect(m.right).toEqual(m.rightOrder.map((k) => original[k]));
    expect(m.right).not.toEqual(original);
  });

  it("has a label for every type", () => {
    for (const content of Object.values(E)) expect(TYPE_LABELS[toExerciseView("x", content).type]).toMatch(/\w/);
  });
});
