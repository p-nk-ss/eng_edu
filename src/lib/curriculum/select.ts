import { CEFR_BANDS, normalizeCefrLevel, type CefrBand } from "./parse";
import { GENERAL_TOPIC, type Theme } from "./themes";

/** Deterministic "what to teach" selection. Pure: no DB, no clock, no randomness. */

export function parseLevel(level: string): CefrBand {
  const band = normalizeCefrLevel(level);
  if (!band) throw new Error(`Unrecognised CEFR level in profile: "${level}" (expected e.g. "B1" or "B1+")`);
  return band;
}

/**
 * Weighted least-recently-used. age = lessons since last use (never used = Infinity);
 * preferred themes score age x2. Highest score wins; ties -> preferred first, then `themes` order.
 */
export function pickTheme(
  themes: readonly Theme[],
  preferred: readonly string[],
  recentThemes: readonly string[],
): Theme {
  const pref = new Set(preferred);
  let best = themes[0];
  let bestScore = -1;
  let bestPref = false;
  for (const t of themes) {
    const idx = recentThemes.indexOf(t.key);
    const age = idx === -1 ? Infinity : idx + 1;
    const isPref = pref.has(t.key);
    const score = isPref ? age * 2 : age;
    if (score > bestScore || (score === bestScore && isPref && !bestPref)) {
      best = t;
      bestScore = score;
      bestPref = isPref;
    }
  }
  return best;
}

export interface GrammarCandidate {
  name: string;
  cefrLevel: string;
  status: string;
  sortOrder: number;
  /** Count of this topic's ErrorRecords whose status is not MASTERED. */
  openErrors: number;
}

const grammarRank = (t: GrammarCandidate): number =>
  t.status === "PRACTICING" ? (t.openErrors > 0 ? 0 : 1) : t.status === "INTRODUCED" ? 2 : 3;

export function pickGrammarFocus<T extends GrammarCandidate>(topics: T[], level: CefrBand): T | null {
  for (const band of CEFR_BANDS.slice(CEFR_BANDS.indexOf(level))) {
    const pool = topics.filter((t) => t.cefrLevel === band && t.status !== "MASTERED");
    if (pool.length === 0) continue;
    return [...pool].sort(
      (a, b) => grammarRank(a) - grammarRank(b) || a.sortOrder - b.sortOrder || a.name.localeCompare(b.name),
    )[0];
  }
  return null;
}

export interface VocabCandidate {
  id: string;
  headword: string;
  cefrLevel: string;
  topic: string | null;
  status: string;
  lastSeenAt: Date | null;
}

const MAX_LEARNING = 3;

export function pickVocab<T extends VocabCandidate>(
  items: T[],
  themeKey: string,
  level: CefrBand,
  target = 8,
): T[] {
  const size = Math.min(10, Math.max(6, target));
  const nextBand: CefrBand | undefined = CEFR_BANDS[CEFR_BANDS.indexOf(level) + 1];
  const byHeadword = (a: T, b: T) => a.headword.localeCompare(b.headword);
  const seenAt = (v: T) => v.lastSeenAt?.getTime() ?? -Infinity; // never seen = oldest

  const learning = items
    .filter((v) => v.status === "LEARNING")
    .sort((a, b) => seenAt(a) - seenAt(b) || byHeadword(a, b))
    .slice(0, MAX_LEARNING);

  const fresh = items.filter((v) => v.status === "NEW");
  const pools: T[][] = [
    fresh.filter((v) => v.topic === themeKey && v.cefrLevel === level),
    fresh.filter((v) => v.topic === themeKey && v.cefrLevel === nextBand),
    fresh.filter((v) => v.topic === GENERAL_TOPIC && v.cefrLevel === level),
    fresh.filter((v) => v.cefrLevel === level),
  ];

  const picked = [...learning];
  const taken = new Set(picked.map((v) => v.id));
  for (const pool of pools) {
    for (const v of [...pool].sort(byHeadword)) {
      if (picked.length >= size) return picked;
      if (taken.has(v.id)) continue;
      taken.add(v.id);
      picked.push(v);
    }
  }
  return picked;
}
