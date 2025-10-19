import admin from "firebase-admin";

const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT;
const projectId = process.env.FIREBASE_PROJECT_ID;
const userUid = process.env.USER_UID; // 你的 UID（只推自己）

if (!serviceAccountJson || !projectId || !userUid) {
  console.error("Missing env: FIREBASE_SERVICE_ACCOUNT / FIREBASE_PROJECT_ID / USER_UID");
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(JSON.parse(serviceAccountJson)),
  projectId
});

const db = admin.firestore();

function todayTokenTZ8() {
  const now = new Date();
  // 轉為台北時區 yyyy-mm-dd（簡化）
  const z = now.toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });
  const d = new Date(z);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2,'0');
  const day = String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
}

async function main() {
  const docRef = db.collection('daily').doc(userUid);
  const snap = await docRef.get();
  if (!snap.exists) {
    console.log("No daily doc, skip.");
    return;
  }
  const data = snap.data() || {};
  const meta = data.meta || {};
  const tokens = (meta.tokens || []).filter(Boolean);

  if (!tokens.length) {
    console.log("No tokens, skip.");
    return;
  }

  const pending = typeof meta.pendingCount === 'number' ? meta.pendingCount : 1; // 若沒值，預設有待辦
  const dayOk = !meta.dayToken || meta.dayToken === todayTokenTZ8(); // 若你有存當天標記就比對一下

  if (pending <= 0 || !dayOk) {
    console.log("All done or stale day token, not sending.");
    return;
  }

  // 準備 WebPush 通知（含 icon、badge）
  const icon  = 'https://eyvind95.github.io/hello/apps/ledger/6.png';
  const badge = 'https://eyvind95.github.io/hello/apps/ledger/8.png';

  const message = {
    tokens,
    webpush: {
      notification: {
        title: "每日任務",
        body: "還有未勾的每日喔！",
        icon,
        badge,
        tag: "daily-reminder"
      },
      fcmOptions: {
        link: "https://eyvind95.github.io/hello/apps/ledger/daily.html"
      }
    }
  };

  const res = await admin.messaging().sendEachForMulticast(message);
  console.log(`Sent: ${res.successCount}, Fail: ${res.failureCount}`);
  if (res.failureCount) {
    res.responses.forEach((r,i)=>{
      if (!r.success) console.log(`  ${i}: ${r.error?.message}`);
    });
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
