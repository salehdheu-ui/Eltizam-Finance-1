import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { hashPlainPassword, setupAuth } from "./auth";
import { writeAuditEvent } from "./audit";
import { createManualBackup, listAllBackups } from "./backup";
import { insertWalletSchema, insertCategorySchema, insertTransactionSchema, insertRecurringIncomeSchema, insertObligationSchema, insertVariableObligationMonthStatusSchema } from "@shared/schema";
import { buildWriteQueueKey, enqueueWrite } from "./write-queue";
import { z } from "zod";

function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ message: "ØºÙŠØ± Ù…Ø³Ø¬Ù„ Ø§Ù„Ø¯Ø®ÙˆÙ„" });
  }
  next();
}

function requireSystemAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ message: "ØºÙŠØ± Ù…Ø³Ø¬Ù„ Ø§Ù„Ø¯Ø®ÙˆÙ„" });
  }

  if (req.user?.role !== "system_admin") {
    return res.status(404).json({ message: "ØºÙŠØ± Ù…ÙˆØ¬ÙˆØ¯" });
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
  amount: z.number().positive("Ø§Ù„Ù…Ø¨Ù„Øº ÙŠØ¬Ø¨ Ø£Ù† ÙŠÙƒÙˆÙ† Ø£ÙƒØ¨Ø± Ù…Ù† ØµÙØ±"),
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
  categoryId: z.union([z.number(), z.string()]).nullable().optional(),
  type: z.enum(["income", "expense", "debt"]),
  amount: z.union([z.number(), z.string()]),
  note: z.string().optional(),
});

const recurringIncomePatchSchema = insertRecurringIncomeSchema.partial();

const obligationPatchSchema = insertObligationSchema.partial();

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
        return res.status(400).json({ message: "Ù„Ø§ ÙŠÙ…ÙƒÙ†Ùƒ ØªØ¹Ø¯ÙŠÙ„ Ø­Ø³Ø§Ø¨Ùƒ Ø§Ù„Ø¥Ø¯Ø§Ø±ÙŠ Ù…Ù† Ù‡Ø°Ù‡ Ø§Ù„ØµÙØ­Ø©" });
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
        return res.status(400).json({ message: "Ù„Ø§ ÙŠÙ…ÙƒÙ†Ùƒ Ø­Ø°Ù Ø­Ø³Ø§Ø¨Ùƒ Ø§Ù„Ø¥Ø¯Ø§Ø±ÙŠ Ø§Ù„Ø­Ø§Ù„ÙŠ" });
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
      res.json({ message: "ØªÙ… Ø­Ø°Ù Ø§Ù„Ù…Ø³ØªØ®Ø¯Ù… Ø¨Ù†Ø¬Ø§Ø­" });
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
      res.json({ message: "ØªÙ… Ø§Ù„Ø­Ø°Ù Ø¨Ù†Ø¬Ø§Ø­" });
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
      res.json({ message: "ØªÙ… Ø§Ù„Ø­Ø°Ù Ø¨Ù†Ø¬Ø§Ø­" });
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
      res.json({ message: "ØªÙ… Ø­Ø°Ù Ø§Ù„Ø¯Ø®Ù„ Ø§Ù„Ù…ØªÙƒØ±Ø± Ø¨Ù†Ø¬Ø§Ø­" });
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
      };
      const data = insertTransactionSchema.parse(body);
      const tx = await runQueuedWrite(
        res,
        buildWriteQueueKey("user", req.user!.id, "wallet", data.walletId, "transactions"),
        () => storage.createTransaction(req.user!.id, data),
      );
      res.status(201).json(tx);
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
      res.json({ message: "ØªÙ… Ø§Ù„Ø­Ø°Ù Ø¨Ù†Ø¬Ø§Ø­" });
    } catch (e) { next(e); }
  });

  app.get("/api/dashboard", requireAuth, async (req, res, next) => {
    try {
      await storage.applyDueRecurringIncomes(req.user!.id);
      const [walletsData, txsData] = await Promise.all([
        storage.getWallets(req.user!.id),
        storage.getTransactions(req.user!.id),
      ]);

      const totalBalance = walletsData.reduce((acc, w) => acc + w.balance, 0);
      const totalIncome = txsData.filter(t => t.type === "income").reduce((acc, t) => acc + t.amount, 0);
      const totalExpenses = txsData.filter(t => t.type === "expense" || t.type === "debt").reduce((acc, t) => acc + t.amount, 0);
      const recentTransactions = txsData.slice(0, 5);

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
      });

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
        const current = expensesByCategoryMap.get(key) ?? { categoryName: tx.categoryName || "ØºÙŠØ± Ù…ØµÙ†Ù", total: 0, count: 0 };
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
        topExpenseCategory ? `Ø£Ø¹Ù„Ù‰ Ø¨Ù†Ø¯ ØµØ±Ù Ù„Ø¯ÙŠÙƒ Ø®Ù„Ø§Ù„ Ø§Ù„ÙØªØ±Ø© Ù‡Ùˆ ${topExpenseCategory.categoryName} Ø¨Ù‚ÙŠÙ…Ø© ${topExpenseCategory.total.toFixed(2)} Ø±.Ø¹` : null,
        mostUsedWallet ? `Ø£ÙƒØ«Ø± Ù…Ø­ÙØ¸Ø© Ø§Ø³ØªØ®Ø¯Ø§Ù…Ù‹Ø§ Ù‡ÙŠ ${mostUsedWallet.name} Ø¨Ø¹Ø¯Ø¯ ${mostUsedWallet.transactionCount} Ø­Ø±ÙƒØ©` : null,
        salarySourceCount > 0 ? `Ù„Ø¯ÙŠÙƒ ${salarySourceCount} Ù…ØµØ¯Ø± Ø±Ø§ØªØ¨ Ù†Ø´Ø· Ø¨Ø¥Ø¬Ù…Ø§Ù„ÙŠ Ø¯ÙˆØ±ÙŠ ${recurringConfiguredTotal.toFixed(2)} Ø±.Ø¹` : "ÙŠÙ…ÙƒÙ†Ùƒ Ø¥Ø¶Ø§ÙØ© Ø±Ø§ØªØ¨ Ø´Ù‡Ø±ÙŠ Ù„ØªØªØ¨Ù‘Ø¹ Ø¯Ø®Ù„Ùƒ Ø§Ù„Ø«Ø§Ø¨Øª ØªÙ„Ù‚Ø§Ø¦ÙŠÙ‹Ø§",
        netFlow >= 0 ? `ØµØ§ÙÙŠ Ø§Ù„ØªØ¯ÙÙ‚ Ø§Ù„Ù…Ø§Ù„ÙŠ Ù…ÙˆØ¬Ø¨ Ø¨Ù…Ù‚Ø¯Ø§Ø± ${netFlow.toFixed(2)} Ø±.Ø¹` : `Ù‡Ù†Ø§Ùƒ Ø¹Ø¬Ø² Ù…Ø§Ù„ÙŠ Ø¨Ù…Ù‚Ø¯Ø§Ø± ${Math.abs(netFlow).toFixed(2)} Ø±.Ø¹`,
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
        return res.status(404).json({ message: "Ø§Ù„Ø§Ù„ØªØ²Ø§Ù… ØºÙŠØ± Ù…ÙˆØ¬ÙˆØ¯" });
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
      res.json({ message: "ØªÙ… Ø­Ø°Ù Ø§Ù„Ø§Ù„ØªØ²Ø§Ù… Ø¨Ù†Ø¬Ø§Ø­" });
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




