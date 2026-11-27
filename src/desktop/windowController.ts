import {
  availableMonitors,
  getCurrentWindow,
  LogicalPosition,
  LogicalSize,
} from "@tauri-apps/api/window";
import { TauriEvent } from "@tauri-apps/api/event";
import {
  isFiniteNumber,
  normalizeStoredWindowGeometry,
  restorableWindowGeometry,
  type WindowGeometry,
  type WindowMonitorGeometry,
} from "../app/windowGeometry";
import { isDesktopRuntime as defaultIsDesktopRuntime } from "./runtime";

export const WINDOW_GEOMETRY_KEY = "zmanager.windowGeometry";

export const WINDOW_RESIZE_DIRECTIONS = [
  "North",
  "East",
  "South",
  "West",
  "NorthEast",
  "SouthEast",
  "SouthWest",
  "NorthWest",
] as const;

export type AppWindowResizeDirection = typeof WINDOW_RESIZE_DIRECTIONS[number];

export type WindowControllerStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

type LogicalDimension = {
  width: number;
  height: number;
};

type LogicalCoordinates = {
  x: number;
  y: number;
};

type WindowDimension = {
  toLogical(scaleFactor: number): LogicalDimension;
};

type WindowPosition = {
  toLogical(scaleFactor: number): LogicalCoordinates;
};

export type AppWindowHandle = {
  close(): Promise<void>;
  destroy(): Promise<void>;
  hide?(): Promise<void>;
  minimize(): Promise<void>;
  toggleMaximize(): Promise<void>;
  show(): Promise<void>;
  setFocus(): Promise<void>;
  unminimize(): Promise<void>;
  setMinSize(size: unknown): Promise<void>;
  setSize(size: unknown): Promise<void>;
  center(): Promise<void>;
  setPosition(position: unknown): Promise<void>;
  scaleFactor(): Promise<number>;
  innerSize(): Promise<WindowDimension>;
  innerPosition(): Promise<WindowPosition>;
  startResizeDragging(direction: AppWindowResizeDirection): Promise<void>;
  onCloseRequested(
    listener: (event: Readonly<{ preventDefault(): void }>) => void,
  ): Promise<() => void>;
};

export type WindowControllerDependencies = {
  getCurrentWindow: () => AppWindowHandle;
  availableMonitors: () => Promise<WindowMonitorGeometry[]>;
  createLogicalSize: (width: number, height: number) => unknown;
  createLogicalPosition: (x: number, y: number) => unknown;
  storage: WindowControllerStorage | null;
  isDesktopRuntime: () => boolean;
};

export type WindowControllerOptions = Partial<WindowControllerDependencies>;

export function listenCurrentWindowFocus(listener: () => void): Promise<() => void> {
  return getCurrentWindow().listen(TauriEvent.WINDOW_FOCUS, listener);
}

