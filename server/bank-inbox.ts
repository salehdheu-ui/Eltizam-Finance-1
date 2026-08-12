import type { Express, NextFunction, Request, Response } from "express";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import { and, desc, eq, gte, inArray, isNotNull, isNull, lt, lte } from "drizzle-orm";
import { z } from "zod";
import { bankCategoryRules, bankEmailConnections, bankEmailEvents, categories, commitments, transactions } from "@shared/schema";
import { db } from "./db";
import { storage, UNKNOWN_ADJUSTMENT_NOTE } from "./storage";
import { buildBankAnalysis } from "./bank-analysis";
import { BANK_PROFILES, buildBankSearchQuery, createMessageFingerprint, detectBalanceGap, extractAccountReferences, messageMatchesAccount, normalizeAccountFilter, normalizeSenderList, parseBankMessage, resolveAllowedSenders, resolveSyncWindowStart, senderMatchesBank, type BankKey } from "./bank-message-parser";
import { getProviderConfig, isProviderConfigured, resolveRedirectUri } from "./integration-settings";
import { buildWriteQueueKey, enqueueWrite } from "./write-queue";
import { notify } from "./notifications";

const senderEntryPattern = /^[a-z0-9](?:[a-z0-9._+@-]*[a-z0-9])?$/;

const bankKeySchema = z.enum(["bank_muscat", "nbo", "bank_dhofar", "sohar_international", "ahlibank", "oman_arab_bank", "bank_nizwa", "other"]);

const accountFilterSchema = z.string().max(34).optional().default("").refine(
  (value) => value.trim() === "" || /\d{3,}/.test(value),
  { message: "أدخل آخر أربعة أرقام من الحساب، مثل 1234" },
);

