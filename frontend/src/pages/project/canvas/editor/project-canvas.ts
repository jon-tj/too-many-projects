import {
  Component,
  booleanAttribute,
  ElementRef,
  HostListener,
  OnDestroy,
  computed,
  effect,
  inject,
  input,
  numberAttribute,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Icon } from '../../../../components/icon/icon';
import {
  CANVAS_COLORS,
  CanvasColor,
  CanvasDetail,
  CanvasItem,
  CanvasList,
  CanvasNote,
  CanvasPin,
  CanvasShape,
  CanvasView,
  ShapeKind,
} from '../../../../services/models';
import { WorkspaceApi } from '../../../../services/workspace-api';

const STAMPS = [
  { label: 'Star', emoji: '⭐' },
  { label: 'Heart', emoji: '❤️' },
  { label: 'Laughing', emoji: '😂' },
  { label: 'Happy', emoji: '😊' },
  { label: 'Mad', emoji: '😡' },
];
const SHAPES: { label: string; shape: ShapeKind; icon: string }[] = [
  { label: 'Box', shape: 'box', icon: 'crop_square' },
  { label: 'Circle', shape: 'circle', icon: 'circle' },
  { label: 'Triangle', shape: 'triangle', icon: 'change_history' },
  { label: 'Line', shape: 'line', icon: 'horizontal_rule' },
  { label: 'Arrow', shape: 'arrow', icon: 'arrow_right_alt' },
];
const MARKERS = ['circle', 'number', 'cross'] as const;
const DEFAULT_VIEW: CanvasView = { x: 40, y: 40, zoom: 1 };

type Tool = { label: string } & ({ type: 'stamp'; emoji: string } | { type: 'shape'; shape: ShapeKind } | { type: 'pin' });
/** Optional numeric input that may come from a query parameter (string) or a binding (number). */
const optionalNumber = (value: string | number | null | undefined) =>
  value === undefined || value === null || value === '' ? null : Number(value);

type Gesture = { move: (event: PointerEvent) => void; tap?: () => void; x: number; y: number };
const PIN_SIZE = 32;

const isLine = (item: CanvasItem) => item.type === 'shape' && (item.shape === 'line' || item.shape === 'arrow');

@Component({
  selector: 'app-project-canvas',
  imports: [RouterLink, Icon],
  host: { '[class.preview]': 'preview()' },
  templateUrl: './project-canvas.html',
  styleUrl: './project-canvas.css',
})
export class ProjectCanvas implements OnDestroy {
  readonly projectId = input.required({ transform: numberAttribute });
  readonly canvasId = input.required({ transform: numberAttribute });
  /** Task to pin, from `?pinTask=`. While set, the editor only offers "Drop pin" and "Cancel". */
  readonly pinTask = input(null, { transform: optionalNumber });
  /** Pin to centre on at the zoom it was dropped at (`?focusPin=`); clicking a pin sets it, so the URL can be shared. */
  readonly focusPin = input<string | null | undefined>(null);
  /** Read-only, non-interactive view without any controls, e.g. on the task page. */
  readonly preview = input(false, { transform: booleanAttribute });
  private readonly api = inject(WorkspaceApi);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly viewport = viewChild.required<ElementRef<HTMLElement>>('viewport');
  protected readonly colors = CANVAS_COLORS;
  protected readonly stamps = STAMPS;
  protected readonly shapes = SHAPES;
  protected readonly view = signal(DEFAULT_VIEW);
  protected readonly items = signal<CanvasItem[]>([]);
  protected readonly tool = signal<Tool | null>(null);
  protected readonly menu = signal<'stamp' | 'shape' | null>(null);
  protected readonly error = signal('');
  protected readonly detail = signal<CanvasDetail | null>(null);
  protected readonly canWrite = computed(() => this.detail()?.canWrite ?? false);
  /** Items can be edited only with write access and outside pin mode. */
  protected readonly editable = computed(() => this.canWrite() && this.pinTask() === null && !this.preview());
  /** A viewing option only; it is not saved. */
  protected readonly showPins = signal(true);
  /** Project tasks, so linked pins show the current title and status colour. */
  private readonly tasks = rxResource({
    params: () => this.projectId(),
    stream: ({ params }) => this.api.projectTasks(params),
    defaultValue: [],
  });
  private readonly taskById = computed(() => new Map(this.tasks.value().map((task) => [task.id, task])));
  protected readonly hint = computed(() => {
    if (this.pinTask() !== null) return 'Pan and zoom so the spot is in the middle, then drop the pin';
    const tool = this.tool();
    if (!tool) return 'Double-click to add a note · drag to pan · Ctrl+scroll to zoom';
    const verb = tool.type === 'shape' ? 'Drag to draw' : 'Click to place';
    return `${verb} ${tool.label.toLowerCase()} · Esc to stop`;
  });
  private gesture: Gesture | null = null;
  private saveTimer?: ReturnType<typeof setTimeout>;
  private loaded = { projectId: 0, canvasId: 0 };

