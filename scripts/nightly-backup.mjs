import { createSign, createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function parseInventory(document) {
  const payload = document?.fields?.payload?.stringValue;
  if (!payload) throw new Error('Firebase document has no inventory payload.');
  const data = JSON.parse(payload);
  if (!data || !['shops', 'categories', 'items', 'movements'].every(k => Array.isArray(data[k])))
    throw new Error('Invalid inventory: no backup pointers were changed.');
  return { data, payload, hash: createHash('sha256').update(payload).digest('hex') };
}

export async function saveSnapshot(document, directory) {
  const { data, hash } = parseInventory(document);
  await mkdir(directory, { recursive: true });
  let previous;
  try { previous = JSON.parse(await readFile(resolve(directory, 'latest.json'), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (previous?.hash === hash) return false;
  const revision = document.fields.revision?.integerValue;
  if (!/^\d+$/.test(String(revision))) throw new Error('Missing revision.');
  const capturedAt = new Date().toISOString();
  const snapshot = { capturedAt, hash, document, inventory: data };
  const filename = 'snapshots/' + capturedAt.replace(/[:.]/g, '-') + '-r' + revision + '.json';
  await mkdir(resolve(directory, 'snapshots'), { recursive: true });
  await writeFile(resolve(directory, filename), JSON.stringify(snapshot, null, 2) + '\n', { flag: 'wx' });
  const pointer = JSON.stringify({ capturedAt, hash, revision, filename, itemCount: data.items.length }, null, 2) + '\n';
  await writeFile(resolve(directory, 'latest.json'), pointer);
  // Empty snapshots are retained for diagnosis but cannot replace a usable recovery point.
  if (data.items.length) await writeFile(resolve(directory, 'latest-nonempty.json'), pointer);
  return true;
}

async function run() {
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON secret is not configured.');
  const account = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const now = Math.floor(Date.now() / 1000);
  const base64 = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const unsigned = base64({ alg: 'RS256', typ: 'JWT' }) + '.' + base64({
    iss: account.client_email, scope: 'https://www.googleapis.com/auth/datastore',
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600
  });
  const signature = createSign('RSA-SHA256').update(unsigned).sign(account.private_key, 'base64url');
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: unsigned + '.' + signature
    })
  });
  if (!tokenResponse.ok) throw new Error('Google token request failed: ' + tokenResponse.status);
  const token = await tokenResponse.json();
  if (!token.access_token) throw new Error('Google returned no access token.');
  const response = await fetch('https://firestore.googleapis.com/v1/projects/phone-count/databases/(default)/documents/phone_count_workspaces/main', {
    headers: { authorization: 'Bearer ' + token.access_token }
  });
  if (!response.ok) throw new Error('Firebase backup read failed: ' + response.status);
  const changed = await saveSnapshot(await response.json(), process.argv[2] || 'backup-state');
  console.log(changed ? 'Changed inventory snapshot saved.' : 'Inventory unchanged; no backup commit needed.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run().catch(error => { console.error(error.message); process.exitCode = 1; });
}
