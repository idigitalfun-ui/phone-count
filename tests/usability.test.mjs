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
