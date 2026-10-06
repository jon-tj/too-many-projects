export interface Project {
  id: number;
  name: string;
  description: string;
  createdAt: string;
  taskCount: number;
  memberCount: number;
  icon: string | null;
  iconImage: string | null;
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

export type ProjectRole = 'Owner' | 'Developer' | 'External';

export interface UserSummary {
  id: string;
  userName: string;
  displayName: string;
  email: string;
}

export interface ProjectMember {
  userId: string;
  userName: string;
  displayName: string;
  role: string;
}

export const CANVAS_COLORS = ['white', 'yellow', 'rose', 'blue', 'green', 'lavender'] as const;
export type CanvasColor = (typeof CANVAS_COLORS)[number];
export type ShapeKind = 'box' | 'circle' | 'triangle' | 'line' | 'arrow';
export type ListMarker = 'circle' | 'number' | 'cross';

export interface CanvasView { x: number; y: number; zoom: number; }
interface CanvasItemBase { id: string; x: number; y: number; w: number; }
export interface CanvasNote extends CanvasItemBase { type: 'note'; text: string; color: CanvasColor; }
export interface CanvasList extends CanvasItemBase {
  type: 'list';
  rows: { text: string; marker: ListMarker }[];
  color: CanvasColor;
}
export interface CanvasShape extends CanvasItemBase {
  type: 'shape';
  shape: ShapeKind;
  h: number;
  angle: number;
  color: CanvasColor;
}
export interface CanvasStamp extends CanvasItemBase { type: 'stamp'; emoji: string; h: number; }
export type CanvasItem = CanvasNote | CanvasList | CanvasShape | CanvasStamp;
export interface CanvasDocument { view: CanvasView; items: CanvasItem[]; }

export interface CanvasSummary {
  id: number;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface CanvasDetail extends CanvasSummary {
  canWrite: boolean;
  canManage: boolean;
  canvas: CanvasDocument;
}

export interface CanvasPermission {
  userId: string;
  userName: string;
  displayName: string;
  role: string;
  canRead: boolean;
  canWrite: boolean;
}
