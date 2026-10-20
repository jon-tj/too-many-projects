#!/usr/bin/env node
// TooManyProjects command-line tool: projects, tasks and time tracking from the terminal.
// One file, no dependencies; needs Node.js 18 or newer. Instructions: https://toomanyprojects.fyi/cli

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const VERSION = '1.0.0';
const DEFAULT_URL = 'https://toomanyprojects.fyi';
const CONFIG_DIR = process.env.APPDATA
  ? join(process.env.APPDATA, 'TooManyProjects')
  : join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'toomanyprojects');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');

const HELP = `TooManyProjects CLI ${VERSION}

Usage: tmp <command> [options]

Account
  login <token> [--url URL]   Save a personal access token (Settings → API tokens)
  logout                      Forget the saved token
  whoami                      Show who the token signs in as

Projects
  projects                    List your projects

Tasks
  tasks [project]             Your tasks: what you are doing, then what you could pick up.
                              With a project: all its tasks, newest first
      --status todo|doing|done  Only tasks with this status
  task <id>                   Show one task
  add <project> <title>       Create a task
      -d, --description TEXT    -p, --priority low|high|critical
      -a, --assign me|USER      --due YYYY-MM-DD
  start <id>                  Move a task to doing (unassigned tasks become yours)
  done <id>                   Move a task to done
  move <id> todo|doing|done   Move a task to any column
  assign <id> me|USER|none    Assign a task to someone in its project, or no one

Time tracking
  work start <project>        Start working (opens a work session)
  work stop <project>         Stop working
      --mood 0-10  --resistance 0-10  -m, --message TEXT
  work status                 Show where you are working right now
  hours [project]             Your work sessions, last 7 days by default
      --days N
  hours add <project> <start> <end>   Log time worked away from the app
      Times as "YYYY-MM-DD HH:MM" (local) or ISO 8601; same options as work stop

A project is its id or its name (any unique part of it, ignoring case).
Add --json to any command to print the raw JSON, e.g. for scripts and AI agents.
Environment: TMP_TOKEN and TMP_URL override the saved token and server.`;

// ── Arguments ────────────────────────────────────────────────────────────────

const ALIASES = { d: 'description', p: 'priority', a: 'assign', m: 'message', h: 'help' };
const FLAGS = new Set(['json', 'help', 'version']);

function parseArgs(argv) {
  const positional = [];
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const match = /^--?([a-z-]+)(?:=(.*))?$/i.exec(arg);
    if (!match || /^-\d/.test(arg)) {
      positional.push(arg);
      continue;
    }
    const name = ALIASES[match[1]] ?? match[1];
    if (FLAGS.has(name)) options[name] = true;
    else if (match[2] !== undefined) options[name] = match[2];
    else if (i + 1 < argv.length) options[name] = argv[++i];
    else fail(`--${name} needs a value.`);
  }
  return { positional, options };
}

// ── Config and HTTP ──────────────────────────────────────────────────────────

