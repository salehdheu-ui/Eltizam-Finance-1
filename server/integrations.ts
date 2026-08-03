import type { Express, NextFunction, Request, Response } from "express";
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "crypto";
import { promises as fs, mkdirSync } from "fs";
import { isIP } from "net";
import { lookup } from "dns/promises";
import path from "path";
import multer from "multer";
import webpush from "web-push";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import {
  bankEmailConnections,
  calendarEventLinks,
  commitments,
  integrationDocuments,
  integrationWebhookDeliveries,
  integrationWebhooks,
  pushSubscriptions,
  userNotificationSettings,
  users,
  type Commitment,
} from "@shared/schema";
import { db } from "./db";
import { canSendMail, sendIntegrationEmail } from "./mail";
import { getBankConnectionAccessToken } from "./bank-inbox";

const notificationSettingsSchema = z.object({
  emailEnabled: z.boolean().optional(),
  pushEnabled: z.boolean().optional(),
  whatsappEnabled: z.boolean().optional(),
  whatsappNumber: z.string().trim().regex(/^\+?[1-9]\d{7,14}$/, "رقم واتساب غير صالح").nullable().optional(),
  telegramEnabled: z.boolean().optional(),
  telegramChatId: z.string().trim().max(80).nullable().optional(),
}).refine((value) => Object.keys(value).length > 0, "لا توجد إعدادات للحفظ");

const pushSubscriptionSchema = z.object({
  endpoint: z.string().url().max(3000),
  keys: z.object({ p256dh: z.string().min(10).max(1000), auth: z.string().min(5).max(500) }),
});

const webhookSchema = z.object({
  name: z.string().trim().min(1).max(100),
  url: z.string().url().max(2000),
  events: z.array(z.enum(["reminder", "escalated", "completed"])).min(1).max(3),
});

const allowedDocumentMimeTypes = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);
const uploadsRoot = path.resolve(process.env.UPLOADS_DIR || path.join(process.cwd(), "uploads"));
const upload = multer({
  storage: multer.diskStorage({
    destination(req, _file, callback) {
      const destination = path.join(uploadsRoot, String(req.user!.id));
      try {
        mkdirSync(destination, { recursive: true });
        callback(null, destination);
      } catch (error) {
        callback(error as Error, destination);
      }
    },
    filename(_req, file, callback) {
      const extension = path.extname(file.originalname).toLowerCase().replace(/[^.a-z0-9]/g, "").slice(0, 10);
      callback(null, `${Date.now()}-${randomBytes(10).toString("hex")}${extension}`);
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter(_req, file, callback) {
    callback(null, allowedDocumentMimeTypes.has(file.mimetype));
  },
});

function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.isAuthenticated()) return res.status(401).json({ message: "غير مسجل الدخول" });
  next();
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function appBaseUrl() {
  return (process.env.PUBLIC_APP_URL || process.env.APP_BASE_URL || "").replace(/\/$/, "");
}

function secretKey(userId: number) {
  const source = process.env.TOKEN_ENCRYPTION_KEY || process.env.SESSION_SECRET;
  if (!source) throw new Error("TOKEN_ENCRYPTION_KEY or SESSION_SECRET is required");
  return createHash("sha256").update(`${source}:integration:${userId}`).digest();
}

function encryptSecret(value: string, userId: number) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", secretKey(userId), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
}

function decryptSecret(value: string, userId: number) {
  const [iv, tag, encrypted] = value.split(".");
  const decipher = createDecipheriv("aes-256-gcm", secretKey(userId), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(encrypted, "base64url")), decipher.final()]).toString("utf8");
}

async function ensureNotificationSettings(userId: number) {
  const [existing] = await db.select().from(userNotificationSettings).where(eq(userNotificationSettings.userId, userId));
  if (existing) return existing;
  const [created] = await db.insert(userNotificationSettings).values({ userId }).onConflictDoNothing().returning();
  if (created) return created;
  const [concurrent] = await db.select().from(userNotificationSettings).where(eq(userNotificationSettings.userId, userId));
  return concurrent;
}

