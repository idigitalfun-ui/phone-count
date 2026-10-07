import test from 'node:test';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, writeBatch, Timestamp, serverTimestamp } from 'firebase/firestore';
const env=await initializeTestEnvironment({projectId:'demo-phone-count-safety',firestore:{host:'127.0.0.1',port:8188,rules:readFileSync(new URL('../firestore.rules',import.meta.url),'utf8')}});
const main='phone_count_workspaces/main';
const previous={ownerUid:'migration',payload:'{"shops":[],"categories":[],"items":[{}],"movements":[]}',schemaVersion:1,revision:10,createdAt:Timestamp.fromMillis(1000),updatedAt:Timestamp.fromMillis(1000),updatedBy:'old'};
async function seed(){
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async context=>setDoc(doc(context.firestore(),main),previous));
}
function admin(email='idigitalfun@gmail.com',verified=true,uid=email==='ranakaharian1@gmail.com'?'zXvU1cxgtoMSnyqL7FIGDZ4oh7i2':'admin'){return env.authenticatedContext(uid,{email,email_verified:verified}).firestore();}
function batchSave(db,backup=previous,uid='admin'){
  const batch=writeBatch(db);
  batch.set(doc(db,main+'/versions/10'),backup);
  batch.update(doc(db,main),{payload:'{"shops":[],"categories":[],"items":[{},{}],"movements":[]}',revision:11,updatedAt:serverTimestamp(),updatedBy:uid});
  return batch.commit();
}
test('named Google and email administrators can read and save with exact prior version',async()=>{
  for(const email of ['idigitalfun@gmail.com','ranakaharian1@gmail.com']){
    await seed();const db=admin(email,email!=='ranakaharian1@gmail.com');
    await assertSucceeds(getDoc(doc(db,main)));
    await assertSucceeds(batchSave(db,previous,email==='ranakaharian1@gmail.com'?'zXvU1cxgtoMSnyqL7FIGDZ4oh7i2':'admin'));
    await assertSucceeds(getDoc(doc(db,main+'/versions/10')));
  }
});
test('unbacked and incorrect-backup saves are rejected',async()=>{
  await seed();const db=admin();
  await assertFails(updateDoc(doc(db,main),{revision:11,updatedAt:serverTimestamp(),updatedBy:'admin'}));
  await assertFails(batchSave(db,{...previous,payload:'wrong'}));
});
test('recovery copies and cloud workspace cannot be deleted',async()=>{
  await seed();const db=admin();await assertSucceeds(batchSave(db));
  await assertFails(deleteDoc(doc(db,main+'/versions/10')));
  await assertFails(updateDoc(doc(db,main+'/versions/10'),{payload:'wrong'}));
  await assertFails(deleteDoc(doc(db,main)));
});
test('unknown accounts, wrong password UID and unverified Google cannot access inventory',async()=>{
  await seed();
  for(const db of [admin('outside@example.com'),admin('idigitalfun@gmail.com',false),admin('ranakaharian1@gmail.com',false,'different-uid'),env.unauthenticatedContext().firestore()])
    await assertFails(getDoc(doc(db,main)));
});
test('missing workspace cannot be automatically created by the browser',async()=>{
  await env.clearFirestore();await assertFails(setDoc(doc(admin(),main),previous));
});
test.after(async()=>env.cleanup());