const connectSchema = z.object({
  bankKey: bankKeySchema,
  customSenders: z.string().max(500).optional().default(""),
  accountFilter: accountFilterSchema,
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

/**
 * The key a saved decision is filed under. Banks mask payee names inconsistently
 * in case and spacing, so both are flattened to keep one payee from splitting
 * into several rules.
 */
export function buildRuleKey(counterparty: string | null | undefined, merchant: string | null | undefined) {
  const source = (counterparty || merchant || "").trim().toUpperCase().replace(/\s+/g, " ");
  return source || null;
}

async function findSavedRule(userId: number, ruleKey: string | null) {
  if (!ruleKey) return null;
  const [rule] = await db.select().from(bankCategoryRules).where(and(
    eq(bankCategoryRules.userId, userId),
    eq(bankCategoryRules.matchKey, ruleKey),
  ));
  return rule ?? null;
}

const CATEGORY_ICONS: Record<string, string> = {
  "مطاعم": "🍽️", "وقود": "⛽", "اتصالات": "📱", "بقالة": "🛒", "صحة": "🏥",
  "فواتير": "🧾", "مواصلات": "🚗", "تعليم": "🎓", "تسوق": "🛍️", "ترفيه": "🎬",
  "تأمين": "🛡️", "إيجار": "🏠", "راتب": "💰", "سحب نقدي": "🏧", "تحويلات": "🔄",
  "رسوم بنكية": "🏦",
};

/**
 * A hint is only useful if it can point at a real category. Creating the missing
 * one keeps imported spending broken down by where it went instead of collapsing
 * every row into the same uncategorised bucket.
 */
async function resolveCategoryId(userId: number, hint: string | null, type: "income" | "expense") {
  if (!hint) return null;

  const categories = await storage.getCategories(userId);
  const existing = categories.find((category) =>
    category.type === type && (category.name.includes(hint) || hint.includes(category.name)));
  if (existing) return existing.id;

  try {
    const created = await storage.createCategory(userId, {
      name: hint,
      type,
      icon: CATEGORY_ICONS[hint] || "📝",
      color: "bg-slate-100 text-slate-600",
      budget: 0,
    });
    return created.id;
  } catch (error) {
    console.error(`Failed to create category "${hint}" for user ${userId}:`, error instanceof Error ? error.message : "unknown error");
    return null;
  }
}

async function findAutomaticLinks(
  userId: number,
  merchant: string,
  categoryHint: string | null,
  amount: number,
  receivedAt: number,
  counterparty?: string | null,
  transactionType: "income" | "expense" = "expense",
) {
  const ruleKey = buildRuleKey(counterparty, merchant);
  const [activeCommitments, savedRule] = await Promise.all([
    db.select().from(commitments).where(and(eq(commitments.userId, userId), eq(commitments.status, "active"))),
    findSavedRule(userId, ruleKey),
  ]);

  // Only reach for a category when no saved decision already answers this.
  const hintedCategoryId = savedRule?.categoryId
    ? null
    : await resolveCategoryId(userId, categoryHint, transactionType);

  // A decision the user made themselves outranks anything we infer from keywords.
  const categoryId = savedRule?.categoryId ?? hintedCategoryId;

  const matchedCommitment = activeCommitments.find((item) => {
    if (item.type !== "financial" || item.amount === null) return false;
    const amountMatches = Math.abs(item.amount - amount) <= Math.max(0.01, amount * 0.02);
    const dateMatches = !item.dueDate || Math.abs(item.dueDate - receivedAt) <= 7 * 86400;
    return amountMatches && dateMatches;
  });

  if (savedRule) {
    await db.update(bankCategoryRules)
      .set({ hitCount: savedRule.hitCount + 1, updatedAt: Math.floor(Date.now() / 1000) })
      .where(eq(bankCategoryRules.id, savedRule.id));
  }

  return {
    categoryId,
    commitmentId: savedRule?.commitmentId ?? matchedCommitment?.id ?? null,
    matchedRule: Boolean(savedRule),
  };
}

/**
 * Banks print a closing balance on every alert, so the balance of the previous
 * message plus this transaction should equal the balance of this one. Any
 * leftover means movements happened that we never received an email for — which
 * is exactly the gap that used to make the running total drift silently.
 */
async function measureBalanceGap(
  userId: number,
  connectionId: number,
  receivedAt: number,
  parsed: NonNullable<ReturnType<typeof parseBankMessage>>,
) {
  if (parsed.balanceAfter === null) return null;

  const [previous] = await db
    .select({ balanceAfter: bankEmailEvents.balanceAfter })
    .from(bankEmailEvents)
    .where(and(
      eq(bankEmailEvents.userId, userId),
      eq(bankEmailEvents.connectionId, connectionId),
      lt(bankEmailEvents.receivedAt, receivedAt),
      isNotNull(bankEmailEvents.balanceAfter),
    ))
    .orderBy(desc(bankEmailEvents.receivedAt))
    .limit(1);

  return detectBalanceGap({
    previousBalance: previous?.balanceAfter ?? null,
    direction: parsed.direction,
    amount: parsed.amount,
    balanceAfter: parsed.balanceAfter,
  });
}

/** How far from the message time a hand-entered transaction may sit and still be the same payment. */
const RECONCILE_WINDOW_SECONDS = 3 * 86400;

/**
 * The same payment recorded twice — once by the user before the bank's email was
 * ever read, once by this importer — is the single way an inbox connection can
 * make the books worse than no automation at all. So before creating anything,
 * look for a transaction the user already entered that this message describes:
 * same wallet, same direction, same amount, within a few days, and not already
 * claimed by another message. Finding one links the two instead of adding a
 * second copy, which is what lets an existing history be connected to the inbox
 * without having to clear it first.
 */
async function findTransactionToReconcile(params: {
  userId: number;
  walletId: number;
  type: "income" | "expense";
  amount: number;
  receivedAt: number;
}) {
  const tolerance = Math.max(0.001, params.amount * 0.001);
  const candidates = await db
    .select({ id: transactions.id, amount: transactions.amount, date: transactions.date, note: transactions.note })
    .from(transactions)
    .where(and(
      eq(transactions.userId, params.userId),
      eq(transactions.walletId, params.walletId),
      eq(transactions.type, params.type),
      gte(transactions.date, params.receivedAt - RECONCILE_WINDOW_SECONDS),
      lte(transactions.date, params.receivedAt + RECONCILE_WINDOW_SECONDS),
    ));

  const matches = candidates
    // A transfer leg is bookkeeping between the user's own wallets, never the
    // payment a bank alert is reporting.
    .filter((candidate) => !(candidate.note || "").startsWith("__transfer__:"))
    // Nor is the placeholder this importer books for an unexplained balance
    // difference. Reconciliation exists to recognise what the *user* recorded;
    // letting a message merge into our own placeholder would leave a real
    // payment permanently labelled "unknown" and stop it being categorised.
    .filter((candidate) => candidate.note !== UNKNOWN_ADJUSTMENT_NOTE)
    .filter((candidate) => Math.abs(candidate.amount - params.amount) <= tolerance)
    .sort((a, b) => Math.abs(a.date - params.receivedAt) - Math.abs(b.date - params.receivedAt));

  for (const candidate of matches) {
    const [claimed] = await db
      .select({ id: bankEmailEvents.id })
      .from(bankEmailEvents)
      .where(eq(bankEmailEvents.transactionId, candidate.id));
    if (!claimed) return candidate;
  }
  return null;
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

  const links = await findAutomaticLinks(params.userId, params.parsed.merchant, params.parsed.categoryHint, params.parsed.amount, params.receivedAt, params.parsed.counterparty, params.parsed.transactionType);
  const gap = await measureBalanceGap(params.userId, params.connection.id, params.receivedAt, params.parsed);
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
    direction: params.parsed.direction,
    channel: params.parsed.channel,
    amount: params.parsed.amount,
    balanceAfter: params.parsed.balanceAfter,
    gapAmount: gap?.difference ?? null,
    merchant: params.parsed.merchant,
    counterparty: params.parsed.counterparty,
    fromAccount: params.parsed.fromAccount,
    toAccount: params.parsed.toAccount,
    accountRef: params.parsed.accountRef,
    reference: params.parsed.reference,
    categoryId: links.categoryId,
    commitmentId: links.commitmentId,
  }).onConflictDoNothing().returning();

  if (!event) return { state: "duplicate" as const };

  // A payment the user already wrote down is not a new transaction, whatever the
  // connection's import setting says — recording it again is the one outcome that
  // is worse than doing nothing.
  const existing = await findTransactionToReconcile({
    userId: params.userId,
    walletId: params.connection.walletId,
    type: params.parsed.transactionType,
    amount: params.parsed.amount,
    receivedAt: params.receivedAt,
  });

  if (existing) {
    const [merged] = await db.update(bankEmailEvents)
      .set({ status: "merged", transactionId: existing.id })
      .where(eq(bankEmailEvents.id, event.id))
      .returning();
    // The bank's own closing balance is the authority, so let it correct whatever
    // the manual entry left the wallet at.
    if (typeof params.parsed.balanceAfter === "number") {
      await storage.updateWallet(params.connection.walletId, params.userId, { balance: params.parsed.balanceAfter });
    }
    if (links.categoryId && !existing.note?.startsWith("__transfer__:")) {
      await db.update(transactions)
        .set({ categoryId: links.categoryId })
        .where(and(eq(transactions.id, existing.id), isNull(transactions.categoryId)));
    }
    return { state: "merged" as const, event: merged };
  }

  // A payee the user already classified is a decision, not a guess, so it clears
  // the bar on its own. Without this the same well-known merchant kept landing in
  // review after being answered, which is the opposite of automating anything.
  const requiredConfidence = links.matchedRule ? 0.6 : 0.9;
  if (!params.connection.autoImport || params.parsed.confidence < requiredConfidence) {
    return { state: "review" as const, event };
  }

  try {
    const transaction = await storage.createTransaction(params.userId, {
      walletId: params.connection.walletId,
      categoryId: links.categoryId,
      type: params.parsed.transactionType,
      amount: params.parsed.amount,
      note: `من البريد البنكي · ${params.parsed.merchant}`,
    }, { allowOverdraft: true, settleBalanceTo: params.parsed.balanceAfter });
    await db.update(transactions).set({ date: params.receivedAt }).where(eq(transactions.id, transaction.id));

    // The bank's balance moved by more than this message explains, so messages we
    // never received account for the rest. Booking it keeps the history equal to
    // the balance instead of leaving a difference nothing in the ledger explains.
    if (gap && Math.abs(gap.difference) >= 0.001) {
      const unknown = await storage.createTransaction(params.userId, {
        walletId: params.connection.walletId,
        categoryId: null,
        type: gap.direction === "credit" ? "income" : "expense",
        amount: Math.abs(gap.difference),
        note: UNKNOWN_ADJUSTMENT_NOTE,
      }, { allowOverdraft: true });
      // Dated just before the message that revealed it, since it happened earlier.
      await db.update(transactions).set({ date: params.receivedAt - 1 }).where(eq(transactions.id, unknown.id));
    }

    const [imported] = await db.update(bankEmailEvents).set({ status: "imported", transactionId: transaction.id }).where(eq(bankEmailEvents.id, event.id)).returning();
    return { state: "imported" as const, event: imported };
  } catch (error) {
    // Leaving the event in review keeps the message actionable, but the reason
    // has to reach the log or the failure is invisible on both sides.
    console.error(`Bank inbox import failed for event ${event.id}:`, error instanceof Error ? error.message : "unknown error");
    return { state: "review" as const, event };
  }
}

