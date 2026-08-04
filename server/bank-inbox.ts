import type { Express, NextFunction, Request, Response } from "express";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { bankEmailConnections, bankEmailEvents, categories, commitments, transactions } from "@shared/schema";
import { db } from "./db";
import { storage } from "./storage";
import { BANK_PROFILES, buildBankSearchQuery, createMessageFingerprint, normalizeSenderList, parseBankMessage, resolveAllowedSenders, senderMatchesBank, type BankKey } from "./bank-message-parser";
import { getProviderConfig, isProviderConfigured, resolveRedirectUri } from "./integration-settings";
import { buildWriteQueueKey, enqueueWrite } from "./write-queue";

const senderEntryPattern = /^[a-z0-9](?:[a-z0-9._+@-]*[a-z0-9])?$/;

const bankKeySchema = z.enum(["bank_muscat", "nbo", "bank_dhofar", "sohar_international", "ahlibank", "oman_arab_bank", "bank_nizwa", "other"]);

const connectSchema = z.object({
  bankKey: bankKeySchema,
  customSenders: z.string().max(500).optional().default(""),
  walletId: z.coerce.number().int().positive(),
  autoImport: z.boolean().optional().default(true),
}).superRefine((input, ctx) => {
  const entries = normalizeSenderList(input.customSenders);

  if (entries.some((entry) => !senderEntryPattern.test(entry))) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["customSenders"],
      message: "أدخل عنوان بريد أو نطاقًا صحيحًا، مثل alerts@yourbank.com أو yourbank.com",
    });
    return;
  }

  // Without a sender filter we would have to scan the whole mailbox, which is
  // exactly what the connect screen promises we never do.
  if (resolveAllowedSenders(input.bankKey, entries).length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["customSenders"],
      message: "اكتب عنوان المرسل الذي يصلك منه إشعار البنك حتى نقرأ رسائله فقط",
    });
  }
});

const previewSchema = z.object({
  bankKey: bankKeySchema,
  sender: z.string().max(300).optional().default(""),
  subject: z.string().max(500).optional().default(""),
  body: z.string().min(3).max(15000),
});

function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.isAuthenticated()) return res.status(401).json({ message: "غير مسجل الدخول" });
  next();
}

/**
 * Errors carrying a 4xx status survive the production error handler, which masks
 * anything >= 500. Mail provider failures are almost always actionable by the
 * user, so they must arrive with the reason intact rather than as "unexpected".
 */
function providerError(status: number, message: string, detail?: string) {
  const error = new Error(detail ? `${message} (${detail})` : message) as Error & { status: number; publicMessage: string };
  error.status = status;
  error.publicMessage = message;
  return error;
}

// `Response` in this module is Express's, so the fetch one needs qualifying.
async function describeProviderFailure(response: globalThis.Response) {
  const raw = await response.text().catch(() => "");
  let detail = raw.slice(0, 300);
  let reason = "";

  try {
    const payload = JSON.parse(raw) as {
      error?: string | { message?: string; status?: string; errors?: Array<{ reason?: string }> };
      error_description?: string;
    };
    if (typeof payload.error === "string") {
      reason = payload.error;
      detail = payload.error_description || payload.error;
    } else if (payload.error) {
      reason = payload.error.errors?.[0]?.reason || payload.error.status || "";
      detail = payload.error.message || detail;
    }
  } catch {
    // Non-JSON body: keep the truncated raw text as the detail.
  }

  return { status: response.status, reason, detail };
}

function googleReadError(failure: { status: number; reason: string; detail: string }) {
  const haystack = `${failure.reason} ${failure.detail}`.toLowerCase();

  if (failure.status === 401) {
    return providerError(401, "انتهت صلاحية ربط Gmail. افصل البريد ثم أعد ربطه.", failure.detail);
  }
  if (haystack.includes("accessnotconfigured") || haystack.includes("has not been used in project") || haystack.includes("is disabled")) {
    return providerError(502, "Gmail API غير مفعّل في مشروع Google. فعّله من Google Cloud Console ثم أعد المحاولة.", failure.detail);
  }
  if (haystack.includes("insufficient") || haystack.includes("insufficientpermissions") || haystack.includes("scope")) {
    return providerError(403, "لم يُمنح التطبيق إذن قراءة Gmail. افصل البريد وأعد ربطه مع الموافقة على إذن قراءة البريد.", failure.detail);
  }
  if (failure.status === 429 || haystack.includes("ratelimit") || haystack.includes("quota")) {
    return providerError(429, "تجاوزنا حد الطلبات المسموح من Gmail. حاول بعد دقائق.", failure.detail);
  }
  return providerError(502, `تعذر قراءة رسائل Gmail (رمز ${failure.status}).`, failure.detail);
}