function isPrivateAddress(address: string) {
  if (address === "::1" || address.startsWith("fe80:") || address.startsWith("fc") || address.startsWith("fd")) return true;
  if (!isIP(address)) return true;
  if (address.includes(":")) return false;
  const [a, b] = address.split(".").map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

async function assertSafeWebhookUrl(value: string) {
  const url = new URL(value);
  const allowHttp = process.env.NODE_ENV !== "production" || process.env.ALLOW_HTTP_WEBHOOKS === "true";
  if (url.protocol !== "https:" && !(allowHttp && url.protocol === "http:")) {
    throw new Error("رابط Webhook يجب أن يستخدم HTTPS");
  }
  if (url.username || url.password) throw new Error("بيانات الدخول داخل رابط Webhook غير مسموحة");
  const addresses = await lookup(url.hostname, { all: true });
  if (addresses.length === 0 || addresses.some((item) => isPrivateAddress(item.address))) {
    throw new Error("لا يمكن استخدام عنوان داخلي في Webhook");
  }
}

function configureWebPush() {
  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  if (!publicKey || !privateKey) return false;
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:admin@example.com", publicKey, privateKey);
  return true;
}

async function sendPush(userId: number, title: string, message: string, commitmentId?: number) {
  if (!configureWebPush()) throw new Error("Push غير مهيأ في المنصة");
  const subscriptions = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId));
  await Promise.all(subscriptions.map(async (subscription) => {
    try {
      await webpush.sendNotification({
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth },
      }, JSON.stringify({ title, body: message, url: commitmentId ? `/commitments/${commitmentId}` : "/" }));
    } catch (error: any) {
      if (error?.statusCode === 404 || error?.statusCode === 410) {
        await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, subscription.id));
      } else {
        throw error;
      }
    }
  }));
}

async function sendWhatsApp(number: string, message: string) {
  const url = process.env.WHATSAPP_API_URL?.trim();
  const token = process.env.WHATSAPP_ACCESS_TOKEN?.trim();
  if (!url || !token) throw new Error("WhatsApp غير مهيأ في المنصة");
  const response = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to: number.replace(/\D/g, ""), type: "text", text: { preview_url: false, body: message } }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`تعذر إرسال WhatsApp (${response.status})`);
}

async function sendTelegram(chatId: string, message: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) throw new Error("Telegram غير مهيأ في المنصة");
  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: message }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`تعذر إرسال Telegram (${response.status})`);
}

type IntegrationEvent = {
  userId: number;
  event: "reminder" | "escalated" | "completed" | "proof_received" | "payment_received" | "test";
  title: string;
  message: string;
  commitmentId?: number;
  data?: Record<string, unknown>;
};

