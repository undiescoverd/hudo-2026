#!/usr/bin/env node
/**
 * linear-import.mjs
 * One-time script to import tasks/sprints-all.md into Linear.
 *
 * Usage:
 *   node scripts/linear-import.mjs --dry-run   # Preview only
 *   node scripts/linear-import.mjs             # Full import
 *
 * Reads LINEAR_API_KEY and LINEAR_TEAM_KEY from .env.baserow
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DRY_RUN = process.argv.includes('--dry-run');

// ─── Config ──────────────────────────────────────────────────────────────────

function loadEnv() {
  const envPath = resolve(ROOT, '.env.baserow');
  const lines = readFileSync(envPath, 'utf8').split('\n');
  const env = {};
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    env[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim();
  }
  return env;
}

const ENV = loadEnv();
const API_KEY = ENV.LINEAR_API_KEY;
const TEAM_KEY = ENV.LINEAR_TEAM_KEY;

if (!API_KEY) {
  console.error('ERROR: LINEAR_API_KEY not found in .env.baserow');
  process.exit(1);
}
if (!TEAM_KEY) {
  console.error('ERROR: LINEAR_TEAM_KEY not found in .env.baserow');
  process.exit(1);
}

// ─── Linear GraphQL client ────────────────────────────────────────────────────

async function gql(query, variables = {}) {
  const res = await fetch('https://api.linear.app/graphql', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: API_KEY,
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors) {
    throw new Error(`GraphQL error: ${JSON.stringify(json.errors, null, 2)}`);
  }
  return json.data;
}

// ─── Parser ───────────────────────────────────────────────────────────────────

function parseSprints(markdown) {
  const sprints = [];
  let currentSprint = null;
  let currentCategory = null;
  let currentTask = null;

  const lines = markdown.split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Sprint heading: ## Sprint N — Title
    const sprintMatch = line.match(/^## (Sprint \d+ — .+)/);
    if (sprintMatch) {
      if (currentTask) currentCategory.tasks.push(currentTask);
      if (currentCategory) currentSprint.categories.push(currentCategory);
      currentTask = null;
      currentCategory = null;
      currentSprint = {
        title: sprintMatch[1],
        goal: '',
        categories: [],
      };
      sprints.push(currentSprint);
      i++;
      continue;
    }

    // Sprint goal
    if (currentSprint && line.startsWith('**Goal:**')) {
      currentSprint.goal = line.replace('**Goal:**', '').trim();
      i++;
      continue;
    }

    // Category heading: ### CATEGORY (N tasks)
    const catMatch = line.match(/^### ([A-Z0-9-]+)/);
    if (catMatch && currentSprint) {
      if (currentTask) {
        currentCategory.tasks.push(currentTask);
        currentTask = null;
      }
      if (currentCategory) currentSprint.categories.push(currentCategory);
      currentCategory = {
        name: catMatch[1].toLowerCase(),
        tasks: [],
      };
      i++;
      continue;
    }

    // Task heading: #### S0-INFRA-001 — Title (middle segment may contain digits e.g. E2E)
    const taskMatch = line.match(/^#### (S\d+-[A-Z0-9]+-\d+) — (.+)/);
    if (taskMatch && currentCategory) {
      if (currentTask) currentCategory.tasks.push(currentTask);
      currentTask = {
        id: taskMatch[1],
        title: `${taskMatch[1]} — ${taskMatch[2].replace(/⭐.*/, '').trim()}`,
        size: 'M',
        status: 'not_started',
        blockedBy: [],
        subtasks: [],
        descriptionLines: [],
      };
      i++;
      continue;
    }

    // Metadata line: **Size:** M | **Status:** done | **Blocked by:** S0-X-001
    if (currentTask && line.startsWith('**Size:**')) {
      const sizeMatch = line.match(/\*\*Size:\*\*\s*(\w+)/);
      const statusMatch = line.match(/\*\*Status:\*\*\s*(\w+)/);
      const blockedMatch = line.match(/\*\*Blocked by:\*\*\s*([^|]+)/);

      if (sizeMatch) currentTask.size = sizeMatch[1];
      if (statusMatch) currentTask.status = statusMatch[1];
      if (blockedMatch) {
        const raw = blockedMatch[1].trim();
        if (raw.toLowerCase() !== 'none') {
          currentTask.blockedBy = raw.split(',').map((s) => s.trim()).filter(Boolean);
        }
      }
      i++;
      continue;
    }

    // Subtask checkbox: - [ ] or - [x]
    if (currentTask && line.match(/^- \[[ x]\] /)) {
      const text = line.replace(/^- \[[ x]\] /, '').trim();
      currentTask.subtasks.push(text);
      i++;
      continue;
    }

    // Horizontal rule (task separator) — don't add to description
    if (line === '---') {
      i++;
      continue;
    }

    // Anything else inside a task = description
    if (currentTask && line !== '') {
      currentTask.descriptionLines.push(line);
    }

    i++;
  }

  // Flush last task/category/sprint
  if (currentTask) currentCategory.tasks.push(currentTask);
  if (currentCategory) currentSprint.categories.push(currentCategory);

  return sprints;
}

// ─── Linear helpers ───────────────────────────────────────────────────────────

async function getTeamId() {
  const data = await gql(`query { teams { nodes { id key name } } }`);
  const team = data.teams.nodes.find((t) => t.key === TEAM_KEY);
  if (!team) {
    const keys = data.teams.nodes.map((t) => t.key).join(', ');
    throw new Error(`Team "${TEAM_KEY}" not found. Available: ${keys}`);
  }
  return team.id;
}

async function getWorkflowStates(teamId) {
  const data = await gql(
    `query($teamId: ID!) {
      workflowStates(filter: { team: { id: { eq: $teamId } } }) {
        nodes { id name type }
      }
    }`,
    { teamId }
  );
  return data.workflowStates.nodes;
}

async function getLabels(teamId) {
  const data = await gql(
    `query($teamId: ID!) {
      issueLabels(filter: { team: { id: { eq: $teamId } } }) {
        nodes { id name }
      }
    }`,
    { teamId }
  );
  return data.issueLabels.nodes;
}

async function createLabel(teamId, name, color) {
  const data = await gql(
    `mutation($teamId: String!, $name: String!, $color: String!) {
      issueLabelCreate(input: { teamId: $teamId, name: $name, color: $color }) {
        issueLabel { id name }
      }
    }`,
    { teamId, name, color }
  );
  return data.issueLabelCreate.issueLabel;
}

async function getOrCreateLabel(teamId, existingLabels, name, color = '#6B7280') {
  const existing = existingLabels.find((l) => l.name.toLowerCase() === name.toLowerCase());
  if (existing) return existing;
  const label = await createLabel(teamId, name, color);
  existingLabels.push(label);
  return label;
}

async function getProjects() {
  const data = await gql(
    `query {
      projects(first: 50) {
        nodes { id name }
      }
    }`
  );
  return data.projects.nodes;
}

async function createProject(teamId, name, description) {
  const data = await gql(
    `mutation($teamId: String!, $name: String!, $description: String) {
      projectCreate(input: { teamIds: [$teamId], name: $name, description: $description }) {
        project { id name }
      }
    }`,
    { teamId, name, description }
  );
  return data.projectCreate.project;
}

async function createIssue(input) {
  const data = await gql(
    `mutation($input: IssueCreateInput!) {
      issueCreate(input: $input) {
        issue { id identifier title }
      }
    }`,
    { input }
  );
  return data.issueCreate.issue;
}

async function getIssuesByTitle(teamId) {
  // Fetch all issues in the team — used for idempotency check
  const data = await gql(
    `query($teamId: ID!) {
      issues(filter: { team: { id: { eq: $teamId } } }, first: 250) {
        nodes { id identifier title }
      }
    }`,
    { teamId }
  );
  return data.issues.nodes;
}

async function createRelation(issueId, relatedIssueId, type = 'blocks') {
  await gql(
    `mutation($issueId: String!, $relatedIssueId: String!, $type: IssueRelationType!) {
      issueRelationCreate(input: { issueId: $issueId, relatedIssueId: $relatedIssueId, type: $type }) {
        issueRelation { id }
      }
    }`,
    { issueId, relatedIssueId, type }
  );
}

// ─── Status mapping ───────────────────────────────────────────────────────────

const STATUS_MAP = {
  done: 'Done',
  in_progress: 'In Progress',
  in_review: 'In Review',
  not_started: 'Todo',
};

const CATEGORY_COLORS = {
  infra: '#3B82F6',
  db: '#8B5CF6',
  auth: '#10B981',
  storage: '#F59E0B',
  e2e: '#EF4444',
  upload: '#06B6D4',
  player: '#EC4899',
  comments: '#84CC16',
  versioning: '#F97316',
  dashboards: '#6366F1',
  'plan gating': '#14B8A6',
  notifications: '#A855F7',
  'guest links': '#F43F5E',
  billing: '#22C55E',
  compliance: '#0EA5E9',
  'security hardening': '#DC2626',
  accessibility: '#7C3AED',
  pwa: '#0891B2',
  'launch readiness': '#065F46',
};

const SIZE_ESTIMATE = { XS: 1, S: 2, M: 3, L: 5, XL: 8 };

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n🚀 Linear Import ${DRY_RUN ? '[DRY RUN]' : '[LIVE]'}\n`);

  // Parse markdown
  const mdPath = resolve(ROOT, 'tasks/sprints-all.md');
  const markdown = readFileSync(mdPath, 'utf8');
  const sprints = parseSprints(markdown);

  const totalTasks = sprints.flatMap((s) => s.categories.flatMap((c) => c.tasks)).length;
  console.log(`Parsed ${sprints.length} sprints, ${totalTasks} tasks`);
  for (const sprint of sprints) {
    const count = sprint.categories.flatMap((c) => c.tasks).length;
    console.log(`  ${sprint.title}: ${count} tasks`);
  }

  if (DRY_RUN) {
    console.log('\n✅ Dry run complete — no changes made to Linear.\n');
    return;
  }

  // Get team
  console.log(`\nLooking up team "${TEAM_KEY}"…`);
  const teamId = await getTeamId();
  console.log(`  Team ID: ${teamId}`);

  // Get workflow states
  const states = await getWorkflowStates(teamId);
  const stateMap = {};
  for (const state of states) {
    // Map by name (case-insensitive)
    stateMap[state.name.toLowerCase()] = state.id;
  }
  console.log(`  Workflow states: ${states.map((s) => s.name).join(', ')}`);

  function resolveStateId(taskStatus) {
    const target = STATUS_MAP[taskStatus] || 'Todo';
    const id = stateMap[target.toLowerCase()];
    if (!id) {
      // Fallback: find Todo or first state
      return stateMap['todo'] || stateMap['backlog'] || states[0]?.id;
    }
    return id;
  }

  // Get / create labels
  console.log('\nLoading labels…');
  const existingLabels = await getLabels(teamId);

  // Load existing issues for idempotency
  console.log('Loading existing issues…');
  const existingIssues = await getIssuesByTitle(teamId);
  const existingByTitle = new Map(existingIssues.map((i) => [i.title, i]));
  console.log(`  Found ${existingIssues.length} existing issues`);

  // Map: task ID → Linear issue ID
  const idMap = {};
  const ID_MAP_PATH = resolve(ROOT, 'scripts/linear-id-map.json');
  if (existsSync(ID_MAP_PATH)) {
    Object.assign(idMap, JSON.parse(readFileSync(ID_MAP_PATH, 'utf8')));
    console.log(`  Loaded ${Object.keys(idMap).length} IDs from existing id-map`);
  }

  // Get existing projects for idempotency
  console.log('\nLoading existing projects…');
  const existingProjects = await getProjects();
  const projectByName = new Map(existingProjects.map((p) => [p.name, p]));

  // ── Create projects (one per sprint) ──────────────────────────────────────

  console.log('\nCreating projects…');
  const projectMap = {}; // sprint title → project ID

  for (const sprint of sprints) {
    const name = sprint.title;
    if (projectByName.has(name)) {
      console.log(`  ✓ Exists: ${name}`);
      projectMap[name] = projectByName.get(name).id;
    } else {
      console.log(`  + Creating: ${name}`);
      const project = await createProject(teamId, name, sprint.goal);
      projectMap[name] = project.id;
      console.log(`    → ${project.id}`);
    }
  }

  // ── Create top-level issues ────────────────────────────────────────────────

  console.log('\nCreating issues…');
  let created = 0;
  let skipped = 0;

  for (const sprint of sprints) {
    console.log(`\n  ${sprint.title}`);
    const projectId = projectMap[sprint.title];

    for (const category of sprint.categories) {
      const label = await getOrCreateLabel(
        teamId,
        existingLabels,
        category.name,
        CATEGORY_COLORS[category.name] || '#6B7280'
      );

      for (const task of category.tasks) {
        if (existingByTitle.has(task.title) || idMap[task.id]) {
          const existingId = idMap[task.id] || existingByTitle.get(task.title)?.id;
          idMap[task.id] = existingId;
          console.log(`    ✓ ${task.id} (exists)`);
          skipped++;
          continue;
        }

        const description = task.descriptionLines.join('\n').trim();
        const stateId = resolveStateId(task.status);
        const estimate = SIZE_ESTIMATE[task.size] ?? 3;

        const sizeLabel = await getOrCreateLabel(
          teamId,
          existingLabels,
          `size:${task.size}`,
          '#9CA3AF'
        );

        const issue = await createIssue({
          teamId,
          projectId,
          title: task.title,
          description,
          stateId,
          labelIds: [label.id, sizeLabel.id],
          estimate,
        });

        idMap[task.id] = issue.id;
        existingByTitle.set(task.title, issue);
        console.log(`    + ${task.id} → ${issue.identifier}`);
        created++;
      }
    }
  }

  // ── Create sub-issues ──────────────────────────────────────────────────────

  console.log('\nCreating sub-issues…');
  let subCreated = 0;

  for (const sprint of sprints) {
    for (const category of sprint.categories) {
      for (const task of category.tasks) {
        if (!task.subtasks.length) continue;
        const parentId = idMap[task.id];
        if (!parentId) continue;

        for (const subtaskText of task.subtasks) {
          const subTitle = `[${task.id}] ${subtaskText.slice(0, 120)}`;

          if (existingByTitle.has(subTitle)) {
            console.log(`    ✓ Sub exists: ${subTitle.slice(0, 60)}…`);
            continue;
          }

          const stateId = resolveStateId(task.status === 'done' ? 'done' : 'not_started');

          const issue = await createIssue({
            teamId,
            parentId,
            title: subTitle,
            stateId,
          });

          existingByTitle.set(subTitle, issue);
          console.log(`    + Sub: ${issue.identifier} (parent: ${task.id})`);
          subCreated++;
        }
      }
    }
  }

  // ── Apply blocking relationships ───────────────────────────────────────────

  console.log('\nApplying blocking relationships…');
  let relationsCreated = 0;

  for (const sprint of sprints) {
    for (const category of sprint.categories) {
      for (const task of category.tasks) {
        if (!task.blockedBy.length) continue;
        const blockedIssueId = idMap[task.id];
        if (!blockedIssueId) continue;

        for (const blockerId of task.blockedBy) {
          const blockerLinearId = idMap[blockerId];
          if (!blockerLinearId) {
            console.log(`    ⚠ Blocker ${blockerId} not found in idMap — skipping`);
            continue;
          }
          try {
            // blockerLinearId blocks blockedIssueId
            await createRelation(blockerLinearId, blockedIssueId, 'blocks');
            console.log(`    + ${blockerId} blocks ${task.id}`);
            relationsCreated++;
          } catch (err) {
            // Relations may already exist; warn and continue
            console.log(`    ⚠ Relation ${blockerId}→${task.id}: ${err.message}`);
          }
        }
      }
    }
  }

  // ── Save ID map ────────────────────────────────────────────────────────────

  writeFileSync(ID_MAP_PATH, JSON.stringify(idMap, null, 2));
  console.log(`\nID map saved to scripts/linear-id-map.json (${Object.keys(idMap).length} entries)`);

  // ── Summary ────────────────────────────────────────────────────────────────

  console.log(`
✅ Import complete
   Issues created:      ${created}
   Issues skipped:      ${skipped} (already existed)
   Sub-issues created:  ${subCreated}
   Relations created:   ${relationsCreated}
`);
}

main().catch((err) => {
  console.error('\n❌ Fatal error:', err.message);
  process.exit(1);
});
