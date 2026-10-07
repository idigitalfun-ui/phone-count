import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseInventory, saveSnapshot, parseServiceAccount } from '../scripts/nightly-backup.mjs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
test('backup credential validation rejects wrong accounts and never prints malformed secret text', () => {
  const account={type:'service_account',project_id:'phone-count',client_email:'phone-count-inventory-backup@phone-count.iam.gserviceaccount.com',private_key:'-----BEGIN PRIVATE KEY-----\\nTEST ONLY'};
  assert.deepEqual(parseServiceAccount('\uFEFF'+JSON.stringify(account)),account);
  for (const text of ['private-secret-invalid', JSON.stringify({...account,client_email:'another@example.com'}),JSON.stringify({...account,project_id:'another-project'})]) {
    assert.throws(()=>parseServiceAccount(text),error=>error.message.includes('GOOGLE_SERVICE_ACCOUNT_JSON')&&!error.message.includes('private-secret-invalid')&&!error.message.includes('TEST ONLY'));
  }
});
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
    window: {}, localStorage: { setItem(){} }, STORAGE_KEY: 'test', render(){}, AccessScreen: {show(){},hide(){}}
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
test('approved password account is pinned by UID without email verification', async () => {
  const {subject,user}=setup();
  assert.equal(await subject.isAdmin(user),true);
  user.getIdTokenResult=async()=>({claims:{email:'unknown@example.com',email_verified:true}});
  assert.equal(await subject.isAdmin(user),false);
  user.uid='zXvU1cxgtoMSnyqL7FIGDZ4oh7i2';
  user.getIdTokenResult=async()=>({claims:{email:'ranakaharian1@gmail.com',email_verified:true}});
  assert.equal(await subject.isAdmin(user),true);
  user.getIdTokenResult=async()=>({claims:{email:'ranakaharian1@gmail.com',email_verified:false}});
  assert.equal(await subject.isAdmin(user),true);
  user.uid='another-user';
  assert.equal(await subject.isAdmin(user),false);
});
test('backup is change-only, once per UTC night, and blocks empty inventory loss', async () => {
  const directory=await mkdtemp(join(tmpdir(),'phone-count-test-'));
  const doc=data=>({fields:{payload:{stringValue:JSON.stringify(data)},revision:{integerValue:'10'}}});
  try {
    const good=doc(inventory());
    const night = day => ({now:new Date(`2026-10-${String(day).padStart(2,'0')}T01:17:00Z`)});
    assert.equal(await saveSnapshot(good,directory,night(1)),true);
    const pointer=await readFile(join(directory,'latest-nonempty.json'),'utf8');
    assert.equal(await saveSnapshot(good,directory,night(1)),false);
    const changed=doc(inventory(21,6));
    assert.equal(await saveSnapshot(changed,directory,night(1)),false);
    assert.equal(await readFile(join(directory,'latest-nonempty.json'),'utf8'),pointer);
    const sameWithSaveTime=doc({...inventory(),meta:{lastSaved:'2026-10-02T00:00:00Z'}});
    const a=parseInventory(doc({...inventory(),meta:{lastSaved:'2026-10-01T00:00:00Z'}})).hash;
    assert.equal(parseInventory(sameWithSaveTime).hash,a);
    assert.equal(await saveSnapshot(sameWithSaveTime,directory,night(2)),false);
    assert.equal((await readdir(join(directory,'snapshots'))).length,1);
    await assert.rejects(saveSnapshot(doc(inventory(0,0)),directory,night(2)),/Empty inventory blocked/);
    assert.equal(await readFile(join(directory,'latest-nonempty.json'),'utf8'),pointer);
    assert.equal(await saveSnapshot(changed,directory,night(2)),true);
    assert.equal(await saveSnapshot(changed,directory,night(3)),false);
    assert.throws(()=>parseInventory(doc({items:[]})),/Invalid inventory/);
  } finally { await rm(directory,{recursive:true,force:true}); }
});

test('backup retains only three snapshots and keeps both recovery pointers valid', async () => {
  const directory=await mkdtemp(join(tmpdir(),'phone-count-retention-'));
  const doc=count=>({fields:{payload:{stringValue:JSON.stringify(inventory(count))},revision:{integerValue:String(count)}}});
  try {
    for (let day=1;day<=5;day++) {
      assert.equal(await saveSnapshot(doc(day),directory,{now:new Date(`2026-10-0${day}T01:17:00Z`)}),true);
      assert.equal((await readdir(join(directory,'snapshots'))).length,Math.min(day,3));
    }
    const files=await readdir(join(directory,'snapshots'));
    assert.ok(files.every(name=>/2026-10-0[345]T/.test(name)));
    for (const name of ['latest.json','latest-nonempty.json']) {
      const pointer=JSON.parse(await readFile(join(directory,name),'utf8'));
      const snapshot=JSON.parse(await readFile(join(directory,pointer.filename),'utf8'));
      assert.equal(snapshot.hash,pointer.hash);
      assert.equal(snapshot.inventory.items.length,5);
    }
    await assert.rejects(saveSnapshot({fields:{payload:doc(6).fields.payload}},directory,{now:new Date('2026-10-06T01:17:00Z')}),/Missing revision/);
    assert.equal(await saveSnapshot(doc(6),directory,{now:new Date('2026-10-06T01:17:00Z')}),true);
    assert.equal((await readdir(join(directory,'snapshots'))).length,3);
  } finally { await rm(directory,{recursive:true,force:true}); }
});
