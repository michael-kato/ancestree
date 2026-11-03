import {polar} from './sectors.js';
import {clearCubicPath,segmentClearance} from './curves.js';
import {routeChild,CLEARANCE} from './routing.js';
function normalToward(junction,child) {
  const [x,y]=junction.normal;
  const dot=child.packed?y:x*(child.x-junction.x)+y*(child.y-junction.y);
  return dot>=0?[x,y]:[-x,-y];
}

function sectorRoute(junction,child,step,track) {
  const start=[junction.x,junction.y],sourceRadius=Math.hypot(...start),targetRadius=child.radius;
  const outward=targetRadius>sourceRadius;
  const direction=outward?1:-1;
  const departure=junction.normal?normalToward(junction,child):polar(junction.angle,direction);
  const first=[start[0]+departure[0]*64,start[1]+departure[1]*64];
  const angle=sourceRadius>1e-6?Math.atan2(start[0],-start[1]):Math.atan2(departure[0],-departure[1]);
  let targetAngle=child.depth?child.angle:angle;
  while(targetAngle-angle>Math.PI)targetAngle-=2*Math.PI;
  while(targetAngle-angle<-Math.PI)targetAngle+=2*Math.PI;
  const radius=sourceRadius+(targetRadius-sourceRadius)*(0.4+track*0.2);
  const count=Math.max(1,Math.ceil(Math.abs(targetAngle-angle)/(Math.PI/16)));
  const points=[start,first,polar(angle,radius)];
  for(let i=1;i<=count;i++)points.push(polar(angle+(targetAngle-angle)*i/count,radius));
  const end=child.depth?polar(child.angle,child.radius-direction*child.card.width/2):circlePort(child,points.at(-1));
  points.push(end);
  return {points,normal:departure,angles:[angle,targetAngle],band:{inner:Math.max(0,Math.min(sourceRadius,targetRadius)-step*0.02),outer:Math.max(sourceRadius,targetRadius)+step*0.02}};
}

export function circlePort(child,from) {
  const dx=from[0]-child.x,dy=from[1]-child.y,scale=child.card.width/2/Math.hypot(dx,dy);
  return [child.x+dx*scale,child.y+dy*scale];
}

export function familyRoute(junction,child,step,track,nodes) {
  const route=sectorRoute(junction,child,step,track),{points}=route;
  const clear=nodes.every(n=>{
    const circle={x:n.x,y:n.y,r:n.card.width/2};
    return points.slice(1).every((p,i)=>{
      const padding=n.id===child.id&&i===points.length-2?0:CLEARANCE;
      return segmentClearance(points[i],p,circle)>=padding-1e-7;
    });
  });
  return clear?route:{normal:route.normal,points:routeChild(junction,route.normal,child,nodes,CLEARANCE,Boolean(child.packed&&junction.normal))};
}

function sampleTurn(t,startAngle,turn,startRadius,radialChange) {
  const turnProgress=t*t*t*(10-15*t+6*t*t);
  const turnRate=30*t*t*(1-t)*(1-t);
  return {
    angle:startAngle+turn*turnProgress,
    radius:startRadius+t*radialChange,
    tangent:turn*turnRate
  };
}

function polarSegment(previous,next) {
  const low=Math.min(previous.angle,next.angle),high=Math.max(previous.angle,next.angle);
  const first=Math.max(low,Math.min(high,previous.angle+previous.tangent/18));
  const second=Math.max(low,Math.min(high,next.angle-next.tangent/18));
  const gap=(next.radius-previous.radius)/3;
  return [
    polar(previous.angle,previous.radius),
    polar(first,previous.radius+gap),
    polar(second,next.radius-gap),
    polar(next.angle,next.radius)
  ];
}

function tangentControl(sample,offset,direction) {
  const position=polar(sample.angle,sample.radius);
  const radial=polar(sample.angle,offset);
  const tangent=polar(sample.angle+Math.PI/2,sample.radius*sample.tangent/18);
  return position.map((value,i)=>value+radial[i]+direction*tangent[i]);
}

function tangentSegment(previous,next) {
  const gap=(next.radius-previous.radius)/3;
  const a=tangentControl(previous,gap,1);
  const b=tangentControl(next,-gap,-1);
  return [polar(previous.angle,previous.radius),a,b,polar(next.angle,next.radius)];
}

function turnFinish(origin,direction,siblings,nodes) {
  const sameSide=siblings.filter(person=>person.depth&&Math.sign(person.radius-origin)===direction);
  return Math.min(...sameSide.map(person=>{
    const clearance=Math.max(...nodes.filter(n=>n.radius===person.radius).map(n=>n.card.width/2))+36;
    return Math.abs(person.radius-origin)-clearance;
  }));
}

export function localFanCurve(route,junction,child,nodes,siblings) {
  const start=[junction.x,junction.y],normal=route.normal;
  const projection=person=>(person.x-start[0])*normal[0]+(person.y-start[1])*normal[1]-person.card.width/2;
  const nearest=Math.min(...siblings.map(projection).filter(distance=>distance>0));
  const distance=projection(child);
  if(distance<=0||nearest<100)return null;
  const shift=(point,amount)=>point.map((value,i)=>value+normal[i]*amount);
  const end=shift([child.x,child.y],-child.card.width/2);
  const turn=shift(end,nearest-distance);
  const a=shift(start,nearest/2),b=shift(turn,-nearest/2);
  return clearCubicPath([[start,a,b,turn],[turn,end]],nodes,child.id);
}

export function fanCurve(route,junction,child,nodes,siblings) {
  if(!route.angles||!child.depth)return null;
  const start=route.points[0],end=route.points.at(-1);
  const origin=Math.hypot(...start),direction=Math.sign(child.radius-origin);
  const [angle,targetAngle]=route.angles;
  if(origin>1e-6&&junction.normal)return null;
  const departure=Math.max(64,...nodes.filter(n=>n.radius===junction.radius).map(n=>n.card.width/2+36));
  const startRadius=origin+direction*departure;
  const first=polar(angle,startRadius);
  const change=direction*(turnFinish(origin,direction,siblings,nodes)-departure);
  if(change*direction<=0)return null;
  const turn=targetAngle-angle;
  const segments=[[start,first]];
  const curveSegment=child.packed?polarSegment:tangentSegment;
  let previous=sampleTurn(0,angle,turn,startRadius,change);
  for(let i=1;i<=6;i++){
    const next=sampleTurn(i/6,angle,turn,startRadius,change);
    segments.push(curveSegment(previous,next));
    previous=next;
  }
  segments.push([polar(previous.angle,previous.radius),end]);
  return clearCubicPath(segments,nodes,child.id);
}
