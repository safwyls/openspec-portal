import http from 'node:http';
import { gzip } from 'node:zlib';
import { randomUUID } from 'node:crypto';
import { taskSummary, headings, validEntry, readLedger, resolveEffort, fingerprint } from './lib/model.mjs';
import { planningStatus, schemaChecklists, validateRepository } from './lib/openspec.mjs';
import { parse as parseYaml } from 'yaml';
import { projectMetadata } from './lib/project.mjs';
import fs from 'node:fs/promises';
import { watch } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import MarkdownIt from 'markdown-it';
import taskLists from 'markdown-it-task-lists';

const appDir = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(appDir, 'public');
const args = process.argv.slice(2);
const argValue = (name) => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
if (args.includes('--help') || args.includes('-h')) {
  console.log('Usage: npm start -- --repo <path-to-repository> [--port 4177]');
  process.exit(0);
}
const port = Number(argValue('--port') || process.env.PORT || 4177);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Port must be between 1 and 65535.');
const input = path.resolve(argValue('--repo') || process.cwd());
const repo = path.basename(input).toLowerCase() === 'openspec' ? path.dirname(input) : input;
const specRoot = path.join(repo, 'openspec');
const rootStat = await fs.stat(specRoot).catch(() => null);
if (!rootStat?.isDirectory()) {
  console.error(`No openspec/ directory found at ${specRoot}\nRun openspec init in your repository first, or pass --repo <path>.`);
  process.exit(1);
}
const md = new MarkdownIt({ html: false, linkify: true, typographer: true, breaks: false }).use(taskLists, { enabled: false });
const allowed = new Set(['.md', '.markdown', '.yml', '.yaml', '.json', '.txt']);
const maxFileBytes = 1024 * 1024;
const maxFiles = 5000;
const maxTotalBytes = 50 * 1024 * 1024;
const execFileAsync = promisify(execFile);
const liveClients = new Set();
const gzipAsync = promisify(gzip);
const rendered = new Map();
const snapshots = new Map();
let historyCache;
const watchId = `${process.pid}-${Date.now()}`;
let watchVersion = 0;
let watchTimer;
let watcher;
let watcherError = '';
let scannedAt = '';
let scanCache = null;
let scanPromise = null;
let writeQueue = Promise.resolve();
const sidecar = path.join(repo, '.openspec-portal');
const watcherHealth = () => ({ healthy: Boolean(watcher), error: watcherError, scannedAt, pending: Boolean(watchTimer) });
function publishHealth() { for (const res of liveClients) res.write(`event: health\ndata: ${JSON.stringify(watcherHealth())}\n\n`); }
const watchRevision = () => `${watchId}-${watchVersion}`;

function publishChange() {
  clearTimeout(watchTimer);
  watchTimer = setTimeout(() => {
    watchTimer = null; watchVersion++; scanCache = null;
    for (const res of liveClients) res.write(`event: change\ndata: ${watchRevision()}\n\n`);
  }, 350);
}

function startWatcher() {
  try {
    watcher = watch(specRoot, { recursive: true }, publishChange); watcherError = ''; publishHealth();
    watcher.on('error', error => {
      watcherError = error.message; console.error('OpenSpec watcher error:', error);
      watcher?.close();
      watcher = null; publishHealth();
      setTimeout(startWatcher, 2000).unref();
    });
  } catch (error) {
    watcherError = error.message; publishHealth(); console.error('Could not start OpenSpec watcher:', error);
    setTimeout(startWatcher, 2000).unref();
  }
}

