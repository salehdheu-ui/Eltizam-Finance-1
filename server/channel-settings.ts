import { eq } from "drizzle-orm";
import { channelSettings } from "@shared/schema";
import { db } from "./db";
import { decryptSecret, encryptSecret } from "./integration-settings";

/**
 * Delivery credentials for the notification channels. Both channels used to be
 * environment-only, which left them unconfigurable on a deployment where the
 * operator cannot set environment variables — the admin screen could set up
 * Gmail and Outlook but not the two channels the notifications actually go out
 * on. An admin-saved row is authoritative once it exists; the environment stays
 * the fallback so an existing deployment keeps working untouched.
 */
export type NotificationChannelKey = "email" | "push" | "n8n";

export const NOTIFICATION_CHANNEL_KEYS: NotificationChannelKey[] = ["email", "push", "n8n"];

export type MailConfig = {
  host: string;
  port: number;
  secure: boolean;
  requireAuth: boolean;
  user: string;
  pass: string;
  from: string;
  source: "database" | "environment";
};

export type PushConfig = {
  publicKey: string;
  privateKey: string;
  subject: string;
  source: "database" | "environment";
};

/**
 * Outgoing webhook into an n8n workflow.
 *
 * Admin-managed rather than per-user: it is one automation endpoint for the
 * whole deployment, so it sits beside the other channels an admin configures
 * and never shows up in the settings a normal user can reach.
 */
export type N8nConfig = {
  webhookUrl: string;
  /** Optional header n8n checks on the way in, e.g. a header auth credential. */
  authHeaderName: string;
  authToken: string;
  source: "database" | "environment";
};

type StoredEmailConfig = Omit<MailConfig, "source">;
type StoredPushConfig = Omit<PushConfig, "source">;
type StoredN8nConfig = Omit<N8nConfig, "source">;

const CACHE_TTL_MS = 30_000;
const cache = new Map<NotificationChannelKey, { value: unknown; expiresAt: number }>();

export function invalidateChannelCache(channel?: NotificationChannelKey) {
  if (channel) {
    cache.delete(channel);
    return;
  }
  cache.clear();
}

export async function getChannelRecord(channel: NotificationChannelKey) {
  const [record] = await db.select().from(channelSettings).where(eq(channelSettings.channel, channel));
  return record ?? null;
}

/** Reads the stored config regardless of the enabled flag — the admin form has to
 *  show what is saved even while the channel is switched off. */
export async function readStoredConfig<T>(channel: NotificationChannelKey): Promise<T | null> {
  const record = await getChannelRecord(channel);
  if (!record) return null;
  const decrypted = decryptSecret(record.configEncrypted);
  if (!decrypted) return null;
  try {
    return JSON.parse(decrypted) as T;
  } catch {
    return null;
  }
}

export async function saveChannelConfig(
  channel: NotificationChannelKey,
  config: StoredEmailConfig | StoredPushConfig | StoredN8nConfig,
  options: { isEnabled: boolean; updatedByUserId?: number },
) {
  const now = Math.floor(Date.now() / 1000);
  const values = {
    configEncrypted: encryptSecret(JSON.stringify(config)),
    isEnabled: options.isEnabled,
    updatedByUserId: options.updatedByUserId ?? null,
    updatedAt: now,
  };

  const existing = await getChannelRecord(channel);
  if (existing) {
    await db.update(channelSettings).set(values).where(eq(channelSettings.channel, channel));
  } else {
    await db.insert(channelSettings).values({ channel, ...values });
  }

  invalidateChannelCache(channel);
}

export async function deleteChannelConfig(channel: NotificationChannelKey) {
  await db.delete(channelSettings).where(eq(channelSettings.channel, channel));
  invalidateChannelCache(channel);
}

function environmentMailConfig(): MailConfig | null {
  const host = process.env.SMTP_HOST?.trim() || "";
  if (!host) return null;

  const requireAuth = process.env.SMTP_REQUIRE_AUTH !== "false";
  const user = process.env.SMTP_USER?.trim() || "";
  const pass = process.env.SMTP_PASS?.trim() || "";
  const from = process.env.SMTP_FROM?.trim() || user;
  if (requireAuth && (!user || !pass)) return null;
  if (!from) return null;

  return {
    host,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === "true",
    requireAuth,
    user,
    pass,
    from,
    source: "environment",
  };
}

function environmentPushConfig(): PushConfig | null {
  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  if (!publicKey || !privateKey) return null;

  return {
    publicKey,
    privateKey,
    subject: process.env.VAPID_SUBJECT?.trim() || "mailto:admin@eltizam.app",
    source: "environment",
  };
}

async function resolve<T extends { source: "database" | "environment" }>(
  channel: NotificationChannelKey,
  fromStored: (stored: Record<string, unknown>) => T | null,
  fromEnvironment: () => T | null,
): Promise<T | null> {
  const cached = cache.get(channel);
  if (cached && cached.expiresAt > Date.now()) return cached.value as T | null;

  let value: T | null = null;
  try {
    const record = await getChannelRecord(channel);
    if (record) {
      // A saved-but-disabled channel means off for everyone, not fall back.
      if (record.isEnabled) {
        const decrypted = decryptSecret(record.configEncrypted);
        const parsed = decrypted ? (JSON.parse(decrypted) as Record<string, unknown>) : null;
        value = parsed ? fromStored(parsed) : null;
      }
    } else {
      value = fromEnvironment();
    }
  } catch (error) {
    console.error(`Failed to read channel settings for ${channel}:`, error instanceof Error ? error.message : "unknown error");
    value = fromEnvironment();
  }

  cache.set(channel, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  return value;
}

export function resolveMailConfig(): Promise<MailConfig | null> {
  return resolve<MailConfig>("email", (stored) => {
    const host = String(stored.host || "").trim();
    const requireAuth = stored.requireAuth !== false;
    const user = String(stored.user || "").trim();
    const pass = String(stored.pass || "");
    const from = String(stored.from || "").trim() || user;
    if (!host || !from) return null;
    if (requireAuth && (!user || !pass)) return null;

    return {
      host,
      port: Number(stored.port) || 587,
      secure: Boolean(stored.secure),
      requireAuth,
      user,
      pass,
      from,
      source: "database",
    };
  }, environmentMailConfig);
}

export function resolvePushConfig(): Promise<PushConfig | null> {
  return resolve<PushConfig>("push", (stored) => {
    const publicKey = String(stored.publicKey || "").trim();
    const privateKey = String(stored.privateKey || "").trim();
    if (!publicKey || !privateKey) return null;

    return {
      publicKey,
      privateKey,
      subject: String(stored.subject || "").trim() || "mailto:admin@eltizam.app",
      source: "database",
    };
  }, environmentPushConfig);
}

function environmentN8nConfig(): N8nConfig | null {
  const webhookUrl = process.env.N8N_WEBHOOK_URL?.trim() || "";
  if (!webhookUrl) return null;

  return {
    webhookUrl,
    authHeaderName: process.env.N8N_AUTH_HEADER?.trim() || "",
    authToken: process.env.N8N_AUTH_TOKEN?.trim() || "",
    source: "environment",
  };
}

export function resolveN8nConfig(): Promise<N8nConfig | null> {
  return resolve<N8nConfig>("n8n", (stored) => {
    const webhookUrl = String(stored.webhookUrl || "").trim();
    if (!webhookUrl) return null;

    return {
      webhookUrl,
      authHeaderName: String(stored.authHeaderName || "").trim(),
      authToken: String(stored.authToken || ""),
      source: "database",
    };
  }, environmentN8nConfig);
}
