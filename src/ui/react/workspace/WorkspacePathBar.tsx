import { useEffect, useState, type ReactNode } from "react";
import { useShellSearchInputRef } from "../interaction/ShellInteractionContext";

export type WorkspacePathCrumb = Readonly<{
  name: string;
  path: string;
}>;

export type WorkspacePathSearch = Readonly<{
  query: string;
  disabled: boolean;
  clearDisabled: boolean;
  resultText: string;
  entriesLabel: string;
  placeholder: string;
  buttonLabel: string;
  clearLabel: string;
  clearAriaLabel: string;
  onChange?: (query: string) => void;
  onSubmit?: (query: string) => void;
  onClear?: () => void;
}>;

export type WorkspacePathBarProps = Readonly<{
  ariaLabel: string;
  locationLabel: string;
  pathAriaLabel: string;
  pathInputId?: string;
  displayPath: string;
  pathDisabled: boolean;
  pathReadOnly?: boolean;
  pathPlaceholder?: string;
  pathSuggestionsId?: string;
  pathSuggestions?: readonly string[];
  crumbs: readonly WorkspacePathCrumb[];
  crumbsHidden: boolean;
  emptyCrumbsText: string;
  pathAccessory?: ReactNode;
  search: WorkspacePathSearch;
  onPathChange?: (path: string) => void;
  onCrumbClick?: (path: string) => void;
}>;

export function WorkspacePathBar({
  ariaLabel,
  locationLabel,
  pathAriaLabel,
  pathInputId = "path-field",
  displayPath,
  pathDisabled,
  pathReadOnly = true,
  pathPlaceholder,
  pathSuggestionsId,
  pathSuggestions = [],
  crumbs,
  crumbsHidden,
  emptyCrumbsText,
  pathAccessory,
  search,
  onPathChange,
  onCrumbClick,
}: WorkspacePathBarProps) {
  return (
    <section
      className="flex h-11 min-h-11 shrink-0 items-center gap-2 border-b border-slate-200 bg-white px-3 py-1.5 dark:border-slate-800 dark:bg-slate-900"
      data-shell-chrome="path"
      aria-label={ariaLabel}
    >
      <label className="flex min-w-0 flex-[0_1_32rem] items-center gap-2">
        <span className="shrink-0 text-xs font-semibold text-slate-600 dark:text-slate-300">
          {locationLabel}
        </span>
        <span className="flex min-w-0 flex-1 items-center">
          <input
            id={pathInputId}
            className="h-8 min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-2 text-sm shadow-inner outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-950"
            type="text"
            aria-label={pathAriaLabel}
            value={displayPath}
            readOnly={pathReadOnly}
            disabled={pathDisabled}
            placeholder={pathPlaceholder}
            list={pathSuggestionsId}
            onChange={(event) => onPathChange?.(event.currentTarget.value)}
          />
          {pathSuggestionsId ? (
            <datalist id={pathSuggestionsId}>
              {pathSuggestions.map((suggestion) => (
                <option value={suggestion} key={suggestion} />
              ))}
            </datalist>
          ) : null}
        </span>
      </label>
      {pathAccessory ? (
        <div className="flex min-w-0 items-center gap-2">{pathAccessory}</div>
      ) : null}
      <div
        id="path-crumbs"
        className="hidden min-w-0 flex-[2_1_0%] items-center gap-1 overflow-hidden text-xs text-slate-500 min-[900px]:flex dark:text-slate-400"
        aria-live="polite"
        hidden={crumbsHidden}
      >
        {crumbsHidden
          ? emptyCrumbsText
          : crumbs.map((crumb, index) => (
              <PathCrumb
                key={`${crumb.path}-${index}`}
                name={crumb.name}
                path={crumb.path}
                showSeparator={index > 0}
                onClick={onCrumbClick}
              />
            ))}
      </div>
      <WorkspaceSearchControls search={search} />
    </section>
  );
}

function PathCrumb({
  name,
  path,
  showSeparator,
  onClick,
}: Readonly<{
  name: string;
  path: string;
  showSeparator: boolean;
  onClick?: (path: string) => void;
}>) {
  return (
    <>
      {showSeparator ? <span aria-hidden="true">&gt;</span> : null}
      <button
        className="min-h-7 truncate rounded px-1.5 hover:bg-slate-100 hover:text-slate-950 dark:hover:bg-slate-800 dark:hover:text-white"
        type="button"
        data-crumb-path={path}
        aria-keyshortcuts="Enter Space"
        onClick={() => onClick?.(path)}
      >
        {name}
      </button>
    </>
  );
}

function WorkspaceSearchControls({
  search,
}: Readonly<{
  search: WorkspacePathSearch;
}>) {
  const [draft, setDraft] = useState(search.query);
  const searchInputRef = useShellSearchInputRef();

  useEffect(() => {
    setDraft(search.query);
  }, [search.query]);

  return (
    <div className="flex min-w-0 items-center gap-1.5" role="search">
      <label className="min-w-[150px] flex-1">
        <span className="sr-only">{search.entriesLabel}</span>
        <input
          ref={searchInputRef}
          id="search-entries"
          className="h-8 w-full rounded-md border border-slate-300 bg-white px-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-950"
          type="search"
          placeholder={search.placeholder}
          aria-keyshortcuts="Control+F"
          disabled={search.disabled}
          value={draft}
          onChange={(event) => {
            setDraft(event.currentTarget.value);
            search.onChange?.(event.currentTarget.value);
          }}
        />
      </label>
      <button
        id="search-submit"
        className="min-h-8 rounded-md border border-slate-300 bg-white px-2 text-xs hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800"
        type="button"
        disabled={search.disabled}
        onClick={() => search.onSubmit?.(draft)}
      >
        {search.buttonLabel}
      </button>
      <button
        id="clear-search"
        className="min-h-8 rounded-md border border-transparent bg-transparent px-2 text-xs hover:bg-slate-100 disabled:opacity-50 dark:hover:bg-slate-800"
        type="button"
        disabled={search.clearDisabled}
        aria-label={search.clearAriaLabel}
        onClick={() => search.onClear?.()}
      >
        {search.clearLabel}
      </button>
      <output
        id="search-count"
        className="min-w-[54px] text-right text-[11px] text-slate-500 dark:text-slate-400"
        htmlFor="search-entries"
        aria-live="polite"
      >
        {search.resultText}
      </output>
    </div>
  );
}
