/**
 * One-off vocab topic classification via TypeSafe Jev.
 *   npm run vocab:classify -- --pilot            # ~200-word stratified sample -> data/vocab-topics.pilot.csv
 *   npm run vocab:classify                       # full run, resumable      -> data/vocab-topics.csv
 *   flags: --limit N (cap words this run), --threshold X (default 0.5)
 * Reads vocab from the committed CSVs (no DB). Needs TYPESAFE_API_KEY in .env.local.
 */
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { config as loadEnv } from "dotenv";
import { loadSeedData } from "../src/lib/curriculum/load";
import {
  buildBatch, chunk, parseTopicRows, pendingWords, resolveTopic, sortTopicRows, stratifiedSample,
  toCsvLine, TOPIC_CSV_HEADER, type TopicRow,
} from "../src/lib/curriculum/classify";
import { createTypeSafeClient } from "../src/lib/typesafe/client";

loadEnv({ path: ".env" });
loadEnv({ path: ".env.local", override: true });

const BATCH_SIZE = 1; // neighbouring words in a shared `state` contaminate each other's answers;
// tokens per word are dominated by the ~22 criteria, so batching saved almost nothing anyway.
const CONCURRENCY = 8;
const PILOT_PER_LEVEL = 34; // x6 CEFR bands ~= 200 words

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const opt = (name: string, fallback: number) => {
  const i = args.indexOf(name);
  return i >= 0 ? Number(args[i + 1]) : fallback;
};

const pilot = flag("--pilot");
const threshold = opt("--threshold", 0.5);
const limit = opt("--limit", Infinity);
const outFile = path.join("data", pilot ? "vocab-topics.pilot.csv" : "vocab-topics.csv");

async function main() {
  const client = createTypeSafeClient();
  const { vocab } = loadSeedData();

  if (pilot || !existsSync(outFile)) writeFileSync(outFile, TOPIC_CSV_HEADER + "\n", "utf8");
  const done = parseTopicRows(readFileSync(outFile, "utf8"));
  const source = pilot ? stratifiedSample(vocab, PILOT_PER_LEVEL) : vocab;
  const todo = pendingWords(source, done).slice(0, limit);
  console.log(`${source.length} words in scope, ${done.length} already done, classifying ${todo.length} (threshold ${threshold})`);

  const batches = chunk(todo, BATCH_SIZE);
  let next = 0;
  let tokens = 0;
  const fresh: TopicRow[] = [];

  async function worker() {
    while (next < batches.length) {
      const batch = batches[next++];
      const { state, questions } = buildBatch(batch);
      const res = await client.systemOne({ state, questions });
      tokens += res.usage.input_tokens;
      const rows = batch.map((v, i) => ({
        headword: v.headword,
        pos: v.pos ?? "",
        ...resolveTopic(res.answers[`w${i}`], threshold),
      }));
      appendFileSync(outFile, rows.map(toCsvLine).join("\n") + "\n", "utf8"); // progress survives a crash
      fresh.push(...rows);
      if (fresh.length % 200 === 0 || fresh.length === todo.length) console.log(`  ${fresh.length}/${todo.length}`);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  const all = sortTopicRows(parseTopicRows(readFileSync(outFile, "utf8")));
  writeFileSync(outFile, [TOPIC_CSV_HEADER, ...all.map(toCsvLine)].join("\n") + "\n", "utf8");

  const counts = new Map<string, number>();
  for (const r of all) counts.set(r.topic, (counts.get(r.topic) ?? 0) + 1);
  console.log(`\n${all.length} rows in ${outFile}; input tokens this run: ${tokens} (~$${((tokens * 0.042) / 1e6).toFixed(4)})`);
  for (const [topic, n] of [...counts].sort((a, b) => b[1] - a[1])) console.log(`  ${topic.padEnd(14)} ${n}`);
  const demoted = all.filter((r) => r.topic !== r.rawTopic).length;
  console.log(`  demoted to general by threshold: ${demoted}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
