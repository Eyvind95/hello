// firebase-messaging-sw.js
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');

// ★ 換成你的 firebaseConfig
firebase.initializeApp({
  apiKey: "你的 apiKey",
  authDomain: "你的專案ID.firebaseapp.com",
  projectId: "你的專案ID",
  storageBucket: "你的專案ID.appspot.com",
  messagingSenderId: "你的 senderId",
  appId: "你的 appId",
});

const messaging = firebase.messaging();

// 背景推播（App 關掉或在背景時）
messaging.onBackgroundMessage((payload) => {
  const title = (payload.notification && payload.notification.title) || '每日提醒';
  const options = {
    body: (payload.notification && payload.notification.body) || '',
    icon: './icons/app-192.png',
    badge: './icons/app-192.png',
  };
  self.registration.showNotification(title, options);
});
