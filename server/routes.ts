import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { hashPlainPassword, setupAuth } from "./auth";
import { writeAuditEvent } from "./audit";
import { createManualBackup, listAllBackups } from "./backup";
import { insertWalletSchema, insertCategorySchema, insertTransactionSchema, insertRecurringIncomeSchema, insertObligationSchema, insertVariableObligationMonthStatusSchema, insertCommitmentSchema, insertCommitmentStepSchema, insertCommitmentProofSchema, insertSavingsGoalSchema, integrationSettings, upsertIntegrationSettingSchema, upsertEmailChannelSchema, upsertPushChannelSchema, transactions, categories, bankEmailEvents, bankCategoryRules, automationLog, commitmentOccurrences, commitments, notificationPreferences } from "@shared/schema";
import { buildWriteQueueKey, enqueueWrite } from "./write-queue";
import { z } from "zod";
import { buildRuleKey, registerBankInboxRoutes } from "./bank-inbox";
import { postponeOccurrence, runAutomationForUser, startAutomationEngine, undoAutomationEntry } from "./automation";
import { generateVapidKeys, getPreferences, getPublicVapidKey, notify, removePushSubscription, savePushSubscription } from "./notifications";
import { canSendMail, sendTestEmail } from "./mail";
import {
  deleteChannelConfig,
  getChannelRecord,
  readStoredConfig,
  resolveMailConfig,
  resolvePushConfig,
  saveChannelConfig,
} from "./channel-settings";
import { buildWeeklySummary, detectRecurring, detectRisks, simulateDecision } from "./insights";
import { buildCalendarFeed, calendarToken, deleteDocument, documentsRoot, getDocument, isAllowedDocument, listDocuments, MAX_DOCUMENT_BYTES, storeDocument } from "./documents";
import { isClaudeConfigured, readDocument, understandCommitment } from "./understanding";
import multer from "multer";
import path from "path";
import { db } from "./db";
import { and, asc, desc, eq, gte, sql } from "drizzle-orm";
import {
  INTEGRATION_PROVIDERS,
  PROVIDER_CALLBACK_PATHS,
  PROVIDER_LABELS,
  decryptSecret,
  encryptSecret,
  getIntegrationRecord,
  getProviderConfig,
  invalidateProviderCache,
  maskSecret,
  resolveAppBaseUrl,
  testProviderCredentials,
  type IntegrationProvider,
} from "./integration-settings";

function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ message: "غير مسجل الدخول" });
  }
  next();
}

function requireSystemAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ message: "غير مسجل الدخول" });
  }

  if (req.user?.role !== "system_admin") {
    return res.status(404).json({ message: "غير موجود" });
  }

  next();
}

function toAdminUser(user: Awaited<ReturnType<typeof storage.getUser>>) {
  if (!user) {
    return user;
  }

  const { password, ...safeUser } = user;
  return safeUser;
}

function parseRouteId(param: string | string[]) {
  return parseInt(Array.isArray(param) ? param[0] : param, 10);
}

function toOptionalNumber(value: unknown) {
  if (value === undefined) {
    return undefined;
  }

  if (value === null || value === "") {
    return null;
  }

  if (typeof value === "string") {
    return Number(value);
  }

  return value;
}

function toRequiredNumber(value: unknown) {
  if (typeof value === "string") {
    return Number(value);
  }

  return value;
}

/** Buffered in memory: files are capped at 10MB and written once validated, so
 *  a temp file never outlives a rejected upload. */
const uploadDocument = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_DOCUMENT_BYTES, files: 1 },
  fileFilter: (_req, file, callback) => {
    if (!isAllowedDocument(file.mimetype)) {
      callback(Object.assign(new Error("نوع الملف غير مدعوم. ارفع PDF أو صورة."), { status: 400 }));
      return;
    }
    callback(null, true);
  },
});

async function runQueuedWrite<T>(res: Response, key: string, task: () => Promise<T>) {
  const queued = await enqueueWrite(key, task);
  res.setHeader("X-Write-Queue-Wait-Ms", queued.waitMs.toString());
  return queued.result;
}

const applyVariableObligationPaymentSchema = z.object({
  amount: z.number().positive("المبلغ يجب أن يكون أكبر من صفر"),
});

const adminUserUpdateSchema = z.object({
  isActive: z.boolean(),
});

const adminApprovePasswordResetSchema = z.object({
  temporaryPassword: z.string().min(8).max(128),
});

const walletUpdateSchema = insertWalletSchema.partial().extend({
  balance: z.number().finite().optional(),
});

const categoryUpdateSchema = insertCategorySchema.partial();

const transactionCreateRequestSchema = z.object({
  walletId: z.union([z.number(), z.string()]),
  targetWalletId: z.union([z.number(), z.string()]).nullable().optional(),
  categoryId: z.union([z.number(), z.string()]).nullable().optional(),
  type: z.enum(["income", "expense", "debt", "transfer"]),
  amount: z.union([z.number(), z.string()]),
  note: z.string().optional(),
});

const recurringIncomePatchSchema = insertRecurringIncomeSchema.partial();

const obligationPatchSchema = insertObligationSchema.partial();
const commitmentPatchSchema = insertCommitmentSchema.partial();

function getPeriodRange(period: string) {
  const end = new Date();
  const start = new Date(end);

  switch (period) {
    case "1month":
      start.setMonth(end.getMonth() - 1);
      break;
    case "3months":
      start.setMonth(end.getMonth() - 3);
      break;
    case "6months":
      start.setMonth(end.getMonth() - 6);
      break;
    case "1year":
      start.setFullYear(end.getFullYear() - 1);
      break;
    default:
      start.setFullYear(1970, 0, 1);
      break;
  }

  return { start, end };
}

