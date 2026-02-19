// src/firebase.js
// ─────────────────────────────────────────────────────────────
// Replace the placeholder values below with your own Firebase
// project credentials. You'll find these in the Firebase Console
// under Project Settings → Your Apps → SDK setup and configuration.
// ─────────────────────────────────────────────────────────────

import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";

const firebaseConfig = {
  apiKey:            "AIzaSyAmXV3xQDpa17DGclYOZx2K5OBMxOJqKrw",
  authDomain:        "spark-stock-40285.firebaseapp.com",
  projectId:         "spark-stock-40285",
  storageBucket:     "spark-stock-40285.firebasestorage.app",
  messagingSenderId: "247301540306",
  appId:             "1:247301540306:web:8d34bca21bd6e8c22a600b",
};

const app  = initializeApp(firebaseConfig);
export const db   = getFirestore(app);
export const auth = getAuth(app);
