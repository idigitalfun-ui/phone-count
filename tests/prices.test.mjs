import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
function setup(){
 const items=[{id:'a',name:'iPhone 12',memory:'64 GB',costPrice:150,shopPrices:{warehouse:250},units:[
  {id:'one',costPrice:115,sellPrice:0,purchaseDate:'2026-11-13',location:'warehouse'},
  {id:'two',costPrice:125,sellPrice:0,purchaseDate:'2026-11-13',location:'thurles'},
  {id:'older',costPrice:120,sellPrice:0,purchaseDate:'2026-11-12',location:'warehouse'},
  {id:'priced',costPrice:120,sellPrice:300,purchaseDate:'2026-11-13',location:'warehouse'}]},
  {id:'b',name:'iPhone 12',memory:'64GB',units:[{id:'other-record',sellPrice:0,dateAdded:'2026-11-13',location:'warehouse'}]},
  {id:'c',name:'iPhone 12',memory:'128GB',units:[{id:'capacity',sellPrice:0,purchaseDate:'2026-11-13'}]}];
 let saves=0;const logs=[];
 const ctx=vm.createContext({Views:{},Store:{data:{items},save(){saves++;},logShopChange(e){logs.push(e);}},itemById:id=>items.find(x=>x.id===id),Toast:{show(){}},shopName:x=>x});
 const start=html.indexOf('Views.invSetCostPrice ='),end=html.indexOf('Views.invSetUntrackedCost =',start);
 vm.runInContext(html.slice(start,end),ctx);
 return {items,views:ctx.Views,logs,saves:()=>saves};
}
test('typing partial cost values never changes data; commit retains final digits and logs previous unit cost',()=>{
 const s=setup();for(const value of ['','1','11','110'])s.views.invSetCostPrice('a','one',value,false);
 assert.equal(s.items[0].units[0].costPrice,115);assert.equal(s.saves(),0);
 s.views.invSetCostPrice('a','one','11',true);
 assert.equal(s.items[0].units[0].costPrice,11);assert.equal(s.items[0].units[1].costPrice,125);assert.equal(s.items[0].costPrice,150);
 assert.equal(s.logs[0].oldValue,115);assert.equal(s.saves(),1);
});
test('blank, negative and infinite entries do not replace cost with zero',()=>{
 const s=setup();for(const value of ['',' ','-1','Infinity','NaN'])s.views.invSetCostPrice('a','one',value,true);
 assert.equal(s.saves(),0);assert.equal(s.items[0].units[0].costPrice,115);
});
test('initial sale price fills only matching unpriced model-memory-date units across stores',()=>{
 const s=setup();s.views.invSetSalePrice('a','one','warehouse','2',false);assert.equal(s.saves(),0);
 s.views.invSetSalePrice('a','one','warehouse','200',true);
 assert.deepEqual(s.items[0].units.map(x=>x.sellPrice),[200,200,0,300]);
 assert.equal(s.items[1].units[0].sellPrice,200);assert.equal(s.items[2].units[0].sellPrice,0);
 assert.equal(s.items[0].shopPrices.warehouse,250);
 s.views.invSetSalePrice('a','one','warehouse','210',true);
 assert.deepEqual(s.items[0].units.map(x=>x.sellPrice),[210,200,0,300]);
});
test('unknown dates do not create a shared batch and explicit zero remains an override',()=>{
 const s=setup();delete s.items[0].units[0].purchaseDate;
 s.views.invSetSalePrice('a','one','warehouse','0',true);
 s.items[0].units[0].purchaseDate='2026-11-13';s.views.invSetSalePrice('a','one','warehouse','220',true);
 assert.equal(s.items[0].units[1].sellPrice,0);
});

