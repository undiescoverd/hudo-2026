#!/usr/bin/env node
// orchestrate.js — Hudo agent build orchestrator
// Runs with Node.js 20+, zero npm dependencies.
// Usage: node orchestrate.js <command> [args]

'use strict';

const fs   = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

// ─── Colour helpers ───────────────────────────────────────────────────────────
// No colour in CI (--ci), when NO_COLOR is set, or when stdout is not a terminal
const plain = !process.env.FORCE_COLOR &&
  (process.env.NO_COLOR || process.argv.includes('--ci') || !process.stdout.isTTY);
const c = plain ? new Proxy({}, { get: () => '' }) : {
  reset:  '\x1b[0m',
  bold:   '\x1b[1m',
  red:    '\x1b[31m',
  green:  '\x1b[32m',
  yellow: '\x1b[33m',
  blue:   '\x1b[34m',
  white:  '\x1b[37m',
  grey:   '\x1b[90m',
};
const col  = (colour, str) => `${colour}${str}${c.reset}`;
const bold = (str) => col(c.bold, str);

// Colour for task status
function statusColour(status) {
  switch (status) {
    case 'done':        return c.green;
    case 'in_progress':
    case 'in_review':   return c.yellow;
    case 'blocked':     return c.red;
    default:            return c.white;
  }
}

// Colour for model
function modelColour(model) {
  if (!model) return c.white;
  if (model.includes('haiku'))  return c.blue;
  if (model.includes('sonnet')) return c.yellow;
  if (model.includes('opus'))   return c.red;
  return c.white;
}

// ─── Paths ────────────────────────────────────────────────────────────────────
const TASKS_DIR  = path.join(__dirname, 'tasks');
const AUDIT_LOG  = path.join(__dirname, 'orchestrate-audit.log');
const DEFAULT_MODEL = 'sonnet-4.6';

// ─── File helpers ─────────────────────────────────────────────────────────────

/** List all sprint task files, e.g. tasks/sprint-0.md */
function sprintFiles() {
  if (!fs.existsSync(TASKS_DIR)) return [];
  return fs.readdirSync(TASKS_DIR)
    .filter(f => f.endsWith('.md'))
    .map(f => path.join(TASKS_DIR, f));
}

/** Atomic write: write to temp file then rename, so a crash never corrupts the target. */
function atomicWrite(filePath, content) {
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, content, 'utf8');
  fs.renameSync(tmp, filePath);
}

/** Append a line to the audit log. */
function auditLog(message) {
  const ts = new Date().toISOString();
  fs.appendFileSync(AUDIT_LOG, `[${ts}] ${message}\n`, 'utf8');
}

/** Sync task status to Linear via update-linear-task.sh script. Never throws.
 *  Returns true on success, false if the sync was skipped or all retries failed. */
function syncLinear(taskId, orchestratorStatus) {
  const statusMap = {
    'in_progress': 'In Progress',
    'in_review':   'In Review',
    'done':        'Done',
    'blocked':     'Blocked',
  };
  const linearStatus = statusMap[orchestratorStatus];
  if (!linearStatus) return false;

  const script = path.join(__dirname, 'scripts', 'update-linear-task.sh');
  if (!fs.existsSync(script)) {
    console.warn(col(c.grey, `  ⚠  Linear sync skipped — script not found`));
    return false;
  }

  const maxAttempts = 2;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      execFileSync('bash', [script, taskId, linearStatus], {
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 15000,
      });
      console.log(col(c.grey, `  ↗  Linear: ${taskId} → ${linearStatus}`));
      return true;
    } catch (err) {
      const stderr = err.stderr ? err.stderr.toString().trim() : '';
      if (attempt < maxAttempts) {
        // Wait 2s before retry
        execFileSync('sleep', ['2']);
        continue;
      }
      console.warn(col(c.yellow, `  ⚠  Linear sync failed: ${stderr || err.message}`));
      console.warn(col(c.yellow, `      Run: node orchestrate.js sync-fix to repair drift`));
    }
  }
  return false;
}

/**
 * Task ID in a branch name, case-insensitive, anywhere in the string, uppercased:
 * `feat/s5-S5-FLOW-003-x` → S5-FLOW-003, `feat/s2-dash-003-x` → S2-DASH-003.
 * Returns null when there is none. linear-update.yml embeds the same pattern (python
 * `re.I`); orchestrate.test.ts asserts they stay identical.
 */
const TASK_ID_BRANCH_PATTERN = '(?<![a-z0-9])s(\\d+)-([a-z0-9]+)-(\\d+)';
function extractTaskIdFromBranch(branch) {
  const m = new RegExp(TASK_ID_BRANCH_PATTERN, 'i').exec(String(branch));
  return m ? `S${m[1]}-${m[2].toUpperCase()}-${m[3]}` : null;
}

// ─── Linear batch client ──────────────────────────────────────────────────────
// sync-check / sync-fix talk to Linear directly (one paginated issues query, one
// workflow-states query) instead of one `searchIssues` call per task, which hit
// Linear's rate limit (HTTP 429) and left most tasks as "error".

const LINEAR_API_URL   = 'https://api.linear.app/graphql';
const LINEAR_TEAM_NAME = process.env.LINEAR_TEAM_NAME || 'Resolvelabs';
const linearStats = { requests: 0, retries: 0 };

