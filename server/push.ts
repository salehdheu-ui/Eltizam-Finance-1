import type { Express, NextFunction, Request, Response } from "express";
import webpush from "web-push";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { notificationPreferences, pushSubscriptions } from "@shared/schema";
import { db } from "./db";

/**
 * Web push delivery.
 *
 * Notifications are best-effort by design: a push that cannot be delivered must
 * never fail the action that triggered it. Importing a bank transaction is the
 * real work; telling the user about it is a courtesy, and a dead subscription or
 * an unreachable push service is not a reason to fail the import.
 */

export type NotificationTopic = "bankImports" | "bankReviews" | "balanceGaps";

export type PushMessage = {
  title: string;
  body: string;
  url?: string;
  tag?: string;
};

const subscriptionSchema = z.object({
  subscription: z.object({
    endpoint: z.string().url().max(1000),
    keys: z.object({
      p256dh: z.string().min(1).max(300),
      auth: z.string().min(1).max(300),
    }),
  }),
});

const preferencesSchema = z.object({
  bankImports: z.boolean().optional(),
  bankReviews: z.boolean().optional(),
  balanceGaps: z.boolean().optional(),
});

let configuredPublicKey: string | null = null;

/**
 * Push needs a VAPID key pair to identify this server to the browser's push
 * service. Without one the feature stays switched off rather than half-working:
 * the client asks whether push is available before offering to turn it on, so an
 * unconfigured deployment simply never shows the option.
 */
export function configurePushNotifications() {
  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  const subject = process.env.VAPID_SUBJECT?.trim() || process.env.APP_BASE_URL?.trim() || "";

  if (!publicKey || !privateKey) {
    console.warn("Push notifications are disabled: set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY to enable them.");
    return;
  }

  // The spec wants a contact the push service can reach; a bare origin is not
  // one, so fall back to a mailto rather than sending something invalid.
  const contact = subject.startsWith("mailto:") || subject.startsWith("https://")
    ? subject
    : "mailto:admin@eltizam.app";

  try {
    webpush.setVapidDetails(contact, publicKey, privateKey);
    configuredPublicKey = publicKey;
  } catch (error) {
    console.error("Push notifications are disabled: VAPID keys were rejected —", error instanceof Error ? error.message : "unknown error");
  }
}

export function isPushConfigured() {
  return configuredPublicKey !== null;
}

async function getPreferences(userId: number) {
  const [row] = await db.select().from(notificationPreferences).where(eq(notificationPreferences.userId, userId));
  // No row means the user never changed anything, which is not the same as
  // having opted out of everything.
  return row ?? { userId, bankImports: true, bankReviews: true, balanceGaps: true, updatedAt: 0 };
}

/**
 * A subscription the push service rejects as gone is dead for good — the browser
 * was uninstalled, or the user cleared site data. Keeping it means retrying it on
 * every notification forever, so it is removed on the spot. Any other failure is
 * counted but kept, since it may just be a transient outage.
 */
async function discardOrCountFailure(subscriptionId: number, statusCode: number | undefined) {
  if (statusCode === 404 || statusCode === 410) {
    await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, subscriptionId));
    return;
  }
  const [row] = await db.select({ failureCount: pushSubscriptions.failureCount })
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.id, subscriptionId));
  if (!row) return;
  await db.update(pushSubscriptions)
    .set({ failureCount: row.failureCount + 1 })
    .where(eq(pushSubscriptions.id, subscriptionId));
}

/**
 * Sends to every device the user has registered. Never throws: callers are in the
 * middle of doing the user's actual work.
 */
export async function sendPushToUser(userId: number, topic: NotificationTopic, message: PushMessage) {
  if (!isPushConfigured()) return { sent: 0, failed: 0 };

  try {
    const preferences = await getPreferences(userId);
    if (!preferences[topic]) return { sent: 0, failed: 0 };

    const subscriptions = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId));
    if (subscriptions.length === 0) return { sent: 0, failed: 0 };

    const payload = JSON.stringify({
      title: message.title,
      body: message.body,
      url: message.url || "/",
      tag: message.tag || topic,
    });

    let sent = 0;
    let failed = 0;

    await Promise.all(subscriptions.map(async (subscription) => {
      try {
        await webpush.sendNotification(
          { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
          payload,
          { TTL: 12 * 3600 },
        );
        sent += 1;
        await db.update(pushSubscriptions)
          .set({ lastUsedAt: Math.floor(Date.now() / 1000), failureCount: 0 })
          .where(eq(pushSubscriptions.id, subscription.id));
      } catch (error) {
        failed += 1;
        await discardOrCountFailure(subscription.id, (error as { statusCode?: number }).statusCode);
      }
    }));

    return { sent, failed };
  } catch (error) {
    console.error(`Failed to send push notification to user ${userId}:`, error instanceof Error ? error.message : "unknown error");
    return { sent: 0, failed: 0 };
  }
}

