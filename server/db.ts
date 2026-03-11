import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "@shared/schema";

export const sqliteDb = new Database("./eltizam.db");

export const db = drizzle(sqliteDb, { schema });

export function initializeDatabase() {
  sqliteDb.pragma("foreign_keys = ON");

  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT,
      role TEXT NOT NULL DEFAULT 'user',
      is_active INTEGER NOT NULL DEFAULT 1,
      last_login_at INTEGER,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS wallets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'cash',
      balance REAL NOT NULL DEFAULT 0,
      color TEXT NOT NULL DEFAULT 'from-slate-600 to-slate-800',
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'expense',
      icon TEXT NOT NULL DEFAULT '📝',
      color TEXT NOT NULL DEFAULT 'bg-orange-100 text-orange-600',
      budget REAL DEFAULT 0,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      wallet_id INTEGER,
      category_id INTEGER,
      type TEXT NOT NULL DEFAULT 'expense',
      amount REAL NOT NULL,
      note TEXT DEFAULT '',
      date INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (wallet_id) REFERENCES wallets(id),
      FOREIGN KEY (category_id) REFERENCES categories(id)
    );

    CREATE TABLE IF NOT EXISTS recurring_incomes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      amount REAL NOT NULL,
      income_type TEXT NOT NULL DEFAULT 'salary',
      day_of_month INTEGER NOT NULL,
      wallet_id INTEGER NOT NULL,
      category_id INTEGER,
      note TEXT DEFAULT '',
      is_active INTEGER NOT NULL DEFAULT 1,
      last_applied_month TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (wallet_id) REFERENCES wallets(id),
      FOREIGN KEY (category_id) REFERENCES categories(id)
    );

    CREATE TABLE IF NOT EXISTS obligations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      amount REAL NOT NULL,
      schedule_type TEXT NOT NULL DEFAULT 'fixed',
      obligation_type TEXT NOT NULL DEFAULT 'custom',
      frequency TEXT NOT NULL DEFAULT 'monthly',
      due_day INTEGER,
      due_month INTEGER,
      due_date INTEGER,
      start_date INTEGER NOT NULL DEFAULT (unixepoch()),
      end_date INTEGER,
      wallet_id INTEGER,
      category_id INTEGER,
      notes TEXT DEFAULT '',
      is_active INTEGER NOT NULL DEFAULT 1,
      auto_create_transaction INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (wallet_id) REFERENCES wallets(id),
      FOREIGN KEY (category_id) REFERENCES categories(id)
    );

    CREATE TABLE IF NOT EXISTS variable_obligation_month_statuses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      obligation_id INTEGER NOT NULL,
      month_key TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'unpaid',
      paid_at INTEGER,
      note TEXT DEFAULT '',
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (obligation_id) REFERENCES obligations(id)
    );
  `);

  sqliteDb.exec("CREATE UNIQUE INDEX IF NOT EXISTS users_username_unique ON users (username)");
  sqliteDb.exec("CREATE UNIQUE INDEX IF NOT EXISTS variable_obligation_month_statuses_unique_month ON variable_obligation_month_statuses (user_id, obligation_id, month_key)");
  sqliteDb.exec("CREATE INDEX IF NOT EXISTS variable_obligation_month_statuses_obligation_idx ON variable_obligation_month_statuses (obligation_id, month_key)");
}

export function ensureUserEmailUniqueIndex() {
  try {
    sqliteDb.exec("CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique ON users (email) WHERE email IS NOT NULL AND email <> ''");
  } catch (error) {
    console.warn("Skipping users_email_unique index creation because duplicate emails already exist", error);
  }
}

export function ensureUserPhoneColumns() {
  const existingColumns = sqliteDb.prepare("PRAGMA table_info(users)").all() as Array<{ name: string }>;
  const columnNames = new Set(existingColumns.map((column) => column.name));

  if (!columnNames.has("phone")) {
    sqliteDb.exec("ALTER TABLE users ADD COLUMN phone TEXT");
  }
}

export function ensureUserPhoneUniqueIndex() {
  try {
    sqliteDb.exec("CREATE UNIQUE INDEX IF NOT EXISTS users_phone_unique ON users (phone) WHERE phone IS NOT NULL AND phone <> ''");
  } catch (error) {
    console.warn("Skipping users_phone_unique index creation because duplicate phone numbers already exist", error);
  }
}

export function ensureUserAdminColumns() {
  const existingColumns = sqliteDb.prepare("PRAGMA table_info(users)").all() as Array<{ name: string }>;
  const columnNames = new Set(existingColumns.map((column) => column.name));

  if (!columnNames.has("role")) {
    sqliteDb.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'");
  }

  if (!columnNames.has("is_active")) {
    sqliteDb.exec("ALTER TABLE users ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1");
  }

  if (!columnNames.has("last_login_at")) {
    sqliteDb.exec("ALTER TABLE users ADD COLUMN last_login_at INTEGER");
  }

  if (!columnNames.has("created_at")) {
    sqliteDb.exec("ALTER TABLE users ADD COLUMN created_at INTEGER NOT NULL DEFAULT (unixepoch())");
  }
}

export function ensureVariableObligationMonthStatusesTable() {
  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS variable_obligation_month_statuses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      obligation_id INTEGER NOT NULL,
      month_key TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'unpaid',
      paid_at INTEGER,
      note TEXT DEFAULT '',
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (obligation_id) REFERENCES obligations(id)
    )
  `);

  sqliteDb.exec("CREATE UNIQUE INDEX IF NOT EXISTS variable_obligation_month_statuses_unique_month ON variable_obligation_month_statuses (user_id, obligation_id, month_key)");
  sqliteDb.exec("CREATE INDEX IF NOT EXISTS variable_obligation_month_statuses_obligation_idx ON variable_obligation_month_statuses (obligation_id, month_key)");
}