function microsoftReadError(failure: { status: number; reason: string; detail: string }) {
  const haystack = `${failure.reason} ${failure.detail}`.toLowerCase();

  if (failure.status === 401) {
    return providerError(401, "انتهت صلاحية ربط Outlook. افصل البريد ثم أعد ربطه.", failure.detail);
  }
  if (haystack.includes("accessdenied") || haystack.includes("authorization") || haystack.includes("scope")) {
    return providerError(403, "لم يُمنح التطبيق إذن قراءة Outlook. تأكد من صلاحية Mail.Read ثم أعد الربط.", failure.detail);
  }
  if (failure.status === 429) {
    return providerError(429, "تجاوزنا حد الطلبات المسموح من Outlook. حاول بعد دقائق.", failure.detail);
  }
  return providerError(502, `تعذر قراءة رسائل Outlook (رمز ${failure.status}).`, failure.detail);
}

function tokenKey(userId: number) {
  const secret = process.env.TOKEN_ENCRYPTION_KEY || process.env.SESSION_SECRET;
  if (!secret) throw new Error("TOKEN_ENCRYPTION_KEY or SESSION_SECRET is required");
  return createHash("sha256").update(`${secret}:bank-email-user:${userId}`).digest();
}

function encryptToken(value: string | null | undefined, userId: number) {
  if (!value) return null;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", tokenKey(userId), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
}

function decryptToken(value: string | null | undefined, userId: number) {
  if (!value) return null;
  const [iv, tag, encrypted] = value.split(".");
  if (!iv || !tag || !encrypted) return null;
  const decipher = createDecipheriv("aes-256-gcm", tokenKey(userId), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(encrypted, "base64url")), decipher.final()]).toString("utf8");
}

function decodeBase64Url(value?: string) {
  if (!value) return "";
  return Buffer.from(value, "base64url").toString("utf8");
}

function htmlToText(value: string) {
  return value
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

type GmailPart = { mimeType?: string; body?: { data?: string }; parts?: GmailPart[] };
function gmailBody(part?: GmailPart): string {
  if (!part) return "";
  if (part.mimeType === "text/plain" && part.body?.data) return decodeBase64Url(part.body.data);
  const children = (part.parts || []).map(gmailBody).filter(Boolean);
  if (children.length > 0) return children.join("\n");
  return part.body?.data ? htmlToText(decodeBase64Url(part.body.data)) : "";
}

async function googleAccessToken(connection: typeof bankEmailConnections.$inferSelect) {
  const now = Math.floor(Date.now() / 1000);
  const accessToken = decryptToken(connection.accessTokenEncrypted, connection.userId);
  if (accessToken && (connection.tokenExpiresAt || 0) > now + 60) return accessToken;

  const refreshToken = decryptToken(connection.refreshTokenEncrypted, connection.userId);
  const config = await getProviderConfig("google");
  if (!refreshToken || !config) {
    throw new Error("انتهت صلاحية ربط Gmail. أعد ربط البريد.");
  }

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!response.ok) {
    const failure = await describeProviderFailure(response);
    throw providerError(401, "انتهت صلاحية ربط Gmail. افصل البريد ثم أعد ربطه.", failure.detail);
  }
  const token = await response.json() as { access_token: string; expires_in?: number };
  await db.update(bankEmailConnections).set({
    accessTokenEncrypted: encryptToken(token.access_token, connection.userId),
    tokenExpiresAt: now + (token.expires_in || 3600),
    updatedAt: now,
  }).where(eq(bankEmailConnections.id, connection.id));
  return token.access_token;
}

