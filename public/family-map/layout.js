import {isLive,relationshipDistances,displayName,familyGraph,partnerBlocks} from '../tree.js';
import {sectorLayout,polar} from './sectors.js';
import {familyRoute,fanCurve,localFanCurve,circlePort} from './family-routes.js';
import {packFamilies} from './family-packing.js';
import {reduceCrossings} from './route-crossings.js';
import {bezierPath,clearCubicPath} from './curves.js';
import {routeChild,routePair,splitConnector,RouteUnavailable} from './routing.js';

export const fullName=d=>d.nickname&&d.given?`${d.given} “${d.nickname}” ${d.surname||''}`.trim():displayName(d)||'Unknown';

const endpoints=e=>e.kind==='parent'?[e.data.parent,e.data.child]:[e.data.a,e.data.b];
const role=(e,from)=>e.kind==='partner'?1:e.data.child===from?0:2;
const familyKey=(e,parents)=>e.kind==='partner'?`pair:${[e.data.a,e.data.b].sort().join('+')}`:`parents:${parents.get(e.data.child).slice().sort().join('+')}`;

function orderedRelatives(id,list,people,family) {
  return list.sort((a,b)=>role(a.edge,id)-role(b.edge,id)||family(a.edge).localeCompare(family(b.edge))||(people.get(a.id).data.birth||'9999').localeCompare(people.get(b.id).data.birth||'9999')||a.id.localeCompare(b.id));
}

function relationIndex(state) {
  const people=new Map([...state.entities].filter(([,p])=>isLive(p)&&p.kind==='person'));
  const adj=new Map([...people.keys()].map(id=>[id,[]]));
  const parents=new Map();
  const edges=[...state.entities.values()].filter(e=>isLive(e)&&e.kind!=='person');
  for(const e of edges){
    const [a,b]=endpoints(e);
    if(!adj.has(a)||!adj.has(b))throw new Error(`Missing person in relationship ${e.id}`);
    adj.get(a).push({id:b,edge:e});adj.get(b).push({id:a,edge:e});
    if(e.kind==='parent'){if(!parents.has(b))parents.set(b,[]);parents.get(b).push(a);}
  }
  const family=e=>familyKey(e,parents);
  for(const [id,list] of adj)orderedRelatives(id,list,people,family);
  return {people,adj,edges,family,unions:familyGraph(state).unions};
}

function breadthTree(index,start,maxDepth) {
  const root={id:start,depth:0,children:[],branch:start,family:''};
  const seen=new Set([start]),queue=[root];
  for(const node of queue){
    if(node.depth>=maxDepth)continue;
    for(const relative of index.adj.get(node.id)){
      if(seen.has(relative.id))continue;
      seen.add(relative.id);
      const child={id:relative.id,depth:node.depth+1,children:[],branch:node.depth?node.branch:relative.id,parent:node.id,ref:relative.edge.id,family:index.family(relative.edge)};
      node.children.push(child);queue.push(child);
    }
  }
  return root;
}

export {polar};

function arc(radius,start,end) {
  const p=polar(end,radius);
  return `A${radius},${radius} 0 ${Math.abs(end-start)>Math.PI?1:0},${end>start?1:0} ${p}`;
}

function orderedPartners(state,ids,people) {
  const blocks=partnerBlocks(state,ids.map(id=>people.get(id)));
  return blocks.flatMap(block=>ids.indexOf(block[0])>ids.indexOf(block.at(-1))?block.reverse():block);
}

function familyBlocks(index,start,state) {
  const owner=new Map([...index.people.keys()].map(id=>[id,id]));
  const find=id=>{while(owner.get(id)!==id)id=owner.get(id);return id;};
  for(const union of index.unions){
    const members=union.parents;
    for(const id of members.slice(1))owner.set(find(id),find(members[0]));
  }
  const blocks=new Map();
  for(const id of owner.keys()){
    const key=find(id);
    if(!blocks.has(key))blocks.set(key,[]);
    blocks.get(key).push(id);
  }
  for(const [key,ids] of blocks)if(ids.length>2){
    blocks.set(key,orderedPartners(state,ids,index.people));
  }
  const adj=new Map([...blocks.keys()].map(id=>[id,[]]));
  for(const [id,list] of index.adj)for(const relative of list){
    const a=find(id),b=find(relative.id);
    if(a!==b)adj.get(a).push({...relative,id:b});
  }
  return {blocks,adj,family:index.family,start:find(start)};
}

