import test from 'node:test';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, getDocs, collection, runTransaction, setDoc, updateDoc, deleteDoc, writeBatch, Timestamp, serverTimestamp } from 'firebase/firestore';
import '../stock-records.js';
import '../stock-record-cloud.js';
const env=await initializeTestEnvironment({projectId:'demo-phone-count-safety',firestore:{host:'127.0.0.1',port:8188,rules:readFileSync(new URL('../firestore.rules.preview',import.meta.url),'utf8')}});
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

async function seedRecords(){
 await seed();
 const data={items:[{id:'p',units:Array.from({length:10},(_,i)=>({id:'u'+i,imei:'11111'+i,location:'warehouse',costPrice:10}))}],movements:[],shops:[],categories:[]};
 await env.withSecurityRulesDisabled(async context=>{
  const db=context.firestore();
  await setDoc(doc(db,'phone_count_generations/main-v2'),{state:'active',revision:1});
  for(const [id,r] of StockRecords.split(data))await setDoc(doc(db,'phone_count_generations/main-v2/records/'+id),{payload:JSON.stringify(r),deleted:false,revision:1,updatedBy:'migration',updatedAt:Timestamp.fromMillis(1000)});
 });
 return data;
}
test('active generation freezes legacy clients and rejects unauthorised record access',async()=>{
 await seedRecords();
 await assertFails(batchSave(admin()));
 await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(),'phone_count_generations/main-v2')));
 await assertFails(getDoc(doc(admin('outside@example.com'),'phone_count_generations/main-v2/records/device_u0')));
});
test('record adapter saves a batch with immutable individual audit under real rules',async()=>{
 await seedRecords();const db=admin();
 const fb={db,doc,getDoc,getDocs,collection,runTransaction,serverTimestamp};
 const adapter=StockRecordCloud.create(fb,'main-v2');const {data}=await adapter.load();
 for(const u of data.items[0].units)u.costPrice=11;
 await assertSucceeds(adapter.save(data,{uid:'admin'}));
 const marker=await getDoc(doc(db,'phone_count_generations/main-v2'));if(marker.data().revision!==3)throw Error('Expected two bounded transactions');
 for(let i=0;i<10;i++){
  const current=await getDoc(doc(db,'phone_count_generations/main-v2/records/device_u'+i));
  if(JSON.parse(current.data().payload).value.unit.costPrice!==11)throw Error('Cost not saved');
 }
 await assertFails(updateDoc(doc(db,'phone_count_generations/main-v2/audit/2_device_u0'),{previous:'wrong'}));
 await assertFails(deleteDoc(doc(db,'phone_count_generations/main-v2/records/device_u0')));
});
test('authorised shop editor can save bounded batches and revocation blocks further writes',async()=>{
 await seedRecords();
 await env.withSecurityRulesDisabled(async context=>setDoc(doc(context.firestore(),'phone_count_access/editor'),{active:true,role:'all_shops_editor',expiresAt:null}));
 const db=env.authenticatedContext('editor').firestore();
 const adapter=StockRecordCloud.create({db,doc,getDoc,getDocs,collection,runTransaction,serverTimestamp},'main-v2');
 const {data}=await adapter.load();for(const u of data.items[0].units)u.costPrice=12;
 await assertSucceeds(adapter.save(data,{uid:'editor'}));
 await env.withSecurityRulesDisabled(async context=>updateDoc(doc(context.firestore(),'phone_count_access/editor'),{active:false}));
 data.items[0].units[0].costPrice=13;await assertFails(adapter.save(data,{uid:'editor'}));
});
