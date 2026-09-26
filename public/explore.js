// Project exploration views share the state and helpers in app.js.
const allChanges = () => [...state.data.changes, ...state.data.archive];
const milestoneGroups = () => {
  const known = new Set((state.data.milestones || []).map(m => m.id));
  const ids = [...new Set([...known, ...allChanges().map(c => c.milestone).filter(Boolean)])];
  const groups = ids.map(id => ({ id, label: milestoneLabel(id), changes: allChanges().filter(c => c.milestone === id) }));
  if (allChanges().some(c => !c.milestone)) groups.push({ id: 'unassigned', label: 'No milestone line', changes: allChanges().filter(c => !c.milestone) });
  return groups;
};
const visibleChanges = () => allChanges().filter(c => (state.includeArchive || !c.archived) && (state.milestone === 'all' || c.milestone === state.milestone || (state.milestone === 'unassigned' && !c.milestone)));
const changeKind = c => c.archived ? 'archive' : 'changes';
const milestonePicker = (compact = false) => compact ? `<label class="milestone-select">Milestone <select id="milestone-select"><option value="all">All milestones</option>${milestoneGroups().map(g=>`<option value="${escapeHtml(g.id)}" ${state.milestone===g.id ? 'selected' : ''}>${escapeHtml(g.id + ' · ' + g.label)}</option>`).join('')}</select></label>` : `<div class="${compact ? 'mini-milestones' : 'map-milestones'}"><button class="milestone-pick ${state.milestone === 'all' ? 'selected' : ''}" data-milestone="all"><strong>All milestones</strong><span>${allChanges().length} changes</span></button>${milestoneGroups().map(group => `<button class="milestone-pick ${state.milestone === group.id ? 'selected' : ''}" data-milestone="${escapeHtml(group.id)}"><strong>${escapeHtml(group.id === 'unassigned' ? 'Other' : group.id)} · ${escapeHtml(group.label)}</strong><span>${group.changes.filter(c => !c.archived).length} active · ${group.changes.filter(c => c.archived).length} archived</span></button>`).join('')}</div>`;

