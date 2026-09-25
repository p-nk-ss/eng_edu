import type { CompleteArgs } from "../llm/types";
import { lessonGenerationPrompt, type GenerationInputs, type LessonEnvelope } from "../prompts/lessonGeneration";
import { checkExercise, pruneVocab } from "./exerciseChecks";
import { parseExercise, type ExerciseContent, type ExerciseTypeName } from "./exerciseSchemas";
import type { GateResult } from "./qualityGate";

export const MIN_EXERCISES = 5;

export interface LessonDrop {
  attempt: 1 | 2;
  index: number;
  type?: ExerciseTypeName;
  reason: string;
}

/** "attempt N #i TYPE: reason" for the persisted plan and the API error payload; TYPE is omitted when unknown. */
export function formatDrop(d: LessonDrop): string {
  const type = d.type ? ` ${d.type}` : "";
  return `attempt ${d.attempt} #${d.index}${type}: ${d.reason}`;
}

export interface GateScoreEntry {
  /** Index into the returned exercises array (and so into sections.written.exerciseIds once persisted). */
  exerciseIndex: number;
  scores: Record<string, number>;
}

export interface LessonDraft {
  exercises: { type: ExerciseTypeName; content: ExerciseContent }[];
  warmup: LessonEnvelope["warmup"];
  scenario: LessonEnvelope["scenario"];
  qualityGate: GateResult["status"];
  drops: LessonDrop[];
  attempts: 1 | 2;
  /** Jev gate scores for the kept, gated exercises of the successful attempt only. */
  gateScores: GateScoreEntry[];
}

export interface GenerationDeps {
  ask: (args: CompleteArgs) => Promise<LessonEnvelope>;
  gate: (exercises: ExerciseContent[], grammar: { title: string; description: string } | null) => Promise<GateResult>;
}

export class LessonGenerationError extends Error {
  constructor(message: string, readonly drops: LessonDrop[]) {
    super(message);
    this.name = "LessonGenerationError";
  }
}

/**
 * One Claude call per attempt; every exercise is validated on its own - vocab pruned first
 * (heuristic, never a drop reason), then schema -> deterministic checks -> Jev gate - so a bad
 * exercise is dropped, not the lesson. Fewer than MIN_EXERCISES survivors -> one regeneration;
 * then LessonGenerationError. Writes nothing.
 */
export async function generateLesson(inputs: GenerationInputs, deps: GenerationDeps): Promise<LessonDraft> {
  const prompt = lessonGenerationPrompt(inputs);
  const grammar = inputs.grammar ? { title: inputs.grammar.title, description: inputs.grammar.description } : null;
  const ctx = { vocab: inputs.vocab.map((v) => ({ id: v.id, headword: v.headword })) };
  const drops: LessonDrop[] = [];

  for (const attempt of [1, 2] as const) {
    let envelope: LessonEnvelope;
    try {
      envelope = await deps.ask(prompt);
    } catch (e) {
      drops.push({ attempt, index: -1, reason: `generation failed: ${e instanceof Error ? e.message : String(e)}` });
      continue;
    }

    const valid: { index: number; type: ExerciseTypeName; content: ExerciseContent }[] = [];
    const seen = new Set<ExerciseTypeName>();
    envelope.exercises.forEach((raw, index) => {
      const parsed = parseExercise(raw);
      if (!parsed.ok) {
        drops.push({ attempt, index, reason: parsed.reason });
        return;
      }
      const { type } = parsed;
      if (!inputs.mix.includes(type)) {
        drops.push({ attempt, index, type, reason: "type was not requested for this lesson" });
        return;
      }
      if (seen.has(type)) {
        drops.push({ attempt, index, type, reason: "duplicate of an exercise type already present" });
        return;
      }
      const pruned = pruneVocab(parsed.content, ctx);
      const problems = checkExercise(pruned.content, ctx);
      if (problems.length > 0) {
        drops.push({ attempt, index, type, reason: problems.join("; ") });
        return;
      }
      seen.add(type);
      valid.push({ index, type, content: pruned.content });
    });

    const gate = await deps.gate(valid.map((v) => v.content), grammar);
    const survivors: { index: number; type: ExerciseTypeName; content: ExerciseContent; scores?: Record<string, number> }[] = [];
    valid.forEach((v, i) => {
      const verdict = gate.verdicts[i];
      if (verdict?.drop) {
        drops.push({ attempt, index: v.index, type: v.type, reason: verdict.reason ?? "gate: dropped" });
        return;
      }
      survivors.push({ ...v, scores: verdict?.scores });
    });

    if (survivors.length >= MIN_EXERCISES) {
      const order = (t: ExerciseTypeName) => inputs.mix.indexOf(t);
      const sorted = survivors.slice().sort((a, b) => order(a.type) - order(b.type));
      const gateScores: GateScoreEntry[] = sorted
        .map((v, exerciseIndex) => (v.scores ? { exerciseIndex, scores: v.scores } : null))
        .filter((e): e is GateScoreEntry => e !== null);
      return {
        exercises: sorted.map(({ type, content }) => ({ type, content })),
        warmup: envelope.warmup,
        scenario: envelope.scenario,
        qualityGate: gate.status,
        drops,
        attempts: attempt,
        gateScores,
      };
    }
    drops.push({ attempt, index: -1, reason: `only ${survivors.length} of ${inputs.mix.length} exercises survived (need ${MIN_EXERCISES})` });
  }

  throw new LessonGenerationError(
    "Lesson generation failed twice: " + drops.filter((d) => d.index === -1).map((d) => d.reason).join(" | "),
    drops,
  );
}
