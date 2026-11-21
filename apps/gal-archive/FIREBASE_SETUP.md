# 輪迴檔案館 V5.7：Firebase 分層來源與安全遷移

網站：https://eyvind95.github.io/hello/apps/gal-archive/index.html

## 儲存架構

```text
galArchive/{uid}
├── worlds/{worldId}                      世界觀
├── cycles/{cycleId}                      輪迴索引、管理人名單
│   ├── parts/{partId}                    正式劇情／副駕駛聊天等資料片段
│   └── incoming/{sourceEventId}          ★ 這個輪迴專用的自動收取來源
├── integration/autoWriter               自動寫入授權（雜湊金鑰）
└── incoming/{sourceEventId}             舊版平面來源：僅相容讀取／人工遷移
```

- V5.7 起，`archiveIngest` **只將新來源寫入指定 `cycleId` 下的 incoming**，不再往使用者共用的平面 incoming 新增資料。
- 網站「分類收取」同時讀取新版與舊版來源，遇到相同文件 ID 優先採用新版；對刪除／清理則核對兩個位置，避免平面舊副本遺漏。
- `manager` 只是副駕駛名稱，**不是輪迴識別碼**；真正決定目標的是 `cycleId`。不同輪迴可使用同一位副駕駛。
- 一個 ChatGPT 對話可以在不同時段切換輪迴綁定，單純相同 `chatKey` 不足以確定輪迴歸屬。擴充功能應依當時綁定的 `cycleId` 上傳。
- 更改檔案館網頁本身**不會**部署 Firebase Functions；兩部分需要分別更新。

## 先部署 Firebase Functions

在 Windows 命令提示字元（CMD）進入含有 `firebase.json` 的 `apps\gal-archive` 目錄，再執行：

```bat
firebase deploy --only functions:gal-archive --project eyvind95-182f0
```

以出現 `Successful update operation` 與 `Deploy complete!` 為成功依據。不要使用 `--only functions:archiveIngest`，因為此專案採用名為 `gal-archive` 的 codebase。部署前請確保本機的 `functions/index.js` **已同步至 GitHub 最新版**，否則會重新部署舊程式！

## 舊資料處理（需人工核對）

1. **停止 Chrome 擴充功能監看**。先從檔案館匯出完整輪迴 JSON 備份。
2. 打開「☁ 雲端同步」→「📦 舊來源分層遷移／核對」。
3. 建議先選「只處理目前輪迴」，按「掃描舊來源／預覽」；檢查所列內容確實屬於這個輪迴。
4. 如果來源本來就綁錯，先到該輪迴使用「↗ 轉移誤收的來源對話」，並重新核對。**不要只靠副駕駛名稱或時間盲目分類。**
5. 第一次遷移請保持「刪除舊平面副本」**不勾**，先確認新路徑、件數及內容一致。
6. 再次掃描核對，若要移除舊平面來源，可勾選「複製並驗證成功後，刪除舊平面 incoming 的對應副本」，備份後輸入第二次確認詞。
7. 不符合目標輪迴、副駕駛名單、正式紀錄引用或雲端輪迴索引的資料會暫停遷移、保留原始資料，等待手動調查。

遷移會建立新路徑、驗證已保存，再決定是否刪除舊文件；**不會自動修改任何劇情／副駕駛聊天文字**，也不會自動恢復曾經漏抓的訊息。刪除前請自行確認下載的備份完整且可讀。

## Firestore 安全規則

已提供 `apps/gal-archive/firestore.rules`。在 Firebase 主控台的既有 Firestore 規則內，確認有：

```js
match /galArchive/{uid}/{path=**} {
  allow read, write: if request.auth != null && request.auth.uid == uid;
}
```

規則版本為 `rules_version = '2'` 時，這個遞迴比對同時涵蓋 `cycles/{cycleId}/incoming/{id}`。**請只合併上述區塊，不要用這份範例取代其他 app 的既有規則。**

注意：Firebase Admin SDK 寫入由 Functions 授權金鑰、輪迴存在與副駕駛名單檢查保護，不依賴上述前端規則。

## 驗收

- 新增一組全新測試輪迴並在 Chrome 擴充功能正確綁定；收到一則皮卡／GPT 訊息後，Firestore 中應出現 `galArchive/{uid}/cycles/{cycleId}/incoming/{id}`，而不是 `galArchive/{uid}/incoming/{id}`。
- 選「分類收取自動紀錄」，確認只進入綁定輪迴。
- 在另一個輪迴重複一次，核對兩個 `incoming` 子集合互相獨立。
- 舊資料維持可檢索，刪除輪迴前依介面提示備份；若發現來源混錯，優先先轉移並比對，避免直接全部刪除。

