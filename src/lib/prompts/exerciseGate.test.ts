// @vitest-environment node
import { describe, it, expect } from "vitest";
import { VALID_EXERCISES } from "../lesson/fixtures";
import { GATE_THRESHOLDS, gateQuestions, gateState, gateVerdict, isGated } from "./exerciseGate";

const grammar = { title: "Past Perfect (had done)", description: "had + past participle." };

describe("exercise gate prompt", () => {
  it("gates only types with a disputable key", () => {
    const gated = Object.entries(VALID_EXERCISES).filter(([, c]) => isGated(c)).map(([t]) => t).sort();
    expect(gated).toEqual(["CLOZE_DROPDOWN", "DIALOGUE_GAP", "ERROR_CORRECTION", "FILL_BLANK", "MULTIPLE_CHOICE"]);
  });

  it("renders an mcq with the keyed option filled in and the other options listed", () => {
    const s = gateState(VALID_EXERCISES.MULTIPLE_CHOICE, grammar) as Record<string, unknown>;
    expect(s.sentence).toBe("She had finished the report before the deadline yesterday.");
    expect(s.other_options).toEqual(["finish", "finishing", "finishes"]);
    expect(s.grammar_focus).toMatchObject({ title: "Past Perfect (had done)" });
  });

  it("fills every cloze gap with its keyed option", () => {
    const s = gateState(VALID_EXERCISES.CLOZE_DROPDOWN, null) as Record<string, unknown>;
    expect(s.sentence).toBe("I have worked here since 2019, for five years.");
    expect(s.other_options).toEqual([["for"], ["since"]]);
    expect(s.grammar_focus).toBeNull();
  });

  it("shows the corrected and the original sentence for error correction", () => {
    const s = gateState(VALID_EXERCISES.ERROR_CORRECTION, grammar) as Record<string, unknown>;
    expect(s.sentence).toBe("She doesn't like tea");
    expect(s.original).toBe("She don't like tea");
  });

  it("asks on_focus only when there is a grammar focus, other_correct only when alternatives exist", () => {
    expect(Object.keys(gateQuestions(VALID_EXERCISES.MULTIPLE_CHOICE, grammar)).sort()).toEqual(["key_correct", "on_focus", "other_correct"]);
    expect(Object.keys(gateQuestions(VALID_EXERCISES.MULTIPLE_CHOICE, null)).sort()).toEqual(["key_correct", "other_correct"]);
    expect(Object.keys(gateQuestions(VALID_EXERCISES.FILL_BLANK, grammar)).sort()).toEqual(["key_correct", "on_focus"]);
    for (const q of Object.values(gateQuestions(VALID_EXERCISES.MULTIPLE_CHOICE, grammar))) expect(q.type).toBe("noul");
  });

  it("drops only on a confident failure", () => {
    expect(gateVerdict({ key_correct: 0.9, other_correct: 0.1, on_focus: 0.9 })).toBeNull();
    expect(gateVerdict({ key_correct: 0.5, other_correct: 0.5, on_focus: 0.5 })).toBeNull();
    expect(gateVerdict({ key_correct: GATE_THRESHOLDS.keyCorrectMax })).toMatch(/keyed answer/);
    expect(gateVerdict({ key_correct: 0.9, other_correct: GATE_THRESHOLDS.otherCorrectMin })).toMatch(/another option/);
    expect(gateVerdict({ key_correct: 0.9, on_focus: 0.1 })).toMatch(/grammar focus/);
  });
});