type SyncSummary = {
  checked: number;
  imported: number;
  review: number;
  merged: number;
  duplicate: number;
  ignored: number;
  otherAccount: number;
};

type MessageCandidate = {
  providerMessageId: string;
  sender: string;
  subject: string;
  body: string;
  receivedAt: number;
};

/** What a finished sync is worth telling the user about. */
type SyncOutcome = {
  imported: Array<{ merchant: string; amount: number; type: "income" | "expense" }>;
  gaps: number;
  /** Newest message in the batch, which is what makes a dedupe key stable. */
  latestReceivedAt: number;
};

function formatAmount(amount: number) {
  return `${amount.toFixed(3)} ر.ع`;
}

/**
 * One notification per sync, not one per message. A first read covers ninety days
 * and can import dozens of alerts at once; firing a notification for each would
 * bury the phone and teach the user to swipe the whole category away.
 *
 * Delivery goes through the shared notification service, so the channels the user
 * chose and their quiet hours apply here exactly as they do to commitment
 * reminders. The dedupe keys are built from the newest message in the batch: a
 * re-read of the same overlap window produces the same key and is dropped, while
 * genuinely new mail moves the key and gets through.
 */
async function notifySyncOutcome(userId: number, connectionId: number, summary: SyncSummary, outcome: SyncOutcome) {
  const stamp = `${connectionId}:${outcome.latestReceivedAt}`;

  if (summary.imported === 1) {
    const [only] = outcome.imported;
    if (only) {
      await notify({
        userId,
        title: only.type === "income" ? "إيداع جديد" : "خصم جديد",
        body: `${formatAmount(only.amount)} · ${only.merchant}`,
        url: "/transactions",
        dedupeKey: `bank-import:${stamp}`,
      });
    }
  } else if (summary.imported > 1) {
    const total = outcome.imported.reduce((sum, item) => sum + (item.type === "income" ? item.amount : -item.amount), 0);
    await notify({
      userId,
      title: `${summary.imported} حركة جديدة من البنك`,
      body: `الصافي ${formatAmount(Math.abs(total))} ${total >= 0 ? "إيداع" : "خصم"}`,
      url: "/transactions",
      dedupeKey: `bank-import:${stamp}`,
    });
  }

  if (summary.review > 0) {
    await notify({
      userId,
      title: "حركات تنتظر مراجعتك",
      body: `${summary.review} رسالة بنكية تحتاج تأكيدك قبل إضافتها`,
      url: "/bank-inbox",
      dedupeKey: `bank-review:${stamp}`,
    });
  }

  if (outcome.gaps > 0) {
    await notify({
      userId,
      title: "فجوة في الرصيد",
      body: `${outcome.gaps} حركة ظهرت في رصيد البنك دون أن تصلك رسالة بها`,
      url: "/bank-inbox",
      dedupeKey: `bank-gap:${stamp}`,
    });
  }
}

