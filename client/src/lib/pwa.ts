/**
 * Service worker registration and install-prompt plumbing.
 *
 * Push subscription lives in components/notification-settings.tsx alongside the
 * rest of the notification channels; this file only gets the worker registered
 * so that push — and offline loading — have something to run in.
 *
 * Nothing here ever throws at the caller. A browser that cannot register a
 * service worker, or one that never offers installation, are ordinary states for
 * a web app and neither should break the page that asked.
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
