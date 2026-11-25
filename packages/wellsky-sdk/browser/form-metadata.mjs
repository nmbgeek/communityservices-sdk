import {buildAssessmentDefinition, configuredAssessmentQuestions, createCatalogWriteLabelResolver, flattenQuestions} from '../dist/esm/index.js';

// The browser only exposes the currently published defaults and labels. Older
// revisions can be read from a captured snapshot, never populated from today's UI.
export function createFormMetadataCache({config, api, discovery, enrollmentSession, writeLabel, tenantScope, locationsByType, hash, date, fail}) {
  const {store, revisions} = config;
  if (!store || !['read','write','withLock'].every(method => typeof store[method] === 'function') ||
      !Array.isArray(revisions) || !revisions.length) throw new TypeError('Metadata store and dated form revisions required');
  const periods = revisions.map(({id, effectiveFrom}) => {
    if (typeof id !== 'string' || !id.trim()) throw new TypeError('Form revision ID required');
    return {id, start:date(effectiveFrom)};
  }).sort((a,b) => a.start.localeCompare(b.start));
  for (const field of ['id','start']) {
    if (new Set(periods.map(period => period[field])).size !== periods.length) throw new TypeError('Form revisions require distinct IDs and effective dates');
  }
  const automaticLabels = !writeLabel && typeof enrollmentSession?.readPicklistOptions === 'function';
  function select(input) {
    const at = date(input.entryDate);
    const period = periods.findLast(item => item.start <= at);
    if (!period) fail('no form revision covers the requested date', {code:'FORM_REVISION_UNAVAILABLE'});
    const locations = locationsByType[input.type];
    if (!Number.isSafeInteger(input.providerId) || input.providerId <= 0 || !locations) throw new TypeError('Configured provider and Entry/Exit type required');
    const scope = JSON.stringify(['enrollment-form-metadata-v1',tenantScope,discovery.connection?.scope,
      enrollmentSession?.connection?.scope,input.providerId,input.type,hash(locations),period.id,period.start,automaticLabels]);
    return {scope, period, locations, at};
  }
  async function defaults(providerId, locations) {
    const config = await discovery.getProviderAssessments({providerId});
    if (config.providerId !== providerId) fail('provider discovery mismatch');
    const selected = {};
    for (const [phase, location] of Object.entries(locations)) {
      const matches = config.defaults.filter(item => item.location === location);
      if (matches.length === 1 && matches[0].resolution === 'resolved' && matches[0].assessment?.code) {
        const {assessmentId,code,name,assignedToAssessmentTab} = matches[0].assessment;
        selected[phase] = {assessmentId,code,name,assignedToAssessmentTab};
      }
    }
    return selected;
  }
  async function readSources(input, assessment, effectiveDate) {
    const path = {clientId:input.clientId, assessmentCode:assessment.code};
    const [mobile, generic] = await Promise.all([api.assessmentsMobile.getAnswers({path}), api.assessments.get({path,query:{dateEffective:effectiveDate}})]);
    return {tenant:api.tenant, assessmentCode:assessment.code, effectiveDate, mobile, generic};
  }
  async function readForm(input, assessment, effectiveDate) {
    const sources = await readSources(input, assessment, effectiveDate);
    const definition = buildAssessmentDefinition({...sources, configuredOnly:true});
    if (definition.unresolvedPicklists.length) fail('assessment metadata incomplete');
    return {assessment,definition,genericSchema:genericFormHash(sources.generic,hash)};
  }
  async function readLabels(clientId, forms) {
    const ids = new Set();
    for (const {definition} of forms) {
      for (const {question} of flattenQuestions(definition.questions)) {
        if (question.questionType === 'lookup') for (const option of question.options) ids.add(option.id);
      }
    }
    if (!automaticLabels || !ids.size) return [];
    const catalog = await enrollmentSession.readPicklistOptions({clientId,optionIds:[...ids]});
    if (catalog?.clientId !== clientId || catalog.source !== 'gwt-rpc') fail('picklist catalog client mismatch', {code:'PICKLIST_CATALOG_CONTEXT_MISMATCH'});
    for (const {definition} of forms) createCatalogWriteLabelResolver(definition,catalog);
    return catalog.values.filter(row => ids.has(row.optionId)).map(({optionId,picklistId,code,name}) => ({optionId,picklistId,code,name}));
  }
  async function resolve(input, phases, refreshPhase) {
    const {scope,period,locations,at} = select(input);
    return store.withLock(scope, async () => {
      const records = await store.read(scope);
      if (!Array.isArray(records) || records.length > 1 || records.length && records[0]?.checksum !== hash([scope,records[0]?.data])) throw new Error('Invalid form metadata store record');
      let data = structuredClone(records[0]?.data);
      const fill = !data || refreshPhase || phases.some(phase => !data.forms[phase]);
      if (fill) {
        if (period !== periods.findLast(item => item.start <= new Date().toISOString())) fail('no captured definition for this form revision', {code:'FORM_REVISION_UNAVAILABLE'});
        const needsDefaults = !data || refreshPhase || phases.some(phase => !data.defaults[phase]);
        const selected = needsDefaults ? await defaults(input.providerId, locations) : data.defaults;
        const forms = {...data?.forms};
        const formKey = assessment => JSON.stringify([assessment.assessmentId,assessment.code]);
        const refreshedKey = selected[refreshPhase] && formKey(selected[refreshPhase]);
        for (const phase of Object.keys(forms)) {
          if (refreshPhase === 'all' || formKey(forms[phase].assessment) === refreshedKey || hash(forms[phase].assessment) !== hash(selected[phase] ?? null)) delete forms[phase];
        }
        const fetched = [];
        const byForm = new Map(Object.values(forms).map(form => [formKey(form.assessment),form]));
        for (const phase of phases) {
          if (!selected[phase]) fail('program assessment default unresolved');
          if (!forms[phase]) {
            const key = formKey(selected[phase]);
            let form = byForm.get(key);
            if (!form) {
              form = await readForm(input, selected[phase], at);
              byForm.set(key,form);
              fetched.push(form);
            }
            forms[phase] = {...form,assessment:selected[phase]};
          }
        }
        const labels = new Map((data?.labels ?? []).map(row => [row.optionId,row]));
        for (const row of await readLabels(input.clientId,fetched)) labels.set(row.optionId,row);
        const used = new Set(Object.values(forms).flatMap(form => flattenQuestions(form.definition.questions).flatMap(({question}) => question.options.map(option => option.id))));
        data = {defaults:selected, forms, labels:[...labels.values()].filter(row => used.has(row.optionId)).sort((a,b) => a.optionId-b.optionId)};
      }
      const result = {formRevision:period.id}, signature = [], usedIds = new Set();
      for (const phase of phases) {
        const {assessment,definition,genericSchema} = data.forms[phase];
        result[phase] = {assessment,genericSchema,definition:{...definition,effectiveDate:at}};
        for (const {question} of flattenQuestions(definition.questions)) for (const option of question.options) usedIds.add(option.id);
        const override = writeLabel && flattenQuestions(definition.questions).filter(({question}) => question.questionType === 'lookup')
          .flatMap(({question}) => question.options.map(option => writeLabel(question,option) ?? null));
        signature.push([phase,assessment,definition.questions,override]);
      }
      if (automaticLabels) {
        const values = data.labels.filter(row => usedIds.has(row.optionId));
        result.writeLabels = {source:'form-metadata',tenant:api.tenant,count:values.length,values};
        for (const phase of phases) createCatalogWriteLabelResolver(result[phase].definition,result.writeLabels);
        signature.push(values);
      }
      result.schemaRevision = hash([scope,signature]);
      if (fill) await store.write(scope,[{data,checksum:hash([scope,data])}]);
      return structuredClone(result);
    });
  }
  // Derive both projections from the same source reads. The historical questions
  // exist only in this check and must never enter the shared metadata store.
  async function reconstructLegacyEntry(entry, review) {
    const {period, locations, at} = select(entry.context);
    if (period.id !== review.formRevision || period !== periods.findLast(item => item.start <= new Date().toISOString())) return;
    const selected = await defaults(entry.context.providerId, locations);
    const legacy = {provider:review.provider};
    for (const phase of ['entry','interim']) {
      const assessment = selected[phase];
      if (!assessment || hash(assessment) !== hash(review[phase].assessment)) return {refresh:true};
      const sources = await readSources(entry.context, assessment, at);
      const configured = buildAssessmentDefinition({...sources,configuredOnly:true});
      if (hash(configured.questions) !== hash(review[phase].definition.questions)) return {refresh:true};
      const definition = buildAssessmentDefinition(sources);
      if (definition.unresolvedPicklists.length || !retainsConfiguredFields(configured, definition, hash)) return;
      legacy[phase] = {assessment,definition};
    }
    if (automaticLabels) {
      const labels = await readLabels(entry.context.clientId,[review.entry,review.interim]);
      if (hash(labels.sort((a,b) => a.optionId-b.optionId)) !== hash(review.writeLabels?.values ?? [])) return {refresh:true};
    }
    return {legacy};
  }
  async function invalidate(input) {
    const {scope} = select(input);
    await store.withLock(scope, () => store.write(scope,[]));
  }
  return {resolve,invalidate,reconstructLegacyEntry};
}

