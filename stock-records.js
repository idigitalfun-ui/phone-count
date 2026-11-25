// Lossless record codec. No live migration or writes are performed by this module.
(function(root){
'use strict';
const clone=x=>JSON.parse(JSON.stringify(x));
const stable=x=>Array.isArray(x)?x.map(stable):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,stable(x[k])])):x;
const equal=(a,b)=>JSON.stringify(stable(a))===JSON.stringify(stable(b));
const key=(kind,id)=>kind+'_'+encodeURIComponent(String(id));
function split(input){
 const data=clone(input), records=new Map(), imeis=new Set();
 const put=(kind,id,value)=>{const k=key(kind,id);if(records.has(k))throw Error('Duplicate record '+k);records.set(k,{kind,id:String(id),value});};
 for(const field of ['items','movements','shops','categories'])if(!Array.isArray(data[field]))throw Error('Missing '+field);
 const order={items:[],movements:[],shops:[],categories:[]};
 for(const item of data.items){
  if(!item.id)throw Error('Missing item ID');
  const {units,...product}=item;
  order.items.push(item.id);put('product',item.id,{...product,unitOrder:(units||[]).map(u=>u.id),hadUnits:Object.hasOwn(item,'units')});
  for(const u of units||[]){
   if(!u.id)throw Error('Missing unit ID');
   const imei=String(u.imei||'').trim().toUpperCase();
   if(imei&&imeis.has(imei))throw Error('Duplicate IMEI '+imei);
   if(imei)imeis.add(imei);
   put('device',u.id,{itemId:item.id,unit:u});
  }
 }
 for(const [field,kind] of [['movements','movement'],['shops','shop'],['categories','category']]){
  for(const row of data[field]){if(!row.id)throw Error('Missing '+kind+' ID');order[field].push(row.id);put(kind,row.id,row);}
 }
 for(const field of Object.keys(data)){if(Object.hasOwn(order,field))continue;put('setting',field,data[field]);}
 put('index','main',order);
 return records;
}
function join(records){
 const read=(kind,id)=>{const r=records.get(key(kind,id));if(!r)throw Error('Missing '+kind+' '+id);return clone(r.value);};
 const order=read('index','main'),data={};
 for(const r of records.values())if(r.kind==='setting')Object.defineProperty(data,r.id,{value:clone(r.value),enumerable:true,writable:true,configurable:true});
 data.items=order.items.map(id=>{const {unitOrder,hadUnits,...item}=read('product',id);const units=unitOrder.map(uid=>{const r=read('device',uid);if(r.itemId!==id)throw Error('Device ownership mismatch');return r.unit;});if(hadUnits)item.units=units;return item;});
 for(const [field,kind] of [['movements','movement'],['shops','shop'],['categories','category']])data[field]=order[field].map(id=>read(kind,id));
 if(!equal([...split(data)].sort(),[...records].sort()))throw Error('Record round trip failed');
 return data;
}
function diff(before,after){
 const changes=[];
 for(const [id,next] of after){const old=before.get(id);if(!old||!equal(old,next))changes.push({id,before:old||null,after:next});}
 for(const [id,old] of before)if(!after.has(id))changes.push({id,before:old,after:null});
 return changes;
}
root.StockRecords={split,join,diff,equal};
})(typeof window==='undefined'?globalThis:window);
