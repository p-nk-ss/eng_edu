export const CEFR_BANDS = ["A1", "A2", "B1", "B2", "C1", "C2"] as const;
export type CefrBand = (typeof CEFR_BANDS)[number];

const BAND_SET: Set<string> = new Set(CEFR_BANDS);

/**
 * Normalize a raw CEFR-J level cell to a plain band.
 * "A1.1" -> "A1", "B2.2*" -> "B2", "A1-A2" -> "A1" (first match), "" -> null.
 */
export function normalizeCefrLevel(raw: string | undefined | null): CefrBand | null {
  if (!raw) return null;
  const m = raw.trim().toUpperCase().match(/[ABC][12]/);
  return m && BAND_SET.has(m[0]) ? (m[0] as CefrBand) : null;
}

export interface GrammarSeed {
  name: string;
  cefrLevel: CefrBand;
  category: string | null;
  sortOrder: number;
}

// Grammar CSV columns: 0=ID 1=Shorthand 2=Grammatical Item 3=Sentence Type
// 4=CEFR-J Level 5=FREQ*DISP 6=Core Inventory 7=EGP 8=GSELO 9=Notes
export function parseGrammarRows(rows: string[][]): GrammarSeed[] {
  const out: GrammarSeed[] = [];
  const seen = new Set<string>();
  const perLevelOrder: Record<string, number> = {};

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const name = (r[2] ?? "").trim();
    if (!name) continue;
    // Prefer the CEFR-J Level; fall back to Core Inventory, then EGP.
    const level =
      normalizeCefrLevel(r[4]) ?? normalizeCefrLevel(r[6]) ?? normalizeCefrLevel(r[7]);
    if (!level) continue;
    if (seen.has(name)) continue; // dedup by name (GrammarTopic.name is @unique); keep first
    seen.add(name);
    perLevelOrder[level] = (perLevelOrder[level] ?? 0) + 1;
    out.push({ name, cefrLevel: level, category: null, sortOrder: perLevelOrder[level] });
  }
  return out;
}

export interface GrammarVariant {
  shorthand: string;
  sentenceType: string;
  /** Dataset note (Japanese) describing the corpus extraction constraint; "" when absent. */
  note: string;
}

/**
 * All CSV rows sharing a Grammatical Item name, in file order. The seed collapses these
 * AFF/NEG/INT variants into one GrammarTopic (dedup by name); enrichment needs them all.
 * Key = the same trimmed name parseGrammarRows uses.
 */
export function collectGrammarVariants(rows: string[][]): Map<string, GrammarVariant[]> {
  const out = new Map<string, GrammarVariant[]>();
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const name = (r[2] ?? "").trim();
    if (!name) continue;
    const list = out.get(name) ?? [];
    list.push({
      shorthand: (r[1] ?? "").trim(),
      sentenceType: (r[3] ?? "").trim(),
      note: (r[9] ?? "").trim(),
    });
    out.set(name, list);
  }
  return out;
}

export interface VocabSeed {
  headword: string;
  pos: string | null;
  cefrLevel: CefrBand;
  isPhrase: boolean;
  topic: string | null;
}

/** Dedup/lookup key for a vocab item — matches `VocabItem.@@unique([headword, pos])`. */
export const wordKey = (headword: string, pos: string | null): string => `${headword} ${pos ?? ""}`;

// Vocab CSVs share columns: 0=headword 1=pos 2=CEFR (rest ignored).
export function parseVocabRows(
  rows: string[][],
  opts: { isPhrase?: boolean } = {},
): VocabSeed[] {
  const out: VocabSeed[] = [];
  const seen = new Set<string>();

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const headword = (r[0] ?? "").trim();
    const pos = (r[1] ?? "").trim() || null;
    const level = normalizeCefrLevel(r[2]);
    if (!headword || !level) continue;
    const key = wordKey(headword, pos);
    if (seen.has(key)) continue; // dedup by (headword, pos) to match @@unique
    seen.add(key);
    out.push({ headword, pos, cefrLevel: level, isPhrase: !!opts.isPhrase, topic: null });
  }
  return out;
}

/**
 * Merge vocab lists from multiple sources, de-duplicating by (headword, pos).
 * Earlier sources win — pass the primary CEFR-J list first so octanove only
 * contributes items that aren't already present.
 */
export function mergeVocab(...lists: VocabSeed[][]): VocabSeed[] {
  const byKey = new Map<string, VocabSeed>();
  for (const list of lists) {
    for (const v of list) {
      const key = wordKey(v.headword, v.pos);
      if (!byKey.has(key)) byKey.set(key, v);
    }
  }
  return [...byKey.values()];
}
