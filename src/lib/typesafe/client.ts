/**
 * Minimal typed client for the TypeSafe "System One" endpoint (model: Jev).
 * One endpoint, three question types — plain fetch, no SDK dependency.
 * Docs: https://docs.typesafe.ai/api
 */
export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

export interface ChoiceQuestion<K extends string = string> {
  type: "choice";
  instructions: Json;
  criteria: Record<K, string | null>;
}
export interface NoulQuestion {
  type: "noul";
  instructions: Json;
  criteria: { true: string; false: string };
}
export interface ScoreQuestion {
  type: "score";
  instructions: Json;
  criteria: string[];
}
export type Question = ChoiceQuestion | NoulQuestion | ScoreQuestion;

export interface ChoiceAnswer<K extends string = string> {
  type: "choice";
  choice: K;
  probabilities: Record<K, number>;
  confidence: number;
}
export interface NoulAnswer {
  type: "noul";
  noul: number;
}
export interface ScoreAnswer {
  type: "score";
  score: number;
  legend: Record<string, string>;
  probabilities: Record<string, number>;
  confidence: number;
}

export type AnswerFor<Q> =
  Q extends ChoiceQuestion<infer K> ? ChoiceAnswer<K>
  : Q extends NoulQuestion ? NoulAnswer
  : Q extends ScoreQuestion ? ScoreAnswer
  : never;

export const choice = <K extends string>(
  instructions: Json,
  criteria: Record<K, string | null>,
): ChoiceQuestion<K> => ({ type: "choice", instructions, criteria });

export const noul = (instructions: Json, criteria: { true: string; false: string }): NoulQuestion => ({
  type: "noul",
  instructions,
  criteria,
});

export const score = (instructions: Json, criteria: string[]): ScoreQuestion => ({
  type: "score",
  instructions,
  criteria,
});

export class TypeSafeError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(message);
    this.name = "TypeSafeError";
  }
}

export interface ClientOptions {
  apiKey?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** Retries after the first attempt, for 429/529 only. */
  maxRetries?: number;
}

export interface SystemOneRequest<Q extends Record<string, Question>> {
  state: Json;
  questions: Q;
  model?: string;
}

export interface SystemOneResult<Q extends Record<string, Question>> {
  answers: { [P in keyof Q]: AnswerFor<Q[P]> };
  usage: { input_tokens: number; output_tokens: number };
}

export interface TypeSafeClient {
  systemOne<Q extends Record<string, Question>>(req: SystemOneRequest<Q>): Promise<SystemOneResult<Q>>;
}

const RETRYABLE = new Set([429, 529]);

export function createTypeSafeClient(opts: ClientOptions = {}): TypeSafeClient {
  const apiKey = opts.apiKey ?? process.env.TYPESAFE_API_KEY;
  if (!apiKey) throw new TypeSafeError("TYPESAFE_API_KEY is not set", 0, "");
  const baseUrl = opts.baseUrl ?? "https://api.typesafe.ai";
  const fetchImpl = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const maxRetries = opts.maxRetries ?? 4;

  return {
    async systemOne(req) {
      const body = JSON.stringify({
        state: req.state,
        model: req.model ?? "jev-latest",
        questions: req.questions,
      });
      for (let attempt = 0; ; attempt++) {
        const res = await fetchImpl(`${baseUrl}/v1/systemone`, {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body,
        });
        if (res.ok) {
          const data = await res.json();
          return { answers: data.answers, usage: data.usage };
        }
        const text = await res.text();
        if (RETRYABLE.has(res.status) && attempt < maxRetries) {
          await sleep(1000 * 2 ** attempt);
          continue;
        }
        throw new TypeSafeError(`TypeSafe request failed (HTTP ${res.status})`, res.status, text);
      }
    },
  };
}
