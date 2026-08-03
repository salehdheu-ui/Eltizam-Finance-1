import type { Express, NextFunction, Request, Response } from "express";
import { and, desc, eq, isNotNull, isNull, ne, or } from "drizzle-orm";
import { z } from "zod";
import {
  bankEmailEvents,
  commitmentAutomationLogs,
  commitmentAutomationSettings,
  commitmentOccurrences,
  commitmentProofs,
  commitments,
  type Commitment,
} from "@shared/schema";
import { db } from "./db";

const settingsUpdateSchema = z.object({
  enabled: z.boolean().optional(),
  reminderMinutes: z.number().int().min(0).max(60 * 24 * 30).optional(),
  escalationMinutes: z.number().int().min(0).max(60 * 24 * 30).optional(),
  autoCloseOnProof: z.boolean().optional(),
  autoCloseOnPayment: z.boolean().optional(),
}).refine((value) => Object.keys(value).length > 0, { message: "لا توجد إعدادات للحفظ" });

const delegateSchema = z.object({
  delegatedTo: z.string().trim().max(120).nullable(),
  delegatedContact: z.string().trim().max(180).nullable().optional(),
});

const snoozeSchema = z.object({
  minutes: z.number().int().min(5).max(60 * 24 * 30),
});

type AutomationSetting = typeof commitmentAutomationSettings.$inferSelect;
type Occurrence = typeof commitmentOccurrences.$inferSelect;

function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.isAuthenticated()) return res.status(401).json({ message: "غير مسجل الدخول" });
  next();
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function nextOccurrenceAt(timestamp: number, frequency: string) {
  const date = new Date(timestamp * 1000);
  switch (frequency) {
    case "daily":
      date.setUTCDate(date.getUTCDate() + 1);
      break;
    case "weekly":
      date.setUTCDate(date.getUTCDate() + 7);
      break;
    case "monthly": {
      const day = date.getUTCDate();
      date.setUTCDate(1);
      date.setUTCMonth(date.getUTCMonth() + 1);
      const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
      date.setUTCDate(Math.min(day, lastDay));
      break;
    }
    case "yearly": {
      const month = date.getUTCMonth();
      const day = date.getUTCDate();
      date.setUTCDate(1);
      date.setUTCFullYear(date.getUTCFullYear() + 1);
      date.setUTCMonth(month);
      const lastDay = new Date(Date.UTC(date.getUTCFullYear(), month + 1, 0)).getUTCDate();
      date.setUTCDate(Math.min(day, lastDay));
      break;
    }
    default:
      return null;
  }
  return Math.floor(date.getTime() / 1000);
}

async function getOwnedCommitment(commitmentId: number, userId: number) {
  const [commitment] = await db
    .select()
    .from(commitments)
    .where(and(eq(commitments.id, commitmentId), eq(commitments.userId, userId)));
  return commitment;
}

