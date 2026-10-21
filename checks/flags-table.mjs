import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const nodes=new Map(),el=id=>{if(!nodes.has(id))nodes.set(id,{innerHTML:'',textContent:'',style:{},classList:{toggle(){}},setAttribute(){},append(){}});return nodes.get(id);};
const c={console,Intl,Date,Math,Number,Array,Object,String,Map,Set,URLSearchParams,AbortSignal,matchMedia:()=>({matches:false}),document:{getElementById:el,querySelector:el,querySelectorAll:()=>[],createElement:()=>({})}};
vm.createContext(c);vm.runInContext(fs.readFileSync('dist/app.js','utf8').replace(/start\(\);\s*$/,'')+';globalThis.test={state,MODELS,PORTS,windFlagsSVG,buildWindyTable,renderChart,renderTableLabels,windHeat,flowArrow,markerIcon,updateMarkers,setHour,windFlagLayout,windFlagsOverlap,advanceFlagCycle};',c);
const {state,MODELS,PORTS,windFlagsSVG,buildWindyTable,renderChart,windHeat,flowArrow}=c.test;state.slots=[0,1,2];
// Around midnight in Swedish time: table day groups must not use the host timezone.
state.times=[Date.parse('2026-10-16T21:00:00Z')/1000,Date.parse('2026-10-16T22:00:00Z')/1000,Date.parse('2026-10-16T23:00:00Z')/1000];state.base=state.times[0];
state.wind=Object.fromEntries(Object.keys(MODELS).map((model,j)=>[model,PORTS.map((p,i)=>({hourly:{time:state.times,wind_speed_10m:[5+j,10+j,15+j],wind_gusts_10m:[8+j,15+j,21+j],wind_direction_10m:[220+j*5,70+j*5,120+j*5]}}))]));
state.wave=PORTS.map(()=>({hourly:{time:state.times,wave_height:[.5,1,1.5],wave_direction:[190,200,210],wave_period:[3,4,5]}}));
for(let p=0;p<3;p++){
 state.port=p;for(let other=0;other<3;other++)if(other!==p)assert.equal(windFlagsSVG(other),'');state.hour=0;const first=windFlagsSVG(p);assert.equal((first.match(/data-flag-model=/g)||[]).length,4);assert(!first.includes('data-flag-model="icon_global"'));assert(first.includes('data-wind-from="220"'));assert(first.includes('5.0'));assert.equal((first.match(/class="flag-stem"/g)||[]).length,4);assert(!first.includes('V-155'));assert(first.includes('fill="none"'));assert(first.includes('stroke-width=".8"'));assert(first.includes('d="M0,0 V-42 H'));assert(first.includes('rx="4"'));assert.equal((first.match(/class="flag-tail"/g)||[]).length,4);assert.equal((first.match(/class="flag-arrow"/g)||[]).length,4);assert(!first.includes('mast-arrow'));assert(first.includes('<animateMotion'));assert(/path="M(-?[\d.]+),-\d+(\.\d+)? L\1,-\d+(\.\d+)? L0,0"/.test(first),'along the flag axis, then on to the port dot');assert(first.includes('data-values="'));
 state.hour=1;const next=windFlagsSVG(p);assert(next.includes('data-wind-from="70"'));assert(next.includes('10.0'));assert.notEqual(first,next);
 const table=buildWindyTable(state.times);assert.equal((table.match(/data-row-model=/g)||[]).length,6);assert(!table.includes('data-row-model="icon_global"'));assert(!table.includes('data-row-model="icon_d2"'));assert.equal((table.match(/class="meteo-day"/g)||[]).length,2);assert.equal((table.match(/role="cell"/g)||[]).length,18);assert.equal((table.match(/meteo-cell selected/g)||[]).length,6);assert(table.includes('23:00'));assert(table.includes('00:00'));assert(table.includes('Wind 10.0 m/s · Gusts 15.0 m/s'));assert(!table.includes('NaN'));renderChart();assert(el('tableLabels').innerHTML.includes('ICON-EU'));assert(el('chartContent').innerHTML.includes('model-meteogram'));
}
assert.notEqual(windHeat(4),windHeat(10));assert.equal(windHeat(null),'#f0f2f3');assert(flowArrow(0).includes('rotate(180deg)'));
state.flags=false;assert.equal(windFlagsSVG(0),'');state.flags=true;state.port=0;state.hour=0;state.wind.icon_eu[0].hourly.wind_speed_10m[0]=null;assert.equal((windFlagsSVG(0).match(/data-flag-model=/g)||[]).length,3);state.model='icon_global';assert(!windFlagsSVG(0).includes('icon_global'));state.model='icon_eu';
state.wind.smhi_snow[0].hourly.wind_speed_10m[0]=0;assert(windFlagsSVG(0).includes('calm-flag'));assert(!windFlagsSVG(0).includes('NaN'));
// Exercise the actual shared hourly selector: flags on the selected marker and every table row follow it.
state.wind.icon_eu[0].hourly.wind_speed_10m[0]=6;
state.wind.smhi_snow[0].hourly.wind_speed_10m[0]=7;
const icons=[];vm.runInContext('map={};markers=PORTS.map(()=>({setIcon(icon){globalThis.captureIcon(icon)},setZIndexOffset(){}}));',c);c.captureIcon=icon=>icons.push(icon);c.L={divIcon:x=>x};
c.test.setHour(0);const firstMarker=icons[0].html;assert(!icons[1].html.includes('wind-flags-svg'));assert(!icons[2].html.includes('wind-flags-svg'));assert(firstMarker.includes('data-wind-from="220"'));
c.test.setHour(1);const nextMarker=icons[PORTS.length].html;assert(nextMarker.includes('data-wind-from="70"'));assert.notEqual(firstMarker,nextMarker);assert.equal(icons.length,PORTS.length*2);assert.equal(state.hour,1);assert.equal((el('chartContent').innerHTML.match(/meteo-cell selected/g)||[]).length,6);
// Labels use true compass bearings: adjacent directions collide, perpendicular
// and opposing winds stay separate, including the 359°/1° wrap around north.
const {windFlagLayout,windFlagsOverlap,advanceFlagCycle}=c.test;
assert(windFlagsOverlap(359,1));assert(windFlagsOverlap(40,43));assert(!windFlagsOverlap(0,90));assert(!windFlagsOverlap(0,180));
state.port=0;state.hour=0;state.flagCycle=0;
for(const [i,model] of Object.keys(MODELS).entries())state.wind[model][0].hourly.wind_direction_10m[0]=['icon_eu','ecmwf_ifs','smhi_snow','dmi_harmonie'].includes(model)?40+i:220+i*20;
let layout=windFlagLayout(0);assert.equal(layout.length,4);assert.equal(new Set(layout.map(f=>f.model)).size,4);assert.equal(layout.filter(f=>f.cycleSize===4).length,4);assert.equal(new Set(layout.map(f=>f.lane)).size,4);
const seen=new Set();for(let phase=0;phase<4;phase++){state.flagCycle=phase;layout=windFlagLayout(0);assert.equal(layout.length,4);const front=layout.filter(f=>f.front);assert.equal(front.length,1);seen.add(front[0].model);assert.equal(layout.at(-1).model,front[0].model);const svg=windFlagsSVG(0);assert.equal((svg.match(/aria-hidden="false"/g)||[]).length,4);assert(!svg.includes('flag-obscured'));}
assert.equal(seen.size,4);
// Four flags (ICON-EU, ECMWF, SMHI, DMI); never ICON Global.
state.model='smhi_snow';assert(windFlagLayout(0).some(f=>f.model==='smhi_snow'));assert.equal(windFlagLayout(0).length,4);assert(!windFlagLayout(0).some(f=>f.model==='icon_global'));state.model='ecmwf_ifs';
// The timer moves the overlapping card to the top without hiding any card.
state.flagCycle=0;let toggles=0;const raised=[],liveNodes=windFlagLayout(0).map(f=>({model:f.model,dataset:{cycleSize:String(f.cycleSize),cycleIndex:String(f.cycleIndex)},classList:{toggle(name,front){assert.equal(name,'flag-front');this.front=front;toggles++;}},parentNode:{append(node){raised.push(node.model);}}}));
c.document.querySelectorAll=()=>liveNodes;for(let i=0;i<4;i++)advanceFlagCycle();assert.equal(state.flagCycle,4);assert.equal(new Set(raised).size,4);assert.equal(liveNodes.length,4);assert.equal(toggles,16);
state.flags=false;advanceFlagCycle();assert.equal(state.flagCycle,4);state.flags=true;c.document.hidden=true;advanceFlagCycle();assert.equal(state.flagCycle,4);c.document.hidden=false;c.document.querySelectorAll=()=>[];
console.log('PASS: selected-port rounded flags, exact bearing alignment, three simultaneous sources and rotating overlap order without hiding flags, actual hourly-selector synchronization, values/bearings, calm/missing handling, table rows, Swedish day grouping, heat colors and selected column.');
