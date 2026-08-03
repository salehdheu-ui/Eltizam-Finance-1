import { sql } from "drizzle-orm";
import { pgTable, text, integer, serial, doublePrecision, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  phone: text("phone"),
  role: text("role").notNull().default("user"),
  isActive: boolean("is_active").notNull().default(true),
  lastLoginAt: integer("last_login_at"),
  createdAt: integer("created_at").notNull().default(sql`extract(epoch from now())::integer`),
});

export const passwordResetRequests = pgTable("password_reset_requests", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  status: text("status").notNull().default("pending"),
  verificationMethod: text("verification_method").notNull().default("admin"),
  requestedByIdentifier: text("requested_by_identifier").notNull(),
  contactValue: text("contact_value"),
  resetToken: text("reset_token"),
  resetTokenExpiresAt: integer("reset_token_expires_at"),
  adminUserId: integer("admin_user_id").references(() => users.id),
  createdAt: integer("created_at").notNull().default(sql`extract(epoch from now())::integer`),
  resolvedAt: integer("resolved_at"),
});

export const wallets = pgTable("wallets", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  name: text("name").notNull(),
  type: text("type").notNull().default("cash"),
  balance: doublePrecision("balance").notNull().default(0),
  color: text("color").notNull().default("from-slate-600 to-slate-800"),
});

export const categories = pgTable("categories", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  name: text("name").notNull(),
  type: text("type").notNull().default("expense"),
  icon: text("icon").notNull().default("📝"),
  color: text("color").notNull().default("bg-orange-100 text-orange-600"),
  budget: doublePrecision("budget").default(0),
});

export const transactions = pgTable("transactions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  walletId: integer("wallet_id").references(() => wallets.id),
  categoryId: integer("category_id").references(() => categories.id),
  type: text("type").notNull().default("expense"),
  amount: doublePrecision("amount").notNull(),
  note: text("note").default(""),
  date: integer("date").notNull().default(sql`extract(epoch from now())::integer`),
});

export const recurringIncomes = pgTable("recurring_incomes", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  title: text("title").notNull(),
  amount: doublePrecision("amount").notNull(),
  incomeType: text("income_type").notNull().default("salary"),
  dayOfMonth: integer("day_of_month").notNull(),
  walletId: integer("wallet_id").notNull().references(() => wallets.id),
  categoryId: integer("category_id").references(() => categories.id),
  note: text("note").default(""),
  isActive: boolean("is_active").notNull().default(true),
  lastAppliedMonth: text("last_applied_month"),
  createdAt: integer("created_at").notNull().default(sql`extract(epoch from now())::integer`),
  updatedAt: integer("updated_at").notNull().default(sql`extract(epoch from now())::integer`),
});

export const obligations = pgTable("obligations", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  title: text("title").notNull(),
  amount: doublePrecision("amount").notNull(),
  scheduleType: text("schedule_type").notNull().default("fixed"),
  obligationType: text("obligation_type").notNull().default("custom"),
  frequency: text("frequency").notNull().default("monthly"),
  dueDay: integer("due_day"), // للالتزامات الشهرية (1-31)
  dueMonth: integer("due_month"), // للالتزامات السنوية (1-12)
  dueDate: integer("due_date"), // للالتزامات لمرة واحدة (unixepoch)
  startDate: integer("start_date").notNull().default(sql`extract(epoch from now())::integer`),
  endDate: integer("end_date"), // اختياري - تاريخ انتهاء الالتزام
  walletId: integer("wallet_id").references(() => wallets.id),
  categoryId: integer("category_id").references(() => categories.id),
  notes: text("notes").default(""),
  isActive: boolean("is_active").notNull().default(true),
  autoCreateTransaction: boolean("auto_create_transaction").notNull().default(false),
  createdAt: integer("created_at").notNull().default(sql`extract(epoch from now())::integer`),
  updatedAt: integer("updated_at").notNull().default(sql`extract(epoch from now())::integer`),
});

export const variableObligationMonthStatuses = pgTable("variable_obligation_month_statuses", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  obligationId: integer("obligation_id").notNull().references(() => obligations.id),
  monthKey: text("month_key").notNull(),
  status: text("status").notNull().default("unpaid"),
  paidAt: integer("paid_at"),
  note: text("note").default(""),
  createdAt: integer("created_at").notNull().default(sql`extract(epoch from now())::integer`),
  updatedAt: integer("updated_at").notNull().default(sql`extract(epoch from now())::integer`),
});