/** LINEAR_API_KEY from the environment, else from .env.linear. Never logged. */
function readLinearApiKey() {
  if (process.env.LINEAR_API_KEY) return process.env.LINEAR_API_KEY;
  const envFile = path.join(__dirname, '.env.linear');
  if (!fs.existsSync(envFile)) return '';
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*(?:export\s+)?LINEAR_API_KEY\s*=\s*(.*?)\s*$/);
    if (m) return m[1].replace(/^(['"])(.*)\1$/, '$2');
  }
  return '';
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Retry-After header (seconds or HTTP date) → milliseconds, or null. */
function parseRetryAfter(value) {
  if (value === null || value === undefined || value === '') return null;
  const secs = Number(value);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const when = Date.parse(value);
  return Number.isNaN(when) ? null : Math.max(0, when - Date.now());
}

/**
 * Create a Linear GraphQL client. `fetchFn` and `sleepFn` are injectable for tests.
 * request() retries HTTP 429, HTTP 5xx, GraphQL RATELIMITED and network errors with
 * exponential backoff (honouring Retry-After), at most `maxAttempts` tries.
 * @param {{ apiKey?: string, fetchFn?: Function, sleepFn?: Function, maxAttempts?: number, baseDelayMs?: number, maxDelayMs?: number }} [options]
 */
function createLinearClient({
  apiKey,
  fetchFn = (...a) => globalThis.fetch(...a),
  sleepFn = sleep,
  maxAttempts = 4,
  baseDelayMs = 1000,
  maxDelayMs = 60000,
} = {}) {
  async function request(query, variables = {}) {
    const key = apiKey || readLinearApiKey();
    if (!key) throw new Error('LINEAR_API_KEY not set (environment or .env.linear)');

    let lastError;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      let retryAfterMs = null;
      try {
        linearStats.requests++;
        const res = await fetchFn(LINEAR_API_URL, {
          method: 'POST',
          headers: { Authorization: key, 'Content-Type': 'application/json' },
          body: JSON.stringify({ query, variables }),
        });
        if (res.status === 429 || res.status >= 500) {
          retryAfterMs = parseRetryAfter(res.headers && res.headers.get && res.headers.get('retry-after'));
          lastError = new Error(`Linear API HTTP ${res.status}`);
        } else {
          let body = null;
          try { body = await res.json(); } catch { /* handled below */ }
          const errors = body && body.errors;
          if (errors && errors.length) {
            const rateLimited = errors.some(e => e && e.extensions && e.extensions.code === 'RATELIMITED');
            const err = new Error(`Linear GraphQL error: ${errors.map(e => e && e.message).join('; ')}`);
            if (!rateLimited) throw Object.assign(err, { fatal: true });
            lastError = err;
          } else if (!res.ok || !body || !body.data) {
            throw Object.assign(new Error(`Linear API HTTP ${res.status}`), { fatal: true });
          } else {
            return body.data;
          }
        }
      } catch (err) {
        if (err.fatal) throw err;
        lastError = err; // network failure: retryable
      }
      if (attempt < maxAttempts) {
        linearStats.retries++;
        const backoff = baseDelayMs * 2 ** (attempt - 1);
        await sleepFn(Math.min(maxDelayMs, retryAfterMs !== null ? retryAfterMs : backoff));
      }
    }
    throw new Error(`${lastError.message} (gave up after ${maxAttempts} attempts)`);
  }
  return { request };
}

// includeArchived: Linear auto-archives old Done issues; they still exist and must not look MISSING
// (sync-fix would otherwise create duplicates).
const ISSUES_QUERY = `query($team: String!, $after: String) {
  issues(includeArchived: true, filter: { team: { name: { eq: $team } } }, first: 100, after: $after) {
    nodes { id identifier title state { id name type } project { id name } labels(first: 10) { nodes { name } } }
    pageInfo { hasNextPage endCursor }
  }
}`;

/** Fetch every issue for the team in as few paginated requests as possible. */
async function fetchLinearIssues(client, teamName = LINEAR_TEAM_NAME) {
  const issues = [];
  let after = null;
  for (let page = 0; page < 50; page++) {
    const data = await client.request(ISSUES_QUERY, { team: teamName, after });
    issues.push(...data.issues.nodes);
    if (!data.issues.pageInfo.hasNextPage) return issues;
    after = data.issues.pageInfo.endCursor;
  }
  throw new Error('Linear issues pagination did not terminate');
}

/** Fetch the team's workflow states and id. One request. */
async function fetchLinearTeam(client, teamName = LINEAR_TEAM_NAME) {
  const data = await client.request(
    `query($team: String!) {
      teams(filter: { name: { eq: $team } }) { nodes { id name states { nodes { id name type } } } }
    }`,
    { team: teamName }
  );
  const team = data.teams.nodes[0];
  if (!team) throw new Error(`Linear team '${teamName}' not found`);
  return { id: team.id, states: team.states.nodes };
}

/** Find a workflow state by (case-insensitive) name. */
function findState(states, name) {
  return states.find(s => s.name.toLowerCase() === String(name).toLowerCase()) || null;
}

const isCancelledIssue = (issue) =>
  !!issue.state && (issue.state.type === 'canceled' || /^(duplicate|canceled|cancelled)$/i.test(issue.state.name));

const issueNumber = (issue) => Number(String(issue.identifier).split('-').pop()) || 0;

/**
 * Map each TASK_ID to its Linear issue by title prefix (`title.toUpperCase()` starts
 * with the ID, followed by a non-alphanumeric so S4-X-001 never claims S4-X-0011).
 * Canceled / Duplicate issues are ignored. If several live issues match, the lowest
 * identifier wins and the ambiguity is reported.
 * Returns { map: Map<taskId, issue>, ambiguous: [{ id, chosen, others }] }.
 */
function buildTaskIssueMap(issues, taskIds) {
  const live = issues.filter(i => !isCancelledIssue(i));
  const map = new Map();
  const ambiguous = [];
  for (const id of taskIds) {
    const matches = live.filter(i => {
      const title = String(i.title).toUpperCase();
      return title.startsWith(id.toUpperCase()) && !/[A-Z0-9]/.test(title.charAt(id.length));
    }).sort((a, b) => issueNumber(a) - issueNumber(b));
    if (matches.length === 0) continue;
    map.set(id, matches[0]);
    if (matches.length > 1) {
      ambiguous.push({ id, chosen: matches[0].identifier, others: matches.slice(1).map(m => m.identifier) });
    }
  }
  return { map, ambiguous };
}

/**
 * Classify each Linear-tracked task: ok | drifted | missing | error.
 * `issueMap` null means the Linear fetch failed, so every task is an error.
 */
function classifyTasks(tasks, issueMap) {
  return tasks.filter(t => statusToLinear[t.status]).map(t => {
    const base = { id: t.id, markdown: t.status, expected: statusToLinear[t.status] };
    if (!issueMap) return { ...base, actual: null, status: 'error' };
    const issue = issueMap.get(t.id);
    if (!issue) return { ...base, actual: null, status: 'missing' };
    const actual = issue.state.name;
    return { ...base, actual, issue, status: linearDrifted(t.status, actual) ? 'drifted' : 'ok' };
  });
}

/**
 * Infer a sprint's Linear project: the project most used by existing issues whose
 * title starts with the same `S<N>-` prefix as `taskId`. Returns { id, name } or null.
 */
function inferSprintProject(taskId, issues) {
  const sprint = (String(taskId).match(/^S(\d+)-/i) || [])[1];
  if (!sprint) return null;
  const counts = new Map();
  for (const i of issues) {
    const m = String(i.title).match(/^S(\d+)-/i);
    if (!m || m[1] !== sprint || !i.project || isCancelledIssue(i)) continue;
    const entry = counts.get(i.project.id) || { project: i.project, n: 0 };
    entry.n++;
    counts.set(i.project.id, entry);
  }
  const ranked = [...counts.values()].sort((a, b) => b.n - a.n || a.project.name.localeCompare(b.project.name));
  return ranked.length ? ranked[0].project : null;
}

/** Issue-create input for a task with no Linear issue (state/team ids filled by caller). */
function buildCreateInput(task, issues) {
  const project = inferSprintProject(task.id, issues);
  return {
    title: `${task.id} — ${task.title}`,
    description: `Source: ${task.filePath ? 'tasks/' + path.basename(task.filePath) : 'sprint file'} (${task.id}). Created by \`orchestrate.js sync-fix\`.`,
    stateName: statusToLinear[task.status],
    project,
  };
}

/** Exit code for --ci: 1 when anything is still out of sync, else 0. */
function syncExitCode(summary) {
  const bad = summary.driftCount + summary.missingCount + summary.errorCount + summary.gitDriftCount;
  return bad > 0 || (summary.failed || 0) > 0 ? 1 : 0;
}

// ─── Task block parser ────────────────────────────────────────────────────────

/**
 * Parse all task blocks from a sprint markdown file.
 * Returns an array of task objects. Each task has the shape:
 *   { id, title, branch, model, status, blockedBy[], acceptanceCriteria[], files[], notes, raw, filePath, blockStart, blockEnd }
 *
 * blockStart/blockEnd are line-indices in the original file content (split by \n)
 * so we can update STATUS in-place later.
 */
function parseSprintFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const lines = raw.split('\n');
  const tasks = [];

  // Each task block starts at a line matching: - [ ] **[TASK_ID]** — …  or - [x] …
  // We detect task boundaries by looking for the TASK_ID: field.
  let i = 0;
  while (i < lines.length) {
    if (/^TASK_ID:\s+\S/.test(lines[i])) {
      // Scan backwards to find the checkbox header line (- [ ] **…**)
      let blockStart = i;
      while (blockStart > 0 && !/^- \[[ x]\]/.test(lines[blockStart])) blockStart--;

      // Scan forwards to find the end of this task block (next --- separator or next - [ ] or EOF)
      let blockEnd = i + 1;
      while (blockEnd < lines.length) {
        const l = lines[blockEnd];
        if (/^---/.test(l) || /^- \[[ x]\]/.test(l) || /^TASK_ID:/.test(l)) break;
        blockEnd++;
      }

      const blockLines = lines.slice(blockStart, blockEnd);
      const task = parseTaskBlock(blockLines, blockStart, blockEnd - 1, filePath);
      if (task) tasks.push(task);
      i = blockEnd;
    } else {
      i++;
    }
  }

  return tasks;
}

