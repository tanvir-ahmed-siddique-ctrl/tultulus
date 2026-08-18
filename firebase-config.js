import { initializeApp } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  serverTimestamp,
  updateDoc,
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

// apiKey is filled at Netlify build from FIREBASE_WEB_API_KEY. Never commit the live key.
const firebaseConfig = {
  apiKey: "",
  authDomain: "tultulus.firebaseapp.com",
  projectId: "tultulus",
  storageBucket: "tultulus.firebasestorage.app",
  messagingSenderId: "288715406498",
  appId: "1:288715406498:web:b7dc71ffb5e74de7b32bfb",
  measurementId: "G-QK92B1EGV0",
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

export {
  addDoc,
  auth,
  collection,
  db,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onAuthStateChanged,
  serverTimestamp,
  signInWithEmailAndPassword,
  signOut,
  updateDoc,
};
