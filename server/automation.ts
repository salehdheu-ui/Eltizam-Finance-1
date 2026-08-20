import { and, asc, desc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import {
  automationLog,
  commitmentOccurrences,
  commitmentProofs,
  commitmentShares,
  commitments,
  users,
  type Commitment,
} from "@shared/schema";
import { db } from "./db";
import { getPreferences, notify } from "./notifications";

const DAY = 86400;

/** How far ahead occurrences are materialised. Enough to plan a month, not so far
 *  that changing a commitment leaves a long tail of stale rows behind it. */
const HORIZON_DAYS = 90;

export type AutomationAction =
  | "occurrence_created"
  | "reminder_due"
  | "marked_missed"
  | "escalated"
  | "auto_closed"
  | "postponed"
  | "weekly_summary";

function now() {
  return Math.floor(Date.now() / 1000);
}

function startOfDay(timestamp: number) {
  const date = new Date(timestamp * 1000);
  date.setHours(0, 0, 0, 0);
  return Math.floor(date.getTime() / 1000);
}

function formatDueLabel(timestamp: number, dueTime = "") {
  const dateLabel = new Date(timestamp * 1000).toLocaleDateString("ar-OM");
  return dueTime ? `${dateLabel} الساعة ${dueTime}` : dateLabel;
}

/**
 * The next time a commitment falls due after `from`. Month and year steps move by
 * calendar rather than by a fixed number of days, so a commitment due on the 31st
 * lands on the last day of a short month instead of drifting into the next one.
 */
export function nextDueDate(commitment: Pick<Commitment, "frequency" | "dueDate">, from: number): number | null {
  const anchor = commitment.dueDate ?? from;

  switch (commitment.frequency) {
    case "daily":
      return from + DAY;
    case "weekly":
      return from + 7 * DAY;
    case "monthly":
    case "yearly": {
      const anchorDate = new Date(anchor * 1000);
      const cursor = new Date(from * 1000);
      const targetDay = anchorDate.getDate();

      if (commitment.frequency === "monthly") {
        cursor.setDate(1);
        cursor.setMonth(cursor.getMonth() + 1);
      } else {
        cursor.setDate(1);
        cursor.setFullYear(cursor.getFullYear() + 1);
        cursor.setMonth(anchorDate.getMonth());
      }

      const lastDay = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
      cursor.setDate(Math.min(targetDay, lastDay));
      cursor.setHours(anchorDate.getHours(), anchorDate.getMinutes(), 0, 0);
      return Math.floor(cursor.getTime() / 1000);
    }
    default:
      return null;
  }
}

async function record(entry: {
  userId: number;
  action: AutomationAction;
  summary: string;
  commitmentId?: number | null;
  occurrenceId?: number | null;
  undoPayload?: unknown;
}) {
  await db.insert(automationLog).values({
    userId: entry.userId,
    action: entry.action,
    summary: entry.summary,
    commitmentId: entry.commitmentId ?? null,
    occurrenceId: entry.occurrenceId ?? null,
    undoPayload: entry.undoPayload ? JSON.stringify(entry.undoPayload) : null,
  });
}

/**
 * Materialises the next occurrences of every recurring commitment up to the
 * horizon. The unique constraint on (commitment, due date) is what makes this
 * safe to run repeatedly — a second pass inserts nothing rather than duplicating.
 */
async function generateOccurrences(commitment: Commitment) {
  if (commitment.frequency === "one_time") {
    if (!commitment.dueDate) return 0;
    const [created] = await db.insert(commitmentOccurrences).values({
      userId: commitment.userId,
      commitmentId: commitment.id,
      dueDate: commitment.dueDate,
      amount: commitment.amount,
    }).onConflictDoNothing().returning();
    return created ? 1 : 0;
  }

  const horizon = now() + HORIZON_DAYS * DAY;
  const [latest] = await db.select({ dueDate: commitmentOccurrences.dueDate })
    .from(commitmentOccurrences)
    .where(eq(commitmentOccurrences.commitmentId, commitment.id))
    .orderBy(desc(commitmentOccurrences.dueDate))
    .limit(1);

  let cursor = latest?.dueDate ?? commitment.dueDate ?? now();
  let created = 0;

  // Seed the first occurrence from the commitment's own due date.
  if (!latest && commitment.dueDate) {
    const [seeded] = await db.insert(commitmentOccurrences).values({
      userId: commitment.userId,
      commitmentId: commitment.id,
      dueDate: commitment.dueDate,
      amount: commitment.amount,
    }).onConflictDoNothing().returning();
    if (seeded) created += 1;
  }

  while (cursor < horizon && created < 60) {
    const next = nextDueDate(commitment, cursor);
    if (next === null || next <= cursor) break;
    cursor = next;
    if (cursor > horizon) break;

    const [inserted] = await db.insert(commitmentOccurrences).values({
      userId: commitment.userId,
      commitmentId: commitment.id,
      dueDate: cursor,
      amount: commitment.amount,
    }).onConflictDoNothing().returning();
    if (inserted) created += 1;
  }

  return created;
}

/** Occurrences whose reminder window has opened and that have not been told about yet. */
async function raiseReminders(commitment: Commitment) {
  const windowEnd = now() + Math.max(0, commitment.reminderDaysBefore) * DAY;

  const due = await db.select().from(commitmentOccurrences).where(and(
    eq(commitmentOccurrences.commitmentId, commitment.id),
    eq(commitmentOccurrences.status, "pending"),
    isNull(commitmentOccurrences.remindedAt),
    gte(commitmentOccurrences.dueDate, startOfDay(now())),
    lte(commitmentOccurrences.dueDate, windowEnd),
  ));

  for (const occurrence of due) {
    await db.update(commitmentOccurrences)
      .set({ remindedAt: now() })
      .where(eq(commitmentOccurrences.id, occurrence.id));

    const dueLabel = formatDueLabel(occurrence.dueDate, commitment.dueTime);
    await record({
      userId: commitment.userId,
      action: "reminder_due",
      summary: `تذكير: ${commitment.title} يستحق ${dueLabel}`,
      commitmentId: commitment.id,
      occurrenceId: occurrence.id,
    });

    // A reminder that never leaves the app is not a reminder.
    await notify({
      userId: commitment.userId,
      title: `تذكير: ${commitment.title}`,
      body: `يستحق ${dueLabel}${commitment.amount ? ` · ${commitment.amount} ر.ع` : ""}${commitment.delegatedTo ? ` · بعهدة ${commitment.delegatedTo}` : ""}`,
      dedupeKey: `reminder:${occurrence.id}`,
      url: `/commitments/${commitment.id}`,
    }).catch((error) => {
      console.error("Reminder notification failed:", error instanceof Error ? error.message : "unknown");
    });
  }

  return due.length;
}

/** Anything still pending after its due day has passed. Kept as a distinct state
 *  so a missed month stays visible instead of being silently rolled forward. */
async function markMissed(commitment: Commitment) {
  const cutoff = startOfDay(now());

  const overdue = await db.select().from(commitmentOccurrences).where(and(
    eq(commitmentOccurrences.commitmentId, commitment.id),
    eq(commitmentOccurrences.status, "pending"),
    lte(commitmentOccurrences.dueDate, cutoff - DAY),
  ));

  for (const occurrence of overdue) {
    await db.update(commitmentOccurrences)
      .set({ status: "missed" })
      .where(eq(commitmentOccurrences.id, occurrence.id));

    await record({
      userId: commitment.userId,
      action: "marked_missed",
      summary: `فات موعد ${commitment.title}`,
      commitmentId: commitment.id,
      occurrenceId: occurrence.id,
      undoPayload: { occurrenceId: occurrence.id, previousStatus: "pending" },
    });
  }

  return overdue.length;
}

/** Raises a commitment that has been missed for longer than the user's tolerance. */
async function escalate(commitment: Commitment) {
  if (!commitment.escalateAfterDays) return 0;
  const threshold = now() - commitment.escalateAfterDays * DAY;

  const stale = await db.select().from(commitmentOccurrences).where(and(
    eq(commitmentOccurrences.commitmentId, commitment.id),
    eq(commitmentOccurrences.status, "missed"),
    isNull(commitmentOccurrences.escalatedAt),
    lte(commitmentOccurrences.dueDate, threshold),
  ));

  for (const occurrence of stale) {
    await db.update(commitmentOccurrences)
      .set({ escalatedAt: now() })
      .where(eq(commitmentOccurrences.id, occurrence.id));

    const overdueDays = Math.floor((now() - occurrence.dueDate) / DAY);
    const summary = `${commitment.title} متأخر ${overdueDays} يوماً${commitment.delegatedTo ? ` — بعهدة ${commitment.delegatedTo}` : ""}`;
    await record({
      userId: commitment.userId,
      action: "escalated",
      summary,
      commitmentId: commitment.id,
      occurrenceId: occurrence.id,
    });

    // Escalation is the case the user set a tolerance for, so it overrides quiet hours.
    await notify({
      userId: commitment.userId,
      title: "التزام متأخر",
      body: summary,
      dedupeKey: `escalation:${occurrence.id}`,
      url: `/commitments/${commitment.id}`,
      urgent: true,
    }).catch((error) => {
      console.error("Escalation notification failed:", error instanceof Error ? error.message : "unknown");
    });
  }

  return stale.length;
}

/**
 * Closes a commitment once evidence of it being done arrives. Only one-off
 * commitments close outright; a recurring one closes the occurrence it covers,
 * because the obligation itself continues.
 */
async function autoCloseOnProof(commitment: Commitment) {
  if (!commitment.autoCloseOnProof || commitment.status !== "active") return 0;

  const [proof] = await db.select().from(commitmentProofs)
    .where(eq(commitmentProofs.commitmentId, commitment.id))
    .orderBy(desc(commitmentProofs.createdAt))
    .limit(1);
  if (!proof) return 0;

  if (commitment.frequency === "one_time") {
    await db.update(commitments)
      .set({ status: "completed", updatedAt: now() })
      .where(eq(commitments.id, commitment.id));

    await db.update(commitmentOccurrences)
      .set({ status: "completed", completedAt: now() })
      .where(and(
        eq(commitmentOccurrences.commitmentId, commitment.id),
        eq(commitmentOccurrences.status, "pending"),
      ));

    await record({
      userId: commitment.userId,
      action: "auto_closed",
      summary: `أُغلق ${commitment.title} بعد إضافة إثبات: ${proof.label}`,
      commitmentId: commitment.id,
      undoPayload: { commitmentId: commitment.id, previousStatus: "active" },
    });
    return 1;
  }

  // A recurring commitment: close the occurrence the proof most plausibly covers.
  const [open] = await db.select().from(commitmentOccurrences).where(and(
    eq(commitmentOccurrences.commitmentId, commitment.id),
    eq(commitmentOccurrences.status, "pending"),
    lte(commitmentOccurrences.dueDate, proof.createdAt + 7 * DAY),
  )).orderBy(asc(commitmentOccurrences.dueDate)).limit(1);

  if (!open || open.createdAt > proof.createdAt) return 0;

  await db.update(commitmentOccurrences)
    .set({ status: "completed", completedAt: now() })
    .where(eq(commitmentOccurrences.id, open.id));

  await record({
    userId: commitment.userId,
    action: "auto_closed",
    summary: `أُنجزت دفعة ${commitment.title} بعد إضافة إثبات: ${proof.label}`,
    commitmentId: commitment.id,
    occurrenceId: open.id,
    undoPayload: { occurrenceId: open.id, previousStatus: "pending" },
  });
  return 1;
}

/**
 * Reminds the assignee without leaking the task title or any private owner
 * details into email, WhatsApp or webhooks. The owner gets a separate alert
 * only when the shared task is actually overdue.
 */
async function processSharedCommitmentAlerts(ownerUserId: number) {
  const rows = await db.select({
    shareId: commitmentShares.id,
    commitmentId: commitments.id,
    assigneeUserId: commitmentShares.assigneeUserId,
    title: commitments.title,
    dueDate: commitments.dueDate,
    dueTime: commitments.dueTime,
    reminderDaysBefore: commitments.reminderDaysBefore,
    escalateAfterDays: commitments.escalateAfterDays,
    remindedAt: commitmentShares.remindedAt,
    escalatedAt: commitmentShares.escalatedAt,
  })
    .from(commitmentShares)
    .innerJoin(commitments, eq(commitments.id, commitmentShares.commitmentId))
    .where(and(
      eq(commitmentShares.ownerUserId, ownerUserId),
      inArray(commitmentShares.status, ["pending", "accepted"]),
      eq(commitments.status, "active"),
    ));

  const current = now();
  const today = startOfDay(current);
  let reminders = 0;
  let escalated = 0;

  for (const row of rows) {
    if (!row.dueDate) continue;
    const dueLabel = formatDueLabel(row.dueDate, row.dueTime);
    const reminderWindowEnd = current + Math.max(0, row.reminderDaysBefore) * DAY;

    if (!row.remindedAt && row.dueDate >= today && row.dueDate <= reminderWindowEnd) {
      const [claimed] = await db.update(commitmentShares)
        .set({ remindedAt: current })
        .where(and(eq(commitmentShares.id, row.shareId), isNull(commitmentShares.remindedAt)))
        .returning({ id: commitmentShares.id });
      if (claimed) {
        reminders += 1;
        await record({
          userId: ownerUserId,
          action: "reminder_due",
          summary: `تم تذكير المكلّف باقتراب موعد ${row.title}`,
          commitmentId: row.commitmentId,
        });
        await notify({
          userId: row.assigneeUserId,
          title: "موعد مهمة مشتركة يقترب",
          body: `لديك مهمة مشتركة موعدها ${dueLabel}. افتح منصة التزام للاطلاع عليها.`,
          dedupeKey: `commitment-share:${row.shareId}:due-reminder:${row.dueDate}`,
          url: "/shared-commitments",
        }).catch((error) => console.error("Shared reminder failed:", error instanceof Error ? error.message : "unknown"));
      }
    }

    const escalationThreshold = row.escalateAfterDays ? current - row.escalateAfterDays * DAY : null;
    if (!row.escalatedAt && escalationThreshold !== null && row.dueDate <= escalationThreshold) {
      const [claimed] = await db.update(commitmentShares)
        .set({ escalatedAt: current })
        .where(and(eq(commitmentShares.id, row.shareId), isNull(commitmentShares.escalatedAt)))
        .returning({ id: commitmentShares.id });
      if (claimed) {
        escalated += 1;
        await record({
          userId: ownerUserId,
          action: "escalated",
          summary: `تأخرت المهمة المسندة: ${row.title}`,
          commitmentId: row.commitmentId,
        });
        await Promise.all([
          notify({
            userId: row.assigneeUserId,
            title: "مهمة مشتركة متأخرة",
            body: `لديك مهمة مشتركة تجاوزت موعد ${dueLabel}. افتح منصة التزام لتحديث حالتها.`,
            dedupeKey: `commitment-share:${row.shareId}:overdue-assignee:${row.dueDate}`,
            url: "/shared-commitments",
            urgent: true,
          }),
          notify({
            userId: ownerUserId,
            title: "مهمة مسندة متأخرة",
            body: "تأخرت إحدى المهام التي أسندتها. افتح منصة التزام للمتابعة.",
            dedupeKey: `commitment-share:${row.shareId}:overdue-owner:${row.dueDate}`,
            url: `/commitments/${row.commitmentId}`,
            urgent: true,
          }),
        ]).catch((error) => console.error("Shared escalation failed:", error instanceof Error ? error.message : "unknown"));
      }
    }
  }

  return { reminders, escalated };
}

function weeklyDedupeKey(timestamp = now()) {
  const date = new Date(timestamp * 1000);
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((date.getTime() - yearStart.getTime()) / 1000 / DAY) + 1) / 7);
  return `${date.getUTCFullYear()}-${String(week).padStart(2, "0")}`;
}

