import type { DiagnosticRecorder } from "../app/diagnostics";

export type RuntimeStartupOptions = Readonly<{
  bindWindowLifecycleHandlers(): void;
  refreshDisplayFromPreferences(): void;
  loadPathHistory(): void;
  applyCreatePreferenceDefaults(): void;
  setInitialBrowseState(): void;
  installRuntimeDevTools(): void;
  bindFileDrop(): void | Promise<void>;
  isDesktopRuntime(): boolean;
  initializeNativeQuickActionPath(): Promise<void>;
  initializeDeferredDesktopRuntime(): Promise<void>;
  renderNormalWorkspaceOnce(): void;
  loadLocalDevFixtureFromUrl(): void;
  loadBootstrapState(): void | Promise<void>;
  diagnostics?: DiagnosticRecorder;
}>;

export function startZManagerRuntime(options: RuntimeStartupOptions): void {
  options.diagnostics?.record({
    scope: "frontend",
    name: "initializationStarted",
    fields: {},
  });
  options.bindWindowLifecycleHandlers();
  options.refreshDisplayFromPreferences();
  options.loadPathHistory();
  options.applyCreatePreferenceDefaults();
  options.setInitialBrowseState();
  options.installRuntimeDevTools();
  void options.bindFileDrop();

  if (options.isDesktopRuntime()) {
    void Promise.resolve(options.loadBootstrapState()).catch(() => {
      options.diagnostics?.record({
        scope: "frontend",
        name: "bootstrapFailed",
        fields: {},
      });
    });
    const startDeferredInitialization = () => {
      void options.initializeDeferredDesktopRuntime()
        .catch(() => {
          options.diagnostics?.record({
            scope: "frontend",
            name: "deferredInitializationFailed",
            fields: {},
          });
        })
        .finally(() => options.loadLocalDevFixtureFromUrl());
    };
    void options.initializeNativeQuickActionPath().then(
      startDeferredInitialization,
      startDeferredInitialization,
    );
    return;
  }

  options.renderNormalWorkspaceOnce();
  options.loadLocalDevFixtureFromUrl();
  void options.loadBootstrapState();
}
