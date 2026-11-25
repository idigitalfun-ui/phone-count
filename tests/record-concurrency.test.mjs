import test from 'node:test';
import assert from 'node:assert/strict';
import '../stock-records.js';
import '../stock-record-cloud.js';
function fixture(){
 const data={items:[{id:'p',units:[{id:'a',imei:'11111',costPrice:10},{id:'b',imei:'22222',costPrice:20}]}],movements:[],shops:[],categories:[]};
 const docs=new Map([['phone_count_generations/g',{state:'active',revision:1}],...[...StockRecords.split(data)].map(([id,r])=>['phone_count_generations/g/records/'+id,{payload:JSON.stringify(r),deleted:false}])]);
 const snap=k=>({exists:()=>docs.has(k),data:()=>docs.get(k),id:k.split('/').at(-1)});
 let fail=false;
 const fb={db:{},doc:(_, ...p)=>p.join('/'),collection:(_, ...p)=>p.join('/'),getDoc:async k=>snap(k),getDocs:async k=>({docs:[...docs.keys()].filter(x=>x.startsWith(k+'/')).map(snap)}),serverTimestamp:()=>0,runTransaction:async(_,fn)=>{
  const writes=[];await fn({get:async k=>snap(k),set:(k,v)=>writes.push([k,v]),update:(k,v)=>writes.push([k,{...docs.get(k),...v}])});
  if(fail)throw Error('offline');for(const [k,v] of writes)docs.set(k,v);
 }};
 const cache=new Map();const storage={getItem:k=>cache.get(k)||null,setItem:(k,v)=>cache.set(k,v),removeItem:k=>cache.delete(k)};
 return {data,docs,fb,storage,setFail:v=>{fail=v}};
}
test('independent phone edits from two clients both survive',async()=>{
 const f=fixture(),a=StockRecordCloud.create(f.fb,'g'),b=StockRecordCloud.create(f.fb,'g');
 const da=(await a.load()).data,db=(await b.load()).data;
 da.items[0].units[0].costPrice=11;await a.save(da,{uid:'admin'});
 db.items[0].units[1].costPrice=22;const result=await b.save(db,{uid:'admin'});assert.equal(result.remoteChanged,true);
 const final=(await StockRecordCloud.create(f.fb,'g').load()).data;
 assert.deepEqual(final.items[0].units.map(u=>u.costPrice),[11,22]);
});
test('same phone conflict retains cloud value and durable pending edit',async()=>{
 const f=fixture(),a=StockRecordCloud.create(f.fb,'g'),b=StockRecordCloud.create(f.fb,'g',{storage:f.storage,pendingKey:'b'});
 const da=(await a.load()).data,db=(await b.load()).data;
 da.items[0].units[0].costPrice=11;await a.save(da,{uid:'admin'});
 db.items[0].units[0].costPrice=12;await assert.rejects(b.save(db,{uid:'admin'}),/Record conflict/);
 assert.ok(f.storage.getItem('b'));assert.equal((await a.load()).data.items[0].units[0].costPrice,11);
});
test('unsaved edit survives reload and successful retry clears journal',async()=>{
 const f=fixture(),options={storage:f.storage,pendingKey:'b'},a=StockRecordCloud.create(f.fb,'g',options);
 const data=(await a.load()).data;data.items[0].units[0].costPrice=11;a.stage(data);
 f.setFail(true);await assert.rejects(a.save(data,{uid:'admin'}),/offline/);
 const b=StockRecordCloud.create(f.fb,'g',options),restored=await b.load();assert.ok(restored.pending);assert.equal(restored.data.items[0].units[0].costPrice,11);
 f.setFail(false);await b.save(restored.data,{uid:'admin'});assert.equal(f.storage.getItem('b'),null);
});
test('recovery ignores normalised defaults on untouched phones',async()=>{
 const f=fixture(),options={storage:f.storage,pendingKey:'b'},a=StockRecordCloud.create(f.fb,'g',options);
 const data=(await a.load()).data;for(const u of data.items[0].units)u.verified=false;
 a.acceptLocalBaseline(data);data.items[0].units[0].costPrice=11;a.stage(data);
 const b=StockRecordCloud.create(f.fb,'g',options),restored=await b.load();
 for(const u of restored.baselineData.items[0].units)u.verified=false;b.acceptLocalBaseline(restored.baselineData);
 for(const u of restored.data.items[0].units)u.verified=false;
 assert.equal((await b.save(restored.data,{uid:'admin'})).changed,1);
});
