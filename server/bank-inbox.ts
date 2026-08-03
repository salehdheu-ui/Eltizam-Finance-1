import type { Express, NextFunction, Request, Response } from "express";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { bankEmailConnections, bankEmailEvents, categories, commitments, transactions } from "@shared/schema";
import { db } from "./db";
import { storage } from "./storage";
import { BANK_PROFILES, buildBankSearchQuery, createMessageFingerprint, parseBankMessage, type BankKey } from "./bank-message-parser";
import { establishUserSession, hashPlainPassword } from "./auth";
import { writeAuditEvent } from "./audit";

const connectSchema = z.object({
  bankKey: z.enum(["bank_muscat", "nbo", "bank_dhofar", "sohar_international", "ahlibank", "oman_arab_bank", "bank_nizwa", "other"]).optional().default("other"),
  walletId: z.coerce.number().int().positive().optional(),
  autoImport: z.boolean().optional().default(true),
});

const previewSchema = z.object({
  bankKey: z.enum(["bank_muscat", "nbo", "bank_dhofar", "sohar_international", "ahlibank", "oman_arab_bank", "bank_nizwa", "other"]),
  sender: z.string().max(300).optional().default(""),
  subject: z.string().max(500).optional().default(""),
  body: z.string().min(3).max(15000),
});

function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.isAuthenticated()) return res.status(401).json({ message: "غير مسجل الدخول" });
  next();
}

function appUrl(req: Request) {
  const configured = process.env.PUBLIC_APP_URL?.replace(/\/$/, "");
  if (configured) return configured;
  const protocol = (req.get("x-forwarded-proto") || req.protocol).split(",")[0].trim();
  return `${protocol}://${req.get("host")}`;
}

function saveSession(req: Request) {
  return new Promise<void>((resolve, reject) => {
    req.session.save((error) => error ? reject(error) : resolve());
  });
}

async function resolveConnectionWallet(userId: number, walletId?: number) {
  if (walletId) {
    const selected = await storage.getWallet(walletId, userId);
    if (!selected) throw new Error("المحفظة المحددة غير موجودة");
    return selected;
  }

  const existing = await storage.getWallets(userId);
  if (existing[0]) return existing[0];

  return storage.createWallet(userId, {
    name: "حساب البنك",
    type: "bank",
    balance: 0,
    color: "from-blue-600 to-cyan-500",
  });
}

async function uniqueOauthUsername(email: string) {
  const localPart = email.split("@")[0]?.toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 40) || "user";
  const base = localPart.length >= 3 ? localPart : `user_${localPart}`;
  let candidate = base;
  let suffix = 1;
  while (await storage.getUserByUsername(candidate)) {
    candidate = `${base.slice(0, 43)}_${suffix}`;
    suffix += 1;
  }
  return candidate;
}

async function resolveOauthUser(email: string, name: string) {
  const existing = await storage.getUserByEmail(email);
  const now = Math.floor(Date.now() / 1000);
  if (existing) {
    if (!existing.isActive) throw new Error("تم إيقاف هذا الحساب");
    return storage.updateUser(existing.id, { lastLoginAt: now });
  }

  const users = await storage.getAllUsers();
  return storage.createUser({
    username: await uniqueOauthUsername(email),
    password: await hashPlainPassword(randomBytes(32).toString("base64url")),
    name: name.trim() || email.split("@")[0] || "مستخدم التزام",
    email,
    phone: null,
    role: users.length === 0 ? "system_admin" : "user",
    isActive: true,
    lastLoginAt: now,
    createdAt: now,
  });
}

