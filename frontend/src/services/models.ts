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
  /** Units of work the task is split into; null when it is not split. */
  units: number | null;
  /** Units completed so far. A done task counts as complete whatever this is. */
  unitsDone: number;
}

export type TaskStatus = 'todo' | 'doing' | 'done';

export interface Account {
  id: string;
  userName: string;
  displayName: string;
  email: string;
  mustChangePassword: boolean;
  avatarImage: string | null;
}

export type OverviewRange = '7d' | '30d' | '1y';

/** Cumulative values at the end of the day (or week) starting at date. */
export interface OverviewPoint {
  date: string;
  tasksCompleted: number;
  hours: number;
}

export interface ProjectOverview {
  points: OverviewPoint[];
  working: boolean;
  workingSince: string | null;
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
  /** Invited but not signed in yet. */
  pending: boolean;
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
/**
 * A marker on the canvas. When taskId is set it is linked to that task: it shows the task's title and
 * status colour (color is then unused), and clicking it opens the task.
 */
export interface CanvasPin extends CanvasItemBase {
  type: 'pin';
  h: number;
  label: string;
  color: CanvasColor;
  taskId: number | null;
  /** The zoom the pin was dropped at; used for pins saved before `area` existed. */
  zoom: number;
  /**
   * The canvas area (in canvas units) that was visible when the pin was dropped. Showing the pin fits this
   * whole area into the current window, so smaller windows such as previews still show everything.
   */
  area?: { width: number; height: number };
}
/** A pasted image; the file itself is stored separately and fetched by imageId. */
export interface CanvasImageItem extends CanvasItemBase { type: 'image'; h: number; imageId: number; }
export type CanvasItem = CanvasNote | CanvasList | CanvasShape | CanvasStamp | CanvasPin | CanvasImageItem;
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