/** A compact, privacy-safe weekly summary. It contains counts only so an email,
 * WhatsApp message or webhook never exposes commitment titles or amounts. */
async function sendWeeklySummary(userId: number) {
  const preferences = await getPreferences(userId);
  if (!preferences?.weeklySummary) return 0;

  const current = now();
  const today = startOfDay(current);
  const weekEnd = today + 7 * DAY;
  const [activeRows, dueRows, missedRows, reviewRows] = await Promise.all([
    db.select({ count: sql<number>`count(*)::int` }).from(commitments).where(and(
      eq(commitments.userId, userId),
      eq(commitments.status, "active"),
    )),
    db.select({ count: sql<number>`count(*)::int` }).from(commitmentOccurrences).where(and(
      eq(commitmentOccurrences.userId, userId),
      eq(commitmentOccurrences.status, "pending"),
      gte(commitmentOccurrences.dueDate, today),
      lte(commitmentOccurrences.dueDate, weekEnd),
    )),
    db.select({ count: sql<number>`count(*)::int` }).from(commitmentOccurrences).where(and(
      eq(commitmentOccurrences.userId, userId),
      eq(commitmentOccurrences.status, "missed"),
    )),
    db.select({ count: sql<number>`count(*)::int` }).from(commitmentShares).where(and(
      eq(commitmentShares.ownerUserId, userId),
      eq(commitmentShares.status, "completed"),
    )),
  ]);

  const active = activeRows[0]?.count ?? 0;
  const due = dueRows[0]?.count ?? 0;
  const missed = missedRows[0]?.count ?? 0;
  const review = reviewRows[0]?.count ?? 0;
  const result = await notify({
    userId,
    title: "ملخص أسبوعك في التزام",
    body: `${active} التزام نشط · ${due} خلال 7 أيام · ${missed} متأخر · ${review} ينتظر اعتمادك. افتح المنصة للمتابعة.`,
    dedupeKey: `weekly-summary:${weeklyDedupeKey(current)}`,
    url: "/commitments",
  });

  if (result.sent.length === 0) return 0;
  await record({
    userId,
    action: "weekly_summary",
    summary: `أُرسل ملخص الأسبوع: ${active} نشط، ${due} قريب، ${missed} متأخر، ${review} ينتظر الاعتماد`,
  });
  return 1;
}

