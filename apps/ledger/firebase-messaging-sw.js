// === Firebase Messaging Service Worker (v8) ===
importScripts('https://www.gstatic.com/firebasejs/8.10.1/firebase-app.js');
importScripts('https://www.gstatic.com/firebasejs/8.10.1/firebase-messaging.js');

// 你的專案設定（這裡填一樣的即可）
firebase.initializeApp({
  apiKey: "AIzaSyAP4hKop0wN9jrAN6_xx0fGhwInAAa5chI",
  authDomain: "eyvind95-182f0.firebaseapp.com",
  projectId: "eyvind95-182f0",
  storageBucket: "eyvind95-182f0.firebasestorage.app",
  messagingSenderId: "105770576221",
  appId: "1:105770576221:web:dd3a57ce4e051bda91a0b4"
});

const messaging = firebase.messaging();

// 背景訊息（App/頁面關掉或在背景時）
messaging.setBackgroundMessageHandler(function (payload) {
  const n = payload.notification || {};
  const d = payload.data || {};

  const title = n.title || d.title || '每日任務';
  const body  = n.body  || d.body  || '還有未勾的每日喔！';

  // 用「絕對網址」保險，避免 SW 相對路徑抓不到圖
  const icon  = 'https://eyvind95.github.io/hello/apps/ledger/8.png';

  return self.registration.showNotification(title, { body, icon, data: d });
});

// 點通知打開/聚焦你的 daily.html
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = 'https://eyvind95.github.io/hello/apps/ledger/daily.html';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      // 已有分頁就聚焦
      for (const c of list) {
        if (c.url.includes('/hello/apps/ledger/daily.html')) {
          return c.focus();
        }
      }
      // 沒有就開新分頁
      return clients.openWindow(url);
    })
  );
});
