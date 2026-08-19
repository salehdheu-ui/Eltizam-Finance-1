import webpush from "web-push";
import { and, eq } from "drizzle-orm";
import {
  inAppNotifications,
  notificationDeliveries,
  notificationPreferences,
  pushSubscriptions,
  users,
} from "@shared/schema";
import { db } from "./db";
import { resolvePushConfig } from "./channel-settings";
import { sendPlainEmail } from "./mail";

export type NotificationChannel = "email" | "push" | "telegram" | "whatsapp" | "webhook";

export type Notification = {
  userId: number;
  title: string;
  body: string;
  /** Stable per logical event, so a retry or a second engine pass cannot notify twice. */
  dedupeKey: string;
  url?: string;
  /** Bypasses quiet hours. For things the user asked to be interrupted for. */
  urgent?: boolean;
};

function now() {
  return Math.floor(Date.now() / 1000);
}

export async function getPreferences(userId: number) {
  const [existing] = await db.select().from(notificationPreferences)
    .where(eq(notificationPreferences.userId, userId));
  if (existing) return existing;

  const [created] = await db.insert(notificationPreferences)
    .values({ userId })
    .onConflictDoNothing()
    .returning();

  if (created) return created;
  const [raced] = await db.select().from(notificationPreferences)
    .where(eq(notificationPreferences.userId, userId));
  return raced;
}

/**
 * Quiet hours may wrap past midnight (22:00 to 07:00), so the inside test flips
 * depending on whether the window crosses the day boundary.
 */
export function isQuietNow(start: number | null, end: number | null, hour = new Date().getHours()) {
  if (start === null || end === null || start === end) return false;
  return start < end ? hour >= start && hour < end : hour >= start || hour < end;
}

/**
 * VAPID keys identify this server to the push services. They are applied on
 * every send rather than latched once: the keys are editable from the admin
 * screen, and a latched pair would keep signing with credentials the operator
 * has already replaced.
 */
async function ensureVapid() {
  const config = await resolvePushConfig();
  if (!config) return false;

  webpush.setVapidDetails(config.subject, config.publicKey, config.privateKey);
  return true;
}

export function generateVapidKeys() {
  return webpush.generateVAPIDKeys();
}

export async function saveInAppNotification(notification: Notification) {
  const [created] = await db.insert(inAppNotifications).values({
    userId: notification.userId,
    title: notification.title,
    body: notification.body,
    url: notification.url ?? null,
    dedupeKey: notification.dedupeKey,
  }).onConflictDoNothing().returning();

  return created ?? null;
}

export async function getPublicVapidKey() {
  const config = await resolvePushConfig();
  return config?.publicKey ?? null;
}

async function deliverPush(notification: Notification) {
  if (!(await ensureVapid())) {
    throw new Error("مفاتيح Push غير مهيّأة — اضبطها من صفحة الإدارة");
  }

  const subscriptions = await db.select().from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, notification.userId));
  if (subscriptions.length === 0) throw new Error("لا يوجد جهاز مشترك");

  const payload = JSON.stringify({
    title: notification.title,
    body: notification.body,
    url: notification.url || "/commitments",
  });

  let delivered = 0;
  for (const subscription of subscriptions) {
    try {
      await webpush.sendNotification({
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth },
      }, payload);
      delivered += 1;
    } catch (error) {
      // 404/410 mean the browser threw the subscription away; keeping it would
      // make every future send fail against a device that no longer exists.
      const statusCode = (error as { statusCode?: number }).statusCode;
      if (statusCode === 404 || statusCode === 410) {
        await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, subscription.id));
      }
    }
  }

  if (delivered === 0) throw new Error("تعذر التسليم لأي جهاز");
}

async function deliverEmail(notification: Notification) {
  const [user] = await db.select({ email: users.email, name: users.name })
    .from(users).where(eq(users.id, notification.userId));
  if (!user?.email) throw new Error("لا يوجد بريد للمستخدم");

  await sendPlainEmail({
    to: user.email,
    subject: notification.title,
    text: notification.body,
  });
}

