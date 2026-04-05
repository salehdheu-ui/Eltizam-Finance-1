import { exec } from "child_process";
import { promisify } from "util";
import path from "path";
import { mkdir, readdir, rm, writeFile } from "fs/promises";
import { backupRootPath } from "../db-path";

const execAsync = promisify(exec);

const dailyDirectoryPath = path.join(backupRootPath, "daily");
const weeklyDirectoryPath = path.join(backupRootPath, "weekly");
const annualDirectoryPath = path.join(backupRootPath, "annual");
const manualDirectoryPath = path.join(backupRootPath, "manual");
const dailyRetentionCount = 7;
const weeklyRetentionCount = 4;
const annualRetentionCount = 1;
const manualRetentionCount = 20;

export type BackupFrequency = "daily" | "weekly" | "annual" | "manual";

export type BackupRecord = {
  fileName: string;
  filePath: string;
  frequency: BackupFrequency;
};

function formatDateParts(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  return { year, month, day, hours, minutes, seconds };
}

function getIsoWeekInfo(date: Date) {
  const normalizedDate = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNumber = normalizedDate.getUTCDay() || 7;
  normalizedDate.setUTCDate(normalizedDate.getUTCDate() + 4 - dayNumber);
  const yearStart = new Date(Date.UTC(normalizedDate.getUTCFullYear(), 0, 1));
  const weekNumber = Math.ceil((((normalizedDate.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return {
    isoYear: normalizedDate.getUTCFullYear(),
    isoWeek: String(weekNumber).padStart(2, "0"),
  };
}

function getBackupDirectory(frequency: BackupFrequency) {
  switch (frequency) {
    case "daily":
      return dailyDirectoryPath;
    case "weekly":
      return weeklyDirectoryPath;
    case "annual":
      return annualDirectoryPath;
    case "manual":
      return manualDirectoryPath;
  }
}

function getRetentionCount(frequency: BackupFrequency) {
  switch (frequency) {
    case "daily":
      return dailyRetentionCount;
    case "weekly":
      return weeklyRetentionCount;
    case "annual":
      return annualRetentionCount;
    case "manual":
      return manualRetentionCount;
  }
}

function buildBackupFileName(date: Date, frequency: BackupFrequency) {
  const { year, month, day, hours, minutes, seconds } = formatDateParts(date);

  if (frequency === "annual") {
    return `eltizam-${year}-annual.sql`;
  }

  if (frequency === "weekly") {
    const { isoYear, isoWeek } = getIsoWeekInfo(date);
    return `eltizam-${isoYear}-week-${isoWeek}.sql`;
  }

  if (frequency === "manual") {
    return `eltizam-${year}-${month}-${day}-${hours}${minutes}${seconds}-manual.sql`;
  }

  return `eltizam-${year}-${month}-${day}.sql`;
}

async function ensureDirectory(directoryPath: string) {
  await mkdir(directoryPath, { recursive: true });
}

async function listBackupFilesInDirectory(directoryPath: string, frequency: BackupFrequency): Promise<BackupRecord[]> {
  await ensureDirectory(directoryPath);
  const entries = await readdir(directoryPath, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => ({
      fileName: entry.name,
      filePath: path.join(directoryPath, entry.name),
      frequency,
    }))
    .sort((a, b) => b.fileName.localeCompare(a.fileName));
}

async function pruneBackups(frequency: BackupFrequency) {
  const directoryPath = getBackupDirectory(frequency);
  const files = await listBackupFilesInDirectory(directoryPath, frequency);
  const retainCount = getRetentionCount(frequency);
  const filesToDelete = files.slice(retainCount);

  for (const file of filesToDelete) {
    await rm(file.filePath, { force: true });
  }
}

async function backupDatabaseToFile(targetFilePath: string) {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.warn("DATABASE_URL not set, skipping backup");
    return;
  }

  try {
    const { stdout } = await execAsync(`pg_dump "${dbUrl}" --no-owner --no-acl`);
    await writeFile(targetFilePath, stdout, "utf8");
  } catch (error) {
    console.warn("pg_dump not available or failed, creating metadata-only backup", error);
    const timestamp = new Date().toISOString();
    await writeFile(targetFilePath, `-- Backup marker created at ${timestamp}\n-- pg_dump was not available\n`, "utf8");
  }
}

async function createBackupIfMissing(frequency: BackupFrequency, date: Date) {
  const directoryPath = getBackupDirectory(frequency);
  await ensureDirectory(directoryPath);
  const backupFileName = buildBackupFileName(date, frequency);
  const backupFilePath = path.join(directoryPath, backupFileName);
  const existingFiles = await listBackupFilesInDirectory(directoryPath, frequency);
  const alreadyExists = existingFiles.some((file) => file.fileName === backupFileName);

  if (alreadyExists) {
    return { created: false, filePath: backupFilePath, fileName: backupFileName };
  }

  await backupDatabaseToFile(backupFilePath);
  return { created: true, filePath: backupFilePath, fileName: backupFileName };
}

function shouldCreateWeeklyBackup(date: Date) {
  return date.getDay() === 6;
}

function shouldCreateAnnualBackup(date: Date) {
  return date.getMonth() === 11 && date.getDate() === 31;
}

export async function runBackupRetentionJob(date = new Date()) {
  await Promise.all([
    ensureDirectory(dailyDirectoryPath),
    ensureDirectory(weeklyDirectoryPath),
    ensureDirectory(annualDirectoryPath),
    ensureDirectory(manualDirectoryPath),
  ]);

  const createdBackups: Array<{ frequency: BackupFrequency; fileName: string; filePath: string; created: boolean }> = [];

  createdBackups.push({ frequency: "daily", ...(await createBackupIfMissing("daily", date)) });
  await pruneBackups("daily");

  if (shouldCreateWeeklyBackup(date)) {
    createdBackups.push({ frequency: "weekly", ...(await createBackupIfMissing("weekly", date)) });
  }
  await pruneBackups("weekly");

  if (shouldCreateAnnualBackup(date)) {
    createdBackups.push({ frequency: "annual", ...(await createBackupIfMissing("annual", date)) });
  }
  await pruneBackups("annual");

  await pruneBackups("manual");

  return createdBackups;
}

export async function createManualBackup(date = new Date()) {
  const result = await createBackupIfMissing("manual", date);
  await pruneBackups("manual");
  return { frequency: "manual" as const, ...result };
}

export async function listAllBackups() {
  const [daily, weekly, annual, manual] = await Promise.all([
    listBackupFilesInDirectory(dailyDirectoryPath, "daily"),
    listBackupFilesInDirectory(weeklyDirectoryPath, "weekly"),
    listBackupFilesInDirectory(annualDirectoryPath, "annual"),
    listBackupFilesInDirectory(manualDirectoryPath, "manual"),
  ]);

  return {
    daily,
    weekly,
    annual,
    manual,
  };
}