  constructor() {
    effect(() => {
      const projectId = this.projectId();
      const canvasId = this.canvasId();
      untracked(() => this.load(projectId, canvasId));
    });
    // Also follow ?focusPin= changes after loading, e.g. back/forward or a pasted link.
    effect(() => {
      const pinId = this.focusPin();
      untracked(() => {
        if (pinId && this.detail()) this.centerOnPin(pinId);
      });
    });
  }

  ngOnDestroy(): void {
    this.flush();
  }

  // ---- view ----

  protected onPointerDown(event: PointerEvent): void {
    const tool = this.tool();
    if (tool) {
      const point = this.toWorld(event);
      if (tool.type === 'stamp') {
        this.add({ id: crypto.randomUUID(), type: 'stamp', emoji: tool.emoji, x: point.x - 32, y: point.y - 32, w: 64, h: 64 });
      } else if (tool.type === 'pin') {
        const label = prompt('Pin name')?.trim();
        if (label) this.add(this.newPin(point, label, null));
      } else {
        this.draw(event, tool.shape, point);
      }
      event.preventDefault();
      return;
    }
    if (!this.isBackground(event)) return;
    (document.activeElement as HTMLElement | null)?.blur();
    this.menu.set(null);
    const start = { x: event.clientX, y: event.clientY, view: this.view() };
    this.begin(event, (move) =>
      this.view.set({ ...start.view, x: start.view.x + move.clientX - start.x, y: start.view.y + move.clientY - start.y }),
    );
  }

  protected onPointerMove(event: PointerEvent): void {
    this.gesture?.move(event);
  }

