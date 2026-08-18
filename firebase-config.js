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

// const firebaseConfig = {
  // // PASTE the new Day-1 Firebase web app config here (Project settings -> Your apps).
  // apiKey: "AIzaSyBHZfsYdmWvtacR6QmeWKcV70t0BTek24U",
  // authDomain: "accolade-clo.firebaseapp.com",
  // projectId: "accolade-clo",
  // storageBucket: "accolade-clo.firebasestorage.app",
  // messagingSenderId: "467911820664",
  // appId: "1:467911820664:web:fa7b3062c7c33c1276748d",
  // measurementId: "G-HS0KR9DZR8",

  // <script type="module">
  // // Import the functions you need from the SDKs you need
  // import { initializeApp } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-app.js";
  // import { getAnalytics } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-analytics.js";
  // TODO: Add SDKs for Firebase products that you want to use
  // https://firebase.google.com/docs/web/setup#available-libraries

  // Your web app's Firebase configuration
  // For Firebase JS SDK v7.20.0 and later, measurementId is optional
  const firebaseConfig = {
    apiKey: "AIzaSyDopQxnz7rx5aXcgDNDCYMxP9x_XPgmfLM",
    authDomain: "tultulus.firebaseapp.com",
    projectId: "tultulus",
    storageBucket: "tultulus.firebasestorage.app",
    messagingSenderId: "288715406498",
    appId: "1:288715406498:web:b7dc71ffb5e74de7b32bfb",
    measurementId: "G-QK92B1EGV0"
  };

//   // Initialize Firebase
//   const app = initializeApp(firebaseConfig);
//   const analytics = getAnalytics(app);
// </script>
// };

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


{/* <script type="module">
  // Import the functions you need from the SDKs you need
  import { initializeApp } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-app.js";
  import { getAnalytics } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-analytics.js";
  // TODO: Add SDKs for Firebase products that you want to use
  // https://firebase.google.com/docs/web/setup#available-libraries

  // Your web app's Firebase configuration
  // For Firebase JS SDK v7.20.0 and later, measurementId is optional
  const firebaseConfig = {
    apiKey: "AIzaSyDopQxnz7rx5aXcgDNDCYMxP9x_XPgmfLM",
    authDomain: "tultulus.firebaseapp.com",
    projectId: "tultulus",
    storageBucket: "tultulus.firebasestorage.app",
    messagingSenderId: "288715406498",
    appId: "1:288715406498:web:b7dc71ffb5e74de7b32bfb",
    measurementId: "G-QK92B1EGV0"
  };

  // Initialize Firebase
  const app = initializeApp(firebaseConfig);
  const analytics = getAnalytics(app);
</script> */}