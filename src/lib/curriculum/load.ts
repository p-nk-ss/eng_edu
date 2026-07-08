import { readFileSync } from "node:fs";
import path from "node:path";
import { parseCsv } from "./csv";
import {
  parseGrammarRows,
  parseVocabRows,
  mergeVocab,
  type GrammarSeed,
  type VocabSeed,
} from "./parse";

const DATA_DIR = path.join(process.cwd(), "data");
const GRAMMAR_FILE = "cefrj-grammar-profile-20180315.csv";
const VOCAB_A1B2_FILE = "cefrj-vocabulary-profile-1.5.csv";
const VOCAB_C1C2_FILE = "octanove-vocabulary-profile-c1c2-1.0.csv";

export interface SeedData {
  grammar: GrammarSeed[];
  vocab: VocabSeed[];
}

/** Read + parse the committed CEFR-J datasets into normalized seed rows (no DB). */
export function loadSeedData(dataDir = DATA_DIR): SeedData {
  const read = (f: string) => parseCsv(readFileSync(path.join(dataDir, f), "utf8"));
  const grammar = parseGrammarRows(read(GRAMMAR_FILE));
  const vocabPrimary = parseVocabRows(read(VOCAB_A1B2_FILE)); // A1-B2
  const vocabC1C2 = parseVocabRows(read(VOCAB_C1C2_FILE)); // C1-C2 (octanove)
  // Primary CEFR-J list wins on (headword,pos) collision; octanove only adds new items.
  const vocab = mergeVocab(vocabPrimary, vocabC1C2);
  return { grammar, vocab };
}
