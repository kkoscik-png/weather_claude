// The time cursor follows the clock only until the user picks another hour; "Now" resumes it.
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const nodes=new Map();
const el=id=>{if(!nodes.has(id))nodes.set(id,{id,innerHTML:'',textContent:'',style:{},scrollLeft:0,clientWidth:800,setAttribute(){},classList:{toggle(){},add(){},remove(){}},querySelector:()=>null,querySelectorAll:()=>[]});return nodes.get(id);};
let clock=Date.parse('2026-10-22T10:20:00Z');
class FakeDate extends Date{constructor(...a){super(...(a.length?a:[clock]));}static now(){return clock;}}
const c={Intl,Date:FakeDate,Math,Number,Array,Object,String,Map,Set,console,URLSearchParams,AbortSignal,setTimeout:()=>0,matchMedia:()=>({matches:false}),document:{getElementById:el,querySelector:el,querySelectorAll:()=>[]}};
vm.createContext(c);vm.runInContext(fs.readFileSync('dist/app.js','utf8').replace(/start\(\);\s*$/,'')+';globalThis.t={state,resetForecastWindow,setHour,tickNowCursor,nowHourIndex};',c);
const {state,resetForecastWindow,setHour,tickNowCursor,nowHourIndex}=c.t;
for(const name of ['renderPorts','renderSummary','renderTimeline','renderChart','updateMarkers','updateRouteWaves','drawField','updateFieldStatus','renderMapTimeline'])vm.runInContext(`try{${name}=()=>{}}catch{}`,c);
vm.runInContext('moveChartSelection=()=>true',c);
resetForecastWindow();assert.equal(state.hour,nowHourIndex());assert.equal(state.followingNow,true);
// Following: the next full hour moves the cursor along.
clock+=3600000;tickNowCursor();assert.equal(state.hour,nowHourIndex());
// The user drags to Thursday: ticks over the next hours must not pull it back.
setHour(50);for(let k=0;k<6;k++){clock+=600000;tickNowCursor();}assert.equal(state.hour,50);
clock+=3600000;tickNowCursor();assert.equal(state.hour,50);
// "Now" (or picking the current hour) resumes following.
setHour(nowHourIndex(),true);assert.equal(state.followingNow,true);clock+=3600000;tickNowCursor();assert.equal(state.hour,nowHourIndex());
console.log('follow-now ok');
