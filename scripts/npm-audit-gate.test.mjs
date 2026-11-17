import assert from "node:assert/strict";
import test from "node:test";
import { evaluateAuditReport, PICOMATCH_ADVISORY } from "./npm-audit-gate.mjs";

const lockfile = {
  packages: { "node_modules/picomatch": { version: "4.0.7" } },
};

function advisoryReport() {
  return {
    vulnerabilities: {
      picomatch: {
        severity: "high",
        via: [{ source: 1247710, name: "picomatch", url: PICOMATCH_ADVISORY, range: "<=4.0.7" }],
        effects: ["vite"],
        range: "*",
        nodes: ["node_modules/picomatch"],
      },
      vite: {
        severity: "high",
        via: ["picomatch"],
        effects: [],
        range: "*",
        nodes: ["node_modules/vite"],
      },
    },
    metadata: { vulnerabilities: { total: 2 } },
  };
}

test("allows only the documented picomatch advisory and its affected toolchain chain", () => {
  assert.deepEqual(evaluateAuditReport(advisoryReport(), lockfile), {
    accepted: true,
    exceptionUsed: true,
  });
});

test("passes a clean npm audit report without using the exception", () => {
  assert.deepEqual(evaluateAuditReport({
    vulnerabilities: {},
    metadata: { vulnerabilities: { total: 0 } },
  }, lockfile), { accepted: true, exceptionUsed: false });
});

test("blocks an independent advisory even when it affects a dependent tool package", () => {
  const report = advisoryReport();
  report.vulnerabilities.vite.via.push({
    source: 999,
    name: "vite",
    url: "https://github.com/advisories/GHSA-other-advisory",
    range: "<9.0.0",
  });
  assert.equal(evaluateAuditReport(report, lockfile).accepted, false);
});

test("blocks unrelated vulnerabilities", () => {
  const report = advisoryReport();
  report.vulnerabilities.other = { severity: "high", via: [{ url: "https://example.test" }], effects: [] };
  report.metadata.vulnerabilities.total += 1;
  assert.equal(evaluateAuditReport(report, lockfile).accepted, false);
});

test("blocks if the picomatch version, advisory range, or audit scope changes", () => {
  assert.equal(evaluateAuditReport(advisoryReport(), {
    packages: { "node_modules/picomatch": { version: "4.0.8" } },
  }).accepted, false);

  const widenedRange = advisoryReport();
  widenedRange.vulnerabilities.picomatch.via[0].range = "*";
  assert.equal(evaluateAuditReport(widenedRange, lockfile).accepted, false);

  const extraAdvisory = advisoryReport();
  extraAdvisory.vulnerabilities.picomatch.via.push({
    source: 1000,
    name: "picomatch",
    url: "https://github.com/advisories/GHSA-other-advisory",
    range: "*",
  });
  assert.equal(evaluateAuditReport(extraAdvisory, lockfile).accepted, false);
});
