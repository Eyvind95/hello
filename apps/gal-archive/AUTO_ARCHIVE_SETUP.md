# 輪迴檔案館 V4.3 — 副駕駛自動歸檔

這份說明對應 GitHub 的 `apps/gal-archive/functions` 與 `gpt-action.openapi.yaml`。

## 已完成的部分

- 輪迴建立／編輯可指定多位「負責管理的副駕駛／前輩／後輩」（例如「暗夢前輩、暗夢後輩」），依接手順序儲存為 managerNames；在列表、備份及閱讀模式中顯示。每則自動紀錄標記實際負責者。
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
5. 打開檔案館，登入 Google，先為輪迴填入一位或多位「負責管理人」（用頓號隔開）；按「↑ 上傳本機資料」更新雲端輪迴索引。
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
- 若輪迴負責人更改，需要先從網站重新上傳該輪迴，接收端才會用新的 managerNames 進行驗證。每次傳入的 manager 必須是其中一個單一名稱，不能傳合併名單。
- 如意外洩露寫入金鑰，立刻在網站按「撤銷寫入金鑰」，並於自訂 GPT 的動作認證中更新金鑰。


## V4.3 多管理者更新與重新部署

已經部署 V4.2 的使用者，必須把 **GitHub 最新的 `functions/index.js`** 覆蓋到電腦上相同位置，再在 `apps/gal-archive/` 執行：

```sh
firebase deploy --only functions:gal-archive:archiveIngest --project eyvind95-182f0
```

然後網站更新至 V4.3，在編輯輪迴填入「暗夢前輩、暗夢後輩」，登入 Google 後按「上傳本機資料」。這樣兩位才會都被接收端允許。


## V4.4：區分 Gal AI 正史與副駕駛 GPT 聊天

- 「完整對話」只用來保存 Gal AI 劇情原文。**自動**接收皮卡的貼文時，只有**行首**有「我：」或「他：」標記的部分才會拆入此區；前置無標記文字留在「副駕駛聊天」。
- 皮卡與 GPT 的一般討論（未含上述行首標記），以及 GPT **自己的所有回覆**，都進入新分頁「副駕駛聊天」。GPT 並非 Gal AI，不可代替「他：」。
- 自動收取按 Firestore 的 `receivedAt` 排序；V0.4 擴充功能還會附上相同對話的 `messageOrder`，避免非同步上傳造成顛倒。
- **已經在 V4.3 誤收入「完整對話」的訊息**：先按「匯出備份」保存 JSON，再到「☁ 雲端同步」點「🛠 修復先前的自動收取紀錄」。此動作只辨認附有 `sourceEventId` 的自動紀錄，保留手動寫入的 Gal AI 正史；處理過的紀錄不會重複修復。
- V0.4 Chrome 擴充功能新按鈕「回補目前頁面已顯示的歷史訊息」需要**使用者手動確認**。啟用監看預設不倒灌舊訊息，按下回補才會逐筆送出，目前單次限 200 則已載入訊息，不保證完整歷史或附件。
- 需重新部署本版本的 `functions/index.js` 才會保存 `chatKey` 和 `messageOrder`，保留原來的寫入金鑰及 API 位址，不需要建立新的金鑰：

```sh
firebase deploy --only functions:gal-archive:archiveIngest --project eyvind95-182f0
```

- 須先將 GitHub 更新後的 `apps/gal-archive/functions/index.js` 複製到電腦既有的 `apps/gal-archive/functions/index.js`，並在本機 `apps/gal-archive/` 執行上面指令。只有部署成功後，才會記錄新的順序欄位。
- 重要限制：超過 25,000 字元的單則訊息、未載入網頁的歷史、圖片及複雜格式暫不會被完整自動記錄；仍須手動補登，不能當作唯一正史備份。


## V4.5：修復「歷史回補後副駕駛聊天順序錯亂」

V4.4 雖然已從 Firestore incoming 排序，但儲存到正式 `pilotMessages` 時未保存 `chatKey` 和 `messageOrder`。後續先收到新訊息、再回補舊訊息時，已經收取的聊天不會重新排列。

修復方式：

1. 在網站先按「匯出備份」，保存本機 JSON。
2. 更新到 V4.5 並登入 Google，點選「☁ 雲端同步」。
3. 點「↕ 校正副駕駛聊天順序」：程式會用 `sourceEventId` 回查 Firestore `incoming`，讀取原始 `chatKey` 與 `messageOrder`，先展示可排序／缺失數量。
4. 確定後，只移動能辨識順序的自動副駕駛訊息；不刪除訊息、不改內容、不改「完整對話」Gal AI 劇情，手動輸入的副駕駛訊息保留原位置。
5. 若早期訊息沒有原始回合順序資訊，無法從接收時間可靠還原，程式會顯示未校正數量；請用聊天卡片的 ↑／↓ 手動調整。

未來新收取的訊息也會保存順序欄位並在同個輪迴內重新排序。只要 Cloud Function 已支援 `chatKey`／`messageOrder`，這次**不需要再次部署 Firebase 函式**。
