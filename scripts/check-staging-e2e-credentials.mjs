import { appendFileSync } from "node:fs";

const required = [
  "TZAP_DESKTOP_STAGING_CLIENT_ID",
  "TZAP_E2E_USERNAME",
  "TZAP_E2E_PASSWORD",
];
const missing = required.filter((name) => !process.env[name]?.trim());
const configured = missing.length === 0;

if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `configured=${configured ? "true" : "false"}\n`);
}

if (configured) {
  console.log("Staging E2E credentials are configured.");
} else {
  console.warn(`::warning::Skipping staging native E2E; missing repository secrets: ${missing.join(", ")}.`);
}
