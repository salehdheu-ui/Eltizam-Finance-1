import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { databasePath } from "../db-path";
import * as schema from "../shared/schema";

if (process.env.ALLOW_DB_RESET !== "true") {
  throw new Error("Database reset is blocked to protect existing data. Set ALLOW_DB_RESET=true only when you explicitly want to destroy the database.");
}

console.log("Resetting database...");

const sqliteDb = new Database(databasePath);

// Drop existing tables
sqliteDb.exec(`
  DROP TABLE IF EXISTS transactions;
  DROP TABLE IF EXISTS wallets;
  DROP TABLE IF EXISTS categories;
  DROP TABLE IF EXISTS users;
`);

console.log("Tables dropped");

const db = drizzle(sqliteDb, { schema });

// Create tables by running the schema
const { users, wallets, categories, transactions } = schema;

console.log("Database reset complete!");
console.log("You can now register a new account.");

sqliteDb.close();