/** Parse a single task block (array of lines) into a task object. */
function parseTaskBlock(lines, blockStart, blockEnd, filePath) {
  const get = (key) => {
    const line = lines.find(l => new RegExp(`^${key}:\\s`).test(l));
    return line ? line.replace(new RegExp(`^${key}:\\s+`), '').trim() : null;
  };

  const id      = get('TASK_ID');
  const title   = get('TITLE');
  const branch  = get('BRANCH');
  const status  = get('STATUS') || 'not_started';
  const notes   = get('NOTES');

  let model = get('MODEL');
  if (!model) {
    console.warn(col(c.yellow, `⚠  Task ${id || '?'} has no MODEL field — defaulting to ${DEFAULT_MODEL}`));
    model = DEFAULT_MODEL;
  }

  // BLOCKED_BY — comma-separated or 'none'
  const blockedByRaw = get('BLOCKED_BY') || 'none';
  const blockedBy = blockedByRaw === 'none' ? [] : blockedByRaw.split(',').map(s => s.trim()).filter(Boolean);

  // ACCEPTANCE_CRITERIA — indented list
  const acStart = lines.findIndex(l => /^ACCEPTANCE_CRITERIA:/.test(l));
  const filesStart = lines.findIndex(l => /^FILES:/.test(l));
  const notesIdx = lines.findIndex(l => /^NOTES:/.test(l));

  const extractList = (startIdx) => {
    if (startIdx === -1) return [];
    const items = [];
    for (let i = startIdx + 1; i < lines.length; i++) {
      const l = lines[i];
      if (/^\s*-\s+/.test(l)) items.push(l.replace(/^\s*-\s+/, '').trim());
      else if (/^[A-Z_]+:/.test(l) || l.trim() === '') break;
    }
    return items;
  };

  const acceptanceCriteria = extractList(acStart);
  const files = extractList(filesStart);

  if (!id) return null;

  return {
    id,
    title:   title   || id,
    branch:  branch  || '',
    model,
    status,
    blockedBy,
    acceptanceCriteria,
    files,
    notes:   notes   || '',
    raw:     lines.join('\n'),
    filePath,
    blockStart,
    blockEnd,
  };
}

/** Load all tasks from all sprint files. Returns { tasks: Task[], byId: Map } */
function loadAllTasks() {
  const files = sprintFiles();
  if (files.length === 0) {
    console.error(col(c.red, '✗  No sprint files found in tasks/ directory.'));
    process.exit(1);
  }
  const allTasks = [];
  for (const f of files) {
    allTasks.push(...parseSprintFile(f));
  }
  const byId = new Map(allTasks.map(t => [t.id, t]));
  return { tasks: allTasks, byId };
}

// ─── Dependency graph helpers ─────────────────────────────────────────────────

/** Detect circular dependencies using DFS. Throws if a cycle is found. */
function detectCircularDependencies(tasks, byId) {
  const UNVISITED = 0, VISITING = 1, VISITED = 2;
  const state = new Map(tasks.map(t => [t.id, UNVISITED]));

  function dfs(id, path) {
    state.set(id, VISITING);
    const task = byId.get(id);
    if (!task) return; // unknown dependency — will be flagged elsewhere
    for (const dep of task.blockedBy) {
      if (!byId.has(dep)) continue;
      if (state.get(dep) === VISITING) {
        throw new Error(`Circular dependency detected: ${[...path, dep].join(' → ')}`);
      }
      if (state.get(dep) === UNVISITED) dfs(dep, [...path, dep]);
    }
    state.set(id, VISITED);
  }

  for (const t of tasks) {
    if (state.get(t.id) === UNVISITED) dfs(t.id, [t.id]);
  }
}

