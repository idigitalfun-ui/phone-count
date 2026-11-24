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
test('initial sale price fills only matching unpriced model-memory-date units in the same shop',()=>{
 const s=setup();s.views.invSetSalePrice('a','one','warehouse','2',false);assert.equal(s.saves(),0);
 s.views.invSetSalePrice('a','one','warehouse','200',true);
 assert.deepEqual(s.items[0].units.map(x=>x.sellPrice),[200,0,0,300]);
 assert.equal(s.items[1].units[0].sellPrice,200);assert.equal(s.items[2].units[0].sellPrice,0);
 assert.equal(s.items[0].shopPrices.warehouse,250);
 s.views.invSetSalePrice('a','one','warehouse','210',true);
 assert.deepEqual(s.items[0].units.map(x=>x.sellPrice),[210,0,0,300]);
});
test('unknown dates do not create a shared batch and explicit zero remains an override',()=>{
 const s=setup();delete s.items[0].units[0].purchaseDate;
 s.views.invSetSalePrice('a','one','warehouse','0',true);
 s.items[0].units[0].purchaseDate='2026-11-13';s.views.invSetSalePrice('a','one','warehouse','220',true);
 assert.equal(s.items[0].units[1].sellPrice,0);
});


test('default price edits do not change tracked device prices and ignore incomplete typing',()=>{
 const items=[{id:'a',name:'Phone',costPrice:100,shopPrices:{warehouse:200},units:[{id:'u',location:'warehouse',costPrice:110,sellPrice:220,salePriceAssigned:true}]}];
 let saves=0;const ctx=vm.createContext({Views:{},Store:{data:{items},save(){saves++;},logShopChange(){}},itemById:id=>items.find(x=>x.id===id),Toast:{show(){}},shopName:x=>x,render(){}});
 const start=html.indexOf('Views.invSetCostPrice ='),end=html.indexOf('Views.saveInlineUntrackedImei =',start);
 vm.runInContext(html.slice(start,end),ctx);
 const svStart=html.indexOf('Views.svSetCostPrice ='),svEnd=html.indexOf('Views.stockview =',svStart);
 vm.runInContext(html.slice(svStart,svEnd),ctx);
 for(const v of ['', '1','11','110']){ctx.Views.invSetUntrackedCost('a',v,false);ctx.Views.invSetUntrackedSale('a','warehouse',v,false);}
 for(const v of ['', ' ', 'Infinity','-1']){ctx.Views.invSetUntrackedCost('a',v,true);ctx.Views.invSetUntrackedSale('a','warehouse',v,true);}
 assert.equal(saves,0);assert.equal(items[0].costPrice,100);
 ctx.Views.svSetCostPrice('a','11',true);ctx.Views.svSetPrice('a','warehouse','250',true);
 assert.equal(items[0].costPrice,11);assert.equal(items[0].shopPrices.warehouse,250);
 assert.equal(items[0].units[0].costPrice,110);assert.equal(items[0].units[0].sellPrice,220);assert.equal(saves,2);
});
test('quantity edits cannot create fractional stock or remove tracked devices',()=>{
 const item={id:'a',locations:{warehouse:2},units:[{location:'warehouse'}]};
 let saves=0;const ctx=vm.createContext({Views:{},Store:{save(){saves++;}},itemById:()=>item,activeShops:()=>[{id:'warehouse'}],unitsAt:(it,loc)=>it.units.filter(u=>u.location===loc),Toast:{show(){}},render(){}});
 const start=html.indexOf('Views.svSetQty ='),end=html.indexOf('Views.stockview =',start);
 vm.runInContext(html.slice(start,end),ctx);
 for(const v of ['', '0','1.5','Infinity','-1'])ctx.Views.svSetQty('a','warehouse',v,true);
 ctx.Views.svSetQty('a','invalid','2',true);ctx.Views.svSetQty('a','warehouse','3',false);
 assert.equal(saves,0);assert.equal(item.locations.warehouse,2);
 ctx.Views.svSetQty('a','warehouse','3',true);assert.equal(item.locations.warehouse,3);assert.equal(saves,1);
});

test('initial batch cost fills only unpriced matching purchase dates across shops',()=>{
 const s=setup();s.items[0].units[0].costPrice=0;s.items[0].units[1].costPrice=0;
 s.views.invSetCostPrice('a','one','180',true);
 assert.equal(s.items[0].units[1].costPrice,180);assert.equal(s.items[1].units[0].costPrice,180);
 assert.equal(s.items[0].units[2].costPrice,120);assert.equal(s.items[0].units[3].costPrice,120);
 s.views.invSetCostPrice('a','one','190',true);assert.equal(s.items[0].units[1].costPrice,180);
});
test('shop default updates shop-linked phones but preserves individual and legacy prices',()=>{
 const s=setup();s.views.invSetSalePrice('a','one','warehouse','200',true);
 s.views.invSetSalePrice('a','one','warehouse','210',true);
 const items=s.items;const ctx=vm.createContext({Views:{},Store:{data:{items},save(){},logShopChange(){}},itemById:id=>items.find(x=>x.id===id),Toast:{show(){}},shopName:x=>x});
 const start=html.indexOf('Views.invSetUntrackedSale ='),end=html.indexOf('Views.saveInlineUntrackedImei =',start);
 vm.runInContext(html.slice(start,end),ctx);ctx.Views.invSetUntrackedSale('a','warehouse','250',true);
 assert.equal(items[0].units[0].sellPrice,210);assert.equal(items[0].units[1].sellPrice,0);
 assert.equal(items[0].units[3].sellPrice,300);assert.equal(items[1].units[0].sellPrice,250);
});
