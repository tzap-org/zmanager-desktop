import { createHash, randomBytes, randomUUID, sign } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const LOCAL_PORT = 8787;
const CALLBACK_URL = "tzap://auth/callback";
const AUDIENCE = "sign.tzap.org";
const LOCAL_ENROLLMENT_AUDIENCE = "tzap.enrollment";
const CA_POLICY_OID = "2.25.216801977638581014157980575261877559132";
const LEAF_POLICY_OID = "2.25.194500518885741369143906285659225836299";
const DOCUMENT_SIGNING_EKU_OID = "2.25.201653505380392472132808080578384925035";
const METADATA_OID = "2.25.25754549376475580214508793807157112225";
const P256_ORDER = BigInt("0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551");
const P256_HALF_ORDER = P256_ORDER / 2n;

export type FixtureStatusMode = "valid" | "unavailable" | "revoked" | "mismatch";

export type OnlineFixture = Readonly<{
  baseUrl: string;
  username: string;
  password: string;
  rootCertificatePath: string;
  receiverPrivateKeyPath: string;
  contactCards: ReadonlyArray<{ name: string; card: Record<string, unknown> }>;
  contactSnapshotVersion: number;
  start(): Promise<void>;
  stop(): Promise<void>;
  setStatus(mode: FixtureStatusMode): Promise<void>;
  setContactStatus(contactId: string, mode: FixtureStatusMode): Promise<void>;
  setContactSnapshotVersion(version: 1 | 2): Promise<void>;
  cleanup(): Promise<void>;
  requestSummary(): ReadonlyArray<{ method: string; path: string; status: number }>;
  redact(value: unknown): unknown;
}>;

type FixtureState = {
  username: string;
  password: string;
  statusMode: FixtureStatusMode;
  contactStatusOverrides: Map<string, FixtureStatusMode>;
  contactSnapshotVersion: 1 | 2;
  handoffs: Map<string, { state: string; verifier: string; redirectUri: string; audience: string; expiresAt: number }>;
  sessions: Map<string, { expiresAt: number; audience: string }>;
  certificates: Map<string, CertificateRecord>;
  requests: Array<{ method: string; path: string; status: number }>;
  server: Server | null;
};

type CertificateRecord = {
  id: string;
  leafDer: Buffer;
  intermediateDer: Buffer;
  rootDer: Buffer;
  certificateSha256: string;
  issuerCertificateSha256: string;
  serialNumber: string;
  issuerKeyIdentifier: string;
  signerId: string;
  deviceId: string;
  privateKeyPath: string;
};

function configValue(name: string, fallback?: string): string | undefined {
  return process.env[name] || fallback;
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function sha256Identifier(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function base64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64").replace(/=/gu, "").replace(/\+/gu, "-").replace(/\//gu, "_");
}

function canonicalP256Signature(signature: Buffer): Buffer {
  if (signature.byteLength !== 64) throw new Error(`unexpected P-256 signature length: ${signature.byteLength}`);
  const s = BigInt(`0x${signature.subarray(32).toString("hex")}`);
  if (s <= P256_HALF_ORDER) return signature;
  const normalized = Buffer.from(signature);
  const lowS = (P256_ORDER - s).toString(16).padStart(64, "0");
  Buffer.from(lowS, "hex").copy(normalized, 32);
  return normalized;
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(object[key])}`).join(",")}}`;
  }
  throw new Error("unsupported canonical JSON value");
}

function sanitize(value: unknown): unknown {
  if (typeof value === "string") {
    return value
      .replace(/(handoff_code|access_token|session_token|refresh_token|password|code_verifier)=([^&\s]+)/giu, "$1=<redacted>")
      .replace(/https?:\/\/[^\s?]+\?[^\s]*/giu, (url) => url.split("?")[0]);
  }
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => {
      const secret = /password|token|handoff|verifier|private[_-]?key|authorization/iu.test(key);
      return [key, secret ? "<redacted>" : sanitize(item)];
    }));
  }
  return value;
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.from(chunk));
    if (Buffer.concat(chunks).length > 2 * 1024 * 1024) throw new Error("fixture request too large");
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) as Record<string, unknown> : {};
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(payload) });
  response.end(payload);
}

