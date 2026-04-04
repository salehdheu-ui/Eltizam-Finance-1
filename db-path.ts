import { existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const projectRootPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const explicitDatabasePath = process.env.DATABASE_PATH?.trim();
const defaultDatabasePath = path.join(projectRootPath, "eltizam.db");
const workingDirectoryDatabasePath = path.resolve(process.cwd(), "eltizam.db");

const candidatePaths = Array.from(new Set([
  explicitDatabasePath,
  defaultDatabasePath,
  workingDirectoryDatabasePath,
].filter((value): value is string => Boolean(value))));

const existingDatabasePath = candidatePaths.find((candidatePath) => existsSync(candidatePath));

export const databasePath = explicitDatabasePath || existingDatabasePath || defaultDatabasePath;
export const backupRootPath = path.join(projectRootPath, "backups", "eltizam-db");
export const resolvedProjectRootPath = projectRootPath;
