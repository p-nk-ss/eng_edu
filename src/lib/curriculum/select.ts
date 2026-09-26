import { CEFR_BANDS, normalizeCefrLevel, type CefrBand } from "./parse";
import { GENERAL_TOPIC, type Theme } from "./themes";
import { isParked } from "./advancement";

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
  /** false = never a lesson focus (trivial at its level / corpus artefact). From data/grammar-topics.json. */
  teachable: boolean;
  /** 1 core .. 3 peripheral, relative to the topic's own level. */
  importance: number;
  /** completed lessons with this focus (M4a); a PRACTICING topic with >= PARK_AFTER_LESSONS is parked. */
  lessonsCompleted: number;
}

const grammarRank = (t: GrammarCandidate): number =>
  isParked(t) ? 4 : t.status === "PRACTICING" ? (t.openErrors > 0 ? 0 : 1) : t.status === "INTRODUCED" ? 2 : 3;

// Plain code-unit comparison — avoids locale/ICU-dependent ordering from localeCompare.
const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const byFocusPriority = <T extends GrammarCandidate>(pool: T[]): T[] =>
  [...pool].sort(
    (a, b) =>
      grammarRank(a) - grammarRank(b) ||
      // Round-robin among parked topics: the least-practised one comes next, so parked topics
      // don't starve each other forever (its count grows after its lesson and the next one wins).
      (isParked(a) && isParked(b) ? a.lessonsCompleted - b.lessonsCompleted : 0) ||
      a.importance - b.importance ||
      a.sortOrder - b.sortOrder ||
      cmp(a.name, b.name),
  );

export function pickGrammarFocus<T extends GrammarCandidate>(topics: T[], level: CefrBand): T | null {
  const open = topics.filter((t) => t.status !== "MASTERED" && t.teachable);
  const at = CEFR_BANDS.indexOf(level);

  // Review-as-diagnosis: unfinished CORE topics of the band directly below come first
  // (a B1 learner is checked on A2 Present Perfect before B1 Past Perfect).
  if (at > 0) {
    const below = CEFR_BANDS[at - 1];
    const core = open.filter((t) => t.cefrLevel === below && t.importance === 1 && !isParked(t));
    if (core.length > 0) return byFocusPriority(core)[0];
  }

  for (const band of CEFR_BANDS.slice(at)) {
    const pool = open.filter((t) => t.cefrLevel === band);
    if (pool.length === 0) continue; // nothing teachable left here -> next band
    return byFocusPriority(pool)[0];
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
  // Total order: headword, then id — Postgres row order is otherwise unspecified for ties
  // (e.g. same headword, different pos), which would make lesson vocab non-deterministic.
  const byHeadword = (a: T, b: T) => cmp(a.headword, b.headword) || cmp(a.id, b.id);
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
