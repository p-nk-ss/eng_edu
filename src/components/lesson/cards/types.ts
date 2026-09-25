import type { Answer, GradeResult } from "@/lib/grading/types";
import type { ExerciseView, ViewOf } from "@/lib/lesson/lessonView";

type Tag = ExerciseView["type"];

/** The request body `answer` of POST /api/exercise/check for type T (an M3c Answer without its tag). */
export type PayloadOf<T extends Tag> = Omit<Extract<Answer, { type: T }>, "type">;
export type AnswerPayload = { [K in Tag]: PayloadOf<K> }[Tag];

export interface CardProps<T extends Tag> {
  view: ViewOf<T>;
  /** true while checking and after grading */
  disabled: boolean;
  result: GradeResult | null;
  /** null = the answer is not complete yet */
  onChange: (answer: PayloadOf<T> | null) => void;
}
