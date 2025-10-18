self.addEventListener('push', event => {
  let data = {};
  try { data = event.data.json(); } catch(e){}

  // 支援兩種結構：自定義 payload 或 FCM 常見 notification 欄位
  const title = data.notification?.title || data.title || '通知';
  const body  = data.notification?.body  || data.body  || '你有一則新訊息';
  const icon  = data.notification?.icon  || data.icon  || '../6.png';
  const tag   = data.tag || 'fcm-msg';

  const options = {
    body, icon, tag,
    data
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// 使用者點擊通知
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = event.notification.data?.click_action || './';
  event.waitUntil(clients.openWindow(url));
});