// A first read covers 90 days, so the ceiling has to clear a busy mailbox in one
// pass; later reads only ask for what arrived since, and never come near it.
const MESSAGES_PER_PAGE = 100;
const MAX_PAGES_PER_SYNC = 10;
const MAX_MESSAGES_PER_SYNC = MESSAGES_PER_PAGE * MAX_PAGES_PER_SYNC;

function emptySummary(): SyncSummary {
  return { checked: 0, imported: 0, review: 0, merged: 0, duplicate: 0, ignored: 0, otherAccount: 0 };
}

/**
 * Which of these messages we have never stored, asked once for the whole batch.
 * The previous shape asked the database per message, so a sync of 100 messages
 * cost 100 round trips before a single one was read.
 */
async function findUnseenMessageIds(userId: number, connectionId: number, providerMessageIds: string[]) {
  if (providerMessageIds.length === 0) return [];
  // Filtered on the same columns as the table's (user_id, connection_id,
  // provider_message_id) unique constraint, so the lookup rides that index.
  const seen = await db
    .select({ providerMessageId: bankEmailEvents.providerMessageId })
    .from(bankEmailEvents)
    .where(and(
      eq(bankEmailEvents.userId, userId),
      eq(bankEmailEvents.connectionId, connectionId),
      inArray(bankEmailEvents.providerMessageId, providerMessageIds),
    ));
  const seenIds = new Set(seen.map((row) => row.providerMessageId));
  return providerMessageIds.filter((id) => !seenIds.has(id));
}

/**
 * Ordering here is not cosmetic. Both providers hand back the newest message
 * first, while the importer settles the wallet to the closing balance each
 * message reports — so reading a batch in the order it arrives left the wallet
 * holding the *oldest* message's balance, and the balance-gap check measured each
 * message against a predecessor that had not been written yet. Oldest-first gives
 * the last word to the most recent message, which is the one the bank agrees with.
 */
async function importCandidates(
  userId: number,
  connection: typeof bankEmailConnections.$inferSelect,
  candidates: MessageCandidate[],
  summary: SyncSummary,
  observedAccounts: Set<string>,
  outcome: SyncOutcome = { imported: [], gaps: 0, latestReceivedAt: 0 },
) {
  const ordered = [...candidates].sort((a, b) => a.receivedAt - b.receivedAt);

  for (const candidate of ordered) {
    const text = `${candidate.subject}\n${candidate.body}`;
    // Record what the mailbox actually holds even when we skip it, so a filter
    // that matches nothing can be corrected instead of dead-ending.
    extractAccountReferences(text).forEach((reference) => observedAccounts.add(reference));
    if (!messageMatchesAccount(text, connection.accountFilter)) { summary.otherAccount += 1; continue; }

    const parsed = parseBankMessage({
      bankKey: connection.bankKey as BankKey,
      sender: candidate.sender,
      subject: candidate.subject,
      body: candidate.body,
    });
    if (!parsed) { summary.ignored += 1; continue; }

    const result = await importParsedEvent({
      userId,
      connection,
      providerMessageId: candidate.providerMessageId,
      sender: candidate.sender,
      subject: candidate.subject,
      snippet: candidate.subject,
      receivedAt: candidate.receivedAt,
      parsed,
    });
    summary[result.state] += 1;
    // Ordered oldest-first, so the last message seen is the newest one.
    outcome.latestReceivedAt = Math.max(outcome.latestReceivedAt, candidate.receivedAt);

    if (result.state === "imported") {
      outcome.imported.push({
        merchant: parsed.merchant,
        amount: parsed.amount,
        type: parsed.transactionType,
      });
    }
    if (result.state !== "duplicate" && typeof result.event?.gapAmount === "number" && Math.abs(result.event.gapAmount) >= 0.001) {
      outcome.gaps += 1;
    }
  }
}

