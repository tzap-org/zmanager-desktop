import { describe, expect, it, vi } from "vitest";

import type { CommandErrorDto, CreatePlanResponse, StartJobResponseDto } from "../../api/types";
import type { FormatCreateDefaults } from "../preferences";
import { createMainWindowSubmissionGuard } from "../mainWindowSubmissionGuard";
import { createCreateWorkspace } from "../workspaces/createWorkspace";
import { createCreateStartController, type CreateStartControllerOptions } from "./createStartController";

const startedAt = "2026-06-11T00:00:00Z";

function createPlan(overrides: Partial<CreatePlanResponse> = {}): CreatePlanResponse {
  return {
    includedCount: 1,
    excludedCount: 0,
    totalBytes: 12,
    excludedBytes: 0,
    entries: ["project/readme.md"],
    planEntries: [{
      path: "project/readme.md",
      kind: "file",
      size: 12,
      sourcePath: "C:/work/project/readme.md",
    }],
    excludedEntries: [],
    warnings: [],
    ...overrides,
  };
}

function startJobResponse(overrides: Partial<StartJobResponseDto> = {}): StartJobResponseDto {
  return {
    jobId: "create-job",
    kind: "zipCreate",
    status: "queued",
    createdAt: startedAt,
    ...overrides,
  };
}

function commandError(overrides: Partial<CommandErrorDto> = {}): CommandErrorDto {
  return {
    code: "failed",
    message: "Could not create",
    hint: null,
    severity: "error",
    retryable: false,
    ...overrides,
  };
}

function formatDefaults(overrides: Partial<FormatCreateDefaults> = {}): FormatCreateDefaults {
  return {
    cleanSource: true,
    compressionLevel: null,
    volumeSize: null,
    preserveMetadata: true,
    replaceExisting: false,
    promptForPassword: false,
    tzapRecoveryPercentage: null,
    ...overrides,
  };
}

function createReadyWorkspace() {
  const workspace = createCreateWorkspace();
  workspace.addSources(["C:/work/project"]);
  workspace.changeFormat("zip", formatDefaults());
  workspace.setDestinationPath("C:/out/project.zip");
  const started = workspace.beginPlan();
  expect(started.ready).toBe(true);
  if (!started.ready) {
    throw new Error("Expected plan request to be ready");
  }
  workspace.acceptPlanResult(started.revision, createPlan());
  return workspace;
}

function createHarness(overrides: Partial<CreateStartControllerOptions> = {}) {
  const workspace = createReadyWorkspace();
  const calls = {
    published: 0,
    started: [] as unknown[],
  };
  const startCreate = vi.fn(async () => startJobResponse());

  const controller = createCreateStartController({
    workspace,
    submissionGuard: createMainWindowSubmissionGuard(),
    publishSnapshot(snapshot) {
      calls.published += 1;
      return snapshot;
    },
    startCreate,
    enqueueShare: vi.fn(async () => {}),
    onCreateStarted(response, request) {
      calls.started.push({ response, request });
    },
    toCommandError(error) {
      return error && typeof error === "object" && "code" in error
        ? error as CommandErrorDto
        : null;
    },
    ...overrides,
  });

  return {
    calls,
    controller,
    startCreate,
    workspace,
  };
}

