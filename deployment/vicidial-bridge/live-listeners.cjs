'use strict';
// A receive-only copy of the 20 ms customer/agent frames. Never touches the call socket.
function stereoFrame(input,output){const frame=Buffer.alloc(640);for(let i=0;i<160;i++){if(i*2+2<=input.length)frame.writeInt16LE(input.readInt16LE(i*2),i*4);if(i*2+2<=output.length)frame.writeInt16LE(output.readInt16LE(i*2),i*4+2);}return frame;}
function publish(c,input,output){if(!c.listeners?.size)return;const frame=stereoFrame(input,output);for(const res of c.listeners){try{if(res.destroyed||res.writableLength>16000){c.listeners.delete(res);res.destroy();continue;}res.write(frame);}catch{c.listeners.delete(res);res.destroy();}}}
function closeListeners(c){for(const res of c.listeners||[])res.end();c.listeners?.clear();}
module.exports={publish,closeListeners,stereoFrame};
