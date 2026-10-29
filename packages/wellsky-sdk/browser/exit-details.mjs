const normalize=value=>typeof value==='string'?value.replace(/\s*\(HUD\)\s*$/,'').trim():value;
export const rentalDestination='Rental by client, with ongoing housing subsidy';
const text=(value,max)=>typeof value==='string'&&value.trim()===value&&value.length>0&&value.length<=max&&!/[\x00-\x1f\x7f-\x9f]/.test(value);
/** Validate only explicit caller intent. Keep omission stable for existing journals. */
export function expectedExitDetails(input){
 const details=input.destinationDetails,reason=input.reasonForLeavingOther;
 if(details!==undefined){
  if(!details||typeof details!=='object'||Array.isArray(details))throw Error('Invalid destination details');
  const keys=details.kind==='rental-subsidy'?['kind','rentalSubsidyType']:details.kind==='other'?['kind','explanation']:[];
  if(!keys.length||Object.keys(details).some(k=>!keys.includes(k)))throw Error('Invalid destination details');
 }
 if(normalize(input.destination)===rentalDestination){
  if(details?.kind!=='rental-subsidy'||!text(details.rentalSubsidyType,500))throw Error('Rental subsidy type required');
 }else if(normalize(input.destination)==='Other'){
  if(details?.kind!=='other'||!text(details.explanation,100))throw Error('Destination Other explanation required, maximum 100 characters');
 }else if(details!==undefined)throw Error('Destination details do not apply');
 if(normalize(input.reasonForLeaving)==='Other'){
  if(!text(reason,100))throw Error('Reason for leaving Other explanation required, maximum 100 characters');
 }else if(reason!==undefined)throw Error('Reason for leaving explanation does not apply');
 return {destinationDetails:details??null,reasonForLeavingOther:reason??null};
}
