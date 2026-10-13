import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
function object(name,extra={}){
 const start=html.indexOf('const '+name+' = {');const end=html.indexOf('\n};',start)+3;
 const ctx=vm.createContext({console,setTimeout,clearTimeout,...extra});
 vm.runInContext(html.slice(start,end)+';this.subject='+name,ctx);return ctx.subject;
}
test('report export helpers are attached only after Views is initialized',()=>{
 const viewsStart=html.indexOf('const Views = {}');
 const exportStart=html.indexOf('Views.exportAvailabilityCsv =');
 assert.ok(viewsStart>=0,'Views must be initialized');
 assert.ok(exportStart>viewsStart,'report helpers must not run before Views exists');
});
test('shop availability has its own CSV export button',()=>{
 const start=html.indexOf('Views.availability =');
 const end=html.indexOf('\nViews.openAvailabilityDevices =',start);
 assert.match(html.slice(start,end),/Export shop availability \(CSV\)/);
 assert.match(html.slice(start,end),/Views\.exportAvailabilityCsv\(\)/);
});
test('shop availability provides a print-friendly PDF report',()=>{
 const exportStart=html.indexOf('Views.printAvailabilityPdf =');
 const viewStart=html.indexOf('Views.availability =');
 const viewEnd=html.indexOf('\nViews.openAvailabilityDevices =',viewStart);
 assert.ok(exportStart>=0,'PDF report helper must be available');
 assert.match(html.slice(exportStart,viewStart),/@page\{size:A4 landscape/);
 assert.match(html.slice(exportStart,viewStart),/reportWindow\.print\(\)/);
 assert.match(html.slice(viewStart,viewEnd),/Print \/ Save PDF/);
 assert.match(html.slice(viewStart,viewEnd),/Views\.printAvailabilityPdf\(\)/);
});
test('availability PDF report renders summary and quantity table before printing',()=>{
 const start=html.indexOf('Views.printAvailabilityPdf =');
 const end=html.indexOf('\nViews.exportShopSalesCsv =',start);
 let printed=false,written='';
 const popup={focus(){},print(){printed=true;},document:{open(){},write:text=>{written=text;},close(){}}};
 const ctx=vm.createContext({
  Views:{},window:{open:()=>popup},setTimeout:fn=>fn(),Toast:{show(){}},todayISO:()=> '2026-10-12',
  activeShops:()=>[{id:'warehouse',name:'Warehouse'},{id:'shop_thurles',name:'Thurles'}],
  sortedItems:()=>[{id:'item',name:'Demo Phone'}],totalQty:()=>1,
  displayModelGroups:()=>[{name:'Demo Phone',memory:'128GB',category:'iphone',locations:{warehouse:1,shop_thurles:2}}],
  catName:()=> 'iPhone',esc:value=>String(value),Date,
 });
 vm.runInContext('const Views = {};'+html.slice(start,end)+';this.subject=Views.printAvailabilityPdf;',ctx);
 ctx.subject();
 assert.equal(printed,true);assert.match(written,/Shop Availability/);assert.match(written,/Demo Phone/);assert.match(written,/Devices in stock/);assert.match(written,/A4 landscape/);
});
test('reorder rows include custom supplier lines and sort every line by item name',()=>{
 const start=html.indexOf('function reorderKey('),end=html.indexOf('\nViews.reorder =',start);
 const items={a:{id:'a',name:'Apple A15',memory:'64GB',colors:['Black'],category:'phones',locations:{warehouse:2}},b:{id:'b',name:'Samsung A17',memory:'128GB',colors:['Blue'],category:'phones',locations:{warehouse:1}}};
 const ctx=vm.createContext({Store:{data:{reorderList:[{itemId:'b',qty:10},{id:'custom',name:'Samsung S Series',memory:'Up to you',colors:'Mixed colours',qty:20,custom:true},{itemId:'a',qty:5}]}},itemById:id=>items[id],catName:()=> 'Samsung',totalQty:item=>item.locations.warehouse,soldInPeriod:()=>0});
 vm.runInContext(html.slice(start,end)+';this.rows=reorderRows("2026-10-01");',ctx);
 assert.deepEqual(Array.from(ctx.rows,row=>row.name),['Apple A15','Samsung A17','Samsung S Series']);
 assert.deepEqual({...ctx.rows[2],item:undefined},{id:'custom',name:'Samsung S Series',memory:'Up to you',colors:'Mixed colours',qty:20,custom:true,key:'custom',category:'',stock:0,sold:0,item:undefined});
});
test('supplier PDF defaults to only order-ready columns',()=>{
 const start=html.indexOf('Views.printReorderOrder ='),end=html.indexOf('\n/* ---- SHOPS ---- */',start);
 let written='';const popup={document:{open(){},write:text=>{written=text;},close(){}}};
 const ctx=vm.createContext({Views:{_reorderPeriod:'30'},window:{open:()=>popup},Toast:{show(){}},reorderPeriodStart:()=> '2026-10-01',reorderPdfColumns:()=>({category:false,stock:false,sold:false}),reorderRows:()=>[{name:'Samsung S Series',memory:'Up to you',colors:'Mixed colours',qty:20,item:null,category:'',stock:0,sold:0}],esc:value=>String(value),Date});
 vm.runInContext(html.slice(start,end)+';this.subject=Views.printReorderOrder;',ctx);ctx.subject();
 assert.match(written,/>Item<\/th>/);assert.match(written,/>Memory \/ Size<\/th>/);assert.match(written,/>Colours \/ Notes<\/th>/);assert.match(written,/>Qty to order<\/th>/);
 assert.doesNotMatch(written,/>Category<\/th>/);assert.doesNotMatch(written,/>Current stock<\/th>/);assert.doesNotMatch(written,/>Sold \(Last 30 days\)<\/th>/);
});
test('overlapping password requests issue one Firebase call and restore the button',async()=>{
 let calls=0,resolve;const button={disabled:false,textContent:'Sign in'};const errors=[];
 const auth=object('FirebaseStore',{document:{getElementById:id=>id==='passwordSignInButton'?button:null},val:id=>id.includes('email')?'ranakaharian1@gmail.com':'example',Toast:{show(){}},Modal:{close(){}}});
 auth.ready=async()=>({auth:{},signInWithEmailAndPassword:()=>{calls++;return new Promise(r=>resolve=r);}});
 auth.isAdmin=async()=>true;auth.syncNow=async()=>{};auth.showLoginError=m=>errors.push(m);
 const first=auth.signInWithPassword();await Promise.resolve();await Promise.resolve();
 await auth.signInWithPassword();assert.equal(calls,1);assert.equal(button.disabled,true);
 resolve({user:{email:'ranakaharian1@gmail.com',emailVerified:false}});await first;assert.equal(button.disabled,false);assert.deepEqual(errors,[]);
});
test('rate-limited login sets a local pause and no second request is sent',async()=>{
 let calls=0;const errors=[];
 const auth=object('FirebaseStore',{document:{getElementById:()=>null},val:id=>id.includes('email')?'ranakaharian1@gmail.com':'example'});
 auth.ready=async()=>({auth:{},signInWithEmailAndPassword:async()=>{calls++;throw {code:'auth/too-many-requests'};}});
 auth.showLoginError=m=>errors.push(m);
 await auth.signInWithPassword();await auth.signInWithPassword();
 assert.equal(calls,1);assert.match(errors[0],/temporarily limited/);assert.match(errors[1],/wait/);
});
test('transfer changes exactly one device and paired movements, rejects invalid and repeated destinations',()=>{
 const item={id:'phone',name:'Phone',category:'phones',units:[{id:'u1',imei:'001234567890123',location:'warehouse'}],locations:{warehouse:1,maynooth:0}};
 const messages=[];let saves=0;
 const stock=object('Stock',{itemById:()=>item,Store:{data:{shops:[{id:'warehouse',isWarehouse:true},{id:'maynooth'}]},save(){saves++;}},activeShops:()=>[{id:'warehouse'},{id:'maynooth'}],Toast:{show:m=>messages.push(m)},shopName:id=>id,uid:()=> 'transfer1',todayISO:()=> '2026-10-01'});
 const moves=[];stock.addMovement=m=>{m.id='m'+moves.length;moves.push(m);};
 assert.equal(stock.transferUnit('phone','u1','Maynooth','2026-10-01'),false);
 assert.equal(item.units[0].location,'warehouse');assert.equal(saves,0);
 assert.ok(stock.transferUnit('phone','u1','maynooth','2026-10-01'));
 assert.equal(item.units.length,1);assert.equal(item.units[0].imei,'001234567890123');
 assert.deepEqual(item.locations,{warehouse:0,maynooth:1});assert.equal(moves.length,2);assert.equal(moves[0].transferId,moves[1].transferId);
 assert.equal(stock.transferUnit('phone','u1','maynooth','2026-10-01'),false);assert.equal(moves.length,2);
});
test('inventory transfer forwards the selected destination into its dialog',()=>{
 const start=html.indexOf('Views.doInlineTransfer =');const end=html.indexOf('\n};',start)+3;
 let passed;const ctx=vm.createContext({Views:{openTransferUnitModal:(...args)=>passed=args},val:()=> 'maynooth'});
 vm.runInContext(html.slice(start,end),ctx);ctx.Views.doInlineTransfer('phone','unit','warehouse');
 assert.deepEqual(passed,['phone','unit','warehouse','maynooth']);
});
test('destination options carry real shop IDs and preserve the selected shop',()=>{
 const start=html.indexOf('Views.transfer =');const end=html.indexOf('\n};',start)+3;
 const ctx=vm.createContext({Views:{_trFrom:'warehouse',_trTo:'maynooth',_trDate:'2026-10-01'},activeShops:()=>[{id:'warehouse',name:'Warehouse',isWarehouse:true},{id:'maynooth',name:'Maynooth'}],allUnitsWithImei:()=>[],Store:{data:{movements:[]}},esc:x=>x,shopName:x=>x});
 vm.runInContext(html.slice(start,end),ctx);const view=ctx.Views.transfer();
 assert.match(view,/<option value="maynooth" selected>Maynooth/);
});
test('refresh waits for authentication restoration before reading currentUser',async()=>{
 let resolve;const user={uid:'existing'};
 const restored=new Promise(r=>resolve=r);
 const auth=object('FirebaseStore');auth.ready=async()=>({auth:{authStateReady:()=>restored,currentUser:user}});
 const pending=auth.user();resolve();
 assert.equal(await pending,user);
});
test('overlapping sync does not clear the first request lock',async()=>{
 const auth=object('FirebaseStore',{AccessScreen:{show(){},hide(){}},updateSaveIndicator(){}});
 auth.user=async()=>({uid:'existing'});auth._syncing=true;
 await auth.syncNow();assert.equal(auth._syncing,true);
});
test('sign out during a read cannot reopen the private inventory',async()=>{
 let adopted=false,hidden=false;
 const auth=object('FirebaseStore',{AccessScreen:{show(){},hide(){hidden=true;}},updateSaveIndicator(){}});
 auth.user=async()=>({uid:'existing'});auth.canUseWorkspace=async()=>true;auth.workspaceRef=()=>({});auth.adoptRemote=()=>adopted=true;
 auth.ready=async()=>({auth:{currentUser:null},getDoc:async()=>({exists:()=>true,data:()=>({})})});
 await auth.syncNow();assert.equal(adopted,false);assert.equal(hidden,false);assert.equal(auth._syncing,false);
});

function grouping(){
 const start=html.indexOf('function displayModelMemory('),end=html.indexOf('function groupByCategory(',start);
 const ctx=vm.createContext({});vm.runInContext(html.slice(start,end)+';this.group=displayModelGroups;',ctx);return ctx.group;
}
test('display grouping combines confirmed memory aliases, dash placeholders and colours without changing devices',()=>{
 const group=grouping();
 const rows=[['Blackview N1000','4GB','Black'],['Blackview N1000','1GB/4GB','Black'],['Nokia 106','-','Charcoal'],['Nokia 106','—','Charcoal'],['AirPods Pro 3','-','White'],['AirPods Pro 3','—','Black'],['Hoco Y22','','Black'],['Hoco Y22','—','Rose Gold'],['Hoco Y25','-',''],['Hoco Y25','—','Silver'],['Hoco Y27','-',''],['Hoco Y27','—','Black']].map(([name,memory,color],i)=>({id:'m'+i,name,memory,category:i===1?'legacy-category':name.split(' ')[0],locations:{warehouse:1,maynooth:2},units:[{id:'u'+i,imei:'imei'+i,color,location:'warehouse'}]}));
 const before=JSON.stringify(rows),groups=group(rows);
 assert.equal(groups.length,6);assert.equal(groups[0].memory,'4GB');
 assert.ok(groups.every(g=>g.members.length===2&&g.locations.warehouse===2&&g.locations.maynooth===4));
 assert.equal(groups.flatMap(g=>g.members.flatMap(it=>it.units)).length,12);
 assert.equal(JSON.stringify(rows),before);
});
test('display grouping keeps different phone capacities, watch sizes and model generations separate',()=>{
 const group=grouping();const rows=[['iPhone 11','64GB'],['iPhone 11','128GB'],['Apple Watch 41mm',''],['Apple Watch 45mm',''],['AirPods Pro 2',''],['AirPods Pro 3','']].map(([name,memory],i)=>({id:String(i),name,memory,category:'devices',locations:{warehouse:1}}));
 assert.equal(group(rows).length,6);
});

test('group colours use current device colours instead of stale model metadata',()=>{
 const start=html.indexOf('function displayStockColors('),end=html.indexOf('function groupByCategory(',start);
 const ctx=vm.createContext({});vm.runInContext(html.slice(start,end)+';this.colors=displayStockColors;',ctx);
 const rows=[{colors:['Black','Charcoal'],units:[{color:'Charcoal',location:'shop'}]},{colors:['Black'],units:[{color:'Charcoal',location:'shop'},{color:'Blue',location:'warehouse'}]}];
 const before=JSON.stringify(rows);
 assert.deepEqual(Array.from(ctx.colors(rows,'shop')),['Charcoal']);
 assert.deepEqual(Array.from(ctx.colors(rows,'all')),['Charcoal','Blue']);
 assert.deepEqual(Array.from(ctx.colors([{colors:['—','-','Silver'],units:[]}],'all')),['Silver']);
 assert.equal(JSON.stringify(rows),before);
});

function stockFixture(){
 const item={id:'phone',name:'Phone',category:'phones',locations:{warehouse:2,shop:0},units:[{id:'u1',imei:'001234567890123',location:'warehouse',sellPrice:330},{id:'u2',imei:'001234567890124',location:'warehouse'}]};
 const shops=[{id:'warehouse',isWarehouse:true},{id:'shop'}],data={items:[item],shops,movements:[]};let next=0,saves=0;
 const stock=object('Stock',{itemById:()=>item,Store:{data,save(){saves++;}},activeShops:()=>shops,unitsAt:(it,loc)=>it.units.filter(u=>u.location===loc),untrackedQtyAt:(it,loc)=>Math.max(0,(it.locations[loc]||0)-it.units.filter(u=>u.location===loc).length),Toast:{show(){}},shopName:id=>id,uid:()=> 'id'+(++next),todayISO:()=> '2026-10-01'});
 stock.addMovement=m=>{m.id=m.id||'id'+(++next);data.movements.push(m);};
 return {stock,item,data,saves:()=>saves};
}

test('bulk sales, faulty and deposit actions cannot leave tracked IMEIs behind',()=>{
 for(const method of ['sell','faulty','deposit']){
  const {stock,item,data,saves}=stockFixture();const before=JSON.stringify(item);
  assert.equal(stock[method]('phone','warehouse',2),false);
  assert.equal(stock[method]('phone','warehouse',0.5),false);
  assert.equal(stock[method]('phone','warehouse',NaN),false);
  assert.equal(stock[method]('phone','shop',1,null,null,'u1'),false);
  assert.equal(JSON.stringify(item),before);assert.equal(data.movements.length,0);assert.equal(saves(),0);
 }
});

test('transfer, sale and undo preserve one IMEI and reject undoing later activity out of order',()=>{
 const {stock,item,data}=stockFixture();
 const transfer=stock.transferUnit('phone','u1','shop');assert.ok(transfer);assert.equal(data.movements.length,2);
 const sale=stock.sell('phone','shop',1,null,null,'u1');assert.ok(sale);assert.equal(sale.unitData.imei,'001234567890123');assert.equal(sale.sellPrice,330);
 assert.equal(item.units.length,1);assert.equal(item.locations.shop,0);
 assert.equal(stock.sellUnit('phone','u1'),false);
 const before=JSON.stringify({item,moves:data.movements});assert.equal(stock.revertMovement(transfer.movementId),false);assert.equal(JSON.stringify({item,moves:data.movements}),before);
 assert.equal(stock.revertMovement(sale.id),true);assert.equal(stock.revertMovement(sale.id),false);
 assert.equal(item.units.filter(u=>u.imei==='001234567890123').length,1);assert.equal(item.locations.shop,1);
 assert.equal(stock.revertMovement(transfer.movementId),true);assert.equal(item.locations.warehouse,2);assert.equal(item.locations.shop,0);assert.equal(data.movements.length,0);
 assert.equal(item.units.find(u=>u.id==='u1').location,'warehouse');
});

