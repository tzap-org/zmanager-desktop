import {
  COMMAND_DEFINITIONS,
  UNSUPPORTED_OPERATION_MESSAGE,
  type CommandId,
  type CommandStateMap,
} from "../classicCommands";
import type { ContextMenuAction } from "./contextMenuModel";

export type RoutedExtractMode = "archive" | "selection";
export type RoutedExtractDestination = "dialog" | "here";
export type RoutedSortKey = "name" | "kind" | "modified" | "size";
export type RoutedInfoTarget = "current" | "archive" | "context";
export type RoutedOpenSource = "dialog" | "clipboard" | "path";
export type RoutedMenuAnchor = Readonly<{ x: number; y: number }>;

export type CommandRouterPayload = {
  readonly extractMode?: RoutedExtractMode;
  readonly extractDestination?: RoutedExtractDestination;
  readonly extractPassword?: string;
  readonly sortKey?: RoutedSortKey;
  readonly infoTarget?: RoutedInfoTarget;
  readonly archivePath?: string;
  readonly openSource?: RoutedOpenSource;
  readonly entryPath?: string;
  readonly addSourcesMenuAnchor?: RoutedMenuAnchor;
};

export type KeyboardCommandInput = {
  readonly key: string;
  readonly ctrlKey?: boolean;
  readonly altKey?: boolean;
  readonly selectedCount?: number;
};

export type RoutedCommand = {
  readonly commandId: CommandId;
  readonly payload?: CommandRouterPayload;
};

export type ContextCommandOptions = {
  readonly archivePath?: string;
  readonly entryPath?: string;
  readonly extractMode?: RoutedExtractMode;
};

export type CommandExecutionStatus = "executed" | "disabled" | "unsupported";

export type CommandExecutionResult = {
  readonly commandId: CommandId;
  readonly status: CommandExecutionStatus;
  readonly reason?: string;
};

export type CommandRouterEffects = {
  openArchive: (source: RoutedOpenSource, archivePath?: string) => void | Promise<void>;
  closeArchive: () => void | Promise<void>;
  addSources: (anchor?: RoutedMenuAnchor) => void | Promise<void>;
  selectAll: () => void | Promise<void>;
  deselectAll: () => void | Promise<void>;
  invertSelection: () => void | Promise<void>;
  selectByType: () => void | Promise<void>;
  deselectByType: () => void | Promise<void>;
  openRoot: () => void | Promise<void>;
  upOneLevel: () => void | Promise<void>;
  openInside: () => void | Promise<void>;
  openOutside: () => void | Promise<void>;
  extract: (mode: RoutedExtractMode, destination: RoutedExtractDestination, password?: string) => void | Promise<void>;
  test: () => void | Promise<void>;
  view: () => void | Promise<void>;
  copySelectedPaths: () => void | Promise<void>;
  info: (target: RoutedInfoTarget, entryPath?: string) => void | Promise<void>;
  refresh: () => void | Promise<void>;
  exit: () => void | Promise<void>;
  detailsView: () => void | Promise<void>;
  sort: (key: RoutedSortKey) => void | Promise<void>;
  toggleToolbarLabels: () => void | Promise<void>;
  options: () => void | Promise<void>;
  about: () => void | Promise<void>;
  toggleFlatView: () => void | Promise<void>;
  deleteTempFiles: () => void | Promise<void>;
  reportDisabled: (commandId: CommandId, reason?: string) => void | Promise<void>;
  reportUnsupported: (commandId: CommandId, reason: string) => void | Promise<void>;
};

export type CommandRouterOptions = {
  readonly getCommandState: () => CommandStateMap;
  readonly effects: CommandRouterEffects;
};

export type CommandRouter = {
  run: (commandId: CommandId, payload?: CommandRouterPayload) => CommandExecutionResult;
};

export function selectKeyboardCommand(input: KeyboardCommandInput): RoutedCommand | null {
  const key = input.key;
  const lowerKey = key.toLowerCase();

  if (input.ctrlKey && lowerKey === "o") {
    return { commandId: "open" };
  }

  if (input.ctrlKey && lowerKey === "n") {
    return { commandId: "add" };
  }

  if (input.ctrlKey && lowerKey === "a") {
    return { commandId: "selectAll" };
  }

  if (key === "F5") {
    return { commandId: "extract", payload: { extractMode: input.selectedCount ? "selection" : "archive" } };
  }

  if (input.ctrlKey && lowerKey === "r") {
    return { commandId: "refresh" };
  }

  if (key === "Backspace" || (input.altKey && key === "ArrowUp")) {
    return { commandId: "upOneLevel" };
  }

  if (key === "Enter") {
    return input.selectedCount === 1 ? { commandId: "view" } : null;
  }

  if (key === "F3") {
    return { commandId: "view" };
  }

  if (input.altKey && key === "Enter") {
    return { commandId: "info" };
  }

  return null;
}

export function selectDetailsCommand(action?: string): RoutedCommand | null {
  switch (action) {
    case "open-archive":
      return { commandId: "open" };
    case "preview":
      return { commandId: "view" };
    case "extract-selected":
      return { commandId: "extract", payload: { extractMode: "selection" } };
    case "test-selected":
      return { commandId: "test" };
    case "properties":
      return { commandId: "properties" };
    case "archive-info":
      return { commandId: "info", payload: { infoTarget: "archive" } };
    default:
      return null;
  }
}

