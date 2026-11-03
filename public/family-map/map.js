import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';
import {fromRows,relatives,lifespan} from '../tree.js';
import {relationshipRings,fullName} from './layout.js';
import {readMapSettings,mapSettingsUrl} from './settings.js';
const snapshot=await fetch('/api/tree').then(response=>{
 if(!response.ok)throw new Error('The tree request failed.');
 return response.json();
}).catch(()=>{
 document.getElementById('count').textContent='The family map could not load. Reload the page to try again.';
 return null;
});
if(!snapshot)throw new Error('The tree request failed.');
const state=fromRows(snapshot.tree.seq,snapshot.entities),relations=relatives(state);
const people=[...state.entities.values()].filter(p=>p.kind==='person'&&!p.deleted);
const el=id=>document.getElementById(id),name=id=>fullName(state.entities.get(id)?.data||{});
await document.fonts.load('600 15px "Atkinson Hyperlegible Next"').catch(()=>[]);
const context=document.createElement('canvas').getContext('2d');
context.font=`600 15px ${getComputedStyle(document.body).fontFamily}`;
const measure=text=>context.measureText(text).width;
const familyColors=[
 '#7ad8ff','#ff9bbb','#a8e97a','#ffc36e','#b8a3ff','#65e1c8',
 '#ffad8e','#eb9bea','#f3df70','#8eb5ff','#7ae2a2','#ff92a0'
];
function familyColor(id){
 let hash=2166136261;
 for(const letter of id)hash=Math.imul(hash^letter.codePointAt(0),16777619);
 return familyColors[(hash>>>0)%familyColors.length];
}
const node=(tag,text)=>{const e=document.createElement(tag);if(text)e.textContent=text;return e;};
const rootSelect=el('root'),depthSelect=el('depth');
for(const p of [...people].sort((a,b)=>name(a.id).localeCompare(name(b.id)))){const o=node('option',name(p.id));o.value=p.id;rootSelect.append(o);}
const personIds=new Set(people.map(p=>p.id));
const defaultPerson=personIds.has('src-jinpachi-kaneko')?'src-jinpachi-kaneko':people[0]?.id;
const defaults={person:defaultPerson,levels:depthSelect.value};
let chart,selected,transform=d3.zoomIdentity;
const svg=d3.select('svg'),scene=svg.append('g'),extra=scene.append('g'),edges=scene.append('g'),marks=scene.append('g');
const zoom=d3.zoom().scaleExtent([0.005,4]).on('zoom',event=>{
 transform=event.transform;scene.attr('transform',transform);el('zoom').value=`${Math.round(transform.k*100)}%`;
});
svg.call(zoom).on('dblclick.zoom',null);
function describeRecord(id){
 const {kind,data}=state.entities.get(id);
 if(kind==='partner')return `${data.type==='married'?'Marriage':'Partners'} · ${name(data.a)} and ${name(data.b)}`;
 const type=data.type||'birth';
 return `${type[0].toUpperCase()+type.slice(1)} parent · ${name(data.parent)} to ${name(data.child)}`;
}
function fit(){
 const bounds=scene.node().getBBox(),r=svg.node().getBoundingClientRect();
 const k=Math.max(0.005,Math.min(1.1,(r.width-64)/Math.max(1,bounds.width),(r.height-132)/Math.max(1,bounds.height)));
 const x=r.width/2-(bounds.x+bounds.width/2)*k;
 const y=(r.height+40)/2-(bounds.y+bounds.height/2)*k;
 svg.call(zoom.transform,d3.zoomIdentity.translate(x,y).scale(k));
}
function settingsUrl(){
 return mapSettingsUrl(location.href,{person:rootSelect.value,levels:depthSelect.value});
}
function restoreSettings(){
 const {person,levels}=readMapSettings(location.href,personIds,defaults);
 selected=rootSelect.value=person;
 depthSelect.value=levels;
 el('share-status').textContent='';
 draw();
}
function applySettings(){
 const url=settingsUrl();
 if(url.href!==location.href)history.pushState(null,'',url);
 el('share-status').textContent='';
 draw();
}
function draw(){
 const depth=depthSelect.value==='unlimited'?Infinity:Number(depthSelect.value);
 chart=relationshipRings(state,rootSelect.value,depth,d3,measure);
 const colors=new Map(chart.nodes.map(person=>[person.id,familyColor(person.cohort)]));
 const paths=edges.selectAll('path').data(chart.links,e=>e.id).join('path').attr('data-ref',e=>e.refs.join(' ')).attr('data-family',e=>e.family||'').attr('data-junction',e=>e.junction?.join(',')||'').attr('data-from',e=>e.source).attr('data-to',e=>e.target).attr('class',e=>`edge ${e.kind==='partner'?'partner':e.type}`).style('--edge-color',e=>colors.get(e.target)).attr('d',e=>e.d);
 paths.selectAll('title').data(e=>[e.refs.map(describeRecord).join('\n')]).join('title').text(label=>label);
 extra.selectAll('path').data(chart.other,e=>e.id).join('path').attr('data-ref',e=>e.refs.join(' ')).attr('data-family',e=>e.family||'').attr('data-junction',e=>e.junction?.join(',')||'').attr('data-from',e=>e.source).attr('data-to',e=>e.target).attr('class',e=>`context-edge ${e.kind==='parent'?e.type:''}`).style('--edge-color',e=>colors.get(e.target)).attr('d',e=>e.d);
 const groups=marks.selectAll('g.person').data(chart.nodes,n=>n.id).join(enter=>{
  const group=enter.append('g').attr('class','person').attr('role','button').attr('tabindex',0);
  group.append('circle').attr('class','node');group.append('text').attr('class','name').attr('text-anchor','middle');group.append('text').attr('class','years').attr('text-anchor','middle');group.append('title');
  group.on('click',(e,n)=>inspect(n.id)).on('keydown',(e,n)=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();inspect(n.id);}});
  return group;
 });
 groups.attr('transform',n=>`translate(${n.x},${n.y})`).style('--person-color',n=>colors.get(n.id)).classed('more',n=>n.more>0).attr('aria-label',n=>`${n.name}, ${n.distance} relationship ${n.distance===1?'link':'links'} from ${name(rootSelect.value)}`);
 groups.select('.node').attr('r',n=>n.card.width/2);
 groups.each(function(n){
  const group=d3.select(this),card=n.card;
  textLines(group.select('.name'),card.nameLines,card.nameY-card.height/2,20);
  textLines(group.select('.years'),card.subtitleLines,card.subtitleY-card.height/2,17);
 });
 groups.select('title').text(n=>`${n.name}\n${n.distance} recorded ${n.distance===1?'link':'links'} from ${name(rootSelect.value)}${n.more?`\n${n.more} ${n.more===1?'relative':'relatives'} outside this range`:''}`);
 el('title').textContent=`Distance from ${name(rootSelect.value)}`;
 el('count').textContent=`${chart.nodes.length} of ${people.length} people shown · ${chart.beyond} farther away · ${chart.disconnected} with no recorded path`;
 el('other-label').textContent=`All additional links (${chart.other.length})`;
 inspect(chart.nodes.some(n=>n.id===selected)?selected:rootSelect.value);fit();
}
function textLines(text,lines,y,step){
 text.attr('y',y).selectAll('tspan').data(lines).join('tspan').attr('x',0).attr('dy',(_,i)=>i?step:0).text(line=>line);
}
function inspect(id){
 selected=id;
 const p=state.entities.get(id),position=chart.nodes.find(n=>n.id===id),container=el('details');
 container.replaceChildren(node('h1',name(id)));
 const distance=node('p',position?`${position.distance} ${position.distance===1?'link':'links'} from ${name(rootSelect.value)}`:'Outside this chart');distance.className='distance';container.append(distance);
 if(position)container.append(node('p',`Family level ${position.depth}`));
 const years=lifespan(p.data);if(years)container.append(node('p',years));
 const buttons=node('div');buttons.className='button-row';
 const center=node('button','Start from this person');center.disabled=id===rootSelect.value;center.onclick=()=>{rootSelect.value=id;applySettings();};buttons.append(center);

 container.append(buttons);
 const list=node('ul');list.className='relatives';
 for(const [map,role] of [[relations.parents,'parent'],[relations.partners,'partner'],[relations.children,'child']])for(const relative of map.get(id)||[]){
  const li=node('li'),button=node('button',name(relative.id)),text=node('span',`${role}${relative.type&&relative.type!=='birth'&&relative.type!=='married'?` · ${relative.type}`:''}`);
  button.onclick=()=>inspect(relative.id);li.append(button,text);list.append(li);
 }
 container.append(node('h2','Recorded family'),list);
 const shown=new Set(chart.nodes.map(n=>n.id));
 const notShown=[...(relations.parents.get(id)||[]),...(relations.partners.get(id)||[]),...(relations.children.get(id)||[])].filter(r=>!shown.has(r.id)).length;
 if(notShown){const hint=node('p',`${notShown} relatives listed here are outside the displayed range. Start from this person to explore them.`);hint.className='hint';container.append(hint);}
 marks.selectAll('.person').classed('selected',n=>n.id===id);
 const path=new Set();let current=position;while(current?.parent){path.add(current.ref);current=chart.nodes.find(n=>n.id===current.parent);}
 edges.selectAll('path').classed('active',e=>e.refs.some(ref=>path.has(ref)));
 extra.selectAll('path').classed('active',e=>e.source===id||e.target===id).attr('display',e=>el('context').checked||e.source===id||e.target===id?null:'none');
}
rootSelect.onchange=()=>{selected=rootSelect.value;applySettings();};depthSelect.onchange=applySettings;el('context').onchange=()=>inspect(selected);
el('share').onclick=async()=>{
 try{
  await navigator.clipboard.writeText(location.href);
  el('share-status').textContent='Link copied.';
 }catch{
  el('share-status').textContent='Copy the link from the address bar.';
 }
};
el('fit').onclick=fit;el('out').onclick=()=>svg.call(zoom.scaleBy,0.7);el('in').onclick=()=>svg.call(zoom.scaleBy,1/0.7);
let initial=true;new ResizeObserver(()=>{if(chart&&!initial)fit();initial=false;}).observe(document.querySelector('.chart'));
if(people.length){
 restoreSettings();
 history.replaceState(null,'',settingsUrl());
 addEventListener('popstate',restoreSettings);
 el('share').disabled=false;
}else el('count').textContent='The tree has no people yet.';
