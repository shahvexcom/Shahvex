const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
test('campaign, category and assignment modals fit mobile and desktop while the page contains cards',async t=>{
 const executablePath='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
 if(!fs.existsSync(executablePath)){t.skip('Install Edge or run this layout check on the Windows development host');return;}
 const React=require('react'),renderer=require('react-dom/server');let index=0;
 let states=[[{id:'category',name:'Custom category',description:''}],[{id:'campaign',name:'Custom campaign',category_id:'category',connection_id:'connection',external_campaign_id:'CAMP01',script:'Collect name.',settings:{goal:'Collect name.'},connection_name:'Saved connection',intake_state:'STOPPED',ready_agents:0,busy_agents:0}], [{id:'agent',name:'Assigned AI',campaign_id:'campaign'}],[{id:'connection',name:'Saved connection',enabled:true}], {id:'',name:'Custom campaign',categoryId:null,connectionId:'',externalId:'CAMP01',enabled:true,script:'Collect only the configured customer details.',transferInGroup:'HUMANS',settings:{}},true];
 const hooks={...React,useState:initial=>[index<states.length?states[index++]:initial,()=>{}],useEffect:()=>{},useCallback:f=>f};
 const m={exports:{}};new Function('require','module','exports',ts.transpileModule(fs.readFileSync('app/components/campaign-manager.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText)(n=>n==='react'?hooks:n==='./toast-provider'?{ToastProvider:()=>null}:require(n),m,m.exports);
 const initial=states.slice(0,5);initial[2].push({id:'free-agent',name:'Available AI'});
 const render=mode=>{index=0;states=[...initial,mode==='campaign',{id:'',name:'',description:''},{},false,mode==='category',mode==='assignment'?'campaign':'',''];return renderer.renderToStaticMarkup(React.createElement(m.exports.CampaignManager,{portal:'admin'}));};
 const css=fs.readFileSync('app/components/voip-manager.css','utf8');
 const browser=await require('playwright').chromium.launch({executablePath,headless:true});
 try{for(const viewport of [{width:360,height:640},{width:768,height:1024},{width:1440,height:900}])for(const mode of ['campaign','category','assignment']){
  const page=await browser.newPage({viewport});await page.setContent(`<style>*{box-sizing:border-box}body{margin:0;padding:12px;font:14px Arial}${css}</style>${render(mode)}`);
  assert.equal(await page.locator('.sv-category-card').count(),1);assert.equal(await page.locator('.sv-campaign-card').count(),1);assert.equal(await page.locator('.sv-category-accordion,.sv-campaign-accordion').count(),0);
  await page.locator('dialog').evaluate(d=>d.showModal());
  const dialog=page.getByRole('dialog');assert.equal(await dialog.isVisible(),true);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`Page overflow at ${viewport.width}`);
  const box=await dialog.boundingBox();assert.ok(box.x>=0&&box.y>=0&&box.x+box.width<=viewport.width+1&&box.y+box.height<=viewport.height+1,`${mode} exceeds viewport`);
  assert.ok(await dialog.evaluate(d=>d.scrollWidth<=d.clientWidth+1),`${mode} horizontal overflow`);
  if(mode==='campaign'){const script=page.getByLabel('Full campaign script');await script.fill('Updated campaign instructions.');assert.equal(await script.inputValue(),'Updated campaign instructions.');}
  if(mode==='category'){await page.getByLabel('Category name').fill('New category');assert.equal(await page.getByLabel('Category name').inputValue(),'New category');}
  if(mode==='assignment'){await page.getByLabel('Available AI').check();assert.equal(await page.getByLabel('Available AI').isChecked(),true);}
  const footer=await dialog.locator('form>footer').boundingBox();assert.ok(footer.y+footer.height<=viewport.height+1,`${mode} footer hidden`);await page.close();
 }}finally{await browser.close();}
});
test('new VICIdial connection shows required AI media fields without agent selection or an API-only mode',async t=>{
 const executablePath='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';if(!fs.existsSync(executablePath)){t.skip('Edge is unavailable');return;}
 const React=require('react'),renderer=require('react-dom/server');let index=0;
 const hooks={...React,useEffect:()=>{},useState:initial=>{const i=index++;return [i===4?true:i===5?false:initial,()=>{}];}};
 const m={exports:{}};new Function('require','module','exports',ts.transpileModule(fs.readFileSync('app/components/voip-manager.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText)(n=>n==='react'?hooks:n==='./campaign-manager'?{CampaignManager:()=>null}:n==='./admin-skeleton'?{AdminSkeleton:()=>null}:n.endsWith('.css')?{}:require(n),m,m.exports);
 const html=renderer.renderToStaticMarkup(React.createElement(m.exports.VoipManager,{portal:'admin'})),css=fs.readFileSync('app/components/voip-manager.css','utf8');
 const browser=await require('playwright').chromium.launch({executablePath,headless:true});try{for(const viewport of [{width:360,height:640},{width:1440,height:900}]){
  const page=await browser.newPage({viewport});await page.setContent(`<style>*{box-sizing:border-box}body{margin:0;font:14px Arial}${css}</style>${html}`);
  const dialog=page.getByRole('dialog');for(const label of ['Remote agent users (comma separated)','Audio bridge URL','Human transfer in-group','Bridge shared secret'])assert.equal(await dialog.getByLabel(label).getAttribute('required'),'');
  assert.equal(await dialog.getByText('Calling agents',{exact:true}).count(),0);assert.equal(await dialog.getByText('Use VICIdial for live agent calls',{exact:true}).count(),0);assert.equal(await dialog.getByRole('button',{name:'Save connection',exact:true}).isEnabled(),true);
  const box=await dialog.boundingBox();assert.ok(box.x>=0&&box.x+box.width<=viewport.width+1);const footer=await dialog.locator('footer').boundingBox();assert.ok(footer.y+footer.height<=viewport.height);await page.close();
 }}finally{await browser.close();}
});
