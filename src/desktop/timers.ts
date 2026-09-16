export type TimerHandle = unknown;

export interface TimerClock {
  setTimeout(callback: () => void, delayMs: number): TimerHandle;
  clearTimeout(handle: TimerHandle): void;
  setInterval(callback: () => void, delayMs: number): TimerHandle;
  clearInterval(handle: TimerHandle): void;
}

export interface AppTimerOptions {
  createPlanDebounceMs: number;
  archiveSearchDebounceMs: number;
  clock?: TimerClock;
}

export interface DebounceTimerAdapter {
  hasPending(): boolean;
  cancel(): void;
  schedule(callback: () => void): void;
}

export interface OneShotTimerAdapter {
  schedule(callback: () => void, delayMs: number): TimerHandle;
  cancel(handle: TimerHandle): void;
}

export interface AppTimers {
  createPlanDebounce: DebounceTimerAdapter;
  archiveSearchDebounce: DebounceTimerAdapter;
  uiDeferrals: OneShotTimerAdapter;
}

function browserTimerClock(): TimerClock {
  return {
    setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs),
    clearTimeout: (handle) => window.clearTimeout(handle as number),
    setInterval: (callback, delayMs) => window.setInterval(callback, delayMs),
    clearInterval: (handle) => window.clearInterval(handle as number),
  };
}

function createDebounceTimer(clock: TimerClock, delayMs: number): DebounceTimerAdapter {
  let timer: TimerHandle | null = null;
  const cancel = (): void => {
    if (timer === null) {
      return;
    }
    clock.clearTimeout(timer);
    timer = null;
  };

  return {
    hasPending(): boolean {
      return timer !== null;
    },
    cancel,
    schedule(callback: () => void): void {
      cancel();
      timer = clock.setTimeout(() => {
        timer = null;
        callback();
      }, delayMs);
    },
  };
}

function createOneShotTimer(clock: TimerClock): OneShotTimerAdapter {
  return {
    schedule(callback: () => void, delayMs: number): TimerHandle {
      return clock.setTimeout(callback, delayMs);
    },
    cancel(handle: TimerHandle): void {
      clock.clearTimeout(handle);
    },
  };
}

export function createAppTimers(options: AppTimerOptions): AppTimers {
  const clock = options.clock ?? browserTimerClock();

  return {
    createPlanDebounce: createDebounceTimer(clock, options.createPlanDebounceMs),
    archiveSearchDebounce: createDebounceTimer(clock, options.archiveSearchDebounceMs),
    uiDeferrals: createOneShotTimer(clock),
  };
}