async function upsertAutomaticConnection(params: {
  userId: number;
  provider: "google" | "microsoft";
  email: string;
  walletId: number;
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
}) {
  const existing = await db.select().from(bankEmailConnections).where(and(
    eq(bankEmailConnections.userId, params.userId),
    eq(bankEmailConnections.provider, params.provider),
    eq(bankEmailConnections.email, params.email),
    eq(bankEmailConnections.bankKey, "other"),
  ));
  const now = Math.floor(Date.now() / 1000);
  const values = {
    walletId: params.walletId,
    autoImport: true,
    accessTokenEncrypted: encryptToken(params.accessToken, params.userId),
    refreshTokenEncrypted: params.refreshToken ? encryptToken(params.refreshToken, params.userId) : existing[0]?.refreshTokenEncrypted || null,
    tokenExpiresAt: now + (params.expiresIn || 3600),
    updatedAt: now,
  };
  if (existing[0]) {
    const [updated] = await db.update(bankEmailConnections).set(values).where(eq(bankEmailConnections.id, existing[0].id)).returning();
    return updated;
  }
  const [created] = await db.insert(bankEmailConnections).values({ userId: params.userId, provider: params.provider, email: params.email, bankKey: "other", ...values }).returning();
  return created;
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
  if (!refreshToken || !process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    throw new Error("انتهت صلاحية ربط Gmail. أعد ربط البريد.");
  }

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!response.ok) throw new Error("تعذر تحديث صلاحية Gmail");
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
  if (!refreshToken || !process.env.MICROSOFT_CLIENT_ID || !process.env.MICROSOFT_CLIENT_SECRET) {
    throw new Error("انتهت صلاحية ربط Outlook. أعد ربط البريد.");
  }
  const tenant = process.env.MICROSOFT_TENANT_ID || "common";
  const response = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.MICROSOFT_CLIENT_ID,
      client_secret: process.env.MICROSOFT_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
      scope: "openid email offline_access User.Read Mail.Read",
    }),
  });
  if (!response.ok) throw new Error("تعذر تحديث صلاحية Outlook");
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
    bankKey: params.parsed.bankKey,
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
  const [event] = await db.insert(bankEmailEvents).values({
    userId: params.userId,
    connectionId: params.connection.id,
    providerMessageId: params.providerMessageId,
    fingerprint,
    bankKey: params.parsed.bankKey,
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
  }).returning();

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
  const listUrl = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
  listUrl.searchParams.set("maxResults", "50");
  listUrl.searchParams.set("q", buildBankSearchQuery(connection.bankKey as BankKey));
  const listResponse = await fetch(listUrl, { headers });
  if (!listResponse.ok) throw new Error("تعذر قراءة رسائل Gmail");
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

function senderMatchesBank(bankKey: BankKey, sender: string) {
  const profile = BANK_PROFILES.find((bank) => bank.key === bankKey);
  const normalized = sender.toLowerCase();
  if (!profile || profile.key === "other") {
    return BANK_PROFILES.some((bank) => bank.key !== "other" && bank.senders.some((value) => normalized.includes(value.toLowerCase())));
  }
  return profile.senders.some((value) => normalized.includes(value.toLowerCase()));
}

