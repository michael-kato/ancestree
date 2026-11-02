import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as V from '../public/view.js';
import { palette } from '../public/palette.js';
import { fromRows, relatives } from '../public/tree.js';
const measure = (text) => [...text].length * 8;
const person = (id) => ({ id,kind:'person',data:{},deleted:0 });
const parent = (id,a,b,type='birth') => ({ id,kind:'parent',data:{parent:a,child:b,type},deleted:0 });
const state = (...rows) => fromRows(0,rows);
function colorLuminance([L,a,b], brightness) {
  const l=(L+0.3963377774*a+0.2158037573*b)**3, m=(L-0.1055613458*a-0.0638541728*b)**3, s=(L-0.0894841775*a-1.291485548*b)**3;
  const rgb=[4.0767416621*l-3.3077115913*m+0.2309699292*s,-1.2684380046*l+2.6097574011*m-0.3413193965*s,-0.0041960863*l-0.7034186147*m+1.707614701*s].map(v=>Math.max(0,Math.min(1,v))).map(v=>{
    const srgb=(v<=0.0031308?v*12.92:1.055*v**(1/2.4)-0.055)*brightness;
    return srgb<=0.04045?srgb/12.92:((srgb+0.055)/1.055)**2.4;
  });
  return rgb[0]*0.2126+rgb[1]*0.7152+rgb[2]*0.0722;
}

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
    assert.ok(card.width>=172 && card.width===card.height);
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

test('color field blends nearby positions and uses 1000 source colors', () => {
  assert.equal(palette.length,1000);
  assert.equal(new Set(palette).size,1000);
  const first=V.fieldColor(100,100), nearby=V.fieldColor(101,100), far=V.fieldColor(5000,4000);
  assert.deepEqual(first,V.fieldColor(100,100));
  assert.notDeepEqual(first,far);
  assert.ok(Math.hypot(...first.map((v,i)=>v-nearby[i]))<0.01);
  const left=V.fieldColor(999.99,650), right=V.fieldColor(1000.01,650);
  assert.ok(Math.hypot(...left.map((v,i)=>v-right[i]))<0.001);
  assert.match(V.colorCss(first),/^oklab\(/);
});

test('rounded connections keep endpoints, handle repeated points, and limit corner radius', () => {
  assert.equal(V.roundedPath([[0,0],[100,0]]),'M0,0L100,0');
  assert.equal(V.roundedPath([[0,0],[0,0],[10,0],[10,10]]),'M0,0L5,0Q10,0 10,5L10,10');
  assert.equal(V.roundedPath([]),'');
  assert.equal(V.roundedPath([[1,2]]),'M1,2');
});

test('color field keeps black text readable on normal and muted cards', () => {
  for(let i=0;i<1000;i++){
    const color=V.fieldColor(i*97,i*37);
    for(const brightness of [1,V.distanceBrightness(4,true)]){
      const luminance=colorLuminance(color,brightness);
      assert.ok((luminance+0.05)/0.05>=4.5);
    }
  }
});

test('sibling highlights include shared birth and adoptive parents only', () => {
  const graph=state(person('p'),person('q'),person('a'),person('b'),person('c'),person('d'),
    parent('pa','p','a'),parent('pb','p','b'),parent('qa','q','a','adoptive'),parent('qc','q','c','adoptive'),parent('pd','p','d'));
  graph.entities.get('pd').deleted=1;
  const result=V.siblingHighlights(graph,'a');
  assert.deepEqual([...result.people].sort(),['b','c']);
  assert.deepEqual([...result.edges].sort(),['pb','qc']);
  assert.equal(V.siblingHighlights(graph,null).people.size,0);
});
