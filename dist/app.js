'use strict';
const $=id=>document.getElementById(id);
const MODELS={ecmwf_ifs:{label:'ECMWF',short:'ECMWF',desc:'IFS · global · grid approx. 9 km',color:'#72ad9d'},icon_eu:{label:'ICON-EU',short:'ICON-EU',desc:'DWD · Europe · grid approx. 7 km',color:'#a18ac8'},icon_global:{label:'ICON Global',short:'ICON',desc:'DWD · global · grid approx. 13 km',color:'#7294c1'},smhi_snow:{label:'SMHI',short:'SMHI',desc:'SNOW · SMHI · grid approx. 2.5 km · missing hours: —',color:'#bf748a'}};
const PORTS=[
{id:'bw-ventspils',name:'Ventspils BW',portName:'Ventspils',country:'Latvia',code:'LV VNT · BW',lat:57.407578,lon:21.525557,mapUrl:'https://maps.app.goo.gl/8yP1vpuotDnaFp2M9'},
{id:'ventspils-berth',name:'Ventspils Berth',portName:'Ventspils',country:'Latvia',code:'LV VNT · BERTH',lat:57.398842,lon:21.576607,mapUrl:'https://maps.app.goo.gl/Mr2t1ju1dLLCRthV7'},
{id:'norvik-berth',name:'Norvik Berth',portName:'Nynäshamn / Norvik',country:'Sweden',code:'SE NYN · NORVIK',lat:58.939033,lon:17.979752,mapUrl:'https://maps.app.goo.gl/DCB23vAFyfPnwjSVA'}
];
MODELS.dmi_harmonie={label:'DMI HARMONIE DINI',short:'DMI',desc:'DMI · HARMONIE DINI · 2 km · cycle every 3 h',color:'#d38c4f',api:true};
const WAVE_MODEL='ecmwf_wam';
const WAVE_SOURCES={ecmwf_wam:{label:'ECMWF WAM',available:true},smhi_swan:{label:'SMHI SWAN',available:false},stormglass:{label:'Stormglass AI',available:false}};
Object.assign(WAVE_SOURCES,{fmi_wam:{label:'FMI WAM',available:true,api:true,desc:'FMI · Baltic · 1.85 km · peak period Tp'},dmi_wam:{label:'DMI WAM',available:false,api:true,desc:'DMI · North Sea and Baltic · 5 km · mean period'},dwd_ewam:{label:'DWD EWAM',available:true,desc:'DWD · Europa · 5 km · Open-Meteo'},copernicus_baltic:{label:'Copernicus Baltic WAM',available:true,api:true,desc:'Copernicus Marine / FMI · 1.85 km · peak period Tp'}});
const WAVE_LABEL='ECMWF WAM';
Object.values(MODELS).forEach(model=>model.api=true);WAVE_SOURCES.ecmwf_wam.api=true;WAVE_SOURCES.dwd_ewam.api=true;
function waveSourceLabel(){return WAVE_SOURCES[state.waveSource].label;}
function selectWaveSource(source){
 if(!WAVE_SOURCES[source]?.available)return false;const changed=state.waveSource!==source;state.waveSource=source;if(changed)resetDMIRetryAttempts(source);renderAll();
 if(source==='stormglass')loadStormglassPorts();else if(source!=='ecmwf_wam')loadExtraWavePorts(source);
 loadModelTiming(source);loadRouteWaves();if(state.layer==='wave')loadField();return true;
}
function waveMeta(){return state.metas[state.waveSource==='stormglass'?'stormglass':state.waveSource==='ecmwf_wam'?'wave':'wave-'+state.waveSource];}
function routeWaveMeta(){return state.metas[state.waveSource==='stormglass'?'route-wave-stormglass':state.waveSource==='ecmwf_wam'?'route-wave':'route-wave-'+state.waveSource];}
const state={port:0,model:'ecmwf_ifs',layer:'wind',hour:0,range:72,compare:false,animate:!matchMedia('(prefers-reduced-motion: reduce)').matches,playing:false,wind:{},wave:null,windGrid:{},waveGrid:null,land:null,gridPoints:[],times:[],base:Math.floor(Date.now()/3600000)*3600,errors:{},metas:{},fieldLoading:0,flags:true,waveSource:'ecmwf_wam',stormglassStatus:{configured:false,routeEnabled:false},stormglassWave:null,stormglassLoading:false,stormglassRoute:null,routeWaves:true,routeWaveGrid:null,routeWaveLoading:false,routeWaveError:false};
Object.assign(state,{waves:{},waveFields:{},waveRoutes:{},timings:{},providerLoading:{},coastWaves:{}});
// Sea-state points near the Ventspils coast and on the approach to Nynäshamn / Norvik (same list as the server).
const COAST_POINTS=[{"id":"0","name":"Ventspils · roads W","lat":57.405,"lon":21.44,"area":"ventspils"},{"id":"1","name":"Ventspils · approach NW","lat":57.44,"lon":21.46,"area":"ventspils"},{"id":"2","name":"Ventspils · approach SW","lat":57.37,"lon":21.45,"area":"ventspils"},{"id":"3","name":"Ventspils · coast N","lat":57.47,"lon":21.52,"area":"ventspils"},{"id":"4","name":"Ventspils · coast NNE","lat":57.52,"lon":21.58,"area":"ventspils"},{"id":"5","name":"Ventspils · coast NE (Ovīši)","lat":57.57,"lon":21.66,"area":"ventspils"},{"id":"6","name":"Ventspils · coast SSW","lat":57.32,"lon":21.4,"area":"ventspils"},{"id":"7","name":"Ventspils · coast S (Užava)","lat":57.25,"lon":21.35,"area":"ventspils"},{"id":"8","name":"Ventspils · 12 km W","lat":57.4,"lon":21.33,"area":"ventspils"},{"id":"9","name":"Ventspils · 12 km NW","lat":57.48,"lon":21.38,"area":"ventspils"},{"id":"10","name":"Norvik · roads S","lat":58.905,"lon":17.975,"area":"nynashamn"},{"id":"11","name":"Nynäshamn · approach channel 1","lat":58.87,"lon":17.955,"area":"nynashamn"},{"id":"12","name":"Nynäshamn · approach channel 2","lat":58.835,"lon":17.945,"area":"nynashamn"},{"id":"13","name":"Nynäshamn · approach channel 3","lat":58.8,"lon":17.92,"area":"nynashamn"},{"id":"14","name":"Landsort · N","lat":58.77,"lon":17.9,"area":"nynashamn"},{"id":"15","name":"Landsort · S","lat":58.72,"lon":17.86,"area":"nynashamn"},{"id":"16","name":"Nynäshamn · E","lat":58.85,"lon":18.02,"area":"nynashamn"},{"id":"17","name":"Nynäshamn · SE","lat":58.8,"lon":18.0,"area":"nynashamn"},{"id":"18","name":"Landsort · open sea","lat":58.69,"lon":17.95,"area":"nynashamn"},{"id":"19","name":"Landsort · SW","lat":58.75,"lon":17.8,"area":"nynashamn"}];
const timeFmt=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Stockholm',hour:'2-digit',minute:'2-digit',timeZoneName:'short'});
const shortFmt=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Stockholm',hour:'2-digit',minute:'2-digit'});
const dateFmt=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Stockholm',day:'numeric',month:'short'});
const fullFmt=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Stockholm',weekday:'short',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',timeZoneName:'short'});
const format=(v,d=1)=>Number.isFinite(v)?v.toLocaleString('en-GB',{minimumFractionDigits:d,maximumFractionDigits:d}):'—';
const valid=v=>typeof v==='number'&&Number.isFinite(v);
const selectedEpoch=()=>state.times[state.hour]||state.base+state.hour*3600;
const timeIndexes=new WeakMap();
// Hourly lookups run thousands of times per map frame; index each time axis once.
function timeIndex(times,t){if(!Array.isArray(times))return -1;let index=timeIndexes.get(times);if(!index||index.size!==times.length){index=new Map();times.forEach((x,i)=>{if(!index.has(x))index.set(x,i);});timeIndexes.set(times,index);}return index.get(t)??-1;}
function at(series,key,t=selectedEpoch()){if(!series?.hourly)return null;const i=timeIndex(series.hourly.time,t);const v=series.hourly[key]?.[i];return valid(v)?v:null;}
function windRecord(p,model=state.model){return state.wind?.[model]?.[p];}
function windAt(p,key,t,model=state.model){return at(windRecord(p,model),key,t);}
function selectedWaveRecords(){return state.waveSource==='stormglass'?state.stormglassWave:state.waveSource==='ecmwf_wam'?state.wave:state.waves[state.waveSource];}
function waveAt(p,key,t){return at(selectedWaveRecords()?.[p],key,t);}
function waveErrorKey(){return state.waveSource==='stormglass'?'stormglass':state.waveSource==='ecmwf_wam'?'wave':'wave-'+state.waveSource;}
function nextWaveHour(records){return state.times.find(t=>t>selectedEpoch()&&(records||[]).some(r=>valid(at(r,'wave_height',t))))??null;}
function waveMissingMessage(records){const next=nextWaveHour(records);return 'No data for this hour'+(next!==null?' · available from '+fullFmt.format(new Date(next*1000)):'');}
function renderWaveAvailability(){
 const node=$('waveDataStatus'),button=$('waveAvailableHour');if(!node||!button)return;
 const records=selectedWaveRecords(),count=PORTS.filter((_,i)=>valid(waveAt(i,'wave_height'))).length,loading=state.waveSource==='stormglass'?state.stormglassLoading:state.providerLoading[state.waveSource],error=state.errors[waveErrorKey()];
 node.textContent=count?'Hs '+shortFmt.format(new Date(selectedEpoch()*1000))+': '+count+'/3 positions with data.':loading?'Loading wave height…':error||waveMissingMessage(records);
 node.classList.toggle('wave-data-missing',!count);button.hidden=Boolean(count||loading||nextWaveHour(records)===null);
}
function direction(v){return valid(v)?'<i class="direction" style="transform:rotate('+(v%360)+'deg)">↑</i>'+Math.round(v)+'°':'—';}
function url(base,points,params){const times=state.times.length?state.times:forecastTimes();return base+'?'+new URLSearchParams({latitude:points.map(p=>p.lat).join(','),longitude:points.map(p=>p.lon).join(','),start_hour:new Date(times[0]*1000).toISOString().slice(0,16),end_hour:new Date(times.at(-1)*1000).toISOString().slice(0,16),timeformat:'unixtime',timezone:'UTC',...params});}
async function requestJSON(url,key,force=false,ttl=1800000){const dmi=url.startsWith('/api/forecast?')&&(new URLSearchParams(url.split('?')[1]).get('model')||'').startsWith('dmi_');if(url.includes('open-meteo.com/v1/'))key+=':'+new URLSearchParams(url.split('?')[1]).get('start_hour');let cached;try{cached=JSON.parse(localStorage.getItem('baltic-v5-'+key));}catch{}const until=Date.parse(cached?.data?.refreshAfter||cached?.data?.timing?.nextUpdate);if(cached&&(Number.isFinite(until)?Date.now()<until:!force&&Date.now()-cached.saved<ttl))return {data:cached.data,saved:cached.saved,stale:Boolean(cached.stale||cached.data?.stale)};try{const res=await fetch(url,{signal:AbortSignal.timeout(url.startsWith('/api/forecast?')?300000:60000)});if(!res.ok){let body;try{body=await res.json();}catch{}const e=Error(res.status===429?(body?.error||'The provider is busy (429). Try again shortly.'):body?.error||body?.reason||'HTTP '+res.status);e.status=res.status;e.retryAt=body?.retryAt;e.retryAfter=body?.retryAfter;throw e;}const data=await res.json();if(data.error)throw Error(data.reason||'Data error');const result={data,saved:Date.now(),stale:Boolean(data.stale)};try{localStorage.setItem('baltic-v5-'+key,JSON.stringify(result));}catch{}return result;}catch(e){if(cached&&Date.now()-cached.saved<(dmi?172800000:21600000))return {...cached,stale:true};throw e;}}
function list(data){return Array.isArray(data)?data:[data];}
function cacheLabel(meta){return meta?'Downloaded '+timeFmt.format(new Date(meta.saved))+(meta.stale?' · may be outdated':''):'';}
function windModelInfo(model,meta=state.metas[model]){
 const info=MODELS[model];return model==='dmi_harmonie'&&meta?.delivery==='open-meteo'?{...info,label:'DMI + ECMWF · Open-Meteo',short:'DMI',desc:'Fallback source Open-Meteo · DMI HARMONIE 2 km + ECMWF 9 km'}:info;
}
function renderWindSource(){
 const option=$('windSource')?.querySelector?.('[value="dmi_harmonie"]');if(option)option.textContent=windModelInfo('dmi_harmonie').label.replace(' · Open-Meteo','').replace('DMI HARMONIE DINI','DMI HARMONIE');
 if($('modelDescription'))$('modelDescription').textContent=windModelInfo(state.model).desc;
}
// Wind and gust chips use the same Windy colour scale as the hourly table.
function windInk(v){if(!valid(v))return '#6f8790';const c=windRGB(v);return c[0]*.2126+c[1]*.7152+c[2]*.0722<130?'#fff':'#15343e';}
function windChip(v,label,cls=''){return `<span class="wind-chip ${cls}${valid(v)?'':' no-data'}" style="background:${windHeat(v)};color:${windInk(v)}"><small>${label}</small><b>${format(v)}</b></span>`;}
// Flags on the map: by default only the selected point; the flag toggles on the cards
// let you show them on one, two or all three points (remembered in this browser).
function flagPorts(){return state.flagPorts||new Set([state.port]);}
function toggleFlagPort(i){const set=new Set(flagPorts());if(set.has(i))set.delete(i);else set.add(i);state.flagPorts=set;renderPorts();updateMarkers();}
function loadFlagPorts(){try{const saved=JSON.parse(localStorage.getItem('baltic-flag-ports'));if(Array.isArray(saved))state.flagPorts=new Set(saved.filter(i=>Number.isInteger(i)&&i>=0&&i<PORTS.length));}catch{}}
const FLAG_ICON='<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 14.5V2m0 .8c3-2.2 5 2.2 8.5 0v6.4c-3.5 2.2-5.5-2.2-8.5 0"/></svg>';
const COMPASS=['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
function compassName(d){return COMPASS[Math.round((((d%360)+360)%360)/22.5)%16];}
// Direction chip (light blue): the arrow points the way the wind blows (from N: top to bottom).
// The arrow lives in the area below the compass label (top 12 px) and is scaled to 80 %
// of that area, so it never touches the label, whatever the direction.
function directionArrowSVG(from,w=58,h=40,top=12){
 const a=(from+180)*Math.PI/180,vx=Math.sin(a),vy=-Math.cos(a),cx=w/2,cy=(top+h)/2,halfW=w/2-4,halfH=(h-top)/2-1.5;
 const t=.8*Math.min(Math.abs(vx)>1e-6?halfW/Math.abs(vx):Infinity,Math.abs(vy)>1e-6?halfH/Math.abs(vy):Infinity);
 const f=n=>n.toFixed(1),sx=cx-vx*t,sy=cy-vy*t,ex=cx+vx*t,ey=cy+vy*t,bx=ex-vx*5.5,by=ey-vy*5.5,px=-vy*3.4,py=vx*3.4;
 // Faint shaft and open chevron head; two short streaks travel along the full length of the
// arrow, tail to head, so the movement shows which way the wind blows.
 const L=2*t,len=L.toFixed(1),streak=`x1="${f(sx)}" y1="${f(sy)}" x2="${f(ex-vx*1.5)}" y2="${f(ey-vy*1.5)}" stroke-dasharray="9 400"`;
 // A streak's front reaches the head at L/(L+9) of its cycle; streaks run half a cycle apart,
 // so the head pulses every half cycle, timed (keyframe peak at 10%) to each arrival.
 const arrive=L/(L+9),headDelay=(((arrive-.05)%.5)+.5)%.5-.5;
 return `<svg class="dir-arrow" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true" style="--len:${len}px;--head-delay:${headDelay.toFixed(3)}"><line class="dir-track" x1="${f(sx)}" y1="${f(sy)}" x2="${f(ex)}" y2="${f(ey)}"/><line class="dir-flow" ${streak}/><line class="dir-flow dir-flow-2" ${streak}/><path class="dir-head" style="transform-origin:${f(ex)}px ${f(ey)}px" d="M${f(bx+px)} ${f(by+py)}L${f(ex)} ${f(ey)}L${f(bx-px)} ${f(by-py)}"/></svg>`;
}
function directionChip(d,speed=null){
 if(!valid(d))return '<span class="wind-chip dir-chip no-data" title="No direction"><small>Dir.</small><b>—</b></span>';
 const from=((d%360)+360)%360;
 const duration=valid(speed)?Math.min(6,Math.max(.4,14/Math.max(speed,.5))).toFixed(2):'1.6';
 return `<span class="wind-chip dir-chip" style="--flow-duration:${duration}s" title="Wind from ${Math.round(from)}° (${compassName(from)})" aria-label="Wind direction: from ${Math.round(from)}°, ${compassName(from)}">${directionArrowSVG(from)}<small class="dir-name">${compassName(from)}</small></span>`;
}
// Sun elevation (degrees) for day/night icons; simple solar geometry, accurate to ~1°.
function sunElevation(lat,lon,t){const d=new Date(t*1000),n=Math.floor((d-Date.UTC(d.getUTCFullYear(),0,0))/864e5),decl=23.44*Math.sin(2*Math.PI*(284+n)/365)*Math.PI/180,solar=d.getUTCHours()+d.getUTCMinutes()/60+lon/15,ha=(solar-12)*15*Math.PI/180,phi=lat*Math.PI/180;return Math.asin(Math.sin(phi)*Math.sin(decl)+Math.cos(phi)*Math.cos(decl)*Math.cos(ha))*180/Math.PI;}
const WX={
 sun:'<circle cx="12" cy="12" r="4.2" fill="#f5b52e"/><g stroke="#f5b52e" stroke-width="1.8" stroke-linecap="round"><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.5 1.5M17.2 17.2l1.5 1.5M5.3 18.7l1.5-1.5M17.2 6.8l1.5-1.5"/></g>',
 moon:'<path d="M15.5 3.5a8.5 8.5 0 1 0 5 13.6A7 7 0 0 1 15.5 3.5z" fill="#8fa3c8"/>',
 cloud:'<path d="M7 18.5h10.2a4 4 0 0 0 .4-8A5.5 5.5 0 0 0 7 9.6a4.5 4.5 0 0 0 0 8.9z" fill="#a9b6bd"/>',
 partSun:'<circle cx="8.5" cy="8.5" r="3.6" fill="#f5b52e"/><g stroke="#f5b52e" stroke-width="1.6" stroke-linecap="round"><path d="M8.5 1.8v1.6M1.8 8.5h1.6M3.7 3.7l1.1 1.1M13.3 3.7l-1.1 1.1"/></g><path d="M8.5 20h9.5a3.6 3.6 0 0 0 .3-7.2A5 5 0 0 0 8.7 12a4 4 0 0 0-.2 8z" fill="#b8c4ca"/>',
 partMoon:'<path d="M11 2.8a6 6 0 1 0 4.3 9.8A5 5 0 0 1 11 2.8z" fill="#8fa3c8"/><path d="M8.5 20h9.5a3.6 3.6 0 0 0 .3-7.2A5 5 0 0 0 8.7 12a4 4 0 0 0-.2 8z" fill="#b8c4ca"/>',
 rain:'<path d="M7 15h10.2a4 4 0 0 0 .4-8A5.5 5.5 0 0 0 7 6.1a4.5 4.5 0 0 0 0 8.9z" fill="#98a7b0"/><g stroke="#2d8fd0" stroke-width="1.8" stroke-linecap="round"><path d="M8.5 17.5l-1 2.8M12.5 17.5l-1 2.8M16.5 17.5l-1 2.8"/></g>',
 snow:'<path d="M7 15h10.2a4 4 0 0 0 .4-8A5.5 5.5 0 0 0 7 6.1a4.5 4.5 0 0 0 0 8.9z" fill="#98a7b0"/><g fill="#6cb4e6"><circle cx="8.5" cy="19" r="1.2"/><circle cx="12.5" cy="20.5" r="1.2"/><circle cx="16.5" cy="19" r="1.2"/></g>'
};
// Weather symbol from the selected model: precipitation first, then cloud cover, day or night.
function weatherSymbol(i,t=selectedEpoch()){
 const p=PORTS[i],cloud=windAt(i,'cloud_cover',t),rain=windAt(i,'precipitation',t),temp=windAt(i,'temperature_2m',t),day=sunElevation(p.lat,p.lon,t)>-0.8;
 if(valid(rain)&&rain>=0.1)return valid(temp)&&temp<=0.5?['snow','Snow']:['rain','Rain'];
 if(!valid(cloud))return null;
 if(cloud<25)return day?['sun','Clear']:['moon','Clear night'];
 if(cloud<70)return day?['partSun','Partly cloudy']:['partMoon','Partly cloudy'];
 return ['cloud','Cloudy'];
}
// Lowest and highest 2 m temperature of the selected day (Swedish calendar day), selected model.
function dayTempRange(i,t=selectedEpoch()){const day=DAY_KEY.format(new Date(t*1000)),rec=windRecord(i);if(!rec?.hourly?.time)return null;const v=rec.hourly.time.map((x,k)=>DAY_KEY.format(new Date(x*1000))===day?rec.hourly.temperature_2m?.[k]:null).filter(valid);return v.length?{min:Math.min(...v),max:Math.max(...v)}:null;}
// Weather block: symbol and current temperature, with the day's min (green) and max (red) below.
function portWeather(i){const t=windAt(i,'temperature_2m'),sym=weatherSymbol(i),r=dayTempRange(i),label=(sym?sym[1]:'No cloud data')+' · '+(valid(t)?Math.round(t)+' °C':'no temperature')+(r?' · today '+Math.round(r.min)+'° to '+Math.round(r.max)+'°':'')+' · '+windModelInfo(state.model).short;return `<span class="port-wx" title="${label}" aria-label="${label}"><span class="port-wx-now">${sym?`<svg viewBox="0 0 24 24" aria-hidden="true">${WX[sym[0]]}</svg>`:''}<b>${valid(t)?Math.round(t)+'°':'—'}</b></span>${r?`<span class="port-range"><b class="t-min">${Math.round(r.min)}°</b><b class="t-max">${Math.round(r.max)}°</b></span>`:''}</span>`;}
function renderPorts(){const flags=flagPorts(); $('ports').innerHTML=PORTS.map((p,i)=>{const v=windAt(i,'wind_speed_10m'),g=windAt(i,'wind_gusts_10m'),d=windAt(i,'wind_direction_10m'),on=flags.has(i);return `<div class="port ${i===state.port?'active':''}"><button class="port-main" data-port="${i}" aria-pressed="${i===state.port}" aria-label="${p.name}: wind ${format(v)} m/s, gusts ${format(g)} m/s. Show on the chart and table"><div class="port-top"><div class="port-id"><h2>${p.name}</h2><small>${p.lat.toFixed(4)}°N · ${p.lon.toFixed(4)}°E</small></div>${portWeather(i)}</div><div class="port-wind">${windChip(v,'Wind')}${windChip(g,'Gusts','gust')}${directionChip(d,v)}</div></button><button class="port-flag ${on?'on':''}" data-flag-port="${i}" aria-pressed="${on}" aria-label="Model flags on the map: ${p.name}" title="${on?'Hide':'Show'} model flags on the map for ${p.name}">${FLAG_ICON}</button></div>`;}).join('');}
function renderSummary(){renderWaveAvailability();const p=PORTS[state.port];$('forecastPort').textContent=p.name;$('forecastLocation').textContent=p.country+' · '+p.portName;renderPointDetails();const ts=state.times.filter(t=>t>=Math.floor(Date.now()/3600000)*3600).slice(0,24),max=arr=>{const a=arr.filter(valid);return a.length?Math.max(...a):null;};if($('maxGust'))$('maxGust').innerHTML=format(max(ts.map(t=>windAt(state.port,'wind_gusts_10m',t))))+' <small>m/s</small>';if($('maxWave'))$('maxWave').innerHTML=format(max(ts.map(t=>waveAt(state.port,'wave_height',t))))+' <small>m</small>';$('forecastSource').textContent='Wind: '+windModelInfo(state.model).label+' · Wave: '+waveSourceLabel()+(state.metas[state.model]?' · '+cacheLabel(state.metas[state.model]):'')+(waveMeta()?.stale?' · Wave from cache: '+cacheLabel(waveMeta()):'');const errors=[...Object.keys(MODELS),waveErrorKey()].map(key=>state.errors[key]).filter(Boolean);const metas=Object.values(state.metas).filter(Boolean);const windMeta=state.metas[state.model],notices=[state.model==='dmi_harmonie'&&windMeta?.delivery==='open-meteo'?'Fallback source: Open-Meteo · DMI Seamless (DMI + ECMWF).':'',windMeta?.stale||waveMeta()?.stale?'Last good forecast — may be outdated.':''].filter(Boolean);$('forecastError').hidden=!errors.length&&!notices.length;$('forecastError').textContent=[...errors,...notices].join(' ');if($('dataStatus'))$('dataStatus').textContent=errors.length?'Some data unavailable':metas.some(x=>x.stale)?'May be outdated · cached copy':state.model==='dmi_harmonie'&&windMeta?.delivery==='open-meteo'?'Fallback source · Open-Meteo':'Model forecast · 1 h';document.querySelector('.sidebar-footer')?.classList.toggle('error',errors.length>0||metas.some(x=>x.stale));$('forecastSource').title=metas.map(cacheLabel).join(' / ');}
function forecastDayGroups(times){const days=[];times.forEach((t,i)=>{const key=DAY_KEY.format(new Date(t*1000));if(days.at(-1)?.key===key)days.at(-1).count++;else days.push({key,index:i,count:1,t});});return days;}
function forecastTimes(now=Date.now()){
 const start=Math.floor(now/3600000)*3600-3600;
 return Array.from({length:73},(_,i)=>start+i*3600);
}
function resetForecastWindow(){state.times=forecastTimes();state.base=state.times[0];state.hour=1;state.range=state.times.length;state.chartPositioned=false;}
const tlDayFmt=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Stockholm',weekday:'short',day:'numeric'});
const tlTimeFmt=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Stockholm',weekday:'short',hour:'2-digit',minute:'2-digit'});
// Full-screen map timeline: day bands, a draggable hour slider and play, in step with the table.
const PLAY_SVG='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.5 5.6v12.8c0 .9 1 1.4 1.7.9l9.4-6.4c.6-.4.6-1.4 0-1.8l-9.4-6.4c-.7-.5-1.7 0-1.7.9z"/></svg>',PAUSE_SVG='<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6.5" y="5.5" width="4" height="13" rx="1.3"/><rect x="13.5" y="5.5" width="4" height="13" rx="1.3"/></svg>';
function playIcon(playing){return playing?PAUSE_SVG:PLAY_SVG;}
function renderMapTimeline(){
 const range=$('mapTlRange'),days=$('mapTlDays'),out=$('mapTlTime'),play=$('mapPlay');if(!range||!days||!out)return;
 const n=state.times.length;if(!n)return;const last=n-1,w=range.clientWidth||0,key=state.times[0]+'|'+n+'|'+Math.round(w/40);
 // Short first/last days get no label when there is no room for one.
 if(days.dataset?.key!==key){days.innerHTML=forecastDayGroups(state.times).map(g=>`<span style="width:${(g.count/n*100).toFixed(3)}%">${!w||g.count/n*w>=44?'<b>'+tlDayFmt.format(new Date(g.t*1000))+'</b>':''}</span>`).join('');if(days.dataset)days.dataset.key=key;range.max=String(last);}
 range.value=String(state.hour);const pct=last?state.hour/last*100:0;out.textContent=tlTimeFmt.format(new Date(selectedEpoch()*1000));if(out.style)out.style.left=pct+'%';if(range.style)range.style.setProperty?.('--tl-pct',pct+'%');
 if(play){play.innerHTML=playIcon(state.playing);play.setAttribute('aria-pressed',state.playing);play.setAttribute('aria-label',state.playing?'Pause forecast':'Play forecast');}
}
function renderTimeline(){renderMapTimeline();
 const t=selectedEpoch();if($('selectedTime'))$('selectedTime').textContent=fullFmt.format(new Date(t*1000));$('mapSource').textContent=(state.layer==='wave'?waveSourceLabel():windModelInfo(state.model).label).replace(' · Open-Meteo','');renderMapStamp();

}

const TABLE_MODELS=['icon_eu','icon_global','ecmwf_ifs','smhi_snow','dmi_harmonie'];
const DAY_KEY=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Stockholm',year:'numeric',month:'2-digit',day:'2-digit'});
const DAY_TITLE=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Stockholm',weekday:'long',day:'numeric',month:'short'});
// Windy windDetail color breakpoints, in m/s. Applied locally; no Windy API/runtime.
const WIND_COLORS=[[0,[243,243,243]],[3,[243,243,243]],[4,[0,200,254]],[6,[0,230,0]],[10,[254,174,0]],[19,[254,0,150]],[100,[151,50,222]]];
function windRGB(v){if(!valid(v))return [240,242,243];for(let i=1;i<WIND_COLORS.length;i++)if(v<WIND_COLORS[i][0]){const [a,ac]=WIND_COLORS[i-1],[b,bc]=WIND_COLORS[i],f=Math.max(0,(v-a)/(b-a));return ac.map((x,j)=>Math.round(x+(bc[j]-x)*f));}return WIND_COLORS.at(-1)[1];}
function windHeat(v){return valid(v)?'rgb('+windRGB(v).join(',')+')':'#f0f2f3';}
function flowArrow(degrees){return valid(degrees)?`<i class="flow-arrow" style="transform:rotate(${(degrees+180)%360}deg)" aria-hidden="true">↑</i>`:'<i class="flow-arrow missing" aria-hidden="true">·</i>';}
function buildWindyTable(ts){
 const count=ts.length,groups=[];ts.forEach((t,i)=>{const key=DAY_KEY.format(new Date(t*1000));const last=groups.at(-1);if(last?.key===key)last.count++;else groups.push({key,count:1,index:i,t});});
 let html='<div class="model-meteogram" role="table" aria-label="Hourly comparison of five wind and gust sources">';
 html+='<div class="meteo-days" role="row">'+groups.map(d=>`<div class="meteo-day" role="columnheader" style="width:${d.count*48}px"><span>${DAY_TITLE.format(new Date(d.t*1000))}</span></div>`).join('')+'</div>';
 html+='<div class="meteo-hours" role="row">'+ts.map((t,i)=>`<button class="hour-col hour-heading ${i===state.hour?'selected':''}" data-hour="${i}" aria-label="${fullFmt.format(new Date(t*1000))}" aria-pressed="${i===state.hour}">${shortFmt.format(new Date(t*1000))}</button>`).join('')+'</div>';
 for(const model of TABLE_MODELS){
  html+=`<div class="model-row ${model===state.model?'primary-model':''}" role="row" data-row-model="${model}">`;
  ts.forEach((t,i)=>{const v=windAt(state.port,'wind_speed_10m',t,model),g=windAt(state.port,'wind_gusts_10m',t,model),d=windAt(state.port,'wind_direction_10m',t,model),title=windModelInfo(model).short+' · '+fullFmt.format(new Date(t*1000))+' · Wind '+format(v)+' m/s · Gusts '+format(g)+' m/s · Z '+(valid(d)?Math.round(d)+'°':'—');
   html+=`<button class="meteo-cell ${i===state.hour?'selected':''} ${valid(v)?'':'no-data'}" data-hour="${i}" role="cell" style="background:${windHeat(v)}" title="${title}" aria-label="${title}"><span class="meteo-wind">${flowArrow(d)}<b>${format(v)}</b></span><span class="meteo-gust" style="background:${windHeat(g)}">${format(g)}</span></button>`;
  });html+='</div>';
 }
 html+='</div>';
 return html;
}
const WIND_FLAG={width:13,near:42,far:120};
function windFlagCorners(bearing){
 const r=bearing*Math.PI/180,c=Math.cos(r),s=Math.sin(r),half=WIND_FLAG.width/2+2;
 return [[-half,-WIND_FLAG.far-2],[half,-WIND_FLAG.far-2],[half,-WIND_FLAG.near+2],[-half,-WIND_FLAG.near+2]].map(([x,y])=>({x:x*c-y*s,y:x*s+y*c}));
}
function windFlagsOverlap(a,b){
 const aa=windFlagCorners(a),bb=windFlagCorners(b);
 for(const polygon of [aa,bb])for(let i=0;i<2;i++){
  const p=polygon[i],q=polygon[i+1],axis={x:-(q.y-p.y),y:q.x-p.x},project=v=>v.x*axis.x+v.y*axis.y;
  const ap=aa.map(project),bp=bb.map(project);if(Math.max(...ap)<Math.min(...bp)||Math.max(...bp)<Math.min(...ap))return false;
 }
 return true;
}
function windFlagLayout(point){
 const sources=[state.model,...TABLE_MODELS.filter(model=>model!==state.model)];
 const flags=sources.map(model=>{const v=windAt(point,'wind_speed_10m',selectedEpoch(),model),gust=windAt(point,'wind_gusts_10m',selectedEpoch(),model),d=windAt(point,'wind_direction_10m',selectedEpoch(),model);return valid(v)&&valid(d)?{model,v,gust,d,calm:v<.2,rotation:v<.2?0:((d%360)+360)%360}:null;}).filter(Boolean).slice(0,3);
 const parents=flags.map((_,i)=>i),root=i=>parents[i]===i?i:(parents[i]=root(parents[i]));
 for(let i=0;i<flags.length;i++)for(let j=0;j<i;j++)if(windFlagsOverlap(flags[i].rotation,flags[j].rotation))parents[root(i)]=root(j);
 const groups=new Map();flags.forEach((flag,i)=>{const key=root(i);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(flag);});
 for(const group of groups.values())group.forEach((flag,index)=>{flag.lane=(index-(group.length-1)/2)*15;flag.cycleSize=group.length;flag.cycleIndex=index;flag.front=(state.flagCycle||0)%group.length===index;});
 return flags.sort((a,b)=>Number(a.front)-Number(b.front));
}
function windFlagsSVG(point){
 if(!state.flags||!flagPorts().has(point))return '';
 const flags=windFlagLayout(point),half=WIND_FLAG.width/2,top=-WIND_FLAG.far,split=top+28,bottom=-WIND_FLAG.near;
 const shapes=flags.map(flag=>{
  const {model,v,gust,d,rotation,calm,cycleSize,cycleIndex,front,lane}=flag,title=windModelInfo(model).short+': wind '+format(v)+' m/s, gusts '+format(gust)+' m/s, z '+Math.round(d)+'°'+(calm?' · calm':''),id='wind-flag-'+point+'-'+model,textAngle=rotation>180?90:-90;
  // Pennant with a swallowtail: dark head with the model name, then gust, then mean wind.
  // A light streak runs from the model name down the flag and the mast to the port dot,
  // i.e. the way the wind blows. Its speed is proportional to the mean wind (6 px/s per m/s,
  // e.g. 3 m/s ≈ 7 s per pass, 10 m/s ≈ 2 s, 20 m/s ≈ 1 s). The tail waves gently.
  const L=lane-half,R=lane+half,split=top+28,mid=(split+bottom)/2,notch=9,dur=(Math.min(8,Math.max(.5,(WIND_FLAG.far-WIND_FLAG.near+Math.abs(lane)+WIND_FLAG.near)/(6*Math.max(v,.5)))).toFixed(2))+'s',stem=Math.abs(lane)-bottom;
  const tail=(n,dy)=>`M${L},${split} V${top+dy} L${lane},${top+n} L${R},${top-dy} V${split} Z`;
  return `<g class="model-wind-flag${calm?' calm-flag':''}${front?' flag-front':''}" data-flag-model="${model}" data-wind-from="${((d%360)+360)%360}" data-values="${format(v)} – ${format(gust)}" data-cycle-size="${cycleSize}" data-cycle-index="${cycleIndex}" aria-hidden="false" transform="rotate(${rotation})"><title>${title}</title>`+
   `<path class="flag-stem" d="M0,0 V${bottom} H${lane}" fill="none" stroke="#426575" stroke-opacity=".6" stroke-width=".8"${calm?' stroke-dasharray="2 3"':''}/>`+
   `<defs><clipPath id="${id}"><rect x="${L}" y="${split-4}" width="${WIND_FLAG.width}" height="${bottom-split+4}" rx="4"/><path d="${tail(notch,0)}"/></clipPath></defs>`+
   `<path class="flag-tail" d="${tail(notch,0)}" fill="#1d3a45"><animate attributeName="d" dur="${(1.6+cycleIndex*.3).toFixed(1)}s" repeatCount="indefinite" calcMode="spline" keySplines=".45 0 .55 1;.45 0 .55 1" values="${tail(notch,0)};${tail(notch-4,2)};${tail(notch,0)}"/></path>`+
   `<g clip-path="url(#${id})"><rect class="flag-label" x="${L}" y="${split}" width="${WIND_FLAG.width}" height="${mid-split}" fill="${windHeat(gust)}"/><rect x="${L}" y="${mid}" width="${WIND_FLAG.width}" height="${bottom-mid}" fill="${windHeat(v)}"/>`+
   `<rect x="${L}" y="${top-8}" width="${WIND_FLAG.width}" height="6" fill="#fff" opacity="0"><animate attributeName="y" dur="${dur}" repeatCount="indefinite" keyTimes="0;.72;1" values="${top-8};${bottom};${bottom}"/><animate attributeName="opacity" dur="${dur}" repeatCount="indefinite" keyTimes="0;.08;.64;.72;1" values="0;.5;.5;0;0"/></rect></g>`+
   `<path d="M${lane},${bottom} H0 V0" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-dasharray="6 400" stroke-dashoffset="6" opacity=".9"><animate attributeName="stroke-dashoffset" dur="${dur}" repeatCount="indefinite" keyTimes="0;.7;1" values="6;6;${-stem}"/></path>`+
   `<line x1="${L}" x2="${R}" y1="${split}" y2="${split}" stroke="#fff" stroke-opacity=".7" stroke-width=".5"/>`+
   `<text x="${lane}" y="${top+15}" text-anchor="middle" dominant-baseline="middle" transform="rotate(${textAngle} ${lane} ${top+15})" fill="#fff" font-size="6" font-weight="500">${windModelInfo(model).short}</text>`+
   `<text x="${lane}" y="${(split+mid)/2}" text-anchor="middle" dominant-baseline="middle" transform="rotate(${textAngle} ${lane} ${(split+mid)/2})" fill="${windInk(gust)}" font-size="8" font-weight="600">${format(gust)}</text>`+
   `<text x="${lane}" y="${(mid+bottom)/2}" text-anchor="middle" dominant-baseline="middle" transform="rotate(${textAngle} ${lane} ${(mid+bottom)/2})" fill="${windInk(v)}" font-size="8" font-weight="600">${format(v)}</text></g>`;
 }).join('');
 return shapes?`<svg class="wind-flags-svg" viewBox="-160 -160 320 320" width="320" height="320" role="img" aria-label="Model flags for ${PORTS[point].name}; wind – gusts, m/s; direction the wind blows from"><g>${shapes}</g><circle r="4.5" fill="#fff" stroke="#72b7b4" stroke-width="1.5"/></svg>`:'';
}
function advanceFlagCycle(){
 if(!state.flags||document.hidden)return;
 const flags=[...document.querySelectorAll('.model-wind-flag[data-cycle-size]')];if(!flags.some(node=>Number(node.dataset.cycleSize)>1))return;
 state.flagCycle=(state.flagCycle||0)+1;
 for(const node of flags){const front=state.flagCycle%Number(node.dataset.cycleSize)===Number(node.dataset.cycleIndex);node.classList.toggle('flag-front',front);if(front&&Number(node.dataset.cycleSize)>1)node.parentNode.append(node);}
}
function renderFlagCycleStatus(){const node=$('flagCycleStatus');if(!node)return;const overlaps=state.flags&&windFlagLayout(state.port).some(flag=>flag.cycleSize>1);node.hidden=!overlaps;node.textContent=overlaps?'3 flags · order changes every 3 s':'';}

function linePath(values,yFn){let path='',open=false;values.forEach((v,i)=>{if(!valid(v)){open=false;return;}path+=(open?'L':'M')+(i*48+24)+','+yFn(v).toFixed(2)+' ';open=true;});return path;}
function windChartScale(values){
 const data=values.filter(valid),lo=data.length?Math.min(...data):0,hi=data.length?Math.max(...data):4,span=Math.max(2,hi-lo),step=span<=3?.5:span<=7?1:span<=15?2:span<=35?5:10;
 const min=Math.max(0,Math.floor((lo-span*.12)/step)*step),max=Math.max(min+2,Math.ceil((hi+span*.12)/step)*step),ticks=[];
 for(let v=min;v<=max+.001;v+=step)ticks.push(v);return {min,max,ticks};
}
function cloudRibbon(values,center,halfHeight){
 let result='',run=[];const add=()=>{if(run.length){const top=run.map(({v,i})=>(i*48+24)+','+(center-v/100*halfHeight).toFixed(2)),bottom=run.slice().reverse().map(({v,i})=>(i*48+24)+','+(center+v/100*halfHeight).toFixed(2));result+='M'+(run[0].i*48)+','+center+' L'+top.join(' L')+' L'+(run.at(-1).i*48+48)+','+center+' L'+bottom.join(' L')+'Z ';run=[];}};
 values.forEach((v,i)=>valid(v)?run.push({v:Math.min(100,Math.max(0,v)),i}):add());add();return result;
}
function formatRain(v){return format(v,valid(v)&&v>0&&v<.1?2:1);}
// Compact meteogram (wind, gusts, cloud layers, precipitation). Height MG_H; no wave row.
const MG_H=84;
function meteogramSVG(ts){
 const width=ts.length*48,scroller=$('chartScroll'),left=scroller.scrollLeft||0,viewport=scroller.clientWidth||width,from=Math.max(0,Math.floor(left/48)-1),to=Math.min(ts.length,Math.ceil((left+viewport)/48)+1);
 const series=key=>ts.map(t=>windAt(state.port,key,t)),wind=series('wind_speed_10m'),gust=series('wind_gusts_10m'),cloud=series('cloud_cover'),rain=series('precipitation');
 const comps=state.compare?Object.keys(MODELS).filter(m=>m!==state.model).map(m=>({model:m,values:ts.map(t=>windAt(state.port,'wind_speed_10m',t,m))})):[];
 const scale=windChartScale([...wind.slice(from,to),...gust.slice(from,to),...comps.flatMap(c=>c.values.slice(from,to))]),yb=MG_H*.86,yt=MG_H*.16,y=v=>yb-(v-scale.min)/(scale.max-scale.min)*(yb-yt);
 const rainMax=Math.max(1,...rain.slice(from,to).filter(valid)),rainH=MG_H*.26;
 const placeEl=$('chartPlace');if(placeEl){placeEl.textContent=PORTS[state.port].name;placeEl.title='Chart and table for '+PORTS[state.port].name+' · '+windModelInfo(state.model).label;}const every=Math.ceil(scale.ticks.length/3);$('chartWindScale').innerHTML=scale.ticks.filter((_,i)=>i%every===0).map(v=>`<span style="top:${y(v)-5}px">${format(v,v%1?1:0)}</span>`).join('');
 const active=state.times[state.hour]??ts[0],cloudNow=windAt(state.port,'cloud_cover',active),rainNow=windAt(state.port,'precipitation',active);
 $('meteogramContext').textContent=PORTS[state.port].name+' · '+windModelInfo(state.model).label+' · '+shortFmt.format(new Date(active*1000))+' · clouds '+format(cloudNow,0)+'% · precipitation '+formatRain(rainNow)+' mm / 1 h';
 let svg=`<svg class="chart-svg meteogram-svg" width="${width}" height="${MG_H}" role="img" aria-label="${PORTS[state.port].name}: hourly meteogram of wind, gusts, cloud and precipitation; ${windModelInfo(state.model).label}" data-scale-min="${scale.min}" data-scale-max="${scale.max}"><defs><linearGradient id="skyFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe49b"/><stop offset="1" stop-color="#fff3c7"/></linearGradient><clipPath id="windPlotClip"><rect width="${width}" y="${MG_H*.1}" height="${MG_H*.82}"/></clipPath></defs><rect width="${width}" height="${MG_H}" fill="url(#skyFill)"/>`;
 const layers=[['cloud_cover_high',MG_H*.27,.40],['cloud_cover_mid',MG_H*.48,.55],['cloud_cover_low',MG_H*.69,.70]],hasLayers=layers.some(([key])=>series(key).some(valid));
 if(hasLayers){for(const [key,center,opacity] of layers){const values=series(key);svg+=`<path class="cloud-band" data-cloud-layer="${key}" d="${cloudRibbon(values,center,MG_H*.085)}" fill="#899399" fill-opacity="${opacity}"/>`;values.forEach((v,i)=>{if(!valid(v))svg+=`<text class="missing-cloud" x="${i*48+24}" y="${center+3}" text-anchor="middle" fill="#7c8588" font-size="8">—</text>`;});}}
 else svg+=`<path class="cloud-band" data-cloud-layer="cloud_cover" d="${cloudRibbon(cloud,MG_H*.48,MG_H*.3)}" fill="#899399" fill-opacity=".6"/>`;
 ts.forEach((t,i)=>{
  const x=i*48+24,newDay=i===0||DAY_KEY.format(new Date(t*1000))!==DAY_KEY.format(new Date(ts[i-1]*1000));
  svg+=`<line x1="${i*48}" x2="${i*48}" y1="0" y2="${MG_H}" stroke="${newDay?'#9d9e89':'#b9b39b'}" stroke-opacity="${newDay?'.65':'.23'}" stroke-width="${newDay?1.5:.6}"/>`;
  svg+=`<text class="cloud-percent" x="${x}" y="11" text-anchor="middle" fill="#5c6466" font-size="9">${valid(cloud[i])?Math.round(cloud[i])+'%':'—'}</text>`;
  if(valid(rain[i])&&rain[i]>0){const h=Math.min(rainH,rain[i]/rainMax*rainH);svg+=`<rect class="precip-bar" data-precipitation="${rain[i]}" x="${x-9}" y="${MG_H-h}" width="18" height="${h}" rx="2" fill="#1789bf" fill-opacity=".86"/><text x="${x}" y="${Math.max(MG_H*.66,MG_H-3-h)}" text-anchor="middle" fill="#126a95" font-size="8">${formatRain(rain[i])}</text>`;}
  else if(!valid(rain[i]))svg+=`<text x="${x}" y="${MG_H-2}" text-anchor="middle" fill="#758995" font-size="8">—</text>`;
 });
 for(const tick of scale.ticks)svg+=`<line x1="0" x2="${width}" y1="${y(tick)}" y2="${y(tick)}" stroke="#aca985" stroke-opacity=".24" stroke-dasharray="2 4"/>`;
 svg+=`<g clip-path="url(#windPlotClip)"><path class="gust-trace" d="${linePath(gust,y)}" fill="none" stroke="#98733a" stroke-width="1.3" stroke-dasharray="4 4" opacity=".8"/>`;
 for(const c of comps)svg+=`<path d="${linePath(c.values,y)}" fill="none" stroke="${MODELS[c.model].color}" stroke-width="1.5"/>`;
 svg+=`<path class="wind-trace" d="${linePath(wind,y)}" fill="none" stroke="#13865b" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>`;
 wind.forEach((v,i)=>{if(valid(v)){svg+=`<circle cx="${i*48+24}" cy="${y(v)}" r="1.8" fill="#13865b"/>`;if(i%3===0)svg+=`<text x="${i*48+24}" y="${y(v)-7}" text-anchor="middle" fill="#176a4e" font-size="9" font-weight="600" stroke="#fff5d0" stroke-width="2.5" paint-order="stroke">${format(v)}</text>`;}});svg+='</g>';
 state.meteogramMarker={y,wind};svg+=`<g class="selected-hour">${selectedHourMarker()}</g>`;
 ts.forEach((t,i)=>{const text=PORTS[state.port].name+' · '+windModelInfo(state.model).label+' · '+fullFmt.format(new Date(t*1000))+' · Wind '+format(wind[i])+' m/s · Gusts '+format(gust[i])+' m/s · Clouds '+format(cloud[i],0)+'% · Precipitation '+formatRain(rain[i])+' mm in the previous hour';svg+=`<g data-hour="${i}"><title>${text}</title><rect class="meteo-hour-hit" x="${i*48}" y="0" width="48" height="${MG_H}" fill="transparent"/></g>`;});return svg+'</svg>';
}
// The red hour cursor is redrawn alone, so stepping through hours does not rebuild the whole chart.
function selectedHourMarker(){
 const m=state.meteogramMarker;if(!m||state.hour>=m.wind.length)return '';const x=state.hour*48+24,v=m.wind[state.hour];
 let svg='';
 if(valid(v)){svg+=`<circle cx="${x}" cy="${m.y(v)}" r="3.8" fill="#13865b" stroke="#fff" stroke-width="1.5"/>`;if(state.hour%3)svg+=`<text x="${x}" y="${m.y(v)-7}" text-anchor="middle" fill="#176a4e" font-size="9" font-weight="600" stroke="#fff5d0" stroke-width="2.5" paint-order="stroke">${format(v)}</text>`;}
 return svg;
}
let meteogramFrame=false;
function scheduleMeteogram(){if(meteogramFrame||typeof requestAnimationFrame!=='function')return;meteogramFrame=true;requestAnimationFrame(()=>{meteogramFrame=false;const plot=$('meteogramPlot'),ts=state.times.slice(0,Math.min(state.range,state.times.length));if(plot&&ts.length)plot.innerHTML=meteogramSVG(ts);});}
function renderChart(){
 const ts=state.times.slice(0,Math.min(state.range,state.times.length));if(!ts.length)return;const width=ts.length*48,scroller=$('chartScroll');
 if(!state.chartPositioned&&scroller.clientWidth){scroller.scrollLeft=0;state.chartPositioned=true;}
 $('chartContent').style.width=width+'px';$('chartContent').innerHTML=buildWindyTable(ts)+'<div id="meteogramPlot" class="meteogram-plot">'+meteogramSVG(ts)+'</div>'+timeCursorHTML();state.renderedChart=chartKey();renderTableLabels();
 document.querySelectorAll('.extra-legend').forEach(x=>x.remove());if(state.compare)Object.keys(MODELS).filter(m=>m!==state.model).forEach(model=>{const span=document.createElement('span');span.className='extra-legend';span.innerHTML=`<i class="line" style="background:${MODELS[model].color}"></i>${windModelInfo(model).short} · wind`;document.querySelector('.forecast-legend').append(span);});
}
function renderTableLabels(){
 const resolution={icon_eu:'7 km',icon_global:'13 km',ecmwf_ifs:'9 km',smhi_snow:'2.5 km',dmi_harmonie:'2 km'};
 $('tableLabels').innerHTML='<div class="model-label-day">DAY</div><div class="model-label-hour">Hour</div>'+TABLE_MODELS.map(model=>`<button class="model-label ${model===state.model?'primary-model':''}" data-select-model="${model}" title="Show ${windModelInfo(model).short} on the chart and map"><span>${windModelInfo(model).short}<small>${resolution[model]}</small></span><em>wind / gusts · m/s</em></button>`).join('');
}
// Red vertical time cursor across all model rows and the meteogram; drag it to change the hour.
function timeCursorHTML(){return `<div class="time-cursor" id="timeCursor" style="left:${state.hour*48+24}px" role="slider" aria-label="Forecast hour" aria-valuemin="0" aria-valuemax="${Math.max(0,state.times.length-1)}" aria-valuenow="${state.hour}" tabindex="0"><span class="time-cursor-handle" aria-hidden="true"></span></div>`;}
function positionTimeCursor(){const c=$('timeCursor');if(!c?.style)return;c.style.left=(state.hour*48+24)+'px';c.setAttribute('aria-valuenow',state.hour);}
function bindTimeCursor(){
 const content=$('chartContent'),scroller=$('chartScroll');if(!content?.addEventListener)return;let dragging=null;
 const hourAt=x=>{const r=content.getBoundingClientRect();return Math.max(0,Math.min(state.times.length-1,Math.floor((x-r.left)/48)));};
 content.addEventListener('pointerdown',e=>{if(!e.target.closest?.('.time-cursor'))return;e.preventDefault();e.stopPropagation();dragging=e.pointerId;content.setPointerCapture(e.pointerId);content.classList.add('cursor-dragging');});
 content.addEventListener('pointermove',e=>{if(dragging!==e.pointerId)return;const s=scroller.getBoundingClientRect();if(e.clientX>s.right-28)scroller.scrollLeft+=14;else if(e.clientX<s.left+28)scroller.scrollLeft-=14;const h=hourAt(e.clientX);if(h!==state.hour)setHour(h);});
 const end=e=>{if(dragging!==e.pointerId)return;dragging=null;content.classList.remove('cursor-dragging');if(content.hasPointerCapture(e.pointerId))content.releasePointerCapture(e.pointerId);};
 content.addEventListener('pointerup',end);content.addEventListener('pointercancel',end);
 content.addEventListener('keydown',e=>{if(!e.target.closest?.('.time-cursor'))return;if(e.key==='ArrowRight'||e.key==='ArrowLeft'){e.preventDefault();e.stopPropagation();setHour(state.hour+(e.key==='ArrowRight'?1:-1),true);$('timeCursor')?.focus?.();}});
}
function chartKey(){return [state.port,state.model,state.waveSource,state.range,state.compare,state.times[0],state.times.length].join('|');}
function moveChartSelection(){
 const content=$('chartContent');if(!content?.querySelectorAll||state.renderedChart!==chartKey())return false;
 for(const node of content.querySelectorAll('.model-meteogram .selected')){node.classList.remove('selected');if(node.hasAttribute('aria-pressed'))node.setAttribute('aria-pressed','false');}
 for(const node of content.querySelectorAll('.model-meteogram [data-hour="'+state.hour+'"]')){node.classList.add('selected');if(node.hasAttribute('aria-pressed'))node.setAttribute('aria-pressed','true');}
 const marker=$('meteogramPlot')?.querySelector?.('.selected-hour');if(marker)marker.innerHTML=selectedHourMarker();positionTimeCursor();
 const context=$('meteogramContext');if(context){const t=state.times[state.hour];context.textContent=PORTS[state.port].name+' · '+windModelInfo(state.model).label+' · '+shortFmt.format(new Date(t*1000))+' · clouds '+format(windAt(state.port,'cloud_cover',t),0)+'% · precipitation '+formatRain(windAt(state.port,'precipitation',t))+' mm / 1 h';}return true;
}
function setHour(hour,scroll=false){state.hour=Math.max(0,Math.min(state.times.length-1,Number(hour)));renderPorts();renderSummary();renderTimeline();if(!moveChartSelection())renderChart();updateMarkers();updateRouteWaves();drawField();updateFieldStatus();if(scroll){const x=state.hour*48,el=$('chartScroll');if(x<el.scrollLeft||x>el.scrollLeft+el.clientWidth-48)el.scrollLeft=Math.max(0,x-el.clientWidth/2);}}
let renderQueued=false;
// Several sources finish within milliseconds of each other; draw once per frame.
function scheduleRenderAll(){if(typeof requestAnimationFrame!=='function'){renderAll();return;}if(renderQueued)return;renderQueued=true;requestAnimationFrame(()=>{renderQueued=false;renderAll();});}
function renderAll(){renderQueued=false;if(map&&!state.viewTouched&&!state.flagFitDone)fitFlags();renderWindSource();renderUpdateClocks();renderWaveSource();renderPorts();renderSummary();renderTimeline();renderChart();updateMarkers();updateRouteWaves();drawField();updateFieldStatus();}
function distanceKm(a,b){const rad=Math.PI/180,dlat=(b.lat-a.lat)*rad,dlon=(b.lon-a.lon)*rad;const h=Math.sin(dlat/2)**2+Math.cos(a.lat*rad)*Math.cos(b.lat*rad)*Math.sin(dlon/2)**2;return 6371*2*Math.atan2(Math.sqrt(h),Math.sqrt(1-h));}
function renderPointDetails(){
 const p=PORTS[state.port],r=windRecord(state.port),w=selectedWaveRecords()?.[state.port];
 const gridText=(record,label)=>record&&valid(record.latitude)&&valid(record.longitude)?(record.coordinateType==='sea-query'?'Sea point '+waveSourceLabel():label)+': '+record.latitude.toFixed(6)+'°N, '+record.longitude.toFixed(6)+'°E · '+format(distanceKm(p,{lat:record.latitude,lon:record.longitude}))+' km from point':label+': waiting for data';
 $('pointDetails').innerHTML=`<div><span>POINT FROM LINK</span><a href="${p.mapUrl}" target="_blank" rel="noreferrer">${p.lat.toFixed(6)}°N, ${p.lon.toFixed(6)}°E ↗</a></div><p>${gridText(r,'Grid '+windModelInfo(state.model).short)}</p><p>${state.waveSource==='stormglass'?'Stormglass AI · query point: '+p.lat.toFixed(6)+'°N, '+p.lon.toFixed(6)+'°E · no source cell coordinates':gridText(w,'Wave / marine grid '+waveSourceLabel())}</p><small>This is a model-grid forecast. Neighbouring points can share values; waves do not describe harbour shelter.</small>`;
}
function smhiURL(point){return 'https://opendata-download-metfcst.smhi.se/api/category/snow1g/version/1/geotype/point/lon/'+point.lon+'/lat/'+point.lat+'/data.json';}
function normalizeSMHI(data){if(!Array.isArray(data.timeSeries)||!data.timeSeries.length)throw Error('No SNOW forecast');const [longitude,latitude]=data.geometry?.coordinates||[];const rows=data.timeSeries.filter(row=>Number.isFinite(Date.parse(row.time))).sort((a,b)=>Date.parse(a.time)-Date.parse(b.time));const value=(row,key)=>{const v=row.data?.[key];return valid(v)&&v>=0&&v!==9999?v:null;};return {latitude,longitude,provider:'SMHI',model:'SNOW1gv1',referenceTime:data.referenceTime,createdTime:data.createdTime,hourly:{time:rows.map(row=>Date.parse(row.time)/1000),wind_speed_10m:rows.map(row=>value(row,'wind_speed')),wind_gusts_10m:rows.map(row=>value(row,'wind_speed_of_gust')),wind_direction_10m:rows.map(row=>{const v=value(row,'wind_from_direction');return valid(v)&&v<=360?v:null;}),...Object.fromEntries(Object.entries({cloud_cover:'cloud_area_fraction',cloud_cover_low:'low_type_cloud_area_fraction',cloud_cover_mid:'medium_type_cloud_area_fraction',cloud_cover_high:'high_type_cloud_area_fraction'}).map(([key,field])=>[key,rows.map(row=>{const v=value(row,field);return valid(v)&&v<=8?v*12.5:null;})])),precipitation:rows.map(row=>{const hours=(Date.parse(row.time)-Date.parse(row.intervalParametersStartTime))/3600000;return hours===1?value(row,'precipitation_amount_mean_deterministic'):null;})}};}
async function loadSMHI(force=false){return fetchProvider('smhi_snow','ports',force);}
async function loadPorts(force=false){
 const jobs=Object.keys(MODELS).map(async model=>{
  try{
   const result=await fetchProvider(model,'ports',force),r=result.meta,records=result.records;
   if(records.length!==PORTS.length)throw Error('Incomplete point list');
   state.wind[model]=records;state.metas[model]=r;if(r.timing)state.timings[model]=r.timing;state.errors[model]='';
  }catch(e){state.errors[model]=MODELS[model].api?windModelInfo(model).label+': '+scheduleDMIRetry(model,e):windModelInfo(model).short+': forecast could not be loaded. Use ↻ to retry.';console.warn(model,e.message);}
  scheduleRenderAll();
 });
 jobs.push((async()=>{
  try{
   const result=await fetchProvider(WAVE_MODEL,'ports',force),r=result.meta,records=result.records;
   if(records.length!==PORTS.length)throw Error('Incomplete point list');
   state.wave=records;state.metas.wave=r;state.errors.wave='';
  }catch(e){state.errors.wave='Wave: ECMWF WAM data could not be loaded. Use ↻ to retry.';console.warn('wave',e.message);}
  scheduleRenderAll();
 })());
 await Promise.allSettled(jobs);
}
// Wind/gusts cover land and sea inside the Baltic region. Only the wave layer uses the land mask.
const BASIN=[[9.2,53.5],[13,53.4],[22,53.4],[24.5,56],[25,58.5],[30.5,59.5],[30.5,61],[26,61.5],[26,66.2],[21,66.2],[18,63.8],[15.8,60.7],[13,58.3],[9.2,57.8]];
function inRing(lon,lat,ring){let inside=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const [x,y]=ring[i],[xx,yy]=ring[j];if((y>lat)!==(yy>lat)&&lon<(xx-x)*(lat-y)/(yy-y)+x)inside=!inside;}return inside;}
function isLand(lon,lat){return (state.land?.features||[]).some(f=>{const polys=f.geometry.type==='Polygon'?[f.geometry.coordinates]:f.geometry.coordinates;return polys.some(poly=>inRing(lon,lat,poly[0])&&!poly.slice(1).some(h=>inRing(lon,lat,h)));});}
function isSea(lon,lat){return inRing(lon,lat,BASIN)&&!isLand(lon,lat);}
function fieldCovers(lon,lat,layer=state.layer){return inRing(lon,lat,BASIN)&&(layer!=='wave'||!isLand(lon,lat));}
function grid(kind='wind'){
 const points=[];
 for(const lat of [54.8,56.0,57.2,58.4,59.6,60.8,62.0,63.2,64.4,65.3])for(const lon of [11.5,14,16.5,19,21.5,24,26.5,29])if(isSea(lon,lat))points.push({lat,lon});
 if(kind!=='wave'){
  const centers=[{lat:57.40321,lon:21.55108},{lat:58.939033,lon:17.979752}];
  for(const p of centers)for(const dy of [-.12,0,.12])for(const dx of [-.12,0,.12])points.push({lat:Number((p.lat+dy).toFixed(6)),lon:Number((p.lon+dx).toFixed(6))});
 }
 return points;
}

