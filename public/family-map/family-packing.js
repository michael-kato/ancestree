const GAP=68;

function bounds(people) {
  const left=Math.min(...people.map(p=>p.x-p.card.width/2));
  const right=Math.max(...people.map(p=>p.x+p.card.width/2));
  const top=Math.min(...people.map(p=>p.y-p.card.width/2));
  const bottom=Math.max(...people.map(p=>p.y+p.card.width/2));
  return {left,right,top,bottom,width:right-left};
}

function rowPeople(group) {
  const width=group.reduce((sum,p)=>sum+p.card.width,0)+GAP*(group.length-1);
  let cursor=-width/2;
  return group.map(p=>{
    const x=cursor+p.card.width/2;
    cursor+=p.card.width+GAP;
    return {...p,x,y:0};
  });
}

function childRows(children) {
  const columns=Math.ceil(Math.sqrt(children.length*1.25));
  const rows=[];
  for(let i=0;i<children.length;i+=columns)rows.push(children.slice(i,i+columns));
  return rows;
}

function buildPatch(branch,groups) {
  const people=rowPeople(groups.get(branch.id));
  const children=branch.children.map(child=>buildPatch(child,groups));
  let top=bounds(people).bottom+138;
  for(const [i,row] of childRows(children).entries()){
    const width=row.reduce((sum,p)=>sum+p.box.width,0)+GAP*(row.length-1);
    let left=-width/2+(i%2?55:0);
    let height=0;
    for(const patch of row){
      const dx=left-patch.box.left,dy=top-patch.box.top;
      for(const person of patch.people)people.push({...person,x:person.x+dx,y:person.y+dy});
      left+=patch.box.width+GAP;
      height=Math.max(height,patch.box.bottom-patch.box.top);
    }
    top+=height+GAP;
  }
  return {people,box:bounds(people)};
}

function projectedPatch(patch,axis,distance) {
  const [x,y]=axis;
  return patch.people.map(p=>{
    const outward=distance+p.y;
    const px=p.x*y+x*outward,py=-p.x*x+y*outward;
    return {...p,x:px,y:py,radius:Math.hypot(px,py),angle:Math.atan2(px,-py),free:true};
  });
}

function separates(people,placed) {
  return people.every(a=>placed.every(b=>Math.hypot(a.x-b.x,a.y-b.y)>=(a.card.width+b.card.width)/2+GAP-1e-6));
}

function placePatch(branch,patch,groups,placed) {
  const group=groups.get(branch.id);
  const dx=group.reduce((sum,p)=>sum+p.x,0),dy=group.reduce((sum,p)=>sum+p.y,0),r=Math.hypot(dx,dy);
  const bearing=Math.atan2(dx/r,-dy/r);
  for(let distance=335;distance<=12000;distance+=44)for(const offset of [0,0.12,-0.12,0.24,-0.24,0.36,-0.36]){
    const angle=bearing+offset,axis=[Math.sin(angle),-Math.cos(angle)];
    const people=projectedPatch(patch,axis,distance);
    if(!separates(people,placed))continue;
    return people;
  }
}

function turnCouple(group,parent,others) {
  const [a,b]=group;
  const x=(a.x+b.x)/2,y=(a.y+b.y)/2;
  const px=parent.reduce((sum,p)=>sum+p.x,0)/parent.length;
  const py=parent.reduce((sum,p)=>sum+p.y,0)/parent.length;
  const current=Math.atan2(b.y-a.y,b.x-a.x);
  const turn=Math.atan2(y-py,x-px)+Math.PI/2-current;
  const angle=Math.atan2(Math.sin(2*turn),Math.cos(2*turn))/2;
  for(const amount of [1,0.6,0.3]){
    const cos=Math.cos(angle*amount),sin=Math.sin(angle*amount);
    const candidate=group.map(p=>{
      const dx=p.x-x,dy=p.y-y;
      return {...p,x:x+dx*cos-dy*sin,y:y+dx*sin+dy*cos};
    });
    if(!separates(candidate,others))continue;
    return candidate.map(p=>({...p,radius:Math.hypot(p.x,p.y),angle:Math.atan2(p.x,-p.y)}));
  }
  return group;
}

function orientPairs(tree,placed) {
  const groups=new Map();
  for(const p of placed){
    if(!groups.has(p.cohort))groups.set(p.cohort,[]);
    groups.get(p.cohort).push(p);
  }
  function visit(branch,parent) {
    let group=groups.get(branch.id);
    if(group[0].free&&branch.depth>=2&&group.length===2){
      const other=[...groups.entries()].filter(([id])=>id!==branch.id).flatMap(([,p])=>p);
      group=turnCouple(group,parent,other);
      groups.set(branch.id,group);
    }
    for(const child of branch.children)visit(child,group);
  }
  visit(tree,null);
  return [...groups.values()].flat();
}

export function packFamilies(nodes,tree) {
  const groups=new Map();
  for(const person of nodes){
    if(!groups.has(person.cohort))groups.set(person.cohort,[]);
    groups.get(person.cohort).push(person);
  }
  const branches=tree.children.filter(branch=>groups.get(branch.id)[0].packed);
  if(!branches.length)return null;
  const placed=nodes.filter(n=>!n.packed);
  for(const branch of branches){
    const patch=buildPatch(branch,groups);
    const people=placePatch(branch,patch,groups,placed);
    if(!people)return null;
    placed.push(...people);
  }
  const byId=new Map(orientPairs(tree,placed).map(p=>[p.id,p]));
  return nodes.map(p=>byId.get(p.id));
}