function projectMapV2() {
  const all = visibleChanges();
  const query = state.mapQuery.toLowerCase();
  const rank = c => c.archived ? 4 : c.tasks.done > 0 && c.tasks.done < c.tasks.total ? 0 : c.tasks.total && c.tasks.done === c.tasks.total ? 1 : c.tasks.total ? 2 : 3;
  const matches = all.filter(c=>!state.mapStatus || state.mapStatus==='all' || itemStatus(c)[1]===state.mapStatus).filter(c => !query || `${c.title} ${c.summary} ${c.milestone || ''}`.toLowerCase().includes(query)).sort((a,b) => rank(a) - rank(b) || a.title.localeCompare(b.title));
  const selected = matches.find(c => c.id === state.mapChange) || matches.find(c => !c.archived && c.tasks.done > 0) || matches.find(c => !c.archived) || matches[0];
  if (selected) state.mapChange = selected.id;
  const affected = selected?.capabilities || [];
  const milestone = state.data.milestones.find(m => m.id === state.milestone);
  const milestoneContext = milestone?.outcome || milestone?.exitCriteria?.length ? '<div class="milestone-outcomes"><h3>Declared milestone outcome</h3><p>'+escapeHtml(milestone.outcome || '')+'</p><ul>'+(milestone.exitCriteria || []).map(c=>'<li>'+escapeHtml(c)+'</li>').join('')+'</ul><small>Portal metadata; task completion does not satisfy criteria automatically.</small></div>' : '';
  const specLinks = affected.length ? affected.map(id => {
    const spec = state.data.specs.find(s => s.id === id);
    return `<button class="map-spec-card" data-open-spec="${escapeHtml(id)}"><strong>${escapeHtml(spec?.title || caps(id.split('/').at(-1)))}</strong><span>${spec ? `${spec.requirements.length} current requirements` : 'Delta spec only'} ↗</span></button>`;
  }).join('') : `<p class="muted-copy">No delta spec files in this change yet. Its proposal may still name capabilities.</p>`;
  const changeRows = matches.map(c => {
    const [status, tone] = itemStatus(c);
    return `<button class="map-change-row ${selected?.id === c.id ? 'selected' : ''}" data-map-change="${escapeHtml(c.id)}"><span class="map-change-title">${escapeHtml(c.title)}</span><span class="status ${c.archived ? 'archived' : tone}"><i></i>${c.archived ? 'Archived' : status}</span><small>${c.tasks.total ? `${c.tasks.done}/${c.tasks.total} checked` : 'No checklist'} · ${c.capabilities.length} delta ${c.capabilities.length === 1 ? 'spec' : 'specs'}</small></button>`;
  }).join('');
  const selectedInfo = selected ? `<div class="map-detail-head"><div class="eyebrow">${selected.archived ? 'ARCHIVED CHANGE' : 'ACTIVE CHANGE'} · ${escapeHtml(selected.milestone || 'NO MILESTONE')}</div><h2>${escapeHtml(selected.title)}</h2><p>${escapeHtml(selected.goal || selected.summary || 'Open the proposal for more detail.')}</p><div class="map-detail-actions"><button data-open-change="${escapeHtml(selected.id)}" data-kind="${changeKind(selected)}">Read change ↗</button><button data-timeline-open="${escapeHtml(selected.id)}">See task timeline ↗</button></div></div><div class="map-detail-stats"><span><strong>${selected.tasks.done}/${selected.tasks.total}</strong> tasks checked</span><span><strong>${selected.requirements}</strong> delta requirements</span><span><strong>${affected.length}</strong> affected capabilities</span></div><h3>Associated capability specs</h3>${specLinks}<h3>Checklist sections</h3>${selected.tasks.sections?.length ? selected.tasks.sections.map(s => `<div class="map-section-row"><span>${escapeHtml(s.title)}</span><b>${s.done}/${s.total}</b></div>`).join('') : `<p class="muted-copy">No checklist sections yet.</p>`}` : empty('Choose a change', 'Select a milestone and a change to inspect its specs and work.');
  const active = all.filter(c => !c.archived).length;
  const inProgress = all.filter(c => !c.archived && c.tasks.done > 0 && c.tasks.done < c.tasks.total).length;
  return `${pageHeader('PROJECT STRUCTURE', 'Project map', 'Start with a milestone, inspect its proposed and active changes, then open their capability specs or tasks.')}
    <div class="map-summary">${archiveToggle()}<label>Status <select id="map-status">${['all','draft','planned','active','complete'].map(status=>`<option value="${status}" ${state.mapStatus===status?'selected':''}>${({all:'All',draft:'Proposed',planned:'Planned',active:'In progress',complete:'Checklist complete'})[status]}</option>`).join('')}</select></label><span><strong>${active}</strong> active changes in selection</span><span><strong>${inProgress}</strong> with checked tasks</span><span><strong>${all.filter(c => c.archived).length}</strong> archived</span><button data-view="graph">Explore node graph ↗</button><button data-view="timeline">View timeline ↗</button></div>
    <p class="map-hint">OpenSpec changes are peers. This project groups them by milestone; delta specs link changes to capabilities, and checklists track work.</p>
    <div class="map-board"><section class="map-col milestone-col"><div class="map-col-head"><h2>Milestones</h2><small>Project convention</small></div>${milestonePicker()}</section>
    <section class="map-col change-col"><div class="map-col-head"><h2>Changes</h2><small>${matches.length} shown</small></div><label class="map-search"><span>⌕</span><input id="map-search" type="search" value="${escapeHtml(state.mapQuery)}" placeholder="Find a change…" aria-label="Find a change"></label><div class="map-change-list">${changeRows || empty('No changes found', 'Choose another milestone or search term.')}</div></section>
    <section class="map-col detail-col"><div class="map-col-head"><h2>Change details</h2><small>Drill down</small></div><div class="map-detail-scroll">${milestoneContext}${selectedInfo}</div></section></div>`;
}