let routeWaveLayer;
let map,fieldCanvas,particleCanvas,fctx,pctx,markers=[],particles=[],screenField=null,frame=0,lastFrame=0,mapPaused=false,tileErrors=0;
// Default view: Stockholm and Nynäshamn in the north-west to Saaremaa and Ventspils in the
// east, Gotland in the middle (both ports and the whole route).
const DEFAULT_VIEW=[[56.91,13.81],[59.40,25.04]];
function fitPorts(){if(!map)return;if(!fitFlags())map.fitBounds(DEFAULT_VIEW,{animate:false});}
// Closest zoom (quarter steps) at which both ports AND their whole wind flags are visible,
// clear of the map buttons (left), legend (right) and the layer switch (top left).
// Flags have a fixed pixel size, so the fit is computed in screen pixels at each zoom.
function flagPixelOffsets(point){
 if(!state.flags||!flagPorts().has(point))return [{x:0,y:0}];
 const flags=windFlagLayout(point);if(!flags.length)return null;
 const out=[{x:0,y:0}];
 for(const f of flags){const r=f.rotation*Math.PI/180,c=Math.cos(r),s=Math.sin(r);for(const [x,y] of [[f.lane-12,-WIND_FLAG.far-6],[f.lane+12,-WIND_FLAG.far-6],[f.lane-12,-WIND_FLAG.near],[f.lane+12,-WIND_FLAG.near]])out.push({x:x*c-y*s,y:x*s+y*c});}
 return out;
}
function fitFlags(){
 if(!map)return false;const size=map.getSize();if(!size.x||!size.y)return false;
 const points=PORTS.map((p,i)=>({ll:L.latLng(p.lat,p.lon),off:flagPixelOffsets(i)}));if(points.some(p=>!p.off))return false;
 const narrow=size.x<560,m={left:narrow?52:58,right:narrow?58:62,top:narrow?112:18,bottom:18},tabs=narrow?{x:0,y:0}:{x:330,y:118};
 for(let z=12;z>=4;z-=.25){
  const px=points.flatMap(p=>{const c=map.project(p.ll,z);return p.off.map(o=>({x:c.x+o.x,y:c.y+o.y}));});
  const minX=Math.min(...px.map(q=>q.x)),maxX=Math.max(...px.map(q=>q.x)),minY=Math.min(...px.map(q=>q.y)),maxY=Math.max(...px.map(q=>q.y));
  if(maxX-minX>size.x-m.left-m.right||maxY-minY>size.y-m.top-m.bottom)continue;
  const origin={x:(minX+maxX)/2-(m.left+(size.x-m.right))/2,y:(minY+maxY)/2-(m.top+(size.y-m.bottom))/2};
  if(px.some(q=>q.x-origin.x<tabs.x&&q.y-origin.y<tabs.y))continue;
  map.setView(map.unproject(L.point(origin.x+size.x/2,origin.y+size.y/2),z),z,{animate:false});state.flagFitDone=true;return true;
 }
 return false;
}
function initMap(){if(!window.L){$('fieldStatus').textContent='Map engine unavailable. Charts remain available.';return;}map=L.map('map',{zoomControl:false,attributionControl:true,minZoom:4,maxZoom:16,zoomSnap:.25,maxBounds:[[51,4],[69,36]],maxBoundsViscosity:.8});fitPorts();map.getContainer().addEventListener('pointerdown',()=>{state.viewTouched=true;},{once:true});map.getContainer().addEventListener('wheel',()=>{state.viewTouched=true;},{once:true,passive:true});const tiles=L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{attribution:'© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a>',maxZoom:19,referrerPolicy:'strict-origin-when-cross-origin'});tiles.on('tileerror',()=>{if(++tileErrors>8)$('mapError').hidden=false;});tiles.on('load',()=>{if(tileErrors===0)$('mapError').hidden=true;});tiles.addTo(map);map.createPane('routeWaves');map.getPane('routeWaves').style.zIndex=410;map.createPane('weather');map.getPane('weather').style.zIndex=350;map.getPane('weather').style.pointerEvents='none';fieldCanvas=L.DomUtil.create('canvas','field-canvas',map.getPane('weather'));particleCanvas=L.DomUtil.create('canvas','particle-canvas',map.getPane('weather'));for(const c of [fieldCanvas,particleCanvas]){c.style.position='absolute';c.style.pointerEvents='none';}fctx=fieldCanvas.getContext('2d');pctx=particleCanvas.getContext('2d');PORTS.forEach((p,i)=>markers.push(L.marker([p.lat,p.lon],{icon:markerIcon(i)}).addTo(map).on('click',()=>selectPort(i))));map.on('movestart zoomstart',()=>{mapPaused=true;pctx.clearRect(0,0,particleCanvas.width,particleCanvas.height);});map.on('moveend zoomend resize',()=>{mapPaused=false;updateRouteWaves();drawField();});map.on('click',e=>{if(!fieldCovers(e.latlng.lng,e.latlng.lat))return;const v=sample(e.latlng.lat,e.latlng.lng);const label=state.layer==='wave'?'Wave Hs':state.layer==='gust'?'Gusts':'Wind';L.popup().setLatLng(e.latlng).setContent(`<b>${label} · ${format(v?.value)} ${state.layer==='wave'?'m':'m/s'}</b><br>${fullFmt.format(new Date(selectedEpoch()*1000))}<br>${e.latlng.lat.toFixed(2)}°N ${e.latlng.lng.toFixed(2)}°E<br><small>Interpolated overview grid · ${state.layer==='wave'?waveSourceLabel():windModelInfo(state.model).label}</small>`).openOn(map);});new ResizeObserver(()=>{map.invalidateSize();if(!state.viewTouched)fitPorts();}).observe($('map'));requestAnimationFrame(animate);}

