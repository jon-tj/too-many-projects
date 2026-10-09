export interface Project {
  id: number;
  name: string;
  description: string;
  createdAt: string;
  taskCount: number;
  memberCount: number;
  icon: string | null;
  iconImage: string | null;
  /** Your role in the project. */
  myRole: string;
  billingEnabled: boolean;
  /** The project's GitHub repository (https://github.com/...), or null. */
  gitHubUrl: string | null;
  /** The project's website (http(s)://...), or null. */
  websiteUrl: string | null;
}

export interface ProjectTask {
  id: number;
  projectId: number;
  projectName: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  assigneeUserId: string | null;
  dueAt: string | null;
  createdAt: string;
  /** Units of work the task is split into; null when it is not split. */
  units: number | null;
  /** Units completed so far. A done task counts as complete whatever this is. */
  unitsDone: number;
  /** Ids of tasks in the same project that must be done before this one can start. */
  dependsOn: number[];
  /** True while any dependency is not done; a blocked task stays in to do. */
  blocked: boolean;
}

export type TaskStatus = 'todo' | 'doing' | 'done';

export type TaskPriority = 'low' | 'high' | 'critical';

/** Higher ranks sort first. */
export const PRIORITY_RANK: Record<TaskPriority, number> = { critical: 2, high: 1, low: 0 };

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
  billableFraction: BillableFraction;
}

export const BILLABLE_FRACTIONS = ['1/1', '3/4', '2/3', '1/2'] as const;
export type BillableFraction = (typeof BILLABLE_FRACTIONS)[number];

export interface BillingSettings {
  enabled: boolean;
  clientName: string;
  /** Our side's point of contact for the client. */
  contactName: string;
  costPerHour: number;
  minHoursPerDay: number;
  maxHoursPerDay: number;
}

export interface BillingMemberTotal {
  name: string;
  fraction: BillableFraction;
  daysWorked: number;
  hoursWorked: number;
  billableHours: number;
  amount: number;
}

/** An earlier bill still owed: unpaid, or the rest of a partial payment. */
export interface OverdueBill {
  billId: number;
  month: string;
  amount: number;
}

/** "due" = open; the others close the bill. */
export const BILL_STATUSES = [
  { value: 'due', label: 'Due' },
  { value: 'paid', label: 'Paid' },
  { value: 'partiallyPaid', label: 'Partially paid' },
  { value: 'unpaid', label: 'Unpaid' },
  { value: 'canceled', label: 'Canceled' },
] as const;
export type BillStatus = (typeof BILL_STATUSES)[number]['value'];

export interface BillSummary {
  id: number;
  month: string;
  createdAt: string;
  status: BillStatus;
  amount: number;
  amountPaid: number;
  /** Still owed on this bill when unpaid or partially paid, otherwise 0. */
  overdue: number;
}

export interface BillDetail {
  bill: BillSummary;
  report: BillingReport;
}

export interface BillingDay {
  date: string;
  userId: string;
  name: string;
  fraction: BillableFraction;
  hoursWorked: number;
  billableHours: number;
  /** Worked before the bill's month but not billed before. */
  carriedOver: boolean;
}

/** A month's billing; month is "yyyy-MM". */
export interface BillingReport {
  projectName: string;
  month: string;
  settings: BillingSettings;
  members: BillingMemberTotal[];
  days: BillingDay[];
  hoursWorked: number;
  billableHours: number;
  amount: number;
  /** Earlier bills still owed; frozen into a bill when it is finalized. */
  overdue: OverdueBill[];
  overdueTotal: number;
  totalWithOverdue: number;
  /** Work from earlier months that no earlier bill covered; included in the totals above. */
  carriedOverBillableHours: number;
  carriedOverAmount: number;
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