function graphData() {
  const changes = visibleChanges();
  const groups = milestoneGroups().filter(g => state.milestone === 'all' || g.id === state.milestone);
  const caps = [...new Set(changes.flatMap(c => c.capabilities || []))].sort();
  const nodes = [
    ...groups.map(g => ({ key: `m:${g.id}`, label: g.id === 'unassigned' ? 'Other' : g.id, detail: g.label, type: 'milestone', id: g.id })),
    ...changes.map(c => ({ key: `c:${c.id}`, label: c.title, detail: c.archived ? 'Archived change' : `${c.tasks.done}/${c.tasks.total} tasks checked`, type: 'change', id: c.id, archived: c.archived })),
    ...caps.map(id => ({ key: `s:${id}`, label: capsName(id), detail: 'Capability', type: 'spec', id }))
  ];
  const edges = changes.flatMap(c => [
    { from: `m:${c.milestone || 'unassigned'}`, to: `c:${c.id}`, type: 'assignment' },
    ...(c.capabilities || []).map(id => ({ from: `c:${c.id}`, to: `s:${id}`, type: 'capability' })),
    ...(c.portal?.dependsOn || []).filter(id=>changes.some(c=>c.id===id)).map(id=>({from: `c:${c.id}`,to:`c:${id}`,type:'dependency'}))
  ]);
  if (state.neighborhood && state.graphFocus) { const keys = new Set([state.graphFocus, ...edges.filter(e => e.from === state.graphFocus || e.to === state.graphFocus).flatMap(e => [e.from,e.to])]); return { nodes: nodes.filter(n => keys.has(n.key)), edges: edges.filter(e => keys.has(e.from) && keys.has(e.to)) }; }
  return { nodes, edges: edges.filter(e => nodes.some(n=>n.key===e.from) && nodes.some(n=>n.key===e.to)) };
}
function capsName(id) { return state.data.specs.find(s => s.id === id)?.title || caps(id.split('/').at(-1)); }
function graphViewBox() {
  const size = state.graphSize || { width:1600, height:1050 };
  const width = size.width / state.graphScale, height = size.height / state.graphScale;
  return `${(size.width - width) / 2 + state.graphPan.x} ${(size.height - height) / 2 + state.graphPan.y} ${width} ${height}`;
}
function nodeGraphView() {
  const { nodes, edges } = graphData();
  const { pos, width, height } = layoutGraph(nodes, edges);
  state.graphSize = { width, height };
  const focus = nodes.find(n => n.key === state.graphFocus);
  const neighborKeys = new Set(edges.filter(e => e.from === state.graphFocus || e.to === state.graphFocus).flatMap(e => [e.from,e.to]));
  const edgeHtml = edges.map(e => {
    const a = pos.get(e.from), b = pos.get(e.to);
    const dx = b.x - a.x, dy = b.y - a.y, distance = Math.max(1, Math.hypot(dx, dy));
    const fromRadius = e.type === 'assignment' ? 31 : 19;
    const toRadius = e.type === 'capability' ? 25 : 19;
    const start = {x:a.x + dx/distance*fromRadius,y:a.y + dy/distance*fromRadius}, end = {x:b.x - dx/distance*toRadius,y:b.y - dy/distance*toRadius};
    const obstacles = nodes.filter(n=>n.key!==e.from && n.key!==e.to).map(n=>({...pos.get(n.key),radius:n.type==='milestone'?38:n.type==='spec'?32:26}));
    let best = null;
    for (const offset of [0,40,-40,80,-80,140,-140,220,-220]) {
      const control = {x:(start.x+end.x)/2-dy/distance*offset,y:(start.y+end.y)/2+dx/distance*offset};
      let collisions=0;
      for (const obstacle of obstacles) {
        for (let step=1;step<25;step++) { const t=step/25, q=1-t, x=q*q*start.x+2*q*t*control.x+t*t*end.x, y=q*q*start.y+2*q*t*control.y+t*t*end.y; if(Math.hypot(x-obstacle.x,y-obstacle.y)<obstacle.radius){collisions++;break;} }
      }
      const score=collisions*10000+Math.abs(offset);
      if (!best || score<best.score) best={control,score};
      if (!collisions && !offset) break;
    }
    return '<path d="M '+start.x.toFixed(1)+' '+start.y.toFixed(1)+' Q '+best.control.x.toFixed(1)+' '+best.control.y.toFixed(1)+' '+end.x.toFixed(1)+' '+end.y.toFixed(1)+'" class="node-edge '+e.type+' '+(focus && (e.from===focus.key || e.to===focus.key)?'highlight':'')+'" '+(e.type==='dependency'?'marker-end="url(#dependency-arrow)"':'')+'/>';
  }).join('');
  const nodeHtml = nodes.map(n => {
    const p = pos.get(n.key);
    const dim = focus && n.key !== focus.key && !neighborKeys.has(n.key) ? 'dimmed' : '';
    const name = n.label.length > 22 ? `${n.label.slice(0, 20)}…` : n.label;
    const labelHalfWidth = name.length * 4.5;
    const anchor = n.type === 'spec' && p.x < labelHalfWidth + 18 ? 'start' : n.type === 'spec' && p.x > width - labelHalfWidth - 18 ? 'end' : 'middle';
    return `<g class="network-node ${n.type} ${n.archived ? 'archived' : ''} ${dim} ${focus?.key === n.key ? 'selected' : ''}" transform="translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})" data-graph-node="${escapeHtml(n.key)}" role="button" tabindex="0" aria-label="${escapeHtml(n.type)}: ${escapeHtml(n.label)}"><circle r="${n.type === 'milestone' ? 31 : n.type === 'spec' ? 25 : 19}"/><text y="${n.type === 'milestone' ? 4 : 37}" text-anchor="${anchor}">${escapeHtml(name)}</text><title>${escapeHtml(n.label)} · ${escapeHtml(n.detail)}</title></g>`;
  }).join('');
  const neighbors = focus ? nodes.filter(n=>neighborKeys.has(n.key) && n.key!==focus.key) : [];
  const neighborList = '<div class="neighbor-list"><h3>'+(focus?'Direct relationships':'Nodes')+'</h3>'+(focus?neighbors:nodes).map(n=>'<button data-focus-node="'+escapeHtml(n.key)+'">'+escapeHtml(n.label)+' <small>'+escapeHtml(n.type)+'</small></button>').join('')+'</div>';
  const detail = focus ? `<div class="network-inspector"><div class="eyebrow">${focus.type.toUpperCase()}</div><h2>${escapeHtml(focus.label)}</h2><p>${escapeHtml(focus.detail)}</p><p>${edges.filter(e => e.from === focus.key || e.to === focus.key).length} direct links</p>${focus.type === 'change' ? `<button data-open-change="${escapeHtml(focus.id)}" data-kind="${changeKind(allChanges().find(c => c.id === focus.id))}">Open change ↗</button>` : focus.type === 'spec' ? `<button data-open-spec="${escapeHtml(focus.id)}">Open capability ↗</button>` : `<button data-milestone="${escapeHtml(focus.id)}">Focus milestone ↗</button>`}</div>` : `<div class="network-inspector"><div class="eyebrow">EXPLORE</div><h2>Select a node</h2><p>Click a milestone, change, or capability to highlight its direct relationships and open its source details.</p></div>`;
  return `${pageHeader('RELATIONSHIP VIEW', 'Node graph', 'Explore milestone assignments and capability links in a two-dimensional network.')}
    <div class="graph-controls">${archiveToggle()}<label><input id="graph-neighborhood" type="checkbox" ${state.neighborhood ? 'checked' : ''}> Only selected neighborhood</label><label><input id="graph-labels" type="checkbox" ${state.graphLabels ? 'checked' : ''}> Show change labels</label>${milestonePicker(true)}<div class="graph-zoom"><button data-graph-zoom="out" aria-label="Zoom out">−</button><button data-graph-zoom="reset">Reset</button><button data-graph-zoom="in" aria-label="Zoom in">+</button></div></div>
    <label class="graph-search">Find node <input id="graph-search" list="graph-node-list" placeholder="Search a change or capability…" aria-label="Find graph node"></label><datalist id="graph-node-list">${nodes.map(n => `<option value="${escapeHtml(n.label)}"></option>`).join('')}</datalist>
    <div class="network-layout"><div class="network-stage"><svg id="network-svg" class="${edges.length > 60 ? 'dense' : ''} ${focus ? 'focused' : ''} ${state.graphLabels ? 'show-labels' : ''}" viewBox="${graphViewBox()}" role="group" aria-label="Interactive relationship graph with ${nodes.length} nodes and ${edges.length} links"><defs><marker id="dependency-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0L10 5L0 10z" fill="currentColor"/></marker></defs><rect class="network-background" width="${width}" height="${height}"/>${edgeHtml}${nodeHtml}</svg></div><div class="network-side">${detail}${neighborList}</div></div>
    <div class="map-legend"><span><i class="line-swatch assigned"></i> Milestone assignment</span><span><i class="line-swatch affected"></i> Delta spec link</span><span><i class="line-swatch dependency"></i> Declared dependency (arrow to prerequisite)</span><span>${nodes.length} nodes · ${edges.length} links</span><span>Drag the canvas to pan; use the buttons or mouse wheel to zoom.</span></div>`;
}

