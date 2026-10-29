// Reproduced in a sandbox tenant on 2026-10-23. See SSVF.md for evidence and scope.
const serviceTypes=[
  "Outreach services",
  "Case management services",
  "Assistance obtaining VA benefits",
  "Assistance obtaining/coordinating other public benefits",
  "Direct provision of other public benefits",
  "Other (non-TFA) supportive service approved by VA",
  "Shallow Subsidy",
  "Returning Home",
  "Rapid Resolution",
  "Healthcare Navigation"
];
const financialAssistanceTypes=[
  "Rental assistance",
  "Utility fee payment assistance",
  "Security deposit",
  "Utility deposit",
  "Moving costs",
  "Transportation services: tokens/vouchers",
  "Transportation services: vehicle repair/maintenance",
  "Child Care",
  "General housing stability assistance",
  "Emergency housing assistance",
  "Shallow subsidy financial assistance",
  "Food assistance",
  "Landlord incentive",
  "Tenant incentive"
];
const dependents=[
  {
    "key": "ifObtainingVaAssistanceBenefits",
    "label": "If \"Assistance obtaining VA benefits\"",
    "serviceType": "Assistance obtaining VA benefits",
    "control": "select",
    "required": false,
    "options": [
      "VA vocational and rehabilitation counseling",
      "Employment and training services",
      "Educational assistance",
      "Health care services"
    ]
  },
  {
    "key": "ifObtainingCoordinatingOtherPublicBenefits",
    "label": "If \"Assistance obtaining/coordinating other public benefits\"",
    "serviceType": "Assistance obtaining/coordinating other public benefits",
    "control": "select",
    "required": false,
    "options": [
      "Health care services",
      "Daily living services",
      "Personal financial planning services",
      "Transportation services",
      "Income support services",
      "Fiduciary and representative payee services",
      "Legal services - child support",
      "Legal services - eviction prevention",
      "Legal services - outstanding fines and penalties",
      "Legal services - restore/acquire driver's license",
      "Legal services - other",
      "Child care",
      "Housing counseling"
    ]
  },
  {
    "key": "ifDirectProvisionOfOtherPublicBenefits",
    "label": "If \"Direct provision of other public benefits\"",
    "serviceType": "Direct provision of other public benefits",
    "control": "select",
    "required": false,
    "options": [
      "Personal financial planning services",
      "Transportation services",
      "Income support services",
      "Fiduciary and representative payee services",
      "Legal services - child support",
      "Legal services - eviction prevention",
      "Legal services - outstanding fines and penalties",
      "Legal services - restore/acquire driver's license",
      "Legal services - other",
      "Child care",
      "Housing counseling"
    ]
  },
  {
    "key": "ifOtherNonTfaSupportiveServiceApprovedByVa",
    "label": "If \"Other(Non-TFA) Supportive Service approved by VA\"",
    "serviceType": "Other (non-TFA) supportive service approved by VA",
    "control": "text",
    "required": false,
    "maxLength": 100
  }
];

/** Verified form contract, not a live provider configuration query.
 * Return a copy so callers cannot mutate validation rules. Required means UI-required. */
export function getSsvfServiceRules({typeOfSsvfService,ssvfFinancialAssistanceType}={}) {
  if(typeOfSsvfService!==undefined&&!serviceTypes.includes(typeOfSsvfService))throw Error('Unknown Type of SSVF Service');
  if(ssvfFinancialAssistanceType!==undefined&&!financialAssistanceTypes.includes(ssvfFinancialAssistanceType))throw Error('Unknown SSVF Financial Assistance Type');
  return structuredClone({verifiedOn:'2026-10-23',serviceTypes,financialAssistanceTypes,fields:[
    {key:'typeOfSsvfService',label:'Type of SSVF Service',control:'select',visible:true,required:false,options:serviceTypes,transport:'rest'},
    ...dependents.map(({serviceType,...field})=>({...field,visible:serviceType===typeOfSsvfService,visibleWhen:{typeOfSsvfService:serviceType},transport:'rest'})),
    {key:'ssvfFinancialAssistanceType',label:'SSVF Financial Assistance Type',control:'select',visible:true,required:false,options:financialAssistanceTypes,transport:'rest'},
    ...['start','end'].map(part=>({key:`financialAssistancePeriod.${part}`,label:`SSVF Financial Assistance ${part==='start'?'Start':'End'} Date`,control:'datetime',visible:ssvfFinancialAssistanceType!==undefined,required:ssvfFinancialAssistanceType!==undefined,transport:'ui'})),
    {key:'ssvfFinancialAssistanceAmount',label:'SSVF Financial Assistance Amount',control:'money',visible:true,required:false,transport:'rest'},
  ]});
}

/** Reject stale hidden answers and invalid picklist values before any row is reserved. */
export function validateSsvfInformation(info,period) {
  if(info===undefined){if(period)throw Error('SSVF assistance period requires a financial assistance type');return;}
  if(!info||typeof info!=='object'||Array.isArray(info))throw Error('SSVF information must be an object');
  const rules=getSsvfServiceRules(info),fields=rules.fields.filter(f=>f.transport==='rest');
  for(const [key,value] of Object.entries(info)){
    const field=fields.find(f=>f.key===key);
    if(!field)throw Error(`Unsupported SSVF field: ${key}`);
    if(!field.visible)throw Error(`${field.label} is not applicable to ${info.typeOfSsvfService??'an unspecified service type'}`);
    if(field.options&&!field.options.includes(value))throw Error(`Invalid ${field.label}`);
    if(field.control==='text'&&(typeof value!=='string'||!value.trim()||value.length>field.maxLength))throw Error(`${field.label} must contain 1-${field.maxLength} characters`);
    if(field.control==='money'&&(typeof value!=='number'||!Number.isFinite(value)||value<0||value>1e9||Math.abs(value*100-Math.round(value*100))>=1e-6))throw Error(`Invalid ${field.label}`);
  }
  if(info.ssvfFinancialAssistanceType&&!period)throw Error('SSVF Financial Assistance Start Date and End Date are required when a financial assistance type is selected');
  if(period&&!info.ssvfFinancialAssistanceType)throw Error('SSVF assistance period requires a financial assistance type');
}

/** Read only visible controls, including text boxes whose labels use aria-labelledby. */
export async function readSsvfInformation(page) {
  const fields=getSsvfServiceRules().fields.filter(f=>f.transport==='rest');
  return page.evaluate(fields=>{
    const values={};
    for(const field of fields){
      const matches=[...document.querySelectorAll('input,select,textarea')].filter(e=>{
        const owner=e.closest('[aria-label],[aria-labelledby]');
        const label=owner?.getAttribute('aria-label')??owner?.getAttribute('aria-labelledby')?.split(/\s+/).map(id=>document.getElementById(id)?.textContent).join(' ').trim();
        return e.getClientRects().length&&label===field.label;
      });
      if(matches.length>1)throw Error('Ambiguous SSVF control');
      if(!matches.length)continue;
      const value=matches[0].value;
      if(value&&value!=='-Select-')values[field.key]=field.control==='money'?Number(value.replace(/,/g,'')):value;
    }
    return values;
  },fields);
}
