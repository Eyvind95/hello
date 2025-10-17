// 自訂背景通知外觀
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data.json(); } catch(e) {}
  const title = data.notification?.title || '每日提醒';
  const body  = data.notification?.body  || '你有未勾選的每日！';
  const icon  = './6.png';

  event.waitUntil(
    self.registration.showNotification(title, { body, icon, data })
  );
});
