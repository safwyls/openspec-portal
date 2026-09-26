import MarkdownIt from 'markdown-it';
import { createHash } from 'node:crypto';

const parser = new MarkdownIt();
export const fingerprint = text => createHash('sha256').update(text).digest('hex');
export const taskKey = text => fingerprint(text.replace(/^\d+(?:\.\d+)*\.?\s*/, '').replace(/\s+/g, ' ').trim()).slice(0, 16);
export function taskSummary(source) {
  const tokens = parser.parse(source, {}), sections = [], items = [];
  let section = null;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.type === 'heading_open' && ['h2', 'h3'].includes(token.tag)) {
      section = { title: tokens[i + 1].content, done: 0, total: 0 }; sections.push(section);
    }
    if (token.type !== 'inline' || tokens[i - 1]?.type !== 'paragraph_open' || tokens[i - 2]?.type !== 'list_item_open') continue;
    const match = token.content.match(/^\[([ xX])\]\s+([\s\S]*)/);
    if (!match) continue;
    if (!section) { section = { title: 'Other tasks', done: 0, total: 0 }; sections.push(section); }
    const text = match[2].trim(), done = match[1].toLowerCase() === 'x';
    const number = text.match(/^(\d+(?:\.\d+)*\.?)(?:\s+|$)/)?.[1]?.replace(/\.$/, '');
    const key = taskKey(text);
    items.push({ id: number || `text-${key}`, key, text, section: section.title, done });
    section.total++; if (done) section.done++;
  }
  const ids = new Map();
  for (const item of items) ids.set(item.id, (ids.get(item.id) || 0) + 1);
  for (const item of items) item.ambiguous = ids.get(item.id) > 1;
  return { done: items.filter(t => t.done).length, total: items.length, sections: sections.filter(s => s.total), items };
}
export function headings(source, level, prefix) {
  const tokens = parser.parse(source, {}), result = [];
  for (let i = 0; i < tokens.length; i++) if (tokens[i].type === 'heading_open' && tokens[i].tag === `h${level}`) {
    const value = tokens[i + 1].content;
    if (value.startsWith(prefix)) result.push(value.slice(prefix.length).trim());
  }
  return result;
}
export function validDate(date) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const value = new Date(`${date}T12:00:00Z`);
  return Number.isFinite(value.getTime()) && value.toISOString().slice(0, 10) === date;
}
export function validEntry(e) {
  return e && typeof e.change === 'string' && /^[a-z0-9][a-z0-9-]{0,150}$/.test(e.change) && typeof e.task === 'string' && /^(?:\d+(?:\.\d+)*|item-\d+|text-[a-f0-9]{16})$/.test(e.task) && validDate(e.date) && Number.isInteger(e.minutes) && e.minutes >= 1 && e.minutes <= 1440 && typeof e.note === 'string' && e.note.length <= 300;
}
export function readLedger(source, warnings = []) {
  if (!source) return [];
  try {
    const parsed = JSON.parse(source), entries = Array.isArray(parsed) ? parsed : parsed.entries;
    if (!Array.isArray(entries)) throw Error('Expected an entries array');
    const valid = entries.filter(validEntry);
    if (valid.length !== entries.length) warnings.push(`${entries.length - valid.length} invalid effort entries were excluded; repair the ledger before saving.`);
    return valid;
  } catch { warnings.push('Effort ledger is malformed; no effort can be displayed or saved.'); return []; }
}
export function resolveEffort(entries, changes, warnings) {
  const assigned = new Map(); let orphaned = 0;
  for (const entry of entries) {
    const candidates = changes.filter(c => c.id === entry.change || c.stableId === entry.change);
    // An exact archived directory is unambiguous. A reused active name isn't.
    const exactArchive = candidates.find(c => c.archived && c.id === entry.change);
    const change = exactArchive || (candidates.length === 1 ? candidates[0] : null);
    const tasks = change?.tasks.items.filter(t => !t.ambiguous && (entry.taskKey ? t.key === entry.taskKey : t.id === entry.task || (entry.task.startsWith('item-') && t.id === entry.task))) || [];
    if (tasks.length !== 1) { orphaned++; continue; }
    const key = `${change.id}/${tasks[0].id}`;
    if (!assigned.has(key)) assigned.set(key, []);
    assigned.get(key).push(entry);
  }
  if (orphaned) warnings.push(`${orphaned} effort entries have missing or ambiguous change/task identities and are not attributed. Review the ledger.`);
  return assigned;
}