// Four query rows, extended toward Gotland, with independent marine samples at cell centres.
const NAUTICAL_MILE_KM=1.852,ROUTE_ROW_OFFSETS_NM=[-30,-15,0,15],EARTH_KM=6371.0088;
const radians=x=>x*Math.PI/180,degrees=x=>x*180/Math.PI;
function bearingBetween(a,b){const p=radians(a.lat),q=radians(b.lat),d=radians(b.lon-a.lon);return (degrees(Math.atan2(Math.sin(d)*Math.cos(q),Math.cos(p)*Math.sin(q)-Math.sin(p)*Math.cos(q)*Math.cos(d)))+360)%360;}
function destination(p,bearing,km){const d=km/EARTH_KM,b=radians(bearing),a=radians(p.lat),o=radians(p.lon),lat=Math.asin(Math.sin(a)*Math.cos(d)+Math.cos(a)*Math.sin(d)*Math.cos(b));return {lat:degrees(lat),lon:(degrees(o+Math.atan2(Math.sin(b)*Math.sin(d)*Math.cos(a),Math.cos(d)-Math.sin(a)*Math.sin(lat)))+540)%360-180};}
function routeGeometry(){const a=PORTS[0],b=PORTS[2],length=distanceKm(a,b),bearing=bearingBetween(a,b),axis=[],left=[],right=[],points=[];
 const pointAt=(fraction,offset,kind='row')=>{const center=destination(a,bearing,length*fraction),heading=fraction===1?bearingBetween(destination(a,bearing,length*.99),center):bearingBetween(center,b);return {...destination(center,heading+(offset<0?-90:90),Math.abs(offset)*NAUTICAL_MILE_KM),fraction,station:fraction*10,offset,kind};};
 for(let station=0;station<=10;station++){const fraction=station/10;axis.push(pointAt(fraction,0));left.push(pointAt(fraction,-30));right.push(pointAt(fraction,15));if(station>0&&station<10)for(const offset of ROUTE_ROW_OFFSETS_NM)points.push(pointAt(fraction,offset));}
 // Halfway along and across each cell: direct forecasts, not averages of the corner values.
 for(let station=1;station<9;station++)for(const offset of [-22.5,-7.5,7.5])points.push(pointAt((station+.5)/10,offset,'centre'));
 return {axis,polygon:[...left,...right.reverse()],points:points.filter(p=>isSea(p.lon,p.lat)),length};}
