import fs from 'node:fs/promises';
import path from 'node:path';
const short = (v, max=500) => typeof v === 'string' ? v.slice(0,max) : '';
export async function projectMetadata(repo,warnings) {
  const file=path.join(repo,'.openspec-portal','project.json');
  try {
    const directory=await fs.lstat(path.dirname(file));
    if(directory.isSymbolicLink() || !directory.isDirectory())throw Error('metadata directory must be a real directory');
    const stat=await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size>1024*1024) throw Error('must be a regular file smaller than 1 MB');
    const data=JSON.parse(await fs.readFile(file,'utf8'));
    if (!Array.isArray(data.milestones || []) || typeof (data.changes || {}) !== 'object') throw Error('expected milestones array and changes object');
    return {
      milestones:(data.milestones || []).filter(m=>m && /^[a-zA-Z0-9+_-]{1,80}$/.test(m.id)).map(m=>({id:m.id,label:short(m.label),outcome:short(m.outcome),exitCriteria:Array.isArray(m.exitCriteria) ? m.exitCriteria.map(v=>short(v)).filter(Boolean) : [],source:'portal-metadata'})),
      changes:Object.fromEntries(Object.entries(data.changes || {}).filter(([id])=>/^[a-z0-9][a-z0-9-]{0,150}$/.test(id)).map(([id,c])=>[id,{
        milestone:short(c?.milestone,80), decisions:Array.isArray(c?.decisions) ? c.decisions.map(v=>short(v)).filter(Boolean) : [],
        dependsOn:Array.isArray(c?.dependsOn) ? c.dependsOn.filter(v=>typeof v==='string' && /^[a-z0-9][a-z0-9-]{0,150}$/.test(v)) : [],
        evidence:Array.isArray(c?.evidence) ? c.evidence.filter(e=>e && ['agent-reported','automatically-checked','human-reviewed'].includes(e.kind) && typeof e.url==='string' && /^(?:https?:\/\/|openspec:)/.test(e.url)).map(e=>({label:short(e.label),url:short(e.url,2000),kind:e.kind,revision:short(e.revision,100),recordedAt:short(e.recordedAt,40),requirement:short(e.requirement),capability:short(e.capability,150),task:short(e.task,100)})) : []
      }]))
    };
  } catch(error) { if(error.code!=='ENOENT')warnings.push('Optional portal project metadata could not be read: '+error.message); return {milestones:[],changes:{}}; }
}
