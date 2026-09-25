// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { EXERCISE_TYPES, type ExerciseContent } from "./exerciseSchemas";
import { FIXTURE_VOCAB, VALID_EXERCISES } from "./fixtures";
import { checkExercise, headwordOccurs, normalizeAnswer, normalizeLoose, pruneVocab } from "./exerciseChecks";

const ctx = { vocab: FIXTURE_VOCAB };
const broken = (base: ExerciseContent, patch: Record<string, unknown>) => ({ ...base, ...patch }) as ExerciseContent;

describe("normalizeAnswer", () => {
  it("trims, collapses whitespace, lowercases, strips edge punctuation, straightens quotes", () => {
    expect(normalizeAnswer("  Doesn't   LIKE  ")).toBe("doesn't like");
    expect(normalizeAnswer("\u201CHello, world!\u201D")).toBe("hello, world");
    expect(normalizeAnswer("...")).toBe("");
  });
  it("loose form also drops inner punctuation but keeps apostrophes", () => {
    expect(normalizeLoose("I'd like a coffee, please.")).toBe("i'd like a coffee please");
  });
  it("straightens a real typographic right single quote/apostrophe (U+2019), not just ASCII input", () => {
    // Regression for the character class that was accidentally written with ASCII lookalikes
    // (', ") instead of the typographic code points - so it never matched real
    // smart-punctuation input such as iOS/macOS autocorrect produces.
    expect(normalizeAnswer("Doesn\u2019t")).toBe("doesn't");
    expect(normalizeAnswer("I\u2019d")).toBe("i'd");
  });
  it("straightens typographic double quotes INSIDE the string (U+201C/U+201D), edge punctuation still stripped", () => {
    // "\u201CHi\u201D, he said" straightens to '"hi", he said' (after lowercasing), then the
    // edge-punctuation strip removes only the LEADING '"' (it is punctuation); the closing
    // quote after "hi" is no longer at the string edge (a comma+space+"he said" follow it) so
    // it survives, and the trailing "d" of "said" is a letter, so nothing is stripped there.
    expect(normalizeAnswer("\u201CHi\u201D, he said")).toBe("hi\", he said");
  });
  it("normalizeLoose straightens a typographic apostrophe too", () => {
    expect(normalizeLoose("I\u2019d like it.")).toBe("i'd like it");
  });
  it("source file has no literal typographic quote glyphs - only \\u escapes, so a straightening tool cannot silently break the regex classes again", () => {
    const src = readFileSync(path.join(process.cwd(), "src/lib/lesson/exerciseChecks.ts"), "utf8");
    const forbidden = [0x2018, 0x2019, 0x201c, 0x201d, 0x02bc];
    const found = [...src].filter((ch) => forbidden.includes(ch.codePointAt(0) as number));
    expect(found).toEqual([]);
  });
});

describe("headwordOccurs", () => {
  it("tolerates inflection via a stem prefix", () => {
    expect(headwordOccurs("make", "She is making tea")).toBe(true);
    expect(headwordOccurs("study", "He studied hard")).toBe(true);
    expect(headwordOccurs("deadline", "Two deadlines passed")).toBe(true);
    expect(headwordOccurs("deadline", "We were on time")).toBe(false);
  });
  it("handles multi-word headwords, slash alternatives and hyphens", () => {
    expect(headwordOccurs("bank account", "I opened two bank accounts")).toBe(true);
    expect(headwordOccurs("bank account", "The account at the bank")).toBe(false);
    expect(headwordOccurs("adviser/advisor", "My advisor agreed")).toBe(true);
    expect(headwordOccurs("CD-ROM", "an old cd-rom drive")).toBe(true);
  });
});

