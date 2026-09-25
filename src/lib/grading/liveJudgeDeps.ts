import { completeJson } from "../llm/index";
import { translationFeedbackSchema } from "../prompts/translationFeedback";
import { writingFeedbackSchema } from "../prompts/writingFeedback";
import { createTypeSafeClient, type TypeSafeClient } from "../typesafe/client";
import type { JudgeDeps } from "./judge";

/** Real Jev + Claude for the route and the acceptance script. Jev is optional by design. */
export function liveJudgeDeps(): JudgeDeps {
  let client: TypeSafeClient | null | undefined;
  return {
    jev: () => {
      if (client === undefined) {
        try {
          // Interactive (in the request path) must fail fast, unlike the offline scripts' defaults.
          client = createTypeSafeClient({ timeoutMs: 8000, maxRetries: 1 });
        } catch {
          client = null;
        }
      }
      return client;
    },
    askTranslation: (args) => completeJson("translation_check", args, translationFeedbackSchema),
    askWriting: (args) => completeJson("writing_feedback", args, writingFeedbackSchema),
  };
}
