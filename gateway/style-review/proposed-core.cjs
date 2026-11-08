'use strict';
// Loads ONLY a reviewed local in-memory proposal for isolated tests; never writes core.cjs.
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
function proposedSource(source){
  const replacements=[
    ["const { PhraseStream } = require('./phrase-stream.cjs');","const { PhraseStream } = require('./phrase-stream.cjs');\nconst { prepareStyleRequest } = require('./dialogue-style.cjs');"],
    ["queue = new WorkerQueue(), log = () => {} })", "queue = new WorkerQueue(), log = () => {}, stylePolicy = null })"],
    ["Object.assign(this, { stt, llm, tts, telephony, voices, maxSessions, queue, log });", "if(stylePolicy!==null&&typeof stylePolicy!=='function')throw Error('Trusted style policy resolver required');\n    Object.assign(this, { stt, llm, tts, telephony, voices, maxSessions, queue, log, stylePolicy });"],
    ["reply=await this.llm([{role:'system',content:system},...s.history,{role:'user',content:text}],pipelineSignal,timing,delta=>phrases.push(delta));", "const originalMessages=[{role:'system',content:system},...s.history,{role:'user',content:text}];\n          const messages=this.stylePolicy?prepareStyleRequest(originalMessages,this.stylePolicy(s.config)||{}).messages:originalMessages;\n          reply=await this.llm(messages,pipelineSignal,timing,delta=>phrases.push(delta));"]
  ];
  for(const [before,after] of replacements){if(source.split(before).length!==2)throw Error('Core changed; proposal needs review');source=source.replace(before,after);}return source;
}
function loadOfflineGateway(){
  const filename=path.resolve(__dirname,'../core.cjs');const local=new Module(filename,module);local.filename=filename;local.paths=Module._nodeModulePaths(path.dirname(filename));local._compile(proposedSource(fs.readFileSync(filename,'utf8')),filename);return local.exports;
}
module.exports={proposedSource,loadOfflineGateway};
