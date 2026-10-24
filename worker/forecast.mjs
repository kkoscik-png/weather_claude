import { normalizeOpenWeather, normalizeSnow } from './open-weather.mjs';
import { createLastGoodCache, normalizeDMIOpenMeteo } from './dmi-resilience.mjs';
import { STORMGLASS_POINTS } from './stormglass-points.mjs';
import { FORECAST_GRIDS, COAST_POINTS, GK_ROUTE_POINTS } from './forecast-points.mjs';
import { loadCopernicus, copernicusDataset } from './copernicus.mjs';
import { loadFcoo, fcooMeta, fcooTiming } from './fcoo.mjs';
import { remoteStore } from './store.mjs';
const HOUR=3600000, BATCH=6, WIDE_MODELS=['icon_eu','icon_global','ecmwf_ifs','dmi_harmonie','metno_nordic','icon_d2','fmi_harmonie','smhi_snow'];
const SOURCES={ecmwf_ifs:{interval:6*HOUR},icon_eu:{interval:3*HOUR},icon_global:{interval:6*HOUR},ecmwf_wam:{interval:6*HOUR},dwd_ewam:{interval:6*HOUR},smhi_snow:{interval:900000},fmi_wam:{interval:6*HOUR},dmi_wam:{interval:6*HOUR,collection:'wam_nsb'},dmi_harmonie:{interval:3*HOUR,collection:'harmonie_dini_sf'},copernicus_baltic:{interval:12*HOUR},fcoo_ww3:{interval:6*HOUR},metno_nordic:{interval:HOUR},icon_d2:{interval:3*HOUR},fmi_harmonie:{interval:3*HOUR}};
const METADATA={dmi_harmonie:['https://api.open-meteo.com','dmi_harmonie_arome_europe'],metno_nordic:['https://api.open-meteo.com','metno_nordic_pp'],icon_d2:['https://api.open-meteo.com','dwd_icon_d2'],ecmwf_ifs:['https://api.open-meteo.com','ecmwf_ifs'],icon_eu:['https://api.open-meteo.com','dwd_icon_eu'],icon_global:['https://api.open-meteo.com','dwd_icon'],ecmwf_wam:['https://marine-api.open-meteo.com','ecmwf_wam'],dwd_ewam:['https://marine-api.open-meteo.com','dwd_ewam']};
// Open-Meteo model ids. DMI HARMONIE AROME is read from Open-Meteo instead of the overloaded DMI EDR API.
const OM_MODEL={dmi_harmonie:'dmi_harmonie_arome_europe',metno_nordic:'metno_nordic',icon_d2:'icon_d2'};
// Regional models: points outside the model domain get empty series instead of failing the whole batch.
const REGIONAL=new Set(['dmi_harmonie','metno_nordic','icon_d2']),ICON_D2_DOMAIN={south:43.18,north:58.08,west:-3.94,east:20.34};
const inDomain=(model,p)=>model!=='icon_d2'||p.lat>=ICON_D2_DOMAIN.south&&p.lat<=ICON_D2_DOMAIN.north&&p.lon>=ICON_D2_DOMAIN.west&&p.lon<=ICON_D2_DOMAIN.east;
// Map fields only: where a regional model has no data (outside its domain) the field is filled
// from the provider's seamless blend; models without an Open-Meteo field use ECMWF IFS there.
const FIELD_FILL={dmi_harmonie:'dmi_seamless',metno_nordic:'metno_seamless',icon_d2:'icon_seamless'};
const WIDE_SOURCE={...FIELD_FILL,fmi_harmonie:'ecmwf_ifs',smhi_snow:'ecmwf_ifs'};
const OM_ATTRIBUTION={dmi_harmonie:'DMI HARMONIE AROME',metno_nordic:'MET Norway MET Nordic',icon_d2:'DWD ICON-D2'};
const GROUPS={ports:STORMGLASS_POINTS.ports,route:STORMGLASS_POINTS.route,'wind-grid':FORECAST_GRIDS.windGrid.map((p,i)=>({...p,id:String(i)})),'wave-grid':FORECAST_GRIDS.waveGrid.map((p,i)=>({...p,id:String(i)})),'wide-grid':FORECAST_GRIDS.wideGrid.map((p,i)=>({...p,id:String(i)})),coast:COAST_POINTS.map(({id,lat,lon})=>({id,lat,lon})),'route-gk':GK_ROUTE_POINTS.map(({id,lat,lon})=>({id,lat,lon}))};
const json=(value,status=200,extraHeaders={})=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...extraHeaders}});
const numeric=(x,max=Infinity)=>typeof x==='number'&&Number.isFinite(x)&&x>=0&&x<=max?x:null;
// Bump a model's revision when its sampling changes, so stored cycles are not reused.
// Groups whose point list changed (ports: +Gdynia, +Karlskrona; coast: +16 points) get a new revision too.
const CYCLE_REVISION={fcoo_ww3:2,dmi_harmonie:4,dmi_wam:3},GROUP_REVISION={ports:3,coast:2},cycleKey=(model,group,offset)=>[model+(CYCLE_REVISION[model]?'@'+CYCLE_REVISION[model]:''),group+(GROUP_REVISION[group]?'@'+GROUP_REVISION[group]:''),offset].join('/');
const iso=x=>Number.isFinite(x)?new Date(x).toISOString():null;
// What the app loads, per source: wind sources → ports, map field and zoomed-out grid;
// wave sources → ports, map field, both routes and the coast points.
const PREWARM_WIND=['icon_eu','ecmwf_ifs','smhi_snow','dmi_harmonie','metno_nordic','fmi_harmonie','icon_global','icon_d2'],PREWARM_WAVE=['ecmwf_wam','fmi_wam','dwd_ewam','copernicus_baltic','fcoo_ww3'];
export function prewarmTasks(){
  const batches=(model,group)=>{const n=GROUPS[group].length,b=group==='wide-grid'?n:BATCH,out=[];for(let o=0;o<(group==='ports'?1:n);o+=b)out.push({model,group,offset:o});return out;};
  return [...[...PREWARM_WIND,...PREWARM_WAVE].flatMap(m=>batches(m,'ports')),...PREWARM_WIND.flatMap(m=>batches(m,'wind-grid')),...PREWARM_WAVE.flatMap(m=>[...batches(m,'wave-grid'),...batches(m,'route'),...batches(m,'coast'),...batches(m,'route-gk')]),...PREWARM_WIND.flatMap(m=>batches(m,'wide-grid'))];
}
export function modelTiming(updatedAt,interval,referenceTime=null,basis='publication') {
  const t=Date.parse(updatedAt);return {updatedAt:Number.isFinite(t)?iso(t):null,referenceTime,nextUpdate:Number.isFinite(t)?iso(t+interval):null,basis,estimated:true};
}
function dmiTiming(referenceTime,model){
  const timing=modelTiming(referenceTime,SOURCES[model].interval,referenceTime,'reference');
  // DMI documents +2h45m from cycle start to complete surface/WAM data.
  timing.nextUpdate=iso(Date.parse(referenceTime)+SOURCES[model].interval+165*60000);return timing;
}
const FMI_WAM={fields:{SigWaveHeight:'wave_height',WaveDirection:'wave_direction',WavePeriod:'wave_period'},model:'WAM',interval:6*HOUR};
export const FMI_HARMONIE={fields:{WindSpeedMS:'wind_speed_10m',WindGust:'wind_gusts_10m',WindDirection:'wind_direction_10m',Temperature:'temperature_2m',TotalCloudCover:'cloud_cover',LowCloudCover:'cloud_cover_low',MediumCloudCover:'cloud_cover_mid',HighCloudCover:'cloud_cover_high',Precipitation1h:'precipitation'},model:'HARMONIE',interval:3*HOUR};
// FMI WFS "timevaluepair" stored queries (WAM waves, HARMONIE weather). One member per parameter.
export function normalizeFMI(xml,points,kind=FMI_WAM) {
  if (xml.includes('ExceptionReport')) throw Error('FMI rejected the request');
  const fields=kind.fields,keys=[...new Set(Object.values(fields))];
  const records=points.map(p=>({id:p.id,latitude:p.lat,longitude:p.lon,provider:'FMI',model:kind.model,hourly:{time:[],...Object.fromEntries(keys.map(k=>[k,[]]))}}));
  const rows=points.map(()=>new Map());
  const clean=(field,v)=>!Number.isFinite(v)?null:field==='temperature_2m'?Math.round(v*10)/10:numeric(v,field.endsWith('direction')||field==='wind_direction_10m'?360:field.startsWith('cloud_cover')?100:Infinity);
  let updatedAt=null,referenceTime=null;
  for(const match of xml.matchAll(/<wfs:member>([\s\S]*?)<\/wfs:member>/g)) {
    const member=match[1],pos=member.match(/<gml:pos[^>]*>([^<]+)<\/gml:pos>/)?.[1]?.trim().split(/\s+/).map(Number);
    const field=fields[member.match(/observableProperty=forecast[^"<>]*?param=([^&"<>]+)/)?.[1]];
    if(!pos||!field)continue;
    // A single-point query is answered for that point even if FMI rounds the echoed position.
    const i=points.length===1?0:points.findIndex(p=>Math.abs(p.lat-pos[0])<0.0001&&Math.abs(p.lon-pos[1])<0.0001);if(i<0)continue;
    const resultTime=member.match(/<om:resultTime>([\s\S]*?)<\/om:resultTime>/)?.[1]?.match(/<gml:timePosition[^>]*>([^<]+)/)?.[1];
    const analysis=member.match(/<om:parameter>([\s\S]*?)<\/om:parameter>/g)?.find(s=>s.includes('analysisTime'))?.match(/<gml:timePosition[^>]*>([^<]+)/)?.[1];
    if(resultTime&&(!updatedAt||Date.parse(resultTime)<Date.parse(updatedAt)))updatedAt=resultTime;
    if(analysis)referenceTime=analysis;
    for(const pair of member.matchAll(/<wml2:MeasurementTVP>([\s\S]*?)<\/wml2:MeasurementTVP>/g)) {
      const time=Date.parse(pair[1].match(/<wml2:time>([^<]+)/)?.[1])/1000,raw=pair[1].match(/<wml2:value[^>]*>([^<]+)/)?.[1];
      if(!Number.isFinite(time))continue;if(!rows[i].has(time))rows[i].set(time,{});
      rows[i].get(time)[field]=raw?.trim()?clean(field,Number(raw)):null;
    }
  }
  records.forEach((r,i)=>{for(const [t,values] of [...rows[i]].sort((a,b)=>a[0]-b[0])){r.hourly.time.push(t);for(const key of keys)r.hourly[key].push(values[key]??null);}});
  if(!records.some(r=>r.hourly.time.length))throw Error('No FMI data');
  return {records,timing:modelTiming(updatedAt,kind.interval,referenceTime),attribution:'Finnish Meteorological Institute, CC BY 4.0'};
}
export function normalizeDMI(data,points,model,referenceTime,fetchedAt=Date.now()) {
  const axes=data.domain?.axes,range=data.ranges;if(!axes?.t?.values||!range)throw Error('Invalid DMI forecast');
  const fields=model==='dmi_wam'?{'significant-wave-height':'wave_height','mean-wave-dir':'wave_direction','mean-wave-period':'wave_period'}:{'wind-speed-10m':'wind_speed_10m','wind-dir-10m':'wind_direction_10m','gust-wind-speed-10m':'wind_gusts_10m','fraction-of-cloud-cover':'cloud_cover','high-cloud-cover':'cloud_cover_high','medium-cloud-cover':'cloud_cover_mid','low-cloud-cover':'cloud_cover_low','temperature-2m':'temperature_2m'};
  const xs=axes.x?.values,ys=axes.y?.values;if(!xs?.length||!ys?.length)throw Error('No DMI grid');
  const nearest=(arr,v)=>arr.reduce((best,x,i)=>Math.abs(x-v)<Math.abs(arr[best]-v)?i:best,0);
  const records=points.map(p=>{
    let x=nearest(xs,p.lon),y=nearest(ys,p.lat);
    const read=(key,t,xx=x,yy=y)=>{const r=range[key];if(!r)return null;let index=0;for(let j=0;j<r.axisNames.length;j++)index=index*r.shape[j]+({t,x:xx,y:yy}[r.axisNames[j]]??0);return numeric(r.values[index],key.includes('dir')?360:Infinity);};
    if(model==='dmi_wam'&&read('significant-wave-height',0)===null){let best=Infinity;for(let yy=Math.max(0,y-2);yy<=Math.min(ys.length-1,y+2);yy++)for(let xx=Math.max(0,x-2);xx<=Math.min(xs.length-1,x+2);xx++){const d=(xs[xx]-p.lon)**2*Math.cos(p.lat*Math.PI/180)**2+(ys[yy]-p.lat)**2;if(d<best&&read('significant-wave-height',0,xx,yy)!==null){best=d;x=xx;y=yy;}}}
    const hourly={time:axes.t.values.map(t=>Date.parse(t)/1000)};for(const [field,key] of Object.entries(fields))hourly[key]=axes.t.values.map((_,t)=>{const v=read(field,t);return key==='temperature_2m'?(v===null?null:v-273.15):key==='cloud_cover'?numeric(v===null?null:v*100,100):key.startsWith('cloud_cover_')?numeric(v,100):v;});
    if(model==='dmi_harmonie')hourly.precipitation=axes.t.values.map((_,t)=>{if(!t||hourly.time[t]-hourly.time[t-1]!==3600)return null;const a=read('total-precipitation',t-1),b=read('total-precipitation',t);return a!==null&&b!==null&&b>=a?b-a:null;});
    return {id:p.id,latitude:ys[y],longitude:xs[x],provider:'DMI',model:model==='dmi_wam'?'WAM NSB':'HARMONIE DINI',referenceTime,hourly};
  });
  return {records,timing:Number.isFinite(Date.parse(referenceTime))?dmiTiming(referenceTime,model):modelTiming(iso(fetchedAt),HOUR,null,'fetch'),attribution:'Danish Meteorological Institute, CC BY 4.0'};
}
export function createDMIRequester({fetcher,now=()=>Date.now(),cache=null,pause=ms=>new Promise(resolve=>setTimeout(resolve,ms))}){
 let queue=Promise.resolve(),nextRequest=0,cooldownUntil=0,failures=0,lastBackoff=0;
 const cooldownKey=new Request('https://weather.seasync.co/__dmi_cooldown/v2');
 const storage=()=>cache||(typeof caches!=='undefined'?caches.default:null);
 const busy=until=>Object.assign(Error('DMI is overloaded. Next attempt after a pause.'),{status:429,retryAt:until,retryAfter:Math.max(1,Math.ceil((until-now())/1000))});
 return url=>{
  const job=queue.then(async()=>{
   const store=storage();if(store){const hit=await store.match(cooldownKey);if(hit){const state=await hit.json();cooldownUntil=Math.max(cooldownUntil,Number(state.until)||0);failures=Math.max(failures,state.failures||0);lastBackoff=Math.max(lastBackoff,state.backoff||0);}}
   if(now()<cooldownUntil)throw busy(cooldownUntil);
   const delay=Math.max(0,nextRequest-now());if(delay)await pause(delay);nextRequest=now()+1000;
   const response=await fetcher(url,{signal:AbortSignal.timeout(60000),headers:{Accept:'application/geo+json, application/prs.coverage+json, application/json'}});
   if(response.status===429){
    failures++;const raw=response.headers.get('Retry-After'),seconds=raw&&/^\d+(\.\d+)?$/.test(raw)?Number(raw):null,headerDelay=seconds!==null?seconds*1000:raw?Date.parse(raw)-now():NaN;
    const backoff=Math.max(Number.isFinite(headerDelay)?headerDelay:0,Math.min(900000,lastBackoff?lastBackoff*2:60000));cooldownUntil=now()+backoff;lastBackoff=backoff;
    if(store)await store.put(cooldownKey,new Response(JSON.stringify({until:cooldownUntil,failures,backoff}),{headers:{'Content-Type':'application/json','Cache-Control':'public, max-age=86400'}}));
    await response.body?.cancel();throw busy(cooldownUntil);
   }
   if(!response.ok){const error=Object.assign(Error('DMI: HTTP '+response.status),{status:response.status});await response.body?.cancel();throw error;}
   // Metadata success does not mean the forecast data service has recovered.
   if(/\/(position|cube)\?/.test(url)){failures=0;lastBackoff=0;cooldownUntil=0;if(store)await store.put(cooldownKey,new Response(JSON.stringify({until:0,failures:0,backoff:0}),{headers:{'Cache-Control':'public, max-age=1'}}));}
   return response;
  });queue=job.catch(()=>{});return job;
 };
}
export function normalizeDMIGeoJSON(data,points,model,referenceTime=null,fetchedAt=Date.now()){
 if(data.type!=='FeatureCollection'||!Array.isArray(data.features))throw Error('Invalid DMI GeoJSON');
 const records=points.map(point=>{
  const features=data.features.filter(f=>f.geometry?.type==='Point'&&f.geometry.coordinates?.length>=2&&Number.isFinite(Date.parse(f.properties?.step)));
  if(!features.length)throw Error('DMI returned no forecast for the point');
  const nearest=features.reduce((a,b)=>{const distance=f=>(f.geometry.coordinates[0]-point.lon)**2*Math.cos(point.lat*Math.PI/180)**2+(f.geometry.coordinates[1]-point.lat)**2;return distance(b)<distance(a)?b:a;});
  const [lon,lat]=nearest.geometry.coordinates,rows=new Map();for(const feature of features){const [x,y]=feature.geometry.coordinates;if(Math.abs(x-lon)>1e-7||Math.abs(y-lat)>1e-7)continue;const step=feature.properties.step;rows.set(step,{...rows.get(step),...feature.properties});}
  const times=[...rows.keys()].sort((a,b)=>Date.parse(a)-Date.parse(b)),keys=new Set(times.flatMap(t=>Object.keys(rows.get(t))));keys.delete('step');
  const coverage={domain:{axes:{t:{values:times},x:{values:[lon]},y:{values:[lat]}}},ranges:Object.fromEntries([...keys].map(key=>[key,{axisNames:['t','y','x'],shape:[times.length,1,1],values:times.map(t=>rows.get(t)[key]??null)}]))};
  return normalizeDMI(coverage,[point],model,referenceTime,fetchedAt).records[0];
 });
 return {records,timing:Number.isFinite(Date.parse(referenceTime))?dmiTiming(referenceTime,model):modelTiming(iso(fetchedAt),HOUR,null,'fetch'),attribution:'Danish Meteorological Institute, CC BY 4.0'};
}
export function createTTLCache({now=()=>Date.now(),cache=null,memory=new Map(),pending=new Map()}={}){
  return async function cached(key,ttl,load,ctx={}) {
    const old=memory.get(key);if(old&&now()-old.saved<ttl*1000)return old.value;
    const storage=cache||(typeof caches!=='undefined'?caches.default:null),request=new Request('https://weather.seasync.co/__forecast_cache/v10/'+encodeURIComponent(key));
    // Keep the original download time: a copy read back from the shared cache
    // must not receive a fresh TTL in memory, or data could age to twice the TTL.
    if(storage&&ttl){try{const hit=await storage.match(request);if(hit){const entry=await hit.json();if(Number.isFinite(entry?.saved)&&now()-entry.saved<ttl*1000){memory.set(key,entry);return entry.value;}}}catch{}}
    if(!pending.has(key))pending.set(key,(async()=>{const value=await load();if(ttl){const entry={saved:now(),value};if(memory.size>180)memory.delete(memory.keys().next().value);memory.set(key,entry);if(storage){const task=storage.put(request,new Response(JSON.stringify(entry),{headers:{'Content-Type':'application/json','Cache-Control':'public, max-age='+ttl}})).catch(()=>{});if(ctx.waitUntil)ctx.waitUntil(task);else await task;}}return value;})().finally(()=>pending.delete(key)));
    return pending.get(key);
  }
}
export function createForecastAPI({fetcher=(...args)=>fetch(...args),now=()=>Date.now(),cache=null,pause}={}) {
  const memory=new Map(),pending=new Map(),dmiTimings=new Map(),dmiResponse=createDMIRequester({fetcher,now,cache,pause}),shared={store:null},remote=()=>shared.store,lastGood=createLastGoodCache({now,cache,remote,prefix:'c/'}),schedules=createLastGoodCache({now,cache,usable:v=>Number.isFinite(Date.parse(v?.timing?.updatedAt)),remote,prefix:'s/'});
  const cached=createTTLCache({now,cache,memory,pending});
  async function response(url) {if(url.startsWith('https://opendataapi.dmi.dk/'))return dmiResponse(url);const r=await fetcher(url,{signal:AbortSignal.timeout(35000),headers:{Accept:'application/json, application/xml, */*'}});if(!r.ok){const e=Error('Source temporarily unavailable ('+r.status+')');e.status=r.status;throw e;}return r;}
  const getJSON=(url,ttl=300)=>cached(url,ttl,async()=>await(await response(url)).json());
  const getBuffer=async url=>await(await response(url)).arrayBuffer();
  const getText=(url,ttl=300)=>cached('text/'+url,ttl,async()=>await(await response(url)).text());
  async function getSchedule(model,delivery='auto'){
    return schedules(model+'/'+delivery,async()=>{
      let timing;
      if(model==='dmi_wam'&&delivery!=='open-meteo'){
        const root='https://opendataapi.dmi.dk/v1/forecastedr/collections/'+SOURCES[model].collection,runs=await getJSON(root+'/instances',0);
        const ids=runs.instances.map(r=>r.id).sort().reverse(),id=ids.find(id=>Date.parse(id.replace(/T(\d{2})(\d{2})(\d{2})Z$/,'T$1:$2:$3Z'))+165*60000<=now())||ids[0];
        timing=dmiTiming(id.replace(/T(\d{2})(\d{2})(\d{2})Z$/,'T$1:$2:$3Z'),model);
      }else if(model==='fcoo_ww3'){
        timing=fcooTiming(await fcooMeta({getText,cached}));
      }else if(model==='copernicus_baltic'){
        const d=await copernicusDataset(url=>getJSON(url,0),now());timing=modelTiming(d.properties.admp_updated_data||d.properties.admp_updated,12*HOUR);
      }else{
        const [host,id]=METADATA[model],data=await getJSON(host+'/data/'+id+'/static/meta.json',0);
        timing=modelTiming(iso(data.last_run_availability_time*1000),data.update_interval_seconds*1000,iso(data.last_run_initialisation_time*1000));
      }
      return {timing,saved:now()};
    });
  }
  const omWindow=()=>{const hour=Math.floor(now()/HOUR)*HOUR;return {start:hour-HOUR,end:hour+95*HOUR};};
  // An out-of-domain point of a regional model: same hourly axis, all values empty.
  function emptyRecord(model,p,fields){const {start,end}=omWindow(),time=[];for(let t=start;t<=end;t+=HOUR)time.push(t/1000);return {id:p.id,latitude:p.lat,longitude:p.lon,provider:OM_ATTRIBUTION[model]||model,model,outsideDomain:true,hourly:{time,...Object.fromEntries(fields.split(',').map(f=>[f,time.map(()=>null)]))}};}
  async function fetchOpenWeather(model,points,group,source=null){
    const wave=['ecmwf_wam','dwd_ewam'].includes(model),host=wave?'https://marine-api.open-meteo.com/v1/marine':'https://api.open-meteo.com/v1/forecast';
    let fields=wave?'wave_height,wave_direction,wave_period':'wind_speed_10m,wind_gusts_10m,wind_direction_10m'+(group==='ports'?',cloud_cover,cloud_cover_low,cloud_cover_mid,cloud_cover_high,precipitation,precipitation_probability,temperature_2m':'');
    const {start,end}=omWindow();
    const request=async list=>{
      const query={latitude:list.map(p=>p.lat).join(','),longitude:list.map(p=>p.lon).join(','),hourly:fields,models:source||OM_MODEL[model]||model,timeformat:'unixtime',timezone:'UTC',start_hour:iso(start).slice(0,16),end_hour:iso(end).slice(0,16),cell_selection:wave?'sea':'nearest',...(!wave?{wind_speed_unit:'ms',temperature_unit:'celsius'}:{})};
      try{return normalizeOpenWeather(await(await response(host+'?'+new URLSearchParams(query))).json(),list,model,wave);}
      catch(e){
        // Not every model offers the chance of rain; ask again without it rather than lose the forecast.
        if(e.status!==400||!fields.includes(',precipitation_probability'))throw e;
        query.hourly=fields.replace(',precipitation_probability','');
        return normalizeOpenWeather(await(await response(host+'?'+new URLSearchParams(query))).json(),list,model,wave);
      }
    };
    let records;
    if(source||!REGIONAL.has(model))records=await request(points);
    else{
      const inside=points.filter(p=>inDomain(model,p));
      // Open-Meteo rejects a whole multi-point request ("No data is available for this location")
      // when one point is outside a regional domain; then ask point by point.
      let got=[];
      if(inside.length){try{got=await request(inside);}catch(e){if(e.status!==400)throw e;got=[];for(const p of inside){try{got.push(...await request([p]));}catch(err){if(err.status!==400)throw err;}}}}
      const byId=new Map(got.map(r=>[r.id,r]));
      // Map fields: fill out-of-domain points from the seamless blend so the field has no holes.
      const missing=points.filter(p=>!byId.has(p.id));
      if(missing.length&&group!=='ports'&&FIELD_FILL[model]){try{const fill=await fetchOpenWeather(model,missing,group,FIELD_FILL[model]);for(const r of fill.records)byId.set(r.id,{...r,filledFrom:FIELD_FILL[model]});}catch{}}
      records=points.map(p=>byId.get(p.id)||emptyRecord(model,p,fields));
      if(!got.length&&group==='ports')throw Error('No '+model+' data for the ports');
    }
    const saved=now();let timing;
    try{timing=(await getSchedule(model)).timing;}catch{timing=modelTiming(iso(saved),SOURCES[model]?.interval||HOUR,null,'fetch');}
    return {records,saved,timing,delivery:'open-meteo',attribution:(OM_ATTRIBUTION[model]?OM_ATTRIBUTION[model]+' · ':'')+(wave?'Marine forecasts':'Weather forecasts')+' / Open-Meteo, CC BY 4.0'};
  }
  // FMI HARMONIE (MEPS) from FMI open data: one WFS point query per position.
  async function fmiHarmoniePoint(p,full){
    const hour=Math.floor(now()/HOUR)*HOUR,url=new URL('https://opendata.fmi.fi/wfs');
    url.search=new URLSearchParams({service:'WFS',version:'2.0.0',request:'getFeature',storedquery_id:'fmi::forecast::harmonie::surface::point::timevaluepair',parameters:full?Object.keys(FMI_HARMONIE.fields).join(','):'WindSpeedMS,WindGust,WindDirection',starttime:iso(hour-HOUR),endtime:iso(hour+95*HOUR),timestep:'60',latlon:p.lat+','+p.lon});
    const result=normalizeFMI(await(await response(url.href)).text(),[p],FMI_HARMONIE);result.records[0].model='HARMONIE';return result;
  }
  async function fetchFMIHarmonie(points,group){
    const results=[];
    for(let k=0;k<points.length;k+=3)results.push(...await Promise.all(points.slice(k,k+3).map(p=>fmiHarmoniePoint(p,group==='ports').catch(e=>{if(e.status===429||e.status>=500)throw e;return null;}))));
    const ok=results.filter(Boolean);if(!ok.length)throw Error('No FMI HARMONIE data');
    const axis=ok[0].records[0].hourly.time,records=points.map((p,i)=>results[i]?.records[0]||{id:p.id,latitude:p.lat,longitude:p.lon,provider:'FMI',model:'HARMONIE',outsideDomain:true,hourly:{time:axis,...Object.fromEntries(Object.values(FMI_HARMONIE.fields).map(f=>[f,axis.map(()=>null)]))}});
    const timing=ok.map(r=>r.timing).filter(t=>t.updatedAt).sort((a,b)=>Date.parse(a.updatedAt)-Date.parse(b.updatedAt))[0]||modelTiming(iso(now()),3*HOUR,null,'fetch');
    return {records,timing,saved:now(),delivery:'fmi',attribution:'Finnish Meteorological Institute (HARMONIE), CC BY 4.0'};
  }
  async function fetchModel(model,points,group) {
    if(group==='wide-grid'&&WIDE_SOURCE[model])return fetchOpenWeather(model,points,group,WIDE_SOURCE[model]);
    if(model==='smhi_snow'&&group==='wind-grid')return fetchOpenWeather(model,points,group,'ecmwf_ifs');
    if(METADATA[model])return fetchOpenWeather(model,points,group);
    if(model==='fmi_harmonie')return fetchFMIHarmonie(points,group);
    if(model==='smhi_snow'){
      const records=[];for(const p of points){const url='https://opendata-download-metfcst.smhi.se/api/category/snow1g/version/1/geotype/point/lon/'+p.lon+'/lat/'+p.lat+'/data.json';records.push(normalizeSnow(await(await response(url)).json(),p));}
      const referenceTime=records.map(r=>r.referenceTime).filter(Boolean).sort()[0];return {records,saved:now(),timing:modelTiming(referenceTime,900000,referenceTime,'reference'),attribution:'SMHI Open Data, CC BY 4.0'};
    }
    // Match the shared UI axis: previous full hour through 71 hours ahead.
    const start=iso(Math.floor(now()/HOUR)*HOUR-(model==='dmi_harmonie'?2:1)*HOUR),end=iso(Math.floor(now()/HOUR)*HOUR+71*HOUR);
    if(model==='copernicus_baltic')return loadCopernicus(points,{getJSON,getBuffer,now:now()});
    if(model==='fcoo_ww3')return loadFcoo(points,group,{getText,cached,now:now()});
    if(model==='fmi_wam'){
      // The documented stored query accepts one location. Repeated latlon
      // parameters are not reliably honoured, so fetch every point explicitly.
      // Harbour samples use verified nearby sea positions, disclosed in the UI.
      const sea={0:{lat:57.437578,lon:21.525557},1:{lat:57.398842,lon:21.466607},2:{lat:58.909033,lon:18.034752},3:{lat:54.535,lon:18.60},4:{lat:56.075,lon:15.645}};
      const results=[];
      for(let offset=0;offset<points.length;offset+=2){
        results.push(...await Promise.all(points.slice(offset,offset+2).map(async p=>{
          const sample=group==='ports'?{...p,...sea[p.id]}:p;
          const url=new URL('https://opendata.fmi.fi/wfs');url.search=new URLSearchParams({service:'WFS',version:'2.0.0',request:'getFeature',storedquery_id:'fmi::forecast::wam::point::timevaluepair',parameters:'SigWaveHeight,WaveDirection,WavePeriod',starttime:start,endtime:end,timestep:'60',latlon:sample.lat+','+sample.lon});
          const result=normalizeFMI(await(await response(url.href)).text(),[sample],FMI_WAM);if(group==='ports')result.records[0].coordinateType='sea-query';return result;
        })));
      }
      const timing=results.map(r=>r.timing).sort((a,b)=>Date.parse(a.updatedAt)-Date.parse(b.updatedAt))[0];
      return {records:results.flatMap(r=>r.records),timing,attribution:'Finnish Meteorological Institute, CC BY 4.0'};
    }
    const collection=SOURCES[model].collection,root='https://opendataapi.dmi.dk/v1/forecastedr/collections/'+collection;
    // The collection endpoint selects the latest COMPLETE run, as documented by DMI.
    const collectionMeta=await getJSON(root,3600),interval=collectionMeta.extent?.temporal?.interval?.[0]||[];
    const availableStart=Date.parse(interval[0]),availableEnd=Date.parse(interval[1]);
    const queryStart=iso(Math.max(Date.parse(start),Number.isFinite(availableStart)?availableStart:Date.parse(start))),queryEnd=iso(Math.min(Date.parse(end),Number.isFinite(availableEnd)?availableEnd:Date.parse(end)));
    if(Date.parse(queryEnd)<Date.parse(queryStart))throw Error('No DMI forecast in the selected range.');
    const fields=model==='dmi_wam'?'significant-wave-height,mean-wave-dir,mean-wave-period':'wind-speed-10m,wind-dir-10m,gust-wind-speed-10m'+(group==='ports'?',fraction-of-cloud-cover,high-cloud-cover,medium-cloud-cover,low-cloud-cover,total-precipitation,temperature-2m':'');
    const records=[],savedTimes=[];
    // Distant app samples must not request a giant rectangular 2-km wind grid.
    // Small fixed-point requests stay below EDR's payload and Worker limits.
    for(const p of points){
      // Coastal and harbour cells can be land-masked in the 5 km WAM grid; read a small
      // cube and use the nearest wet cell of the same model instead of returning nothing.
      const sea=model==='dmi_wam'&&(group==='ports'||group==='coast');
      const query={crs:'crs84','parameter-name':fields,datetime:queryStart+'/'+queryEnd,f:sea?'CoverageJSON':'GeoJSON'};
      if(sea)query.bbox=[p.lon-.12,p.lat-.08,p.lon+.12,p.lat+.08].join(',');else query.coords='POINT('+p.lon+' '+p.lat+')';
      const url=root+'/'+(sea?'cube':'position')+'?'+new URLSearchParams(query).toString().replace(/\+/g,'%20');
      const pointKey=['dmi-point',model,p.lon,p.lat,group==='ports'?'weather':'grid'].join('/');
      const result=await cached(pointKey,3600,async()=>{const data=await(await response(url)).json(),saved=now(),result=sea?normalizeDMI(data,[p],model,null,saved):normalizeDMIGeoJSON(data,[p],model,null,saved);return {...result,saved};});
      records.push(...result.records);savedTimes.push(result.saved);
    }
    const saved=Math.min(...savedTimes);let timing;try{timing=(await getSchedule(model)).timing;}catch{timing=modelTiming(iso(saved),SOURCES[model].interval,null,'fetch');}dmiTimings.set(model,timing);return {records,timing,saved,delivery:'dmi',attribution:'Danish Meteorological Institute, CC BY 4.0'};
  }
  async function fetchDMIFallback(points,group){
    const hour=Math.floor(now()/HOUR)*HOUR,fields=['wind_speed_10m','wind_gusts_10m','wind_direction_10m',...(group==='ports'?['temperature_2m','cloud_cover','cloud_cover_low','cloud_cover_mid','cloud_cover_high','precipitation','precipitation_probability']:[])];
    const query={latitude:points.map(p=>p.lat).join(','),longitude:points.map(p=>p.lon).join(','),hourly:fields.join(','),models:'dmi_seamless',wind_speed_unit:'ms',temperature_unit:'celsius',timeformat:'unixtime',timezone:'UTC',start_hour:iso(hour-HOUR).slice(0,16),end_hour:iso(hour+95*HOUR).slice(0,16),cell_selection:'nearest'};
    const result=await fetcher('https://api.open-meteo.com/v1/forecast?'+new URLSearchParams(query),{signal:AbortSignal.timeout(60000)});
    if(!result.ok)throw Object.assign(Error('Open-Meteo: HTTP '+result.status),{status:result.status});
    const payload=normalizeDMIOpenMeteo(await result.json(),points,now());try{payload.timing=(await getSchedule('dmi_harmonie','open-meteo')).timing;}catch{}dmiTimings.set('dmi_harmonie',payload.timing);return payload;
  }
  // Point forecast for a map click: the selected model at that exact position (nearest model cell).
  const POINT_WIND={icon_eu:'icon_eu',icon_global:'icon_global',ecmwf_ifs:'ecmwf_ifs',dmi_harmonie:'dmi_harmonie_arome_europe',metno_nordic:'metno_nordic',icon_d2:'icon_d2'},POINT_WAVE=['ecmwf_wam','dwd_ewam'];
  async function pointForecast(model,lat,lon){
    const p={id:'0',lat,lon};
    if(model==='fmi_harmonie')return {record:(await fmiHarmoniePoint(p,false)).records[0],source:'FMI HARMONIE · FMI open data'};
    if(model==='smhi_snow'){const url='https://opendata-download-metfcst.smhi.se/api/category/snow1g/version/1/geotype/point/lon/'+lon+'/lat/'+lat+'/data.json';return {record:normalizeSnow(await(await response(url)).json(),p),source:'SMHI SNOW1gv1'};}
    const wave=POINT_WAVE.includes(model),host=wave?'https://marine-api.open-meteo.com/v1/marine':'https://api.open-meteo.com/v1/forecast';
    const hour=Math.floor(now()/HOUR)*HOUR,query={latitude:lat,longitude:lon,hourly:wave?'wave_height,wave_direction,wave_period':'wind_speed_10m,wind_gusts_10m,wind_direction_10m',models:wave?model:POINT_WIND[model],timeformat:'unixtime',timezone:'UTC',start_hour:iso(hour-HOUR).slice(0,16),end_hour:iso(hour+95*HOUR).slice(0,16),cell_selection:wave?'sea':'nearest',...(wave?{}:{wind_speed_unit:'ms'})};
    const data=await(await response(host+'?'+new URLSearchParams(query))).json();
    return {record:normalizeOpenWeather(data,[p],model,wave)[0],source:OM_ATTRIBUTION[model]?OM_ATTRIBUTION[model]+' via Open-Meteo':(wave?'Marine':'Weather')+' forecast via Open-Meteo'};
  }
  // Scheduled pre-fetch: every source and point group the app shows, in the order a visitor
  // needs them (ports first). Only entries whose cycle is due are fetched; each one runs as its
  // own request (call), so a slow provider does not hold up the others.
  async function prewarm(env,call,{limit=16,concurrency=4}={}){
    shared.store=shared.store||remoteStore(env);if(!shared.store)return {skipped:'no store'};
    const tasks=prewarmTasks(),keys=tasks.map(t=>'c/'+cycleKey(t.model,t.group,t.offset));
    const dueKeys=new Set(await shared.store.due(keys,now())),due=tasks.filter((t,i)=>dueKeys.has(keys[i])).slice(0,limit);
    let ran=0,failed=0;const queue=[...due];
    await Promise.all(Array.from({length:Math.min(concurrency,queue.length)},async()=>{for(let t=queue.shift();t;t=queue.shift()){try{const r=await call(new Request('https://weather.seasync.co/api/forecast?'+new URLSearchParams({model:t.model,group:t.group,offset:String(t.offset)})));await r.body?.cancel?.();r.ok?ran++:failed++;}catch{failed++;}}}));
    return {total:tasks.length,due:dueKeys.size,ran,failed};
  }
  const api=async function handleForecast(request,env,ctx={}) {
    if(!shared.store)shared.store=remoteStore(env);
    const u=new URL(request.url);
    // 7-day outlook for the port tiles' weather popup: one Open-Meteo request for all ports
    // (best-match model mix, which includes the chance of rain), cached for 30 minutes.
    if(u.pathname==='/api/daily'){
      if(request.method!=='GET')return json({error:'Method not allowed.'},405);
      try{
        const result=await cached('daily/v2',1800,async()=>{
          const ports=STORMGLASS_POINTS.ports,query={latitude:ports.map(p=>p.lat).join(','),longitude:ports.map(p=>p.lon).join(','),daily:'weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_direction_10m_dominant,wind_speed_10m_max,wind_gusts_10m_max',current:'temperature_2m,weather_code',hourly:'temperature_2m,weather_code,precipitation,precipitation_probability,is_day',timezone:'Europe/Stockholm',forecast_days:'7',wind_speed_unit:'ms',temperature_unit:'celsius'};
          const data=await(await response('https://api.open-meteo.com/v1/forecast?'+new URLSearchParams(query))).json(),rows=Array.isArray(data)?data:[data];
          if(rows.length!==ports.length||!rows.every(r=>Array.isArray(r.daily?.time)))throw Error('Invalid daily forecast');
          const num=(v,lo=-Infinity,hi=Infinity)=>typeof v==='number'&&Number.isFinite(v)&&v>=lo&&v<=hi?v:null;
          return {saved:now(),attribution:'Weather forecasts / Open-Meteo, CC BY 4.0',ports:rows.map((r,i)=>({id:ports[i].id,current:{time:r.current?.time??null,temperature_2m:num(r.current?.temperature_2m),weather_code:num(r.current?.weather_code,0,99)},daily:{time:r.daily.time,weather_code:r.daily.time.map((_,k)=>num(r.daily.weather_code?.[k],0,99)),temperature_2m_max:r.daily.time.map((_,k)=>num(r.daily.temperature_2m_max?.[k])),temperature_2m_min:r.daily.time.map((_,k)=>num(r.daily.temperature_2m_min?.[k])),precipitation_sum:r.daily.time.map((_,k)=>num(r.daily.precipitation_sum?.[k],0)),precipitation_probability_max:r.daily.time.map((_,k)=>num(r.daily.precipitation_probability_max?.[k],0,100)),wind_direction_10m_dominant:r.daily.time.map((_,k)=>num(r.daily.wind_direction_10m_dominant?.[k],0,360)),wind_speed_10m_max:r.daily.time.map((_,k)=>num(r.daily.wind_speed_10m_max?.[k],0)),wind_gusts_10m_max:r.daily.time.map((_,k)=>num(r.daily.wind_gusts_10m_max?.[k],0))},hourly:Array.isArray(r.hourly?.time)?{time:r.hourly.time,temperature_2m:r.hourly.time.map((_,k)=>num(r.hourly.temperature_2m?.[k])),weather_code:r.hourly.time.map((_,k)=>num(r.hourly.weather_code?.[k],0,99)),precipitation:r.hourly.time.map((_,k)=>num(r.hourly.precipitation?.[k],0)),precipitation_probability:r.hourly.time.map((_,k)=>num(r.hourly.precipitation_probability?.[k],0,100)),is_day:r.hourly.time.map((_,k)=>num(r.hourly.is_day?.[k],0,1))}:null}))};
        });
        return json(result,200,{'Cache-Control':'private, max-age=600'});
      }catch(e){return json({error:'7-day forecast unavailable.'},e.status===429?429:502);}
    }
    if(u.pathname==='/api/point'){
      if(request.method!=='GET')return json({error:'Method not allowed.'},405);
      const model=u.searchParams.get('model'),lat=Number(u.searchParams.get('lat')),lon=Number(u.searchParams.get('lon'));
      if(!(POINT_WIND[model]||POINT_WAVE.includes(model)||model==='smhi_snow'||model==='fmi_harmonie')||!(lat>=47&&lat<=71.5)||!(lon>=-26&&lon<=62))return json({error:'Invalid model or position.'},400);
      const rl=Math.round(lat*50)/50,ro=Math.round(lon*50)/50;
      try{const result=await cached('point/v2/'+model+'/'+rl+'/'+ro,1800,()=>pointForecast(model,rl,ro));return json({...result,model,lat:rl,lon:ro},200,{'Cache-Control':'private, max-age=600'});}
      catch(e){return json({error:'Point forecast unavailable.',model},e.status===429?429:502);}
    }
    if(!['/api/forecast','/api/model-updates'].includes(u.pathname))return null;
    if(request.method!=='GET')return json({error:'Method not allowed.'},405);
    const model=u.searchParams.get('model');
    if(u.pathname==='/api/model-updates'){
      if(!SOURCES[model])return json({error:'Unknown model.'},400);
      const snapshot=await lastGood.peek(cycleKey(model,'ports',0));
      if(snapshot&&now()<Date.parse(snapshot.refreshAfter||snapshot.timing?.nextUpdate))return json({timing:snapshot.timing,refreshAfter:snapshot.refreshAfter||snapshot.timing?.nextUpdate,checkedAt:iso(snapshot.checkedAt)});
      if(model==='smhi_snow'||model.startsWith('fmi_'))return snapshot?json({timing:snapshot.timing,refreshAfter:snapshot.refreshAfter}):json({error:'The update time appears after the forecast is loaded.'},503);
      try{const schedule=await getSchedule(model);return json({timing:schedule.timing,refreshAfter:schedule.refreshAfter,checkedAt:iso(schedule.saved)});}
      catch(e){return json({error:'Update time temporarily unavailable.',...(e.retryAt?{retryAt:iso(e.retryAt),retryAfter:e.retryAfter}:{})},e.status===429?429:502,e.retryAfter?{'Retry-After':String(e.retryAfter)}:{});}
    }
    const group=u.searchParams.get('group')||'ports',text=u.searchParams.get('offset')||'0',points=GROUPS[group];
    if(!SOURCES[model]||!points||!/^\d+$/.test(text)||(model==='smhi_snow'&&!['ports','wind-grid','wide-grid'].includes(group))||(model==='fmi_harmonie'&&!['ports','wind-grid','wide-grid'].includes(group))||(group==='wide-grid'&&!WIDE_MODELS.includes(model)))return json({error:'Invalid model or group.'},400);
    // The wide zoomed-out wind grid is one Open-Meteo multi-point request, cached per model cycle.
    const batch=group==='wide-grid'?points.length:BATCH,offset=Number(text);if(offset%batch||offset>=points.length||(group==='ports'&&offset))return json({error:'Invalid range.'},400);
    const selected=points.slice(offset,offset+batch);
    try {
      const payload=await lastGood(cycleKey(model,group,offset),()=>fetchModel(model,selected,group),model==='dmi_harmonie'?()=>fetchDMIFallback(selected,group):null);
      return json({...payload,model,group,total:points.length,nextOffset:offset+selected.length<points.length?offset+selected.length:null});
    }catch(e){return json({error:e.status===429?(model.startsWith('dmi_')?'DMI is overloaded. Wait '+e.retryAfter+' s before trying again.':'The provider is busy. Try again shortly.'):'Could not load model '+model+'.',model,...(e.retryAt?{retryAt:iso(e.retryAt),retryAfter:e.retryAfter}:{})},e.status===429?429:502,e.retryAfter?{'Retry-After':String(e.retryAfter)}:{});}
  };
  api.prewarm=prewarm;return api;
}
export const handleForecast=createForecastAPI();