/**
 * Compute parallelism waves. A wave is the set of tasks whose dependencies
 * are all satisfied by tasks in earlier waves.
 * Returns an array of waves, each wave is an array of task objects.
 */
function computeWaves(tasks, byId) {
  // Only consider not_started tasks whose all BLOCKED_BY are done
  const eligible = tasks.filter(t => t.status === 'not_started');
  const doneIds  = new Set(tasks.filter(t => t.status === 'done').map(t => t.id));

  // Compute level for each eligible task (max dependency level + 1)
  // We compute across all tasks for correctness, then filter.
  const level = new Map();

  function getLevel(id, visiting = new Set()) {
    if (level.has(id)) return level.get(id);
    const task = byId.get(id);
    if (!task || task.blockedBy.length === 0) { level.set(id, 0); return 0; }
    visiting.add(id);
    let max = -1;
    for (const dep of task.blockedBy) {
      if (visiting.has(dep)) continue; // cycle already detected
      const dl = getLevel(dep, new Set(visiting));
      if (dl > max) max = dl;
    }
    const l = max + 1;
    level.set(id, l);
    return l;
  }

  for (const t of tasks) getLevel(t.id);

  // Group eligible tasks by level, but only if all deps are done
  const waves = [];
  for (const t of eligible) {
    const allDepsDone = t.blockedBy.every(dep => {
      const depTask = byId.get(dep);
      return depTask && depTask.status === 'done';
    });
    if (!allDepsDone) continue;
    const waveIdx = level.get(t.id) || 0;
    while (waves.length <= waveIdx) waves.push([]);
    waves[waveIdx].push(t);
  }

  return waves.filter(w => w.length > 0);
}

// ─── Progress bar ─────────────────────────────────────────────────────────────

function progressBar(done, total, width = 10) {
  const filled = total ? Math.round((done / total) * width) : 0;
  return '[' + '█'.repeat(filled) + '░'.repeat(width - filled) + ']';
}

// ─── Sprint name from file path ───────────────────────────────────────────────
function sprintName(filePath) {
  return path.basename(filePath, '.md');
}

// ─── Update STATUS in file ────────────────────────────────────────────────────

/**
 * Set a task's STATUS field to newStatus in its markdown file.
 * Also toggles the checkbox header: [x] when done, [ ] otherwise.
 */
function setTaskStatus(task, newStatus) {
  const raw = fs.readFileSync(task.filePath, 'utf8');
  const lines = raw.split('\n');

  let updated = false;

  // Update STATUS: field
  for (let i = task.blockStart; i <= task.blockEnd && i < lines.length; i++) {
    if (/^STATUS:\s/.test(lines[i])) {
      lines[i] = `STATUS: ${newStatus}`;
      updated = true;
    }
    // Toggle checkbox
    if (/^- \[[ x]\]/.test(lines[i])) {
      lines[i] = lines[i].replace(/^- \[[ x]\]/, newStatus === 'done' ? '- [x]' : '- [ ]');
    }
  }

  if (!updated) {
    console.error(col(c.red, `✗  Could not find STATUS field for task ${task.id}`));
    return;
  }

  atomicWrite(task.filePath, lines.join('\n'));
}

// ─── Commands ─────────────────────────────────────────────────────────────────

function cmdStatus() {
  const { tasks, byId } = loadAllTasks();
  detectCircularDependencies(tasks, byId);

  // Group by sprint file
  const byFile = new Map();
  for (const t of tasks) {
    if (!byFile.has(t.filePath)) byFile.set(t.filePath, []);
    byFile.get(t.filePath).push(t);
  }

  console.log('\n' + bold('=== Hudo Orchestration Status ===') + '\n');

  for (const [filePath, ftasks] of byFile) {
    const sprint = sprintName(filePath);
    const done  = ftasks.filter(t => t.status === 'done').length;
    const total = ftasks.length;
    const bar   = progressBar(done, total);
    console.log(bold(`${sprint} ${bar} ${done}/${total} tasks done`));

    for (const t of ftasks) {
      const sc   = statusColour(t.status);
      const mc   = modelColour(t.model);
      const deps = t.blockedBy.length ? ` (blocked by: ${t.blockedBy.join(', ')})` : '';
      // Check for unknown dependencies
      const missingDeps = t.blockedBy.filter(d => !byId.has(d));
      const missing = missingDeps.length ? col(c.red, ` [unknown dep: ${missingDeps.join(', ')}]`) : '';
      console.log(
        `  ${col(sc, t.id.padEnd(20))} ${col(sc, t.status.padEnd(12))} ` +
        `${col(mc, ('claude-' + t.model).padEnd(20))} ${t.title}${deps}${missing}`
      );
    }
    console.log();
  }
}

function cmdNext() {
  const { tasks, byId } = loadAllTasks();
  detectCircularDependencies(tasks, byId);

  const waves = computeWaves(tasks, byId);

  if (waves.length === 0) {
    // Check if everything is done
    const allDone = tasks.every(t => t.status === 'done');
    if (allDone) {
      console.log(col(c.green, '\n✓  All tasks are done!\n'));
    } else {
      console.log(col(c.yellow, '\n⚠  No unblocked tasks. Check for blocked/in-progress tasks.\n'));
    }
    return;
  }

  console.log('\n' + bold('=== Unblocked Tasks (Parallelism Waves) ===') + '\n');

  waves.forEach((wave, idx) => {
    const label = idx === 0 ? 'Wave 1 (run simultaneously)' : `Wave ${idx + 1} (after Wave ${idx} completes)`;
    console.log(bold(label));
    for (const t of wave) {
      const mc = modelColour(t.model);
      console.log(`  ${col(c.white, t.id.padEnd(20))} ${col(mc, 'claude-' + t.model)}  ${t.title}`);
      console.log(`    Branch: ${col(c.grey, t.branch)}`);
    }
    console.log();
  });
}

