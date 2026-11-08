'use strict';
const fs=require('node:fs'),path=require('node:path');const {probe}=require('./transport-probe.cjs');const {phrases}=require('./native-ab.cjs');
async function main(){
  if(!process.argv.includes('--quiet-window-approved'))throw Error('Explicit confirmed maintenance/quiet-window approval required');
  const source=fs.readFileSync('C:\\Shahvex-AI\\integration-gateway\\phrase-stream.cjs','utf8');
  const text=phrases(source,require('./native-ab-fixtures.json')[1],40)[0];if(text.length!==74)throw Error('Previously failing phrase differs');
  const id='once-'+Date.now();
  const result=await probe('http://127.0.0.1:8765/synthesize',{body:Buffer.from(JSON.stringify({text})),id,timeoutMs:60000});
  const folder=path.resolve('.env.native-transport');fs.mkdirSync(folder,{recursive:true,mode:0o700});
  fs.writeFileSync(path.join(folder,id+'.json'),JSON.stringify(result,null,2),{flag:'wx',mode:0o600});console.log(JSON.stringify(result));
}
if(require.main===module)main().catch(error=>{console.error(JSON.stringify({failed:true,errorType:error.name}));process.exitCode=1;});
