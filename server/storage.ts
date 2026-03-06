import {
  type User, type InsertUser,
  type Wallet, type InsertWallet,
  type Category, type InsertCategory,
  type Transaction, type InsertTransaction,
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
}

// In-memory storage - data is lost when server restarts
class MemStorage implements IStorage {
  private users: Map<number, User>;
  private wallets: Map<number, Wallet>;
  private categories: Map<number, Category>;
  private transactions: Map<number, Transaction>;
  private userIdCounter: number;
  private walletIdCounter: number;
  private categoryIdCounter: number;
  private transactionIdCounter: number;

  constructor() {
    this.users = new Map();
    this.wallets = new Map();
    this.categories = new Map();
    this.transactions = new Map();
    this.userIdCounter = 1;
    this.walletIdCounter = 1;
    this.categoryIdCounter = 1;
    this.transactionIdCounter = 1;
  }

  async getUser(id: number): Promise<User | undefined> {
    return this.users.get(id);
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(
      (user) => user.username === username,
    );
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const id = this.userIdCounter++;
    const user: User = { ...insertUser, id };
    this.users.set(id, user);
    return user;
  }

  async updateUser(id: number, data: Partial<User>): Promise<User> {
    const user = this.users.get(id);
    if (!user) throw new Error("User not found");
    const updated = { ...user, ...data };
    this.users.set(id, updated);
    return updated;
  }

  async getWallets(userId: number): Promise<Wallet[]> {
    return Array.from(this.wallets.values()).filter(
      (wallet) => wallet.userId === userId,
    );
  }

  async getWallet(id: number, userId: number): Promise<Wallet | undefined> {
    const wallet = this.wallets.get(id);
    if (wallet && wallet.userId === userId) return wallet;
    return undefined;
  }

  async createWallet(userId: number, insertWallet: InsertWallet): Promise<Wallet> {
    const id = this.walletIdCounter++;
    const wallet: Wallet = { 
      id, 
      userId,
      name: insertWallet.name,
      type: insertWallet.type ?? "cash",
      balance: insertWallet.balance ?? 0,
      color: insertWallet.color ?? "from-slate-600 to-slate-800"
    };
    this.wallets.set(id, wallet);
    return wallet;
  }

  async updateWallet(id: number, userId: number, data: Partial<InsertWallet>): Promise<Wallet> {
    const wallet = await this.getWallet(id, userId);
    if (!wallet) throw new Error("Wallet not found");
    const updated = { ...wallet, ...data };
    this.wallets.set(id, updated);
    return updated;
  }

  async deleteWallet(id: number, userId: number): Promise<void> {
    const wallet = await this.getWallet(id, userId);
    if (!wallet) throw new Error("Wallet not found");
    this.wallets.delete(id);
  }

  async getCategories(userId: number): Promise<Category[]> {
    return Array.from(this.categories.values()).filter(
      (category) => category.userId === userId,
    );
  }

  async getCategoriesByType(userId: number, type: string): Promise<Category[]> {
    return Array.from(this.categories.values()).filter(
      (category) => category.userId === userId && category.type === type,
    );
  }

  async createCategory(userId: number, insertCategory: InsertCategory): Promise<Category> {
    const id = this.categoryIdCounter++;
    const category: Category = { 
      id, 
      userId,
      name: insertCategory.name,
      type: insertCategory.type ?? "expense",
      icon: insertCategory.icon ?? "📝",
      color: insertCategory.color ?? "bg-orange-100 text-orange-600",
      budget: insertCategory.budget ?? 0
    };
    this.categories.set(id, category);
    return category;
  }

  async updateCategory(id: number, userId: number, data: Partial<InsertCategory>): Promise<Category> {
    const category = this.categories.get(id);
    if (!category || category.userId !== userId) throw new Error("Category not found");
    const updated = { ...category, ...data };
    this.categories.set(id, updated);
    return updated;
  }

  async deleteCategory(id: number, userId: number): Promise<void> {
    const category = this.categories.get(id);
    if (!category || category.userId !== userId) throw new Error("Category not found");
    this.categories.delete(id);
  }

  async getTransactions(userId: number): Promise<(Transaction & { categoryName?: string; categoryIcon?: string; walletName?: string })[]> {
    const txs = Array.from(this.transactions.values()).filter(
      (tx) => tx.userId === userId,
    );
    
    return txs.map(tx => {
      const category = this.categories.get(tx.categoryId || 0);
      const wallet = this.wallets.get(tx.walletId || 0);
      return {
        ...tx,
        categoryName: category?.name,
        categoryIcon: category?.icon,
        walletName: wallet?.name,
      };
    });
  }

  async getTransactionsByType(userId: number, type: string): Promise<Transaction[]> {
    return Array.from(this.transactions.values()).filter(
      (tx) => tx.userId === userId && tx.type === type,
    );
  }

  async createTransaction(userId: number, insertTx: InsertTransaction): Promise<Transaction> {
    const id = this.transactionIdCounter++;
    const tx: Transaction = { 
      id, 
      userId, 
      date: new Date(),
      walletId: insertTx.walletId ?? null,
      categoryId: insertTx.categoryId ?? null,
      type: insertTx.type ?? "expense",
      amount: insertTx.amount,
      note: insertTx.note ?? ""
    };
    this.transactions.set(id, tx);

    // Update wallet balance
    if (tx.walletId) {
      const wallet = this.wallets.get(tx.walletId);
      if (wallet && wallet.userId === userId) {
        const delta = tx.type === "income" ? tx.amount : -tx.amount;
        this.wallets.set(wallet.id, { ...wallet, balance: wallet.balance + delta });
      }
    }

    return tx;
  }

  async deleteTransaction(id: number, userId: number): Promise<void> {
    const tx = this.transactions.get(id);
    if (!tx || tx.userId !== userId) throw new Error("Transaction not found");
    
    // Revert wallet balance
    if (tx.walletId) {
      const wallet = this.wallets.get(tx.walletId);
      if (wallet && wallet.userId === userId) {
        const delta = tx.type === "income" ? -tx.amount : tx.amount;
        this.wallets.set(wallet.id, { ...wallet, balance: wallet.balance + delta });
      }
    }
    
    this.transactions.delete(id);
  }
}

export const storage = new MemStorage();