function cmdPrompt(taskId) {
  if (!taskId) { console.error('Usage: node orchestrate.js prompt <TASK_ID>'); process.exit(1); }
  const { byId } = loadAllTasks();
  const task = byId.get(taskId);
  if (!task) { console.error(col(c.red, `✗  Task not found: ${taskId}`)); process.exit(1); }

  const modelLine = `claude-${task.model}`;
  const mc = modelColour(task.model);

  console.log('\n' + '═'.repeat(55));
  console.log(`  MODEL: ${col(mc, modelLine)}`);
  console.log(`  ⚠  Select this model in Cursor before starting this session`);
  console.log('═'.repeat(55) + '\n');

  console.log(`You are a build agent for the Hudo project.

Your task is below. Read it fully before writing any code.

${task.raw}

RULES:
- Only create or modify the files listed in FILES above
- Write the minimum code needed to satisfy every acceptance criterion — nothing more
- Write a test for every behaviour described in the acceptance criteria
- Do not install any npm dependency not already in package.json without flagging it first
- The full PRD is at docs/prd.md — refer to it if you need context beyond this task
- The full tech stack and schema is at docs/build-foundation.md

WHEN STARTING:
  Run: node orchestrate.js start ${taskId}

WHEN OPENING PR:
  Run: node orchestrate.js review ${taskId}

Commit your work, push the branch, and open a PR when done.
${taskId.includes('-E2E-') ? `
E2E TASK NOTES:
- This is a Playwright E2E task. Tests live in tests/e2e/
- Run tests locally: pnpm test:e2e (against localhost:3000)
- Interactive mode: pnpm test:e2e:ui
- Never call Supabase or R2 directly from tests — drive the browser UI only
- Use data-testid attributes for selectors, never CSS class names
- Page Objects live in tests/e2e/pages/ — populate rather than inventing new ones
- Fixtures live in tests/e2e/fixtures/ — use the auth fixture for authenticated sessions
- Skeleton files already exist from S1-E2E-000 — populate them, don't recreate
` : ''}`);
}

function cmdStart(taskId) {
  if (!taskId) { console.error('Usage: node orchestrate.js start <TASK_ID>'); process.exit(1); }
  const { byId } = loadAllTasks();
  const task = byId.get(taskId);
  if (!task) { console.error(col(c.red, `✗  Task not found: ${taskId}`)); process.exit(1); }

  // Always branch from main so PRs always target main
  if (task.branch) {
    try {
      console.log(col(c.grey, '  Branching from main…'));
      execFileSync('git', ['checkout', 'main'], { stdio: 'inherit' });
      execFileSync('git', ['pull', 'origin', 'main'], { stdio: 'inherit' });
      try {
        execFileSync('git', ['checkout', '-b', task.branch], { stdio: 'inherit' });
      } catch {
        execFileSync('git', ['checkout', task.branch], { stdio: 'inherit' });
      }
      console.log(col(c.grey, `  on branch: ${task.branch}`));
    } catch (err) {
      console.warn(col(c.yellow, `⚠  git branch setup failed — create branch manually: git checkout main && git checkout -b ${task.branch}`));
    }
  }

  setTaskStatus(task, 'in_progress');
  auditLog(`START ${taskId}`);
  console.log(col(c.yellow, `▶  ${taskId} set to in_progress`));
  syncLinear(taskId, 'in_progress');
}

function cmdReview(taskId) {
  if (!taskId) { console.error('Usage: node orchestrate.js review <TASK_ID>'); process.exit(1); }
  const { byId } = loadAllTasks();
  const task = byId.get(taskId);
  if (!task) { console.error(col(c.red, `✗  Task not found: ${taskId}`)); process.exit(1); }
  setTaskStatus(task, 'in_review');
  auditLog(`REVIEW ${taskId}`);
  console.log(col(c.yellow, `⏳  ${taskId} set to in_review`));
  syncLinear(taskId, 'in_review');
}

/**
 * Mark a task done in markdown + Linear. Shared by cmdDone and cmdSyncFix.
 * Returns { task, linearSynced } on success, or null if the task was not found.
 */
function markTaskDone(taskId, { auditTag = 'DONE' } = {}) {
  const { byId } = loadAllTasks();
  const task = byId.get(taskId);
  if (!task) return null;
  setTaskStatus(task, 'done');
  auditLog(`${auditTag} ${taskId}`);
  const linearSynced = syncLinear(taskId, 'done');
  return { task, linearSynced };
}

function cmdDone(taskId) {
  if (!taskId) { console.error('Usage: node orchestrate.js done <TASK_ID>'); process.exit(1); }
  const result = markTaskDone(taskId);
  if (!result) { console.error(col(c.red, `✗  Task not found: ${taskId}`)); process.exit(1); }
  console.log(col(c.green, `✓  ${taskId} done`));

  // Re-load to get fresh statuses and print newly unblocked tasks
  const { tasks: freshTasks, byId: freshById } = loadAllTasks();
  // Mark the task we just set as done in memory (in case file parse lags)
  const waves = computeWaves(freshTasks, freshById);
  const wave1 = waves[0] || [];

  if (wave1.length > 0) {
    console.log('\n' + bold('Newly unblocked:'));
    for (const t of wave1) {
      const mc = modelColour(t.model);
      console.log(`  ${col(c.white, t.id)}  ${col(mc, 'claude-' + t.model)}  ${t.title}`);
    }
    console.log();
  }

  // Vault update prompt
  const sprintMatch = taskId.match(/^S(\d+)-/);
  if (sprintMatch) {
    const sprintNum  = sprintMatch[1];
    const vaultNote  = path.join(__dirname, 'docs', 'vault', 'sprints', `sprint-${sprintNum}`, `${taskId}.md`);
    if (fs.existsSync(vaultNote)) {
      const relPath = path.relative(__dirname, vaultNote);
      console.log(col(c.grey, '─'.repeat(52)));
      console.log(bold('Vault update:') + col(c.grey, ` ${relPath}`));
      console.log(col(c.white, 'Add a ## Gotchas section with anything non-obvious'));
      console.log(col(c.white, 'from this session: surprises, workarounds, decisions.'));
      console.log(col(c.white, 'Skip if the implementation was straightforward.'));
      console.log(col(c.grey, '─'.repeat(52)));
    }
  }
}