function sendHtml(response: ServerResponse, status: number, body: string): void {
  response.writeHead(status, { "content-type": "text/html; charset=utf-8", "content-length": Buffer.byteLength(body) });
  response.end(body);
}

function sendPem(response: ServerResponse, status: number, pem: Buffer): void {
  response.writeHead(status, { "content-type": "application/x-pem-file", "content-length": pem.byteLength });
  response.end(pem);
}

function openssl(args: string[], cwd: string): void {
  execFileSync("openssl", args, { cwd, stdio: "ignore", windowsHide: true, env: { ...process.env, OPENSSL_CONF: path.join(cwd, "openssl.cnf") } });
}

function generateCa(fixtureDir: string): { rootPem: string; rootDer: Buffer; intermediateDer: Buffer } {
  const opensslConfig = path.join(fixtureDir, "openssl.cnf");
  if (!existsSync(opensslConfig)) {
    writeFileSync(opensslConfig, [
      "openssl_conf = openssl_init",
      "[openssl_init]",
      "providers = provider_sect",
      "[provider_sect]",
      "default = default_sect",
      "[default_sect]",
      "activate = 1",
      "[req]",
      "distinguished_name = req_distinguished_name",
      "[req_distinguished_name]",
      "",
    ].join("\n"));
  }
  const rootKey = path.join(fixtureDir, "root.key");
  const rootPem = path.join(fixtureDir, "root.pem");
  const intermediateKey = path.join(fixtureDir, "intermediate.key");
  const intermediateCsr = path.join(fixtureDir, "intermediate.csr");
  const intermediatePem = path.join(fixtureDir, "intermediate.pem");
  const intermediateExt = path.join(fixtureDir, "intermediate.ext");
  if (!existsSync(rootPem) || !existsSync(intermediatePem)) {
    openssl(["ecparam", "-name", "prime256v1", "-genkey", "-noout", "-out", rootKey], fixtureDir);
    openssl(["req", "-x509", "-new", "-sha256", "-days", "3650", "-key", rootKey, "-subj", "/CN=TZAP E2E Fixture Root/O=TZAP E2E", "-addext", "basicConstraints=critical,CA:TRUE,pathlen:2", "-addext", "keyUsage=critical,keyCertSign,cRLSign", "-addext", "subjectKeyIdentifier=hash", "-out", rootPem], fixtureDir);
    openssl(["ecparam", "-name", "prime256v1", "-genkey", "-noout", "-out", intermediateKey], fixtureDir);
    openssl(["req", "-new", "-sha256", "-key", intermediateKey, "-subj", "/CN=TZAP E2E Fixture Intermediate/O=TZAP E2E", "-out", intermediateCsr], fixtureDir);
    writeFileSync(intermediateExt, [
      "basicConstraints=critical,CA:TRUE,pathlen:0",
      "keyUsage=critical,keyCertSign,cRLSign",
      "subjectKeyIdentifier=hash",
      "authorityKeyIdentifier=keyid,issuer",
      "crlDistributionPoints=URI:http://127.0.0.1:8787/v1/status",
      `certificatePolicies=${CA_POLICY_OID}`,
    ].join("\n"));
    openssl(["x509", "-req", "-sha256", "-days", "3650", "-in", intermediateCsr, "-CA", rootPem, "-CAkey", rootKey, "-set_serial", "1001", "-extfile", intermediateExt, "-out", intermediatePem], fixtureDir);
  }
  const rootDer = execFileSync("openssl", ["x509", "-in", rootPem, "-outform", "DER"], { cwd: fixtureDir, windowsHide: true, env: { ...process.env, OPENSSL_CONF: opensslConfig } });
  const intermediateDer = execFileSync("openssl", ["x509", "-in", intermediatePem, "-outform", "DER"], { cwd: fixtureDir, windowsHide: true, env: { ...process.env, OPENSSL_CONF: opensslConfig } });
  return { rootPem, rootDer, intermediateDer };
}

