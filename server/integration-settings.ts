import type { Request } from "express";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import { eq } from "drizzle-orm";
import { integrationSettings } from "@shared/schema";
import { db } from "./db";

export type IntegrationProvider = "google" | "microsoft";

export const INTEGRATION_PROVIDERS: IntegrationProvider[] = ["google", "microsoft"];

export const PROVIDER_LABELS: Record<IntegrationProvider, string> = {
  google: "Gmail (Google)",
  microsoft: "Outlook (Microsoft)",
};

export const PROVIDER_CALLBACK_PATHS: Record<IntegrationProvider, string> = {
  google: "/api/bank-inbox/google/callback",
  microsoft: "/api/bank-inbox/microsoft/callback",
};

export type ProviderConfig = {
  provider: IntegrationProvider;
  clientId: string;
  clientSecret: string;
  tenantId: string | null;
  redirectUri: string | null;
  source: "database" | "environment";
};

const CACHE_TTL_MS = 30_000;
const cache = new Map<IntegrationProvider, { value: ProviderConfig | null; expiresAt: number }>();

function settingsKey() {
  const secret = process.env.TOKEN_ENCRYPTION_KEY || process.env.SESSION_SECRET;
  if (!secret) throw new Error("TOKEN_ENCRYPTION_KEY or SESSION_SECRET is required");
  return createHash("sha256").update(`${secret}:integration-settings`).digest();
}

export function encryptSecret(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", settingsKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
}

export function decryptSecret(value: string | null | undefined) {
  if (!value) return null;
  const [iv, tag, encrypted] = value.split(".");
  if (!iv || !tag || !encrypted) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", settingsKey(), Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(encrypted, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

function environmentConfig(provider: IntegrationProvider): ProviderConfig | null {
  if (provider === "google") {
    const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
    if (!clientId || !clientSecret) return null;
    return {
      provider,
      clientId,
      clientSecret,
      tenantId: null,
      redirectUri: process.env.GOOGLE_REDIRECT_URI?.trim() || null,
      source: "environment",
    };
  }

  const clientId = process.env.MICROSOFT_CLIENT_ID?.trim();
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  return {
    provider,
    clientId,
    clientSecret,
    tenantId: process.env.MICROSOFT_TENANT_ID?.trim() || null,
    redirectUri: process.env.MICROSOFT_REDIRECT_URI?.trim() || null,
    source: "environment",
  };
}

export function invalidateProviderCache(provider?: IntegrationProvider) {
  if (provider) {
    cache.delete(provider);
    return;
  }
  cache.clear();
}

export async function getIntegrationRecord(provider: IntegrationProvider) {
  const [record] = await db.select().from(integrationSettings).where(eq(integrationSettings.provider, provider));
  return record ?? null;
}

/**
 * Resolves the credentials used for a provider. An admin-saved record is the source
 * of truth once it exists: enabled means use it, disabled means the provider is off
 * for everyone. Only when no record exists do we fall back to the environment
 * variables the deployment already had.
 */
export async function getProviderConfig(provider: IntegrationProvider): Promise<ProviderConfig | null> {
  const cached = cache.get(provider);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  let value: ProviderConfig | null = null;
  try {
    const record = await getIntegrationRecord(provider);
    if (record) {
      const clientSecret = record.isEnabled ? decryptSecret(record.clientSecretEncrypted) : null;
      value = clientSecret && record.clientId
        ? {
            provider,
            clientId: record.clientId,
            clientSecret,
            tenantId: record.tenantId || null,
            redirectUri: record.redirectUri || null,
            source: "database",
          }
        : null;
    } else {
      value = environmentConfig(provider);
    }
  } catch (error) {
    console.error(`Failed to read integration settings for ${provider}:`, error instanceof Error ? error.message : "unknown error");
    value = environmentConfig(provider);
  }

  cache.set(provider, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  return value;
}

export async function isProviderConfigured(provider: IntegrationProvider) {
  return Boolean(await getProviderConfig(provider));
}

export function resolveAppBaseUrl(req: Request) {
  const configured = process.env.PUBLIC_APP_URL?.trim().replace(/\/$/, "");
  if (configured) return configured;
  const protocol = (req.get("x-forwarded-proto") || req.protocol).split(",")[0].trim();
  return `${protocol}://${req.get("host")}`;
}

export function resolveRedirectUri(req: Request, provider: IntegrationProvider, config: ProviderConfig | null) {
  return config?.redirectUri || `${resolveAppBaseUrl(req)}${PROVIDER_CALLBACK_PATHS[provider]}`;
}

export function maskSecret(secret: string | null) {
  if (!secret) return null;
  if (secret.length <= 8) return "•".repeat(secret.length);
  return `${secret.slice(0, 3)}${"•".repeat(Math.min(12, secret.length - 6))}${secret.slice(-3)}`;
}

export type CredentialTestResult = { ok: boolean; message: string };

/**
 * Probes the provider's token endpoint with a deliberately invalid grant. A wrong
 * client id/secret fails with a client error, while correct credentials fail with a
 * grant error — which is exactly what tells us the credentials themselves are good.
 */
export async function testProviderCredentials(config: ProviderConfig): Promise<CredentialTestResult> {
  try {
    if (config.provider === "google") {
      const response = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: config.clientId,
          client_secret: config.clientSecret,
          refresh_token: "eltizam-credential-probe",
          grant_type: "refresh_token",
        }),
      });
      const payload = await response.json().catch(() => ({})) as { error?: string; error_description?: string };
      if (payload.error === "invalid_client") {
        return { ok: false, message: "المفاتيح مرفوضة من Google. تأكد من Client ID و Client Secret." };
      }
      if (payload.error === "invalid_grant" || response.ok) {
        return { ok: true, message: "المفاتيح مقبولة من Google. تبقّى تسجيل رابط إعادة التوجيه في Google Cloud Console." };
      }
      return { ok: false, message: `رد غير متوقع من Google: ${payload.error || response.status}` };
    }

    const tenant = config.tenantId || "common";
    const response = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        refresh_token: "eltizam-credential-probe",
        grant_type: "refresh_token",
        scope: "openid email offline_access User.Read Mail.Read",
      }),
    });
    const payload = await response.json().catch(() => ({})) as { error?: string; error_description?: string };
    const description = payload.error_description || "";

    if (description.includes("AADSTS700016") || description.includes("AADSTS900023")) {
      return { ok: false, message: "Microsoft لا تعرف هذا التطبيق. راجع Client ID و Tenant ID." };
    }
    if (description.includes("AADSTS7000215") || description.includes("AADSTS7000222")) {
      return { ok: false, message: "المفتاح السري (Client Secret) خاطئ أو منتهي الصلاحية." };
    }
    if (payload.error === "invalid_client") {
      return { ok: false, message: "المفاتيح مرفوضة من Microsoft. تأكد من Client ID و Client Secret." };
    }
    if (payload.error === "invalid_grant" || response.ok) {
      return { ok: true, message: "المفاتيح مقبولة من Microsoft. تبقّى تسجيل رابط إعادة التوجيه في Azure Portal." };
    }
    return { ok: false, message: `رد غير متوقع من Microsoft: ${payload.error || response.status}` };
  } catch (error) {
    return { ok: false, message: `تعذر الاتصال بخادم المزوّد: ${error instanceof Error ? error.message : "خطأ غير معروف"}` };
  }
}
