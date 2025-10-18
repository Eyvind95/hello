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

messaging.setBackgroundMessageHandler(function(payload) {
  console.log("🔔 背景推播：", payload);
  const { title, body } = payload.notification || {};
  return self.registration.showNotification(title, { body });
});
