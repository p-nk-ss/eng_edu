# Design System — English Trainer

Visual clarity and motivation are first-class product goals. This document is the source of
truth for tokens, typography, components, motion, and accessibility. `SPEC.md` §"Design System
& Visual Approach" is the summary; this file is the detail implementers follow.

**Direction:** *gamified but adult.* Motivating and playful (streak, XP, juicy correct-answer
feedback, progress rings) without reading as childish. Calm neutral base, energetic accents,
generous whitespace, one primary action per surface.

**Stack:** Next.js + Tailwind CSS. Light **and** dark via semantic tokens (system-based + manual
toggle). Desktop-first, fully usable on phone (home-LAN).

---

## 1. Design skills — when to use which

| Skill | Use it for | When |
|---|---|---|
| `frontend-design` | Aesthetic direction, avoiding templated/"AI-slop" looks, **locking the final font pairing** | Start of each UI milestone |
| `ui-ux-pro-max` | Token generation, component/layout patterns, chart choice, **pre-delivery checklist** | While building surfaces; final QA pass |
| `emil-design-eng` | Interaction & animation polish, the "invisible details," micro-interactions | Polishing a surface before sign-off |

Run all three on UI-bearing milestones: **M1** (shell + tokens), **M3** (exercise cards), **M5**
(conversation + review). Always finish with the `ui-ux-pro-max` pre-delivery checklist (§7).

---

## 2. Color tokens (semantic)

Define as CSS variables + Tailwind theme. **Never signal state by color alone — pair with icon + text.**

### Semantic roles

| Token | Meaning | Light | Dark |
|---|---|---|---|
| `--primary` | brand, primary CTA | `#4F46E5` | `#818CF8` |
| `--on-primary` | text on primary | `#FFFFFF` | `#0B1020` |
| `--success` | correct / progress / mastered | `#16A34A` | `#34D399` |
| `--warning` | review-due / streak-at-risk | `#D97706` | `#FBBF24` |
| `--danger` | error / destructive | `#DC2626` | `#F87171` |
| `--background` | app background | `#F7F8FC` | `#0B1020` |
| `--surface` | cards, sheets | `#FFFFFF` | `#151A2C` |
| `--surface-2` | inset / muted panels | `#EEF1F8` | `#1E2438` |
| `--foreground` | primary text | `#1E2233` | `#E9ECF5` |
| `--muted-foreground` | secondary text | `#5B6478` | `#A3ABC2` |
| `--border` | dividers, card edges | `#E2E6F0` | `#2A3149` |
| `--ring` | focus ring | `#4F46E5` | `#818CF8` |

### Rules
- **Contrast:** body text ≥ 4.5:1, large/secondary ≥ 3:1, in **both** themes. Verify, don't assume.
- Dark mode uses **desaturated/lighter tonal variants**, not inverted light values (see the shifted accents above).
- Green is reserved for **success/progress**; don't use it for neutral CTAs (that's `--primary`).
- Interaction states (hover/pressed/focus/disabled) must be distinct in both themes. Disabled =
  reduced opacity (0.4) + `disabled` attribute + no pointer.

---

## 3. Typography

- **Headings / XP / numbers:** **Nunito** (rounded, friendly, gamified-but-adult), weights 600–800.
- **Body / UI:** **Inter**, weights 400–600. Base **16px**, line-height **1.5**, measure 60–75ch.
- **Tabular figures** (`font-variant-numeric: tabular-nums`) for stats, streak counts, timers,
  and score columns to prevent layout shift.
- Type scale: `12 · 14 · 16 · 18 · 24 · 32 · 48`. Weight reinforces hierarchy (bold headings,
  medium labels, regular body).
- `font-display: swap`; preload only the two critical weights.
- **Final pairing is confirmed via `frontend-design`** at M1 — Nunito+Inter is the committed
  default, override only with a documented reason.

---

## 4. Layout, spacing, shape

- **Spacing scale (4/8px):** `4 · 8 · 12 · 16 · 24 · 32 · 48 · 64`. Standard density.
- **Radius:** cards `16px`, buttons/inputs `12px`, chips/pills `9999px` (the rounded, gamified feel).
- **Elevation:** one consistent shadow scale (sm/md/lg); cards use `sm`, modals/sheets `lg`. No ad-hoc shadows.
- **Containers:** dashboard `max-w-6xl`; lesson player is a **single focused column** `max-w-2xl`
  centered (one exercise at a time — minimize distraction).
