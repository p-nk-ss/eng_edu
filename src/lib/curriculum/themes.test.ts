// @vitest-environment node
import { describe, it, expect } from "vitest";
import { THEMES, GENERAL_TOPIC, THEME_KEYS, isTopicKey, themeByKey } from "./themes";

describe("themes", () => {
  it("has 21 lesson themes with unique kebab-case keys", () => {
    expect(THEMES).toHaveLength(21);
    expect(new Set(THEMES.map((t) => t.key)).size).toBe(21);
    for (const t of THEMES) expect(t.key).toMatch(/^[a-z]+(-[a-z]+)*$/);
  });

  it("gives every theme a label and a substantive description", () => {
    for (const t of THEMES) {
      expect(t.label.length).toBeGreaterThan(2);
      expect(t.description.length).toBeGreaterThan(40);
    }
  });

  it("keeps 'general' out of the lesson themes but accepts it as a topic key", () => {
    expect(THEME_KEYS.has(GENERAL_TOPIC)).toBe(false);
    expect(isTopicKey(GENERAL_TOPIC)).toBe(true);
    expect(isTopicKey("technology")).toBe(true);
    expect(isTopicKey("nope")).toBe(false);
  });

  it("looks a theme up by key", () => {
    expect(themeByKey("health")?.label).toBe("Health & medicine");
    expect(themeByKey("general")).toBeUndefined();
  });
});
