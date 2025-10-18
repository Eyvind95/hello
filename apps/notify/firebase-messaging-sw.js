/* apps/notify/firebase-messaging-sw.js */
/* 你可以用純 push 事件來顯示通知（不用載入 Firebase SW SDK） */
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data.json() } catch(e) {}
  const title = data.notification?.title || '每日任務通知';
  const body  = data.notification?.body  || '這是 FCM 背景推播（push event）';
  const icon  = data.notification?.icon  || '../6.png';

  event.waitUntil(self.registration.showNotification(title, { body, icon, data }));
});

/* 點擊通知可補充導向 */
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(clients.openWindow('../daily.html'));
});
