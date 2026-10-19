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
    const pick=name=>{const i=das.indexOf('\n    '+name+' {');return i<0?null:das.slice(i,das.indexOf('\n    }',i)+6);};
    out.push({das_u:pick('u'),das_v:pick('v'),das_time:pick('time'),das_global:das.slice(das.indexOf('NC_GLOBAL'),das.indexOf('NC_GLOBAL')+1500)});
    await get('time',f+'.ascii?time[0:1:3]',800);
    await get('tiny',f+'.ascii?u_v[0:1:1][177:1:178][307:1:308],u[0:1:0][177:1:178][307:1:308],v[0:1:0][177:1:178][307:1:308]',2000);
    await get('tinyhs-only',f+'.ascii?u_v.u_v[0:1:1][177:1:178][307:1:308]',1200);
    const t=Date.now();await get('big',f+'.ascii?u_v.u_v[0:1:55][170:1:185][300:1:315]',0);out.push({bigms:Date.now()-t});
  }
  return new Response(JSON.stringify(out,null,1),{headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
}
