import { firebaseConfig, ROOM_PATH } from './firebase-config.js';

const SDK_VERSION = '12.19.0';
let connection;

export function withTimeout(promise, ms = 12000, message = 'The room is not responding. Check your connection and try again.') {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); })
  ]).finally(() => clearTimeout(timer));
}

export async function connectFirebase() {
  if (!firebaseConfig.apiKey || !firebaseConfig.projectId || !firebaseConfig.appId || !firebaseConfig.databaseURL) {
    throw new Error('The room is not configured yet. Please ask the host to check its settings.');
  }
  if (!/^https:\/\/[a-z0-9.-]+\.(firebaseio\.com|firebasedatabase\.app)\/?$/i.test(firebaseConfig.databaseURL)) {
    throw new Error('The room connection is not configured correctly. Please ask the host to check its settings.');
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
  if (code.includes('permission') || code.includes('denied')) return 'The room could not accept this action. Please ask the host to check its settings.';
  if (code.includes('network') || code.includes('fetch') || code.includes('import')) return 'Could not connect to the room. Check your internet connection and try again.';
  return error?.message || 'Something went wrong. Please try again.';
}
