import {readFileSync} from 'node:fs';
import ts from 'typescript';

const parse=(name,text)=>ts.createSourceFile(name,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const strings=node=>!node?[]:ts.isStringLiteralLike(node)?[node.text]:ts.isParenthesizedExpression(node)?strings(node.expression):ts.isConditionalExpression(node)?[...strings(node.whenTrue),...strings(node.whenFalse)]:[];
const code=value=>/^[A-Z][A-Z0-9_]+$/.test(value);
const property=(node,name)=>ts.isObjectLiteralExpression(node)?node.properties.find(p=>ts.isPropertyAssignment(p)&&p.name.getText()===name)?.initializer:undefined;

/** Extract SDK-owned codes and reject new constant reasons without an explicit code. */
export function collectWorkflowErrors(mapText,sources,codeOnlySources={}){
 const reasons=new Map(),entries=new Map(),unmapped=new Set();
 const add=(name,description)=>{if(!entries.has(name))entries.set(name,new Set());entries.get(name).add(description??name.toLowerCase().replaceAll('_',' '));};
 const map=parse('workflow-error-codes.mjs',mapText);
 const visitMap=node=>{
  if(ts.isArrayLiteralExpression(node)&&node.elements.length===2&&node.elements.every(ts.isStringLiteralLike)){
   const [reason,name]=node.elements.map(e=>e.text);if(code(name)){reasons.set(reason,name);add(name,reason);}
  }
  if(ts.isStringLiteralLike(node)&&node.text==='WORKFLOW_FAILED')add(node.text,'Unclassified workflow failure; inspect cause and commit markers.');
  ts.forEachChild(node,visitMap);
 };
 visitMap(map);
 for(const [file,text]of Object.entries({...sources,...codeOnlySources})){
  const source=parse(file,text);
  const visit=node=>{
   if(ts.isPropertyAssignment(node)&&node.name.getText(source)==='code')for(const name of strings(node.initializer).filter(code))add(name);
   if(ts.isBinaryExpression(node)&&node.operatorToken.kind===ts.SyntaxKind.EqualsToken&&ts.isPropertyAccessExpression(node.left)&&node.left.name.text==='code')for(const name of strings(node.right).filter(code))add(name);
   if(Object.hasOwn(sources,file)&&(ts.isCallExpression(node)||ts.isNewExpression(node))&&ts.isIdentifier(node.expression)&&['fail','makeError','EnrollmentWorkflowError'].includes(node.expression.text)){
    const args=node.arguments??[],first=strings(args[0]),explicit=strings(property(args[1]??{},'code'));
    // Row registration/discovery use fail(code, reason); the other guards use fail(reason, options).
    if(first.length&&first.every(code))for(const name of first)add(name,strings(args[1])[0]);
    else for(const reason of first){
     if(explicit.length)for(const name of explicit)add(name,reason);
     else if(!reasons.has(reason))unmapped.add(`${file}: ${reason}`);
    }
   }
   ts.forEachChild(node,visit);
  };
  visit(source);
 }
 if(unmapped.size)throw Error('Workflow reasons need stable codes:\n'+[...unmapped].sort().join('\n'));
 return [...entries].sort(([a],[b])=>a.localeCompare(b)).map(([code,descriptions])=>({code,descriptions:[...descriptions].sort()}));
}

export function workflowErrorReference(){
 const files=['enrollment-workflow','entry-correction','entry-row-registration','household-enrollment-discovery'];
 const entries=collectWorkflowErrors(readFileSync('browser/workflow-error-codes.mjs','utf8'),Object.fromEntries(files.map(file=>[file,readFileSync(`browser/${file}.mjs`,'utf8')])),{'member-entry-date':readFileSync('browser/member-entry-date.mjs','utf8')});
 const cell=text=>text.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('|','&#124;').replaceAll('\n',' ');
 return [
  '## Enrollment workflow errors','',
  'This SDK-owned code inventory is generated from the workflow guards and stable reason map. These codes are separate from the REST Swagger operations above. Classify errors by `code`, never by message text. Existing codes remain stable when wording changes; later releases may add codes. Application-supplied constructor codes are outside this inventory.','',
  '`EnrollmentWorkflowError.operation` identifies the SDK operation. `committed: false` means that operation has not attempted a WellSky record write; it does not promise that no local journal exists or that another operation wrote nothing. `committed: "unknown"` preserves an attempted or unreadable prior outcome. Never choose a new key solely from an HTTP status or unchanged read.','',
  'A preflight refusal after enrollment creation can identify `step: "scalars"` while the enrollment is already saved. Keep the same key and reconcile the existing journal. A failed `resolveEntryCorrection` can have `committed: false` for resolution itself and `originalCommitted: "unknown"` for the original correction. See [recovery guidance](docs/troubleshooting.md#workflow-error-codes).','',
  '| Code | Reason or meaning |','| --- | --- |',
  ...entries.map(e=>`| \`${e.code}\` | ${e.descriptions.map(cell).join('<br>')} |`),'',
 ].join('\n');
}