export const commitments = pgTable("commitments", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  title: text("title").notNull(),
  type: text("type").notNull().default("personal"),
  status: text("status").notNull().default("active"),
  frequency: text("frequency").notNull().default("one_time"),
  dueDate: integer("due_date"),
  amount: doublePrecision("amount"),
  personName: text("person_name"),
  assetName: text("asset_name"),
  notes: text("notes").default(""),
  createdAt: integer("created_at").notNull().default(sql`extract(epoch from now())::integer`),
  updatedAt: integer("updated_at").notNull().default(sql`extract(epoch from now())::integer`),
});
export const commitmentSteps = pgTable("commitment_steps", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  commitmentId: integer("commitment_id").notNull().references(() => commitments.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  position: integer("position").notNull().default(0),
  isCompleted: boolean("is_completed").notNull().default(false),
  completedAt: integer("completed_at"),
  createdAt: integer("created_at").notNull().default(sql`extract(epoch from now())::integer`),
});

export const commitmentProofs = pgTable("commitment_proofs", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  commitmentId: integer("commitment_id").notNull().references(() => commitments.id, { onDelete: "cascade" }),
  kind: text("kind").notNull().default("note"),
  label: text("label").notNull(),
  value: text("value").notNull(),
  createdAt: integer("created_at").notNull().default(sql`extract(epoch from now())::integer`),
});
export const commitmentAutomationSettings = pgTable("commitment_automation_settings", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  commitmentId: integer("commitment_id").notNull().references(() => commitments.id, { onDelete: "cascade" }),
  enabled: boolean("enabled").notNull().default(true),
  reminderMinutes: integer("reminder_minutes").notNull().default(1440),
  escalationMinutes: integer("escalation_minutes").notNull().default(1440),
  autoCloseOnProof: boolean("auto_close_on_proof").notNull().default(true),
  autoCloseOnPayment: boolean("auto_close_on_payment").notNull().default(true),
  delegatedTo: text("delegated_to"),
  delegatedContact: text("delegated_contact"),
  snoozedUntil: integer("snoozed_until"),
  lastOccurrenceAt: integer("last_occurrence_at"),
  nextOccurrenceAt: integer("next_occurrence_at"),
  createdAt: integer("created_at").notNull().default(sql`extract(epoch from now())::integer`),
  updatedAt: integer("updated_at").notNull().default(sql`extract(epoch from now())::integer`),
});
export const commitmentOccurrences = pgTable("commitment_occurrences", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  commitmentId: integer("commitment_id").notNull().references(() => commitments.id, { onDelete: "cascade" }),
  scheduledFor: integer("scheduled_for").notNull(),
  status: text("status").notNull().default("pending"),
  snoozedUntil: integer("snoozed_until"),
  completedAt: integer("completed_at"),
  source: text("source").notNull().default("scheduler"),
  createdAt: integer("created_at").notNull().default(sql`extract(epoch from now())::integer`),
  updatedAt: integer("updated_at").notNull().default(sql`extract(epoch from now())::integer`),
});
export const commitmentAutomationLogs = pgTable("commitment_automation_logs", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  commitmentId: integer("commitment_id").notNull().references(() => commitments.id, { onDelete: "cascade" }),
  occurrenceId: integer("occurrence_id").references(() => commitmentOccurrences.id, { onDelete: "cascade" }),
  action: text("action").notNull(),
  summary: text("summary").notNull(),
  metadata: text("metadata"),
  undoPayload: text("undo_payload"),
  undoneAt: integer("undone_at"),
  seenAt: integer("seen_at"),
  createdAt: integer("created_at").notNull().default(sql`extract(epoch from now())::integer`),
});
export const bankEmailConnections = pgTable("bank_email_connections", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  provider: text("provider").notNull().default("google"),
  email: text("email").notNull(),
  bankKey: text("bank_key").notNull(),
  walletId: integer("wallet_id").notNull().references(() => wallets.id),
  autoImport: boolean("auto_import").notNull().default(true),
  accessTokenEncrypted: text("access_token_encrypted"),
  refreshTokenEncrypted: text("refresh_token_encrypted"),
  tokenExpiresAt: integer("token_expires_at"),
  lastSyncAt: integer("last_sync_at"),
  createdAt: integer("created_at").notNull().default(sql`extract(epoch from now())::integer`),
  updatedAt: integer("updated_at").notNull().default(sql`extract(epoch from now())::integer`),
});