## V5.23：跨輪迴誤收的精準修復（暗玄／暗夢等）

**不要**再按整個 ChatGPT 對話 ID 直接搬走。同一個 chatKey 可能跨越多個輪迴。

1. 停止擴充功能監看、備份全站 JSON；選擇被誤收的來源輪迴。
2. 雲端同步 →「精準轉移誤收訊息（跨輪迴）」；選取目的輪迴。
3. 依分頁、內容關鍵字、勾選或組號範圍，明確指定要轉移哪些訊息。不要單憑副駕駛名稱或時間猜輪迴。
4. 核對來源與目的名稱、來源原文和件數後確認；網站先提供含兩輪正式資料的可匯入 JSON，再開始搬移。
5. 對能核對原始 incoming 的來源，依接收函式使用的 SHA-256（UID + 原輪迴 ID + sourceId + entryIndex）驗證舊來源，重新計算目的輪迴 ID 對應的新來源文件 ID，並同步更改正式訊息引用，避免日後重掃再次建立重複來源。無法驗證則停止，不會亂猜。
6. 目的輪迴來源寫入驗證 → 同步目的與原輪迴 → 核對後移除無其他輪迴使用的舊來源。找不到原始來源者只移正式訊息，該筆未來重掃可能無法去重。
7. 轉移完重新綁定 Chrome 擴充功能到正確的輪迴 ID；重新整理兩輪確認內容。

另外新版 galArchive 的雲端輪迴始終優先於舊 users 路徑中的同 ID 輪迴，避免舊備份因較晚的 updatedAt 再次覆蓋新版。

**還原注意：**轉移前下載的備份可在網站「匯入 JSON」回復兩輪正式資料；Firebase 原始 incoming 收在 transferAudit.rawSources，需人工核對，不能靠一般匯入直接重建。若轉移中斷，勿連續重試，先檢查兩輪與來源狀態。

## V5.25：歷史上錯綁輪迴的 incoming ID 修復

- 轉移前仍以目前來源輪迴的 SHA-256（UID / cycleId / sourceId / entryIndex）確認 ID；若不符，再逐一核對**本機已存在的輪迴 ID**及來源記錄中的歷史來源輪迴 ID，而不是直接拒絕。
- 若歷史來源輪迴已刪除、無從重建舊雜湊，只有符合官方 Chrome 擴充功能格式的 **單筆聊天來源**（`chrome-` + 48 位十六進位、`section=chat`、`role=me/ai`、`schemaVersion=1/2`）才依固定 `entryIndex=0` 重算目的輪迴 ID；其他來源仍停止，不會猜測。
- 原始 incoming 必須位於目前來源輪迴的路徑或舊平面收件匣，且 `cycleId` 必須與來源輪迴一致；同 ID 多個來源必須內容一致；目的輪迴若同 ID 但原文、角色或 `sourceId` 不同，仍拒絕轉移。
- 完整備份的 `transferAudit.sourceHashRepairs` 會記錄修復原因、舊／新來源 ID、索引及可核對的歷史輪迴 ID；成功彈窗顯示修復筆數。新 incoming 會標示 `originalIncomingEventId` 和 `transferHashValidation`，方便查核。
- 操作仍由使用者勾選、確認目標輪迴與輸入輪迴名稱，**不會自動猜測暗玄／暗夢歸屬**。實際 Firebase 資料未經遠端驗收，請保留 JSON 備份，先以少量明確的誤收來源測試，核對兩輪再大量搬移。
- 本次只改網站前端及 PWA 快取版號。**不需要重新部署 Cloud Functions**。

## V5.26：本輪對話缺漏唯讀診斷

雲端同步 →「🔍 對照本輪缺漏（唯讀）」：輸入外部核對的完整對話預期則數（如第十六周目 803），可對照本機 `messages`、已接事件、未接事件、`pilotMessages`、雙方人數、疑似錯分的玩家貼文。讀取 Firebase 指定輪迴的新分層／舊平面 `incoming` 以及雲端正式 `parts`，報告已收取來源中缺少對應正式片段、錯分頁、來源衝突與折疊訊息，並可下載診斷 JSON。只診斷不修改、不上傳、不刪除資料；差額不代表真正遺失，沒有擷取過的原始聊天必須回 ChatGPT 核對。檢查之前建議備份 JSON；Firebase 讀取需要登入、可能產生讀取計費。