export async function runAutomationForUser(userId: number) {
  const active = await db.select().from(commitments).where(and(
    eq(commitments.userId, userId),
    eq(commitments.status, "active"),
  ));

  const totals = { occurrences: 0, reminders: 0, missed: 0, escalated: 0, closed: 0, sharedReminders: 0, sharedEscalated: 0, weeklySummaries: 0 };

  for (const commitment of active) {
    try {
      totals.occurrences += await generateOccurrences(commitment);
      totals.closed += await autoCloseOnProof(commitment);
      totals.reminders += await raiseReminders(commitment);
      totals.missed += await markMissed(commitment);
      totals.escalated += await escalate(commitment);
    } catch (error) {
      console.error(`Automation failed for commitment ${commitment.id}:`, error instanceof Error ? error.message : "unknown error");
    }
  }

  const shared = await processSharedCommitmentAlerts(userId);
  totals.sharedReminders = shared.reminders;
  totals.sharedEscalated = shared.escalated;
  totals.weeklySummaries = await sendWeeklySummary(userId);

  return totals;
}

async function runAutomationForEveryone() {
  const owners = await db.select({ userId: users.id })
    .from(users)
    .where(eq(users.isActive, true));

  for (const owner of owners) {
    try {
      await runAutomationForUser(owner.userId);
    } catch (error) {
      console.error(`Automation failed for user ${owner.userId}:`, error instanceof Error ? error.message : "unknown error");
    }
  }
}

