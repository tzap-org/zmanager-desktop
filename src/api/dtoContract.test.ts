import { describe, expect, it } from "vitest";

import rustAccountSource from "../../src-tauri/src/account.rs?raw";
import rustDtoSource from "../../src-tauri/src/dto.rs?raw";
import rustLocalsendSource from "../../src-tauri/src/localsend.rs?raw";
import typeScriptApiTypesSource from "./types.ts?raw";

const rustSource = `${rustDtoSource}\n${rustLocalsendSource}`;
const responseRustSource = `${rustDtoSource}\n${rustAccountSource}`;

// Most Rust request structs and their TypeScript counterparts share one
// name; a bare string checks that. `localsend.rs` DTOs are suffixed `Dto`
// on the Rust side (matching this codebase's other localsend_* commands)
// but not on the TypeScript side, so those use the two-name form instead.
const REQUEST_DTO_TYPES: readonly (string | Readonly<{ typeScriptName: string; rustName: string }>)[] = [
  "SystemFileIconRequest",
  "SystemFileIconRequestEntry",
  "ValidateDirectoryRequest",
  "QuickActionRequestDto",
  "ListArchiveRequest",
  "PlanCreateRequest",
  "StartCreateRequest",
  "StartExtractRequest",
  "VerifyTzapCertificateRequest",
  "PreviewEntryRequest",
  "NativeFileDragRequest",
  "TestArchiveRequest",
  "CancelJobRequest",
  "PauseJobRequest",
  "ResumeJobRequest",
  "DismissJobRequest",
  { typeScriptName: "LocalSendDiscoverRequest", rustName: "LocalSendDiscoverRequestDto" },
  { typeScriptName: "LocalSendStartReceiverRequest", rustName: "LocalSendStartReceiverRequestDto" },
  { typeScriptName: "LocalSendRespondToTransferRequest", rustName: "LocalSendRespondToTransferRequestDto" },
] as const;

describe("Rust and TypeScript request DTO contracts", () => {
  it("keeps request DTO field names aligned", () => {
    for (const entry of REQUEST_DTO_TYPES) {
      const typeScriptName = typeof entry === "string" ? entry : entry.typeScriptName;
      const rustName = typeof entry === "string" ? entry : entry.rustName;
      expect(typeScriptTypeFields(typeScriptApiTypesSource, typeScriptName), typeScriptName).toEqual(
        rustStructFields(rustSource, rustName),
      );
    }
  });
});

const RESPONSE_DTO_TYPES = [
  "AccountSnapshotDto",
  "AccountLifecycleResultDto",
  "AccountContactSyncResultDto",
  "AccountCertificateDto",
  "AccountRecipientKeyDto",
  "AccountContactDto",
  "AccountHostedAuthLaunchDto",
  "AccountCurrentUserDto",
  "AccountContactCardPreviewDto",
  "VerifyTzapCertificateResponse",
] as const;

describe("Rust and TypeScript response DTO contracts", () => {
  it("keeps response DTO field names aligned", () => {
    for (const typeName of RESPONSE_DTO_TYPES) {
      expect(typeScriptTypeFields(typeScriptApiTypesSource, typeName), typeName).toEqual(
        rustStructFields(responseRustSource, typeName),
      );
    }
  });
});

function typeScriptTypeFields(source: string, typeName: string): string[] {
  const body = bracedBody(source, `export type ${typeName} =`);
  if (!body) {
    throw new Error(`Unable to find TypeScript type ${typeName}`);
  }

  return body.split("\n").flatMap((line) => {
    const match = line.match(/^  ([A-Za-z0-9_]+)\??:/);
    return match ? [match[1]] : [];
  });
}

function rustStructFields(source: string, typeName: string): string[] {
  const body = bracedBody(source, `pub struct ${typeName}`);
  if (!body) {
    throw new Error(`Unable to find Rust struct ${typeName}`);
  }

  return body.split("\n").flatMap((line) => {
    const match = line.match(/^    pub ([a-zA-Z0-9_]+):/);
    return match ? [snakeToCamel(match[1])] : [];
  });
}

function bracedBody(source: string, marker: string): string | null {
  const markerStart = source.indexOf(marker);
  if (markerStart < 0) return null;
  const openingBrace = source.indexOf("{", markerStart + marker.length);
  if (openingBrace < 0) return null;
  let depth = 0;
  for (let index = openingBrace; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(openingBrace + 1, index);
    }
  }
  return null;
}

function snakeToCamel(value: string): string {
  return value.replace(/_([a-z0-9])/g, (_match, letter: string) => letter.toUpperCase());
}
