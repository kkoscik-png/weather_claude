import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const NOW=Date.parse('2026-10-23T06:30:00Z');
const oldTiming={updatedAt:'2026-10-22T09:20:00Z',nextUpdate:'2026-10-23T09:00:00Z',basis:'publication'};
const freshTiming={updatedAt:'2026-10-23T05:53:12Z',nextUpdate:'2026-10-23T08:53:12Z',basis:'publication'};
function fixture(){
 const values=new Map(),nodes=new Map(),requests=[];
 const el=id=>{if(!nodes.has(id))nodes.set(id,{innerHTML:'',textContent:'',style:{},classList:{toggle(){}},closest:()=>null,setAttribute(){},querySelector:()=>null});return nodes.get(id);};
 class Clock extends Date { constructor(...args){super(...(args.length?args:[NOW]));} static now(){return NOW;} }
 const c={Intl,Date:Clock,URLSearchParams,AbortSignal,console,matchMedia:()=>({matches:false}),setTimeout:()=>0,requestAnimationFrame:()=>0,localStorage:{getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value)},document:{getElementById:el,querySelector:el,querySelectorAll:()=>[]},fetch:async(url,options)=>{
  requests.push({url,options});
  if(url.startsWith('/api/model-updates?'))return Response.json({timing:freshTiming,refreshAfter:freshTiming.nextUpdate});
  return Response.json({records:Array.from({length:5},(_,i)=>({id:String(i),hourly:{time:[NOW/1000],wind_speed_10m:[9],wind_gusts_10m:[12],wind_direction_10m:[220]}})),saved:NOW,checkedAt:NOW,refreshAfter:freshTiming.nextUpdate,timing:freshTiming,delivery:'open-meteo',nextOffset:null});
 }};
 vm.createContext(c);vm.runInContext(fs.readFileSync('dist/app.js','utf8').replace(/start\(\);\s*$/,'')+';globalThis.t={state,requestJSON,loadModelTiming,sourceTiming,renderUpdateClocks};',c);
 return {c,t:c.t,values,nodes,requests};
}

test('manual refresh replaces yesterday’s local ICON-EU snapshot even before its stored retry deadline',async()=>{
 const f=fixture(),key='provider-cycle-v4/icon_eu/ports/0';
 f.values.set('baltic-v5-'+key,JSON.stringify({saved:NOW-3600000,data:{timing:oldTiming,refreshAfter:oldTiming.nextUpdate,records:[{old:true}]}}));
 const url='/api/forecast?model=icon_eu&group=ports&offset=0';
 assert.equal((await f.t.requestJSON(url,key)).data.records[0].old,true);assert.equal(f.requests.length,0);
 const fresh=await f.t.requestJSON(url,key,true);assert.equal(f.requests.length,1);assert.equal(fresh.data.timing.updatedAt,freshTiming.updatedAt);
 assert.equal(f.requests[0].options.cache,'no-store');assert.equal(JSON.parse(f.values.get('baltic-v5-'+key)).data.records[0].hourly.wind_speed_10m[0],9);
});

test('discovering a new ICON-EU cycle replaces port records, not just the displayed timestamp',async()=>{
 const f=fixture();f.t.state.model='icon_eu';f.t.state.metas.icon_eu={saved:NOW-3600000,delivery:'open-meteo',timing:oldTiming,refreshAfter:oldTiming.nextUpdate};
 f.t.state.wind.icon_eu=[{hourly:{time:[NOW/1000],wind_speed_10m:[1]}}];
 await f.t.loadModelTiming('icon_eu',true);
 assert.equal(f.requests.length,2);assert(f.requests[0].url.startsWith('/api/model-updates?'));assert(f.requests[1].url.startsWith('/api/forecast?'));
 assert.equal(f.t.state.wind.icon_eu[0].hourly.wind_speed_10m[0],9);assert.equal(f.t.sourceTiming('icon_eu',f.t.state.metas.icon_eu).updatedAt,freshTiming.updatedAt);
});

test('a newer known cycle warns about old records without relabeling them as fresh',()=>{
 const f=fixture();f.t.state.model='icon_eu';f.t.state.metas.icon_eu={saved:NOW-3600000,delivery:'open-meteo',timing:oldTiming};f.t.state.timings.icon_eu=freshTiming;
 f.t.renderUpdateClocks();assert.equal(f.t.sourceTiming('icon_eu',f.t.state.metas.icon_eu).updatedAt,oldTiming.updatedAt);
 assert.match(f.nodes.get('windUpdates').innerHTML,/newer cycle is available/);
});

test('a failed refresh keeps the old forecast timestamp and the newer-cycle warning',async()=>{
 const f=fixture(),oldRecords=Array.from({length:5},(_,i)=>({id:String(i),hourly:{time:[NOW/1000],wind_speed_10m:[1]}}));
 f.t.state.model='icon_eu';f.t.state.metas.icon_eu={saved:NOW-86400000,delivery:'open-meteo',timing:oldTiming,refreshAfter:oldTiming.nextUpdate};f.t.state.wind.icon_eu=oldRecords;
 f.values.set('baltic-v5-provider-cycle-v4/icon_eu/ports/0',JSON.stringify({saved:NOW-3600000,data:{records:oldRecords,saved:NOW-86400000,timing:oldTiming,delivery:'open-meteo',nextOffset:null}}));
 f.c.fetch=async url=>url.startsWith('/api/model-updates?')?Response.json({timing:freshTiming}):new Response('offline',{status:503});
 await f.t.loadModelTiming('icon_eu',true);f.t.renderUpdateClocks();
 assert.equal(f.t.state.wind.icon_eu[0].hourly.wind_speed_10m[0],1);assert.equal(f.t.state.metas.icon_eu.stale,true);
 assert.equal(f.t.sourceTiming('icon_eu',f.t.state.metas.icon_eu).updatedAt,oldTiming.updatedAt);assert.match(f.nodes.get('windUpdates').innerHTML,/newer cycle is available/);
});
