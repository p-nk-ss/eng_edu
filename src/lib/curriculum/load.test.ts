// @vitest-environment node
import { describe, it, expect } from "vitest";
import { loadGrammarVariants, loadSeedData } from "./load";

describe("loadGrammarVariants (committed CEFR-J CSV)", () => {
  it("has variants for every seeded grammar topic", () => {
    const variants = loadGrammarVariants();
    const { grammar } = loadSeedData();
    expect(grammar).toHaveLength(266);
    for (const g of grammar) expect(variants.get(g.name)?.length ?? 0).toBeGreaterThan(0);
  });

  it("keeps the dataset's shorthand and sentence type", () => {
    expect(loadGrammarVariants().get("I am")?.[0]).toMatchObject({ shorthand: "PP.I_am", sentenceType: "AFF. DEC." });
  });
});
