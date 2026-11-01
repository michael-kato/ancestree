import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as V from '../public/view.js';
import { fromRows, relatives } from '../public/tree.js';
const measure = (text) => [...text].length * 8;
const person = (id) => ({ id,kind:'person',data:{},deleted:0 });
const parent = (id,a,b,type='birth') => ({ id,kind:'parent',data:{parent:a,child:b,type},deleted:0 });
const state = (...rows) => fromRows(0,rows);

test('new people appear from an already visible parent, partner, or child', () => {
  const graph=relatives(state(person('a'),person('b'),person('c'),person('d'),parent('ab','a','b'),parent('bc','b','c'),
    { id:'bd',kind:'partner',data:{a:'b',b:'d',type:'married'},deleted:0 }));
  assert.equal(V.arrivalOrigin(graph,'b',new Set(['a','c'])),'a');
  assert.equal(V.arrivalOrigin(graph,'b',new Set(['c','d'])),'d');
  assert.equal(V.arrivalOrigin(graph,'b',new Set(['c'])),'c');
  assert.equal(V.arrivalOrigin(graph,'b',new Set()),null);
});

test('cards contain complete short, long, Japanese, and unbroken names', () => {
  for (const name of ['Alexis Kalena Davidson','A very long given name and an equally long surname','山田太郎'.repeat(15),'X'.repeat(160),'Ana 👩🏽‍💻 María']) {
    const card=V.cardLayout(name,'1869–1947',true,measure);
    assert.equal(card.nameLines.join('').replace(/\s/g,''),name.replace(/\s/g,''));
    assert.ok(card.width>=188 && card.width<=340);
    assert.equal(card.textX,card.width/2);
    assert.ok(card.nameLines.every((line)=>measure(line)<=card.textWidth));
    assert.ok(card.subtitleLines.every((line)=>measure(line)<=card.textWidth));
    assert.ok(card.subtitleY+(card.subtitleLines.length-1)*17<card.height-12);
  }
  assert.deepEqual(V.wrapText('',100,measure),[]);
  assert.ok(V.cardLayout('Short','',false,measure).width<V.cardLayout('Longer name with a surname','',false,measure).width);
  const emoji='👩🏽‍💻';
  assert.deepEqual(V.wrapText(emoji.repeat(4),measure(emoji)+1,measure),Array(4).fill(emoji));
});

test('drag ports follow the measured card bounds', () => {
  assert.deepEqual(V.ports({width:300,height:100}),[['top',150,0],['bottom',150,100],['left',0,50],['right',300,50]]);
});

test('distance mutes distant people without hiding them', () => {
  assert.equal(V.distanceFilter(0,true),'none');
  assert.equal(V.distanceFilter(1,true),'none');
  assert.match(V.distanceFilter(5,true),/saturate\(0\.45\) brightness\(0\.85\)/);
  assert.equal(V.distanceFilter(undefined,true),V.distanceFilter(5,true));
  assert.equal(V.distanceFilter(undefined,false),'none');
});

test('default focus uses the most connected person with a stable tie order', () => {
  const graph=state(person('a'),person('b'),person('c'),parent('ab','a','b'),parent('bc','b','c'));
  assert.equal(V.defaultFocus(graph),'b');
  assert.equal(V.defaultFocus(state(person('z'),person('a'))),'a');
  assert.equal(V.defaultFocus(state()),null);
});