- **Icons:** one set only — **Lucide** (SVG, consistent stroke ~1.75px). No emoji as structural icons.
- **Navigation:** desktop = left sidebar (Dashboard / Lesson / Errors / History); phone = bottom
  tab bar (≤5, icon+label, active state highlighted).

---

## 5. Component & interaction patterns

### Exercise cards (the core surface)
- One exercise per card, centered column, big readable prompt, one **primary "Check"** CTA.
- **On submit — instant feedback:** the card animates to a correct (`--success`) or incorrect
  (`--danger`) state with an **icon + short text label** (not color alone), then reveals an
  **expandable explanation** (from `content.explain` / rationales) and a clear **"Next"** action.
- Per-type affordances:
  - **MULTIPLE_CHOICE / DIALOGUE_GAP:** option chips; after grading, tint the chosen + correct option, show per-option rationale.
  - **CLOZE_DROPDOWN:** inline dropdown pills inside the sentence; each gap grades independently.
  - **FILL_BLANK:** underlined typed gap; on wrong, show accepted answer(s).
  - **WORD_BANK:** tap word tiles into an answer tray (with distractors); tiles animate on place; tap to remove.
  - **MATCH:** two columns; correct pair fades/locks together; wrong pair shakes briefly.
  - **DICTATION:** play/replay button (Kokoro or fallback) + text field; never log STT noise as errors.
  - **ERROR_CORRECTION:** tap the wrong token, then inline-edit the fix.
- **Keyboard a11y:** every tap-tile / chip / dropdown reachable and operable by keyboard;
  drag-based post-MVP types must ship a keyboard alternative.

### Gamification (motivating, restrained)
- **Streak** (calendar + count), **XP per completed exercise/lesson**, **level ring** toward the
  next CEFR band. Correct-answer "celebration" is a brief (≤400ms), skippable micro-animation +
  optional sound; respect `prefers-reduced-motion`.
- Motivation reinforces progress, never blocks or nags. No dark patterns.

### Forms & feedback
- Visible labels (not placeholder-only); errors inline below the field; loading state on async
  buttons; success confirmation (check/toast). `aria-live` for dynamic feedback.

### Conversation & review
- **Conversation screen:** push-to-talk button, live waveform, streaming tutor audio with a
  **replay** button per message, small **status indicator** for local-LLM / TTS availability.
- **Conversation Review screen:** the transcript with **inline highlights color-coded by
  severity** (`minor` subtle, `moderate`, `major` strong) + a top-issues summary. Only `major`
  findings became persisted errors (see `SPEC.md`).

---

## 6. Motion

- Micro-interactions **150–300ms**; complex transitions ≤ 400ms; **transform/opacity only**
  (never animate width/height/top/left).
- ease-out entering, ease-in exiting; exit ~60–70% of enter duration.
- Animate 1–2 key elements per view; stagger lists 30–50ms/item.
- Everything respects `prefers-reduced-motion` (celebrations reduce to a static state change).
- Route transitions: subtle fade (~200ms), never block navigation on animation.

---

## 7. Progress visualization

| Metric | Chart | Notes |
|---|---|---|
| Level mastery (% topics mastered) | **Waffle / ring** | 3–5 categories max; % label always visible; each cell `aria-label`ed |
| Errors over time / accuracy trend | **Line / area** | ≤6 series; differentiate by line style + color; togglable data table |
| "To next level" | **Gauge / bullet** | single KPI vs threshold |
| Streak | **Calendar heat + count** | tabular figures |

Charts: Recharts (or lightweight custom). Legends visible, tooltips on hover **and** tap,
accessible color pairs (not red/green-only), empty/loading/error states defined, `prefers-reduced-motion` respected.

---

## 8. Accessibility & pre-delivery checklist

- [ ] Contrast ≥ 4.5:1 body / ≥ 3:1 large, verified in **light and dark**
- [ ] State never conveyed by color alone (icon + text everywhere)
- [ ] Visible focus rings; full keyboard operability (incl. exercise tiles/dropdowns)
- [ ] Touch targets ≥ 44px; ≥ 8px spacing
- [ ] `prefers-reduced-motion` honored (celebrations included)
- [ ] Lucide SVG icons only; no emoji as icons; one icon family, consistent stroke
- [ ] Semantic tokens only — no raw hex in components
- [ ] Responsive at 375 / 768 / 1024 / 1440; no horizontal scroll; usable in landscape
- [ ] Charts have data-table fallback + non-color differentiation
- [ ] Run the `ui-ux-pro-max` pre-delivery checklist as the final gate
