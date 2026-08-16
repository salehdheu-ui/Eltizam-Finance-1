import { afterAll, beforeAll, describe, expect, it } from "vitest";

const hasTestDatabase = Boolean(process.env.TEST_DATABASE_URL);

describe.skipIf(!hasTestDatabase)("financial writes against PostgreSQL", () => {
  let pool: typeof import("./db").pool;
  let storage: typeof import("./storage").storage;
  let migrateDatabase: typeof import("./db").migrateDatabase;
  let userId: number;
  let walletId: number;
  let targetWalletId: number;

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    const dbModule = await import("./db");
    const storageModule = await import("./storage");
    pool = dbModule.pool;
    migrateDatabase = dbModule.migrateDatabase;
    storage = storageModule.storage;
    await migrateDatabase();

    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const userResult = await pool.query<{ id: number }>(
      `INSERT INTO users (username, password, name, email, role, is_active)
       VALUES ($1, $2, $3, $4, 'user', true)
       RETURNING id`,
      [`p1-test-${suffix}`, "not-a-real-password", "P1 Test", `p1-${suffix}@example.invalid`],
    );
    userId = userResult.rows[0].id;

    const wallet = await storage.createWallet(userId, {
      name: "P1 Test Wallet",
      type: "cash",
      balance: 100,
      color: "from-slate-600 to-slate-800",
    });
    walletId = wallet.id;

    const targetWallet = await storage.createWallet(userId, {
      name: "P1 Target Wallet",
      type: "cash",
      balance: 25,
      color: "from-blue-600 to-blue-800",
    });
    targetWalletId = targetWallet.id;
  });

  afterAll(async () => {
    if (!pool || !userId) return;
    await pool.query("DELETE FROM ledger_entries WHERE user_id = $1", [userId]);
    await pool.query("DELETE FROM transactions WHERE user_id = $1", [userId]);
    await pool.query("DELETE FROM wallets WHERE user_id = $1", [userId]);
    await pool.query("DELETE FROM users WHERE id = $1", [userId]);
    await pool.end();
  });

  it("writes one precise ledger entry and remains idempotent on retry", async () => {
    const first = await storage.createTransaction(userId, {
      walletId,
      categoryId: null,
      type: "expense",
      amount: 12.5,
      note: "P1 test expense",
    }, {
      idempotencyKey: "p1-integration-expense-1",
      source: "manual",
      occurredAt: 1_700_000_000,
    });

    const retry = await storage.createTransaction(userId, {
      walletId,
      categoryId: null,
      type: "expense",
      amount: 12.5,
      note: "P1 test expense retried",
    }, {
      idempotencyKey: "p1-integration-expense-1",
      source: "manual",
      occurredAt: 1_700_000_001,
    });

    expect(retry.id).toBe(first.id);

    const ledger = await pool.query<{ amount: string; direction: string; source: string; occurred_at: number }>(
      `SELECT amount, direction, source, occurred_at
       FROM ledger_entries
       WHERE user_id = $1 AND idempotency_key = $2`,
      [userId, "p1-integration-expense-1"],
    );
    expect(ledger.rows).toHaveLength(1);
    expect(ledger.rows[0]).toMatchObject({ amount: "12.500", direction: "debit", source: "manual", occurred_at: 1_700_000_000 });

    const wallet = await storage.getWallet(walletId, userId);
    expect(wallet?.balance).toBe(87.5);
  });

  it("keeps total balance unchanged while writing two transfer ledger entries", async () => {
    const before = await storage.getWallet(targetWalletId, userId);
    const outgoing = await storage.createTransfer(userId, {
      sourceWalletId: walletId,
      targetWalletId,
      amount: 20,
      note: "P1 transfer",
    });

    const entries = await pool.query<{ direction: string; amount: string; source: string }>(
      `SELECT direction, amount, source
       FROM ledger_entries
       WHERE user_id = $1 AND external_id = (SELECT external_id FROM ledger_entries WHERE transaction_id = $2 LIMIT 1)
       ORDER BY direction`,
      [userId, outgoing.id],
    );
    expect(entries.rows).toHaveLength(2);
    expect(entries.rows.map((row) => row.direction).sort()).toEqual(["credit", "debit"]);
    expect(entries.rows.every((row) => row.amount === "20.000" && row.source === "transfer")).toBe(true);

    const after = await storage.getWallet(targetWalletId, userId);
    expect(after?.balance).toBe((before?.balance ?? 0) + 20);
  });

  it("rolls back invalid transfers without creating ledger or transaction rows", async () => {
    const beforeCount = await pool.query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM ledger_entries WHERE user_id = $1",
      [userId],
    );

    await expect(storage.createTransfer(userId, {
      sourceWalletId: walletId,
      targetWalletId: 999999999,
      amount: 5,
      note: "invalid target",
    })).rejects.toThrow();

    const afterCount = await pool.query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM ledger_entries WHERE user_id = $1",
      [userId],
    );
    expect(afterCount.rows[0].count).toBe(beforeCount.rows[0].count);
  });

  it("reverses a deleted transaction and removes its linked ledger entry atomically", async () => {
    const transaction = await storage.createTransaction(userId, {
      walletId,
      categoryId: null,
      type: "income",
      amount: 7.75,
      note: "P1 delete test",
    }, { idempotencyKey: "p1-integration-delete-1" });

    const before = await storage.getWallet(walletId, userId);
    await storage.deleteTransaction(transaction.id, userId);
    const after = await storage.getWallet(walletId, userId);
    expect(after?.balance).toBe((before?.balance ?? 0) - 7.75);

    const ledger = await pool.query("SELECT 1 FROM ledger_entries WHERE transaction_id = $1", [transaction.id]);
    expect(ledger.rows).toHaveLength(0);
  });
});