function issueCertificate(
  fixtureDir: string,
  ca: { rootPem: string; rootDer: Buffer; intermediateDer: Buffer },
  id: string,
  csrPem: Buffer,
  signerId: string,
  deviceId: string,
  privateKeyPath: string,
): CertificateRecord {
  const csrPath = path.join(fixtureDir, `${id}.csr.pem`);
  const leafPem = path.join(fixtureDir, `${id}.pem`);
  const leafExt = path.join(fixtureDir, `${id}.ext`);
  const intermediatePem = path.join(fixtureDir, "intermediate.pem");
  writeFileSync(csrPath, csrPem);
  const metadata = canonicalize({
    assurance_level: "oauth_verified_email",
    policy_oid: LEAF_POLICY_OID,
    public_device_id: deviceId,
    public_org_id: null,
    public_signer_id: signerId,
    version: 1,
  });
  writeFileSync(leafExt, [
    "basicConstraints=critical,CA:FALSE",
    "keyUsage=critical,digitalSignature",
    `extendedKeyUsage=${DOCUMENT_SIGNING_EKU_OID}`,
    "authorityKeyIdentifier=keyid,issuer",
    `certificatePolicies=${LEAF_POLICY_OID}`,
    `${METADATA_OID}=DER:${Buffer.from(metadata).toString("hex")}`,
  ].join("\n"));
  const serial = 2000 + (createHash("sha256").update(id).digest().readUInt16BE(0) % 60000);
  openssl(["x509", "-req", "-sha256", "-days", "90", "-in", csrPath, "-CA", intermediatePem, "-CAkey", path.join(fixtureDir, "intermediate.key"), "-set_serial", String(serial), "-extfile", leafExt, "-out", leafPem], fixtureDir);
  const opensslEnv = { ...process.env, OPENSSL_CONF: path.join(fixtureDir, "openssl.cnf") };
  const leafDer = execFileSync("openssl", ["x509", "-in", leafPem, "-outform", "DER"], { cwd: fixtureDir, windowsHide: true, env: opensslEnv });
  const leafInfo = execFileSync("openssl", ["x509", "-in", leafPem, "-noout", "-serial"], { cwd: fixtureDir, windowsHide: true, env: opensslEnv }).toString("utf8").trim();
  const leafText = execFileSync("openssl", ["x509", "-in", leafPem, "-noout", "-text"], { cwd: fixtureDir, windowsHide: true, env: opensslEnv }).toString("utf8");
  const akiHex = /Authority Key Identifier:\s*\n\s*([0-9A-F:]+)/iu.exec(leafText)?.[1]?.replace(/:/gu, "");
  if (!akiHex) throw new Error(`fixture certificate ${id} has no authority key identifier`);
  return {
    id,
    leafDer,
    intermediateDer: ca.intermediateDer,
    rootDer: ca.rootDer,
    certificateSha256: sha256Identifier(leafDer),
    issuerCertificateSha256: sha256Identifier(ca.intermediateDer),
    serialNumber: leafInfo.replace(/^serial=/iu, "").toUpperCase(),
    issuerKeyIdentifier: base64Url(Buffer.from(akiHex, "hex")),
    signerId,
    deviceId,
    privateKeyPath,
  };
}

function statusBody(record: CertificateRecord, mode: FixtureStatusMode): Record<string, unknown> {
  const status = mode === "revoked" ? "revoked" : "valid";
  return {
    status,
    certificate_sha256: mode === "mismatch" ? sha256Identifier(Buffer.from("mismatch")) : record.certificateSha256,
    issuer_certificate_sha256: record.issuerCertificateSha256,
    issuer_key_identifier: record.issuerKeyIdentifier,
    serial_number: record.serialNumber,
    not_before_unix_seconds: nowSeconds() - 60,
    not_after_unix_seconds: nowSeconds() + 90 * 24 * 60 * 60,
    this_update_unix_seconds: nowSeconds() - 5,
    next_update_unix_seconds: nowSeconds() + 60 * 60,
    ...(mode === "revoked" ? { revoked_at_unix_seconds: nowSeconds() - 1, revocation_reason: "key_compromise", revocation_category: "compromise" } : {}),
    query: { certificate_sha256: record.certificateSha256 },
  };
}

function unavailableStatusBody(record: CertificateRecord): Record<string, unknown> {
  return { ...statusBody(record, "valid"), this_update_unix_seconds: nowSeconds() - 3600, next_update_unix_seconds: nowSeconds() - 1 };
}