const dayMillis = 86400000;
const toDay = value => Math.floor(new Date(`${value}T12:00:00Z`).getTime() / dayMillis);
const fromDay = value => new Date(value * dayMillis).toISOString().slice(0,10);
function timelineView() {
  const changes = visibleChanges();
  const selected = changes.find(c => c.id === state.timelineChange) || changes.find(c => c.tasks.total && !c.archived) || changes.find(c => c.tasks.total) || changes[0];
  if (selected) state.timelineChange = selected.id;
  const sections = [...new Set((selected?.tasks.items || []).map(t=>t.section))];
  if (!sections.includes(state.timelineSection)) state.timelineSection = '';
  const tasks = (selected?.tasks.items || []).filter(t=>!state.timelineSection || t.section===state.timelineSection);
  const dated = tasks.flatMap(t => [t.timeline?.firstSeen, t.timeline?.completedAt, ...(t.timeline?.activityDays || []), ...(t.timeline?.effortDays || []).map(e => e.date)]).filter(Boolean).sort();
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  const earliest = toDay(dated[0] || today) - 1;
  const end = Math.max(toDay(dated.at(-1) || today), toDay(today), earliest + 6) + 1;
  const start = Math.max(earliest, end - (state.timelineRange === 'all' ? end - earliest : Number(state.timelineRange) - 1));
  const days = end - start + 1, cell = days <= 14 ? 90 : days <= 30 ? 50 : 36, width = days * cell, row = 54, header = 54;
  const grid = Array.from({ length: days }, (_, i) => {
    const date = fromDay(start + i);
    return `<line x1="${i*cell}" y1="${header}" x2="${i*cell}" y2="${header + tasks.length*row}" class="timeline-gridline"/><text x="${i*cell+cell/2}" y="21" text-anchor="middle" class="timeline-day">${date.slice(8)}</text><text x="${i*cell+cell/2}" y="38" text-anchor="middle" class="timeline-month">${new Date(date + 'T12:00:00Z').toLocaleDateString(undefined,{month:'short',year:'2-digit'})}</text>`;
  }).join('');
  const bars = tasks.map((task, index) => {
    const data = task.timeline || {};
    const first = data.firstSeen ? toDay(data.firstSeen) : null;
    const last = data.activityDays?.length ? toDay(data.activityDays.at(-1)) : first;
    const y = header + index * row + 10;
    const span = first === null || state.timelineMode === 'effort' ? '' : `<rect class="timeline-span" x="${(first-start)*cell+8}" y="${y}" width="${Math.max(18, (last-first+1)*cell-16)}" height="18" rx="7"><title>Observed in sampled Git history: ${escapeHtml(data.firstSeen)} to ${escapeHtml(fromDay(last))}. This is not time spent.</title></rect>`;
    const markers = (state.timelineMode === 'effort' ? [] : data.activityDays || []).map(date => `<circle class="timeline-activity" cx="${(toDay(date)-start)*cell+cell/2}" cy="${y+9}" r="5"><title>Checklist changed: ${date}</title></circle>`).join('');
    const byDay = new Map();
    for (const entry of data.effortDays || []) {
      const day = byDay.get(entry.date) || { minutes: 0, notes: [] };
      day.minutes += entry.minutes;
      if (entry.note) day.notes.push(entry.note);
      byDay.set(entry.date, day);
    }
    const effort = [...(state.timelineMode === 'history' ? [] : byDay)].map(([date, entry]) => `<rect class="timeline-effort" x="${(toDay(date)-start)*cell+5}" y="${y+26}" width="${Math.max(5, Math.min(cell-10, (cell-10)*entry.minutes/480)).toFixed(1)}" height="10" rx="3"><title>${date}: ${entry.minutes} logged minutes${entry.notes.length ? ` · ${escapeHtml(entry.notes.join('; '))}` : ''}. A full-width strip represents 8 hours.</title></rect>`).join('');
    const checked = data.completedAt && state.timelineMode !== 'effort' ? `<circle class="timeline-complete" cx="${(toDay(data.completedAt)-start)*cell+cell/2}" cy="${y+9}" r="7"><title>First observed checked: ${data.completedAt}</title></circle>` : '';
    return `<g data-timeline-index="${index}" class="timeline-row">${span}${markers}${checked}${effort}</g><line x1="0" y1="${header+(index+1)*row}" x2="${width}" y2="${header+(index+1)*row}" class="timeline-rowline"/>`;
  }).join('');
  const totalMinutes = tasks.reduce((n,t) => n + (t.timeline?.effortMinutes || 0), 0);
  const selectedTask = tasks.find(t => t.id === state.timelineTask) || tasks.find(t => !t.done) || tasks[0];
  if (selectedTask) state.timelineTask = selectedTask.id;
  const effortForm = selectedTask ? `<details class="effort-panel"><summary>Log actual work</summary><form id="effort-form" class="effort-form"><div><strong>Log actual work</strong><p>Save a dated time entry for one checklist task in this repository.</p></div><label>Task<select id="effort-task" required>${tasks.map(t => `<option value="${escapeHtml(t.id)}" ${t.id === selectedTask.id ? 'selected' : ''}>${escapeHtml(t.id)} · ${escapeHtml(t.text.replace(/^\d+(?:\.\d+)*\.?\s*/, '').slice(0, 80))}</option>`).join('')}</select></label><label>Date<input id="effort-date" type="date" value="${today}" max="${today}" required></label><label>Minutes<input id="effort-minutes" type="number" min="1" max="1440" step="1" placeholder="e.g. 45" required></label><label class="effort-note">Note<input id="effort-note" type="text" maxlength="300" placeholder="What work was done?"></label><button type="submit" ${state.savingEffort?'disabled':''}>Save time entry</button><span id="effort-message" role="status">${escapeHtml(state.savingEffort ? 'Saving…' : state.effortSuccess || '')}</span></form></details>` : '';
  return `${pageHeader('HISTORY AND EFFORT', 'Task timeline', 'See when checklist tasks appeared or changed, and any time explicitly logged against them.')}
    <details class="structure-note"><summary>Timeline provenance and legend</summary><p>Blue spans show the observed period between a task’s first and last checklist change in Git. File timestamps are not treated as work dates. Dots mark checklist changes; green dots mark tasks first observed checked. Teal strips show actual minutes recorded in <code>.openspec-portal/effort.json</code>; a full day cell equals 8 logged hours. Git history cannot measure hours worked. History is sampled (latest 30 revisions per file, 600 total); missing history remains unknown. Task matching uses normalized text; changed wording starts a new observation series. The visible range may clip older observations.</p></details>
    <div class="timeline-controls">${archiveToggle()}<label>Section <select id="timeline-section"><option value="">All sections</option>${sections.map(section=>`<option ${state.timelineSection === section ? 'selected' : ''}>${escapeHtml(section)}</option>`).join('')}</select></label><label>Display <select id="timeline-mode">${['both','history','effort'].map(mode => `<option ${state.timelineMode === mode ? 'selected' : ''}>${mode}</option>`).join('')}</select></label><label>Range <select id="timeline-range">${['30','90','180','all'].map(range => `<option value="${range}" ${state.timelineRange === range ? 'selected' : ''}>${range === 'all' ? 'All observed dates' : range + ' days'}</option>`).join('')}</select></label><div>${milestonePicker(true)}</div><label class="timeline-select">Change <select id="timeline-change" aria-label="Choose change">${changes.map(c => `<option value="${escapeHtml(c.id)}" ${selected?.id === c.id ? 'selected' : ''}>${escapeHtml(c.title)}${c.archived ? ' (archived)' : ''}</option>`).join('')}</select></label></div>
    ${selected ? `<div class="timeline-summary"><strong>${escapeHtml(selected.title)}</strong><span>${selected.tasks.done}/${selected.tasks.total} checklist tasks checked</span><span>${tasks.filter(t=>!t.timeline?.firstSeen).length} tasks with unknown historical dates</span><span>${totalMinutes ? `${(totalMinutes/60).toFixed(1)} hours logged` : 'No hours logged'}</span><button data-open-change="${escapeHtml(selected.id)}" data-kind="${changeKind(selected)}">Open change ↗</button></div>` : ''}
    ${tasks.length ? `<div class="gantt-shell" role="region" aria-label="Scrollable task Gantt chart" tabindex="0"><div class="gantt-content"><div class="gantt-labels"><div class="gantt-label-head">TASK</div>${tasks.map((task,i) => `<button data-timeline-task="${escapeHtml(task.id)}" title="${escapeHtml(task.text)}"><span class="${task.done ? 'checked' : ''}">${task.done ? '✓' : '○'}</span><strong>${escapeHtml(task.id)} ${escapeHtml(task.text.replace(/^\d+(?:\.\d+)*\.?\s*/, '').slice(0,66))}</strong><small>${task.timeline?.effortMinutes ? `${(task.timeline.effortMinutes/60).toFixed(1)}h` : ''}</small></button>`).join('')}</div><div class="gantt-scroll"><svg width="${width}" height="${header+tasks.length*row}" viewBox="0 0 ${width} ${header+tasks.length*row}" aria-label="Task Gantt chart">${grid}${bars}</svg></div></div></div><div id="timeline-task-detail" class="timeline-task-detail"></div>${effortForm}` : empty('No tasks in this change', 'Choose a change with a tasks.md checklist to see its timeline.')}
    <p class="progress-note">New effort ledgers use <code>.openspec-portal/effort.json</code>; existing <code>openspec/effort.json</code> ledgers remain supported. This is portal metadata. Git checklist history and logged minutes are shown separately.</p>`;
}

