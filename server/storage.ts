import { eq, and, asc, desc, like, inArray } from "drizzle-orm";
import { db } from "./db";
import {
  users, wallets, categories, transactions, recurringIncomes, obligations, variableObligationMonthStatuses, commitments, commitmentSteps, commitmentProofs, savingsGoals, passwordResetRequests, bankEmailEvents, bankEmailConnections,
  type User, type InsertUser,
  type Wallet, type InsertWallet,
  type Category, type InsertCategory,
  type Transaction, type InsertTransaction,
  type RecurringIncome, type InsertRecurringIncome,
  type Obligation, type InsertObligation,
  type VariableObligationMonthStatus, type InsertVariableObligationMonthStatus,
  type Commitment, type InsertCommitment,
  type CommitmentStep, type InsertCommitmentStep,
  type CommitmentProof, type InsertCommitmentProof,
  type SavingsGoal, type InsertSavingsGoal,
  type PasswordResetRequest, type InsertPasswordResetRequest,
} from "@shared/schema";

/**
 * A failure the user can act on. Thrown as a bare Error these reach the handler
 * without a status, become 500s, and production replaces the message with
 * "unexpected error" — hiding the one line that says what to fix.
 */
function userError(message: string) {
  const error = new Error(message) as Error & { status: number; publicMessage: string };
  error.status = 400;
  error.publicMessage = message;
  return error;
}

/** The note that marks money the ledger cannot account for, so these movements
 *  can be found, totalled and told apart from anything the user entered. */