describe("create start controller", () => {
  it("builds a request, starts create, and runs success effects", async () => {
    const harness = createHarness();
    harness.startCreate.mockResolvedValueOnce(startJobResponse({ jobId: "job-1" }));

    await harness.controller.runCreate({
      destinationCollisionStrategy: "rename",
      passwordInput: {
        password: " secret ",
        passwordConfirm: "secret",
      },
    });

    expect(harness.startCreate).toHaveBeenCalledWith(expect.objectContaining({
      sources: ["C:/work/project"],
      destinationPath: "C:/out/project.zip",
      password: "secret",
      destinationCollisionStrategy: "rename",
    }));
    expect(harness.calls.started).toHaveLength(1);
    expect(harness.calls.started[0]).toMatchObject({
      response: startJobResponse({ jobId: "job-1" }),
      request: {
        destinationPath: "C:/out/project.zip",
      },
    });
    expect(harness.workspace.getSnapshot().options.submissionInFlight).toBe(false);
    expect(harness.calls.published).toBe(3);
  });

  it("queues the reviewed exclusions and recipient selection when sharing", async () => {
    const enqueueShare = vi.fn(async () => {});
    const harness = createHarness({ enqueueShare });
    const { workspace } = harness;
    workspace.changeFormat("tzap", formatDefaults());
    workspace.setDestinationPath("C:/out/project.tzap");
    workspace.setOptions({ tzapRecipientKeyIds: "recipient-1", compressionLevel: 7 });
    const plan = workspace.beginPlan();
    if (!plan.ready) throw new Error("Expected plan request to be ready");
    workspace.acceptPlanResult(plan.revision, createPlan({
      includedCount: 2,
      entries: ["project/readme.md", "project/private.txt"],
      planEntries: [
        { path: "project/readme.md", kind: "file", size: 12, sourcePath: "C:/work/project/readme.md" },
        { path: "project/private.txt", kind: "file", size: 8, sourcePath: "C:/work/project/private.txt" },
      ],
    }));
    workspace.setPathIncluded("project/private.txt", false);

    await harness.controller.runCreateAndShare({
      passwordInput: { password: "", passwordConfirm: "" },
    });

    expect(enqueueShare).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      destinationPath: "C:/out/project.tzap",
      excludeArchivePaths: ["project/private.txt"],
      compressionLevel: 7,
      tzapCertificates: expect.objectContaining({
        recipientSelection: expect.objectContaining({ recipientKeyIds: ["recipient-1"] }),
      }),
    }));
    expect(harness.startCreate).not.toHaveBeenCalled();
    expect(workspace.getSnapshot().options.submissionInFlight).toBe(false);
  });

  it("validates the password confirmation before queuing a share", async () => {
    const enqueueShare = vi.fn(async () => {});
    const harness = createHarness({ enqueueShare });

    await harness.controller.runCreateAndShare({
      passwordInput: { password: "one", passwordConfirm: "two" },
    });

    expect(enqueueShare).not.toHaveBeenCalled();
    expect(harness.workspace.getSnapshot().plan.status).toEqual({
      messageKey: "create.error.passwordMismatch",
    });
  });

  it("renders validation errors without starting create", async () => {
    const harness = createHarness();

    await harness.controller.runCreate({
      passwordInput: {
        password: "one",
        passwordConfirm: "two",
      },
    });

    expect(harness.startCreate).not.toHaveBeenCalled();
    expect(harness.workspace.getSnapshot().plan.status).toEqual({
      messageKey: "create.error.passwordMismatch",
    });
    expect(harness.calls.published).toBe(1);
  });

  it("uses explicit submit passwords from the call site", async () => {
    const harness = createHarness();

    await harness.controller.runCreate({
      passwordInput: {
        password: " react secret ",
        passwordConfirm: "react secret",
      },
    });

    expect(harness.startCreate).toHaveBeenCalledWith(expect.objectContaining({
      password: "react secret",
    }));
  });

  it("maps API errors to plan errors and clears submission state", async () => {
    const harness = createHarness();
    harness.startCreate.mockRejectedValueOnce(commandError({ message: "Create failed" }));

    await harness.controller.runCreate({
      passwordInput: {
        password: "",
        passwordConfirm: "",
      },
    });

    expect(harness.workspace.getSnapshot().plan.status).toEqual({
      fallbackText: "Create failed",
    });
    expect(harness.workspace.getSnapshot().options.submissionInFlight).toBe(false);
    expect(harness.calls.published).toBe(4);
  });

  it("uses generic create error text for unknown API failures", async () => {
    const harness = createHarness();
    harness.startCreate.mockRejectedValueOnce(new Error("boom"));

    await harness.controller.runCreate({
      passwordInput: {
        password: "",
        passwordConfirm: "",
      },
    });

    expect(harness.workspace.getSnapshot().plan.status).toEqual({
      messageKey: "create.error.unableStart",
    });
  });

  it("does nothing while a submission is already in flight", async () => {
    const submissionGuard = createMainWindowSubmissionGuard();
    submissionGuard.tryBegin();
    const harness = createHarness({ submissionGuard });

    await harness.controller.runCreate({
      passwordInput: {
        password: "",
        passwordConfirm: "",
      },
    });

    expect(harness.startCreate).not.toHaveBeenCalled();
    expect(harness.calls.published).toBe(0);
  });

  it("does nothing when there are no sources", async () => {
    const emptyWorkspace = createCreateWorkspace();
    const harness = createHarness({
      workspace: emptyWorkspace,
      publishSnapshot: (snapshot) => snapshot,
      submissionGuard: createMainWindowSubmissionGuard(),
    });

    await harness.controller.runCreate({
      passwordInput: {
        password: "",
        passwordConfirm: "",
      },
    });

    expect(harness.startCreate).not.toHaveBeenCalled();
    expect(harness.calls.published).toBe(0);
  });

  it("allows another create immediately after Rust accepts the first Job", async () => {
    let acceptFirst: (job: StartJobResponseDto) => void = () => {
      throw new Error("first create was not started");
    };
    const firstAcceptance = new Promise<StartJobResponseDto>((resolve) => {
      acceptFirst = resolve;
    });
    const startCreate = vi.fn()
      .mockImplementationOnce(() => firstAcceptance)
      .mockResolvedValueOnce(startJobResponse({ jobId: "job-2" }));
    const harness = createHarness({ startCreate });
    const input = {
      passwordInput: { password: "", passwordConfirm: "" },
    };

    const first = harness.controller.runCreate(input);
    const duplicate = harness.controller.runCreate(input);
    expect(startCreate).toHaveBeenCalledTimes(1);

    acceptFirst(startJobResponse({ jobId: "job-1" }));
    await Promise.all([first, duplicate]);
    await harness.controller.runCreate(input);

    expect(startCreate).toHaveBeenCalledTimes(2);
  });
});
