// __SW_BUILD__: 2025-10-23-01  // ← 每次改這串
// v8 版 SW：只放背景處理（data-only）
importScripts('https://www.gstatic.com/firebasejs/8.10.1/firebase-app.js');
importScripts('https://www.gstatic.com/firebasejs/8.10.1/firebase-messaging.js');

firebase.initializeApp({
  apiKey: "AIzaSyAP4hKop0wN9jrAN6_xx0fGhwInAAa5chI",
  authDomain: "eyvind95-182f0.firebaseapp.com",
  projectId: "eyvind95-182f0",
  storageBucket: "eyvind95-182f0.firebasestorage.app",
  messagingSenderId: "105770576221",
  appId: "1:105770576221:web:dd3a57ce4e051bda91a0b4"
});

const messaging = firebase.messaging();

messaging.setBackgroundMessageHandler(payload => {
  const d = payload.data || {};
  const title = d.title || '每日任務';
  const body  = d.body  || '還有未勾的每日喔！';
  const ts    = d.ts || Date.now();
  const icon  = 'https://eyvind95.github.io/hello/apps/ledger/6.png';
  const badge = 'https://eyvind95.github.io/hello/apps/ledger/8.png';

  return self.registration.showNotification(title, {
    body,
    icon,
    badge,
    tag: 'daily-reminder-' + ts,  // 動態，避免靜默取代
    renotify: true,
    vibrate: [100, 50, 100]
  });
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = 'https://eyvind95.github.io/hello/apps/ledger/daily.html';
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) if (c.url.includes('/hello/apps/ledger/daily.html')) return c.focus();
      return clients.openWindow(url);
    })
  );
});
