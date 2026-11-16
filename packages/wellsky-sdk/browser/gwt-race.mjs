// Decode the raw DaAnswer used by Summary, not the history DTO that reconstructs text.
// Decode only this read contract. Never evaluate server JavaScript or retain user/provider names.
export function decodeRaceDemographics(body) {
  const fail=()=>{throw Error('Unsupported Race and Ethnicity demographic response');};
  if(typeof body!=='string'||!body.startsWith('//OK[')||body.length>5_000_000)fail();
  const stream=JSON.parse(body.slice(4).replace(/"(?:[^"\\]|\\.)*"|'([A-Za-z0-9$_]+)'/g,(token,long)=>long===undefined?token.replace(/\\(?:x([0-9a-fA-F]{2})|.)/g,(escape,hex)=>hex===undefined?escape:`\\u00${hex}`):JSON.stringify(long)));
  if(stream.pop()!==7||stream.pop()!==0)fail();
  const strings=stream.pop(),refs=[];
  if(!Array.isArray(strings)||strings.some(s=>typeof s!=='string'))fail();
  const integer=()=>{const n=stream.pop();if(!Number.isSafeInteger(n))fail();return n;};
  const text=()=>{const n=integer();if(n===0)return null;if(n<1||n>strings.length)fail();return strings[n-1];};
  const long=()=>{const value=stream.pop();if(typeof value!=='string'||!/^[A-Za-z0-9$_]+$/.test(value))fail();let n=0n;for(const c of value)n=n*64n+BigInt('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789$_'.indexOf(c));const result=Number(BigInt.asIntN(64,n));if(!Number.isSafeInteger(result))fail();return result;};
  const object=()=>{
    const tag=integer();if(tag===0)return null;if(tag<0){if(-tag>refs.length)fail();return refs[-tag-1];}
    const type=strings[tag-1],slot=refs.length;refs.push(null);let value;
    switch(type){
      case 'java.lang.Integer/3438268394':value=integer();break;
      case 'java.lang.Boolean/476441737':{const n=integer();if(n!==0&&n!==1)fail();value=!!n;break;}
      case 'java.lang.Long/4227064769':value=long();break;
      case 'java.lang.Double/858496421':value=stream.pop();if(typeof value!=='number'||!Number.isFinite(value))fail();break;
      case 'java.util.Date/3385151746':value=new Date(long()).toISOString();break;
      case '[Lcom.bowmansystems.sp5.model.client.DaAnswer;/1756264905':{const count=integer();if(count!==5)fail();value=[];refs[slot]=value;for(let i=0;i<count;i++)value.push(object());break;}
      case 'com.bowmansystems.sp5.model.client.DaQuestion/3816473893':{
        // Schema-bound positions from the current GWT serializer. Reject unknown wire types.
        const stringFields=new Set([14,24,39,55,56,75,76,82]),fields=[];
        for(let i=0;i<83;i++)fields.push(stringFields.has(i)?text():object());
        value={questionId:fields[59],fieldName:fields[82]};break;
      }
      case 'com.bowmansystems.sp5.model.client.DaAnswer/2864568370':{
        const fields=[];for(let i=0;i<21;i++)fields.push(object());const categoryText=text();
        const [active,answerId,,clientId,,,effectiveDate]=fields,question=fields[12],questionId=fields[13],optionId=fields[20];
        if(typeof active!=='boolean'||![answerId,clientId,questionId].every(n=>Number.isSafeInteger(n)&&n>0)||typeof effectiveDate!=='string'||!Number.isFinite(Date.parse(effectiveDate))||!question||question.questionId!==questionId||optionId!==null&&(!Number.isSafeInteger(optionId)||optionId<1))fail();
        value={active,answerId,clientId,questionId,effectiveDate,optionId,categoryText:categoryText??'',fieldName:question.fieldName};break;
      }
      default:fail();
    }
    refs[slot]=value;return value;
  };
  const rows=object();if(stream.length||!Array.isArray(rows)||rows.some(r=>r!==null&&typeof r.active!=='boolean'))fail();
  const race=rows[4];if(race&&race.fieldName!=='HUD_RACEETHNICITY')fail();return race;
}
