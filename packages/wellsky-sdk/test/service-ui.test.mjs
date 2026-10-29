import test from 'node:test';
import assert from 'node:assert/strict';
import {createServiceUi} from '../browser/service-ui.mjs';
test('fund verification compares persisted source and cycle identity',()=>{
 const ui=createServiceUi({page:{url:()=>'https://wscs.wellsky.com/synthetic/com.bowmansystems.sp5.core.ServicePoint/index.html'}}),fund={fundId:28,fundCycleId:28,name:'SSVF - RRH',amount:925};
 const snapshot={needStatus:'Closed',needOutcome:'Fully Met',fundingSources:[fund]};
 assert.equal(ui.matches(snapshot,{fundingSources:[fund]}),true);
 assert.equal(ui.matches(snapshot,{fundingSources:[{...fund,fundCycleId:29}]}),false);
 assert.equal(ui.matches(snapshot,{fundingSources:[{...fund,fundId:29}]}),false);
 assert.equal(ui.matches({...snapshot,needOutcome:''},{fundingSources:[fund]}),false);
});
