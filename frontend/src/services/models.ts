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
  /** The owner's plan no longer includes this project (or their trial ended): nothing in it can be used. */
  frozen: boolean;
  /** False on the free plan, which only includes boards and tasks. */
  fullFeatures: boolean;
  /** You own the project, so its plan (and whether it is frozen) is yours to change. */
  isPlanOwner: boolean;
  /** Who owns the project, to ask about upgrading it. */
  ownerName: string;
  /** The project is yours, frozen, and your plan has a free project slot to unfreeze it into. */
  canUnfreeze: boolean;
  /** Members (pending invites included) the owner's plan allows; null for no limit. */
  memberLimit: number | null;
}

/** none is what a trial or paid plan becomes when it runs out: no project slots, everything frozen. */
export type PlanName = 'trial' | 'free' | 'plus' | 'pro' | 'none';

export const PLAN_TITLES: Record<PlanName, string> = {
  trial: 'Free trial',
  free: 'Free',
  plus: 'Plus',
  pro: 'Pro',
  none: 'No plan',
};

/** The plans you can switch to; trial is only given at registration and none only when a plan runs out. */
export type ChoosablePlan = Exclude<PlanName, 'trial' | 'none'>;

/** Your plan and the projects you own, for choosing a plan. */
export interface PlanInfo {
  planType: PlanName;
  planRenewDate: string | null;
  planLapsed: boolean;
  /** The plan you had when it last ran out; null if it never has. */
  previousPlanType: PlanName | null;
  /** The plan never runs out, whatever its renew date. */
  planExempt: boolean;
  /** Active projects the plan allows; null for no limit. */
  projectLimit: number | null;
  /** Members per project the plan allows, you included; null for no limit. */
  memberLimit: number | null;
  /** memberCount includes you and pending invites. */
  ownedProjects: { id: number; name: string; frozen: boolean; memberCount: number }[];
  /** Stripe is connected, so paid plans are paid for through Stripe Checkout. */
  paymentsEnabled: boolean;
  /** A Stripe subscription pays for your plan. */
  subscribed: boolean;
  /** You have paid through Stripe before, so the billing portal has invoices to show. */
  hasBillingAccount: boolean;
  /** Your subscription ends at the renew date instead of renewing; you then move to Free. */
  cancelsAtRenewal: boolean;
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
  /** When the task last moved to done; null while it is not done. */
  completedAt: string | null;
  /** Units of work the task is split into; null when it is not split. */
  units: number | null;
  /** Units completed so far. A done task counts as complete whatever this is. */
  unitsDone: number;
  /** Ids of tasks in the same project that must be done before this one can start. */
  dependsOn: number[];
  /** True while any dependency is not done; a blocked task stays in to do. */
  blocked: boolean;
  createdByUserId: string;
  /** Who last changed the task and when; null until it is first changed after being created. */
  updatedByUserId: string | null;
  updatedAt: string | null;
}

export type TaskStatus = 'todo' | 'doing' | 'done';

/** Real usage numbers for the landing page. */
export interface PublicStats {
  weeklyActiveUsers: number;
  tasksCompleted: number;
  hoursTracked: number;
}

/** A stretch of time someone marked themselves as working on a project. */
export interface WorkSession extends WorkReflectionValues {
  id: number;
  projectId: number;
  projectName: string;
  startedAt: string;
  /** Null while the session is still running. */
  endedAt: string | null;
}

/** How a work session went, given when finishing it; each part is optional. */
export interface WorkReflectionValues {
  /** 0 (awful) to 10 (great). */
  mood: number | null;
  /** How much the work pushed back: 0 (none) to 10 (a wall). */
  resistance: number | null;
  message: string | null;
}

/** A work session in a project's hours table, with who did it. */
export interface ProjectWorkSession extends WorkReflectionValues {
  id: number;
  userId: string;
  displayName: string;
  avatarImage: string | null;
  startedAt: string;
  endedAt: string | null;
  /** Yours, so you can correct or delete it. */
  mine: boolean;
}

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
  /** trial is only ever set at registration; it cannot be chosen. */
  planType: PlanName;
  /** When the plan runs out unless renewed (end of the trial, or next renewal); null on the free plan. */
  planRenewDate: string | null;
  /** The plan has run out: every project you own is frozen until you choose a plan. */
  planLapsed: boolean;
  /** The plan you had when it last ran out (trial, plus or pro); null if it never has. */
  previousPlanType: PlanName | null;
  /** Can open the admin page. */
  isAdmin: boolean;
  /** Gets the Monday summary email. */
  weeklySummary: boolean;
}

/** A user as the admin page lists them. */
export interface AdminUser {
  id: string;
  userName: string;
  displayName: string;
  email: string;
  avatarImage: string | null;
  createdAt: string;
  /** When they last opened the app; null if never. */
  lastSeenAt: string | null;
  isAdmin: boolean;
  /** Invited but not signed in yet. */
  pending: boolean;
  planType: PlanName;
  planRenewDate: string | null;
  previousPlanType: PlanName | null;
  /** A Stripe subscription pays for their plan. */
  subscribed: boolean;
  planExempt: boolean;
  /** Projects they own. */
  projectsCreated: number;
  /** Projects they are a member of, their own included. */
  projectsJoined: number;
  tasksCreated: number;
  /** Done tasks assigned to them. */
  tasksCompleted: number;
  /** Where they signed up from (utm_source, referring site or "(direct)"); null for invited accounts. */
  signupSource: string | null;
  signupCampaign: string | null;
}

