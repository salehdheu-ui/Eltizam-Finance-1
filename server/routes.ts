import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { hashPlainPassword, setupAuth } from "./auth";
import { writeAuditEvent } from "./audit";
import { createManualBackup, listAllBackups } from "./backup";
import { insertWalletSchema, insertCategorySchema, insertTransactionSchema, insertRecurringIncomeSchema, insertObligationSchema, insertVariableObligationMonthStatusSchema, insertCommitmentSchema, insertCommitmentStepSchema, insertCommitmentProofSchema, insertSavingsGoalSchema, integrationSettings, upsertIntegrationSettingSchema, transactions, categories, bankEmailEvents, bankCategoryRules } from "@shared/schema";
import { buildWriteQueueKey, enqueueWrite } from "./write-queue";
import { z } from "zod";
import { buildRuleKey, registerBankInboxRoutes } from "./bank-inbox";
import { db } from "./db";
import { and, eq } from "drizzle-orm";
import {
  INTEGRATION_PROVIDERS,
  PROVIDER_CALLBACK_PATHS,
  PROVIDER_LABELS,
  decryptSecret,
  encryptSecret,
  getIntegrationRecord,
  getProviderConfig,
  invalidateProviderCache,
  maskSecret,
  resolveAppBaseUrl,
  testProviderCredentials,
  type IntegrationProvider,
} from "./integration-settings";

function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ message: "غير مسجل الدخول" });
  }
  next();
}

function requireSystemAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ message: "غير مسجل الدخول" });
  }

  if (req.user?.role !== "system_admin") {
    return res.status(404).json({ message: "غير موجود" });
  }

  next();
}

function toAdminUser(user: Awaited<ReturnType<typeof storage.getUser>>) {
  if (!user) {
    return user;
  }

  const { password, ...safeUser } = user;
  return safeUser;
}

function parseRouteId(param: string | string[]) {
  return parseInt(Array.isArray(param) ? param[0] : param, 10);
}

function toOptionalNumber(value: unknown) {
  if (value === undefined) {
    return undefined;
  }

  if (value === null || value === "") {
    return null;
  }

  if (typeof value === "string") {
    return Number(value);
  }

  return value;
}

function toRequiredNumber(value: unknown) {
  if (typeof value === "string") {
    return Number(value);
  }

  return value;
}

async function runQueuedWrite<T>(res: Response, key: string, task: () => Promise<T>) {
  const queued = await enqueueWrite(key, task);
  res.setHeader("X-Write-Queue-Wait-Ms", queued.waitMs.toString());
  return queued.result;
}

const applyVariableObligationPaymentSchema = z.object({
  amount: z.number().positive("المبلغ يجب أن يكون أكبر من صفر"),
});

const adminUserUpdateSchema = z.object({
  isActive: z.boolean(),
});

const adminApprovePasswordResetSchema = z.object({
  temporaryPassword: z.string().min(8).max(128),
});

const walletUpdateSchema = insertWalletSchema.partial().extend({
  balance: z.number().finite().optional(),
});

const categoryUpdateSchema = insertCategorySchema.partial();

const transactionCreateRequestSchema = z.object({
  walletId: z.union([z.number(), z.string()]),
  targetWalletId: z.union([z.number(), z.string()]).nullable().optional(),
  categoryId: z.union([z.number(), z.string()]).nullable().optional(),
  type: z.enum(["income", "expense", "debt", "transfer"]),
  amount: z.union([z.number(), z.string()]),
  note: z.string().optional(),
});

const recurringIncomePatchSchema = insertRecurringIncomeSchema.partial();

const obligationPatchSchema = insertObligationSchema.partial();
const commitmentPatchSchema = insertCommitmentSchema.partial();

function getPeriodRange(period: string) {
  const end = new Date();
  const start = new Date(end);

  switch (period) {
    case "1month":
      start.setMonth(end.getMonth() - 1);
      break;
    case "3months":
      start.setMonth(end.getMonth() - 3);
      break;
    case "6months":
      start.setMonth(end.getMonth() - 6);
      break;
    case "1year":
      start.setFullYear(end.getFullYear() - 1);
      break;
    default:
      start.setFullYear(1970, 0, 1);
      break;
  }

  return { start, end };
}

