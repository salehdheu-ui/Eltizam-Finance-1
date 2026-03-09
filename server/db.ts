import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "@shared/schema";

export const sqliteDb = new Database("./eltizam.db");

export const db = drizzle(sqliteDb, { schema });

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
