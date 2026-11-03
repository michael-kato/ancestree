import {roundedPath} from '../view.js';
const EPS=1e-7;
const distance=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
const mix=(a,b,t)=>a.map((v,i)=>v+(b[i]-v)*t);
const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);

export function segmentClearance(a,b,c) {
  const dx=b[0]-a[0],dy=b[1]-a[1];
  const t=Math.max(0,Math.min(1,((c.x-a[0])*dx+(c.y-a[1])*dy)/(dx*dx+dy*dy||1)));
  return Math.hypot(a[0]+t*dx-c.x,a[1]+t*dy-c.y)-c.r;
}

function hull(points) {
  const sorted=points.slice().sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
  const chain=list=>{
    const side=[];
    for(const p of list){while(side.length>1&&cross(side.at(-2),side.at(-1),p)<=EPS)side.pop();side.push(p);}
    return side.slice(0,-1);
  };
  return [...chain(sorted),...chain(sorted.slice().reverse())];
}

function outside(polygon,circle) {
  const point=[circle.x,circle.y];
  if(polygon.length>2&&polygon.every((p,i)=>cross(p,polygon[(i+1)%polygon.length],point)>=-EPS))return false;
  return polygon.every((p,i)=>segmentClearance(p,polygon[(i+1)%polygon.length],circle)>=-EPS);
}

function split(controls) {
  const left=[controls[0]],right=[controls.at(-1)];
  for(let row=controls;row.length>1;){row=row.slice(1).map((p,i)=>mix(row[i],p,0.5));left.push(row[0]);right.unshift(row.at(-1));}
  return [left,right];
}

function curveClear(controls,circles,depth=0) {
  const polygon=hull(controls),blocked=circles.filter(c=>!outside(polygon,c));
  if(!blocked.length)return true;
  if(depth===10)return false;
  if(blocked.some(c=>segmentClearance(controls[0],controls[0],c)<-EPS||segmentClearance(controls.at(-1),controls.at(-1),c)<-EPS))return false;
  return split(controls).every(part=>curveClear(part,blocked,depth+1));
}

function protectedCircles(nodes,incident) {
  return nodes.map(n=>({x:n.x,y:n.y,r:n.card.width/2+(incident.includes(n.id)?0:28)}));
}

export function clearCubicPath(segments,nodes,target) {
  const circles=protectedCircles(nodes,[target]);
  if(!segments.every(controls=>curveClear(controls,circles)))return null;
  return `M${segments[0][0]}`+segments.map(controls=>{
    const command=controls.length===2?'L':'C';
    return command+controls.slice(1).join(' ');
  }).join('');
}

function corners(points,radius) {
  return points.slice(1,-1).map((p,i)=>{
    const a=points[i],b=points[i+2],incoming=distance(a,p),outgoing=distance(p,b);
    const r=Math.min(radius,incoming/2,outgoing/2);
    return [mix(p,a,r/incoming),p,mix(p,b,r/outgoing)];
  });
}

function cubicPath(points,band,isClear) {
  const start=points[0],end=points.at(-1),first=points[1],last=points.at(-2);
  const span=distance(start,end),r0=Math.hypot(...start),r1=Math.hypot(...end);
  const fractions=band?[0.5,0.65,0.8,0.35,0.2]:[0.5,0.3,0.15];
  for(const fraction of fractions){
    const radius=r0+(r1-r0)*fraction;
    const out=band?Math.abs(radius-r0):span*fraction;
    const entry=band?Math.abs(radius-r1):span*fraction;
    const a=mix(start,first,out/distance(start,first)),b=mix(end,last,entry/distance(end,last));
    if(isClear([start,a,b,end]))return `M${start}C${a} ${b} ${end}`;
  }
}

export function bezierPath(points,nodes=[],incident=[],band) {
  const clean=points.filter((p,i)=>!i||distance(p,points[i-1])>EPS);
  if(clean.length<2)return roundedPath(clean);
  const circles=protectedCircles(nodes,incident);
  if(band?.inner>28)circles.push({x:0,y:0,r:band.inner});
  const isClear=controls=>(!band||controls.every(p=>Math.hypot(...p)<=band.outer+EPS))&&curveClear(controls,circles);
  const cubic=cubicPath(clean,band,isClear);
  return cubic||smoothGuide(clean,isClear);
}

function smoothGuide(clean,isClear) {
  for(let radius=32;radius>=0.125;radius/=2)if(corners(clean,radius).every(isClear))return roundedPath(clean,radius);
  return clean.map((p,i)=>`${i?'L':'M'}${p}`).join('');
}