function statusModeForContact(
  contact: ContactCardFixture | undefined,
  state: FixtureState,
): FixtureStatusMode {
  return contact
    ? state.contactStatusOverrides.get(contact.certificate.certificateSha256)
      ?? state.contactStatusOverrides.get(contact.contactId)
      ?? state.statusMode
    : state.statusMode;
}

type ContactCardFixture = { contactId: string; card: Record<string, unknown>; certificate: CertificateRecord };

function fixtureSnapshot(version: 1 | 2, contacts: { a: ContactCardFixture; b: ContactCardFixture; aUpdated: ContactCardFixture; c: ContactCardFixture }, acceptedAt: number): Record<string, unknown> {
  const entry = (contact: ContactCardFixture, timestamp: number, localAlias?: string) => ({ contact_id: contact.contactId, card: contact.card, ...(localAlias ? { local_alias: localAlias } : {}), accepted_at: timestamp });
  return {
    format: "plain",
    version: 1,
    contacts: version === 1 ? [entry(contacts.a, acceptedAt, "Fixture A"), entry(contacts.b, acceptedAt, "Fixture B"), { contact_id: "fixture-contact-invalid", card: { invalid: true }, accepted_at: acceptedAt }] : [entry(contacts.aUpdated, acceptedAt + 1, "Fixture A (updated)"), entry(contacts.c, acceptedAt + 1, "Fixture C") , { contact_id: "fixture-contact-invalid", card: { invalid: true }, accepted_at: acceptedAt + 1 }],
    removed: version === 2 ? [{ contact_id: contacts.b.contactId, removed_at: acceptedAt + 1 }] : [],
  };
}