async function microsoftAccessToken(connection: typeof bankEmailConnections.$inferSelect) {
  const now = Math.floor(Date.now() / 1000);
  const accessToken = decryptToken(connection.accessTokenEncrypted, connection.userId);
  if (accessToken && (connection.tokenExpiresAt || 0) > now + 60) return accessToken;

  const refreshToken = decryptToken(connection.refreshTokenEncrypted, connection.userId);
  const config = await getProviderConfig("microsoft");
  if (!refreshToken || !config) {
    throw new Error("انتهت صلاحية ربط Outlook. أعد ربط البريد.");
  }
  const tenant = config.tenantId || "common";
  const response = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
      scope: "openid email offline_access User.Read Mail.Read",
    }),
  });
  if (!response.ok) {
    const failure = await describeProviderFailure(response);
    throw providerError(401, "انتهت صلاحية ربط Outlook. افصل البريد ثم أعد ربطه.", failure.detail);
  }
  const token = await response.json() as { access_token: string; expires_in?: number; refresh_token?: string };
  await db.update(bankEmailConnections).set({
    accessTokenEncrypted: encryptToken(token.access_token, connection.userId),
    refreshTokenEncrypted: token.refresh_token ? encryptToken(token.refresh_token, connection.userId) : connection.refreshTokenEncrypted,
    tokenExpiresAt: now + (token.expires_in || 3600),
    updatedAt: now,
  }).where(eq(bankEmailConnections.id, connection.id));
  return token.access_token;
}
function headerValue(headers: Array<{ name?: string; value?: string }> | undefined, name: string) {
  return headers?.find((header) => header.name?.toLowerCase() === name.toLowerCase())?.value || "";
}

async function findAutomaticLinks(userId: number, merchant: string, categoryHint: string | null, amount: number, receivedAt: number) {
  const [categories, activeCommitments, learnedEvents] = await Promise.all([
    storage.getCategories(userId),
    db.select().from(commitments).where(and(eq(commitments.userId, userId), eq(commitments.status, "active"))),
    db.select().from(bankEmailEvents).where(and(eq(bankEmailEvents.userId, userId), eq(bankEmailEvents.merchant, merchant))).orderBy(desc(bankEmailEvents.id)),
  ]);

  const learnedCategoryId = learnedEvents.find((event) => event.categoryId)?.categoryId || null;
  const hintedCategoryId = categoryHint
    ? categories.find((category) => category.name.includes(categoryHint) || categoryHint.includes(category.name))?.id || null
    : null;
  const categoryId = learnedCategoryId || hintedCategoryId;

  const commitment = activeCommitments.find((item) => {
    if (item.type !== "financial" || item.amount === null) return false;
    const amountMatches = Math.abs(item.amount - amount) <= Math.max(0.01, amount * 0.02);
    const dateMatches = !item.dueDate || Math.abs(item.dueDate - receivedAt) <= 7 * 86400;
    return amountMatches && dateMatches;
  });

  return { categoryId, commitmentId: commitment?.id || null };
}

async function importParsedEvent(params: {
  userId: number;
  connection: typeof bankEmailConnections.$inferSelect;
  providerMessageId: string;
  sender: string;
  subject: string;
  snippet: string;
  receivedAt: number;
  parsed: NonNullable<ReturnType<typeof parseBankMessage>>;
}) {
  const fingerprint = createMessageFingerprint({
    bankKey: params.connection.bankKey,
    amount: params.parsed.amount,
    type: params.parsed.transactionType,
    merchant: params.parsed.merchant,
    receivedAt: params.receivedAt,
  });

  const duplicate = await db.select({ id: bankEmailEvents.id }).from(bankEmailEvents).where(and(
    eq(bankEmailEvents.userId, params.userId),
    eq(bankEmailEvents.fingerprint, fingerprint),
  ));
  if (duplicate.length > 0) return { state: "duplicate" as const };

  const links = await findAutomaticLinks(params.userId, params.parsed.merchant, params.parsed.categoryHint, params.parsed.amount, params.receivedAt);
  // The select above cannot prevent a concurrent run from inserting the same
  // message between the check and the write, so let the unique indexes decide.
  const [event] = await db.insert(bankEmailEvents).values({
    userId: params.userId,
    connectionId: params.connection.id,
    providerMessageId: params.providerMessageId,
    fingerprint,
    bankKey: params.connection.bankKey,
    sender: params.sender,
    subject: params.subject,
    snippet: params.snippet.slice(0, 600),
    receivedAt: params.receivedAt,
    status: "review",
    transactionType: params.parsed.transactionType,
    amount: params.parsed.amount,
    merchant: params.parsed.merchant,
    categoryId: links.categoryId,
    commitmentId: links.commitmentId,
  }).onConflictDoNothing().returning();

  if (!event) return { state: "duplicate" as const };

  if (!params.connection.autoImport || params.parsed.confidence < 0.9) return { state: "review" as const, event };

  try {
    const transaction = await storage.createTransaction(params.userId, {
      walletId: params.connection.walletId,
      categoryId: links.categoryId,
      type: params.parsed.transactionType,
      amount: params.parsed.amount,
      note: `من البريد البنكي · ${params.parsed.merchant}`,
    });
    await db.update(transactions).set({ date: params.receivedAt }).where(eq(transactions.id, transaction.id));
    const [imported] = await db.update(bankEmailEvents).set({ status: "imported", transactionId: transaction.id }).where(eq(bankEmailEvents.id, event.id)).returning();
    return { state: "imported" as const, event: imported };
  } catch {
    return { state: "review" as const, event };
  }
}