async function deliverWebhook(webhook: typeof integrationWebhooks.$inferSelect, event: IntegrationEvent) {
  const payload = JSON.stringify({
    id: randomBytes(12).toString("hex"),
    event: event.event,
    createdAt: new Date().toISOString(),
    source: "eltizam",
    userId: event.userId,
    commitmentId: event.commitmentId ?? null,
    title: event.title,
    message: event.message,
    data: event.data || {},
  });
  let responseStatus: number | null = null;
  let status = "failed";
  let errorMessage: string | null = null;
  try {
    await assertSafeWebhookUrl(webhook.url);
    const signature = createHmac("sha256", decryptSecret(webhook.secret, webhook.userId)).update(payload).digest("hex");
    const response = await fetch(webhook.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": "Eltizam-Webhooks/1.0", "X-Eltizam-Event": event.event, "X-Eltizam-Signature": `sha256=${signature}` },
      body: payload,
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    responseStatus = response.status;
    status = response.ok ? "delivered" : "failed";
    if (!response.ok) errorMessage = `HTTP ${response.status}`;
  } catch (error) {
    errorMessage = error instanceof Error ? error.message.slice(0, 500) : "تعذر الاتصال";
  }
  const now = nowSeconds();
  await db.insert(integrationWebhookDeliveries).values({ userId: webhook.userId, webhookId: webhook.id, event: event.event, responseStatus, status, error: errorMessage, createdAt: now });
  await db.update(integrationWebhooks).set({ lastDeliveryAt: now, lastStatus: status, updatedAt: now }).where(eq(integrationWebhooks.id, webhook.id));
  return { status, responseStatus, error: errorMessage };
}

export async function dispatchIntegrationEvent(event: IntegrationEvent) {
  const settings = await ensureNotificationSettings(event.userId);
  const [user] = await db.select({ email: users.email }).from(users).where(eq(users.id, event.userId));
  const actionUrl = event.commitmentId && appBaseUrl() ? `${appBaseUrl()}/commitments/${event.commitmentId}` : undefined;
  const messageWithLink = `${event.message}${actionUrl ? `\n${actionUrl}` : ""}`;
  const tasks: Promise<unknown>[] = [];
  if (settings.emailEnabled && user?.email && canSendMail()) tasks.push(sendIntegrationEmail({ to: user.email, subject: event.title, message: event.message, actionUrl }));
  if (settings.pushEnabled) tasks.push(sendPush(event.userId, event.title, event.message, event.commitmentId));
  if (settings.whatsappEnabled && settings.whatsappNumber) tasks.push(sendWhatsApp(settings.whatsappNumber, messageWithLink));
  if (settings.telegramEnabled && settings.telegramChatId) tasks.push(sendTelegram(settings.telegramChatId, messageWithLink));
  if (event.event !== "test") {
    const hooks = await db.select().from(integrationWebhooks).where(and(eq(integrationWebhooks.userId, event.userId), eq(integrationWebhooks.enabled, true)));
    for (const hook of hooks) {
      if (hook.events.split(",").includes(event.event)) tasks.push(deliverWebhook(hook, event));
    }
  }
  await Promise.allSettled(tasks);
}

async function upsertCalendarLink(userId: number, commitmentId: number, provider: string, externalEventId: string) {
  const [existing] = await db.select().from(calendarEventLinks).where(and(eq(calendarEventLinks.userId, userId), eq(calendarEventLinks.commitmentId, commitmentId), eq(calendarEventLinks.provider, provider)));
  if (existing) {
    await db.update(calendarEventLinks).set({ externalEventId, syncedAt: nowSeconds() }).where(eq(calendarEventLinks.id, existing.id));
  } else {
    await db.insert(calendarEventLinks).values({ userId, commitmentId, provider, externalEventId, syncedAt: nowSeconds() });
  }
}

function calendarEventBody(commitment: Commitment, provider: "google" | "microsoft") {
  const start = new Date(commitment.dueDate! * 1000);
  const end = new Date(start.getTime() + 30 * 60 * 1000);
  const description = `التزام: ${commitment.title}${commitment.notes ? `\n${commitment.notes}` : ""}`;
  if (provider === "google") return { summary: commitment.title, description, start: { dateTime: start.toISOString() }, end: { dateTime: end.toISOString() } };
  return { subject: commitment.title, body: { contentType: "text", content: description }, start: { dateTime: start.toISOString().replace("Z", ""), timeZone: "UTC" }, end: { dateTime: end.toISOString().replace("Z", ""), timeZone: "UTC" } };
}

async function syncCalendar(userId: number, provider: "google" | "microsoft") {
  const [connection] = await db.select().from(bankEmailConnections).where(and(eq(bankEmailConnections.userId, userId), eq(bankEmailConnections.provider, provider))).orderBy(desc(bankEmailConnections.updatedAt));
  if (!connection) throw new Error(provider === "google" ? "اربط Google أولاً" : "اربط Microsoft أولاً");
  const accessToken = await getBankConnectionAccessToken(connection);
  const active = await db.select().from(commitments).where(and(eq(commitments.userId, userId), eq(commitments.status, "active")));
  let synced = 0;
  for (const commitment of active.filter((item) => Boolean(item.dueDate))) {
    const [link] = await db.select().from(calendarEventLinks).where(and(eq(calendarEventLinks.userId, userId), eq(calendarEventLinks.commitmentId, commitment.id), eq(calendarEventLinks.provider, provider)));
    const baseUrl = provider === "google" ? "https://www.googleapis.com/calendar/v3/calendars/primary/events" : "https://graph.microsoft.com/v1.0/me/events";
    const url = link ? `${baseUrl}/${encodeURIComponent(link.externalEventId)}` : baseUrl;
    const response = await fetch(url, {
      method: link ? "PATCH" : "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(calendarEventBody(commitment, provider)),
      signal: AbortSignal.timeout(12_000),
    });
    if (response.status === 401 || response.status === 403) throw new Error("أعد ربط الحساب لمنح صلاحية التقويم");
    if (!response.ok) throw new Error(`تعذرت مزامنة التقويم (${response.status})`);
    const result = await response.json() as { id?: string };
    if (result.id) await upsertCalendarLink(userId, commitment.id, provider, result.id);
    synced += 1;
  }
  return { synced };
}

export function registerIntegrationRoutes(app: Express) {
  app.get("/api/integrations", requireAuth, async (req, res, next) => {
    try {
      const userId = req.user!.id;
      const [settings, connections, documents, webhooks, subscriptions] = await Promise.all([
        ensureNotificationSettings(userId),
        db.select({ provider: bankEmailConnections.provider, email: bankEmailConnections.email }).from(bankEmailConnections).where(eq(bankEmailConnections.userId, userId)),
        db.select().from(integrationDocuments).where(eq(integrationDocuments.userId, userId)).orderBy(desc(integrationDocuments.createdAt)).limit(30),
        db.select({ id: integrationWebhooks.id, name: integrationWebhooks.name, url: integrationWebhooks.url, events: integrationWebhooks.events, enabled: integrationWebhooks.enabled, lastDeliveryAt: integrationWebhooks.lastDeliveryAt, lastStatus: integrationWebhooks.lastStatus, createdAt: integrationWebhooks.createdAt }).from(integrationWebhooks).where(eq(integrationWebhooks.userId, userId)).orderBy(desc(integrationWebhooks.id)),
        db.select({ id: pushSubscriptions.id }).from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId)),
      ]);
      res.json({
        settings,
        providers: {
          email: { configured: canSendMail() },
          push: { configured: Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY), publicKey: process.env.VAPID_PUBLIC_KEY || null, subscriptions: subscriptions.length },
          whatsapp: { configured: Boolean(process.env.WHATSAPP_API_URL && process.env.WHATSAPP_ACCESS_TOKEN) },
          telegram: { configured: Boolean(process.env.TELEGRAM_BOT_TOKEN), botUsername: process.env.TELEGRAM_BOT_USERNAME || null },
        },
        accounts: Array.from(new Map(connections.map((item) => [item.provider, item])).values()),
        documents,
        webhooks,
      });
    } catch (error) { next(error); }
  });

  app.patch("/api/integrations/notifications", requireAuth, async (req, res, next) => {
    try {
      const input = notificationSettingsSchema.parse(req.body);
      const current = await ensureNotificationSettings(req.user!.id);
      const [updated] = await db.update(userNotificationSettings).set({ ...input, updatedAt: nowSeconds() }).where(eq(userNotificationSettings.id, current.id)).returning();
      res.json(updated);
    } catch (error) { next(error); }
  });

  app.post("/api/integrations/notifications/test", requireAuth, async (req, res, next) => {
    try {
      const channel = z.enum(["email", "push", "whatsapp", "telegram"]).parse(req.body.channel);
      const settings = await ensureNotificationSettings(req.user!.id);
      const [user] = await db.select().from(users).where(eq(users.id, req.user!.id));
      const title = "رسالة تجريبية من التزام";
      const message = "تم ربط قناة التنبيهات بنجاح.";
      if (channel === "email") {
        if (!canSendMail()) throw new Error("البريد غير مهيأ في المنصة");
        await sendIntegrationEmail({ to: user.email, subject: title, message });
      } else if (channel === "push") await sendPush(user.id, title, message);
      else if (channel === "whatsapp" && settings.whatsappNumber) await sendWhatsApp(settings.whatsappNumber, message);
      else if (channel === "telegram" && settings.telegramChatId) await sendTelegram(settings.telegramChatId, message);
      else throw new Error("أكمل بيانات القناة أولاً");
      res.json({ message: "تم إرسال الرسالة التجريبية" });
    } catch (error) { next(error); }
  });

  app.post("/api/integrations/push/subscribe", requireAuth, async (req, res, next) => {
    try {
      const subscription = pushSubscriptionSchema.parse(req.body);
      await db.insert(pushSubscriptions).values({ userId: req.user!.id, endpoint: subscription.endpoint, p256dh: subscription.keys.p256dh, auth: subscription.keys.auth, userAgent: req.get("user-agent") || null, updatedAt: nowSeconds() }).onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: { userId: req.user!.id, p256dh: subscription.keys.p256dh, auth: subscription.keys.auth, userAgent: req.get("user-agent") || null, updatedAt: nowSeconds() } });
      const settings = await ensureNotificationSettings(req.user!.id);
      await db.update(userNotificationSettings).set({ pushEnabled: true, updatedAt: nowSeconds() }).where(eq(userNotificationSettings.id, settings.id));
      res.status(201).json({ message: "تم تفعيل Push Notifications" });
    } catch (error) { next(error); }
  });

  app.delete("/api/integrations/push/subscribe", requireAuth, async (req, res, next) => {
    try {
      const endpoint = z.string().url().parse(req.body.endpoint);
      await db.delete(pushSubscriptions).where(and(eq(pushSubscriptions.userId, req.user!.id), eq(pushSubscriptions.endpoint, endpoint)));
      res.json({ message: "تم إلغاء هذا الجهاز" });
    } catch (error) { next(error); }
  });

  app.post("/api/integrations/calendar/:provider/sync", requireAuth, async (req, res, next) => {
    try {
      const provider = z.enum(["google", "microsoft"]).parse(req.params.provider);
      res.json(await syncCalendar(req.user!.id, provider));
    } catch (error) { next(error); }
  });

  app.post("/api/integrations/documents", requireAuth, upload.single("file"), async (req, res, next) => {
    try {
      if (!req.file) return res.status(400).json({ message: "اختر ملف PDF أو صورة أو Word بحجم لا يتجاوز 10MB" });
      const kind = z.enum(["contract", "invoice", "receipt", "other"]).parse(req.body.kind || "other");
      const commitmentId = req.body.commitmentId ? z.coerce.number().int().positive().parse(req.body.commitmentId) : null;
      if (commitmentId) {
        const [owned] = await db.select({ id: commitments.id }).from(commitments).where(and(eq(commitments.id, commitmentId), eq(commitments.userId, req.user!.id)));
        if (!owned) { await fs.unlink(req.file.path).catch(() => undefined); return res.status(404).json({ message: "الالتزام المحدد غير موجود" }); }
      }
      const [document] = await db.insert(integrationDocuments).values({ userId: req.user!.id, commitmentId, kind, originalName: req.file.originalname.slice(0, 240), storedName: req.file.filename, mimeType: req.file.mimetype, size: req.file.size }).returning();
      res.status(201).json(document);
    } catch (error) {
      if (req.file) await fs.unlink(req.file.path).catch(() => undefined);
      next(error);
    }
  });

  app.get("/api/integrations/documents/:id/download", requireAuth, async (req, res, next) => {
    try {
      const [document] = await db.select().from(integrationDocuments).where(and(eq(integrationDocuments.id, Number(req.params.id)), eq(integrationDocuments.userId, req.user!.id)));
      if (!document) return res.status(404).json({ message: "الملف غير موجود" });
      const filePath = path.join(uploadsRoot, String(req.user!.id), document.storedName);
      res.type(document.mimeType);
      res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(document.originalName)}`);
      res.sendFile(filePath);
    } catch (error) { next(error); }
  });

  app.delete("/api/integrations/documents/:id", requireAuth, async (req, res, next) => {
    try {
      const [document] = await db.delete(integrationDocuments).where(and(eq(integrationDocuments.id, Number(req.params.id)), eq(integrationDocuments.userId, req.user!.id))).returning();
      if (!document) return res.status(404).json({ message: "الملف غير موجود" });
      await fs.unlink(path.join(uploadsRoot, String(req.user!.id), document.storedName)).catch(() => undefined);
      res.json({ message: "تم حذف الملف" });
    } catch (error) { next(error); }
  });

  app.post("/api/integrations/webhooks", requireAuth, async (req, res, next) => {
    try {
      const input = webhookSchema.parse(req.body);
      await assertSafeWebhookUrl(input.url);
      const signingSecret = randomBytes(24).toString("base64url");
      const [webhook] = await db.insert(integrationWebhooks).values({ userId: req.user!.id, name: input.name, url: input.url, secret: encryptSecret(signingSecret, req.user!.id), events: input.events.join(",") }).returning();
      res.status(201).json({ ...webhook, secret: undefined, signingSecret });
    } catch (error) { next(error); }
  });

  app.patch("/api/integrations/webhooks/:id", requireAuth, async (req, res, next) => {
    try {
      const input = z.object({ enabled: z.boolean() }).parse(req.body);
      const [updated] = await db.update(integrationWebhooks).set({ enabled: input.enabled, updatedAt: nowSeconds() }).where(and(eq(integrationWebhooks.id, Number(req.params.id)), eq(integrationWebhooks.userId, req.user!.id))).returning();
      if (!updated) return res.status(404).json({ message: "Webhook غير موجود" });
      res.json({ ...updated, secret: undefined });
    } catch (error) { next(error); }
  });

  app.post("/api/integrations/webhooks/:id/test", requireAuth, async (req, res, next) => {
    try {
      const [webhook] = await db.select().from(integrationWebhooks).where(and(eq(integrationWebhooks.id, Number(req.params.id)), eq(integrationWebhooks.userId, req.user!.id)));
      if (!webhook) return res.status(404).json({ message: "Webhook غير موجود" });
      res.json(await deliverWebhook(webhook, { userId: req.user!.id, event: "test", title: "اختبار التزام", message: "تم اتصال n8n أو نظام الأعمال بنجاح" }));
    } catch (error) { next(error); }
  });

  app.delete("/api/integrations/webhooks/:id", requireAuth, async (req, res, next) => {
    try {
      const [deleted] = await db.delete(integrationWebhooks).where(and(eq(integrationWebhooks.id, Number(req.params.id)), eq(integrationWebhooks.userId, req.user!.id))).returning();
      if (!deleted) return res.status(404).json({ message: "Webhook غير موجود" });
      res.json({ message: "تم حذف Webhook" });
    } catch (error) { next(error); }
  });
}
