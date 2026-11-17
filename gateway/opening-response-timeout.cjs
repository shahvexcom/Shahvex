'use strict';
/** Independent first-response deadline: metadata, recognition and SSE cleanup cannot suspend it. */
class OpeningResponseTimeout {
 constructor(limitMs=8000){this.limitMs=limitMs;this.lastOpeningAudio=undefined;this.lastVoice=undefined;this.responded=false;}
 output(now){this.lastOpeningAudio=now;}
 voice(now){this.lastVoice=now;}
 response(){this.responded=true;}
 tick(now,paused=false){
  if(this.responded||this.lastOpeningAudio===undefined)return false;
  if(paused){this.lastVoice=now;return false;}
  return now-Math.max(this.lastOpeningAudio,this.lastVoice??this.lastOpeningAudio)>=this.limitMs;
 }
}
module.exports={OpeningResponseTimeout};
