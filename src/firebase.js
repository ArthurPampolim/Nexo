import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyAZpUMT6-3XMJIUPfoGS0aAHKXX3mzJ7AY",
  authDomain: "projeto---nexo.firebaseapp.com",
  projectId: "projeto---nexo",
  storageBucket: "projeto---nexo.firebasestorage.app",
  messagingSenderId: "1065645957072",
  appId: "1:1065645957072:web:a868bd2cfb82e5b381a3d5"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);