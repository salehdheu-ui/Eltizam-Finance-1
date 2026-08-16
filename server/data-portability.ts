import { randomUUID } from "crypto";
import { and, eq, lt } from "drizzle-orm";
import { z } from "zod";

const walletImportSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().trim().min(1).max(120),
  type: z.string().trim().min(1).max(60),
  balance: z.number().finite(),
  color: z.string().trim().max(120).default("from-slate-600 to-slate-800"),
});

const categoryImportSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().trim().min(1).max(120),
  type: z.string().trim().min(1).max(60),
  icon: z.string().trim().max(20).default("📝"),
  color: z.string().trim().max(120).default("bg-orange-100 text-orange-600"),
  budget: z.number().finite().nullable().default(0),
});

const transactionImportSchema = z.object({
  id: z.number().int().positive(),
  walletId: z.number().int().positive().nullable(),
  categoryId: z.number().int().positive().nullable(),
  type: z.enum(["income", "expense", "debt", "transfer"]),
  amount: z.number().finite().nonnegative(),
  note: z.string().max(1000).nullable().default(""),
  date: z.number().int().positive(),
  reversalOfId: z.number().int().positive().nullable().optional(),
  reversalReason: z.string().max(300).nullable().optional(),
  voidedAt: z.number().int().positive().nullable().optional(),
});

const budgetImportSchema = z.object({
  id: z.number().int().positive(),
  categoryId: z.number().int().positive(),
  monthKey: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  amount: z.number().finite().nonnegative(),
});

const exportPayloadSchema = z.object({
  exportVersion: z.literal(1),
  exportedAt: z.string().datetime(),
  user: z.object({
    id: z.number().int().positive().optional(),
    username: z.string().optional(),
    name: z.string().optional(),
    email: z.string().optional(),
    phone: z.string().nullable().optional(),
  }).optional(),
  wallets: z.array(walletImportSchema).default([]),
  categories: z.array(categoryImportSchema).default([]),
  transactions: z.array(transactionImportSchema).default([]),
  monthlyBudgets: z.array(budgetImportSchema).default([]),
  recurringIncomes: z.array(z.unknown()).default([]),
  obligations: z.array(z.unknown()).default([]),
  variableObligationMonthStatuses: z.array(z.unknown()).default([]),
  commitments: z.array(z.unknown()).default([]),
  commitmentSteps: z.array(z.unknown()).default([]),
  commitmentProofs: z.array(z.unknown()).default([]),
  savingsGoals: z.array(z.unknown()).default([]),
  bankEmailEvents: z.array(z.unknown()).default([]),
  bankCategoryRules: z.array(z.unknown()).default([]),
  automationLog: z.array(z.unknown()).default([]),
  commitmentOccurrences: z.array(z.unknown()).default([]),
});

export type ImportPayload = z.infer<typeof exportPayloadSchema>;

export type ImportSummary = {
  exportVersion: 1;
  supported: {
    wallets: number;
    categories: number;
    transactions: number;
    monthlyBudgets: number;
  };
  unsupported: Record<string, number>;
  newRecords: number;
  duplicateRecords: number;
  conflicts: number;
  errors: string[];
  warnings: string[];
};

function normalizeKey(value: string) {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("ar");
}

function walletKey(wallet: { name: string; type: string }) {
  return `${normalizeKey(wallet.name)}::${normalizeKey(wallet.type)}`;
}

function categoryKey(category: { name: string; type: string }) {
  return `${normalizeKey(category.name)}::${normalizeKey(category.type)}`;
}

function transactionFingerprint(transaction: { type: string; amount: number; note?: string | null; date: number; walletKey: string; categoryKey: string }) {
  return [
    transaction.type,
    transaction.amount.toFixed(3),
    transaction.note?.trim() ?? "",
    transaction.date,
    transaction.walletKey,
    transaction.categoryKey,
  ].join("|");
}

