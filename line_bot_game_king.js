/**
 * 遊戲王表管理系統 - Line Bot 版本
 * 用於追蹤遊戲中王的重生時間並提供查詢功能
 * 
 * 主要功能：
 * 1. 自動追蹤和更新王的重生時間
 * 2. 支持通過名稱或關鍵字查詢王的狀態
 * 3. 提供重生時間的自動計算和更新
 * 4. 支持批量重置王的時間
 * 5. 提供Line Bot webhook處理，只對特定指令回應
 * 6. 包含錯誤處理和伺服器狀態檢測功能
 * 
 * @version 1.3.1
 * @update 1.3.0 - 添加Line Bot webhook處理，改進錯誤處理，添加選擇性回應功能
 * @update 1.3.1 - 修復⚔符號顯示問題，使用cycles值判斷王是否已過期
 */

var VERSION = "1.3.1";    // 程式版本號
var spreadSheetConfig = SpreadsheetApp.getActive();    // 獲取當前活動的試算表
var sheetConfig = spreadSheetConfig.getSheetByName("參數設定");    // 取得參數設定工作表
var sheetConfigData = sheetConfig.getSheetValues(1, 2, sheetConfig.getLastRow(), sheetConfig.getLastColumn() - 1);    // 獲取設定數據

// 系統設定變數
var CHANNEL_ACCESS_TOKEN = sheetConfigData[0][0].replace(/\r?\n|\r/g,"");    // Line Bot 的權杖
var spreadSheetId = sheetConfigData[2][0];    // 要被搜尋的 Google 試算表 ID
var sheetName = transformArray(sheetConfigData[3]);    // 搜尋的工作表名稱
var searchColumn = transformColumnNum(transformArray(sheetConfigData[4]));    // 搜尋第幾欄的資料
var hiddenColumn = transformColumnNum(transformArray(sheetConfigData[5]));    // 不要將資料傳送到 Line 的欄位
var datetimeColumn =  transformColumnNum(transformArray(sheetConfigData[7]));    // 日期時間欄位
var datetimeFormatColumn =  transformArray(sheetConfigData[8]);    // 日期時間格式
var simpleModeColumn = transformColumnNum(transformArray(sheetConfigData[9]));    // 精簡模式欄位
var simpleMode = sheetConfigData[10][0];    // 精簡模式開關
var fuzzySearch = sheetConfigData[11][0];    // 模糊搜尋開關
var whiteListMode = sheetConfigData[12][0];    // 白名單模式開關
var whiteList = transformArray(sheetConfigData[13]);    // 白名單列表
var initialSearch = sheetConfigData[14][0];    // 開頭搜尋開關
var onceMaxMessages = sheetConfigData[15][0];    // 最大回傳訊息數
var carouselMaxLoad = sheetConfigData[16][0];    // 最大輪播數量
var flexImageFrameRatio = sheetConfigData[17][0] + sheetConfigData[17][1] + sheetConfigData[17][2];    // 圖片框架比例
var flexImageType = sheetConfigData[18][0] == "填滿" ? "cover" : "fit";    // 圖片填充方式
var flexTitleRatio = sheetConfigData[19][0];    // 標題比例
var flexContentRatio = sheetConfigData[19][2];    // 內容比例
var spreadSheet;    // 全局試算表對象

/**
 * 移除試算表空儲存格
 * 過濾掉陣列中的空字串元素，用於清理數據
 * 
 * @param {Array} arrayData - 要處理的陣列數據，可能包含空字串
 * @returns {Array} 過濾後的陣列，不包含空字串和無效值
 * @example
 * transformArray(['A', '', 'B', '', 'C']) // 返回 ['A', 'B', 'C']
 */
function transformArray(arrayData) {
  // 檢查arrayData是否為undefined或null，如果是則返回空陣列
  if (!arrayData) {
    Logger.log("警告: transformArray收到undefined或null值");
    return [];
  }
  return arrayData.filter(item => item !== "");
}

/**
 * 把英文字母的欄位轉換成數字
 * 用於將試算表的欄位標識轉換為數字索引
 * 
 * @param {Array<string>} arrayData - 包含欄位名稱的陣列 (如 ['A', 'B', 'AA'])
 * @returns {Array<number>} 轉換後的數字陣列，對應每個欄位的數字索引
 * @example
 * transformColumnNum(['A', 'B', 'AA']) // 返回 [1, 2, 27]
 */
