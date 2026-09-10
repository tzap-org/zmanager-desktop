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
// standalone browser observer yet, so keep that platform-specific gap visible
// by excluding only the unsupported suite rather than failing unrelated native
// coverage.
if (process.platform !== "linux") {
  await import("./online-account.spec.ts");
}
