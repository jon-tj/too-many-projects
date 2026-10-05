import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { UpperCasePipe } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { LucideLayoutGrid, LucidePlus, LucideWorkflow } from '@lucide/angular';
import { Project, ProjectTask, TaskStatus } from './models';
import { WorkspaceApi } from './workspace-api';
import { ProjectCanvas } from './project-canvas';

@Component({
  selector: 'app-project-page',
  imports: [RouterLink, ReactiveFormsModule, UpperCasePipe, LucideLayoutGrid, LucidePlus, LucideWorkflow, ProjectCanvas],
  templateUrl: './project-page.html',
  styleUrl: './project-page.css',
})
export class ProjectPage implements OnInit {
  protected readonly project = signal<Project | null>(null);
  protected readonly tasks = signal<ProjectTask[]>([]);
  protected readonly activeView = signal<'board' | 'canvas'>('board');
  protected readonly addingTask = signal(false);
  protected readonly loading = signal(true);
  protected readonly taskError = signal('');
  private readonly formBuilder = inject(FormBuilder);
  protected readonly todoTasks = computed(() => this.tasks().filter((task) => task.status === 'todo'));
  protected readonly doingTasks = computed(() => this.tasks().filter((task) => task.status === 'doing'));
  protected readonly doneTasks = computed(() => this.tasks().filter((task) => task.status === 'done'));
  protected readonly form = this.formBuilder.nonNullable.group({
    title: ['', [Validators.required, Validators.maxLength(180)]],
    description: [''],
  });
  private projectId = 0;

  constructor(
    private readonly route: ActivatedRoute,
    private readonly api: WorkspaceApi,
  ) {}

  ngOnInit(): void {
    this.route.paramMap.subscribe((params) => {
      this.projectId = Number(params.get('id'));
      this.loadProject();
    });
    this.route.queryParamMap.subscribe((params) => {
      this.activeView.set(params.get('view') === 'canvas' ? 'canvas' : 'board');
    });
  }

  protected loadProject(): void {
    this.loading.set(true);
    this.api.project(this.projectId).subscribe({
      next: (project) => this.project.set(project),
      error: () => this.taskError.set('This project is unavailable or you are not a member.'),
    });
    this.api.projectTasks(this.projectId).subscribe({
      next: (tasks) => { this.tasks.set(tasks); this.loading.set(false); },
      error: () => { this.taskError.set('Could not load project tasks.'); this.loading.set(false); },
    });
  }

  protected createTask(): void {
    if (this.form.invalid) return;
    const { title, description } = this.form.getRawValue();
    this.api.createTask(this.projectId, title.trim(), description.trim()).subscribe({
      next: (task) => {
        this.tasks.update((tasks) => [task, ...tasks]);
        this.form.reset({ title: '', description: '' });
        this.addingTask.set(false);
        this.taskError.set('');
        this.project.update((project) => project ? { ...project, taskCount: project.taskCount + 1 } : project);
      },
      error: () => this.taskError.set('Could not create the task. Please try again.'),
    });
  }

  protected changeStatus(task: ProjectTask, status: TaskStatus): void {
    if (task.status === status) return;
    const previousStatus = task.status;
    this.tasks.update((tasks) => tasks.map((item) => item.id === task.id ? { ...item, status } : item));
    this.api.setTaskStatus(task.id, status).subscribe({
      error: () => {
        this.tasks.update((tasks) => tasks.map((item) => item.id === task.id ? { ...item, status: previousStatus } : item));
        this.taskError.set('Could not update task status.');
      },
    });
  }
}