function transformColumnNum(arrayData) {
  // 檢查arrayData是否為undefined或null或空陣列
  if (!arrayData || arrayData.length === 0) {
    Logger.log("警告: transformColumnNum收到空陣列或undefined值");
    return [];
  }
  
  return arrayData.map(col => {
    if (!col) {
      Logger.log("警告: transformColumnNum中發現null或undefined元素");
      return 0;
    }
    const str = col.toString().toUpperCase();
    return [...str].reduce((acc, char, i) => 
      acc + Math.pow(26, str.length - i - 1) * (char.charCodeAt(0) - 64), 0);
  });
}

/**
 * 取得資料庫
 * 根據設定的試算表ID開啟試算表，初始化全局試算表對象
 * 
 * @global
 * @function
 * @example
 * getDatabase() // 初始化 spreadSheet 全局變量
 */
function getDatabase() {
  spreadSheet = SpreadsheetApp.openById(spreadSheetId);
}

/**
 * 格式化時間為 HH:MM:SS 格式
 * 將日期對象轉換為標準時間格式字串
 * 
 * @param {Date} date - 要格式化的日期對象
 * @returns {string} 格式化後的時間字串 (HH:MM:SS)
 * @example
 * formatTime(new Date()) // 返回如 "14:30:00"
 */
function formatTime(date) {
  return [
    date.getHours().toString().padStart(2, '0'),
    date.getMinutes().toString().padStart(2, '0'),
    date.getSeconds().toString().padStart(2, '0')
  ].join(':');
}

/**
 * 計算兩個時間點之間的差異（以分鐘為單位）
 * 用於計算重生時間與當前時間的差距
 * 
 * @param {Date} date1 - 第一個日期（通常是重生時間）
 * @param {Date} date2 - 第二個日期（通常是當前時間）
 * @returns {number} 兩個日期之間的分鐘差，正數表示未來時間，負數表示過去時間
 * @example
 * calculateTimeDiff(new Date('2023-12-31'), new Date('2023-12-30')) // 返回 1440（一天的分鐘數）
 */
function calculateTimeDiff(date1, date2) {
  return Math.floor((date1.getTime() - date2.getTime()) / (1000 * 60));
}

/**
 * 列出 A 欄內容（王表）並計算重生狀態
 * 
 * 功能說明：
 * 1. 從試算表中讀取王的資料（A欄：王名稱、B欄：重生間隔、D欄：上次出現時間）
 * 2. 計算每個王的重生狀態，包括已經過了幾個重生週期
 * 3. 根據重生時間排序並返回格式化的訊息
 * 
 * 欄位說明：
 * - A欄：王的名稱
 * - B欄：重生間隔（小時）
 * - D欄：上次出現時間
 * 
 * @returns {Array<Object>} 包含王表訊息的 Line 回覆物件
 */
function listColumnA() {
  getDatabase();
  const sheet = spreadSheet.getSheets()[0];
  const range = sheet.getRange("A2:D");
  const values = range.getValues();
  const now = new Date();
  
  // 檢查並更新每個王的重生時間
  for (let i = 0; i < values.length; i++) {
    if (!values[i][0]) continue;  // 如果該行沒有王名稱，則跳過
    
    const originalSpawnTime = values[i][3];  // 保存原始時間
    const respawnHours = values[i][1];   // B欄重生間隔（小時）
    
    // 檢查 D 欄時間（上次出現時間），如果時間有效且已過期，則根據重生間隔更新時間
    if (originalSpawnTime instanceof Date && !isNaN(originalSpawnTime.getTime())) {
      // 如果有設定重生間隔（B欄），則計算新的重生時間
      if (respawnHours && !isNaN(respawnHours)) {
        const respawnInterval = parseInt(respawnHours);
        let newSpawnTime = new Date(originalSpawnTime.getTime());
        let cycles = 0;
        
        // 計算已過期的重生週期數
        while (newSpawnTime <= now) {
          newSpawnTime = new Date(newSpawnTime.getTime() + (respawnInterval * 3600000));
          cycles++;
        }
        
        // 只有當確實需要更新時（cycles > 0）才更新 D 欄
        if (cycles > 0) {
          sheet.getRange(i + 2, 4).setValue(newSpawnTime);
          values[i][3] = newSpawnTime;
          values[i].expiredCycles = cycles;  // 儲存重生次數
        }
      }
    }
  }
  
  // 過濾並格式化數據
  const bossList = values
    .filter(row => row[0])  // 過濾掉沒有王名稱的行
    .map(row => {
      let timeInfo = "";
      let timeDiffMinutes = Infinity;
      let bossName = row[0];
      
      if (row[3] instanceof Date && !isNaN(row[3].getTime())) {
        const respawnTime = row[3];  // 取得重生時間（D欄）
        const timeStr = formatTime(respawnTime);  // 格式化時間為 HH:MM:SS
        timeDiffMinutes = calculateTimeDiff(respawnTime, now);  // 計算與當前時間的差異（分鐘）
        
        // 新增過期檢查 (使用cycles值判斷是否已過期)
        const isExpired = row.expiredCycles > 0 ? '⚔' : '';
        timeInfo = `${timeStr} ➤ ${bossName}${isExpired}`;
      }
      return { timeInfo, timeDiffMinutes, bossName };
    })
    .sort((a, b) => {
      // 先按時間差排序，如果時間差相同則按王名稱排序
      const timeDiff = a.timeDiffMinutes - b.timeDiffMinutes;
      return timeDiff === 0 ? a.bossName.localeCompare(b.bossName) : timeDiff;
    })
    .map(item => item.timeInfo)
    .filter(item => item !== "")
    .join("\n");

  return [{
    type: "text",
    text: `版本: ${VERSION}\n現在時間: ${formatTime(now)}\n${bossList || "無資料"}`
  }];
}

