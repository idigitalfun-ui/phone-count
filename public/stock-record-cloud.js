// Staged record persistence adapter; requires a separately provisioned generation.
// Never falls back to legacy full-payload writes after activation.
(function(root){
'use strict';
const clone=x=>JSON.parse(JSON.stringify(x));
function create(fb, generation, options={}){
 if(!/^[A-Za-z0-9_-]+$/.test(generation))throw Error('Invalid generation');
 const prefix=['phone_count_generations',generation];
 const ref=id=>fb.doc(fb.db,...prefix,'records',id);
 const marker=fb.doc(fb.db,...prefix);
 const collection=fb.collection(fb.db,...prefix,'records');
 const codec=root.StockRecords;
 const clean=data=>{const next=clone(data);if(next.meta)delete next.meta.lastSaved;return next;};
 const map=data=>codec.split(clean(data));
 const decode=snapshot=>new Map(snapshot.docs.filter(d=>!d.data().deleted).map(d=>[d.id,JSON.parse(d.data().payload)]));
 let baseline=null, localBaseline=null, loadedRevision=null;
 const storage=options.storage, pendingKey=options.pendingKey;
 const pending=()=>storage&&pendingKey?JSON.parse(storage.getItem(pendingKey)||'null'):null;
 const remember=changes=>{if(storage&&pendingKey){if(changes.length)storage.setItem(pendingKey,JSON.stringify(changes));else storage.removeItem(pendingKey);}};
 const overlay=(records,changes)=>{
  const merged=new Map(records);
  for(const c of changes){
   const actual=records.get(c.id)||null;
   if(!codec.equal(actual,c.before)&&!codec.equal(actual,c.after))throw Error('Record conflict: '+c.id+'; local recovery retained');
   if(c.after===null)merged.delete(c.id);else merged.set(c.id,c.after);
  }
  codec.join(merged);return merged;
 };
 const read=async()=>{
  for(let attempt=0;attempt<3;attempt++){
   const before=await fb.getDoc(marker);
   if(!before.exists()||before.data().state!=='active')throw Error('Record generation not active');
   const records=decode(await fb.getDocs(collection));
   const after=await fb.getDoc(marker);
   if(after.exists()&&after.data().state==='active'&&after.data().revision===before.data().revision)return {records,revision:after.data().revision};
  }
  throw Error('Inventory changed during load; retry');
 };
 return {
  async load(){
   const {records,revision}=await read(),changes=pending()||[];
   const restored=overlay(records,changes);
   baseline=records;localBaseline=records;loadedRevision=revision;
   return {data:codec.join(restored),baselineData:codec.join(records),revision,pending:changes.length>0};
  },
  stage(data){if(!baseline)return;const next=map(data);remember(codec.diff(localBaseline,next).map(c=>({...c,before:baseline.get(c.id)||null})));},
  async save(data,user){
   if(!baseline)throw Error('Load record inventory before saving');
   const next=map(data), localChanges=codec.diff(localBaseline,next);
   let changes=localChanges.map(c=>({...c,before:baseline.get(c.id)||null}));
   if(!changes.length){remember([]);return {changed:0};}
   remember(changes);
   const journal=clone(changes), oldRevision=loadedRevision;
   const markerSnapshot=await fb.getDoc(marker);
   if(!markerSnapshot.exists()||markerSnapshot.data().state!=='active')throw Error('Record generation not active');
   const remote=markerSnapshot.data().revision===loadedRevision?{records:baseline,revision:loadedRevision}:await read();
   const merged=overlay(remote.records,changes);
   changes=codec.diff(remote.records,merged);
   const priceOnly=changes.every(c=>c.before&&c.after&&(c.after.kind==='setting'&&c.after.id==='meta'||c.after.kind==='device'&&c.before.value.itemId===c.after.value.itemId&&c.before.value.unit.location===c.after.value.unit.location&&c.before.value.unit.imei===c.after.value.unit.imei));
   if(changes.length>8&&!priceOnly)throw Error('This operation affects too many records; use smaller batches. CSV imports save one row at a time.');
   const previous=codec.join(remote.records), proposed=codec.join(merged);
   if(previous.items.length&&!proposed.items.length)throw Error('Empty inventory blocked');
   if(previous.items.length>=10&&proposed.items.length<previous.items.length/2)throw Error('Large inventory deletion blocked');
   if(proposed.movements.length<previous.movements.length)throw Error('Movement history cannot shrink');
   const uid=user.uid;
   let revision=remote.revision;
   const allChanges=changes;
   for(let offset=0;offset<allChanges.length;offset+=8){
   const changes=allChanges.slice(offset,offset+8), expectedRevision=revision;
   await fb.runTransaction(fb.db,async tx=>{
    const m=await tx.get(marker);
    if(!m.exists()||m.data().state!=='active')throw Error('Record generation not active');
    if(m.data().revision!==expectedRevision)throw Error('Cloud changed during save; retry. Local edits are retained.');
    const snapshots=await Promise.all(changes.map(c=>tx.get(ref(c.id))));
    for(let i=0;i<changes.length;i++){
     const c=changes[i],s=snapshots[i],actual=s.exists()&&!s.data().deleted?JSON.parse(s.data().payload):null;
     if(!codec.equal(actual,c.before))throw Error('Record conflict: '+c.id+'; local changes retained');
    }
    revision=m.data().revision+1;
    for(let i=0;i<changes.length;i++){
     const c=changes[i],s=snapshots[i];
     const payload=JSON.stringify(c.after);
     if(new TextEncoder().encode(payload).length>800000)throw Error('Individual record too large');
     if(s.exists())tx.set(fb.doc(fb.db,...prefix,'audit',String(revision)+'_'+c.id),{recordId:c.id,previous:s.data().payload,revision,updatedBy:uid,updatedAt:fb.serverTimestamp()});
     tx.set(ref(c.id),{payload,deleted:c.after===null,revision,updatedBy:uid,updatedAt:fb.serverTimestamp()});
    }
    tx.update(marker,{revision,updatedAt:fb.serverTimestamp(),updatedBy:uid});
   });
   }
   baseline=merged;localBaseline=next;loadedRevision=revision;
   // A newer edit may have been staged while this request was in flight.
   if(codec.equal(pending(),journal))remember([]);
   return {changed:changes.length,revision,remoteChanged:remote.revision!==oldRevision};
  },
  subscribe(callback,error){return fb.onSnapshot(marker,s=>{if(s.exists()&&!s.metadata?.hasPendingWrites)callback(s.data().revision);},error);},
  acceptLocalBaseline(data){localBaseline=map(data);},
  dirty(data){return !localBaseline||codec.diff(localBaseline,map(data)).length>0;}
 };
}
root.StockRecordCloud={create};
})(typeof window==='undefined'?globalThis:window);
