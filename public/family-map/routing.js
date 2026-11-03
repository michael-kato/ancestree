import {bezierPath,segmentClearance} from './curves.js';
export const CLEARANCE=28;
export class RouteUnavailable extends Error {}
const EPS=1e-7;
const length=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);


const hits=(a,b,c,padding)=>segmentClearance(a,b,c)<padding-EPS;

const clear=(points,circles,padding)=>!circles.some(c=>points.slice(1).some((p,i)=>hits(points[i],p,c,padding)));

function coordinates(start,end,circles,padding,axis) {
  const key=axis?'y':'x';
  return [...new Set([start[axis],end[axis],...circles.flatMap(c=>[c[key]-c.r-padding,c[key]+c.r+padding])])].sort((a,b)=>a-b);
}

function neighbors(id,xs,ys) {
  const x=id%xs.length,y=Math.floor(id/xs.length),ids=[];
  if(x)ids.push(id-1);
  if(x<xs.length-1)ids.push(id+1);
  if(y)ids.push(id-xs.length);
  if(y<ys.length-1)ids.push(id+xs.length);
  return ids;
}

function enqueue(queue,entry) {
  let low=0,high=queue.length;
  while(low<high){
    const middle=Math.floor((low+high)/2);
    if(queue[middle].score>=entry.score)low=middle+1;
    else high=middle;
  }
  queue.splice(low,0,entry);
}

function visit(current,next,points,circles,padding,end,queue,best,previous,direction) {
  const a=points[current.id],b=points[next];
  if(circles.some(c=>hits(a,b,c,padding)))return;
  const axis=a[0]===b[0]?1:0,key=next*2+axis;
  if(current.initial&&axis===1&&(b[1]-a[1])*direction<-EPS)return;
  const cost=current.cost+length(a,b)+(axis===current.axis?0:12);
  if(cost>=(best.get(key)??Infinity))return;
  best.set(key,cost);previous.set(key,current.key);
  enqueue(queue,{id:next,key,axis,cost,score:cost+Math.abs(b[0]-end[0])+Math.abs(b[1]-end[1])});
}

function gridRoute(start,end,circles,padding,direction) {
  const xs=coordinates(start,end,circles,padding,0),ys=coordinates(start,end,circles,padding,1);
  const points=ys.flatMap(y=>xs.map(x=>[x,y]));
  const first=ys.indexOf(start[1])*xs.length+xs.indexOf(start[0]),last=ys.indexOf(end[1])*xs.length+xs.indexOf(end[0]);
  const axis=direction?1:0,key=first*2+axis;
  const queue=[{id:first,key,axis,cost:0,score:0,initial:true}],best=new Map([[key,0]]),previous=new Map();
  while(queue.length){
    const current=queue.pop();
    if(current.cost!==best.get(current.key))continue;
    if(current.id===last){
      const route=[];
      for(let key=current.key;key!==undefined;key=previous.get(key))route.unshift(points[Math.floor(key/2)]);
      return route;
    }
    for(const next of neighbors(current.id,xs,ys))visit(current,next,points,circles,padding,end,queue,best,previous,direction);
  }
  return null;
}

function simplify(points) {
  const result=[];
  for(const p of points){
    if(result.length&&length(result.at(-1),p)<EPS)continue;
    while(result.length>1){
      const a=result.at(-2),b=result.at(-1);
      if(Math.abs((b[0]-a[0])*(p[1]-b[1])-(b[1]-a[1])*(p[0]-b[0]))>EPS)break;
      result.pop();
    }
    result.push(p);
  }
  return result;
}

function route(start,end,circles,padding,direction=0) {
  const corner=direction&&(end[1]-start[1])*direction>=0?[start[0],end[1]]:[end[0],start[1]];
  let points=[start,corner,end];
  const blockers=new Set();
  for(;;){
    const added=circles.filter(c=>!blockers.has(c)&&!clear(points,[c],padding));
    if(!added.length)return simplify(points);
    added.forEach(c=>blockers.add(c));
    points=gridRoute(start,end,[...blockers],padding,direction);
    if(!points)return null;
  }
}

function frame(origin,normal) {
  const tangent=[normal[1],-normal[0]];
  return {
    local:([x,y])=>[(x-origin[0])*tangent[0]+(y-origin[1])*tangent[1],(x-origin[0])*normal[0]+(y-origin[1])*normal[1]],
    world:([x,y])=>[origin[0]+x*tangent[0]+y*normal[0],origin[1]+x*tangent[1]+y*normal[1]],
  };
}

const circlesIn=(nodes,basis)=>nodes.map(n=>{const [x,y]=basis.local([n.x,n.y]);return {x,y,r:n.card.width/2,id:n.id};});

function childCandidate(stem,target,entry,circles,padding,direction) {
  const port=[target.x+entry[0]*target.r,target.y+entry[1]*target.r];
  const approach=[target.x+entry[0]*(target.r+padding+16),target.y+entry[1]*(target.r+padding+16)];
  if(!clear([approach,port],circles.filter(c=>c.id!==target.id),padding))return null;
  const body=route(stem,approach,circles,padding,direction);
  return body?simplify([...body,port]):null;
}