/**
 * 重置所有王的時間
 * 清除B欄的內容，重置重生間隔
 * 
 * @param {string} clientId - 客戶端ID
 * @returns {Array<Object>} Line 回覆物件
 */
function resetAllBossTimes(clientId) {
  getDatabase();
  const sheet = spreadSheet.getSheets()[0];
  const range = sheet.getRange("B2:B");
  range.clearContent();
  
  return [{
    type: "text",
    text: "已重置所有王的時間"
  }];
}

/**
 * 處理用戶指令
 * 根據用戶輸入的指令執行相應的功能
 * 
 * 支援的指令：
 * - 出/顯：顯示王表狀態
 * - K [王名稱/編號/關鍵字] [時間]：更新王的時間
 * - 重置：重置所有王的時間
 * - ping/測試：檢查伺服器狀態
 * 
 * @param {string} message - 用戶發送的訊息
 * @returns {Array<Object>|null} Line 回覆物件，如果是未知指令則返回null（不回應）
 */
function handleCommand(message) {
  // 去除前後空白
  const trimmedMessage = message.trim();
  
  // 處理"出"或"顯"指令 - 顯示王表
  if (trimmedMessage === "出" || trimmedMessage === "顯") {
    const response = listColumnA();
    // 修改回傳訊息，添加指令說明
    response[0].text = `【王表狀態】\n${response[0].text}`;
    return response;
  }
  
  // 處理"重置"指令 - 重置所有王的時間
  if (trimmedMessage === "重置") {
    return resetAllBossTimes();
  }
  
  // 處理"K"開頭的指令 - 更新王的時間
  if (trimmedMessage.startsWith("K") || trimmedMessage.startsWith("k")) {
    return updateCellTime(trimmedMessage);
  }
  
  // 處理"ping"指令 - 測試伺服器狀態
  if (trimmedMessage.toLowerCase() === "ping" || trimmedMessage === "測試") {
    try {
      // 測試資料庫連接
      getDatabase();
      const sheet = spreadSheet.getSheets()[0];
      const testCell = sheet.getRange("A1").getValue();
      
      return [{
        type: "text",
        text: `【伺服器狀態】\n✅ Line Bot 伺服器正常運行中\n✅ 資料庫連接正常\n✅ 版本: ${VERSION}\n✅ 時間: ${new Date().toLocaleString()}`
      }];
    } catch (error) {
      return [{
        type: "text",
        text: `【伺服器狀態】\n❌ 發生錯誤: ${error.message}\n請聯繫管理員檢查伺服器狀態`
      }];
    }
  }
  
  // 未知指令 - 不回應
  return null;
}

/**
 * 測試Line Bot伺服器狀態
 * 此函數可以直接在Google Apps Script編輯器中運行，用於測試Line Bot的各項功能是否正常
 * 
 * 測試項目：
 * 1. 資料庫連接
 * 2. Line API連接
 * 3. 基本功能運作
 * 
 * @returns {object} 測試結果報告
 */
