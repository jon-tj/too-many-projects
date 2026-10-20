import { Component, computed, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Icon } from '../../components/icon/icon';

/** Where the CLI goes when no --url is given; on any other host the page tells people to pass it. */
const PRODUCTION = 'https://toomanyprojects.fyi';

const COMMANDS = [
  { group: 'Projects', rows: [['tmp projects', 'List your projects, with their ids']] },
  {
    group: 'Tasks',
    rows: [
      ['tmp tasks', 'What you are doing, then what you could pick up next'],
      ['tmp tasks website --status todo', "A project's tasks, optionally only one column"],
      ['tmp task 42', 'One task, with its description and dependencies'],
      ['tmp add website "Fix the footer" -p high --assign me --due 2026-11-01', 'Create a task'],
      ['tmp start 42 / tmp done 42', 'Move a task to doing or done'],
      ['tmp move 42 todo', 'Move a task to any column'],
      ['tmp assign 42 mia', 'Assign to a member by username or name; also me or none'],
    ],
  },
  {
    group: 'Time tracking',
    rows: [
      ['tmp work start website', 'Start working on a project'],
      ['tmp work stop website --mood 8 --resistance 2 -m "Shipped it"', 'Stop, with how it went (all optional)'],
      ['tmp work status', 'Where you are working right now'],
      ['tmp hours --days 30', 'Your sessions and total hours, in every project or one'],
      ['tmp hours add website "2026-10-19 09:00" "2026-10-19 11:30"', 'Log time worked away from the app'],
    ],
  },
];

/**
 * The public guide to the command-line tool: getting a token, installing the one-file CLI hosted next to this page
 * (public/cli/tmp.mjs), the commands, and how to let AI coding agents use it.
 */
@Component({
  selector: 'app-cli-page',
  imports: [RouterLink, Icon],
  templateUrl: './cli-page.html',
  styleUrl: './cli-page.css',
})
export class CliPage {
  protected readonly COMMANDS = COMMANDS;
  protected readonly year = new Date().getFullYear();
  protected readonly origin = location.origin;
  protected readonly os = signal<'unix' | 'windows'>(navigator.userAgent.includes('Windows') ? 'windows' : 'unix');
  /** Which code block was just copied, to show a tick on its button. */
  protected readonly copied = signal('');

  protected readonly install = computed(() =>
    this.os() === 'windows'
      ? [
          `$dir = "$env:LOCALAPPDATA\\TooManyProjects"; New-Item -ItemType Directory -Force $dir | Out-Null`,
          `Invoke-WebRequest ${this.origin}/cli/tmp.mjs -OutFile "$dir\\tmp.mjs"`,
          `Set-Content "$dir\\tmp.cmd" '@node "%~dp0tmp.mjs" %*'`,
          `$path = [Environment]::GetEnvironmentVariable('Path', 'User')`,
          `if ($path -notlike "*$dir*") { [Environment]::SetEnvironmentVariable('Path', "$path;$dir", 'User') }`,
        ].join('\n')
      : `mkdir -p ~/.local/bin && curl -fsSL ${this.origin}/cli/tmp.mjs -o ~/.local/bin/tmp && chmod +x ~/.local/bin/tmp`,
  );
  protected readonly login =
    'tmp login tmp_your_token_here' + (this.origin === PRODUCTION ? '' : ` --url ${this.origin}`);
  protected readonly agentNote = [
    '## Tasks and time tracking',
    'This project is managed in TooManyProjects. Use the `tmp` command-line tool (already signed in):',
    '- `tmp tasks <project> --json` lists tasks; `tmp task <id> --json` shows one, with its description.',
    '- `tmp start <id>` when you begin a task and `tmp done <id>` when it is finished.',
    '- `tmp add <project> "<title>" -d "<details>"` for follow-up work you find but do not do now.',
    'Run `tmp help` for all commands.',
  ].join('\n');

  protected copy(key: string, text: string): void {
    void navigator.clipboard.writeText(text).then(() => {
      this.copied.set(key);
      setTimeout(() => this.copied.update(current => (current === key ? '' : current)), 2000);
    });
  }
}
