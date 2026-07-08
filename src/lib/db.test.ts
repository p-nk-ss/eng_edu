import { describe, it, expect } from "vitest";

const hasDb = !!process.env.DATABASE_URL;

describe.skipIf(!hasDb)("db connectivity", () => {
  it("runs SELECT 1 through the adapter", async () => {
    const { prisma } = await import("./db");
    const rows = await prisma.$queryRaw<{ one: number }[]>`SELECT 1 as one`;
    expect(rows[0].one).toBe(1);
  });
});