function unsupportedCounts(payload: ImportPayload) {
  const entries: Array<[string, number]> = [
    ["recurringIncomes", payload.recurringIncomes.length],
    ["obligations", payload.obligations.length],
    ["variableObligationMonthStatuses", payload.variableObligationMonthStatuses.length],
    ["commitments", payload.commitments.length],
    ["commitmentSteps", payload.commitmentSteps.length],
    ["commitmentProofs", payload.commitmentProofs.length],
    ["savingsGoals", payload.savingsGoals.length],
    ["bankEmailEvents", payload.bankEmailEvents.length],
    ["bankCategoryRules", payload.bankCategoryRules.length],
    ["automationLog", payload.automationLog.length],
    ["commitmentOccurrences", payload.commitmentOccurrences.length],
  ];
  return Object.fromEntries(entries.filter(([, count]) => count > 0));
}

export function parseImportPayload(input: unknown) {
  return exportPayloadSchema.parse(input);
}

export async function createImportPreview(userId: number, input: unknown) {
  const { db } = await import("./db");
  const { categories, dataImportBatches, ledgerEntries, monthlyBudgets, transactions, wallets } = await import("@shared/schema");
  const payload = parseImportPayload(input);
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + 15 * 60;

  const [existingWallets, existingCategories, existingTransactions, existingBudgets] = await Promise.all([
    db.select().from(wallets).where(eq(wallets.userId, userId)),
    db.select().from(categories).where(eq(categories.userId, userId)),
    db.select().from(transactions).where(eq(transactions.userId, userId)),
    db.select().from(monthlyBudgets).where(eq(monthlyBudgets.userId, userId)),
  ]);

  const existingWalletKeys = new Set(existingWallets.map(walletKey));
  const existingCategoryKeys = new Set(existingCategories.map(categoryKey));
  const walletKeyById = new Map(existingWallets.map((wallet) => [wallet.id, walletKey(wallet)]));
  const categoryKeyById = new Map(existingCategories.map((category) => [category.id, categoryKey(category)]));
  const importedWalletKeys = new Set<string>();
  const importedCategoryKeys = new Set<string>();
  const warnings: string[] = [];
  const errors: string[] = [];
  let newRecords = 0;
  let duplicateRecords = 0;
  let conflicts = 0;

  for (const wallet of payload.wallets) {
    const key = walletKey(wallet);
    if (importedWalletKeys.has(key) || existingWalletKeys.has(key)) duplicateRecords += 1;
    else { importedWalletKeys.add(key); newRecords += 1; }
  }

  for (const category of payload.categories) {
    const key = categoryKey(category);
    if (importedCategoryKeys.has(key) || existingCategoryKeys.has(key)) duplicateRecords += 1;
    else { importedCategoryKeys.add(key); newRecords += 1; }
  }

  const existingFingerprints = new Set(existingTransactions.map((transaction) => transactionFingerprint({
    type: transaction.type,
    amount: transaction.amount,
    note: transaction.note,
    date: transaction.date,
    walletKey: transaction.walletId ? walletKeyById.get(transaction.walletId) ?? `wallet:${transaction.walletId}` : "wallet:none",
    categoryKey: transaction.categoryId ? categoryKeyById.get(transaction.categoryId) ?? `category:${transaction.categoryId}` : "category:none",
  })));
  const importedFingerprints = new Set<string>();
  const importedWalletIds = new Set(payload.wallets.map((wallet) => wallet.id));
  const importedCategoryIds = new Set(payload.categories.map((category) => category.id));

  for (const transaction of payload.transactions) {
    if (transaction.walletId === null || (!importedWalletIds.has(transaction.walletId) && !walletKeyById.has(transaction.walletId))) {
      errors.push(`الحركة #${transaction.id} تشير إلى محفظة غير موجودة`);
      continue;
    }
    if (transaction.categoryId !== null && !importedCategoryIds.has(transaction.categoryId) && !categoryKeyById.has(transaction.categoryId)) {
      errors.push(`الحركة #${transaction.id} تشير إلى تصنيف غير موجود`);
      continue;
    }
    const sourceWallet = payload.wallets.find((wallet) => wallet.id === transaction.walletId);
    const sourceCategory = payload.categories.find((category) => category.id === transaction.categoryId);
    const fingerprint = transactionFingerprint({
      type: transaction.type,
      amount: transaction.amount,
      note: transaction.note,
      date: transaction.date,
      walletKey: sourceWallet ? walletKey(sourceWallet) : walletKeyById.get(transaction.walletId!) ?? `wallet:${transaction.walletId}`,
      categoryKey: sourceCategory ? categoryKey(sourceCategory) : transaction.categoryId ? categoryKeyById.get(transaction.categoryId) ?? `category:${transaction.categoryId}` : "category:none",
    });
    if (existingFingerprints.has(fingerprint) || importedFingerprints.has(fingerprint)) duplicateRecords += 1;
    else { importedFingerprints.add(fingerprint); newRecords += 1; }
  }

  const budgetKeys = new Set(existingBudgets.map((budget) => `${categoryKeyById.get(budget.categoryId) ?? `category:${budget.categoryId}`}::${budget.monthKey}`));
  for (const budget of payload.monthlyBudgets) {
    const sourceCategory = payload.categories.find((category) => category.id === budget.categoryId);
    const key = `${sourceCategory ? categoryKey(sourceCategory) : categoryKeyById.get(budget.categoryId) ?? `category:${budget.categoryId}`}::${budget.monthKey}`;
    if (budgetKeys.has(key)) conflicts += 1;
    else { budgetKeys.add(key); newRecords += 1; }
  }

  const unsupported = unsupportedCounts(payload);
  if (Object.keys(unsupported).length > 0) {
    warnings.push("يحتوي الملف على كيانات متقدمة لن تُستورد في هذا الإصدار؛ يجب تأكيد الاستيراد الجزئي صراحةً");
  }
  if (errors.length > 0) warnings.push("يجب إصلاح أخطاء الربط قبل التأكيد؛ لم تُكتب أي بيانات");

  const summary: ImportSummary = {
    exportVersion: 1,
    supported: {
      wallets: payload.wallets.length,
      categories: payload.categories.length,
      transactions: payload.transactions.length,
      monthlyBudgets: payload.monthlyBudgets.length,
    },
    unsupported,
    newRecords,
    duplicateRecords,
    conflicts,
    errors: errors.slice(0, 50),
    warnings,
  };
  const importKey = randomUUID();

  await db.delete(dataImportBatches).where(and(eq(dataImportBatches.userId, userId), lt(dataImportBatches.expiresAt, now)));
  await db.insert(dataImportBatches).values({
    userId,
    importKey,
    status: "preview",
    payload,
    summary,
    createdAt: now,
    expiresAt,
  });

  return { importKey, expiresAt, summary };
}

