import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseInventory, saveSnapshot } from '../scripts/nightly-backup.mjs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
function inventory(count = 20, moves = 5) {
  return { shops: [], categories: [], items: Array.from({ length: count }, (_, id) => ({ id })), movements: Array.from({ length: moves }, (_, id) => ({ id })) };
}
function setup({ revision = 10, loaded = true, remote = inventory(), next = inventory(), history = null } = {}) {
  const writes = [], messages = [];
  const previous = { payload: JSON.stringify(remote), revision: 10 };
  const user = { uid: 'admin', getIdTokenResult: async () => ({ claims: { email: 'idigitalfun@gmail.com', email_verified: true } }) };
  const context = vm.createContext({
    Store: { data: next, snapshotToBackups(){} }, Toast: { show: (...args) => messages.push(args) },
    console: { error(){} }, setTimeout, clearTimeout, updateSaveIndicator(){},
    window: {}, localStorage: { setItem(){} }, STORAGE_KEY: 'test', render(){}
  });
  const start = html.indexOf('const FirebaseStore = {');
  const end = html.indexOf('\n};', start) + 3;
  vm.runInContext(html.slice(start, end) + '\nthis.subject=FirebaseStore;', context);
  const subject = context.subject;
  subject._revision = revision;
  subject._loadedUid = loaded ? user.uid : null;
  subject.user = async () => user;
  subject.canUseWorkspace = async () => true;
  subject.ready = async () => ({
    db: {}, doc: (_db,...parts) => parts.join('/'),
    serverTimestamp: () => 'server',
    runTransaction: async (_db, callback) => callback({
      get: async ref => ref.includes('/versions/') ? { exists: () => !!history, data: () => history } : { exists: () => true, data: () => previous },
      set: (ref, value) => writes.push({ type:'set', ref, value }),
      update: (ref, value) => writes.push({ type:'update', ref, value })
    })
  });
  return { subject, writes, previous, user, messages };
}

test('cannot save before cloud revision is loaded, or for another account', async () => {
  for (const options of [{ revision:null }, { loaded:false }]) {
    const { subject, writes } = setup(options);
    await subject.saveRemote();
    assert.equal(writes.length,0);
    assert.match(subject._lastSaveError,/Load Firebase/);
  }
});
test('rejects empty and bulk-loss inventory and shortened history', async () => {
  for (const next of [inventory(0),inventory(4),inventory(20,0),inventory(20,4)]) {
    const {subject,writes}=setup({next});
    await subject.saveRemote();
    assert.equal(writes.length,0);
    assert.match(subject._lastSaveError,/Blocked/);
  }
});
test('normal save preserves exact previous document before updating', async () => {
  const {subject,writes,previous}=setup({next:inventory(21,6)});
  await subject.saveRemote();
  assert.equal(writes.length,2);
  assert.equal(writes[0].ref,'phone_count_workspaces/main/versions/10');
  assert.deepEqual(writes[0].value,previous);
  assert.equal(writes[1].value.revision,11);
});
test('stale revisions and conflicting recovery copies cannot write', async () => {
  for (const options of [{revision:9},{history:{payload:'wrong'}}]) {
    const {subject,writes}=setup(options);
    await subject.saveRemote();
    assert.equal(writes.length,0);
  }
});
test('existing verified email administrator is accepted', async () => {
  const {subject,user}=setup();
  assert.equal(await subject.isAdmin(user),true);
  user.getIdTokenResult=async()=>({claims:{email:'unknown@example.com',email_verified:true}});
  assert.equal(await subject.isAdmin(user),false);
  user.getIdTokenResult=async()=>({claims:{email:'ranakaharian1@gmail.com',email_verified:false}});
  assert.equal(await subject.isAdmin(user),false);
});
test('backup is change-only and empty snapshots retain last nonempty pointer', async () => {
  const directory=await mkdtemp(join(tmpdir(),'phone-count-test-'));
  const doc=data=>({fields:{payload:{stringValue:JSON.stringify(data)},revision:{integerValue:'10'}}});
  try {
    const good=doc(inventory());
    assert.equal(await saveSnapshot(good,directory),true);
    const pointer=await readFile(join(directory,'latest-nonempty.json'),'utf8');
    assert.equal(await saveSnapshot(good,directory),false);
    const sameWithSaveTime=doc({...inventory(),meta:{lastSaved:'2026-10-02T00:00:00Z'}});
    const a=parseInventory(doc({...inventory(),meta:{lastSaved:'2026-10-01T00:00:00Z'}})).hash;
    assert.equal(parseInventory(sameWithSaveTime).hash,a);
    assert.equal((await readdir(join(directory,'snapshots'))).length,1);
    assert.equal(await saveSnapshot(doc(inventory(0,0)),directory),true);
    assert.equal(await readFile(join(directory,'latest-nonempty.json'),'utf8'),pointer);
    assert.throws(()=>parseInventory(doc({items:[]})),/Invalid inventory/);
  } finally { await rm(directory,{recursive:true,force:true}); }
});