function createFixture(): OnlineFixture {
  const runId = configValue("TZAP_E2E_RUN_ID") ?? randomUUID();
  const artifactDir = path.resolve(configValue("TZAP_E2E_ARTIFACT_DIR", path.join(os.tmpdir(), "zmanager-online-e2e", runId)) ?? path.join(os.tmpdir(), "zmanager-online-e2e", runId));
  const safeRunId = runId.replace(/[^a-zA-Z0-9_-]/gu, "-");
  const secretDir = path.join(os.tmpdir(), "zmanager-online-e2e-secrets", safeRunId);
  rmSync(secretDir, { recursive: true, force: true });
  const fixtureDir = secretDir;
  mkdirSync(fixtureDir, { recursive: true });
  const ca = generateCa(fixtureDir);
  const rootCertificatePath = path.resolve(configValue("TZAP_E2E_FIXTURE_ROOT_CERT", path.join(artifactDir, "fixture-root.pem")) ?? path.join(artifactDir, "fixture-root.pem"));
  writeFileSync(rootCertificatePath, readFileSync(ca.rootPem));
  const configuredUsername = configValue("TZAP_E2E_USERNAME");
  const configuredPassword = configValue("TZAP_E2E_PASSWORD");
  const state: FixtureState = {
    username: configuredUsername ?? `fixture-${runId.slice(-12)}`,
    password: configuredPassword ?? base64Url(randomBytes(24)),
    statusMode: "valid",
    contactStatusOverrides: new Map(),
    contactSnapshotVersion: 1,
    handoffs: new Map(),
    sessions: new Map(),
    certificates: new Map(),
    requests: [],
    server: null,
  };
  const contactAKey = path.join(fixtureDir, "contact-a-recipient.key");
  opensslIfMissing(contactAKey, ["ecparam", "-name", "prime256v1", "-genkey", "-noout", "-out", contactAKey], fixtureDir);
  const contacts = {
    a: createContactCard(fixtureDir, ca, "contact-a", "Receiver Contact A", "psign_E2EContactASigner01", "pdev_E2EContactADevice01", contactAKey),
    b: createContactCard(fixtureDir, ca, "contact-b", "Receiver Contact B", "psign_E2EContactBSigner01", "pdev_E2EContactBDevice01"),
    aUpdated: createContactCard(fixtureDir, ca, "contact-a-updated", "Receiver Contact A (updated)", "psign_E2EContactAUpdated01", "pdev_E2EContactADevice01", contactAKey),
    c: createContactCard(fixtureDir, ca, "contact-c", "Receiver Contact C", "psign_E2EContactCSigner01", "pdev_E2EContactCDevice01"),
  };
  for (const contact of Object.values(contacts)) state.certificates.set(contact.certificate.id, contact.certificate);
  const snapshotAcceptedAt = nowSeconds();

  const recordRequest = (request: IncomingMessage, status: number): void => {
    state.requests.push({ method: request.method ?? "GET", path: new URL(request.url ?? "/", "http://fixture").pathname, status });
    if (state.requests.length > 500) state.requests.shift();
  };

  const handler = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const url = new URL(request.url ?? "/", "http://fixture");
    let status = 200;
    try {
      if (request.method === "GET" && url.pathname === "/auth/launch") {
        const stateParam = url.searchParams.get("state") ?? "";
        sendHtml(response, 200, `<!doctype html><title>TZAP Fixture Login</title><form method="post" action="/auth/login"><input name="username" autocomplete="username"><input name="password" type="password" autocomplete="current-password"><input type="hidden" name="state" value="${stateParam}"><input type="hidden" name="code_verifier" value="${url.searchParams.get("code_challenge") ?? ""}"><input type="hidden" name="redirect_uri" value="${url.searchParams.get("redirect_uri") ?? CALLBACK_URL}"><input type="hidden" name="audience" value="${url.searchParams.get("audience") ?? AUDIENCE}"><button type="submit">Sign in</button></form>`);
      } else if (request.method === "POST" && url.pathname === "/auth/login") {
        const body = await readForm(request);
        if (body.username !== state.username || body.password !== state.password) {
          status = 401;
          sendHtml(response, status, "<!doctype html><title>Login failed</title><p>Sign-in failed.</p>");
        } else {
          const handoffCode = `handoff-${base64Url(randomBytes(24))}`;
          state.handoffs.set(handoffCode, { state: body.state, verifier: body.code_verifier, redirectUri: body.redirect_uri, audience: body.audience, expiresAt: nowSeconds() + 600 });
          const callback = `${CALLBACK_URL}?state=${encodeURIComponent(body.state)}&result=completed&handoff_code=${encodeURIComponent(handoffCode)}`;
          sendHtml(response, 200, `<!doctype html><title>Continue in ZManager</title><a id="deep-link" href="${callback}">Continue in ZManager</a><code data-callback-url="${callback}"></code>`);
        }
      } else if (request.method === "POST" && url.pathname === "/auth/session/exchange") {
        const body = await readJson(request);
        const code = String(body.handoff_code ?? "");
        const handoff = state.handoffs.get(code);
        if (!handoff || handoff.expiresAt < nowSeconds() || body.state !== handoff.state || body.redirect_uri !== handoff.redirectUri || body.required_audience !== handoff.audience) {
          status = 400;
          sendJson(response, status, { error: "invalid_handoff" });
        } else {
          state.handoffs.delete(code);
          const sessionToken = `session-${base64Url(randomBytes(24))}`;
          state.sessions.set(sessionToken, { expiresAt: nowSeconds() + 3600, audience: handoff.audience });
          sendJson(response, 200, { session_token: sessionToken, session_id: `login-${runId}`, audience: handoff.audience, expires_at_unix_seconds: nowSeconds() + 3600, identity_assurance: "oauth_verified_email" });
        }
      } else if (request.method === "GET" && url.pathname === "/v1/me") {
        requireSession(request, state);
        sendJson(response, 200, { display_name: "Hosted E2E Account", public_signer_id: "psign_E2EHostedSigner01", assurance_level: "oauth_verified_email", selected_org_id: null });
      } else if (request.method === "POST" && url.pathname === "/v1/certificates/enrollment-challenges") {
        const body = await readJson(request);
        requireSession(request, state);
        const id = `certificate-online-${state.certificates.size + 1}`;
        sendJson(response, 200, { challenge_id: `challenge-${id}`, challenge_payload: { canonicalization: "JCS-JSON", audience: LOCAL_ENROLLMENT_AUDIENCE, operation: "enroll", challenge_id: `challenge-${id}`, session_id: `login-${runId}`, csr_sha256: body.csr_sha256, device_public_key_fingerprint: body.device_public_key_fingerprint, org_id: null, requested_validity_days: 90, renewal_of_certificate_sha256: null, expires_at: new Date(Date.now() + 300_000).toISOString() }, canonicalization: "JCS-JSON" });
      } else if (request.method === "POST" && url.pathname === "/v1/certificates/enroll") {
        const body = await readJson(request);
        requireSession(request, state);
        const id = `certificate-online-${state.certificates.size + 1}`;
        const csrPem = Buffer.from(String(body.csr_pem ?? ""));
        const record = issueCertificate(fixtureDir, ca, id, csrPem, "psign_E2EHostedSigner01", "pdev_E2EHostedDevice01", "");
        state.certificates.set(id, record);
        sendJson(response, 200, { certificate: certificatePayload(record) });
      } else if (request.method === "POST" && /^\/v1\/certificates\/[^/]+\/renew$/u.test(url.pathname)) {
        const body = await readJson(request);
        requireSession(request, state);
        const predecessor = state.certificates.get(url.pathname.split("/")[3]);
        if (!predecessor) { status = 404; sendJson(response, status, { error: "certificate_not_found" }); }
        else {
          const id = `certificate-online-${state.certificates.size + 1}`;
          const record = issueCertificate(fixtureDir, ca, id, Buffer.from(String(body.csr_pem ?? "")), predecessor.signerId, predecessor.deviceId, predecessor.privateKeyPath);
          state.certificates.set(id, record);
          sendJson(response, 200, { certificate: { ...certificatePayload(record), predecessor_certificate_id: predecessor.id, predecessor_certificate_sha256: predecessor.certificateSha256 } });
        }
      } else if (request.method === "GET" && url.pathname === "/v1/me/contact-backup") {
        requireSession(request, state);
        sendJson(response, 200, { version: state.contactSnapshotVersion, updated_at: new Date().toISOString(), payload: fixtureSnapshot(state.contactSnapshotVersion, contacts, snapshotAcceptedAt) });
      } else if (request.method === "POST" && url.pathname === "/v1/status/bulk") {
        const body = await readJson(request);
        if (state.statusMode === "unavailable") { status = 503; sendJson(response, status, { error: "status_unavailable" }); }
        else {
          const lookups = Array.isArray(body.lookups) ? body.lookups as Array<Record<string, unknown>> : [];
          sendJson(response, 200, { results: lookups.map((lookup) => {
            const record = [...state.certificates.values()].find((candidate) => candidate.certificateSha256 === lookup.certificate_sha256);
            const contact = Object.values(contacts).find((candidate) => candidate.certificate.certificateSha256 === record?.certificateSha256);
            const contactMode = statusModeForContact(contact, state);
            return {
              lookup_id: lookup.lookup_id,
              status_response: record
                ? contactMode === "unavailable"
                  ? unavailableStatusBody(record)
                  : statusBody(record, contactMode)
                : { status: "unknown_certificate", query: lookup },
            };
          }) });
        }
      } else if (request.method === "GET" && url.pathname.startsWith("/v1/status/certificates/by-fingerprint/")) {
        if (state.statusMode === "unavailable") { status = 503; sendJson(response, status, { error: "status_unavailable" }); }
        else {
          const requestedFingerprint = decodeURIComponent(url.pathname.slice("/v1/status/certificates/by-fingerprint/".length));
          const record = [...state.certificates.values()].find((candidate) => candidate.certificateSha256 === requestedFingerprint);
          const contact = Object.values(contacts).find((candidate) => candidate.certificate.certificateSha256 === record?.certificateSha256);
          const contactMode = statusModeForContact(contact, state);
          sendJson(response, 200, record
            ? contactMode === "unavailable"
              ? unavailableStatusBody(record)
              : statusBody(record, contactMode)
            : { status: "unknown_certificate", query: { certificate_sha256: requestedFingerprint } });
        }
      } else if (request.method === "GET" && url.pathname === "/fixture/root.pem") {
        sendPem(response, 200, readFileSync(ca.rootPem));
      } else if (request.method === "POST" && url.pathname === "/test/control") {
        const body = await readJson(request);
        if (body.statusMode === "valid" || body.statusMode === "unavailable" || body.statusMode === "revoked" || body.statusMode === "mismatch") state.statusMode = body.statusMode;
        if (typeof body.contactId === "string" && (body.contactStatus === "valid" || body.contactStatus === "unavailable" || body.contactStatus === "revoked" || body.contactStatus === "mismatch")) {
          const matchingContacts = Object.values(contacts).filter((candidate) => candidate.contactId === body.contactId);
          if (matchingContacts.length === 0) state.contactStatusOverrides.set(body.contactId, body.contactStatus);
          for (const contact of matchingContacts) state.contactStatusOverrides.set(contact.certificate.certificateSha256, body.contactStatus);
        }
        if (body.contactSnapshotVersion === 1 || body.contactSnapshotVersion === 2) state.contactSnapshotVersion = body.contactSnapshotVersion;
        sendJson(response, 200, { ok: true, statusMode: state.statusMode, contactSnapshotVersion: state.contactSnapshotVersion });
      } else {
        status = 404;
        sendJson(response, status, { error: "not_found" });
      }
    } catch (error) {
      status = error instanceof Error && error.message === "unauthorized" ? 401 : 500;
      sendJson(response, status, { error: status === 401 ? "unauthorized" : "fixture_failure" });
    } finally {
      recordRequest(request, status);
    }
  };

  return {
    baseUrl: `http://127.0.0.1:${LOCAL_PORT}`,
    username: state.username,
    password: state.password,
    rootCertificatePath,
    receiverPrivateKeyPath: contactAKey,
    contactCards: Object.entries(contacts).map(([name, contact]) => ({ name, card: contact.card })),
    get contactSnapshotVersion() { return state.contactSnapshotVersion; },
    async start() {
      if (state.server) return;
      state.server = createServer((request, response) => { void handler(request, response); });
      await new Promise<void>((resolveStart, reject) => {
        state.server!.once("error", reject);
        state.server!.listen(LOCAL_PORT, "127.0.0.1", () => resolveStart());
      });
    },
    async stop() {
      if (!state.server) return;
      await new Promise<void>((resolveStop) => state.server!.close(() => resolveStop()));
      state.server = null;
    },
    async setStatus(mode: FixtureStatusMode) { state.statusMode = mode; },
    async setContactStatus(contactId: string, mode: FixtureStatusMode) { state.contactStatusOverrides.set(contactId, mode); },
    async setContactSnapshotVersion(version: 1 | 2) { state.contactSnapshotVersion = version; },
    async cleanup() { rmSync(secretDir, { recursive: true, force: true }); },
    requestSummary() { return state.requests.map((request) => ({ ...request })); },
    redact(value: unknown) { return sanitize(value); },
  } satisfies OnlineFixture;

}