function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.isAuthenticated()) return res.status(401).json({ message: "غير مسجل الدخول" });
  next();
}

export function registerPushRoutes(app: Express) {
  app.get("/api/push/config", requireAuth, async (req, res, next) => {
    try {
      res.json({
        configured: isPushConfigured(),
        publicKey: configuredPublicKey,
        preferences: await getPreferences(req.user!.id),
        deviceCount: (await db.select({ id: pushSubscriptions.id })
          .from(pushSubscriptions)
          .where(eq(pushSubscriptions.userId, req.user!.id))).length,
      });
    } catch (error) { next(error); }
  });

  app.post("/api/push/subscribe", requireAuth, async (req, res, next) => {
    try {
      if (!isPushConfigured()) {
        return res.status(503).json({ message: "الإشعارات غير مفعّلة على الخادم بعد" });
      }
      const { subscription } = subscriptionSchema.parse(req.body);
      const now = Math.floor(Date.now() / 1000);

      // Keyed on the endpoint so re-enabling on the same device replaces its row
      // rather than adding a second one that would double every notification.
      await db.insert(pushSubscriptions).values({
        userId: req.user!.id,
        endpoint: subscription.endpoint,
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
        userAgent: String(req.get("user-agent") || "").slice(0, 300),
        lastUsedAt: now,
      }).onConflictDoUpdate({
        target: pushSubscriptions.endpoint,
        set: {
          userId: req.user!.id,
          p256dh: subscription.keys.p256dh,
          auth: subscription.keys.auth,
          failureCount: 0,
          lastUsedAt: now,
        },
      });

      res.json({ message: "تم تفعيل الإشعارات على هذا الجهاز" });
    } catch (error) { next(error); }
  });

  app.post("/api/push/unsubscribe", requireAuth, async (req, res, next) => {
    try {
      const endpoint = z.object({ endpoint: z.string().max(1000) }).parse(req.body).endpoint;
      await db.delete(pushSubscriptions).where(and(
        eq(pushSubscriptions.userId, req.user!.id),
        eq(pushSubscriptions.endpoint, endpoint),
      ));
      res.json({ message: "تم إيقاف الإشعارات على هذا الجهاز" });
    } catch (error) { next(error); }
  });

  app.patch("/api/push/preferences", requireAuth, async (req, res, next) => {
    try {
      const input = preferencesSchema.parse(req.body);
      const now = Math.floor(Date.now() / 1000);
      const [saved] = await db.insert(notificationPreferences)
        .values({ userId: req.user!.id, ...input, updatedAt: now })
        .onConflictDoUpdate({
          target: notificationPreferences.userId,
          set: { ...input, updatedAt: now },
        })
        .returning();
      res.json(saved);
    } catch (error) { next(error); }
  });

  /** Lets the user confirm the whole chain works instead of waiting for a real event. */
  app.post("/api/push/test", requireAuth, async (req, res, next) => {
    try {
      if (!isPushConfigured()) {
        return res.status(503).json({ message: "الإشعارات غير مفعّلة على الخادم بعد" });
      }
      const devices = await db.select({ id: pushSubscriptions.id })
        .from(pushSubscriptions)
        .where(eq(pushSubscriptions.userId, req.user!.id));
      if (devices.length === 0) {
        return res.status(400).json({ message: "لم يتم تفعيل الإشعارات على أي جهاز بعد" });
      }

      // Deliberately bypasses the topic preferences: this is the user asking to be
      // notified right now, not a category they may have switched off.
      const payload = JSON.stringify({
        title: "التزام",
        body: "الإشعارات تعمل بنجاح ✅",
        url: "/settings",
        tag: "eltizam-test",
      });
      const subscriptions = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, req.user!.id));
      let sent = 0;
      await Promise.all(subscriptions.map(async (subscription) => {
        try {
          await webpush.sendNotification(
            { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
            payload,
            { TTL: 60 },
          );
          sent += 1;
        } catch (error) {
          await discardOrCountFailure(subscription.id, (error as { statusCode?: number }).statusCode);
        }
      }));

      if (sent === 0) {
        return res.status(502).json({ message: "تعذر إرسال الإشعار. جرّب إيقاف الإشعارات وتفعيلها من جديد." });
      }
      res.json({ message: `تم إرسال إشعار تجريبي إلى ${sent} جهاز` });
    } catch (error) { next(error); }
  });
}
