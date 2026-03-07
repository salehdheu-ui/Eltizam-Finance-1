import { eq, and, desc } from "drizzle-orm";
import { db } from "./db";
import {
  users, wallets, categories, transactions, obligations,
  type User, type InsertUser,
  type Wallet, type InsertWallet,
  type Category, type InsertCategory,
  type Transaction, type InsertTransaction,
  type Obligation, type InsertObligation,
} from "@shared/schema";

export interface IStorage {
  getUser(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  updateUser(id: number, data: Partial<User>): Promise<User>;

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

  getTransactions(userId: number): Promise<(Transaction & { categoryName?: string; categoryIcon?: string; walletName?: string })[]>;
  getTransactionsByType(userId: number, type: string): Promise<Transaction[]>;
  createTransaction(userId: number, transaction: InsertTransaction): Promise<Transaction>;
  deleteTransaction(id: number, userId: number): Promise<void>;

  getObligations(userId: number): Promise<Obligation[]>;
  getObligationById(id: number, userId: number): Promise<Obligation | undefined>;
  createObligation(userId: number, obligation: InsertObligation): Promise<Obligation>;
  updateObligation(id: number, userId: number, data: Partial<InsertObligation>): Promise<Obligation>;
  deleteObligation(id: number, userId: number): Promise<void>;
  toggleObligation(id: number, userId: number): Promise<Obligation>;
}

export class DatabaseStorage implements IStorage {
  async getUser(id: number): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
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

  async getTransactions(userId: number): Promise<(Transaction & { categoryName?: string; categoryIcon?: string; walletName?: string })[]> {
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

  async getObligations(userId: number): Promise<Obligation[]> {
    return db
      .select()
      .from(obligations)
      .where(eq(obligations.userId, userId))
      .orderBy(desc(obligations.createdAt));
  }

  async getObligationById(id: number, userId: number): Promise<Obligation | undefined> {
    const [obligation] = await db
      .select()
      .from(obligations)
      .where(and(eq(obligations.id, id), eq(obligations.userId, userId)));
    return obligation;
  }

  async createObligation(userId: number, obligation: InsertObligation): Promise<Obligation> {
    const [created] = await db
      .insert(obligations)
      .values({ ...obligation, userId })
      .returning();
    return created;
  }

  async updateObligation(id: number, userId: number, data: Partial<InsertObligation>): Promise<Obligation> {
    const [updated] = await db
      .update(obligations)
      .set({ ...data, updatedAt: Math.floor(Date.now() / 1000) })
      .where(and(eq(obligations.id, id), eq(obligations.userId, userId)))
      .returning();
    return updated;
  }

  async deleteObligation(id: number, userId: number): Promise<void> {
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
}

export const storage = new DatabaseStorage();
