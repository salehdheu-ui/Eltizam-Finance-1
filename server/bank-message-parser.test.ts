import { describe, expect, it } from "vitest";
import {
  buildBankSearchQuery,
  createMessageFingerprint,
  detectBalanceGap,
  messageMatchesAccount,
  parseBankMessage,
  resolveSyncWindowStart,
  senderMatchesBank,
} from "./bank-message-parser";

describe("bank message parser", () => {
  it("parses an Arabic debit message without confusing the closing balance for the amount", () => {
    const parsed = parseBankMessage({
      bankKey: "bank_muscat",
      sender: "alerts@bankmuscat.com",
      subject: "تنبيه عملية شراء",
      body: "تمت عملية شراء من كارفور بقيمة 12٫500 ريال عماني. الرصيد المتاح: 987٫500 ريال عماني.",
    });

    expect(parsed).not.toBeNull();
    expect(parsed).toMatchObject({
      direction: "debit",
      transactionType: "expense",
      operation: "purchase",
      channel: "pos",
      amount: 12.5,
      balanceAfter: 987.5,
    });
  });

  it("parses a salary credit and preserves the account reference", () => {
    const parsed = parseBankMessage({
      bankKey: "nbo",
      sender: "alerts@nbo.co.om",
      subject: "Salary credit",
      body: "Salary credited OMR 1,250.000 to account XX1234. Available balance OMR 2,000.000.",
    });

    expect(parsed).not.toBeNull();
    expect(parsed).toMatchObject({
      direction: "credit",
      transactionType: "income",
      operation: "deposit",
      channel: "salary",
      amount: 1250,
      balanceAfter: 2000,
      accountRef: "*1234",
    });
  });

  it("rejects a message that has no plausible amount", () => {
    expect(parseBankMessage({
      bankKey: "bank_muscat",
      sender: "alerts@bankmuscat.com",
      subject: "تنبيه",
      body: "تم تحديث بياناتك. لا توجد عملية مالية.",
    })).toBeNull();
  });
});

describe("bank import safety helpers", () => {
  it("uses a bounded overlap for incremental synchronization", () => {
    const now = 2_000_000_000;
    expect(resolveSyncWindowStart(null, now)).toBe(now - 90 * 86400);
    expect(resolveSyncWindowStart(now - 10, now)).toBe(now - 10 - 2 * 86400);
    expect(resolveSyncWindowStart(now - 200 * 86400, now)).toBe(now - 90 * 86400);
  });

  it("restricts sender and account matching to the configured bank scope", () => {
    expect(senderMatchesBank("bank_muscat", "alerts@bankmuscat.com")).toBe(true);
    expect(senderMatchesBank("bank_muscat", "alerts@unknown-bank.example")).toBe(false);
    expect(messageMatchesAccount("Transfer to account XX1234", "1234")).toBe(true);
    expect(messageMatchesAccount("Transfer to account XX1234", "9999")).toBe(false);
  });

  it("builds a bounded provider query with an incremental time window", () => {
    const query = buildBankSearchQuery("bank_muscat", null, 1_700_000_000);
    expect(query).toContain("after:1700000000");
    expect(query).toContain("from:(bankmuscat)");
    expect(query).not.toContain("from:(unknown)");
  });

  it("creates stable fingerprints for the same message and changes them when identity changes", () => {
    const input = {
      bankKey: "bank_muscat",
      amount: 12.5,
      type: "expense",
      merchant: "Carrefour",
      receivedAt: 1_700_000_030,
    };

    expect(createMessageFingerprint(input)).toBe(createMessageFingerprint({ ...input, merchant: "carrefour" }));
    expect(createMessageFingerprint(input)).not.toBe(createMessageFingerprint({ ...input, amount: 13.5 }));
  });
});

describe("balance-gap detection", () => {
  it("returns no gap when the reported balance matches the movement", () => {
    expect(detectBalanceGap({
      previousBalance: 100,
      direction: "debit",
      amount: 12.5,
      balanceAfter: 87.5,
    })).toBeNull();
  });

  it("reports the unexplained difference and its direction", () => {
    expect(detectBalanceGap({
      previousBalance: 100,
      direction: "debit",
      amount: 12.5,
      balanceAfter: 90,
    })).toEqual({
      expectedBalance: 87.5,
      actualBalance: 90,
      difference: 2.5,
      direction: "credit",
    });
  });

  it("does not invent a gap when either balance is unavailable", () => {
    expect(detectBalanceGap({
      previousBalance: null,
      direction: "credit",
      amount: 10,
      balanceAfter: 110,
    })).toBeNull();
    expect(detectBalanceGap({
      previousBalance: 100,
      direction: "credit",
      amount: 10,
      balanceAfter: null,
    })).toBeNull();
  });
});
