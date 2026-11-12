const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),ts=require('typescript');
const mod={exports:{}};
new Function('module','exports',ts.transpileModule(fs.readFileSync('lib/agent-script-category.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(mod,mod.exports);
const {agentScriptCategory:category}=mod.exports;
test('missing and unrecognized scripts remain visible without guessed campaigns',()=>{
 for(const input of [undefined,null,'',' \n '])assert.equal(category(input),'No script assigned');
 assert.equal(category('Ask whether the customer is available to talk.'),'Uncategorized');
});
test('classifies campaign content and keeps final expense distinct from general life insurance',()=>{
 assert.equal(category('We offer final expense life insurance to cover funeral expenses.'),'Final Expense');
 assert.equal(category('Discuss term life insurance coverage.'),'Life Insurance');
 assert.equal(category('Review Medicare and Medigap options.'),'Medicare');
 assert.equal(category('Affordable Care Act marketplace coverage.'),'ACA / Health Insurance');
 assert.equal(category('Discuss solar panels and energy savings.'),'Solar');
 assert.equal(category('Book a clinic consultation for the patient.'),'Healthcare / Appointments');
 assert.equal(category('We offer life insurance. Explain the life insurance program. Ask whether the customer has Medicare.'),'Life Insurance');
});
test('explicit category wins and ambiguous campaigns are not silently assigned',()=>{
 assert.equal(category('# Category: Travel Bookings\nHelp book a flight.'),'Travel Bookings');
 assert.equal(category('Campaign category: Business Services\nProvide customer support.'),'Business Services');
 assert.equal(category('We discuss solar and Medicare.'),'Multiple campaigns');
 assert.equal(category('Explain location and available call times.'),'Uncategorized');
});
