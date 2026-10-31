import assert from "node:assert/strict";
import { test } from "node:test";

import { openStagingLogin } from "../e2e/tauri/helpers/stagingLogin.ts";

test("staging login assigns explicit budgets to navigation and form rendering", async () => {
  const navigation = [];
  const waits = [];
  const selectors = new Map();
  const page = {
    goto: async (url, options) => navigation.push({ url, ...options }),
    locator: (selector) => {
      if (!selectors.has(selector)) {
        selectors.set(selector, {
          first() { return this; },
          waitFor: async (options) => waits.push({ selector, ...options }),
          count: async () => 0,
        });
      }
      return selectors.get(selector);
    },
    url: () => "https://staging.tzap.org/auth/login?state=secret-state",
  };

  const form = await openStagingLogin(page, "https://staging.tzap.org/auth/launch?state=secret-state");

  assert.deepEqual(navigation, [{
    url: "https://staging.tzap.org/auth/launch?state=secret-state",
    waitUntil: "commit",
    timeout: 90_000,
  }]);
  assert.deepEqual(waits.map(({ state, timeout }) => ({ state, timeout })), [
    { state: "visible", timeout: 60_000 },
    { state: "visible", timeout: 60_000 },
  ]);
  assert.ok(form.username);
  assert.ok(form.password);
});

test("staging login failure reports only the safe path and rendered control counts", async () => {
  const page = {
    goto: async () => undefined,
    locator: (selector) => ({
      first() { return this; },
      waitFor: async () => { throw new Error("not visible"); },
      count: async () => selector === "input" ? 1 : 2,
    }),
    url: () => "https://staging.tzap.org/auth/login?state=secret-state",
  };

  await assert.rejects(
    () => openStagingLogin(page, "https://staging.tzap.org/auth/launch"),
    /staging login form was not visible \(path=\/auth\/login, inputs=1, buttons=2\)/u,
  );
});
