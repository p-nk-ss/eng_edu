# Curriculum datasets

These CSVs seed the grammar syllabus (`GrammarTopic`) and vocabulary pool (`VocabItem`)
via `prisma/seed.ts`. They are committed to the repo so the seed is reproducible offline.

## Files

| File | Rows used | Feeds | Source |
|---|---|---|---|
| `cefrj-grammar-profile-20180315.csv` | 266 grammar topics (A1–C2) | `GrammarTopic` | CEFR-J Grammar Profile |
| `cefrj-vocabulary-profile-1.5.csv` | ~7,800 words (A1–B2) | `VocabItem` | CEFR-J Vocabulary Profile |
| `octanove-vocabulary-profile-c1c2-1.0.csv` | ~2,000 words (C1–C2) | `VocabItem` | Octanove Vocabulary Profile |

Downloaded from the Open Language Profiles repo:
<https://github.com/openlanguageprofiles/olp-en-cefrj>

## Attribution & license (required)

- **CEFR-J Grammar Profile** and **CEFR-J Vocabulary Profile** — © **Tono Laboratory, Tokyo
  University of Foreign Studies (TUFS)**. Free for research and commercial use **provided the
  dataset is cited**. Please cite: *CEFR-J Grammar/Vocabulary Profile, compiled by Yukio Tono,
  Tokyo University of Foreign Studies* (<https://cefr-j.org/>). Neither CEFR-J nor Open Language
  Profiles is responsible for inaccuracies in the data.
- **Octanove Vocabulary Profile (C1/C2)** — licensed under
  [**CC BY-SA 4.0**](https://creativecommons.org/licenses/by-sa/4.0/).

## Notes for maintainers

- **No thematic categories.** The SPEC assumed the CEFR-J Vocabulary Profile carried thematic
  categories (for topic-based vocab selection in Curriculum). Version 1.5 does **not** — it only
  has `headword, pos, CEFR, CoreInventory, Threshold`. The seed therefore sets `VocabItem.topic = null`.
  This affects the conversation-theme × thematic-category selection planned for M3 — revisit the
  theme source there (see SPEC §Curriculum).
- Grammar rows: `cefrLevel` is taken from `CEFR-J Level`, falling back to `Core Inventory` then
  `EGP` (328/499 rows have a blank `CEFR-J Level`); sub-levels like `A1.1` are normalized to `A1`.
  Rows with no name or no derivable level are skipped; topics are de-duplicated by name.
