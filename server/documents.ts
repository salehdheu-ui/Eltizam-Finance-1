import path from "path";
import { createHash, randomBytes } from "crypto";
import { mkdir, unlink, writeFile } from "fs/promises";
import { and, desc, eq } from "drizzle-orm";
import { commitmentDocuments } from "@shared/schema";
import { db } from "./db";
import { resolvedProjectRootPath } from "../db-path";

export const documentsRoot = path.join(resolvedProjectRootPath, "uploads", "documents");

/** Formats a contract or invoice realistically arrives as. Anything executable
 *  is refused outright rather than filtered, since the safe list is short. */
const ALLOWED_TYPES: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
};

export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

export function isAllowedDocument(mimeType: string) {
  return Boolean(ALLOWED_TYPES[mimeType]);
}

/**
 * Stores under a generated name. The original never touches the filesystem path,
 * so a filename like "../../etc/passwd" or a duplicate cannot decide where the
 * bytes land; the real name is kept in the database for display only.
 */
export async function storeDocument(input: {
  userId: number;
  commitmentId: number | null;
  fileName: string;
  mimeType: string;
  buffer: Buffer;
}) {
  if (!isAllowedDocument(input.mimeType)) {
    throw Object.assign(new Error("نوع الملف غير مدعوم. ارفع PDF أو صورة."), { status: 400 });
  }
  if (input.buffer.length > MAX_DOCUMENT_BYTES) {
    throw Object.assign(new Error("الملف أكبر من 10 ميجابايت."), { status: 400 });
  }

  await mkdir(documentsRoot, { recursive: true });

  const extension = ALLOWED_TYPES[input.mimeType];
  const storedName = `${input.userId}-${Date.now()}-${randomBytes(8).toString("hex")}.${extension}`;
  await writeFile(path.join(documentsRoot, storedName), input.buffer);

  const [created] = await db.insert(commitmentDocuments).values({
    userId: input.userId,
    commitmentId: input.commitmentId,
    fileName: input.fileName.slice(0, 200),
    storedName,
    mimeType: input.mimeType,
    sizeBytes: input.buffer.length,
  }).returning();

  return created;
}

export async function listDocuments(userId: number, commitmentId?: number) {
  const condition = commitmentId
    ? and(eq(commitmentDocuments.userId, userId), eq(commitmentDocuments.commitmentId, commitmentId))
    : eq(commitmentDocuments.userId, userId);

  return db.select().from(commitmentDocuments)
    .where(condition)
    .orderBy(desc(commitmentDocuments.createdAt));
}

export async function getDocument(userId: number, documentId: number) {
  const [document] = await db.select().from(commitmentDocuments).where(and(
    eq(commitmentDocuments.id, documentId),
    eq(commitmentDocuments.userId, userId),
  ));
  return document ?? null;
}

export async function deleteDocument(userId: number, documentId: number) {
  const document = await getDocument(userId, documentId);
  if (!document) return false;

  await db.delete(commitmentDocuments).where(eq(commitmentDocuments.id, document.id));
  // The row is the record of truth; a leftover file is harmless, a missing row
  // with a live file is not.
  await unlink(path.join(documentsRoot, document.storedName)).catch(() => undefined);
  return true;
}

/** RFC 5545 escaping. Unescaped commas and semicolons silently corrupt the feed. */
function icsEscape(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

function icsDate(timestamp: number) {
  return new Date(timestamp * 1000).toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
}

/**
 * A calendar feed of upcoming commitments. Subscribing to a URL works in Google
 * Calendar, Outlook and Apple Calendar alike, without asking the user for
 * calendar write access to their account.
 */
export function buildCalendarFeed(input: {
  events: Array<{ id: number; title: string; dueDate: number; amount: number | null; status: string }>;
  calendarName?: string;
}) {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Eltizam//Commitments//AR",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${icsEscape(input.calendarName || "التزاماتي")}`,
  ];

  for (const event of input.events) {
    const start = icsDate(event.dueDate);
    const end = icsDate(event.dueDate + 3600);
    const summary = event.amount ? `${event.title} — ${event.amount} ر.ع` : event.title;

    lines.push(
      "BEGIN:VEVENT",
      `UID:eltizam-occurrence-${event.id}@eltizam`,
      `DTSTAMP:${icsDate(Math.floor(Date.now() / 1000))}`,
      `DTSTART:${start}`,
      `DTEND:${end}`,
      `SUMMARY:${icsEscape(summary)}`,
      `STATUS:${event.status === "completed" ? "CONFIRMED" : "TENTATIVE"}`,
      "BEGIN:VALARM",
      "TRIGGER:-P1D",
      "ACTION:DISPLAY",
      `DESCRIPTION:${icsEscape(summary)}`,
      "END:VALARM",
      "END:VEVENT",
    );
  }

  lines.push("END:VCALENDAR");
  // Calendar clients require CRLF; bare newlines make some of them reject the feed.
  return lines.join("\r\n");
}

/** A per-user token so a calendar URL can be fetched by an app that cannot log in,
 *  without that URL granting anything beyond the feed. */
export function calendarToken(userId: number) {
  const secret = process.env.TOKEN_ENCRYPTION_KEY || process.env.SESSION_SECRET || "";
  return createHash("sha256").update(`${secret}:calendar:${userId}`).digest("hex").slice(0, 32);
}
