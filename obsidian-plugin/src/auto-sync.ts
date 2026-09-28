import { reportError } from "./models";

export interface Timer {
  set(callback: () => void, milliseconds: number): unknown;
  clear(handle: unknown): void;
}
const timer: Timer = {
  set: (callback, milliseconds) => setTimeout(callback, milliseconds),
  clear: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

// Schedule after completion so a slow sync cannot overlap the next interval.
export class AutoSync {
  private handle?: unknown;
  private generation = 0;
  private running = false;
  constructor(private task: () => Promise<void>, private clock: Timer = timer) {}

  configure(enabled: boolean, minutes: number): void {
    this.stop();
    if (!enabled) return;
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) throw new Error("自动同步间隔须为 1–1440 分钟。");
    this.schedule(this.generation, minutes * 60000);
  }

  stop(): void {
    this.generation++;
    if (this.handle !== undefined) this.clock.clear(this.handle);
    this.handle = undefined;
  }

  private schedule(generation: number, milliseconds: number): void {
    this.handle = this.clock.set(() => { void this.tick(generation, milliseconds); }, milliseconds);
  }

  private async tick(generation: number, milliseconds: number): Promise<void> {
    if (generation !== this.generation) return;
    this.handle = undefined;
    if (this.running) { this.schedule(generation, milliseconds); return; }
    this.running = true;
    try { await this.task(); }
    catch (error) { reportError("automatic sync failed", error); }
    finally {
      this.running = false;
      if (generation === this.generation) this.schedule(generation, milliseconds);
    }
  }
}
