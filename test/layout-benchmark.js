import assert from 'node:assert/strict';import fs from 'node:fs';import * as force from 'd3-force';import * as T from '../public/tree.js';import * as G from '../public/view.js';import {familyLayout} from '../public/layout.js';
assert.ok(process.argv[2], 'Usage: node test/layout-benchmark.js snapshot.json');
const {entities,tree}=JSON.parse(fs.readFileSync(process.argv[2]));const state=T.fromRows(tree.seq,entities),graph=T.familyGraph(state),cards=new Map(graph.people.map(p=>[p.id,G.cardLayout([p.data.given,p.data.nickname && `“${p.data.nickname}”`,p.data.surname].filter(Boolean).join(' ') || 'Unknown',T.lifespan(p.data),Boolean(p.data.photo),t=>t.length*8)]));const start=performance.now();const {pos,layout}=familyLayout(graph,cards,force),paths=G.connectionPaths(state,graph,pos);let collisions=0,nodeHits=0,overlaps=0,crossings=0;const people=graph.people.map(p=>({id:p.id,...pos.get(p.id)}));
for(let i=0;i<people.length;i++)for(let j=i+1;j<people.length;j++){const a=people[i],b=people[j];if(Math.hypot(a.x+a.width/2-b.x-b.width/2,a.y+a.height/2-b.y-b.height/2)<(a.width+b.width)/2)collisions++;}
const segments=paths.flatMap(p=>p.points.slice(1).map((b,i)=>({a:p.points[i],b,family:p.family,id:p.id})));
for(const {a,b} of segments)for(const c of people){const cx=c.x+c.width/2,cy=c.y+c.height/2,dx=b[0]-a[0],dy=b[1]-a[1],t=Math.max(0,Math.min(1,((cx-a[0])*dx+(cy-a[1])*dy)/(dx*dx+dy*dy||1)));if(Math.hypot(cx-a[0]-t*dx,cy-a[1]-t*dy)<c.width/2-0.01)nodeHits++;}
const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
for(let i=0;i<segments.length;i++)for(let j=i+1;j<segments.length;j++){
 const {a,b,family}=segments[i],{a:c,b:d,family:other}=segments[j];if(family===other)continue;
 if(cross(a,b,c)*cross(a,b,d)<-1e-6&&cross(c,d,a)*cross(c,d,b)<-1e-6)crossings++;
 if(Math.abs(cross(a,b,c))>1e-6||Math.abs(cross(a,b,d))>1e-6)continue;
 const axis=Math.abs(b[0]-a[0])>Math.abs(b[1]-a[1])?0:1;
 if(Math.min(Math.max(a[axis],b[axis]),Math.max(c[axis],d[axis]))-Math.max(Math.min(a[axis],b[axis]),Math.min(c[axis],d[axis]))>0.01)overlaps++;
}
const report={people:people.length,families:graph.unions.length,paths:paths.length,collisions,nodeHits,unrelatedSharedSegments:overlaps,crossings,layout,milliseconds:performance.now()-start};console.log(report);assert.equal(collisions,0);assert.equal(nodeHits,0);assert.equal(overlaps,0);assert.equal(new Set(paths.map(p=>p.d)).size,paths.length);const refs=new Set(paths.flatMap(p=>p.refs));assert.ok(entities.filter(e=>e.kind!=='person'&&!e.deleted).every(e=>refs.has(e.id)));
