# 輪迴檔案館 V4.2 — 副駕駛自動歸檔

這份說明對應 GitHub 的 `apps/gal-archive/functions` 與 `gpt-action.openapi.yaml`。

## 已完成的部分

- 輪迴建立／編輯可指定「負責管理的副駕駛／前輩／後輩」，在列表、備份和副駕駛閱讀中顯示。
- 網站的「☁ 雲端同步」有「建立／重設寫入金鑰」「撤銷寫入金鑰」「收取副駕駛自動紀錄」。
- Firebase HTTPS 接收函式 `archiveIngest` 的原始碼已存放在 GitHub。函式接收 Bearer 金鑰，驗證 SHA-256 摘要與輪迴 ID，只會將資料 **create** 到 `galArchive/{uid}/incoming/{eventId}`，不會改寫正史。
- 收取時將待收取對話加入所屬輪迴，再寫回雲端。訊息帶有 `sourceEventId`，重試不會重複加入。

**尚未完成：Cloud Function 尚未部署到你的 Firebase 專案；也尚未連接任何歷代 ChatGPT。只有修改網站與 GitHub 程式不會讓其他聊天自行上傳。**

## 你需要操作的步驟

1. 確保 Firebase 專案 `eyvind95-182f0` 可部署 Cloud Functions（Firebase 文件要求 Blaze 計費方案）。確認費用及預算警示。
2. 電腦安裝 Node.js 22，以及 Firebase CLI：`npm install -g firebase-tools`。
3. 在電腦終端開啟 GitHub 專案的 `apps/gal-archive/` 資料夾，依序執行：
   ```sh
   firebase login
   npm install --prefix functions
   firebase deploy --only functions:archiveIngest --project eyvind95-182f0
   ```
   若 Firebase CLI 尚未指定此資料夾的設定，請確認它讀取到同資料夾的 `firebase.json`，且沒有修改你其他應用的部署。
4. 部署後，從 CLI 輸出取得 **實際 HTTPS 函式網址**。不要猜測網址。
5. 打開檔案館，登入 Google，先為輪迴填入「負責管理人」；按「↑ 上傳本機資料」更新雲端輪迴索引。
6. 在「☁ 雲端同步」按「建立／重設寫入金鑰」。只將出現的金鑰複製到 **自訂 GPT 編輯器的動作 API Key（Bearer）欄位**，不要貼到對話、GitHub 或公開網頁。金鑰只會顯示一次，必要時重設或撤銷。
7. 同頁「目前登入 UID」可用於 Action JSON。`cycleId` 是輪迴資料在 Firestore `cycles` 下的文件 ID（UUID），不是「第16周目」文字。
8. 在可編輯的自訂 GPT 裡新增 **Action（動作）**，貼入 `gpt-action.openapi.yaml`。其中的 `servers.url` 要換成實際部署的 HTTPS host；若網址路徑已包含 `/archiveIngest`，請保證 schema 的 host / path 組合不重複。身份驗證選 API Key / Bearer。
9. 測試只寫入一至兩則短訊息，確認 Firestore `galArchive/{uid}/incoming` 新增了 `status=pending` 紀錄。
10. 回檔案館按「📥 收取副駕駛自動紀錄」，應看到這些訊息被加入所屬輪迴並上傳回雲端。

## 提供給可使用 Action 的副駕駛的指示（可直接複製）

```text
你是 Gal AI 副駕駛。使用者貼來的內容中，「我：」是皮卡；「他：」是 Gal AI。你不能自行補寫或推測正史。
每當取得本輪新增的原始對話，才呼叫 appendArchiveMessages；每次呼叫提供事先指定的 Firebase UID、cycleId、負責管理人 manager、能去重的 sourceId，和原樣訊息 entries。
section=chat 是完整對話；quiz=10題；changes=與皮卡修改記錄。
role=me 顯示右側，role=ai 顯示左側。不得把你自己的評論冒充成 Gal AI 對話。
如果資訊缺少、輪迴 ID 不明或管理人不相符，就不要呼叫；不可盲猜 ID。
同一來源重試時必須使用同樣的 sourceId。回應使用者時可簡要告知歸檔是否完成。
```

## 為什麼不能直接接管所有舊聊天？

一般 ChatGPT 聊天沒有自動監聽每次回覆並任意呼叫外部 API 的能力。必須在**有啟用相關 Action／工具的 GPT 或支援的工作流程中**使用。舊聊天與歷代 GPT 不會因這些 GitHub 檔案就自動獲得寫入能力；如果原本前輩聊天不能加 Action，就需要切換至配置好的 GPT，或由使用者批次匯入。

## 安全與限制

- GitHub **沒有**存放任何私人 API 金鑰，瀏覽器只會把金鑰的 SHA-256 摘要送往 Firestore；函式驗證 Bearer 金鑰。
- 接收函式使用 Firebase Admin SDK，只能創建 pending 接收匣文件，不提供編輯、刪除正史的端點。
- 所有接收資料都會進入待收取區。網站收取時才合併入正式輪迴，防止 GPT 直接覆蓋內容。
- 預設單次最多 10 則訊息、總共最多 40,000 字元；大批內容請分段。
- Cloud Functions、Firestore 等用量可能產生費用。建議啟用計費預算提醒。
- 若輪迴負責人更改，需要先從網站重新上傳該輪迴，接收端才會用新的 manager 進行驗證。
- 如意外洩露寫入金鑰，立刻在網站按「撤銷寫入金鑰」，並於自訂 GPT 的動作認證中更新金鑰。