describe("checkExercise", () => {
  it.each(EXERCISE_TYPES)("finds no problem in the valid %s fixture", (t) => {
    expect(checkExercise(VALID_EXERCISES[t], ctx)).toEqual([]);
  });

  it("flags answer indexes out of range and mismatched rationales", () => {
    expect(checkExercise(broken(VALID_EXERCISES.MULTIPLE_CHOICE, { answer: 9 }), ctx).join()).toMatch(/answer/);
    expect(checkExercise(broken(VALID_EXERCISES.MULTIPLE_CHOICE, { rationales: ["one"] }), ctx).join()).toMatch(/rationales/);
    expect(checkExercise(broken(VALID_EXERCISES.DIALOGUE_GAP, { answer: 2 }), ctx).join()).toMatch(/answer/);
    expect(
      checkExercise(broken(VALID_EXERCISES.CLOZE_DROPDOWN, { gaps: [{ options: ["a", "b"], answer: 5 }, { options: ["a", "b"], answer: 0 }] }), ctx).join(),
    ).toMatch(/gap 1.*answer/);
  });

  it("requires the number of ___ markers to equal the number of gaps", () => {
    expect(checkExercise(broken(VALID_EXERCISES.CLOZE_DROPDOWN, { text: "Only ___ here." }), ctx).join()).toMatch(/___/);
    expect(checkExercise(broken(VALID_EXERCISES.FILL_BLANK, { text: "No gap at all." }), ctx).join()).toMatch(/___/);
    expect(checkExercise(broken(VALID_EXERCISES.DIALOGUE_GAP, { turns: ["A: Hi.", "B: Hello."] }), ctx).join()).toMatch(/___/);
  });

  it("checks that word-bank answers can be built from the tokens", () => {
    expect(checkExercise(broken(VALID_EXERCISES.WORD_BANK, { answer: ["I", "went", "to", "work"] }), ctx).join()).toMatch(/went/);
    expect(checkExercise(broken(VALID_EXERCISES.WORD_BANK, { accept_alt: [["to", "to", "I", "go"]] }), ctx).join()).toMatch(/accept_alt/);
  });

  it("requires match answers to be a permutation of the right column", () => {
    expect(checkExercise(broken(VALID_EXERCISES.MATCH, { answer: [0, 0, 1] }), ctx).join()).toMatch(/permutation/);
    expect(checkExercise(broken(VALID_EXERCISES.MATCH, { right: ["a", "b"] }), ctx).join()).toMatch(/length/);
  });

  it("rejects an error-correction fix that equals the wrong token, and a bad index", () => {
    expect(checkExercise(broken(VALID_EXERCISES.ERROR_CORRECTION, { accept: ["Don't"] }), ctx).join()).toMatch(/same as the wrong token/);
    expect(checkExercise(broken(VALID_EXERCISES.ERROR_CORRECTION, { answer: 7 }), ctx).join()).toMatch(/answer/);
  });

  it("requires the dictation sentence to be accepted under loose normalization", () => {
    expect(checkExercise(broken(VALID_EXERCISES.DICTATION, { accept: ["i want a coffee"] }), ctx).join()).toMatch(/tts/);
  });

  it("rejects accept entries that normalize to nothing", () => {
    expect(checkExercise(broken(VALID_EXERCISES.FILL_BLANK, { gaps: [{ accept: ["..."] }] }), ctx).join()).toMatch(/empty/);
  });

  it("flags options that are identical after normalizeAnswer - a duplicated correct option breaks index grading", () => {
    expect(
      checkExercise(broken(VALID_EXERCISES.MULTIPLE_CHOICE, { options: ["finish", "Finish", "finishing", "finishes"] }), ctx).join(),
    ).toMatch(/duplicate option/);
    expect(
      checkExercise(
        broken(VALID_EXERCISES.CLOZE_DROPDOWN, { gaps: [{ options: ["since", "Since"], answer: 0 }, { options: ["since", "for"], answer: 1 }] }),
        ctx,
      ).join(),
    ).toMatch(/gap 1.*duplicate option/);
    expect(
      checkExercise(broken(VALID_EXERCISES.DIALOGUE_GAP, { options: ["No worries.", "no worries"] }), ctx).join(),
    ).toMatch(/duplicate option/);
    expect(
      checkExercise(broken(VALID_EXERCISES.MATCH, { right: ["with no money", "with no money", "to be honest"] }), ctx).join(),
    ).toMatch(/duplicate option/);
  });

  it("does not reject exercises for vocab attribution issues", () => {
    expect(checkExercise(broken(VALID_EXERCISES.MULTIPLE_CHOICE, { vocab: ["ghost"] }), ctx)).toEqual([]);
    expect(checkExercise(broken(VALID_EXERCISES.MULTIPLE_CHOICE, { vocab: ["v2"] }), ctx)).toEqual([]);
  });
});

describe("pruneVocab", () => {
  it.each(EXERCISE_TYPES)("returns unchanged with empty removed for valid %s fixture", (t) => {
    const result = pruneVocab(VALID_EXERCISES[t], ctx);
    expect(result.removed).toEqual([]);
    expect(result.content).toBe(VALID_EXERCISES[t]);
  });

  it("removes unknown vocab id with a note", () => {
    const result = pruneVocab(broken(VALID_EXERCISES.MULTIPLE_CHOICE, { vocab: ["ghost"] }), ctx);
    expect(result.content.vocab).toEqual([]);
    expect(result.removed.join()).toMatch(/ghost/);
  });

  it("removes vocab ids whose headword does not appear", () => {
    const result = pruneVocab(broken(VALID_EXERCISES.MULTIPLE_CHOICE, { vocab: ["v1", "v2"] }), ctx);
    expect(result.content.vocab).toEqual(["v1"]);
    expect(result.removed.join()).toMatch(/colleague/);
  });

  it("does not mutate the input", () => {
    const original = broken(VALID_EXERCISES.MULTIPLE_CHOICE, { vocab: ["ghost", "v1"] });
    const originalVocab = [...original.vocab];
    pruneVocab(original, ctx);
    expect(original.vocab).toEqual(originalVocab);
  });

  it("handles irregular inflections: exercise survives when headword is not recognised", () => {
    const ctx2 = { vocab: [{ id: "g", headword: "go" }] };
    const translation = broken(VALID_EXERCISES.TRANSLATION, { vocab: ["g"] });
    const result = pruneVocab(translation, ctx2);
    expect(result.content.vocab).toEqual([]);
    expect(result.removed.join()).toMatch(/go/);
    expect(checkExercise(result.content, ctx2)).toEqual([]);
  });
});