async function readForm(request: IncomingMessage): Promise<Record<string, string>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  const params = new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
  return Object.fromEntries([...params.entries()]);
}

function requireSession(request: IncomingMessage, state: FixtureState): void {
  const header = request.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  const session = state.sessions.get(token);
  if (!session || session.expiresAt <= nowSeconds()) throw new Error("unauthorized");
}

function certificatePayload(record: CertificateRecord): Record<string, unknown> {
  return {
    certificate_id: record.id,
    leaf_certificate_der: base64Url(record.leafDer),
    intermediate_chain_der: [base64Url(record.intermediateDer), base64Url(record.rootDer)],
    issuer_certificate_sha256: record.issuerCertificateSha256,
    issuer_key_identifier: record.issuerKeyIdentifier,
    serial_number: record.serialNumber,
    certificate_sha256: record.certificateSha256,
    not_before_unix_seconds: nowSeconds() - 60,
    not_after_unix_seconds: nowSeconds() + 90 * 24 * 60 * 60,
    renewal_grace_period_days: 30,
    renewal_recommended_within_days: 14,
    sign_device_id: record.deviceId,
  };
}

export function createOnlineFixture(): OnlineFixture {
  const fixture = createFixture();
  // Bind the control helper after the server object exists, without exposing
  // request bodies or secrets to the test output.
  const baseUrl = fixture.baseUrl;
  const control = async (body: Record<string, unknown>): Promise<void> => {
    const response = await fetch(`${baseUrl}/test/control`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (!response.ok) throw new Error(`fixture control failed: ${response.status}`);
  };
  return {
    ...fixture,
    setStatus: async (mode) => control({ statusMode: mode }),
    setContactStatus: async (contactId, mode) => control({ contactId, contactStatus: mode }),
    setContactSnapshotVersion: async (version) => control({ contactSnapshotVersion: version }),
  };
}

function opensslIfMissing(outputPath: string, args: string[], cwd: string): void {
  if (!existsSync(outputPath)) openssl(args, cwd);
}

function createContactCard(
  fixtureDir: string,
  ca: { rootPem: string; rootDer: Buffer; intermediateDer: Buffer },
  id: string,
  displayName: string,
  signerId: string,
  deviceId: string,
  recipientKeyPath?: string,
): ContactCardFixture {
  const keyPath = recipientKeyPath ?? path.join(fixtureDir, `${id}-recipient.key`);
  opensslIfMissing(keyPath, ["ecparam", "-name", "prime256v1", "-genkey", "-noout", "-out", keyPath], fixtureDir);
  const csr = execFileSync("openssl", ["req", "-new", "-sha256", "-key", keyPath, "-subj", `/CN=${displayName}/O=TZAP E2E`,], { cwd: fixtureDir, windowsHide: true, env: { ...process.env, OPENSSL_CONF: path.join(fixtureDir, "openssl.cnf") } });
  const certificate = issueCertificate(fixtureDir, ca, id, csr, signerId, deviceId, keyPath);
  const signingKeyPath = path.join(fixtureDir, `${id}-signing.pk8`);
  opensslIfMissing(signingKeyPath, ["pkcs8", "-topk8", "-nocrypt", "-in", keyPath, "-out", signingKeyPath], fixtureDir);
  const recipientPublicKey = execFileSync("openssl", ["ec", "-in", keyPath, "-pubout", "-outform", "DER"], { cwd: fixtureDir, windowsHide: true, env: { ...process.env, OPENSSL_CONF: path.join(fixtureDir, "openssl.cnf") } });
  const contactId = sha256Identifier(recipientPublicKey);
  const payload = {
    contact_card_version: 1,
    recipient_key_algorithm: "P-256-SPKI",
    recipient_public_key: base64Url(recipientPublicKey),
    recipient_key_fingerprint: contactId,
    display_name: displayName,
    device_label: "Fixture Receiver",
    created_at_unix_seconds: nowSeconds(),
    expires_at_unix_seconds: null,
    signing_certificate_sha256: certificate.certificateSha256,
    signing_certificate_der: base64Url(certificate.leafDer),
    signing_public_metadata: {
      version: 1,
      public_signer_id: signerId,
      public_org_id: null,
      public_device_id: deviceId,
      assurance_level: "oauth_verified_email",
      policy_oid: LEAF_POLICY_OID,
    },
    intermediate_chain_der: [base64Url(certificate.intermediateDer)],
  };
  const signature = canonicalP256Signature(sign("sha256", Buffer.from(canonicalize(payload)), { key: readFileSync(signingKeyPath), dsaEncoding: "ieee-p1363" }));
  return { contactId, card: { version: 1, payload, signature_algorithm: "ECDSA-P256-SHA256", signature: base64Url(signature) }, certificate };
}

export function sanitizeOnlineEvidence(value: unknown): unknown {
  return sanitize(value);
}

export function onlineFixtureConfig(): { environment: "local" | "staging"; artifactDir: string; username?: string; password?: string } {
  const environment = (process.env.TZAP_E2E_ENV ?? "local") as "local" | "staging";
  if (environment !== "local" && environment !== "staging") throw new Error("Unsupported TZAP_E2E_ENV");
  return {
    environment,
    artifactDir: path.resolve(process.env.TZAP_E2E_ARTIFACT_DIR ?? path.join(os.tmpdir(), "zmanager-online-e2e", process.env.TZAP_E2E_RUN_ID ?? "adhoc")),
    username: process.env.TZAP_E2E_USERNAME,
    password: process.env.TZAP_E2E_PASSWORD,
  };
}
