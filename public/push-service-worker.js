self.addEventListener("push", (event) => {
  const payload = readPushPayload(event);
  const title = payload.title || "Behavior reminder";
  const options = {
    body: payload.body || "A scheduled behavior is ready to review.",
    icon: payload.icon || "/icons/cadence-notification-icon.png",
    badge: payload.badge || "/icons/cadence-notification-badge.png",
    tag: payload.tag || "cadence-browser-reminder",
    data: {
      url: payload.url || "/timeline",
    },
  };

  // Ticket 278: a leave reminder's update replaces the first notification and alerts again.
  if (payload.renotify === true && payload.tag) {
    options.renotify = true;
  }

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const requestedUrl = new URL(
    event.notification.data?.url || "/timeline",
    self.location.origin,
  );
  const targetUrl =
    requestedUrl.origin === self.location.origin
      ? requestedUrl
      : new URL("/timeline", self.location.origin);

  event.waitUntil(
    self.clients
      .matchAll({
        type: "window",
        includeUncontrolled: true,
      })
      .then((clients) => {
        const existingClient = clients.find((client) => {
          return new URL(client.url).origin === targetUrl.origin;
        });

        if (existingClient) {
          // Ticket 278: a leave reminder link reloads even at the same URL, so its drawer opens again.
          if (
            typeof existingClient.navigate === "function" &&
            (existingClient.url !== targetUrl.href ||
              (targetUrl.pathname === "/timeline" && targetUrl.searchParams.has("leave")))
          ) {
            return existingClient.navigate(targetUrl.href).then((client) => {
              return (client || existingClient).focus();
            });
          }

          return existingClient.focus();
        }

        return self.clients.openWindow(targetUrl.href);
      }),
  );
});

function readPushPayload(event) {
  if (!event.data) {
    return {};
  }

  try {
    return event.data.json();
  } catch {
    return {
      body: event.data.text(),
    };
  }
}
