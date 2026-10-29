// Decode only the observed mapped-read wire types. Never evaluate server JavaScript.
export function decodeMappedResponse(body, expectedOffset) {
  if (!body.startsWith('//OK[') || body.length > 5_000_000) throw Error('GWT read failed');
  // GWT emits long tokens in single quotes. Leave ordinary JSON strings untouched,
  // including note text such as "selected 'No'" and escaped quotation marks.
  const values = JSON.parse(body.slice(4).replace(/"(?:[^"\\]|\\.)*"|'([A-Za-z0-9$_]+)'/g, (token, long) => long === undefined ? token.replace(/\\(?:x([0-9a-fA-F]{2})|.)/g, (escape, hex) => hex === undefined ? escape : `\\u00${hex}`) : JSON.stringify(long)));
  if (values.pop() !== 7 || values.pop() !== 0) throw Error('Unsupported GWT response');
  const strings = values.pop(), refs = [];
  if (!Array.isArray(strings) || strings.some(s => typeof s !== 'string')) throw Error('Invalid GWT strings');
  const pop = () => { if (!values.length) throw Error('Truncated GWT response'); return values.pop(); };
  const integer = () => { const n=pop(); if(!Number.isSafeInteger(n))throw Error('Invalid GWT integer');return n; };
  const long = () => {
    const s=pop(); if(typeof s!=='string'||!s.length)throw Error('Invalid GWT long');
    let n=0n;for(const c of s){const digit='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789$_'.indexOf(c);if(digit<0)throw Error('Invalid GWT long');n=n*64n+BigInt(digit);}
    n=BigInt.asIntN(64,n);const number=Number(n);if(!Number.isSafeInteger(number))throw Error('GWT integer exceeds safe range');return number;
  };
  const object = () => {
    const tag=integer();if(tag===0)return null;if(tag<0){if(-tag>refs.length)throw Error('Invalid GWT reference');return refs[-tag-1];}
    const type=strings[tag-1],slot=refs.length;refs.push(null);
    let result;
    switch(type){
      case 'java.lang.String/2004016611': result=strings[integer()-1];if(typeof result!=='string')throw Error('Invalid string reference');break;
      case 'java.lang.Integer/3438268394': result=integer();break;
      case 'java.lang.Double/858496421': result=pop();if(typeof result!=='number'||!Number.isFinite(result))throw Error('Invalid GWT double');break;
      case 'java.lang.Long/4227064769': result=long();break;
      case 'java.lang.Boolean/476441737': {const n=integer();if(n!==0&&n!==1)throw Error('Invalid boolean');result=!!n;break;}
      case 'java.util.Date/3385151746': result=new Date(long()).toISOString();break;
      case 'java.util.ArrayList/4159755760': {
        result=[];refs[slot]=result;const count=integer();if(count<0||count>10000)throw Error('Invalid list size');for(let i=0;i<count;i++)result.push(object());break;
      }
      case 'java.util.HashMap/1797211028': {
        result=Object.create(null);refs[slot]=result;const count=integer();if(count<0||count>1000)throw Error('Invalid map size');
        for(let i=0;i<count;i++){const key=object();if(typeof key!=='string'||Object.hasOwn(result,key))throw Error('Invalid map key');result[key]=object();}break;
      }
      default: throw Error('Unsupported GWT mapped type');
    }
    refs[slot]=result;return result;
  };
  const root=integer();if(strings[root-1]!=='com.bowmansystems.sp5.core.client.ui.MappedQueryResults/340212582')throw Error('Not mapped results');
  refs.push(null);
  // MappedQueryResults serializes rows, firstRow and lastRow as primitive
  // integers, then the boxed total. A zero firstRow is not a null object.
  const rows=object(),offset=integer(),lastRow=integer(),total=object();
  if(values.length||!Array.isArray(rows)||offset<0||lastRow < -1||expectedOffset!==undefined&&offset!==expectedOffset||!Number.isSafeInteger(total)||total<rows.length||offset+rows.length>total)throw Error('Incomplete mapped response');
  return {rows,total};
}
