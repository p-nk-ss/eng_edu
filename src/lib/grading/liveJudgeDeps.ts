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
          client = createTypeSafeClient();
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
