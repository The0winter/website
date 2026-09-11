import importlib.util
import json
import os
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("retention", Path(__file__).parents[1] / "release_retention.py")
retention = importlib.util.module_from_spec(spec)
spec.loader.exec_module(retention)


class RetentionTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.releases = self.root / "releases"
        self.releases.mkdir()
        self.old = self.release("old", 1)
        self.previous = self.release("previous", 2)
        self.recent = self.release("recent", 3)
        self.current = self.release("current-release", 4)
        try:
            (self.root / "current").symlink_to(self.current, target_is_directory=True)
        except OSError:
            self.skipTest("Symbolic link privileges required")
        (self.root / "backups").mkdir()
        (self.root / "backups/precious").write_text("business data")

    def release(self, name, order, activated=True):
        path = self.releases / name
        path.mkdir()
        for name in ("package.json", "server/package.json", "server/app.js", "web-next/package.json", "web-next/.next-candidate/BUILD_ID"):
            target = path / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text("{}")
        if activated:
            (path / "deployment-manifest.json").write_text(json.dumps({
                "sourceCommit": "a" * 40, "release": str(path),
                "activatedAt": f"2026-01-01T00:00:{order:02d}Z"}))
        return path

    def plan(self, **kwargs):
        return retention.plan_cleanup(self.root, **kwargs)

    def apply(self, plan, process_reader=lambda: set(), health_check=lambda: None):
        if not shutil.rmtree.avoids_symlink_attacks:
            self.skipTest("Apply checks require the Linux deployment platform")
        return retention.apply_plan(plan, process_reader, health_check)

    def test_retains_current_and_two_activated_versions_by_activation_not_mtime(self):
        os.utime(self.old, None)
        plan = self.plan()
        self.assertEqual(plan["keep"], ["current-release", "recent", "previous"])
        self.assertEqual([row["name"] for row in plan["candidates"]], ["old"])

    def test_rollback_keeps_the_newer_version_for_roll_forward(self):
        (self.root / "current").unlink()
        (self.root / "current").symlink_to(self.previous, target_is_directory=True)
        self.assertEqual(self.plan()["keep"], ["previous", "current-release", "recent"])

    def test_protects_pending_unknown_symlink_and_process_referenced_versions(self):
        self.release("pending", 5, activated=False)
        (self.releases / "unexpected").mkdir()
        (self.releases / "outside").symlink_to(self.root / "backups", target_is_directory=True)
        plan = self.plan(in_use={"old"})
        self.assertEqual(plan["candidates"], [])
        self.assertEqual(set(plan["skipped"]), {"pending", "unexpected", "outside", "old"})

    def test_requires_a_verified_current_and_two_complete_rollbacks(self):
        (self.previous / "web-next/.next-candidate/BUILD_ID").unlink()
        (self.old / "deployment-manifest.json").unlink()
        with self.assertRaises(retention.UnsafePlan):
            self.plan()
        (self.current / "deployment-manifest.json").unlink()
        with self.assertRaises(retention.UnsafePlan):
            self.plan()

    def test_refuses_current_outside_release_root(self):
        (self.root / "current").unlink()
        (self.root / "current").symlink_to(self.root / "backups", target_is_directory=True)
        with self.assertRaises(retention.UnsafePlan):
            self.plan()

    def test_legacy_cleanup_is_explicit_and_ignores_new_builds(self):
        legacy = self.release("legacy", 0, activated=False)
        os.utime(legacy, (1, 1))
        self.release("building", 5, activated=False)
        self.assertNotIn("legacy", [row["name"] for row in self.plan()["candidates"]])
        plan = self.plan(include_legacy=True)
        self.assertIn("legacy", [row["name"] for row in plan["candidates"]])
        self.assertNotIn("building", [row["name"] for row in plan["candidates"]])

    def test_deletes_only_old_versions_preserving_hardlinks_symlink_targets_and_backups(self):
        shared = self.current / "shared-package"
        shared.write_text("shared bytes")
        os.link(shared, self.old / "shared-package")
        (self.old / "outside").symlink_to(self.root / "backups", target_is_directory=True)
        self.assertEqual(self.apply(self.plan()), ["old"])
        self.assertFalse(self.old.exists())
        self.assertEqual(shared.read_text(), "shared bytes")
        self.assertEqual((self.root / "backups/precious").read_text(), "business data")
        self.assertEqual((self.root / "current").resolve(), self.current)

    def test_stops_if_current_changes_after_planning(self):
        plan = self.plan()
        (self.root / "current").unlink()
        (self.root / "current").symlink_to(self.recent, target_is_directory=True)
        with self.assertRaises(retention.UnsafePlan):
            self.apply(plan)
        self.assertTrue(self.old.exists())

    def test_stops_if_a_candidate_becomes_active(self):
        with self.assertRaises(retention.UnsafePlan):
            self.apply(self.plan(), process_reader=lambda: {"old"})
        self.assertTrue(self.old.exists())

    def test_stops_if_a_candidate_directory_is_replaced(self):
        plan = self.plan()
        self.old.rename(self.root / "moved-old")
        self.release("old", 1)
        with self.assertRaises(retention.UnsafePlan):
            self.apply(plan)
        self.assertTrue(self.old.exists())

    def test_health_failure_prevents_deletion(self):
        def unhealthy():
            raise retention.UnsafePlan("unhealthy")
        with self.assertRaises(retention.UnsafePlan):
            self.apply(self.plan(), health_check=unhealthy)
        self.assertTrue(self.old.exists())

    def test_refuses_mount_points_and_retained_candidates(self):
        plan = self.plan()
        original = Path.read_text
        def read_text(path, *args, **kwargs):
            if str(path) == "/proc/self/mountinfo":
                return f"1 2 0:1 / {self.old}/mounted rw - tmpfs tmpfs rw"
            return original(path, *args, **kwargs)
        with patch.object(Path, "read_text", read_text):
            with self.assertRaises(retention.UnsafePlan):
                self.apply(plan)
        self.assertTrue(self.old.exists())
        plan["candidates"][0]["name"] = "current-release"
        with self.assertRaises(retention.UnsafePlan):
            self.apply(plan)


if __name__ == "__main__":
    unittest.main()