async function syncMicrosoftConnection(userId: number, connection: typeof bankEmailConnections.$inferSelect) {
  const accessToken = await microsoftAccessToken(connection);
  const url = new URL("https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages");
  url.searchParams.set("$top", "50");
  url.searchParams.set("$select", "id,subject,from,receivedDateTime");
  url.searchParams.set("$orderby", "receivedDateTime desc");
  const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!response.ok) throw new Error("تعذر قراءة رسائل Outlook");
  const list = await response.json() as { value?: Array<{ id: string; subject?: string; from?: { emailAddress?: { address?: string } }; receivedDateTime?: string }> };
  const summary = { checked: list.value?.length || 0, imported: 0, review: 0, duplicate: 0, ignored: 0 };

  for (const message of list.value || []) {
    const sender = message.from?.emailAddress?.address || "";
    if (!senderMatchesBank(connection.bankKey as BankKey, sender)) { summary.ignored += 1; continue; }
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
          if (connection.provider === "google") await syncGoogleConnection(connection.userId, connection);
          if (connection.provider === "microsoft") await syncMicrosoftConnection(connection.userId, connection);
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
  app.get("/api/auth/email-providers", (_req, res) => {
    res.json({
      google: { configured: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) },
      microsoft: { configured: Boolean(process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET) },
    });
  });

  app.get("/api/auth/google/start", async (req, res, next) => {
    try {
      if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
        return res.redirect("/login?oauth_error=google_not_configured");
      }
      const state = randomBytes(24).toString("base64url");
      (req.session as any).bankEmailLoginOauth = { state, provider: "google", createdAt: Date.now() };
      await saveSession(req);
      const redirectUri = process.env.GOOGLE_AUTH_REDIRECT_URI || `${appUrl(req)}/api/auth/google/callback`;
      const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      url.searchParams.set("client_id", process.env.GOOGLE_CLIENT_ID);
      url.searchParams.set("redirect_uri", redirectUri);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("scope", "openid email profile https://www.googleapis.com/auth/gmail.readonly");
      url.searchParams.set("access_type", "offline");
      url.searchParams.set("prompt", "consent");
      url.searchParams.set("state", state);
      res.redirect(url.toString());
    } catch (error) { next(error); }
  });

  app.get("/api/auth/google/callback", async (req, res) => {
    const pending = (req.session as any).bankEmailLoginOauth;
    delete (req.session as any).bankEmailLoginOauth;
    if (!pending || pending.provider !== "google" || pending.state !== req.query.state || Date.now() - pending.createdAt > 10 * 60 * 1000) {
      return res.redirect("/login?oauth_error=invalid_state");
    }
    try {
      const redirectUri = process.env.GOOGLE_AUTH_REDIRECT_URI || `${appUrl(req)}/api/auth/google/callback`;
      const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ code: String(req.query.code || ""), client_id: process.env.GOOGLE_CLIENT_ID!, client_secret: process.env.GOOGLE_CLIENT_SECRET!, redirect_uri: redirectUri, grant_type: "authorization_code" }),
      });
      if (!tokenResponse.ok) throw new Error("token exchange failed");
      const token = await tokenResponse.json() as { access_token: string; refresh_token?: string; expires_in?: number };
      const profileResponse = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", { headers: { Authorization: `Bearer ${token.access_token}` } });
      if (!profileResponse.ok) throw new Error("profile read failed");
      const profile = await profileResponse.json() as { email?: string; name?: string; verified_email?: boolean };
      if (!profile.email || profile.verified_email === false) throw new Error("email missing");
      const user = await resolveOauthUser(profile.email, profile.name || "");
      const wallet = await resolveConnectionWallet(user.id);
      const connection = await upsertAutomaticConnection({ userId: user.id, provider: "google", email: profile.email, walletId: wallet.id, accessToken: token.access_token, refreshToken: token.refresh_token, expiresIn: token.expires_in });
      await establishUserSession(req, user);
      await writeAuditEvent({ action: "auth.login.google", actorUserId: user.id, actorRole: user.role, targetUserId: user.id, ipAddress: req.ip });
      void syncGoogleConnection(user.id, connection).catch(() => undefined);
      res.redirect("/bank-inbox?connected=1&provider=google");
    } catch {
      res.redirect("/login?oauth_error=google_failed");
    }
  });

  app.get("/api/auth/microsoft/start", async (req, res, next) => {
    try {
      if (!process.env.MICROSOFT_CLIENT_ID || !process.env.MICROSOFT_CLIENT_SECRET) {
        return res.redirect("/login?oauth_error=microsoft_not_configured");
      }
      const state = randomBytes(24).toString("base64url");
      (req.session as any).bankEmailLoginOauth = { state, provider: "microsoft", createdAt: Date.now() };
      await saveSession(req);
      const tenant = process.env.MICROSOFT_TENANT_ID || "common";
      const redirectUri = process.env.MICROSOFT_AUTH_REDIRECT_URI || `${appUrl(req)}/api/auth/microsoft/callback`;
      const url = new URL(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`);
      url.searchParams.set("client_id", process.env.MICROSOFT_CLIENT_ID);
      url.searchParams.set("redirect_uri", redirectUri);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("response_mode", "query");
      url.searchParams.set("scope", "openid email profile offline_access User.Read Mail.Read");
      url.searchParams.set("state", state);
      res.redirect(url.toString());
    } catch (error) { next(error); }
  });

  app.get("/api/auth/microsoft/callback", async (req, res) => {
    const pending = (req.session as any).bankEmailLoginOauth;
    delete (req.session as any).bankEmailLoginOauth;
    if (!pending || pending.provider !== "microsoft" || pending.state !== req.query.state || Date.now() - pending.createdAt > 10 * 60 * 1000) {
      return res.redirect("/login?oauth_error=invalid_state");
    }
    try {
      const tenant = process.env.MICROSOFT_TENANT_ID || "common";
      const redirectUri = process.env.MICROSOFT_AUTH_REDIRECT_URI || `${appUrl(req)}/api/auth/microsoft/callback`;
      const tokenResponse = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ code: String(req.query.code || ""), client_id: process.env.MICROSOFT_CLIENT_ID!, client_secret: process.env.MICROSOFT_CLIENT_SECRET!, redirect_uri: redirectUri, grant_type: "authorization_code", scope: "openid email profile offline_access User.Read Mail.Read" }),
      });
      if (!tokenResponse.ok) throw new Error("token exchange failed");
      const token = await tokenResponse.json() as { access_token: string; refresh_token?: string; expires_in?: number };
      const profileResponse = await fetch("https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName,displayName", { headers: { Authorization: `Bearer ${token.access_token}` } });
      if (!profileResponse.ok) throw new Error("profile read failed");
      const profile = await profileResponse.json() as { mail?: string; userPrincipalName?: string; displayName?: string };
      const email = profile.mail || profile.userPrincipalName;
      if (!email) throw new Error("email missing");
      const user = await resolveOauthUser(email, profile.displayName || "");
      const wallet = await resolveConnectionWallet(user.id);
      const connection = await upsertAutomaticConnection({ userId: user.id, provider: "microsoft", email, walletId: wallet.id, accessToken: token.access_token, refreshToken: token.refresh_token, expiresIn: token.expires_in });
      await establishUserSession(req, user);
      await writeAuditEvent({ action: "auth.login.microsoft", actorUserId: user.id, actorRole: user.role, targetUserId: user.id, ipAddress: req.ip });
      void syncMicrosoftConnection(user.id, connection).catch(() => undefined);
      res.redirect("/bank-inbox?connected=1&provider=microsoft");
    } catch {
      res.redirect("/login?oauth_error=microsoft_failed");
    }
  });

  app.get("/api/bank-inbox", requireAuth, async (req, res, next) => {
    try {
      const connections = await db.select({
        id: bankEmailConnections.id,
        provider: bankEmailConnections.provider,
        email: bankEmailConnections.email,
        bankKey: bankEmailConnections.bankKey,
        walletId: bankEmailConnections.walletId,
        autoImport: bankEmailConnections.autoImport,
        lastSyncAt: bankEmailConnections.lastSyncAt,
        createdAt: bankEmailConnections.createdAt,
      }).from(bankEmailConnections).where(eq(bankEmailConnections.userId, req.user!.id)).orderBy(desc(bankEmailConnections.id));
      const events = await db.select().from(bankEmailEvents).where(eq(bankEmailEvents.userId, req.user!.id)).orderBy(desc(bankEmailEvents.receivedAt)).limit(30);
      res.json({
        providers: {
          google: { configured: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) },
          microsoft: { configured: Boolean(process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET) },
        },
        banks: BANK_PROFILES.map(({ key, name }) => ({ key, name })),
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
      if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
        return res.status(503).json({ message: "ربط Gmail يحتاج تهيئة مفاتيح Google من إدارة المنصة" });
      }
      const input = connectSchema.parse(req.body);
      const wallet = await resolveConnectionWallet(req.user!.id, input.walletId);
      const state = randomBytes(24).toString("base64url");
      (req.session as any).bankEmailOauth = { state, provider: "google", userId: req.user!.id, ...input, walletId: wallet.id, createdAt: Date.now() };
      const redirectUri = process.env.GOOGLE_REDIRECT_URI || `${appUrl(req)}/api/bank-inbox/google/callback`;
      const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      url.searchParams.set("client_id", process.env.GOOGLE_CLIENT_ID);
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
      const redirectUri = process.env.GOOGLE_REDIRECT_URI || `${appUrl(req)}/api/bank-inbox/google/callback`;
      const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code: String(req.query.code || ""),
          client_id: process.env.GOOGLE_CLIENT_ID!,
          client_secret: process.env.GOOGLE_CLIENT_SECRET!,
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
      if (existing[0]) {
        await db.update(bankEmailConnections).set({
          walletId: pending.walletId,
          autoImport: pending.autoImport,
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
      if (!process.env.MICROSOFT_CLIENT_ID || !process.env.MICROSOFT_CLIENT_SECRET) {
        return res.status(503).json({ message: "ربط Outlook يحتاج تهيئة مفاتيح Microsoft من إدارة المنصة" });
      }
      const input = connectSchema.parse(req.body);
      const wallet = await resolveConnectionWallet(req.user!.id, input.walletId);
      const state = randomBytes(24).toString("base64url");
      (req.session as any).bankEmailOauth = { state, provider: "microsoft", userId: req.user!.id, ...input, walletId: wallet.id, createdAt: Date.now() };
      const tenant = process.env.MICROSOFT_TENANT_ID || "common";
      const redirectUri = process.env.MICROSOFT_REDIRECT_URI || `${appUrl(req)}/api/bank-inbox/microsoft/callback`;
      const url = new URL(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`);
      url.searchParams.set("client_id", process.env.MICROSOFT_CLIENT_ID);
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
      const tenant = process.env.MICROSOFT_TENANT_ID || "common";
      const redirectUri = process.env.MICROSOFT_REDIRECT_URI || `${appUrl(req)}/api/bank-inbox/microsoft/callback`;
      const tokenResponse = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ code: String(req.query.code || ""), client_id: process.env.MICROSOFT_CLIENT_ID!, client_secret: process.env.MICROSOFT_CLIENT_SECRET!, redirect_uri: redirectUri, grant_type: "authorization_code", scope: "openid email offline_access User.Read Mail.Read" }),
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
      const values = { walletId: pending.walletId, autoImport: pending.autoImport, accessTokenEncrypted: encryptToken(token.access_token, req.user!.id), refreshTokenEncrypted: token.refresh_token ? encryptToken(token.refresh_token, req.user!.id) : existing[0]?.refreshTokenEncrypted || null, tokenExpiresAt: now + (token.expires_in || 3600), updatedAt: now };
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
      if (connection.provider === "google") return res.json(await syncGoogleConnection(req.user!.id, connection));
      if (connection.provider === "microsoft") return res.json(await syncMicrosoftConnection(req.user!.id, connection));
      return res.status(400).json({ message: "موصل البريد غير مدعوم" });
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
