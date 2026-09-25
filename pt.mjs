const BASE='http://localhost:3000';
const post=async(r,b)=>{const res=await fetch(BASE+r,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});return {status:res.status,json:await res.json().catch(()=>null)};};
const wait=(ms)=>new Promise(r=>setTimeout(r,ms));
const sample=await fetch(BASE+'/api/sample?type=report').then(r=>r.json());
const source=sample.source;
let ledger=null;
for(let i=0;i<4&&!ledger;i++){const an=await post('/api/analyze',{source});ledger=an.json?.ledger;if(!ledger){console.log('analyze retry',i+1);await wait(45000);}}
if(!ledger){console.log('analyze unavailable — quota');process.exit(0);}
console.log('detail'.padEnd(11),'slides  bullets  errors  layouts');
for (const detail of ['Brief','Standard','Detailed']) {
  let c=null,a=null;
  for(let i=0;i<3&&!c;i++){
    const res=await post('/api/generate',{format:'presentation',
      brief:{mode:'grounded',audience:'Leadership',objective:'Inform',tone:'Professional',language:'English',detail,formats:['presentation']},source,ledger});
    a=res.json?.artifact??res.json; c=a?.content?.slides?a.content:null;
    if(!c) await wait(40000);
  }
  if(!c){console.log(detail.padEnd(11),'unavailable (quota)');continue;}
  const bullets=c.slides.reduce((n,s)=>n+(s.bullets?.length??0),0);
  const errs=(a.findings??[]).filter(f=>f.severity==='error').length;
  console.log(detail.padEnd(11),String(c.slides.length).padStart(4),String(bullets).padStart(8),String(errs).padStart(7),'  ',[...new Set(c.slides.map(s=>s.layout))].join(','));
}
