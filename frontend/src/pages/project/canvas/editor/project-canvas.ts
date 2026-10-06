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
import { Avatar } from '../../../../components/avatar/avatar';
import { Icon } from '../../../../components/icon/icon';
import {
  CANVAS_COLORS,
  CanvasColor,
  CanvasDetail,
  CanvasImageItem,
  CanvasItem,
  CanvasList,
  CanvasNote,
  CanvasPin,
  CanvasShape,
  CanvasView,
  ShapeKind,
} from '../../../../services/models';
import { AuthService } from '../../../../services/auth.service';
import { CanvasChange, CanvasLive, CanvasLock, CanvasPresence } from '../../../../services/canvas-live';
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

type Gesture = { move: (event: PointerEvent) => void; tap?: () => void; end?: () => void; x: number; y: number };
/** The timer button cycles through these (seconds); 0 removes the timer. Matches the server's options. */
const TIMER_OPTIONS = [0, 10, 30, 300, 1800];
/** A finished timer stays at 0 (bouncing) this long before it disappears; dice results show this long too. */
const TIMER_DONE_MS = 3000;
const DICE_SHOWN_MS = 3000;

/** Someone else's lock stops counting this long after we last heard from them. */
const LOCK_TIMEOUT_MS = 60_000;
const PIN_SIZE = 32;
/** Pasted images are shrunk to this on their longest side before upload, and shown at most this wide. */
const IMAGE_MAX_PIXELS = 2000;
const IMAGE_MAX_WIDTH = 480;

const isLine = (item: CanvasItem) => item.type === 'shape' && (item.shape === 'line' || item.shape === 'arrow');

/** Shrinks an image to at most IMAGE_MAX_PIXELS on its longest side (WebP, or PNG where WebP is unsupported). */
async function shrinkImage(file: File): Promise<{ blob: Blob; width: number; height: number }> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, IMAGE_MAX_PIXELS / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.85));
  if (!blob) throw new Error('The image could not be encoded.');
  return { blob, width: canvas.width, height: canvas.height };
}