function cmdGate(sprintArg) {
  if (!sprintArg) { console.error('Usage: node orchestrate.js gate <sprint-name>'); process.exit(1); }
  // sprintArg e.g. "sprint-0"
  const filePath = path.join(TASKS_DIR, sprintArg + '.md');
  if (!fs.existsSync(filePath)) {
    console.error(col(c.red, `✗  Sprint file not found: ${filePath}`));
    process.exit(1);
  }

  // Parse gate checklist from the file — lines starting with `- [ ]` or `- [x]` under a "Gate Checklist" heading
  const raw   = fs.readFileSync(filePath, 'utf8');
  const lines = raw.split('\n');

  const gateStart = lines.findIndex(l => /gate checklist/i.test(l));
  if (gateStart === -1) {
    console.error(col(c.red, '✗  No gate checklist found in sprint file.'));
    process.exit(1);
  }

  const tasks = parseSprintFile(filePath);
  const allDone = tasks.every(t => t.status === 'done');

  console.log('\n' + bold(`=== Gate Checklist: ${sprintArg} ===`) + '\n');

  let hasItems = false;
  for (let i = gateStart + 1; i < lines.length; i++) {
    const l = lines[i];
    // Stop at next major heading
    if (/^#{1,3} /.test(l) && i > gateStart + 1) break;
    const doneMatch = l.match(/^- \[x\]\s+(.+)/);
    const todoMatch = l.match(/^- \[ \]\s+(.+)/);
    if (doneMatch) {
      console.log(col(c.green, `  ✓  ${doneMatch[1]}`));
      hasItems = true;
    } else if (todoMatch) {
      console.log(col(c.red,   `  ✗  ${todoMatch[1]}`));
      hasItems = true;
    }
  }

  if (!hasItems) {
    // Fallback: use the built-in gate criteria for sprint-0
    console.log(col(c.grey, '  (No checklist items found in file — showing task completion status)'));
    for (const t of tasks) {
      const check = t.status === 'done' ? col(c.green, '✓') : col(c.red, '✗');
      console.log(`  ${check}  [${t.id}] ${t.title}`);
    }
  }

  console.log();
  const overall = allDone ? col(c.green, '✓  All tasks done — sprint gate can be reviewed') :
                             col(c.yellow, '⚠  Sprint not fully done — gate not yet passable');
  console.log(overall + '\n');
}

function cmdBlocked(taskId, reason) {
  if (!taskId || !reason) {
    console.error('Usage: node orchestrate.js blocked <TASK_ID> "<reason>"');
    process.exit(1);
  }
  const { byId } = loadAllTasks();
  const task = byId.get(taskId);
  if (!task) { console.error(col(c.red, `✗  Task not found: ${taskId}`)); process.exit(1); }
  setTaskStatus(task, 'blocked');
  const msg = `BLOCKED ${taskId} — ${reason}`;
  auditLog(msg);
  console.log(col(c.red, `✗  ${taskId} marked blocked: ${reason}`));
  syncLinear(taskId, 'blocked');
}

// ─── Sync commands ────────────────────────────────────────────────────────────

/** Run a git command and return stdout, or '' on failure (never throws). */
function gitSafe(args) {
  try {
    return execFileSync('git', args, {
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 10000,
    }).toString().trim();
  } catch {
    return '';
  }
}

/** True if `ancestor` is reachable from `descendant` (both ref names). */
function gitIsAncestor(ancestor, descendant) {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', ancestor, descendant], {
      stdio: ['ignore', 'ignore', 'ignore'],
      timeout: 10000,
    });
    return true;
  } catch {
    return false;
  }
}