function getBucketLabel(dateValue: number, period: string) {
  const date = new Date(dateValue * 1000);
  if (period === "1month") {
    return `${date.getDate()}/${date.getMonth() + 1}`;
  }

  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  setupAuth(app);
  registerBankInboxRoutes(app);

  app.get("/api/admin/stats", requireSystemAdmin, async (_req, res, next) => {
    try {
      const stats = await storage.getUserStats();
      res.json(stats);
    } catch (e) { next(e); }
  });

  app.get("/api/admin/users", requireSystemAdmin, async (_req, res, next) => {
    try {
      const users = await storage.getAllUsers();
      res.json(users.map((user) => toAdminUser(user)));
    } catch (e) { next(e); }
  });

  app.get("/api/admin/backups", requireSystemAdmin, async (_req, res, next) => {
    try {
      const backups = await listAllBackups();
      res.json(backups);
    } catch (e) { next(e); }
  });

  app.post("/api/admin/backups/manual", requireSystemAdmin, async (_req, res, next) => {
    try {
      const backup = await runQueuedWrite(
        res,
        buildWriteQueueKey("admin", "backups", "manual"),
        () => createManualBackup(),
      );
      await writeAuditEvent({
        action: "admin.backup.manual_created",
        actorUserId: _req.user?.id,
        actorRole: _req.user?.role,
        targetUserId: null,
        ipAddress: _req.ip,
        metadata: { fileName: backup.fileName, frequency: backup.frequency },
      });
      res.status(201).json(backup);
    } catch (e) { next(e); }
  });

  app.get("/api/admin/password-reset-requests", requireSystemAdmin, async (_req, res, next) => {
    try {
      const requests = await storage.getPasswordResetRequests();
      const users = await storage.getAllUsers();
      const userMap = new Map(users.map((user) => [user.id, user]));
      res.json(requests.map((request) => {
        const user = userMap.get(request.userId);
        return {
          id: request.id,
          userId: request.userId,
          status: request.status,
          verificationMethod: request.verificationMethod,
          requestedByIdentifier: request.requestedByIdentifier,
          contactValue: request.contactValue,
          adminUserId: request.adminUserId,
          createdAt: request.createdAt,
          resolvedAt: request.resolvedAt,
          user: user ? { id: user.id, name: user.name, username: user.username, email: user.email, phone: user.phone, isActive: user.isActive } : null,
        };
      }));
    } catch (e) { next(e); }
  });

  app.post("/api/admin/password-reset-requests/:id/approve", requireSystemAdmin, async (req, res, next) => {
    try {
      const requestId = parseRouteId(req.params.id);
      const resetRequest = await storage.getPasswordResetRequestById(requestId);
      if (!resetRequest) {
        return res.status(404).json({ message: "طلب إعادة التعيين غير موجود" });
      }
      if (resetRequest.status !== "pending") {
        return res.status(400).json({ message: "تمت معالجة هذا الطلب مسبقًا" });
      }
      const parsed = adminApprovePasswordResetSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "كلمة المرور المؤقتة غير صالحة" });
      }
      const hashed = await hashPlainPassword(parsed.data.temporaryPassword);
      await runQueuedWrite(res, buildWriteQueueKey("admin-password-reset", requestId), async () => {
        await storage.updateUser(resetRequest.userId, { password: hashed });
        return storage.updatePasswordResetRequest(requestId, { status: "approved", adminUserId: req.user!.id, resolvedAt: Math.floor(Date.now() / 1000) });
      });
      await writeAuditEvent({ action: "admin.password_reset.approved", actorUserId: req.user?.id, actorRole: req.user?.role, targetUserId: resetRequest.userId, ipAddress: req.ip, metadata: { requestId } });
      res.json({ message: "تمت الموافقة على إعادة التعيين وتحديث كلمة المرور المؤقتة" });
    } catch (e) { next(e); }
  });

  app.post("/api/admin/password-reset-requests/:id/reject", requireSystemAdmin, async (req, res, next) => {
    try {
      const requestId = parseRouteId(req.params.id);
      const resetRequest = await storage.getPasswordResetRequestById(requestId);
      if (!resetRequest) {
        return res.status(404).json({ message: "طلب إعادة التعيين غير موجود" });
      }
      if (resetRequest.status !== "pending") {
        return res.status(400).json({ message: "تمت معالجة هذا الطلب مسبقًا" });
      }
      await runQueuedWrite(res, buildWriteQueueKey("admin-password-reset", requestId), () => storage.updatePasswordResetRequest(requestId, { status: "rejected", adminUserId: req.user!.id, resolvedAt: Math.floor(Date.now() / 1000) }));
      await writeAuditEvent({ action: "admin.password_reset.rejected", actorUserId: req.user?.id, actorRole: req.user?.role, targetUserId: resetRequest.userId, ipAddress: req.ip, metadata: { requestId } });
      res.json({ message: "تم رفض طلب إعادة التعيين" });
    } catch (e) { next(e); }
  });

  app.patch("/api/admin/users/:id", requireSystemAdmin, async (req, res, next) => {
    try {
      const userId = parseRouteId(req.params.id);
      if (req.user!.id === userId) {
        return res.status(400).json({ message: "لا يمكنك تعديل حسابك الإداري من هذه الصفحة" });
      }

      const { isActive } = adminUserUpdateSchema.parse(req.body);
      const updated = await runQueuedWrite(
        res,
        buildWriteQueueKey("admin-user", userId),
        () => storage.updateUser(userId, { isActive }),
      );
      await writeAuditEvent({
        action: "admin.user.status_updated",
        actorUserId: req.user?.id,
        actorRole: req.user?.role,
        targetUserId: userId,
        ipAddress: req.ip,
        metadata: { isActive },
      });
      res.json(toAdminUser(updated));
    } catch (e) { next(e); }
  });

  app.delete("/api/admin/users/:id", requireSystemAdmin, async (req, res, next) => {
    try {
      const userId = parseRouteId(req.params.id);
      if (req.user!.id === userId) {
        return res.status(400).json({ message: "لا يمكنك حذف حسابك الإداري الحالي" });
      }

      await runQueuedWrite(
        res,
        buildWriteQueueKey("admin-user", userId),
        () => storage.deleteUser(userId),
      );
      await writeAuditEvent({
        action: "admin.user.deleted",
        actorUserId: req.user?.id,
        actorRole: req.user?.role,
        targetUserId: userId,
        ipAddress: req.ip,
      });
      res.json({ message: "تم حذف المستخدم بنجاح" });
    } catch (e) { next(e); }
  });

  async function buildIntegrationView(req: Request, provider: IntegrationProvider) {
    const [record, effective] = await Promise.all([
      getIntegrationRecord(provider),
      getProviderConfig(provider),
    ]);

    const defaultRedirectUri = `${resolveAppBaseUrl(req)}${PROVIDER_CALLBACK_PATHS[provider]}`;
    // A saved record stays the source of truth for what the form shows, even while
    // disabled — otherwise switching the provider off would blank out its fields.
    const storedSecret = record ? decryptSecret(record.clientSecretEncrypted) : null;

    return {
      provider,
      label: PROVIDER_LABELS[provider],
      configured: Boolean(effective),
      source: effective?.source ?? null,
      hasDatabaseRecord: Boolean(record),
      isEnabled: record?.isEnabled ?? true,
      clientId: record?.clientId ?? effective?.clientId ?? "",
      clientSecretMasked: maskSecret(record ? storedSecret : effective?.clientSecret ?? null),
      tenantId: record?.tenantId ?? effective?.tenantId ?? "",
      redirectUri: record?.redirectUri ?? "",
      effectiveRedirectUri: record?.redirectUri || effective?.redirectUri || defaultRedirectUri,
      defaultRedirectUri,
      updatedAt: record?.updatedAt ?? null,
    };
  }

  function parseIntegrationProvider(value: string | string[]): IntegrationProvider | null {
    const provider = Array.isArray(value) ? value[0] : value;
    return INTEGRATION_PROVIDERS.includes(provider as IntegrationProvider) ? (provider as IntegrationProvider) : null;
  }

  app.get("/api/admin/integrations", requireSystemAdmin, async (req, res, next) => {
    try {
      const views = await Promise.all(INTEGRATION_PROVIDERS.map((provider) => buildIntegrationView(req, provider)));
      res.json(views);
    } catch (e) { next(e); }
  });

  app.put("/api/admin/integrations/:provider", requireSystemAdmin, async (req, res, next) => {
    try {
      const provider = parseIntegrationProvider(req.params.provider);
      if (!provider) {
        return res.status(404).json({ message: "مزوّد غير مدعوم" });
      }

      const input = upsertIntegrationSettingSchema.parse(req.body);
      const existing = await getIntegrationRecord(provider);
      if (!existing && !input.clientSecret) {
        return res.status(400).json({ message: "يجب إدخال المفتاح السري (Client Secret) عند الحفظ لأول مرة" });
      }

      const now = Math.floor(Date.now() / 1000);
      await runQueuedWrite(res, buildWriteQueueKey("admin-integration", provider), async () => {
        const values = {
          clientId: input.clientId,
          tenantId: input.tenantId?.trim() || null,
          redirectUri: input.redirectUri?.trim() || null,
          isEnabled: input.isEnabled ?? existing?.isEnabled ?? true,
          updatedByUserId: req.user!.id,
          updatedAt: now,
        };

        if (existing) {
          return db.update(integrationSettings).set({
            ...values,
            ...(input.clientSecret ? { clientSecretEncrypted: encryptSecret(input.clientSecret) } : {}),
          }).where(eq(integrationSettings.provider, provider));
        }

        return db.insert(integrationSettings).values({
          provider,
          clientSecretEncrypted: encryptSecret(input.clientSecret!),
          ...values,
        });
      });

      invalidateProviderCache(provider);
      await writeAuditEvent({
        action: "admin.integration.updated",
        actorUserId: req.user?.id,
        actorRole: req.user?.role,
        targetUserId: null,
        ipAddress: req.ip,
        metadata: { provider, secretRotated: Boolean(input.clientSecret), isEnabled: input.isEnabled ?? existing?.isEnabled ?? true },
      });
      res.json(await buildIntegrationView(req, provider));
    } catch (e) { next(e); }
  });

  app.delete("/api/admin/integrations/:provider", requireSystemAdmin, async (req, res, next) => {
    try {
      const provider = parseIntegrationProvider(req.params.provider);
      if (!provider) {
        return res.status(404).json({ message: "مزوّد غير مدعوم" });
      }

      const existing = await getIntegrationRecord(provider);
      if (!existing) {
        return res.status(404).json({ message: "لا توجد مفاتيح محفوظة لهذا المزوّد" });
      }

      await runQueuedWrite(res, buildWriteQueueKey("admin-integration", provider), () =>
        db.delete(integrationSettings).where(eq(integrationSettings.provider, provider)));

      invalidateProviderCache(provider);
      await writeAuditEvent({
        action: "admin.integration.deleted",
        actorUserId: req.user?.id,
        actorRole: req.user?.role,
        targetUserId: null,
        ipAddress: req.ip,
        metadata: { provider },
      });
      res.json(await buildIntegrationView(req, provider));
    } catch (e) { next(e); }
  });

  app.post("/api/admin/integrations/:provider/test", requireSystemAdmin, async (req, res, next) => {
    try {
      const provider = parseIntegrationProvider(req.params.provider);
      if (!provider) {
        return res.status(404).json({ message: "مزوّد غير مدعوم" });
      }

      const config = await getProviderConfig(provider);
      if (!config) {
        return res.status(400).json({ ok: false, message: "لا توجد مفاتيح مفعّلة لهذا المزوّد. احفظ المفاتيح وفعّلها أولاً." });
      }

      const result = await testProviderCredentials(config);
      await writeAuditEvent({
        action: "admin.integration.tested",
        actorUserId: req.user?.id,
        actorRole: req.user?.role,
        targetUserId: null,
        ipAddress: req.ip,
        metadata: { provider, ok: result.ok },
      });
      res.json(result);
    } catch (e) { next(e); }
  });

  app.get("/api/wallets", requireAuth, async (req, res, next) => {
    try {
      const wallets = await storage.getWallets(req.user!.id);
      res.json(wallets);
    } catch (e) { next(e); }
  });

  app.post("/api/wallets", requireAuth, async (req, res, next) => {
    try {
      const data = insertWalletSchema.parse(req.body);
      const wallet = await runQueuedWrite(
        res,
        buildWriteQueueKey("user", req.user!.id, "wallets"),
        () => storage.createWallet(req.user!.id, data),
      );
      res.status(201).json(wallet);
    } catch (e) { next(e); }
  });

  app.patch("/api/wallets/:id", requireAuth, async (req, res, next) => {
    try {
      const walletId = parseRouteId(req.params.id);
      const body = {
        ...req.body,
        balance: req.body.balance === undefined ? undefined : toRequiredNumber(req.body.balance),
      };
      const data = walletUpdateSchema.parse(body);
      const wallet = await runQueuedWrite(
        res,
        buildWriteQueueKey("user", req.user!.id, "wallet", walletId),
        () => storage.updateWallet(walletId, req.user!.id, data),
      );
      res.json(wallet);
    } catch (e) { next(e); }
  });

  app.delete("/api/wallets/:id", requireAuth, async (req, res, next) => {
    try {
      const walletId = parseRouteId(req.params.id);
      await runQueuedWrite(
        res,
        buildWriteQueueKey("user", req.user!.id, "wallet", walletId),
        () => storage.deleteWallet(walletId, req.user!.id),
      );
      res.json({ message: "تم حذف المحفظة بنجاح" });
    } catch (e) { next(e); }
  });

  app.get("/api/categories", requireAuth, async (req, res, next) => {
    try {
      const cats = await storage.getCategories(req.user!.id);
      res.json(cats);
    } catch (e) { next(e); }
  });

  app.post("/api/categories", requireAuth, async (req, res, next) => {
    try {
      const data = insertCategorySchema.parse(req.body);
      const cat = await runQueuedWrite(
        res,
        buildWriteQueueKey("user", req.user!.id, "categories"),
        () => storage.createCategory(req.user!.id, data),
      );
      res.status(201).json(cat);
    } catch (e) { next(e); }
  });

  app.patch("/api/categories/:id", requireAuth, async (req, res, next) => {
    try {
      const categoryId = parseRouteId(req.params.id);
      const body = {
        ...req.body,
        budget: req.body.budget === undefined ? undefined : toRequiredNumber(req.body.budget),
      };
      const data = categoryUpdateSchema.parse(body);
      const cat = await runQueuedWrite(
        res,
        buildWriteQueueKey("user", req.user!.id, "category", categoryId),
        () => storage.updateCategory(categoryId, req.user!.id, data),
      );
      res.json(cat);
    } catch (e) { next(e); }
  });

  app.delete("/api/categories/:id", requireAuth, async (req, res, next) => {
    try {
      const categoryId = parseRouteId(req.params.id);
      await runQueuedWrite(
        res,
        buildWriteQueueKey("user", req.user!.id, "category", categoryId),
        () => storage.deleteCategory(categoryId, req.user!.id),
      );
      res.json({ message: "تم حذف الفئة بنجاح" });
    } catch (e) { next(e); }
  });

  app.get("/api/transactions", requireAuth, async (req, res, next) => {
    try {
      await storage.applyDueRecurringIncomes(req.user!.id);
      const txs = await storage.getTransactions(req.user!.id);
      res.json(txs);
    } catch (e) { next(e); }
  });

  app.get("/api/recurring-incomes", requireAuth, async (req, res, next) => {
    try {
      const incomes = await storage.getRecurringIncomes(req.user!.id);
      res.json(incomes);
    } catch (e) { next(e); }
  });

  app.post("/api/recurring-incomes", requireAuth, async (req, res, next) => {
    try {
      const body = {
        ...req.body,
        amount: toRequiredNumber(req.body.amount),
        dayOfMonth: toRequiredNumber(req.body.dayOfMonth),
        walletId: toRequiredNumber(req.body.walletId),
        categoryId: req.body.categoryId === null || req.body.categoryId === undefined ? null : toOptionalNumber(req.body.categoryId),
      };
      const data = insertRecurringIncomeSchema.parse(body);
      const recurringIncome = await runQueuedWrite(
        res,
        buildWriteQueueKey("user", req.user!.id, "recurring-incomes"),
        () => storage.createRecurringIncome(req.user!.id, data),
      );
      res.status(201).json(recurringIncome);
    } catch (e) { next(e); }
  });

  app.patch("/api/recurring-incomes/:id", requireAuth, async (req, res, next) => {
    try {
      const recurringIncomeId = parseRouteId(req.params.id);
      const body = {
        ...req.body,
        amount: req.body.amount === undefined || req.body.amount === null ? undefined : toRequiredNumber(req.body.amount),
        dayOfMonth: req.body.dayOfMonth === undefined || req.body.dayOfMonth === null ? undefined : toRequiredNumber(req.body.dayOfMonth),
        walletId: req.body.walletId === undefined || req.body.walletId === null ? undefined : toRequiredNumber(req.body.walletId),
        categoryId: req.body.categoryId === undefined ? undefined : req.body.categoryId === null ? null : toOptionalNumber(req.body.categoryId),
      };
      const data = recurringIncomePatchSchema.parse(body);
      const recurringIncome = await runQueuedWrite(
        res,
        buildWriteQueueKey("user", req.user!.id, "recurring-income", recurringIncomeId),
        () => storage.updateRecurringIncome(recurringIncomeId, req.user!.id, data),
      );
      res.json(recurringIncome);
    } catch (e) { next(e); }
  });

  app.delete("/api/recurring-incomes/:id", requireAuth, async (req, res, next) => {
    try {
      const recurringIncomeId = parseRouteId(req.params.id);
      await runQueuedWrite(
        res,
        buildWriteQueueKey("user", req.user!.id, "recurring-income", recurringIncomeId),
        () => storage.deleteRecurringIncome(recurringIncomeId, req.user!.id),
      );
      res.json({ message: "تم حذف الدخل المتكرر بنجاح" });
    } catch (e) { next(e); }
  });

  app.post("/api/transactions", requireAuth, async (req, res, next) => {
    try {
      const input = transactionCreateRequestSchema.parse(req.body);
      const body = {
        ...input,
        amount: toRequiredNumber(input.amount),
        categoryId: toOptionalNumber(input.categoryId),
        walletId: toOptionalNumber(input.walletId),
        targetWalletId: toOptionalNumber(input.targetWalletId),
      };
      if (input.type === "transfer") {
        if (!body.walletId || !body.targetWalletId) {
          throw new Error("يجب اختيار المحفظة المحوَّل منها والمحفظة المحوَّل إليها");
        }
        const sourceWalletId = Number(body.walletId);
        const targetWalletId = Number(body.targetWalletId);
        const transferAmount = Number(body.amount);

        const tx = await runQueuedWrite(
          res,
          buildWriteQueueKey("user", req.user!.id, "wallet", sourceWalletId, "transfer", targetWalletId),
          () => storage.createTransfer(req.user!.id, {
            sourceWalletId,
            targetWalletId,
            amount: transferAmount,
            note: body.note,
          }),
        );
        return res.status(201).json(tx);
      }

      const data = insertTransactionSchema.parse(body);
      const tx = await runQueuedWrite(
        res,
        buildWriteQueueKey("user", req.user!.id, "wallet", data.walletId, "transactions"),
        () => storage.createTransaction(req.user!.id, data),
      );
      res.status(201).json(tx);
    } catch (e) { next(e); }
  });

  /**
   * Recategorising a transaction that came from a bank email also teaches the
   * inbox, so the same payee is filed correctly next time without the user
   * having to make the same correction again.
   */
  app.patch("/api/transactions/:id", requireAuth, async (req, res, next) => {
    try {
      const input = z.object({
        categoryId: z.number().int().positive().nullable(),
      }).parse(req.body);

      const transactionId = parseRouteId(req.params.id);
      const userId = req.user!.id;

      const [existing] = await db.select().from(transactions)
        .where(and(eq(transactions.id, transactionId), eq(transactions.userId, userId)));
      if (!existing) return res.status(404).json({ message: "الحركة غير موجودة" });

      if (input.categoryId) {
        const [ownedCategory] = await db.select({ id: categories.id }).from(categories)
          .where(and(eq(categories.id, input.categoryId), eq(categories.userId, userId)));
        if (!ownedCategory) return res.status(404).json({ message: "التصنيف المحدد غير موجود" });
      }

      const [updated] = await db.update(transactions)
        .set({ categoryId: input.categoryId })
        .where(and(eq(transactions.id, transactionId), eq(transactions.userId, userId)))
        .returning();

      const [linkedEvent] = await db.select().from(bankEmailEvents)
        .where(and(eq(bankEmailEvents.transactionId, transactionId), eq(bankEmailEvents.userId, userId)));

      let ruleLabel: string | null = null;
      let appliedToOthers = 0;

      if (linkedEvent) {
        await db.update(bankEmailEvents).set({ categoryId: input.categoryId })
          .where(eq(bankEmailEvents.id, linkedEvent.id));

        const ruleKey = buildRuleKey(linkedEvent.counterparty, linkedEvent.merchant);
        if (ruleKey) {
          const now = Math.floor(Date.now() / 1000);
          ruleLabel = linkedEvent.counterparty || linkedEvent.merchant || ruleKey;
          await db.insert(bankCategoryRules).values({
            userId,
            matchKey: ruleKey,
            matchLabel: ruleLabel,
            categoryId: input.categoryId,
            updatedAt: now,
          }).onConflictDoUpdate({
            target: [bankCategoryRules.userId, bankCategoryRules.matchKey],
            set: { categoryId: input.categoryId, matchLabel: ruleLabel, updatedAt: now },
          });

          // The decision is about the payee, not this one row, so every other
          // transaction already imported from them follows it too.
          const siblings = await db.select({
            id: bankEmailEvents.id,
            transactionId: bankEmailEvents.transactionId,
            counterparty: bankEmailEvents.counterparty,
            merchant: bankEmailEvents.merchant,
          }).from(bankEmailEvents).where(eq(bankEmailEvents.userId, userId));

          const sameParty = siblings.filter((sibling) =>
            sibling.id !== linkedEvent.id && buildRuleKey(sibling.counterparty, sibling.merchant) === ruleKey);

          for (const sibling of sameParty) {
            await db.update(bankEmailEvents).set({ categoryId: input.categoryId })
              .where(eq(bankEmailEvents.id, sibling.id));
            if (sibling.transactionId) {
              await db.update(transactions).set({ categoryId: input.categoryId })
                .where(and(eq(transactions.id, sibling.transactionId), eq(transactions.userId, userId)));
            }
          }
          appliedToOthers = sameParty.length;
        }
      }

      res.json({ ...updated, ruleSaved: Boolean(ruleLabel), ruleLabel, appliedToOthers });
    } catch (e) { next(e); }
  });

  app.delete("/api/transactions/:id", requireAuth, async (req, res, next) => {
    try {
      const transactionId = parseRouteId(req.params.id);
      await runQueuedWrite(
        res,
        buildWriteQueueKey("user", req.user!.id, "transactions"),
        () => storage.deleteTransaction(transactionId, req.user!.id),
      );
      res.json({ message: "تم حذف الحركة بنجاح" });
    } catch (e) { next(e); }
  });

  app.get("/api/dashboard", requireAuth, async (req, res, next) => {
    try {
      await storage.applyDueRecurringIncomes(req.user!.id);
      const [walletsData, txsData] = await Promise.all([
        storage.getWallets(req.user!.id),
        storage.getTransactions(req.user!.id),
      ]);
      const visibleTransactions = txsData.filter((tx) => !(typeof tx.note === "string" && tx.note.startsWith("__transfer__:")));

      const totalBalance = walletsData.reduce((acc, w) => acc + w.balance, 0);
      const totalIncome = visibleTransactions.filter(t => t.type === "income").reduce((acc, t) => acc + t.amount, 0);
      const totalExpenses = visibleTransactions.filter(t => t.type === "expense" || t.type === "debt").reduce((acc, t) => acc + t.amount, 0);
      const recentTransactions = visibleTransactions.slice(0, 5);

      res.json({ totalBalance, totalIncome, totalExpenses, recentTransactions });
    } catch (e) { next(e); }
  });

  app.get("/api/reports/summary", requireAuth, async (req, res, next) => {
    try {
      await storage.applyDueRecurringIncomes(req.user!.id);
      const period = typeof req.query.period === "string" ? req.query.period : "1month";
      const [txsData, walletsData, obligationsData, recurringIncomesData] = await Promise.all([
        storage.getTransactions(req.user!.id),
        storage.getWallets(req.user!.id),
        storage.getObligations(req.user!.id),
        storage.getRecurringIncomes(req.user!.id),
      ]);

      const { start, end } = getPeriodRange(period);
      const filteredTransactions = txsData.filter((tx) => {
        const date = new Date(tx.date * 1000);
        return date >= start && date <= end;
      }).filter((tx) => !(typeof tx.note === "string" && tx.note.startsWith("__transfer__:")));

      const incomeTransactions = filteredTransactions.filter((tx) => tx.type === "income");
      const outflowTransactions = filteredTransactions.filter((tx) => tx.type === "expense" || tx.type === "debt");
      const totalIncome = incomeTransactions.reduce((sum, tx) => sum + tx.amount, 0);
      const totalExpenses = outflowTransactions.reduce((sum, tx) => sum + tx.amount, 0);
      const netFlow = totalIncome - totalExpenses;
      const savingsRate = totalIncome > 0 ? (netFlow / totalIncome) * 100 : 0;

      const recurringConfiguredTotal = recurringIncomesData.filter((item) => item.isActive).reduce((sum, item) => sum + item.amount, 0);
      const salarySourceCount = recurringIncomesData.filter((item) => item.isActive && item.incomeType === "salary").length;

      const expensesByCategoryMap = new Map<string, { categoryName: string; total: number; count: number }>();
      for (const tx of outflowTransactions) {
        const key = String(tx.categoryId ?? "uncategorized");
        const current = expensesByCategoryMap.get(key) ?? { categoryName: tx.categoryName || "غير مصنف", total: 0, count: 0 };

        current.total += tx.amount;
        current.count += 1;
        expensesByCategoryMap.set(key, current);
      }

      const expensesByCategory = Array.from(expensesByCategoryMap.entries())
        .map(([key, value]) => ({ categoryId: key === "uncategorized" ? null : Number(key), ...value }))
        .sort((a, b) => b.total - a.total);

      const walletBreakdown = walletsData.map((wallet) => {
        const walletTransactions = filteredTransactions.filter((tx) => tx.walletId === wallet.id);
        const income = walletTransactions.filter((tx) => tx.type === "income").reduce((sum, tx) => sum + tx.amount, 0);
        const expenses = walletTransactions.filter((tx) => tx.type === "expense" || tx.type === "debt").reduce((sum, tx) => sum + tx.amount, 0);
        return {
          id: wallet.id,
          name: wallet.name,
          color: wallet.color,
          balance: wallet.balance,
          income,
          expenses,
          transactionCount: walletTransactions.length,
        };
      }).sort((a, b) => b.transactionCount - a.transactionCount);

      const timelineMap = new Map<string, { label: string; income: number; expenses: number }>();
      for (const tx of filteredTransactions) {
        const label = getBucketLabel(tx.date, period);
        const current = timelineMap.get(label) ?? { label, income: 0, expenses: 0 };
        if (tx.type === "income") {
          current.income += tx.amount;
        } else {
          current.expenses += tx.amount;
        }
        timelineMap.set(label, current);
      }

      const timeline = Array.from(timelineMap.values());
      const topExpenseCategory = expensesByCategory[0] ?? null;
      const mostUsedWallet = walletBreakdown[0] ?? null;
      const upcomingObligations = obligationsData
        .filter((obligation) => obligation.isActive)
        .slice(0, 5)
        .map((obligation) => ({
          id: obligation.id,
          title: obligation.title,
          amount: obligation.amount,
          dueDay: obligation.dueDay,
          dueMonth: obligation.dueMonth,
          dueDate: obligation.dueDate,
          frequency: obligation.frequency,
        }));

      const insights = [
        topExpenseCategory ? `أعلى بند صرف لديك خلال الفترة هو ${topExpenseCategory.categoryName} بقيمة ${topExpenseCategory.total.toFixed(2)} ر.ع` : null,
        mostUsedWallet ? `أكثر محفظة استخدامًا هي ${mostUsedWallet.name} بعدد ${mostUsedWallet.transactionCount} حركة` : null,
        salarySourceCount > 0 ? `لديك ${salarySourceCount} مصدر راتب نشط بإجمالي دوري ${recurringConfiguredTotal.toFixed(2)} ر.ع` : "يمكنك إضافة راتب شهري لتتبّع دخلك الثابت تلقائيًا",
        netFlow >= 0 ? `صافي التدفق المالي موجب بمقدار ${netFlow.toFixed(2)} ر.ع` : `هناك عجز مالي بمقدار ${Math.abs(netFlow).toFixed(2)} ر.ع`,
      ].filter(Boolean);

      res.json({
        period,
        summary: {
          totalIncome,
          totalExpenses,
          netFlow,
          savingsRate,
          transactionCount: filteredTransactions.length,
          recurringConfiguredTotal,
          salarySourceCount,
        },
        expensesByCategory,
        walletBreakdown,
        timeline,
        upcomingObligations,
        recentTransactions: filteredTransactions.slice(0, 8),
        insights,
      });
    } catch (e) { next(e); }
  });




  app.get("/api/savings-goals", requireAuth, async (req, res, next) => {
    try {
      res.json(await storage.getSavingsGoals(req.user!.id));
    } catch (e) { next(e); }
  });

  app.post("/api/savings-goals", requireAuth, async (req, res, next) => {
    try {
      const data = insertSavingsGoalSchema.parse({
        ...req.body,
        walletId: toRequiredNumber(req.body.walletId),
        targetAmount: toRequiredNumber(req.body.targetAmount),
        monthlyAmount: toRequiredNumber(req.body.monthlyAmount),
        years: toRequiredNumber(req.body.years),
      });
      const goal = await runQueuedWrite(
        res,
        buildWriteQueueKey("user", req.user!.id, "savings-goals"),
        () => storage.createSavingsGoal(req.user!.id, data),
      );
      res.status(201).json(goal);
    } catch (e) { next(e); }
  });

  app.delete("/api/savings-goals/:id", requireAuth, async (req, res, next) => {
    try {
      await runQueuedWrite(
        res,
        buildWriteQueueKey("user", req.user!.id, "savings-goals"),
        () => storage.deleteSavingsGoal(parseRouteId(req.params.id), req.user!.id),
      );
      res.json({ message: "تم حذف الهدف الادخاري بنجاح" });
    } catch (e) { next(e); }
  });
  app.get("/api/commitments/:id/steps", requireAuth, async (req, res, next) => {
    try {
      res.json(await storage.getCommitmentSteps(parseRouteId(req.params.id), req.user!.id));
    } catch (e) { next(e); }
  });

  app.post("/api/commitments/:id/steps", requireAuth, async (req, res, next) => {
    try {
      const data = insertCommitmentStepSchema.parse({
        ...req.body,
        position: req.body.position === undefined ? undefined : toRequiredNumber(req.body.position),
      });
      const commitmentId = parseRouteId(req.params.id);
      const step = await runQueuedWrite(
        res,
        buildWriteQueueKey("user", req.user!.id, "commitment", commitmentId, "steps"),
        () => storage.createCommitmentStep(commitmentId, req.user!.id, data),
      );
      res.status(201).json(step);
    } catch (e) { next(e); }
  });

  app.patch("/api/commitments/:id/steps/:stepId/toggle", requireAuth, async (req, res, next) => {
    try {
      const commitmentId = parseRouteId(req.params.id);
      const stepId = parseRouteId(req.params.stepId);
      const step = await runQueuedWrite(
        res,
        buildWriteQueueKey("user", req.user!.id, "commitment", commitmentId, "step", stepId),
        () => storage.toggleCommitmentStep(commitmentId, stepId, req.user!.id),
      );
      res.json(step);
    } catch (e) { next(e); }
  });

  app.delete("/api/commitments/:id/steps/:stepId", requireAuth, async (req, res, next) => {
    try {
      const commitmentId = parseRouteId(req.params.id);
      const stepId = parseRouteId(req.params.stepId);
      await runQueuedWrite(
        res,
        buildWriteQueueKey("user", req.user!.id, "commitment", commitmentId, "steps"),
        () => storage.deleteCommitmentStep(commitmentId, stepId, req.user!.id),
      );
      res.json({ message: "تم حذف الخطوة" });
    } catch (e) { next(e); }
  });

  app.get("/api/commitments/:id/proofs", requireAuth, async (req, res, next) => {
    try {
      res.json(await storage.getCommitmentProofs(parseRouteId(req.params.id), req.user!.id));
    } catch (e) { next(e); }
  });

  app.post("/api/commitments/:id/proofs", requireAuth, async (req, res, next) => {
    try {
      const data = insertCommitmentProofSchema.parse(req.body);
      const commitmentId = parseRouteId(req.params.id);
      const proof = await runQueuedWrite(
        res,
        buildWriteQueueKey("user", req.user!.id, "commitment", commitmentId, "proofs"),
        () => storage.createCommitmentProof(commitmentId, req.user!.id, data),
      );
      res.status(201).json(proof);
    } catch (e) { next(e); }
  });

  app.delete("/api/commitments/:id/proofs/:proofId", requireAuth, async (req, res, next) => {
    try {
      const commitmentId = parseRouteId(req.params.id);
      const proofId = parseRouteId(req.params.proofId);
      await runQueuedWrite(
        res,
        buildWriteQueueKey("user", req.user!.id, "commitment", commitmentId, "proofs"),
        () => storage.deleteCommitmentProof(commitmentId, proofId, req.user!.id),
      );
      res.json({ message: "تم حذف الإثبات" });
    } catch (e) { next(e); }
  });
  app.get("/api/commitments", requireAuth, async (req, res, next) => {
    try {
      res.json(await storage.getCommitments(req.user!.id));
    } catch (e) { next(e); }
  });

  app.get("/api/commitments/:id", requireAuth, async (req, res, next) => {
    try {
      const commitment = await storage.getCommitmentById(parseRouteId(req.params.id), req.user!.id);
      if (!commitment) {
        return res.status(404).json({ message: "الالتزام غير موجود" });
      }
      res.json(commitment);
    } catch (e) { next(e); }
  });

  app.post("/api/commitments", requireAuth, async (req, res, next) => {
    try {
      const data = insertCommitmentSchema.parse({
        ...req.body,
        dueDate: toOptionalNumber(req.body.dueDate),
        amount: toOptionalNumber(req.body.amount),
      });
      const commitment = await runQueuedWrite(
        res,
        buildWriteQueueKey("user", req.user!.id, "commitments"),
        () => storage.createCommitment(req.user!.id, data),
      );
      res.status(201).json(commitment);
    } catch (e) { next(e); }
  });

  app.patch("/api/commitments/:id", requireAuth, async (req, res, next) => {
    try {
      const data = commitmentPatchSchema.parse({
        ...req.body,
        dueDate: req.body.dueDate === undefined ? undefined : toOptionalNumber(req.body.dueDate),
        amount: req.body.amount === undefined ? undefined : toOptionalNumber(req.body.amount),
      });
      const commitment = await runQueuedWrite(
        res,
        buildWriteQueueKey("user", req.user!.id, "commitment", parseRouteId(req.params.id)),
        () => storage.updateCommitment(parseRouteId(req.params.id), req.user!.id, data),
      );
      res.json(commitment);
    } catch (e) { next(e); }
  });

  app.patch("/api/commitments/:id/status", requireAuth, async (req, res, next) => {
    try {
      const status = z.enum(["active", "completed", "postponed", "archived"]).parse(req.body.status);
      const commitment = await runQueuedWrite(
        res,
        buildWriteQueueKey("user", req.user!.id, "commitment", parseRouteId(req.params.id), "status"),
        () => storage.updateCommitmentStatus(parseRouteId(req.params.id), req.user!.id, status),
      );
      res.json(commitment);
    } catch (e) { next(e); }
  });

  app.delete("/api/commitments/:id", requireAuth, async (req, res, next) => {
    try {
      await runQueuedWrite(
        res,
        buildWriteQueueKey("user", req.user!.id, "commitments"),
        () => storage.deleteCommitment(parseRouteId(req.params.id), req.user!.id),
      );
      res.json({ message: "تم حذف الالتزام بنجاح" });
    } catch (e) { next(e); }
  });
  app.get("/api/obligations", requireAuth, async (req, res, next) => {
    try {
      const obligations = await storage.getObligations(req.user!.id);
      res.json(obligations);
    } catch (e) { next(e); }
  });

  app.get("/api/obligations/:id", requireAuth, async (req, res, next) => {
    try {
      const obligation = await storage.getObligationById(parseRouteId(req.params.id), req.user!.id);
      if (!obligation) {
        return res.status(404).json({ message: "الالتزام غير موجود" });
      }
      res.json(obligation);
    } catch (e) { next(e); }
  });

  app.get("/api/obligations/:id/variable-statuses", requireAuth, async (req, res, next) => {
    try {
      const statuses = await storage.getVariableObligationMonthStatuses(parseRouteId(req.params.id), req.user!.id);
      res.json(statuses);
    } catch (e) { next(e); }
  });

  app.patch("/api/obligations/:id/variable-statuses", requireAuth, async (req, res, next) => {
    try {
      const obligationId = parseRouteId(req.params.id);
      const body = {
        ...req.body,
        paidAt: req.body.paidAt === undefined
          ? undefined
          : req.body.paidAt === null
            ? null
            : typeof req.body.paidAt === "string"
              ? parseInt(req.body.paidAt)
              : req.body.paidAt,
        note: req.body.note === undefined ? undefined : req.body.note,
      };
      const data = insertVariableObligationMonthStatusSchema.parse(body);
      const status = await runQueuedWrite(
        res,
        buildWriteQueueKey("user", req.user!.id, "obligation", obligationId, "variable-statuses"),
        () => storage.upsertVariableObligationMonthStatus(obligationId, req.user!.id, data),
      );
      res.json(status);
    } catch (e) { next(e); }
  });

  app.post("/api/obligations/:id/apply-variable-payment", requireAuth, async (req, res, next) => {
    try {
      const obligationId = parseRouteId(req.params.id);
      const body = {
        amount: typeof req.body.amount === "string" ? parseFloat(req.body.amount) : req.body.amount,
      };
      const data = applyVariableObligationPaymentSchema.parse(body);
      const result = await runQueuedWrite(
        res,
        buildWriteQueueKey("user", req.user!.id, "obligation", obligationId, "variable-payment"),
        () => storage.applyVariableObligationPayment(obligationId, req.user!.id, data.amount),
      );
      res.json(result);
    } catch (e) { next(e); }
  });

  app.post("/api/obligations", requireAuth, async (req, res, next) => {
    try {
      const body = {
        ...req.body,
        amount: toRequiredNumber(req.body.amount),
        dueDay: toOptionalNumber(req.body.dueDay),
        dueMonth: toOptionalNumber(req.body.dueMonth),
        dueDate: toOptionalNumber(req.body.dueDate),
        scheduleType: req.body.scheduleType === null || req.body.scheduleType === undefined
          ? undefined
          : req.body.scheduleType,
        startDate: req.body.startDate === null || req.body.startDate === undefined
          ? undefined
          : toRequiredNumber(req.body.startDate),
        endDate: req.body.endDate === null || req.body.endDate === undefined
          ? null
          : toOptionalNumber(req.body.endDate),
        walletId: req.body.walletId === null || req.body.walletId === undefined
          ? null
          : toOptionalNumber(req.body.walletId),
        categoryId: req.body.categoryId === null || req.body.categoryId === undefined
          ? null
          : toOptionalNumber(req.body.categoryId),
      };
      const data = insertObligationSchema.parse(body);
      const obligation = await runQueuedWrite(
        res,
        buildWriteQueueKey("user", req.user!.id, "obligations"),
        () => storage.createObligation(req.user!.id, data),
      );
      res.status(201).json(obligation);
    } catch (e) { next(e); }
  });

  app.patch("/api/obligations/:id", requireAuth, async (req, res, next) => {
    try {
      const obligationId = parseRouteId(req.params.id);
      const body = {
        ...req.body,
        amount: req.body.amount === undefined || req.body.amount === null
          ? undefined
          : toRequiredNumber(req.body.amount),
        dueDay: req.body.dueDay === undefined
          ? undefined
          : req.body.dueDay === null
            ? null
            : toRequiredNumber(req.body.dueDay),
        dueMonth: req.body.dueMonth === undefined
          ? undefined
          : req.body.dueMonth === null
            ? null
            : toRequiredNumber(req.body.dueMonth),
        dueDate: req.body.dueDate === undefined
          ? undefined
          : req.body.dueDate === null
            ? null
            : toRequiredNumber(req.body.dueDate),
        scheduleType: req.body.scheduleType === undefined
          ? undefined
          : req.body.scheduleType,
        startDate: req.body.startDate === undefined
          ? undefined
          : req.body.startDate === null
            ? null
            : toRequiredNumber(req.body.startDate),
        endDate: req.body.endDate === undefined
          ? undefined
          : req.body.endDate === null
            ? null
            : toRequiredNumber(req.body.endDate),
        walletId: req.body.walletId === undefined
          ? undefined
          : req.body.walletId === null
            ? null
            : toRequiredNumber(req.body.walletId),
        categoryId: req.body.categoryId === undefined
          ? undefined
          : req.body.categoryId === null
            ? null
            : toRequiredNumber(req.body.categoryId),
      };
      const data = obligationPatchSchema.parse(body);
      const obligation = await runQueuedWrite(
        res,
        buildWriteQueueKey("user", req.user!.id, "obligation", obligationId),
        () => storage.updateObligation(obligationId, req.user!.id, data),
      );
      res.json(obligation);
    } catch (e) { next(e); }
  });

  app.delete("/api/obligations/:id", requireAuth, async (req, res, next) => {
    try {
      const obligationId = parseRouteId(req.params.id);
      await runQueuedWrite(
        res,
        buildWriteQueueKey("user", req.user!.id, "obligation", obligationId),
        () => storage.deleteObligation(obligationId, req.user!.id),
      );
      res.json({ message: "تم حذف الالتزام بنجاح" });
    } catch (e) { next(e); }
  });

  app.patch("/api/obligations/:id/toggle", requireAuth, async (req, res, next) => {
    try {
      const obligationId = parseRouteId(req.params.id);
      const obligation = await runQueuedWrite(
        res,
        buildWriteQueueKey("user", req.user!.id, "obligation", obligationId),
        () => storage.toggleObligation(obligationId, req.user!.id),
      );
      res.json(obligation);
    } catch (e) { next(e); }
  });

  return httpServer;
}




