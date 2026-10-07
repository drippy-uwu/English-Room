// Pega aquí el objeto de Firebase Console > Configuración > Tus apps > Web.
// Esta configuración es pública. Nunca pegues una cuenta de servicio ni claves privadas.
export const firebaseConfig = {
  apiKey: "AIzaSyDfGUhjCyhm563IZRlwXJrnq2F0DuoTCbI",
  authDomain: "english-room-acbd7.firebaseapp.com",
  databaseURL: 'https://english-room-acbd7-default-rtdb.firebaseio.com/', // Copia la URL EXACTA de Realtime Database, incluida la región.
  projectId: "english-room-acbd7",
  storageBucket: "english-room-acbd7.firebasestorage.app",
  messagingSenderId: "797306180950",
  appId: "1:797306180950:web:87a5c6526e3ff630cef2f7"
};

// Todos los dispositivos comparten esta sala. No cambia con el nombre del jugador.
export const ROOM_PATH = 'rooms/lounge';