function routeWaveValues(){return ((state.waveSource==='stormglass'?state.stormglassRoute:state.waveSource==='ecmwf_wam'?state.routeWaveGrid:state.waveRoutes[state.waveSource])||[]).map(p=>({...p,value:at(p.series,'wave_height'),direction:at(p.series,'wave_direction'),period:at(p.series,'wave_period')}));}
// Darkened wave-scale colour: readable on the light map, still telling calm from rough at a glance.
function waveInk(v){if(!valid(v))return '#879ca6';const val=v*5;let rgb=stops.at(-1)[1];for(let i=1;i<stops.length;i++)if(val<stops[i][0]){const [a,ac]=stops[i-1],[b,bc]=stops[i],f=Math.max(0,(val-a)/(b-a));rgb=ac.map((x,j)=>x+(bc[j]-x)*f);break;}return 'rgb('+rgb.map(x=>Math.round(x*.5)).join(',')+')';}
function routeWaveIcon(p){const missing=!valid(p.value),coast=p.kind==='coast',v=missing?'—':format(p.value),title=`Significant wave height Hs ${v} m · ${fullFmt.format(new Date(selectedEpoch()*1000))} · ${waveSourceLabel()} · ${coast?p.name+(valid(p.period)?' · okres '+format(p.period)+' s':''):p.offset===0?'route axis':Math.abs(p.offset)+' NM from axis'} · point ${p.lat.toFixed(3)}°N ${p.lon.toFixed(3)}°E`+(valid(p.series?.latitude)&&valid(p.series?.longitude)?` · model grid ${p.series.latitude.toFixed(3)}°N ${p.series.longitude.toFixed(3)}°E`:'')+(routeWaveMeta()?.stale?' · cached copy':'');return L.divIcon({className:'route-wave-marker',iconSize:[36,22],iconAnchor:[18,11],html:`<span class="route-wave-value ${missing?'missing':''}${coast?' coast-wave-value':''}" style="${missing?'':'color:'+waveInk(p.value)}"${coast?' data-coast-point="'+p.id+'"':''} data-wave-height="${missing?'':p.value}" title="${title}" aria-label="${title}">${v}</span>`});}
// Wave numbers are thinned to one even spacing on screen, so the dense coastal points
// never look more crowded than the open-sea route. The spacing follows the route's own
// point spacing at the current zoom (58–84 px); values stay direct model samples.
function waveLabelSpacing(values,project,size){
 const seen=values.map(project).filter(q=>q.x>=0&&q.y>=0&&q.x<=size.x&&q.y<=size.y);if(seen.length<3)return 58;
 const gaps=seen.map((a,i)=>Math.min(...seen.filter((_,j)=>j!==i).map(b=>Math.hypot(a.x-b.x,(a.y-b.y)*1.6)))).sort((a,b)=>a-b);
 return Math.max(58,Math.min(84,gaps[Math.floor(gaps.length/2)]*.85));
}
function visibleRouteWaves(values,project,size,extra=[]){
 const spacing=waveLabelSpacing(values,project,size),chosen=[];
 const sorted=[...values].sort((a,b)=>(a.kind==='centre')-(b.kind==='centre')||(b.station%2)-(a.station%2)||a.station-b.station);
 for(const p of [...sorted,...extra]){const screen=project(p);if(screen.x<18||screen.y<11||screen.x>size.x-18||screen.y>size.y-11)continue;if(chosen.some(q=>Math.abs(q.screen.x-screen.x)<Math.max(40,spacing)&&Math.abs(q.screen.y-screen.y)<Math.max(22,spacing*.62)))continue;chosen.push({p,screen});}
 return chosen.map(x=>x.p);
}
function updateRouteWaves(){const button=$('routeWaves'),readout=$('routeWaveReadout');if(button){button.setAttribute('aria-pressed',state.routeWaves);button.classList.toggle('active',state.routeWaves);}const values=routeWaveValues(),known=values.filter(p=>valid(p.value)),meta=routeWaveMeta();
 if(readout){const summary=known.length?`Hs ${format(Math.min(...known.map(p=>p.value)))}–${format(Math.max(...known.map(p=>p.value)))} m · ${shortFmt.format(new Date(selectedEpoch()*1000))}${known.length<values.length?' · some points without data':''}`:state.waveSource==='stormglass'&&!state.stormglassStatus.routeEnabled?stormglassMapStatus():state.routeWaveLoading?'Loading route waves…':state.routeWaveError?'Route waves unavailable · use ↻':waveMissingMessage(values.map(p=>p.series));readout.textContent=summary+(meta?.stale?' · cached copy':'')+(known.length&&state.routeWaveError?' · refresh failed':'');readout.hidden=!state.routeWaves;readout.title='Hs range at Ventspils–Norvik points: an extra row 15 NM toward Gotland and cell-centre readings. '+waveSourceLabel()+'. '+cacheLabel(meta);}
 if(!map||!routeWaveLayer)return;routeWaveLayer.clearLayers();if(!state.routeWaves)return;
 const visible=visibleRouteWaves(values,p=>map.latLngToContainerPoint([p.lat,p.lon]),map.getSize(),coastWaveValues());for(const p of visible)L.marker([p.lat,p.lon],{pane:'routeWaves',icon:routeWaveIcon(p),keyboard:false,interactive:false}).addTo(routeWaveLayer);
}
function initRouteWaves(){if(!map)return;routeWaveLayer=L.layerGroup().addTo(map);updateRouteWaves();}
function coastWaveValues(){const records=state.coastWaves[state.waveSource];if(!records)return [];return COAST_POINTS.map((p,i)=>({...p,kind:'coast',series:records[i],value:at(records[i],'wave_height'),direction:at(records[i],'wave_direction'),period:at(records[i],'wave_period')}));}
async function loadCoastWaves(force=false){
 const source=state.waveSource;if(source==='stormglass'||!WAVE_SOURCES[source]?.api)return;if(!force&&state.coastWaves[source])return;
 try{const result=await fetchProvider(source,'coast',force);if(result.records.length!==COAST_POINTS.length)throw Error('Incomplete coastal data');state.coastWaves[source]=COAST_POINTS.map((p,i)=>result.records.find(r=>r.id===p.id)||result.records[i]||null);state.metas['coast-wave-'+source]=result.meta;}
 catch(e){console.warn('coast-wave',source,e.message);}
 finally{if(state.waveSource===source){updateRouteWaves();if(state.layer==='wave'){drawField();updateFieldStatus();}}}
}
async function loadRouteWaves(force=false){
 const source=state.waveSource;loadCoastWaves(force).catch(e=>console.warn('coast-wave',e.message));if(source==='stormglass')return loadStormglassRoute(force);
 const points=routeGeometry().points;if(!points.length)return;state.routeWaveLoading=true;state.routeWaveError=false;updateRouteWaves();
 try{let r,records;
  if(WAVE_SOURCES[source].api){const result=await fetchProvider(source,'route',force,partial=>{state.waveRoutes[source]=partial.map((series,i)=>({...points[i],series}));if(state.waveSource===source)updateRouteWaves();});r=result.meta;records=result.records;}
  else{r=await requestJSON(url('https://marine-api.open-meteo.com/v1/marine',points,{hourly:'wave_height,wave_direction,wave_period',models:source,cell_selection:'sea'}),'route-wave-gotland-centres-v3-'+source,force);records=list(r.data);}
  if(records.length!==points.length)throw Error('Incomplete corridor data');const entries=records.map((series,i)=>({...points[i],series}));
  if(source==='ecmwf_wam'){state.routeWaveGrid=entries;state.metas['route-wave']=r;}else{state.waveRoutes[source]=entries;state.metas['route-wave-'+source]=r;}
 }catch(e){if(state.waveSource===source)state.routeWaveError=true;console.warn('route-wave',source,e.message);}
 finally{if(state.waveSource===source){state.routeWaveLoading=false;updateRouteWaves();if(state.layer==='wave'){drawField();updateFieldStatus();}}}
}
function stormglassMapStatus(){
 if(state.stormglassLoading)return 'Stormglass AI: loading waves for 3 port positions…';
 if(state.errors.stormglass)return state.errors.stormglass;
 const count=PORTS.filter((p,i)=>valid(waveAt(i,'wave_height'))).length;
 return `Stormglass AI: ${count}/3 positions with waves this hour · readings in the port cards and hourly table. `+(state.stormglassStatus.routeEnabled?'Route: '+(state.routeWaveLoading?'loading…':state.routeWaveError?'data unavailable':state.stormglassRoute?'on.':'waiting for data.'):'Full route grid is off.')+(waveMeta()?.stale?' Cached copy.':'');
}
function markerIcon(i){return L.divIcon({className:'port-pin '+(state.port===i?'active':''),iconSize:[1,1],html:`${windFlagsSVG(i)}<span class="pin-dot" title="${PORTS[i].name}" aria-label="${PORTS[i].name}"></span>`});}
function updateMarkers(){renderFlagCycleStatus();if(!map)return;markers.forEach((m,i)=>{m.setIcon(markerIcon(i));m.setZIndexOffset(i===state.port?1000:0);});}
function selectPort(i){state.port=i;state.viewTouched=true;renderAll();if(map)map.flyTo([PORTS[i].lat,PORTS[i].lon],Math.max(map.getZoom(),12),{duration:state.animate ? 0.7 : 0});}
async function loadField(force=false){
 if(state.waveSource==='stormglass'&&state.layer==='wave'){await loadStormglassRoute(force);drawField();updateFieldStatus();return;}
 if(state.model==='smhi_snow'&&state.layer!=='wave'){drawField();updateFieldStatus();return;}
 if(!state.gridPoints.length)return;
 const model=state.model,isWave=state.layer==='wave',source=isWave?state.waveSource:model,points=isWave?grid('wave'):state.gridPoints;
 const existing=isWave?(source==='ecmwf_wam'?state.waveGrid:state.waveFields[source]):state.windGrid[model];
 if(!force&&existing){drawField();updateFieldStatus();return;}
 const pending=++state.fieldLoading;$('fieldStatus').textContent='Loading field '+(isWave?WAVE_SOURCES[source].label:windModelInfo(model).label)+'…';
 try{let r,records;
  if((isWave?WAVE_SOURCES[source]:MODELS[source]).api){const result=await fetchProvider(source,isWave?'wave-grid':'wind-grid',force);r=result.meta;records=result.records;}
  else{const u=url(isWave?'https://marine-api.open-meteo.com/v1/marine':'https://api.open-meteo.com/v1/forecast',points,isWave?{hourly:'wave_height,wave_direction,wave_period',models:source,cell_selection:'sea'}:{hourly:'wind_speed_10m,wind_gusts_10m,wind_direction_10m',models:model,wind_speed_unit:'ms',cell_selection:'nearest'});r=await requestJSON(u,'grid-v4-'+source,force);records=list(r.data);}
  const entries=records.map((series,i)=>({lat:points[i].lat,lon:points[i].lon,series}));
  if(isWave){if(source==='ecmwf_wam')state.waveGrid=entries;else state.waveFields[source]=entries;}else state.windGrid[model]=entries;
  state.metas['grid-'+source]=r;if(pending===state.fieldLoading){drawField();updateFieldStatus();}
 }catch(e){if(pending===state.fieldLoading){$('fieldStatus').textContent='Model field unavailable · use ↻ to retry.';drawField();}console.warn('grid',source,e.message);}
}
let mergedWaveField={key:null,points:null};
// The regional wave grid is coarse (about 1–2.5°); adding the route and coastal samples of
// the same model gives a much finer, smoother field along the route and near both ports.
function waveFieldPoints(source){
 const base=source==='ecmwf_wam'?state.waveGrid:state.waveFields[source],route=source==='ecmwf_wam'?state.routeWaveGrid:state.waveRoutes[source],coast=state.coastWaves[source];
 if(mergedWaveField.base===base&&mergedWaveField.route===route&&mergedWaveField.coast===coast&&mergedWaveField.source===source)return mergedWaveField.points;
 const extra=[...(route||[]).filter(p=>p.series).map(p=>({lat:p.lat,lon:p.lon,series:p.series})),...(coast||[]).map((series,i)=>series?{lat:COAST_POINTS[i].lat,lon:COAST_POINTS[i].lon,series}:null).filter(Boolean)];
 const points=base||extra.length?[...(base||[]),...extra]:null;mergedWaveField={base,route,coast,source,points};return points;
}
function currentGrid(){return state.layer==='wave'?(state.waveSource==='stormglass'?state.stormglassRoute:waveFieldPoints(state.waveSource)):state.windGrid[state.model];}
function updateFieldStatus(){if(state.waveSource==='stormglass'&&state.layer==='wave'){$('fieldStatus').textContent=stormglassMapStatus();return;}if(state.model==='smhi_snow'&&state.layer!=='wave'){$('fieldStatus').textContent='SMHI: wind and gusts at three points. No regional SMHI field.';return;}const g=currentGrid(),meta=state.metas['grid-'+(state.layer==='wave'?state.waveSource:state.model)];$('fieldStatus').textContent=g?`${g.length} points · spatial interpolation · ${cacheLabel(meta)}`:'Map field unavailable';}
function nearestGridPoints(g,lat,lon){
 const c=Math.cos(lat*Math.PI/180),best=[];
 for(let i=0;i<g.length;i++){const p=g[i],d=(p.lat-lat)**2+((p.lon-lon)*c)**2;if(best.length===4&&d>=best[3].d)continue;let j=best.length;best.push({p,d});while(j>0&&best[j-1].d>d){best[j]=best[j-1];j--;}best[j]={p,d};if(best.length>4)best.pop();}
 return best;
}
function fieldKeys(){return {key:state.layer==='wave'?'wave_height':state.layer==='gust'?'wind_gusts_10m':'wind_speed_10m',dk:state.layer==='wave'?'wave_direction':'wind_direction_10m'};}
function sampleNearby(nearby,key,dk,t,g=null){if(!nearby.length||nearby[0].d>5)return null;let sum=0,value=0,u=0,v=0,dsum=0;for(const item of nearby){const p=g?g[item.i]:item.p,d=item.d,val=at(p.series,key,t),dir=at(p.series,dk,t),weight=1/Math.max(.008,d);if(valid(val)){sum+=weight;value+=weight*val;}if(valid(dir)){dsum+=weight;const rad=dir*Math.PI/180;u+=-Math.sin(rad)*weight;v+=Math.cos(rad)*weight;}}return sum?{value:value/sum,u:dsum?u/dsum:0,v:dsum?v/dsum:0}:null;}
function sample(lat,lon){const g=currentGrid();if(!g)return null;const {key,dk}=fieldKeys();return sampleNearby(nearestGridPoints(g,lat,lon),key,dk,selectedEpoch());}
let fieldGeometry=null;
// Cell positions, land coverage and interpolation neighbours depend only on the
// map view and sample grid, not on the hour; compute them once per view.
function fieldGeometryFor(g,size){
 const a=map.containerPointToLatLng([0,0]),b=map.containerPointToLatLng([size.x,size.y]),wave=state.layer==='wave',key=[size.x,size.y,a.lat.toFixed(6),a.lng.toFixed(6),b.lat.toFixed(6),b.lng.toFixed(6),wave,g.length,g[0]?.lat,g[0]?.lon,g.at(-1)?.lat,g.at(-1)?.lon].join('|');
 if(fieldGeometry?.key===key)return fieldGeometry;
 const step=12,cols=Math.ceil(size.x/step),rows=Math.ceil(size.y/step),cells=[];
 for(let y=0;y<rows;y++)for(let x=0;x<cols;x++){const ll=map.containerPointToLatLng([x*step+step/2,y*step+step/2]);if(!fieldCovers(ll.lng,ll.lat))continue;const nearby=nearestGridPoints(g,ll.lat,ll.lng);if(nearby.length&&nearby[0].d<=5)cells.push({index:y*cols+x,nearby:nearby.map(({p,d})=>({i:g.indexOf(p),d}))});}
 return fieldGeometry={key,cols,rows,step,cells};
}
const stops=[[0,[55,84,134]],[5,[38,156,182]],[10,[72,195,165]],[15,[174,203,105]],[20,[232,177,92]],[25,[208,101,100]]];
function color(value){if(state.layer!=='wave')return windRGB(value);const val=value*5;for(let i=1;i<stops.length;i++)if(val<stops[i][0]){const [a,ac]=stops[i-1],[b,bc]=stops[i],f=Math.max(0,(val-a)/(b-a));return ac.map((x,j)=>Math.round(x+(bc[j]-x)*f));}return stops.at(-1)[1];}
function drawField(){if(!map||!fctx)return;const size=map.getSize(),pos=map.containerPointToLayerPoint([0,0]);if(!size.x||!size.y)return;for(const c of [fieldCanvas,particleCanvas]){L.DomUtil.setPosition(c,pos);c.width=size.x;c.height=size.y;c.style.width=size.x+'px';c.style.height=size.y+'px';}particles=[];screenField=null;fctx.clearRect(0,0,size.x,size.y);const g=currentGrid();if(!g||!state.land)return;const geometry=fieldGeometryFor(g,size),{step,cols,rows}=geometry,{key,dk}=fieldKeys(),t=selectedEpoch(),alpha=state.layer==='wave'?136:102;screenField={cols,rows,step,values:Array(cols*rows)};const small=document.createElement('canvas');small.width=cols;small.height=rows;const sc=small.getContext('2d'),im=sc.createImageData(cols,rows);for(const cell of geometry.cells){const s=sampleNearby(cell.nearby,key,dk,t,g);if(!s)continue;screenField.values[cell.index]=s;const c=color(s.value),k=cell.index*4;im.data[k]=c[0];im.data[k+1]=c[1];im.data[k+2]=c[2];im.data[k+3]=alpha;}sc.putImageData(im,0,0);fctx.imageSmoothingEnabled=true;fctx.drawImage(small,0,0,size.x,size.y); // Clip only the wave field to land; atmospheric wind remains visible over cities and ports.
fctx.globalCompositeOperation='destination-in';fctx.beginPath();BASIN.forEach(([lon,lat],i)=>{const p=map.latLngToContainerPoint([lat,lon]);i?fctx.lineTo(p.x,p.y):fctx.moveTo(p.x,p.y);});fctx.closePath();fctx.fillStyle='#000';fctx.fill();if(state.layer==='wave'){fctx.globalCompositeOperation='destination-out';for(const f of state.land.features){const polys=f.geometry.type==='Polygon'?[f.geometry.coordinates]:f.geometry.coordinates;for(const poly of polys){fctx.beginPath();for(const ring of poly){ring.forEach(([lon,lat],i)=>{const p=map.latLngToContainerPoint([lat,lon]);i?fctx.lineTo(p.x,p.y):fctx.moveTo(p.x,p.y);});fctx.closePath();}fctx.fill('evenodd');}}}fctx.globalCompositeOperation='source-over';for(let i=0;i<Math.min(650,Math.floor(size.x*size.y/900));i++)particles.push(newParticle(size.x,size.y));}
function newParticle(w,h){for(let i=0;i<15;i++){const p={x:Math.random()*w,y:Math.random()*h,age:Math.random()*80};if(screenAt(p.x,p.y))return p;}return {x:-10,y:-10,age:100};}
function screenAt(x,y){if(!screenField)return null;const {step,cols,rows,values}=screenField,c=Math.floor(x/step),r=Math.floor(y/step);return c>=0&&r>=0&&c<cols&&r<rows?values[r*cols+c]:null;}
function animate(now){requestAnimationFrame(animate);if(!pctx||!screenField||mapPaused||!state.animate)return;if(now-lastFrame<36)return;const dt=Math.min(2,(now-lastFrame)/36||1);lastFrame=now;pctx.globalCompositeOperation='destination-in';pctx.fillStyle='rgba(0,0,0,.90)';pctx.fillRect(0,0,particleCanvas.width,particleCanvas.height);pctx.globalCompositeOperation='source-over';pctx.strokeStyle=state.layer==='wave'?'rgba(36,88,139,.7)':'rgba(84,77,135,.7)';pctx.lineWidth=state.layer==='wave'?1.6:1.1;for(let i=0;i<particles.length;i++){let p=particles[i],s=screenAt(p.x,p.y);if(!s||p.age++>90){particles[i]=newParticle(particleCanvas.width,particleCanvas.height);continue;}const speed=(state.layer==='wave'?1.1:.45+s.value*.07)*dt,nx=p.x+s.u*speed,ny=p.y+s.v*speed;if(!screenAt(nx,ny)){p.age=100;continue;}pctx.beginPath();pctx.moveTo(p.x,p.y);pctx.lineTo(nx,ny);pctx.stroke();p.x=nx;p.y=ny;}}
function updateScale(){
 const wave=state.layer==='wave',label=wave?'Wave Hs':state.layer==='gust'?'Gusts':'Wind',unit=wave?'m':'m/s',values=wave?[5,4,3,2.5,2,1.5,1,.5,0]:[25,20,15,12,10,8,6,5,4,3,2,1,0];
 $('scaleTitle').textContent=label;$('scaleUnit').textContent=unit;$('mapScale').setAttribute('aria-label',label+' · colour legend · '+unit);
 $('scaleLabels').innerHTML=values.map((v,i)=>{const rgb=wave?color(v):windRGB(v),ink=rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722<130?'#fff':'#15343e';return `<span class="scale-step" style="background:rgb(${rgb.join(',')});color:${ink}">${v.toLocaleString('en-GB')}${i===0?'+':''}</span>`;}).join('');
}
function selectModel(model){
 if(!MODELS[model])return;const changed=state.model!==model;state.model=model;if(changed)resetDMIRetryAttempts(model);document.querySelectorAll('[data-model]').forEach(x=>x.classList.toggle('active',x.dataset.model===model));
 if($('windSource'))$('windSource').value=model;if($('modelDescription'))$('modelDescription').textContent=windModelInfo(model).desc;renderAll();
 if(MODELS[model].api)loadExtraWindPorts(model);loadModelTiming(model);if(state.layer!=='wave')loadField();
}
function renderWaveSource(){const select=$('waveSource');if(select){select.value=state.waveSource;const option=select.querySelector?.('[value="stormglass"]');if(option){option.disabled=!state.stormglassStatus.configured;option.textContent=state.stormglassStatus.configured?(state.stormglassStatus.routeEnabled?'Stormglass AI':'Stormglass AI · ports'):'Stormglass AI · key required';}}const note=$('waveSourceNote');if(note)note.textContent=state.waveSource==='stormglass'?(state.stormglassStatus.routeEnabled?'Stormglass AI: ports and route points.':'Stormglass AI: wave height and direction for three port positions. Full route grid is off.'):'Wave: ECMWF WAM.';if(note&&WAVE_SOURCES[state.waveSource].desc)note.textContent=WAVE_SOURCES[state.waveSource].desc;const modelNote=$('waveModelNote');if(modelNote)modelNote.innerHTML='Wave: '+waveSourceLabel()+'.<br>The model does not resolve harbour shelter.';const caption=$('routeSource');if(caption)caption.textContent='Wave Hs in metres · '+waveSourceLabel();}
async function loadStormglassStatus(){try{const response=await fetch('/api/stormglass/status',{signal:AbortSignal.timeout(12000)});if(!response.ok)throw Error('status');const status=await response.json();state.stormglassStatus={configured:status.configured===true,routeEnabled:status.routeEnabled===true};WAVE_SOURCES.stormglass.available=state.stormglassStatus.configured;}catch{state.stormglassStatus={configured:false,routeEnabled:false};WAVE_SOURCES.stormglass.available=false;}renderWaveSource();}
let stormglassPortRequest,stormglassRouteRequest;
async function loadStormglassPorts(force=false){if(stormglassPortRequest)return stormglassPortRequest;if(!state.stormglassStatus.configured)return;if(state.stormglassWave&&!force){renderAll();return;}state.stormglassLoading=true;state.errors.stormglass='';renderAll();stormglassPortRequest=(async()=>{try{const r=await requestJSON('/api/stormglass/waves?group=ports','stormglass-ports-v1',force);if(!Array.isArray(r.data.records)||r.data.records.length!==PORTS.length)throw Error('No port data');const records=PORTS.map((p,i)=>r.data.records.find(record=>record.id===String(i)));if(records.some(record=>!record?.hourly))throw Error('Incomplete port data');state.stormglassWave=records;state.metas.stormglass={saved:Math.min(...r.data.records.map(x=>x.saved)),stale:r.stale};state.errors.stormglass='';}catch(e){state.errors.stormglass=(e.status===429||e.message==='HTTP 429')?'Stormglass: daily request limit reached.':'Stormglass: waves could not be loaded. Check the key and refresh.';}finally{state.stormglassLoading=false;stormglassPortRequest=null;renderAll();}})();return stormglassPortRequest;}
async function loadStormglassRoute(force=false){if(stormglassRouteRequest)return stormglassRouteRequest;if(!state.stormglassStatus.configured||!state.stormglassStatus.routeEnabled){updateRouteWaves();return;}if(state.stormglassRoute&&!force){updateRouteWaves();return;}stormglassRouteRequest=(async()=>{state.routeWaveLoading=true;state.routeWaveError=false;updateRouteWaves();try{const points=routeGeometry().points,records=[];let offset=0,stale=false;do{const r=await requestJSON('/api/stormglass/waves?group=route&offset='+offset,'stormglass-route-v1-'+offset,force);if(!Array.isArray(r.data.records))throw Error('No route data');records.push(...r.data.records);stale=stale||r.stale;offset=r.data.nextOffset;}while(offset!==null);if(records.length!==points.length)throw Error('Incomplete route forecast');state.stormglassRoute=points.map((p,i)=>({...p,series:records.find(r=>r.id===String(i))}));state.metas['route-wave-stormglass']={saved:Math.min(...records.map(r=>r.saved)),stale};}catch{state.routeWaveError=true;}finally{stormglassRouteRequest=null;state.routeWaveLoading=false;updateRouteWaves();if(state.waveSource==='stormglass'&&state.layer==='wave'){drawField();updateFieldStatus();}}})();return stormglassRouteRequest;}


