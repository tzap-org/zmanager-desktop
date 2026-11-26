#!/usr/bin/env python3
"""Stage, resume, and publish a Desktop release from its immutable signed inputs."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import pathlib
import re
import shutil
import subprocess
import sys
import tempfile
import time
import uuid
import zipfile

VARIANTS = {(arch, profile) for arch in ("arm64", "x86_64") for profile in ("local", "online")}
MARKER = re.compile(r"<!-- zmanager-desktop-notarization-v1\n([^\n]+)\n-->\n?")
TAG = re.compile(r"v[0-9]+\.[0-9]+\.[0-9]+(?:[-+][A-Za-z0-9.+-]+)?")
SHA = re.compile(r"[0-9a-f]{64}")
STALE_SECONDS = 48 * 60 * 60
HISTORY_GRACE_SECONDS = 25 * 60
RELEASE_ERRORS = (KeyError, OSError, ValueError, subprocess.SubprocessError, zipfile.BadZipFile)


def command(*args, stdout=subprocess.PIPE, data=None, timeout=120):
    # Keep large binary downloads on disk and avoid echoing credentials or command arguments.
    return subprocess.run(args, input=data, stdout=stdout, check=True, timeout=timeout).stdout


def git(*args):
    return command("git", *args).decode().strip()


def repository():
    return os.environ["GITHUB_REPOSITORY"]


def gh(*args, **kwargs):
    return command("gh", *args, **kwargs)


def api(path, *, pages=False, payload=None):
    args = ["api", f"repos/{repository()}/{path}"]
    if pages:
        args.extend(("--paginate", "--slurp"))
    if payload is not None:
        args.extend(("--method", "PATCH", "--input", "-"))
    return json.loads(gh(*args, data=None if payload is None else json.dumps(payload).encode()))


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def base_name(tag, arch, profile):
    if not TAG.fullmatch(tag) or (arch, profile) not in VARIANTS:
        raise ValueError("Invalid release tag or macOS variant")
    product = "ZManager-full" if profile == "online" else "ZManager"
    return f"{product}-{tag[1:]}-macos-{arch}"


def final_names(tag, entry):
    base = base_name(tag, entry["arch"], entry["profile"])
    return {base + suffix for suffix in (".zip", ".dmg", "-inspection.json", "-SHA256SUMS.txt")}


def record_inputs(stage, output):
    tag = os.environ["ZMANAGER_RELEASE_TAG"]
    arch, profile = os.environ["TARGET_ARCH"], os.environ["TARGET_PROFILE"]
    base = base_name(tag, arch, profile)
    output.write_text(json.dumps({
        "arch": arch, "profile": profile, "tag": tag, "commit": git("rev-parse", "HEAD"),
        "team": os.environ["ZMANAGER_TEAM_ID"], "artifact": int(os.environ["SIGNED_ARTIFACT_ID"]),
        "sha256": {suffix: sha256(stage / f"{base}.{suffix}") for suffix in ("zip", "dmg")},
    }) + "\n")


def validate(manifest):
    tag = manifest["tag"]
    if not TAG.fullmatch(tag) or not re.fullmatch(r"[0-9a-f]{40}", manifest["commit"]):
        raise ValueError("Invalid notarization release identity")
    if type(manifest["test"]) is not bool or type(manifest["run"]) is not int or manifest["run"] <= 0:
        raise ValueError("Invalid notarization workflow run")
    records = manifest["records"]
    if len(records) != len(VARIANTS) or {(r["arch"], r["profile"]) for r in records} != VARIANTS:
        raise ValueError("Expected exactly one signed input for each macOS variant")
    teams = {r["team"] for r in records}
    if len(teams) != 1 or not all(re.fullmatch(r"[A-Z0-9]{10}", team) for team in teams):
        raise ValueError("Signed inputs must use the same Developer ID team")
    for entry in records:
        if (entry["tag"], entry["commit"]) != (tag, manifest["commit"]):
            raise ValueError("Signed inputs belong to different release commits or tags")
        if type(entry["artifact"]) is not int or entry["artifact"] <= 0:
            raise ValueError("Invalid Actions artifact ID")
        hashes = entry["sha256"]
        if set(hashes) != {"zip", "dmg"} or not all(SHA.fullmatch(h) for h in hashes.values()):
            raise ValueError("Invalid signed input checksums")
        if "submission" in entry:
            uuid.UUID(entry["submission"])
        if "finished" in entry:
            finished = entry["finished"]
            if ("submission" not in entry or set(finished) != final_names(tag, entry)
                    or not all(SHA.fullmatch(digest) for digest in finished.values())):
                raise ValueError("Incomplete or invalid finalized macOS packages")
    return manifest


def make_manifest(records, *, test):
    return validate({
        "tag": os.environ["ZMANAGER_RELEASE_TAG"], "commit": git("rev-parse", "HEAD"),
        "run": int(os.environ["GITHUB_RUN_ID"]), "test": test, "created": int(time.time()),
        "records": [json.loads(path.read_text()) for path in sorted(records.glob("notarization-*.json"))],
    })


def state_comment(manifest):
    return f"<!-- zmanager-desktop-notarization-v1\n{json.dumps(manifest, separators=(',', ':'))}\n-->\n"


def releases():
    for page in api("releases?per_page=100", pages=True):
        yield from page


def stage_release(records, assets):
    manifest = make_manifest(records, test=False)
    tag = manifest["tag"]
    files = sorted(assets.iterdir())
    manifest["platform"] = {file.name: sha256(file) for file in files}
    existing = next((release for release in releases() if release["tag_name"] == tag), None)
    if existing:
        match = MARKER.search(existing.get("body") or "")
        if not existing["draft"] or not match:
            raise ValueError(f"A release already exists for {tag}")
        draft = validate(json.loads(match[1]))
        if any(draft[key] != manifest[key] for key in ("tag", "run", "commit", "platform", "test")):
            raise ValueError(f"Existing draft {tag} belongs to different release inputs")
        current = release_assets(existing["id"])
        uploaded = {name: digest for name, digest in draft["platform"].items()
                    if current.get(name, {}).get("state") == "uploaded"}
        verify_asset_hashes(uploaded, current)
        missing = [file for file in files if file.name not in uploaded]
        if missing:
            update_assets(existing["id"], tag, missing)
        verify_asset_hashes(draft["platform"], release_assets(existing["id"]))
        return

    notes = (
        "ZManager Desktop for macOS, Windows, and Linux. Default packages use the local profile. "
        "Packages marked full include online features. macOS packages are Developer ID signed "
        "and notarized. SHA256 checksums and third-party license notices are included.\n\n"
    )
    gh("release", "create", tag, *(str(file) for file in files), "--repo", repository(),
       "--verify-tag", "--draft", "--title", f"zmanager-desktop {tag}", "--generate-notes",
       "--notes", state_comment(manifest) + notes, timeout=1800)


def notary(*args):
    return json.loads(command(
        "xcrun", "notarytool", *args, "--key", os.environ["APPLE_API_KEY_PATH"],
        "--key-id", os.environ["MACOS_NOTARY_KEY_ID"], "--issuer", os.environ["MACOS_NOTARY_ISSUER_ID"],
        "--output-format", "json", timeout=600 if args[0] == "submit" else 60,
    ))


def submission_filename(manifest, entry):
    base = base_name(manifest["tag"], entry["arch"], entry["profile"])
    return f"{base}-run-{manifest['run']}-{entry['sha256']['dmg'][:16]}.dmg"


def signed_inputs(manifest, entry, work):
    artifact_id = entry["artifact"]
    artifact = api(f"actions/artifacts/{artifact_id}")
    expected_prefix = f"zmanager-macos-{entry['arch']}-{entry['profile']}-"
    if (artifact.get("expired") or artifact["workflow_run"]["id"] != manifest["run"]
            or not artifact["name"].startswith(expected_prefix)):
        raise ValueError(f"Incorrect or expired signed artifact {artifact_id}")
    archive = work / "signed-inputs.zip"
    with archive.open("wb") as stream:
        gh("api", f"repos/{repository()}/actions/artifacts/{artifact_id}/zip", stdout=stream, timeout=600)
    base = base_name(manifest["tag"], entry["arch"], entry["profile"])
    with zipfile.ZipFile(archive) as bundle:
        for suffix, digest in entry["sha256"].items():
            name = f"{base}.{suffix}"
            with bundle.open(name) as source, (work / name).open("wb") as destination:
                shutil.copyfileobj(source, destination)
            if sha256(work / name) != digest:
                raise ValueError(f"Signed input hash mismatch for {name}")
    archive.unlink()
    return base


def find_submission(filename):
    matches = {item["id"] for item in notary("history")["history"] if item["name"] == filename}
    if len(matches) > 1:
        raise ValueError(f"Multiple Apple submissions for {filename}; inspect notary history")
    return next(iter(matches), None)


def obtain_submission(manifest, entry, work, save):
    if entry.get("submission"):
        return entry["submission"]
    filename = submission_filename(manifest, entry)
    submission = find_submission(filename)
    if submission is None:
        # A lost response may be followed by a short delay in Apple's history.
        if time.time() - entry.get("attempted", 0) < HISTORY_GRACE_SECONDS:
            return None
        base = signed_inputs(manifest, entry, work)
        upload = work / filename
        (work / f"{base}.dmg").rename(upload)
        entry["attempted"] = int(time.time())
        save()
        submission = notary("submit", str(upload))["id"]
    uuid.UUID(submission)
    entry["submission"] = submission
    save()
    return submission


def verification_tree(commit, work):
    repo = work / "verification"
    repo.mkdir()
    archive = work / "verification.tar"
    command("git", "archive", "--format=tar", f"--output={archive}", commit,
            "package.json", "packaging/macos", "scripts/release-gate-macos.sh")
    command("tar", "-xf", str(archive), "-C", str(repo))
    return repo


def finalize_package(manifest, entry, work, output):
    base = signed_inputs(manifest, entry, work)
    app = work / f"{base}.app"
    zip_path = output / f"{base}.zip"
    dmg = output / f"{base}.dmg"
    command("ditto", "-x", "-k", str(work / f"{base}.zip"), str(work))
    shutil.move(work / f"{base}.dmg", dmg)
    command("xcrun", "stapler", "staple", str(app))
    command("xcrun", "stapler", "staple", str(dmg))
    command("ditto", "-c", "-k", "--sequesterRsrc", "--keepParent", str(app), str(zip_path))
    repo = verification_tree(manifest["commit"], work)
    command("env", f"ZMANAGER_TEAM_ID={entry['team']}", "bash", str(repo / "scripts/release-gate-macos.sh"),
            str(app), "--expected-arch", entry["arch"], "--zip", str(zip_path), "--dmg", str(dmg),
            "--require-developer-id", "--require-notarization", "--report",
            str(output / f"{base}-inspection.json"), stdout=None)
    (output / f"{base}-SHA256SUMS.txt").write_text(
        "".join(f"{sha256(path)}  {path.name}\n" for path in (zip_path, dmg))
    )


def check_variant(manifest, entry, work, save):
    submission = obtain_submission(manifest, entry, work, save)
    if submission is None:
        return "pending"
    status = notary("info", submission)["status"]
    print(f"{entry['arch']} {entry['profile']}: {submission} {status}", flush=True)
    if status == "In Progress":
        return "pending"
    if status not in {"Accepted", "Invalid", "Rejected"}:
        raise ValueError(f"Unrecognized Apple status for {submission}")
    log = notary("log", submission)
    if status != "Accepted":
        print(f"::error::Apple rejected {submission}: {json.dumps(log.get('issues', []))}")
        return "rejected"
    if log.get("sha256") != entry["sha256"]["dmg"]:
        raise ValueError(f"Apple log hash does not match signed DMG for {submission}")
    return "accepted"


def release_assets(release_id):
    return {asset["name"]: asset for page in api(f"releases/{release_id}/assets?per_page=100", pages=True)
            for asset in page}


def verify_asset_hashes(expected, assets):
    for name, digest in expected.items():
        asset = assets.get(name)
        if not asset or asset.get("state") != "uploaded" or asset.get("digest") != f"sha256:{digest}":
            raise ValueError(f"Missing or changed draft release asset: {name}")


def update_assets(release_id, tag, paths):
    current = api(f"releases/{release_id}")
    if not current["draft"] or current["tag_name"] != tag:
        raise ValueError(f"Release {tag} is no longer the staged draft")
    gh("release", "upload", tag, *(str(path) for path in paths), "--repo", repository(),
       "--clobber", timeout=1800)


def finish_release(release, manifest, notes):
    release_id = release["id"]
    tag = manifest["tag"]
    if manifest["test"] or release["tag_name"] != tag or git("rev-parse", f"refs/tags/{tag}^{{commit}}") != manifest["commit"]:
        raise ValueError(f"Draft or Git tag does not match signed inputs for {tag}")

    def save():
        api(f"releases/{release_id}", payload={"body": state_comment(manifest) + notes})

    expected = dict(manifest["platform"])
    mac_files = {name for entry in manifest["records"] for name in final_names(tag, entry)}
    if not expected or mac_files.intersection(expected):
        raise ValueError("Invalid Windows/Linux asset manifest")
    verify_asset_hashes(expected, release_assets(release_id))
    ready = True
    rejected = False
    for entry in manifest["records"]:
        with tempfile.TemporaryDirectory(prefix="zmanager-notary-") as temporary:
            work = pathlib.Path(temporary)
            try:
                if entry.get("finished"):
                    verify_asset_hashes(entry["finished"], release_assets(release_id))
                else:
                    status = check_variant(manifest, entry, work, save)
                    if status != "accepted":
                        ready = False
                        rejected |= status == "rejected"
                        continue
                    output = work / "final"
                    output.mkdir()
                    finalize_package(manifest, entry, work, output)
                    hashes = {path.name: sha256(path) for path in sorted(output.iterdir())}
                    if set(hashes) != final_names(tag, entry):
                        raise ValueError("Missing finalized macOS packages or inspection results")
                    update_assets(release_id, tag, sorted(output.iterdir()))
                    verify_asset_hashes(hashes, release_assets(release_id))
                    entry["finished"] = hashes
                    save()
                expected.update(entry["finished"])
            except RELEASE_ERRORS as error:
                report_error(f"{tag} {entry['arch']} {entry['profile']}", error)
                ready = False
                rejected = True
    if not ready:
        if time.time() - manifest["created"] >= STALE_SECONDS:
            print(f"::warning::{tag} has been pending notarization for at least 48 hours")
        return not rejected

    checksum_name = f"zmanager-desktop-{tag[1:]}-SHA256SUMS.txt"
    with tempfile.TemporaryDirectory() as temporary:
        checksums = pathlib.Path(temporary) / checksum_name
        checksums.write_text("".join(f"{digest}  {name}\n" for name, digest in sorted(expected.items())))
        update_assets(release_id, tag, [checksums])
        expected[checksum_name] = sha256(checksums)
    current = release_assets(release_id)
    verify_asset_hashes(expected, current)
    if set(expected) != set(current):
        raise ValueError("Unexpected draft assets; refusing to publish")
    api(f"releases/{release_id}", payload={"body": notes, "draft": False})
    print(f"Published {tag} with verified notarized packages.")


def report_error(context, error):
    # Subprocess exception text contains arguments such as Apple credentials. Keep those out of logs.
    if isinstance(error, subprocess.SubprocessError):
        detail = f"{error.cmd[0]} failed or timed out"
    else:
        detail = str(error)
    print(f"::error::{context}: {detail}", file=sys.stderr)


def resume_drafts(tag):
    found = False
    success = True
    for release in releases():
        if not release["draft"] or (tag and release["tag_name"] != tag):
            continue
        body = release.get("body") or ""
        match = MARKER.search(body)
        if match is None:
            continue
        found = True
        try:
            manifest = validate(json.loads(match[1]))
            result = finish_release(release, manifest, MARKER.sub("", body, count=1))
            success = success and result is not False
        except RELEASE_ERRORS as error:
            report_error(release["tag_name"], error)
            success = False
    if not found:
        print(f"No pending Desktop notarization drafts{f' for {tag}' if tag else ''}.")
    return success


def resume_test(run_id, output):
    run = api(f"actions/runs/{run_id}")
    if run["event"] != "workflow_dispatch" or run["path"] != ".github/workflows/release.yml" or run["conclusion"] != "success":
        raise ValueError("Expected a successful Release notarization test run")
    output.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as temporary:
        gh("run", "download", str(run_id), "--repo", repository(),
           "--name", "zmanager-notary-test", "--dir", temporary, timeout=120)
        manifest = validate(json.loads((pathlib.Path(temporary) / "desktop-notarization.json").read_text()))
    if not manifest["test"] or manifest["run"] != run_id or manifest["commit"] != run["head_sha"]:
        raise ValueError("Test record does not match the Release test run")

    def save():
        (output / "notarization-test-state.json").write_text(json.dumps(manifest, indent=2) + "\n")

    success = True
    verified = 0
    for entry in manifest["records"]:
        with tempfile.TemporaryDirectory(prefix="zmanager-notary-test-") as temporary:
            work = pathlib.Path(temporary)
            try:
                status = check_variant(manifest, entry, work, save)
                if status == "accepted":
                    final = work / "final"
                    final.mkdir()
                    finalize_package(manifest, entry, work, final)
                    for path in final.iterdir():
                        shutil.move(path, output / path.name)
                    verified += 1
                elif status == "rejected":
                    success = False
            except RELEASE_ERRORS as error:
                report_error(f"test {entry['arch']} {entry['profile']}", error)
                success = False
    save()
    print(f"Verified {verified} of {len(VARIANTS)} macOS variants. Resume this test with run ID {run_id}.")
    return success


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    for name in ("record", "manifest", "stage"):
        sub = commands.add_parser(name)
        sub.add_argument("source", type=pathlib.Path)
        sub.add_argument("output", type=pathlib.Path)
        if name == "manifest":
            sub.add_argument("--test", action="store_true", required=True)
    resume = commands.add_parser("resume")
    filters = resume.add_mutually_exclusive_group()
    filters.add_argument("--tag")
    filters.add_argument("--test-run-id", type=int)
    resume.add_argument("--output", type=pathlib.Path, default=pathlib.Path("notarization-test"))
    args = parser.parse_args()
    try:
        if args.command == "record":
            record_inputs(args.source, args.output)
        elif args.command == "manifest":
            args.output.write_text(json.dumps(make_manifest(args.source, test=args.test), indent=2) + "\n")
        elif args.command == "stage":
            stage_release(args.source, args.output)
        elif args.test_run_id is not None:
            return 0 if resume_test(args.test_run_id, args.output) else 1
        else:
            return 0 if resume_drafts(args.tag) else 1
    except RELEASE_ERRORS as error:
        report_error("Desktop notarization", error)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