function getBucketLabel(dateValue: number, period: string) {
  const date = new Date(dateValue * 1000);
  if (period === "1month") {
    return `${date.getDate()}/${date.getMonth() + 1}`;
  }

  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  setupAuth(app);
  registerBankInboxRoutes(app);
  startAutomationEngine();

  app.get("/api/admin/stats", requireSystemAdmin, async (_req, res, next) => {
    try {
      const stats = await storage.getUserStats();
      res.json(stats);
    } catch (e) { next(e); }
  });

  app.get("/api/admin/users", requireSystemAdmin, async (_req, res, next) => {
    try {
      const users = await storage.getAllUsers();
      res.json(users.map((user) => toAdminUser(user)));
    } catch (e) { next(e); }
  });

  app.get("/api/admin/backups", requireSystemAdmin, async (_req, res, next) => {
    try {
      const backups = await listAllBackups();
      res.json(backups);
    } catch (e) { next(e); }
  });

  app.post("/api/admin/backups/manual", requireSystemAdmin, async (_req, res, next) => {
    try {
      const backup = await runQueuedWrite(
        res,
        buildWriteQueueKey("admin", "backups", "manual"),
        () => createManualBackup(),
      );
      await writeAuditEvent({
        action: "admin.backup.manual_created",
        actorUserId: _req.user?.id,
        actorRole: _req.user?.role,
        targetUserId: null,
        ipAddress: _req.ip,
        metadata: { fileName: backup.fileName, frequency: backup.frequency },
      });
      res.status(201).json(backup);
    } catch (e) { next(e); }
  });

  app.get("/api/admin/password-reset-requests", requireSystemAdmin, async (_req, res, next) => {
    try {
      const requests = await storage.getPasswordResetRequests();
      const users = await storage.getAllUsers();
      const userMap = new Map(users.map((user) => [user.id, user]));
      res.json(requests.map((request) => {
        const user = userMap.get(request.userId);
        return {
          id: request.id,
          userId: request.userId,
          status: request.status,
          verificationMethod: request.verificationMethod,
          requestedByIdentifier: request.requestedByIdentifier,
          contactValue: request.contactValue,
          adminUserId: request.adminUserId,
          createdAt: request.createdAt,
          resolvedAt: request.resolvedAt,
          user: user ? { id: user.id, name: user.name, username: user.username, email: user.email, phone: user.phone, isActive: user.isActive } : null,
        };
      }));
    } catch (e) { next(e); }
  });

  app.post("/api/admin/password-reset-requests/:id/approve", requireSystemAdmin, async (req, res, next) => {
    try {
      const requestId = parseRouteId(req.params.id);
      const resetRequest = await storage.getPasswordResetRequestById(requestId);
      if (!resetRequest) {
        return res.status(404).json({ message: "طلب إعادة التعيين غير موجود" });
      }
      if (resetRequest.status !== "pending") {
        return res.status(400).json({ message: "تمت معالجة هذا الطلب مسبقًا" });
      }
      const parsed = adminApprovePasswordResetSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "كلمة المرور المؤقتة غير صالحة" });
      }
      const hashed = await hashPlainPassword(parsed.data.temporaryPassword);
      await runQueuedWrite(res, buildWriteQueueKey("admin-password-reset", requestId), async () => {
        await storage.updateUser(resetRequest.userId, { password: hashed });
        return storage.updatePasswordResetRequest(requestId, { status: "approved", adminUserId: req.user!.id, resolvedAt: Math.floor(Date.now() / 1000) });
      });
      await writeAuditEvent({ action: "admin.password_reset.approved", actorUserId: req.user?.id, actorRole: req.user?.role, targetUserId: resetRequest.userId, ipAddress: req.ip, metadata: { requestId } });
      res.json({ message: "تمت الموافقة على إعادة التعيين وتحديث كلمة المرور المؤقتة" });
    } catch (e) { next(e); }
  });

  app.post("/api/admin/password-reset-requests/:id/reject", requireSystemAdmin, async (req, res, next) => {
    try {
      const requestId = parseRouteId(req.params.id);
      const resetRequest = await storage.getPasswordResetRequestById(requestId);
      if (!resetRequest) {
        return res.status(404).json({ message: "طلب إعادة التعيين غير موجود" });
      }
      if (resetRequest.status !== "pending") {
        return res.status(400).json({ message: "تمت معالجة هذا الطلب مسبقًا" });
      }
      await runQueuedWrite(res, buildWriteQueueKey("admin-password-reset", requestId), () => storage.updatePasswordResetRequest(requestId, { status: "rejected", adminUserId: req.user!.id, resolvedAt: Math.floor(Date.now() / 1000) }));
      await writeAuditEvent({ action: "admin.password_reset.rejected", actorUserId: req.user?.id, actorRole: req.user?.role, targetUserId: resetRequest.userId, ipAddress: req.ip, metadata: { requestId } });
      res.json({ message: "تم رفض طلب إعادة التعيين" });
    } catch (e) { next(e); }
  });

  app.patch("/api/admin/users/:id", requireSystemAdmin, async (req, res, next) => {
    try {
      const userId = parseRouteId(req.params.id);
      if (req.user!.id === userId) {
        return res.status(400).json({ message: "لا يمكنك تعديل حسابك الإداري من هذه الصفحة" });
      }

      const { isActive } = adminUserUpdateSchema.parse(req.body);
      const updated = await runQueuedWrite(
        res,
        buildWriteQueueKey("admin-user", userId),
        () => storage.updateUser(userId, { isActive }),
      );
      await writeAuditEvent({
        action: "admin.user.status_updated",
        actorUserId: req.user?.id,
        actorRole: req.user?.role,
        targetUserId: userId,
        ipAddress: req.ip,
        metadata: { isActive },
      });
      res.json(toAdminUser(updated));
    } catch (e) { next(e); }
  });

  app.delete("/api/admin/users/:id", requireSystemAdmin, async (req, res, next) => {
    try {
      const userId = parseRouteId(req.params.id);
      if (req.user!.id === userId) {
        return res.status(400).json({ message: "لا يمكنك حذف حسابك الإداري الحالي" });
      }

      await runQueuedWrite(
        res,
        buildWriteQueueKey("admin-user", userId),
        () => storage.deleteUser(userId),
      );
      await writeAuditEvent({
        action: "admin.user.deleted",
        actorUserId: req.user?.id,
        actorRole: req.user?.role,
        targetUserId: userId,
        ipAddress: req.ip,
      });
      res.json({ message: "تم حذف المستخدم بنجاح" });
    } catch (e) { next(e); }
  });

  async function buildIntegrationView(req: Request, provider: IntegrationProvider) {
    const [record, effective] = await Promise.all([
      getIntegrationRecord(provider),
      getProviderConfig(provider),
    ]);

    const defaultRedirectUri = `${resolveAppBaseUrl(req)}${PROVIDER_CALLBACK_PATHS[provider]}`;
    // A saved record stays the source of truth for what the form shows, even while
    // disabled — otherwise switching the provider off would blank out its fields.
    const storedSecret = record ? decryptSecret(record.clientSecretEncrypted) : null;

    return {
      provider,
      label: PROVIDER_LABELS[provider],
      configured: Boolean(effective),
      source: effective?.source ?? null,
      hasDatabaseRecord: Boolean(record),
      isEnabled: record?.isEnabled ?? true,
      clientId: record?.clientId ?? effective?.clientId ?? "",
      clientSecretMasked: maskSecret(record ? storedSecret : effective?.clientSecret ?? null),
      tenantId: record?.tenantId ?? effective?.tenantId ?? "",
      redirectUri: record?.redirectUri ?? "",
      effectiveRedirectUri: record?.redirectUri || effective?.redirectUri || defaultRedirectUri,
      defaultRedirectUri,
      updatedAt: record?.updatedAt ?? null,
    };
  }

  function parseIntegrationProvider(value: string | string[]): IntegrationProvider | null {
    const provider = Array.isArray(value) ? value[0] : value;
    return INTEGRATION_PROVIDERS.includes(provider as IntegrationProvider) ? (provider as IntegrationProvider) : null;
  }

  app.get("/api/admin/integrations", requireSystemAdmin, async (req, res, next) => {
    try {
      const views = await Promise.all(INTEGRATION_PROVIDERS.map((provider) => buildIntegrationView(req, provider)));
      res.json(views);
    } catch (e) { next(e); }
  });

  app.put("/api/admin/integrations/:provider", requireSystemAdmin, async (req, res, next) => {
    try {
      const provider = parseIntegrationProvider(req.params.provider);
      if (!provider) {
        return res.status(404).json({ message: "مزوّد غير مدعوم" });
      }

      const input = upsertIntegrationSettingSchema.parse(req.body);
      const existing = await getIntegrationRecord(provider);
      if (!existing && !input.clientSecret) {
        return res.status(400).json({ message: "يجب إدخال المفتاح السري (Client Secret) عند الحفظ لأول مرة" });
      }

      const now = Math.floor(Date.now() / 1000);
      await runQueuedWrite(res, buildWriteQueueKey("admin-integration", provider), async () => {
        const values = {
          clientId: input.clientId,
          tenantId: input.tenantId?.trim() || null,
          redirectUri: input.redirectUri?.trim() || null,
          isEnabled: input.isEnabled ?? existing?.isEnabled ?? true,
          updatedByUserId: req.user!.id,
          updatedAt: now,
        };

        if (existing) {
          return db.update(integrationSettings).set({
            ...values,
            ...(input.clientSecret ? { clientSecretEncrypted: encryptSecret(input.clientSecret) } : {}),
          }).where(eq(integrationSettings.provider, provider));
        }

        return db.insert(integrationSettings).values({
          provider,
          clientSecretEncrypted: encryptSecret(input.clientSecret!),
          ...values,
        });
      });

      invalidateProviderCache(provider);
      await writeAuditEvent({
        action: "admin.integration.updated",
        actorUserId: req.user?.id,
        actorRole: req.user?.role,
        targetUserId: null,
        ipAddress: req.ip,
        metadata: { provider, secretRotated: Boolean(input.clientSecret), isEnabled: input.isEnabled ?? existing?.isEnabled ?? true },
      });
      res.json(await buildIntegrationView(req, provider));
    } catch (e) { next(e); }
  });

  app.delete("/api/admin/integrations/:provider", requireSystemAdmin, async (req, res, next) => {
    try {
      const provider = parseIntegrationProvider(req.params.provider);
      if (!provider) {
        return res.status(404).json({ message: "مزوّد غير مدعوم" });
      }

      const existing = await getIntegrationRecord(provider);
      if (!existing) {
        return res.status(404).json({ message: "لا توجد مفاتيح محفوظة لهذا المزوّد" });
      }

      await runQueuedWrite(res, buildWriteQueueKey("admin-integration", provider), () =>
        db.delete(integrationSettings).where(eq(integrationSettings.provider, provider)));

      invalidateProviderCache(provider);
      await writeAuditEvent({
        action: "admin.integration.deleted",
        actorUserId: req.user?.id,
        actorRole: req.user?.role,
        targetUserId: null,
        ipAddress: req.ip,
        metadata: { provider },
      });
      res.json(await buildIntegrationView(req, provider));
    } catch (e) { next(e); }
  });

  app.post("/api/admin/integrations/:provider/test", requireSystemAdmin, async (req, res, next) => {
    try {
      const provider = parseIntegrationProvider(req.params.provider);
      if (!provider) {
        return res.status(404).json({ message: "مزوّد غير مدعوم" });
      }

      const config = await getProviderConfig(provider);
      if (!config) {
        return res.status(400).json({ ok: false, message: "لا توجد مفاتيح مفعّلة لهذا المزوّد. احفظ المفاتيح وفعّلها أولاً." });
      }

      const result = await testProviderCredentials(config);
      await writeAuditEvent({
        action: "admin.integration.tested",
        actorUserId: req.user?.id,
        actorRole: req.user?.role,
        targetUserId: null,
        ipAddress: req.ip,
        metadata: { provider, ok: result.ok },
      });
      res.json(result);
    } catch (e) { next(e); }
  });

  /**
   * Delivery credentials for the notification channels. Secrets are write-only:
   * the view returns whether one is stored and a masked hint, never the value,
   * and an empty field on save keeps whatever is already there.
   */
  async function buildChannelsView() {
    const [emailRecord, pushRecord, emailStored, pushStored, mailConfig, pushConfig] = await Promise.all([
      getChannelRecord("email"),
      getChannelRecord("push"),
      readStoredConfig<Record<string, unknown>>("email"),
      readStoredConfig<Record<string, unknown>>("push"),
      resolveMailConfig(),
      resolvePushConfig(),
    ]);

    return {
      email: {
        channel: "email" as const,
        label: "البريد الإلكتروني (SMTP)",
        configured: Boolean(mailConfig),
        source: mailConfig?.source ?? null,
        hasDatabaseRecord: Boolean(emailRecord),
        isEnabled: emailRecord?.isEnabled ?? true,
        updatedAt: emailRecord?.updatedAt ?? null,
        host: String(emailStored?.host ?? "") || (emailRecord ? "" : mailConfig?.host ?? ""),
        port: Number(emailStored?.port ?? 0) || (emailRecord ? 587 : mailConfig?.port ?? 587),
        secure: Boolean(emailStored?.secure ?? (emailRecord ? false : mailConfig?.secure ?? false)),
        requireAuth: emailStored ? emailStored.requireAuth !== false : mailConfig?.requireAuth ?? true,
        user: String(emailStored?.user ?? "") || (emailRecord ? "" : mailConfig?.user ?? ""),
        from: String(emailStored?.from ?? "") || (emailRecord ? "" : mailConfig?.from ?? ""),
        passMasked: maskSecret(emailStored?.pass ? String(emailStored.pass) : null),
      },
      push: {
        channel: "push" as const,
        label: "إشعارات المتصفح (Web Push)",
        configured: Boolean(pushConfig),
        source: pushConfig?.source ?? null,
        hasDatabaseRecord: Boolean(pushRecord),
        isEnabled: pushRecord?.isEnabled ?? true,
        updatedAt: pushRecord?.updatedAt ?? null,
        publicKey: String(pushStored?.publicKey ?? "") || (pushRecord ? "" : pushConfig?.publicKey ?? ""),
        subject: String(pushStored?.subject ?? "") || (pushRecord ? "" : pushConfig?.subject ?? ""),
        privateKeyMasked: maskSecret(pushStored?.privateKey ? String(pushStored.privateKey) : null),
      },
    };
  }

  app.get("/api/admin/channels", requireSystemAdmin, async (_req, res, next) => {
    try {
      res.json(await buildChannelsView());
    } catch (e) { next(e); }
  });

  app.put("/api/admin/channels/email", requireSystemAdmin, async (req, res, next) => {
    try {
      const input = upsertEmailChannelSchema.parse(req.body);
      const stored = await readStoredConfig<Record<string, unknown>>("email");
      const pass = input.pass?.trim() || String(stored?.pass ?? "");

      if (input.requireAuth && (!input.user || !pass)) {
        return res.status(400).json({ message: "المصادقة مفعّلة، فيجب إدخال اسم المستخدم وكلمة المرور" });
      }

      await runQueuedWrite(res, buildWriteQueueKey("admin-channel", "email"), () => saveChannelConfig("email", {
        host: input.host,
        port: input.port,
        secure: input.secure,
        requireAuth: input.requireAuth,
        user: input.user ?? "",
        pass,
        from: input.from?.trim() || input.user || "",
      }, { isEnabled: input.isEnabled ?? true, updatedByUserId: req.user!.id }));

      await writeAuditEvent({
        action: "admin.channel.updated",
        actorUserId: req.user?.id,
        actorRole: req.user?.role,
        targetUserId: null,
        ipAddress: req.ip,
        metadata: { channel: "email", secretRotated: Boolean(input.pass?.trim()), isEnabled: input.isEnabled ?? true },
      });
      res.json(await buildChannelsView());
    } catch (e) { next(e); }
  });

  app.put("/api/admin/channels/push", requireSystemAdmin, async (req, res, next) => {
    try {
      const input = upsertPushChannelSchema.parse(req.body);
      const stored = await readStoredConfig<Record<string, unknown>>("push");
      const privateKey = input.privateKey?.trim() || String(stored?.privateKey ?? "");

      if (!privateKey) {
        return res.status(400).json({ message: "يجب إدخال المفتاح الخاص (Private Key) أو توليد زوج مفاتيح جديد" });
      }

      await runQueuedWrite(res, buildWriteQueueKey("admin-channel", "push"), () => saveChannelConfig("push", {
        publicKey: input.publicKey,
        privateKey,
        subject: input.subject?.trim() || "mailto:admin@eltizam.app",
      }, { isEnabled: input.isEnabled ?? true, updatedByUserId: req.user!.id }));

      await writeAuditEvent({
        action: "admin.channel.updated",
        actorUserId: req.user?.id,
        actorRole: req.user?.role,
        targetUserId: null,
        ipAddress: req.ip,
        metadata: { channel: "push", secretRotated: Boolean(input.privateKey?.trim()), isEnabled: input.isEnabled ?? true },
      });
      res.json(await buildChannelsView());
    } catch (e) { next(e); }
  });

  /** Hands back a fresh pair for the admin to save. Replacing a live pair
   *  invalidates every subscription already handed out, so the UI warns first. */
  app.post("/api/admin/channels/push/generate", requireSystemAdmin, async (_req, res, next) => {
    try {
      res.json(generateVapidKeys());
    } catch (e) { next(e); }
  });

  app.delete("/api/admin/channels/:channel", requireSystemAdmin, async (req, res, next) => {
    try {
      const channel = req.params.channel === "email" || req.params.channel === "push" ? req.params.channel : null;
      if (!channel) return res.status(404).json({ message: "قناة غير مدعومة" });

      const existing = await getChannelRecord(channel);
      if (!existing) return res.status(404).json({ message: "لا توجد إعدادات محفوظة لهذه القناة" });

      await runQueuedWrite(res, buildWriteQueueKey("admin-channel", channel), () => deleteChannelConfig(channel));
      await writeAuditEvent({
        action: "admin.channel.deleted",
        actorUserId: req.user?.id,
        actorRole: req.user?.role,
        targetUserId: null,
        ipAddress: req.ip,
        metadata: { channel },
      });
      res.json(await buildChannelsView());
    } catch (e) { next(e); }
  });

  /** Proves the saved SMTP settings actually deliver, rather than only parsing. */
  app.post("/api/admin/channels/email/test", requireSystemAdmin, async (req, res, next) => {
    try {
      const { to } = z.object({ to: z.string().trim().email("بريد غير صالح") }).parse(req.body);
      await sendTestEmail(to);
      res.json({ ok: true, message: `أُرسلت رسالة تجريبية إلى ${to}` });
    } catch (error) {
      if (error instanceof z.ZodError) return next(error);
      res.json({ ok: false, message: error instanceof Error ? error.message : "تعذر الإرسال" });
    }
  });

  app.get("/api/wallets", requireAuth, async (req, res, next) => {
    try {
      const wallets = await storage.getWallets(req.user!.id);
      res.json(wallets);
    } catch (e) { next(e); }
  });

  app.post("/api/wallets", requireAuth, async (req, res, next) => {
    try {
      const data = insertWalletSchema.parse(req.body);
      const wallet = await runQueuedWrite(
        res,
        buildWriteQueueKey("user", req.user!.id, "wallets"),
        () => storage.createWallet(req.user!.id, data),
      );
      res.status(201).json(wallet);
    } catch (e) { next(e); }
  });

  app.patch("/api/wallets/:id", requireAuth, async (req, res, next) => {
    try {
      const walletId = parseRouteId(req.params.id);
      const body = {
        ...req.body,
        balance: req.body.balance === undefined ? undefined : toRequiredNumber(req.body.balance),
      };
      const { balance, ...rest } = walletUpdateSchema.parse(body);
      const wallet = await runQueuedWrite(
        res,
        buildWriteQueueKey("user", req.user!.id, "wallet", walletId),
        async () => {
          if (Object.keys(rest).length > 0) {
            await storage.updateWallet(walletId, req.user!.id, rest);
          }
          // A balance typed by hand is a claim the transactions do not explain,
          // so it goes through the path that books the difference as "unknown"
          // instead of silently overwriting the number.
          return balance === undefined
            ? storage.updateWallet(walletId, req.user!.id, {})
            : storage.setWalletBalance(walletId, req.user!.id, balance);
        },
      );
      res.json(wallet);
    } catch (e) { next(e); }
  });

  app.delete("/api/wallets/:id", requireAuth, async (req, res, next) => {
    try {
      const walletId = parseRouteId(req.params.id);
      await runQueuedWrite(
        res,
        buildWriteQueueKey("user", req.user!.id, "wallet", walletId),
        () => storage.deleteWallet(walletId, req.user!.id),
      );
      res.json({ message: "تم حذف المحفظة بنجاح" });
    } catch (e) { next(e); }
  });

  app.get("/api/categories", requireAuth, async (req, res, next) => {
    try {
      const cats = await storage.getCategories(req.user!.id);
      res.json(cats);
    } catch (e) { next(e); }
  });

  app.post("/api/categories", requireAuth, async (req, res, next) => {
    try {
      const data = insertCategorySchema.parse(req.body);
      const cat = await runQueuedWrite(
        res,
        buildWriteQueueKey("user", req.user!.id, "categories"),
        () => storage.createCategory(req.user!.id, data),
      );
      res.status(201).json(cat);
    } catch (e) { next(e); }
  });

  app.patch("/api/categories/:id", requireAuth, async (req, res, next) => {
    try {
      const categoryId = parseRouteId(req.params.id);
      const body = {
        ...req.body,
        budget: req.body.budget === undefined ? undefined : toRequiredNumber(req.body.budget),
      };
      const data = categoryUpdateSchema.parse(body);
      const cat = await runQueuedWrite(
        res,
        buildWriteQueueKey("user", req.user!.id, "category", categoryId),
        () => storage.updateCategory(categoryId, req.user!.id, data),
      );
      res.json(cat);
    } catch (e) { next(e); }
  });

  app.delete("/api/categories/:id", requireAuth, async (req, res, next) => {
    try {
      const categoryId = parseRouteId(req.params.id);
      await runQueuedWrite(
        res,
        buildWriteQueueKey("user", req.user!.id, "category", categoryId),
        () => storage.deleteCategory(categoryId, req.user!.id),
      );
      res.json({ message: "تم حذف الفئة بنجاح" });
    } catch (e) { next(e); }
  });

  app.get("/api/transactions", requireAuth, async (req, res, next) => {
    try {
      await storage.applyDueRecurringIncomes(req.user!.id);
      const txs = await storage.getTransactions(req.user!.id);
      res.json(txs);
    } catch (e) { next(e); }
  });

  app.get("/api/recurring-incomes", requireAuth, async (req, res, next) => {
    try {
      const incomes = await storage.getRecurringIncomes(req.user!.id);
      res.json(incomes);
    } catch (e) { next(e); }
  });

  app.post("/api/recurring-incomes", requireAuth, async (req, res, next) => {
    try {
      const body = {
        ...req.body,
        amount: toRequiredNumber(req.body.amount),
        dayOfMonth: toRequiredNumber(req.body.dayOfMonth),
        walletId: toRequiredNumber(req.body.walletId),
        categoryId: req.body.categoryId === null || req.body.categoryId === undefined ? null : toOptionalNumber(req.body.categoryId),
      };
      const data = insertRecurringIncomeSchema.parse(body);
      const recurringIncome = await runQueuedWrite(
        res,
        buildWriteQueueKey("user", req.user!.id, "recurring-incomes"),
        () => storage.createRecurringIncome(req.user!.id, data),
      );
      res.status(201).json(recurringIncome);
    } catch (e) { next(e); }
  });

  app.patch("/api/recurring-incomes/:id", requireAuth, async (req, res, next) => {
    try {
      const recurringIncomeId = parseRouteId(req.params.id);
      const body = {
        ...req.body,
        amount: req.body.amount === undefined || req.body.amount === null ? undefined : toRequiredNumber(req.body.amount),
        dayOfMonth: req.body.dayOfMonth === undefined || req.body.dayOfMonth === null ? undefined : toRequiredNumber(req.body.dayOfMonth),
        walletId: req.body.walletId === undefined || req.body.walletId === null ? undefined : toRequiredNumber(req.body.walletId),
        categoryId: req.body.categoryId === undefined ? undefined : req.body.categoryId === null ? null : toOptionalNumber(req.body.categoryId),
      };
      const data = recurringIncomePatchSchema.parse(body);
      const recurringIncome = await runQueuedWrite(
        res,
        buildWriteQueueKey("user", req.user!.id, "recurring-income", recurringIncomeId),
        () => storage.updateRecurringIncome(recurringIncomeId, req.user!.id, data),
      );
      res.json(recurringIncome);
    } catch (e) { next(e); }
  });

  app.delete("/api/recurring-incomes/:id", requireAuth, async (req, res, next) => {
    try {
      const recurringIncomeId = parseRouteId(req.params.id);
      await runQueuedWrite(
        res,
        buildWriteQueueKey("user", req.user!.id, "recurring-income", recurringIncomeId),
        () => storage.deleteRecurringIncome(recurringIncomeId, req.user!.id),
      );
      res.json({ message: "تم حذف الدخل المتكرر بنجاح" });
    } catch (e) { next(e); }
  });

  app.post("/api/transactions", requireAuth, async (req, res, next) => {
    try {
      const input = transactionCreateRequestSchema.parse(req.body);
      const body = {
        ...input,
        amount: toRequiredNumber(input.amount),
        categoryId: toOptionalNumber(input.categoryId),
        walletId: toOptionalNumber(input.walletId),
        targetWalletId: toOptionalNumber(input.targetWalletId),
      };
      if (input.type === "transfer") {
        if (!body.walletId || !body.targetWalletId) {
          throw new Error("يجب اختيار المحفظة المحوَّل منها والمحفظة المحوَّل إليها");
        }
        const sourceWalletId = Number(body.walletId);
        const targetWalletId = Number(body.targetWalletId);
        const transferAmount = Number(body.amount);

        const tx = await runQueuedWrite(
          res,
          buildWriteQueueKey("user", req.user!.id, "wallet", sourceWalletId, "transfer", targetWalletId),
          () => storage.createTransfer(req.user!.id, {
            sourceWalletId,
            targetWalletId,
            amount: transferAmount,
            note: body.note,
          }),
        );
        return res.status(201).json(tx);
      }

      const data = insertTransactionSchema.parse(body);
      const tx = await runQueuedWrite(
        res,
        buildWriteQueueKey("user", req.user!.id, "wallet", data.walletId, "transactions"),
        () => storage.createTransaction(req.user!.id, data),
      );
      res.status(201).json(tx);
    } catch (e) { next(e); }
  });

  /**
   * Recategorising a transaction that came from a bank email also teaches the
   * inbox, so the same payee is filed correctly next time without the user
   * having to make the same correction again.
   */
  app.patch("/api/transactions/:id", requireAuth, async (req, res, next) => {
    try {
      const input = z.object({
        categoryId: z.number().int().positive().nullable(),
        // Whether this is a decision about the payee or a one-off correction.
        // Remembering a one-off would quietly re-file every other row from them.
        applyToAll: z.boolean().optional().default(true),
      }).parse(req.body);

      const transactionId = parseRouteId(req.params.id);
      const userId = req.user!.id;

      const [existing] = await db.select().from(transactions)
        .where(and(eq(transactions.id, transactionId), eq(transactions.userId, userId)));
      if (!existing) return res.status(404).json({ message: "الحركة غير موجودة" });

      if (input.categoryId) {
        const [ownedCategory] = await db.select({ id: categories.id }).from(categories)
          .where(and(eq(categories.id, input.categoryId), eq(categories.userId, userId)));
        if (!ownedCategory) return res.status(404).json({ message: "التصنيف المحدد غير موجود" });
      }

      const [updated] = await db.update(transactions)
        .set({ categoryId: input.categoryId })
        .where(and(eq(transactions.id, transactionId), eq(transactions.userId, userId)))
        .returning();

      const [linkedEvent] = await db.select().from(bankEmailEvents)
        .where(and(eq(bankEmailEvents.transactionId, transactionId), eq(bankEmailEvents.userId, userId)));

      let ruleLabel: string | null = null;
      let appliedToOthers = 0;

      if (linkedEvent) {
        await db.update(bankEmailEvents).set({ categoryId: input.categoryId })
          .where(eq(bankEmailEvents.id, linkedEvent.id));

        const ruleKey = input.applyToAll ? buildRuleKey(linkedEvent.counterparty, linkedEvent.merchant) : null;
        if (ruleKey) {
          const now = Math.floor(Date.now() / 1000);
          ruleLabel = linkedEvent.counterparty || linkedEvent.merchant || ruleKey;
          await db.insert(bankCategoryRules).values({
            userId,
            matchKey: ruleKey,
            matchLabel: ruleLabel,
            categoryId: input.categoryId,
            updatedAt: now,
          }).onConflictDoUpdate({
            target: [bankCategoryRules.userId, bankCategoryRules.matchKey],
            set: { categoryId: input.categoryId, matchLabel: ruleLabel, updatedAt: now },
          });

          // The decision is about the payee, not this one row, so every other
          // transaction already imported from them follows it too.
          const siblings = await db.select({
            id: bankEmailEvents.id,
            transactionId: bankEmailEvents.transactionId,
            counterparty: bankEmailEvents.counterparty,
            merchant: bankEmailEvents.merchant,
          }).from(bankEmailEvents).where(eq(bankEmailEvents.userId, userId));

          const sameParty = siblings.filter((sibling) =>
            sibling.id !== linkedEvent.id && buildRuleKey(sibling.counterparty, sibling.merchant) === ruleKey);

          for (const sibling of sameParty) {
            await db.update(bankEmailEvents).set({ categoryId: input.categoryId })
              .where(eq(bankEmailEvents.id, sibling.id));
            if (sibling.transactionId) {
              await db.update(transactions).set({ categoryId: input.categoryId })
                .where(and(eq(transactions.id, sibling.transactionId), eq(transactions.userId, userId)));
              // Only rows that reached the transactions list are visible changes,
              // so pending suggestions must not inflate what we report back.
              appliedToOthers += 1;
            }
          }
        }
      }

      res.json({ ...updated, ruleSaved: Boolean(ruleLabel), ruleLabel, appliedToOthers });
    } catch (e) { next(e); }
  });

  app.delete("/api/transactions/:id", requireAuth, async (req, res, next) => {
    try {
      const transactionId = parseRouteId(req.params.id);
      await runQueuedWrite(
        res,
        buildWriteQueueKey("user", req.user!.id, "transactions"),
        () => storage.deleteTransaction(transactionId, req.user!.id),
      );
      res.json({ message: "تم حذف الحركة بنجاح" });
    } catch (e) { next(e); }
  });

  app.get("/api/dashboard", requireAuth, async (req, res, next) => {
    try {
      await storage.applyDueRecurringIncomes(req.user!.id);
      const [walletsData, txsData] = await Promise.all([
        storage.getWallets(req.user!.id),
        storage.getTransactions(req.user!.id),
      ]);
      const visibleTransactions = txsData.filter((tx) => !(typeof tx.note === "string" && tx.note.startsWith("__transfer__:")));

      const totalBalance = walletsData.reduce((acc, w) => acc + w.balance, 0);
      const totalIncome = visibleTransactions.filter(t => t.type === "income").reduce((acc, t) => acc + t.amount, 0);
      const totalExpenses = visibleTransactions.filter(t => t.type === "expense" || t.type === "debt").reduce((acc, t) => acc + t.amount, 0);
      const recentTransactions = visibleTransactions.slice(0, 5);

      res.json({ totalBalance, totalIncome, totalExpenses, recentTransactions });
    } catch (e) { next(e); }
  });

  app.get("/api/reports/summary", requireAuth, async (req, res, next) => {
    try {
      await storage.applyDueRecurringIncomes(req.user!.id);
      const period = typeof req.query.period === "string" ? req.query.period : "1month";
      const [txsData, walletsData, obligationsData, recurringIncomesData] = await Promise.all([
        storage.getTransactions(req.user!.id),
        storage.getWallets(req.user!.id),
        storage.getObligations(req.user!.id),
        storage.getRecurringIncomes(req.user!.id),
      ]);

      const { start, end } = getPeriodRange(period);
      const filteredTransactions = txsData.filter((tx) => {
        const date = new Date(tx.date * 1000);
        return date >= start && date <= end;
      }).filter((tx) => !(typeof tx.note === "string" && tx.note.startsWith("__transfer__:")));

      const incomeTransactions = filteredTransactions.filter((tx) => tx.type === "income");
      const outflowTransactions = filteredTransactions.filter((tx) => tx.type === "expense" || tx.type === "debt");
      const totalIncome = incomeTransactions.reduce((sum, tx) => sum + tx.amount, 0);
      const totalExpenses = outflowTransactions.reduce((sum, tx) => sum + tx.amount, 0);
      const netFlow = totalIncome - totalExpenses;
      const savingsRate = totalIncome > 0 ? (netFlow / totalIncome) * 100 : 0;

      const recurringConfiguredTotal = recurringIncomesData.filter((item) => item.isActive).reduce((sum, item) => sum + item.amount, 0);
      const salarySourceCount = recurringIncomesData.filter((item) => item.isActive && item.incomeType === "salary").length;

      const expensesByCategoryMap = new Map<string, { categoryName: string; total: number; count: number }>();
      for (const tx of outflowTransactions) {
        const key = String(tx.categoryId ?? "uncategorized");
        const current = expensesByCategoryMap.get(key) ?? { categoryName: tx.categoryName || "غير مصنف", total: 0, count: 0 };

        current.total += tx.amount;
        current.count += 1;
        expensesByCategoryMap.set(key, current);
      }

      const expensesByCategory = Array.from(expensesByCategoryMap.entries())
        .map(([key, value]) => ({ categoryId: key === "uncategorized" ? null : Number(key), ...value }))
        .sort((a, b) => b.total - a.total);

      const walletBreakdown = walletsData.map((wallet) => {
        const walletTransactions = filteredTransactions.filter((tx) => tx.walletId === wallet.id);
        const income = walletTransactions.filter((tx) => tx.type === "income").reduce((sum, tx) => sum + tx.amount, 0);
        const expenses = walletTransactions.filter((tx) => tx.type === "expense" || tx.type === "debt").reduce((sum, tx) => sum + tx.amount, 0);
        return {
          id: wallet.id,
          name: wallet.name,
          color: wallet.color,
          balance: wallet.balance,
          income,
          expenses,
          transactionCount: walletTransactions.length,
        };
      }).sort((a, b) => b.transactionCount - a.transactionCount);

      const timelineMap = new Map<string, { label: string; income: number; expenses: number }>();
      for (const tx of filteredTransactions) {
        const label = getBucketLabel(tx.date, period);
        const current = timelineMap.get(label) ?? { label, income: 0, expenses: 0 };
        if (tx.type === "income") {
          current.income += tx.amount;
        } else {
          current.expenses += tx.amount;
        }
        timelineMap.set(label, current);
      }

      const timeline = Array.from(timelineMap.values());
      const topExpenseCategory = expensesByCategory[0] ?? null;
      const mostUsedWallet = walletBreakdown[0] ?? null;
      const upcomingObligations = obligationsData
        .filter((obligation) => obligation.isActive)
        .slice(0, 5)
        .map((obligation) => ({
          id: obligation.id,
          title: obligation.title,
          amount: obligation.amount,
          dueDay: obligation.dueDay,
          dueMonth: obligation.dueMonth,
          dueDate: obligation.dueDate,
          frequency: obligation.frequency,
        }));

      const insights = [
        topExpenseCategory ? `أعلى بند صرف لديك خلال الفترة هو ${topExpenseCategory.categoryName} بقيمة ${topExpenseCategory.total.toFixed(2)} ر.ع` : null,
        mostUsedWallet ? `أكثر محفظة استخدامًا هي ${mostUsedWallet.name} بعدد ${mostUsedWallet.transactionCount} حركة` : null,
        salarySourceCount > 0 ? `لديك ${salarySourceCount} مصدر راتب نشط بإجمالي دوري ${recurringConfiguredTotal.toFixed(2)} ر.ع` : "يمكنك إضافة راتب شهري لتتبّع دخلك الثابت تلقائيًا",
        netFlow >= 0 ? `صافي التدفق المالي موجب بمقدار ${netFlow.toFixed(2)} ر.ع` : `هناك عجز مالي بمقدار ${Math.abs(netFlow).toFixed(2)} ر.ع`,
      ].filter(Boolean);

      res.json({
        period,
        summary: {
          totalIncome,
          totalExpenses,
          netFlow,
          savingsRate,
          transactionCount: filteredTransactions.length,
          recurringConfiguredTotal,
          salarySourceCount,
        },
        expensesByCategory,
        walletBreakdown,
        timeline,
        upcomingObligations,
        recentTransactions: filteredTransactions.slice(0, 8),
        insights,
      });
    } catch (e) { next(e); }
  });




  app.get("/api/savings-goals", requireAuth, async (req, res, next) => {
    try {
      res.json(await storage.getSavingsGoals(req.user!.id));
    } catch (e) { next(e); }
  });

  app.post("/api/savings-goals", requireAuth, async (req, res, next) => {
    try {
      const data = insertSavingsGoalSchema.parse({
        ...req.body,
        walletId: toRequiredNumber(req.body.walletId),
        targetAmount: toRequiredNumber(req.body.targetAmount),
        monthlyAmount: toRequiredNumber(req.body.monthlyAmount),
        years: toRequiredNumber(req.body.years),
      });
      const goal = await runQueuedWrite(
        res,
        buildWriteQueueKey("user", req.user!.id, "savings-goals"),
        () => storage.createSavingsGoal(req.user!.id, data),
      );
      res.status(201).json(goal);
    } catch (e) { next(e); }
  });

  app.delete("/api/savings-goals/:id", requireAuth, async (req, res, next) => {
    try {
      await runQueuedWrite(
        res,
        buildWriteQueueKey("user", req.user!.id, "savings-goals"),
        () => storage.deleteSavingsGoal(parseRouteId(req.params.id), req.user!.id),
      );
      res.json({ message: "تم حذف الهدف الادخاري بنجاح" });
    } catch (e) { next(e); }
  });
  /** Turns a typed or dictated sentence into a draft commitment. Works on rules
   *  alone; Claude is consulted only when the sentence is ambiguous. */
  app.post("/api/understand/commitment", requireAuth, async (req, res, next) => {
    try {
      const { text } = z.object({ text: z.string().trim().min(2).max(500) }).parse(req.body);
      res.json(await understandCommitment(text));
    } catch (e) { next(e); }
  });

  /** Reads an uploaded contract or invoice. Needs an AI key — there is no
   *  offline path to understanding an arbitrary scanned document. */
  app.post("/api/understand/document", requireAuth, uploadDocument.single("file"), async (req, res, next) => {
    try {
      if (!req.file) return res.status(400).json({ message: "لم يُرفق ملف" });
      if (!isClaudeConfigured()) {
        return res.status(503).json({ message: "قراءة المستندات تحتاج تفعيل الذكاء الاصطناعي من إدارة المنصة" });
      }

      res.json(await readDocument({
        base64: req.file.buffer.toString("base64"),
        mimeType: req.file.mimetype,
      }));
    } catch (e) { next(e); }
  });

  app.get("/api/understand/status", requireAuth, async (_req, res) => {
    res.json({ aiConfigured: isClaudeConfigured() });
  });

  app.post("/api/documents", requireAuth, uploadDocument.single("file"), async (req, res, next) => {
    try {
      if (!req.file) return res.status(400).json({ message: "لم يُرفق ملف" });

      const commitmentId = req.body.commitmentId ? parseRouteId(req.body.commitmentId) : null;
      if (commitmentId) {
        const [owned] = await db.select({ id: commitments.id }).from(commitments)
          .where(and(eq(commitments.id, commitmentId), eq(commitments.userId, req.user!.id)));
        if (!owned) return res.status(404).json({ message: "الالتزام غير موجود" });
      }

      const document = await storeDocument({
        userId: req.user!.id,
        commitmentId,
        // Browsers send the filename as latin1; without this Arabic names arrive mangled.
        fileName: Buffer.from(req.file.originalname, "latin1").toString("utf8"),
        mimeType: req.file.mimetype,
        buffer: req.file.buffer,
      });

      res.status(201).json(document);
    } catch (e) { next(e); }
  });

  app.get("/api/documents", requireAuth, async (req, res, next) => {
    try {
      const commitmentId = req.query.commitmentId ? Number(req.query.commitmentId) : undefined;
      res.json(await listDocuments(req.user!.id, commitmentId));
    } catch (e) { next(e); }
  });

  app.get("/api/documents/:id/download", requireAuth, async (req, res, next) => {
    try {
      const document = await getDocument(req.user!.id, parseRouteId(req.params.id));
      if (!document) return res.status(404).json({ message: "الملف غير موجود" });

      res.setHeader("Content-Type", document.mimeType);
      res.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(document.fileName)}`);
      res.sendFile(path.join(documentsRoot, document.storedName));
    } catch (e) { next(e); }
  });

  app.delete("/api/documents/:id", requireAuth, async (req, res, next) => {
    try {
      const removed = await deleteDocument(req.user!.id, parseRouteId(req.params.id));
      if (!removed) return res.status(404).json({ message: "الملف غير موجود" });
      res.json({ message: "تم حذف الملف" });
    } catch (e) { next(e); }
  });

  /** The subscribe URL for a calendar app, carrying the user's feed token. */
  app.get("/api/calendar/url", requireAuth, async (req, res, next) => {
    try {
      const token = calendarToken(req.user!.id);
      res.json({ url: `${resolveAppBaseUrl(req)}/api/calendar/${req.user!.id}/${token}.ics` });
    } catch (e) { next(e); }
  });

  /**
   * Deliberately unauthenticated: calendar apps poll this without a session.
   * The token is the credential, and it grants nothing but this feed.
   */
  app.get("/api/calendar/:userId/:token.ics", async (req, res, next) => {
    try {
      const userId = parseRouteId(req.params.userId);
      const token = String(req.params.token || "").replace(/\.ics$/, "");
      if (!Number.isFinite(userId) || token !== calendarToken(userId)) {
        return res.status(404).send("Not found");
      }

      // Oldest-first with a flat cap published the *earliest* 500 occurrences, so
      // once a user accumulated more than that the feed froze in the past and
      // upcoming dues stopped appearing — the one thing a calendar is for. The
      // window starts a month back, which keeps recent history visible without
      // letting years of it crowd out what has not happened yet.
      const feedFrom = Math.floor(Date.now() / 1000) - 30 * 86400;
      const events = await db.select({
        id: commitmentOccurrences.id,
        title: commitments.title,
        dueDate: commitmentOccurrences.dueDate,
        amount: commitmentOccurrences.amount,
        status: commitmentOccurrences.status,
      })
        .from(commitmentOccurrences)
        .innerJoin(commitments, eq(commitments.id, commitmentOccurrences.commitmentId))
        .where(and(
          eq(commitmentOccurrences.userId, userId),
          gte(commitmentOccurrences.dueDate, feedFrom),
        ))
        .orderBy(asc(commitmentOccurrences.dueDate))
        .limit(500);

      res.setHeader("Content-Type", "text/calendar; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache");
      res.send(buildCalendarFeed({ events }));
    } catch (e) { next(e); }
  });

  /** Risks, unnoticed subscriptions and the week in numbers — all computed from
   *  the user's own data, so this works without any AI provider configured. */
  app.get("/api/insights", requireAuth, async (req, res, next) => {
    try {
      const userId = req.user!.id;
      const [allTransactions, wallets, upcomingRows] = await Promise.all([
        storage.getTransactions(userId),
        storage.getWallets(userId),
        db.select({
          title: commitments.title,
          dueDate: commitmentOccurrences.dueDate,
          amount: commitmentOccurrences.amount,
          status: commitmentOccurrences.status,
        })
          .from(commitmentOccurrences)
          .innerJoin(commitments, eq(commitments.id, commitmentOccurrences.commitmentId))
          .where(eq(commitmentOccurrences.userId, userId)),
      ]);

      // Internal transfers move money between the user's own wallets; counting
      // them as spending would double every transfer in the totals.
      const spendable = allTransactions.filter(
        (transaction) => !(typeof transaction.note === "string" && transaction.note.startsWith("__transfer__:")),
      );
      const walletBalance = wallets.reduce((sum, wallet) => sum + wallet.balance, 0);

      res.json({
        risks: detectRisks({ transactions: spendable, walletBalance, upcoming: upcomingRows }),
        recurring: detectRecurring(spendable),
        weekly: buildWeeklySummary({ transactions: spendable, upcoming: upcomingRows }),
        walletBalance: Number(walletBalance.toFixed(3)),
      });
    } catch (e) { next(e); }
  });

  app.post("/api/insights/simulate", requireAuth, async (req, res, next) => {
    try {
      const input = z.object({
        newMonthlyCost: z.number().finite().positive(),
        months: z.number().int().min(1).max(120),
      }).parse(req.body);

      const userId = req.user!.id;
      const [wallets, incomes, activeCommitments] = await Promise.all([
        storage.getWallets(userId),
        storage.getRecurringIncomes(userId),
        db.select().from(commitments).where(and(eq(commitments.userId, userId), eq(commitments.status, "active"))),
      ]);

      const monthlyIncome = incomes
        .filter((income) => income.isActive)
        .reduce((sum, income) => sum + income.amount, 0);

      // Only recurring commitments represent an ongoing monthly claim on income.
      const committedMonthly = activeCommitments
        .filter((commitment) => commitment.frequency === "monthly" && commitment.amount)
        .reduce((sum, commitment) => sum + (commitment.amount ?? 0), 0);

      res.json(simulateDecision({
        monthlyIncome,
        walletBalance: wallets.reduce((sum, wallet) => sum + wallet.balance, 0),
        committedMonthly,
        newMonthlyCost: input.newMonthlyCost,
        months: input.months,
      }));
    } catch (e) { next(e); }
  });

  app.get("/api/notifications/preferences", requireAuth, async (req, res, next) => {
    try {
      const preferences = await getPreferences(req.user!.id);
      const [pushPublicKey, emailReady] = await Promise.all([getPublicVapidKey(), canSendMail()]);
      res.json({
        ...preferences,
        pushPublicKey,
        channels: {
          email: emailReady,
          push: Boolean(pushPublicKey),
          telegram: Boolean(process.env.TELEGRAM_BOT_TOKEN?.trim()),
          whatsapp: Boolean(process.env.WHATSAPP_TOKEN?.trim() && process.env.WHATSAPP_PHONE_ID?.trim()),
        },
      });
    } catch (e) { next(e); }
  });

  app.patch("/api/notifications/preferences", requireAuth, async (req, res, next) => {
    try {
      const input = z.object({
        emailEnabled: z.boolean().optional(),
        pushEnabled: z.boolean().optional(),
        telegramEnabled: z.boolean().optional(),
        telegramChatId: z.string().trim().max(64).nullable().optional(),
        whatsappEnabled: z.boolean().optional(),
        whatsappNumber: z.string().trim().max(32).nullable().optional(),
        webhookUrl: z.string().trim().url().max(500).nullable().optional().or(z.literal("")),
        weeklySummary: z.boolean().optional(),
        quietHoursStart: z.number().int().min(0).max(23).nullable().optional(),
        quietHoursEnd: z.number().int().min(0).max(23).nullable().optional(),
      }).parse(req.body);

      await getPreferences(req.user!.id);
      const [updated] = await db.update(notificationPreferences)
        .set({
          ...input,
          webhookUrl: input.webhookUrl === "" ? null : input.webhookUrl,
          updatedAt: Math.floor(Date.now() / 1000),
        })
        .where(eq(notificationPreferences.userId, req.user!.id))
        .returning();

      res.json(updated);
    } catch (e) { next(e); }
  });

  app.post("/api/notifications/push/subscribe", requireAuth, async (req, res, next) => {
    try {
      const subscription = z.object({
        endpoint: z.string().url(),
        keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
      }).parse(req.body);

      await savePushSubscription(req.user!.id, subscription);
      res.json({ message: "تم تفعيل الإشعارات على هذا الجهاز" });
    } catch (e) { next(e); }
  });

  app.post("/api/notifications/push/unsubscribe", requireAuth, async (req, res, next) => {
    try {
      const { endpoint } = z.object({ endpoint: z.string().url() }).parse(req.body);
      await removePushSubscription(req.user!.id, endpoint);
      res.json({ message: "تم إيقاف الإشعارات على هذا الجهاز" });
    } catch (e) { next(e); }
  });

  /** Sends a real notification through every enabled channel so the user can see
   *  which ones actually arrive rather than trusting the toggles. */
  app.post("/api/notifications/test", requireAuth, async (req, res, next) => {
    try {
      const result = await notify({
        userId: req.user!.id,
        title: "تجربة الإشعارات",
        body: "وصلتك هذه الرسالة، فالقناة تعمل.",
        dedupeKey: `test:${Date.now()}`,
        urgent: true,
      });
      res.json(result);
    } catch (e) { next(e); }
  });

  /** What the engine has done lately, newest first, with what can be reversed. */
  app.get("/api/automation/log", requireAuth, async (req, res, next) => {
    try {
      const entries = await db.select().from(automationLog)
        .where(eq(automationLog.userId, req.user!.id))
        .orderBy(desc(automationLog.createdAt))
        .limit(50);

      res.json(entries.map((entry) => ({
        id: entry.id,
        action: entry.action,
        summary: entry.summary,
        commitmentId: entry.commitmentId,
        occurrenceId: entry.occurrenceId,
        canUndo: Boolean(entry.undoPayload) && !entry.undoneAt,
        undoneAt: entry.undoneAt,
        createdAt: entry.createdAt,
      })));
    } catch (e) { next(e); }
  });

  app.post("/api/automation/log/:id/undo", requireAuth, async (req, res, next) => {
    try {
      const result = await undoAutomationEntry(req.user!.id, parseRouteId(req.params.id));
      if (!result.ok) return res.status(400).json({ message: result.message });
      res.json(result);
    } catch (e) { next(e); }
  });

  /** Lets the user pull the engine forward instead of waiting for its next pass. */
  app.post("/api/automation/run", requireAuth, async (req, res, next) => {
    try {
      const totals = await runAutomationForUser(req.user!.id);
      res.json(totals);
    } catch (e) { next(e); }
  });

  app.get("/api/commitments/:id/occurrences", requireAuth, async (req, res, next) => {
    try {
      const commitmentId = parseRouteId(req.params.id);
      const rows = await db.select().from(commitmentOccurrences).where(and(
        eq(commitmentOccurrences.commitmentId, commitmentId),
        eq(commitmentOccurrences.userId, req.user!.id),
      )).orderBy(asc(commitmentOccurrences.dueDate));
      res.json(rows);
    } catch (e) { next(e); }
  });

  /** Upcoming and overdue across every commitment — what the home screen needs. */
  app.get("/api/occurrences", requireAuth, async (req, res, next) => {
    try {
      const rows = await db.select({
        id: commitmentOccurrences.id,
        commitmentId: commitmentOccurrences.commitmentId,
        dueDate: commitmentOccurrences.dueDate,
        status: commitmentOccurrences.status,
        amount: commitmentOccurrences.amount,
        postponedFrom: commitmentOccurrences.postponedFrom,
        escalatedAt: commitmentOccurrences.escalatedAt,
        title: commitments.title,
        type: commitments.type,
        delegatedTo: commitments.delegatedTo,
      })
        .from(commitmentOccurrences)
        .innerJoin(commitments, eq(commitments.id, commitmentOccurrences.commitmentId))
        .where(and(
          eq(commitmentOccurrences.userId, req.user!.id),
          sql`${commitmentOccurrences.status} in ('pending','missed')`,
        ))
        .orderBy(asc(commitmentOccurrences.dueDate))
        .limit(100);
      res.json(rows);
    } catch (e) { next(e); }
  });

  app.post("/api/occurrences/:id/postpone", requireAuth, async (req, res, next) => {
    try {
      const { days } = z.object({ days: z.number().int().min(1).max(365) }).parse(req.body);
      const result = await postponeOccurrence(req.user!.id, parseRouteId(req.params.id), days);
      if (!result.ok) return res.status(404).json({ message: result.message });
      res.json(result);
    } catch (e) { next(e); }
  });

  app.patch("/api/occurrences/:id", requireAuth, async (req, res, next) => {
    try {
      const { status } = z.object({
        status: z.enum(["pending", "completed", "missed", "skipped"]),
      }).parse(req.body);

      const occurrenceId = parseRouteId(req.params.id);
      const [updated] = await db.update(commitmentOccurrences)
        .set({ status, completedAt: status === "completed" ? Math.floor(Date.now() / 1000) : null })
        .where(and(
          eq(commitmentOccurrences.id, occurrenceId),
          eq(commitmentOccurrences.userId, req.user!.id),
        ))
        .returning();

      if (!updated) return res.status(404).json({ message: "الموعد غير موجود" });
      res.json(updated);
    } catch (e) { next(e); }
  });

  app.get("/api/commitments/:id/steps", requireAuth, async (req, res, next) => {
    try {
      res.json(await storage.getCommitmentSteps(parseRouteId(req.params.id), req.user!.id));
    } catch (e) { next(e); }
  });

  app.post("/api/commitments/:id/steps", requireAuth, async (req, res, next) => {
    try {
      const data = insertCommitmentStepSchema.parse({
        ...req.body,
        position: req.body.position === undefined ? undefined : toRequiredNumber(req.body.position),
      });
      const commitmentId = parseRouteId(req.params.id);
      const step = await runQueuedWrite(
        res,
        buildWriteQueueKey("user", req.user!.id, "commitment", commitmentId, "steps"),
        () => storage.createCommitmentStep(commitmentId, req.user!.id, data),
      );
      res.status(201).json(step);
    } catch (e) { next(e); }
  });

  app.patch("/api/commitments/:id/steps/:stepId/toggle", requireAuth, async (req, res, next) => {
    try {
      const commitmentId = parseRouteId(req.params.id);
      const stepId = parseRouteId(req.params.stepId);
      const step = await runQueuedWrite(
        res,
        buildWriteQueueKey("user", req.user!.id, "commitment", commitmentId, "step", stepId),
        () => storage.toggleCommitmentStep(commitmentId, stepId, req.user!.id),
      );
      res.json(step);
    } catch (e) { next(e); }
  });

  app.delete("/api/commitments/:id/steps/:stepId", requireAuth, async (req, res, next) => {
    try {
      const commitmentId = parseRouteId(req.params.id);
      const stepId = parseRouteId(req.params.stepId);
      await runQueuedWrite(
        res,
        buildWriteQueueKey("user", req.user!.id, "commitment", commitmentId, "steps"),
        () => storage.deleteCommitmentStep(commitmentId, stepId, req.user!.id),
      );
      res.json({ message: "تم حذف الخطوة" });
    } catch (e) { next(e); }
  });

  app.get("/api/commitments/:id/proofs", requireAuth, async (req, res, next) => {
    try {
      res.json(await storage.getCommitmentProofs(parseRouteId(req.params.id), req.user!.id));
    } catch (e) { next(e); }
  });

  app.post("/api/commitments/:id/proofs", requireAuth, async (req, res, next) => {
    try {
      const data = insertCommitmentProofSchema.parse(req.body);
      const commitmentId = parseRouteId(req.params.id);
      const proof = await runQueuedWrite(
        res,
        buildWriteQueueKey("user", req.user!.id, "commitment", commitmentId, "proofs"),
        () => storage.createCommitmentProof(commitmentId, req.user!.id, data),
      );
      res.status(201).json(proof);
    } catch (e) { next(e); }
  });

  app.delete("/api/commitments/:id/proofs/:proofId", requireAuth, async (req, res, next) => {
    try {
      const commitmentId = parseRouteId(req.params.id);
      const proofId = parseRouteId(req.params.proofId);
      await runQueuedWrite(
        res,
        buildWriteQueueKey("user", req.user!.id, "commitment", commitmentId, "proofs"),
        () => storage.deleteCommitmentProof(commitmentId, proofId, req.user!.id),
      );
      res.json({ message: "تم حذف الإثبات" });
    } catch (e) { next(e); }
  });
  app.get("/api/commitments", requireAuth, async (req, res, next) => {
    try {
      res.json(await storage.getCommitments(req.user!.id));
    } catch (e) { next(e); }
  });

  app.get("/api/commitments/:id", requireAuth, async (req, res, next) => {
    try {
      const commitment = await storage.getCommitmentById(parseRouteId(req.params.id), req.user!.id);
      if (!commitment) {
        return res.status(404).json({ message: "الالتزام غير موجود" });
      }
      res.json(commitment);
    } catch (e) { next(e); }
  });

  app.post("/api/commitments", requireAuth, async (req, res, next) => {
    try {
      const data = insertCommitmentSchema.parse({
        ...req.body,
        dueDate: toOptionalNumber(req.body.dueDate),
        amount: toOptionalNumber(req.body.amount),
      });
      const commitment = await runQueuedWrite(
        res,
        buildWriteQueueKey("user", req.user!.id, "commitments"),
        () => storage.createCommitment(req.user!.id, data),
      );
      res.status(201).json(commitment);
    } catch (e) { next(e); }
  });

  app.patch("/api/commitments/:id", requireAuth, async (req, res, next) => {
    try {
      const data = commitmentPatchSchema.parse({
        ...req.body,
        dueDate: req.body.dueDate === undefined ? undefined : toOptionalNumber(req.body.dueDate),
        amount: req.body.amount === undefined ? undefined : toOptionalNumber(req.body.amount),
      });
      const commitment = await runQueuedWrite(
        res,
        buildWriteQueueKey("user", req.user!.id, "commitment", parseRouteId(req.params.id)),
        () => storage.updateCommitment(parseRouteId(req.params.id), req.user!.id, data),
      );
      res.json(commitment);
    } catch (e) { next(e); }
  });

  app.patch("/api/commitments/:id/status", requireAuth, async (req, res, next) => {
    try {
      const status = z.enum(["active", "completed", "postponed", "archived"]).parse(req.body.status);
      const commitment = await runQueuedWrite(
        res,
        buildWriteQueueKey("user", req.user!.id, "commitment", parseRouteId(req.params.id), "status"),
        () => storage.updateCommitmentStatus(parseRouteId(req.params.id), req.user!.id, status),
      );
      res.json(commitment);
    } catch (e) { next(e); }
  });

  app.delete("/api/commitments/:id", requireAuth, async (req, res, next) => {
    try {
      await runQueuedWrite(
        res,
        buildWriteQueueKey("user", req.user!.id, "commitments"),
        () => storage.deleteCommitment(parseRouteId(req.params.id), req.user!.id),
      );
      res.json({ message: "تم حذف الالتزام بنجاح" });
    } catch (e) { next(e); }
  });
  app.get("/api/obligations", requireAuth, async (req, res, next) => {
    try {
      const obligations = await storage.getObligations(req.user!.id);
      res.json(obligations);
    } catch (e) { next(e); }
  });

  app.get("/api/obligations/:id", requireAuth, async (req, res, next) => {
    try {
      const obligation = await storage.getObligationById(parseRouteId(req.params.id), req.user!.id);
      if (!obligation) {
        return res.status(404).json({ message: "الالتزام غير موجود" });
      }
      res.json(obligation);
    } catch (e) { next(e); }
  });

  app.get("/api/obligations/:id/variable-statuses", requireAuth, async (req, res, next) => {
    try {
      const statuses = await storage.getVariableObligationMonthStatuses(parseRouteId(req.params.id), req.user!.id);
      res.json(statuses);
    } catch (e) { next(e); }
  });

  app.patch("/api/obligations/:id/variable-statuses", requireAuth, async (req, res, next) => {
    try {
      const obligationId = parseRouteId(req.params.id);
      const body = {
        ...req.body,
        paidAt: req.body.paidAt === undefined
          ? undefined
          : req.body.paidAt === null
            ? null
            : typeof req.body.paidAt === "string"
              ? parseInt(req.body.paidAt)
              : req.body.paidAt,
        note: req.body.note === undefined ? undefined : req.body.note,
      };
      const data = insertVariableObligationMonthStatusSchema.parse(body);
      const status = await runQueuedWrite(
        res,
        buildWriteQueueKey("user", req.user!.id, "obligation", obligationId, "variable-statuses"),
        () => storage.upsertVariableObligationMonthStatus(obligationId, req.user!.id, data),
      );
      res.json(status);
    } catch (e) { next(e); }
  });

  app.post("/api/obligations/:id/apply-variable-payment", requireAuth, async (req, res, next) => {
    try {
      const obligationId = parseRouteId(req.params.id);
      const body = {
        amount: typeof req.body.amount === "string" ? parseFloat(req.body.amount) : req.body.amount,
      };
      const data = applyVariableObligationPaymentSchema.parse(body);
      const result = await runQueuedWrite(
        res,
        buildWriteQueueKey("user", req.user!.id, "obligation", obligationId, "variable-payment"),
        () => storage.applyVariableObligationPayment(obligationId, req.user!.id, data.amount),
      );
      res.json(result);
    } catch (e) { next(e); }
  });

  app.post("/api/obligations", requireAuth, async (req, res, next) => {
    try {
      const body = {
        ...req.body,
        amount: toRequiredNumber(req.body.amount),
        dueDay: toOptionalNumber(req.body.dueDay),
        dueMonth: toOptionalNumber(req.body.dueMonth),
        dueDate: toOptionalNumber(req.body.dueDate),
        scheduleType: req.body.scheduleType === null || req.body.scheduleType === undefined
          ? undefined
          : req.body.scheduleType,
        startDate: req.body.startDate === null || req.body.startDate === undefined
          ? undefined
          : toRequiredNumber(req.body.startDate),
        endDate: req.body.endDate === null || req.body.endDate === undefined
          ? null
          : toOptionalNumber(req.body.endDate),
        walletId: req.body.walletId === null || req.body.walletId === undefined
          ? null
          : toOptionalNumber(req.body.walletId),
        categoryId: req.body.categoryId === null || req.body.categoryId === undefined
          ? null
          : toOptionalNumber(req.body.categoryId),
      };
      const data = insertObligationSchema.parse(body);
      const obligation = await runQueuedWrite(
        res,
        buildWriteQueueKey("user", req.user!.id, "obligations"),
        () => storage.createObligation(req.user!.id, data),
      );
      res.status(201).json(obligation);
    } catch (e) { next(e); }
  });

  app.patch("/api/obligations/:id", requireAuth, async (req, res, next) => {
    try {
      const obligationId = parseRouteId(req.params.id);
      const body = {
        ...req.body,
        amount: req.body.amount === undefined || req.body.amount === null
          ? undefined
          : toRequiredNumber(req.body.amount),
        dueDay: req.body.dueDay === undefined
          ? undefined
          : req.body.dueDay === null
            ? null
            : toRequiredNumber(req.body.dueDay),
        dueMonth: req.body.dueMonth === undefined
          ? undefined
          : req.body.dueMonth === null
            ? null
            : toRequiredNumber(req.body.dueMonth),
        dueDate: req.body.dueDate === undefined
          ? undefined
          : req.body.dueDate === null
            ? null
            : toRequiredNumber(req.body.dueDate),
        scheduleType: req.body.scheduleType === undefined
          ? undefined
          : req.body.scheduleType,
        startDate: req.body.startDate === undefined
          ? undefined
          : req.body.startDate === null
            ? null
            : toRequiredNumber(req.body.startDate),
        endDate: req.body.endDate === undefined
          ? undefined
          : req.body.endDate === null
            ? null
            : toRequiredNumber(req.body.endDate),
        walletId: req.body.walletId === undefined
          ? undefined
          : req.body.walletId === null
            ? null
            : toRequiredNumber(req.body.walletId),
        categoryId: req.body.categoryId === undefined
          ? undefined
          : req.body.categoryId === null
            ? null
            : toRequiredNumber(req.body.categoryId),
      };
      const data = obligationPatchSchema.parse(body);
      const obligation = await runQueuedWrite(
        res,
        buildWriteQueueKey("user", req.user!.id, "obligation", obligationId),
        () => storage.updateObligation(obligationId, req.user!.id, data),
      );
      res.json(obligation);
    } catch (e) { next(e); }
  });

  app.delete("/api/obligations/:id", requireAuth, async (req, res, next) => {
    try {
      const obligationId = parseRouteId(req.params.id);
      await runQueuedWrite(
        res,
        buildWriteQueueKey("user", req.user!.id, "obligation", obligationId),
        () => storage.deleteObligation(obligationId, req.user!.id),
      );
      res.json({ message: "تم حذف الالتزام بنجاح" });
    } catch (e) { next(e); }
  });

  app.patch("/api/obligations/:id/toggle", requireAuth, async (req, res, next) => {
    try {
      const obligationId = parseRouteId(req.params.id);
      const obligation = await runQueuedWrite(
        res,
        buildWriteQueueKey("user", req.user!.id, "obligation", obligationId),
        () => storage.toggleObligation(obligationId, req.user!.id),
      );
      res.json(obligation);
    } catch (e) { next(e); }
  });

  return httpServer;
}




