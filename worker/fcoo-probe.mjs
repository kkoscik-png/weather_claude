// TEMPORARY diagnostic: checks that the FCOO OPeNDAP server answers point subsets from Cloudflare.
const BASE='https://data.fcoo.dk/webmap/v2/data/NETCDF/FCOO/WW3/';
export async function handleFcooProbe(request){
  const u=new URL(request.url);if(u.pathname!=='/api/fcoo-probe')return null;
  const out=[];
  const get=async(label,url,limit=3000)=>{const t=Date.now();try{const r=await fetch(url,{signal:AbortSignal.timeout(25000)});const body=await r.text();out.push({label,url,status:r.status,ms:Date.now()-t,bytes:body.length,type:r.headers.get('content-type'),body:body.slice(0,limit)});return body;}catch(e){out.push({label,url,error:String(e),ms:Date.now()-t});return '';}};
  const listing=await get('listing',BASE,0);
  const files=[...listing.matchAll(/ww3c_NSBALT3NM_(\d{10})\.nc/g)].map(m=>m[1]).sort();const run=files.at(-1);
  out.push({runs:[...new Set(files)].slice(-4)});
  if(run){
    const f=BASE+'ww3c_NSBALT3NM_'+run+'.nc';
    const das=await get('das',f+'.das',0);
    const pick=name=>{const m=das.match(new RegExp(name+' \\{[\\s\\S]*?\\n    \\}'));return m?m[0]:null;};
    out.push({das_u:pick('u'),das_v:pick('v'),das_uv:pick('u_v'),das_tmn:pick('TMN'),das_time:pick('time')});
    await get('time',f+'.ascii?time');
    await get('lat',f+'.ascii?latc[175:1:179]');
    await get('lon',f+'.ascii?lonc[305:1:309]');
    await get('ventspils',f+'.ascii?u_v[0:1:2][175:1:179][305:1:309],u[0:1:2][175:1:179][305:1:309],v[0:1:2][175:1:179][305:1:309],TMN[0:1:2][175:1:179][305:1:309]',6000);
    await get('norvik-hs-all',f+'.ascii?u_v[0:1:55][206:1:209][263:1:266]',2500);
  }
  return new Response(JSON.stringify(out,null,1),{headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
}
