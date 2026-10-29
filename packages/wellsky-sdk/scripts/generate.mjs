import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

// Names are deliberately stable even if Swagger changes tags or gains operationIds.
const names = {
  '/apitoapiauthentication/CreateAuthKey': 'apiToApiAuthentication.createAuthKey',
  '/assessments/{clientId}/{assessmentCode}': 'assessments.get',
  '/assessments/create/{clientId}/{assessmentCode}': 'assessments.create',
  '/assessmentsmobile/GetAssessmentAnswers/{clientId}/{assessmentCode}': 'assessmentsMobile.getAnswers',
  '/assessmentsmobile/AddAssessmentAnswer/{clientId}/{assessmentCode}': 'assessmentsMobile.addAnswer',
  '/authentication/SetAuthKey': 'authentication.setAuthKey',
  '/authentication/GetCurrentAuthKey': 'authentication.getCurrentAuthKey',
  '/authentication/GetCurrentAuthKeyList': 'authentication.getCurrentAuthKeyList',
  '/calls': 'calls.list',
  '/casemanager': 'caseManagers.list',
  '/casemanager/{clientId}': 'caseManagers.listForClient',
  '/clientAuthentication/RegisterClient': 'clientAuthentication.registerClient',
  '/clientAuthentication/MobileAuthenticationInformation': 'clientAuthentication.getMobileInformation',
  '/clientAuthentication/UpdateClientDetails': 'clientAuthentication.updateClientDetails',
  '/clientAuthentication/GetAuthKeyFormobileapp': 'clientAuthentication.getMobileAuthKey',
  '/clientAuthentication/ResetPassword': 'clientAuthentication.resetPassword',
  '/clientAuthentication/ChangePassword': 'clientAuthentication.changePassword',
  '/clientAuthentication/MobileMasterDataInformation': 'clientAuthentication.getMobileMasterData',
  '/clientAuthentication/SaveUserDetails': 'clientAuthentication.saveUserDetails',
  '/clientAuthentication/GenerateTokenUsingOldToken': 'clientAuthentication.generateTokenUsingOldToken',
  '/clientnotes': 'clientNotes.list',
  '/clientnotes/create': 'clientNotes.create',
  '/clientnotes/update': 'clientNotes.update',
  '/clients': 'clients.list',
  '/clients/{clientId}': 'clients.get',
  '/clients/simplified': 'clients.listSimplified',
  '/clients/simplified/{clientId}': 'clients.getSimplified',
  '/clients/create': 'clients.create',
  '/clients/update/{client_id}': 'clients.update',
  '/enrollments/entry/assessment/create': 'enrollments.createEntryAssessment',
  '/enrollments/entry/assessment/update': 'enrollments.updateEntryAssessment',
  '/enrollments': 'enrollments.list',
  '/enrollments/{clientId}': 'enrollments.listForClient',
  '/enrollments/complete/{enrollmentId}': 'enrollments.getComplete',
  '/enrollments/assessment/{clientId}/{assessmentCode}': 'enrollments.getAssessment',
  '/fileattachments/clients/get': 'fileAttachments.getForClient',
  '/fileattachments/clients/create': 'fileAttachments.createForClient',
  '/goals': 'goals.list',
  '/goals/client/{clientId}': 'goals.listForClient',
  '/goals/{goalId}': 'goals.get',
  '/goals/create': 'goals.create',
  '/goals/update/{goalId}': 'goals.update',
  '/goals/actions/create/{goalId}': 'goals.createAction',
  '/goals/actions/update/{goalActionStepId}': 'goals.updateAction',
  '/healthcheckup': 'healthCheck.get',
  '/households': 'households.list',
  '/households/{householdId}': 'households.get',
  '/households/client/{clientId}': 'households.listForClient',
  '/households/create': 'households.create',
  '/households/update/{householdId}': 'households.update',
  '/needs': 'needs.list',
  '/needs/{clientId}': 'needs.listForClient',
  '/needs/call/{callRecordId}': 'needs.listForCall',
  '/needs/complete/{needId}': 'needs.getComplete',
  '/providers': 'providers.list',
  '/providers/{providerId}': 'providers.get',
  '/providers/complete/{providerId}': 'providers.getComplete',
  '/referrals': 'referrals.list',
  '/referrals/client/{clientId}': 'referrals.listForClient',
  '/referrals/call/{callRecordId}': 'referrals.listForCall',
  '/referrals/{referralId}': 'referrals.get',
  '/referrals/create': 'referrals.create',
  '/referrals/update/{referral_id}': 'referrals.update',
  '/releasesofinformation': 'releasesOfInformation.list',
  '/services/needs/household/update/{serviceId}': 'services.updateHouseholdNeeds',
  '/services': 'services.list',
  '/services/{clientId}': 'services.listForClient',
  '/services/call/{callRecordId}': 'services.listForCall',
  '/services/complete/{serviceId}': 'services.getComplete',
  '/services/create': 'services.create',
  '/services/update/{serviceId}': 'services.update',
  '/services/household/create': 'services.createHousehold',
  '/services/household/update/{serviceId}': 'services.updateHousehold',
  '/tenants/GetCurrentTenants': 'tenants.list',
  '/tenants/AddTenantRecord': 'tenants.create',
  '/tenants/UpdateTenantRecord': 'tenants.update',
  '/tenants/UpdateTenantRecord/{tenant_code}': 'tenants.updateByCode',
  '/tenants/DeleteTenantRecord': 'tenants.delete',
};
const anonymous = new Set([
  '/apitoapiauthentication/CreateAuthKey', '/authentication/SetAuthKey',
  '/authentication/GetCurrentAuthKey', '/healthcheckup',
  '/clientAuthentication/RegisterClient', '/clientAuthentication/GetAuthKeyFormobileapp',
  '/clientAuthentication/ResetPassword', '/clientAuthentication/GenerateTokenUsingOldToken',
]);
const banner = '// Generated by scripts/generate.mjs. Do not edit.\n';
const q = JSON.stringify;
const hash = data => createHash('sha256').update(data).digest('hex');
const emitted = new Map();
const docs = ['# API coverage', '', 'Generated from the pinned WellSky V2 and V3 Swagger documents. Every operation has a named method and a typed `client.request("METHOD /path", options)` equivalent.', '', 'Both versions have the methods below. Import from `@choiceapps/communityservices-sdk/v2` or `@choiceapps/communityservices-sdk/v3` to select the matching request and response models.', '', '| Method | HTTP | Path | Pagination |', '| --- | --- | --- | --- |'];

