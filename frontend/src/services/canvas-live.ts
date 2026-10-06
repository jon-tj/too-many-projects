import { HubConnection, HubConnectionBuilder, HubConnectionState } from '@microsoft/signalr';
import { firstValueFrom } from 'rxjs';
import { AuthService } from './auth.service';
import { CanvasItem } from './models';

/** Changed fields of an item (with its id), or a whole new item. */
export type ItemPatch = Partial<CanvasItem> & { id: string };

/** A small edit relayed to everyone else on the canvas. */
export interface CanvasChange {
  upsert?: ItemPatch[];
  remove?: string[];
  /** The full item order, sent when items are brought forward or sent back. */
  order?: string[];
}

/** Items a user is dragging; ignored once not updated for a minute. */
export interface CanvasLock {
  userId: string;
  userName: string;
  canvasId: number;
  itemIds: string[];
}

/** Someone in the canvas. Times are relative: timerRemainingMs is negative once their timer has ended. */
export interface CanvasPresence {
  userId: string;
  name: string;
  avatar: string | null;
  timerSeconds: number | null;
  timerRemainingMs: number | null;
  dice: number | null;
  diceRollId: number | null;
  diceAgeMs: number | null;
}

export interface CanvasLiveHandlers {
  changed(userId: string, change: CanvasChange): void;
  locks(locks: CanvasLock[]): void;
  presence(people: CanvasPresence[]): void;
  /** Changes may have been missed while disconnected, so the canvas should be reloaded. */
  reconnected(): void;
}

/** Changes are batched for this long, so a drag sends ~20 small messages a second rather than one per pixel. */
const BATCH_MS = 50;

/** The live connection for one open canvas (SignalR hub at /hubs/canvas). */
export class CanvasLive {
  private readonly connection: HubConnection;
  private readonly pending = { upsert: new Map<string, ItemPatch>(), remove: new Set<string>(), order: null as string[] | null };
  private batchTimer?: ReturnType<typeof setTimeout>;
  private stopped = false;

  constructor(
    private readonly projectId: number,
    private readonly canvasId: number,
    private readonly auth: AuthService,
    handlers: CanvasLiveHandlers,
  ) {
    this.connection = new HubConnectionBuilder()
      .withUrl('/hubs/canvas', { accessTokenFactory: () => this.auth.token() ?? '' })
      .withAutomaticReconnect()
      .build();
    this.connection.on('Changed', handlers.changed);
    this.connection.on('Locks', handlers.locks);
    this.connection.on('Presence', handlers.presence);
    this.connection.onreconnected(async () => {
      handlers.locks(await this.join());
      handlers.reconnected();
    });
    // Automatic reconnects gave up (e.g. the access token expired meanwhile): start again with a fresh token.
    this.connection.onclose(() => {
      if (!this.stopped) setTimeout(() => this.start().then(handlers.locks, () => undefined), 5000);
    });
  }

  /** Connects and joins the canvas; returns the current locks. Retries once with a refreshed token. */
  async start(): Promise<CanvasLock[]> {
    try {
      await this.connection.start();
    } catch {
      await firstValueFrom(this.auth.refresh());
      await this.connection.start();
    }
    return this.join();
  }

  stop(): void {
    this.stopped = true;
    this.sendPending();
    void this.connection.stop();
  }

  /** Queues a change; changes to the same item within a batch are merged. */
  send(change: CanvasChange): void {
    for (const patch of change.upsert ?? []) {
      this.pending.upsert.set(patch.id, { ...this.pending.upsert.get(patch.id), ...patch });
    }
    change.remove?.forEach((id) => this.pending.remove.add(id));
    if (change.order) this.pending.order = change.order;
    this.batchTimer ??= setTimeout(() => this.sendPending(), BATCH_MS);
  }

  /** Locks the items before dragging them; false when someone else already holds one. */
  async lock(itemIds: string[]): Promise<boolean> {
    if (!this.connected) return true;
    return this.connection.invoke<boolean>('Lock', this.canvasId, itemIds).catch(() => true);
  }

  rollDice(): void {
    if (this.connected) void this.connection.invoke('RollDice', this.canvasId).catch(() => undefined);
  }

  /** Starts a timer of this many seconds; 0 removes it. */
  setTimer(seconds: number): void {
    if (this.connected) void this.connection.invoke('SetTimer', this.canvasId, seconds).catch(() => undefined);
  }

  unlock(): void {
    if (this.connected) void this.connection.invoke('Unlock').catch(() => undefined);
  }

  private get connected(): boolean {
    return this.connection.state === HubConnectionState.Connected;
  }

  private join(): Promise<CanvasLock[]> {
    return this.connection.invoke<CanvasLock[]>('Join', this.projectId, this.canvasId);
  }

  private sendPending(): void {
    clearTimeout(this.batchTimer);
    this.batchTimer = undefined;
    const { upsert, remove, order } = this.pending;
    if (!upsert.size && !remove.size && !order) return;
    const change: CanvasChange = {
      upsert: upsert.size ? [...upsert.values()] : undefined,
      remove: remove.size ? [...remove] : undefined,
      order: order ?? undefined,
    };
    upsert.clear();
    remove.clear();
    this.pending.order = null;
    if (this.connected) void this.connection.invoke('Change', this.canvasId, change).catch(() => undefined);
  }
}
