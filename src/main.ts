import { StrictMode, createElement } from "react";
import { createRoot } from "react-dom/client";

import "./styles.tailwind.css";

performance.mark("zmanager-frontend-entrypoint-start");

const app = document.querySelector<HTMLElement>("#app");

if (!app) {
  throw new Error("missing app root");
}

const disposableTaskSurface = new URLSearchParams(globalThis.location?.search ?? "")
  .get("surface") === "disposable-task";

if (disposableTaskSurface) {
  document.querySelector<HTMLElement>("#quick-action-loading")?.classList.remove("hidden");
} else {
  document.querySelector<HTMLElement>("#quick-action-loading")?.remove();
}

if (import.meta.env.MODE === "gui" && !disposableTaskSurface) {
  await import("@wdio/tauri-plugin");
}

const RootSurface = disposableTaskSurface
  ? (await import("./runtime/DisposableTaskRuntimeApp")).DisposableTaskRuntimeApp
  : (await import("./ui/react/AppShell")).AppShell;

if (disposableTaskSurface) {
  document.querySelector<HTMLElement>("#quick-action-loading")?.classList.add("hidden");
}

createRoot(app).render(createElement(
  StrictMode,
  null,
  createElement(RootSurface),
));
