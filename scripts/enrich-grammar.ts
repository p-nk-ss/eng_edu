/**
 * One-off grammar topic enrichment via Claude (Agent SDK, subscription auth).
 *   npm run grammar:enrich -- --pilot   # 15 A2 + 15 B1 topics -> data/grammar-topics.pilot.json (always fresh)
 *   npm run grammar:enrich              # all 266 topics, resumable -> data/grammar-topics.json
 * Reads topics from the committed CSV (no DB). Needs CLAUDE_CODE_OAUTH_TOKEN in .env.local.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { config as loadEnv } from "dotenv";
import { z } from "zod";
import { loadGrammarVariants, loadSeedData } from "../src/lib/curriculum/load";
import {
  batchByLevel, enrichBatch, enrichmentSchema, parseEnrichmentFile, pendingTopics, pilotSample,
  serializeEnrichmentFile, type GrammarEnrichment,
} from "../src/lib/curriculum/grammarEnrichment";
import { completeJson } from "../src/lib/llm/index";

loadEnv({ path: ".env" });
loadEnv({ path: ".env.local", override: true });

const pilot = process.argv.includes("--pilot");
const outFile = path.join("data", pilot ? "grammar-topics.pilot.json" : "grammar-topics.json");

async function main() {
  if (process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is set - unset it, or this run is billed pay-per-token instead of the subscription.");
  }
  if (!process.env.CLAUDE_CODE_OAUTH_TOKEN) {
    throw new Error("CLAUDE_CODE_OAUTH_TOKEN is not set (.env.local) - generate it with `claude setup-token`.");
  }

  const { grammar } = loadSeedData();
  const variants = loadGrammarVariants();
  const levelOf = new Map(grammar.map((g) => [g.name, g.cefrLevel]));

  const all: GrammarEnrichment[] = pilot || !existsSync(outFile) ? [] : parseEnrichmentFile(readFileSync(outFile, "utf8"));
  const scope = pilot ? pilotSample(grammar) : grammar;
  const batches = batchByLevel(pendingTopics(scope, all));
  console.log(`${scope.length} topics in scope, ${all.length} already enriched, ${batches.length} batches to run`);

  const ask = (p: { system: string; user: string }) =>
    completeJson<GrammarEnrichment[]>("lesson_generation", { system: p.system, messages: [{ role: "user", content: p.user }] }, z.array(enrichmentSchema));

  for (const [i, batch] of batches.entries()) {
    const started = Date.now();
    all.push(...(await enrichBatch(batch, variants, ask)));
    writeFileSync(outFile, serializeEnrichmentFile(all), "utf8"); // progress survives a crash
    console.log(`  batch ${i + 1}/${batches.length} (${batch.level}, ${batch.topics.length} topics) ${Math.round((Date.now() - started) / 1000)}s`);
  }

  console.log(`\n${all.length} records in ${outFile}`);
  const levels = [...new Set(all.map((r) => levelOf.get(r.name) ?? "?"))].sort();
  for (const level of levels) {
    const rows = all.filter((r) => (levelOf.get(r.name) ?? "?") === level);
    const imp = [1, 2, 3].map((n) => rows.filter((r) => r.teachable && r.importance === n).length);
    console.log(`  ${level}: ${rows.length} topics, ${rows.filter((r) => !r.teachable).length} not teachable, importance 1/2/3 = ${imp.join("/")}`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
