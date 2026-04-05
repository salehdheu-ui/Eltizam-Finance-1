import pg from "pg";
import { databaseUrl } from "../db-path";

if (process.env.ALLOW_DB_RESET !== "true") {
  throw new Error("Database reset is blocked to protect existing data. Set ALLOW_DB_RESET=true only when you explicitly want to destroy the database.");
}

console.log("Resetting database...");

const pool = new pg.Pool({ connectionString: databaseUrl });

try {
  await pool.query(`
    DROP TABLE IF EXISTS password_reset_requests CASCADE;
    DROP TABLE IF EXISTS variable_obligation_month_statuses CASCADE;
    DROP TABLE IF EXISTS recurring_incomes CASCADE;
    DROP TABLE IF EXISTS transactions CASCADE;
    DROP TABLE IF EXISTS obligations CASCADE;
    DROP TABLE IF EXISTS categories CASCADE;
    DROP TABLE IF EXISTS wallets CASCADE;
    DROP TABLE IF EXISTS users CASCADE;
    DROP TABLE IF EXISTS schema_migrations CASCADE;
  `);

  console.log("Tables dropped");
  console.log("Database reset complete!");
  console.log("You can now run npm run db:migrate to recreate the schema.");
} finally {
  await pool.end();
}
