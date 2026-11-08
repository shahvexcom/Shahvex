import "server-only";
import { execFile } from "node:child_process";
import path from "node:path";
export function issueLocalIdleProof(snapshot: object): Promise<object> {
  if(process.platform!=='win32')return Promise.reject(Error('Windows local proof issuer required'));
  return new Promise((resolve,reject)=>{
    const child=execFile('powershell.exe',['-NoProfile','-File',path.join(process.cwd(),'deployment','IdleProof.ps1'),'-Action','Issue'],{windowsHide:true,timeout:10000,maxBuffer:8192},(error,stdout)=>{
      if(error){reject(Error('Proof refused: run the approved Deploy command first and ensure maintenance is drained'));return;}
      try{resolve(JSON.parse(stdout.replace(/^\uFEFF/,'')));}catch{reject(Error('Invalid proof issuer response'));}
    });
    child.stdin?.end(JSON.stringify(snapshot));
  });
}