async function syncGoogleConnection(userId: number, connection: typeof bankEmailConnections.$inferSelect) {
  const accessToken = await googleAccessToken(connection);
  const headers = { Authorization: `Bearer ${accessToken}` };
  const since = resolveSyncWindowStart(connection.lastSyncAt);
  const searchQuery = buildBankSearchQuery(connection.bankKey as BankKey, connection.customSenders, since);
  if (!searchQuery) throw providerError(400, "أضف عنوان مرسل البنك لهذا الربط قبل قراءة الرسائل");

  // Gmail caps a page at 100 ids, so a mailbox holding more bank alerts than that
  // needs every page walked. Reading only the first page is how alerts older than
  // the newest hundred used to be dropped without anything saying so.
  const messageIds: string[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < MAX_PAGES_PER_SYNC; page += 1) {
    const listUrl = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
    listUrl.searchParams.set("maxResults", String(MESSAGES_PER_PAGE));
    listUrl.searchParams.set("q", searchQuery);
    if (pageToken) listUrl.searchParams.set("pageToken", pageToken);
    const listResponse = await fetch(listUrl, { headers });
    if (!listResponse.ok) throw googleReadError(await describeProviderFailure(listResponse));
    const list = await listResponse.json() as { messages?: Array<{ id: string }>; nextPageToken?: string };
    for (const item of list.messages || []) messageIds.push(item.id);
    if (!list.nextPageToken || messageIds.length >= MAX_MESSAGES_PER_SYNC) break;
    pageToken = list.nextPageToken;
  }

  const summary = emptySummary();
  summary.checked = messageIds.length;
  const observedAccounts = new Set<string>();
  const outcome: SyncOutcome = { imported: [], gaps: 0, latestReceivedAt: 0 };

  const unseen = await findUnseenMessageIds(userId, connection.id, messageIds);
  summary.duplicate += messageIds.length - unseen.length;

  const candidates: MessageCandidate[] = [];
  for (const messageId of unseen) {
    const response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}?format=full`, { headers });
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
    candidates.push({
      providerMessageId: message.id,
      sender,
      subject: headerValue(message.payload?.headers, "Subject"),
      body: gmailBody(message.payload) || message.snippet || "",
      receivedAt: Math.floor(Number(message.internalDate || Date.now()) / 1000),
    });
  }

  await importCandidates(userId, connection, candidates, summary, observedAccounts, outcome);
  return { ...summary, observedAccounts: Array.from(observedAccounts), outcome };
}

async function syncMicrosoftConnection(userId: number, connection: typeof bankEmailConnections.$inferSelect) {
  if (resolveAllowedSenders(connection.bankKey as BankKey, connection.customSenders).length === 0) {
    throw new Error("أضف عنوان مرسل البنك لهذا الربط قبل قراءة الرسائل");
  }
  const accessToken = await microsoftAccessToken(connection);
  const headers = { Authorization: `Bearer ${accessToken}` };
  const since = resolveSyncWindowStart(connection.lastSyncAt);

  // Graph cannot filter a mailbox by sender, so the window has to be the date and
  // the pages have to be walked. Taking the newest 50 of the whole inbox — as this
  // did — meant a single busy morning of personal mail pushed every bank alert out
  // of view, and the sync reported nothing to import while looking at nothing.
  const summary = emptySummary();
  const observedAccounts = new Set<string>();
  const outcome: SyncOutcome = { imported: [], gaps: 0, latestReceivedAt: 0 };
  const messages: Array<{ id: string; subject?: string; sender: string; receivedDateTime?: string }> = [];

  let nextLink: string | null = (() => {
    const url = new URL("https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages");
    url.searchParams.set("$top", String(MESSAGES_PER_PAGE));
    url.searchParams.set("$select", "id,subject,from,receivedDateTime");
    url.searchParams.set("$orderby", "receivedDateTime desc");
    url.searchParams.set("$filter", `receivedDateTime ge ${new Date(since * 1000).toISOString()}`);
    return url.toString();
  })();

  for (let page = 0; page < MAX_PAGES_PER_SYNC && nextLink; page += 1) {
    const response: globalThis.Response = await fetch(nextLink, { headers });
    if (!response.ok) throw microsoftReadError(await describeProviderFailure(response));
    const list = await response.json() as {
      value?: Array<{ id: string; subject?: string; from?: { emailAddress?: { address?: string } }; receivedDateTime?: string }>;
      "@odata.nextLink"?: string;
    };
    for (const message of list.value || []) {
      summary.checked += 1;
      const sender = message.from?.emailAddress?.address || "";
      if (!senderMatchesBank(connection.bankKey as BankKey, sender, connection.customSenders)) { summary.ignored += 1; continue; }
      messages.push({ id: message.id, subject: message.subject, sender, receivedDateTime: message.receivedDateTime });
    }
    nextLink = messages.length >= MAX_MESSAGES_PER_SYNC ? null : (list["@odata.nextLink"] ?? null);
  }

  const unseen = new Set(await findUnseenMessageIds(userId, connection.id, messages.map((message) => message.id)));
  summary.duplicate += messages.length - unseen.size;

  const candidates: MessageCandidate[] = [];
  for (const message of messages) {
    if (!unseen.has(message.id)) continue;
    const detailResponse = await fetch(`https://graph.microsoft.com/v1.0/me/messages/${encodeURIComponent(message.id)}?$select=subject,from,receivedDateTime,bodyPreview,body`, { headers });
    if (!detailResponse.ok) { summary.ignored += 1; continue; }
    const detail = await detailResponse.json() as { subject?: string; receivedDateTime?: string; bodyPreview?: string; body?: { content?: string; contentType?: string } };
    candidates.push({
      providerMessageId: message.id,
      sender: message.sender,
      subject: detail.subject || message.subject || "",
      body: detail.body?.contentType?.toLowerCase() === "html" ? htmlToText(detail.body.content || "") : (detail.body?.content || detail.bodyPreview || ""),
      receivedAt: Math.floor(new Date(detail.receivedDateTime || message.receivedDateTime || Date.now()).getTime() / 1000),
    });
  }

  await importCandidates(userId, connection, candidates, summary, observedAccounts, outcome);
  return { ...summary, observedAccounts: Array.from(observedAccounts), outcome };
}
/** The message to show the user for a failed read, without leaking internals. */
function describeSyncError(error: unknown) {
  if (error && typeof error === "object" && "publicMessage" in error) {
    return String((error as { publicMessage: string }).publicMessage);
  }
  return error instanceof Error ? error.message : "تعذرت قراءة الرسائل لسبب غير معروف";
}

