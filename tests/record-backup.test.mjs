import test from 'node:test';
import assert from 'node:assert/strict';
import {readRecordBackup} from '../scripts/record-backup.mjs';
const data={items:[{id:'p',units:[{id:'u'}]}],shops:[],categories:[],movements:[]};
const docs=[...StockRecords.split(data)].map(([id,r])=>({name:'records/'+id,fields:{payload:{stringValue:JSON.stringify(r)},deleted:{booleanValue:false}}}));
test('record backup follows pagination and round trips all data',async()=>{
  const get=async url=>url.includes('/records?')?url.includes('pageToken=')?{documents:docs.slice(2)}:{documents:docs.slice(0,2),nextPageToken:'next'}:{fields:{state:{stringValue:'active'},revision:{integerValue:'8'}}};
  const result=await readRecordBackup(get,'base');assert.deepEqual(JSON.parse(result.fields.payload.stringValue),data);
});
test('mixed revision backup fails without producing snapshot',async()=>{
  let n=0;
  const get=async url=>url.includes('/records?')?{documents:docs}:{fields:{state:{stringValue:'active'},revision:{integerValue:String(++n)}}};
  await assert.rejects(readRecordBackup(get,'base'),/every backup attempt/);
});
test('missing device record cannot become recovery backup',async()=>{
  const get=async url=>url.includes('/records?')?{documents:docs.filter(d=>!d.name.endsWith('device_u'))}:{fields:{state:{stringValue:'active'},revision:{integerValue:'8'}}};
  await assert.rejects(readRecordBackup(get,'base'),/Missing device/);
});
