import { FolderOpen } from "lucide-react";
import { useEffect, useState } from "react";

import { getPathBasename } from "../../../app/formatting";
import { useZManagerActions, useZManagerSnapshot } from "../AppProviders";
import { translatorForSnapshot } from "../shell/shellHelpers";
import { WorkspacePathBar } from "../workspace/WorkspacePathBar";

export function ArchivePathBar() {
  const snapshot = useZManagerSnapshot();
  const actions = useZManagerActions();
  const i18n = translatorForSnapshot(snapshot);
  const archive = snapshot.archive;
  const extract = snapshot.extract;
  const [destination, setDestination] = useState(extract.destinationPath);
  const archiveName = getPathBasename(archive.currentArchivePath, "ZManager");

  useEffect(() => {
    setDestination(extract.destinationPath);
  }, [extract.destinationPath]);

  useEffect(() => {
    document.title = archive.currentArchivePath
      ? archive.view.currentFolder
        ? `${archiveName}\\${archive.view.currentFolder.replace(/\//g, "\\")} - ZManager`
        : `${archiveName} - ZManager`
      : "ZManager";
  }, [archive.currentArchivePath, archive.view.currentFolder, archiveName]);

  return (
    <WorkspacePathBar
      ariaLabel={i18n.t("extract.destination")}
      locationLabel={i18n.t("extract.destination")}
      pathAriaLabel={i18n.t("extract.destination")}
      pathInputId="extract-destination"
      displayPath={destination}
      pathDisabled={!archive.currentArchivePath}
      pathReadOnly={false}
      pathPlaceholder={i18n.t("extract.destination.placeholder")}
      onPathChange={(path) => {
        setDestination(path);
        actions.handleArchiveIntent({
          type: "setExtractDestination",
          destinationPath: path,
        });
      }}
      crumbs={[]}
      crumbsHidden
      emptyCrumbsText=""
      pathAccessory={
        <>
          <button
            id="browse-extract-destination"
            className="grid size-8 place-items-center rounded-md border border-slate-300 bg-white hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800"
            type="button"
            aria-label={i18n.t("nativeDialog.chooseExtractDestination")}
            title={i18n.t("nativeDialog.chooseExtractDestination")}
            disabled={!archive.currentArchivePath}
            onClick={() =>
              actions.handleArchiveIntent({ type: "browseExtractDestination" })
            }
          >
            <FolderOpen className="size-4" aria-hidden="true" />
          </button>
          <span className="hidden max-w-28 truncate text-[11px] text-slate-500 min-[900px]:inline dark:text-slate-400">
            {extract.usesGlobalDefaults
              ? i18n.t("extract.globalDefault")
              : i18n.t("extract.customDestination")}
          </span>
        </>
      }
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
