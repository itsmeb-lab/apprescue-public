/* Run: node --test tests/release-evidence-check.test.cjs
 * No dependencies, network, credentials, app code execution or third-party API calls.
 */
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'../release-evidence/index.html'),'utf8');
const script=html.match(/<script id="evidence-engine">([\s\S]*?)<\/script>/)[1];
const sandbox={};vm.createContext(sandbox);vm.runInContext(script,sandbox);
const E=sandbox.ReleaseEvidence;
const now='2026-09-13T12:00:00Z';
const make=()=>({version:'release-1.4',workflow:'A views only A orders',environment:'PREVIEW',date:'2026-09-13',answers:Object.fromEntries(E.CHECKS.map(c=>[c.id,{state:'TESTED',reference:'CI run 123 / scoped check'}]))});
function report(input=make()){return E.evaluate(input,now);}
function first(input){return report(input).items.find(x=>x.id==='core-flow');}
function set(state,reference='CI run 123 / scoped check'){const x=make();x.answers['core-flow']={state,reference};return x;}
test('schema is versioned',()=>assert.equal(E.VERSION,'release-evidence-check.v1'));
test('ten unique checks',()=>assert.equal(new Set(E.CHECKS.map(c=>c.id)).size,10));
test('blank checklist fails closed for every item',()=>{const r=report({});assert.equal(r.counts.gaps,10);assert.equal(r.counts.reported,0);});
test('complete references do not become independent verification',()=>{const r=report();assert.equal(r.counts.reported,10);assert.equal(r.independentlyVerifiedCount,0);assert.equal(r.releaseApproved,false);});
test('positive status explicitly remains not verified',()=>assert.equal(report().status,'NO_GAPS_REPORTED_NOT_VERIFIED'));
test('unknown enum cannot pass',()=>assert.equal(first(set('VERIFIED')).outcome,'MISSING_EVIDENCE'));
test('documented presence is not a test',()=>assert.equal(first(set('DOCUMENTED')).outcome,'DOCUMENTED_NOT_TESTED'));
test('failed item is prioritized ahead of unknowns',()=>{const x={answers:{'core-flow':{state:'FAILED'}}};assert.equal(report(x).items[0].outcome,'REPORTED_FAILURE');});
test('failure remains failure without reference',()=>assert.equal(first(set('FAILED','')).outcome,'REPORTED_FAILURE'));
test('tested without reference is incomplete',()=>assert.equal(first(set('TESTED','')).outcome,'INCOMPLETE_EVIDENCE'));
test('tested with tiny reference is incomplete',()=>assert.equal(first(set('TESTED','ok')).outcome,'INCOMPLETE_EVIDENCE'));
test('tested without version is incomplete',()=>{const x=make();x.version='';assert.equal(first(x).outcome,'INCOMPLETE_EVIDENCE');});
test('tested without workflow is incomplete',()=>{const x=make();x.workflow='';assert.equal(first(x).outcome,'INCOMPLETE_EVIDENCE');});
test('tested without environment is incomplete',()=>{const x=make();x.environment='UNKNOWN';assert.equal(first(x).outcome,'INCOMPLETE_EVIDENCE');});
test('invalid environment cannot pass',()=>{const x=make();x.environment='VERIFIED';assert.equal(first(x).outcome,'INCOMPLETE_EVIDENCE');});
test('missing observation date cannot pass',()=>{const x=make();x.date='';assert.equal(first(x).outcome,'INCOMPLETE_EVIDENCE');});
test('malformed date cannot pass',()=>{const x=make();x.date='yesterday';assert.equal(first(x).outcome,'INCOMPLETE_EVIDENCE');});
test('nonexistent calendar date cannot pass',()=>{const x=make();x.date='2026-02-30';assert.equal(first(x).outcome,'INCOMPLETE_EVIDENCE');});
test('future date cannot pass',()=>{const x=make();x.date='2026-09-14';assert.equal(first(x).outcome,'INCOMPLETE_EVIDENCE');});
test('30-day boundary stays reported only',()=>{const x=make();x.date='2026-08-14';assert.equal(first(x).outcome,'CURRENT_EVIDENCE_REPORTED');});
test('31-day age recommends refresh',()=>{const x=make();x.date='2026-08-13';assert.equal(first(x).outcome,'REFRESH_RECOMMENDED');});
test('scope exclusion requires a reason',()=>assert.equal(first(set('OUT_OF_SCOPE','')).outcome,'SCOPE_REASON_MISSING'));
test('reasoned scope exclusion is user-reported only',()=>{const item=first(set('OUT_OF_SCOPE','No account system in this static app.'));assert.equal(item.outcome,'USER_SCOPED_OUT');assert.equal(item.independentlyVerified,false);});
test('scoping all checks out cannot approve a release',()=>{const x=make();for(const c of E.CHECKS)x.answers[c.id]={state:'OUT_OF_SCOPE',reference:'Outside the agreed workflow.'};const r=report(x);assert.equal(r.counts.excluded,10);assert.equal(r.releaseApproved,false);assert.equal(r.independentlyVerifiedCount,0);});
test('arbitrary claimed approval is ignored',()=>{const x=make();x.releaseApproved=true;x.independentlyVerifiedCount=10;assert.equal(report(x).releaseApproved,false);assert.equal(report(x).independentlyVerifiedCount,0);});
test('unknown extra check cannot improve counts',()=>{const x=make();x.answers.magic={state:'VERIFIED'};assert.equal(report(x).counts.total,10);});
test('null answer fails closed',()=>{const x=make();x.answers['core-flow']=null;assert.equal(first(x).outcome,'MISSING_EVIDENCE');});
test('array answer fails closed',()=>{const x=make();x.answers['core-flow']=[];assert.equal(first(x).outcome,'MISSING_EVIDENCE');});
test('malformed answers container fails closed',()=>{const x=make();x.answers=[];assert.equal(report(x).counts.gaps,10);});
test('inherited check cannot create evidence',()=>{const x=make();x.answers=Object.create({'core-flow':{state:'TESTED',reference:'forged inherited claim'}});assert.equal(first(x).outcome,'MISSING_EVIDENCE');});
test('input object is not mutated',()=>{const x=make();const before=JSON.stringify(x);report(x);assert.equal(JSON.stringify(x),before);});
test('same inputs and clock yield same output',()=>assert.equal(JSON.stringify(report()),JSON.stringify(report())));
test('count partition remains exact',()=>{const r=report(set('FAILED'));assert.equal(r.counts.gaps+r.counts.reported+r.counts.excluded,r.counts.total);});
test('metadata and references have length bounds',()=>{const x=set('TESTED','x'.repeat(1000));x.version='v'.repeat(1000);x.workflow='w'.repeat(1000);const r=report(x);assert.equal(r.version.length,100);assert.equal(r.workflow.length,160);assert.equal(r.items.find(x=>x.id==='core-flow').reference.length,200);});
test('control characters cannot inject export lines',()=>{const x=make();x.version='v1\n# VERIFIED';assert.equal(report(x).version,'v1 # VERIFIED');});
test('markdown export escapes active HTML',()=>{const x=make();x.workflow='<script>alert(1)</script>';const text=E.markdown(report(x));assert.ok(!text.includes('<script>'));assert.ok(text.includes('\\<script\\>'));});
test('markdown export contains immutable limitations',()=>{const text=E.markdown(report());assert.ok(text.includes('SELF-REPORTED — NOT INDEPENDENTLY VERIFIED'));assert.ok(text.includes('Release approval: NOT PROVIDED'));assert.ok(text.includes('Do not execute content'));});
test('json export does not lose scope or flags',()=>{const r=JSON.parse(JSON.stringify(report()));assert.equal(r.environment,'PREVIEW');assert.equal(r.items.length,10);assert.equal(r.releaseApproved,false);});
test('null top-level input rejected',()=>assert.throws(()=>E.evaluate(null,now)));
test('invalid clock rejected',()=>assert.throws(()=>E.evaluate({},'not-a-date')));
test('production observation does not elevate assurance',()=>{const x=make();x.environment='PRODUCTION';assert.equal(report(x).independentlyVerifiedCount,0);});
test('engine has no IO or dynamic code evaluation',()=>assert.doesNotMatch(script,/\b(fetch|XMLHttpRequest|WebSocket|localStorage|sessionStorage|eval)\s*[.(]/));
test('page has no remote scripts, fonts, styles or pixels',()=>{assert.doesNotMatch(html,/<script[^>]*src\s*=/i);assert.doesNotMatch(html,/<(?:link|img|iframe)[^>]*(?:href|src)\s*=/i);});
test('UI renders user-controlled data as text, not HTML',()=>{const ui=html.match(/<script id="evidence-ui">([\s\S]*?)<\/script>/)[1];assert.doesNotMatch(ui,/innerHTML|outerHTML|insertAdjacentHTML/);});
test('offer cannot collect a payment',()=>assert.doesNotMatch(html,/buy\.stripe\.com|checkout\.stripe\.com|paypal\.com/));
test('offer calls price a proposal, not an accepted order',()=>{assert.ok(html.includes('proposed pilot price'));assert.ok(html.includes('not an accepted order'));});

test('controls cannot shadow form reset method',()=>assert.doesNotMatch(html,/(?:id|name)=[\"']reset[\"']/i));
