export interface Project {
  id: number;
  name: string;
  description: string;
  createdAt: string;
  taskCount: number;
  memberCount: number;
}

export interface ProjectTask {
  id: number;
  projectId: number;
  projectName: string;
  title: string;
  description: string;
  status: TaskStatus;
  assigneeUserId: string | null;
  dueAt: string | null;
  createdAt: string;
}

export type TaskStatus = 'todo' | 'doing' | 'done';

export interface Account {
  id: string;
  userName: string;
  displayName: string;
  email: string;
}

export interface CanvasView { x: number; y: number; zoom: number; }
export interface CanvasNote { id: string; type: 'note'; x: number; y: number; text: string; color: string; }
export interface CanvasShape {
  id: string;
  type: 'shape';
  shape: 'rectangle' | 'circle' | 'diamond' | 'arrow';
  x: number;
  y: number;
  color: string;
}
export type CanvasItem = CanvasNote | CanvasShape;
export interface CanvasDocument { view: CanvasView; items: CanvasItem[]; }
export const EMPTY_CANVAS: CanvasDocument = { view: { x: 80, y: 70, zoom: 1 }, items: [] };