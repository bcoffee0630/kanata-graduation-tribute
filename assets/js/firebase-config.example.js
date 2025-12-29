/**
 * Firebase Configuration Template
 * Firebase 設定範本
 *
 * Instructions / 使用說明:
 * 1. Copy this file and rename to: firebase-config.js
 *    複製此檔案並重新命名為: firebase-config.js
 *
 * 2. Replace the placeholder values with your Firebase project config
 *    將下方的佔位符替換為你的 Firebase 專案設定
 *
 * 3. IMPORTANT: firebase-config.js is in .gitignore and will NOT be uploaded
 *    重要: firebase-config.js 已被 .gitignore 排除，不會被上傳
 *
 * To get your config / 取得設定方式:
 * 1. Go to Firebase Console: https://console.firebase.google.com/
 * 2. Select your project / 選擇你的專案
 * 3. Click the gear icon > Project settings / 點擊齒輪圖示 > 專案設定
 * 4. Scroll to "Your apps" > Select web app / 滾動到「您的應用程式」> 選擇網頁應用程式
 * 5. Copy the firebaseConfig object / 複製 firebaseConfig 物件
 */

const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId: "YOUR_APP_ID"
};

// Do not modify below this line / 請勿修改以下內容
export default firebaseConfig;
