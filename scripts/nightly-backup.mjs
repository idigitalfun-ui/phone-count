import { createSign, createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, readdir, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function parseServiceAccount(value) {
  let account;
  try { account = JSON.parse(String(value).replace(/^\uFEFF/, '').trim()); }
  catch { throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON must contain the complete downloaded JSON file contents, not its filename or path.'); }
  if (account?.type !== 'service_account' || account.project_id !== 'phone-count' ||
      account.client_email !== 'phone-count-inventory-backup@phone-count.iam.gserviceaccount.com' ||
      typeof account.private_key !== 'string' || !account.private_key.includes('-----BEGIN PRIVATE KEY-----'))
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON must be the dedicated phone-count inventory backup service account key.');
  return account;
}

export function parseInventory(document) {
  const payload = document?.fields?.payload?.stringValue;
  if (!payload) throw new Error('Firebase document has no inventory payload.');
  const data = JSON.parse(payload);
  if (!data || !['shops', 'categories', 'items', 'movements'].every(k => Array.isArray(data[k])))
    throw new Error('Invalid inventory: no backup pointers were changed.');
  const comparable = structuredClone(data);
  if (comparable.meta) {
    delete comparable.meta.lastSaved;
    if (!Object.keys(comparable.meta).length) delete comparable.meta;
  }
  const stable = value => Array.isArray(value) ? value.map(stable) :
    value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])) : value;
  return { data, payload, hash: createHash('sha256').update(JSON.stringify(stable(comparable))).digest('hex') };
}

async function pruneSnapshots(directory, protectedFilename) {
  const folder = resolve(directory, 'snapshots');
  let files;
  try { files = (await readdir(folder)).filter(name => /^\d{4}-\d{2}-\d{2}T[\dZ-]+-r\d+\.json$/.test(name)).sort().reverse(); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  const keep = files.slice(0, 3);
  const protectedName = protectedFilename?.startsWith('snapshots/') ? protectedFilename.slice(10) : null;
  // Keep the last usable recovery point within the three-file limit if legacy empty snapshots exist.
  if (files.includes(protectedName) && !keep.includes(protectedName)) keep[keep.length - 1] = protectedName;
  for (const name of files) if (!keep.includes(name)) await unlink(resolve(folder, name));
}

export async function saveSnapshot(document, directory, { now = new Date(), report = () => {} } = {}) {
  const { data, hash } = parseInventory(document);
  await mkdir(directory, { recursive: true });
  let previous;
  try { previous = JSON.parse(await readFile(resolve(directory, 'latest.json'), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  let nonempty;
  try { nonempty = JSON.parse(await readFile(resolve(directory, 'latest-nonempty.json'), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const capturedAt = now.toISOString();
  if (previous?.hash === hash) {
    await pruneSnapshots(directory, nonempty?.filename);
    report('Inventory unchanged; no new backup.');
    return false;
  }
  if (previous?.capturedAt?.slice(0, 10) >= capturedAt.slice(0, 10)) {
    await pruneSnapshots(directory, nonempty?.filename);
    report('A backup already exists for this UTC night; later changes will be saved next night.');
    return false;
  }
  if (!data.items.length && nonempty) throw new Error('Empty inventory blocked; previous usable backups preserved.');
  const revision = document.fields.revision?.integerValue;
  if (!/^\d+$/.test(String(revision))) throw new Error('Missing revision.');
  const snapshot = { capturedAt, hash, document, inventory: data };
  const filename = 'snapshots/' + capturedAt.replace(/[:.]/g, '-') + '-r' + revision + '.json';
  await mkdir(resolve(directory, 'snapshots'), { recursive: true });
  await writeFile(resolve(directory, filename), JSON.stringify(snapshot, null, 2) + '\n', { flag: 'wx' });
  const pointer = JSON.stringify({ capturedAt, hash, revision, filename, itemCount: data.items.length }, null, 2) + '\n';
  await writeFile(resolve(directory, 'latest.json'), pointer);
  // An initial empty workspace cannot become the last usable recovery point.
  if (data.items.length) await writeFile(resolve(directory, 'latest-nonempty.json'), pointer);
  await pruneSnapshots(directory, data.items.length ? filename : nonempty?.filename);
  report('Changed inventory snapshot saved; at most three backups retained.');
  return true;
}

async function run() {
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON secret is not configured.');
  const account = parseServiceAccount(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
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
  await saveSnapshot(await response.json(), process.argv[2] || 'backup-state', { report: message => console.log(message) });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run().catch(error => { console.error(error.message); process.exitCode = 1; });
}