@Component({
  selector: 'app-project-canvas',
  imports: [RouterLink, Icon, Avatar],
  host: { '[class.preview]': 'preview()', '[class.zen-mode]': 'zenMode()' },
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
  private readonly auth = inject(AuthService);
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
  protected readonly zenMode = signal(false);
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
    if (!tool) return 'Double-click to add a note · paste an image · drag to pan · Ctrl+scroll to zoom';
    const verb = tool.type === 'shape' ? 'Drag to draw' : 'Click to place';
    return `${verb} ${tool.label.toLowerCase()} · Esc to stop`;
  });
  private gesture: Gesture | null = null;
  private saveTimer?: ReturnType<typeof setTimeout>;
  private loaded = { projectId: 0, canvasId: 0 };
  /** Live connection for seeing and sending edits; not used by previews. */
  private live: CanvasLive | null = null;
  /** Other people's drag locks, with when we last heard from them. */
  private readonly locks = signal<(CanvasLock & { seen: number })[]>([]);
  /** Ticks so timers count down and expired locks stop showing even when nothing else changes. */
  private readonly now = signal(Date.now());
  /** Everyone in the canvas, with timer and dice times converted to this browser's clock. */
  protected readonly people = signal<(CanvasPresence & { timerEndsAt: number | null; diceRolledAt: number | null })[]>(
    [],
  );
  private readonly me = computed(() => this.people().find((person) => person.userId === this.account.value()?.id));
  /** The timer length currently running on my profile, or 0. */
  private readonly myTimerSeconds = computed(() => {
    const me = this.me();
    return me?.timerEndsAt && me.timerEndsAt > this.now() ? (me.timerSeconds ?? 0) : 0;
  });
  private clock?: ReturnType<typeof setInterval>;
  /** Object URLs of loaded images by image id; images are fetched with auth, then shown from memory. */
  protected readonly imageUrls = signal(new Map<number, string>());
  private readonly loadingImages = new Set<number>();
  /** The note or list whose text you are writing in; it stays locked for others meanwhile. */
  private editingItemId: string | null = null;
  private readonly account = rxResource({
    params: () => (this.preview() ? undefined : true),
    stream: () => this.api.currentAccount(),
  });

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
    this.imageUrls().forEach((url) => URL.revokeObjectURL(url));
    this.flush();
    this.live?.stop();
    clearInterval(this.clock);
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
    gesture.end?.();
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
    if (this.zenMode()) {
      this.zenMode.set(false);
      return;
    }
    this.tool.set(null);
    this.menu.set(null);
  }

  protected toggleZenMode(): void {
    this.zenMode.update((enabled) => !enabled);
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
    const moving = [item];
    if (item.type === 'shape' && item.shape === 'box') {
      moving.push(...this.items().filter((other) => other !== item && this.isInside(other, item)));
    }
    // Someone else is dragging one of these: leave them alone.
    if (moving.some((entry) => this.lockedBy(entry.id))) return;
    event.stopPropagation();
    const origins = moving.map((entry) => ({ entry, x: entry.x, y: entry.y }));
    this.items.update((items) => [
      ...items.filter((entry) => !moving.includes(entry)),
      ...items.filter((entry) => moving.includes(entry)),
    ]);
    this.send({ order: this.items().map((entry) => entry.id) });
    const start = { x: event.clientX, y: event.clientY, zoom: this.view().zoom };
    const gesture = this.begin(
      event,
      (move) => {
        const dx = (move.clientX - start.x) / start.zoom;
        const dy = (move.clientY - start.y) / start.zoom;
        origins.forEach(({ entry, x, y }) => Object.assign(entry, { x: x + dx, y: y + dy }));
        this.touch();
        this.send({ upsert: moving.map(({ id, x, y }) => ({ id, x, y })) });
      },
      focus,
      () => this.restoreLock(),
    );
    // The server has the final say: if someone else locked an item first, undo this drag.
    void this.live?.lock(moving.map((entry) => entry.id)).then((locked) => {
      if (locked) return;
      if (this.gesture === gesture) this.gesture = null;
      origins.forEach(({ entry, x, y }) => Object.assign(entry, { x, y }));
      this.touch();
      this.send({ upsert: moving.map(({ id, x, y }) => ({ id, x, y })) });
    });
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
    if (!this.editable() || this.lockedBy(item.id)) return;
    event.stopPropagation();
    const start = { x: event.clientX, y: event.clientY, w: item.w, h: 'h' in item ? item.h : 0, zoom: this.view().zoom };
    const size = () => ({ id: item.id, w: item.w, ...('h' in item ? { h: item.h } : {}) });
    const gesture = this.begin(
      event,
      (move) => {
        item.w = Math.max(40, start.w + (move.clientX - start.x) / start.zoom);
        if (item.type === 'stamp' || item.type === 'pin') item.h = item.w;
      else if (item.type === 'image') item.h = item.w * (start.h / start.w);
        else if (item.type === 'shape' && !isLine(item)) item.h = Math.max(40, start.h + (move.clientY - start.y) / start.zoom);
        this.touch();
        this.send({ upsert: [size()] });
      },
      undefined,
      () => this.restoreLock(),
    );
    void this.live?.lock([item.id]).then((locked) => {
      if (locked) return;
      if (this.gesture === gesture) this.gesture = null;
      Object.assign(item, { w: start.w }, 'h' in item ? { h: start.h } : {});
      this.touch();
      this.send({ upsert: [size()] });
    });
  }

  protected setColor(item: CanvasNote | CanvasList | CanvasShape | CanvasPin, color: CanvasColor): void {
    item.color = color;
    this.touch();
    this.send({ upsert: [{ id: item.id, color }] });
    this.save();
  }

  protected sendToBack(item: CanvasItem): void {
    this.items.update((items) => [item, ...items.filter((entry) => entry !== item)]);
    this.send({ order: this.items().map((entry) => entry.id) });
    this.save();
  }

  protected remove(item: CanvasItem): void {
    this.items.update((items) => items.filter((entry) => entry !== item));
    this.send({ remove: [item.id] });
    this.save();
  }

  /** Name of the other user dragging this item, if their lock is still fresh. */
  protected lockedBy(itemId: string): string | null {
    const me = this.account.value()?.id;
    const now = this.now();
    const lock = this.locks().find(
      (entry) => entry.userId !== me && now - entry.seen < LOCK_TIMEOUT_MS && entry.itemIds.includes(itemId),
    );
    return lock?.userName ?? null;
  }

  /** Linked pins take their task's status colour instead, see statusOf. */
  protected colorOf(item: CanvasItem): CanvasColor | null {
    if (item.type === 'stamp' || item.type === 'image' || (item.type === 'pin' && item.taskId !== null)) return null;
    return item.color;
  }

  protected statusOf(item: CanvasItem): string | null {
    return item.type === 'pin' && item.taskId !== null ? (this.taskById().get(item.taskId)?.status ?? null) : null;
  }

  /**
   * Where a line's or arrow's controls sit: centred above its higher end (or its middle when level).
   * The element is an unrotated box around the line's midpoint, so the ends are found from length and angle.
   */
  protected lineControlsAt(item: CanvasItem): { x: number; y: number } | null {
    if (item.type !== 'shape' || !isLine(item)) return null;
    const angle = (item.angle * Math.PI) / 180;
    const half = item.w / 2;
    const level = Math.abs(Math.sin(angle)) < 1e-6;
    const toTop = level ? 0 : Math.sin(angle) > 0 ? -1 : 1;
    return { x: half + toTop * half * Math.cos(angle), y: item.h / 2 + toTop * half * Math.sin(angle) };
  }

  protected isLinkedPin(item: CanvasItem): boolean {
    return item.type === 'pin' && item.taskId !== null;
  }

  protected pinLabel(pin: CanvasPin): string {
    return pin.taskId !== null ? (this.taskById().get(pin.taskId)?.title ?? pin.label) : pin.label;
  }

  protected renamePin(pin: CanvasPin): void {
    const label = prompt('Pin name', pin.label)?.trim();
    if (!label) return;
    pin.label = label;
    this.touch();
    this.send({ upsert: [{ id: pin.id, label }] });
    this.save();
  }

  // ---- dice and timer ----

  protected rollDice(): void {
    this.live?.rollDice();
  }

  /** Off → 10s → 30s → 5 min → 30 min → off; each click starts the new length from now. */
  protected cycleTimer(): void {
    const next = TIMER_OPTIONS[(TIMER_OPTIONS.indexOf(this.myTimerSeconds()) + 1) % TIMER_OPTIONS.length];
    this.live?.setTimer(next);
  }

  /** Whole minutes down to 1 minute, then seconds; "0s" for a few seconds once done; null when hidden. */
  protected timerText(person: { timerEndsAt: number | null }): string | null {
    if (person.timerEndsAt === null) return null;
    const left = person.timerEndsAt - this.now();
    if (left > 60_000) return `${Math.ceil(left / 60_000)}m`;
    if (left > 0) return `${Math.ceil(left / 1000)}s`;
    return left > -TIMER_DONE_MS ? '0s' : null;
  }

  /** The latest roll, for a few seconds after it was rolled; null otherwise. */
  protected diceText(person: { dice: number | null; diceRolledAt: number | null }): string | null {
    if (person.dice === null || person.diceRolledAt === null) return null;
    return this.now() - person.diceRolledAt < DICE_SHOWN_MS ? `🎲 ${person.dice}` : null;
  }

  // ---- images ----

  /** Pasting an image (outside a text box) uploads it and places it in the middle of the view. */
  @HostListener('document:paste', ['$event'])
  protected onPaste(event: ClipboardEvent): void {
    if (!this.editable()) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest('textarea, input, [contenteditable]')) return;
    const file = [...(event.clipboardData?.items ?? [])]
      .find((entry) => entry.kind === 'file' && entry.type.startsWith('image/'))
      ?.getAsFile();
    if (!file) return;
    event.preventDefault();
    void this.pasteImage(file);
  }

  private async pasteImage(file: File): Promise<void> {
    try {
      const { blob, width, height } = await shrinkImage(file);
      const { projectId, canvasId } = this.loaded;
      this.api.uploadCanvasImage(projectId, canvasId, blob).subscribe({
        next: ({ id: imageId }) => {
          const w = Math.min(width, IMAGE_MAX_WIDTH);
          const h = w * (height / width);
          const middle = this.middle();
          this.add({ id: crypto.randomUUID(), type: 'image', imageId, x: middle.x - w / 2, y: middle.y - h / 2, w, h });
        },
        error: () => this.error.set('The image could not be uploaded.'),
      });
    } catch {
      this.error.set('That image could not be read.');
    }
  }

  /** Fetches images not loaded yet (once each) and keeps them as object URLs. */
  private loadImages(): void {
    const { projectId, canvasId } = this.loaded;
    for (const item of this.items()) {
      if (item.type !== 'image' || this.imageUrls().has(item.imageId) || this.loadingImages.has(item.imageId)) continue;
      const imageId = item.imageId;
      this.loadingImages.add(imageId);
      this.api.canvasImage(projectId, canvasId, imageId).subscribe({
        next: (blob) => this.imageUrls.update((urls) => new Map(urls).set(imageId, URL.createObjectURL(blob))),
        complete: () => this.loadingImages.delete(imageId),
        error: () => this.loadingImages.delete(imageId),
      });
    }
  }

  /** The middle of the view, in canvas units. */
  private middle(): { x: number; y: number } {
    const rect = this.viewport().nativeElement.getBoundingClientRect();
    const { x, y, zoom } = this.view();
    return { x: (rect.width / 2 - x) / zoom, y: (rect.height / 2 - y) / zoom };
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
      const moved = { x: pin.x, y: pin.y, label: pin.label, zoom: pin.zoom, area: pin.area };
      Object.assign(existing, moved);
      this.touch();
      this.send({ upsert: [{ id: existing.id, ...moved }] });
    } else {
      this.items.update((items) => [...items, pin]);
      this.send({ upsert: [pin] });
    }
    // Save before leaving: the task page asks the server for this pin as soon as it opens.
    clearTimeout(this.saveTimer);
    this.saveTimer = undefined;
    this.persist().subscribe({
      next: () => this.openTask(taskId),
      error: () => this.error.set('The pin could not be saved. Please try again.'),
    });
  }

  protected cancelPin(): void {
    const taskId = this.pinTask();
    if (taskId !== null) this.openTask(taskId);
  }

  /** Writing in a note or list locks it, so nobody else edits or moves it at the same time. */
  protected startEditing(item: CanvasNote | CanvasList, event: FocusEvent): void {
    if (this.editingItemId === item.id) return;
    this.editingItemId = item.id;
    void this.live?.lock([item.id]).then((locked) => {
      if (locked || this.editingItemId !== item.id) return;
      // Someone else got there first.
      this.editingItemId = null;
      (event.target as HTMLElement).blur();
    });
  }

  protected stopEditing(item: CanvasNote | CanvasList, event: FocusEvent): void {
    // Moving between rows of the same list keeps the lock.
    const next = event.relatedTarget as Element | null;
    if (next?.closest(`[data-id="${item.id}"]`)) return;
    if (this.editingItemId !== item.id) return;
    this.editingItemId = null;
    this.live?.unlock();
  }

  protected setText(note: CanvasNote, event: Event): void {
    note.text = (event.target as HTMLTextAreaElement).value;
    this.send({ upsert: [{ id: note.id, text: note.text }] });
    this.save();
  }

  protected setRowText(list: CanvasList, row: CanvasList['rows'][number], event: Event): void {
    row.text = (event.target as HTMLTextAreaElement).value;
    this.sendRows(list);
    this.save();
  }

  // ---- lists ----

  protected marker(list: CanvasList, index: number): string {
    const row = list.rows[index];
    if (row.marker === 'cross') return '×';
    if (row.marker === 'circle') return '•';
    return `${list.rows.slice(0, index + 1).filter((entry) => entry.marker === 'number').length}.`;
  }

  protected cycleMarker(list: CanvasList, row: CanvasList['rows'][number]): void {
    row.marker = MARKERS[(MARKERS.indexOf(row.marker) + 1) % MARKERS.length];
    this.touch();
    this.sendRows(list);
    this.save();
  }

  protected addRow(list: CanvasList, index: number): void {
    const previous = list.rows[index - 1];
    list.rows.splice(index, 0, { text: '', marker: previous?.marker === 'number' ? 'number' : 'circle' });
    this.touch();
    this.sendRows(list);
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
      this.sendRows(list);
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
      const { id, x, y, w, h, angle } = shape;
      this.send({ upsert: [{ id, x, y, w, h, angle }] });
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

  private begin(event: PointerEvent, move: (event: PointerEvent) => void, tap?: () => void, end?: () => void): Gesture {
    event.preventDefault();
    this.viewport().nativeElement.setPointerCapture(event.pointerId);
    this.gesture = { move, tap, end, x: event.clientX, y: event.clientY };
    return this.gesture;
  }

  /** A pin whose tip (bottom middle) is at the given point, remembering the current zoom. */
  private newPin(tip: { x: number; y: number }, label: string, taskId: number | null): CanvasPin {
    return {
      id: String(this.nextPinNumber()),
      type: 'pin',
      x: tip.x - PIN_SIZE / 2,
      y: tip.y - PIN_SIZE,
      w: PIN_SIZE,
      h: PIN_SIZE,
      label,
      color: 'rose',
      taskId,
      zoom: this.view().zoom,
      area: this.visibleArea(),
    };
  }

  /** The part of the canvas currently on screen, in canvas units. */
  private visibleArea(): { width: number; height: number } {
    const rect = this.viewport().nativeElement.getBoundingClientRect();
    const { zoom } = this.view();
    return { width: rect.width / zoom, height: rect.height / zoom };
  }

  /** Pins are numbered 1, 2, 3… per canvas so share links stay short (?focusPin=3). */
  private nextPinNumber(): number {
    const numbers = this.items()
      .filter((item) => item.type === 'pin')
      .map((pin) => Number(pin.id))
      .filter(Number.isInteger);
    return Math.max(0, ...numbers) + 1;
  }

  /** Pins made before pins were numbered have long random ids; give them numbers. Returns whether any changed. */
  private numberOldPins(): boolean {
    const old = this.items().filter((item) => item.type === 'pin' && !Number.isInteger(Number(item.id)));
    for (const pin of old) pin.id = String(this.nextPinNumber());
    return old.length > 0;
  }

  private openTask(taskId: number): void {
    void this.router.navigate(['/projects', this.projectId(), 'tasks', taskId]);
  }

  private add(item: CanvasItem): void {
    this.items.update((items) => [...items, item]);
    this.loadImages();
    this.send({ upsert: [item] });
    this.save();
  }

  // ---- live editing ----

  /** Ends a drag or resize lock, returning to the text lock if you are still writing in something. */
  private restoreLock(): void {
    if (this.editingItemId) void this.live?.lock([this.editingItemId]);
    else this.live?.unlock();
  }

  private send(change: CanvasChange): void {
    this.live?.send(change);
  }

  private sendRows(list: CanvasList): void {
    this.send({ upsert: [{ id: list.id, rows: list.rows }] });
  }

  /** Merges someone else's edit: changed fields of existing items, new items, removals and order. */
  private applyRemote(userId: string, change: CanvasChange): void {
    this.items.update((items) => {
      let next = change.remove ? items.filter((item) => !change.remove!.includes(item.id)) : items;
      for (const patch of change.upsert ?? []) {
        const index = next.findIndex((item) => item.id === patch.id);
        if (index >= 0) next = next.map((item, i) => (i === index ? ({ ...item, ...patch } as CanvasItem) : item));
        else if ('type' in patch) next = [...next, patch as CanvasItem];
      }
      if (change.order) {
        const rank = new Map(change.order.map((id, i) => [id, i]));
        next = [...next].sort((a, b) => (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity));
      }
      return next;
    });
    this.loadImages();
    // Hearing from someone keeps their lock fresh.
    this.locks.update((locks) => locks.map((lock) => (lock.userId === userId ? { ...lock, seen: Date.now() } : lock)));
  }

  private setPeople(people: CanvasPresence[]): void {
    const now = Date.now();
    // Refresh the clock too: comparing new end times with a tick up to 0.5s old would show 11s for a 10s timer.
    this.now.set(now);
    this.people.set(
      people.map((person) => ({
        ...person,
        timerEndsAt: person.timerRemainingMs === null ? null : now + person.timerRemainingMs,
        diceRolledAt: person.diceAgeMs === null ? null : now - person.diceAgeMs,
      })),
    );
  }

  private setLocks(locks: CanvasLock[]): void {
    const seen = Date.now();
    this.locks.set(locks.map((lock) => ({ ...lock, seen })));
  }

  private connect(projectId: number, canvasId: number): void {
    this.live?.stop();
    this.live = null;
    this.locks.set([]);
    if (this.preview()) return;
    this.people.set([]);
    this.clock ??= setInterval(() => this.now.set(Date.now()), 500);
    this.live = new CanvasLive(projectId, canvasId, this.auth, {
      changed: (userId, change) => this.applyRemote(userId, change),
      locks: (locks) => this.setLocks(locks),
      presence: (people) => this.setPeople(people),
      reconnected: () => this.fetch(),
    });
    // Without a live connection the canvas still works; edits just are not shared until saved.
    this.live.start().then((locks) => this.setLocks(locks), () => undefined);
  }

  /** Your own pan and zoom per canvas, kept in this browser so collaborators do not move each other's view. */
  private viewKey(): string {
    return `canvas-view:${this.loaded.canvasId}`;
  }

  private storedView(): CanvasView | null {
    try {
      const stored = localStorage.getItem(this.viewKey());
      return stored ? (JSON.parse(stored) as CanvasView) : null;
    } catch {
      return null;
    }
  }

  private storeView(): void {
    try {
      localStorage.setItem(this.viewKey(), JSON.stringify(this.view()));
    } catch {
      // Storage can be unavailable (e.g. private windows); the view just is not remembered.
    }
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
    this.connect(projectId, canvasId);
    this.fetch();
  }

  private fetch(): void {
    const { projectId, canvasId } = this.loaded;
    this.api.canvas(projectId, canvasId).subscribe({
      next: (detail) => {
        const { canvas } = detail;
        this.detail.set(detail);
        this.view.set((!this.preview() && this.storedView()) || canvas.view || DEFAULT_VIEW);
        // Items saved by the previous canvas version have no width and are dropped.
        this.items.set((canvas.items ?? []).filter((item) => typeof item.w === 'number'));
        if (this.numberOldPins()) this.save();
        this.loadImages();
        const focusPin = this.focusPin();
        if (focusPin) this.centerOnPin(focusPin);
      },
      error: () => this.error.set('Canvas could not be loaded.'),
    });
  }

  /** Puts the task's pin tip in the middle of the viewport at the zoom it was dropped at, without saving. */
  /** Centres the pin's tip and zooms so the area visible when it was dropped fits this window. */
  private centerOnPin(pinId: string): void {
    const pin = this.items().find((item): item is CanvasPin => item.type === 'pin' && item.id === pinId);
    if (!pin) return;
    const rect = this.viewport().nativeElement.getBoundingClientRect();
    const fitted = pin.area ? Math.min(rect.width / pin.area.width, rect.height / pin.area.height) : pin.zoom;
    const zoom = Math.min(4, Math.max(0.15, fitted));
    const tip = { x: pin.x + pin.w / 2, y: pin.y + pin.h };
    this.view.set({ x: rect.width / 2 - tip.x * zoom, y: rect.height / 2 - tip.y * zoom, zoom });
  }

  private save(): void {
    if (this.preview()) return;
    this.storeView();
    if (!this.canWrite()) return;
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.flush(), 300);
  }

  private flush(): void {
    if (this.saveTimer === undefined) return;
    clearTimeout(this.saveTimer);
    this.saveTimer = undefined;
    this.persist().subscribe({ error: () => this.error.set('Canvas changes could not be saved.') });
  }

  private persist() {
    const { projectId, canvasId } = this.loaded;
    return this.api.saveCanvas(projectId, canvasId, { view: this.view(), items: this.items() });
  }
}
