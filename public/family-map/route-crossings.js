import {clearCubicPath} from './curves.js';
import {pathCrossing,traceLink} from './path-crossings.js';

function score(trace,others,nodes) {
  let count=0;
  for(const other of others){
    if(other.id===trace.id)continue;
    if(pathCrossing(trace,other,nodes,true))count+=trace.family===other.family?1:3;
  }
  return count;
}

function* alternateCurves(link,target,nodes) {
  const start=link.junction;
  const angle=Math.atan2(start[1]-target.y,start[0]-target.x);
  const radius=target.card.width/2;
  for(const offset of [0,30,-30,60,-60,90,-90,120,-120]){
    const bearing=angle+offset*Math.PI/180;
    const arrival=[Math.cos(bearing),Math.sin(bearing)];
    const end=[target.x+arrival[0]*radius,target.y+arrival[1]*radius];
    const span=Math.hypot(end[0]-start[0],end[1]-start[1]);
    for(const scale of [0.3,0.5,-0.3,-0.5]){
      const a=start.map((value,i)=>value+link.normal[i]*span*scale);
      const b=end.map((value,i)=>value+arrival[i]*span*Math.abs(scale));
      const d=clearCubicPath([[start,a,b,end]],nodes,target.id);
      if(d)yield d;
    }
  }
}

function* detours(link,target,nodes) {
  const start=link.junction,dx=target.x-start[0],dy=target.y-start[1],length=Math.hypot(dx,dy);
  const along=[dx/length,dy/length],across=[-along[1],along[0]];
  const shift=(point,direction,amount)=>point.map((value,i)=>value+direction[i]*amount);
  for(const offset of [-280,280,-140,140]){
    const middle=shift(shift(start,along,length/2),across,offset);
    const ray=[middle[0]-target.x,middle[1]-target.y],span=Math.hypot(...ray);
    const arrival=ray.map(v=>v/span);
    const end=shift([target.x,target.y],arrival,target.card.width/2);
    for(const direction of [1,-1]){
      const handle=Math.min(210,length/4);
      const a=shift(start,link.normal,handle*direction);
      const b=shift(end,arrival,handle);
      const d=clearCubicPath([
        [start,a,shift(middle,along,-handle),middle],
        [middle,shift(middle,along,handle),b,end]
      ],nodes,target.id);
      if(d)yield d;
    }
  }
}

function* options(link,target,nodes) {
  yield* alternateCurves(link,target,nodes);
  yield* detours(link,target,nodes);
}

function improveLink(link,others,nodes,target) {
  let best=link,bestScore=score(link,others,nodes);
  if(bestScore===0)return link;
  for(const d of options(link,target,nodes)){
    const candidate=traceLink({...link,d},16);
    const cost=score(candidate,others,nodes);
    if(cost>=bestScore)continue;
    best=candidate;
    bestScore=cost;
    if(cost===0)break;
  }
  return best;
}

export function reduceCrossings(links,nodes,positions) {
  if(!nodes.some(p=>p.free))return;
  const traces=links.map(link=>traceLink(link,16));
  for(let round=0;round<2;round++)for(let i=0;i<links.length;i++){
    const link=links[i],target=positions.get(link.target);
    if(!link.junction)continue;
    const best=improveLink(traces[i],traces,nodes,target);
    traces[i]=best;
    link.d=best.d;
  }
}