export function selectTreeCommand(action?: string): RoutedCommand | null {
  switch (action) {
    case "open":
      return { commandId: "open" };
    default:
      return null;
  }
}

export function selectContextCommand(action?: ContextMenuAction | string, options: ContextCommandOptions = {}): RoutedCommand | null {
  switch (action) {
    case "open-archive":
      return { commandId: "open" };
    case "paste-archive-path":
      return { commandId: "open", payload: { openSource: "clipboard" } };
    case "open-recent-archive":
      return options.archivePath
        ? { commandId: "open", payload: { openSource: "path", archivePath: options.archivePath } }
        : null;
    case "open-entry":
      return { commandId: "view" };
    case "open-outside":
      return { commandId: "openOutside" };
    case "select-by-type":
      return { commandId: "selectByType" };
    case "deselect-by-type":
      return { commandId: "deselectByType" };
    case "extract":
      return { commandId: "extract", payload: { extractMode: "selection" } };
    case "extract-here":
      return {
        commandId: "extract",
        payload: {
          extractMode: options.extractMode ?? "archive",
          extractDestination: "here",
        },
      };
    case "test":
      return { commandId: "test" };
    case "info":
      return { commandId: "info", payload: { infoTarget: "context", entryPath: options.entryPath } };
    default:
      return null;
  }
}

function executed(commandId: CommandId): CommandExecutionResult {
  return { commandId, status: "executed" };
}

function disabled(commandId: CommandId, reason?: string): CommandExecutionResult {
  return reason ? { commandId, status: "disabled", reason } : { commandId, status: "disabled" };
}

function unsupported(commandId: CommandId, reason: string): CommandExecutionResult {
  return { commandId, status: "unsupported", reason };
}

export function createCommandRouter(options: CommandRouterOptions): CommandRouter {
  const { effects, getCommandState } = options;

  function reportUnsupported(commandId: CommandId): CommandExecutionResult {
    void effects.reportUnsupported(commandId, UNSUPPORTED_OPERATION_MESSAGE);
    return unsupported(commandId, UNSUPPORTED_OPERATION_MESSAGE);
  }

  return {
    run(commandId, payload = {}) {
      const definition = COMMAND_DEFINITIONS[commandId];
      if (!definition || definition.unsupported) {
        return reportUnsupported(commandId);
      }

      const state = getCommandState()[commandId];
      if (!state?.enabled) {
        void effects.reportDisabled(commandId, state?.reason);
        return disabled(commandId, state?.reason);
      }

      switch (commandId) {
        case "open":
          void effects.openArchive(payload.openSource ?? "dialog", payload.archivePath);
          return executed(commandId);
        case "closeArchive":
          void effects.closeArchive();
          return executed(commandId);
        case "add":
          void effects.addSources(payload.addSourcesMenuAnchor);
          return executed(commandId);
        case "selectAll":
          void effects.selectAll();
          return executed(commandId);
        case "deselectAll":
          void effects.deselectAll();
          return executed(commandId);
        case "invertSelection":
          void effects.invertSelection();
          return executed(commandId);
        case "selectByType":
          void effects.selectByType();
          return executed(commandId);
        case "deselectByType":
          void effects.deselectByType();
          return executed(commandId);
        case "openRoot":
          void effects.openRoot();
          return executed(commandId);
        case "upOneLevel":
          void effects.upOneLevel();
          return executed(commandId);
        case "openInside":
          void effects.openInside();
          return executed(commandId);
        case "openOutside":
          void effects.openOutside();
          return executed(commandId);
        case "extract":
          void effects.extract(payload.extractMode ?? "archive", payload.extractDestination ?? "dialog", payload.extractPassword);
          return executed(commandId);
        case "test":
          void effects.test();
          return executed(commandId);
        case "view":
          void effects.view();
          return executed(commandId);
        case "copy":
          void effects.copySelectedPaths();
          return executed(commandId);
        case "info":
        case "properties":
          void effects.info(payload.infoTarget ?? "current", payload.entryPath);
          return executed(commandId);
        case "refresh":
          void effects.refresh();
          return executed(commandId);
        case "exit":
          void effects.exit();
          return executed(commandId);
        case "detailsView":
          void effects.detailsView();
          return executed(commandId);
        case "sortName":
          void effects.sort("name");
          return executed(commandId);
        case "sortType":
          void effects.sort("kind");
          return executed(commandId);
        case "sortDate":
          void effects.sort("modified");
          return executed(commandId);
        case "sortSize":
          void effects.sort("size");
          return executed(commandId);
        case "showButtonText":
          void effects.toggleToolbarLabels();
          return executed(commandId);
        case "options":
          void effects.options();
          return executed(commandId);
        case "about":
          void effects.about();
          return executed(commandId);
        case "flatView":
          void effects.toggleFlatView();
          return executed(commandId);
        case "deleteTempFiles":
          void effects.deleteTempFiles();
          return executed(commandId);
        case "copyTo":
        case "standardToolbar":
          return reportUnsupported(commandId);
      }

      return reportUnsupported(commandId);
    },
  };
}
