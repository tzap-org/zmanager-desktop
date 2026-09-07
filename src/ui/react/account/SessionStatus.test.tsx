import { createElement } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { createZManagerAppStore } from "../appStore";
import {
  createInitialZManagerReactSnapshot,
  noopZManagerReactActions,
} from "../appRuntime";
import { ZManagerAppRuntimeProvider } from "../AppProviders";
import { SessionStatus } from "./SessionStatus";

describe("SessionStatus", () => {
  it("launches hosted auth against the selected TZAP environment", () => {
    const handleAccountIntent = vi.fn();
    const initial = createInitialZManagerReactSnapshot();
    const store = createZManagerAppStore(
      {
        ...initial,
        preferences: { ...initial.preferences, tzapEnvironment: "staging" },
        account: {
          ...initial.account,
          capabilities: { ...initial.account.capabilities, auth: "launch_only" },
        },
      },
      { ...noopZManagerReactActions, handleAccountIntent },
    );

    render(
      createElement(
        ZManagerAppRuntimeProvider,
        { store },
        createElement(SessionStatus),
      ),
    );

    expect(screen.getByText(/Hosted sign-in is needed for enrollment, renewal, device retirement, and contact sync/)).toBeVisible();
    expect(screen.getByText(/Archive verification can optionally check public certificate status when online/)).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Sign In to Hosted Account" }));

    expect(handleAccountIntent).toHaveBeenCalledWith({
      type: "beginHostedAuth",
      environment: "staging",
    });
  });
});
