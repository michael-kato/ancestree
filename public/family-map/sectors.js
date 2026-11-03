import {cardLayout} from '../view.js';
import {lifespan} from '../tree.js';
export const polar=(angle,radius)=>[Math.sin(angle)*radius,-Math.cos(angle)*radius];
const GAP=64,CENTER_GAP=80,GUTTER=20,SWEEP=2*Math.PI-0.6;
const ANCESTOR_SWEEP=4.6,DESCENDANT_SWEEP=Math.PI-0.3;
const PACKED_FAN_SWEEP=4.6,PACKED_FAN_MIN_BRANCHES=8;

function memberAngles(members,radius) {
  const angles=[0];
  for(let i=1;i<members.length;i++)angles.push(angles.at(-1)+2*Math.asin((members[i-1].card.width/2+members[i].card.width/2+GAP)/(2*radius)));
  return angles.map(a=>a-angles.at(-1)/2);
}

function demand(tree,step) {
  tree.eachAfter(n=>{
    if(!n.depth)return;
    const radius=n.depth*step,angles=memberAngles(n.data.members,radius);
    const own=angles.at(-1)-angles[0]+2*Math.asin((Math.max(...n.data.members.map(p=>p.card.width/2))+GAP/2)/radius);
    n.need=Math.max(own,groupNeed(n.children,(n.depth+1)*step));
  });
}

function groupNeed(group=[],radius) {
  return group.reduce((sum,n)=>sum+n.need,0)+Math.max(0,group.length-1)*GUTTER/radius;
}

function allocate(group=[],center,step,depth) {
  const radius=depth*step;
  let cursor=center-groupNeed(group,radius)/2;
  for(const n of group){
    n.radius=radius;
    n.low=cursor;n.high=cursor+n.need;n.angle=(n.low+n.high)/2;
    allocate(n.children,n.angle,step,depth+1);
    cursor=n.high+GUTTER/radius;
  }
}

function centralPositions(members,wide) {
  const width=members.reduce((sum,n)=>sum+n.card.width,0)+CENTER_GAP*(members.length-1);
  const [first,second]=members;
  const midpoint=wide&&members.length===2?(first.card.width-second.card.width)/2:0;
  let x=-width/2-midpoint;
  for(const n of members){n.x=x+n.card.width/2;n.y=0;n.angle=Math.atan2(n.x,-n.y);x+=n.card.width+CENTER_GAP;}
  return width;
}

function attachment(node,members,index) {
  const edge=index.edges.find(e=>e.id===node.data.ref),ids=members.map(p=>p.id);
  if(ids.includes(edge.data.child))return ids.indexOf(edge.data.child);
  const parents=index.unions.find(u=>u.children.includes(edge.data.child)).parents;
  return parents.reduce((sum,id)=>sum+ids.indexOf(id),0)/parents.length;
}

function fitStep(tree,ancestors,descendants,spacing,lowerSweep) {
  let step=spacing;
  for(;;){
    demand(tree,step);
    const above=groupNeed(ancestors,step),below=groupNeed(descendants,step);
    const scale=Math.max((above+below)/SWEEP,above/ANCESTOR_SWEEP,below/lowerSweep);
    if(scale<=1)return step;
    step*=scale*1.01;
  }
}

function fitFan(group,center,sweep,spacing) {
  let step=spacing;
  for(;;){
    for(const branch of group)demand(branch,step);
    const ratio=groupNeed(group,step)/sweep;
    if(ratio<=1)break;
    step*=ratio*1.01;
  }
  allocate(group,center,step,1);
}

function rootGroups(children=[],central,edges) {
  const ancestors=[],descendants=[];
  for(const n of children){
    const edge=edges.find(e=>e.id===n.data.ref);
    (central.has(edge.data.child)?ancestors:descendants).push(n);
  }
  return [ancestors,descendants];
}

function placeMembers(n,radius) {
  const offsets=memberAngles(n.data.members,radius);
  return n.data.members.map((p,i)=>{
    const angle=n.angle+offsets[i],[x,y]=polar(angle,radius);
    return {...p,angle,x,y,radius,packed:n.packed,sector:[n.low,n.high]};
  });
}

function fits(members,others) {
  return members.every(a=>others.every(b=>Math.hypot(a.x-b.x,a.y-b.y)>=(a.card.width+b.card.width)/2+64));
}

function compactGroup(n,groups,spacing) {
  const crowded=n.radius/n.depth>2*spacing;
  const retained=crowded?(n.packed?0.58:0.8):0.96;
  const min=Math.max(n.parent.placed[0].radius+spacing,n.radius*retained);
  if(min>=n.radius)return;
  const others=groups.filter(group=>group!==n).flatMap(group=>group.placed);
  for(let radius=min;radius<n.radius;radius+=32){
    const members=placeMembers(n,radius);
    if(!fits(members,others))continue;
    n.placed=members;
    break;
  }
}

function compactBranches(tree,spacing,packedBranches) {
  const groups=tree.descendants(),branches=groups.slice(1);
  tree.placed=tree.data.members.map(p=>({...p,radius:0,sector:[-Math.PI,Math.PI]}));
  for(const n of branches){
    n.packed=packedBranches.has(n.data.branch);
    n.placed=placeMembers(n,n.radius);
  }
  for(const n of branches)compactGroup(n,groups,spacing);
  return groups.flatMap(n=>n.placed);
}

function fitRootFans(tree,centralMembers,ancestors,descendants) {
  const wide=descendants.length>=PACKED_FAN_MIN_BRANCHES;
  const centerWidth=centralPositions(centralMembers,wide);
  const spacing=Math.max(centerWidth/2+120,...tree.descendants().flatMap(n=>n.data.members.map(p=>p.card.width+120)));
  const lowerSweep=wide?PACKED_FAN_SWEEP:DESCENDANT_SWEEP;
  const step=fitStep(tree,ancestors,descendants,spacing,lowerSweep);
  const upper=Math.min(ANCESTOR_SWEEP,SWEEP-groupNeed(descendants,step));
  fitFan(ancestors,0,upper,spacing);
  fitFan(descendants,Math.PI,Math.min(lowerSweep,SWEEP-upper),spacing);
  const packedBranches=new Set(wide?descendants.map(n=>n.data.id):[]);
  return {spacing,step,packedBranches};
}

export function sectorLayout(root,index,blocks,start,d3,measure,fullName) {
  const tree=d3.hierarchy(root),central=new Set(blocks.get(root.id));
  for(const n of tree.descendants())n.data.members=blocks.get(n.data.id).map(id=>{
    const person=index.people.get(id),name=fullName(person.data);
    return {id,name,card:cardLayout(name,lifespan(person.data),false,measure),depth:n.depth,branch:n.data.branch,cohort:n.data.id};
  });
  const centralMembers=tree.data.members;
  centralMembers.sort((a,b)=>a.id===start?-1:b.id===start?1:0);
  for(const n of tree.descendants())n.children?.sort((a,b)=>attachment(a,n.data.members,index)-attachment(b,n.data.members,index));
  const [ancestors,descendants]=rootGroups(tree.children,central,index.edges);
  const {spacing,step,packedBranches}=fitRootFans(tree,centralMembers,ancestors,descendants);
  const nodes=compactBranches(tree,spacing,packedBranches);
  return {nodes,step};
}
