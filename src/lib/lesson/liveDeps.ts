import { completeJson } from "../llm/index";
import { lessonEnvelopeSchema, type LessonEnvelope } from "../prompts/lessonGeneration";
import { createTypeSafeClient, type TypeSafeClient } from "../typesafe/client";
import type { GenerationDeps } from "./generateLesson";
import { runQualityGate } from "./qualityGate";

/** Real ask/gate for the route and the preview script. The Jev gate is best effort by design. */
export function liveGenerationDeps(): GenerationDeps {
  let client: TypeSafeClient | null | undefined;
  const jev = (): TypeSafeClient | null => {
    if (client === undefined) {
      try {
        client = createTypeSafeClient();
      } catch {
        client = null; // no key -> gate reports "skipped"
      }
    }
    return client;
  };
  return {
    ask: (args) => completeJson<LessonEnvelope>("lesson_generation", args, lessonEnvelopeSchema),
    gate: (exercises, grammar) => runQualityGate(exercises, grammar, jev()),
  };
}
