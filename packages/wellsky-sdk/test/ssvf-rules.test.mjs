import test from 'node:test';
import assert from 'node:assert/strict';
import {getSsvfServiceRules,validateSsvfInformation,readSsvfInformation} from '../browser/ssvf-rules.mjs';
import {createServiceRecorder} from '../browser/service-recording.mjs';
import {createServiceUi} from '../browser/service-ui.mjs';

const financial={ssvfFinancialAssistanceType:'Rental assistance'};
const period={start:'2026-10-20T16:00:00Z',end:'2026-10-23T16:00:00Z'};
test('SSVF catalog separates four optional service dependencies from fourteen required financial periods',()=>{
 const baseline=getSsvfServiceRules();assert.equal(baseline.serviceTypes.length,10);assert.equal(baseline.financialAssistanceTypes.length,14);
 for(const typeOfSsvfService of baseline.serviceTypes){
  const rules=getSsvfServiceRules({typeOfSsvfService});
  const children=rules.fields.filter(f=>f.visibleWhen&&f.visible);
  assert.equal(children.length,/^(Assistance |Direct |Other )/.test(typeOfSsvfService)?1:0);
  assert.ok(children.every(c=>!c.required));
  validateSsvfInformation({typeOfSsvfService});
  for(const field of children){
   const value=field.options?.[0]??'Synthetic VA-approved service';
   validateSsvfInformation({typeOfSsvfService,[field.key]:value});
   assert.throws(()=>validateSsvfInformation({typeOfSsvfService:'Outreach services',[field.key]:value}),/not applicable/);
  }
 }
 for(const ssvfFinancialAssistanceType of baseline.financialAssistanceTypes){
  const rules=getSsvfServiceRules({ssvfFinancialAssistanceType});
  assert.equal(rules.fields.filter(f=>f.required).length,2);
  assert.throws(()=>validateSsvfInformation({ssvfFinancialAssistanceType}),/Start Date and End Date/);
  validateSsvfInformation({ssvfFinancialAssistanceType},period);
 }
 assert.equal(baseline.fields.filter(f=>f.required).length,0);
 baseline.serviceTypes.length=0;assert.equal(getSsvfServiceRules().serviceTypes.length,10);
});
test('reject unknown, null, inactive and oversized answers without normalizing away the error',()=>{
 for(const info of [{typeOfSsvfService:'unknown'},{typeOfSsvfService:null},{typeOfSsvfService:'Assistance obtaining VA benefits',ifObtainingVaAssistanceBenefits:'invalid'},
  {typeOfSsvfService:'Other (non-TFA) supportive service approved by VA',ifOtherNonTfaSupportiveServiceApprovedByVa:'x'.repeat(101)},
  {typeOfSsvfService:'Other (non-TFA) supportive service approved by VA',ifOtherNonTfaSupportiveServiceApprovedByVa:' '},
  {ssvfFinancialAssistanceAmount:1.001},{ssvfFinancialAssistanceAmount:null},{unknown:'field'}])assert.throws(()=>validateSsvfInformation(info));
 assert.throws(()=>validateSsvfInformation(undefined,period));
 assert.throws(()=>validateSsvfInformation({typeOfSsvfService:'Shallow Subsidy'},period));
 validateSsvfInformation({...financial,ssvfFinancialAssistanceAmount:0},period);
});
test('all bulk rows are checked before even opening the UI or reserving a journal',async()=>{
 let calls=0;const fail=()=>{calls++;throw Error('Unexpected side effect');};
 const recorder=createServiceRecorder({api:{tenant:'tenant-b'},ui:{assertReady:fail},store:{withLock:fail}});
 const body={clientId:1,serviceProvider:2,serviceCode:'BH-3800.7000',serviceStartDate:'2026-10-22T16:00:00Z',serviceEndDate:'2026-10-22T16:00:00Z'};
 const first={key:'first',body};
 for(const second of [{key:'bad',body:{...body,ssvfInformation:financial}},
  {key:'bad',body:{...body,ssvfInformation:{typeOfSsvfService:'Outreach services',ifObtainingVaAssistanceBenefits:'Health care services'}}}])await assert.rejects(recorder.recordBulk([first,second]));
 assert.equal(calls,0);
});
test('UI verification must prove the requested SSVF subtype and explanation',()=>{
 const ui=createServiceUi({page:{url:()=>'https://wscs.wellsky.com/synthetic/com.bowmansystems.sp5.core.ServicePoint/index.html'}}),ssvfInformation={typeOfSsvfService:'Assistance obtaining VA benefits',ifObtainingVaAssistanceBenefits:'Health care services'};
 const expected={fundingSources:[],ssvfInformation},snapshot={needStatus:'Closed',needOutcome:'Fully Met',fundingSources:[],ssvfInformation};
 assert.equal(ui.matches(snapshot,expected),true);
 assert.equal(ui.matches({...snapshot,ssvfInformation:{typeOfSsvfService:'Assistance obtaining VA benefits'}},expected),false);
 assert.equal(ui.matches({...snapshot,ssvfInformation:{...ssvfInformation,ifObtainingVaAssistanceBenefits:'Educational assistance'}},expected),false);
});

test('real DOM reads inherited amount label and ignores hidden stale branches',{skip:!process.env.WELLSKY_TEST_CHROME},async()=>{
 const {chromium}=await import('playwright-core');
 const browser=await chromium.launch({headless:true,executablePath:process.env.WELLSKY_TEST_CHROME});
 try{
  const page=await browser.newPage();
  await page.setContent(`<select aria-label="Type of SSVF Service"><option>Other (non-TFA) supportive service approved by VA</option></select>
    <div id="other">If "Other(Non-TFA) Supportive Service approved by VA"</div><input aria-labelledby="other" value="Synthetic assistance">
    <div style="display:none"><select aria-label='If "Assistance obtaining VA benefits"'><option>Health care services</option></select></div>
    <div id="amount">SSVF Financial Assistance Amount</div><table aria-labelledby="amount"><tr><td>$</td><td><input value="1,250.00"></td></tr></table>`);
  assert.deepEqual(await readSsvfInformation(page),{typeOfSsvfService:'Other (non-TFA) supportive service approved by VA',ifOtherNonTfaSupportiveServiceApprovedByVa:'Synthetic assistance',ssvfFinancialAssistanceAmount:1250});
 }finally{await browser.close();}
});
