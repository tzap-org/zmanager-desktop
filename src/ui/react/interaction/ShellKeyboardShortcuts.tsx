import type { KeyboardEventHandler } from "react";

import { selectKeyboardCommand } from "../../../app/commands/commandRouter";
import type { CommandRouterPayload } from "../../../app/commands/commandRouter";
import type { CommandId } from "../../../app/classicCommands";
import { useZManagerActions, useZManagerSnapshot } from "../AppProviders";
import type { ZManagerReactSnapshot } from "../appRuntime";
import { useShellSearchInputRef } from "./ShellInteractionContext";

export type ShellKeyboardEventLike = Readonly<{
  key: string;
  ctrlKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  editableTarget?: boolean;
}>;

export type ShellKeyboardDecision =
  | Readonly<{ type: "ignore" }>
  | Readonly<{ type: "escape" }>
  | Readonly<{ type: "focusSearch" }>
  | Readonly<{
      type: "command";
      commandId: CommandId;
      payload?: CommandRouterPayload;
    }>;

export function decodeShellKeyboardShortcut(
  snapshot: ZManagerReactSnapshot,
  event: ShellKeyboardEventLike,
): ShellKeyboardDecision {
  if (event.key === "Escape") {
    return { type: "escape" };
  }

  if (
    snapshot.dialog.kind !== "none" ||
    snapshot.preferencesDraft ||
    event.editableTarget
  ) {
    return { type: "ignore" };
  }

  if (event.ctrlKey && event.key.toLowerCase() === "f") {
    return { type: "focusSearch" };
  }

  const selectedCount =
    event.key === "F5"
      ? snapshot.archive.view.selection.allSelected
        ? snapshot.archive.view.selection.selectedCount
        : snapshot.archive.view.selection.selectedPaths.length
      : snapshot.archive.view.selection.selectedEntryPaths.length;
  const command = selectKeyboardCommand({
    key: event.key,
    ctrlKey: Boolean(event.ctrlKey),
    altKey: Boolean(event.altKey),
    selectedCount,
  });

  return command ? { type: "command", ...command } : { type: "ignore" };
}

export function useShellKeyboardShortcutHandler(): KeyboardEventHandler<HTMLDivElement> {
  const snapshot = useZManagerSnapshot();
  const actions = useZManagerActions();
  const searchInputRef = useShellSearchInputRef();
  return (event) => {
    if (event.defaultPrevented) {
      return;
    }

    const decision = decodeShellKeyboardShortcut(snapshot, {
      key: event.key,
      ctrlKey: event.ctrlKey,
      altKey: event.altKey,
      metaKey: event.metaKey,
      shiftKey: event.shiftKey,
      editableTarget: isEditableTarget(event.target),
    });

    switch (decision.type) {
      case "escape":
        event.preventDefault();
        actions.handleKeyboardIntent({ type: "escape" });
        break;
      case "focusSearch": {
        event.preventDefault();
        const searchInput = searchInputRef.current;
        if (searchInput && !searchInput.disabled) {
          searchInput.focus();
          searchInput.select();
        } else {
          actions.handleKeyboardIntent({ type: "focusSearch" });
        }
        break;
      }
      case "command":
        event.preventDefault();
        actions.executeCommand(decision.commandId, decision.payload);
        break;
      case "ignore":
        break;
    }
  };
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  const tagName = target.tagName.toLowerCase();
  return (
    tagName === "input" ||
    tagName === "textarea" ||
    tagName === "select" ||
    target.isContentEditable
  );
}
