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
  ProjectOverview,
  OverviewRange,
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

  updateProject(
    id: number,
    changes: Pick<Project, 'name' | 'description' | 'icon' | 'iconImage'>,
  ): Observable<void> {
    return this.http.put<void>(`/api/projects/${id}`, changes);
  }

  projectOverview(id: number, range: OverviewRange): Observable<ProjectOverview> {
    return this.http.get<ProjectOverview>(`/api/projects/${id}/overview`, { params: { range } });
  }

  /** Working opens a work session for you in the project; idle closes it. */
  setWorking(id: number, working: boolean): Observable<void> {
    return this.http.put<void>(`/api/projects/${id}/work`, { working });
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

  /** Cancels an invite; the account is deleted too when this was the user's only project. */
  cancelInvite(projectId: number, userId: string): Observable<{ userDeleted: boolean }> {
    return this.http.delete<{ userDeleted: boolean }>(`/api/projects/${projectId}/members/${userId}/invite`);
  }

  /** Sets the profile picture (a small image data URL), or removes it with null. */
  setAvatar(image: string | null): Observable<void> {
    return this.http.put<void>('/api/account/avatar', { image });
  }

  deleteAccount(password: string): Observable<void> {
    return this.http.post<void>('/api/account/delete', { password });
  }

  addNewUserMember(
    projectId: number,
    userName: string,
    email: string,
    role: ProjectRole,
  ): Observable<ProjectMember> {
    return this.http.post<ProjectMember>(
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

  createTask(
    projectId: number,
    task: Pick<ProjectTask, 'title' | 'description' | 'assigneeUserId' | 'dueAt' | 'units'>,
  ): Observable<ProjectTask> {
    const { title, description, assigneeUserId, dueAt, units } = task;
    return this.http.post<ProjectTask>(`/api/tasks/by-project/${projectId}`, {
      title,
      description,
      assigneeUserId,
      dueAt,
      units,
    });
  }

  task(id: number): Observable<ProjectTask> {
    return this.http.get<ProjectTask>(`/api/tasks/${id}`);
  }

  updateTask(task: ProjectTask): Observable<void> {
    const { title, description, status, assigneeUserId, dueAt, units } = task;
    return this.http.put<void>(`/api/tasks/${task.id}`, { title, description, status, assigneeUserId, dueAt, units });
  }

  setTaskUnitsDone(taskId: number, done: number): Observable<void> {
    return this.http.patch<void>(`/api/tasks/${taskId}/units`, { done });
  }

  deleteTask(id: number): Observable<void> {
    return this.http.delete<void>(`/api/tasks/${id}`);
  }

  setTaskStatus(taskId: number, status: string): Observable<void> {
    return this.http.patch<void>(`/api/tasks/${taskId}/status`, { status });
  }

  canvases(projectId: number): Observable<CanvasSummary[]> {
    return this.http.get<CanvasSummary[]>(`/api/projects/${projectId}/canvases`);
  }

  /** Canvases (that you can read) with a pin linked to the task, and that pin's id. */
  canvasesPinnedTo(projectId: number, taskId: number): Observable<{ id: number; name: string; pinId: string }[]> {
    return this.http.get<{ id: number; name: string; pinId: string }[]>(
      `/api/projects/${projectId}/canvases/pinned/${taskId}`,
    );
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

  uploadCanvasImage(projectId: number, canvasId: number, image: Blob): Observable<{ id: number }> {
    const form = new FormData();
    form.append('file', image, 'pasted-image');
    return this.http.post<{ id: number }>(`/api/projects/${projectId}/canvases/${canvasId}/images`, form);
  }

  /** Fetched with the sign-in token, which a plain <img src> could not send. */
  canvasImage(projectId: number, canvasId: number, imageId: number): Observable<Blob> {
    return this.http.get(`/api/projects/${projectId}/canvases/${canvasId}/images/${imageId}`, { responseType: 'blob' });
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