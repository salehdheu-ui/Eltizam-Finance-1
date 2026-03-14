import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  phone: text("phone"),
  role: text("role").notNull().default("user"),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  lastLoginAt: integer("last_login_at"),
  createdAt: integer("created_at").notNull().default(sql`(unixepoch())`),
});

export const passwordResetRequests = sqliteTable("password_reset_requests", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull().references(() => users.id),
  status: text("status").notNull().default("pending"),
  verificationMethod: text("verification_method").notNull().default("admin"),
  requestedByIdentifier: text("requested_by_identifier").notNull(),
  contactValue: text("contact_value"),
  resetToken: text("reset_token"),
  resetTokenExpiresAt: integer("reset_token_expires_at"),
  adminUserId: integer("admin_user_id").references(() => users.id),
  createdAt: integer("created_at").notNull().default(sql`(unixepoch())`),
  resolvedAt: integer("resolved_at"),
});

export const wallets = sqliteTable("wallets", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull().references(() => users.id),
  name: text("name").notNull(),
  type: text("type").notNull().default("cash"),
  balance: real("balance").notNull().default(0),
  color: text("color").notNull().default("from-slate-600 to-slate-800"),
});

export const categories = sqliteTable("categories", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull().references(() => users.id),
  name: text("name").notNull(),
  type: text("type").notNull().default("expense"),
  icon: text("icon").notNull().default("📝"),
  color: text("color").notNull().default("bg-orange-100 text-orange-600"),
  budget: real("budget").default(0),
});

export const transactions = sqliteTable("transactions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull().references(() => users.id),
  walletId: integer("wallet_id").references(() => wallets.id),
  categoryId: integer("category_id").references(() => categories.id),
  type: text("type").notNull().default("expense"),
  amount: real("amount").notNull(),
  note: text("note").default(""),
  date: integer("date").notNull().default(sql`(unixepoch())`),
});

export const recurringIncomes = sqliteTable("recurring_incomes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull().references(() => users.id),
  title: text("title").notNull(),
  amount: real("amount").notNull(),
  incomeType: text("income_type").notNull().default("salary"),
  dayOfMonth: integer("day_of_month").notNull(),
  walletId: integer("wallet_id").notNull().references(() => wallets.id),
  categoryId: integer("category_id").references(() => categories.id),
  note: text("note").default(""),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  lastAppliedMonth: text("last_applied_month"),
  createdAt: integer("created_at").notNull().default(sql`(unixepoch())`),
  updatedAt: integer("updated_at").notNull().default(sql`(unixepoch())`),
});

export const obligations = sqliteTable("obligations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull().references(() => users.id),
  title: text("title").notNull(),
  amount: real("amount").notNull(),
  scheduleType: text("schedule_type").notNull().default("fixed"),
  obligationType: text("obligation_type").notNull().default("custom"),
  frequency: text("frequency").notNull().default("monthly"),
  dueDay: integer("due_day"), // للالتزامات الشهرية (1-31)
  dueMonth: integer("due_month"), // للالتزامات السنوية (1-12)
  dueDate: integer("due_date"), // للالتزامات لمرة واحدة (unixepoch)
  startDate: integer("start_date").notNull().default(sql`(unixepoch())`),
  endDate: integer("end_date"), // اختياري - تاريخ انتهاء الالتزام
  walletId: integer("wallet_id").references(() => wallets.id),
  categoryId: integer("category_id").references(() => categories.id),
  notes: text("notes").default(""),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  autoCreateTransaction: integer("auto_create_transaction", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at").notNull().default(sql`(unixepoch())`),
  updatedAt: integer("updated_at").notNull().default(sql`(unixepoch())`),
});

export const variableObligationMonthStatuses = sqliteTable("variable_obligation_month_statuses", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull().references(() => users.id),
  obligationId: integer("obligation_id").notNull().references(() => obligations.id),
  monthKey: text("month_key").notNull(),
  status: text("status").notNull().default("unpaid"),
  paidAt: integer("paid_at"),
  note: text("note").default(""),
  createdAt: integer("created_at").notNull().default(sql`(unixepoch())`),
  updatedAt: integer("updated_at").notNull().default(sql`(unixepoch())`),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
  name: true,
  email: true,
  phone: true,
  role: true,
  isActive: true,
  lastLoginAt: true,
  createdAt: true,
});

export const insertWalletSchema = createInsertSchema(wallets).pick({
  name: true,
  type: true,
  balance: true,
  color: true,
});