export const UNKNOWN_ADJUSTMENT_NOTE = "فرق غير معروف · مجهول";

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
  setWalletBalance(id: number, userId: number, newBalance: number): Promise<Wallet>;
  deleteWallet(id: number, userId: number): Promise<void>;


  getSavingsGoals(userId: number): Promise<SavingsGoal[]>;
  createSavingsGoal(userId: number, goal: InsertSavingsGoal): Promise<SavingsGoal>;
  deleteSavingsGoal(id: number, userId: number): Promise<void>;
  getCategories(userId: number): Promise<Category[]>;
  getCategoriesByType(userId: number, type: string): Promise<Category[]>;
  createCategory(userId: number, category: InsertCategory): Promise<Category>;
  updateCategory(id: number, userId: number, data: Partial<InsertCategory>): Promise<Category>;
  deleteCategory(id: number, userId: number): Promise<void>;

  getTransactions(userId: number): Promise<(Transaction & { categoryName?: string | null; categoryIcon?: string | null; walletName?: string | null })[]>;
  getTransactionsByType(userId: number, type: string): Promise<Transaction[]>;
  createTransaction(userId: number, transaction: InsertTransaction, options?: { allowOverdraft?: boolean; settleBalanceTo?: number | null }): Promise<Transaction>;
  createTransfer(userId: number, transfer: { sourceWalletId: number; targetWalletId: number; amount: number; note?: string | null }): Promise<Transaction>;
  deleteTransaction(id: number, userId: number): Promise<void>;

  getRecurringIncomes(userId: number): Promise<RecurringIncome[]>;
  createRecurringIncome(userId: number, income: InsertRecurringIncome): Promise<RecurringIncome>;
  updateRecurringIncome(id: number, userId: number, data: Partial<InsertRecurringIncome>): Promise<RecurringIncome>;
  deleteRecurringIncome(id: number, userId: number): Promise<void>;
  applyDueRecurringIncomes(userId: number): Promise<RecurringIncome[]>;

  getCommitmentSteps(commitmentId: number, userId: number): Promise<CommitmentStep[]>;
  createCommitmentStep(commitmentId: number, userId: number, step: InsertCommitmentStep): Promise<CommitmentStep>;
  toggleCommitmentStep(commitmentId: number, stepId: number, userId: number): Promise<CommitmentStep>;
  deleteCommitmentStep(commitmentId: number, stepId: number, userId: number): Promise<void>;
  getCommitmentProofs(commitmentId: number, userId: number): Promise<CommitmentProof[]>;
  createCommitmentProof(commitmentId: number, userId: number, proof: InsertCommitmentProof): Promise<CommitmentProof>;
  deleteCommitmentProof(commitmentId: number, proofId: number, userId: number): Promise<void>;
  getCommitments(userId: number): Promise<Commitment[]>;
  getCommitmentById(id: number, userId: number): Promise<Commitment | undefined>;
  createCommitment(userId: number, commitment: InsertCommitment): Promise<Commitment>;
  updateCommitment(id: number, userId: number, data: Partial<InsertCommitment>): Promise<Commitment>;
  deleteCommitment(id: number, userId: number): Promise<void>;
  updateCommitmentStatus(id: number, userId: number, status: NonNullable<InsertCommitment["status"]>): Promise<Commitment>;

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
  private isTransferNote(note: string | null | undefined) {
    return typeof note === "string" && note.startsWith("__transfer__:");
  }

  private parseTransferNote(note: string | null | undefined) {
    if (!this.isTransferNote(note)) {
      return null;
    }

    const [prefix, pairId, direction, walletId, ...rest] = (note ?? "").split(":");
    if (prefix !== "__transfer__" || !pairId || !direction || !walletId) {
      return null;
    }

    return {
      pairId,
      direction,
      relatedWalletId: Number(walletId),
      label: rest.join(":"),
    };
  }

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
    await db.delete(passwordResetRequests).where(eq(passwordResetRequests.userId, id));
    await db.delete(commitmentProofs).where(eq(commitmentProofs.userId, id));
    await db.delete(commitmentSteps).where(eq(commitmentSteps.userId, id));
    await db.delete(commitments).where(eq(commitments.userId, id));
    await db.delete(savingsGoals).where(eq(savingsGoals.userId, id));
    await db.delete(obligations).where(eq(obligations.userId, id));
    await db.delete(categories).where(eq(categories.userId, id));
    await db.delete(wallets).where(eq(wallets.userId, id));
    await db.delete(users).where(eq(users.id, id));
  }

  async createPasswordResetRequest(data: InsertPasswordResetRequest): Promise<PasswordResetRequest> {
    const [created] = await db.insert(passwordResetRequests).values(data).returning();
    return created;
  }

  async getPasswordResetRequests(): Promise<PasswordResetRequest[]> {
    return db.select().from(passwordResetRequests).orderBy(desc(passwordResetRequests.createdAt));
  }

  async getPasswordResetRequestById(id: number): Promise<PasswordResetRequest | undefined> {
    const [request] = await db.select().from(passwordResetRequests).where(eq(passwordResetRequests.id, id));
    return request;
  }

  async getPasswordResetRequestByToken(token: string): Promise<PasswordResetRequest | undefined> {
    const [request] = await db.select().from(passwordResetRequests).where(eq(passwordResetRequests.resetToken, token));
    return request;
  }

  async updatePasswordResetRequest(id: number, data: Partial<PasswordResetRequest>): Promise<PasswordResetRequest> {
    const [updated] = await db.update(passwordResetRequests).set(data).where(eq(passwordResetRequests.id, id)).returning();
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

  /**
   * Five tables point at a wallet, and Postgres refuses the delete while any of
   * them still does. Records that only make sense inside this wallet go with it;
   * ones that must be pointed somewhere else stop the delete with a message
   * naming them, rather than failing as an unexplained error.
   */
  async deleteWallet(id: number, userId: number): Promise<void> {
    const [connection] = await db.select({ id: bankEmailConnections.id, email: bankEmailConnections.email })
      .from(bankEmailConnections)
      .where(and(eq(bankEmailConnections.walletId, id), eq(bankEmailConnections.userId, userId)));
    if (connection) {
      throw userError(`هذه المحفظة مرتبطة ببريد بنكي (${connection.email}). افصل الربط أو حوّله لمحفظة أخرى أولاً.`);
    }

    const income = await db.select({ id: recurringIncomes.id, title: recurringIncomes.title })
      .from(recurringIncomes)
      .where(and(eq(recurringIncomes.walletId, id), eq(recurringIncomes.userId, userId)));
    if (income.length > 0) {
      throw userError(`هذه المحفظة مرتبطة بدخل متكرر (${income[0].title}). غيّر محفظته أو احذفه أولاً.`);
    }

    // An obligation can live without a wallet, so it is detached rather than lost.
    await db.update(obligations).set({ walletId: null })
      .where(and(eq(obligations.walletId, id), eq(obligations.userId, userId)));

    // A bank inbox event points at a transaction we are about to remove.
    const walletTransactions = await db.select({ id: transactions.id })
      .from(transactions)
      .where(and(eq(transactions.walletId, id), eq(transactions.userId, userId)));
    await this.detachBankEmailEvents(walletTransactions.map((row) => row.id), userId);

    await db.delete(transactions).where(and(eq(transactions.walletId, id), eq(transactions.userId, userId)));
    await db.delete(savingsGoals).where(and(eq(savingsGoals.walletId, id), eq(savingsGoals.userId, userId)));
    await db.delete(wallets).where(and(eq(wallets.id, id), eq(wallets.userId, userId)));
  }

  /**
   * Editing a balance by hand states a fact the transactions do not explain, so
   * the difference is booked as its own movement labelled "مجهول". Without it the
   * balance and its history disagree and every later reconciliation is off by
   * the amount that was quietly typed in.
   */
  async setWalletBalance(id: number, userId: number, newBalance: number): Promise<Wallet> {
    const wallet = await this.getWallet(id, userId);
    if (!wallet) throw userError("المحفظة غير موجودة");

    const difference = Number((newBalance - wallet.balance).toFixed(3));
    if (Math.abs(difference) >= 0.001) {
      await db.insert(transactions).values({
        userId,
        walletId: id,
        categoryId: null,
        type: difference > 0 ? "income" : "expense",
        amount: Math.abs(difference),
        note: UNKNOWN_ADJUSTMENT_NOTE,
      });
    }

    const [updated] = await db.update(wallets).set({ balance: newBalance })
      .where(and(eq(wallets.id, id), eq(wallets.userId, userId))).returning();
    return updated;
  }


  async getSavingsGoals(userId: number): Promise<SavingsGoal[]> {
    return db
      .select()
      .from(savingsGoals)
      .where(eq(savingsGoals.userId, userId))
      .orderBy(desc(savingsGoals.createdAt), desc(savingsGoals.id));
  }

  async createSavingsGoal(userId: number, goal: InsertSavingsGoal): Promise<SavingsGoal> {
    const wallet = await this.getWallet(goal.walletId, userId);
    if (!wallet) {
      throw userError("المحفظة المحددة غير موجودة");
    }

    const now = Math.floor(Date.now() / 1000);
    const [created] = await db
      .insert(savingsGoals)
      .values({ ...goal, userId, createdAt: now, updatedAt: now })
      .returning();
    return created;
  }

  async deleteSavingsGoal(id: number, userId: number): Promise<void> {
    await db
      .delete(savingsGoals)
      .where(and(eq(savingsGoals.id, id), eq(savingsGoals.userId, userId)));
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
      .orderBy(desc(transactions.date), desc(transactions.id));
    return result;
  }

  async getTransactionsByType(userId: number, type: string): Promise<Transaction[]> {
    return db
      .select()
      .from(transactions)
      .where(and(eq(transactions.userId, userId), eq(transactions.type, type)))
      .orderBy(desc(transactions.date), desc(transactions.id));
  }

  /**
   * `allowOverdraft` is for movements the bank already carried out. Refusing to
   * record a debit because our copy of the balance is lower does not undo it at
   * the bank — it just widens the gap between the app and reality.
   *
   * `settleBalanceTo` takes the closing balance the bank stated and makes it the
   * wallet's balance, so a missed alert self-corrects on the next one instead of
   * leaving the running total permanently off.
   */
  async createTransaction(
    userId: number,
    transaction: InsertTransaction,
    options: { allowOverdraft?: boolean; settleBalanceTo?: number | null } = {},
  ): Promise<Transaction> {
    if (transaction.walletId) {
      const wallet = await this.getWallet(transaction.walletId, userId);
      if (wallet) {
        if (!options.allowOverdraft && (transaction.type === "expense" || transaction.type === "debt") && transaction.amount > wallet.balance) {
          throw userError("المبلغ أكبر من الرصيد المتاح في المحفظة");
        }

        const [created] = await db.insert(transactions).values({ ...transaction, userId }).returning();
        const delta = transaction.type === "income" ? transaction.amount : -transaction.amount;
        const nextBalance = typeof options.settleBalanceTo === "number"
          ? options.settleBalanceTo
          : wallet.balance + delta;
        await this.updateWallet(wallet.id, userId, { balance: nextBalance });
        return created;
      }
    }

    const [created] = await db.insert(transactions).values({ ...transaction, userId }).returning();
    return created;
  }

  async createTransfer(userId: number, transfer: { sourceWalletId: number; targetWalletId: number; amount: number; note?: string | null }): Promise<Transaction> {
    if (transfer.sourceWalletId === transfer.targetWalletId) {
      throw userError("يجب اختيار محفظتين مختلفتين للتحويل");
    }

    const sourceWallet = await this.getWallet(transfer.sourceWalletId, userId);
    const targetWallet = await this.getWallet(transfer.targetWalletId, userId);

    if (!sourceWallet || !targetWallet) {
      throw userError("تعذر العثور على إحدى المحافظ المحددة");
    }

    if (transfer.amount > sourceWallet.balance) {
      throw userError("المبلغ أكبر من الرصيد المتاح في المحفظة");
    }

    const pairId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const label = (transfer.note?.trim() || "تحويل بين المحافظ").replace(/:/g, " - ");
    const outNote = `__transfer__:${pairId}:out:${transfer.targetWalletId}:${label}`;
    const inNote = `__transfer__:${pairId}:in:${transfer.sourceWalletId}:${label}`;

    const [outgoing] = await db.insert(transactions).values({
      userId,
      walletId: transfer.sourceWalletId,
      categoryId: null,
      type: "expense",
      amount: transfer.amount,
      note: outNote,
    }).returning();

    await db.insert(transactions).values({
      userId,
      walletId: transfer.targetWalletId,
      categoryId: null,
      type: "income",
      amount: transfer.amount,
      note: inNote,
    });

    await this.updateWallet(sourceWallet.id, userId, { balance: sourceWallet.balance - transfer.amount });
    await this.updateWallet(targetWallet.id, userId, { balance: targetWallet.balance + transfer.amount });

    return outgoing;
  }

  /**
   * A bank inbox event keeps a reference to the transaction it produced, so the
   * row has to let go of it before Postgres will allow the delete. Without this
   * the foreign key rejects deleting any transaction that came from an email.
   */
  private async detachBankEmailEvents(transactionIds: number[], userId: number) {
    if (transactionIds.length === 0) return;
    await db
      .update(bankEmailEvents)
      .set({ transactionId: null })
      .where(and(eq(bankEmailEvents.userId, userId), inArray(bankEmailEvents.transactionId, transactionIds)));
  }

  async deleteTransaction(id: number, userId: number): Promise<void> {
    const [tx] = await db.select().from(transactions).where(and(eq(transactions.id, id), eq(transactions.userId, userId)));
    const transferMeta = this.parseTransferNote(tx?.note);
    if (tx && transferMeta) {
      const pairTransactions = await db
        .select()
        .from(transactions)
        .where(and(eq(transactions.userId, userId), like(transactions.note, `__transfer__:${transferMeta.pairId}:%`)));

      for (const pairTx of pairTransactions) {
        if (pairTx.walletId) {
          const wallet = await this.getWallet(pairTx.walletId, userId);
          if (wallet) {
            const delta = pairTx.type === "income" ? -pairTx.amount : pairTx.amount;
            await this.updateWallet(wallet.id, userId, { balance: wallet.balance + delta });
          }
        }
      }

      await this.detachBankEmailEvents(pairTransactions.map((pairTx) => pairTx.id), userId);
      await db.delete(transactions).where(and(eq(transactions.userId, userId), like(transactions.note, `__transfer__:${transferMeta.pairId}:%`)));
      return;
    }

    if (tx && tx.walletId) {
      const wallet = await this.getWallet(tx.walletId, userId);
      if (wallet) {
        const delta = tx.type === "income" ? -tx.amount : tx.amount;
        await this.updateWallet(wallet.id, userId, { balance: wallet.balance + delta });
      }
    }

    await this.detachBankEmailEvents([id], userId);
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



  async getCommitmentSteps(commitmentId: number, userId: number): Promise<CommitmentStep[]> {
    const commitment = await this.getCommitmentById(commitmentId, userId);
    if (!commitment) throw userError("الالتزام غير موجود");

    return db
      .select()
      .from(commitmentSteps)
      .where(and(eq(commitmentSteps.commitmentId, commitmentId), eq(commitmentSteps.userId, userId)))
      .orderBy(asc(commitmentSteps.position), asc(commitmentSteps.id));
  }

  async createCommitmentStep(commitmentId: number, userId: number, step: InsertCommitmentStep): Promise<CommitmentStep> {
    const existingSteps = await this.getCommitmentSteps(commitmentId, userId);
    const [created] = await db
      .insert(commitmentSteps)
      .values({
        userId,
        commitmentId,
        title: step.title,
        position: step.position ?? existingSteps.length,
      })
      .returning();
    return created;
  }

  async toggleCommitmentStep(commitmentId: number, stepId: number, userId: number): Promise<CommitmentStep> {
    const [step] = await db
      .select()
      .from(commitmentSteps)
      .where(and(
        eq(commitmentSteps.id, stepId),
        eq(commitmentSteps.commitmentId, commitmentId),
        eq(commitmentSteps.userId, userId),
      ));

    if (!step) throw userError("الخطوة غير موجودة");

    const nextCompleted = !step.isCompleted;
    const [updated] = await db
      .update(commitmentSteps)
      .set({
        isCompleted: nextCompleted,
        completedAt: nextCompleted ? Math.floor(Date.now() / 1000) : null,
      })
      .where(eq(commitmentSteps.id, step.id))
      .returning();
    return updated;
  }

  async deleteCommitmentStep(commitmentId: number, stepId: number, userId: number): Promise<void> {
    await db
      .delete(commitmentSteps)
      .where(and(
        eq(commitmentSteps.id, stepId),
        eq(commitmentSteps.commitmentId, commitmentId),
        eq(commitmentSteps.userId, userId),
      ));
  }

  async getCommitmentProofs(commitmentId: number, userId: number): Promise<CommitmentProof[]> {
    const commitment = await this.getCommitmentById(commitmentId, userId);
    if (!commitment) throw userError("الالتزام غير موجود");

    return db
      .select()
      .from(commitmentProofs)
      .where(and(eq(commitmentProofs.commitmentId, commitmentId), eq(commitmentProofs.userId, userId)))
      .orderBy(desc(commitmentProofs.createdAt), desc(commitmentProofs.id));
  }

  async createCommitmentProof(commitmentId: number, userId: number, proof: InsertCommitmentProof): Promise<CommitmentProof> {
    await this.getCommitmentProofs(commitmentId, userId);
    const [created] = await db
      .insert(commitmentProofs)
      .values({ ...proof, userId, commitmentId })
      .returning();
    return created;
  }

  async deleteCommitmentProof(commitmentId: number, proofId: number, userId: number): Promise<void> {
    await db
      .delete(commitmentProofs)
      .where(and(
        eq(commitmentProofs.id, proofId),
        eq(commitmentProofs.commitmentId, commitmentId),
        eq(commitmentProofs.userId, userId),
      ));
  }
  async getCommitments(userId: number): Promise<Commitment[]> {
    return db
      .select()
      .from(commitments)
      .where(eq(commitments.userId, userId))
      .orderBy(desc(commitments.dueDate), desc(commitments.createdAt));
  }

  async getCommitmentById(id: number, userId: number): Promise<Commitment | undefined> {
    const [commitment] = await db
      .select()
      .from(commitments)
      .where(and(eq(commitments.id, id), eq(commitments.userId, userId)));
    return commitment;
  }

  async createCommitment(userId: number, commitment: InsertCommitment): Promise<Commitment> {
    const now = Math.floor(Date.now() / 1000);
    const [created] = await db
      .insert(commitments)
      .values({
        ...commitment,
        userId,
        status: commitment.status ?? "active",
        amount: commitment.amount ?? null,
        personName: commitment.personName ?? null,
        assetName: commitment.assetName ?? null,
        notes: commitment.notes ?? "",
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    return created;
  }

  async updateCommitment(id: number, userId: number, data: Partial<InsertCommitment>): Promise<Commitment> {
    const [updated] = await db
      .update(commitments)
      .set({ ...data, updatedAt: Math.floor(Date.now() / 1000) })
      .where(and(eq(commitments.id, id), eq(commitments.userId, userId)))
      .returning();

    if (!updated) {
      throw userError("الالتزام غير موجود");
    }

    return updated;
  }

  async deleteCommitment(id: number, userId: number): Promise<void> {
    await db
      .delete(commitments)
      .where(and(eq(commitments.id, id), eq(commitments.userId, userId)));
  }

  async updateCommitmentStatus(id: number, userId: number, status: NonNullable<InsertCommitment["status"]>): Promise<Commitment> {
    return this.updateCommitment(id, userId, { status });
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
      throw userError("الالتزام غير موجود");
    }
    return this.updateObligation(id, userId, { isActive: !obligation.isActive });
  }

  async getVariableObligationMonthStatuses(obligationId: number, userId: number): Promise<VariableObligationMonthStatus[]> {
    const obligation = await this.getObligationById(obligationId, userId);
    if (!obligation) {
      throw userError("الالتزام غير موجود");
    }

    if (obligation.scheduleType !== "variable") {
      throw userError("هذه الصفحة مخصصة للالتزامات المتغيرة فقط");
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
      throw userError("الالتزام غير موجود");
    }

    if (obligation.scheduleType !== "variable") {
      throw userError("يمكن تحديث حالات الأشهر للالتزام المتغير فقط");
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
      throw userError("الالتزام غير موجود");
    }

    if (obligation.scheduleType !== "variable") {
      throw userError("هذا الإجراء متاح للالتزامات المتغيرة فقط");
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