function bindExplore() {
  $('#map-status')?.addEventListener('change',event=>{state.mapStatus=event.target.value;render();});
  document.querySelectorAll('[data-focus-node]').forEach(el=>el.addEventListener('click',()=>{state.graphFocus=el.dataset.focusNode;render();}));
  $('#milestone-select')?.addEventListener('change',event=>{state.milestone=event.target.value;state.graphPan={x:0,y:0};state.graphScale=1;render();});
  $('#include-archive')?.addEventListener('change', event => { state.includeArchive = event.target.checked; render(); });
  $('#graph-neighborhood')?.addEventListener('change', event => { state.neighborhood = event.target.checked; state.graphPan={x:0,y:0}; state.graphScale=1; render(); });
  $('#graph-labels')?.addEventListener('change', event => { state.graphLabels = event.target.checked; render(); });
  $('#timeline-section')?.addEventListener('change', event => { state.timelineSection = event.target.value; render(); });
  $('#timeline-mode')?.addEventListener('change', event => { state.timelineMode = event.target.value; render(); });
  $('#timeline-range')?.addEventListener('change', event => { state.timelineRange = event.target.value; render(); });
  $('#graph-search')?.addEventListener('change', event => { const query = event.target.value.toLowerCase().trim(); const match = graphData().nodes.find(n => n.label.toLowerCase() === query) || graphData().nodes.find(n => n.label.toLowerCase().includes(query)); if (match) { state.graphFocus = match.key; const data = graphData(), layout = layoutGraph(data.nodes, data.edges), position = layout.pos.get(match.key); state.graphScale = 1.8; state.graphPan = { x: position.x - layout.width/2, y: position.y - layout.height/2 }; render(); } });
  $('#map-search')?.addEventListener('input', event => { const cursor = event.target.selectionStart; state.mapQuery = event.target.value; render(); $('.map-change-list').scrollTop = 0; const input = $('#map-search'); input.focus(); input.setSelectionRange(cursor, cursor); });
  document.querySelectorAll('[data-map-change]').forEach(el => el.addEventListener('click', () => { state.mapChange = el.dataset.mapChange; render(); $('.map-detail-scroll').scrollTop = 0; }));
  $('#timeline-change')?.addEventListener('change', event => { state.timelineChange = event.target.value; render(); });
  document.querySelectorAll('[data-timeline-task]').forEach(el => el.addEventListener('click', () => {
    const change = visibleChanges().find(c => c.id === state.timelineChange);
    const task = change?.tasks.items.find(t=>t.id===el.dataset.timelineTask);
    if (!task) return;
    state.timelineTask = task.id;
    if ($('#effort-task')) $('#effort-task').value = task.id; syncExploreUrl();
    const time = task.timeline || {};
    $('#timeline-task-detail').innerHTML = `<strong>${escapeHtml(task.id)} · ${escapeHtml(task.text)}</strong><span>${escapeHtml(task.section)} · ${task.done ? 'checked' : 'open'}</span><span>First observed: ${escapeHtml(time.firstSeen || 'unknown')} · Checked: ${escapeHtml(time.completedAt || 'not observed')} · Logged: ${((time.effortMinutes || 0)/60).toFixed(1)} hours</span>`;
  }));
  $('#effort-task')?.addEventListener('change', event => { state.timelineTask = event.target.value; });
  $('#effort-form')?.addEventListener('input', () => { state.effortRequestId = null; state.effortSuccess = ''; });
  $('#effort-form')?.addEventListener('submit', async event => {
    event.preventDefault();
    const button = event.target.querySelector('button[type="submit"]');
    state.savingEffort=true; button.disabled = true;
    $('#effort-message').textContent = 'Saving…';
    try {
      const response = await fetch('/api/effort', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ change: state.timelineChange, requestId: state.effortRequestId ||= crypto.randomUUID(), task: $('#effort-task').value, date: $('#effort-date').value, minutes: Number($('#effort-minutes').value), note: $('#effort-note').value }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not save time entry.');
      state.effortRequestId = null; state.effortSuccess='Time entry saved';
      $('#effort-minutes').value = ''; $('#effort-note').value = '';
      await load(false, 'effort');
      $('#effort-message').textContent = 'Time entry saved'; toast('Time entry saved');
    } catch (error) { state.effortSuccess=error.message; $('#effort-message').textContent=error.message; } finally { state.savingEffort=false; const submit=$('#effort-form button[type="submit"]'); if(submit)submit.disabled=false; }
  });
  document.querySelectorAll('[data-graph-zoom]').forEach(el => el.addEventListener('click', () => {
    state.graphScale = el.dataset.graphZoom === 'reset' ? 1 : Math.max(.6, Math.min(2.5, state.graphScale * (el.dataset.graphZoom === 'in' ? 1.25 : .8)));
    if (el.dataset.graphZoom === 'reset') state.graphPan = { x: 0, y: 0 };
    $('#network-svg')?.setAttribute('viewBox', graphViewBox()); resizeGraphLabels();
  }));
  const svg = $('#network-svg');
  resizeGraphLabels();
  if (svg) {
    svg.querySelectorAll('[data-graph-node]').forEach(el => {
      el.addEventListener('click', () => { state.graphFocus = el.dataset.graphNode; render(); document.querySelector('[data-graph-node="' + CSS.escape(state.graphFocus) + '"]')?.focus({ preventScroll:true }); });
      el.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); state.graphFocus = el.dataset.graphNode; render(); } });
    });
    let drag = null;
    svg.addEventListener('pointerdown', event => { if (event.target.closest('[data-graph-node]')) return; event.preventDefault(); drag = { x: event.clientX, y: event.clientY, panX: state.graphPan.x, panY: state.graphPan.y, moved: false }; svg.setPointerCapture(event.pointerId); });
    svg.addEventListener('pointermove', event => { if (!drag) return; if (Math.hypot(event.clientX-drag.x, event.clientY-drag.y) < 5 && !drag.moved) return; drag.moved = true; const rect = svg.getBoundingClientRect(); const box = svg.viewBox.baseVal; state.graphPan = { x: drag.panX - (event.clientX-drag.x) * Math.max(box.width / rect.width, box.height / rect.height), y: drag.panY - (event.clientY-drag.y) * Math.max(box.width / rect.width, box.height / rect.height) }; svg.setAttribute('viewBox', graphViewBox()); });
    svg.addEventListener('pointerup', () => { if (drag && !drag.moved && state.graphFocus) { state.graphFocus = null; drag = null; render(); return; } drag = null; });
    svg.addEventListener('pointercancel', () => { drag = null; });
    svg.addEventListener('wheel', event => { event.preventDefault(); state.graphScale = Math.max(.6, Math.min(2.5, state.graphScale * (event.deltaY < 0 ? 1.1 : .9))); svg.setAttribute('viewBox', graphViewBox()); resizeGraphLabels(); }, { passive: false });
  }
}

function archiveToggle() { return `<label class="archive-toggle"><input id="include-archive" type="checkbox" ${state.includeArchive ? 'checked' : ''}> Include archived changes</label>`; }

function resizeGraphLabels() {
  const svg=$('#network-svg'); if(!svg)return;
  const rect=svg.getBoundingClientRect(),box=svg.viewBox.baseVal;
  const scale=Math.min(rect.width/box.width,rect.height/box.height);
  if(!scale)return;
  svg.querySelectorAll('.network-node text').forEach(text=>{text.style.fontSize=Math.max(14,12/scale)+'px';});
}
