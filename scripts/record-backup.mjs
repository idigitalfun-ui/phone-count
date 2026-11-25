import '../stock-records.js';

// Read a complete generation at one revision. Never publish a mixed snapshot.
export async function readRecordBackup(get, base, generation='main-v2') {
  const markerUrl=base+'/phone_count_generations/'+encodeURIComponent(generation);
  for(let attempt=0;attempt<3;attempt++) {
    const before=await get(markerUrl);
    if(before?.fields?.state?.stringValue!=='active')throw Error('Record generation is not active.');
    const revision=before.fields.revision?.integerValue;
    if(!/^\d+$/.test(String(revision)))throw Error('Invalid record revision.');
    const records=new Map();let page='';
    do {
      const response=await get(markerUrl+'/records?pageSize=300'+(page?'&pageToken='+encodeURIComponent(page):''));
      for(const doc of response.documents||[]) {
        if(doc.fields?.deleted?.booleanValue)continue;
        const id=doc.name.split('/').at(-1);
        if(records.has(id))throw Error('Duplicate record in backup.');
        records.set(id,JSON.parse(doc.fields.payload.stringValue));
      }
      page=response.nextPageToken||'';
    }while(page);
    const after=await get(markerUrl);
    if(after?.fields?.state?.stringValue!=='active')throw Error('Generation changed during backup.');
    if(after.fields.revision?.integerValue!==revision)continue;
    const data=globalThis.StockRecords.join(records);
    return {name:markerUrl,fields:{payload:{stringValue:JSON.stringify(data)},revision:{integerValue:revision}},recordGeneration:generation};
  }
  throw Error('Inventory changed during every backup attempt; existing backups retained.');
}
