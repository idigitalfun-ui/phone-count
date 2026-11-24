// Staged record persistence adapter; requires a separately provisioned generation.
// Never falls back to legacy full-payload writes after activation.
(function(root){
'use strict';
const clone=x=>JSON.parse(JSON.stringify(x));
function create(fb, generation){
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
 return {
  async load(){
   const before=await fb.getDoc(marker);
   if(!before.exists()||before.data().state!=='active')throw Error('Record generation not active');
   const records=decode(await fb.getDocs(collection));
   const after=await fb.getDoc(marker);
   if(!after.exists()||after.data().revision!==before.data().revision)throw Error('Inventory changed during load; retry');
   const data=codec.join(records);baseline=records;localBaseline=records;loadedRevision=after.data().revision;return {data,revision:after.data().revision};
  },
  async save(data,user){
   if(!baseline)throw Error('Load record inventory before saving');
   const next=map(data), localChanges=codec.diff(localBaseline,next);
   const changes=localChanges.map(c=>({...c,before:baseline.get(c.id)||null}));
   const merged=new Map(baseline);for(const c of changes){if(c.after===null)merged.delete(c.id);else merged.set(c.id,c.after); }
   if(!changes.length)return {changed:0};
   if(changes.length>190)throw Error('Too many affected records for one safe transaction; split the operation');
   const previous=codec.join(baseline), proposed=codec.join(merged);
   if(previous.items.length&&!proposed.items.length)throw Error('Empty inventory blocked');
   if(previous.items.length>=10&&proposed.items.length<previous.items.length/2)throw Error('Large inventory deletion blocked');
   if(proposed.movements.length<previous.movements.length)throw Error('Movement history cannot shrink');
   const uid=user.uid;
   let revision;
   await fb.runTransaction(fb.db,async tx=>{
    const m=await tx.get(marker);
    if(!m.exists()||m.data().state!=='active')throw Error('Record generation not active');
    if(m.data().revision!==loadedRevision)throw Error('Cloud changed; export local changes before resolving conflict.');
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
   baseline=merged;localBaseline=next;loadedRevision=revision;
   return {changed:changes.length,revision};
  },
  subscribe(callback,error){return fb.onSnapshot(marker,s=>{if(s.exists()&&!s.metadata?.hasPendingWrites)callback(s.data().revision);},error);},
  acceptLocalBaseline(data){localBaseline=map(data);},
  dirty(data){return !localBaseline||codec.diff(localBaseline,map(data)).length>0;}
 };
}
root.StockRecordCloud={create};
})(typeof window==='undefined'?globalThis:window);
