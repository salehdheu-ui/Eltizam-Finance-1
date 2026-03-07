import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "@shared/schema";

const sqliteDb = new Database("./eltizam.db");

export const db = drizzle(sqliteDb, { schema });