function typeOf(schema, prefix = '') {
  if (!schema) return 'unknown';
  let type;
  if (schema.$ref) type = prefix + schema.$ref.split('/').at(-1);
  else if (schema.enum) type = schema.enum.map(q).join(' | ');
  else switch (schema.type?.toLowerCase()) {
    case 'string': type = schema.format === 'binary' ? 'Blob' : 'string'; break;
    case 'integer': case 'number': type = 'number'; break;
    case 'boolean': type = 'boolean'; break;
    case 'array': type = `Array<${typeOf(schema.items, prefix)}>`; break;
    case 'object': {
      const fields = Object.entries(schema.properties ?? {}).map(([name, child]) => `${q(name)}${schema.required?.includes(name) ? '' : '?'}: ${typeOf(child, prefix)};`);
      if (schema.additionalProperties && typeof schema.additionalProperties === 'object') fields.push(`[key: string]: ${typeOf(schema.additionalProperties, prefix)};`);
      type = fields.length ? `{\n${fields.map(f => `  ${f}`).join('\n')}\n}` : 'Record<string, unknown>';
      break;
    }
    default: throw new Error(`Unsupported schema: ${q(schema)}`);
  }
  return schema.nullable ? `${type} | null` : type;
}

function contentSchema(container) {
  const content = container?.content;
  if (!content) return undefined;
  return (content['application/json'] ?? content['multipart/form-data'] ?? Object.values(content)[0])?.schema;
}

function parameterObject(parameters) {
  return { type: 'object', properties: Object.fromEntries(parameters.map(p => [p.name, p.schema])), required: parameters.filter(p => p.required).map(p => p.name), additionalProperties: false };
}

