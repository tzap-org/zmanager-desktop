import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const PICOMATCH_ADVISORY = "https://github.com/advisories/GHSA-fc5q-39xc-vjpf";
const EXPECTED_PICOMATCH_VERSION = "4.0.7";

/**
 * Accept only the one known, unpatched picomatch advisory in the development
 * toolchain. npm reports downstream packages as affected too, so their audit
 * entries are allowed only when they form picomatch's dependency-effect graph
 * and contain no independent advisory objects.
 */
export function evaluateAuditReport(report, lockfile) {
  const vulnerabilities = report?.vulnerabilities;
  if (!vulnerabilities || typeof vulnerabilities !== "object") {
    return { accepted: false, reason: "npm audit returned no vulnerability report" };
  }

  const names = Object.keys(vulnerabilities);
  if (names.length === 0) {
    return { accepted: true, exceptionUsed: false };
  }

  const picomatch = vulnerabilities.picomatch;
  const lockedVersion = lockfile?.packages?.["node_modules/picomatch"]?.version;
  const picomatchAdvisories = picomatch?.via?.filter((entry) => typeof entry !== "string") ?? [];
  if (
    !picomatch ||
    lockedVersion !== EXPECTED_PICOMATCH_VERSION ||
    picomatchAdvisories[0]?.range !== "<=4.0.7" ||
    picomatchAdvisories.length !== 1 ||
    picomatchAdvisories[0]?.url !== PICOMATCH_ADVISORY ||
    picomatch.nodes?.length !== 1 ||
    picomatch.nodes[0] !== "node_modules/picomatch"
  ) {
    return {
      accepted: false,
      reason: "the expected unpatched picomatch@4.0.7 advisory was absent or its scope changed",
    };
  }

  const affectedToolchain = new Set(["picomatch"]);
  const pending = ["picomatch"];
  while (pending.length > 0) {
    const current = pending.pop();
    for (const effect of vulnerabilities[current]?.effects ?? []) {
      if (!affectedToolchain.has(effect)) {
        affectedToolchain.add(effect);
        pending.push(effect);
      }
    }
  }

  for (const [name, vulnerability] of Object.entries(vulnerabilities)) {
    if (name === "picomatch") continue;
    if (!affectedToolchain.has(name)) {
      return { accepted: false, reason: `unrelated npm advisory found: ${name}` };
    }
    if (
      !Array.isArray(vulnerability.via) ||
      vulnerability.via.length === 0 ||
      vulnerability.via.some((entry) => typeof entry !== "string" || !affectedToolchain.has(entry))
    ) {
      return { accepted: false, reason: `independent or out-of-scope advisory found: ${name}` };
    }
  }

  const reportedTotal = report.metadata?.vulnerabilities?.total;
  if (reportedTotal !== names.length) {
    return { accepted: false, reason: "npm audit summary does not match its vulnerability entries" };
  }

  return { accepted: true, exceptionUsed: true };
}

function run() {
  const audit = spawnSync("npm", ["audit", "--json"], {
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
  if (audit.error || audit.signal) {
    console.error(`npm audit could not run: ${audit.error?.message ?? audit.signal}`);
    process.exitCode = 1;
    return;
  }

  let report;
  try {
    report = JSON.parse(audit.stdout);
  } catch {
    console.error("npm audit did not return valid JSON.");
    if (audit.stderr) console.error(audit.stderr.trim());
    process.exitCode = 1;
    return;
  }

  const lockfile = JSON.parse(readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"));
  const result = evaluateAuditReport(report, lockfile);
  if (result.accepted && audit.status === 0 && !result.exceptionUsed) {
    console.log("npm audit passed with no advisories.");
    return;
  }
  if (result.accepted && result.exceptionUsed && !report.error) {
    console.log(`npm audit accepted only ${PICOMATCH_ADVISORY} for development-toolchain picomatch@${EXPECTED_PICOMATCH_VERSION}; all other advisories remain blocking.`);
    return;
  }

  console.error(`npm audit gate failed: ${result.reason ?? report.error?.summary ?? `npm exited with status ${audit.status}`}`);
  console.error(JSON.stringify(report.vulnerabilities ?? report, null, 2));
  if (audit.stderr) console.error(audit.stderr.trim());
  process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  run();
}