const providerRequests=new Map(),providerRetries=new Map(),providerRetryTimers=new Map();
function dmiSelected(model){return model===state.model||model===state.waveSource;}
function clearDMIRetryTimers(){for(const timer of providerRetryTimers.values())clearTimeout(timer);providerRetryTimers.clear();}
function resetDMIRetryAttempts(model=null){
 for(const [source,timer] of providerRetryTimers)if(!model||source===model||!dmiSelected(source)){clearTimeout(timer);providerRetryTimers.delete(source);}
 for(const [source,retry] of providerRetries)if(!model||source===model)retry.attempts=0;
}
function scheduleDMIRetry(model,error){
 if(!model.startsWith('dmi_')||error.status!==429)return error.message;
 const retry=providerRetries.get(model);if(!retry)return error.message;
 if(!dmiSelected(model)||document.hidden)return error.message;
 if(retry.attempts>=2)return error.message+' Automatic retries finished. Try again later.';
 if(!providerRetryTimers.has(model))providerRetryTimers.set(model,setTimeout(async()=>{
  providerRetryTimers.delete(model);if(document.hidden||!dmiSelected(model))return;
  const current=providerRetries.get(model);if(!current)return;
  if(Date.now()<current.until){scheduleDMIRetry(model,current.error);return;}
  current.attempts++;
  if(model==='dmi_harmonie')await loadExtraWindPorts(model,true);else await loadExtraWavePorts(model,true);
  // Load large map/route groups only once the small port forecast succeeds.
  if(providerRetries.has(model))return;
  if(model===state.waveSource)await loadRouteWaves();
  if((model===state.model&&state.layer!=='wave')||(model===state.waveSource&&state.layer==='wave'))await loadField();
 },Math.max(0,retry.until-Date.now())+250));
 const when=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Stockholm',hour:'2-digit',minute:'2-digit',second:'2-digit'}).format(new Date(retry.until));
 return 'DMI temporarily unavailable (HTTP 429). Automatic attempt '+(retry.attempts+1)+'/2 o '+when+' (Swedish time).';
}
function resumeDMIRetries(){
 for(const [model,retry] of providerRetries){if(!dmiSelected(model))continue;const key=model==='dmi_harmonie'?model:'wave-'+model;state.errors[key]=(MODELS[model]||WAVE_SOURCES[model]).label+': '+scheduleDMIRetry(model,retry.error);}
 renderAll();
}
async function fetchProvider(model,group,force=false,onProgress){
 const retry=providerRetries.get(model);if(retry&&Date.now()<retry.until)throw retry.error;const key=model+'/'+group;if(providerRequests.has(key))return providerRequests.get(key);
 const job=(async()=>{let offset=0,records=[],timing=null,saved=Infinity,checkedAt=Infinity,refreshAfter=Infinity,stale=false,delivery=null,blend=false;
  do{const r=await requestJSON('/api/forecast?'+new URLSearchParams({model,group,offset}), 'provider-cycle-v2/'+key+'/'+offset,force,model.startsWith('dmi_')?3600000:1800000);
   if(!Array.isArray(r.data.records)||!r.data.records.length)throw Error('No model records');records.push(...r.data.records);timing=r.data.timing||timing;saved=Math.min(saved,r.data.saved||r.saved);stale=stale||r.stale||r.data.stale;checkedAt=Math.min(checkedAt,r.data.checkedAt||r.saved);const expiry=Date.parse(r.data.refreshAfter||r.data.timing?.nextUpdate);if(Number.isFinite(expiry))refreshAfter=Math.min(refreshAfter,expiry);if(r.data.delivery==='open-meteo'||!delivery)delivery=r.data.delivery||delivery;blend=blend||Boolean(r.data.blend);
   const next=r.data.nextOffset;if(next!==null&&(!Number.isInteger(next)||next<=offset))throw Error('Invalid model range');offset=next;if(onProgress)onProgress(records);
  }while(offset!==null);
  if(model.startsWith('dmi_')){providerRetries.delete(model);if(providerRetryTimers.has(model))clearTimeout(providerRetryTimers.get(model));providerRetryTimers.delete(model);}
  return {records,meta:{saved,checkedAt,refreshAfter:Number.isFinite(refreshAfter)?new Date(refreshAfter).toISOString():null,stale,timing,delivery,blend}};
 })().catch(error=>{if(model.startsWith('dmi_')&&error.status===429)providerRetries.set(model,{until:Math.max(Date.now()+60000,Date.parse(error.retryAt)||Date.now()+(error.retryAfter||60)*1000),error,attempts:providerRetries.get(model)?.attempts||0});throw error;}).finally(()=>providerRequests.delete(key));providerRequests.set(key,job);return job;
}
async function loadExtraWindPorts(model,force=false){
 if(!MODELS[model]?.api)return;if(!force&&state.wind[model]&&providerDataFresh(model,state.metas[model]))return;
 state.providerLoading[model]=true;renderUpdateClocks();
 try{const result=await fetchProvider(model,'ports',force);state.wind[model]=result.records;state.metas[model]=result.meta;state.timings[model]=result.meta.timing;state.errors[model]='';}
 catch(e){state.errors[model]=windModelInfo(model).label+': '+scheduleDMIRetry(model,e);}finally{state.providerLoading[model]=false;scheduleRenderAll();}
}
async function loadExtraWavePorts(source,force=false){
 if(['ecmwf_wam','stormglass','smhi_swan'].includes(source))return;if(!force&&state.waves[source]&&providerDataFresh(source,state.metas['wave-'+source]))return;
 state.providerLoading[source]=true;renderAll();
 try{let records,meta;
  if(WAVE_SOURCES[source].api){const result=await fetchProvider(source,'ports',force);records=result.records;meta=result.meta;state.timings[source]=meta.timing;}
  else{const r=await requestJSON(url('https://marine-api.open-meteo.com/v1/marine',PORTS,{hourly:'wave_height,wave_direction,wave_period',models:source,cell_selection:'sea'}),'wave-ports-v2-'+source,force);records=list(r.data);meta=r;}
  if(records.length!==PORTS.length)throw Error('Incomplete point list');state.waves[source]=records;state.metas['wave-'+source]=meta;state.errors['wave-'+source]='';
 }catch(e){state.errors['wave-'+source]=WAVE_SOURCES[source].label+': '+scheduleDMIRetry(source,e);}finally{state.providerLoading[source]=false;scheduleRenderAll();}
}
function providerDataFresh(model,meta){const next=Date.parse(meta?.refreshAfter||meta?.timing?.nextUpdate);return Number.isFinite(next)?Date.now()<next:Date.now()-(meta?.checkedAt||meta?.saved||0)<3600000;}
async function refreshDMIIfDue(){
 if(document.hidden)return;
 const due=Object.keys(MODELS).some(model=>state.metas[model]&&!providerDataFresh(model,state.metas[model]))||waveMeta()&&!providerDataFresh(state.waveSource,waveMeta());
 if(!due)return;await loadPorts();await loadExtraWavePorts(state.waveSource);
 await Promise.allSettled([loadField(true),loadRouteWaves(true)]);
}
async function loadModelTiming(model,force=false){
 if(!['ecmwf_ifs','icon_eu','icon_global','ecmwf_wam','dwd_ewam','dmi_harmonie','dmi_wam','copernicus_baltic'].includes(model)){renderUpdateClocks();return;}
 const meta=model===state.waveSource?waveMeta():state.metas[model],known=meta?.refreshAfter||state.timings[model]?.nextUpdate;if(Date.now()<Date.parse(known)){renderUpdateClocks();return;}
 try{const r=await requestJSON('/api/model-updates?model='+model,'model-timing-cycle-v1-'+model,force,300000);state.timings[model]=r.data.timing;}catch{}renderUpdateClocks();
}
function sourceTiming(model,meta){
 let timing=meta?.delivery==='open-meteo'?meta.timing:state.timings[model]||meta?.timing;
 if(model==='stormglass'&&meta)timing={updatedAt:new Date(meta.saved).toISOString(),nextUpdate:new Date(meta.saved+21600000).toISOString(),basis:'fetch',estimated:true};
 return timing;
}
const stampDayFmt=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Stockholm',weekday:'short'});
// Short time for the map label; adds the weekday when it is not today (Swedish time).
function stampTime(ms){if(!Number.isFinite(ms))return '—';const d=new Date(ms);return (DAY_KEY.format(d)!==DAY_KEY.format(new Date())?stampDayFmt.format(d)+' ':'')+shortFmt.format(d);}
// Map label: selected source, when its data was last updated and when the next update is expected.
function renderMapStamp(){
 const wave=state.layer==='wave',model=wave?state.waveSource:state.model,meta=wave?waveMeta():state.metas[model],timing=sourceTiming(model,meta);
 const updated=$('mapUpdated'),next=$('mapNext');if(!updated||!next)return;
 updated.textContent=stampTime(Date.parse(timing?.updatedAt));next.textContent=stampTime(Date.parse(timing?.nextUpdate));
 const stamp=updated.closest?.('.map-stamp');if(stamp)stamp.title=(timing?.basis==='reference'?'Model cycle':timing?.basis==='fetch'?'Data download':'Provider publication')+(timing?.estimated?' · next update is estimated':'')+' · Swedish time';
}
function renderUpdateClocks(){renderMapStamp();
 for(const [id,model,meta] of [['windUpdates',state.model,state.metas[state.model]],['waveUpdates',state.waveSource,waveMeta()]]){
  const node=$(id);if(!node)continue;let timing=meta?.delivery==='open-meteo'?meta.timing:state.timings[model]||meta?.timing;
  if(model==='stormglass'&&meta)timing={updatedAt:new Date(meta.saved).toISOString(),nextUpdate:new Date(meta.saved+21600000).toISOString(),basis:'fetch',estimated:true};
  const updated=Date.parse(timing?.updatedAt),next=Date.parse(timing?.nextUpdate)||(Number.isFinite(updated)&&timing?.interval?updated+timing.interval:NaN),late=Number.isFinite(next)&&next<Date.now();
  const newerThanData=Number.isFinite(updated)&&meta?.saved&&updated>meta.saved;
  const label=timing?.basis==='reference'?'Last model cycle':timing?.basis==='fetch'?'Last download':'Last update';
  node.innerHTML='<span>'+label+': <b>'+ (Number.isFinite(updated)?fullFmt.format(new Date(updated)):state.providerLoading[model]?'loading…':'no information from the provider')+'</b></span><span>'+(timing?.basis==='fetch'?'Next download':'Next update (expected)')+': <b>'+(Number.isFinite(next)?fullFmt.format(new Date(next)):'—')+'</b></span>'+(late?'<small class="update-delayed">Waiting for a newer cycle — the time may shift.</small>':'')+(newerThanData?'<small class="update-delayed">A newer cycle is available — refresh the forecast.</small>':'')+(meta?.refreshAfter?'<small>Forecast on the server until: '+fullFmt.format(new Date(meta.refreshAfter))+'</small>':'')+(meta?.stale?'<small class="update-delayed">May be outdated — last good forecast.</small>':'');
 }
}

