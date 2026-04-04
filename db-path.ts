import { existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const sourceFileDirectoryPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const entryFilePath = process.argv[1] ? path.resolve(process.argv[1]) : sourceFileDirectoryPath;
const entryFileDirectoryPath = path.dirname(entryFilePath);
const workingDirectoryPath = path.resolve(process.cwd());
const explicitDatabasePath = process.env.DATABASE_PATH?.trim();

function collectParentDirectories(startPath: string) {
  const directories: string[] = [];
  let currentPath = path.resolve(startPath);

  for (;;) {
    directories.push(currentPath);
    const parentPath = path.dirname(currentPath);
    if (parentPath === currentPath) {
      break;
    }
    currentPath = parentPath;
  }

  return directories;
}

function isProjectRoot(directoryPath: string) {
  return existsSync(path.join(directoryPath, "package.json")) && existsSync(path.join(directoryPath, "client"));
}

const searchableDirectories = Array.from(new Set([
  ...collectParentDirectories(workingDirectoryPath),
  ...collectParentDirectories(entryFileDirectoryPath),
  ...collectParentDirectories(sourceFileDirectoryPath),
]));

const detectedProjectRootPath = searchableDirectories.find((directoryPath) => isProjectRoot(directoryPath)) || sourceFileDirectoryPath;
const existingDatabasePath = searchableDirectories
  .map((directoryPath) => path.join(directoryPath, "eltizam.db"))
  .find((candidatePath) => existsSync(candidatePath));
const defaultDatabasePath = path.join(detectedProjectRootPath, "eltizam.db");

export const resolvedProjectRootPath = detectedProjectRootPath;
export const databasePath = explicitDatabasePath || existingDatabasePath || defaultDatabasePath;
export const backupRootPath = path.join(resolvedProjectRootPath, "backups", "eltizam-db");
