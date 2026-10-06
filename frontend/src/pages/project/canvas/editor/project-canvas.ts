import {
  Component,
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
import { RouterLink } from '@angular/router';
import { Icon } from '../../../../components/icon/icon';
import {
  CANVAS_COLORS,
  CanvasColor,
  CanvasDetail,
  CanvasItem,
  CanvasList,
  CanvasNote,
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

type Tool = { label: string } & ({ type: 'stamp'; emoji: string } | { type: 'shape'; shape: ShapeKind });

const isLine = (item: CanvasItem) => item.type === 'shape' && (item.shape === 'line' || item.shape === 'arrow');

@Component({
  selector: 'app-project-canvas',
  imports: [RouterLink, Icon],
  templateUrl: './project-canvas.html',
  styleUrl: './project-canvas.css',
})
export class ProjectCanvas implements OnDestroy {
  readonly projectId = input.required({ transform: numberAttribute });
  readonly canvasId = input.required({ transform: numberAttribute });
  private readonly api = inject(WorkspaceApi);
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
  protected readonly hint = computed(() => {
    const tool = this.tool();
    if (!tool) return 'Double-click to add a note · drag to pan · Ctrl+scroll to zoom';
    const verb = tool.type === 'stamp' ? 'Click to place' : 'Drag to draw';
    return `${verb} ${tool.label.toLowerCase()} · Esc to stop`;
  });
  private gesture: ((event: PointerEvent) => void) | null = null;
  private saveTimer?: ReturnType<typeof setTimeout>;
  private loaded = { projectId: 0, canvasId: 0 };

  constructor() {
    effect(() => {
      const projectId = this.projectId();
      const canvasId = this.canvasId();
      untracked(() => this.load(projectId, canvasId));
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
    this.gesture?.(event);
  }

  protected onPointerUp(): void {
    if (!this.gesture) return;
    this.gesture = null;
    this.save();
  }

  /** Double-clicking empty space or a shape adds a note there, like in the original board. */
  protected onDoubleClick(event: MouseEvent): void {
    if (!this.canWrite()) return;
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
    if (this.tool() || !this.canWrite() || event.button !== 0) return;
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
    });
  }

  protected resize(event: PointerEvent, item: CanvasItem): void {
    if (!this.canWrite()) return;
    event.stopPropagation();
    const start = { x: event.clientX, y: event.clientY, w: item.w, h: 'h' in item ? item.h : 0, zoom: this.view().zoom };
    this.begin(event, (move) => {
      item.w = Math.max(40, start.w + (move.clientX - start.x) / start.zoom);
      if (item.type === 'stamp') item.h = item.w;
      else if (item.type === 'shape' && !isLine(item)) item.h = Math.max(40, start.h + (move.clientY - start.y) / start.zoom);
      this.touch();
    });
  }

  protected setColor(item: CanvasNote | CanvasList | CanvasShape, color: CanvasColor): void {
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

  protected colorOf(item: CanvasItem): CanvasColor | null {
    return item.type === 'stamp' ? null : item.color;
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

  /** Lines and stamps count as inside when their centre is; everything else must fit entirely. */
  private isInside(item: CanvasItem, box: CanvasShape): boolean {
    const element = this.viewport().nativeElement.querySelector<HTMLElement>(`[data-id="${item.id}"]`);
    const w = element?.offsetWidth ?? item.w;
    const h = element?.offsetHeight ?? 0;
    const within = (x: number, y: number) => x >= box.x && y >= box.y && x <= box.x + box.w && y <= box.y + box.h;
    if (item.type === 'stamp' || isLine(item)) return within(item.x + w / 2, item.y + h / 2);
    return within(item.x, item.y) && within(item.x + w, item.y + h);
  }

  private begin(event: PointerEvent, gesture: (event: PointerEvent) => void): void {
    event.preventDefault();
    this.viewport().nativeElement.setPointerCapture(event.pointerId);
    this.gesture = gesture;
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
      },
      error: () => this.error.set('Canvas could not be loaded.'),
    });
  }

  private save(): void {
    if (!this.canWrite()) return;
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
