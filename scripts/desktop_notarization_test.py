"""Exercise the release resume and publication gates without contacting Apple or GitHub."""

import copy
import importlib.util
import pathlib
import subprocess
import tempfile
import time
import unittest
from unittest.mock import Mock, patch

SPEC = importlib.util.spec_from_file_location(
    "desktop_notarization", pathlib.Path(__file__).with_name("desktop-notarization.py")
)
notarization = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(notarization)

SUBMISSION = "4e3fd761-078f-4a2c-a301-4e8953a81f59"
DIGEST = "f" * 64
COMMIT = "a" * 40


def release_manifest():
    return {
        "tag": "v1.2.9", "commit": COMMIT, "test": False, "run": 123, "created": int(time.time()),
        "platform": {"zmanager-linux.deb": DIGEST},
        "records": [
            {"tag": "v1.2.9", "commit": COMMIT, "arch": arch, "profile": profile,
             "team": "ABCDEFGHIJ", "artifact": idx, "sha256": {"zip": DIGEST, "dmg": DIGEST}}
            for idx, (arch, profile) in enumerate(sorted(notarization.VARIANTS), 1)
        ],
    }


class DesktopNotarizationTest(unittest.TestCase):
    def test_fresh_runner_recovers_submission_after_lost_response(self):
        manifest = release_manifest()
        entry = manifest["records"][0]
        saved = Mock()
        filename = notarization.submission_filename(manifest, entry)

        def provide_inputs(_manifest, _entry, work):
            (work / "signed.dmg").write_bytes(b"the original artifact")
            return "signed"

        with tempfile.TemporaryDirectory() as temporary:
            work = pathlib.Path(temporary)
            with patch.object(notarization, "signed_inputs", side_effect=provide_inputs), patch.object(
                notarization, "notary", side_effect=[
                    {"history": []}, subprocess.TimeoutExpired(["notarytool"], 600),
                ]
            ):
                with self.assertRaises(subprocess.TimeoutExpired):
                    notarization.obtain_submission(manifest, entry, work, saved)

        self.assertIn("attempted", entry)
        self.assertNotIn("submission", entry)
        saved.assert_called_once()
        with tempfile.TemporaryDirectory() as temporary, patch.object(
            notarization, "notary", return_value={"history": [{"name": filename, "id": SUBMISSION}]}
        ) as apple, patch.object(notarization, "signed_inputs") as download:
            self.assertEqual(notarization.obtain_submission(
                manifest, entry, pathlib.Path(temporary), saved), SUBMISSION)
            apple.assert_called_once_with("history")
            download.assert_not_called()
        self.assertEqual(entry["submission"], SUBMISSION)

    def test_same_id_survives_multiple_pending_checks(self):
        manifest = release_manifest()
        entry = manifest["records"][0]
        entry["submission"] = SUBMISSION
        with patch.object(notarization, "notary", return_value={"status": "In Progress"}) as apple:
            for _ in range(2):
                self.assertEqual(notarization.check_variant(manifest, entry, None, Mock()), "pending")
        self.assertEqual([call.args for call in apple.call_args_list], [
            ("info", SUBMISSION), ("info", SUBMISSION),
        ])

    def test_accepted_submission_must_match_exact_dmg_hash(self):
        manifest = release_manifest()
        entry = manifest["records"][0]
        entry["submission"] = SUBMISSION
        with patch.object(notarization, "notary", side_effect=[
            {"status": "Accepted"}, {"sha256": "0" * 64},
        ]):
            with self.assertRaisesRegex(ValueError, "Apple log hash does not match"):
                notarization.check_variant(manifest, entry, None, Mock())

    def test_one_pending_or_rejected_variant_prevents_publication(self):
        for status in ("pending", "rejected"):
            with self.subTest(status=status):
                manifest = release_manifest()
                release = {"id": 10, "tag_name": manifest["tag"]}
                with patch.object(notarization, "git", return_value=COMMIT), patch.object(
                    notarization, "check_variant", return_value=status
                ), patch.object(notarization, "finalize_package") as finalize, patch.object(
                    notarization, "api"
                ) as api, patch.object(
                    notarization, "release_assets",
                    return_value={"zmanager-linux.deb": {"state": "uploaded", "digest": f"sha256:{DIGEST}"}},
                ):
                    self.assertEqual(notarization.finish_release(release, manifest, "notes"), status == "pending")
                    finalize.assert_not_called()
                    api.assert_not_called()

    def test_stage_retry_fills_missing_assets_without_changing_the_apple_checkpoint(self):
        staged = release_manifest()
        staged["records"][0]["submission"] = SUBMISSION
        with tempfile.TemporaryDirectory() as temporary:
            folder = pathlib.Path(temporary)
            payload = folder / "zmanager-linux.deb"
            payload.write_bytes(b"release input")
            digest = notarization.sha256(payload)
            staged["platform"] = {payload.name: digest}
            existing = {"id": 10, "tag_name": staged["tag"], "draft": True,
                        "body": notarization.state_comment(staged)}
            with patch.object(notarization, "make_manifest", return_value=release_manifest()), patch.object(
                notarization, "releases", return_value=[existing]
            ), patch.object(
                notarization, "release_assets", side_effect=[
                    {}, {payload.name: {"state": "uploaded", "digest": f"sha256:{digest}"}},
                ],
            ), patch.object(notarization, "update_assets") as upload, patch.object(notarization, "gh") as gh:
                notarization.stage_release(folder, folder)
                upload.assert_called_once_with(existing["id"], staged["tag"], [payload])
                gh.assert_not_called()

    def test_partial_finalization_never_counts_as_a_finished_variant(self):
        manifest = release_manifest()
        manifest["records"][0].update({"submission": SUBMISSION, "finished": {"partial.dmg": DIGEST}})
        with self.assertRaisesRegex(ValueError, "Incomplete or invalid"):
            notarization.validate(manifest)

    def test_publish_requires_exact_digests_of_all_final_assets(self):
        manifest = release_manifest()
        release = {"id": 10, "tag_name": manifest["tag"]}
        assets = {}

        def add_assets(expected):
            for name, digest in expected.items():
                assets[name] = {"state": "uploaded", "digest": f"sha256:{digest}"}

        add_assets(manifest["platform"])
        for entry in manifest["records"]:
            entry["submission"] = SUBMISSION
            entry["finished"] = {name: DIGEST for name in notarization.final_names(manifest["tag"], entry)}
            add_assets(entry["finished"])

        def upload(_id, _tag, paths):
            add_assets({path.name: notarization.sha256(path) for path in paths})

        for tamper in (True, False):
            with self.subTest(tamper=tamper):
                if tamper:
                    name = next(iter(manifest["platform"]))
                    assets[name]["digest"] = f"sha256:{'0' * 64}"
                else:
                    add_assets(manifest["platform"])
                with patch.object(notarization, "git", return_value=COMMIT), patch.object(
                    notarization, "release_assets", return_value=assets
                ), patch.object(notarization, "update_assets", side_effect=upload), patch.object(
                    notarization, "api"
                ) as api:
                    if tamper:
                        with self.assertRaisesRegex(ValueError, "changed draft release asset"):
                            notarization.finish_release(release, copy.deepcopy(manifest), "notes")
                        api.assert_not_called()
                    else:
                        notarization.finish_release(release, copy.deepcopy(manifest), "notes")
                        api.assert_called_once_with("releases/10", payload={"body": "notes", "draft": False})


if __name__ == "__main__":
    unittest.main()