function browserStorage(): WindowControllerStorage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function readJsonFromStorage<T>(
  storage: WindowControllerStorage | null,
  key: string,
  fallback: T | null = null,
): T | null {
  if (!storage) {
    return fallback;
  }

  try {
    const raw = storage.getItem(key);
    if (!raw) {
      return fallback;
    }
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function saveJsonToStorage<T>(storage: WindowControllerStorage | null, key: string, value: T): void {
  if (!storage) {
    return;
  }

  try {
    storage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage can be unavailable in restricted environments.
  }
}

function loadWindowGeometryFromStorage(storage: WindowControllerStorage | null): WindowGeometry | null {
  return normalizeStoredWindowGeometry(readJsonFromStorage<WindowGeometry>(storage, WINDOW_GEOMETRY_KEY));
}

function saveWindowGeometryToStorage(
  storage: WindowControllerStorage | null,
  geometry: WindowGeometry,
): void {
  if (!isFiniteNumber(geometry.width) || !isFiniteNumber(geometry.height)) {
    return;
  }

  saveJsonToStorage(storage, WINDOW_GEOMETRY_KEY, geometry);
}

function createWindowControllerDependencies(
  options: WindowControllerOptions,
): WindowControllerDependencies {
  return {
    getCurrentWindow: options.getCurrentWindow ?? getCurrentWindow,
    availableMonitors: options.availableMonitors ?? availableMonitors,
    createLogicalSize: options.createLogicalSize ?? ((width, height) => new LogicalSize(width, height)),
    createLogicalPosition: options.createLogicalPosition ?? ((x, y) => new LogicalPosition(x, y)),
    storage: options.storage === undefined ? browserStorage() : options.storage,
    isDesktopRuntime: options.isDesktopRuntime ?? defaultIsDesktopRuntime,
  };
}

export function createWindowController(options: WindowControllerOptions = {}) {
  const dependencies = createWindowControllerDependencies(options);

  async function restoreNormalWindowGeometry(): Promise<boolean> {
    if (!dependencies.isDesktopRuntime()) {
      return false;
    }

    const storedGeometry = loadWindowGeometryFromStorage(dependencies.storage);
    if (!storedGeometry) {
      return false;
    }

    const currentWindow = dependencies.getCurrentWindow();
    const scaleFactor = await currentWindow.scaleFactor();
    let monitors: WindowMonitorGeometry[];
    try {
      monitors = await dependencies.availableMonitors();
    } catch {
      return false;
    }

    const geometry = restorableWindowGeometry(storedGeometry, monitors, scaleFactor);
    if (!geometry) {
      return false;
    }

    if (geometry.width && geometry.height) {
      await currentWindow.setSize(dependencies.createLogicalSize(geometry.width, geometry.height));
    }
    if (isFiniteNumber(geometry.x) && isFiniteNumber(geometry.y)) {
      await currentWindow.setPosition(dependencies.createLogicalPosition(geometry.x, geometry.y));
    }
    return true;
  }

  async function restoreNormalWindowGeometryOrCenter(): Promise<void> {
    if (!dependencies.isDesktopRuntime()) {
      return;
    }

    const restored = await restoreNormalWindowGeometry();
    if (!restored) {
      await dependencies.getCurrentWindow().center();
    }
  }

  return {
    closeCurrentWindow(): Promise<void> {
      return dependencies.getCurrentWindow().close();
    },
    destroyCurrentWindow(): Promise<void> {
      return dependencies.getCurrentWindow().destroy();
    },
    listenCloseRequested(
      listener: (event: Readonly<{ preventDefault(): void }>) => void,
    ): Promise<() => void> {
      return dependencies.getCurrentWindow().onCloseRequested(listener);
    },
    hideCurrentWindow(): Promise<void> {
      const currentWindow = dependencies.getCurrentWindow();
      return currentWindow.hide ? currentWindow.hide() : currentWindow.close();
    },
    minimizeCurrentWindow(): Promise<void> {
      return dependencies.getCurrentWindow().minimize();
    },
    toggleMaximizeCurrentWindow(): Promise<void> {
      return dependencies.getCurrentWindow().toggleMaximize();
    },
    async revealNormalWindow({ userInitiated = false, alreadyShown = false }: { userInitiated?: boolean; alreadyShown?: boolean } = {}): Promise<void> {
      if (!alreadyShown) await restoreNormalWindowGeometryOrCenter();
      if (dependencies.isDesktopRuntime()) {
        const window = dependencies.getCurrentWindow();
        await window.show();
        if (userInitiated) {
          await window.unminimize();
          await window.setFocus();
        }
      }
    },
    restoreNormalWindowGeometry,
    restoreNormalWindowGeometryOrCenter,
    async persistCurrentWindowGeometry(): Promise<void> {
      if (!dependencies.isDesktopRuntime()) {
        return;
      }

      const currentWindow = dependencies.getCurrentWindow();
      const scaleFactor = await currentWindow.scaleFactor();
      const size = (await currentWindow.innerSize()).toLogical(scaleFactor);
      const position = (await currentWindow.innerPosition()).toLogical(scaleFactor);

      saveWindowGeometryToStorage(dependencies.storage, {
        width: Math.floor(size.width),
        height: Math.floor(size.height),
        x: Math.floor(position.x),
        y: Math.floor(position.y),
        unit: "logical",
      });
    },
    beginResizeDrag(direction: AppWindowResizeDirection): Promise<void> {
      return dependencies.getCurrentWindow().startResizeDragging(direction);
    },
  };
}