for (const version of ['v2', 'v3']) {
  const raw = readFileSync(`specs/${version}.json`, 'utf8');
  const spec = JSON.parse(raw);
  const overrides = JSON.parse(readFileSync('specs/overrides.json', 'utf8'));
  for (const [model, properties] of Object.entries(overrides.nullableResponseProperties)) {
    for (const property of properties) {
      const field = spec.components.schemas[model]?.properties?.[property];
      if (!field) throw new Error(`Stale schema correction: ${model}.${property}`);
      field.nullable = true;
    }
  }
  const models = Object.entries(spec.components.schemas).map(([name, schema]) => `export type ${name} = ${typeOf(schema)};`).join('\n\n');
  emitted.set(`src/generated/${version}-models.ts`, banner + models + '\n');
  const definitions = {};
  const operationTypes = [];
  const groups = new Map();
  const pageable = [];
  const seen = new Set();
  let count = 0;
  for (const [path, methods] of Object.entries(spec.paths)) {
    for (const [verb, operation] of Object.entries(methods)) {
      if (!['get', 'post', 'put', 'delete', 'patch', 'head', 'options'].includes(verb)) throw new Error(`Unsupported path entry ${verb}`);
      const name = names[path];
      if (!name || seen.has(name)) throw new Error(`Missing or duplicate method name for ${verb} ${path}`);
      seen.add(name);
      const [group, method] = name.split('.');
      const key = `${verb.toUpperCase()} ${path}`;
      const parameters = [...(methods.parameters ?? []), ...(operation.parameters ?? [])];
      const pathSchema = parameterObject(parameters.filter(p => p.in === 'path'));
      const querySchema = parameterObject(parameters.filter(p => p.in === 'query'));
      const body = contentSchema(operation.requestBody);
      const success = Object.entries(operation.responses).filter(([status]) => status.startsWith('2'));
      if (success.length !== 1) throw new Error(`Review success variants for ${key}`);
      const response = contentSchema(success[0][1]);
      const fields = [];
      if (Object.keys(pathSchema.properties).length) fields.push(`path: ${typeOf(pathSchema)};`);
      if (Object.keys(querySchema.properties).length) fields.push(`query${querySchema.required.length ? '' : '?'}: ${typeOf(querySchema)};`);
      // Swagger omits requestBody.required even on create operations. Require a payload.
      if (body) fields.push(`body: ${typeOf(body, 'Models.')};`);
      const required = pathSchema.required.length || querySchema.required.length || body;
      const isPageable = verb === 'get' && 'perPage' in querySchema.properties;
      const responseType = response ? `ApiResponse<${typeOf(response, 'Models.')}>` : 'unknown';
      operationTypes.push(`  ${q(key)}: { request: RequestOptions & { ${fields.join('\n')} }; response: ${responseType}; item: ${typeOf(response, 'Models.')}; };`);
      definitions[key] = { method: verb.toUpperCase(), path, authenticated: !anonymous.has(path), pathSchema, querySchema, ...(body ? { bodySchema: body } : {}), ...(response ? { responseSchema: response } : {}), multipart: Boolean(operation.requestBody?.content?.['multipart/form-data']), pageable: isPageable };
      const methodsForGroup = groups.get(group) ?? [];
      const summary = (operation.summary ?? name).replaceAll('*/', '* /').replaceAll(/\s+/g, ' ');
      methodsForGroup.push(`    /** ${summary} */\n    ${method}: (options: Operations[${q(key)}]["request"]${required ? '' : ' = {}'}): Promise<Operations[${q(key)}]["response"]> => this.#transport.execute(definitions[${q(key)}], options),`);
      groups.set(group, methodsForGroup);
      if (isPageable) pageable.push(q(key));
      if (version === 'v3') docs.push(`| \`${name}\` | ${verb.toUpperCase()} | \`${path}\` | ${isPageable ? 'Yes' : ''} |`);
      count++;
    }
  }
  const output = `${banner}import { Transport } from "../transport.js";
import type { ApiResponse, RequestOptions, ClientOptions, PaginationOptions } from "../runtime.js";
import { AssessmentMetadata } from "../metadata.js";
import { SubassessmentEditor } from "../subassessments.js";
import { mapBulk } from "../bulk.js";
import type { BulkOptions, BulkReport } from "../bulk.js";
import type { AssessmentContext, QuestionReference, PicklistSelector } from "../metadata.js";
import type { OperationDefinition, SchemaRegistry } from "../validation.js";
import type * as Models from "./${version}-models.js";

export interface Operations {
${operationTypes.join('\n')}
}
export type Operation = keyof Operations;
export type PaginatedOperation = ${pageable.join(' | ')};
export const apiVersion = ${q(version === 'v2' ? '2.0' : '3.0')};
export const specSha256 = ${q(hash(raw))};
export const operationRoutes: ReadonlyArray<{ operation: Operation; method: string; path: string }> = ${q(Object.entries(definitions).map(([operation, d]) => ({operation, method:d.method,path:d.path})))};
const schemas: SchemaRegistry = ${q(spec.components.schemas)};
const definitions = ${q(definitions)} satisfies Record<Operation, OperationDefinition>;

/** One tenant and one API version per client. Keep credentials on the server. */
export class WellSkyClient {
  readonly #transport: Transport;
  readonly #metadata: AssessmentMetadata;
  readonly subassessments: SubassessmentEditor;
  constructor(options: ClientOptions) {
    this.#transport = new Transport(options, apiVersion, schemas);
    this.#metadata = new AssessmentMetadata(options.tenant, {
      generic: context => this.assessments.get({ path: { clientId: context.clientId, assessmentCode: context.assessmentCode }, ...(context.effectiveDate === undefined ? {} : { query: { dateEffective: context.effectiveDate } }), ...(context.signal ? { signal: context.signal } : {}), ...(context.timeoutMs === undefined ? {} : { timeoutMs: context.timeoutMs }), ...(context.correlationId === undefined ? {} : { correlationId: context.correlationId }) }),
      mobile: context => this.assessmentsMobile.getAnswers({ path: { clientId: context.clientId, assessmentCode: context.assessmentCode }, ...(context.signal ? { signal: context.signal } : {}), ...(context.timeoutMs === undefined ? {} : { timeoutMs: context.timeoutMs }), ...(context.correlationId === undefined ? {} : { correlationId: context.correlationId }) }),
    }, options.metadataCacheTtlMs, options.metadataCacheMaxEntries);
    this.subassessments = new SubassessmentEditor(options.tenant, {
      read: context => this.assessmentsMobile.getAnswers({ path: { clientId: context.clientId, assessmentCode: context.assessmentCode }, ...(context.signal ? { signal: context.signal } : {}), ...(context.timeoutMs === undefined ? {} : { timeoutMs: context.timeoutMs }), ...(context.correlationId === undefined ? {} : { correlationId: context.correlationId }) }),
      write: (context, body) => this.assessmentsMobile.addAnswer({ path: { clientId: context.clientId, assessmentCode: context.assessmentCode }, body, ...(context.effectiveDate === undefined ? {} : { query: { dateEffective: context.effectiveDate } }), ...(context.signal ? { signal: context.signal } : {}), ...(context.timeoutMs === undefined ? {} : { timeoutMs: context.timeoutMs }), ...(context.correlationId === undefined ? {} : { correlationId: context.correlationId }) }),
    });
  }
  get tenant(): string { return this.#transport.tenant; }
  get baseUrl(): string { return this.#transport.baseUrl; }
  health() { return this.#transport.health(); }
  readonly questions = {
    list: (context: AssessmentContext) => this.#metadata.listQuestions(context),
    get: (context: AssessmentContext & QuestionReference) => this.#metadata.getQuestion(context),
  };
  readonly picklists = {
    list: (context: AssessmentContext) => this.#metadata.listPicklists(context),
    resolve: (context: AssessmentContext & QuestionReference & PicklistSelector) => this.#metadata.resolve(context),
  };
  clearMetadataCache(): void { this.#metadata.clearCache(); }
  bulk<K extends Operation>(operation: K, requests: ReadonlyArray<Operations[K]["request"]>, options: BulkOptions<Operations[K]["response"]> = {}): Promise<BulkReport<Operations[K]["response"]>> {
    return mapBulk(requests, (request, context) => this.#transport.execute(definitions[operation], { ...request, ...(context.signal ? { signal: request.signal ? AbortSignal.any([request.signal, context.signal]) : context.signal } : {}) }), options);
  }
  request<K extends Operation>(operation: K, ...args: {} extends Operations[K]["request"] ? [options?: Operations[K]["request"]] : [options: Operations[K]["request"]]): Promise<Operations[K]["response"]> {
    return this.#transport.execute(definitions[operation], args[0] ?? {});
  }
  paginate<K extends PaginatedOperation>(operation: K, options: Operations[K]["request"] & PaginationOptions): AsyncGenerator<Operations[K]["item"]> {
    return this.#transport.paginate(definitions[operation], options);
  }
${[...groups].map(([group, methods]) => `  readonly ${group} = {\n${methods.join('\n')}\n${group === 'assessments' ? '    getDefinition: (context: AssessmentContext) => this.#metadata.getDefinition(context),\n' : ''}  };`).join('\n')}
}
export function createWellSkyClient(options: ClientOptions): WellSkyClient { return new WellSkyClient(options); }
`;
  emitted.set(`src/generated/${version}.ts`, output);
  console.log(`${version}: ${count} operations, ${Object.keys(spec.components.schemas).length} schemas, ${groups.size} groups`);
}
emitted.set('API.md', docs.join('\n') + '\n');
for (const [path, content] of emitted) {
  if (process.argv.includes('--check')) {
    if (readFileSync(path, 'utf8') !== content) throw new Error(`Generated file is stale: ${path}`);
  } else writeFileSync(path, content);
}
