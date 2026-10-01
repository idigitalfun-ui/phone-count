(function(root){
  'use strict';
  const norm = value => String(value ?? '').trim().toLowerCase().replace(/\s+/g,' ');
  const serial = value => String(value ?? '').trim().toUpperCase();
  const clone = value => JSON.parse(JSON.stringify(value));
  const safeId = value => Array.from(new TextEncoder().encode(value), byte=>byte.toString(16).padStart(2,'0')).join('');
  function parseCsv(text){
    const rows=[];let row=[],field='',quoted=false;
    text=String(text).replace(/^\uFEFF/,'');
    for(let i=0;i<text.length;i++){
      const ch=text[i];
      if(ch==='"'){
        if(quoted && text[i+1]==='"'){field+='"';i++;}
        else if(quoted){quoted=false;}
        else if(field===''){quoted=true;}
        else throw new Error('Unexpected quote in CSV.');
      } else if(ch===',' && !quoted){row.push(field);field='';}
      else if((ch==='\n'||ch==='\r') && !quoted){
        if(ch==='\r' && text[i+1]==='\n')i++;
        row.push(field); if(row.some(cell=>cell.trim()))rows.push(row);
        row=[];field='';
      }else field+=ch;
    }
    if(quoted)throw new Error('CSV contains an unclosed quote.');
    row.push(field);if(row.some(cell=>cell.trim()))rows.push(row);
    return rows;
  }
  function dateISO(value){
    const input=String(value??'').trim();
    const iso=input.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T].*)?$/);
    const uk=input.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s.*)?$/);
    if(!iso&&!uk)throw new Error('Use a date such as 2026-09-30 or 30/09/2026.');
    const [y,m,d]=iso?[+iso[1],+iso[2],+iso[3]]:[+uk[3],+uk[2],+uk[1]];
    const date=new Date(Date.UTC(y,m-1,d));
    if(date.getUTCFullYear()!==y||date.getUTCMonth()!==m-1||date.getUTCDate()!==d)throw new Error('Invalid calendar date.');
    return y+'-'+String(m).padStart(2,'0')+'-'+String(d).padStart(2,'0');
  }
  function number(value){
    if(value==null||String(value).trim()==='')return null;
    const clean=String(value).replace(/[€£$%\s,]/g,'');
    if(!/^-?\d+(?:\.\d+)?$/.test(clean))throw new Error('Invalid number: '+value);
    return Number(clean);
  }
  function decode(text){
    const raw=parseCsv(text);
    if(!raw.length)throw new Error('The CSV is empty.');
    let section='';const result=[];
    const legacy=/^transfer from/i.test(raw[0][0]);
    const header=raw[0].map(norm);
    const column=(row,names)=>{const index=header.findIndex(h=>names.includes(h));return index<0?'':row[index];};
    raw.forEach((row,index)=>{
      if(legacy){
        if(/^transfer from/i.test(row[0])){section='transfer';return;}
        if(/^stock in/i.test(row[0])){section='warehouse-return';return;}
      }else if(index===0)return;
      const record={line:index+1};
      try{
        if(legacy){
          Object.assign(record,{date:dateISO(row[0]),type:'transfer',imei:serial(row[2]),quantity:number(row[4])??1,
            from:section==='warehouse-return'?String(row[5]).replace(/\s+return$/i,''):'warehouse',
            to:section==='warehouse-return'?'warehouse':row[5],cost:number(row[6]),battery:number(row[8]),model:row[1],reference:''});
        }else{
          const saleReport=header.includes('biller')&&header.includes('product (qty)');
          const product=column(row,['product (qty)','model','product']);
          const qtyMatch=String(product).match(/\((-?\d+)\)/);
          const quantity=number(column(row,['quantity','qty']))??(qtyMatch?Number(qtyMatch[1]):1);
          const products=String(product).split(/\r?\n/).filter(v=>v.trim());
          const type=norm(column(row,['type','action']))||(saleReport?(quantity<0?'return':'sale'):'');
          const sale=number(column(row,['sale_price','sale price','unit sale price']))??
            (saleReport&&products.length===1&&Math.abs(quantity)===1?Math.abs(number(column(row,['grand total']))??0):null);
          Object.assign(record,{date:dateISO(column(row,['date','transfer date'])),type:type==='sold'?'sale':type,
            imei:serial(column(row,['imei','serial','serial number','imei/serial'])||
              (products.length===1?(String(product).match(/\bIMEI[:\s]+([A-Z0-9-]{5,64})/i)?.[1]||
              String(product).match(/\)\s*([A-Z0-9-]{5,64})\s*$/i)?.[1]||''):'')),quantity:Math.abs(quantity),
            from:column(row,['from','from shop','biller','shop']),to:column(row,['to','to shop']),
            cost:number(column(row,['cost_price','cost price','cost'])),sale,battery:number(column(row,['battery','battery %'])),
            model:column(row,['model','product']),memory:column(row,['memory']),color:column(row,['color','colour']),
            condition:column(row,['condition']),description:column(row,['description','product (qty)']),reference:column(row,['reference','reference no','transfer id'])});
          if(saleReport&&products.length>1)throw new Error('Split this invoice into one phone per row and provide each sale price.');
        }
        if(!record.imei)throw new Error('IMEI or serial number is required.');
        if(!/^[A-Z0-9-]{5,64}$/.test(record.imei))throw new Error('IMEI/serial must be text, with no spaces or scientific notation.');
        if(String(record.reference||'').length>128)throw new Error('Reference is longer than 128 characters.');
        if(record.quantity!==1)throw new Error('Use one phone and one IMEI per row.');
        if(!['transfer','sale','return','stock-in','store-sale'].includes(record.type))throw new Error('Type must be transfer, sale, return, stock-in or store-sale.');
        if(record.battery!==null&&(record.battery<0||record.battery>100))throw new Error('Battery must be between 0 and 100.');
        if(record.cost!==null&&record.cost<0)throw new Error('Cost cannot be negative.');
        if(record.sale!==null&&record.sale<0)throw new Error('Sale price cannot be negative.');
      }catch(error){record.error=error.message;}
      result.push(record);
    });
    return result;
  }
  function shopId(data,value){
    const input=norm(value).replace(/^(idfl\s*-\s*|get connected\s*-\s*)/,'');
    const alias=input==='kilkenny'?'kilkenney':input==='portlaoise'?'warehouse':input;
    const matches=data.shops.filter(s=>s.active!==false&&(norm(s.id)===input||norm(s.name)===alias));
    return matches.length===1?matches[0].id:null;
  }
  function eventKey(row){
    // Keep the canonical identity itself: no hash collisions or filename dependence.
    return JSON.stringify([row.reference?norm(row.reference):row.date,row.type,serial(row.imei),norm(row.from),norm(row.to)]);
  }
  function findUnits(data,imei){
    return data.items.flatMap(item=>(item.units||[]).filter(unit=>serial(unit.imei)===imei).map(unit=>({item,unit})));
  }
  function plan(original,records){
    const data=clone(original),results=[];
    data.meta=data.meta||{};data.meta.csvImports=data.meta.csvImports||{};
    let changed=0;
    for(const row of records.map((r,i)=>({...r,order:i})).sort((a,b)=>String(a.date).localeCompare(String(b.date))||a.order-b.order)){
      const result={...row,status:'conflict',message:row.error||''};results.push(result);
      if(row.error)continue;
      const from=shopId(data,row.from),to=shopId(data,row.to);
      const canonical={...row,from:from||row.from,to:to||row.to};
      const key=eventKey(canonical);
      if(data.meta.csvImports[key]){result.status='skip';result.message='Already imported';continue;}
      const matches=findUnits(data,row.imei);
      if(matches.length>1){result.message='Duplicate IMEI in inventory';continue;}
      let found=matches[0];
      const movements=data.movements||[];
      const actionType=['sale','return','store-sale'].includes(row.type)?'sold':row.type==='stock-in'?'stock-in':'transfer-in';
      if(movements.some(m=>serial(m.unitData?.imei)===row.imei&&m.date===row.date&&m.type===actionType&&
          (row.type==='return'?(m.qty<0):['sale','store-sale'].includes(row.type)?(m.qty>0):true)&&
          (row.reference?m.reference===row.reference:(row.type==='transfer'?m.location===to:m.location===from)))){
        result.status='skip';result.message='Already recorded in history';continue;
      }
      if(row.type==='transfer'&&found&&to===found.unit.location){
        data.meta.csvImports[key]={date:row.date,imei:row.imei,type:row.type,reference:row.reference||'',alreadyAtDestination:true};
        result.status='skip';result.message='Already at destination';continue;
      }
      if(row.type==='transfer'&&(!from||!to||from===to)){result.message='Choose valid, different source and destination shops';continue;}
      if(row.type==='sale'&&(!from||row.sale==null)){result.message='Sale needs a valid shop and individual sale price';continue;}
      if(row.type==='store-sale'&&(!from||row.sale==null)){result.message='Direct shop sale needs a shop and individual sale price';continue;}
      if(row.type==='store-sale'&&found){result.message='IMEI already exists: use sale to deduct the existing phone';continue;}
      if(row.type==='return'&&!from){result.message='Return needs the shop receiving the phone';continue;}
      if(row.type==='stock-in'&&!to){result.message='Stock-in needs a destination shop';continue;}
      if(found&&row.type==='stock-in'){result.status='skip';result.message='IMEI already exists';continue;}
      if(found&&row.type==='return'){result.message='Phone is already in stock; return would duplicate it';continue;}
      if(found&&found.unit.transferredAt&&found.unit.transferredAt>row.date){result.message='Phone has a newer transfer; review this older row';continue;}
      if((row.type==='transfer'||row.type==='sale')&&!found){result.message='IMEI not in stock';continue;}
      if(found&&(row.type==='transfer'||row.type==='sale')&&found.unit.location!==from){
        result.message='Phone is at '+found.unit.location+', not '+from;continue;
      }
      if(found&&(row.type==='transfer'||row.type==='sale')&&(found.item.locations?.[from]||0)<1){
        result.message='Stock count is inconsistent for this IMEI';continue;
      }
      if(row.type==='return'){
        const sold=movements.filter(m=>m.type==='sold'&&m.qty>0&&serial(m.unitData?.imei)===row.imei&&m.date<=row.date).at(-1);
        const item=sold&&data.items.find(i=>i.id===sold.itemId);
        if(!item||!sold.unitData){result.message='No matching sale with a recoverable device record';continue;}
        found={item,unit:clone(sold.unitData)};
        found.refundPrice=row.sale??sold.sellPrice??sold.unitData.sellPrice;
        found.unit.location=from;item.units=item.units||[];item.units.push(found.unit);
        item.locations[from]=(item.locations[from]||0)+1;
      }
      if(row.type==='stock-in'){
        const candidates=data.items.filter(i=>norm(i.name)===norm(row.model)&&norm(i.memory)===norm(row.memory));
        if(candidates.length!==1||row.cost==null){result.message='Stock-in needs an exact existing model, memory and cost price';continue;}
        const item=candidates[0];
        found={item,unit:{id:'csv-unit-'+row.imei,imei:row.imei,color:row.color||'',condition:row.condition||item.condition,location:to,costPrice:row.cost,sellPrice:row.sale??item.shopPrices?.[to]??0,dateAdded:row.date,verified:false}};
        item.units=item.units||[];item.units.push(found.unit);item.locations[to]=(item.locations[to]||0)+1;
      }
      if(row.type==='store-sale'){
        const candidates=data.items.filter(i=>norm(i.name)===norm(row.model)&&norm(i.memory)===norm(row.memory));
        if(candidates.length!==1){result.message='Direct shop sale needs an exact existing model and memory';continue;}
        found={item:candidates[0],unit:{id:'csv-unit-'+row.imei,imei:row.imei,color:row.color||'',condition:row.condition||candidates[0].condition,
          location:from,costPrice:row.cost??0,costPriceUnknown:row.cost==null,sellPrice:row.sale,dateAdded:row.date,purchaseDate:null,purchaseDateUnknown:true,batteryPct:row.battery}};
      }
      const {item,unit}=found,prior=clone(unit);
      if(row.cost!=null)unit.costPrice=row.cost;
      if(row.battery!=null)unit.batteryPct=row.battery;
      const base={itemId:item.id,itemName:item.name,categoryId:item.category,qty:1,date:row.date,reference:row.reference||'',csvImportKey:key,note:'CSV import line '+row.line+(row.reference?' · '+row.reference:'')+(row.description?' · '+row.description:''),unitData:prior};
      const movement=(suffix,values)=>({id:'csv-'+safeId(key)+'-'+suffix,...base,...values});
      if(row.type==='transfer'){
        item.locations[from]-=1;item.locations[to]=(item.locations[to]||0)+1;
        unit.location=to;unit.transferredAt=row.date;unit.sentToShopDate=to==='warehouse'?null:row.date;
        data.movements.push(movement('out',{type:'transfer-out',transferId:'csv-'+safeId(key),location:from,toLocation:to}));
        data.movements.push(movement('in',{type:'transfer-in',transferId:'csv-'+safeId(key),location:to,fromLocation:from}));
      }else if(row.type==='store-sale'){
        data.movements.push(movement('stock-in',{type:'stock-in',location:from,unitData:clone(unit),directShopPurchase:true,note:base.note+' · Direct shop receipt, acquisition date not supplied; recorded on sale date for recovery.'}));
        data.movements.push(movement('sold',{type:'sold',location:from,sellPrice:row.sale,unitData:clone(unit),directShopPurchase:true}));
      }else if(row.type==='sale'){
        const soldUnit=clone(unit);soldUnit.sellPrice=row.sale;
        item.units=item.units.filter(u=>u.id!==unit.id);item.locations[from]-=1;
        data.movements.push(movement('sold',{type:'sold',location:from,sellPrice:row.sale,unitData:soldUnit}));
      }else{
        data.movements.push(movement(row.type,{type:row.type==='return'?'sold':'stock-in',qty:row.type==='return'?-1:1,location:unit.location,sellPrice:row.type==='return'?found.refundPrice:(row.sale??unit.sellPrice),unitData:clone(unit)}));
      }
      data.meta.csvImports[key]={date:row.date,imei:row.imei,type:row.type,reference:row.reference||''};
      result.status='ready';result.message=row.type+' matched to '+item.name;changed++;
    }
    return {data,results:results.sort((a,b)=>a.order-b.order),changed};
  }
  const api={parseCsv,dateISO,decode,plan};
  root.InventoryCsv=api;
  if(typeof document==='undefined')return;
  const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let preview=null;
  api.open=function(){
    Modal.open('<div class="modal"><div class="modal-head"><h3>Import transfers and sales</h3><button class="btn" onclick="Modal.close()">Close</button></div><div class="modal-body"><p>Choose your transfer CSV or sales CSV with an IMEI for each phone. You will see a preview before anything changes.</p><input aria-label="Transfer or sales CSV files" type="file" accept=".csv" multiple onchange="InventoryCsv.previewFiles(this.files)"><p>CSV columns: date, type, imei, from, to, sale_price, cost_price, reference. Use one phone per row. For a phone received and sold directly in a shop, use store-sale with its model and memory.</p><button class="btn" onclick="InventoryCsv.template()">Download CSV template</button><div id="inventoryCsvPreview" aria-live="polite"></div></div><div class="modal-foot"><button class="btn" onclick="Modal.close()">Cancel</button><button id="inventoryCsvApply" class="btn primary" disabled onclick="InventoryCsv.apply()">Apply valid rows</button></div></div>');
  };
  api.template=function(){
    const text='date,type,imei,from,to,sale_price,cost_price,reference,model,memory,color,condition,battery\n';
    const link=document.createElement('a');const url=URL.createObjectURL(new Blob([text],{type:'text/csv'}));
    link.href=url;link.download='stockline-transfers-and-sales-template.csv';link.click();URL.revokeObjectURL(url);
  };
  api.previewFiles=async function(files){
    const target=document.getElementById('inventoryCsvPreview'),button=document.getElementById('inventoryCsvApply');
    preview=null;button.disabled=true;
    try{
      if(FirebaseStore._revision===null||!FirebaseStore._loadedUid)throw new Error('Load Firebase inventory before importing.');
      if(FirebaseStore._syncing)throw new Error('Wait for the current cloud save to finish.');
      const baseline=JSON.stringify(Store.data),revision=FirebaseStore._revision;const rows=[];
      for(const file of files){
        if(file.size>5*1024*1024)throw new Error('CSV is larger than 5 MB.');
        rows.push(...decode(await file.text()).map(row=>({...row,filename:file.name})));
      }
      if(rows.length>5000)throw new Error('Use at most 5,000 rows per import.');
      const planned=plan(Store.data,rows);
      preview={baseline,revision,rows,planned};
      const skipped=planned.results.filter(r=>r.status==='skip').length;
      const conflicts=planned.results.filter(r=>r.status==='conflict').length;
      target.innerHTML='<p><b>'+planned.changed+' valid rows</b>, '+skipped+' skipped, '+conflicts+' conflicts. Conflicts will not be applied.</p><div style="max-height:360px;overflow:auto"><table><thead><tr><th>File / row</th><th>IMEI</th><th>Result</th></tr></thead><tbody>'+
        planned.results.map(r=>'<tr><td>'+escape(r.filename)+' / '+r.line+'</td><td>'+escape(r.imei)+'</td><td>'+escape(r.status+': '+r.message)+'</td></tr>').join('')+'</tbody></table></div>';
      button.disabled=!planned.changed;
    }catch(error){target.textContent=error.message;}
  };
  api.apply=async function(){
    const target=document.getElementById('inventoryCsvPreview'),button=document.getElementById('inventoryCsvApply');
    if(!preview)return;
    if(FirebaseStore._syncing||FirebaseStore._revision!==preview.revision||JSON.stringify(Store.data)!==preview.baseline){
      button.disabled=true;target.textContent='Inventory changed since the preview. Choose the files again.';return;
    }
    button.disabled=true;
    Store.snapshotToBackups('Before CSV transfer/sales import');
    Store.data=preview.planned.data;Store.save();clearTimeout(FirebaseStore._timer);
    await FirebaseStore.saveRemote(true);
    if(FirebaseStore._revision===preview.revision+1&&!FirebaseStore._lastSaveError){
      Toast.show(preview.planned.changed+' CSV rows saved to Firebase.','ok');preview=null;Modal.close();render();
    }else{
      target.textContent='Cloud save did not complete. Your local recovery copy is kept. Refresh Firebase before trying again.';
    }
  };
})(typeof window!=='undefined'?window:globalThis);
