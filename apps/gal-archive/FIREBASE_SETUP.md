# 輪迴檔案館 V4.0：Firebase 設定

網站：`https://eyvind95.github.io/hello/apps/gal-archive/index.html`

## 已使用共用專案

檔案館和記帳本、每日任務、計時器使用相同 Firebase 專案：`eyvind95-182f0`，且直接使用 Google 登入；**不需要再貼 Firebase 設定 JSON**。

## 必要設定

1. 到 [Firebase 主控台](https://console.firebase.google.com/) 開啟上述專案的 **Cloud Firestore > 規則**。
2. 確保 Authentication 已啟用 Google 並授權 `eyvind95.github.io`。
3. **將 `firestore.rules` 中的 `match /galArchive/{uid}/{path=**}` 區塊合併到目前安全規則的 `match /databases/{database}/documents` 內。** 不要覆蓋其他網站的規則。
4. 按「發布」後，開啟輪迴檔案館 V4.0 →「☁ 雲端同步」→ Google 登入。
5. **先匯出 JSON 備份，再按「↑ 上傳本機資料」。** 登入本身不會建立集合／上傳資料。
6. 完成時會顯示「上傳完成」及世界觀、輪迴數量；Firestore 根目錄應可看見 `galArchive` 集合。可打開 `galArchive / 你的登入 UID` 查看 `worlds` 與 `cycles` 子集合。
7. 手機上使用相同 Google 帳號登入，按「↓ 從雲端合併下載」。

## V4.0 儲存結構

```text
galArchive (根集合)
└── {登入 UID} (含 app、schemaVersion、worldCount、cycleCount 等欄位的文件)
    ├── worlds
    │   └── {worldId}：共用世界觀
    └── cycles
        └── {cycleId}：輪迴索引
            └── parts
                └── 000000 ...：對話／設定的分段內容
```

舊版本使用 `users/{uid}/worlds` 與 `users/{uid}/cycles`，V4.0 的「雲端合併下載」仍會讀取這些資料以避免舊資料遺失；它**不會刪除舊路徑**。若要把舊資料遷移至新集合，請先合併下載後再手動上傳一次，並確認新集合內容正確，才考慮清理舊資料。

## 注意

- 登入≠上傳；Firestore 不會只因網站部署 GitHub 或 Google 登入成功就自動建立集合。
- 根文件現在會在「上傳本機資料」成功後建立，因此能在 Firestore 主控台直接找到 `galArchive`。
- 讀取舊路徑的權限由你先前已發布的 `/users/{uid}/{document=**}` 規則負責。
- 網站程式是公開的，**不會將故事 JSON 寫到 GitHub**。資料保護靠 Firebase Authentication 與 Firestore 安全規則。
- 同 ID 的雲端合併仍按 updatedAt 比較，請定期匯出 JSON 備份。
- 雲端同步是手動的，避免在空資料狀態覆蓋正史。
