/**
 * Service worker registration and push subscription plumbing.
 *
 * Nothing here ever throws at the caller. An install that cannot register a
 * service worker, a browser without push, a user who declines the permission —
 * all of these are ordinary states for a web app, and none of them should break
 * the page that asked.
 */

const SERVICE_WORKER_URL = "/sw.js";

export function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches
    // iOS reports installed apps through a non-standard flag instead.
    || (window.navigator as { standalone?: boolean }).standalone === true;
}

export function supportsPush() {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

export function notificationPermission(): NotificationPermission | "unsupported" {
  if (!("Notification" in window)) return "unsupported";
  return Notification.permission;
}

export async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return null;

  try {
    const registration = await navigator.serviceWorker.register(SERVICE_WORKER_URL, { scope: "/" });

    // A tab left open for days would otherwise keep running the worker it started
    // with, and never notice a deploy.
    setInterval(() => { void registration.update(); }, 60 * 60 * 1000);

    return registration;
  } catch (error) {
    console.warn("Service worker registration failed:", error);
    return null;
  }
}

/** VAPID keys travel as base64url but `subscribe` wants raw bytes. */
function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  const bytes = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index += 1) {
    bytes[index] = raw.charCodeAt(index);
  }
  return bytes;
}

export type PushEnableResult =
  | { state: "enabled" }
  | { state: "denied" }
  | { state: "unsupported" }
  | { state: "failed"; message: string };

/**
 * Asks for permission, subscribes with the server's VAPID key, and registers the
 * subscription. The permission prompt is only ever reached from an explicit user
 * action — browsers penalise sites that ask on load, and so do users.
 */
export async function enablePushNotifications(publicKey: string): Promise<PushEnableResult> {
  if (!supportsPush()) return { state: "unsupported" };

  try {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") return { state: "denied" };

    const registration = (await navigator.serviceWorker.getRegistration()) || (await registerServiceWorker());
    if (!registration) return { state: "failed", message: "تعذر تشغيل خدمة الإشعارات في هذا المتصفح" };

    await navigator.serviceWorker.ready;

    // An existing subscription is reused; re-subscribing would hand the server a
    // second endpoint for one device and double every notification.
    const existing = await registration.pushManager.getSubscription();
    const subscription = existing ?? (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    }));

    const response = await fetch("/api/push/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ subscription: subscription.toJSON() }),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({ message: "" }));
      return { state: "failed", message: body.message || "تعذر حفظ الاشتراك على الخادم" };
    }

    return { state: "enabled" };
  } catch (error) {
    return { state: "failed", message: error instanceof Error ? error.message : "تعذر تفعيل الإشعارات" };
  }
}

export async function disablePushNotifications() {
  if (!("serviceWorker" in navigator)) return;

  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) return;

  // Told to the server first: a subscription dropped locally but left on the
  // server would keep receiving pushes that land nowhere.
  await fetch("/api/push/unsubscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ endpoint: subscription.endpoint }),
  }).catch(() => undefined);

  await subscription.unsubscribe().catch(() => undefined);
}

export async function hasLocalSubscription() {
  if (!("serviceWorker" in navigator)) return false;
  const registration = await navigator.serviceWorker.getRegistration();
  return Boolean(await registration?.pushManager.getSubscription());
}
