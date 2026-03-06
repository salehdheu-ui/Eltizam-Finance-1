import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, real, timestamp, serial } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  name: text("name").notNull(),
  email: text("email").notNull(),
});

export const wallets = pgTable("wallets", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  name: text("name").notNull(),
  type: text("type").notNull().default("cash"),
  balance: real("balance").notNull().default(0),
  color: text("color").notNull().default("from-slate-600 to-slate-800"),
});

export const categories = pgTable("categories", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  name: text("name").notNull(),
  type: text("type").notNull().default("expense"),
  icon: text("icon").notNull().default("📝"),
  color: text("color").notNull().default("bg-orange-100 text-orange-600"),
  budget: real("budget").default(0),
});

export const transactions = pgTable("transactions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  walletId: integer("wallet_id").references(() => wallets.id),
  categoryId: integer("category_id").references(() => categories.id),
  type: text("type").notNull().default("expense"),
  amount: real("amount").notNull(),
  note: text("note").default(""),
  date: timestamp("date").notNull().defaultNow(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
  name: true,
  email: true,
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
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type InsertWallet = z.infer<typeof insertWalletSchema>;
export type Wallet = typeof wallets.$inferSelect;
export type InsertCategory = z.infer<typeof insertCategorySchema>;
export type Category = typeof categories.$inferSelect;
export type InsertTransaction = z.infer<typeof insertTransactionSchema>;
export type Transaction = typeof transactions.$inferSelect;
