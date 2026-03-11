import { eq, and, desc } from "drizzle-orm";
import { db } from "./db";
import {
  users, wallets, categories, transactions, recurringIncomes, obligations, variableObligationMonthStatuses,
  type User, type InsertUser,
  type Wallet, type InsertWallet,
  type Category, type InsertCategory,
  type Transaction, type InsertTransaction,
  type RecurringIncome, type InsertRecurringIncome,
  type Obligation, type InsertObligation,
  type VariableObligationMonthStatus, type InsertVariableObligationMonthStatus,
} from "@shared/schema";

function isObligationEnded(obligation: Pick<Obligation, "endDate">) {
  return !!obligation.endDate && obligation.endDate <= Math.floor(Date.now() / 1000);
}

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addMonths(date: Date, months: number) {
  return new Date(date.getFullYear(), date.getMonth() + months, 1);
}

function formatMonthKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function getClampedMonthlyDay(dayOfMonth: number, date: Date) {
  const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  return Math.min(dayOfMonth, lastDay);
}

export interface IStorage {
  getUser(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  getUserByPhone(phone: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  updateUser(id: number, data: Partial<User>): Promise<User>;
  getAllUsers(): Promise<User[]>;
  getUserStats(): Promise<{
    totalUsers: number;
    activeUsers: number;
    inactiveUsers: number;
    newUsersThisMonth: number;
    usersLoggedInToday: number;
  }>;
  deleteUser(id: number): Promise<void>;

  getWallets(userId: number): Promise<Wallet[]>;
  getWallet(id: number, userId: number): Promise<Wallet | undefined>;
  createWallet(userId: number, wallet: InsertWallet): Promise<Wallet>;
  updateWallet(id: number, userId: number, data: Partial<InsertWallet>): Promise<Wallet>;
  deleteWallet(id: number, userId: number): Promise<void>;

  getCategories(userId: number): Promise<Category[]>;
  getCategoriesByType(userId: number, type: string): Promise<Category[]>;
  createCategory(userId: number, category: InsertCategory): Promise<Category>;
  updateCategory(id: number, userId: number, data: Partial<InsertCategory>): Promise<Category>;
  deleteCategory(id: number, userId: number): Promise<void>;

  getTransactions(userId: number): Promise<(Transaction & { categoryName?: string | null; categoryIcon?: string | null; walletName?: string | null })[]>;
  getTransactionsByType(userId: number, type: string): Promise<Transaction[]>;
  createTransaction(userId: number, transaction: InsertTransaction): Promise<Transaction>;
  deleteTransaction(id: number, userId: number): Promise<void>;

  getRecurringIncomes(userId: number): Promise<RecurringIncome[]>;
  createRecurringIncome(userId: number, income: InsertRecurringIncome): Promise<RecurringIncome>;
  updateRecurringIncome(id: number, userId: number, data: Partial<InsertRecurringIncome>): Promise<RecurringIncome>;
  deleteRecurringIncome(id: number, userId: number): Promise<void>;
  applyDueRecurringIncomes(userId: number): Promise<RecurringIncome[]>;

  getObligations(userId: number): Promise<Obligation[]>;
  getObligationById(id: number, userId: number): Promise<Obligation | undefined>;
  createObligation(userId: number, obligation: InsertObligation): Promise<Obligation>;
  updateObligation(id: number, userId: number, data: Partial<InsertObligation>): Promise<Obligation>;
  deleteObligation(id: number, userId: number): Promise<void>;
  toggleObligation(id: number, userId: number): Promise<Obligation>;
  getVariableObligationMonthStatuses(obligationId: number, userId: number): Promise<VariableObligationMonthStatus[]>;
  upsertVariableObligationMonthStatus(obligationId: number, userId: number, data: InsertVariableObligationMonthStatus): Promise<VariableObligationMonthStatus>;
  applyVariableObligationPayment(obligationId: number, userId: number, amount: number): Promise<{ allocatedMonths: number; monthKeys: string[] }>;
}

export class DatabaseStorage implements IStorage {
  private async normalizeObligationStatus(obligation: Obligation | undefined, userId: number): Promise<Obligation | undefined> {
    if (!obligation) {
      return obligation;
    }

    if (obligation.isActive && isObligationEnded(obligation)) {
      return this.updateObligation(obligation.id, userId, { isActive: false });
    }

    return obligation;
  }

  async getUser(id: number): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user;
  }

  async getUserByPhone(phone: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.phone, phone));
    return user;
  }

  async createUser(user: InsertUser): Promise<User> {
    const [created] = await db.insert(users).values(user).returning();
    return created;
  }

  async updateUser(id: number, data: Partial<User>): Promise<User> {
    const [updated] = await db.update(users).set(data).where(eq(users.id, id)).returning();
    return updated;
  }

  async getAllUsers(): Promise<User[]> {
    return db.select().from(users).orderBy(desc(users.createdAt));
  }

  async getUserStats(): Promise<{
    totalUsers: number;
    activeUsers: number;
    inactiveUsers: number;
    newUsersThisMonth: number;
    usersLoggedInToday: number;
  }> {
    const allUsers = await this.getAllUsers();
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime() / 1000;
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() / 1000;

    return {
      totalUsers: allUsers.length,
      activeUsers: allUsers.filter((user) => user.isActive).length,
      inactiveUsers: allUsers.filter((user) => !user.isActive).length,
      newUsersThisMonth: allUsers.filter((user) => user.createdAt >= startOfMonth).length,
      usersLoggedInToday: allUsers.filter((user) => user.lastLoginAt && user.lastLoginAt >= startOfDay).length,
    };
  }

  async deleteUser(id: number): Promise<void> {
    await db.delete(transactions).where(eq(transactions.userId, id));
    await db.delete(recurringIncomes).where(eq(recurringIncomes.userId, id));
    await db.delete(variableObligationMonthStatuses).where(eq(variableObligationMonthStatuses.userId, id));
    await db.delete(obligations).where(eq(obligations.userId, id));
    await db.delete(categories).where(eq(categories.userId, id));
    await db.delete(wallets).where(eq(wallets.userId, id));
    await db.delete(users).where(eq(users.id, id));
  }

  async getWallets(userId: number): Promise<Wallet[]> {
    return db.select().from(wallets).where(eq(wallets.userId, userId));
  }

  async getWallet(id: number, userId: number): Promise<Wallet | undefined> {
    const [wallet] = await db.select().from(wallets).where(and(eq(wallets.id, id), eq(wallets.userId, userId)));
    return wallet;
  }

  async createWallet(userId: number, wallet: InsertWallet): Promise<Wallet> {
    const [created] = await db.insert(wallets).values({ ...wallet, userId }).returning();
    return created;
  }

  async updateWallet(id: number, userId: number, data: Partial<InsertWallet>): Promise<Wallet> {
    const [updated] = await db.update(wallets).set(data).where(and(eq(wallets.id, id), eq(wallets.userId, userId))).returning();
    return updated;
  }

  async deleteWallet(id: number, userId: number): Promise<void> {
    await db.delete(wallets).where(and(eq(wallets.id, id), eq(wallets.userId, userId)));
  }

  async getCategories(userId: number): Promise<Category[]> {
    return db.select().from(categories).where(eq(categories.userId, userId));
  }

  async getCategoriesByType(userId: number, type: string): Promise<Category[]> {
    return db.select().from(categories).where(and(eq(categories.userId, userId), eq(categories.type, type)));
  }

  async createCategory(userId: number, category: InsertCategory): Promise<Category> {
    const [created] = await db.insert(categories).values({ ...category, userId }).returning();
    return created;
  }

  async updateCategory(id: number, userId: number, data: Partial<InsertCategory>): Promise<Category> {
    const [updated] = await db.update(categories).set(data).where(and(eq(categories.id, id), eq(categories.userId, userId))).returning();
    return updated;
  }

  async deleteCategory(id: number, userId: number): Promise<void> {
    await db.delete(categories).where(and(eq(categories.id, id), eq(categories.userId, userId)));
  }

  async getTransactions(userId: number): Promise<(Transaction & { categoryName?: string | null; categoryIcon?: string | null; walletName?: string | null })[]> {
    const result = await db
      .select({
        id: transactions.id,
        userId: transactions.userId,
        walletId: transactions.walletId,
        categoryId: transactions.categoryId,
        type: transactions.type,
        amount: transactions.amount,
        note: transactions.note,
        date: transactions.date,
        categoryName: categories.name,
        categoryIcon: categories.icon,
        walletName: wallets.name,
      })
      .from(transactions)
      .leftJoin(categories, eq(transactions.categoryId, categories.id))
      .leftJoin(wallets, eq(transactions.walletId, wallets.id))
      .where(eq(transactions.userId, userId))
      .orderBy(desc(transactions.date));
    return result;
  }

  async getTransactionsByType(userId: number, type: string): Promise<Transaction[]> {
    return db.select().from(transactions).where(and(eq(transactions.userId, userId), eq(transactions.type, type))).orderBy(desc(transactions.date));
  }

  async createTransaction(userId: number, transaction: InsertTransaction): Promise<Transaction> {
    const [created] = await db.insert(transactions).values({ ...transaction, userId }).returning();

    if (transaction.walletId) {
      const wallet = await this.getWallet(transaction.walletId, userId);
      if (wallet) {
        const delta = transaction.type === "income" ? transaction.amount : -transaction.amount;
        await this.updateWallet(wallet.id, userId, { balance: wallet.balance + delta });
      }
    }

    return created;
  }

  async deleteTransaction(id: number, userId: number): Promise<void> {
    const [tx] = await db.select().from(transactions).where(and(eq(transactions.id, id), eq(transactions.userId, userId)));
    if (tx && tx.walletId) {
      const wallet = await this.getWallet(tx.walletId, userId);
      if (wallet) {
        const delta = tx.type === "income" ? -tx.amount : tx.amount;
        await this.updateWallet(wallet.id, userId, { balance: wallet.balance + delta });
      }
    }
    await db.delete(transactions).where(and(eq(transactions.id, id), eq(transactions.userId, userId)));
  }

  async getRecurringIncomes(userId: number): Promise<RecurringIncome[]> {
    return db.select().from(recurringIncomes).where(eq(recurringIncomes.userId, userId)).orderBy(desc(recurringIncomes.createdAt));
  }

  async createRecurringIncome(userId: number, income: InsertRecurringIncome): Promise<RecurringIncome> {
    const now = Math.floor(Date.now() / 1000);
    const [created] = await db.insert(recurringIncomes).values({
      ...income,
      userId,
      note: income.note ?? "",
      categoryId: income.categoryId ?? null,
      isActive: income.isActive ?? true,
      lastAppliedMonth: income.lastAppliedMonth ?? null,
      createdAt: now,
      updatedAt: now,
    }).returning();
    return created;
  }

  async updateRecurringIncome(id: number, userId: number, data: Partial<InsertRecurringIncome>): Promise<RecurringIncome> {
    const [updated] = await db.update(recurringIncomes).set({
      ...data,
      updatedAt: Math.floor(Date.now() / 1000),
    }).where(and(eq(recurringIncomes.id, id), eq(recurringIncomes.userId, userId))).returning();
    return updated;
  }

  async deleteRecurringIncome(id: number, userId: number): Promise<void> {
    await db.delete(recurringIncomes).where(and(eq(recurringIncomes.id, id), eq(recurringIncomes.userId, userId)));
  }

  async applyDueRecurringIncomes(userId: number): Promise<RecurringIncome[]> {
    const activeIncomes = await db.select().from(recurringIncomes).where(and(eq(recurringIncomes.userId, userId), eq(recurringIncomes.isActive, true)));
    const now = new Date();
    const currentMonthKey = formatMonthKey(now);
    const applied: RecurringIncome[] = [];

    for (const income of activeIncomes) {
      if (income.lastAppliedMonth === currentMonthKey) {
        continue;
      }

      const dueDay = getClampedMonthlyDay(income.dayOfMonth, now);
      if (now.getDate() < dueDay) {
        continue;
      }

      await this.createTransaction(userId, {
        type: "income",
        amount: income.amount,
        note: income.note?.trim() ? income.note : `${income.incomeType === "salary" ? "راتب شهري" : "دخل متكرر"} - ${income.title}`,
        categoryId: income.categoryId ?? null,
        walletId: income.walletId,
      });

      const [updated] = await db.update(recurringIncomes).set({
        lastAppliedMonth: currentMonthKey,
        updatedAt: Math.floor(Date.now() / 1000),
      }).where(and(eq(recurringIncomes.id, income.id), eq(recurringIncomes.userId, userId))).returning();

      applied.push(updated);
    }

    return applied;
  }

  async getObligations(userId: number): Promise<Obligation[]> {
    const result = await db
      .select()
      .from(obligations)
      .where(eq(obligations.userId, userId))
      .orderBy(desc(obligations.createdAt));

    return Promise.all(result.map((obligation) => this.normalizeObligationStatus(obligation, userId))) as Promise<Obligation[]>;
  }

  async getObligationById(id: number, userId: number): Promise<Obligation | undefined> {
    const [obligation] = await db
      .select()
      .from(obligations)
      .where(and(eq(obligations.id, id), eq(obligations.userId, userId)));
    return this.normalizeObligationStatus(obligation, userId);
  }

  async createObligation(userId: number, obligation: InsertObligation): Promise<Obligation> {
    const [created] = await db
      .insert(obligations)
      .values({ ...obligation, userId })
      .returning();
    return (await this.normalizeObligationStatus(created, userId))!;
  }

  async updateObligation(id: number, userId: number, data: Partial<InsertObligation>): Promise<Obligation> {
    const nextIsActive = data.isActive === true && data.endDate !== undefined && data.endDate !== null && data.endDate <= Math.floor(Date.now() / 1000)
      ? false
      : data.isActive;
    const [updated] = await db
      .update(obligations)
      .set({ ...data, isActive: nextIsActive, updatedAt: Math.floor(Date.now() / 1000) })
      .where(and(eq(obligations.id, id), eq(obligations.userId, userId)))
      .returning();
    return (await this.normalizeObligationStatus(updated, userId))!;
  }

  async deleteObligation(id: number, userId: number): Promise<void> {
    await db
      .delete(variableObligationMonthStatuses)
      .where(and(eq(variableObligationMonthStatuses.obligationId, id), eq(variableObligationMonthStatuses.userId, userId)));
    await db
      .delete(obligations)
      .where(and(eq(obligations.id, id), eq(obligations.userId, userId)));
  }

  async toggleObligation(id: number, userId: number): Promise<Obligation> {
    const obligation = await this.getObligationById(id, userId);
    if (!obligation) {
      throw new Error("الالتزام غير موجود");
    }
    return this.updateObligation(id, userId, { isActive: !obligation.isActive });
  }

  async getVariableObligationMonthStatuses(obligationId: number, userId: number): Promise<VariableObligationMonthStatus[]> {
    const obligation = await this.getObligationById(obligationId, userId);
    if (!obligation) {
      throw new Error("الالتزام غير موجود");
    }

    if (obligation.scheduleType !== "variable") {
      throw new Error("هذه الصفحة مخصصة للالتزامات المتغيرة فقط");
    }

    return db
      .select()
      .from(variableObligationMonthStatuses)
      .where(and(eq(variableObligationMonthStatuses.obligationId, obligationId), eq(variableObligationMonthStatuses.userId, userId)))
      .orderBy(desc(variableObligationMonthStatuses.monthKey));
  }

  async upsertVariableObligationMonthStatus(obligationId: number, userId: number, data: InsertVariableObligationMonthStatus): Promise<VariableObligationMonthStatus> {
    const obligation = await this.getObligationById(obligationId, userId);
    if (!obligation) {
      throw new Error("الالتزام غير موجود");
    }

    if (obligation.scheduleType !== "variable") {
      throw new Error("يمكن تحديث حالات الأشهر للالتزام المتغير فقط");
    }

    const [existing] = await db
      .select()
      .from(variableObligationMonthStatuses)
      .where(
        and(
          eq(variableObligationMonthStatuses.obligationId, obligationId),
          eq(variableObligationMonthStatuses.userId, userId),
          eq(variableObligationMonthStatuses.monthKey, data.monthKey),
        ),
      );

    const now = Math.floor(Date.now() / 1000);
    const normalizedNote = data.note ?? "";
    const normalizedPaidAt = data.status === "paid" ? (data.paidAt ?? now) : null;

    if (existing) {
      const [updated] = await db
        .update(variableObligationMonthStatuses)
        .set({
          status: data.status,
          paidAt: normalizedPaidAt,
          note: normalizedNote,
          updatedAt: now,
        })
        .where(eq(variableObligationMonthStatuses.id, existing.id))
        .returning();
      return updated;
    }

    const [created] = await db
      .insert(variableObligationMonthStatuses)
      .values({
        userId,
        obligationId,
        monthKey: data.monthKey,
        status: data.status,
        paidAt: normalizedPaidAt,
        note: normalizedNote,
      })
      .returning();
    return created;
  }

  async applyVariableObligationPayment(obligationId: number, userId: number, amount: number): Promise<{ allocatedMonths: number; monthKeys: string[] }> {
    const obligation = await this.getObligationById(obligationId, userId);
    if (!obligation) {
      throw new Error("الالتزام غير موجود");
    }

    if (obligation.scheduleType !== "variable") {
      throw new Error("هذا الإجراء متاح للالتزامات المتغيرة فقط");
    }

    if (amount <= 0 || obligation.amount <= 0) {
      return { allocatedMonths: 0, monthKeys: [] };
    }

    const fullMonthsToAllocate = Math.floor(amount / obligation.amount);
    if (fullMonthsToAllocate <= 0) {
      return { allocatedMonths: 0, monthKeys: [] };
    }

    const existingStatuses = await this.getVariableObligationMonthStatuses(obligationId, userId);
    const existingStatusMap = new Map(existingStatuses.map((item) => [item.monthKey, item]));

    const startDate = startOfMonth(new Date(obligation.startDate * 1000));
    const minimumEnd = addMonths(startOfMonth(new Date()), 23);
    const explicitEnd = obligation.endDate ? startOfMonth(new Date(obligation.endDate * 1000)) : minimumEnd;
    const endDate = explicitEnd > minimumEnd ? explicitEnd : minimumEnd;
    const monthKeysToMarkPaid: string[] = [];

    for (let cursor = new Date(startDate); cursor <= endDate; cursor = addMonths(cursor, 1)) {
      const monthKey = formatMonthKey(cursor);
      const existing = existingStatusMap.get(monthKey);
      if (existing?.status === "paid") {
        continue;
      }

      monthKeysToMarkPaid.push(monthKey);
      if (monthKeysToMarkPaid.length === fullMonthsToAllocate) {
        break;
      }
    }

    for (const monthKey of monthKeysToMarkPaid) {
      await this.upsertVariableObligationMonthStatus(obligationId, userId, {
        monthKey,
        status: "paid",
        paidAt: Math.floor(Date.now() / 1000),
        note: "",
      });
    }

    return {
      allocatedMonths: monthKeysToMarkPaid.length,
      monthKeys: monthKeysToMarkPaid,
    };
  }
}

export const storage = new DatabaseStorage();
