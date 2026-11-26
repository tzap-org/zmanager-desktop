export type PasswordPromptAdapter = Readonly<{
  promptForPassword(message: string): string | null;
}>;

export function createBrowserPasswordPromptAdapter(
  windowRef: Pick<Window, "prompt"> = window,
): PasswordPromptAdapter {
  return {
    promptForPassword(message) {
      return windowRef.prompt(message) || null;
    },
  };
}