/** Self sign-ups from one source and campaign, for the admin page. */
export interface Campaign {
  /** utm_source, the referring site with " (referrer)", or "(direct)". */
  source: string;
  /** utm_campaign; empty when none. */
  campaign: string;
  signups30Days: number;
  signupsTotal: number;
  /** Opened the app in the last 30 days. */
  active: number;
  /** Have a Stripe subscription. */
  paying: number;
}

/** Asking you about your experience (GET api/reviews/prompt). */
export interface ReviewPrompt {
  /** Days since you created your account: 10, 40 or 150. */
  round: number;
  /** Days a review adds to your trial; null when you are not on one. */
  trialBonusDays: number | null;
  /** Your projects, to optionally name one with the review. */
  projectNames: string[];
}

/** A review as the admin page lists it. */
export interface AdminReview {
  id: number;
  userId: string;
  displayName: string;
  userName: string;
  avatarImage: string | null;
  memberSince: string;
  /** Days after creating their account that the user was asked: 10, 40 or 150. */
  round: number;
  createdAt: string;
  stars: number;
  body: string;
  /** The user allows it on the landing page, with their name. */
  mayPublish: boolean;
  /** The project the user allows to be named with it. */
  projectName: string | null;
  /** Shown on the landing page. */
  featured: boolean;
}

/** Where a feature request stands, set by the admin. */
export type FeatureRequestStatus = 'new' | 'planned' | 'done' | 'declined';

/** A feature request as the admin page lists it. */
export interface AdminFeatureRequest {
  id: number;
  userId: string;
  displayName: string;
  userName: string;
  email: string;
  avatarImage: string | null;
  title: string;
  description: string;
  createdAt: string;
  status: FeatureRequestStatus;
}

/** A review on the landing page. */
export interface PublicReview {
  stars: number;
  body: string;
  name: string;
  avatarImage: string | null;
  /** When the reviewer created their account. */
  memberSince: string;
  projectName: string | null;
}

/** Usage over the last 7 and 30 days, for the admin page. */
export interface AdminStats {
  /** Users who opened the app in the last 7 days. */
  weeklyActive: number;
  /** Users who opened the app in the last 30 days. */
  monthlyActive: number;
  /** Accounts made through the sign-up form. */
  signupsWeek: number;
  signupsMonth: number;
  /** Accounts made by inviting someone to a project. */
  invitedWeek: number;
  invitedMonth: number;
}

/** A project as the admin page lists it. */
export interface AdminProject {
  id: number;
  name: string;
  description: string;
  icon: string | null;
  iconImage: string | null;
  createdAt: string;
  ownerId: string;
  ownerName: string;
  ownerUserName: string;
  ownerPlanType: PlanName;
  frozen: boolean;
  memberCount: number;
  taskCount: number;
  doneTaskCount: number;
  /** You are a member, so you can open it. */
  adminIsMember: boolean;
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
  /** When they joined the project. */
  addedAt: string;
  /** Profile picture as an image data URL; null shows their initial. */
  avatarImage: string | null;
}

export const BILLABLE_FRACTIONS = ['1/1', '3/4', '2/3', '1/2'] as const;
export type BillableFraction = (typeof BILLABLE_FRACTIONS)[number];

export interface BillingSettings {
  enabled: boolean;
  clientName: string;
  /** Who does the work for the client. */
  contractorName: string;
  costPerHour: number;
  minHoursPerDay: number;
  maxHoursPerDay: number;
  /** IANA name (e.g. Europe/Oslo) whose midnights start each billed day and month; empty means UTC. */
  timeZone: string;
  /** ISO 4217 code (e.g. USD, NOK); missing on bills finalized before currencies, which were in USD. */
  currency?: string;
  /** VAT added on top of each bill, in percent; 0 adds none. Missing on bills from before VAT. */
  vatRate?: number;
  /** The contractor's postal address, one line per line. Business details are missing on older bills. */
  contractorAddress?: string;
  /** The contractor's organisation or VAT number. */
  orgNumber?: string;
  /** How to pay: bank account, IBAN, reference. */
  paymentDetails?: string;
  /** Days after a bill is issued that it is due. */
  paymentTermsDays?: number;
}

/** Currencies offered in billing settings; any other three-letter code is kept if a project already has it. */
export const BILLING_CURRENCIES = ['USD', 'EUR', 'GBP', 'NOK', 'SEK', 'DKK', 'ISK', 'CHF', 'PLN', 'CAD', 'AUD', 'NZD', 'JPY'];

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

/** A secret link to a bill, or to a month's live report ("yyyy-MM"). */
export interface ShareLink {
  token: string;
  billId: number | null;
  month: string | null;
}

/** What a share link shows: a bill, or a live report (bill is null). */
export interface SharedBilling {
  bill: BillSummary | null;
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
  /** This month's work, before VAT. */
  amount: number;
  /** VAT on amount; 0 or missing without VAT. */
  vat?: number;
  /** This month's work with VAT; missing on bills from before VAT. */
  amountWithVat?: number | null;
  /** The project's icon and image when the report was made, for the top of the bill; missing on older bills. */
  projectIcon?: string | null;
  projectIconImage?: string | null;
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
