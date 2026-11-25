import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
let count=0;
for(const match of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)){
  if(match[1].includes('src='))continue;
  if(match[1].includes('type="module"')){
    const code=match[2].replace(/^\s*import .*?;\s*$/gm,'');
    new vm.Script('(async()=>{'+code+'})()');
  }else new vm.Script(match[2]);
  count++;
}
if(html!==readFileSync(new URL('../index.html',import.meta.url),'utf8'))throw Error('Root and deployed app differ');
console.log('Both app copies match; '+count+' inline scripts parse');
for(const name of ['stock-records.js','stock-record-cloud.js','inventory-csv.js']){
 const source=readFileSync(new URL('../'+name,import.meta.url),'utf8');
 if(source!==readFileSync(new URL('../public/'+name,import.meta.url),'utf8'))throw Error('Deployed copy differs: '+name);
 new vm.Script(source);
}