async function ensureSettings(commitment: Commitment): Promise<AutomationSetting> {
  const [existing] = await db
    .select()
    .from(commitmentAutomationSettings)
    .where(and(
      eq(commitmentAutomationSettings.userId, commitment.userId),
      eq(commitmentAutomationSettings.commitmentId, commitment.id),
    ));
  if (existing) return existing;

  const now = nowSeconds();
  const [created] = await db
    .insert(commitmentAutomationSettings)
    .values({
      userId: commitment.userId,
      commitmentId: commitment.id,
      enabled: true,
      reminderMinutes: 24 * 60,
      escalationMinutes: 24 * 60,
      autoCloseOnProof: true,
      autoCloseOnPayment: commitment.type === "financial",
      nextOccurrenceAt: commitment.dueDate,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing()
    .returning();

  if (created) return created;
  const [concurrent] = await db
    .select()
    .from(commitmentAutomationSettings)
    .where(and(
      eq(commitmentAutomationSettings.userId, commitment.userId),
      eq(commitmentAutomationSettings.commitmentId, commitment.id),
    ));
  return concurrent;
}

async function addLog(params: {
  userId: number;
  commitmentId: number;
  occurrenceId?: number | null;
  action: string;
  summary: string;
  metadata?: Record<string, unknown>;
  undoPayload?: Record<string, unknown> | null;
}) {
  const [log] = await db
    .insert(commitmentAutomationLogs)
    .values({
      userId: params.userId,
      commitmentId: params.commitmentId,
      occurrenceId: params.occurrenceId ?? null,
      action: params.action,
      summary: params.summary,
      metadata: params.metadata ? JSON.stringify(params.metadata) : null,
      undoPayload: params.undoPayload ? JSON.stringify(params.undoPayload) : null,
      createdAt: nowSeconds(),
    })
    .returning();
  const externalEvent = params.action === "reminder"
    ? "reminder"
    : params.action === "escalated"
      ? "escalated"
      : params.action === "auto_completed"
        ? "completed"
        : null;
  if (externalEvent) {
    void import("./integrations").then(({ dispatchIntegrationEvent }) => dispatchIntegrationEvent({
      userId: params.userId,
      commitmentId: params.commitmentId,
      event: externalEvent,
      title: externalEvent === "reminder"
        ? "تذكير من التزام"
        : externalEvent === "escalated" ? "التزام متأخر" : "اكتمل الالتزام",
      message: params.summary,
      data: params.metadata,
    })).catch((error) => console.error("Integration delivery failed:", error instanceof Error ? error.message : "unknown error"));
  }
  return log;
}

async function hasOccurrenceLog(occurrenceId: number, action: string) {
  const [log] = await db
    .select({ id: commitmentAutomationLogs.id })
    .from(commitmentAutomationLogs)
    .where(and(
      eq(commitmentAutomationLogs.occurrenceId, occurrenceId),
      eq(commitmentAutomationLogs.action, action),
    ));
  return Boolean(log);
}

async function createDueOccurrences(commitment: Commitment, settings: AutomationSetting, now: number) {
  if (!commitment.dueDate || !settings.enabled) return settings;

  const horizon = now + Math.max(settings.reminderMinutes * 60, 24 * 60 * 60);
  let candidate = settings.lastOccurrenceAt
    ? nextOccurrenceAt(settings.lastOccurrenceAt, commitment.frequency)
    : commitment.dueDate;

  if (!candidate) return settings;

  let skipped = 0;
  while (commitment.frequency !== "one_time" && candidate < now - 2 * 24 * 60 * 60 && skipped < 1500) {
    const next = nextOccurrenceAt(candidate, commitment.frequency);
    if (!next) break;
    candidate = next;
    skipped += 1;
  }

  let lastOccurrenceAt = settings.lastOccurrenceAt;
  let createdCount = 0;
  while (candidate <= horizon && createdCount < 12) {
    const [occurrence] = await db
      .insert(commitmentOccurrences)
      .values({
        userId: commitment.userId,
        commitmentId: commitment.id,
        scheduledFor: candidate,
        status: "pending",
        source: "scheduler",
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing()
      .returning();

    if (occurrence) {
      await addLog({
        userId: commitment.userId,
        commitmentId: commitment.id,
        occurrenceId: occurrence.id,
        action: "occurrence_created",
        summary: "أنشأ النظام موعد تنفيذ جديدًا",
        metadata: { scheduledFor: candidate },
      });
    }

    lastOccurrenceAt = candidate;
    createdCount += 1;
    if (commitment.frequency === "one_time") break;
    const next = nextOccurrenceAt(candidate, commitment.frequency);
    if (!next) break;
    candidate = next;
  }

  if (lastOccurrenceAt !== settings.lastOccurrenceAt) {
    const nextAt = commitment.frequency === "one_time" || !lastOccurrenceAt
      ? null
      : nextOccurrenceAt(lastOccurrenceAt, commitment.frequency);
    const [updated] = await db
      .update(commitmentAutomationSettings)
      .set({ lastOccurrenceAt, nextOccurrenceAt: nextAt, updatedAt: now })
      .where(eq(commitmentAutomationSettings.id, settings.id))
      .returning();
    return updated;
  }

  return settings;
}

async function processOccurrence(commitment: Commitment, settings: AutomationSetting, occurrence: Occurrence, now: number) {
  if (occurrence.status === "completed" || occurrence.status === "cancelled") return;
  const effectiveDue = occurrence.snoozedUntil || occurrence.scheduledFor;

  if (now >= effectiveDue - settings.reminderMinutes * 60 && !await hasOccurrenceLog(occurrence.id, "reminder")) {
    await addLog({
      userId: commitment.userId,
      commitmentId: commitment.id,
      occurrenceId: occurrence.id,
      action: "reminder",
      summary: `تذكير: ${commitment.title}`,
      metadata: { effectiveDue },
    });
  }

  if (now >= effectiveDue + settings.escalationMinutes * 60 && !await hasOccurrenceLog(occurrence.id, "escalated")) {
    await db
      .update(commitmentOccurrences)
      .set({ status: "overdue", updatedAt: now })
      .where(eq(commitmentOccurrences.id, occurrence.id));
    await addLog({
      userId: commitment.userId,
      commitmentId: commitment.id,
      occurrenceId: occurrence.id,
      action: "escalated",
      summary: settings.delegatedTo
        ? `صعّد النظام الالتزام إلى ${settings.delegatedTo}`
        : "صعّد النظام الالتزام لأنه تجاوز الموعد",
      metadata: { effectiveDue, delegatedTo: settings.delegatedTo },
    });
  }
}

async function completeFromEvidence(commitment: Commitment, settings: AutomationSetting, now: number) {
  const [occurrence] = await db
    .select()
    .from(commitmentOccurrences)
    .where(and(
      eq(commitmentOccurrences.userId, commitment.userId),
      eq(commitmentOccurrences.commitmentId, commitment.id),
      ne(commitmentOccurrences.status, "completed"),
      ne(commitmentOccurrences.status, "cancelled"),
    ))
    .orderBy(desc(commitmentOccurrences.scheduledFor));
  if (!occurrence) return;

  let evidence: { kind: "proof" | "payment"; at: number } | null = null;
  if (settings.autoCloseOnProof) {
    const [proof] = await db
      .select({ createdAt: commitmentProofs.createdAt })
      .from(commitmentProofs)
      .where(and(
        eq(commitmentProofs.userId, commitment.userId),
        eq(commitmentProofs.commitmentId, commitment.id),
      ))
      .orderBy(desc(commitmentProofs.createdAt));
    if (proof && proof.createdAt >= occurrence.createdAt) evidence = { kind: "proof", at: proof.createdAt };
  }

  if (!evidence && settings.autoCloseOnPayment && commitment.type === "financial") {
    const [payment] = await db
      .select({ createdAt: bankEmailEvents.createdAt })
      .from(bankEmailEvents)
      .where(and(
        eq(bankEmailEvents.userId, commitment.userId),
        eq(bankEmailEvents.commitmentId, commitment.id),
        eq(bankEmailEvents.status, "imported"),
        isNotNull(bankEmailEvents.transactionId),
      ))
      .orderBy(desc(bankEmailEvents.createdAt));
    if (payment && payment.createdAt >= occurrence.createdAt) evidence = { kind: "payment", at: payment.createdAt };
  }

  if (!evidence) return;
  const previousCommitmentStatus = commitment.status;
  const previousOccurrenceStatus = occurrence.status;
  await db
    .update(commitmentOccurrences)
    .set({ status: "completed", completedAt: evidence.at, updatedAt: now })
    .where(eq(commitmentOccurrences.id, occurrence.id));
  if (commitment.frequency === "one_time") {
    await db
      .update(commitments)
      .set({ status: "completed", updatedAt: now })
      .where(and(eq(commitments.id, commitment.id), eq(commitments.userId, commitment.userId)));
  }
  await addLog({
    userId: commitment.userId,
    commitmentId: commitment.id,
    occurrenceId: occurrence.id,
    action: "auto_completed",
    summary: evidence.kind === "payment"
      ? "أغلق النظام الالتزام بعد وصول الدفعة"
      : "أغلق النظام الالتزام بعد وصول الإثبات",
    metadata: evidence,
    undoPayload: {
      kind: "completion",
      occurrenceId: occurrence.id,
      occurrenceStatus: previousOccurrenceStatus,
      commitmentStatus: previousCommitmentStatus,
    },
  });
}

export async function processCommitmentAutomation(commitment: Commitment) {
  const now = nowSeconds();
  let settings = await ensureSettings(commitment);
  if (!settings.enabled) return;
  settings = await createDueOccurrences(commitment, settings, now);
  const occurrences = await db
    .select()
    .from(commitmentOccurrences)
    .where(and(
      eq(commitmentOccurrences.userId, commitment.userId),
      eq(commitmentOccurrences.commitmentId, commitment.id),
      ne(commitmentOccurrences.status, "completed"),
      ne(commitmentOccurrences.status, "cancelled"),
    ))
    .orderBy(desc(commitmentOccurrences.scheduledFor));
  for (const occurrence of occurrences.slice(0, 20)) {
    await processOccurrence(commitment, settings, occurrence, now);
  }
  await completeFromEvidence(commitment, settings, now);
}

let schedulerStarted = false;
export function startCommitmentAutomationWorker() {
  if (schedulerStarted || process.env.NODE_ENV === "test") return;
  schedulerStarted = true;
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      const active = await db
        .select()
        .from(commitments)
        .where(and(eq(commitments.status, "active"), isNotNull(commitments.dueDate)));
      for (const commitment of active) {
        try {
          await processCommitmentAutomation(commitment);
        } catch (error) {
          console.error(`Commitment automation failed for ${commitment.id}:`, error instanceof Error ? error.message : "unknown error");
        }
      }
    } finally {
      running = false;
    }
  };
  const configuredInterval = Number(process.env.COMMITMENT_AUTOMATION_MINUTES || 2);
  const intervalMinutes = Number.isFinite(configuredInterval)
    ? Math.max(1, Math.min(60, configuredInterval)) : 2;
  const timer = setInterval(() => { void run(); }, intervalMinutes * 60 * 1000);
  timer.unref();
  const initialTimer = setTimeout(() => { void run(); }, 15_000);
  initialTimer.unref();
}

async function loadAutomation(commitment: Commitment) {
  await processCommitmentAutomation(commitment);
  const settings = await ensureSettings(commitment);
  const [occurrences, logs] = await Promise.all([
    db.select().from(commitmentOccurrences)
      .where(and(eq(commitmentOccurrences.userId, commitment.userId), eq(commitmentOccurrences.commitmentId, commitment.id)))
      .orderBy(desc(commitmentOccurrences.scheduledFor)).limit(20),
    db.select().from(commitmentAutomationLogs)
      .where(and(eq(commitmentAutomationLogs.userId, commitment.userId), eq(commitmentAutomationLogs.commitmentId, commitment.id)))
      .orderBy(desc(commitmentAutomationLogs.createdAt)).limit(30),
  ]);
  return { settings, occurrences, logs };
}

export function registerCommitmentAutomationRoutes(app: Express) {
  app.get("/api/commitments/:id/automation", requireAuth, async (req, res, next) => {
    try {
      const commitment = await getOwnedCommitment(Number(req.params.id), req.user!.id);
      if (!commitment) return res.status(404).json({ message: "الالتزام غير موجود" });
      res.json(await loadAutomation(commitment));
    } catch (error) { next(error); }
  });

  app.patch("/api/commitments/:id/automation", requireAuth, async (req, res, next) => {
    try {
      const commitment = await getOwnedCommitment(Number(req.params.id), req.user!.id);
      if (!commitment) return res.status(404).json({ message: "الالتزام غير موجود" });
      const input = settingsUpdateSchema.parse(req.body);
      const current = await ensureSettings(commitment);
      const [updated] = await db
        .update(commitmentAutomationSettings)
        .set({ ...input, updatedAt: nowSeconds() })
        .where(eq(commitmentAutomationSettings.id, current.id))
        .returning();
      await addLog({
        userId: commitment.userId,
        commitmentId: commitment.id,
        action: "settings_updated",
        summary: "حدّث المستخدم إعدادات الأتمتة",
        undoPayload: {
          kind: "settings",
          settingsId: current.id,
          values: {
            enabled: current.enabled,
            reminderMinutes: current.reminderMinutes,
            escalationMinutes: current.escalationMinutes,
            autoCloseOnProof: current.autoCloseOnProof,
            autoCloseOnPayment: current.autoCloseOnPayment,
          },
        },
      });
      res.json(updated);
    } catch (error) { next(error); }
  });

  app.post("/api/commitments/:id/automation/snooze", requireAuth, async (req, res, next) => {
    try {
      const commitment = await getOwnedCommitment(Number(req.params.id), req.user!.id);
      if (!commitment) return res.status(404).json({ message: "الالتزام غير موجود" });
      const input = snoozeSchema.parse(req.body);
      const settings = await ensureSettings(commitment);
      await processCommitmentAutomation(commitment);
      const [occurrence] = await db.select().from(commitmentOccurrences)
        .where(and(
          eq(commitmentOccurrences.userId, commitment.userId),
          eq(commitmentOccurrences.commitmentId, commitment.id),
          ne(commitmentOccurrences.status, "completed"),
          ne(commitmentOccurrences.status, "cancelled"),
        ))
        .orderBy(desc(commitmentOccurrences.scheduledFor));
      if (!occurrence) return res.status(409).json({ message: "لا توجد مرة تنفيذ قابلة للتأجيل" });
      const snoozedUntil = nowSeconds() + input.minutes * 60;
      const [updated] = await db.update(commitmentOccurrences)
        .set({ status: "snoozed", snoozedUntil, updatedAt: nowSeconds() })
        .where(eq(commitmentOccurrences.id, occurrence.id)).returning();
      await db.update(commitmentAutomationSettings)
        .set({ snoozedUntil, updatedAt: nowSeconds() })
        .where(eq(commitmentAutomationSettings.id, settings.id));
      await addLog({
        userId: commitment.userId,
        commitmentId: commitment.id,
        occurrenceId: occurrence.id,
        action: "snoozed",
        summary: `أجّل المستخدم الالتزام لمدة ${input.minutes} دقيقة`,
        metadata: { snoozedUntil },
        undoPayload: {
          kind: "snooze",
          occurrenceId: occurrence.id,
          settingsId: settings.id,
          occurrenceStatus: occurrence.status,
          occurrenceSnoozedUntil: occurrence.snoozedUntil,
          settingsSnoozedUntil: settings.snoozedUntil,
        },
      });
      res.json(updated);
    } catch (error) { next(error); }
  });

  app.post("/api/commitments/:id/automation/delegate", requireAuth, async (req, res, next) => {
    try {
      const commitment = await getOwnedCommitment(Number(req.params.id), req.user!.id);
      if (!commitment) return res.status(404).json({ message: "الالتزام غير موجود" });
      const input = delegateSchema.parse(req.body);
      const settings = await ensureSettings(commitment);
      const [updated] = await db.update(commitmentAutomationSettings)
        .set({ ...input, updatedAt: nowSeconds() })
        .where(eq(commitmentAutomationSettings.id, settings.id)).returning();
      await addLog({
        userId: commitment.userId,
        commitmentId: commitment.id,
        action: "delegated",
        summary: input.delegatedTo ? `فُوّض الالتزام إلى ${input.delegatedTo}` : "أُلغي تفويض الالتزام",
        metadata: input,
        undoPayload: {
          kind: "settings",
          settingsId: settings.id,
          values: { delegatedTo: settings.delegatedTo, delegatedContact: settings.delegatedContact },
        },
      });
      res.json(updated);
    } catch (error) { next(error); }
  });

  app.post("/api/commitments/:id/automation/run", requireAuth, async (req, res, next) => {
    try {
      const commitment = await getOwnedCommitment(Number(req.params.id), req.user!.id);
      if (!commitment) return res.status(404).json({ message: "الالتزام غير موجود" });
      await processCommitmentAutomation(commitment);
      res.json(await loadAutomation(commitment));
    } catch (error) { next(error); }
  });

  app.get("/api/automation/alerts", requireAuth, async (req, res, next) => {
    try {
      const alerts = await db
        .select({
          id: commitmentAutomationLogs.id,
          commitmentId: commitmentAutomationLogs.commitmentId,
          action: commitmentAutomationLogs.action,
          summary: commitmentAutomationLogs.summary,
          createdAt: commitmentAutomationLogs.createdAt,
        })
        .from(commitmentAutomationLogs)
        .where(and(
          eq(commitmentAutomationLogs.userId, req.user!.id),
          isNull(commitmentAutomationLogs.seenAt),
          or(
            eq(commitmentAutomationLogs.action, "reminder"),
            eq(commitmentAutomationLogs.action, "escalated"),
          ),
        ))
        .orderBy(desc(commitmentAutomationLogs.createdAt))
        .limit(10);
      res.json(alerts);
    } catch (error) { next(error); }
  });

  app.post("/api/automation/logs/:id/seen", requireAuth, async (req, res, next) => {
    try {
      await db.update(commitmentAutomationLogs)
        .set({ seenAt: nowSeconds() })
        .where(and(eq(commitmentAutomationLogs.id, Number(req.params.id)), eq(commitmentAutomationLogs.userId, req.user!.id)));
      res.json({ message: "تمت القراءة" });
    } catch (error) { next(error); }
  });

  app.post("/api/automation/logs/:id/undo", requireAuth, async (req, res, next) => {
    try {
      const [log] = await db.select().from(commitmentAutomationLogs).where(and(
        eq(commitmentAutomationLogs.id, Number(req.params.id)),
        eq(commitmentAutomationLogs.userId, req.user!.id),
      ));
      if (!log) return res.status(404).json({ message: "السجل غير موجود" });
      if (log.undoneAt) return res.status(409).json({ message: "تم التراجع عن هذا الإجراء سابقًا" });
      if (!log.undoPayload) return res.status(409).json({ message: "هذا الإجراء لا يدعم التراجع" });
      const undo = JSON.parse(log.undoPayload) as Record<string, any>;
      if (undo.kind === "settings") {
        await db.update(commitmentAutomationSettings)
          .set({ ...undo.values, updatedAt: nowSeconds() })
          .where(and(
            eq(commitmentAutomationSettings.id, Number(undo.settingsId)),
            eq(commitmentAutomationSettings.userId, req.user!.id),
          ));
      } else if (undo.kind === "snooze") {
        await db.update(commitmentOccurrences)
          .set({ status: undo.occurrenceStatus, snoozedUntil: undo.occurrenceSnoozedUntil, updatedAt: nowSeconds() })
          .where(and(eq(commitmentOccurrences.id, Number(undo.occurrenceId)), eq(commitmentOccurrences.userId, req.user!.id)));
        await db.update(commitmentAutomationSettings)
          .set({ snoozedUntil: undo.settingsSnoozedUntil, updatedAt: nowSeconds() })
          .where(and(eq(commitmentAutomationSettings.id, Number(undo.settingsId)), eq(commitmentAutomationSettings.userId, req.user!.id)));
      } else if (undo.kind === "completion") {
        await db.update(commitmentOccurrences)
          .set({ status: undo.occurrenceStatus, completedAt: null, updatedAt: nowSeconds() })
          .where(and(eq(commitmentOccurrences.id, Number(undo.occurrenceId)), eq(commitmentOccurrences.userId, req.user!.id)));
        await db.update(commitments)
          .set({ status: undo.commitmentStatus, updatedAt: nowSeconds() })
          .where(and(eq(commitments.id, log.commitmentId), eq(commitments.userId, req.user!.id)));
      } else {
        return res.status(409).json({ message: "صيغة التراجع غير مدعومة" });
      }
      await db.update(commitmentAutomationLogs)
        .set({ undoneAt: nowSeconds() })
        .where(eq(commitmentAutomationLogs.id, log.id));
      await addLog({
        userId: req.user!.id,
        commitmentId: log.commitmentId,
        occurrenceId: log.occurrenceId,
        action: "undone",
        summary: `تراجع المستخدم عن: ${log.summary}`,
      });
      res.json({ message: "تم التراجع بنجاح" });
    } catch (error) { next(error); }
  });

  startCommitmentAutomationWorker();
}
