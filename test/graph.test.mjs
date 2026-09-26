import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
test('adaptive graph separates a hundred changes without overlapping circles',async()=>{
  const source=await fs.readFile(new URL('../public/graph-layout.js',import.meta.url),'utf8');
  const context=vm.createContext({});vm.runInContext(source,context);
  const nodes=[{key:'m:M2',type:'milestone',label:'M2'},...Array.from({length:100},(_,i)=>({key:'c:'+i,type:'change',label:'Change '+i}))];
  const edges=nodes.slice(1).map(n=>({from:'m:M2',to:n.key,type:'assignment'}));
  context.nodes=nodes;context.edges=edges;
  const layout=vm.runInContext('layoutGraph(nodes,edges)',context);
  const positions=[...layout.pos.values()];
  for(let i=0;i<positions.length;i++)for(let j=i+1;j<positions.length;j++) assert.ok(Math.hypot(positions[i].x-positions[j].x,positions[i].y-positions[j].y)>38);
  assert.ok(layout.width>1600);
  context.nodes=[{key:'s:cap',type:'spec',label:'Capability'},...nodes.slice(1,5)];
  context.edges=context.nodes.slice(1).map(n=>({from:n.key,to:'s:cap',type:'capability'}));
  const neighborhood=vm.runInContext('layoutGraph(nodes,edges)',context);
  assert.ok(context.nodes.every(n=>neighborhood.pos.has(n.key)));
});
