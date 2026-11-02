import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as force from 'd3-force';
import { familyLayout } from '../public/layout.js';
import { familyGraph, fromRows } from '../public/tree.js';
import { cardLayout, connectionPaths, fitTransform, ZOOM_EXTENT } from '../public/view.js';
const person = (id) => ({id,kind:'person',deleted:0,created_seq:1,data:{given:id}});
const parent = (id,p,c,type='birth') => ({id,kind:'parent',deleted:0,data:{parent:p,child:c,type}});
const fixture = () => fromRows(1,[...['a','b','c','d','e','f','isolated'].map(person),parent('ac','a','c'),parent('bc','b','c'),parent('ad','a','d'),parent('bd','b','d'),parent('af','a','f'),parent('ef','e','f','adoptive'),{id:'ab',kind:'partner',deleted:0,data:{a:'a',b:'b'}}]);
const cardsFor = (g) => new Map(g.people.map(p=>[p.id,cardLayout(p.id,'1900–1980',false,s=>s.length*8)]));

test('families occupy both axes with no circle collisions and repeatable positions', () => {
 const state=fixture(),graph=familyGraph(state),cards=cardsFor(graph),snapshot=structuredClone(graph);
 const {pos,layout}=familyLayout(graph,cards,force);
 assert.deepEqual(familyLayout(graph,cards,force),{pos,layout});
 assert.deepEqual(graph,snapshot);
 assert.equal(pos.size,graph.people.length+graph.unions.length);
 const people=graph.people.map(p=>pos.get(p.id));
 for(const p of graph.people){assert.equal(pos.get(p.id).width,cards.get(p.id).width);assert.equal(pos.get(p.id).height,cards.get(p.id).height);}
 for(let i=0;i<people.length;i++)for(let j=i+1;j<people.length;j++){
  const a=people[i],b=people[j];
  assert.ok(Math.hypot(a.x+a.width/2-b.x-b.width/2,a.y+a.height/2-b.y-b.height/2)>=(a.width+b.width)/2+10);
 }
 assert.ok(people.every(p=>p.x>=0&&p.y>=0&&p.x+p.width<=layout.width&&p.y+p.height<=layout.height));
 assert.ok(Math.abs(pos.get('a').y-pos.get('b').y)>1);
 assert.ok(Math.abs(pos.get('c').y-pos.get('d').y)>1);
 const paths=connectionPaths(state,graph,pos);
 assert.ok(paths.length>0);
 assert.equal(new Set(paths.map(p=>p.d)).size,paths.length);
 const refs=new Set(paths.flatMap(p=>p.refs));
 for(const e of state.entities.values())if(e.kind!=='person')assert.ok(refs.has(e.id),e.id);
 for(const p of paths){assert.ok(!/NaN|Infinity/.test(p.d));assert.ok(p.points.length>=2);}
 assert.deepEqual(paths.filter(p=>p.refs.includes('ac')&&p.refs.includes('af')),[]);
});

test('layout handles empty graphs, one person, cycles, and many children', () => {
 const empty=familyLayout({people:[],unions:[]},new Map(),force);
 assert.equal(empty.pos.size,0);assert.equal(empty.layout.width,0);
 const rows=[person('p'),person('q')];
 for(let i=0;i<40;i++)rows.push(person(`c${i}`),parent(`p${i}`,'p',`c${i}`),parent(`q${i}`,'q',`c${i}`));
 rows.push(parent('cycle','c0','p'));
 for(const state of [fromRows(1,[person('only')]),fromRows(1,rows)]){
  const g=familyGraph(state),result=familyLayout(g,cardsFor(g),force);
  assert.equal(result.pos.size,g.people.length+g.unions.length);
  assert.ok([...result.pos.values()].every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)));
 }
});

test('fit includes the full tree and zoom reaches 30 times farther out', () => {
 assert.equal(ZOOM_EXTENT[0],0.005);
 assert.ok(ZOOM_EXTENT[1]>=2.5);
 const t=fitTransform({width:20000,height:10000},1000,700);
 assert.ok(t.k<0.15);
 assert.ok(t.x>=39&&t.y>=39);
 assert.ok(t.x+20000*t.k<=961&&t.y+10000*t.k<=661);
 assert.deepEqual(fitTransform({width:0,height:0},1000,700),{x:500,y:350,k:1});
});

test('connections go around unrelated circles and meet the circle boundary', () => {
 const state=fromRows(1,[person('a'),person('c'),person('block'),parent('ac','a','c')]);
 const graph=familyGraph(state),pos=new Map([['a',{x:0,y:0,width:100,height:100}],['c',{x:500,y:0,width:100,height:100}],['block',{x:175,y:0,width:150,height:150}],['u:a',{x:398,y:48,width:4,height:4}]]);
 const paths=connectionPaths(state,graph,pos);
 const leg=paths.find(p=>p.id==='u:a:parent:a');
 assert.ok(leg.points.length>2);
 assert.equal(Math.round(Math.hypot(leg.points[0][0]-50,leg.points[0][1]-50)),50);
 assert.deepEqual(leg.points.at(-1),[400,50]);
 for(let i=1;i<leg.points.length;i++){
  const a=leg.points[i-1],b=leg.points[i],dx=b[0]-a[0],dy=b[1]-a[1];
  const t=Math.max(0,Math.min(1,((250-a[0])*dx+(75-a[1])*dy)/(dx*dx+dy*dy)));
  assert.ok(Math.hypot(250-a[0]-t*dx,75-a[1]-t*dy)>75);
 }
});


test('family paths keep birth, adoptive, step, partner, and hidden-parent references', () => {
 const state=fromRows(1,[...['a','b','c','d'].map(person),parent('ac','a','c'),parent('bc','b','c','adoptive'),parent('ad','a','d','step'),{id:'ab',kind:'partner',deleted:0,data:{a:'a',b:'b'}}]);
 const graph=familyGraph(state),cards=cardsFor(graph),{pos}=familyLayout(graph,cards,force);
 const paths=connectionPaths(state,graph,pos);
 assert.ok(paths.find(p=>p.id==='u:a+b:child:c').mixed);
 assert.equal(paths.find(p=>p.id==='u:a+b:child:c').child,'c');
 assert.equal(paths.find(p=>p.id==='u:a+b:parent:a').child,null);
 assert.ok(paths.find(p=>p.id==='u:a:child:d').chosen);
 assert.equal(paths.find(p=>p.id==='u:a+b:parent:a').chosen,false);
 assert.deepEqual(paths.find(p=>p.id==='u:a+b:parent:a').refs,['ac','ab']);
 const visible=familyGraph(state,new Set(['a','c']));
 const partial=connectionPaths(state,visible,pos);
 assert.equal(partial.length,2);
 assert.ok(partial.every(p=>!p.refs.includes('bc')&&!p.refs.includes('ab')));
 const noHub=new Map(pos);noHub.delete('u:a');
 assert.ok(connectionPaths(state,visible,noHub).every(p=>!p.d.includes('NaN')));
});
