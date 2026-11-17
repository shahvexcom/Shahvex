'use strict';
const fs=require('node:fs'),path=require('node:path');
function waveHeader(bytes){
  const header=Buffer.alloc(44);header.write('RIFF');header.writeUInt32LE(36+bytes,4);header.write('WAVEfmt ',8);header.writeUInt32LE(16,16);header.writeUInt16LE(1,20);header.writeUInt16LE(2,22);header.writeUInt32LE(8000,24);header.writeUInt32LE(32000,28);header.writeUInt16LE(4,32);header.writeUInt16LE(16,34);header.write('data',36);header.writeUInt32LE(bytes,40);return header;
}
function createAiRecording(directory,id){
  if(!/^[a-f0-9-]{36}$/.test(id))throw Error('Invalid recording ID');
  fs.mkdirSync(directory,{recursive:true});
  const temporary=path.join(directory,`${id}.part`),file=path.join(directory,`${id}.wav`);
  const fd=fs.openSync(temporary,'wx',0o600);fs.writeSync(fd,Buffer.alloc(44));let bytes=0,closed=false,paused=false,ready=false;
  const snapshot=()=>{fs.writeSync(fd,waveHeader(bytes),0,44,0);fs.fsyncSync(fd);const next=file+'.next';fs.copyFileSync(temporary,next);fs.renameSync(next,file);ready=true;return {id,bytes:bytes+44};};
  return {get active(){return !closed&&!paused;},get ready(){return ready;},pause(){if(closed)throw Error('Recording has ended');paused=true;return snapshot();},resume(){if(closed)throw Error('Recording has ended');paused=false;},frame(input,output){
    if(closed||paused)return;if(bytes>=1000000000)throw Error('AI recording size limit reached');
    const stereo=Buffer.alloc(640);
    for(let i=0;i<160;i++){if(i*2+2<=input.length)stereo.writeInt16LE(input.readInt16LE(i*2),i*4);if(i*2+2<=output.length)stereo.writeInt16LE(output.readInt16LE(i*2),i*4+2);}
    fs.writeSync(fd,stereo);bytes+=stereo.length;
  },finish(){
    if(closed)return null;closed=true;
    const header=waveHeader(bytes);
    fs.writeSync(fd,header,0,44,0);fs.fsyncSync(fd);fs.closeSync(fd);fs.renameSync(temporary,file);
    return {id,file,bytes:bytes+44};
  }};
}
function recoverAiRecording(directory,id){
  if(!/^[a-f0-9-]{36}$/.test(id))throw Error('Invalid recording ID');
  const file=path.join(directory,`${id}.wav`),temporary=path.join(directory,`${id}.part`);
  if(fs.existsSync(file)&&!fs.existsSync(temporary))return {id,file,bytes:fs.statSync(file).size};
  if(!fs.existsSync(temporary))return null;
  const bytes=Math.max(0,Math.floor((fs.statSync(temporary).size-44)/640)*640),fd=fs.openSync(temporary,'r+');
  try{fs.ftruncateSync(fd,bytes+44);fs.writeSync(fd,waveHeader(bytes),0,44,0);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  fs.renameSync(temporary,file);return {id,file,bytes:bytes+44};
}
module.exports={createAiRecording,recoverAiRecording};
