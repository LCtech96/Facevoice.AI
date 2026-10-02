// Service worker: solo notifiche push della casella messaggi admin.

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch (e) {
    data = { body: event.data ? event.data.text() : '' }
  }

  event.waitUntil(
    self.registration.showNotification(data.title || 'Nuovo messaggio', {
      body: data.body || '',
      icon: '/icon-180.png',
      badge: '/icon-180.png',
      tag: data.tag,
      data: { url: data.url || '/admin/inbox' },
    })
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = new URL(event.notification.data?.url || '/admin/inbox', self.location.origin).href

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('navigate' in client) {
          return client.focus().then(() => client.navigate(target))
        }
      }
      return self.clients.openWindow(target)
    })
  )
})
