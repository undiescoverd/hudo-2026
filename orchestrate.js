#!/usr/bin/env node
// orchestrate.js — Hudo agent build orchestrator
// Runs with Node.js 20+, zero npm dependencies.
// Usage: node orchestrate.js <command> [args]

'use strict';

const fs = require('fs');
const path = require('path');

// ─── Colour helpers ───────────────────────────────────────────────────────────
const c = {
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
`);
}

function cmdStart(taskId) {
  if (!taskId) { console.error('Usage: node orchestrate.js start <TASK_ID>'); process.exit(1); }
  const { byId } = loadAllTasks();
  const task = byId.get(taskId);
  if (!task) { console.error(col(c.red, `✗  Task not found: ${taskId}`)); process.exit(1); }
  setTaskStatus(task, 'in_progress');
  auditLog(`START ${taskId}`);
  console.log(col(c.yellow, `▶  ${taskId} set to in_progress`));
}

function cmdReview(taskId) {
  if (!taskId) { console.error('Usage: node orchestrate.js review <TASK_ID>'); process.exit(1); }
  const { byId } = loadAllTasks();
  const task = byId.get(taskId);
  if (!task) { console.error(col(c.red, `✗  Task not found: ${taskId}`)); process.exit(1); }
  setTaskStatus(task, 'in_review');
  auditLog(`REVIEW ${taskId}`);
  console.log(col(c.yellow, `⏳  ${taskId} set to in_review`));
}

function cmdDone(taskId) {
  if (!taskId) { console.error('Usage: node orchestrate.js done <TASK_ID>'); process.exit(1); }
  const { tasks, byId } = loadAllTasks();
  const task = byId.get(taskId);
  if (!task) { console.error(col(c.red, `✗  Task not found: ${taskId}`)); process.exit(1); }
  setTaskStatus(task, 'done');
  auditLog(`DONE ${taskId}`);
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
}

// ─── CLI entry point ──────────────────────────────────────────────────────────

const [,, command, ...args] = process.argv;

switch (command) {
  case 'status':               cmdStatus();                    break;
  case 'next':                 cmdNext();                      break;
  case 'prompt':               cmdPrompt(args[0]);             break;
  case 'start':                cmdStart(args[0]);              break;
  case 'review':               cmdReview(args[0]);             break;
  case 'done':                 cmdDone(args[0]);               break;
  case 'gate':                 cmdGate(args[0]);               break;
  case 'blocked':              cmdBlocked(args[0], args[1]);   break;
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
`);
}
