import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { setupAuth } from "./auth";
import { insertWalletSchema, insertCategorySchema, insertTransactionSchema, insertObligationSchema, insertVariableObligationMonthStatusSchema } from "@shared/schema";
import { z } from "zod";

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

const applyVariableObligationPaymentSchema = z.object({
  amount: z.number().positive("المبلغ يجب أن يكون أكبر من صفر"),
});

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

  app.patch("/api/admin/users/:id", requireSystemAdmin, async (req, res, next) => {
    try {
      const userId = parseRouteId(req.params.id);
      if (req.user!.id === userId) {
        return res.status(400).json({ message: "لا يمكنك تعديل حسابك الإداري من هذه الصفحة" });
      }

      const { isActive } = req.body;
      const updated = await storage.updateUser(userId, { isActive: Boolean(isActive) });
      res.json(toAdminUser(updated));
    } catch (e) { next(e); }
  });

  app.delete("/api/admin/users/:id", requireSystemAdmin, async (req, res, next) => {
    try {
      const userId = parseRouteId(req.params.id);
      if (req.user!.id === userId) {
        return res.status(400).json({ message: "لا يمكنك حذف حسابك الإداري الحالي" });
      }

      await storage.deleteUser(userId);
      res.json({ message: "تم حذف المستخدم بنجاح" });
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
      const wallet = await storage.createWallet(req.user!.id, data);
      res.status(201).json(wallet);
    } catch (e) { next(e); }
  });

  app.patch("/api/wallets/:id", requireAuth, async (req, res, next) => {
    try {
      const wallet = await storage.updateWallet(parseRouteId(req.params.id), req.user!.id, req.body);
      res.json(wallet);
    } catch (e) { next(e); }
  });

  app.delete("/api/wallets/:id", requireAuth, async (req, res, next) => {
    try {
      await storage.deleteWallet(parseRouteId(req.params.id), req.user!.id);
      res.json({ message: "تم الحذف بنجاح" });
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
      const cat = await storage.createCategory(req.user!.id, data);
      res.status(201).json(cat);
    } catch (e) { next(e); }
  });

  app.patch("/api/categories/:id", requireAuth, async (req, res, next) => {
    try {
      const cat = await storage.updateCategory(parseRouteId(req.params.id), req.user!.id, req.body);
      res.json(cat);
    } catch (e) { next(e); }
  });

  app.delete("/api/categories/:id", requireAuth, async (req, res, next) => {
    try {
      await storage.deleteCategory(parseRouteId(req.params.id), req.user!.id);
      res.json({ message: "تم الحذف بنجاح" });
    } catch (e) { next(e); }
  });

  app.get("/api/transactions", requireAuth, async (req, res, next) => {
    try {
      const txs = await storage.getTransactions(req.user!.id);
      res.json(txs);
    } catch (e) { next(e); }
  });

  app.post("/api/transactions", requireAuth, async (req, res, next) => {
    try {
      const body = {
        ...req.body,
        amount: typeof req.body.amount === 'string' ? parseFloat(req.body.amount) : req.body.amount,
        categoryId: req.body.categoryId === null || req.body.categoryId === undefined 
          ? null 
          : typeof req.body.categoryId === 'string' 
            ? parseInt(req.body.categoryId) 
            : req.body.categoryId,
        walletId: req.body.walletId === null || req.body.walletId === undefined 
          ? null 
          : typeof req.body.walletId === 'string' 
            ? parseInt(req.body.walletId) 
            : req.body.walletId,
      };
      const data = insertTransactionSchema.parse(body);
      const tx = await storage.createTransaction(req.user!.id, data);
      res.status(201).json(tx);
    } catch (e) { next(e); }
  });

  app.delete("/api/transactions/:id", requireAuth, async (req, res, next) => {
    try {
      await storage.deleteTransaction(parseRouteId(req.params.id), req.user!.id);
      res.json({ message: "تم الحذف بنجاح" });
    } catch (e) { next(e); }
  });

  app.get("/api/dashboard", requireAuth, async (req, res, next) => {
    try {
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
      const status = await storage.upsertVariableObligationMonthStatus(parseRouteId(req.params.id), req.user!.id, data);
      res.json(status);
    } catch (e) { next(e); }
  });

  app.post("/api/obligations/:id/apply-variable-payment", requireAuth, async (req, res, next) => {
    try {
      const body = {
        amount: typeof req.body.amount === "string" ? parseFloat(req.body.amount) : req.body.amount,
      };
      const data = applyVariableObligationPaymentSchema.parse(body);
      const result = await storage.applyVariableObligationPayment(parseRouteId(req.params.id), req.user!.id, data.amount);
      res.json(result);
    } catch (e) { next(e); }
  });

  app.post("/api/obligations", requireAuth, async (req, res, next) => {
    try {
      // Convert string numbers to actual numbers for validation
      const body = {
        ...req.body,
        amount: typeof req.body.amount === 'string' ? parseFloat(req.body.amount) : req.body.amount,
        dueDay: req.body.dueDay === null || req.body.dueDay === undefined 
          ? null 
          : typeof req.body.dueDay === 'string' 
            ? parseInt(req.body.dueDay) 
            : req.body.dueDay,
        dueMonth: req.body.dueMonth === null || req.body.dueMonth === undefined 
          ? null 
          : typeof req.body.dueMonth === 'string' 
            ? parseInt(req.body.dueMonth) 
            : req.body.dueMonth,
        dueDate: req.body.dueDate === null || req.body.dueDate === undefined 
          ? null 
          : typeof req.body.dueDate === 'string' 
            ? parseInt(req.body.dueDate) 
            : req.body.dueDate,
        scheduleType: req.body.scheduleType === null || req.body.scheduleType === undefined 
          ? undefined
          : req.body.scheduleType,
        startDate: req.body.startDate === null || req.body.startDate === undefined 
          ? undefined
          : typeof req.body.startDate === 'string' 
            ? parseInt(req.body.startDate) 
            : req.body.startDate,
        endDate: req.body.endDate === null || req.body.endDate === undefined 
          ? null 
          : typeof req.body.endDate === 'string' 
            ? parseInt(req.body.endDate) 
            : req.body.endDate,
        walletId: req.body.walletId === null || req.body.walletId === undefined 
          ? null 
          : typeof req.body.walletId === 'string' 
            ? parseInt(req.body.walletId) 
            : req.body.walletId,
        categoryId: req.body.categoryId === null || req.body.categoryId === undefined 
          ? null 
          : typeof req.body.categoryId === 'string' 
            ? parseInt(req.body.categoryId) 
            : req.body.categoryId,
      };
      const data = insertObligationSchema.parse(body);
      const obligation = await storage.createObligation(req.user!.id, data);
      res.status(201).json(obligation);
    } catch (e) { next(e); }
  });

  app.patch("/api/obligations/:id", requireAuth, async (req, res, next) => {
    try {
      const body = {
        ...req.body,
        amount: req.body.amount === undefined || req.body.amount === null
          ? undefined
          : typeof req.body.amount === 'string' ? parseFloat(req.body.amount) : req.body.amount,
        dueDay: req.body.dueDay === undefined
          ? undefined
          : req.body.dueDay === null
            ? null
            : typeof req.body.dueDay === 'string' ? parseInt(req.body.dueDay) : req.body.dueDay,
        dueMonth: req.body.dueMonth === undefined
          ? undefined
          : req.body.dueMonth === null
            ? null
            : typeof req.body.dueMonth === 'string' ? parseInt(req.body.dueMonth) : req.body.dueMonth,
        dueDate: req.body.dueDate === undefined
          ? undefined
          : req.body.dueDate === null
            ? null
            : typeof req.body.dueDate === 'string' ? parseInt(req.body.dueDate) : req.body.dueDate,
        scheduleType: req.body.scheduleType === undefined
          ? undefined
          : req.body.scheduleType,
        startDate: req.body.startDate === undefined
          ? undefined
          : req.body.startDate === null
            ? null
            : typeof req.body.startDate === 'string' ? parseInt(req.body.startDate) : req.body.startDate,
        endDate: req.body.endDate === undefined
          ? undefined
          : req.body.endDate === null
            ? null
            : typeof req.body.endDate === 'string' ? parseInt(req.body.endDate) : req.body.endDate,
        walletId: req.body.walletId === undefined
          ? undefined
          : req.body.walletId === null
            ? null
            : typeof req.body.walletId === 'string' ? parseInt(req.body.walletId) : req.body.walletId,
        categoryId: req.body.categoryId === undefined
          ? undefined
          : req.body.categoryId === null
            ? null
            : typeof req.body.categoryId === 'string' ? parseInt(req.body.categoryId) : req.body.categoryId,
      };
      const obligation = await storage.updateObligation(parseRouteId(req.params.id), req.user!.id, body);
      res.json(obligation);
    } catch (e) { next(e); }
  });

  app.delete("/api/obligations/:id", requireAuth, async (req, res, next) => {
    try {
      await storage.deleteObligation(parseRouteId(req.params.id), req.user!.id);
      res.json({ message: "تم حذف الالتزام بنجاح" });
    } catch (e) { next(e); }
  });

  app.patch("/api/obligations/:id/toggle", requireAuth, async (req, res, next) => {
    try {
      const obligation = await storage.toggleObligation(parseRouteId(req.params.id), req.user!.id);
      res.json(obligation);
    } catch (e) { next(e); }
  });

  return httpServer;
}
