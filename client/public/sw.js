/* eslint-env serviceworker */

/**
 * Service worker for التزام.
 *
 * Two jobs: keep the app openable without a connection, and receive push
 * notifications when the app is closed.
 *
 * The caching rules are deliberately conservative for a finance app. Balances,
 * transactions and anything else under /api are never served from a cache —
 * showing a stale balance as if it were current is worse than showing nothing,
 * because the number looks authoritative and the user acts on it. Only the shell
 * (HTML, hashed assets, icons) is cached, so the app opens offline and then says
 * plainly that it cannot reach the server.
 */

const VERSION = "v1";
const SHELL_CACHE = `eltizam-shell-${VERSION}`;
const ASSET_CACHE = `eltizam-assets-${VERSION}`;

// Enough to render the app frame; everything else arrives through runtime caching.
const SHELL_URLS = ["/", "/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      // A single missing entry must not fail the whole install, or one renamed
      // icon leaves the app with no service worker — and with it no push.
      .then((cache) => Promise.allSettled(SHELL_URLS.map((url) => cache.add(url))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key.startsWith("eltizam-") && key !== SHELL_CACHE && key !== ASSET_CACHE)
          .map((key) => caches.delete(key)),
      ))
      .then(() => self.clients.claim()),
  );
});

/** Vite writes content hashes into these filenames, so a cached one can never be stale. */
function isHashedAsset(url) {
  return url.pathname.startsWith("/assets/") || url.pathname.startsWith("/icons/");
}

async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(cacheName);
    cache.put(request, response.clone());
  }
  return response;
}

/**
 * The page itself comes from the network whenever the network answers, so a
 * deploy is picked up on the next load rather than being pinned to whatever was
 * cached first. The cached copy is the offline fallback only.
 */
async function navigationHandler(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(SHELL_CACHE);
      cache.put("/", response.clone());
    }
    return response;
  } catch (error) {
    const cached = (await caches.match(request)) || (await caches.match("/"));
    if (cached) return cached;
    throw error;
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Financial data is never served from a cache — see the note at the top.
  if (url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(navigationHandler(request));
    return;
  }

  if (isHashedAsset(url)) {
    event.respondWith(cacheFirst(request, ASSET_CACHE));
  }
});

self.addEventListener("push", (event) => {
  if (!event.data) return;

  // The server sends JSON; a payload that will not parse still has to raise
  // something, because a subscription that silently drops messages looks
  // identical to one that is working.
  let payload = { title: "التزام", body: "", url: "/commitments" };
  try {
    payload = { ...payload, ...event.data.json() };
  } catch {
    payload.body = event.data.text();
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      dir: "rtl",
      lang: "ar",
      // Grouping by destination keeps a busy morning from stacking into a wall
      // of notifications; the newest replaces the previous one of its kind.
      tag: payload.tag || payload.url,
      data: { url: payload.url },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = event.notification.data?.url || "/commitments";

  // Focus an already-open tab instead of stacking another copy of the app.
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client) {
          client.navigate(target);
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});

/**
 * Chrome drops a subscription when it rotates keys or the browser is restored on
 * a new profile. Re-subscribing here keeps notifications alive without waiting
 * for the user to visit the settings screen again.
 */
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      const applicationServerKey = event.oldSubscription?.options?.applicationServerKey;
      if (!applicationServerKey) return;

      const subscription = await self.registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey,
      });

      await fetch("/api/notifications/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(subscription.toJSON()),
      });
    })(),
  );
});
