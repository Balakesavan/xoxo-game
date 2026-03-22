// =============================================================
// FIREBASE CONFIGURATION
// Replace the values below with your own Firebase project config.
// See README.md for step-by-step setup instructions.
// =============================================================

const firebaseConfig = {
  apiKey: "AIzaSyA_2HwD66VxBtk6chEnfSLT0BspLMTqd-I",
  authDomain: "xoxo-game-b726f.firebaseapp.com",
  databaseURL: "https://xoxo-game-b726f-default-rtdb.firebaseio.com",
  projectId: "xoxo-game-b726f",
  storageBucket: "xoxo-game-b726f.firebasestorage.app",
  messagingSenderId: "40045465729",
  appId: "1:40045465729:web:e5a4f823f9559c7132fd80",
  measurementId: "G-YZ3ELB9YWY"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const db = firebase.database();
