import {readFileSync,readdirSync,existsSync,statSync} from 'node:fs';
import {resolve,dirname,relative,join} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';

const withoutCode=text=>text.replace(/^```[^\n]*\n[\s\S]*?^```\s*$/gm,'');
const headings=text=>{
 const seen=new Map(),ids=new Set();
 for(const match of withoutCode(text).matchAll(/^#{1,6}\s+(.+?)\s*#*$/gm)){
  const base=match[1].toLowerCase().replace(/[^\p{L}\p{N}_\s-]/gu,'').replace(/\s/g,'-');
  const n=seen.get(base)??0;seen.set(base,n+1);ids.add(base+(n?`-${n}`:''));
 }return ids;
};
/** Checks the actual filesystem supplied, including a clean installed package. */
export async function checkDocumentation(directory){
 const root=resolve(directory),failures=[];
 const docs=['README.md','API.md','SSVF.md','CHANGELOG.md','AGENTS.md','llms.txt',...readdirSync(join(root,'docs'),{recursive:true}).filter(n=>n.endsWith('.md')).map(n=>'docs/'+n),'examples/README.md'];
 for(const name of docs){
  const file=join(root,name),text=readFileSync(file,'utf8');
  for(const match of withoutCode(text).matchAll(/\[[^\]]*\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g)){
   const href=match[1];if(/^(https?:|mailto:)/.test(href))continue;
   const [pathPart,fragment]=href.split('#'),target=resolve(dirname(file),decodeURIComponent(pathPart||'.'));
   const dest=pathPart?target:file;
   if(relative(root,dest).startsWith('..')||!existsSync(dest)||!statSync(dest).isFile()){failures.push(`${name}: missing or outside-package link ${href}`);continue;}
   if(fragment&&dest.endsWith('.md')&&!headings(readFileSync(dest,'utf8')).has(decodeURIComponent(fragment)))failures.push(`${name}: missing anchor ${href}`);
  }
  for(const match of text.matchAll(/<!-- checked-example: ([^ ]+) -->\s*```\w*\n([\s\S]*?)\n```/g)){
   const example=join(root,match[1]);if(!existsSync(example)||readFileSync(example,'utf8').trim()!==match[2].trim())failures.push(`${name}: checked example differs: ${match[1]}`);
  }
 }
 const exampleFiles=readdirSync(join(root,'examples')).filter(n=>/\.(?:mjs|mts|ts)$/.test(n));
 for(const file of exampleFiles){
  const text=readFileSync(join(root,'examples',file),'utf8');
  for(const match of text.matchAll(/(?:from\s*|import\s*\()(['"])([^'"]+)\1/g))if(!/^(?:@choiceapps\/communityservices-sdk(?:\/(?:v2|v3|testing|browser))?|playwright-core|node:[\w/]+)$/.test(match[2]))failures.push(`examples/${file}: non-public import ${match[2]}`);
  if(/private-probes|tests\/live|SDK_HANDOFF/.test(text))failures.push(`examples/${file}: private repository dependency`);
 }
 const reference=readFileSync(join(root,'docs/reference.md'),'utf8');
 for(const entry of ['dist/esm/index.js','dist/esm/v2.js','dist/esm/v3.js','dist/esm/testing.js','browser/index.mjs']){
  for(const name of Object.keys(await import(pathToFileURL(join(root,entry)).href)))if(!reference.includes('`'+name+'`'))failures.push(`Reference missing runtime export ${name} from ${entry}`);
 }
 if(failures.length)throw Error(failures.join('\n'));
 return {documents:docs.length,examples:exampleFiles.length};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const result=await checkDocumentation(process.argv[2]??process.cwd());
 console.log(`Documentation checked: ${result.documents} files, ${result.examples} examples, local links/anchors and runtime export inventory`);
}
