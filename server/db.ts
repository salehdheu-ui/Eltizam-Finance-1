import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "@shared/schema";
import { databasePath } from "../db-path";
import { createManualBackup } from "./backup";

export const sqliteDb = new Database(databasePath);

export const db = drizzle(sqliteDb, { schema });

type DatabaseMigration = {
  version: number;
  name: string;
  up: () => void;
};

const databaseMigrations: DatabaseMigration[] = [
  {
    version: 1,
    name: "initialize_core_tables",
    up: () => {
      initializeDatabase();
    },
  },
  {
    version: 2,
    name: "ensure_user_phone_columns",
    up: () => {
      ensureUserPhoneColumns();
    },
  },
  {
    version: 3,
    name: "ensure_user_admin_columns",
    up: () => {
      ensureUserAdminColumns();
    },
  },
  {
    version: 4,
    name: "ensure_user_email_unique_index",
    up: () => {
      ensureUserEmailUniqueIndex();
    },
  },
  {
    version: 5,
    name: "ensure_user_phone_unique_index",
    up: () => {
      ensureUserPhoneUniqueIndex();
    },
  },
  {
    version: 6,
    name: "ensure_variable_obligation_month_statuses_table",
    up: () => {
      ensureVariableObligationMonthStatusesTable();
    },
  },
  {
    version: 7,
    name: "ensure_password_reset_requests_table",
    up: () => {
      ensurePasswordResetRequestsTable();
    },
  },
];

function ensureSchemaMigrationsTable() {
  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);
}

function getAppliedMigrationVersions() {
  ensureSchemaMigrationsTable();
  const rows = sqliteDb.prepare("SELECT version FROM schema_migrations ORDER BY version ASC").all() as Array<{ version: number }>;
  return new Set(rows.map((row) => row.version));
}

function getPendingMigrations() {
  const appliedVersions = getAppliedMigrationVersions();
  return databaseMigrations.filter((migration) => !appliedVersions.has(migration.version));
}

function hasExistingUserTables() {
  const rows = sqliteDb.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> 'schema_migrations'").all() as Array<{ name: string }>;
  return rows.length > 0;
}

export function getCurrentDatabaseSchemaVersion() {
  ensureSchemaMigrationsTable();
  const row = sqliteDb.prepare("SELECT MAX(version) as version FROM schema_migrations").get() as { version: number | null } | undefined;
  return row?.version ?? 0;
}

export async function migrateDatabase() {
  sqliteDb.pragma("foreign_keys = ON");
  ensureSchemaMigrationsTable();
  const pendingMigrations = getPendingMigrations();

  if (pendingMigrations.length === 0) {
    return { appliedCount: 0, targetVersion: getCurrentDatabaseSchemaVersion(), backupCreated: false };
  }

  const shouldCreateBackup = hasExistingUserTables();
  if (shouldCreateBackup) {
    await createManualBackup();
  }

  const insertMigration = sqliteDb.prepare("INSERT INTO schema_migrations (version, name) VALUES (?, ?)");
  const runMigration = sqliteDb.transaction((migration: DatabaseMigration) => {
    migration.up();
    insertMigration.run(migration.version, migration.name);
  });

  for (const migration of pendingMigrations) {
    runMigration(migration);
  }

  return {
    appliedCount: pendingMigrations.length,
    targetVersion: pendingMigrations[pendingMigrations.length - 1]?.version ?? getCurrentDatabaseSchemaVersion(),
    backupCreated: shouldCreateBackup,
  };
}

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


export function ensurePasswordResetRequestsTable() {
  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS password_reset_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      verification_method TEXT NOT NULL DEFAULT 'admin',
      requested_by_identifier TEXT NOT NULL,
      contact_value TEXT,
      reset_token TEXT,
      reset_token_expires_at INTEGER,
      admin_user_id INTEGER,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      resolved_at INTEGER,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (admin_user_id) REFERENCES users(id)
    )
  `);

  sqliteDb.exec("CREATE INDEX IF NOT EXISTS password_reset_requests_user_idx ON password_reset_requests (user_id, created_at DESC)");
  sqliteDb.exec("CREATE INDEX IF NOT EXISTS password_reset_requests_status_idx ON password_reset_requests (status, created_at DESC)");
  sqliteDb.exec("CREATE UNIQUE INDEX IF NOT EXISTS password_reset_requests_token_unique ON password_reset_requests (reset_token) WHERE reset_token IS NOT NULL");
}