export const bankEmailEvents = pgTable("bank_email_events", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  connectionId: integer("connection_id").notNull().references(() => bankEmailConnections.id, { onDelete: "cascade" }),
  providerMessageId: text("provider_message_id").notNull(),
  fingerprint: text("fingerprint").notNull(),
  bankKey: text("bank_key").notNull(),
  sender: text("sender").default(""),
  subject: text("subject").default(""),
  snippet: text("snippet").default(""),
  receivedAt: integer("received_at").notNull(),
  status: text("status").notNull().default("review"),
  transactionType: text("transaction_type"),
  amount: doublePrecision("amount"),
  merchant: text("merchant"),
  categoryId: integer("category_id").references(() => categories.id),
  commitmentId: integer("commitment_id").references(() => commitments.id),
  transactionId: integer("transaction_id").references(() => transactions.id),
  createdAt: integer("created_at").notNull().default(sql`extract(epoch from now())::integer`),
});

export const userNotificationSettings = pgTable("user_notification_settings", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }).unique(),
  emailEnabled: boolean("email_enabled").notNull().default(false),
  pushEnabled: boolean("push_enabled").notNull().default(false),
  whatsappEnabled: boolean("whatsapp_enabled").notNull().default(false),
  whatsappNumber: text("whatsapp_number"),
  telegramEnabled: boolean("telegram_enabled").notNull().default(false),
  telegramChatId: text("telegram_chat_id"),
  createdAt: integer("created_at").notNull().default(sql`extract(epoch from now())::integer`),
  updatedAt: integer("updated_at").notNull().default(sql`extract(epoch from now())::integer`),
});

export const pushSubscriptions = pgTable("push_subscriptions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  endpoint: text("endpoint").notNull().unique(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  userAgent: text("user_agent"),
  createdAt: integer("created_at").notNull().default(sql`extract(epoch from now())::integer`),
  updatedAt: integer("updated_at").notNull().default(sql`extract(epoch from now())::integer`),
});

export const integrationDocuments = pgTable("integration_documents", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  commitmentId: integer("commitment_id").references(() => commitments.id, { onDelete: "set null" }),
  kind: text("kind").notNull().default("other"),
  originalName: text("original_name").notNull(),
  storedName: text("stored_name").notNull(),
  mimeType: text("mime_type").notNull(),
  size: integer("size").notNull(),
  createdAt: integer("created_at").notNull().default(sql`extract(epoch from now())::integer`),
});

export const integrationWebhooks = pgTable("integration_webhooks", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  url: text("url").notNull(),
  secret: text("secret").notNull(),
  events: text("events").notNull().default("reminder,escalated,completed"),
  enabled: boolean("enabled").notNull().default(true),
  lastDeliveryAt: integer("last_delivery_at"),
  lastStatus: text("last_status"),
  createdAt: integer("created_at").notNull().default(sql`extract(epoch from now())::integer`),
  updatedAt: integer("updated_at").notNull().default(sql`extract(epoch from now())::integer`),
});

export const integrationWebhookDeliveries = pgTable("integration_webhook_deliveries", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  webhookId: integer("webhook_id").notNull().references(() => integrationWebhooks.id, { onDelete: "cascade" }),
  event: text("event").notNull(),
  responseStatus: integer("response_status"),
  status: text("status").notNull(),
  error: text("error"),
  createdAt: integer("created_at").notNull().default(sql`extract(epoch from now())::integer`),
});