// Map on the whole screen: native fullscreen where the browser allows it for an element,
// otherwise (e.g. iPhone) a fixed full-window overlay. Esc or the same button returns.
function setMapFull(on){const section=document.querySelector('.map-section'),btn=$('mapFull');if(!section||!btn)return;section.classList.toggle('map-full',on);document.body.classList.toggle('map-full-open',on);btn.setAttribute('aria-pressed',on);btn.title=btn.ariaLabel=on?'Exit full screen':'Full-screen map';btn.setAttribute('aria-label',btn.title);if(map)setTimeout(()=>{map.invalidateSize();drawField();updateRouteWaves();renderMapTimeline();},60);}
function bindMapFullscreen(){
 const btn=$('mapFull'),section=document.querySelector('.map-section');if(!btn||!section)return;
 btn.onclick=async()=>{const on=!section.classList.contains('map-full');
  if(on&&section.requestFullscreen&&document.fullscreenEnabled){try{await section.requestFullscreen({navigationUI:'hide'});}catch{}}
  else if(!on&&document.fullscreenElement){try{await document.exitFullscreen();}catch{}}
  setMapFull(on);};
 document.addEventListener('fullscreenchange',()=>{if(!document.fullscreenElement&&section.classList.contains('map-full'))setMapFull(false);});
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&section.classList.contains('map-full')&&!document.fullscreenElement)setMapFull(false);});
}
function bindChartDrag(){
 for(const scroller of [$('chartScroll')]){let drag=null,blockClick=false;
 scroller.addEventListener('scroll',()=>{scheduleMeteogram();},{passive:true});
 scroller.addEventListener('pointerdown',event=>{if(event.button!==0||event.isPrimary===false||event.pointerType==='touch'||event.target?.closest('input'))return;drag={id:event.pointerId,x:event.clientX,y:event.clientY,left:scroller.scrollLeft,active:false};});
 scroller.addEventListener('pointermove',event=>{
  if(!drag||drag.id!==event.pointerId)return;const dx=event.clientX-drag.x,dy=event.clientY-drag.y;
  if(!drag.active){if(Math.abs(dy)>6&&Math.abs(dy)>Math.abs(dx)){drag=null;return;}if(Math.abs(dx)<6)return;drag.active=true;scroller.setPointerCapture(event.pointerId);scroller.classList.add('dragging');}
  event.preventDefault();scroller.scrollLeft=drag.left-dx;
 });
 const finish=event=>{if(!drag||drag.id!==event.pointerId)return;if(drag.active){blockClick=true;setTimeout(()=>{blockClick=false;},0);if(scroller.hasPointerCapture(event.pointerId))scroller.releasePointerCapture(event.pointerId);}drag=null;scroller.classList.remove('dragging');};
 scroller.addEventListener('pointerup',finish);scroller.addEventListener('pointercancel',finish);scroller.addEventListener('lostpointercapture',()=>{drag=null;scroller.classList.remove('dragging');});
 scroller.addEventListener('click',event=>{if(blockClick){event.preventDefault();event.stopImmediatePropagation();}},true);
 }
}
function bindEvents(){ document.addEventListener('visibilitychange',()=>{if(document.hidden)clearDMIRetryTimers();else{resumeDMIRetries();refreshDMIIfDue();}});bindChartDrag();bindTimeCursor();if($('waveAvailableHour'))$('waveAvailableHour').onclick=()=>{const next=nextWaveHour(selectedWaveRecords());if(next!==null)setHour(state.times.indexOf(next),true);}; $('windSource').onchange=e=>selectModel(e.target.value); $('waveSource').onchange=e=>{if(!selectWaveSource(e.target.value))e.target.value=state.waveSource;}; $('ports').addEventListener('click',e=>{const f=e.target.closest('[data-flag-port]');if(f){toggleFlagPort(Number(f.dataset.flagPort));return;}const b=e.target.closest('[data-port]');if(b)selectPort(Number(b.dataset.port));});$('models')?.addEventListener('click',e=>{const b=e.target.closest('[data-model]');if(b)selectModel(b.dataset.model);});$('tableLabels').addEventListener('click',e=>{const b=e.target.closest('[data-select-model]');if(b)selectModel(b.dataset.selectModel);});$('routeWaves').onclick=()=>{state.routeWaves=!state.routeWaves;updateRouteWaves();};$('flags').onclick=()=>{state.flags=!state.flags;$('flags').setAttribute('aria-pressed',state.flags);$('flags').classList.toggle('active',state.flags);updateMarkers();};$('layers').addEventListener('click',e=>{const b=e.target.closest('[data-layer]');if(!b)return;state.layer=b.dataset.layer;document.querySelectorAll('[data-layer]').forEach(x=>x.classList.toggle('active',x===b));updateScale();renderTimeline();updateMarkers();updateRouteWaves();drawField();loadField();});$('ranges').addEventListener('click',e=>{const b=e.target.closest('[data-range]');if(!b)return;state.range=Number(b.dataset.range);document.querySelectorAll('[data-range]').forEach(x=>x.classList.toggle('active',x===b));renderChart();});$('compare').onclick=()=>{state.compare=!state.compare;$('compare').setAttribute('aria-pressed',state.compare);renderChart();};$('chartContent').onclick=e=>{const b=e.target.closest('.model-meteogram [data-hour]');if(b)setHour(b.dataset.hour);};let timer;if($('mapTlRange'))$('mapTlRange').addEventListener('input',e=>setHour(Number(e.target.value)));if($('mapPlay'))$('mapPlay').onclick=()=>{$('play').click();};$('play').onclick=()=>{state.playing=!state.playing;$('play').innerHTML=playIcon(state.playing);$('play').setAttribute('aria-pressed',state.playing);$('play').setAttribute('aria-label',state.playing?'Pause forecast':'Play forecast');clearInterval(timer);if(state.playing)timer=setInterval(()=>setHour((state.hour+1)%state.times.length,true),1000);renderMapTimeline();};$('now').onclick=()=>{const now=Math.floor(Date.now()/3600000)*3600;const i=state.times.findIndex(t=>t>=now);setHour(i<0?state.times.length-1:i,true);};$('anim').setAttribute('aria-pressed',state.animate);$('anim').classList.toggle('on',state.animate);$('anim').onclick=()=>{state.animate=!state.animate;$('anim').classList.toggle('on',state.animate);$('anim').setAttribute('aria-pressed',state.animate);if(!state.animate&&pctx)pctx.clearRect(0,0,particleCanvas.width,particleCanvas.height);};bindMapFullscreen();document.querySelector('.map-controls')?.addEventListener?.('click',()=>{state.viewTouched=true;},true);$('zoomIn').onclick=()=>map?.zoomIn();$('zoomOut').onclick=()=>map?.zoomOut();$('fit').onclick=()=>{if(map){const geometry=routeGeometry();map.fitBounds(geometry.polygon.map(p=>[p.lat,p.lon]),{padding:[35,45]});}};if($('refresh'))$('refresh').onclick=async()=>{$('refresh').disabled=true;resetDMIRetryAttempts();resetForecastWindow();renderAll();await Promise.allSettled([loadPorts(true),loadField(true),loadRouteWaves(true),loadExtraWavePorts(state.waveSource,true),loadModelTiming(state.model,true),loadModelTiming(state.waveSource,true),...(state.waveSource==='stormglass'?[loadStormglassPorts(true)]:[])]);$('refresh').disabled=false;};for(const id of ['info','sources','about'])if($(id))$(id).onclick=()=>$('aboutDialog').showModal();$('closeDialog').onclick=()=>$('aboutDialog').close();$('aboutDialog').addEventListener('click',e=>{if(e.target===$('aboutDialog')){const r=e.target.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)e.target.close();}});document.addEventListener('keydown',e=>{if($('aboutDialog').open||['INPUT','SELECT','TEXTAREA'].includes(document.activeElement.tagName))return;if(e.key==='ArrowRight'||e.key==='ArrowLeft'){e.preventDefault();setHour(state.hour+(e.key==='ArrowRight'?1:-1),true);}});}
// Opening state: ICON-EU wind, ECMWF WAM waves, flags at Ventspils Berth and Norvik Berth,
// wind animation and sea-state numbers on, every time the page opens.
async function start(){Object.assign(state,{port:1,model:'icon_eu',waveSource:'ecmwf_wam',animate:true,routeWaves:true,flags:true,flagPorts:new Set([1,2])});if($('windSource'))$('windSource').value='icon_eu';if($('waveSource'))$('waveSource').value='ecmwf_wam';resetForecastWindow();renderPorts();renderTimeline();renderTableLabels();bindEvents();updateScale();initMap();setInterval(advanceFlagCycle,3000);const clock=()=>$('clock').textContent=timeFmt.format(new Date());clock();setInterval(()=>{clock();renderUpdateClocks();},30000);loadModelTiming(state.model);loadModelTiming(state.waveSource);setInterval(()=>{if(document.hidden)return;loadModelTiming(state.model,true);loadModelTiming(state.waveSource,true);refreshDMIIfDue();},300000);loadPorts();loadStormglassStatus();try{const r=await fetch('assets/land.json');if(!r.ok)throw Error('land');state.land=await r.json();state.gridPoints=grid();initRouteWaves();await Promise.allSettled([loadField(),loadRouteWaves()]);}catch(e){$('fieldStatus').textContent='The map field could not be loaded. Reload the app.';}}
start();
