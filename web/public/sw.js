/* local-pilot service worker — receives web-push messages and shows
   notifications. Registered by web/src/push.ts when the user enables push. */

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (_e) {
    data = { title: 'local-pilot', body: event.data ? event.data.text() : '' };
  }

  event.waitUntil(
    (async () => {
      // If a local-pilot window is already open and focused, stay quiet.
      const wins = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });
      const focused = wins.some((c) => c.focused && c.visibilityState === 'visible');
      if (focused) return;

      await self.registration.showNotification(data.title || 'local-pilot', {
        body: data.body || '',
        tag: data.tag || 'local-pilot',
        renotify: true,
        data: { sessionId: data.sessionId || null },
      });
    })(),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const sessionId = event.notification.data && event.notification.data.sessionId;

  event.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });
      for (const client of wins) {
        await client.focus();
        if (sessionId) client.postMessage({ type: 'open-session', sessionId });
        return;
      }
      // No window open — open one, deep-linking to the session.
      const url = sessionId ? `/?session=${encodeURIComponent(sessionId)}` : '/';
      if (self.clients.openWindow) await self.clients.openWindow(url);
    })(),
  );
});
