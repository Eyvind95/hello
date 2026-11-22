# Chrome 雙掃描助手開發與發布

- 每批準備驗收或發布的修復由開發者遞增修訂版號，例如 V0.7.9 → V0.7.10 → V0.7.11。同一批未發布修改沿用已分配的版號。重大功能升級可改增次版本，並在回報中說明。
- 同步核對 Chrome manifest、兩個彈出視窗、掃描面板、程式回報的版本、使用說明、網站下載文字、ZIP 檔名與 ZIP 內的 manifest。manifest 的 `version` 使用純數字，測試狀態可標在 `version_name`、介面及本機網站預覽。
- 測試版通過真實掃描驗收後，移除測試標示、重建 ZIP、更新下載資訊與必要的 PWA 快取，再依發布授權更新 GitHub Pages。更新擴充功能時保留主網站自己的版本號；掃描 JSON 的格式版本獨立管理。
- 本機安裝目錄為開發者桌面的 `archive-extension`（Windows：`%USERPROFILE%\Desktop\archive-extension`）。同步前先驗證備份，更新發行套件中的檔案並核對雜湊，保留原路徑、Chrome 設定與既有資料。工作區外的操作應使用正常權限請求。
- 發布後核對 GH Pages 下載資訊、線上 ZIP 與本機安裝的版本和檔案一致，再回報是否需要重新載入 Chrome 擴充功能。一般修復的驗收只匯出掃描 JSON，須依使用者授權處理任何正史或 Firebase 的變更。
