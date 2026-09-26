import test from 'node:test';
import assert from 'node:assert/strict';
import { taskSummary, headings, readLedger, resolveEffort } from '../lib/model.mjs';
test('Markdown examples never become work or requirements; valid lists are parsed', () => {
  const source = '## Work\n- [x] 1.1 Real\n+ [ ] Unnumbered\n1. [ ] Ordered\n\n```md\n- [ ] Fake\n### Requirement: Fake\n```\n### Requirement: Real\n';
  assert.equal(taskSummary(source).total, 3);
  assert.equal(taskSummary(source).done, 1);
  assert.deepEqual(headings(source,3,'Requirement:'),['Real']);
});
test('unnumbered task identity survives inserting another task; duplicates are diagnosed', () => {
  const before = taskSummary('- [ ] Build it').items[0];
  const after = taskSummary('- [ ] Other\n- [ ] Build it').items[1];
  assert.equal(before.id,after.id);
  assert.ok(taskSummary('- [ ] 1.1 A\n- [ ] 1.1 B').items.every(t => t.ambiguous));
});
test('ledger rejects impossible dates and fractional minutes', () => {
  const warnings = [];
  assert.deepEqual(readLedger(JSON.stringify([{change:'a',task:'1',date:'2026-99-01',minutes:2,note:''}]),warnings),[]);
  assert.equal(warnings.length,1);
});
test('archive alias preserves effort, reused names never silently receive it', () => {
  const task = taskSummary('- [ ] 1.1 Build it').items[0];
  const entry = { change:'a',task:'1.1',date:'2026-09-25',minutes:45,note:'' };
  const archived = {id:'2026-09-26-a',stableId:'a',archived:true,tasks:{items:[task]}};
  assert.equal(resolveEffort([entry],[archived],[]).get('2026-09-26-a/1.1')[0].minutes,45);
  const warnings=[];
  assert.equal(resolveEffort([entry],[archived,{...archived,id:'a',archived:false}],warnings).size,0);
  assert.equal(warnings.length,1);
});