// Historical answer rows can also overwrite metadata on a configured question.
// Accept only extra children, keeping each configured question's identity and properties.
function retainsConfiguredFields(configured, legacy, hash) {
  const byPath = new Map(flattenQuestions(legacy.questions).map(({path,question}) => [JSON.stringify(path),question]));
  return flattenQuestions(configured.questions).every(({path,question}) => {
    const historical = byPath.get(JSON.stringify(path));
    return historical && hash({...historical,children:[]}) === hash({...question,children:[]});
  });
}

export function isFormDrift(error) {
  if (!error) return false;
  if (['unknown_picklist_value','definition_drift'].includes(error.kind)) return true;
  if (error.kind === 'http' && /assessment/i.test(error.operation) && [400,404,422].includes(error.status)) return true;
  if (error.kind === 'validation' && ['unknown assessment fields','verified lookup write label required','incomplete or mismatched picklist label catalog','ambiguous answer-state option','picklist selector on a non-lookup question'].includes(error.operation)) return true;
  if (['ASSESSMENT_FIELD_UNCOVERED','UNSUPPORTED_MANDATORY_FIELD_TYPE','ASSESSMENT_METADATA_INCOMPLETE','FORM_FIELDS_CHANGED'].includes(error.code)) return true;
  if (error instanceof AggregateError && error.errors.some(isFormDrift)) return true;
  return isFormDrift(error.cause);
}

// The same dated GET supplies both configured questions and the client's answer
// verification. Ignore answer rows when checking that its form is still current.
export function genericFormHash(generic, hash) {
  return hash(configuredAssessmentQuestions(generic));
}
