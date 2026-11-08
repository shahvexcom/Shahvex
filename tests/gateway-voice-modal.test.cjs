const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const ts=require('typescript');
const React=require('react');
function component(){
  const states=[true,'Disconnected',true,true,true,false,false,0,'','Assigned text','Assigned text',true,'Assigned Script',false,false,0,'','webm','',0];
  const refs=[];
  const hooks={...React,useEffect:()=>{},useState:()=>[states.shift(),()=>{}],useRef:value=>{const ref={current:value};refs.push(ref);return ref;}};
  const code=ts.transpileModule(fs.readFileSync('app/components/local-agent-voice-test.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  const mod={exports:{}};
  new Function('require','module','exports',code)(name=>name==='react'?hooks:name==='react-dom'?{createPortal:child=>child}:name==='@/lib/browser-conversation-recorder'?{}:name.endsWith('.css')?{}:require(name),mod,mod.exports);
  return mod.exports.LocalAgentVoiceTest({agentId:'jennifer',agentName:'Jennifer',avatarUrl:'/existing-avatar.png'});
}
function all(tree){if(!tree||typeof tree!=='object')return [];if(Array.isArray(tree))return tree.flatMap(all);return [tree,...all(tree.props?.children)];}
test('modal has accessible dialog, actual agent avatar, start/close/mute controls and no fabricated transcript',()=>{
  const prior=global.document;global.document={body:{}};
  try{
    const nodes=all(component());
    assert.ok(nodes.some(n=>n.props?.role==='dialog'&&String(n.props['aria-modal'])==='true'));
    assert.ok(nodes.some(n=>n.type==='img'&&n.props.src==='/existing-avatar.png'));
    assert.ok(nodes.some(n=>n.props?.['aria-label']==='Close conversation'));
    assert.ok(nodes.some(n=>n.props?.['aria-label']==='Mute microphone'&&n.props.disabled));
    assert.ok(nodes.some(n=>Array.isArray(n.props?.children)&&n.props.children.includes('Start Conversation')));
    assert.ok(nodes.some(n=>typeof n.props?.children==='string'&&n.props.children.includes('unavailable from the current Gateway')));
  }finally{global.document=prior;}
});
test('closing during microphone permission releases late tracks and never creates a session',async()=>{
  const prior={document:global.document,AudioContext:global.AudioContext,navigator:Object.getOwnPropertyDescriptor(global,'navigator')};
  let grant,closed=0,stopped=0;
  global.document={body:{}};
  const priorWindow=global.window;global.window={};
  global.requestAnimationFrame=()=>0;global.cancelAnimationFrame=()=>{};
  global.AudioContext=class{sampleRate=16000;resume(){return Promise.resolve();}createMediaStreamDestination(){return {stream:{}};}createAnalyser(){return {connect(){},fftSize:256};}close(){closed++;return Promise.resolve();}};
  Object.defineProperty(global,'navigator',{configurable:true,value:{mediaDevices:{getUserMedia:()=>new Promise(r=>{grant=r;})}}});
  try{
    const nodes=all(component());
    const start=nodes.find(n=>n.type==='button'&&Array.isArray(n.props.children)&&n.props.children.includes('Start Conversation'));
    start.props.onClick();await Promise.resolve();await Promise.resolve();
    nodes.find(n=>n.props?.['aria-label']==='Close conversation').props.onClick();
    grant({getTracks:()=>[{stop:()=>stopped++}]});await new Promise(r=>setImmediate(r));
    assert.equal(closed,1);assert.equal(stopped,1);
  }finally{global.window=priorWindow;global.document=prior.document;global.AudioContext=prior.AudioContext;if(prior.navigator)Object.defineProperty(global,'navigator',prior.navigator);else delete global.navigator;}
});