/**
 * The scheduler and the manual "read messages" button hit the same connection, so
 * they take turns instead of racing each other through the same inbox. Whichever
 * one runs also records how it went: a connection that stopped reading has to be
 * able to say why, since the screen otherwise reports "no new messages" forever
 * and a revoked token looks exactly like a quiet week.
 */
async function syncConnection(userId: number, connection: typeof bankEmailConnections.$inferSelect) {
  const queued = await enqueueWrite(buildWriteQueueKey("bank-inbox-sync", connection.id), async () => {
    const startedAt = Math.floor(Date.now() / 1000);
    try {
      let summary: Awaited<ReturnType<typeof syncGoogleConnection>>;
      if (connection.provider === "google") {
        summary = await syncGoogleConnection(userId, connection);
      } else if (connection.provider === "microsoft") {
        summary = await syncMicrosoftConnection(userId, connection);
      } else {
        throw providerError(400, "موصل البريد غير مدعوم");
      }

      const finishedAt = Math.floor(Date.now() / 1000);
      await db.update(bankEmailConnections).set({
        lastSyncAt: finishedAt,
        lastSyncAttemptAt: startedAt,
        lastStatus: "ok",
        lastError: null,
        failureCount: 0,
        updatedAt: finishedAt,
      }).where(eq(bankEmailConnections.id, connection.id));

      // Telling the user is the point of reading in the background — a sync that
      // ran while the app was closed is otherwise invisible until they open it.
      // But the mail is already read and the transactions already written, so a
      // notification that cannot be delivered must not turn a good sync into a
      // failed one, nor roll the connection into the error backoff.
      const { outcome, ...counts } = summary;
      try {
        await notifySyncOutcome(userId, connection.id, counts, outcome);
      } catch (error) {
        console.error(`Bank inbox notification failed for connection ${connection.id}:`, error instanceof Error ? error.message : "unknown error");
      }
      return summary;
    } catch (error) {
      await db.update(bankEmailConnections).set({
        lastSyncAttemptAt: startedAt,
        lastStatus: "error",
        lastError: describeSyncError(error).slice(0, 300),
        failureCount: (connection.failureCount || 0) + 1,
        updatedAt: Math.floor(Date.now() / 1000),
      }).where(eq(bankEmailConnections.id, connection.id));
      throw error;
    }
  });
  return queued.result;
}

/**
 * A connection that keeps failing is almost always waiting on the user — a
 * revoked token, a disabled API — and retrying it every few minutes neither fixes
 * it nor is free, since the provider counts every rejected call against the quota
 * the working connections share. Each consecutive failure doubles the wait, up to
 * an hour.
 */
function nextAttemptDelaySeconds(connection: typeof bankEmailConnections.$inferSelect, intervalSeconds: number) {
  const failures = Math.min(connection.failureCount || 0, 6);
  if (failures === 0) return intervalSeconds;
  return Math.min(3600, intervalSeconds * 2 ** failures);
}

