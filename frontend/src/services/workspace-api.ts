import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import {
  Account,
  CanvasDetail,
  CanvasDocument,
  CanvasPermission,
  CanvasSummary,
  Project,
  ProjectMember,
  ProjectRole,
  ProjectTask,
  UserSummary,
} from './models';

@Injectable({ providedIn: 'root' })
export class WorkspaceApi {
  constructor(private readonly http: HttpClient) {}

  currentAccount(): Observable<Account> {
    return this.http.get<Account>('/api/account/me');
  }

  projects(): Observable<Project[]> {
    return this.http.get<Project[]>('/api/projects');
  }

  createProject(name: string, description: string): Observable<Project> {
    return this.http.post<Project>('/api/projects', { name, description });
  }

  project(id: number): Observable<Project> {
    return this.http.get<Project>(`/api/projects/${id}`);
  }

  updateProject(id: number, name: string, description: string): Observable<void> {
    return this.http.put<void>(`/api/projects/${id}`, { name, description });
  }

  setProjectIcon(id: number, icon: string | null, iconImage: string | null): Observable<void> {
    return this.http.put<void>(`/api/projects/${id}/icon`, { icon, iconImage });
  }

  deleteProject(id: number): Observable<void> {
    return this.http.delete<void>(`/api/projects/${id}`);
  }

  projectMembers(id: number): Observable<ProjectMember[]> {
    return this.http.get<ProjectMember[]>(`/api/projects/${id}/members`);
  }

  memberCandidates(projectId: number, search: string): Observable<UserSummary[]> {
    return this.http.get<UserSummary[]>(`/api/projects/${projectId}/member-candidates`, { params: { search } });
  }

  addMember(projectId: number, userId: string, role: ProjectRole): Observable<ProjectMember> {
    return this.http.post<ProjectMember>(`/api/projects/${projectId}/members`, { userId, role });
  }

  removeMember(projectId: number, userId: string): Observable<void> {
    return this.http.delete<void>(`/api/projects/${projectId}/members/${userId}`);
  }

  addNewUserMember(
    projectId: number,
    userName: string,
    email: string,
    role: ProjectRole,
  ): Observable<{ member: ProjectMember; password: string }> {
    return this.http.post<{ member: ProjectMember; password: string }>(
      `/api/projects/${projectId}/members/new-user`,
      { userName, email, role },
    );
  }

  dashboardTasks(): Observable<ProjectTask[]> {
    return this.http.get<ProjectTask[]>('/api/tasks');
  }

  projectTasks(projectId: number): Observable<ProjectTask[]> {
    return this.http.get<ProjectTask[]>(`/api/tasks/by-project/${projectId}`);
  }

  createTask(projectId: number, title: string, description: string): Observable<ProjectTask> {
    return this.http.post<ProjectTask>(`/api/tasks/by-project/${projectId}`, { title, description });
  }

  task(id: number): Observable<ProjectTask> {
    return this.http.get<ProjectTask>(`/api/tasks/${id}`);
  }

  updateTask(task: ProjectTask): Observable<void> {
    const { title, description, status, assigneeUserId, dueAt } = task;
    return this.http.put<void>(`/api/tasks/${task.id}`, { title, description, status, assigneeUserId, dueAt });
  }

  setTaskStatus(taskId: number, status: string): Observable<void> {
    return this.http.patch<void>(`/api/tasks/${taskId}/status`, { status });
  }

  canvases(projectId: number): Observable<CanvasSummary[]> {
    return this.http.get<CanvasSummary[]>(`/api/projects/${projectId}/canvases`);
  }

  createCanvas(projectId: number, name: string): Observable<CanvasSummary> {
    return this.http.post<CanvasSummary>(`/api/projects/${projectId}/canvases`, { name });
  }

  canvas(projectId: number, canvasId: number): Observable<CanvasDetail> {
    return this.http.get<CanvasDetail>(`/api/projects/${projectId}/canvases/${canvasId}`);
  }

  renameCanvas(projectId: number, canvasId: number, name: string): Observable<void> {
    return this.http.put<void>(`/api/projects/${projectId}/canvases/${canvasId}`, { name });
  }

  deleteCanvas(projectId: number, canvasId: number): Observable<void> {
    return this.http.delete<void>(`/api/projects/${projectId}/canvases/${canvasId}`);
  }

  saveCanvas(projectId: number, canvasId: number, canvas: CanvasDocument): Observable<void> {
    return this.http.put<void>(`/api/projects/${projectId}/canvases/${canvasId}/content`, { canvas });
  }

  canvasPermissions(projectId: number, canvasId: number): Observable<CanvasPermission[]> {
    return this.http.get<CanvasPermission[]>(`/api/projects/${projectId}/canvases/${canvasId}/permissions`);
  }

  setCanvasPermission(
    projectId: number,
    canvasId: number,
    userId: string,
    canRead: boolean,
    canWrite: boolean,
  ): Observable<void> {
    return this.http.put<void>(`/api/projects/${projectId}/canvases/${canvasId}/permissions/${userId}`, {
      canRead,
      canWrite,
    });
  }
}