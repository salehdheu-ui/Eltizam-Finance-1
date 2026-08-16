import { describe, expect, it } from "vitest";
import { parseImportPayload } from "./data-portability";

describe("P2 data import contract", () => {
  it("accepts a valid core export and applies safe defaults", () => {
    const parsed = parseImportPayload({
      exportVersion: 1,
      exportedAt: "2026-08-16T08:00:00.000Z",
      wallets: [{ id: 1, name: "المحفظة الرئيسية", type: "cash", balance: 100 }],
      categories: [{ id: 2, name: "طعام", type: "expense" }],
      transactions: [{ id: 3, walletId: 1, categoryId: 2, type: "expense", amount: 12.5, date: 1_750_000_000 }],
      monthlyBudgets: [{ id: 4, categoryId: 2, monthKey: "2026-08", amount: 250 }],
    });

    expect(parsed.wallets[0].color).toBe("from-slate-600 to-slate-800");
    expect(parsed.categories[0].icon).toBe("📝");
    expect(parsed.transactions[0].note).toBe("");
    expect(parsed.monthlyBudgets[0].monthKey).toBe("2026-08");
  });

  it("rejects an unknown export version and malformed amounts", () => {
    expect(() => parseImportPayload({ exportVersion: 2, exportedAt: "2026-08-16T08:00:00.000Z" })).toThrow();
    expect(() => parseImportPayload({
      exportVersion: 1,
      exportedAt: "2026-08-16T08:00:00.000Z",
      wallets: [{ id: 1, name: "محفظة", type: "cash", balance: Number.NaN }],
    })).toThrow();
  });

  it("rejects invalid budget month keys and unlinked required wallet references", () => {
    expect(() => parseImportPayload({
      exportVersion: 1,
      exportedAt: "2026-08-16T08:00:00.000Z",
      monthlyBudgets: [{ id: 1, categoryId: 2, monthKey: "2026-13", amount: 10 }],
    })).toThrow();

    expect(() => parseImportPayload({
      exportVersion: 1,
      exportedAt: "2026-08-16T08:00:00.000Z",
      transactions: [{ id: 1, walletId: null, categoryId: null, type: "expense", amount: 10, date: 1_750_000_000 }],
    })).not.toThrow();
  });
});
