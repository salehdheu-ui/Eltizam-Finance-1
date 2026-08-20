import { spawn } from "child_process";
import { createWriteStream } from "fs";
import { once } from "events";
import { pipeline } from "stream/promises";
import path from "path";
import { mkdir, open, readdir, rename, rm, stat } from "fs/promises";
import { backupRootPath } from "../db-path";

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
  sizeBytes: number;
  isValid: boolean;
};

export type PublicBackupRecord = Omit<BackupRecord, "filePath">;

export function toPublicBackupRecord(backup: BackupRecord): PublicBackupRecord {
  return {
    fileName: backup.fileName,
    frequency: backup.frequency,
    sizeBytes: backup.sizeBytes,
    isValid: backup.isValid,
  };
}

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

async function inspectBackupFile(filePath: string) {
  const metadata = await stat(filePath);
  let prefix = "";
  const handle = await open(filePath, "r");
  try {
    const buffer = Buffer.alloc(256);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    prefix = buffer.subarray(0, bytesRead).toString("utf8");
  } finally {
    await handle.close();
  }

  const isMarker = prefix.includes("pg_dump was not available") || prefix.includes("Backup marker created");
  return { sizeBytes: metadata.size, isValid: metadata.size > 32 && !isMarker };
}

async function listBackupFilesInDirectory(directoryPath: string, frequency: BackupFrequency): Promise<BackupRecord[]> {
  await ensureDirectory(directoryPath);
  const entries = await readdir(directoryPath, { withFileTypes: true });
  const records = await Promise.all(entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map(async (entry) => {
      const filePath = path.join(directoryPath, entry.name);
      const inspection = await inspectBackupFile(filePath);
      return { fileName: entry.name, filePath, frequency, ...inspection };
    }));
  return records.sort((a, b) => b.fileName.localeCompare(a.fileName));
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
    throw new Error("DATABASE_URL غير مضبوط، تعذر إنشاء النسخة الاحتياطية");
  }

  const temporaryFilePath = `${targetFilePath}.tmp-${process.pid}-${Date.now()}`;
  try {
    const child = spawn("pg_dump", ["--dbname", dbUrl, "--no-owner", "--no-acl"], {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => { stderr = `${stderr}${chunk}`.slice(-4000); });

    const output = pipeline(child.stdout, createWriteStream(temporaryFilePath, { flags: "wx" }));
    const [exitCode] = await once(child, "close") as [number | null];
    await output;
    if (exitCode !== 0) {
      throw new Error(stderr.trim() || `pg_dump exited with code ${exitCode}`);
    }

    const inspection = await inspectBackupFile(temporaryFilePath);
    if (!inspection.isValid) throw new Error("ملف النسخة الناتج فارغ أو غير صالح");
    await rename(temporaryFilePath, targetFilePath);
    return inspection;
  } catch (error) {
    await rm(temporaryFilePath, { force: true });
    const detail = error instanceof Error ? error.message : "سبب غير معروف";
    throw new Error(`تعذر إنشاء نسخة SQL حقيقية: ${detail}`);
  }
}

async function createBackupIfMissing(frequency: BackupFrequency, date: Date) {
  const directoryPath = getBackupDirectory(frequency);
  await ensureDirectory(directoryPath);
  const backupFileName = buildBackupFileName(date, frequency);
  const backupFilePath = path.join(directoryPath, backupFileName);
  const existingFiles = await listBackupFilesInDirectory(directoryPath, frequency);
  const existing = existingFiles.find((file) => file.fileName === backupFileName);

  if (existing?.isValid) {
    return { ...existing, created: false };
  }
  if (existing) await rm(existing.filePath, { force: true });

  const inspection = await backupDatabaseToFile(backupFilePath);
  return { created: true, filePath: backupFilePath, fileName: backupFileName, frequency, ...inspection };
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

  const createdBackups: Array<Awaited<ReturnType<typeof createBackupIfMissing>>> = [];

  createdBackups.push(await createBackupIfMissing("daily", date));
  await pruneBackups("daily");

  if (shouldCreateWeeklyBackup(date)) {
    createdBackups.push(await createBackupIfMissing("weekly", date));
  }
  await pruneBackups("weekly");

  if (shouldCreateAnnualBackup(date)) {
    createdBackups.push(await createBackupIfMissing("annual", date));
  }
  await pruneBackups("annual");

  await pruneBackups("manual");

  return createdBackups;
}

export async function createManualBackup(date = new Date()) {
  const result = await createBackupIfMissing("manual", date);
  await pruneBackups("manual");
  return result;
}

export async function createMigrationBackup(date = new Date()) {
  return createManualBackup(date);
}

export async function getBackupFile(frequency: BackupFrequency, fileName: string) {
  if (path.basename(fileName) !== fileName || !fileName.endsWith(".sql")) return null;
  const files = await listBackupFilesInDirectory(getBackupDirectory(frequency), frequency);
  return files.find((file) => file.fileName === fileName && file.isValid) ?? null;
}

export async function listAllBackups() {
  const [daily, weekly, annual, manual] = await Promise.all([
    listBackupFilesInDirectory(dailyDirectoryPath, "daily"),
    listBackupFilesInDirectory(weeklyDirectoryPath, "weekly"),
    listBackupFilesInDirectory(annualDirectoryPath, "annual"),
    listBackupFilesInDirectory(manualDirectoryPath, "manual"),
  ]);

  return {
    daily: daily.map(toPublicBackupRecord),
    weekly: weekly.map(toPublicBackupRecord),
    annual: annual.map(toPublicBackupRecord),
    manual: manual.map(toPublicBackupRecord),
  };
}
