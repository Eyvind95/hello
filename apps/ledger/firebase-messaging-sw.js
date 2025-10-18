// === Firebase Messaging Service Worker (v8) ===
importScripts('https://www.gstatic.com/firebasejs/8.10.1/firebase-app.js');
importScripts('https://www.gstatic.com/firebasejs/8.10.1/firebase-messaging.js');

// Firebase 專案設定（與頁面相同）
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

  // 大圖示（app icon）仍用 6.png；通知列小圖示用 8.png（灰階小圖）
  const icon  = 'https://eyvind95.github.io/hello/apps/ledger/6.png';
  const badge = 'https://eyvind95.github.io/hello/apps/ledger/8.png';

  // 把要開啟的頁面放在 data 方便 click 事件取用
  const data  = { url: 'https://eyvind95.github.io/hello/apps/ledger/daily.html' };

  // ***要 return***：回傳 Promise 讓 SW 正確顯示通知
  return self.registration.showNotification(title, {
    body,
    icon,
    badge,
    data,
    vibrate: [100, 50, 100],
    tag: 'daily-reminder'
  });
});

// 點通知打開/聚焦 daily.html
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification && event.notification.data && event.notification.data.url)
           || 'https://eyvind95.github.io/hello/apps/ledger/daily.html';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if (c.url.includes('/hello/apps/ledger/daily.html')) {
          return c.focus();
        }
      }
      return clients.openWindow(url);
    })
  );
});
