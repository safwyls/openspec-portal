# OpenSpec Portal

A local viewer for a repository's `openspec/` directory. Overview, milestone drilldown, a 2D node graph, task history/effort, document outlines, search, and diagnostics run without an account. The server listens on `127.0.0.1` only.

## Run

Requires Node.js 20+:

```powershell
npm install
npm start -- --repo "C:\path\to\repository"
```

Open http://127.0.0.1:4177. Use `--port 4180` for another port. You can run `node C:\path\to\openspec-portal\server.mjs` from a repository root and omit `--repo`. The repository must contain `openspec/`.

Install the official OpenSpec CLI to enable schema-aware planning status and validation. Tested with OpenSpec **1.13.2**. The adapter invokes only read-only commands: `status --all --json`, `schema which --all --json`, and, on request in Repository health, `validate --all --json --no-interactive`. Local npm installations and normal global installations are detected. If the CLI/JSON contract is unavailable, browsing continues with diagnostics and unknown artifact readiness.

## OpenSpec remains authoritative

- Active schemas, artifact names, readiness, dependencies, and skipped artifacts come from the CLI. Custom schemas and `skip_specs: true` are supported.
- Implementation checklists come from the resolved schema's `apply.tracks` path. For multiple/glob checklists, the portal shows the first discovered checklist and reports that limitation; all documents remain browsable.
- Planning completion, checked tasks, human review, and verified implementation are distinct. None implies the others.
- Current capability specs and proposed deltas stay separate. A capability without a current spec opens its delta document.
- Browsing/validation never modify OpenSpec configuration, schemas, proposals, designs, specs, tasks, or archive state. The portal never performs apply/archive operations.
- Milestones, evidence, decision logs, declared prerequisites, and effort are optional project/portal extensions, not OpenSpec workflow states or requirements.

Baseline references: [official agent contract](https://github.com/Fission-AI/OpenSpec/blob/main/docs/agent-contract.md) and [schema definition](https://github.com/Fission-AI/OpenSpec/blob/main/schemas/spec-driven/schema.yaml).

## Views and live updates

- Overview shows checklist counts, changes without checklists, and unreviewed/changed source snapshots.
- Map has internally scrolling milestone/change/detail columns, status filters, and an archive toggle.
- Graph has adaptive spacing, bounded obstacle-aware edge routing, label controls, search, zoom/pan, neighborhood focus, and a keyboard-accessible node list. Assignments, delta links, and declared prerequisites use different styles.
- Timeline separates sampled Git observations from logged minutes. Select a section, date range, and History/Effort/Both mode. Legend/logging form collapse to leave chart space.
- Document outlines use stable heading slugs. Markdown links become portal routes; external links remain external. Unsupported assets/outside documents are labeled explicitly.
- All files searches contents with snippets and scope filters. Change/spec searches include source documents.
- Repository health exposes diagnostics and invokes OpenSpec's validator. Document validation is not implementation testing.
- Themes and human review checkpoints persist in this browser. Checkpoints review source snapshots, not implementation correctness. Changed lines are a line-membership comparison, not a complete Git diff.

The server watches `openspec/` recursively and distinguishes watcher health from stream connectivity. Sidecars/Git refs are checked every two seconds. Two-minute browser polling recovers missed events; Refresh performs a fresh scan. Background failures retain the last successful view and label it stale. Scans are deduplicated; Markdown/Git history are cached; refresh requests receive changed documents only and gzip when supported.

## Optional portable metadata

Copy `project.example.json` to **your repository's** `.openspec-portal/project.json` and replace the example with real information. Do not add portal fields to OpenSpec schemas/artifacts.

Supports milestone `id`, `label`, `outcome`, `exitCriteria`, and a `changes` object keyed by directory name. Changes may declare `milestone`, `dependsOn`, `decisions`, and `evidence`. Evidence kinds: `agent-reported`, `automatically-checked`, `human-reviewed`, with explicit URL, revision, timestamp, capability, exact requirement title, and task. Provenance is author-declared; the portal does not certify it. Exact capability/requirement links appear in spec traceability panels.

Proposal `**Milestone:** M2` lines and roadmap `**Milestones:**` lists remain supported across proposals. Sidecar labels/assignments override that convention. No hierarchy, dependency, future date, or verification result is inferred from task completion.

## Log effort

Expand **Log actual work** in Timeline. Choose a task/date and 1–1440 whole minutes. New ledgers use `.openspec-portal/effort.json`. Existing `openspec/effort.json` remains the authoritative legacy ledger. Both existing produce a diagnostic; neither is silently merged or migrated.

```json
{"entries":[{"change":"example-change","task":"1.1","date":"2026-09-26","minutes":45,"note":"What was done"}]}
```

Numbered tasks retain their IDs. Unnumbered tasks use normalized-text hashes, so inserting tasks does not renumber them. Saves include a text fingerprint and retry ID. Old positional `item-N` entries cannot safely be reconciled after edits and are diagnosed for manual repair.

Saves serialize the full transaction, use a unique temporary file, cooperating-process exclusive lock, atomic replacement, and external-edit check. Same-request retries never duplicate time. Malformed ledgers block saves. After a crash, a stale `effort.json.lock` may remain: remove it only when no portal is writing. External editors do not honor the lock; avoid editing the ledger during saves.

Archive name aliases retain effort when unambiguous. Reused names, duplicate identities, edited task fingerprints, and missing tasks produce orphan diagnostics instead of guessed attribution. Entries remain in the ledger for repair.

## Limits

Git observations use the latest 30 revisions per checklist, up to 600 snapshots overall. Truncation/failures are diagnosed; archive renames are followed. Dates are first observed within the sample, not guaranteed creation/completion dates. Wording changes start a new series. Missing evidence stays unknown; filesystem timestamps never become work dates. Git activity cannot measure effort.

Documents: Markdown/YAML/JSON/text, at most 1 MB each, 5,000 files/50 MB per scan, depth 16. Symlinks are skipped; raw Markdown HTML is disabled. Scan limits are explicit. Graph circle overlaps are prevented in the tested 100-change case; dense crossings/labels may still need zoom/neighborhood focus. No delivery prediction or automated implementation verification is provided.

## Tests

```powershell
npm test
```

Coverage: fenced examples and real lists, stable identities, invalid dates, archive ambiguity, 12 concurrent saves, retry deduplication, custom schemas/archived checklists, skipped specs, official validation, missing titles, incremental payloads, watcher events, Host rejection, file cap, and dense/neighborhood geometry. Tests use isolated temporary repositories; SaberBench is used only for read-only compatibility and browser checks.
