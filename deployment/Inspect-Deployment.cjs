'use strict';
const {execFileSync}=require('node:child_process');
async function main(){
  const raw=execFileSync('git',['credential','fill'],{input:'protocol=https\nhost=github.com\npath=shahvexcom/Shahvex.git\n\n',encoding:'utf8',windowsHide:true});
  const fields=Object.fromEntries(raw.trim().split('\n').map(line=>{const at=line.indexOf('=');return [line.slice(0,at),line.slice(at+1)];}));
  if(!fields.password)throw Error('GitHub credential not available');
  const sha=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
  const headers={Authorization:`Bearer ${fields.password}`,Accept:'application/vnd.github+json','User-Agent':'Shahvex-deployment-check'};
  for(const suffix of [`commits/${sha}/status`,`commits/${sha}/check-runs`,'deployments?per_page=5','hooks']){
    const r=await fetch('https://api.github.com/repos/shahvexcom/Shahvex/'+suffix,{headers});
    if(!r.ok){console.log('GitHub inspection HTTP',r.status);continue;}
    const d=await r.json();
    if(Array.isArray(d)){console.log(JSON.stringify({endpoint:suffix,entries:d.map(x=>({sha:x.sha,environment:x.environment,created:x.created_at,app:x.performed_via_github_app?.slug,hook:x.name,active:x.active,events:x.events}))}));continue;}
    console.log(JSON.stringify({commit:sha.slice(0,7),state:d.state,statuses:d.statuses?.map(s=>({context:s.context,state:s.state,description:s.description,url:s.target_url})),checks:d.check_runs?.map(c=>({name:c.name,status:c.status,conclusion:c.conclusion,title:c.output?.title,summary:c.output?.summary}))}));
  }
}
main().catch(()=>{console.error('Deployment inspection failed; credentials were not printed.');process.exitCode=1;});