function connectorLane(parents,nodes) {
  const ordered=parents.slice().sort((a,b)=>a.angle-b.angle);
  const first=ordered[0],last=ordered.at(-1);
  const band=nodes.filter(n=>n.radius===first.radius);
  const blocked=band.some(n=>!parents.includes(n)&&n.angle>first.angle&&n.angle<last.angle);
  const clearance=Math.max(...band.map(n=>n.card.width/2))+40;
  const radius=parents.length>2||blocked?first.radius+clearance:first.radius;
  return {radius,angle:(first.angle+last.angle)/2};
}

function packedParentLane(parents,nodes) {
  const a=parents[0],b=parents.at(-1),span=Math.hypot(b.x-a.x,b.y-a.y);
  const outward=[(a.y-b.y)/span,(b.x-a.x)/span];
  const clearance=Math.max(...parents.map(p=>p.card.width/2))+40;
  for(const sign of [1,-1]){
    const normal=outward.map(value=>value*sign);
    const shift=(p,amount)=>[p.x+normal[0]*amount,p.y+normal[1]*amount];
    const [x,y]=shift({x:(a.x+b.x)/2,y:(a.y+b.y)/2},clearance);
    const paths=parents.map(p=>{
      const start=shift(p,p.card.width/2),corner=shift(p,clearance);
      return clearCubicPath([[start,corner],[corner,[x,y]]],nodes,p.id);
    });
    if(paths.every(Boolean))return {paths,junction:{x,y,normal,depth:a.depth}};
  }
  throw new RouteUnavailable('No clear connector for the packed parent group');
}

function familyConnector(parents,nodes) {
  const [first,second]=parents;
  if(first.free&&parents.length>2)return packedParentLane(parents,nodes);
  if(!first.depth||first.free){
    const connector=splitConnector(routePair(first,second,nodes),nodes,parents.map(p=>p.id));
    connector.junction.depth=first.depth;
    return connector;
  }
  const {radius,angle}=connectorLane(parents,nodes);
  const [x,y]=polar(angle,radius);
  const junction={x,y,angle,radius,depth:first.depth,card:{width:0}};
  const paths=parents.map(p=>{
    if(radius!==first.radius)return `M${circlePort(p,polar(p.angle,radius))}L${polar(p.angle,radius)}${arc(radius,p.angle,angle)}`;
    const direction=angle>p.angle?1:-1,port=p.angle+direction*2*Math.asin(p.card.width/(4*radius));
    return `M${polar(port,radius)}${arc(radius,port,angle)}`;
  });
  return {junction,paths};
}

function directLinks(records,positions,parents,nodes) {
  return records.map(e=>{
    const [a,b]=endpoints(e),A=positions.get(a),B=positions.get(b),points=routePair(A,B,nodes);
    return {id:e.id,source:a,target:b,refs:[e.id],parents,kind:e.kind,type:e.data.type,points,d:bezierPath(points,nodes,[a,b])};
  });
}

const parentType=edges=>edges.filter(e=>e.kind==='parent').map(e=>e.data.type).find(type=>type!=='birth');

function familyRecords(union,positions,edges) {
  return edges.filter(e=>e.kind==='parent'?union.parents.includes(e.data.parent)&&union.children.includes(e.data.child)&&positions.has(e.data.child):union.parents.length===2&&union.parents.includes(e.data.a)&&union.parents.includes(e.data.b));
}

