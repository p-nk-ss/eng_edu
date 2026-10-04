/**
 * Live tool for M5a: hold a short terminal warm-up conversation against LM Studio for a synthetic
 * lesson input (no DB writes), then run ONE post-conversation analysis call (Claude) and print the
 * findings.
 *   npm run conversation:try
 * Type learner lines at the "You:" prompt (up to 3 turns), or type /end to stop early.
 */
import * as readline from "node:readline";
import { config as loadEnv } from "dotenv";
import type { CompleteArgs } from "../src/lib/llm/types";

loadEnv({ path: ".env" });
loadEnv({ path: ".env.local", override: true });

/** This script's own learner-turn cap (independent of the app's TARGET_TURNS=8 / MAX_TURNS=12). */
const MAX_SCRIPT_TURNS = 3;

const SYNTHETIC = {
  level: "B1",
  interests: "IT, QA, gaming",
  theme: "work",
  intro: "Let's talk about your work. What does a typical day look like for you?",
  questions: [
    "What do you usually do first when you start work?",
    "What is the most interesting part of your job right now?",
  ],
  grammarId: "g1",
  grammarTitle: "Past Perfect (had done)",
  grammarDescription: "an action completed before another past action",
  vocab: ["deadline", "colleague"],
} as const;

type TurnRole = "partner" | "learner";
interface Turn {
  id: string;
  role: TurnRole;
  text: string;
}

class LmUnavailableError extends Error {
  constructor(cause?: unknown) {
    super("Conversation partner (LM Studio) unreachable", { cause });
    this.name = "LmUnavailableError";
  }
}

/** Resolves to the next line, or null once stdin closes with no more input (EOF / nothing typed). */
function askLine(rl: readline.Interface, prompt: string): Promise<string | null> {
  return new Promise((resolve) => {
    let settled = false;
    rl.question(prompt, (line) => {
      if (settled) return;
      settled = true;
      resolve(line);
    });
    rl.once("close", () => {
      if (settled) return;
      settled = true;
      resolve(null);
    });
  });
}

/**
 * Streams the partner's reply to stdout. Failure before the first delta is reported as
 * LmUnavailableError (unreachable LM Studio); a failure after partial output is treated as a
 * dropped connection - the partial reply is kept and the turn continues.
 */
async function streamPartnerReply(
  streamFn: (args: CompleteArgs) => AsyncIterable<string>,
  args: CompleteArgs,
): Promise<string> {
  const iterator = streamFn(args)[Symbol.asyncIterator]();
  let first: IteratorResult<string>;
  try {
    first = await iterator.next();
    if (first.done) throw new Error("Partner returned an empty reply");
  } catch (e) {
    throw new LmUnavailableError(e);
  }

  let reply = first.value;
  process.stdout.write(reply);
  while (true) {
    let next: IteratorResult<string>;
    try {
      next = await iterator.next();
    } catch {
      process.stdout.write("\n[connection lost]");
      break;
    }
    if (next.done) break;
    process.stdout.write(next.value);
    reply += next.value;
  }
  return reply;
}

async function main() {
  if (process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is set - unset it (pay-per-token billing).");

  const { stream, completeJson } = await import("../src/lib/llm");
  const { conversationPartnerPrompt } = await import("../src/lib/prompts/conversationPartner");
  const { conversationAnalysisPrompt, conversationAnalysisSchema } = await import("../src/lib/prompts/conversationAnalysis");
  const { MIN_TURNS_FOR_REVIEW, shouldWrapUp } = await import("../src/lib/conversation/rules");

  const turns: Turn[] = [{ id: "t1", role: "partner", text: SYNTHETIC.intro }];
  console.log(`Partner: ${SYNTHETIC.intro}\n`);
  console.log(`(up to ${MAX_SCRIPT_TURNS} learner turns - type /end to stop early)\n`);

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  let learnerTurns = 0;

  try {
    while (learnerTurns < MAX_SCRIPT_TURNS) {
      const line = await askLine(rl, "You: ");
      if (line === null) break;
      const text = line.trim();
      if (!text) continue;
      if (text.toLowerCase() === "/end") break;

      turns.push({ id: `t${turns.length + 1}`, role: "learner", text });
      learnerTurns++;

      const args = conversationPartnerPrompt({
        level: SYNTHETIC.level,
        interests: SYNTHETIC.interests,
        theme: SYNTHETIC.theme,
        intro: SYNTHETIC.intro,
        questions: [...SYNTHETIC.questions],
        grammar: { title: SYNTHETIC.grammarTitle, description: SYNTHETIC.grammarDescription },
        vocab: [...SYNTHETIC.vocab],
        wrapUp: shouldWrapUp(learnerTurns),
        history: turns.map((t) => ({ role: t.role, text: t.text })),
      });

      process.stdout.write("Partner: ");
      const reply = await streamPartnerReply((a) => stream("conversation", a), args);
      console.log("\n");
      turns.push({ id: `t${turns.length + 1}`, role: "partner", text: reply });
    }
  } finally {
    rl.close();
  }

  if (learnerTurns < MIN_TURNS_FOR_REVIEW) {
    console.log(`Skipping analysis - only ${learnerTurns} learner turn(s), need at least ${MIN_TURNS_FOR_REVIEW}.`);
    return;
  }

  console.log("Analysing the conversation...\n");
  const analysisArgs = conversationAnalysisPrompt({
    level: SYNTHETIC.level,
    turns: turns.map((t) => ({ id: t.id, role: t.role, text: t.text })),
    grammarTopics: [{ id: SYNTHETIC.grammarId, title: SYNTHETIC.grammarTitle }],
  });
  const analysis = await completeJson("conversation_analysis", analysisArgs, conversationAnalysisSchema);

  if (analysis.findings.length === 0) {
    console.log("No findings.");
  } else {
    console.log(`${analysis.findings.length} finding(s):`);
    for (const f of analysis.findings) {
      console.log(`  [${f.severity}] ${f.turnId} "${f.original}" -> "${f.corrected}" (${f.category}) - ${f.explanation}`);
    }
  }
  console.log(`Top issues: ${analysis.topIssues.length ? analysis.topIssues.join("; ") : "- none -"}`);
}

main().catch((e) => {
  if (e instanceof LmUnavailableError) {
    console.error(
      [
        `LM Studio is unreachable at ${process.env.LOCAL_LLM_URL ?? "http://localhost:1234/v1"}.`,
        "Start LM Studio, load the model, and enable the local server on :1234 - see docs/LOCAL_SETUP.md section 1.",
      ].join("\n"),
    );
    process.exit(1);
  }
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