async function deliverTelegram(notification: Notification, chatId: string | null) {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) throw new Error("لم تُضبط مفاتيح Telegram");
  if (!chatId) throw new Error("لم يُربط حساب Telegram");

  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: `*${notification.title}*\n${notification.body}`,
      parse_mode: "Markdown",
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Telegram رفض الإرسال: ${detail.slice(0, 120)}`);
  }
}

async function deliverWhatsapp(notification: Notification, number: string | null) {
  const token = process.env.WHATSAPP_TOKEN?.trim();
  const phoneId = process.env.WHATSAPP_PHONE_ID?.trim();
  if (!token || !phoneId) throw new Error("لم تُضبط مفاتيح WhatsApp");
  if (!number) throw new Error("لم يُضبط رقم WhatsApp");

  const response = await fetch(`https://graph.facebook.com/v21.0/${phoneId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: number.replace(/\D/g, ""),
      type: "text",
      text: { body: `${notification.title}\n${notification.body}` },
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`WhatsApp رفض الإرسال: ${detail.slice(0, 120)}`);
  }
}

async function deliverWebhook(notification: Notification, url: string | null) {
  if (!url) throw new Error("لم يُضبط رابط Webhook");

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      event: "eltizam.notification",
      title: notification.title,
      body: notification.body,
      url: notification.url ?? null,
      dedupeKey: notification.dedupeKey,
      at: new Date().toISOString(),
    }),
  });

  if (!response.ok) throw new Error(`Webhook رد بالرمز ${response.status}`);
}

/**
 * Sends on every channel the user has turned on. The delivery row is claimed
 * first: the unique key on (user, channel, dedupe) is what makes a second pass
 * a no-op rather than a duplicate reminder.
 */
export async function notify(notification: Notification, options: { skipInApp?: boolean } = {}) {
  const inApp = options.skipInApp ? null : await saveInAppNotification(notification);
  const preferences = await getPreferences(notification.userId);
  if (!preferences) return { inApp: Boolean(inApp), sent: [] as NotificationChannel[], skipped: ["no-preferences"] };

  if (!notification.urgent && isQuietNow(preferences.quietHoursStart, preferences.quietHoursEnd)) {
    return { inApp: Boolean(inApp), sent: [] as NotificationChannel[], skipped: ["quiet-hours"] };
  }

  const wanted: Array<[NotificationChannel, boolean, () => Promise<void>]> = [
    ["push", preferences.pushEnabled, () => deliverPush(notification)],
    ["email", preferences.emailEnabled, () => deliverEmail(notification)],
    ["telegram", preferences.telegramEnabled, () => deliverTelegram(notification, preferences.telegramChatId)],
    ["whatsapp", preferences.whatsappEnabled, () => deliverWhatsapp(notification, preferences.whatsappNumber)],
    ["webhook", Boolean(preferences.webhookUrl), () => deliverWebhook(notification, preferences.webhookUrl)],
  ];

  const sent: NotificationChannel[] = [];
  const failed: string[] = [];

  for (const [channel, enabled, deliver] of wanted) {
    if (!enabled) continue;

    const [claim] = await db.insert(notificationDeliveries).values({
      userId: notification.userId,
      channel,
      dedupeKey: notification.dedupeKey,
      title: notification.title,
      body: notification.body,
    }).onConflictDoNothing().returning();

    if (!claim) continue;

    try {
      await deliver();
      await db.update(notificationDeliveries)
        .set({ status: "sent", sentAt: now() })
        .where(eq(notificationDeliveries.id, claim.id));
      sent.push(channel);
    } catch (error) {
      const message = error instanceof Error ? error.message : "خطأ غير معروف";
      await db.update(notificationDeliveries)
        .set({ status: "failed", error: message.slice(0, 300) })
        .where(eq(notificationDeliveries.id, claim.id));
      failed.push(`${channel}: ${message}`);
    }
  }

  return { inApp: Boolean(inApp), sent, skipped: failed };
}

export async function savePushSubscription(userId: number, subscription: {
  endpoint: string; keys: { p256dh: string; auth: string };
}) {
  await db.insert(pushSubscriptions).values({
    userId,
    endpoint: subscription.endpoint,
    p256dh: subscription.keys.p256dh,
    auth: subscription.keys.auth,
  }).onConflictDoUpdate({
    target: pushSubscriptions.endpoint,
    set: { userId, p256dh: subscription.keys.p256dh, auth: subscription.keys.auth },
  });
}

export async function removePushSubscription(userId: number, endpoint: string) {
  await db.delete(pushSubscriptions).where(and(
    eq(pushSubscriptions.userId, userId),
    eq(pushSubscriptions.endpoint, endpoint),
  ));
}
