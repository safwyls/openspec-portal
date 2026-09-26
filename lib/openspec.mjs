import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parse as parseYaml } from 'yaml';
const run = promisify(execFile);
let executable;
async function command(repo) {
  if (executable) return executable;
  // Execute the JS entry directly on Windows; never interpolate change names into a shell.
  const roots = [path.join(repo, 'node_modules'), ...String(process.env.PATH || '').split(path.delimiter).map(p => path.join(p, 'node_modules'))];
  if (process.env.APPDATA) roots.push(path.join(process.env.APPDATA, 'npm', 'node_modules'));
  for (const root of roots) {
    const file = path.join(root, '@fission-ai', 'openspec', 'bin', 'openspec.js');
    if (await fs.stat(file).then(s => s.isFile()).catch(() => false)) return executable = [process.execPath, [file]];
  }
  if (process.platform !== 'win32') return executable = ['openspec', []];
  throw Error('OpenSpec CLI not found. Install it to enable authoritative schema status.');
}
export async function planningStatus(repo, warnings) {
  try {
    const [exe, prefix] = await command(repo);
    const { stdout } = await run(exe, [...prefix, 'status', '--all', '--json'], { cwd: repo, timeout: 15000, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, OPENSPEC_TELEMETRY: '0' } });
    const data = JSON.parse(stdout);
    if (path.resolve(data.root?.path || '') !== path.resolve(repo) || !Array.isArray(data.changes)) throw Error('CLI returned a different OpenSpec root or an unsupported status format.');
    const statuses = new Map(data.changes.filter(c => typeof c.changeName === 'string' && Array.isArray(c.artifacts)).map(c => [c.changeName, {
      schema: c.schemaName, complete: c.isPlanningComplete ?? c.isComplete, applyRequires: c.applyRequires || [],
      artifacts: c.artifacts.map(a => ({ id: a.id, status: a.status, outputPath: a.outputPath, requires: a.requires || [], missingDeps: a.missingDeps || [], files: (c.artifactPaths?.[a.id]?.existingOutputPaths || []).map(p => path.relative(path.join(repo, 'openspec'), p).split(path.sep).join('/')).filter(p => !p.startsWith('../') && !path.isAbsolute(p)) }))
    }]));
    statuses.available=true;
    return statuses;
  } catch (error) { warnings.push(`OpenSpec schema status unavailable: ${error.message}. Files remain browsable; artifact readiness is unknown.`); return new Map(); }
}
export async function schemaChecklists(repo, warnings) {
  const schemas=new Map();
  try {
    const [exe,prefix]=await command(repo);
    const {stdout}=await run(exe,[...prefix,'schema','which','--all','--json'],{cwd:repo,timeout:15000,maxBuffer:2*1024*1024,env:{...process.env,OPENSPEC_TELEMETRY:'0'}});
    const resolved=JSON.parse(stdout);
    if(!Array.isArray(resolved))throw Error('Unsupported schema resolution format');
    for(const entry of resolved) {
      const file=path.join(entry.path,'schema.yaml'),stat=await fs.stat(file);
      if(stat.size>1024*1024)continue;
      const definition=parseYaml(await fs.readFile(file,'utf8'));
      if(typeof definition.apply?.tracks==='string')schemas.set(entry.name,definition.apply.tracks);
    }
  } catch(error) { warnings.push('Archived checklist schema resolution unavailable: '+error.message); }
  return schemas;
}
export async function validateRepository(repo) {
  const [exe,prefix]=await command(repo);
  let stdout;
  try { ({stdout}=await run(exe,[...prefix,'validate','--all','--json','--no-interactive'],{cwd:repo,timeout:30000,maxBuffer:8*1024*1024,env:{...process.env,OPENSPEC_TELEMETRY:'0'}})); }
  catch(error) { if(!error.stdout || error.killed)throw error; stdout=error.stdout; }
  return {source:'openspec-cli',checkedAt:new Date().toISOString(),result:JSON.parse(stdout)};
}
