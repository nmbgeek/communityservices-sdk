import test from 'node:test';
import assert from 'node:assert/strict';
const {decodeMappedResponse}=await import(new URL('./gwt-mapped.mjs',import.meta.resolve('@choiceapps/communityservices-sdk/browser')));
const strings=['com.bowmansystems.sp5.core.client.ui.MappedQueryResults/340212582','java.util.ArrayList/4159755760','java.util.HashMap/1797211028','java.lang.String/2004016611','clientId','java.lang.Integer/3438268394','when','java.util.Date/3385151746'];
const response=(stream,table=strings)=>'//OK'+JSON.stringify([...stream].reverse().concat([table,0,7]));
test('GWT hexadecimal string escapes decode without rewriting literal backslashes',()=>{
 const table=[...strings,'BB&T',String.raw`literal \x26`];
 const wire=response([1,2,1,3,2,4,5,4,9,4,7,4,10,0,0,6,1],table).replace('BB&T',String.raw`BB\x26T`);
 const result=decodeMappedResponse(wire).rows[0];assert.equal(result.clientId,'BB&T');assert.equal(result.when,String.raw`literal \x26`);
});
test('mapped money values decode as finite doubles',()=>{
 const table=[...strings,'java.lang.Double/858496421'];
 assert.equal(decodeMappedResponse(response([1,2,1,3,1,4,5,9,925.25,0,0,6,1],table)).rows[0].clientId,925.25);
});
test('mapped read preserves dates, decodes typed rows and total',()=>{
 const result=decodeMappedResponse(response([1,2,1,3,2,4,5,6,123,4,7,8,'aFPvcgA',0,0,6,1]));
 assert.equal(result.total,1);assert.equal(result.rows[0].clientId,123);assert.equal(result.rows[0].when,'2026-10-18T16:00:00.000Z');
});
test('empty mapped result remains distinguishable from failed read',()=>{
 assert.deepEqual(decodeMappedResponse(response([1,2,0,0,-1,6,0])),{rows:[],total:0});
 for(const value of ['//EX[]','//OK[alert(1)]',response([1,2,0,0,-1,6,0,123]),response([1,2,1,-999,0,0,6,1]),response([1,2,0,0,0,6,-1])])assert.throws(()=>decodeMappedResponse(value));
});
test('unsupported types and versions fail closed',()=>{
 assert.throws(()=>decodeMappedResponse(response([1,2,1,6,4,0,0,6,1],strings.map(s=>s.includes('Integer/')?'other/123':s))));
 assert.throws(()=>decodeMappedResponse(response([1,2,0,0,0,6,0]).replace(/,7\]$/,',8]')));
});
test('single-quoted long tokens do not rewrite quoted words inside note text',()=>{
 const text = 'Selected \'No\'; said "use \'Yes\' later"; path \\synthetic';
 const table=[...strings,text];
 const wire=response([1,2,1,3,2,4,5,4,9,4,7,8,'aFPvcgA',0,0,6,1],table).replace('"aFPvcgA"',"'aFPvcgA'");
 const decoded=decodeMappedResponse(wire);
 assert.equal(decoded.rows[0].clientId,text);
 assert.equal(decoded.rows[0].when,'2026-10-18T16:00:00.000Z');
});

test('nonzero GWT page offsets are primitive integers, not object tags',()=>{
 const wire=response([1,2,1,3,1,4,5,6,123,500,500,6,501]);
 assert.equal(decodeMappedResponse(wire,500).total,501);
 assert.equal(decodeMappedResponse(wire,500).rows[0].clientId,123);
 assert.throws(()=>decodeMappedResponse(wire,0),/Incomplete/);
 assert.throws(()=>decodeMappedResponse(response([1,2,1,3,1,4,5,6,123,500,500,6,500])),/Incomplete/);
});
