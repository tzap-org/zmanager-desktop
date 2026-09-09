import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const runner = fs.readFileSync(new URL("./run-macos-comprehensive-e2e.sh", import.meta.url), "utf8");
const guiRunner = fs.readFileSync(new URL("./test-macos-gui.sh", import.meta.url), "utf8");
const installedProtocol = fs.readFileSync(new URL("./test-macos-installed-protocol.sh", import.meta.url), "utf8");

test("macOS comprehensive runner is staging-only and requires explicit real-world lanes", () => {
  assert.match(runner, /TZAP_E2E_ENV.*staging/);
  assert.match(runner, /export VITE_TZAP_BUILD_ENV=staging/);
  assert.match(runner, /export ZMANAGER_TZAP_BUILD_ENV=staging/);
  assert.match(runner, /export ZMANAGER_TZAP_SERVER_BASE_URL=https:\/\/staging\.tzap\.org/);
  assert.match(runner, /TZAP_SERVER_BASE_URL/);
  assert.match(runner, /--devices/);
  assert.match(runner, /--staging/);
  assert.match(runner, /IOS_DEVELOPMENT_TEAM/);
  assert.match(runner, /STAGING_TEST_PASSWORD/);
  assert.match(runner, /physical-device-localsend/);
  assert.match(guiRunner, /export ZMANAGER_TZAP_BUILD_ENV=staging/);
  assert.match(guiRunner, /export ZMANAGER_TZAP_SERVER_BASE_URL=https:\/\/staging\.tzap\.org/);
  assert.match(installedProtocol, /\/usr\/bin\/open "tzap:\/\/auth\/callback/);
});

test("macOS comprehensive runner records missing prerequisites as blocked", () => {
  assert.match(runner, /block_case/);
  assert.match(runner, /IOS_SHARE_EXTENSION_DRIVER/);
  assert.match(runner, /ZMANAGER_MACOS_APP_PATH/);
  assert.match(runner, /summary\.tsv/);
  assert.match(runner, /failures=.*blocked=/);
});

test("identity-dependent cross-device flows run only after staging enrollment", () => {
  const stagingIdentity = runner.indexOf("run_case android-staging-identity");
  const iosIdentity = runner.indexOf("run_case ios-staging-identity");
  const contactCard = runner.indexOf("run_case contact-card-android-ios");
  const c8Contact = runner.indexOf("run_case c8-contact-ios-to-android");
  assert.ok(stagingIdentity >= 0);
  assert.ok(iosIdentity > stagingIdentity);
  assert.ok(contactCard > iosIdentity);
  assert.ok(c8Contact > contactCard);
  assert.doesNotMatch(runner.slice(0, iosIdentity), /run_case contact-card-android-ios/);
});
