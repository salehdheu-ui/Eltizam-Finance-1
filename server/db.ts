import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@shared/schema";
import { databaseUrl } from "../db-path";

const pool = new pg.Pool({ connectionString: databaseUrl });

export const db = drizzle(pool, { schema });

type DatabaseMigration = {
  version: number;
  name: string;
  up: () => Promise<void>;
};

async function pgExec(sql: string) {
  await pool.query(sql);
}

async function pgQuery<T extends Record<string, unknown> = Record<string, unknown>>(sql: string): Promise<T[]> {
  const result = await pool.query(sql);
  return result.rows as T[];
}

const databaseMigrations: DatabaseMigration[] = [
  {
    version: 1,
    name: "initialize_core_tables",
    up: async () => { await initializeDatabase(); },
  },
  {
    version: 2,
    name: "ensure_user_phone_columns",
    up: async () => { await ensureUserPhoneColumns(); },
  },
  {
    version: 3,
    name: "ensure_user_admin_columns",
    up: async () => { await ensureUserAdminColumns(); },
  },
  {
    version: 4,
    name: "ensure_user_email_unique_index",
    up: async () => { await ensureUserEmailUniqueIndex(); },
  },
  {
    version: 5,
    name: "ensure_user_phone_unique_index",
    up: async () => { await ensureUserPhoneUniqueIndex(); },
  },
  {
    version: 6,
    name: "ensure_variable_obligation_month_statuses_table",
    up: async () => { await ensureVariableObligationMonthStatusesTable(); },
  },
  {
    version: 7,
    name: "ensure_password_reset_requests_table",
    up: async () => { await ensurePasswordResetRequestsTable(); },
  },
];

async function ensureSchemaMigrationsTable() {
  await pgExec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at INTEGER NOT NULL DEFAULT extract(epoch from now())::integer
    )
  `);
}

async function getAppliedMigrationVersions() {
  await ensureSchemaMigrationsTable();
  const rows = await pgQuery<{ version: number }>("SELECT version FROM schema_migrations ORDER BY version ASC");
  return new Set(rows.map((row) => row.version));
}

async function getPendingMigrations() {
  const appliedVersions = await getAppliedMigrationVersions();
  return databaseMigrations.filter((migration) => !appliedVersions.has(migration.version));
}

async function hasExistingUserTables() {
  const rows = await pgQuery<{ tablename: string }>(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'schema_migrations'"
  );
  return rows.length > 0;
}

export async function getCurrentDatabaseSchemaVersion() {
  await ensureSchemaMigrationsTable();
  const rows = await pgQuery<{ version: number | null }>("SELECT MAX(version) as version FROM schema_migrations");
  return rows[0]?.version ?? 0;
}

export async function migrateDatabase() {
  await ensureSchemaMigrationsTable();
  const pendingMigrations = await getPendingMigrations();

  if (pendingMigrations.length === 0) {
    return { appliedCount: 0, targetVersion: await getCurrentDatabaseSchemaVersion(), backupCreated: false };
  }

  const shouldCreateBackup = await hasExistingUserTables();

  for (const migration of pendingMigrations) {
    await migration.up();
    await pgExec(`INSERT INTO schema_migrations (version, name) VALUES (${migration.version}, '${migration.name}')`);
  }

  return {
    appliedCount: pendingMigrations.length,
    targetVersion: pendingMigrations[pendingMigrations.length - 1]?.version ?? await getCurrentDatabaseSchemaVersion(),
    backupCreated: shouldCreateBackup,
  };
}

async function columnExists(tableName: string, columnName: string): Promise<boolean> {
  const rows = await pgQuery<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = '${tableName}' AND column_name = '${columnName}'`
  );
  return rows.length > 0;
}

