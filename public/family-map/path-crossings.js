import {pathParts,pairs,bezierSamples} from './path-geometry.js';
export function pathPoints(path,curveSteps=64){
 const result=[];let start;
 for(const {kind,values} of pathParts(path)){
  const end=values.slice(-2);
  if(kind==='M'){result.push(end);start=end;continue;}
  if(kind==='L')result.push(end);
  else if(kind==='A'){
   const a=Math.atan2(start[0],-start[1]),b=Math.atan2(end[0],-end[1]);
   const span=values[4]?(b-a+2*Math.PI)%(2*Math.PI):-((a-b+2*Math.PI)%(2*Math.PI));
   const count=Math.max(8,Math.ceil(Math.abs(span)*values[0]/10));
   for(let i=1;i<=count;i++){const t=a+span*i/count;result.push([Math.sin(t)*values[0],-Math.cos(t)*values[0]]);}
  }else result.push(...bezierSamples([start,...pairs(values)],curveSteps).slice(1));
  start=end;
 }
 return result;
}
const cross=(a,b)=>a[0]*b[1]-a[1]*b[0];
function intersection(a,b,c,d,ignoreShared){
 const u=[b[0]-a[0],b[1]-a[1]],v=[d[0]-c[0],d[1]-c[1]],w=[c[0]-a[0],c[1]-a[1]],den=cross(u,v);
 if(Math.abs(den)<1e-8){
  if(ignoreShared)return null;
  const length=Math.hypot(...u);
  if(length<1e-8||Math.abs(cross(w,u))/length>1e-7)return null;
  const project=p=>((p[0]-a[0])*u[0]+(p[1]-a[1])*u[1])/length;
  const projections=[project(c),project(d)].sort((x,y)=>x-y);
  const lo=Math.max(0,projections[0]),hi=Math.min(length,projections[1]);
  if(hi-lo<=1)return null;
  const t=(lo+hi)/(2*length);
  return [a[0]+t*u[0],a[1]+t*u[1]];
 }
 const t=cross(w,v)/den,s=cross(w,u)/den;
 return t>=-1e-8&&t<=1+1e-8&&s>=-1e-8&&s<=1+1e-8?[a[0]+t*u[0],a[1]+t*u[1]]:null;
}
function bounds(points) {
 const xs=points.map(p=>p[0]),ys=points.map(p=>p[1]);
 return [Math.min(...xs),Math.min(...ys),Math.max(...xs),Math.max(...ys)];
}

function intersects(a,b) {
 return a[0]<=b[2]+1e-8&&a[2]>=b[0]-1e-8&&a[1]<=b[3]+1e-8&&a[3]>=b[1]-1e-8;
}

function sharedDeparture(a,b,point) {
 const [x,y]=point;
 const near=p=>Math.hypot(x-p[0],y-p[1]);
 if(near(a.junction)<=66)return true;
 const first=a.samples[1],second=b.samples[1];
 return Math.hypot(first[0]-second[0],first[1]-second[1])<1e-6&&near(first)<1e-6;
}

export function traceLink(link,curveSteps){
 const samples=pathPoints(link.d,curveSteps);
 const segments=samples.slice(1).map((end,i)=>{
  const start=samples[i];
  return {start,end,bounds:bounds([start,end])};
 });
 return {...link,family:link.family||`u:${link.parents.slice().sort().join('+')}`,samples,segments,bounds:bounds(samples)};
}

function visibleCrossing(a,b,nodes,siblings,point) {
 if(!point||siblings&&sharedDeparture(a,b,point))return false;
 return !nodes.some(n=>Math.hypot(n.x-point[0],n.y-point[1])<=n.card.width/2+1);
}

export function pathCrossing(a,b,nodes,includeSiblingCrossings){
 const siblings=a.family===b.family;
 if(siblings&&(!includeSiblingCrossings||!a.junction||!b.junction))return null;
 if(!intersects(a.bounds,b.bounds))return null;
 for(const p of a.segments){
  if(!intersects(p.bounds,b.bounds))continue;
  for(const q of b.segments){
   if(!intersects(p.bounds,q.bounds))continue;
   const point=intersection(p.start,p.end,q.start,q.end,siblings);
   if(visibleCrossing(a,b,nodes,siblings,point))return point;
  }
 }
 return null;
}

export function crossingPairs(chart,{includeSiblingCrossings=false}={}){
 const links=chart.links.map(link=>traceLink(link));
 const crossings=[];
 for(let i=0;i<links.length;i++)for(let j=i+1;j<links.length;j++){
  const a=links[i],b=links[j],point=pathCrossing(a,b,chart.nodes,includeSiblingCrossings);
  if(point)crossings.push({a:a.id,b:b.id,point});
 }
 return crossings;
}
