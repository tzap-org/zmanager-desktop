import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

export type HashManifest = Readonly<Record<string, string>>;

function sha256File(filePath: string): string {
  return `sha256:${createHash("sha256").update(readFileSync(filePath)).digest("hex")}`;
}

function walk(root: string, current = root): string[] {
  return readdirSync(current, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(current, entry.name);
    return entry.isDirectory() ? walk(root, entryPath) : [path.relative(root, entryPath).replaceAll(path.sep, "/")];
  });
}

export function hashTree(root: string): HashManifest {
  if (!existsSync(root)) throw new Error(`source tree does not exist: ${root}`);
  return Object.fromEntries(walk(root).sort().map((relativePath) => [relativePath, sha256File(path.join(root, relativePath))]));
}

export function assertHashManifestEqual(expected: HashManifest, actualRoot: string): void {
  const actual = hashTree(actualRoot);
  if (JSON.stringify(expected) !== JSON.stringify(actual)) {
    throw new Error(`extracted tree hash mismatch: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

export function collectArchiveVolumes(archivePath: string): string[] {
  const directory = path.dirname(archivePath);
  const base = path.basename(archivePath);
  const candidates = readdirSync(directory)
    .filter((entry) => entry === base || entry.startsWith(`${base}.`) || entry.startsWith(`${base}.vol`))
    .map((entry) => path.join(directory, entry))
    .filter((entry) => statSync(entry).isFile())
    .sort();
  if (candidates.length === 0) throw new Error(`no archive volume found for ${archivePath}`);
  return candidates;
}

export function writeArchiveEvidence(args: {
  artifactDir: string;
  archivePath: string;
  sourceManifest: HashManifest;
  signerCertificateSha256?: string;
  recipientFingerprint?: string;
  contactSummary?: {
    contactId: string;
    displayName: string;
    publicSignerId?: string | null;
    signingCertificateSha256: string;
    recipientPublicKeyFingerprint: string;
  };
  runId: string;
}): { manifestPath: string; checksumPath: string } {
  const receiverDir = path.join(args.artifactDir, args.recipientFingerprint ? "receiver-contact-a" : "portable");
  mkdirSync(receiverDir, { recursive: true });
  const volumes = collectArchiveVolumes(args.archivePath);
  const manifest = {
    runId: args.runId,
    archives: volumes.map((volume) => ({ path: path.basename(volume), size: statSync(volume).size, sha256: sha256File(volume) })),
    signerCertificateSha256: args.signerCertificateSha256 ?? null,
    recipientFingerprint: args.recipientFingerprint ?? null,
    sourceFileCount: Object.keys(args.sourceManifest).length,
  };
  const evidenceName = args.recipientFingerprint ? "signed-for-contact-a" : "signed-portable";
  const manifestPath = path.join(receiverDir, `${evidenceName}.manifest.json`);
  const checksumPath = path.join(receiverDir, `${evidenceName}.sha256`);
  const sourceChecksumPath = path.join(receiverDir, "source.sha256");
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(checksumPath, `${volumes.map((volume) => `${sha256File(volume)}  ${path.basename(volume)}`).join("\n")}\n`);
  writeFileSync(sourceChecksumPath, `${Object.entries(args.sourceManifest).sort(([left], [right]) => left.localeCompare(right)).map(([relativePath, digest]) => `${digest}  ${relativePath}`).join("\n")}\n`);
  if (args.contactSummary) {
    writeFileSync(path.join(receiverDir, "contact-summary.json"), `${JSON.stringify({ ...args.contactSummary }, null, 2)}\n`);
  }
  return { manifestPath, checksumPath };
}

export function assertNoSecrets(value: unknown, secrets: ReadonlyArray<string | undefined>): void {
  const serialized = JSON.stringify(value);
  for (const secret of secrets) {
    if (secret && secret.length >= 4 && serialized.includes(secret)) throw new Error("online E2E evidence contains a configured secret");
  }
  for (const key of ["access_token", "session_token", "handoff_code", "password", "private_key", "code_verifier"]) {
    if (new RegExp(`(?:\\"|')${key}(?:\\"|')\\s*:`).test(serialized)) throw new Error(`online E2E evidence contains forbidden field ${key}`);
  }
}