async function initializeDatabase() {
  await pgExec(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT,
      role TEXT NOT NULL DEFAULT 'user',
      is_active BOOLEAN NOT NULL DEFAULT true,
      last_login_at INTEGER,
      created_at INTEGER NOT NULL DEFAULT extract(epoch from now())::integer
    );

    CREATE TABLE IF NOT EXISTS wallets (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'cash',
      balance DOUBLE PRECISION NOT NULL DEFAULT 0,
      color TEXT NOT NULL DEFAULT 'from-slate-600 to-slate-800'
    );

    CREATE TABLE IF NOT EXISTS categories (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'expense',
      icon TEXT NOT NULL DEFAULT '📝',
      color TEXT NOT NULL DEFAULT 'bg-orange-100 text-orange-600',
      budget DOUBLE PRECISION DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      wallet_id INTEGER REFERENCES wallets(id),
      category_id INTEGER REFERENCES categories(id),
      type TEXT NOT NULL DEFAULT 'expense',
      amount DOUBLE PRECISION NOT NULL,
      note TEXT DEFAULT '',
      date INTEGER NOT NULL DEFAULT extract(epoch from now())::integer
    );

    CREATE TABLE IF NOT EXISTS recurring_incomes (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      title TEXT NOT NULL,
      amount DOUBLE PRECISION NOT NULL,
      income_type TEXT NOT NULL DEFAULT 'salary',
      day_of_month INTEGER NOT NULL,
      wallet_id INTEGER NOT NULL REFERENCES wallets(id),
      category_id INTEGER REFERENCES categories(id),
      note TEXT DEFAULT '',
      is_active BOOLEAN NOT NULL DEFAULT true,
      last_applied_month TEXT,
      created_at INTEGER NOT NULL DEFAULT extract(epoch from now())::integer,
      updated_at INTEGER NOT NULL DEFAULT extract(epoch from now())::integer
    );

    CREATE TABLE IF NOT EXISTS obligations (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      title TEXT NOT NULL,
      amount DOUBLE PRECISION NOT NULL,
      schedule_type TEXT NOT NULL DEFAULT 'fixed',
      obligation_type TEXT NOT NULL DEFAULT 'custom',
      frequency TEXT NOT NULL DEFAULT 'monthly',
      due_day INTEGER,
      due_month INTEGER,
      due_date INTEGER,
      start_date INTEGER NOT NULL DEFAULT extract(epoch from now())::integer,
      end_date INTEGER,
      wallet_id INTEGER REFERENCES wallets(id),
      category_id INTEGER REFERENCES categories(id),
      notes TEXT DEFAULT '',
      is_active BOOLEAN NOT NULL DEFAULT true,
      auto_create_transaction BOOLEAN NOT NULL DEFAULT false,
      created_at INTEGER NOT NULL DEFAULT extract(epoch from now())::integer,
      updated_at INTEGER NOT NULL DEFAULT extract(epoch from now())::integer
    );

    CREATE TABLE IF NOT EXISTS variable_obligation_month_statuses (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      obligation_id INTEGER NOT NULL REFERENCES obligations(id),
      month_key TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'unpaid',
      paid_at INTEGER,
      note TEXT DEFAULT '',
      created_at INTEGER NOT NULL DEFAULT extract(epoch from now())::integer,
      updated_at INTEGER NOT NULL DEFAULT extract(epoch from now())::integer
    );
  `);

  await pgExec("CREATE UNIQUE INDEX IF NOT EXISTS users_username_unique ON users (username)");
  await pgExec("CREATE UNIQUE INDEX IF NOT EXISTS variable_obligation_month_statuses_unique_month ON variable_obligation_month_statuses (user_id, obligation_id, month_key)");
  await pgExec("CREATE INDEX IF NOT EXISTS variable_obligation_month_statuses_obligation_idx ON variable_obligation_month_statuses (obligation_id, month_key)");
}

async function ensureUserEmailUniqueIndex() {
  try {
    await pgExec("CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique ON users (email) WHERE email IS NOT NULL AND email <> ''");
  } catch (error) {
    console.warn("Skipping users_email_unique index creation because duplicate emails already exist", error);
  }
}

async function ensureUserPhoneColumns() {
  if (!(await columnExists("users", "phone"))) {
    await pgExec("ALTER TABLE users ADD COLUMN phone TEXT");
  }
}

async function ensureUserPhoneUniqueIndex() {
  try {
    await pgExec("CREATE UNIQUE INDEX IF NOT EXISTS users_phone_unique ON users (phone) WHERE phone IS NOT NULL AND phone <> ''");
  } catch (error) {
    console.warn("Skipping users_phone_unique index creation because duplicate phone numbers already exist", error);
  }
}

async function ensureUserAdminColumns() {
  if (!(await columnExists("users", "role"))) {
    await pgExec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'");
  }
  if (!(await columnExists("users", "is_active"))) {
    await pgExec("ALTER TABLE users ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT true");
  }
  if (!(await columnExists("users", "last_login_at"))) {
    await pgExec("ALTER TABLE users ADD COLUMN last_login_at INTEGER");
  }
  if (!(await columnExists("users", "created_at"))) {
    await pgExec("ALTER TABLE users ADD COLUMN created_at INTEGER NOT NULL DEFAULT extract(epoch from now())::integer");
  }
}

async function ensureVariableObligationMonthStatusesTable() {
  await pgExec(`
    CREATE TABLE IF NOT EXISTS variable_obligation_month_statuses (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      obligation_id INTEGER NOT NULL REFERENCES obligations(id),
      month_key TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'unpaid',
      paid_at INTEGER,
      note TEXT DEFAULT '',
      created_at INTEGER NOT NULL DEFAULT extract(epoch from now())::integer,
      updated_at INTEGER NOT NULL DEFAULT extract(epoch from now())::integer
    )
  `);

  await pgExec("CREATE UNIQUE INDEX IF NOT EXISTS variable_obligation_month_statuses_unique_month ON variable_obligation_month_statuses (user_id, obligation_id, month_key)");
  await pgExec("CREATE INDEX IF NOT EXISTS variable_obligation_month_statuses_obligation_idx ON variable_obligation_month_statuses (obligation_id, month_key)");
}

async function ensurePasswordResetRequestsTable() {
  await pgExec(`
    CREATE TABLE IF NOT EXISTS password_reset_requests (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      status TEXT NOT NULL DEFAULT 'pending',
      verification_method TEXT NOT NULL DEFAULT 'admin',
      requested_by_identifier TEXT NOT NULL,
      contact_value TEXT,
      reset_token TEXT,
      reset_token_expires_at INTEGER,
      admin_user_id INTEGER REFERENCES users(id),
      created_at INTEGER NOT NULL DEFAULT extract(epoch from now())::integer,
      resolved_at INTEGER
    )
  `);

  await pgExec("CREATE INDEX IF NOT EXISTS password_reset_requests_user_idx ON password_reset_requests (user_id, created_at DESC)");
  await pgExec("CREATE INDEX IF NOT EXISTS password_reset_requests_status_idx ON password_reset_requests (status, created_at DESC)");
  await pgExec("CREATE UNIQUE INDEX IF NOT EXISTS password_reset_requests_token_unique ON password_reset_requests (reset_token) WHERE reset_token IS NOT NULL");
}
