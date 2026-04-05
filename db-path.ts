import path from "path";
import { existsSync } from "fs";

const sourceFileDirectoryPath = path.resolve(process.cwd());

function findProjectRoot(startPath: string) {
  let currentPath = path.resolve(startPath);
  for (;;) {
    if (existsSync(path.join(currentPath, "package.json")) && existsSync(path.join(currentPath, "client"))) {
      return currentPath;
    }
    const parentPath = path.dirname(currentPath);
    if (parentPath === currentPath) break;
    currentPath = parentPath;
  }
  return startPath;
}

export const resolvedProjectRootPath = findProjectRoot(sourceFileDirectoryPath);

export const databaseUrl =
  process.env.DATABASE_URL?.trim() ||
  (() => { throw new Error("DATABASE_URL environment variable is required for PostgreSQL connection"); })();

export const backupRootPath = path.join(resolvedProjectRootPath, "backups", "eltizam-db");
