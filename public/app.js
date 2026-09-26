const state = { data: null, view: 'overview', item: null, tab: null, section: null, query: '', filter: 'all', milestone: 'all', mapChange: null, mapQuery: '', graphFocus: null, graphScale: 1, graphPan: { x: 0, y: 0 }, timelineChange: null, timelineTask: null, fileFolders: new Map(), loading: false, refreshQueued: false, latestRevision: null, liveConnected: false, stale: false, includeArchive: false, neighborhood: false, graphLabels: false, timelineMode: 'both', timelineRange: '180', effortRequestId: null };
const $ = (selector) => document.querySelector(selector);
const escapeHtml = (value = '') => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const fmtDate = (value) => {
  if (!value) return '—';
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00`) : new Date(value);
  return date.toLocaleDateString(undefined, { year:'numeric', month:'short', day:'numeric' });
};
const pct = (task) => task.total ? Math.round(task.done / task.total * 100) : 0;
const doc = (path) => state.data.docs.find(d => d.path === path);
const caps = (s) => s.replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
const countLabel = (count, singular) => `${count} ${singular}${count === 1 ? '' : 's'}`;
const itemStatus = (item) => item.tasks.total === 0 ? ['Proposed', 'draft'] : item.tasks.done === item.tasks.total ? ['Checklist complete', 'complete'] : item.tasks.done > 0 ? ['In progress', 'active'] : ['Planned', 'planned'];
const progressBar = (task) => `<progress class="progress" value="${task.done}" max="${task.total || 1}" aria-label="${task.done} of ${task.total} checklist tasks complete">${pct(task)}%</progress>`;
const milestoneLabel = (id) => state.data.milestones?.find(m => m.id === id)?.label || id;
const pathParts = (path) => path.split('/').filter(Boolean);
const toast = (message) => { const el = $('#toast'); el.textContent = message; el.classList.add('show'); clearTimeout(toast.timer); toast.timer = setTimeout(() => el.classList.remove('show'), 3200); };

function route(view, item = null, tab = null) {
  state.view = view; state.item = item; state.tab = tab; state.section = null; state.query = ''; state.filter = 'all';
  const hash = [view, item, tab].filter(Boolean).map(encodeURIComponent).join('/');
  if (location.hash.slice(1) !== hash) location.hash = hash;
  render();
  $('#main').focus({ preventScroll: true });
  $('#main').scrollTop = 0;
}
function fromHash() {
  const [path, query] = location.hash.slice(1).split('?');
  let parts; try { parts = path.split('/').map(decodeURIComponent); } catch { toast('Invalid address; opened Overview'); parts = []; }
  const params = new URLSearchParams(query || '');
  if (['map','graph','timeline'].includes(parts[0])) { state.milestone = params.get('milestone') || 'all'; state.includeArchive = params.get('archive') === '1'; state.mapChange = params.get('change'); state.timelineChange = params.get('change'); state.timelineTask = params.get('task'); state.graphFocus = params.get('node'); }
  const valid = ['overview','map','graph','timeline','changes','specs','archive','files','diagnostics'];
  state.view = valid.includes(parts[0]) ? parts[0] : 'overview'; state.item = parts[1] || null; state.tab = parts[2] || null; state.section = parts[3] || null;
  state.query = ''; state.filter = 'all'; render();
}

function showSyncStatus() {
  const synced = state.data?.generatedAt ? new Date(state.data.generatedAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : '';
  $('#last-scan').textContent = `${state.stale ? 'Stale · refresh failed' : !state.data?.watcher?.healthy ? 'Watcher unavailable · polling' : state.liveConnected ? 'Live' : 'Reconnecting'}${synced ? ` · synced ${synced}` : ''}`;
}

async function load(initial = false, source = 'manual') {
  if (state.loading) { state.refreshQueued = true; return; }
  state.loading = true;
  const requestedRevision = state.latestRevision;
  $('#refresh').classList.add('spinning');
  try {
    const response = await fetch('/api/data' + (state.data?.revision ? '?since=' + encodeURIComponent(state.data.revision) + (source === 'manual' ? '&fresh=1' : '') : ''), { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const nextData = await response.json();
    if(nextData.documentsDelta && state.data) { const incoming=new Map(nextData.docs.map(d=>[d.path,d])); nextData.docs=state.data.docs.filter(d=>!nextData.removedDocs.includes(d.path)).map(d=>{ const next=incoming.get(d.path);incoming.delete(d.path);return next || d; }).concat([...incoming.values()]); }
    const active = document.activeElement;
    const focusId = active?.id;
    const cursor = focusId === 'search' ? active.selectionStart : null;
    const effortInputs = Object.fromEntries(['effort-task','effort-date','effort-minutes','effort-note'].map(id => [id, document.getElementById(id)?.value]));
    state.data = nextData; state.stale = false;
    
    $('#workspace-name').textContent = state.data.name;
    document.title = `${state.data.name} · OpenSpec Portal`;
    $('#nav-changes').textContent = state.data.changes.length;
    $('#nav-specs').textContent = state.data.specs.length;
    $('#nav-archive').textContent = state.data.archive.length;
    render();
    for (const [id, value] of Object.entries(effortInputs)) if (value !== undefined && document.getElementById(id)) document.getElementById(id).value = value;
    if (focusId && document.getElementById(focusId)) {
      const target = document.getElementById(focusId);
      target.focus({ preventScroll: true });
      if (cursor !== null) target.setSelectionRange(cursor, cursor);
    }
    showSyncStatus();
    if (state.latestRevision !== requestedRevision && state.latestRevision !== state.data.watchRevision) state.refreshQueued = true;
    if (!initial && source === 'manual') toast('Repository refreshed');
  } catch (error) {
    state.stale = true; showSyncStatus();
    if (state.data) { toast('Refresh failed; displaying the last successful scan'); return; }
    $('#main').innerHTML = `<div class="error-card"><h2>Could not load the repository</h2><p>${escapeHtml(error.message)}</p><button id="retry" class="primary-button">Retry</button></div>`;
    $('#retry')?.addEventListener('click', () => load());
  } finally {
    state.loading = false; $('#refresh').classList.remove('spinning');
    if (state.refreshQueued) { state.refreshQueued = false; queueMicrotask(() => load(false, 'live')); }
  }
}

function connectLive() {
  const events = new EventSource('/api/events');
  const onRevision = event => {
    state.liveConnected = true;
    state.latestRevision = event.data;
    showSyncStatus();
    if (state.data && event.data !== state.data.watchRevision) load(false, 'live');
  };
  events.addEventListener('health', event => { try { if (state.data) state.data.watcher = JSON.parse(event.data); showSyncStatus(); } catch {} });
  events.addEventListener('ready', onRevision);
  events.addEventListener('change', onRevision);
  events.onerror = () => { state.liveConnected = false; showSyncStatus(); };
  // Also recover from missed watcher events or a temporarily unavailable stream.
  setInterval(() => load(false, 'background'), 120000);
  window.addEventListener('beforeunload', () => events.close());
}

function pageHeader(eyebrow, title, description, trailing = '') {
  state.pageHeading = { eyebrow, title, description, trailing };
  return '';
}
function sectionTitle(title, meta = '') { return `<div class="section-title"><h2>${title}</h2><span>${meta}</span></div>`; }
function empty(title, message) { return `<div class="empty"><div class="empty-glyph">◇</div><h3>${title}</h3><p>${message}</p></div>`; }

function changeCard(item) {
  const [status, tone] = itemStatus(item);
  return `<button class="change-card" data-open-change="${escapeHtml(item.id)}" data-kind="${item.archived ? 'archive' : 'changes'}">
    <div class="card-top"><span class="status ${item.archived ? 'archived' : tone}"><i></i>${item.archived ? 'Archived' : status}</span><span class="card-date">${fmtDate(item.date || item.modified)}</span></div>
    <h3>${escapeHtml(item.title)}</h3>${item.milestone ? `<span class="milestone-tag">${escapeHtml(item.milestone)} · ${escapeHtml(milestoneLabel(item.milestone))}</span>` : ''}<p>${escapeHtml(item.goal || item.summary || 'Open the change to review its artifacts and progress.')}</p>
    <div class="card-bottom"><span>${countLabel(item.files.filter(filePath => !/\/\.openspec\.yaml$/.test(filePath)).length, 'file')} · ${countLabel(item.requirements, 'requirement')}</span><span>${item.tasks.total ? `${item.tasks.done}/${item.tasks.total} tasks` : 'No tasks yet'}</span></div>
    ${item.tasks.total ? progressBar(item.tasks) : ''}
  </button>`;
}
function specCard(item) {
  return `<button class="spec-card" data-open-spec="${escapeHtml(item.id)}"><div class="spec-icon">▤</div><div class="spec-info"><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.purpose || 'No purpose recorded yet.')}</p><div class="spec-meta"><span>${countLabel(item.requirements.length, 'requirement')}</span><span>${countLabel(item.scenarios.length, 'scenario')}</span></div></div><span class="arrow">↗</span></button>`;
}
function statCard(value, label, note, icon) { return `<button data-view="${label === 'Capabilities' ? 'specs' : label === 'Archived changes' ? 'archive' : 'changes'}" class="stat-card"><div class="stat-icon">${icon}</div><strong>${value}</strong><span>${label}</span><small>${note}</small></button>`; }

function overview() {
  const d = state.data;
  const totalTasks = d.changes.reduce((n, c) => n + c.tasks.total, 0);
  const doneTasks = d.changes.reduce((n, c) => n + c.tasks.done, 0);
  const active = d.changes.filter(c => c.tasks.done > 0 && c.tasks.done < c.tasks.total).length;
  const checked = d.changes.filter(c => c.tasks.total > 0 && c.tasks.done === c.tasks.total).length;
  const recent = [...d.changes].sort((a,b) => b.modified.localeCompare(a.modified)).slice(0, 6);
  return `${pageHeader('PROJECT AT A GLANCE', escapeHtml(d.name), 'A clear view of current behavior, proposed changes, and work in progress.', `<div class="repo-path" title="${escapeHtml(d.repo)}">${escapeHtml(d.repo)}</div>`)}
    ${d.warnings?.length ? `<div class="warning"><strong>Repository diagnostics</strong><ul>${d.warnings.map(w=>`<li>${escapeHtml(w)}</li>`).join('')}</ul></div>` : ''}
    <div class="stats">${statCard(d.changes.length, 'Active changes', `${active} with checked tasks`, '◈')}${statCard(d.specs.length, 'Capabilities', countLabel(d.specs.reduce((n,s)=>n+s.requirements.length,0), 'requirement'), '▤')}${statCard(`${doneTasks}/${totalTasks}`, 'Tasks completed', totalTasks ? `${Math.round(doneTasks/totalTasks*100)}% of active checklists` : 'No checklists yet', '✓')}${statCard(d.archive.length, 'Archived changes', `${checked} active checklists fully checked`, '◷')}</div>
    <p class="progress-note">${d.changes.filter(c => !c.tasks.total).length} active changes have no checklist and are outside the task percentage. Counts describe the current scope, not delivery readiness.</p>${reviewQueue()}<div class="overview-grid"><section>${sectionTitle('Current changes', `${d.changes.length} total`)}${recent.length ? `<div class="card-grid">${recent.map(changeCard).join('')}</div>` : empty('No active changes', 'Create a change proposal to see it here.')}</section>
    <aside class="overview-side"><div class="side-card"><div class="side-icon">◎</div><h3>Explore the structure</h3><p>See how project milestones group peer changes, and which capability specs each change affects.</p><button class="text-link" data-view="map">Open project map →</button></div><div class="side-card"><div class="side-icon">◷</div><h3>Task history and effort</h3><p>Review checklist activity by date and log actual minutes against each task.</p><button class="text-link" data-view="timeline">Open timeline →</button></div><div class="side-card"><div class="side-icon">↗</div><h3>Progress is task based</h3><p>Percentages count checked boxes in <code>tasks.md</code>. Review the requirements and implementation before treating a change as complete.</p></div></aside></div>`;
}

function collection(kind) {
  const data = state.data;
  const config = {
    changes: ['ACTIVE WORK', 'Changes in motion', 'Explore proposals, design choices, and implementation progress.', data.changes],
    archive: ['PROJECT HISTORY', 'Archived changes', 'The decisions and requirements that shaped the product.', data.archive],
    specs: ['CURRENT PRODUCT CONTRACT', 'Specifications', 'The accepted behavior of the system, organized by capability.', data.specs]
  }[kind];
  const [eyebrow, title, description, items] = config;
  const q = state.query.toLowerCase();
  let filtered = items.filter(item => !q || JSON.stringify(item).toLowerCase().includes(q) || (item.files || [item.path]).some(p=>doc(p)?.text.toLowerCase().includes(q)));
  if (kind === 'changes' && state.filter !== 'all') filtered = filtered.filter(item => itemStatus(item)[1] === state.filter);
  return `${pageHeader(eyebrow, title, description)}<div class="toolbar"><label class="search-box"><span>⌕</span><input id="search" type="search" placeholder="Search ${kind === 'specs' ? 'capabilities' : 'changes'}…" value="${escapeHtml(state.query)}" aria-label="Search ${kind}"></label>${kind === 'changes' ? `<div class="segmented">${['all','draft','planned','active','complete'].map(key=>`<button data-filter="${key}" class="${state.filter===key?'selected':''}">${({all:'All',draft:'Proposed',planned:'Planned',active:'In progress',complete:'Checklist complete'})[key]}</button>`).join('')}</div>` : ''}</div>
    <div class="results-count">${filtered.length} ${kind === 'specs' ? 'capabilities' : 'changes'}</div>
    ${filtered.length ? `<div class="${kind === 'specs' ? 'spec-grid' : 'card-grid collection-grid'}">${filtered.map(kind === 'specs' ? specCard : changeCard).join('')}</div>` : empty('Nothing found', q ? 'Try another search term or filter.' : `No ${kind} are present yet.`)}`;
}

function fileTree(paths, selected = null) {
  const root = { folders: new Map(), files: [] };
  for (const filePath of paths) {
    const parts = pathParts(filePath);
    let node = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const name = parts[i];
      if (!node.folders.has(name)) node.folders.set(name, { name, path: parts.slice(0, i + 1).join('/'), folders: new Map(), files: [] });
      node = node.folders.get(name);
    }
    node.files.push({ name: parts.at(-1), path: filePath });
  }
  const byName = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
  const renderNode = node => {
    const folders = [...node.folders.values()].sort(byName).map(folder => {
      const count = countFiles(folder);
      const open = state.query ? true : state.fileFolders.has(folder.path) ? state.fileFolders.get(folder.path) : selected?.startsWith(`${folder.path}/`);
      return `<details class="tree-folder" data-folder="${escapeHtml(folder.path)}" ${open ? 'open' : ''}><summary title="${escapeHtml(folder.path)}"><span class="tree-folder-icon" aria-hidden="true">▱</span><span class="tree-name">${escapeHtml(folder.name)}</span><small>${count}</small></summary><div class="tree-children">${renderNode(folder)}</div></details>`;
    }).join('');
    const files = node.files.sort(byName).map(file => `<button type="button" data-file="${escapeHtml(file.path)}" title="${escapeHtml(file.path)}" class="tree-file ${selected === file.path ? 'selected' : ''}" ${selected === file.path ? 'aria-current="page"' : ''}><span class="tree-file-icon" aria-hidden="true">${file.name.endsWith('.md') ? '▤' : '◇'}</span><span class="tree-name">${escapeHtml(file.name)}</span></button>`).join('');
    return folders + files;
  };
  const countFiles = node => node.files.length + [...node.folders.values()].reduce((sum, folder) => sum + countFiles(folder), 0);
  return `<div class="file-tree">${renderNode(root)}</div>`;
}
function headingSlug(text) { return text.toLowerCase().trim().replace(/[^\p{L}\p{N} _-]/gu, '').replace(/\s+/g, '-'); }
function capabilityRoute(id) {
  const spec = state.data.specs.find(s => s.id === id);
  if (spec) return route('specs', id);
  const change = allChanges().find(c => c.capabilities.includes(id));
  const path = change?.files.find(p => p.endsWith('/specs/' + id + '/spec.md'));
  if (change && path) route(change.archived ? 'archive' : 'changes', change.id, path);
  else toast('No current or delta specification available');
}
function documentStructure(filePath) {
  const d = doc(filePath);
  if (!d?.html) return { html: '', sections: [] };
  if (d._structure) return d._structure;
  const root = document.createElement('div');
  root.innerHTML = d.html;
  const seen = new Map();
  const sections = [...root.querySelectorAll('h1,h2,h3,h4,h5,h6')].map(heading => {
    const slug = headingSlug(heading.textContent) || 'section', count = seen.get(slug) || 0; seen.set(slug, count + 1);
    const id = slug + (count ? '-' + count : '');
    heading.id = id;
    return { id, level: Number(heading.tagName.slice(1)), title: heading.textContent.trim() };
  });
  root.querySelectorAll('a[href]').forEach(link => {
    const href = link.getAttribute('href');
    if (/^(?:https?:|mailto:|tel:)/i.test(href)) { link.target = '_blank'; link.rel = 'noopener noreferrer'; return; }
    if (/^[a-z]+:/i.test(href)) return;
    let target, anchor;
    try { const parts = href.split('#'); target = decodeURIComponent(parts[0]); anchor = decodeURIComponent(parts[1] || ''); } catch { link.removeAttribute('href'); return; }
    if (target.startsWith('/') && !target.startsWith('/openspec/')) { link.removeAttribute('href'); link.title = 'Target is outside openspec/'; return; }
    const parts = target.startsWith('/') ? target.replace(/^\/openspec\//, '').split('/') : [...filePath.split('/').slice(0, -1), ...target.split('/')];
    const normalized = []; let outside = false; for (const part of parts) { if (part === '..') { if (!normalized.length) outside = true; normalized.pop(); } else if (part && part !== '.') normalized.push(part); }
    const destination = target ? normalized.join('/') : filePath;
    if (outside || !doc(destination)) { link.removeAttribute('href'); link.title = 'Target is outside the browsable OpenSpec documents'; link.classList.add('unavailable-link'); return; }
    link.href = '#' + ['files', destination, '', anchor].map(encodeURIComponent).join('/');
  });
  root.querySelectorAll('img').forEach(image => { const note=document.createElement('span'); note.className='unavailable-link'; note.textContent='[Image: '+(image.alt || 'asset')+' — not served by this document portal]'; image.replaceWith(note); });
  root.querySelectorAll('code').forEach(code => {
    if (/^(ADDED|MODIFIED|REMOVED|RENAMED|MUST|SHALL|SHOULD|MAY|GIVEN|WHEN|THEN)$/.test(code.textContent.trim())) code.classList.add('spec-code-keyword');
  });
  const keywords = /\b(ADDED|MODIFIED|REMOVED|RENAMED|Requirement|Requirements|Scenario|Scenarios|MUST|SHALL|SHOULD|MAY|GIVEN|WHEN|THEN)\b/g;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const matches = [];
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (node.parentElement.closest('code,pre,a')) continue;
    if (keywords.test(node.nodeValue)) matches.push(node);
    keywords.lastIndex = 0;
  }
  for (const node of matches) {
    const fragment = document.createDocumentFragment();
    let start = 0;
    for (const match of node.nodeValue.matchAll(keywords)) {
      fragment.append(document.createTextNode(node.nodeValue.slice(start, match.index)));
      const span = document.createElement('span');
      span.className = `spec-keyword ${/^(ADDED|MODIFIED|REMOVED|RENAMED)$/.test(match[0]) ? 'delta' : /^(Requirement|Requirements|Scenario|Scenarios)$/.test(match[0]) ? 'label' : 'rule'}`;
      span.textContent = match[0];
      fragment.append(span);
      start = match.index + match[0].length;
    }
    fragment.append(document.createTextNode(node.nodeValue.slice(start)));
    node.replaceWith(fragment);
  }
  return d._structure = { html: root.innerHTML, sections };
}
function changeOutline(paths, selected) {
  return `<div class="file-list change-outline">${paths.map(filePath => {
    const active = selected === filePath;
    const sections = documentStructure(filePath).sections;
    return `<div class="outline-file"><button data-file="${escapeHtml(filePath)}" class="file-row ${active?'selected':''}" aria-expanded="${active}" title="${escapeHtml(filePath)}"><span class="file-glyph">▤</span><span>${escapeHtml(pathParts(filePath).at(-1))}</span><small>${escapeHtml(filePath.split('/').slice(-3,-1).join('/'))}</small></button>${active && sections.length ? `<div class="outline-sections">${sections.map(section => `<button class="outline-section level-${section.level} ${state.section===section.id?'selected':''}" data-section="${section.id}" data-section-file="${escapeHtml(filePath)}" title="${escapeHtml(section.title)}">${escapeHtml(section.title)}</button>`).join('')}</div>` : ''}</div>`;
  }).join('')}</div>`;
}
function docPane(filePath) {
  const d = doc(filePath);
  if (!d) return empty('File unavailable', 'Refresh the portal if this file was moved.');
  return `<div class="document"><div class="document-head"><div><span class="eyebrow">${escapeHtml(d.path)}</span><h2>${d.html ? '' : escapeHtml(d.title)}</h2></div><button class="copy-button" data-copy="${escapeHtml(d.path)}">${d.html ? 'Copy Markdown' : 'Copy source'}</button></div>${d.html ? `<article class="markdown">${documentStructure(filePath).html}</article>` : `<pre class="raw-document">${escapeHtml(d.text)}</pre>`}</div>`;
}
function changeDetail(kind, itemId) {
  let item = state.data[kind].find(c => c.id === itemId);
  if (!item && kind === 'changes') { const matches = state.data.archive.filter(c=>c.stableId===itemId); if(matches.length===1) { item=matches[0]; state.view='archive'; state.item=item.id; kind='archive'; } }
  if (!item) return empty('Change not found', 'It may have been renamed or archived. Refresh to update the portal.');
  const ordered = ['proposal.md','design.md','tasks.md'];
  const files = item.files.filter(filePath => !/\/\.openspec\.yaml$/.test(filePath)).sort((a,b)=> {
    const aa = ordered.indexOf(pathParts(a).at(-1)), bb = ordered.indexOf(pathParts(b).at(-1));
    return (aa < 0 ? 9 : aa) - (bb < 0 ? 9 : bb) || a.localeCompare(b);
  });
  const selected = files.includes(state.tab) ? state.tab : files[0];
  const [status, tone] = itemStatus(item);
  const related = item.capabilities?.length ? `<div class="related"><div class="eyebrow">CAPABILITIES AFFECTED</div>${item.capabilities.map(cap => `<button data-open-spec="${escapeHtml(cap)}">${escapeHtml(caps(cap.split('/').at(-1)))} ↗</button>`).join('')}</div>` : '';
  const artifacts = item.artifacts || {};
  const artifactText = [['Proposal', artifacts.proposal], ['Design', artifacts.design], ['Tasks', artifacts.checklist], ['Delta specs', artifacts.deltaSpecs]].map(([name, present]) => `<span class="artifact ${present ? 'present' : ''}">${present ? '✓' : '○'} ${name}${name === 'Delta specs' && present ? ` (${present})` : ''}</span>`).join('');
  const sections = item.tasks.sections || [];
  return `<div class="backline"><button data-back="${kind}">← ${kind === 'archive' ? 'Archive' : 'Active changes'}</button></div>
    ${pageHeader(item.archived ? 'ARCHIVED CHANGE' : 'CHANGE PROPOSAL', escapeHtml(item.title), escapeHtml(item.goal || item.summary || 'Review this change and its supporting artifacts.'), `<span class="status large ${item.archived ? 'archived' : tone}"><i></i>${item.archived ? 'Archived' : status}</span>`)}
    <div class="detail-milestone">${item.milestone ? `Project milestone: <button data-view="map" data-select-milestone="${escapeHtml(item.milestone)}">${escapeHtml(item.milestone)} · ${escapeHtml(milestoneLabel(item.milestone))} ↗</button>` : 'No milestone line'} <button data-timeline-open="${escapeHtml(item.id)}">Task timeline ↗</button></div>
    <details class="change-summary"><summary>Checklist, planning artifacts, and review status</summary><div class="detail-meta"><div><strong>${item.tasks.done}/${item.tasks.total}</strong><span>Tasks complete</span></div><div><strong>${item.requirements}</strong><span>Requirements</span></div><div><strong>${files.length}</strong><span>Files</span></div><div><strong>${fmtDate(item.date || item.modified)}</strong><span>${item.archived ? 'Archived' : 'Last updated'}</span></div></div>
    <div class="detail-progress">${item.tasks.total ? progressBar(item.tasks) : ''}<span>${item.tasks.total ? `${item.tasks.done} of ${item.tasks.total} checked · ${pct(item.tasks)}% of checklist` : 'No checklist tasks recorded'}</span></div>
    <div class="artifact-row"><span class="eyebrow">ARTIFACTS</span>${item.planning ? item.planning.artifacts.map(artifact => `<span class="artifact ${artifact.status === 'done' ? 'present' : ''}" title="${escapeHtml(artifact.outputPath)}; requires: ${escapeHtml(artifact.requires.join(', ') || 'none')}; missing: ${escapeHtml(artifact.missingDeps.join(', ') || 'none')}">${escapeHtml(artifact.id)} · ${escapeHtml(artifact.status)}</span>`).join('') : artifactText}<span class="progress-note">${item.planning ? `Schema: ${escapeHtml(item.schema)} · planning ${item.planning.complete ? 'complete' : 'incomplete'}` : 'Filesystem view · schema readiness unknown'}</span></div>
    ${sections.length ? `<section class="task-breakdown">${sectionTitle('Checklist by section', 'Checked tasks / total tasks')}<div class="task-section-grid">${sections.map(section => `<div class="task-section"><div><strong>${escapeHtml(section.title)}</strong><span>${section.done}/${section.total}</span></div>${progressBar(section)}</div>`).join('')}</div></section>` : ''}
    <p class="progress-note">Checklist completion reflects checked boxes in the schema's implementation checklist. It does not certify implementation, verification, or release readiness.</p>${evidenceView(item)}${reviewControls(item)}</details>${related}
    <div class="detail-layout"><aside class="detail-nav"><div class="eyebrow">CONTENTS</div>${changeOutline(files, selected)}</aside>${docPane(selected)}</div>`;
}
function specDetail(itemId) {
  const item = state.data.specs.find(s => s.id === itemId);
  if (!item) return empty('Specification not found', 'Refresh to update the portal.');
  const related = [...state.data.changes, ...state.data.archive].filter(change => change.capabilities?.includes(itemId));
  const relatedHtml = related.length ? `<section class="related-changes">${sectionTitle('Related changes', `${related.length} found`)}<div class="card-grid">${related.map(changeCard).join('')}</div></section>` : '';
  return `<div class="backline"><button data-back="specs">← Specifications</button></div>${pageHeader('CAPABILITY SPECIFICATION', escapeHtml(item.title), escapeHtml(item.purpose || 'Current accepted behavior for this capability.'))}<div class="detail-meta compact"><div><strong>${item.requirements.length}</strong><span>Requirements</span></div><div><strong>${item.scenarios.length}</strong><span>Scenarios</span></div><div><strong>${fmtDate(item.modified)}</strong><span>Last updated</span></div></div><div class="detail-layout"><aside class="detail-nav">${changeOutline([item.path],item.path)}</aside>${docPane(item.path)}</div>${traceabilityView(item)}${relatedHtml}`;
}
function allFiles() {
  const q = state.query.toLowerCase();
  const paths = state.data.docs.map(d=>d.path).filter(p => !state.fileScope || state.fileScope === 'all' || (state.fileScope === 'specs' ? p.startsWith('specs/') : state.fileScope === 'archive' ? p.startsWith('changes/archive/') : p.startsWith('changes/') && !p.startsWith('changes/archive/'))).filter(p => !q || p.toLowerCase().includes(q) || doc(p).text.toLowerCase().includes(q));
  const selected = paths.includes(state.item) ? state.item : paths.find(p => p === 'config.yaml') || paths.find(p => p.startsWith('specs/')) || paths[0];
  return `${pageHeader('REPOSITORY CONTENTS', 'All OpenSpec files', 'Browse configuration, specs, proposals, checklists, and history in one place.')}
    <div class="toolbar"><label class="search-box"><span>⌕</span><input id="search" type="search" placeholder="Search proposals, requirements, scenarios, and tasks…" value="${escapeHtml(state.query)}" aria-label="Search files"></label><label>Scope <select id="files-scope">${['all','changes','specs','archive'].map(scope=>`<option ${state.fileScope===scope ? 'selected' : ''}>${scope}</option>`).join('')}</select></label><span class="results-count">${paths.length} files</span></div>
    ${q ? `<div class="search-results">${paths.slice(0,30).map(p => { const text = doc(p).text; const index = Math.max(0,text.toLowerCase().indexOf(q)); return `<button data-file="${escapeHtml(p)}"><strong>${escapeHtml(p)}</strong><span>${escapeHtml(text.slice(Math.max(0,index-50),index+180))}</span></button>`; }).join('')}</div>` : ''}<div class="detail-layout files-layout"><aside class="detail-nav" aria-label="OpenSpec file tree">${fileTree(paths, selected)}</aside>${selected ? docPane(selected) : empty('No files found', 'Try another search term.')}</div>`;
}

function render() {
  if (!state.data) { $('#main').innerHTML = '<div class="loading">Loading OpenSpec repository…</div>'; return; }
  const view = state.view;
  const focused = document.activeElement;
  const focusIdentity = focused?.id ? '#' + CSS.escape(focused.id) : focused?.dataset.graphNode ? '[data-graph-node="'+CSS.escape(focused.dataset.graphNode)+'"]' : null;
  const openDetails = [...document.querySelectorAll('#main details[open]')].map(el=>el.className).filter(name=>name==='change-summary' || name==='effort-panel' || name==='structure-note');
  const mainScroll = $('#main').scrollTop;
  const ganttScroll = view === 'timeline' ? { top: $('.gantt-shell')?.scrollTop || 0, left: $('.gantt-shell')?.scrollLeft || 0 } : null;
  const labels = { overview:'Overview', map:'Project map', graph:'Node graph', timeline:'Timeline', changes:'Active changes', specs:'Specifications', archive:'Archive', files:'All files', diagnostics:'Repository health' };
  const scroll = view === 'map' ? { milestones: $('.map-milestones')?.scrollTop || 0, changes: $('.map-change-list')?.scrollTop || 0, detail: $('.map-detail-scroll')?.scrollTop || 0 } : null;
  const fileScroll = view === 'files' ? $('.files-layout .detail-nav')?.scrollTop || 0 : null;
  state.pageHeading = null;
  document.querySelectorAll('.nav-item').forEach(el => el.classList.toggle('active', el.dataset.view === view));
  $('#main').className = `view-${view}`;
  $('#main').innerHTML = view === 'diagnostics' ? diagnosticsView() : view === 'overview' ? overview() : view === 'map' ? projectMapV2() : view === 'graph' ? nodeGraphView() : view === 'timeline' ? timelineView() : view === 'files' ? allFiles() : state.item ? (view === 'specs' ? specDetail(state.item) : changeDetail(view, state.item)) : collection(view);
  const heading = state.pageHeading || { eyebrow: 'OPENSPEC', title: labels[view], description: '', trailing: '' };
  $('#topbar-eyebrow').innerHTML = heading.eyebrow;
  $('#topbar-title').innerHTML = heading.title;
  $('#topbar-description').innerHTML = heading.description;
  $('#topbar-extra').innerHTML = heading.trailing;
  if (scroll) {
    $('.map-milestones').scrollTop = scroll.milestones;
    $('.map-change-list').scrollTop = scroll.changes;
    $('.map-detail-scroll').scrollTop = scroll.detail;
  }
  if (fileScroll !== null) $('.files-layout .detail-nav').scrollTop = fileScroll;
  $('#main').scrollTop = mainScroll;
  if (ganttScroll && $('.gantt-shell')) { $('.gantt-shell').scrollTop = ganttScroll.top; $('.gantt-shell').scrollLeft = ganttScroll.left; }
  for (const name of openDetails) document.querySelector('#main details.'+name)?.setAttribute('open','');
  if(focusIdentity) document.querySelector(focusIdentity)?.focus({preventScroll:true});
  bindDynamic();
  if (['map','graph','timeline'].includes(view)) bindExplore();
  syncExploreUrl();
  if (state.section && ['changes','archive','specs','files'].includes(view)) document.getElementById(state.section)?.scrollIntoView({ block: 'start' });
}
function bindDynamic() {
  $('#run-validation')?.addEventListener('click',async()=>{const button=$('#run-validation');button.disabled=true;button.textContent='Validating…';try{const response=await fetch('/api/validate',{cache:'no-store'}), data=await response.json();if(!response.ok)throw Error(data.error);state.validation=data;$('#validation-result').innerHTML=validationMarkup(data);}catch(error){$('#validation-result').textContent=error.message;}finally{button.disabled=false;button.textContent='Run OpenSpec validation';}});
  document.querySelectorAll('[data-review-change]').forEach(el => el.addEventListener('click', () => { const change = allChanges().find(c => c.id === el.dataset.reviewChange); const checkpoints = reviewCheckpoints(); checkpoints[change.path] = { at: new Date().toISOString(), revision: state.data.gitRevision || 'unavailable', fingerprint: change.fingerprint, total: change.tasks.total, done: change.tasks.done, files: change.files.map(p => ({ path: p, text: doc(p)?.text || '' })) }; try { localStorage.setItem(reviewStorageKey(), JSON.stringify(checkpoints)); render(); toast('Human review checkpoint saved in this browser'); } catch { toast('Browser storage is full; checkpoint was not saved'); } }));
  document.querySelectorAll('.tree-folder > summary').forEach(summary => summary.addEventListener('click', () => {
    const folder = summary.parentElement;
    state.fileFolders.set(folder.dataset.folder, !folder.open);
  }));
  document.querySelectorAll('#main [data-view]').forEach(el => el.addEventListener('click', () => { if (el.dataset.selectMilestone) state.milestone = el.dataset.selectMilestone; route(el.dataset.view); }));
  document.querySelectorAll('[data-timeline-open]').forEach(el => el.addEventListener('click', () => { const change = allChanges().find(c => c.id === el.dataset.timelineOpen); state.milestone = change?.milestone || 'unassigned'; state.timelineChange = el.dataset.timelineOpen; route('timeline'); }));
  document.querySelectorAll('[data-milestone]').forEach(el => el.addEventListener('click', () => { state.milestone = el.dataset.milestone; state.mapChange = null; state.timelineChange = null; state.graphFocus = null; render(); if (state.view === 'map') { $('.map-change-list').scrollTop = 0; $('.map-detail-scroll').scrollTop = 0; } }));
  $('#files-scope')?.addEventListener('change',event=>{state.fileScope=event.target.value;render();});
  $('#search')?.addEventListener('input', event => {
    const cursor = event.target.selectionStart;
    state.query = event.target.value;
    render();
    if (state.view === 'files') $('.files-layout .detail-nav').scrollTop = 0;
    const input = $('#search'); input.focus(); input.setSelectionRange(cursor, cursor);
  });
  document.querySelectorAll('[data-filter]').forEach(el => el.addEventListener('click', () => { state.filter = el.dataset.filter; render(); }));
  document.querySelectorAll('[data-open-change]').forEach(el => el.addEventListener('click', () => route(el.dataset.kind, el.dataset.openChange)));
  document.querySelectorAll('[data-open-spec]').forEach(el => el.addEventListener('click', () => capabilityRoute(el.dataset.openSpec)));
  document.querySelectorAll('[data-back]').forEach(el => el.addEventListener('click', () => route(el.dataset.back)));
  document.querySelectorAll('[data-file]').forEach(el => el.addEventListener('click', () => {
    if (state.view === 'files') { state.item = el.dataset.file; location.hash = ['files', state.item].map(encodeURIComponent).join('/'); }
    else { state.tab = el.dataset.file; state.section = null; location.hash = [state.view, state.item, state.tab].map(encodeURIComponent).join('/'); }
    render();
  }));
  document.querySelectorAll('[data-section]').forEach(el => el.addEventListener('click', () => {
    state.tab = el.dataset.sectionFile; state.section = el.dataset.section;
    location.hash = (state.view === 'files' ? ['files', state.tab, '', state.section] : [state.view, state.item, state.tab, state.section]).map(encodeURIComponent).join('/');
    render();
  }));
  document.querySelectorAll('[data-copy]').forEach(el => el.addEventListener('click', async () => { try { await navigator.clipboard.writeText(doc(el.dataset.copy).text); toast('Source copied'); } catch { toast('Clipboard unavailable in this browser'); } }));
}

function validationMarkup(data) {
  const items=Array.isArray(data.result?.items)?data.result.items:[],failed=items.filter(i=>!i.valid),findings=items.filter(i=>!i.valid || (i.issues || []).some(issue=>issue.level==='ERROR' || issue.level==='WARNING'));
  return '<h3>'+items.filter(i=>i.valid).length+' valid · '+failed.length+' invalid OpenSpec items</h3><p class="progress-note">Official CLI document validation at '+escapeHtml(data.checkedAt)+'. This does not verify the implementation.</p>'+findings.map(item=>'<div class="validation-card"><h4><a href="#'+(item.type==='spec'?'specs':'changes')+'/'+encodeURIComponent(item.id)+'">'+escapeHtml(item.type+': '+item.id)+'</a> · '+(item.valid?'valid with findings':'invalid')+'</h4><ul>'+(item.issues || []).filter(issue=>issue.level!=='INFO').map(issue=>'<li><strong>'+escapeHtml(issue.level)+'</strong> '+escapeHtml(issue.path)+': '+escapeHtml(issue.message)+'</li>').join('')+'</ul></div>').join('')+'<details><summary>Full CLI report including informational messages</summary><pre class="raw-document">'+escapeHtml(JSON.stringify(data,null,2))+'</pre></details>';
}
function diagnosticsView() {
  const d=state.data;
  return pageHeader('DATA TRUST','Repository health','Inspect provenance and run the installed OpenSpec validator without modifying artifacts.') + '<div class="structure-note"><p>Schema status: '+escapeHtml(d.compatibility.source)+' · watcher: '+(d.watcher.healthy?'healthy':'unavailable')+' · last successful scan: '+escapeHtml(d.generatedAt)+'</p><p>Portal metadata is separate from OpenSpec artifacts. Validation covers OpenSpec documents, not implementation correctness.</p></div><h2>Diagnostics ('+d.warnings.length+')</h2>'+(d.warnings.length?'<ul>'+d.warnings.map(w=>'<li>'+escapeHtml(w)+'</li>').join('')+'</ul>':'<p>No scanner diagnostics.</p>')+'<button id="run-validation" class="primary-button">Run OpenSpec validation</button><div id="validation-result">'+(state.validation?validationMarkup(state.validation):'Validation has not been run in this session.')+'</div>';
}
function traceabilityView(spec) {
  const entries=allChanges().flatMap(change=>(change.portal?.evidence || []).filter(e=>e.capability===spec.id).map(e=>({...e,change})));
  return '<section class="traceability"><h2>Declared requirement evidence</h2><p class="progress-note">Exact, manually declared links from portal metadata. Missing links do not establish that behavior is untested; declared links do not certify a passing result.</p>'+spec.requirements.map(requirement=>{const links=entries.filter(e=>e.requirement===requirement);return '<div><strong>'+escapeHtml(requirement)+'</strong>'+ (links.length?links.map(e=>'<button data-open-change="'+escapeHtml(e.change.id)+'" data-kind="'+changeKind(e.change)+'">'+escapeHtml(e.label)+' · '+escapeHtml(e.kind)+'</button>').join(''):'<span>No evidence link declared</span>')+'</div>';}).join('')+'</section>';
}
function syncExploreUrl() {
  if (!['map','graph','timeline'].includes(state.view)) return;
  const params = new URLSearchParams(); if (state.milestone !== 'all') params.set('milestone',state.milestone);
  if (state.includeArchive) params.set('archive','1');
  const change = state.view === 'map' ? state.mapChange : state.view === 'timeline' ? state.timelineChange : null;
  if (change) params.set('change',change); if (state.view === 'graph' && state.graphFocus) params.set('node',state.graphFocus);
  if (state.view === 'timeline' && state.timelineTask) params.set('task',state.timelineTask);
  history.replaceState(null,'','#' + state.view + (params.size ? '?' + params : ''));
}
function reviewStorageKey() { return 'openspec-portal:reviews:' + state.data.repo; }
function evidenceView(item) {
  const evidence = item.portal?.evidence || [], decisions = item.portal?.decisions || [];
  return `<section class="evidence"><h3>Declared evidence and decisions</h3><p class="progress-note">Optional portal metadata. Provenance is declared by its author; the portal does not execute or certify evidence.</p>${evidence.length ? evidence.map(e => `<div><a href="${escapeHtml(e.url.startsWith('openspec:') ? '#files/' + encodeURIComponent(e.url.slice(9)) : e.url)}" ${e.url.startsWith('openspec:') ? '' : 'target="_blank" rel="noopener noreferrer"'}>${escapeHtml(e.label || e.url)}</a><span>${escapeHtml(e.kind)} · revision ${escapeHtml(e.revision || 'unspecified')} · ${escapeHtml(e.recordedAt || 'timestamp unspecified')}</span><small>${escapeHtml([e.capability,e.requirement,e.task ? 'task '+e.task : ''].filter(Boolean).join(' · '))}</small></div>`).join('') : '<p>No verification evidence declared.</p>'}${decisions.length ? `<h4>Decision log</h4><ul>${decisions.map(d=>`<li>${escapeHtml(d)}</li>`).join('')}</ul>` : ''}</section>`;
}
function reviewCheckpoints() { try { return JSON.parse(localStorage.getItem(reviewStorageKey()) || '{}'); } catch { return {}; } }
function reviewControls(item) {
  const prior = reviewCheckpoints()[item.path];
  const changed = prior && prior.fingerprint !== item.fingerprint;
  const diffs = changed ? item.files.map(p => { const previous = prior.files?.find(f => f.path === p)?.text; const current = doc(p)?.text || ''; if (previous === current) return ''; const oldLines = new Set((previous || '').split('\n')), newLines = new Set(current.split('\n')); return '<h4>' + escapeHtml(p) + '</h4><pre class="review-diff">' + escapeHtml([...oldLines].filter(l => !newLines.has(l)).map(l => '- ' + l).concat([...newLines].filter(l => !oldLines.has(l)).map(l => '+ ' + l)).join('\n')) + '</pre>'; }).join('') + (prior.files || []).filter(f=>!item.files.includes(f.path)).map(f=>'<h4>Removed: '+escapeHtml(f.path)+'</h4>').join('') : '';
  return '<div class="review-controls"><p>' + (prior ? 'Human review checkpoint: ' + fmtDate(prior.at) + (changed ? ' · source changed since review' : ' · source unchanged') + (prior.total !== item.tasks.total ? ' · checklist scope changed from ' + prior.total + ' to ' + item.tasks.total : '') : 'No human review checkpoint in this browser') + '</p><button data-review-change="' + escapeHtml(item.id) + '">Mark source reviewed</button><small>Records your review of this source snapshot. It does not verify implementation or tests.</small>' + (diffs ? '<details><summary>Changed lines since your review</summary><p>Line membership comparison; moved and repeated lines are not a full Git diff.</p>' + diffs + '</details>' : '') + '</div>';
}
function reviewQueue() {
  const checkpoints = reviewCheckpoints();
  const items = state.data.changes.filter(c => !checkpoints[c.path] || checkpoints[c.path].fingerprint !== c.fingerprint);
  return '<section class="attention-queue">' + sectionTitle('Needs your review', items.length + ' unreviewed or changed snapshots') + '<div class="attention-list">' + items.map(c => '<button data-open-change="' + escapeHtml(c.id) + '" data-kind="changes"><strong>' + escapeHtml(c.title) + '</strong><span>' + (checkpoints[c.path] ? 'Changed since review' : 'Unreviewed source') + (c.planning?.artifacts.some(a => a.status === 'blocked') ? ' · planning dependencies blocked' : '') + '</span></button>').join('') + '</div><p class="progress-note">Review checkpoints stay in this browser and belong to this repository. They are not OpenSpec workflow states.</p></section>';
}

$('#nav').addEventListener('click', event => { const el = event.target.closest('[data-view]'); if (el) route(el.dataset.view); });
$('#refresh').addEventListener('click', () => load());
window.addEventListener('hashchange', fromHash);
fromHash(); load(true); connectLive();