export const calendarEventLinks = pgTable("calendar_event_links", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  commitmentId: integer("commitment_id").notNull().references(() => commitments.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(),
  externalEventId: text("external_event_id").notNull(),
  syncedAt: integer("synced_at").notNull().default(sql`extract(epoch from now())::integer`),
});
export const savingsGoals = pgTable("savings_goals", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  planId: text("plan_id").notNull(),
  planTitle: text("plan_title").notNull(),
  title: text("title").notNull(),
  walletId: integer("wallet_id").notNull().references(() => wallets.id),
  targetAmount: doublePrecision("target_amount").notNull(),
  monthlyAmount: doublePrecision("monthly_amount").notNull(),
  years: integer("years").notNull().default(5),
  createdAt: integer("created_at").notNull().default(sql`extract(epoch from now())::integer`),
  updatedAt: integer("updated_at").notNull().default(sql`extract(epoch from now())::integer`),
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

export const insertCommitmentSchema = createInsertSchema(commitments).pick({
  title: true,
  type: true,
  status: true,
  frequency: true,
  dueDate: true,
  amount: true,
  personName: true,
  assetName: true,
  notes: true,
}).extend({
  title: z.string().trim().min(1, "يجب إدخال اسم الالتزام").max(160),
  type: z.enum(["financial", "government", "home", "vehicle", "health", "family", "work", "personal"]),
  status: z.enum(["active", "completed", "postponed", "archived"]).optional(),
  frequency: z.enum(["one_time", "daily", "weekly", "monthly", "yearly"]),
  dueDate: z.number().int().positive().nullable().optional(),
  amount: z.number().finite().nonnegative().nullable().optional(),
  personName: z.string().trim().max(120).nullable().optional(),
  assetName: z.string().trim().max(120).nullable().optional(),
  notes: z.string().max(1000).nullable().optional(),
});
export const insertCommitmentStepSchema = createInsertSchema(commitmentSteps).pick({
  title: true,
  position: true,
}).extend({
  title: z.string().trim().min(1, "يجب إدخال اسم الخطوة").max(200),
  position: z.number().int().nonnegative().optional(),
});

export const insertCommitmentProofSchema = createInsertSchema(commitmentProofs).pick({
  kind: true,
  label: true,
  value: true,
}).extend({
  kind: z.enum(["note", "link", "file", "receipt"]),
  label: z.string().trim().min(1, "يجب إدخال اسم الإثبات").max(160),
  value: z.string().trim().min(1, "يجب إدخال تفاصيل الإثبات").max(2000),
});
export const insertSavingsGoalSchema = createInsertSchema(savingsGoals).pick({
  planId: true,
  planTitle: true,
  title: true,
  walletId: true,
  targetAmount: true,
  monthlyAmount: true,
  years: true,
}).extend({
  planId: z.string().trim().min(1).max(80),
  planTitle: z.string().trim().min(1).max(160),
  title: z.string().trim().min(1, "يجب إدخال اسم الهدف الادخاري").max(160),
  walletId: z.number().int().positive("يجب اختيار محفظة صحيحة"),
  targetAmount: z.number().finite().positive("المبلغ المستهدف يجب أن يكون أكبر من صفر"),
  monthlyAmount: z.number().finite().positive("الادخار الشهري يجب أن يكون أكبر من صفر"),
  years: z.union([z.literal(3), z.literal(5), z.literal(10)]),
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
export type BankEmailConnection = typeof bankEmailConnections.$inferSelect;
export type BankEmailEvent = typeof bankEmailEvents.$inferSelect;
export type UserNotificationSetting = typeof userNotificationSettings.$inferSelect;
export type PushSubscriptionRecord = typeof pushSubscriptions.$inferSelect;
export type IntegrationDocument = typeof integrationDocuments.$inferSelect;
export type IntegrationWebhook = typeof integrationWebhooks.$inferSelect;
export type IntegrationWebhookDelivery = typeof integrationWebhookDeliveries.$inferSelect;
export type CalendarEventLink = typeof calendarEventLinks.$inferSelect;
export type InsertRecurringIncome = z.infer<typeof insertRecurringIncomeSchema>;
export type RecurringIncome = typeof recurringIncomes.$inferSelect;
export type InsertObligation = z.infer<typeof insertObligationSchema>;
export type Obligation = typeof obligations.$inferSelect;
export type InsertVariableObligationMonthStatus = z.infer<typeof insertVariableObligationMonthStatusSchema>;
export type VariableObligationMonthStatus = typeof variableObligationMonthStatuses.$inferSelect;
export type InsertCommitment = z.infer<typeof insertCommitmentSchema>;
export type Commitment = typeof commitments.$inferSelect;
export type InsertCommitmentStep = z.infer<typeof insertCommitmentStepSchema>;
export type CommitmentStep = typeof commitmentSteps.$inferSelect;
export type InsertCommitmentProof = z.infer<typeof insertCommitmentProofSchema>;
export type CommitmentProof = typeof commitmentProofs.$inferSelect;
export type CommitmentAutomationSetting = typeof commitmentAutomationSettings.$inferSelect;
export type CommitmentOccurrence = typeof commitmentOccurrences.$inferSelect;
export type CommitmentAutomationLog = typeof commitmentAutomationLogs.$inferSelect;
export type InsertSavingsGoal = z.infer<typeof insertSavingsGoalSchema>;
export type SavingsGoal = typeof savingsGoals.$inferSelect;
export type InsertPasswordResetRequest = z.infer<typeof insertPasswordResetRequestSchema>;
export type PasswordResetRequest = typeof passwordResetRequests.$inferSelect;
