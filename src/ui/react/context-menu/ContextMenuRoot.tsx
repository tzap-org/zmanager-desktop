import { useRef } from "react";

import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "../../components/ui/popover";
import { contextMenuItems } from "../../contextMenuHelpers";
import type {
  ZManagerContextMenuIntent,
  ZManagerContextMenuItem,
} from "../appRuntime";
import { useZManagerActions, useZManagerSnapshot } from "../AppProviders";
import { useExtractPasswordState } from "../archive/ExtractPasswordContext";

export function ContextMenuRoot() {
  const snapshot = useZManagerSnapshot();
  const actions = useZManagerActions();
  const passwordState = useExtractPasswordState();
  const menu = snapshot.contextMenu;
  const menuRef = useRef<HTMLDivElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const menuX = menu.visible ? menu.x : 0;
  const menuY = menu.visible ? menu.y : 0;
  const menuItems = menu.visible ? menu.items : [];
  const virtualAnchorRef = useRef({
    getBoundingClientRect: () => DOMRect.fromRect(),
  });
  virtualAnchorRef.current.getBoundingClientRect = () =>
    DOMRect.fromRect({ x: menuX, y: menuY });

  return (
    <Popover
      open={menu.visible}
      onOpenChange={(open) => {
        if (!open) actions.handleContextMenuIntent({ type: "hide" });
      }}
    >
      <PopoverAnchor virtualRef={virtualAnchorRef} />
      <PopoverContent
        id="context-menu"
        ref={menuRef}
        className="min-w-[220px] w-auto rounded-lg border border-slate-200 bg-white p-1 text-[13px] text-slate-950 shadow-xl dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
        role="menu"
        align="start"
        side="right"
        sideOffset={0}
        collisionPadding={4}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          const menuElement = menuRef.current;
          const active = menuElement?.ownerDocument.activeElement;
          returnFocusRef.current =
            active instanceof HTMLElement && !menuElement?.contains(active)
              ? active
              : null;
          if (menuElement) contextMenuItems(menuElement)[0]?.focus();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          restoreContextMenuFocus(menuRef.current, returnFocusRef.current);
          returnFocusRef.current = null;
        }}
        onInteractOutside={() =>
          actions.handleContextMenuIntent({ type: "hide" })
        }
        onKeyDown={(event) => {
          if (
            handleContextMenuKeyboard(event.currentTarget, event.nativeEvent)
          ) {
            actions.handleContextMenuIntent({ type: "hide" });
          }
        }}
      >
        <ContextMenuItemList
          items={menuItems}
          onIntent={(intent) => {
            if (intent.type === "action" && intent.payload.action === "extract-here") {
              actions.handleContextMenuIntent({ ...intent, extractPassword: passwordState.password });
              passwordState.reset();
              return;
            }
            actions.handleContextMenuIntent(intent);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

export function ContextMenuItemList({
  items,
  onIntent,
}: Readonly<{
  items: readonly ZManagerContextMenuItem[];
  onIntent(intent: ZManagerContextMenuIntent): void;
}>) {
  return items.map((item, index) =>
    renderContextMenuItem(item, index, onIntent),
  );
}

function renderContextMenuItem(
  item: ZManagerContextMenuItem,
  index: number,
  onIntent: (intent: ZManagerContextMenuIntent) => void,
) {
  switch (item.type) {
    case "action":
      return (
        <button
          key={contextMenuItemKey(item, index)}
          type="button"
          role="menuitem"
          className="flex min-h-7 w-full items-center justify-start rounded border-0 bg-transparent px-7 py-1 text-left hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 disabled:opacity-50 dark:hover:bg-slate-800"
          data-context-action={item.payload.action}
          data-column-id={item.payload.columnId}
          data-archive-path={item.payload.archivePath}
          data-entry-path={item.payload.entryPath}
          data-source-path={item.payload.sourcePath}
          disabled={item.disabled}
          aria-disabled={item.disabled ? true : undefined}
          title={item.title ?? item.disabledReason}
          onClick={(event) => {
            event.preventDefault();
            onIntent({ type: "action", payload: item.payload });
          }}
        >
          <span>{item.label}</span>
        </button>
      );
    case "checkbox":
      return (
        <button
          key={contextMenuItemKey(item, index)}
          type="button"
          className="relative flex min-h-7 w-full items-center justify-start rounded border-0 bg-transparent px-7 py-1 text-left hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 disabled:opacity-50 dark:hover:bg-slate-800"
          role="menuitemcheckbox"
          data-context-action={item.payload.action}
          data-column-id={item.payload.columnId}
          data-archive-path={item.payload.archivePath}
          data-entry-path={item.payload.entryPath}
          data-source-path={item.payload.sourcePath}
          aria-checked={item.checked ? "true" : "false"}
          disabled={item.disabled}
          aria-disabled={item.disabled ? true : undefined}
          title={item.title ?? item.disabledReason}
          onClick={(event) => {
            event.preventDefault();
            onIntent({ type: "action", payload: item.payload });
          }}
        >
          <span className="absolute left-3" aria-hidden="true">
            {item.checked ? "✓" : null}
          </span>
          <span>{item.label}</span>
        </button>
      );
    case "caption":
      return (
        <div
          key={contextMenuItemKey(item, index)}
          className="px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400"
        >
          {item.label}
        </div>
      );
    case "separator":
      return (
        <div
          key={contextMenuItemKey(item, index)}
          className="my-1 h-px bg-slate-200 dark:bg-slate-700"
          role="separator"
        />
      );
  }
}

function contextMenuItemKey(
  item: ZManagerContextMenuItem,
  index: number,
): string {
  switch (item.type) {
    case "action":
    case "checkbox":
      return `${item.type}:${item.payload.action}:${index}`;
    case "caption":
      return `${item.type}:${item.label}:${index}`;
    case "separator":
      return `${item.type}:${index}`;
  }
}

function handleContextMenuKeyboard(
  contextMenu: HTMLElement,
  event: KeyboardEvent,
): boolean {
  const items = contextMenuItems(contextMenu);
  if (items.length === 0) {
    return false;
  }

  const active = contextMenu.ownerDocument.activeElement;
  const activeIndex = Math.max(0, items.indexOf(active as HTMLElement));
  let nextIndex: number | null = null;
  if (event.key === "ArrowDown") {
    nextIndex = (activeIndex + 1) % items.length;
  } else if (event.key === "ArrowUp") {
    nextIndex = (activeIndex - 1 + items.length) % items.length;
  } else if (event.key === "Home") {
    nextIndex = 0;
  } else if (event.key === "End") {
    nextIndex = items.length - 1;
  } else if (event.key === "Escape" || event.key === "Tab") {
    event.preventDefault();
    event.stopPropagation();
    return true;
  } else if (
    event.key === "Enter" ||
    event.key === " " ||
    event.key === "Spacebar"
  ) {
    event.preventDefault();
    event.stopPropagation();
    items[activeIndex]?.click();
    return false;
  }

  if (nextIndex !== null) {
    event.preventDefault();
    items[nextIndex]?.focus();
  }

  return false;
}

function restoreContextMenuFocus(
  contextMenu: HTMLElement | null,
  restoreTarget: HTMLElement | null,
) {
  if (!contextMenu || !restoreTarget) {
    return;
  }

  const active = contextMenu.ownerDocument.activeElement;
  if (active instanceof HTMLElement && contextMenu.contains(active)) {
    restoreTarget.focus();
  }
}
