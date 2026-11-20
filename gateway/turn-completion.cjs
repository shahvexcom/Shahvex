'use strict';
const {explicitlyEndsCall}=require('./customer-conduct.cjs');
const {isListeningSignal}=require('./conversation-resume.cjs');
function fastCompletion(value){
 const text=String(value||'').trim();
 if(!text)return {state:'empty'};
 if(explicitlyEndsCall(text))return {state:'complete'};
 if(/^(?:(?:okay|ok|well|please)[, ]*)?(?:hold on|wait a (?:second|moment|minute)|give me a (?:second|moment|minute)|let me (?:think|check|finish|explain)|I(?:'m| am) not (?:done|finished))(?: please| a bit)?[.!? ]*$/i.test(text))return {state:'wait'};
 if(/\b(?:because|although|but|and|or|if|when|unless|the|a|an|my|your|to|with|from|I (?:think|have|want|need)|what (?:is|did)|can you|do you|you are)\s*[,.!?]*$/i.test(text))return {state:'incomplete'};
 if(/^I(?:'m| am)[.!? ]*$/i.test(text))return {state:'incomplete'};
 if(isListeningSignal(text)||/^(?:(?:yes|yeah|yep)[,.! ]*)?(?:I(?:'m| am) (?:still )?(?:here|listening)|I (?:can )?hear you|I am)[.!? ]*$/i.test(text))return {state:'complete'};
 if(/^(?:no|nope|yes|yeah|yep|yup|okay|ok|hmm|hm|mm[- ]?hmm)[.!? ]*$/i.test(text))return {state:'complete'};
 if(/^(?:who are you|what is your name|why are you calling(?: me)?|where are you calling from)[.!? ]*$/i.test(text))return {state:'complete'};
 if(/^(?:(?:yes|no|well)[,. ]+)?(?:I (?:have|am)|I'm)\s+(?:medicaid|medicare|(?:part )?[ab](?: and [ab])?|\d+(?: years old)?)[.!? ]*$/i.test(text))return {state:'complete'};
 return null;
}
async function classifyCompletion(text,pending,infer){
 const fast=fastCompletion(text);if(fast)return fast;
 try{
  const value=String(await infer({text:String(text).slice(0,4000),pendingQuestion:String(pending||'').slice(0,700)})).trim().toUpperCase();
  if(value==='INCOMPLETE')return {state:'incomplete'};
  if(value==='WAIT')return {state:'wait'};
  if(value==='COMPLETE')return {state:'complete'};
 }catch{/* The recognizer may remain usable when the semantic model is unavailable. */}
 // A failure is not a prediction of the caller's intent. Use an explicit bounded extra pause.
 return {state:'uncertain'};
}
function isPresenceConfirmation(value){return /^(?:(?:yes|yeah|yep|okay|ok|sure)[,.! ]*)?(?:I(?:'m| am) (?:still )?(?:here|listening)(?: now)?|I (?:can )?hear you|I am|I can)[.!?, ]*(?:sir|ma['’]?am)?[.!?, ]*$/i.test(String(value||'').trim());}
module.exports={fastCompletion,classifyCompletion,isPresenceConfirmation};
