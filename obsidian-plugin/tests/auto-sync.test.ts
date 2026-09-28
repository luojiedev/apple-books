import { test } from "node:test";
import assert from "node:assert/strict";
import { AutoSync, type Timer } from "../src/auto-sync.ts";

class Clock implements Timer {
  callbacks = new Map<number, () => void>();
  delay = 0; id = 0;
  set(callback: () => void, milliseconds: number): number { this.delay = milliseconds; this.callbacks.set(++this.id, callback); return this.id; }
  clear(handle: unknown): void { this.callbacks.delete(handle as number); }
  fire(): void { const [id, callback] = [...this.callbacks][0]!; this.callbacks.delete(id); callback(); }
}
const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };

test("automatic sync is opt-in and reschedules only after the previous task finishes", async () => {
  const clock = new Clock(); let calls = 0, release!: () => void;
  const scheduler = new AutoSync(async () => { calls++; await new Promise<void>(resolve => { release = resolve; }); }, clock);
  scheduler.configure(false, 5); assert.equal(clock.callbacks.size, 0);
  scheduler.configure(true, 5); assert.equal(clock.delay, 300000);
  clock.fire(); assert.equal(calls, 1); assert.equal(clock.callbacks.size, 0);
  release(); await flush(); assert.equal(clock.callbacks.size, 1);
  scheduler.stop(); assert.equal(clock.callbacks.size, 0);
});

test("disabling during a running sync prevents rescheduling and settings changes do not overlap", async () => {
  const clock = new Clock(); let calls = 0, release!: () => void;
  const scheduler = new AutoSync(async () => { calls++; await new Promise<void>(resolve => { release = resolve; }); }, clock);
  scheduler.configure(true, 1); clock.fire();
  scheduler.configure(true, 2); clock.fire(); assert.equal(calls, 1); assert.equal(clock.callbacks.size, 1);
  scheduler.stop(); release(); await flush(); assert.equal(clock.callbacks.size, 0);
});

test("automatic sync retries after errors and rejects invalid intervals", async () => {
  const clock = new Clock(); const scheduler = new AutoSync(async () => { throw new Error("offline"); }, clock);
  assert.throws(() => scheduler.configure(true, 0), /1–1440/);
  scheduler.configure(true, 3); clock.fire(); await flush();
  assert.equal(clock.callbacks.size, 1); assert.equal(clock.delay, 180000); scheduler.stop();
});
