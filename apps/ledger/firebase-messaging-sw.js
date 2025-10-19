// === Firebase Messaging Service Worker (v8) ===
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
  const n = payload.notification || {};
  const title = n.title || '每日任務';
  const body  = n.body  || '還有未勾的每日喔！';
  const icon  = 'https://eyvind95.github.io/hello/apps/ledger/6.png';
  const badge = 'https://eyvind95.github.io/hello/apps/ledger/8.png';
  return self.registration.showNotification(title, {
    body, icon, badge, vibrate:[100,50,100], tag:'daily-reminder'
  });
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = 'https://eyvind95.github.io/hello/apps/ledger/daily.html';
  e.waitUntil(
    clients.matchAll({ type:'window', includeUncontrolled:true }).then(list=>{
      for (const c of list) if (c.url.includes('/hello/apps/ledger/daily.html')) return c.focus();
      return clients.openWindow(url);
    })
  );
});