function childRoute(junction,child,parents,step,track,nodes) {
  if(!parents[0].free&&!child.free)return familyRoute(junction,child,step,track,nodes);
  const normal=junction.normal||polar(junction.angle,1);
  const dot=normal[0]*(child.x-junction.x)+normal[1]*(child.y-junction.y);
  const departure=dot>=0?normal:normal.map(value=>-value);
  return {normal:departure,points:routeChild(junction,departure,child,nodes)};
}

function childLink(child,{parents,children,junction,records,nodes,step,track,key}) {
  const edges=records.filter(e=>e.kind==='parent'&&e.data.child===child.id);
  const route=childRoute(junction,child,parents,step,track,nodes);
  const {normal,points,band}=route;
  const local=child.packed&&junction.depth&&localFanCurve(route,junction,child,nodes,children);
  const curve=local||((parents[0].depth||children.length>2)&&fanCurve(route,junction,child,nodes,children));
  return {
    id:`${key}:${child.id}`,source:parents[0].id,target:child.id,refs:edges.map(e=>e.id),
    parents:parents.map(p=>p.id),kind:'parent',type:parentType(edges),family:key,
    junction:[junction.x,junction.y],normal,points,d:curve||bezierPath(points,nodes,[child.id],band)
  };
}

function unionLinks(union,positions,index,nodes,track,step) {
  const parents=union.parents.map(id=>positions.get(id));
  const children=union.children.map(id=>positions.get(id)).filter(Boolean);
  const records=familyRecords(union,positions,index.edges);
  if(!records.length)return [];
  const ids=parents.map(p=>p.id),key=union.id;
  if(!children.length||parents.length<2||(parents.length>2&&!parents[0].depth))return directLinks(records,positions,ids,nodes);
  const {junction,paths}=familyConnector(parents,nodes);
  const links=parents.map((p,i)=>({id:`${key}:${p.id}`,source:p.id,target:p.id,refs:records.filter(e=>endpoints(e).includes(p.id)).map(e=>e.id),parents:ids,kind:'union',type:parentType(records.filter(e=>e.data.parent===p.id)),family:key,d:paths[i]}));
  const family={parents,children,junction,records,nodes,step,track,key};
  for(const child of children)links.push(childLink(child,family));
  return links;
}

function drawFamilies(nodes,step,index,state,start) {
  const positions=new Map(nodes.map(n=>[n.id,n])),distances=relationshipDistances(state,start);
  const routes=[breadthTree(index,start,Infinity)];
  for(const route of routes){
    routes.push(...route.children);
    const n=positions.get(route.id);
    if(n)Object.assign(n,{parent:route.parent,ref:route.ref,distance:distances.get(n.id),more:index.adj.get(n.id).filter(r=>!positions.has(r.id)).length});
  }
  const visible=index.unions.filter(u=>u.parents.every(id=>positions.has(id)));
  const links=visible.flatMap((union,i)=>unionLinks(union,positions,index,nodes,0.25+0.5*i/Math.max(1,visible.length-1),step));
  reduceCrossings(links,nodes,positions);
  return {nodes,links,other:[],step,beyond:distances.size-nodes.length,disconnected:index.people.size-distances.size};
}

export function relationshipRings(state,start,maxDepth,d3,measure=text=>[...text].length*8) {
  const index=relationIndex(state);
  if(!index.people.has(start))return {nodes:[],links:[],other:[],step:210,beyond:0,disconnected:index.people.size};
  const grouped=familyBlocks(index,start,state);
  const tree=breadthTree(grouped,grouped.start,maxDepth);
  const {nodes:seed,step,packedAncestors}=sectorLayout(tree,index,grouped.blocks,start,d3,measure,fullName);
  const descendants=packFamilies(seed,tree);
  const both=packedAncestors.length?packFamilies(descendants||seed,tree,packedAncestors):null;
  for(const nodes of [both,descendants]){
    if(!nodes)continue;
    try{return drawFamilies(nodes,step,index,state,start);}
    catch(error){if(!(error instanceof RouteUnavailable))throw error;}
  }
  return drawFamilies(seed,step,index,state,start);
}
