# Line Bot 部署指南

以下為遊戲王表管理系統 Line Bot 的部署步驟說明：

1. 在老師提供的 Google Apps Script 專案檔案中，點選「擴充功能」選單，選擇「Apps Script」進入編輯器。

2. 在 Apps Script 編輯器中，點選「新增部署」按鈕，選擇「新增部署」。

3. 部署完成後，取得該部署的 Webhook URL。

4. 前往小巴（Line Developers）平台，將剛剛取得的 Webhook URL 更新到機器人設定中的 Webhook URL 欄位。

5. 確認機器人的程式碼已連結到老師提供的 Google Apps Script 專案檔案中。

6. 資料庫部分，請使用「出王表」的試算表，其中 D 欄的資料為 C 欄（時間欄）加上重生時間的計算結果。

完成以上步驟後，Line Bot 即可正常運作，並能透過指令與遊戲王表管理系統互動。