async function syncGoogleConnection(userId: number, connection: typeof bankEmailConnections.$inferSelect) {
  const accessToken = await googleAccessToken(connection);
  const headers = { Authorization: `Bearer ${accessToken}` };
  const searchQuery = buildBankSearchQuery(connection.bankKey as BankKey, connection.customSenders);
  if (!searchQuery) throw new Error("أضف عنوان مرسل البنك لهذا الربط قبل قراءة الرسائل");
  const listUrl = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
  listUrl.searchParams.set("maxResults", "50");
  listUrl.searchParams.set("q", searchQuery);
  const listResponse = await fetch(listUrl, { headers });
  if (!listResponse.ok) throw googleReadError(await describeProviderFailure(listResponse));
  const list = await listResponse.json() as { messages?: Array<{ id: string }> };
  const summary = { checked: list.messages?.length || 0, imported: 0, review: 0, duplicate: 0, ignored: 0 };

  for (const item of list.messages || []) {
    const existing = await db.select({ id: bankEmailEvents.id }).from(bankEmailEvents).where(and(
      eq(bankEmailEvents.userId, userId),
      eq(bankEmailEvents.connectionId, connection.id),
      eq(bankEmailEvents.providerMessageId, item.id),
    ));
    if (existing.length > 0) { summary.duplicate += 1; continue; }

    const response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(item.id)}?format=full`, { headers });
    if (!response.ok) { summary.ignored += 1; continue; }
    const message = await response.json() as {
      id: string;
      internalDate?: string;
      snippet?: string;
      payload?: GmailPart & { headers?: Array<{ name?: string; value?: string }> };
    };
    const sender = headerValue(message.payload?.headers, "From");
    // Gmail's `from:` filter is fuzzy, so re-check the header before parsing anything.
    if (!senderMatchesBank(connection.bankKey as BankKey, sender, connection.customSenders)) { summary.ignored += 1; continue; }
    const subject = headerValue(message.payload?.headers, "Subject");
    const body = gmailBody(message.payload) || message.snippet || "";
    const parsed = parseBankMessage({ bankKey: connection.bankKey as BankKey, sender, subject, body });
    if (!parsed) { summary.ignored += 1; continue; }
    const result = await importParsedEvent({
      userId,
      connection,
      providerMessageId: message.id,
      sender,
      subject,
      snippet: subject,
      receivedAt: Math.floor(Number(message.internalDate || Date.now()) / 1000),
      parsed,
    });
    summary[result.state] += 1;
  }

  await db.update(bankEmailConnections).set({ lastSyncAt: Math.floor(Date.now() / 1000), updatedAt: Math.floor(Date.now() / 1000) }).where(eq(bankEmailConnections.id, connection.id));
  return summary;
}

async function syncMicrosoftConnection(userId: number, connection: typeof bankEmailConnections.$inferSelect) {
  if (resolveAllowedSenders(connection.bankKey as BankKey, connection.customSenders).length === 0) {
    throw new Error("أضف عنوان مرسل البنك لهذا الربط قبل قراءة الرسائل");
  }
  const accessToken = await microsoftAccessToken(connection);
  const url = new URL("https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages");
  url.searchParams.set("$top", "50");
  url.searchParams.set("$select", "id,subject,from,receivedDateTime");
  url.searchParams.set("$orderby", "receivedDateTime desc");
  const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!response.ok) throw microsoftReadError(await describeProviderFailure(response));
  const list = await response.json() as { value?: Array<{ id: string; subject?: string; from?: { emailAddress?: { address?: string } }; receivedDateTime?: string }> };
  const summary = { checked: list.value?.length || 0, imported: 0, review: 0, duplicate: 0, ignored: 0 };

  for (const message of list.value || []) {
    const sender = message.from?.emailAddress?.address || "";
    if (!senderMatchesBank(connection.bankKey as BankKey, sender, connection.customSenders)) { summary.ignored += 1; continue; }
    const existing = await db.select({ id: bankEmailEvents.id }).from(bankEmailEvents).where(and(
      eq(bankEmailEvents.userId, userId),
      eq(bankEmailEvents.connectionId, connection.id),
      eq(bankEmailEvents.providerMessageId, message.id),
    ));
    if (existing.length > 0) { summary.duplicate += 1; continue; }
    const detailResponse = await fetch(`https://graph.microsoft.com/v1.0/me/messages/${encodeURIComponent(message.id)}?$select=subject,from,receivedDateTime,bodyPreview,body`, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!detailResponse.ok) { summary.ignored += 1; continue; }
    const detail = await detailResponse.json() as { subject?: string; receivedDateTime?: string; bodyPreview?: string; body?: { content?: string; contentType?: string } };
    const subject = detail.subject || message.subject || "";
    const body = detail.body?.contentType?.toLowerCase() === "html" ? htmlToText(detail.body.content || "") : (detail.body?.content || detail.bodyPreview || "");
    const parsed = parseBankMessage({ bankKey: connection.bankKey as BankKey, sender, subject, body });
    if (!parsed) { summary.ignored += 1; continue; }
    const receivedAt = Math.floor(new Date(detail.receivedDateTime || message.receivedDateTime || Date.now()).getTime() / 1000);
    const result = await importParsedEvent({ userId, connection, providerMessageId: message.id, sender, subject, snippet: subject, receivedAt, parsed });
    summary[result.state] += 1;
  }

  await db.update(bankEmailConnections).set({ lastSyncAt: Math.floor(Date.now() / 1000), updatedAt: Math.floor(Date.now() / 1000) }).where(eq(bankEmailConnections.id, connection.id));
  return summary;
}
/**
 * The scheduler and the manual "read messages" button hit the same connection, so
 * they take turns instead of racing each other through the same inbox.
 */
