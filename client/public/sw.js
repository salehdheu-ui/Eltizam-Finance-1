// Push notifications for التزام. Kept deliberately small: a service worker that
// fails to install takes the whole app's offline story down with it.

self.addEventListener("push", (event) => {
  if (!event.data) return;

  let payload = { title: "التزام", body: "", url: "/commitments" };
  try {
    payload = { ...payload, ...event.data.json() };
  } catch {
    payload.body = event.data.text();
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: "/favicon.png",
      badge: "/favicon.png",
      dir: "rtl",
      lang: "ar",
      tag: payload.url,
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