test('branch colors form a stable gradient through family links', () => {
  const graph=state(person('a'),person('b'),person('child'),parent('ac','a','child'),parent('bc','b','child','adoptive'));
  const colors=V.branchColors(graph), reverse=V.branchColors(state(...[...graph.entities.values()].reverse()));
  for(const [id,color] of colors)assert.deepEqual(reverse.get(id),color);
  assert.notDeepEqual(colors.get('child'),colors.get('a'));
  const chain=V.branchColors(state(person('a'),person('b'),parent('ab','a','b')));
  assert.notDeepEqual(chain.get('a'),chain.get('b'));
  assert.ok(Math.hypot(...chain.get('a').map((v,i)=>v-chain.get('b')[i]))<0.05);
  assert.match(V.colorCss(colors.get('child')),/^oklab\(80% /);
  const many=V.branchColors(state(...Array.from({length:1000},(_,i)=>person(`person-${i}`))));
  assert.equal(new Set([...many.values()].map(V.colorCss)).size,1000);
  assert.ok(new Set([...many.values()].map(([a,b])=>Math.floor((Math.atan2(b,a)+Math.PI)*12/(Math.PI*2)))).size>=10);
  assert.equal(V.branchColors(state()).size,0);
});

test('rounded connections keep endpoints, handle repeated points, and limit corner radius', () => {
  assert.equal(V.roundedPath([[0,0],[100,0]]),'M0,0L100,0');
  assert.equal(V.roundedPath([[0,0],[0,0],[10,0],[10,10]]),'M0,0L5,0Q10,0 10,5L10,10');
  assert.equal(V.roundedPath([]),'');
  assert.equal(V.roundedPath([[1,2]]),'M1,2');
});

test('branch colors keep dark card text above 4.5 contrast across 1000 anchors', () => {
  const colors=V.branchColors(state(...Array.from({length:1000},(_,i)=>person(`root-${i}`))));
  const ink=[23,38,56].map((n)=>n/255).map((n)=>n<=0.04045?n/12.92:((n+0.055)/1.055)**2.4);
  const inkY=ink[0]*0.2126+ink[1]*0.7152+ink[2]*0.0722;
  for(const [a,b] of colors.values()){
    const l=(0.8+0.3963377774*a+0.2158037573*b)**3;
    const m=(0.8-0.1055613458*a-0.0638541728*b)**3;
    const s=(0.8-0.0894841775*a-1.291485548*b)**3;
    const rgb=[4.0767416621*l-3.3077115913*m+0.2309699292*s,-1.2684380046*l+2.6097574011*m-0.3413193965*s,-0.0041960863*l-0.7034186147*m+1.707614701*s].map((v)=>Math.max(0,Math.min(1,v)));
    const y=rgb[0]*0.2126+rgb[1]*0.7152+rgb[2]*0.0722;
    assert.ok((y+0.05)/(inkY+0.05)>=4.5);
  }
});

test('connections retain each parent endpoint and its relationship type', async () => {
  const {familyGraph}=await import('../public/tree.js');
  const rows=state(person('a'),person('b'),person('c'),parent('ac','a','c'),parent('bc','b','c','adoptive'),{id:'ab',kind:'partner',data:{a:'a',b:'b'},deleted:0});
  const pos=new Map([['a',{x:0,y:0,width:300,height:80}],['b',{x:328,y:0,width:200,height:80}],['c',{x:100,y:200,width:250,height:100}]]);
  const paths=V.connectionPaths(rows,familyGraph(rows),pos);
  assert.equal(paths.length,3);
  assert.deepEqual(paths.find((p)=>p.id==='ac').a,'a');
  assert.deepEqual(paths.find((p)=>p.id==='ac').b,'c');
  assert.equal(paths.find((p)=>p.id==='ac').chosen,false);
  assert.equal(paths.find((p)=>p.id==='bc').chosen,true);
  assert.match(paths.find((p)=>p.id==='ac').d,/^M150,80.*Q.*L225,200$/);
  assert.equal(paths.find((p)=>p.id==='ab').d,'M300,40L328,40');
  const wide=new Map(pos);wide.set('b',{...pos.get('b'),x:800});
  assert.match(V.connectionPaths(rows,familyGraph(rows),wide).find((p)=>p.id==='ab').d,/Q/);
  const limited=new Map(pos);limited.delete('c');
  assert.equal(V.connectionPaths(rows,{people:[],unions:[]},limited).length,1);
  rows.entities.get('ab').deleted=1;
  assert.equal(V.connectionPaths(rows,{people:[],unions:[]},limited).length,0);
});

test('overlapping sibling bars get separate tracks within the four-track limit', () => {
  const groups=Array.from({length:6},(_,i)=>({sx:i,kids:[{c:`c${i}`,x:100,y:200}]}));
  const tracks=V.siblingTracks(groups);
  assert.equal(tracks.get(groups[0]),0);
  assert.equal(tracks.get(groups[1]),1);
  assert.ok([...tracks.values()].every((n)=>n>=0&&n<4));
  const apart=[{sx:0,kids:[{x:5,y:200}]},{sx:50,kids:[{x:55,y:200}]}];
  assert.deepEqual([...V.siblingTracks(apart).values()],[0,0]);
});
