import { Home } from "lucide-react";
import { useEffect } from "react";
import { getPathBasename } from "../../../app/formatting";
import { useZManagerActions, useZManagerSnapshot } from "../AppProviders";
import { translatorForSnapshot } from "../shell/shellHelpers";
import { WorkspacePathBar } from "../workspace/WorkspacePathBar";

export function ArchivePathBar() {
  const snapshot = useZManagerSnapshot();
  const actions = useZManagerActions();
  const i18n = translatorForSnapshot(snapshot);
  const archive = snapshot.archive;
  const archiveNavigation = snapshot.archiveNavigation.length
    ? snapshot.archiveNavigation
    : archive.currentArchivePath
      ? [{ label: getPathBasename(archive.currentArchivePath, "Archive"), depth: 0 }]
      : [];
  const navigationCrumbs = archiveNavigation.map((crumb) => ({
    name: crumb.label,
    path: `archive-depth:${crumb.depth}`,
  }));
  const folderCrumbs = archive.view.breadcrumbs.slice(1).map((crumb) => ({
    name: crumb.name,
    path: `archive-folder:${crumb.path}`,
  }));
  const crumbs = [...navigationCrumbs, ...folderCrumbs];
  const location = [
    ...archiveNavigation.map((crumb) => crumb.label),
    ...archive.view.breadcrumbs.slice(1).map((crumb) => crumb.name),
  ].join(" › ");

  useEffect(() => {
    document.title = location ? `${location} - ZManager` : "ZManager";
  }, [location]);

  return (
    <WorkspacePathBar
      ariaLabel={i18n.t("workspace.archiveLocation.aria")}
      locationLabel={i18n.t("workspace.archiveLocation.aria")}
      pathAriaLabel={i18n.t("workspace.archiveLocation.aria")}
      pathInputId="archive-location"
      displayPath={location}
      pathDisabled={!archive.currentArchivePath}
      pathReadOnly
      pathPlaceholder={i18n.t("browse.noArchiveOpen")}
      crumbs={crumbs}
      crumbsHidden={!archive.currentArchivePath}
      emptyCrumbsText=""
      pathAccessory={
        <button
          id="archive-open-root"
          className="grid size-8 shrink-0 place-items-center rounded-md border border-slate-300 bg-white hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800"
          type="button"
          aria-label={i18n.t("icon.archiveRoot")}
          title={i18n.t("icon.archiveRoot")}
          disabled={!archive.currentArchivePath}
          onClick={() => actions.handleArchiveIntent({ type: "navigateArchiveToDepth", depth: 0 })}
        >
          <Home className="size-4" aria-hidden="true" />
        </button>
      }
      onCrumbClick={(path) => {
        if (path.startsWith("archive-depth:")) {
          actions.handleArchiveIntent({
            type: "navigateArchiveToDepth",
            depth: Number(path.slice("archive-depth:".length)),
          });
        } else if (path.startsWith("archive-folder:")) {
          actions.handleArchiveIntent({
            type: "navigateToFolder",
            folderPath: path.slice("archive-folder:".length),
          });
        }
      }}
      search={{
        query: archive.view.searchQuery,
        disabled: !archive.command.canSearchEntries,
        clearDisabled:
          !archive.command.canSearchEntries || !archive.view.searchQuery.trim(),
        resultText: archive.currentArchivePath
          ? i18n.t(
              archive.view.selection.visibleSelectablePaths.length === 1
                ? "search.oneResult"
                : "search.results",
              { count: archive.view.selection.visibleSelectablePaths.length },
            )
          : "",
        entriesLabel: i18n.t("search.entries"),
        placeholder: i18n.t("search.placeholder"),
        buttonLabel: i18n.t("search.button"),
        clearLabel: i18n.t("search.clear"),
        clearAriaLabel: i18n.t("search.clear.aria"),
        onChange: (query) =>
          actions.handleArchiveIntent({ type: "setSearchQuery", query }),
        onSubmit: (query) =>
          actions.handleArchiveIntent({ type: "setSearchQuery", query, immediate: true }),
        onClear: () => actions.handleArchiveIntent({ type: "clearSearch" }),
      }}
    />
  );
}
