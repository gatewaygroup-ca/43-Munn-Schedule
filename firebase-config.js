/* ============================================================
   FIREBASE CONFIG — 43 Munn Schedule
   Realtime Database powers live, cross-device sync.
   ============================================================ */

const firebaseConfig = {
  apiKey: "AIzaSyD6fNaRHUGuHqNM9Y93TzKK5oybC_ZVqMk",
  authDomain: "munn-schedule.firebaseapp.com",
  databaseURL: "https://munn-schedule-default-rtdb.firebaseio.com",
  projectId: "munn-schedule",
  storageBucket: "munn-schedule.firebasestorage.app",
  messagingSenderId: "785773530393",
  appId: "1:785773530393:web:d3e4faccc8457277798988"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.database();