function testLineBot() {
  const results = {
    databaseConnection: false,
    lineApiConnection: false,
    functionsWorking: false,
    errors: [],
    timestamp: new Date().toLocaleString()
  };
  
  // 測試1: 資料庫連接
  try {
    getDatabase();
    const sheet = spreadSheet.getSheets()[0];
    const testCell = sheet.getRange("A1").getValue();
    results.databaseConnection = true;
    Logger.log("✅ 資料庫連接測試通過");
  } catch (error) {
    results.errors.push("資料庫連接錯誤: " + error.message);
    Logger.log("❌ 資料庫連接測試失敗: " + error.message);
  }
  
  // 測試2: Line API連接
  try {
    // 測試Line API是否可以連接（不實際發送訊息）
    const testUrl = "https://api.line.me/v2/bot/message/reply";
    const testOptions = {
      'method': 'post',
      'headers': {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + CHANNEL_ACCESS_TOKEN
      },
      'muteHttpExceptions': true
    };
    
    // 只測試連接，不發送實際訊息
    const response = UrlFetchApp.fetch("https://api.line.me/v2/bot/info", {
      'method': 'get',
      'headers': {
        'Authorization': 'Bearer ' + CHANNEL_ACCESS_TOKEN
      },
      'muteHttpExceptions': true
    });
    
    const responseCode = response.getResponseCode();
    if (responseCode === 200) {
      results.lineApiConnection = true;
      Logger.log("✅ Line API連接測試通過");
    } else {
      results.errors.push("Line API連接錯誤: 狀態碼 " + responseCode);
      Logger.log("❌ Line API連接測試失敗: 狀態碼 " + responseCode);
    }
  } catch (error) {
    results.errors.push("Line API連接錯誤: " + error.message);
    Logger.log("❌ Line API連接測試失敗: " + error.message);
  }
  
  // 測試3: 基本功能運作
  try {
    // 測試listColumnA函數
    const testResponse = listColumnA();
    if (testResponse && testResponse.length > 0) {
      results.functionsWorking = true;
      Logger.log("✅ 基本功能測試通過");
    } else {
      results.errors.push("基本功能測試錯誤: 回傳值無效");
      Logger.log("❌ 基本功能測試失敗: 回傳值無效");
    }
  } catch (error) {
    results.errors.push("基本功能測試錯誤: " + error.message);
    Logger.log("❌ 基本功能測試失敗: " + error.message);
  }
  
  // 輸出總結果
  if (results.databaseConnection && results.lineApiConnection && results.functionsWorking) {
    Logger.log("✅✅✅ 所有測試通過，Line Bot伺服器運作正常");
  } else {
    Logger.log("❌❌❌ 測試失敗，Line Bot伺服器可能有問題");
    Logger.log("錯誤詳情: " + results.errors.join("; "));
  }
  
  return results;
}

/**
 * 處理來自Line的POST請求
 * 這是Google Apps Script的入口點，用於接收Line Webhook發送的訊息
 * 
 * @param {object} e - POST請求事件對象
 * @returns {object} 回應Line的HTTP回應
 */
