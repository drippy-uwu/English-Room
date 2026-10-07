import { firebaseConfig, ROOM_PATH } from './firebase-config.js';

const SDK_VERSION = '12.19.0';
let connection;

export function withTimeout(promise, ms = 12000, message = 'Firebase no responde. Revisa tu conexión.') {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); })
  ]).finally(() => clearTimeout(timer));
}

export async function connectFirebase() {
  if (!firebaseConfig.apiKey || !firebaseConfig.projectId || !firebaseConfig.appId || !firebaseConfig.databaseURL) {
    throw new Error('Falta configurar Firebase. Sigue README.md y pega firebaseConfig en firebase-config.js.');
  }
  if (!/^https:\/\/[a-z0-9.-]+\.(firebaseio\.com|firebasedatabase\.app)\/?$/i.test(firebaseConfig.databaseURL)) {
    throw new Error('databaseURL debe ser la URL HTTPS de tu Realtime Database, sin rutas adicionales.');
  }
  if (!connection) {
    connection = withTimeout(Promise.all([
      import(`https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-app.js`),
      import(`https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-database.js`)
    ])).then(([appSDK, sdk]) => {
      const app = appSDK.initializeApp(firebaseConfig);
      return { sdk, db: sdk.getDatabase(app), path: ROOM_PATH };
    }).catch(error => { connection = null; throw error; });
  }
  return connection;
}

export function friendlyError(error) {
  const code = String(error?.code || error?.message || '').toLowerCase();
  if (code.includes('permission') || code.includes('denied')) return 'Firebase rechazó la operación. Revisa las reglas de Realtime Database.';
  if (code.includes('network') || code.includes('fetch') || code.includes('import')) return 'No se pudo conectar a Firebase. Revisa internet y vuelve a intentar.';
  return error?.message || 'Ocurrió un problema. Vuelve a intentar.';
}
