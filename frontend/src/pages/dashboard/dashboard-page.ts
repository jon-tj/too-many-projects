import { Component, OnInit, computed, effect, inject, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { OVERVIEW_RANGES } from '../../components/overview-charts/time-axis';
import { VelocityChart } from '../../components/overview-charts/velocity-chart';
import { PlanPicker } from '../../components/plan-picker/plan-picker';
import { WorkLog } from '../../components/work-log/work-log';
import { WorkspaceShell } from '../../components/workspace-shell/workspace-shell';
import { CombinedOverview, OverviewRange, ProjectTask } from '../../services/models';
import { WorkspaceApi } from '../../services/workspace-api';

@Component({
  selector: 'app-dashboard-page',
  imports: [RouterLink, WorkLog, PlanPicker, VelocityChart],
  templateUrl: './dashboard-page.html',
  styleUrl: './dashboard-page.css',
})
export class DashboardPage implements OnInit {
  protected readonly tasks = signal<ProjectTask[]>([]);
  protected readonly loading = signal(true);
  protected readonly previewCount = 5;
  protected readonly showAllTasks = signal(false);
  protected readonly visibleTasks = computed(() =>
    this.showAllTasks() ? this.tasks() : this.tasks().slice(0, this.previewCount),
  );

  protected readonly ranges = OVERVIEW_RANGES;
  protected readonly range = signal<OverviewRange>('30d');
  /** Tasks done and hours worked across all your projects, as on a project's overview. */
  protected readonly velocity = rxResource({
    params: () => this.range(),
    stream: ({ params }) => this.api.combinedOverview(params),
  });
  /** The last loaded data, kept on screen (dimmed) while a new range loads instead of flashing empty. */
  protected readonly shownVelocity = signal<CombinedOverview | null>(null);

  private readonly shell = inject(WorkspaceShell);
  protected readonly account = rxResource({ stream: () => this.api.currentAccount() });
  /** Whole days left in the trial, counting today; null when not on a running trial. */
  protected readonly trialDaysLeft = computed(() => {
    const account = this.account.value();
    if (account?.planType !== 'trial' || account.planLapsed || !account.planRenewDate) return null;
    return Math.max(1, Math.ceil((new Date(account.planRenewDate).getTime() - Date.now()) / 86_400_000));
  });

  constructor(private readonly api: WorkspaceApi) {
    effect(() => {
      const value = this.velocity.value();
      if (value) this.shownVelocity.set(value);
    });
  }

  ngOnInit(): void {
    this.loadTasks();
  }

  /** A new plan can unfreeze projects, so the sidebar, the account and the tasks are all loaded again. */
  protected planChanged(): void {
    this.account.reload();
    this.velocity.reload();
    this.shell.refreshProjects();
    this.loadTasks();
  }

  private loadTasks(): void {
    this.api.dashboardTasks().subscribe({
      next: (tasks) => { this.tasks.set(tasks); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
  }
}