export const insertCategorySchema = createInsertSchema(categories).pick({
  name: true,
  type: true,
  icon: true,
  color: true,
  budget: true,
});

export const insertTransactionSchema = createInsertSchema(transactions).pick({
  walletId: true,
  categoryId: true,
  type: true,
  amount: true,
  note: true,
}).extend({
  walletId: z.number({ required_error: "يجب اختيار محفظة أو بنك" }),
  categoryId: z.number().nullable(),
});

export const insertRecurringIncomeSchema = createInsertSchema(recurringIncomes).pick({
  title: true,
  amount: true,
  incomeType: true,
  dayOfMonth: true,
  walletId: true,
  categoryId: true,
  note: true,
  isActive: true,
  lastAppliedMonth: true,
}).extend({
  title: z.string().min(1, "يجب إدخال اسم الدخل"),
  amount: z.number().positive("المبلغ يجب أن يكون أكبر من صفر"),
  incomeType: z.enum(["salary", "other_recurring"]),
  dayOfMonth: z.number().int().min(1).max(28),
  walletId: z.number({ required_error: "يجب اختيار محفظة أو بنك" }),
  categoryId: z.number().nullable().optional(),
  note: z.string().max(500).nullable().optional(),
  isActive: z.boolean().optional(),
  lastAppliedMonth: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "صيغة الشهر يجب أن تكون YYYY-MM").nullable().optional(),
});

export const insertObligationSchema = createInsertSchema(obligations).pick({
  title: true,
  amount: true,
  scheduleType: true,
  obligationType: true,
  frequency: true,
  dueDay: true,
  dueMonth: true,
  dueDate: true,
  startDate: true,
  endDate: true,
  walletId: true,
  categoryId: true,
  notes: true,
  isActive: true,
  autoCreateTransaction: true,
}).extend({
  title: z.string().min(1, "يجب إدخال عنوان الالتزام"),
  amount: z.number().positive("المبلغ يجب أن يكون أكبر من صفر"),
  scheduleType: z.enum(["fixed", "variable"]),
  obligationType: z.enum(["bill", "installment", "subscription", "association", "custom"]),
  frequency: z.enum(["monthly", "yearly", "one_time"]),
  dueDay: z.number().min(1).max(31).nullable().optional(),
  dueMonth: z.number().min(1).max(12).nullable().optional(),
  dueDate: z.number().nullable().optional(),
  startDate: z.number().int().positive().optional(),
  endDate: z.number().int().positive().nullable().optional(),
  walletId: z.number().nullable().optional(),
  categoryId: z.number().nullable().optional(),
});

export const insertVariableObligationMonthStatusSchema = createInsertSchema(variableObligationMonthStatuses).pick({
  monthKey: true,
  status: true,
  paidAt: true,
  note: true,
}).extend({
  monthKey: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "صيغة الشهر يجب أن تكون YYYY-MM"),
  status: z.enum(["paid", "late", "unpaid"]),
  paidAt: z.number().int().positive().nullable().optional(),
  note: z.string().max(500).nullable().optional(),
});

export const insertPasswordResetRequestSchema = createInsertSchema(passwordResetRequests).pick({
  userId: true,
  status: true,
  verificationMethod: true,
  requestedByIdentifier: true,
  contactValue: true,
  resetToken: true,
  resetTokenExpiresAt: true,
  adminUserId: true,
  createdAt: true,
  resolvedAt: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type InsertWallet = z.infer<typeof insertWalletSchema>;
export type Wallet = typeof wallets.$inferSelect;
export type InsertCategory = z.infer<typeof insertCategorySchema>;
export type Category = typeof categories.$inferSelect;
export type InsertTransaction = z.infer<typeof insertTransactionSchema>;
export type Transaction = typeof transactions.$inferSelect;
export type InsertRecurringIncome = z.infer<typeof insertRecurringIncomeSchema>;
export type RecurringIncome = typeof recurringIncomes.$inferSelect;
export type InsertObligation = z.infer<typeof insertObligationSchema>;
export type Obligation = typeof obligations.$inferSelect;
export type InsertVariableObligationMonthStatus = z.infer<typeof insertVariableObligationMonthStatusSchema>;
export type VariableObligationMonthStatus = typeof variableObligationMonthStatuses.$inferSelect;
export type InsertPasswordResetRequest = z.infer<typeof insertPasswordResetRequestSchema>;
export type PasswordResetRequest = typeof passwordResetRequests.$inferSelect;
