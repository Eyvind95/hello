# 輪迴檔案館 V3.6：Firebase 設定

網站：`/hello/apps/gal-archive/index.html`。網站程式公開，但輪迴內容預設只儲存在本機瀏覽器的 IndexedDB，不會自動上傳 GitHub。

## 需要做的設定

1. 開啟 [Firebase 主控台](https://console.firebase.google.com/)，選擇你原本使用的專案，或新建一個專案。
2. 在「Authentication > Sign-in method」啟用 **Google**。
3. 在「Authentication > Settings > Authorized domains」加入 **eyvind95.github.io**。
4. 在「Firestore Database」建立資料庫。前往 Rules，**將本資料夾 `firestore.rules` 裡的三個 match 和 archiveOwner 函式合併進原本規則**，不要整份覆蓋其他應用已使用的規則。
5. 在「Project settings > Your apps」建立 Web App（如已存在也可以使用原本設定），複製 Firebase 設定物件。`apiKey`、`authDomain`、`projectId`、`appId` 必填。
6. 開啟輪迴檔案館的「☁ 雲端同步」→ 貼上設定 JSON →「儲存設定並使用 Google 登入」→ 先匯出 JSON 備份 →「↑ 上傳本機資料」。
7. 換裝置時，使用**相同 Google 帳號**登入，按「↓ 從雲端合併下載」。

範例設定格式（不是可用憑證）：

```json
{
  "apiKey": "你的 Firebase apiKey",
  "authDomain": "你的專案.firebaseapp.com",
  "projectId": "你的專案 ID",
  "appId": "你的 appId"
}
```

## 資料結構

- `users/{Google登入UID}/worlds/{worldId}`：共用世界觀
- `users/{Google登入UID}/cycles/{cycleId}`：輪迴索引／片段數
- `users/{Google登入UID}/cycles/{cycleId}/parts/{000000...}`：分段輪迴資料（含對話）

長篇輪迴將拆成小於 Firestore 單筆文件上限的分段。上傳與合併下載需要網路；尚未啟用 Google 登入時只能本機儲存。

## 注意

- Firebase 網頁設定物件不是管理員金鑰；保密依靠安全規則與 Google 身份驗證。
- 現在是**手動同步**，不是每次修改自動上傳，避免空檔案覆蓋正史。
- 同 ID 合併依 updatedAt 比較，不同步刪除紀錄；若多台裝置同時編輯相同輪迴，較新的版本可能覆蓋另一台的變更。請定期匯出 JSON。
- Firestore 讀寫可能涉及計費與用量配額，尤其大規模對話。
- 要讓 ChatGPT 自動寫入，需要額外建立授權 API／GPT Action 或透過支援連接器的工作流程；普通 ChatGPT 對話無法被網站自動監聽。
