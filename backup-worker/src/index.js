const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const FIRESTORE_SCOPE = 'https://www.googleapis.com/auth/datastore';
const BACKUP_APPS = [
  { name: 'phone-count', projectId: 'phone-count', kind: 'document', path: 'phone_count_workspaces/main' },
  {
    name: 'vapes',
    projectId: 'vapes-1a7d0',
    kind: 'collections',
    collections: ['vapes_stores', 'vapes_products', 'vapes_stock', 'vapes_activity', 'vapes_access'],
  },
];

const encoder = new TextEncoder();

function toBase64Url(value) {
  const bytes = value instanceof Uint8Array ? value : encoder.encode(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function pkcs8FromPem(privateKey) {
  const base64 = privateKey.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, '');
  const binary = atob(base64);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function getGoogleAccessToken(serviceAccountJson) {
  const serviceAccount = JSON.parse(serviceAccountJson);
  if (!serviceAccount.client_email || !serviceAccount.private_key) {
    throw new Error('The Google service-account secret is incomplete.');
  }

  const now = Math.floor(Date.now() / 1000);
  const unsignedToken = `${toBase64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${toBase64Url(JSON.stringify({
    iss: serviceAccount.client_email,
    scope: FIRESTORE_SCOPE,
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600,
  }))}`;
  const signingKey = await crypto.subtle.importKey(
    'pkcs8',
    pkcs8FromPem(serviceAccount.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', signingKey, encoder.encode(unsignedToken)));
  const tokenResponse = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${unsignedToken}.${toBase64Url(signature)}`,
    }),
  });
  if (!tokenResponse.ok) throw new Error(`Google token request failed (${tokenResponse.status}).`);
  const token = await tokenResponse.json();
  if (!token.access_token) throw new Error('Google did not return an access token.');
  return token.access_token;
}

async function firestoreGet(projectId, path, accessToken) {
  const response = await fetch(`https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${path}`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) throw new Error(`Firestore read failed for ${projectId}/${path} (${response.status}).`);
  return response.json();
}

async function firestoreCollection(projectId, collection, accessToken) {
  const documents = [];
  let pageToken = '';
  do {
    const url = new URL(`https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${collection}`);
    url.searchParams.set('pageSize', '1000');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const response = await fetch(url, { headers: { authorization: `Bearer ${accessToken}` } });
    if (!response.ok) throw new Error(`Firestore collection read failed for ${projectId}/${collection} (${response.status}).`);
    const page = await response.json();
    documents.push(...(page.documents || []));
    pageToken = page.nextPageToken || '';
  } while (pageToken);
  return documents;
}

async function snapshotApp(app, accessToken) {
  if (app.kind === 'document') {
    return { kind: 'document', document: await firestoreGet(app.projectId, app.path, accessToken) };
  }

  const collections = {};
  for (const collection of app.collections) {
    collections[collection] = await firestoreCollection(app.projectId, collection, accessToken);
  }
  return { kind: 'collections', collections };
}

async function storeBackup(database, appName, capturedAt, payload) {
  await database
    .prepare('INSERT INTO backups (app, captured_at, payload) VALUES (?, ?, ?)')
    .bind(appName, capturedAt, JSON.stringify(payload))
    .run();

  const monthAgo = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
  await database.batch([
    database.prepare('DELETE FROM backups WHERE app = ? AND captured_at < ?').bind(appName, monthAgo),
    database.prepare(`DELETE FROM backups
      WHERE app = ? AND captured_at NOT IN (
        SELECT captured_at FROM backups WHERE app = ? ORDER BY captured_at DESC LIMIT 4
      )`).bind(appName, appName),
  ]);
}

async function runBackups(env) {
  if (!env.GOOGLE_SERVICE_ACCOUNT_JSON) throw new Error('Backup worker secret is not configured.');
  const accessToken = await getGoogleAccessToken(env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const capturedAt = new Date().toISOString();

  for (const app of BACKUP_APPS) {
    const snapshot = await snapshotApp(app, accessToken);
    await storeBackup(env.BACKUPS, app.name, capturedAt, { version: 1, capturedAt, ...snapshot });
  }
}

export default {
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(runBackups(env));
  },
  fetch() {
    return new Response('Not found', { status: 404 });
  },
};