  protected onPointerUp(event: PointerEvent): void {
    const gesture = this.gesture;
    if (!gesture) return;
    this.gesture = null;
    // A press that barely moved counts as a click, e.g. opening a linked pin's task.
    if (gesture.tap && Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) < 4) gesture.tap();
    this.save();
  }

  /** Double-clicking empty space or a shape adds a note there, like in the original board. */
  protected onDoubleClick(event: MouseEvent): void {
    if (!this.editable()) return;
    // Pointer capture retargets the event to the viewport, so look at what is actually under the cursor.
    const target = document.elementFromPoint(event.clientX, event.clientY);
    if (target === this.viewport().nativeElement || target?.matches('.world, .shape > .face')) {
      this.addNote(this.toWorld(event));
    }
  }

  protected onWheel(event: WheelEvent): void {
    event.preventDefault();
    if (event.ctrlKey || event.metaKey) {
      this.zoom(Math.exp(-event.deltaY * 0.01), event.clientX, event.clientY);
    } else {
      this.view.update((view) => ({ ...view, x: view.x - event.deltaX, y: view.y - event.deltaY }));
      this.save();
    }
  }

  protected zoom(factor: number, clientX?: number, clientY?: number): void {
    const rect = this.viewport().nativeElement.getBoundingClientRect();
    const cx = clientX === undefined ? rect.width / 2 : clientX - rect.left;
    const cy = clientY === undefined ? rect.height / 2 : clientY - rect.top;
    this.view.update((view) => {
      const zoom = Math.min(4, Math.max(0.15, view.zoom * factor));
      return { x: cx - (cx - view.x) * (zoom / view.zoom), y: cy - (cy - view.y) * (zoom / view.zoom), zoom };
    });
    this.save();
  }

  protected resetView(): void {
    this.view.set(DEFAULT_VIEW);
    this.save();
  }

  // ---- tools ----

  protected toggleMenu(menu: 'stamp' | 'shape'): void {
    this.menu.update((open) => (open === menu ? null : menu));
  }

  protected pickStamp(stamp: (typeof STAMPS)[number]): void {
    this.tool.set({ type: 'stamp', ...stamp });
    this.menu.set(null);
  }

  protected pickShape(shape: (typeof SHAPES)[number]): void {
    this.tool.set({ type: 'shape', label: shape.label, shape: shape.shape });
    this.menu.set(null);
  }

  protected pickPin(): void {
    this.tool.set({ type: 'pin', label: 'Pin' });
    this.menu.set(null);
  }

  @HostListener('document:keydown.escape')
  protected stopTool(): void {
    this.tool.set(null);
    this.menu.set(null);
  }

  // ---- items ----

  protected addNote(point = this.center()): void {
    const note: CanvasNote = { id: crypto.randomUUID(), type: 'note', x: point.x, y: point.y, w: 220, text: '', color: 'white' };
    this.add(note);
    this.focus(note.id);
  }

  protected addList(): void {
    const point = this.center();
    const list: CanvasList = {
      id: crypto.randomUUID(),
      type: 'list',
      x: point.x,
      y: point.y,
      w: 280,
      color: 'white',
      rows: [{ text: '', marker: 'circle' }],
    };
    this.add(list);
    this.focus(list.id);
  }

  protected drag(event: PointerEvent, item: CanvasItem): void {
    if (this.tool() || event.button !== 0) return;
    // Clicking (not dragging) a pin shows it: moves there and puts it in the URL.
    const focus = item.type === 'pin' && this.pinTask() === null ? () => this.goToPin(item) : undefined;
    if (!this.editable()) {
      focus?.();
      return;
    }
    event.stopPropagation();
    const moving = [item];
    if (item.type === 'shape' && item.shape === 'box') {
      moving.push(...this.items().filter((other) => other !== item && this.isInside(other, item)));
    }
    const origins = moving.map((entry) => ({ entry, x: entry.x, y: entry.y }));
    this.items.update((items) => [
      ...items.filter((entry) => !moving.includes(entry)),
      ...items.filter((entry) => moving.includes(entry)),
    ]);
    const start = { x: event.clientX, y: event.clientY, zoom: this.view().zoom };
    this.begin(event, (move) => {
      const dx = (move.clientX - start.x) / start.zoom;
      const dy = (move.clientY - start.y) / start.zoom;
      origins.forEach(({ entry, x, y }) => Object.assign(entry, { x: x + dx, y: y + dy }));
      this.touch();
    }, focus);
  }

  /** Moves to the pin's spot and zoom and puts it in the URL, so the address can be shared. */
  protected goToPin(pin: CanvasPin): void {
    this.centerOnPin(pin.id);
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { focusPin: pin.id },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  protected resize(event: PointerEvent, item: CanvasItem): void {
    if (!this.editable()) return;
    event.stopPropagation();
    const start = { x: event.clientX, y: event.clientY, w: item.w, h: 'h' in item ? item.h : 0, zoom: this.view().zoom };
    this.begin(event, (move) => {
      item.w = Math.max(40, start.w + (move.clientX - start.x) / start.zoom);
      if (item.type === 'stamp' || item.type === 'pin') item.h = item.w;
      else if (item.type === 'shape' && !isLine(item)) item.h = Math.max(40, start.h + (move.clientY - start.y) / start.zoom);
      this.touch();
    });
  }

  protected setColor(item: CanvasNote | CanvasList | CanvasShape | CanvasPin, color: CanvasColor): void {
    item.color = color;
    this.touch();
    this.save();
  }

  protected sendToBack(item: CanvasItem): void {
    this.items.update((items) => [item, ...items.filter((entry) => entry !== item)]);
    this.save();
  }

  protected remove(item: CanvasItem): void {
    this.items.update((items) => items.filter((entry) => entry !== item));
    this.save();
  }

  /** Linked pins take their task's status colour instead, see statusOf. */
  protected colorOf(item: CanvasItem): CanvasColor | null {
    if (item.type === 'stamp' || (item.type === 'pin' && item.taskId !== null)) return null;
    return item.color;
  }

  protected statusOf(item: CanvasItem): string | null {
    return item.type === 'pin' && item.taskId !== null ? (this.taskById().get(item.taskId)?.status ?? null) : null;
  }

  protected pinLabel(pin: CanvasPin): string {
    return pin.taskId !== null ? (this.taskById().get(pin.taskId)?.title ?? pin.label) : pin.label;
  }

  protected renamePin(pin: CanvasPin): void {
    const label = prompt('Pin name', pin.label)?.trim();
    if (!label) return;
    pin.label = label;
    this.touch();
    this.save();
  }

  // ---- pin mode ----

  /** Drops the task's pin at the middle of the screen, moving it if this canvas already has one. */
  protected dropPin(): void {
    const taskId = this.pinTask();
    if (taskId === null) return;
    const rect = this.viewport().nativeElement.getBoundingClientRect();
    const { x, y, zoom } = this.view();
    const middle = { x: (rect.width / 2 - x) / zoom, y: (rect.height / 2 - y) / zoom };
    const pin = this.newPin(middle, this.taskById().get(taskId)?.title ?? 'Task', taskId);
    const existing = this.items().find((item): item is CanvasPin => item.type === 'pin' && item.taskId === taskId);
    if (existing) {
      Object.assign(existing, { x: pin.x, y: pin.y, label: pin.label, zoom: pin.zoom });
      this.touch();
      this.save();
    } else {
      this.add(pin);
    }
    this.openTask(taskId);
  }

  protected cancelPin(): void {
    const taskId = this.pinTask();
    if (taskId !== null) this.openTask(taskId);
  }

  protected setText(item: CanvasNote | CanvasList['rows'][number], event: Event): void {
    item.text = (event.target as HTMLTextAreaElement).value;
    this.save();
  }

  // ---- lists ----

  protected marker(list: CanvasList, index: number): string {
    const row = list.rows[index];
    if (row.marker === 'cross') return '×';
    if (row.marker === 'circle') return '•';
    return `${list.rows.slice(0, index + 1).filter((entry) => entry.marker === 'number').length}.`;
  }

  protected cycleMarker(row: CanvasList['rows'][number]): void {
    row.marker = MARKERS[(MARKERS.indexOf(row.marker) + 1) % MARKERS.length];
    this.touch();
    this.save();
  }

  protected addRow(list: CanvasList, index: number): void {
    const previous = list.rows[index - 1];
    list.rows.splice(index, 0, { text: '', marker: previous?.marker === 'number' ? 'number' : 'circle' });
    this.touch();
    this.save();
    this.focus(list.id, index);
  }

  protected onRowKeydown(event: KeyboardEvent, list: CanvasList, index: number): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.addRow(list, index + 1);
    } else if (event.key === 'Backspace' && !list.rows[index].text && list.rows.length > 1) {
      event.preventDefault();
      list.rows.splice(index, 1);
      this.touch();
      this.save();
      this.focus(list.id, Math.max(0, index - 1));
    }
  }

  // ---- helpers ----

  private draw(event: PointerEvent, kind: ShapeKind, start: { x: number; y: number }): void {
    const shape: CanvasShape = {
      id: crypto.randomUUID(),
      type: 'shape',
      shape: kind,
      x: start.x,
      y: start.y,
      w: 1,
      h: 1,
      angle: 0,
      color: kind === 'line' || kind === 'arrow' ? 'rose' : 'blue',
    };
    this.add(shape);
    this.begin(event, (move) => {
      const end = this.toWorld(move);
      if (isLine(shape)) {
        const dx = end.x - start.x;
        const dy = end.y - start.y;
        shape.w = Math.max(8, Math.hypot(dx, dy));
        shape.h = 28;
        shape.x = (start.x + end.x) / 2 - shape.w / 2;
        shape.y = (start.y + end.y) / 2 - shape.h / 2;
        shape.angle = (Math.atan2(dy, dx) * 180) / Math.PI;
      } else {
        shape.x = Math.min(start.x, end.x);
        shape.y = Math.min(start.y, end.y);
        shape.w = Math.max(8, Math.abs(end.x - start.x));
        shape.h = Math.max(8, Math.abs(end.y - start.y));
      }
      this.touch();
    });
  }

  /** Lines, stamps and pins count as inside when their centre is; everything else must fit entirely. */
  private isInside(item: CanvasItem, box: CanvasShape): boolean {
    const element = this.viewport().nativeElement.querySelector<HTMLElement>(`[data-id="${item.id}"]`);
    // Hidden items (e.g. pins while pins are hidden) have no size in the page, so fall back to their own.
    const w = element?.offsetWidth || item.w;
    const h = element?.offsetHeight || ('h' in item ? item.h : 0);
    const within = (x: number, y: number) => x >= box.x && y >= box.y && x <= box.x + box.w && y <= box.y + box.h;
    if (item.type === 'stamp' || item.type === 'pin' || isLine(item)) return within(item.x + w / 2, item.y + h / 2);
    return within(item.x, item.y) && within(item.x + w, item.y + h);
  }

  private begin(event: PointerEvent, move: (event: PointerEvent) => void, tap?: () => void): void {
    event.preventDefault();
    this.viewport().nativeElement.setPointerCapture(event.pointerId);
    this.gesture = { move, tap, x: event.clientX, y: event.clientY };
  }

  /** A pin whose tip (bottom middle) is at the given point, remembering the current zoom. */
  private newPin(tip: { x: number; y: number }, label: string, taskId: number | null): CanvasPin {
    return {
      id: crypto.randomUUID(),
      type: 'pin',
      x: tip.x - PIN_SIZE / 2,
      y: tip.y - PIN_SIZE,
      w: PIN_SIZE,
      h: PIN_SIZE,
      label,
      color: 'rose',
      taskId,
      zoom: this.view().zoom,
    };
  }

  private openTask(taskId: number): void {
    void this.router.navigate(['/projects', this.projectId(), 'tasks', taskId]);
  }

  private add(item: CanvasItem): void {
    this.items.update((items) => [...items, item]);
    this.save();
  }

  /** Items are mutated in place while dragging; a new array tells Angular to re-render them. */
  private touch(): void {
    this.items.update((items) => [...items]);
  }

  private focus(itemId: string, row = 0): void {
    setTimeout(() =>
      this.viewport()
        .nativeElement.querySelectorAll<HTMLTextAreaElement>(`[data-id="${itemId}"] textarea`)
        [row]?.focus(),
    );
  }

  private isBackground(event: Event): boolean {
    const target = event.target as HTMLElement;
    return target === this.viewport().nativeElement || target.matches('.world');
  }

  private toWorld(event: MouseEvent): { x: number; y: number } {
    const rect = this.viewport().nativeElement.getBoundingClientRect();
    const { x, y, zoom } = this.view();
    return { x: (event.clientX - rect.left - x) / zoom, y: (event.clientY - rect.top - y) / zoom };
  }

  private center(): { x: number; y: number } {
    const rect = this.viewport().nativeElement.getBoundingClientRect();
    const { x, y, zoom } = this.view();
    return { x: (rect.width / 2 - 100 - x) / zoom, y: (rect.height / 2 - 60 - y) / zoom };
  }

  private load(projectId: number, canvasId: number): void {
    this.flush();
    this.loaded = { projectId, canvasId };
    this.detail.set(null);
    this.api.canvas(projectId, canvasId).subscribe({
      next: (detail) => {
        const { canvas } = detail;
        this.detail.set(detail);
        this.view.set(canvas.view ?? DEFAULT_VIEW);
        // Items saved by the previous canvas version have no width and are dropped.
        this.items.set((canvas.items ?? []).filter((item) => typeof item.w === 'number'));
        const focusPin = this.focusPin();
        if (focusPin) this.centerOnPin(focusPin);
      },
      error: () => this.error.set('Canvas could not be loaded.'),
    });
  }

  /** Puts the task's pin tip in the middle of the viewport at the zoom it was dropped at, without saving. */
  private centerOnPin(pinId: string): void {
    const pin = this.items().find((item): item is CanvasPin => item.type === 'pin' && item.id === pinId);
    if (!pin) return;
    const rect = this.viewport().nativeElement.getBoundingClientRect();
    const tip = { x: pin.x + pin.w / 2, y: pin.y + pin.h };
    this.view.set({ x: rect.width / 2 - tip.x * pin.zoom, y: rect.height / 2 - tip.y * pin.zoom, zoom: pin.zoom });
  }

  private save(): void {
    if (!this.canWrite() || this.preview()) return;
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.flush(), 300);
  }

  private flush(): void {
    if (this.saveTimer === undefined) return;
    clearTimeout(this.saveTimer);
    this.saveTimer = undefined;
    const { projectId, canvasId } = this.loaded;
    this.api.saveCanvas(projectId, canvasId, { view: this.view(), items: this.items() }).subscribe({
      error: () => this.error.set('Canvas changes could not be saved.'),
    });
  }
}
