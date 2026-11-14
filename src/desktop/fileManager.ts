import {
  openUrl as openUrlWithOpener,
  revealItemInDir,
} from "@tauri-apps/plugin-opener";

export async function openDesktopUrl(url: string): Promise<void> {
  // Hosted Windows GUI builds may pin Edge for CI because the runner image
  // does not always have a usable HTTP/HTTPS default-app association. Normal
  // builds leave this unset and use the user's system default browser.
  const guiTestBrowser = import.meta.env.VITE_ZMANAGER_GUI_TEST_BROWSER;
  await openUrlWithOpener(url, guiTestBrowser || undefined);
}

export async function revealInFileManager(path: string): Promise<void> {
  await revealItemInDir(path);
}