let started = false;

export function startAutomationEngine() {
  if (started || process.env.NODE_ENV === "test") return;
  started = true;

  const configured = Number(process.env.AUTOMATION_INTERVAL_MINUTES || 5);
  const intervalMinutes = Math.min(360, Math.max(5, Number.isFinite(configured) ? configured : 5));
  let running = false;

  const run = async () => {
    if (running) return;
    running = true;
    try {
      await runAutomationForEveryone();
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => { void run(); }, intervalMinutes * 60 * 1000);
  timer.unref();
  const initial = setTimeout(() => { void run(); }, 30_000);
  initial.unref();
}

/** Puts back what an entry did. Only entries that captured prior state can be
 *  reversed; the rest are informational and say so. */
export async function undoAutomationEntry(userId: number, entryId: number) {
  const [entry] = await db.select().from(automationLog).where(and(
    eq(automationLog.id, entryId),
    eq(automationLog.userId, userId),
  ));

  if (!entry) return { ok: false as const, message: "السجل غير موجود" };
  if (entry.undoneAt) return { ok: false as const, message: "تم التراجع عن هذا الإجراء مسبقاً" };
  if (!entry.undoPayload) return { ok: false as const, message: "هذا الإجراء للعلم فقط ولا يمكن التراجع عنه" };

  const payload = JSON.parse(entry.undoPayload) as {
    occurrenceId?: number;
    commitmentId?: number;
    previousStatus?: string;
    previousDueDate?: number;
    previousPostponedFrom?: number | null;
    previousRemindedAt?: number | null;
    previousEscalatedAt?: number | null;
    previousCompletedAt?: number | null;
  };

  if (payload.occurrenceId && payload.previousStatus) {
    const restored: Record<string, unknown> = {
      status: payload.previousStatus,
      completedAt: payload.previousCompletedAt ?? null,
    };
    if (payload.previousDueDate !== undefined) restored.dueDate = payload.previousDueDate;
    if (payload.previousPostponedFrom !== undefined) restored.postponedFrom = payload.previousPostponedFrom;
    if (payload.previousRemindedAt !== undefined) restored.remindedAt = payload.previousRemindedAt;
    if (payload.previousEscalatedAt !== undefined) restored.escalatedAt = payload.previousEscalatedAt;
    await db.update(commitmentOccurrences)
      .set(restored)
      .where(and(
        eq(commitmentOccurrences.id, payload.occurrenceId),
        eq(commitmentOccurrences.userId, userId),
      ));
  }

  if (payload.commitmentId && payload.previousStatus) {
    await db.update(commitments)
      .set({ status: payload.previousStatus, updatedAt: now() })
      .where(and(eq(commitments.id, payload.commitmentId), eq(commitments.userId, userId)));
  }

  await db.update(automationLog)
    .set({ undoneAt: now() })
    .where(eq(automationLog.id, entry.id));

  return { ok: true as const, message: "تم التراجع" };
}

export async function postponeOccurrence(userId: number, occurrenceId: number, days: number) {
  const [occurrence] = await db.select().from(commitmentOccurrences).where(and(
    eq(commitmentOccurrences.id, occurrenceId),
    eq(commitmentOccurrences.userId, userId),
  ));
  if (!occurrence) return { ok: false as const, message: "الموعد غير موجود" };

  const [commitment] = await db.select().from(commitments)
    .where(eq(commitments.id, occurrence.commitmentId));

  let newDueDate = occurrence.dueDate + days * DAY;
  // A recurring commitment may already have its next occurrence on that exact
  // timestamp. Keep both on the requested day while avoiding the unique key.
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const [collision] = await db.select({ id: commitmentOccurrences.id })
      .from(commitmentOccurrences)
      .where(and(
        eq(commitmentOccurrences.commitmentId, occurrence.commitmentId),
        eq(commitmentOccurrences.dueDate, newDueDate),
      ));
    if (!collision || collision.id === occurrence.id) break;
    newDueDate += 60;
  }
  await db.update(commitmentOccurrences).set({
    dueDate: newDueDate,
    status: "pending",
    postponedFrom: occurrence.postponedFrom ?? occurrence.dueDate,
    // Let the new date earn its own reminder rather than reusing the old one.
    remindedAt: null,
    escalatedAt: null,
  }).where(eq(commitmentOccurrences.id, occurrence.id));

  await record({
    userId,
    action: "postponed",
    summary: `أُجّل ${commitment?.title ?? "التزام"} ${days} يوماً`,
    commitmentId: occurrence.commitmentId,
    occurrenceId: occurrence.id,
    undoPayload: {
      occurrenceId: occurrence.id,
      previousStatus: occurrence.status,
      previousDueDate: occurrence.dueDate,
      previousPostponedFrom: occurrence.postponedFrom,
      previousRemindedAt: occurrence.remindedAt,
      previousEscalatedAt: occurrence.escalatedAt,
      previousCompletedAt: occurrence.completedAt,
    },
  });

  return { ok: true as const, dueDate: newDueDate };
}
