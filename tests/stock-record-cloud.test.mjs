import test from 'node:test';
import assert from 'node:assert/strict';
import '../stock-records.js';
import '../stock-record-cloud.js';
test('verification updates only device, audit and small revision marker',async()=>{
 const data={items:[{id:'p',units:[{id:'u',verified:false}]}],movements:[],shops:[],categories:[],meta:{lastSaved:'old'}};
 const clean=structuredClone(data);delete clean.meta.lastSaved;
 const docs=new Map([['phone_count_generations/g',{state:'active',revision:1}],...Array.from(StockRecords.split(clean),([id,r])=>['phone_count_generations/g/records/'+id,{payload:JSON.stringify(r),deleted:false}])]);
 const snap=k=>({exists:()=>docs.has(k),data:()=>docs.get(k),id:k.split('/').at(-1)});
 const writes=[];
 const fb={db:{},doc:(_, ...p)=>p.join('/'),collection:(_, ...p)=>p.join('/'),getDoc:async k=>snap(k),getDocs:async k=>({docs:[...docs.keys()].filter(x=>x.startsWith(k+'/')).map(snap)}),serverTimestamp:()=>0,runTransaction:async(_,fn)=>fn({get:async k=>snap(k),set:(k,v)=>{writes.push(k);docs.set(k,v)},update:(k,v)=>{writes.push(k);docs.set(k,{...docs.get(k),...v})}})};
 const cloud=StockRecordCloud.create(fb,'g');await cloud.load();data.items[0].units[0].verified=true;data.meta.lastSaved='new';
 assert.equal((await cloud.save(data,{uid:'admin'})).changed,1);
 assert.deepEqual(writes,['phone_count_generations/g/audit/2_device_u','phone_count_generations/g/records/device_u','phone_count_generations/g']);
 assert.equal((await cloud.save(data,{uid:'admin'})).changed,0);
});
