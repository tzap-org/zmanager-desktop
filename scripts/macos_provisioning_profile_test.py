#!/usr/bin/env python3

import datetime
import plistlib
import tempfile
import unittest
from pathlib import Path

from macos_provisioning_profile import (
    ProfileRequirements,
    profile_errors,
    select_profile,
)


NOW = datetime.datetime(2026, 7, 28, tzinfo=datetime.timezone.utc)
IDENTITY = bytes.fromhex("0123456789abcdef" * 2 + "01234567")
IDENTITY_SHA1 = __import__("hashlib").sha1(IDENTITY).hexdigest().upper()
REQUIREMENTS = ProfileRequirements(
    bundle_identifier="org.tzap-org.zmanager",
    team_identifier="9PMA523YY4",
    app_group_identifier="9PMA523YY4.org.tzap-org.zmanager",
    signing_identity_sha1=IDENTITY_SHA1,
)


def profile(
    *,
    bundle_identifier: str = "org.tzap-org.zmanager",
    expiration: datetime.datetime = NOW + datetime.timedelta(days=7),
    groups: list[str] | None = None,
    certificate: bytes = IDENTITY,
) -> dict:
    return {
        "Platform": ["OSX"],
        "TeamIdentifier": ["9PMA523YY4"],
        "ExpirationDate": expiration.replace(tzinfo=None),
        "ProvisionedDevices": ["registered-mac"],
        "DeveloperCertificates": [certificate],
        "Entitlements": {
            "com.apple.application-identifier": f"9PMA523YY4.{bundle_identifier}",
            "com.apple.developer.team-identifier": "9PMA523YY4",
            "com.apple.security.application-groups": groups
            or ["9PMA523YY4.org.tzap-org.zmanager", "9PMA523YY4.*"],
        },
    }


class MacOSProvisioningProfileTests(unittest.TestCase):
    def test_accepts_matching_profile_with_additional_authorized_groups(self) -> None:
        self.assertEqual(profile_errors(profile(), REQUIREMENTS, NOW), [])

    def test_rejects_expired_wrong_bundle_group_and_certificate_profiles(self) -> None:
        cases = [
            profile(expiration=NOW),
            profile(bundle_identifier="org.example.wrong"),
            profile(groups=["group.example.wrong"]),
            profile(certificate=b"wrong-certificate"),
        ]
        for candidate in cases:
            with self.subTest(candidate=candidate):
                self.assertTrue(profile_errors(candidate, REQUIREMENTS, NOW))

    def test_selects_latest_valid_decoded_profile(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            earlier = root / "earlier.plist"
            later = root / "later.plist"
            invalid = root / "invalid.plist"
            earlier.write_bytes(
                plistlib.dumps(
                    profile(expiration=NOW + datetime.timedelta(days=3))
                )
            )
            later.write_bytes(
                plistlib.dumps(
                    profile(expiration=NOW + datetime.timedelta(days=7))
                )
            )
            invalid.write_bytes(
                plistlib.dumps(profile(groups=["group.example.wrong"]))
            )
            self.assertEqual(
                select_profile([invalid, earlier, later], REQUIREMENTS, NOW),
                later,
            )


if __name__ == "__main__":
    unittest.main()
