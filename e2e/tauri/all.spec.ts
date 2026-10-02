import "./health.spec.ts";
import "./archive-open.spec.ts";
import "./archive-extract.spec.ts";
import "./archive-create-matrix.spec.ts";
import "./archive-task-failures.spec.ts";
import "./archive-gui-journeys.spec.ts";
import "./linux.spec.ts";
import "./macos.spec.ts";
import "./windows.spec.ts";
import "./share-queue.spec.ts";
import "./staging-contact-sync.spec.ts";

// The hosted account suite observes the real default browser. Linux has no
// standalone browser observer, and the macos-15-intel hosted runner does not
// expose its browser navigation reliably to either macOS observer. Keep this
// integration lane on macOS arm64 and Windows x64, where the real browser
// handoff remains covered, while retaining all other Intel Mac GUI tests.
if (process.platform !== "linux" && process.env.TZAP_E2E_SKIP_ONLINE_ACCOUNT !== "1") {
  await import("./online-account.spec.ts");
}
