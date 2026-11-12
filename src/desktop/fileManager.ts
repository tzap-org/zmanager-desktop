import {
  openUrl as openUrlWithOpener,
  revealItemInDir,
} from "@tauri-apps/plugin-opener";

export async function openDesktopUrl(url: string): Promise<void> {
  await openUrlWithOpener(url);
}

export async function revealInFileManager(path: string): Promise<void> {
  await revealItemInDir(path);
}
