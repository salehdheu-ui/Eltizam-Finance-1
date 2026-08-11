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

/**
 * Chrome fires `beforeinstallprompt` once, early, and only lets the install
 * dialog be opened from the event object it handed over. Miss it and the app
 * cannot offer installation at all for the rest of the visit.
 */
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

let deferredInstallPrompt: BeforeInstallPromptEvent | null = null;
const installListeners = new Set<() => void>();

function notifyInstallListeners() {
  installListeners.forEach((listener) => listener());
}

// Bound at module scope rather than inside a component: the event usually fires
// before React has mounted anything, and a listener attached later never sees it.
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (event) => {
    // Suppresses Chrome's own mini-infobar so the app can ask in its own words,
    // in Arabic, at a moment that makes sense.
    event.preventDefault();
    deferredInstallPrompt = event as BeforeInstallPromptEvent;
    notifyInstallListeners();
  });

  window.addEventListener("appinstalled", () => {
    deferredInstallPrompt = null;
    notifyInstallListeners();
  });
}

export function subscribeToInstallAvailability(listener: () => void) {
  installListeners.add(listener);
  return () => { installListeners.delete(listener); };
}

/** True once Chrome has offered the install dialog and it has not been used yet. */
export function canPromptInstall() {
  return deferredInstallPrompt !== null;
}

/**
 * iOS has no install API at all — Safari installs only through the share sheet —
 * so those users get instructions instead of a button that cannot exist.
 * iPadOS reports itself as a Mac, hence the touch check.
 */
export function isIosDevice() {
  const agent = window.navigator.userAgent;
  return /iphone|ipad|ipod/i.test(agent)
    || (/macintosh/i.test(agent) && window.navigator.maxTouchPoints > 1);
}

export type InstallOutcome = "accepted" | "dismissed" | "unavailable";

export async function promptInstall(): Promise<InstallOutcome> {
  if (!deferredInstallPrompt) return "unavailable";

  try {
    await deferredInstallPrompt.prompt();
    const { outcome } = await deferredInstallPrompt.userChoice;
    // The event is single-use; Chrome fires a fresh one if the user declines and
    // becomes eligible again.
    deferredInstallPrompt = null;
    notifyInstallListeners();
    return outcome;
  } catch {
    deferredInstallPrompt = null;
    notifyInstallListeners();
    return "unavailable";
  }
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
