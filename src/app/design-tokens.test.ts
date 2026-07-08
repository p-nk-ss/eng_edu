import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const css = readFileSync(path.join(process.cwd(), "src/app/globals.css"), "utf8");

describe("design tokens", () => {
  it("defines the light-mode primary and success tokens", () => {
    expect(css).toMatch(/:root[\s\S]*--primary:\s*#4F46E5/i);
    expect(css).toMatch(/:root[\s\S]*--success:\s*#16A34A/i);
  });
  it("defines a dark-mode override block", () => {
    expect(css).toMatch(/\.dark\s*\{[\s\S]*--background:\s*#0B1020/i);
  });
});