function readConfig() {
  try {
    return JSON.parse(readFileSync(CONFIG_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function settings() {
  const config = readConfig();
  const token = process.env.TMP_TOKEN || config.token;
  const url = (process.env.TMP_URL || config.url || DEFAULT_URL).replace(/\/+$/, '');
  if (!token) fail('Not signed in. Make a token in Settings → API tokens, then run: tmp login <token>');
  return { token, url };
}

async function api(method, path, body, { token, url } = settings()) {
  let response;
  try {
    response = await fetch(url + path, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    fail(`Could not reach ${url}: ${error.cause?.message ?? error.message}`);
  }
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (response.ok) return data;
  if (response.status === 401) fail('The token was not accepted: it may have been revoked. Run tmp login <token> with a new one.');
  if (response.status === 404) fail('Not found, or you are not a member of that project.');
  const message = data?.error ?? data?.title ?? (data?.errors ? Object.values(data.errors).flat().join(' ') : text);
  fail(message || `The server answered ${response.status}.`);
}

// ── Output ───────────────────────────────────────────────────────────────────

let json = false;

function fail(message) {
  console.error(`tmp: ${message}`);
  process.exit(1);
}

function print(data, human) {
  if (json) console.log(JSON.stringify(data, null, 2));
  else human(data);
}

/** Prints rows as aligned columns; the last column is not padded. */
function table(rows) {
  if (!rows.length) return;
  const widths = rows[0].map((_, column) => Math.max(...rows.map(row => String(row[column] ?? '').length)));
  for (const row of rows)
    console.log(row.map((cell, column) => column === row.length - 1 ? String(cell ?? '') : String(cell ?? '').padEnd(widths[column])).join('  ').trimEnd());
}

const date = value => value ? new Date(value).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '';
const time = value => new Date(value).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const hours = ms => `${Math.floor(ms / 3_600_000)}h ${String(Math.round((ms % 3_600_000) / 60_000)).padStart(2, '0')}m`;
const short = (text, length) => text.length > length ? text.slice(0, length - 1) + '…' : text;

// ── Lookups ──────────────────────────────────────────────────────────────────

async function findProject(reference) {
  if (!reference) fail('Name a project: its id or part of its name. See tmp projects.');
  const projects = await api('GET', '/api/projects');
  if (/^\d+$/.test(reference)) {
    const project = projects.find(entry => entry.id === Number(reference));
    if (project) return project;
  }
  const wanted = reference.toLowerCase();
  const exact = projects.filter(entry => entry.name.toLowerCase() === wanted);
  const matches = exact.length ? exact : projects.filter(entry => entry.name.toLowerCase().includes(wanted));
  if (matches.length === 1) return matches[0];
  if (!matches.length) fail(`No project matches "${reference}". See tmp projects.`);
  fail(`"${reference}" matches several projects: ${matches.map(entry => `${entry.name} (${entry.id})`).join(', ')}.`);
}

/** A project member by "me", username or display name; null for "none". */
async function findMember(projectId, reference) {
  if (reference === 'none') return null;
  const members = await api('GET', `/api/projects/${projectId}/members`);
  if (reference === 'me') return (await api('GET', '/api/account/me')).id;
  const wanted = reference.toLowerCase();
  const matches = members.filter(member =>
    member.userName.toLowerCase() === wanted || member.displayName.toLowerCase() === wanted);
  const loose = matches.length ? matches : members.filter(member => member.displayName.toLowerCase().includes(wanted));
  if (loose.length === 1) return loose[0].userId;
  if (!loose.length) fail(`No member of the project matches "${reference}".`);
  fail(`"${reference}" matches several members: ${loose.map(member => member.userName).join(', ')}.`);
}

function taskId(value) {
  if (!/^#?\d+$/.test(value ?? '')) fail('Give a task id, e.g. tmp task 42.');
  return Number(value.replace('#', ''));
}

function score(value, name) {
  if (value === undefined) return undefined;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0 || number > 10) fail(`--${name} must be a whole number from 0 to 10.`);
  return number;
}

function parseTime(value, name) {
  if (!value) fail(`Give the ${name} time, e.g. "2026-10-20 09:30".`);
  const local = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2}))?$/.exec(value);
  const parsed = local
    ? new Date(+local[1], +local[2] - 1, +local[3], +(local[4] ?? 0), +(local[5] ?? 0))
    : new Date(value);
  if (Number.isNaN(parsed.getTime())) fail(`Could not read the ${name} time "${value}".`);
  return parsed.toISOString();
}

function printTasks(tasks, showProject) {
  table([
    ['ID', 'STATUS', 'PRIORITY', ...(showProject ? ['PROJECT'] : []), 'DUE', 'TITLE'],
    ...tasks.map(task => [
      task.id, task.blocked && task.status === 'todo' ? 'blocked' : task.status, task.priority,
      ...(showProject ? [short(task.projectName, 24)] : []), date(task.dueAt), short(task.title, 70),
    ]),
  ]);
  if (!tasks.length) console.log('No tasks.');
}

// ── Commands ─────────────────────────────────────────────────────────────────

const commands = {
  async login([token], options) {
    if (!token) fail('Give the token, e.g. tmp login tmp_…  Make one in Settings → API tokens.');
    if (!token.startsWith('tmp_')) fail('That does not look like a TooManyProjects token: they start with tmp_.');
    const url = (options.url || process.env.TMP_URL || readConfig().url || DEFAULT_URL).replace(/\/+$/, '');
    const me = await api('GET', '/api/account/me', undefined, { token, url });
    mkdirSync(CONFIG_DIR, { recursive: true });
    writeFileSync(CONFIG_FILE, JSON.stringify({ url, token }, null, 2), { mode: 0o600 });
    console.log(`Signed in as ${me.displayName || me.userName} (${url}). Token saved in ${CONFIG_FILE}`);
  },

  async logout() {
    if (existsSync(CONFIG_FILE)) rmSync(CONFIG_FILE);
    console.log('Token forgotten. Revoke it in Settings → API tokens if it should stop working everywhere.');
  },

  async whoami() {
    const me = await api('GET', '/api/account/me');
    print(me, () => console.log(`${me.displayName || me.userName} (${me.userName}, ${me.email}) on ${settings().url}`));
  },

  async projects() {
    const projects = await api('GET', '/api/projects');
    print(projects, () => {
      table([
        ['ID', 'OPEN TASKS', 'ROLE', 'NAME'],
        ...projects.map(project => [project.id, project.taskCount, project.myRole, project.name + (project.frozen ? ' (frozen)' : '')]),
      ]);
      if (!projects.length) console.log('No projects yet.');
    });
  },

  async tasks([reference], options) {
    const project = reference ? await findProject(reference) : null;
    let tasks = await api('GET', project ? `/api/tasks/by-project/${project.id}` : '/api/tasks');
    if (options.status) tasks = tasks.filter(task => task.status === options.status);
    print(tasks, () => printTasks(tasks, !project));
  },

  async task([id]) {
    const task = await api('GET', `/api/tasks/${taskId(id)}`);
    print(task, () => {
      console.log(`#${task.id} ${task.title}`);
      console.log(`${task.projectName} · ${task.blocked && task.status === 'todo' ? 'blocked' : task.status} · ${task.priority} priority`
        + (task.dueAt ? ` · due ${date(task.dueAt)}` : '')
        + (task.units ? ` · ${task.unitsDone}/${task.units} units` : ''));
      if (task.dependsOn?.length) console.log(`Depends on ${task.dependsOn.map(other => `#${other}`).join(', ')}`);
      if (task.description) console.log(`\n${task.description}`);
    });
  },

  async add([reference, ...words], options) {
    const project = await findProject(reference);
    const title = words.join(' ').trim();
    if (!title) fail('Give the task a title, e.g. tmp add website "Fix the footer".');
    if (options.priority && !['low', 'high', 'critical'].includes(options.priority)) fail('--priority must be low, high or critical.');
    const task = await api('POST', `/api/tasks/by-project/${project.id}`, {
      title,
      description: options.description,
      priority: options.priority ?? 'low',
      assigneeUserId: options.assign ? await findMember(project.id, options.assign) : null,
      dueAt: options.due ? parseTime(options.due, 'due') : null,
    });
    print(task, () => console.log(`Created #${task.id} in ${project.name}: ${task.title}`));
  },

  async move([id, status]) {
    if (!['todo', 'doing', 'done'].includes(status)) fail('Move to todo, doing or done.');
    await api('PATCH', `/api/tasks/${taskId(id)}/status`, { status });
    const task = await api('GET', `/api/tasks/${taskId(id)}`);
    print(task, () => console.log(`#${task.id} is now ${task.status}: ${task.title}`));
  },

  start: ([id]) => commands.move([id, 'doing']),
  done: ([id]) => commands.move([id, 'done']),

  async assign([id, who]) {
    if (!who) fail('Assign to me, a username or name, or none.');
    const task = await api('GET', `/api/tasks/${taskId(id)}`);
    const assigneeUserId = await findMember(task.projectId, who);
    await api('PATCH', `/api/tasks/by-project/${task.projectId}/assignee`, { taskIds: [task.id], assigneeUserId });
    print({ ...task, assigneeUserId }, () =>
      console.log(assigneeUserId ? `Assigned #${task.id} to ${who}.` : `#${task.id} is now unassigned.`));
  },

  async work([action, reference], options) {
    if (action === 'status') {
      const sessions = await api('GET', `/api/work-sessions?from=${encodeURIComponent(new Date().toISOString())}`);
      const running = sessions.filter(session => !session.endedAt);
      print(running, () => {
        for (const session of running)
          console.log(`Working on ${session.projectName} since ${time(session.startedAt)} (${hours(Date.now() - new Date(session.startedAt))}).`);
        if (!running.length) console.log('Not working on anything.');
      });
      return;
    }
    if (action !== 'start' && action !== 'stop') fail('Use tmp work start <project>, tmp work stop <project> or tmp work status.');
    const project = await findProject(reference);
    const working = action === 'start';
    await api('PUT', `/api/projects/${project.id}/work`, working
      ? { working }
      : { working, mood: score(options.mood, 'mood'), resistance: score(options.resistance, 'resistance'), message: options.message });
    print({ projectId: project.id, working }, () =>
      console.log(working ? `Working on ${project.name}.` : `Stopped working on ${project.name}.`));
  },

  async hours([first, ...rest], options) {
    if (first === 'add') {
      const [reference, start, end] = rest;
      const project = await findProject(reference);
      const session = await api('POST', `/api/work-sessions/by-project/${project.id}`, {
        startedAt: parseTime(start, 'start'),
        endedAt: parseTime(end, 'end'),
        mood: score(options.mood, 'mood'),
        resistance: score(options.resistance, 'resistance'),
        message: options.message,
      });
      print(session, () => console.log(
        `Logged ${hours(new Date(session.endedAt) - new Date(session.startedAt))} on ${project.name}.`));
      return;
    }
    const days = Number(options.days ?? 7);
    if (!(days > 0)) fail('--days must be a positive number.');
    const project = first ? await findProject(first) : null;
    const from = new Date(Date.now() - days * 86_400_000).toISOString();
    const sessions = await api('GET', `/api/work-sessions?from=${encodeURIComponent(from)}${project ? `&projectId=${project.id}` : ''}`);
    print(sessions, () => {
      const length = session => (session.endedAt ? new Date(session.endedAt) : new Date()) - new Date(session.startedAt);
      table([
        ['STARTED', 'LENGTH', ...(project ? [] : ['PROJECT']), 'NOTE'],
        ...sessions.map(session => [
          time(session.startedAt), session.endedAt ? hours(length(session)) : `${hours(length(session))} (running)`,
          ...(project ? [] : [short(session.projectName, 24)]), short(session.message ?? '', 60),
        ]),
      ]);
      const total = sessions.reduce((sum, session) => sum + length(session), 0);
      console.log(sessions.length ? `\nTotal ${hours(total)} in the last ${days} days.` : `No work logged in the last ${days} days.`);
    });
  },
};

// ── Main ─────────────────────────────────────────────────────────────────────

const { positional, options } = parseArgs(process.argv.slice(2));
json = Boolean(options.json);
const [name, ...args] = positional;
if (options.version) console.log(VERSION);
else if (!name || options.help || name === 'help') console.log(HELP);
else if (!Object.hasOwn(commands, name)) fail(`Unknown command "${name}". Run tmp help to see them all.`);
else await commands[name](args, options);