function bestDeparture(stem,target,entries,circles,padding,direction) {
  const candidates=entries.map(entry=>childCandidate(stem,target,entry,circles,padding,direction)).filter(Boolean);
  const forward=candidates.filter(p=>Math.abs(p[1][0]-stem[0])>=EPS||(p[1][1]-stem[1])*direction>=-EPS);
  const score=p=>{const points=simplify([[0,0],...p]);return points.slice(1).reduce((sum,n,i)=>sum+length(points[i],n),points.length*24);};
  return forward.sort((a,b)=>score(a)-score(b))[0];
}

function aroundStartingCouple(target,entries,circles,padding) {
  const center=circles.filter(c=>Math.abs(c.y)<EPS&&c.id!==target.id);
  const side=target.x<0?-1:1;
  const below=Math.max(64,...center.map(c=>c.r+padding+16));
  const outside=Math.max(64,...center.map(c=>side*c.x+c.r+padding+16));
  const exit=[[0,0],[0,below],[side*outside,below]];
  if(!clear(exit,circles,padding))return null;
  const rest=bestDeparture(exit.at(-1),target,entries,circles,padding,0);
  return rest&&[...exit.slice(0,-1),...rest];
}

function perpendicularRoute(target,entries,circles,padding,sign) {
  for(const distance of [64,40])for(const direction of [sign,-sign]){
    const stem=[0,direction*distance];
    if(!clear([[0,0],stem],circles,padding))continue;
    const candidate=bestDeparture(stem,target,entries,circles,padding,direction);
    if(candidate)return [[0,0],...candidate];
  }
}

export function routeChild(junction,normal,child,nodes,padding=CLEARANCE,forward=false) {
  const origin=[junction.x,junction.y],basis=frame(origin,normal),circles=circlesIn(nodes,basis);
  const target=circles.find(c=>c.id===child.id),sign=forward||target.y>=0?1:-1;
  const entries=[[0,-sign],[target.x>=0?-1:1,0],[0,sign],[target.x>=0?1:-1,0]];
  const around=forward&&target.y<0&&aroundStartingCouple(target,entries,circles,padding);
  if(around)return around.map(basis.world);
  const candidate=perpendicularRoute(target,entries,circles,padding,sign);
  if(candidate)return candidate.map(basis.world);
  throw new RouteUnavailable(`No clear perpendicular departure for ${child.id}`);
}


function pairPorts(center,radius,id,circles,padding,directions) {
  const obstacles=circles.filter(c=>c.id!==id);
  return directions.map(direction=>{
    const port=center.map((value,i)=>value+direction[i]*radius);
    const stub=port.map((value,i)=>value+direction[i]*(padding+16));
    return {port,stub};
  }).filter(({port,stub})=>clear([port,stub],obstacles,padding));
}

function alternatePair(a,b,last,circles,padding) {
  const exits=pairPorts([0,0],a.card.width/2,a.id,circles,padding,[[1,0],[0,-1],[0,1],[-1,0]]);
  const entries=pairPorts(last,b.card.width/2,b.id,circles,padding,[[-1,0],[0,-1],[0,1],[1,0]]);
  for(const from of exits)for(const to of entries){
    const body=route(from.stub,to.stub,circles,padding);
    if(body)return simplify([from.port,...body,to.port]);
  }
}

export function routePair(a,b,nodes,padding=CLEARANCE) {
  const dx=b.x-a.x,dy=b.y-a.y,distance=Math.hypot(dx,dy),normal=[-dy/distance,dx/distance];
  const basis=frame([a.x,a.y],normal),circles=circlesIn(nodes,basis),last=basis.local([b.x,b.y]);
  const start=[a.card.width/2,0],end=[last[0]-b.card.width/2,0];
  const obstacles=circles.filter(c=>c.id!==a.id&&c.id!==b.id);
  if(clear([start,end],obstacles,padding))return [start,end].map(basis.world);
  const first=[start[0]+padding+16,0],final=[end[0]-padding-16,0];
  const body=route(first,final,circles,padding);
  if(body)return simplify([start,...body,end]).map(basis.world);
  const alternate=alternatePair(a,b,last,circles,padding);
  if(alternate)return alternate.map(basis.world);
  throw new RouteUnavailable(`No clear parent connector for ${a.id} and ${b.id}`);
}

export function splitConnector(points,nodes=[],parents=[]) {
  let remaining=points.slice(1).reduce((sum,p,i)=>sum+length(points[i],p),0)/2;
  for(let i=1;i<points.length;i++){
    const a=points[i-1],b=points[i],span=length(a,b);
    if(span<EPS)continue;
    if(remaining>span+EPS){remaining-=span;continue;}
    const x=a[0]+(b[0]-a[0])*remaining/span,y=a[1]+(b[1]-a[1])*remaining/span;
    return {junction:{x,y,normal:[-(b[1]-a[1])/span,(b[0]-a[0])/span]},paths:[bezierPath([...points.slice(0,i),[x,y]],nodes,parents.slice(0,1)),bezierPath([...points.slice(i).reverse(),[x,y]],nodes,parents.slice(1,2))]};
  }
  throw new Error('A parent connector must have positive length');
}
