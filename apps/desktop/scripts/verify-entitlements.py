"""Compare a signed app's entitlements and embedded Developer ID profile with Entitlements.plist."""
import datetime
from pathlib import Path
import plistlib
import subprocess
import sys


def fail(message):
    sys.stderr.write(message + "\n")
    sys.exit(1)


def read_plist(command, failure):
    result = subprocess.run(command, capture_output=True)
    if result.returncode != 0 or not result.stdout.strip():
        fail(failure)
    try:
        return plistlib.loads(result.stdout)
    except Exception:
        fail(failure)


def allows(pattern, value):
    # Profiles grant exact values or a trailing wildcard such as TEAMID.*.
    return isinstance(pattern, str) and (pattern == value or (pattern.endswith("*") and value.startswith(pattern[:-1])))


def authorizes(granted, requested):
    if isinstance(requested, list):
        patterns = granted if isinstance(granted, list) else [granted]
        return all(isinstance(item, str) and any(allows(pattern, item) for pattern in patterns) for item in requested)
    return isinstance(requested, str) and allows(granted, requested)


def main():
    if len(sys.argv) != 3:
        fail("Usage: verify-entitlements.py <Cadence.app> <Entitlements.plist>")
    app, expected_path = Path(sys.argv[1]), Path(sys.argv[2])
    expected = plistlib.loads(expected_path.read_bytes())
    if not isinstance(expected, dict) or not expected:
        fail("Entitlements.plist must contain the production entitlements.")

    signed = read_plist(["codesign", "--display", "--entitlements", "-", "--xml", str(app)],
                        "The signed app entitlements could not be read.")
    if signed != expected:
        fail("The signed app entitlements do not exactly match Entitlements.plist.")

    profile_path = app / "Contents" / "embedded.provisionprofile"
    if profile_path.is_symlink() or not profile_path.is_file():
        fail("The production app must embed its Developer ID provisioning profile.")
    profile = read_plist(["security", "cms", "-D", "-i", str(profile_path)],
                         "The embedded provisioning profile could not be decoded.")
    if not isinstance(profile, dict):
        fail("The embedded provisioning profile could not be decoded.")

    team = expected.get("com.apple.developer.team-identifier")
    if not isinstance(team, str) or team not in profile.get("TeamIdentifier", []):
        fail("The embedded provisioning profile belongs to a different team.")
    expiry = profile.get("ExpirationDate")
    now = datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)
    if not isinstance(expiry, datetime.datetime) or expiry.replace(tzinfo=None) <= now:
        fail("The embedded provisioning profile has expired.")
    granted = profile.get("Entitlements")
    if not isinstance(granted, dict):
        fail("The embedded provisioning profile grants no entitlements.")
    for key, requested in expected.items():
        if not authorizes(granted.get(key), requested):
            fail(f"The embedded provisioning profile does not authorize {key}.")


if __name__ == "__main__":
    main()