export async function commitImport(userId: number, importKey: string, allowPartial: boolean) {
  const { db } = await import("./db");
  const { dataImportBatches, ledgerEntries, monthlyBudgets, transactions, wallets, categories } = await import("@shared/schema");
  const now = Math.floor(Date.now() / 1000);
  return db.transaction(async (tx) => {
    const [batch] = await tx.select().from(dataImportBatches)
      .where(and(eq(dataImportBatches.userId, userId), eq(dataImportBatches.importKey, importKey)))
      .for("update");
    if (!batch) throw new Error("معاينة الاستيراد غير موجودة");
    if (batch.status !== "preview") throw new Error("تم استخدام معاينة الاستيراد أو انتهت صلاحيتها");
    if (batch.expiresAt <= now) throw new Error("انتهت صلاحية المعاينة؛ ارفع الملف مرة أخرى");

    const payload = parseImportPayload(batch.payload);
    const summary = batch.summary as ImportSummary;
    if (summary.errors.length > 0) throw new Error("لا يمكن تأكيد ملف يحتوي على أخطاء ربط");
    if (!allowPartial && Object.keys(summary.unsupported).length > 0) {
      throw new Error("يحتوي الملف على كيانات غير مدعومة؛ أعد التأكيد مع السماح بالاستيراد الجزئي");
    }

    const [existingWallets, existingCategories, existingTransactions, existingBudgets, existingLedger] = await Promise.all([
      tx.select().from(wallets).where(eq(wallets.userId, userId)),
      tx.select().from(categories).where(eq(categories.userId, userId)),
      tx.select().from(transactions).where(eq(transactions.userId, userId)),
      tx.select().from(monthlyBudgets).where(eq(monthlyBudgets.userId, userId)),
      tx.select().from(ledgerEntries).where(eq(ledgerEntries.userId, userId)),
    ]);

    const walletIdMap = new Map<number, number>();
    const categoryIdMap = new Map<number, number>();
    const walletByKey = new Map(existingWallets.map((wallet) => [walletKey(wallet), wallet]));
    const categoryByKey = new Map(existingCategories.map((category) => [categoryKey(category), category]));
    const importedNetByWallet = new Map<number, number>();

    for (const transaction of payload.transactions) {
      if (transaction.walletId === null) continue;
      const delta = transaction.type === "income" ? transaction.amount : -transaction.amount;
      importedNetByWallet.set(transaction.walletId, (importedNetByWallet.get(transaction.walletId) ?? 0) + delta);
    }

    for (const sourceWallet of payload.wallets) {
      const key = walletKey(sourceWallet);
      const existing = walletByKey.get(key);
      if (existing) {
        walletIdMap.set(sourceWallet.id, existing.id);
        continue;
      }
      const initialBalance = Number((sourceWallet.balance - (importedNetByWallet.get(sourceWallet.id) ?? 0)).toFixed(3));
      const [created] = await tx.insert(wallets).values({
        userId,
        name: sourceWallet.name,
        type: sourceWallet.type,
        balance: initialBalance,
        color: sourceWallet.color,
      }).returning();
      walletIdMap.set(sourceWallet.id, created.id);
      walletByKey.set(key, created);
    }

    for (const sourceCategory of payload.categories) {
      const key = categoryKey(sourceCategory);
      const existing = categoryByKey.get(key);
      if (existing) {
        categoryIdMap.set(sourceCategory.id, existing.id);
        continue;
      }
      const [created] = await tx.insert(categories).values({
        userId,
        name: sourceCategory.name,
        type: sourceCategory.type,
        icon: sourceCategory.icon,
        color: sourceCategory.color,
        budget: sourceCategory.budget ?? 0,
      }).returning();
      categoryIdMap.set(sourceCategory.id, created.id);
      categoryByKey.set(key, created);
    }

    const walletKeyById = new Map(existingWallets.map((wallet) => [wallet.id, walletKey(wallet)]));
    const categoryKeyById = new Map(existingCategories.map((category) => [category.id, categoryKey(category)]));
    for (const sourceWallet of payload.wallets) walletKeyById.set(walletIdMap.get(sourceWallet.id)!, walletKey(sourceWallet));
    for (const sourceCategory of payload.categories) categoryKeyById.set(categoryIdMap.get(sourceCategory.id)!, categoryKey(sourceCategory));

    const existingFingerprints = new Set(existingTransactions.map((transaction) => transactionFingerprint({
      type: transaction.type,
      amount: transaction.amount,
      note: transaction.note,
      date: transaction.date,
      walletKey: transaction.walletId ? walletKeyById.get(transaction.walletId) ?? `wallet:${transaction.walletId}` : "wallet:none",
      categoryKey: transaction.categoryId ? categoryKeyById.get(transaction.categoryId) ?? `category:${transaction.categoryId}` : "category:none",
    })));
    const insertedTransactionIds = new Map<number, number>();
    let importedTransactions = 0;
    let duplicateTransactions = 0;

    for (const sourceTransaction of payload.transactions) {
      if (sourceTransaction.walletId === null) continue;
      const walletId = walletIdMap.get(sourceTransaction.walletId);
      if (!walletId) throw new Error(`المحفظة للحركة #${sourceTransaction.id} غير موجودة`);
      const categoryId = sourceTransaction.categoryId === null ? null : categoryIdMap.get(sourceTransaction.categoryId) ?? null;
      const fingerprint = transactionFingerprint({
        type: sourceTransaction.type,
        amount: sourceTransaction.amount,
        note: sourceTransaction.note,
        date: sourceTransaction.date,
        walletKey: walletKeyById.get(walletId) ?? `wallet:${walletId}`,
        categoryKey: categoryId ? categoryKeyById.get(categoryId) ?? `category:${categoryId}` : "category:none",
      });
      const idempotencyKey = `import:${importKey}:transaction:${sourceTransaction.id}`;
      if (existingLedger.some((entry) => entry.idempotencyKey === idempotencyKey) || existingFingerprints.has(fingerprint)) {
        duplicateTransactions += 1;
        continue;
      }

      const [created] = await tx.insert(transactions).values({
        userId,
        walletId,
        categoryId,
        type: sourceTransaction.type,
        amount: Number(sourceTransaction.amount.toFixed(3)),
        note: sourceTransaction.note ?? "",
        date: sourceTransaction.date,
        reversalReason: sourceTransaction.reversalReason ?? null,
        voidedAt: sourceTransaction.voidedAt ?? null,
      }).returning();
      await tx.insert(ledgerEntries).values({
        userId,
        walletId,
        transactionId: created.id,
        amount: sourceTransaction.amount.toFixed(3),
        direction: sourceTransaction.type === "income" ? "credit" : "debit",
        source: "import",
        currency: "OMR",
        externalId: `import:${importKey}:transaction:${sourceTransaction.id}`,
        idempotencyKey,
        occurredAt: sourceTransaction.date,
      });
      const balanceDelta = sourceTransaction.type === "income" ? sourceTransaction.amount : -sourceTransaction.amount;
      const [currentWallet] = await tx.select().from(wallets).where(and(eq(wallets.id, walletId), eq(wallets.userId, userId))).for("update");
      if (!currentWallet) throw new Error("تعذر العثور على المحفظة أثناء الاستيراد");
      await tx.update(wallets).set({ balance: Number((currentWallet.balance + balanceDelta).toFixed(3)) }).where(eq(wallets.id, walletId));
      existingFingerprints.add(fingerprint);
      insertedTransactionIds.set(sourceTransaction.id, created.id);
      importedTransactions += 1;
    }

    for (const sourceTransaction of payload.transactions) {
      if (!sourceTransaction.reversalOfId) continue;
      const createdId = insertedTransactionIds.get(sourceTransaction.id);
      const originalId = insertedTransactionIds.get(sourceTransaction.reversalOfId);
      if (createdId && originalId) {
        await tx.update(transactions).set({ reversalOfId: originalId }).where(and(eq(transactions.id, createdId), eq(transactions.userId, userId)));
      }
    }

    const existingBudgetKeys = new Set(existingBudgets.map((budget) => `${categoryKeyById.get(budget.categoryId) ?? `category:${budget.categoryId}`}::${budget.monthKey}`));
    let importedBudgets = 0;
    for (const sourceBudget of payload.monthlyBudgets) {
      const categoryId = categoryIdMap.get(sourceBudget.categoryId);
      if (!categoryId) continue;
      const key = `${categoryKeyById.get(categoryId) ?? `category:${categoryId}`}::${sourceBudget.monthKey}`;
      if (existingBudgetKeys.has(key)) continue;
      await tx.insert(monthlyBudgets).values({
        userId,
        categoryId,
        monthKey: sourceBudget.monthKey,
        amount: Number(sourceBudget.amount.toFixed(3)),
        createdAt: now,
        updatedAt: now,
      });
      existingBudgetKeys.add(key);
      importedBudgets += 1;
    }

    const resultSummary = {
      ...summary,
      importedTransactions,
      duplicateTransactions,
      importedBudgets,
      importedWallets: payload.wallets.length,
      importedCategories: payload.categories.length,
    };
    await tx.update(dataImportBatches).set({ status: "committed", committedAt: now, summary: resultSummary }).where(eq(dataImportBatches.id, batch.id));
    return { importKey, summary: resultSummary };
  });
}
