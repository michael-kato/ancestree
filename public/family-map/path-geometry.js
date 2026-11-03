export const pathParts=path=>(path.match(/[MLAQC][^MLAQC]+/g)||[]).map(part=>({kind:part[0],values:part.slice(1).match(/[-+]?\d*\.?\d+(?:e[-+]?\d+)?/g).map(Number)}));
export const pairs=values=>Array.from({length:values.length/2},(_,i)=>values.slice(i*2,i*2+2));
export function bezierSamples(controls,count=64){
 return Array.from({length:count+1},(_,step)=>{
  const t=step/count;let row=controls;
  while(row.length>1)row=row.slice(1).map((p,i)=>p.map((v,a)=>row[i][a]*(1-t)+v*t));
  return row[0];
 });
}
