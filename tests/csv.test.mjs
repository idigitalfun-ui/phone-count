import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import '../public/inventory-csv.js';
const {decode,plan,parseCsv}=globalThis.InventoryCsv;
const importerSource=readFileSync(new URL('../public/inventory-csv.js',import.meta.url),'utf8');
const stock=()=>({shops:[{id:'warehouse',name:'Warehouse'},{id:'shop_maynooth',name:'Maynooth'},{id:'shop_tullamore',name:'Tullamore'}],categories:[],items:[{id:'phone',name:'iPhone 15',memory:'128GB',category:'phones',locations:{warehouse:1,shop_maynooth:0,shop_tullamore:0},units:[{id:'u1',imei:'351522600826588',location:'warehouse',costPrice:410,sellPrice:485}]}],movements:[],meta:{}});
const header='date,type,imei,from,to,sale_price,cost_price,reference\n';
test('CSV preserves quoted commas, multiline cells and leading-zero serials',()=>{
  assert.deepEqual(parseCsv('a,b\n"x,y","two\nlines"'),[['a','b'],['x,y','two\nlines']]);
  assert.equal(decode(header+'30/09/2026,transfer,001522600826588,warehouse,Maynooth,,,T1')[0].imei,'001522600826588');
});
test('transfer importer offers a paste-to-preview route when file upload is unavailable',()=>{
  assert.match(importerSource,/api\.previewText=async function\(text\)/);
  assert.match(importerSource,/Paste transfer CSV/);
  assert.match(importerSource,/Preview pasted CSV/);
});
test('duplicate uploads preserve counts and history',()=>{
  const rows=decode(header+'30/09/2026,transfer,351522600826588,warehouse,Maynooth,,,T1');
  const original=stock();const first=plan(original,rows);
  assert.equal(original.items[0].units[0].location,'warehouse');
  assert.equal(first.changed,1);
  assert.equal(first.data.items[0].locations.warehouse,0);
  assert.equal(first.data.items[0].locations.shop_maynooth,1);
  assert.equal(first.data.movements.length,2);
  const second=plan(first.data,rows);
  assert.equal(second.changed,0);assert.equal(second.data.movements.length,2);
});
test('incorrect shops and invalid dates do not change stock',()=>{
  const planned=plan(stock(),decode(header+'30/09/2026,sale,351522600826588,Maynooth,,485,,S1\n31/09/2026,transfer,351522600826588,warehouse,Maynooth,,,T1'));
  assert.equal(planned.changed,0);assert.equal(planned.data.items[0].locations.warehouse,1);
  assert.ok(planned.results.every(r=>r.status==='conflict'));
});
test('legacy warehouse returns are applied before later transfers',()=>{
  const data=stock();data.items[0].units[0].location='shop_tullamore';data.items[0].locations={warehouse:0,shop_tullamore:1,shop_maynooth:0};
  const text='Transfer from Portlaoise/warehouse,,,,,,,,\n30/09/2026,iPhone 15,351522600826588,Used,1,Maynooth,410,,90%\nStock in - in warehouse,,,,,,,,\n28/09/2026,iPhone 15,351522600826588,Used,1,Tullamore Return,410,,90%';
  const result=plan(data,decode(text));assert.equal(result.changed,2);
  assert.equal(result.data.items[0].units[0].location,'shop_maynooth');
  assert.equal(result.data.items[0].locations.shop_tullamore,0);
});
test('sale and refund of same reference are distinct, idempotent events',()=>{
  const text=header+'24/09/2026,sale,351522600826588,warehouse,,485,,S1\n25/09/2026,return,351522600826588,warehouse,,485,,S1';
  const result=plan(stock(),decode(text));
  assert.equal(result.changed,2);assert.equal(result.data.items[0].units.length,1);
  assert.equal(result.data.movements.reduce((sum,m)=>sum+m.qty*m.sellPrice,0),0);
  assert.equal(plan(result.data,decode(text)).changed,0);
});
test('sales report accepts inline IMEI but refuses an unallocated multi-phone invoice',()=>{
  const text='Date,Reference No,Biller,Product (Qty),Grand Total\n30/09/2026 14:36,S1,warehouse,iPhone 15 (1) 351522600826588,485\n30/09/2026,S2,warehouse,"Phone A (1) 351522600826588\nPhone B (1) 351522600826589",550';
  const rows=decode(text);assert.equal(rows[0].imei,'351522600826588');assert.equal(rows[0].sale,485);
  assert.match(rows[1].error,/Split this invoice/);
});
test('direct shop receipt and sale records history without changing current stock',()=>{
  const csv=header.replace('reference\n','reference,model,memory\n')+'30/09/2026,store-sale,351522600826589,Maynooth,,485,,S2,iPhone 15,128GB';
  const result=plan(stock(),decode(csv));
  assert.equal(result.changed,1);assert.equal(result.data.items[0].units.length,1);
  assert.equal(result.data.items[0].locations.warehouse,1);
  assert.equal(result.data.items[0].locations.shop_maynooth,0);
  assert.deepEqual(result.data.movements.map(m=>m.type),['stock-in','sold']);
  assert.ok(result.data.movements.every(m=>m.unitData.costPriceUnknown));
  assert.equal(plan(result.data,decode(csv)).changed,0);
});
