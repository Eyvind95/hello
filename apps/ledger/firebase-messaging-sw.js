// __SW_BUILD__: 2025-11-06-10  // ← 每次改這串
// v8 版 SW：背景處理
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

// 統一畫通知（無論是 data-only 或 hybrid）
function show(d = {}) {
  const title = d.title || '每日任務';
  const body  = d.body  || '還有未勾的每日喔！';
  const ts    = d.ts    || Date.now().toString();
  return self.registration.showNotification(title, {
    body,
    icon:  'https://eyvind95.github.io/hello/apps/ledger/6.png',
    badge: 'https://eyvind95.github.io/hello/apps/ledger/8.png',
    tag:   'daily-reminder-' + ts,
    renotify: true,
    vibrate: [100, 50, 100]
  });
}

// FCM v8 背景處理：data-only 會走這裡
messaging.setBackgroundMessageHandler(payload => {
  const d = payload && (payload.data || payload.notification) || {};
  return show(d);
});

// 使用者點通知 → 開頁或聚焦
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