function posix(p) { return p.split(path.sep).join('/'); }
function localDate(value = new Date()) { const date = new Date(value); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; }
function humanize(s) { return s.replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase()); }
function titleOf(source, fallback) { return source.match(/^#\s+(.+)$/m)?.[1].trim() || humanize(fallback); }
function excerpt(source) {
  return source.replace(/^#{1,6}\s+/gm, '').replace(/\*\*|`|\[(.*?)\]\([^)]*\)/g, '$1').replace(/\s+/g, ' ').trim().slice(0, 220);
}
function proposalSummary(source) {
  const why = source.match(/^##\s+Why\s*\n+([\s\S]*?)(?=^##\s+|$)/m)?.[1] || source;
  return excerpt(why);
}
function requirements(source) { return headings(source, 3, 'Requirement:'); }
function scenarios(source) { return headings(source, 4, 'Scenario:'); }
function metaValue(source, field) { return source.match(new RegExp(`^${field}:\\s*(.+)$`, 'm'))?.[1]?.replace(/^['"]|['"]$/g, '').trim() || ''; }
function dateFromName(name) { return /^\d{4}-\d{2}-\d{2}/.test(name) ? name.slice(0, 10) : ''; }
function milestoneOf(source) { return source.match(/\*\*Milestone:\*\*\s*(M\d+\+?)/i)?.[1]?.toUpperCase() || null; }
function roadmapMilestones(source) {
  const block = source.match(/^\s*-\s+\*\*Milestones:\*\*\s*\n((?:\s+-\s+M\d+\+?[^\n]*\n?)+)/m)?.[1] || '';
  return [...block.matchAll(/^\s+-\s+(M\d+\+?)\s+([^\n]+)/gm)].map(match => ({ id: match[1], label: match[2].trim() }));
}

async function gitTimeline(taskDocs, warnings) {
  const head=await execFileAsync('git',['rev-parse','HEAD'],{cwd:repo,timeout:5000}).then(r=>r.stdout.trim()).catch(()=> '');
  const key=head+'|'+taskDocs.map(d=>d.path).join('|');
  if(head && historyCache?.key===key){warnings.push(...historyCache.warnings);return historyCache.history;}
  const before=warnings.length;
  const history=await buildGitTimeline(taskDocs,warnings);
  if(head)historyCache={key,history,warnings:warnings.slice(before)};
  return history;
}
async function buildGitTimeline(taskDocs, warnings) {
  const history = new Map();
  let log = '';
  try {
    ({ stdout: log } = await execFileAsync('git', ['log', '--format=__COMMIT__%H\t%aI', '--name-only', '--', 'openspec/changes'], { cwd: repo, timeout: 10000, maxBuffer: 8 * 1024 * 1024 }));
  } catch { warnings.push('Git history is unavailable. File modification dates are not task start or completion dates.'); return history; }
  let commit = null;
  for (const line of log.split(/\r?\n/)) {
    if (line.startsWith('__COMMIT__')) {
      const [hash, timestamp] = line.slice(10).split('\t');
      commit = { hash, date: timestamp?.slice(0, 10) || '' };
    } else if (commit && line.startsWith('openspec/changes/') && line.endsWith('/tasks.md')) {
      const key = line.slice('openspec/'.length);
      if (!history.has(key)) history.set(key, []);
      history.get(key).push(commit);
    }
  }
  const jobs = [];
  for (const taskDoc of taskDocs) {
    // Follow renames individually so archive moves retain their earlier snapshots.
    if (taskDoc.path.startsWith('changes/archive/') || !taskDoc.path.endsWith('/tasks.md')) {
      try {
        const result = await execFileAsync('git', ['log', '--follow', '-31', '--format=__COMMIT__%H\t%aI', '--name-only', '--', `openspec/${taskDoc.path}`], { cwd: repo, timeout: 10000, maxBuffer: 2 * 1024 * 1024 });
        const followed = []; let revision;
        for (const line of result.stdout.split(/\r?\n/)) {
          if (line.startsWith('__COMMIT__')) { const [hash, date] = line.slice(10).split('\t'); revision = { hash, date: date.slice(0, 10) }; }
          else if (revision && line.startsWith('openspec/')) { followed.push({ ...revision, sourcePath: line.slice(9) }); revision = null; }
        }
        history.set(taskDoc.path, followed);
      } catch { warnings.push(`Rename history unavailable for ${taskDoc.path}.`); }
    }
    if ((history.get(taskDoc.path) || []).length > 30) warnings.push('Partial Git history: latest 30 revisions only for ' + taskDoc.path);
    history.set(taskDoc.path, history.get(taskDoc.path) || []);
    for (const [order, revision] of (history.get(taskDoc.path) || []).slice(0, 30).entries()) jobs.push({ path: taskDoc.path, order, ...revision });
  }
  if (jobs.length > 600) { warnings.push('Git task history was limited to 600 file revisions.'); jobs.length = 600; }
  const snapshots = new Map(taskDocs.map(d => [d.path, []]));
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(6, jobs.length) }, async () => {
    while (next < jobs.length) {
      const job = jobs[next++];
      try {
        const { stdout } = await execFileAsync('git', ['show', `${job.hash}:openspec/${job.sourcePath || job.path}`], { cwd: repo, timeout: 10000, maxBuffer: 2 * 1024 * 1024 });
        if (!snapshots.has(job.path)) snapshots.set(job.path, []);
        snapshots.get(job.path).push({ date: job.date, hash: job.hash.slice(0, 8), order: job.order, tasks: taskSummary(stdout).items });
      } catch { warnings.push(`Git snapshot unavailable: ${job.path} at ${job.hash.slice(0,8)}. History is partial.`); }
    }
  }));
  for (const [file, revisions] of snapshots) history.set(file, revisions.sort((a, b) => b.order - a.order));
  return history;
}

async function saveEffort(req) {
  const origin = req.headers.origin;
  if (origin !== `http://127.0.0.1:${port}` && origin !== `http://localhost:${port}`) return { status: 403, body: { error: 'This request must come from the local portal.' } };
  if (!req.headers['content-type']?.startsWith('application/json')) return { status: 415, body: { error: 'JSON is required.' } };
  let source = '';
  for await (const chunk of req) {
    source += chunk;
    if (source.length > 8192) return { status: 413, body: { error: 'Entry is too large.' } };
  }
  let entry;
  try { entry = JSON.parse(source); } catch { return { status: 400, body: { error: 'Invalid JSON.' } }; }
  if (!entry || typeof entry !== 'object') return { status: 400, body: { error: 'Invalid entry.' } };
  if (!validEntry(entry) || entry.date > localDate() || (entry.requestId && !/^[a-zA-Z0-9-]{8,80}$/.test(entry.requestId))) return { status: 400, body: { error: 'Choose a valid task, past or current date, 1–1440 minutes, and a short note.' } };
  // Queue the complete read/validate/write transaction, not only the rename.
  const transaction = writeQueue.then(async () => {
    const current = await scan();
    const change = [...current.changes, ...current.archive].find(c => c.id === entry.change);
    const source = change?.tasksPath ? await fs.readFile(path.join(specRoot, change.tasksPath), 'utf8').catch(() => '') : '';
    const tasks = taskSummary(source).items.filter(t => t.id === entry.task && !t.ambiguous);
    if (tasks.length !== 1) return { status: 400, body: { error: 'That task is missing or has a duplicate identity.' } };
    const legacy = path.join(specRoot, 'effort.json');
    const file = await fs.lstat(legacy).then(() => legacy).catch(e => { if (e.code !== 'ENOENT') throw e; return path.join(sidecar, 'effort.json'); });
    if (file.startsWith(sidecar)) {
      await fs.mkdir(sidecar, { recursive: true });
      const stat = await fs.lstat(sidecar);
      if (stat.isSymbolicLink() || !stat.isDirectory()) return { status: 409, body: { error: 'Portal metadata directory must be a real directory.' } };
    }
    const stat = await fs.lstat(file).catch(e => { if (e.code !== 'ENOENT') throw e; return null; });
    if (stat && (!stat.isFile() || stat.isSymbolicLink())) return { status: 409, body: { error: 'Effort ledger must be a regular file.' } };
    const lockPath = file + '.lock';
    let lock; try { lock = await fs.open(lockPath, 'wx'); } catch(e) { if(e.code==='EEXIST') return {status:409,body:{error:'Another portal is saving effort. Retry; if no portal is running, remove the stale ledger .lock file.'}}; throw e; }
    try {
    const existing = await fs.readFile(file, 'utf8').catch(e => { if (e.code !== 'ENOENT') throw e; return ''; });
    const diagnostics = [], entries = readLedger(existing, diagnostics);
    if (diagnostics.length) return { status: 409, body: { error: diagnostics.join(' ') } };
    if (entry.requestId && entries.some(e => e.requestId === entry.requestId)) return { status: 200, body: { saved: true, duplicate: true } };
    entries.push({ change: change.id, task: entry.task, taskKey: tasks[0].key, date: entry.date, minutes: entry.minutes, note: entry.note.trim(), requestId: entry.requestId || randomUUID() });
    const temp = path.join(path.dirname(file), '.effort-' + randomUUID() + '.tmp');
    try {
      await fs.writeFile(temp, JSON.stringify({ entries }, null, 2) + '\n', { flag: 'wx' });
      const latest = await fs.readFile(file, 'utf8').catch(e => { if (e.code !== 'ENOENT') throw e; return ''; });
      if (latest !== existing) return { status: 409, body: { error: 'Ledger changed externally during save. Retry your entry.' } };
      const latestStat = await fs.lstat(file).catch(e => { if (e.code !== 'ENOENT') throw e; return null; });
      if (latestStat?.isSymbolicLink()) return { status: 409, body: { error: 'Ledger was replaced by a symbolic link.' } };
      await fs.rename(temp, file); publishChange();
    } finally { await fs.unlink(temp).catch(() => {}); }
    return { status: 201, body: { saved: true, file: path.relative(repo, file) } };
    } finally { await lock.close(); await fs.unlink(lockPath).catch(()=>{}); }
  });
  writeQueue = transaction.catch(() => {});
  return transaction;
}

async function scan(force = false) {
  if (!force && scanCache && Date.now() - scanCache.time < 5000 && scanCache.revision === watchRevision()) return { ...scanCache.data, watcher: watcherHealth() };
  if (scanPromise) return scanPromise;
  scanPromise = buildScan().then(data => { scannedAt = data.generatedAt; scanCache = { time: Date.now(), revision: data.watchRevision, data }; return { ...data, watcher: watcherHealth() }; }).finally(() => { scanPromise = null; });
  return scanPromise;
}
async function buildScan() {
  const revision = watchRevision();
  const docs = [];
  const warnings = [];
  let totalBytes = 0;
  async function visit(dir, depth = 0) {
    if (depth > 16) { warnings.push(`Skipped a directory deeper than 16 levels: ${posix(path.relative(specRoot, dir))}`); return; }
    if (docs.length >= maxFiles || totalBytes >= maxTotalBytes) return;
    let entries;
    try { entries = await fs.readdir(dir, { withFileTypes: true }); }
    catch (error) { if (error.code === 'ENOENT') return; throw error; }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (docs.length >= maxFiles || totalBytes >= maxTotalBytes) return;
      if (entry.isSymbolicLink()) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { await visit(full, depth + 1); continue; }
      if (!entry.isFile() || !allowed.has(path.extname(entry.name).toLowerCase())) continue;
      let stat;
      try { stat = await fs.stat(full); }
      catch (error) { if (error.code === 'ENOENT') continue; throw error; }
      if (stat.size > maxFileBytes) { warnings.push(`Skipped file over 1 MB: ${posix(path.relative(specRoot, full))}`); continue; }
      if (totalBytes + stat.size > maxTotalBytes) { warnings.push('Stopped scanning after 50 MB of source files.'); return; }
      let source;
      try { source = await fs.readFile(full, 'utf8'); }
      catch (error) { if (error.code === 'ENOENT') continue; throw error; }
      totalBytes += stat.size;
      const relative = posix(path.relative(specRoot, full));
      const digest = fingerprint(source);
      const previous = rendered.get(relative);
      const html = previous?.digest === digest ? previous.html : ['.md', '.markdown'].includes(path.extname(entry.name).toLowerCase()) ? md.render(source) : '';
      rendered.set(relative,{digest,html});
      docs.push({ digest,
        path: relative, name: entry.name, title: titleOf(source, path.basename(entry.name, path.extname(entry.name))),
        text: source, html,
        excerpt: excerpt(source), modified: stat.mtime.toISOString(),
        requirements: requirements(source), scenarios: scenarios(source), tasks: taskSummary(source)
      });
    }
  }
  await visit(specRoot);
  const currentPaths=new Set(docs.map(d=>d.path));
  for(const key of rendered.keys()) if(!currentPaths.has(key)) rendered.delete(key);
  const planning = await planningStatus(repo, warnings);
  const schemaTracks = await schemaChecklists(repo,warnings);
  const project = await projectMetadata(repo, warnings);
  const byPath = new Map(docs.map(d => [d.path, d]));
  const specs = docs.filter(d => /^specs\/.+\/spec\.md$/.test(d.path)).map(d => ({
    id: d.path.slice(6, -8), title: humanize(d.path.slice(6, -8).split('/').pop()), path: d.path,
    purpose: d.text.match(/^##\s+Purpose\s*\n+([\s\S]*?)(?=\n##\s|$)/m)?.[1]?.trim() || '',
    requirements: d.requirements, scenarios: d.scenarios, modified: d.modified
  }));
  function changeGroups(prefix, archived) {
    const names = new Set(docs.filter(d => d.path.startsWith(prefix)).map(d => d.path.slice(prefix.length).split('/')[0]).filter(Boolean));
    return [...names].sort().map(name => {
      const base = prefix + name + '/';
      const files = docs.filter(d => d.path.startsWith(base));
      const proposal = byPath.get(base + 'proposal.md');
      const schemaStatus = !archived ? planning.get(name) : null;
      const metadata = byPath.get(base + '.openspec.yaml');
      let settings={},config={};
      try { settings=parseYaml(metadata?.text || '') || {}; config=parseYaml(byPath.get('config.yaml')?.text || '') || {}; } catch { warnings.push('Invalid YAML metadata for '+name+'; schema settings are unknown.'); }
      const schemaName=schemaStatus?.schema || settings.schema || config.schema || 'spec-driven';
      const tracked=schemaTracks.get(schemaName);
      const taskPaths = tracked && !tracked.includes('*') ? [base+tracked] : schemaStatus ? schemaStatus.artifacts.filter(a => a.id === 'tasks' || schemaStatus.applyRequires.includes(a.id)).flatMap(a => a.files).filter(p => byPath.get(p)?.tasks.total) : schemaName==='spec-driven' ? [base+'tasks.md'] : [];
      const tasksFile = taskPaths.map(p => byPath.get(p)).find(Boolean);
      if (taskPaths.length > 1) warnings.push(`${name} has multiple implementation checklists; timeline shows ${tasksFile?.path}. All artifacts are available in Contents.`);
      const task = tasksFile?.tasks || { done: 0, total: 0, sections: [], items: [] };
      const capabilities = files.filter(f => f.path.startsWith(base + 'specs/') && f.path.endsWith('/spec.md'))
        .map(f => f.path.slice((base + 'specs/').length, -8));
      const title = proposal?.title && proposal.title !== 'Proposal' ? proposal.title : humanize(name.replace(/^\d{4}-\d{2}-\d{2}-/, ''));
      return {
        id: name, stableId: name.replace(/^\d{4}-\d{2}-\d{2}-/, ''), fingerprint: fingerprint(files.map(f => f.path + '\n' + f.text).join('\n')), planning: schemaStatus || null, tasksPath: tasksFile?.path || null, title, archived, date: dateFromName(name), path: base, files: files.map(f => f.path),
        goal: typeof settings.goal==='string' ? settings.goal : '',
        schema: schemaName,
        summary: proposal ? proposalSummary(proposal.text) : '', tasks: task, capabilities,
        milestone: project.changes[name]?.milestone || milestoneOf(proposal?.text || ''),
        portal: project.changes[name] || { decisions:[], dependsOn:[], evidence:[] },
        artifacts: {
          proposal: Boolean(proposal),
          design: Boolean(byPath.get(base + 'design.md')),
          checklist: Boolean(tasksFile),
          deltaSpecs: files.filter(f => f.path.startsWith(base + 'specs/') && f.path.endsWith('/spec.md')).length
        },
        requirements: files.reduce((n, f) => n + f.requirements.length, 0),
        modified: files.map(f => f.modified).sort().at(-1) || ''
      };
    });
  }
  const changes = changeGroups('changes/', false).filter(c => c.id !== 'archive');
  const archive = changeGroups('changes/archive/', true).sort((a,b) => b.id.localeCompare(a.id));
  const taskDocs = [...changes, ...archive].map(c => byPath.get(c.tasksPath)).filter(Boolean);
  for (const change of [...changes, ...archive]) if (change.tasks.items.some(t => t.ambiguous)) warnings.push('Duplicate task ids in ' + change.id + '; effort attribution is disabled for those tasks.');
  const history = await gitTimeline(taskDocs, warnings);
  const sidecarText = await (async()=>{
    const directory=await fs.lstat(sidecar),file=path.join(sidecar,'effort.json'),stat=await fs.lstat(file);
    if(directory.isSymbolicLink() || stat.isSymbolicLink() || !stat.isFile() || stat.size>maxFileBytes)throw Error('ledger must be a regular file under a real metadata directory, at most 1 MB');
    return fs.readFile(file,'utf8');
  })().catch(e => { if (e.code !== 'ENOENT') warnings.push('Portal effort ledger could not be read: ' + e.message); return ''; });
  if(sidecarText && byPath.has('effort.json'))warnings.push('Both legacy and sidecar effort ledgers exist. The legacy openspec/effort.json ledger takes precedence; consolidate them manually to avoid hidden entries.');
  const effort = readLedger(byPath.get('effort.json')?.text || sidecarText, warnings);
  const attributed = resolveEffort(effort, [...changes, ...archive], warnings);
  for (const change of [...changes, ...archive]) {
    const taskFile = change.tasksPath;
    const revisions = history.get(taskFile) || [];
    const currentDate = byPath.get(taskFile)?.modified ? localDate(byPath.get(taskFile).modified) : '';
    for (const task of change.tasks.items) {
      let firstSeen = '';
      let completedAt = '';
      const activity = new Set();
      let previous = null;
      for (const revision of revisions) {
        const found = revision.tasks.find(t => !t.ambiguous && t.key === task.key);
        if (!found) continue;
        if (!firstSeen) firstSeen = revision.date;
        const signature = `${found.done}|${found.text}`;
        if (signature !== previous) activity.add(revision.date);
        if (!completedAt && found.done && (!previous || !previous.startsWith('true|'))) completedAt = revision.date;
        previous = signature;
      }
      const currentSignature = `${task.done}|${task.text}`;
      // Uncommitted state is shown separately; mtime is not historical activity.
      // No Git evidence means dates are unknown, not checkout timestamps.
      
      if (!task.done) completedAt = '';
      const entries = attributed.get(change.id + '/' + task.id) || [];
      task.timeline = {
        firstSeen, completedAt, provenance: firstSeen ? 'git-sampled' : 'no-git-evidence', uncommittedOrChanged: currentSignature !== previous, currentFileDate: currentDate, activityDays: [...activity].sort(),
        effortMinutes: entries.reduce((sum, e) => sum + e.minutes, 0),
        effortDays: entries.map(e => ({ date: e.date, minutes: e.minutes, note: e.note }))
      };
    }
  }
  const milestones = [...new Map([...docs.filter(d => d.name === 'proposal.md').flatMap(d => roadmapMilestones(d.text)), ...project.milestones].map(m => [m.id, m])).values()];
  for (const change of changes) for (const id of change.portal.dependsOn) if (![...changes,...archive].some(c=>c.id===id)) warnings.push(`${change.id} declares missing dependency ${id} in portal metadata.`);
  const unknownMilestones = [...new Set(changes.map(c => c.milestone).filter(id => id && !milestones.some(m => m.id === id)))];
  if (unknownMilestones.length) warnings.push('Milestone labels are not declared by a roadmap: ' + unknownMilestones.join(', ') + '. Milestones are a project convention, not an OpenSpec artifact.');
  const looseDocs = docs.filter(d => !d.path.startsWith('specs/') && !d.path.startsWith('changes/'));
  if (docs.length >= maxFiles) warnings.push('Stopped scanning after 5,000 files.');
  return { repo, name: path.basename(repo), generatedAt: new Date().toISOString(), gitRevision: historyCache?.key.split('|')[0] || '', watchRevision: revision, watcher: watcherHealth(), compatibility: { source: planning.available ? 'openspec-cli' : 'filesystem', schemaStatusAvailable: Boolean(planning.available), extensions: ['Project milestone text', 'Portal effort ledger'] }, warnings, specs, changes, archive, milestones, effortEntries: effort.length, looseDocs: looseDocs.map(d=>d.path), docs };
}

const assets = new Map([['/', 'index.html'], ['/app.js', 'app.js'], ['/explore.js', 'explore.js'], ['/graph-layout.js', 'graph-layout.js'], ['/theme.js', 'theme.js'], ['/style.css', 'style.css'], ['/light-theme.css', 'light-theme.css']]);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const server = http.createServer(async (req, res) => {
  try {
    if (![`localhost:${port}`, `127.0.0.1:${port}`].includes(req.headers.host)) { res.writeHead(403).end('Local Host header required'); return; }
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'POST' && url.pathname === '/api/effort') {
      const result = await saveEffort(req);
      res.writeHead(result.status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }).end(JSON.stringify(result.body));
      return;
    }
    if (req.method !== 'GET') { res.writeHead(405).end('Method not allowed'); return; }
    if (url.pathname === '/api/validate') {
      try { const result=await validateRepository(repo); res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'}).end(JSON.stringify(result)); }
      catch(error) { res.writeHead(503,{'Content-Type':'application/json','Cache-Control':'no-store'}).end(JSON.stringify({error:'OpenSpec validation unavailable: '+error.message})); }
      return;
    }
    if (url.pathname === '/api/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Content-Type-Options': 'nosniff' });
      res.write(`retry: 2000\nevent: ready\ndata: ${watchRevision()}\n\n`);
      liveClients.add(res); res.write(`event: health\ndata: ${JSON.stringify(watcherHealth())}\n\n`);
      const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 25000);
      res.on('close', () => { clearInterval(heartbeat); liveClients.delete(res); });
      return;
    }
    if (url.pathname === '/api/data') {
      const data = await scan(url.searchParams.get('fresh') === '1');
      data.revision = fingerprint(JSON.stringify({docs:data.docs.map(d=>[d.path,d.digest,d.modified]),changes:data.changes,archive:data.archive,milestones:data.milestones})).slice(0,24);
      const previous = snapshots.get(url.searchParams.get('since'));
      const summary = previous ? { ...data, documentsDelta:true, docs:data.docs.filter(d=>previous.get(d.path)!==d.digest+'|'+d.modified), removedDocs:[...previous.keys()].filter(p=>!data.docs.some(d=>d.path===p)) } : data;
      snapshots.set(data.revision,new Map(data.docs.map(d=>[d.path,d.digest+'|'+d.modified])));
      while(snapshots.size>4)snapshots.delete(snapshots.keys().next().value);
      let body = JSON.stringify(summary);
      const headers = /\bgzip\b/.test(req.headers['accept-encoding'] || '') ? {'Content-Encoding':'gzip', Vary:'Accept-Encoding'} : {};
      if(headers['Content-Encoding']) body=await gzipAsync(body);
      res.writeHead(200, { ...headers, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }).end(body);
      return;
    }
    const asset = assets.get(url.pathname);
    if (!asset) { res.writeHead(404).end('Not found'); return; }
    const bytes = await fs.readFile(path.join(publicDir, asset));
    res.writeHead(200, { 'Content-Type': types[path.extname(asset)], 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'" }).end(bytes);
  } catch (error) {
    console.error(error);
    res.writeHead(500, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'Unable to read OpenSpec repository.' }));
  }
});
server.listen(port, '127.0.0.1', () => console.log(`OpenSpec Portal: http://127.0.0.1:${port}\nRepository: ${repo}\nPress Ctrl+C to stop.`));
startWatcher();
// Portal sidecars and Git ref changes are outside openspec/. Observe them without
// recursively watching the implementation tree (which can contain node_modules).
let externalSignature;
const externalPoll = setInterval(async () => {
  try {
    const headFile=path.join(repo,'.git','HEAD');
    const head=await fs.readFile(headFile,'utf8').catch(()=> '');
    const ref=head.trim().startsWith('ref: refs/') ? head.trim().slice(5) : '';
    const files=[path.join(sidecar,'project.json'),path.join(sidecar,'effort.json'),headFile,path.join(repo,'.git','packed-refs'),...(ref?[path.join(repo,'.git',ref)]:[])];
    const signature=(await Promise.all(files.map(file=>fs.stat(file).then(s=>s.mtimeMs+':'+s.size).catch(()=>'-')))).join('|');
    if(externalSignature!==undefined && externalSignature!==signature) publishChange();
    externalSignature=signature;
  } catch(error) { console.error('Portal sidecar observation failed:',error.message); }
},2000); externalPoll.unref();