async function syncConnection(userId: number, connection: typeof bankEmailConnections.$inferSelect) {
  const queued = await enqueueWrite(buildWriteQueueKey("bank-inbox-sync", connection.id), async () => {
    if (connection.provider === "google") return syncGoogleConnection(userId, connection);
    if (connection.provider === "microsoft") return syncMicrosoftConnection(userId, connection);
    throw providerError(400, "موصل البريد غير مدعوم");
  });
  return queued.result;
}

let schedulerStarted = false;
function startBankInboxScheduler() {
  if (schedulerStarted || process.env.NODE_ENV === "test") return;
  schedulerStarted = true;
  const configuredMinutes = Number(process.env.BANK_EMAIL_SYNC_MINUTES || 5);
  const intervalMinutes = Math.min(60, Math.max(2, Number.isFinite(configuredMinutes) ? configuredMinutes : 5));
  let running = false;

  const run = async () => {
    if (running) return;
    running = true;
    try {
      const now = Math.floor(Date.now() / 1000);
      const connections = await db.select().from(bankEmailConnections).where(eq(bankEmailConnections.autoImport, true));
      for (const connection of connections) {
        if (connection.lastSyncAt && now - connection.lastSyncAt < intervalMinutes * 60 - 15) continue;
        try {
          await syncConnection(connection.userId, connection);
        } catch (error) {
          console.error(`Bank inbox sync failed for connection ${connection.id}:`, error instanceof Error ? error.message : "unknown error");
        }
      }
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => { void run(); }, intervalMinutes * 60 * 1000);
  timer.unref();
  const initialTimer = setTimeout(() => { void run(); }, 20_000);
  initialTimer.unref();
}
export function registerBankInboxRoutes(app: Express) {
  app.get("/api/bank-inbox", requireAuth, async (req, res, next) => {
    try {
      const connections = await db.select({
        id: bankEmailConnections.id,
        provider: bankEmailConnections.provider,
        email: bankEmailConnections.email,
        bankKey: bankEmailConnections.bankKey,
        customSenders: bankEmailConnections.customSenders,
        walletId: bankEmailConnections.walletId,
        autoImport: bankEmailConnections.autoImport,
        lastSyncAt: bankEmailConnections.lastSyncAt,
        createdAt: bankEmailConnections.createdAt,
      }).from(bankEmailConnections).where(eq(bankEmailConnections.userId, req.user!.id)).orderBy(desc(bankEmailConnections.id));
      const events = await db.select().from(bankEmailEvents).where(eq(bankEmailEvents.userId, req.user!.id)).orderBy(desc(bankEmailEvents.receivedAt)).limit(30);
      const [googleConfigured, microsoftConfigured] = await Promise.all([
        isProviderConfigured("google"),
        isProviderConfigured("microsoft"),
      ]);
      res.json({
        providers: {
          google: { configured: googleConfigured },
          microsoft: { configured: microsoftConfigured },
        },
        banks: BANK_PROFILES.map(({ key, name, senders }) => ({ key, name, requiresCustomSender: senders.length === 0 })),
        connections,
        events,
      });
    } catch (error) { next(error); }
  });

  app.post("/api/bank-inbox/preview", requireAuth, async (req, res, next) => {
    try {
      const input = previewSchema.parse(req.body);
      res.json({ result: parseBankMessage(input) });
    } catch (error) { next(error); }
  });

  app.post("/api/bank-inbox/google/start", requireAuth, async (req, res, next) => {
    try {
      const config = await getProviderConfig("google");
      if (!config) {
        return res.status(503).json({ message: "ربط Gmail يحتاج تهيئة مفاتيح Google من إدارة المنصة" });
      }
      const input = connectSchema.parse(req.body);
      const wallet = await storage.getWallet(input.walletId, req.user!.id);
      if (!wallet) return res.status(404).json({ message: "المحفظة المحددة غير موجودة" });
      const state = randomBytes(24).toString("base64url");
      (req.session as any).bankEmailOauth = { state, provider: "google", userId: req.user!.id, ...input, createdAt: Date.now() };
      const redirectUri = resolveRedirectUri(req, "google", config);
      const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      url.searchParams.set("client_id", config.clientId);
      url.searchParams.set("redirect_uri", redirectUri);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("scope", "openid email https://www.googleapis.com/auth/gmail.readonly");
      url.searchParams.set("access_type", "offline");
      url.searchParams.set("prompt", "consent");
      url.searchParams.set("state", state);
      res.json({ authUrl: url.toString() });
    } catch (error) { next(error); }
  });

  app.get("/api/bank-inbox/google/callback", requireAuth, async (req, res) => {
    const pending = (req.session as any).bankEmailOauth;
    delete (req.session as any).bankEmailOauth;
    if (!pending || pending.provider !== "google" || pending.state !== req.query.state || pending.userId !== req.user!.id || Date.now() - pending.createdAt > 10 * 60 * 1000) {
      return res.redirect("/bank-inbox?error=oauth_state");
    }
    try {
      const config = await getProviderConfig("google");
      if (!config) throw new Error("google integration is not configured");
      const redirectUri = resolveRedirectUri(req, "google", config);
      const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code: String(req.query.code || ""),
          client_id: config.clientId,
          client_secret: config.clientSecret,
          redirect_uri: redirectUri,
          grant_type: "authorization_code",
        }),
      });
      if (!tokenResponse.ok) throw new Error("token exchange failed");
      const token = await tokenResponse.json() as { access_token: string; refresh_token?: string; expires_in?: number };
      const profileResponse = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", { headers: { Authorization: `Bearer ${token.access_token}` } });
      if (!profileResponse.ok) throw new Error("profile read failed");
      const profile = await profileResponse.json() as { email: string };
      const existing = await db.select().from(bankEmailConnections).where(and(
        eq(bankEmailConnections.userId, req.user!.id),
        eq(bankEmailConnections.provider, "google"),
        eq(bankEmailConnections.email, profile.email),
        eq(bankEmailConnections.bankKey, pending.bankKey),
      ));
      const now = Math.floor(Date.now() / 1000);
      const customSenders = normalizeSenderList(pending.customSenders).join(",") || null;
      if (existing[0]) {
        await db.update(bankEmailConnections).set({
          walletId: pending.walletId,
          autoImport: pending.autoImport,
          customSenders,
          accessTokenEncrypted: encryptToken(token.access_token, req.user!.id),
          refreshTokenEncrypted: token.refresh_token ? encryptToken(token.refresh_token, req.user!.id) : existing[0].refreshTokenEncrypted,
          tokenExpiresAt: now + (token.expires_in || 3600),
          updatedAt: now,
        }).where(eq(bankEmailConnections.id, existing[0].id));
      } else {
        await db.insert(bankEmailConnections).values({
          userId: req.user!.id,
          provider: "google",
          email: profile.email,
          bankKey: pending.bankKey,
          customSenders,
          walletId: pending.walletId,
          autoImport: pending.autoImport,
          accessTokenEncrypted: encryptToken(token.access_token, req.user!.id),
          refreshTokenEncrypted: encryptToken(token.refresh_token, req.user!.id),
          tokenExpiresAt: now + (token.expires_in || 3600),
        });
      }
      res.redirect("/bank-inbox?connected=1");
    } catch {
      res.redirect("/bank-inbox?error=oauth_failed");
    }
  });

  app.post("/api/bank-inbox/microsoft/start", requireAuth, async (req, res, next) => {
    try {
      const config = await getProviderConfig("microsoft");
      if (!config) {
        return res.status(503).json({ message: "ربط Outlook يحتاج تهيئة مفاتيح Microsoft من إدارة المنصة" });
      }
      const input = connectSchema.parse(req.body);
      const wallet = await storage.getWallet(input.walletId, req.user!.id);
      if (!wallet) return res.status(404).json({ message: "المحفظة المحددة غير موجودة" });
      const state = randomBytes(24).toString("base64url");
      (req.session as any).bankEmailOauth = { state, provider: "microsoft", userId: req.user!.id, ...input, createdAt: Date.now() };
      const tenant = config.tenantId || "common";
      const redirectUri = resolveRedirectUri(req, "microsoft", config);
      const url = new URL(`https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/authorize`);
      url.searchParams.set("client_id", config.clientId);
      url.searchParams.set("redirect_uri", redirectUri);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("response_mode", "query");
      url.searchParams.set("scope", "openid email offline_access User.Read Mail.Read");
      url.searchParams.set("state", state);
      res.json({ authUrl: url.toString() });
    } catch (error) { next(error); }
  });

  app.get("/api/bank-inbox/microsoft/callback", requireAuth, async (req, res) => {
    const pending = (req.session as any).bankEmailOauth;
    delete (req.session as any).bankEmailOauth;
    if (!pending || pending.provider !== "microsoft" || pending.state !== req.query.state || pending.userId !== req.user!.id || Date.now() - pending.createdAt > 10 * 60 * 1000) {
      return res.redirect("/bank-inbox?error=oauth_state");
    }
    try {
      const config = await getProviderConfig("microsoft");
      if (!config) throw new Error("microsoft integration is not configured");
      const tenant = config.tenantId || "common";
      const redirectUri = resolveRedirectUri(req, "microsoft", config);
      const tokenResponse = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ code: String(req.query.code || ""), client_id: config.clientId, client_secret: config.clientSecret, redirect_uri: redirectUri, grant_type: "authorization_code", scope: "openid email offline_access User.Read Mail.Read" }),
      });
      if (!tokenResponse.ok) throw new Error("token exchange failed");
      const token = await tokenResponse.json() as { access_token: string; refresh_token?: string; expires_in?: number };
      const profileResponse = await fetch("https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName", { headers: { Authorization: `Bearer ${token.access_token}` } });
      if (!profileResponse.ok) throw new Error("profile read failed");
      const profile = await profileResponse.json() as { mail?: string; userPrincipalName?: string };
      const email = profile.mail || profile.userPrincipalName;
      if (!email) throw new Error("email missing");
      const existing = await db.select().from(bankEmailConnections).where(and(eq(bankEmailConnections.userId, req.user!.id), eq(bankEmailConnections.provider, "microsoft"), eq(bankEmailConnections.email, email), eq(bankEmailConnections.bankKey, pending.bankKey)));
      const now = Math.floor(Date.now() / 1000);
      const values = { walletId: pending.walletId, autoImport: pending.autoImport, customSenders: normalizeSenderList(pending.customSenders).join(",") || null, accessTokenEncrypted: encryptToken(token.access_token, req.user!.id), refreshTokenEncrypted: token.refresh_token ? encryptToken(token.refresh_token, req.user!.id) : existing[0]?.refreshTokenEncrypted || null, tokenExpiresAt: now + (token.expires_in || 3600), updatedAt: now };
      if (existing[0]) {
        await db.update(bankEmailConnections).set(values).where(eq(bankEmailConnections.id, existing[0].id));
      } else {
        await db.insert(bankEmailConnections).values({ userId: req.user!.id, provider: "microsoft", email, bankKey: pending.bankKey, ...values });
      }
      res.redirect("/bank-inbox?connected=1&provider=microsoft");
    } catch {
      res.redirect("/bank-inbox?error=oauth_failed");
    }
  });
  app.post("/api/bank-inbox/connections/:id/sync", requireAuth, async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      const [connection] = await db.select().from(bankEmailConnections).where(and(eq(bankEmailConnections.id, id), eq(bankEmailConnections.userId, req.user!.id)));
      if (!connection) return res.status(404).json({ message: "ربط البريد غير موجود" });
      return res.json(await syncConnection(req.user!.id, connection));
    } catch (error) { next(error); }
  });

  app.patch("/api/bank-inbox/events/:id", requireAuth, async (req, res, next) => {
    try {
      const input = z.object({ categoryId: z.number().int().positive().nullable().optional(), commitmentId: z.number().int().positive().nullable().optional() }).parse(req.body);
      const id = Number(req.params.id);
      const userId = req.user!.id;
      const [event] = await db.select().from(bankEmailEvents).where(and(eq(bankEmailEvents.id, id), eq(bankEmailEvents.userId, userId)));
      if (!event) return res.status(404).json({ message: "المعاملة المقترحة غير موجودة" });
      if (input.categoryId) {
        const [ownedCategory] = await db.select({ id: categories.id }).from(categories).where(and(eq(categories.id, input.categoryId), eq(categories.userId, userId)));
        if (!ownedCategory) return res.status(404).json({ message: "التصنيف المحدد غير موجود" });
      }
      if (input.commitmentId) {
        const [ownedCommitment] = await db.select({ id: commitments.id }).from(commitments).where(and(eq(commitments.id, input.commitmentId), eq(commitments.userId, userId), eq(commitments.type, "financial")));
        if (!ownedCommitment) return res.status(404).json({ message: "الالتزام المالي المحدد غير موجود" });
      }
      const [updated] = await db.update(bankEmailEvents).set(input).where(and(eq(bankEmailEvents.id, id), eq(bankEmailEvents.userId, userId))).returning();
      if (event.transactionId && input.categoryId !== undefined) {
        await db.update(transactions).set({ categoryId: input.categoryId }).where(and(eq(transactions.id, event.transactionId), eq(transactions.userId, req.user!.id)));
      }
      res.json(updated);
    } catch (error) { next(error); }
  });

  app.post("/api/bank-inbox/events/:id/import", requireAuth, async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      const [event] = await db.select().from(bankEmailEvents).where(and(eq(bankEmailEvents.id, id), eq(bankEmailEvents.userId, req.user!.id)));
      if (!event) return res.status(404).json({ message: "المعاملة المقترحة غير موجودة" });
      if (event.transactionId) return res.json(event);
      const [connection] = await db.select().from(bankEmailConnections).where(and(eq(bankEmailConnections.id, event.connectionId), eq(bankEmailConnections.userId, req.user!.id)));
      if (!connection || !event.amount || !event.transactionType) return res.status(400).json({ message: "بيانات المعاملة غير مكتملة" });
      const transaction = await storage.createTransaction(req.user!.id, {
        walletId: connection.walletId,
        categoryId: event.categoryId,
        type: event.transactionType,
        amount: event.amount,
        note: `من البريد البنكي · ${event.merchant || "معاملة بنكية"}`,
      });
      await db.update(transactions).set({ date: event.receivedAt }).where(eq(transactions.id, transaction.id));
      const [updated] = await db.update(bankEmailEvents).set({ status: "imported", transactionId: transaction.id }).where(eq(bankEmailEvents.id, id)).returning();
      res.json(updated);
    } catch (error) { next(error); }
  });

  app.delete("/api/bank-inbox/connections/:id", requireAuth, async (req, res, next) => {
    try {
      await db.delete(bankEmailConnections).where(and(eq(bankEmailConnections.id, Number(req.params.id)), eq(bankEmailConnections.userId, req.user!.id)));
      res.json({ message: "تم فصل البريد البنكي" });
    } catch (error) { next(error); }
  });

  startBankInboxScheduler();
}