/** Resolve the list of release refs to check against, in priority order. */
function listReleaseRefs() {
  const candidates = [];
  for (const base of ['main', 'production']) {
    if (gitSafe(['rev-parse', '--verify', '--quiet', base])) {
      candidates.push(base);
    } else if (gitSafe(['rev-parse', '--verify', '--quiet', `origin/${base}`])) {
      candidates.push(`origin/${base}`);
    }
  }
  const waves = gitSafe([
    'for-each-ref',
    '--format=%(refname:short)',
    'refs/heads/preview/wave-*',
    'refs/remotes/origin/preview/wave-*',
  ]).split('\n').map(s => s.trim()).filter(Boolean);
  // De-dupe while preserving order; prefer local ref over its origin/ counterpart
  const seen = new Set();
  for (const ref of waves) {
    const local = ref.replace(/^origin\//, '');
    if (seen.has(local)) continue;
    seen.add(local);
    // Prefer the local ref name if both exist
    candidates.push(waves.includes(local) ? local : ref);
  }
  return candidates;
}

/**
 * True if a commit subject shows `taskId` was actually built and merged. Only the
 * subject counts: bodies of plan/spec commits list future task IDs, and `chore`
 * commits add sprint rows or bump status without building anything.
 */
function subjectShowsTaskMerged(subject, taskId) {
  return subject.includes(taskId) && !/^chore\b/.test(subject);
}

/**
 * Detect tasks whose branch (or task ID) is reachable from a release ref but whose
 * markdown status is not `done`. Returns array of { id, branch, mergedIn, evidence }.
 */
function detectGitDrift(tasks) {
  const releaseRefs = listReleaseRefs();
  if (releaseRefs.length === 0) return [];

  const candidate = (s) => ['not_started', 'in_progress', 'in_review', 'blocked'].includes(s);
  const drifted = [];

  for (const t of tasks) {
    if (!candidate(t.status)) continue;
    if (!t.id) continue;

    let mergedIn = null;
    let evidence = null;

    // First pass: branch-ancestor check (strongest evidence)
    if (t.branch) {
      const branchRefs = [
        `refs/remotes/origin/${t.branch}`,
        `refs/heads/${t.branch}`,
      ];
      for (const ref of branchRefs) {
        if (!gitSafe(['rev-parse', '--verify', '--quiet', ref])) continue;
        for (const release of releaseRefs) {
          if (gitIsAncestor(ref, release)) {
            mergedIn = release;
            evidence = `branch ${t.branch} merged into ${release}`;
            break;
          }
        }
        if (mergedIn) break;
      }
    }

    // Fallback: task ID present in release-ref history
    if (!mergedIn) {
      for (const release of releaseRefs) {
        // --grep matches the whole message; narrow it, then require the ID in the subject
        const log = gitSafe(['log', release, '--format=%h %s', '-F', `--grep=${t.id}`]);
        const line = log.split('\n').find(l => subjectShowsTaskMerged(l.slice(l.indexOf(' ') + 1), t.id));
        if (line) {
          mergedIn = release;
          evidence = `task id in ${release} history: ${line}`;
          break;
        }
      }
    }

    if (mergedIn) {
      drifted.push({ id: t.id, branch: t.branch, markdownStatus: t.status, mergedIn, evidence });
    }
  }

  return drifted;
}

// Map markdown status → expected Linear state name
const statusToLinear = {
  'not_started': 'Backlog',
  'in_progress': 'In Progress',
  'in_review':   'In Review',
  'done':        'Done',
  'blocked':     'Blocked',
};

/**
 * True if a task's Linear state contradicts its markdown status. A `not_started`
 * task only drifts when Linear says Done: In Progress / In Review are normal while
 * its feature branch is open (the status bump lives on the branch, and
 * linear-update.yml moves Linear on push and PR open). Every other status must
 * match its `statusToLinear` name.
 */
function linearDrifted(markdownStatus, linearState) {
  const actual = String(linearState).toLowerCase();
  if (markdownStatus === 'not_started') return actual === 'done';
  const expected = statusToLinear[markdownStatus];
  return expected !== undefined && actual !== expected.toLowerCase();
}

/**
 * Fetch Linear once and classify every Linear-tracked task. Never throws: a failed
 * fetch yields `fetchError` and every task classified as `error`.
 */
async function runSyncCheck({ tasks, client, gitDrift }) {
  let issues = [];
  let issueMap = null;
  let ambiguous = [];
  let fetchError = null;
  try {
    issues = await fetchLinearIssues(client);
    const built = buildTaskIssueMap(issues, tasks.map(t => t.id));
    issueMap = built.map;
    ambiguous = built.ambiguous;
  } catch (err) {
    fetchError = err.message;
  }
  const results = classifyTasks(tasks, issueMap);
  const count = (s) => results.filter(r => r.status === s).length;
  const gd = gitDrift ? gitDrift(tasks) : detectGitDrift(tasks);
  return {
    results, issues, ambiguous, fetchError,
    checkable: results.length,
    driftCount: count('drifted'),
    missingCount: count('missing'),
    errorCount: count('error'),
    gitDrift: gd,
    gitDriftCount: gd.length,
  };
}

function printSyncCheck(s) {
  console.log('\n' + bold('=== Linear Sync Check ===') + '\n');

  if (s.fetchError) {
    console.log(col(c.red, `  ✗  Could not fetch Linear issues: ${s.fetchError}`));
    console.log(col(c.red, `     ${s.errorCount} task(s) could not be checked.\n`));
  } else if (s.results.length === 0) {
    console.log(col(c.grey, '  No tasks with Linear-tracked status to query.\n'));
  } else {
    console.log(`  ${'TASK'.padEnd(20)} ${'MARKDOWN'.padEnd(14)} ${'LINEAR'.padEnd(14)} STATUS`);
    console.log('  ' + '─'.repeat(60));
    for (const r of s.results) {
      const head = `  ${r.id.padEnd(20)} ${r.markdown.padEnd(14)}`;
      if (r.status === 'ok') {
        console.log(`${head} ${r.actual.padEnd(14)} ${col(c.green, '✓ in sync')}`);
      } else if (r.status === 'drifted') {
        console.log(`${head} ${col(c.red, r.actual.padEnd(14))} ${col(c.red, '✗ DRIFTED')}`);
      } else if (r.status === 'missing') {
        console.log(`${head} ${col(c.red, '(no issue)'.padEnd(14))} ${col(c.red, '✗ MISSING')}`);
      }
    }
  }

  for (const a of s.ambiguous) {
    console.log(col(c.yellow, `  ⚠  ${a.id}: several Linear issues match; using ${a.chosen} (also ${a.others.join(', ')})`));
  }

  if (s.gitDriftCount > 0) {
    console.log();
    console.log(bold('MERGED INTO RELEASE BUT NOT DONE'));
    console.log(`  ${'TASK'.padEnd(20)} ${'MARKDOWN'.padEnd(14)} ${'MERGED IN'.padEnd(20)} EVIDENCE`);
    console.log('  ' + '─'.repeat(72));
    for (const g of s.gitDrift) {
      const evidence = g.evidence.length > 60 ? g.evidence.slice(0, 57) + '…' : g.evidence;
      console.log(
        `  ${col(c.red, g.id.padEnd(20))} ${g.markdownStatus.padEnd(14)} ${g.mergedIn.padEnd(20)} ${col(c.grey, evidence)}`
      );
    }
  }

  console.log();
  if (s.driftCount === 0 && s.missingCount === 0 && s.errorCount === 0 && s.gitDriftCount === 0) {
    const tally = s.checkable > 0
      ? `All ${s.checkable} tasks in sync with Linear and git.`
      : 'No drift detected.';
    console.log(col(c.green, `✓  ${tally}\n`));
  } else {
    if (s.driftCount > 0)    console.log(col(c.yellow, `⚠  ${s.driftCount} task(s) drifted from Linear.`));
    if (s.missingCount > 0)  console.log(col(c.yellow, `⚠  ${s.missingCount} task(s) have no Linear issue (MISSING).`));
    if (s.gitDriftCount > 0) console.log(col(c.yellow, `⚠  ${s.gitDriftCount} task(s) merged into a release ref but not marked done.`));
    if (s.errorCount > 0)    console.log(col(c.red,    `⚠  ${s.errorCount} task(s) could not be checked (ERROR).`));
    console.log(col(c.yellow, `   Run: node orchestrate.js sync-fix to repair drift\n`));
  }
}

/**
 * Read-only. With ci=true the process exit code is set from the result.
 * @param {{ ci?: boolean, tasks?: any[], client?: any, gitDrift?: Function }} [opts]
 * @returns {Promise<any>}
 */
async function cmdSyncCheck({ ci = false, tasks, client, gitDrift } = {}) {
  const summary = await runSyncCheck({
    tasks: tasks || loadAllTasks().tasks,
    client: client || createLinearClient(),
    gitDrift,
  });
  printSyncCheck(summary);
  console.log(col(c.grey, `  Linear API requests: ${linearStats.requests} (${linearStats.retries} retried)\n`));
  summary.exitCode = syncExitCode(summary);
  if (ci) process.exitCode = summary.exitCode;
  return summary;
}

/**
 * @param {{ ci?: boolean, tasks?: any[], client?: any, gitDrift?: Function }} [opts]
 * @returns {Promise<any>}
 */
async function cmdSyncFix({ ci = false, tasks: injectedTasks, client: injectedClient, gitDrift } = {}) {
  const client = injectedClient || createLinearClient();
  const loadTasks = () => injectedTasks || loadAllTasks().tasks;

  const first = await runSyncCheck({ tasks: loadTasks(), client, gitDrift });
  printSyncCheck(first);

  const finish = (summary, failed) => {
    summary.failed = failed;
    summary.exitCode = syncExitCode(summary);
    if (ci) process.exitCode = summary.exitCode;
    return summary;
  };

  if (first.fetchError) return finish(first, 0);

  if (first.driftCount === 0 && first.missingCount === 0 && first.gitDriftCount === 0) {
    console.log(col(c.green, 'Nothing to fix.\n'));
    return finish(first, 0);
  }

  console.log(bold('=== Fixing Drift ===') + '\n');

  let fixed = 0;
  let failed = 0;

  // Git drift: tasks merged into a release ref are promoted to done in markdown first,
  // so the Linear pass below pushes `Done` for them. Markdown stays the source of truth
  // even if Linear is unreachable; sync-fix can simply be re-run.
  for (const g of first.gitDrift) {
    const task = loadAllTasks().byId.get(g.id);
    if (!task) {
      console.log(col(c.red, `  ✗  ${g.id}: task vanished from sprint files`));
      failed++;
      continue;
    }
    setTaskStatus(task, 'done');
    auditLog(`SYNC-FIX-GIT: ${g.id} merged into ${g.mergedIn} — auto-promoted to done`);
    console.log(col(c.green, `  ✓  ${g.id}: ${g.markdownStatus} → done in markdown (merged in ${g.mergedIn})`));
  }

  // Re-read markdown: git drift just changed it (injected tasks are used as given)
  const current = loadTasks();
  const byId = new Map(current.map(t => [t.id, t]));
  const plan = classifyTasks(current, buildTaskIssueMap(first.issues, current.map(t => t.id)).map);
  const actionable = plan.filter(r => r.status === 'drifted' || r.status === 'missing');

  let team = null;
  if (actionable.length > 0) {
    try {
      team = await fetchLinearTeam(client);
    } catch (err) {
      console.log(col(c.red, `  ✗  Could not load Linear workflow states: ${err.message}`));
      failed += actionable.length;
    }
  }

  if (team) {
    for (const r of plan.filter(x => x.status === 'drifted')) {
      const state = findState(team.states, r.expected);
      if (!state) {
        console.log(col(c.red, `  ✗  ${r.id}: Linear state '${r.expected}' not found`));
        failed++;
        continue;
      }
      try {
        await client.request(
          'mutation($id: String!, $stateId: String!) { issueUpdate(id: $id, input: { stateId: $stateId }) { success } }',
          { id: r.issue.id, stateId: state.id }
        );
        console.log(col(c.green, `  ✓  ${r.id} (${r.issue.identifier}): ${r.actual} → ${r.expected}`));
        fixed++;
      } catch (err) {
        console.log(col(c.red, `  ✗  ${r.id}: ${err.message}`));
        failed++;
      }
    }

    for (const r of plan.filter(x => x.status === 'missing')) {
      const input = buildCreateInput(byId.get(r.id), first.issues);
      const state = findState(team.states, input.stateName);
      if (!state) {
        console.log(col(c.red, `  ✗  ${r.id}: Linear state '${input.stateName}' not found`));
        failed++;
        continue;
      }
      try {
        const data = await client.request(
          'mutation($input: IssueCreateInput!) { issueCreate(input: $input) { success issue { id identifier } } }',
          {
            input: {
              teamId: team.id,
              title: input.title,
              description: input.description,
              stateId: state.id,
              ...(input.project ? { projectId: input.project.id } : {}),
            },
          }
        );
        const where = input.project ? `project ${input.project.name}` : 'no project (none inferred)';
        console.log(col(c.green, `  ✓  ${r.id}: created ${data.issueCreate.issue.identifier} [${input.stateName}, ${where}]`));
        auditLog(`SYNC-FIX-CREATE: ${r.id} → ${data.issueCreate.issue.identifier}`);
        fixed++;
      } catch (err) {
        console.log(col(c.red, `  ✗  ${r.id}: create failed: ${err.message}`));
        failed++;
      }
    }
  }

  console.log();
  auditLog(`SYNC-FIX: ${fixed} fixed, ${failed} failed`);
  console.log(col(fixed > 0 ? c.green : c.yellow, `Sync-fix complete: ${fixed} fixed, ${failed} failed.`));

  // Re-check against Linear so the result (and the --ci exit code) reflects reality
  console.log(col(c.grey, '\nRe-checking after fixes…'));
  const after = await runSyncCheck({ tasks: loadTasks(), client, gitDrift });
  printSyncCheck(after);
  console.log(col(c.grey, `  Linear API requests: ${linearStats.requests} (${linearStats.retries} retried)\n`));
  return finish(after, failed);
}

// ─── CLI entry point ──────────────────────────────────────────────────────────

if (require.main === module) {
  const [,, command, ...args] = process.argv;
  const fatal = (err) => { console.error(col(c.red, `✗  ${err.message}`)); process.exit(1); };

  switch (command) {
    case 'status':               cmdStatus();                    break;
    case 'next':                 cmdNext();                      break;
    case 'prompt':               cmdPrompt(args[0]);             break;
    case 'start':                cmdStart(args[0]);              break;
    case 'review':               cmdReview(args[0]);             break;
    case 'done':                 cmdDone(args[0]);               break;
    case 'gate':                 cmdGate(args[0]);               break;
    case 'blocked':              cmdBlocked(args[0], args[1]);   break;
    case 'sync-check':           cmdSyncCheck({ ci: args.includes('--ci') }).catch(fatal); break;
    case 'sync-fix':             cmdSyncFix({ ci: args.includes('--ci') }).catch(fatal); break;
    default:
      console.log(`
Usage: node orchestrate.js <command> [args]

Commands:
  status                     — Full dependency graph and progress across all sprints
  next                       — All unblocked tasks grouped into parallelism waves
  prompt <TASK_ID>           — Generate Claude Code agent prompt for a task
  start  <TASK_ID>           — Set task STATUS to in_progress
  review <TASK_ID>           — Set task STATUS to in_review
  done   <TASK_ID>           — Set task STATUS to done; show newly unblocked tasks
  gate   <sprint-name>       — Sprint gate checklist (e.g. gate sprint-0)
  blocked <TASK_ID> "reason" — Mark task blocked with reason (logged to orchestrate-audit.log)
  sync-check [--ci]          — Compare markdown task statuses with Linear (read-only); --ci exits 1 on drift/missing/error
  sync-fix [--ci]            — Push markdown statuses to Linear, create missing issues; --ci exits 1 if anything remains
`);
  }
}

module.exports = {
  subjectShowsTaskMerged, linearDrifted, detectGitDrift,
  extractTaskIdFromBranch, TASK_ID_BRANCH_PATTERN,
  createLinearClient, fetchLinearIssues, fetchLinearTeam, buildTaskIssueMap,
  classifyTasks, inferSprintProject, buildCreateInput, syncExitCode,
  runSyncCheck, cmdSyncCheck, cmdSyncFix,
};
