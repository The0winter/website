#!/usr/bin/env python3
"""Retain the current Test1 release and two successfully activated rollbacks.

Dry-run by default. No dependencies outside the Python standard library.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import time
from datetime import datetime, timezone
from urllib.request import urlopen


class UnsafePlan(RuntimeError):
    pass


def release_path(releases, path):
    path = Path(path)
    if not path.is_absolute() or path.parent != releases or path.is_symlink():
        raise UnsafePlan(f"Not a direct release directory: {path}")
    if path.resolve(strict=True) != path or not path.is_dir():
        raise UnsafePlan(f"Invalid release directory: {path}")
    return path


def activated_release(path):
    manifest = path / "deployment-manifest.json"
    try:
        data = json.loads(manifest.read_text())
        activated = datetime.fromisoformat(data["activatedAt"].replace("Z", "+00:00"))
        if activated.tzinfo is None or activated.timestamp() > time.time() + 60:
            raise ValueError("Invalid activation time")
        if not re.fullmatch(r"[0-9a-f]{40}", data["sourceCommit"]):
            raise ValueError("Invalid commit")
        if data.get("release", str(path)) != str(path):
            raise ValueError("Manifest belongs to another directory")
        for name in ("server/package.json", "web-next/package.json", "web-next/.next-candidate/BUILD_ID"):
            if not (path / name).is_file():
                raise ValueError("Incomplete release")
        return data, activated.timestamp()
    except (OSError, ValueError, KeyError, TypeError, AttributeError):
        return None


def referenced_releases(releases):
    """Protect processes still running from an older release, including native maps."""
    prefix = str(releases) + "/"
    found = set()

    def remember(target):
        if target.startswith(prefix):
            name = target[len(prefix):].split("/", 1)[0]
            if name:
                found.add(name)

    for process in Path("/proc").iterdir():
        if not process.name.isdigit():
            continue
        for name in ("cwd", "exe"):
            try:
                remember(os.readlink(process / name))
            except (FileNotFoundError, ProcessLookupError):
                pass  # The process may have exited.
        try:
            for fd in (process / "fd").iterdir():
                try:
                    remember(os.readlink(fd))
                except (FileNotFoundError, ProcessLookupError):
                    pass
            for line in (process / "maps").read_text().splitlines():
                fields = line.split(maxsplit=5)
                if len(fields) == 6:
                    remember(fields[5])
        except (FileNotFoundError, ProcessLookupError):
            pass
    return found


def plan_cleanup(root, in_use=(), include_legacy=False):
    root = Path(root).resolve(strict=True)
    releases = root / "releases"
    if releases.is_symlink() or not releases.is_dir():
        raise UnsafePlan("Releases must be a real directory")
    if not (root / "current").is_symlink():
        raise UnsafePlan("Current must be a symlink")
    current = release_path(releases, (root / "current").resolve(strict=True))
    current_info = activated_release(current)
    if not current_info:
        raise UnsafePlan("Current release has not completed activation")
    successful = []
    ignored = {}
    legacy = []
    for path in sorted(releases.iterdir()):
        if path.is_symlink() or not path.is_dir():
            ignored[path.name] = "not a real directory"
            continue
        info = activated_release(path)
        if info:
            successful.append((info[1], path))
        elif (include_legacy and not (path / "deployment-manifest.json").exists()
              and path.stat().st_mtime < current_info[1]
              and all((path / name).is_file() for name in
                      ("package.json", "server/app.js", "web-next/package.json"))):
            # One-time, explicitly authorized cleanup of old deployments that
            # predate manifests. Never enabled by the automatic service.
            legacy.append(path)
        else:
            ignored[path.name] = "unverified or unfinished release"
    previous = [path for _, path in sorted(successful, reverse=True) if path != current][:2]
    if len(previous) != 2:
        raise UnsafePlan("Two complete, activated rollback releases are required")
    keep = {current.name, *(path.name for path in previous)}
    protected = set(in_use)
    candidates = []
    for path in sorted([path for _, path in successful] + legacy):
        if path.name in keep:
            continue
        if path.name in protected:
            ignored[path.name] = "referenced by a running process"
            continue
        release_path(releases, path)
        info = path.stat()
        candidates.append({"name": path.name, "device": info.st_dev, "inode": info.st_ino})
    plan = {"root": str(root), "current": current.name,
            "sourceCommit": current_info[0]["sourceCommit"],
            "keep": [current.name, *(path.name for path in previous)],
            "inUse": sorted(protected), "candidates": candidates, "skipped": ignored}
    plan["fingerprint"] = hashlib.sha256(json.dumps(plan, sort_keys=True).encode()).hexdigest()
    return plan


def verify_removal_tree(path):
    """Do not traverse mount points; rmtree itself must not follow symlinks."""
    device = path.stat().st_dev
    mounts = []
    for line in Path("/proc/self/mountinfo").read_text().splitlines():
        value = line.split()[4]
        value = re.sub(r"\\([0-7]{3})", lambda match: chr(int(match[1], 8)), value)
        mount = Path(value)
        if mount == path or path in mount.parents:
            mounts.append(str(mount))
    if mounts:
        raise UnsafePlan(f"Release contains a mount point: {path.name}")
    for parent, dirs, _ in os.walk(path, followlinks=False):
        for name in dirs:
            child = Path(parent) / name
            if not child.is_symlink() and child.stat().st_dev != device:
                raise UnsafePlan(f"Release crosses a filesystem: {path.name}")


def apply_plan(plan, process_reader, health_check):
    root = Path(plan["root"])
    releases = root / "releases"
    if not shutil.rmtree.avoids_symlink_attacks:
        raise UnsafePlan("This Python platform lacks safe directory deletion")
    deleted = []
    health_check()
    for row in plan["candidates"]:
        if row["name"] in plan["keep"]:
            raise UnsafePlan("A retained release cannot be deleted")
        if (root / "current").resolve(strict=True) != releases / plan["current"]:
            raise UnsafePlan("Current changed; aborting cleanup")
        if row["name"] in process_reader():
            raise UnsafePlan(f"Release became active: {row['name']}")
        target = release_path(releases, releases / row["name"])
        info = target.stat()
        if (info.st_dev, info.st_ino) != (row["device"], row["inode"]):
            raise UnsafePlan(f"Release was replaced: {target.name}")
        verify_removal_tree(target)
        # Unlink old directory entries; do not chmod or rewrite shared files.
        shutil.rmtree(target)
        deleted.append(target.name)
        print(json.dumps({"deleted": target.name}), flush=True)
    health_check()
    return deleted


def check_health():
    subprocess.run(["systemctl", "is-active", "--quiet", "test1-web", "test1-api"], check=True)
    with urlopen("http://127.0.0.1:5000/health/ready", timeout=10) as response:
        if not json.load(response).get("ready"):
            raise UnsafePlan("API is not ready")
    with urlopen("http://127.0.0.1:3000/", timeout=15) as response:
        if b"book-search-field" not in response.read():
            raise UnsafePlan("Frontend health check failed")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--include-legacy", action="store_true")
    parser.add_argument("--expected-plan")
    parser.add_argument("--wait-ready", type=int, default=0)
    parser.add_argument("--settle-seconds", type=int, default=0)
    args = parser.parse_args()
    if os.geteuid() != 0:
        parser.error("Run as root so process references can be checked completely")
    import fcntl
    root = Path("/srv/test1")
    state = Path("/var/lib/test1-release-retention")
    state.mkdir(mode=0o700, exist_ok=True)
    with (state / "lock").open("w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        deadline = time.monotonic() + args.wait_ready
        while True:
            try:
                plan = plan_cleanup(root, referenced_releases(root / "releases"), args.include_legacy)
                activated = activated_release(root / "releases" / plan["current"])[1]
                if time.time() - activated < args.settle_seconds:
                    raise UnsafePlan("Waiting for the new activation to settle")
                if args.apply:
                    check_health()
                break
            except (UnsafePlan, OSError, subprocess.CalledProcessError):
                if time.monotonic() >= deadline:
                    raise
                time.sleep(5)
        if args.expected_plan and args.expected_plan != plan["fingerprint"]:
            raise UnsafePlan("Plan changed since inspection")
        before = shutil.disk_usage(root)
        print(json.dumps({"mode": "apply" if args.apply else "dry-run", "plan": plan,
                          "diskUsedBytes": before.used, "diskFreeBytes": before.free}), flush=True)
        if not args.apply:
            return
        deleted = apply_plan(plan, lambda: referenced_releases(root / "releases"), check_health)
        after = shutil.disk_usage(root)
        report = {"completedAt": datetime.now(timezone.utc).isoformat(), "plan": plan,
                  "deleted": deleted, "reclaimedBytes": after.free - before.free,
                  "diskUsedBytes": after.used, "diskFreeBytes": after.free}
        temporary = state / "last-run.json.tmp"
        temporary.write_text(json.dumps(report, indent=2) + "\n")
        os.chmod(temporary, 0o600)
        temporary.replace(state / "last-run.json")
        print(json.dumps({key: value for key, value in report.items() if key != "plan"}), flush=True)


if __name__ == "__main__":
    main()
