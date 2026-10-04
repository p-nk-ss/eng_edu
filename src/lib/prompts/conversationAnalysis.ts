import { z } from "zod";
import type { CompleteArgs } from "../llm/types";

export const ANALYSIS_LIMITS = { topIssues: 3, findings: 30, text: 300 } as const;
const L = ANALYSIS_LIMITS;

export type Severity = "minor" | "moderate" | "major";
export const SEVERITIES = ["minor", "moderate", "major"] as const;

export interface ConversationFinding {
  turnId: string;
  original: string;
  corrected: string;
  explanation: string;
  category: string;
  severity: Severity;
  grammarTopicId: string | null;
}

const findingSchema: z.ZodType<ConversationFinding> = z.object({
  turnId: z.string().min(1),
  original: z.string().min(1).max(L.text),
  corrected: z.string().min(1).max(L.text),
  explanation: z.string().min(1).max(L.text),
  category: z.string().min(1).max(L.text),
  severity: z.enum(SEVERITIES),
  grammarTopicId: z.string().min(1).nullable(),
});

export const conversationAnalysisSchema = z.object({
  findings: z.array(findingSchema).max(L.findings).default([]),
  topIssues: z.array(z.string().min(1).max(L.text)).max(L.topIssues).default([]),
});

export interface AnalysisInput {
  level: string;
  turns: { id: string; role: "partner" | "learner"; text: string }[];
  grammarTopics: { id: string; title: string }[];
}

function buildSystem(input: AnalysisInput): string {
  const topicsList = input.grammarTopics.length ? input.grammarTopics.map((g) => `[${g.id}] ${g.title}`).join("\n") : "(none)";
  return [
    `You are an experienced English teacher reviewing a transcript of a text conversation between an AI partner and a ${input.level} learner.`,
    "Judge ONLY the learner's turns (marked with an id) for English mistakes - never the partner's turns, which are shown for context only.",
    `For each mistake, report: "turnId" (the id of the learner turn, exactly as given), "original" (the wrong words copied verbatim, up to ${L.text} characters), "corrected" (the fixed words, up to ${L.text} characters), "explanation" (why, in simple English for the learner's level, up to ${L.text} characters), "category", "severity" and "grammarTopicId".`,
    'severity: "major" = an error that blocks understanding or a core grammar error at the learner\'s level; "moderate" = a noticeable error that does not block understanding; "minor" = a small slip or a naturalness issue.',
    'category: the grammar topic title when a grammar topic applies; otherwise "vocab: <word>" for a wrong word choice; otherwise "general".',
    `grammarTopicId: the id of the grammar topic the mistake belongs to, or null when none applies. Must be one of these ids, or null:\n${topicsList}`,
    `List at most ${L.findings} findings, most important first, and at most ${L.topIssues} "topIssues" - short strings naming the learner's main recurring problems.`,
    'Return ONLY a JSON object: {"findings":[...],"topIssues":[...]} (empty arrays when the learner made no mistakes). No prose, no markdown fences.',
  ].join("\n");
}

function buildTranscript(turns: AnalysisInput["turns"]): string {
  return turns.map((t) => (t.role === "learner" ? `[${t.id}] ${t.text}` : `(partner) ${t.text}`)).join("\n");
}

/** Post-conversation analysis (role `conversation_analysis`). Response: conversationAnalysisSchema. */
export function conversationAnalysisPrompt(input: AnalysisInput): CompleteArgs {
  const system = buildSystem(input);
  const transcript = buildTranscript(input.turns);
  return { system, messages: [{ role: "user", content: "Review this conversation.\n" + transcript }] };
}
