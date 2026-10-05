import { Component, ElementRef, HostListener, OnDestroy, OnInit, computed, input, numberAttribute, signal, viewChild } from '@angular/core';
import { NgStyle } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Icon } from '../../../components/icon/icon';
import { CanvasDocument, CanvasItem, CanvasNote, CanvasShape, EMPTY_CANVAS } from '../../../services/models';
import { WorkspaceApi } from '../../../services/workspace-api';

type CanvasTool = 'select' | 'pan' | 'note' | 'rectangle' | 'circle' | 'diamond' | 'arrow';
type Gesture =
  | { type: 'pan'; pointerX: number; pointerY: number; viewX: number; viewY: number }
  | { type: 'move'; itemId: string; offsetX: number; offsetY: number };

@Component({
  selector: 'app-project-canvas',
  imports: [FormsModule, NgStyle, Icon],
  templateUrl: './project-canvas.html',
  styleUrl: './project-canvas.css',
})
export class ProjectCanvas implements OnInit, OnDestroy {
  readonly projectId = input.required({ transform: numberAttribute });
  protected readonly state = signal<CanvasDocument>(structuredClone(EMPTY_CANVAS));
  protected readonly tool = signal<CanvasTool>('select');
  protected readonly selectedId = signal<string | null>(null);
  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly error = signal('');
  protected readonly worldTransform = computed(() => {
    const { x, y, zoom } = this.state().view;
    return `translate(${x}px, ${y}px) scale(${zoom})`;
  });
  protected readonly gridStyle = computed(() => {
    const { x, y, zoom } = this.state().view;
    const size = 28 * zoom;
    return {
      'background-size': `${size}px ${size}px`,
      'background-position': `${x}px ${y}px`,
    };
  });
  protected readonly zoomLabel = computed(() => `${Math.round(this.state().view.zoom * 100)}%`);
  protected readonly viewport = viewChild<ElementRef<HTMLElement>>('viewport');
  protected get gestureIsPanning(): boolean { return this.gesture?.type === 'pan'; }
  private gesture: Gesture | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly api: WorkspaceApi) {}

  ngOnInit(): void {
    this.api.canvas(this.projectId()).subscribe({
      next: (response) => {
        const canvas = response.canvas;
        this.state.set({
          view: { x: canvas.view?.x ?? 80, y: canvas.view?.y ?? 70, zoom: canvas.view?.zoom ?? 1 },
          items: Array.isArray(canvas.items) ? canvas.items.map((item) => ({
            ...item,
            color: item.type === 'note'
              ? 'var(--primary-active-surface)'
              : 'var(--secondary-surface)',
          })) : [],
        });
        this.loading.set(false);
      },
      error: () => { this.error.set('Canvas could not be loaded.'); this.loading.set(false); },
    });
  }

  ngOnDestroy(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    if (this.saveTimer) this.persist();
  }

  protected chooseTool(tool: CanvasTool): void { this.tool.set(tool); }

  protected onCanvasPointerDown(event: PointerEvent): void {
    if (event.button !== 0 || !this.viewport()) return;
    if (this.tool() === 'note' || ['rectangle', 'circle', 'diamond', 'arrow'].includes(this.tool())) {
      const point = this.toWorld(event);
      const item = this.createItem(this.tool(), point.x, point.y);
      this.state.update((state) => ({ ...state, items: [...state.items, item] }));
      this.selectedId.set(item.id);
      this.tool.set('select');
      this.gesture = { type: 'move', itemId: item.id, offsetX: 0, offsetY: 0 };
      this.capture(event);
      this.scheduleSave();
      event.preventDefault();
      return;
    }

    this.selectedId.set(null);
    const view = this.state().view;
    this.gesture = { type: 'pan', pointerX: event.clientX, pointerY: event.clientY, viewX: view.x, viewY: view.y };
    this.capture(event);
  }

  protected onItemPointerDown(event: PointerEvent, item: CanvasItem): void {
    event.stopPropagation();
    if (event.button !== 0) return;
    this.selectedId.set(item.id);
    const point = this.toWorld(event);
    this.gesture = { type: 'move', itemId: item.id, offsetX: point.x - item.x, offsetY: point.y - item.y };
    this.capture(event);
  }

  protected onPointerMove(event: PointerEvent): void {
    if (!this.gesture) return;
    if (this.gesture.type === 'pan') {
      const gesture = this.gesture;
      this.updateView(gesture.viewX + event.clientX - gesture.pointerX, gesture.viewY + event.clientY - gesture.pointerY);
    } else {
      const point = this.toWorld(event);
      const { itemId, offsetX, offsetY } = this.gesture;
      this.state.update((state) => ({
        ...state,
        items: state.items.map((item) => item.id === itemId
          ? { ...item, x: point.x - offsetX, y: point.y - offsetY }
          : item),
      }));
    }
    this.scheduleSave();
  }

  protected onPointerUp(event: PointerEvent): void {
    if (!this.gesture) return;
    this.gesture = null;
    const element = event.currentTarget as HTMLElement;
    if (element.hasPointerCapture(event.pointerId)) element.releasePointerCapture(event.pointerId);
    this.scheduleSave();
  }

  protected onWheel(event: WheelEvent): void {
    event.preventDefault();
    const view = this.state().view;
    if (event.ctrlKey || event.metaKey) {
      const rect = this.viewport()?.nativeElement.getBoundingClientRect();
      if (!rect) return;
      const screenX = event.clientX - rect.left;
      const screenY = event.clientY - rect.top;
      const worldX = (screenX - view.x) / view.zoom;
      const worldY = (screenY - view.y) / view.zoom;
      const zoom = this.clampZoom(view.zoom * Math.exp(-event.deltaY * 0.004));
      this.state.update((state) => ({
        ...state,
        view: { x: screenX - worldX * zoom, y: screenY - worldY * zoom, zoom },
      }));
    } else {
      this.updateView(view.x - event.deltaX, view.y - event.deltaY);
    }
    this.scheduleSave();
  }

  protected zoomBy(factor: number): void {
    const element = this.viewport()?.nativeElement;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    const view = this.state().view;
    const screenX = rect.width / 2;
    const screenY = rect.height / 2;
    const worldX = (screenX - view.x) / view.zoom;
    const worldY = (screenY - view.y) / view.zoom;
    const zoom = this.clampZoom(view.zoom * factor);
    this.state.update((state) => ({ ...state, view: { x: screenX - worldX * zoom, y: screenY - worldY * zoom, zoom } }));
    this.scheduleSave();
  }

  protected resetView(): void {
    this.state.update((state) => ({ ...state, view: { x: 80, y: 70, zoom: 1 } }));
    this.scheduleSave();
  }

  protected updateNote(itemId: string, text: string): void {
    this.state.update((state) => ({
      ...state,
      items: state.items.map((item) => item.id === itemId && item.type === 'note' ? { ...item, text } : item),
    }));
    this.scheduleSave();
  }

  protected deleteSelected(): void {
    const id = this.selectedId();
    if (!id) return;
    this.state.update((state) => ({ ...state, items: state.items.filter((item) => item.id !== id) }));
    this.selectedId.set(null);
    this.scheduleSave();
  }

  protected trackItem(_: number, item: CanvasItem): string { return item.id; }

  @HostListener('window:keydown', ['$event'])
  protected onKeyDown(event: KeyboardEvent): void {
    const target = event.target as HTMLElement;
    if ((event.key === 'Delete' || event.key === 'Backspace') && !['INPUT', 'TEXTAREA'].includes(target.tagName)) {
      this.deleteSelected();
    }
    if (event.key === 'Escape') { this.selectedId.set(null); this.tool.set('select'); }
  }

  private createItem(tool: CanvasTool, x: number, y: number): CanvasItem {
    const id = crypto.randomUUID();
    if (tool === 'note') {
      return { id, type: 'note', x, y, text: 'A thought worth keeping…', color: 'var(--primary-active-surface)' };
    }
    return {
      id,
      type: 'shape',
      shape: tool as CanvasShape['shape'],
      x,
      y,
      color: 'var(--secondary-surface)',
    };
  }

  private toWorld(event: PointerEvent): { x: number; y: number } {
    const rect = this.viewport()!.nativeElement.getBoundingClientRect();
    const { x, y, zoom } = this.state().view;
    return { x: (event.clientX - rect.left - x) / zoom, y: (event.clientY - rect.top - y) / zoom };
  }

  private updateView(x: number, y: number): void {
    this.state.update((state) => ({ ...state, view: { ...state.view, x, y } }));
  }

  private clampZoom(zoom: number): number { return Math.max(0.35, Math.min(2.5, zoom)); }

  private capture(event: PointerEvent): void {
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }

  private scheduleSave(): void {
    this.saving.set(true);
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.persist(), 450);
  }

  private persist(): void {
    this.saveTimer = null;
    this.api.saveCanvas(this.projectId(), this.state()).subscribe({
      next: () => { this.saving.set(false); this.error.set(''); },
      error: () => { this.saving.set(false); this.error.set('Canvas changes could not be saved.'); },
    });
  }
}