import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyBML9HZi00i9cFm_haxTLZMpaamf8XBlIA",
  authDomain: "colabam-f675c.firebaseapp.com",
  projectId: "colabam-f675c",
  storageBucket: "colabam-f675c.firebasestorage.app",
  messagingSenderId: "732288039711",
  appId: "1:732288039711:web:04b7949348cf8f46184e2a",
  measurementId: "G-G7H0WSL006"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db   = getFirestore(app);
