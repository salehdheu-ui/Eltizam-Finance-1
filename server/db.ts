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
  {
    version: 8,
    name: "ensure_commitments_table",
    up: async () => { await ensureCommitmentsTable(); },
  },
  {
    version: 9,
    name: "ensure_commitment_steps_and_proofs",
    up: async () => { await ensureCommitmentStepsAndProofs(); },
  },
  {
    version: 10,
    name: "ensure_savings_goals_table",
    up: async () => { await ensureSavingsGoalsTable(); },
  },
  {
    version: 11,
    name: "ensure_bank_email_import_tables",
    up: async () => { await ensureBankEmailImportTables(); },
  },
  {
    version: 12,
    name: "ensure_integration_settings_table",
    up: async () => { await ensureIntegrationSettingsTable(); },
  },
  {
    version: 13,
    name: "ensure_bank_email_custom_senders_column",
    up: async () => { await ensureBankEmailCustomSendersColumn(); },
  },
  {
    version: 14,
    name: "ensure_bank_email_event_analysis_columns",
    up: async () => { await ensureBankEmailEventAnalysisColumns(); },
  },
  {
    version: 15,
    name: "ensure_bank_email_transaction_fk_set_null",
    up: async () => { await ensureBankEmailTransactionForeignKey(); },
  },
  {
    version: 16,
    name: "ensure_bank_email_account_scope_columns",
    up: async () => { await ensureBankEmailAccountScopeColumns(); },
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

async function ensureCommitmentsTable() {
  await pgExec(`
    CREATE TABLE IF NOT EXISTS commitments (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      title TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'personal',
      status TEXT NOT NULL DEFAULT 'active',
      frequency TEXT NOT NULL DEFAULT 'one_time',
      due_date INTEGER,
      amount DOUBLE PRECISION,
      person_name TEXT,
      asset_name TEXT,
      notes TEXT DEFAULT '',
      created_at INTEGER NOT NULL DEFAULT extract(epoch from now())::integer,
      updated_at INTEGER NOT NULL DEFAULT extract(epoch from now())::integer
    )
  `);

  await pgExec("CREATE INDEX IF NOT EXISTS commitments_user_status_idx ON commitments (user_id, status, due_date)");
  await pgExec("CREATE INDEX IF NOT EXISTS commitments_user_due_idx ON commitments (user_id, due_date)");
}
async function ensureCommitmentStepsAndProofs() {
  await pgExec(`
    CREATE TABLE IF NOT EXISTS commitment_steps (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      commitment_id INTEGER NOT NULL REFERENCES commitments(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      is_completed BOOLEAN NOT NULL DEFAULT false,
      completed_at INTEGER,
      created_at INTEGER NOT NULL DEFAULT extract(epoch from now())::integer
    );

    CREATE TABLE IF NOT EXISTS commitment_proofs (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      commitment_id INTEGER NOT NULL REFERENCES commitments(id) ON DELETE CASCADE,
      kind TEXT NOT NULL DEFAULT 'note',
      label TEXT NOT NULL,
      value TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT extract(epoch from now())::integer
    );
  `);

  await pgExec("CREATE INDEX IF NOT EXISTS commitment_steps_commitment_idx ON commitment_steps (user_id, commitment_id, position)");
  await pgExec("CREATE INDEX IF NOT EXISTS commitment_proofs_commitment_idx ON commitment_proofs (user_id, commitment_id, created_at DESC)");
}
async function ensureSavingsGoalsTable() {
  await pgExec(`
    CREATE TABLE IF NOT EXISTS savings_goals (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      plan_id TEXT NOT NULL,
      plan_title TEXT NOT NULL,
      title TEXT NOT NULL,
      wallet_id INTEGER NOT NULL REFERENCES wallets(id),
      target_amount DOUBLE PRECISION NOT NULL,
      monthly_amount DOUBLE PRECISION NOT NULL,
      years INTEGER NOT NULL DEFAULT 5,
      created_at INTEGER NOT NULL DEFAULT extract(epoch from now())::integer,
      updated_at INTEGER NOT NULL DEFAULT extract(epoch from now())::integer
    )
  `);

  await pgExec("CREATE INDEX IF NOT EXISTS savings_goals_user_created_idx ON savings_goals (user_id, created_at DESC)");
  await pgExec("CREATE INDEX IF NOT EXISTS savings_goals_wallet_idx ON savings_goals (user_id, wallet_id)");
}

async function ensureBankEmailImportTables() {
  await pgExec(`
    CREATE TABLE IF NOT EXISTS bank_email_connections (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      provider TEXT NOT NULL DEFAULT 'google',
      email TEXT NOT NULL,
      bank_key TEXT NOT NULL,
      wallet_id INTEGER NOT NULL REFERENCES wallets(id),
      auto_import BOOLEAN NOT NULL DEFAULT true,
      access_token_encrypted TEXT,
      refresh_token_encrypted TEXT,
      token_expires_at INTEGER,
      last_sync_at INTEGER,
      created_at INTEGER NOT NULL DEFAULT extract(epoch from now())::integer,
      updated_at INTEGER NOT NULL DEFAULT extract(epoch from now())::integer,
      UNIQUE(user_id, provider, email, bank_key)
    );

    CREATE TABLE IF NOT EXISTS bank_email_events (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      connection_id INTEGER NOT NULL REFERENCES bank_email_connections(id) ON DELETE CASCADE,
      provider_message_id TEXT NOT NULL,
      fingerprint TEXT NOT NULL,
      bank_key TEXT NOT NULL,
      sender TEXT DEFAULT '',
      subject TEXT DEFAULT '',
      snippet TEXT DEFAULT '',
      received_at INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'review',
      transaction_type TEXT,
      amount DOUBLE PRECISION,
      merchant TEXT,
      category_id INTEGER REFERENCES categories(id),
      commitment_id INTEGER REFERENCES commitments(id),
      transaction_id INTEGER REFERENCES transactions(id) ON DELETE SET NULL,
      created_at INTEGER NOT NULL DEFAULT extract(epoch from now())::integer,
      UNIQUE(user_id, connection_id, provider_message_id),
      UNIQUE(user_id, fingerprint)
    )
  `);

  await pgExec("CREATE INDEX IF NOT EXISTS bank_email_connections_user_idx ON bank_email_connections (user_id, provider)");
  await pgExec("CREATE INDEX IF NOT EXISTS bank_email_events_user_status_idx ON bank_email_events (user_id, status, received_at DESC)");
}

async function ensureIntegrationSettingsTable() {
  await pgExec(`
    CREATE TABLE IF NOT EXISTS integration_settings (
      id SERIAL PRIMARY KEY,
      provider TEXT NOT NULL UNIQUE,
      client_id TEXT NOT NULL,
      client_secret_encrypted TEXT NOT NULL,
      tenant_id TEXT,
      redirect_uri TEXT,
      is_enabled BOOLEAN NOT NULL DEFAULT true,
      updated_by_user_id INTEGER REFERENCES users(id),
      created_at INTEGER NOT NULL DEFAULT extract(epoch from now())::integer,
      updated_at INTEGER NOT NULL DEFAULT extract(epoch from now())::integer
    )
  `);

  await pgExec("CREATE UNIQUE INDEX IF NOT EXISTS integration_settings_provider_unique ON integration_settings (provider)");
}

async function ensureBankEmailCustomSendersColumn() {
  if (!(await columnExists("bank_email_connections", "custom_senders"))) {
    await pgExec("ALTER TABLE bank_email_connections ADD COLUMN custom_senders TEXT");
  }
}

/**
 * The event row remembers which transaction it produced. Left as NO ACTION that
 * reference blocks deleting the transaction at all — which broke deleting an
 * imported transaction, resetting a connection, and removing a user. Setting it
 * to NULL on delete keeps the link honest without holding the transaction hostage.
 */
async function ensureBankEmailAccountScopeColumns() {
  if (!(await columnExists("bank_email_connections", "account_filter"))) {
    await pgExec("ALTER TABLE bank_email_connections ADD COLUMN account_filter TEXT");
  }
  if (!(await columnExists("bank_email_events", "account_ref"))) {
    await pgExec("ALTER TABLE bank_email_events ADD COLUMN account_ref TEXT");
  }
}

async function ensureBankEmailTransactionForeignKey() {
  await pgExec("ALTER TABLE bank_email_events DROP CONSTRAINT IF EXISTS bank_email_events_transaction_id_fkey");
  await pgExec("ALTER TABLE bank_email_events ADD CONSTRAINT bank_email_events_transaction_id_fkey FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE SET NULL");
}

async function ensureBankEmailEventAnalysisColumns() {
  const columns: Array<[string, string]> = [
    ["direction", "TEXT"],
    ["channel", "TEXT"],
    ["balance_after", "DOUBLE PRECISION"],
    ["gap_amount", "DOUBLE PRECISION"],
    ["counterparty", "TEXT"],
    ["from_account", "TEXT"],
    ["to_account", "TEXT"],
    ["reference", "TEXT"],
  ];

  for (const [name, type] of columns) {
    if (!(await columnExists("bank_email_events", name))) {
      await pgExec(`ALTER TABLE bank_email_events ADD COLUMN ${name} ${type}`);
    }
  }

  // Existing rows predate direction tracking; derive it from the type we did store.
  await pgExec("UPDATE bank_email_events SET direction = CASE WHEN transaction_type = 'income' THEN 'credit' ELSE 'debit' END WHERE direction IS NULL AND transaction_type IS NOT NULL");
  await pgExec("CREATE INDEX IF NOT EXISTS bank_email_events_connection_received_idx ON bank_email_events (connection_id, received_at DESC)");
}