let schedulerStarted = false;
function startBankInboxScheduler() {
  if (schedulerStarted || process.env.NODE_ENV === "test") return;
  schedulerStarted = true;
  const configuredMinutes = Number(process.env.BANK_EMAIL_SYNC_MINUTES || 5);
  const intervalSeconds = Math.min(60, Math.max(2, Number.isFinite(configuredMinutes) ? configuredMinutes : 5)) * 60;
  let running = false;

  const run = async () => {
    if (running) return;
    running = true;
    try {
      const now = Math.floor(Date.now() / 1000);
      // Every connection is read, not just the auto-importing ones. Reading the
      // mailbox and creating a transaction from what it says are two different
      // decisions: turning off automatic import asks us to wait for approval, not
      // to stop looking — and while these were conflated, a connection set to
      // review-first never produced anything to review unless a button was pressed.
      const connections = await db.select().from(bankEmailConnections);
      for (const connection of connections) {
        const lastAttempt = connection.lastSyncAttemptAt ?? connection.lastSyncAt;
        if (lastAttempt && now - lastAttempt < nextAttemptDelaySeconds(connection, intervalSeconds) - 15) continue;
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

  const timer = setInterval(() => { void run(); }, intervalSeconds * 1000);
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
        accountFilter: bankEmailConnections.accountFilter,
        walletId: bankEmailConnections.walletId,
        autoImport: bankEmailConnections.autoImport,
        lastSyncAt: bankEmailConnections.lastSyncAt,
        lastSyncAttemptAt: bankEmailConnections.lastSyncAttemptAt,
        lastStatus: bankEmailConnections.lastStatus,
        lastError: bankEmailConnections.lastError,
        failureCount: bankEmailConnections.failureCount,
        createdAt: bankEmailConnections.createdAt,
      }).from(bankEmailConnections).where(eq(bankEmailConnections.userId, req.user!.id)).orderBy(desc(bankEmailConnections.id));
      const events = await db.select().from(bankEmailEvents).where(eq(bankEmailEvents.userId, req.user!.id)).orderBy(desc(bankEmailEvents.receivedAt)).limit(30);
      // Which accounts actually show up in this mailbox, so the user picks one
      // they can recognise instead of guessing the digits from memory.
      const accountRows = await db
        .select({ accountRef: bankEmailEvents.accountRef, connectionId: bankEmailEvents.connectionId })
        .from(bankEmailEvents)
        .where(and(eq(bankEmailEvents.userId, req.user!.id), isNotNull(bankEmailEvents.accountRef)));
      const detectedAccounts = Object.values(
        accountRows.reduce<Record<string, { accountRef: string; connectionId: number; count: number }>>((acc, row) => {
          const key = `${row.connectionId}:${row.accountRef}`;
          if (!acc[key]) acc[key] = { accountRef: row.accountRef!, connectionId: row.connectionId, count: 0 };
          acc[key].count += 1;
          return acc;
        }, {}),
      ).sort((a, b) => b.count - a.count);
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
        detectedAccounts,
        connections,
        events,
      });
    } catch (error) { next(error); }
  });

  app.get("/api/bank-inbox/analysis", requireAuth, async (req, res, next) => {
    try {
      const days = Math.min(365, Math.max(7, Number(req.query.days) || 90));
      const since = Math.floor(Date.now() / 1000) - days * 86400;
      const [events, categories] = await Promise.all([
        db.select().from(bankEmailEvents).where(and(
          eq(bankEmailEvents.userId, req.user!.id),
          gte(bankEmailEvents.receivedAt, since),
        )).orderBy(desc(bankEmailEvents.receivedAt)),
        storage.getCategories(req.user!.id),
      ]);

      res.json({
        days,
        ...buildBankAnalysis(events, new Map(categories.map((category) => [category.id, category.name]))),
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
      const accountFilter = normalizeAccountFilter(pending.accountFilter);
      if (existing[0]) {
        await db.update(bankEmailConnections).set({
          walletId: pending.walletId,
          autoImport: pending.autoImport,
          customSenders,
          accountFilter,
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
          accountFilter,
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
      const values = { walletId: pending.walletId, autoImport: pending.autoImport, customSenders: normalizeSenderList(pending.customSenders).join(",") || null, accountFilter: normalizeAccountFilter(pending.accountFilter), accessTokenEncrypted: encryptToken(token.access_token, req.user!.id), refreshTokenEncrypted: token.refresh_token ? encryptToken(token.refresh_token, req.user!.id) : existing[0]?.refreshTokenEncrypted || null, tokenExpiresAt: now + (token.expires_in || 3600), updatedAt: now };
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

  /**
   * Lets an existing connection be re-scoped without going through OAuth again —
   * picking the account to follow should not cost the user a re-authorisation.
   */
  app.patch("/api/bank-inbox/connections/:id", requireAuth, async (req, res, next) => {
    try {
      const input = z.object({
        accountFilter: accountFilterSchema,
        walletId: z.coerce.number().int().positive().optional(),
        autoImport: z.boolean().optional(),
        customSenders: z.string().max(500).optional(),
      }).parse(req.body);

      const id = Number(req.params.id);
      const userId = req.user!.id;
      const [connection] = await db.select().from(bankEmailConnections).where(and(
        eq(bankEmailConnections.id, id),
        eq(bankEmailConnections.userId, userId),
      ));
      if (!connection) return res.status(404).json({ message: "ربط البريد غير موجود" });

      if (input.walletId) {
        const wallet = await storage.getWallet(input.walletId, userId);
        if (!wallet) return res.status(404).json({ message: "المحفظة المحددة غير موجودة" });
      }

      if (input.customSenders !== undefined) {
        const entries = normalizeSenderList(input.customSenders);
        if (resolveAllowedSenders(connection.bankKey as BankKey, entries).length === 0) {
          return res.status(400).json({ message: "اكتب عنوان المرسل الذي يصلك منه إشعار البنك حتى نقرأ رسائله فقط" });
        }
      }

      const [updated] = await db.update(bankEmailConnections).set({
        accountFilter: normalizeAccountFilter(input.accountFilter),
        ...(input.walletId ? { walletId: input.walletId } : {}),
        ...(input.autoImport !== undefined ? { autoImport: input.autoImport } : {}),
        ...(input.customSenders !== undefined ? { customSenders: normalizeSenderList(input.customSenders).join(",") || null } : {}),
        updatedAt: Math.floor(Date.now() / 1000),
      }).where(eq(bankEmailConnections.id, connection.id)).returning({
        id: bankEmailConnections.id,
        accountFilter: bankEmailConnections.accountFilter,
        walletId: bankEmailConnections.walletId,
        autoImport: bankEmailConnections.autoImport,
        customSenders: bankEmailConnections.customSenders,
      });

      res.json(updated);
    } catch (error) { next(error); }
  });

  /**
   * Clears everything this connection imported so the next sync re-reads the same
   * emails with the current parser. Transactions go through storage.deleteTransaction
   * so each one gives its amount back to the wallet instead of leaving the balance short.
   */
  app.post("/api/bank-inbox/connections/:id/reset", requireAuth, async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      const userId = req.user!.id;
      const [connection] = await db.select().from(bankEmailConnections).where(and(
        eq(bankEmailConnections.id, id),
        eq(bankEmailConnections.userId, userId),
      ));
      if (!connection) return res.status(404).json({ message: "ربط البريد غير موجود" });

      const events = await db.select().from(bankEmailEvents).where(and(
        eq(bankEmailEvents.userId, userId),
        eq(bankEmailEvents.connectionId, connection.id),
      ));

      let removedTransactions = 0;
      for (const event of events) {
        // A merged event points at a transaction the user entered themselves; the
        // import only recognised it. Clearing our own imports must not take their
        // records with it.
        if (!event.transactionId || event.status === "merged") continue;
        try {
          await storage.deleteTransaction(event.transactionId, userId);
          removedTransactions += 1;
        } catch (error) {
          console.error(`Failed to delete transaction ${event.transactionId} during bank inbox reset:`, error instanceof Error ? error.message : "unknown error");
        }
      }

      await db.delete(bankEmailEvents).where(and(
        eq(bankEmailEvents.userId, userId),
        eq(bankEmailEvents.connectionId, connection.id),
      ));
      await db.update(bankEmailConnections)
        .set({
          lastSyncAt: null,
          lastSyncAttemptAt: null,
          lastStatus: "idle",
          lastError: null,
          failureCount: 0,
          updatedAt: Math.floor(Date.now() / 1000),
        })
        .where(eq(bankEmailConnections.id, connection.id));

      res.json({ removedEvents: events.length, removedTransactions });
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

      // The correction is the point: remember it for this payee and stop asking.
      const ruleKey = buildRuleKey(event.counterparty, event.merchant);
      let appliedToPending = 0;
      if (ruleKey) {
        const now = Math.floor(Date.now() / 1000);
        await db.insert(bankCategoryRules).values({
          userId,
          matchKey: ruleKey,
          matchLabel: event.counterparty || event.merchant || ruleKey,
          categoryId: input.categoryId ?? null,
          commitmentId: input.commitmentId ?? null,
          updatedAt: now,
        }).onConflictDoUpdate({
          target: [bankCategoryRules.userId, bankCategoryRules.matchKey],
          set: {
            ...(input.categoryId !== undefined ? { categoryId: input.categoryId } : {}),
            ...(input.commitmentId !== undefined ? { commitmentId: input.commitmentId } : {}),
            matchLabel: event.counterparty || event.merchant || ruleKey,
            updatedAt: now,
          },
        });

        // Sibling suggestions from the same payee should follow the decision now,
        // rather than making the user repeat it once per message.
        const siblings = await db.select({ id: bankEmailEvents.id, counterparty: bankEmailEvents.counterparty, merchant: bankEmailEvents.merchant })
          .from(bankEmailEvents)
          .where(and(eq(bankEmailEvents.userId, userId), eq(bankEmailEvents.status, "review")));

        const sameParty = siblings.filter((sibling) => sibling.id !== id && buildRuleKey(sibling.counterparty, sibling.merchant) === ruleKey);
        for (const sibling of sameParty) {
          await db.update(bankEmailEvents).set(input).where(and(eq(bankEmailEvents.id, sibling.id), eq(bankEmailEvents.userId, userId)));
        }
        appliedToPending = sameParty.length;
      }

      res.json({ ...updated, ruleSaved: Boolean(ruleKey), ruleLabel: updated.counterparty || updated.merchant, appliedToPending });
    } catch (error) { next(error); }
  });

  app.get("/api/bank-inbox/rules", requireAuth, async (req, res, next) => {
    try {
      const rules = await db.select().from(bankCategoryRules)
        .where(eq(bankCategoryRules.userId, req.user!.id))
        .orderBy(desc(bankCategoryRules.updatedAt));
      res.json(rules);
    } catch (error) { next(error); }
  });

  app.delete("/api/bank-inbox/rules/:id", requireAuth, async (req, res, next) => {
    try {
      const deleted = await db.delete(bankCategoryRules).where(and(
        eq(bankCategoryRules.id, Number(req.params.id)),
        eq(bankCategoryRules.userId, req.user!.id),
      )).returning({ id: bankCategoryRules.id });
      if (deleted.length === 0) return res.status(404).json({ message: "القاعدة غير موجودة" });
      res.json({ message: "تم حذف القاعدة" });
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

      // Approving a suggestion should still not write a second copy of a payment
      // the user already entered by hand.
      const alreadyRecorded = await findTransactionToReconcile({
        userId: req.user!.id,
        walletId: connection.walletId,
        type: event.transactionType as "income" | "expense",
        amount: event.amount,
        receivedAt: event.receivedAt,
      });
      if (alreadyRecorded) {
        const [merged] = await db.update(bankEmailEvents)
          .set({ status: "merged", transactionId: alreadyRecorded.id })
          .where(eq(bankEmailEvents.id, id))
          .returning();
        if (typeof event.balanceAfter === "number") {
          await storage.updateWallet(connection.walletId, req.user!.id, { balance: event.balanceAfter });
        }
        return res.json(merged);
      }

      const transaction = await storage.createTransaction(req.user!.id, {
        walletId: connection.walletId,
        categoryId: event.categoryId,
        type: event.transactionType,
        amount: event.amount,
        note: `من البريد البنكي · ${event.merchant || "معاملة بنكية"}`,
      }, { allowOverdraft: true, settleBalanceTo: event.balanceAfter });
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