function doPost(e) {
  try {
    // 解析Line傳來的JSON數據
    const data = JSON.parse(e.postData.contents);
    
    // 記錄接收到的數據，用於調試
    Logger.log("收到Line請求: " + JSON.stringify(data));
    
    // 處理Line事件
    const events = data.events;
    
    // 如果沒有事件，直接返回成功
    if (!events || events.length === 0) {
      return ContentService.createTextOutput(JSON.stringify({ status: 'success' }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    
    // 處理每個事件
    for (let i = 0; i < events.length; i++) {
      const event = events[i];
      
      // 只處理文字訊息
      if (event.type === 'message' && event.message.type === 'text') {
        const userMessage = event.message.text;
        const replyToken = event.replyToken;
        
        // 使用handleCommand處理用戶指令
        const response = handleCommand(userMessage);
        
        // 只有當有回應時才發送訊息
        if (response) {
          replyToLine(replyToken, response);
        }
      }
    }
    
    // 返回成功狀態
    return ContentService.createTextOutput(JSON.stringify({ status: 'success' }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    // 記錄錯誤
    Logger.log("處理Line請求時發生錯誤: " + error.message);
    Logger.log("錯誤堆疊: " + error.stack);
    
    // 返回錯誤狀態
    return ContentService.createTextOutput(JSON.stringify({ 
      status: 'error', 
      message: error.message 
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * 回覆訊息給Line用戶
 * 
 * @param {string} replyToken - Line提供的回覆令牌
 * @param {Array<object>} messages - 要發送的訊息陣列
 */
function replyToLine(replyToken, messages) {
  const url = 'https://api.line.me/v2/bot/message/reply';
  
  const payload = {
    replyToken: replyToken,
    messages: messages
  };
  
  const options = {
    'method': 'post',
    'headers': {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + CHANNEL_ACCESS_TOKEN
    },
    'payload': JSON.stringify(payload),
    'muteHttpExceptions': true
  };
  
  try {
    const response = UrlFetchApp.fetch(url, options);
    const responseCode = response.getResponseCode();
    const responseBody = response.getContentText();
    
    if (responseCode !== 200) {
      Logger.log("Line API回覆錯誤: " + responseCode);
      Logger.log("回應內容: " + responseBody);
    }
  } catch (error) {
    Logger.log("發送Line回覆時發生錯誤: " + error.message);
  }
}

/**
 * 更新王的時間
 * 支援兩種方式更新：
 * 1. 通過王的編號（數字）
 * 2. 通過王的名稱或關鍵字
 * 
 * 功能說明：
 * - 接收以"K"或"k"開頭的指令
 * - 解析指令中的王名稱/編號/關鍵字和可選的時間參數
 * - 更新對應王的時間（D欄）
 * - 如果提供了時間參數，則使用指定時間；否則使用當前時間
 * 
 * 指令格式：K [王名稱/編號/關鍵字] [時間(選填，格式HHMMSS)]
 * 例如：
 * - K 1（更新第1個王的時間為當前時間）
 * - K 龍王 235959（更新名為"龍王"的王的時間為23:59:59）
 * 
 * @param {string} message - 用戶發送的訊息（以K開頭）
 * @returns {Array<Object>} Line 回覆物件，包含更新結果訊息
 */
function updateCellTime(message) {
  getDatabase();
  const sheet = spreadSheet.getSheets()[0];
  
  // 移除開頭的 K
  const command = message.substring(1).trim();
  
  // 分割指令和時間
  const parts = command.split(/\s+/);
  const searchTerm = parts[0].toLowerCase();
  const timeString = parts[1];
  
  // 檢查是否為數字（行號）
  if (!isNaN(searchTerm)) {
    const bossNumber = parseInt(searchTerm) - 1;
    if (bossNumber < 0) {
      return [{type: "text", text: "無效的王編號"}];
    }
    const now = new Date();
    const cell = sheet.getRange(bossNumber + 2, 4);
    cell.setValue(now);
    return [{
      type: "text",
      text: `已更新第 ${bossNumber + 1} 王的時間為 ${now.toLocaleString()}`
    }];
  }
  
  // 使用關鍵字搜尋
  const data = sheet.getRange("A2:E" + sheet.getLastRow()).getValues();
  let found = false;
  let rowNumber = -1;
  
  // 搜尋名稱或關鍵字
  for (let i = 0; i < data.length; i++) {
    if (data[i][0].toString().toLowerCase() === searchTerm) {
      rowNumber = i + 2;
      found = true;
      break;
    }
    // 檢查關鍵字（E欄）
    if (data[i][4]) {
      const keywords = data[i][4].toString().toLowerCase().split(',');
      if (keywords.some(k => k.trim() === searchTerm)) {
        rowNumber = i + 2;
        found = true;
        break;
      }
    }
  }
  
  if (!found) {
    return [{type: "text", text: `找不到名稱或關鍵字為「${searchTerm}」的王`}];
  }
  
  // 更新時間
  const now = new Date();
  if (timeString) {
    const hours = parseInt(timeString.substring(0, 2));
    const minutes = parseInt(timeString.substring(2, 4));
    const seconds = parseInt(timeString.substring(4, 6));
    
    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59 || seconds < 0 || seconds > 59) {
      return [{type: "text", text: "時間格式錯誤，請使用HHMMSS格式（例如：235959）"}];
    }
    
    // 設定指定時間
    now.setHours(hours);
    now.setMinutes(minutes);
    now.setSeconds(seconds);
  }
  
  // 更新時間
  sheet.getRange(rowNumber, 4).setValue(now);
  return [{
    type: "text",
    text: `已更新「${data[rowNumber-2][0]}」的時間為 ${now.toLocaleString()}`
  }];
}
