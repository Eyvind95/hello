# 前輩考古匯入規格 V2（網站 V5.164）
每輪迴、每位前輩一個單檔匯入包。格式如下（僅結構示意，非真實資料）：

```json
{
  "format": "gal-predecessor-import-bundle",
  "version": 1,
  "sourceText": "<完整原始聊天 JSON 的 UTF-8 原文字串，保留 BOM、空白、換行>",
  "pack": {
    "format": "gal-predecessor-cycle-overwrite",
    "version": 2,
    "target": {"worldKey":"sentinel","cycleId":"實際輪迴 UUID","cycleTitle":"第14輪迴"},
    "chatId": "原始聊天 ID",
    "manager": "前輩名稱",
    "sourceSha256": "原始聊天檔實際 SHA-256（小寫64位十六進位）",
    "pilotMessages": [],
    "quizLogs": [],
    "easterEggs": [],
    "casinoLogs": [],
    "realChatLogs": [],
    "rejectedEvents": []
  }
}
```

- 原始檔必須是既有允許的 completed 掃描、離線整合候選或成功頂端補掃證據；原始位元組不可重新排版後假裝相同 SHA。sourceText 應由原始 bytes 使用保留 BOM 的嚴格 UTF-8 解碼（TextDecoder('utf-8',{fatal:true,ignoreBOM:true})），再把完整字串放進外層 JSON；網站重新編碼並計算 SHA-256，不接受偽造摘要。
- pilotMessages / quizLogs / casinoLogs / realChatLogs 每筆 {sourceId,text}，依原始索引排序，各欄位內同一來源僅一筆。text 必須是原始來源可核對的連續文字片段，不改寫、不憑空補折疊內容。混合主題可在多欄保存各自原文片段，必要時可保留整則及交代重疊。副駕駛玩家訊息仍禁止混入「我：／他：」劇情區塊。
- easterEggs 延續 V1 的 {title,text,status,sourceIds}；confirmed 或 uncertain。
- rejectedEvents 每筆 {sourceId,text,title?,decisionSourceId,decisionText}。sourceId 為事件正文或當時考古聊天中的事件內容證據；text 為該來源連續原文。title 選填但必須是該來源原文。decisionSourceId 必須是玩家原始訊息 ID，decisionText 為該訊息可證明玩家拒絕的原文。工具人需逐事件核對語義與關聯；原始事件與拒絕可以在同一則。不要把仍待選擇、已接事件、角色拒絕某人或推測事件視為玩家拒絕。若只剩圖片且不能讀原文、或拒絕不明，列入另外的待確認清冊，不能猜造或匯入確定拒絕。網站獨立保存為非正史，不改 events 或完整對話計數。
- 新版六個欄位都必須有陣列；沒有資料填 [] 並在審查清冊說明。不得把缺少證據宣稱為歷史上沒有事件。V1 舊雙檔相容，缺少新欄位不清空舊資料。
- 網站依世界觀 ID、輪迴 UUID、輪迴名稱三者完全吻合自動定位；找不到或衝突則拒絕，不猜、不建立輪迴。預覽、備份、確認後才寫入；不同前輩與未綁定紀錄保留。新分頁為考古原文唯讀展示；閱讀 ZIP、完整備份與既有同步保留資料。
- 不可把私人原始聊天、實際匯入包或 UID／Firebase 資料提交到公開 GitHub。只在私人 Drive 交付。
