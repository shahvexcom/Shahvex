const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),ts=require('typescript');
function load(file,deps){const mod={exports:{}};const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;new Function('require','module','exports',code)(name=>Object.hasOwn(deps,name)?deps[name]:require(name),mod,mod.exports);return mod.exports;}
test('dashboard initial HTML is stable across server/client calendar-day differences',()=>{
  const React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
  const {DashboardAnalytics}=load('app/components/dashboard-analytics.tsx',{'./dashboard-polish.css':{},'./export-menu':{ExportMenu:()=>null},'@/lib/agent-report-export':{}});
  const OriginalDate=global.Date;
  const render=day=>{global.Date=class extends OriginalDate{constructor(...args){super(...(args.length?args:[day]));}};return renderToStaticMarkup(React.createElement(DashboardAnalytics,{onAction:()=>{}}));};
  try{assert.equal(render('2026-11-09T12:00:00Z'),render('2026-11-10T12:00:00Z'));}finally{global.Date=OriginalDate;}
});
test('authenticated profile read avoids schema DDL but preserves real DB failures',async()=>{
  let authenticated=true,fail=false,dbCalls=0;
  const route=load('app/api/auth/me/route.ts',{
    'next/headers':{cookies:async()=>({get:()=>({value:'fixture'})})},
    '@/lib/session':{ADMIN_SESSION_COOKIE:'admin',readSession:async()=>authenticated?{agentId:'admin',role:'ADMIN'}:null},
    '@/lib/regular-agent':{},
    '@/lib/database':{db:async options=>{dbCalls++;assert.deepEqual(options,{ensureSchema:false});return{query:async()=>{if(fail)throw Error('DB unavailable');return{rows:[{name:'Admin'}]};}};}},
  });
  const request=()=>new Request('http://localhost/api/auth/me?portal=admin');
  assert.equal((await route.GET(request())).status,200);
  fail=true;assert.equal((await route.GET(request())).status,503);
  authenticated=false;assert.equal((await route.GET(request())).status,401);assert.equal(dbCalls,2);
});
