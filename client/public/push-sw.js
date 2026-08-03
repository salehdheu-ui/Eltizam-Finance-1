self.addEventListener("push", (event) => {
  let payload = { title: "التزام", body: "لديك تذكير جديد", url: "/" };
  try {
    payload = { ...payload, ...event.data.json() };
  } catch {
    if (event.data) payload.body = event.data.text();
  }
  event.waitUntil(self.registration.showNotification(payload.title, {
    body: payload.body,
    icon: "/favicon.png",
    badge: "/favicon.png",
    data: { url: payload.url || "/" },
    dir: "rtl",
    lang: "ar",
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "/", self.location.origin).href;
  event.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
    const existing = windows.find((windowClient) => windowClient.url === target);
    return existing ? existing.focus() : clients.openWindow(target);
  }));
});
