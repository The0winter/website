import importlib.util
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import Mock, patch

spec = importlib.util.spec_from_file_location('auto_deploy', Path(__file__).parents[1] / 'auto-deploy.py')
deploy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deploy)


class DeploymentGuards(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='auto-deploy-test-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.old = self.root / 'release'
        self.old.mkdir()

    def test_runtime_scope_and_protected_configuration(self):
        for name in ['web-next/components/BookArticles.tsx', 'server/routes/books.js', 'shared/rating.mjs']:
            with self.subTest(name=name):
                self.assertTrue(deploy.runtime_path(name))
        for name in ['docs/部署.md', 'tools/crawler.mjs', 'infra/auto-deploy.py', 'web-next/tests/layout.spec.ts', 'server/tests/books.test.js']:
            with self.subTest(name=name):
                self.assertFalse(deploy.runtime_path(name))
        for name in ['server/config.js', 'server/package-lock.json', 'web-next/package.json',
                     'web-next/next.config.ts', 'web-next/tsconfig.json', 'server/migrate_passwords.js',
                     'server/services/identity-migration.js', 'server/migrations/new.js', 'server/database/schema.js',
                     'web-next/.env.production', 'web-next/node_modules/a.js',
                     'web-next/public/deployment-version.json', 'server/key.pem']:
            with self.subTest(name=name), self.assertRaises(deploy.DeploymentError):
                deploy.runtime_path(name)

    def test_path_escape_is_rejected_before_writing(self):
        for name in ['../outside.js', '/etc/passwd', 'web-next/../../secret', 'web-next\\..\\secret']:
            with self.subTest(name=name), self.assertRaises(deploy.DeploymentError):
                deploy.runtime_path(name)
        with self.assertRaises(deploy.DeploymentError):
            deploy.safe_target(self.old, '../outside.js')

    def test_online_edits_are_preserved_by_refusing_a_different_baseline(self):
        file = self.old / 'web-next/components/BookArticles.tsx'
        file.parent.mkdir(parents=True)
        file.write_bytes(b'local production fix\n')
        with self.assertRaisesRegex(deploy.DeploymentError, 'differs'):
            deploy.verify_baseline(self.old, 'web-next/components/BookArticles.tsx', b'committed version\n')
        self.assertEqual(file.read_bytes(), b'local production fix\n')

    def test_crlf_text_is_compatible_but_binary_bytes_must_match(self):
        file = self.old / 'web-next/style.css'
        file.parent.mkdir(parents=True)
        file.write_bytes(b'body {}\r\n')
        deploy.verify_baseline(self.old, 'web-next/style.css', b'body {}\n')
        binary = self.old / 'web-next/cover.png'
        binary.write_bytes(b'\x89PNG\r\n')
        with self.assertRaises(deploy.DeploymentError):
            deploy.verify_baseline(self.old, 'web-next/cover.png', b'\x89PNG\n')

    def test_new_file_cannot_overwrite_an_untracked_online_file(self):
        file = self.old / 'shared/feature.js'
        file.parent.mkdir()
        file.write_text('existing deployment-only feature')
        with self.assertRaisesRegex(deploy.DeploymentError, 'already exists'):
            deploy.verify_baseline(self.old, 'shared/feature.js', None)

    def test_source_hashes_exclude_builds_dependencies_and_secrets(self):
        for name in ['web-next/components/A.tsx', 'server/routes/books.js', 'shared/a.mjs',
                     'web-next/.next-candidate/static/chunk.js', 'server/node_modules/a.js', 'server/.env']:
            file = self.old / name
            file.parent.mkdir(parents=True, exist_ok=True)
            file.write_text('fixture')
        self.assertEqual(set(deploy.source_hashes(self.old)), {'web-next/components/A.tsx', 'server/routes/books.js', 'shared/a.mjs'})


class TransactionTests(unittest.TestCase):
    def test_health_waits_for_the_api_listener_and_database(self):
        with patch.object(deploy, 'run'), patch.object(deploy, 'time') as clock, \
                patch.object(deploy, 'read', side_effect=[ConnectionRefusedError(), b'{"ready":false}', b'{"ready":true}']) as read:
            clock.monotonic.return_value = 0
            deploy.health()
            self.assertEqual(read.call_count, 3)
            self.assertEqual(clock.sleep.call_count, 2)

    def test_health_stops_if_the_service_never_starts(self):
        with patch.object(deploy, 'run'), patch.object(deploy, 'time') as clock, \
                patch.object(deploy, 'read', side_effect=ConnectionRefusedError()):
            clock.monotonic.side_effect = [0, 41]
            with self.assertRaisesRegex(deploy.DeploymentError, 'did not become ready'):
                deploy.health()

    def test_rollback_restores_nginx_even_when_restart_or_health_fails(self):
        for failure in ['restart', 'health']:
            activation = Mock()
            calls = []
            def run(*args, **kwargs):
                calls.append(args)
                if failure == 'restart' and args[:2] == ('systemctl', 'restart'):
                    raise deploy.DeploymentError('restart failed')
            with self.subTest(failure=failure), patch.object(deploy, 'run', side_effect=run), \
                    patch.object(deploy, 'health', side_effect=deploy.DeploymentError('not ready')):
                with self.assertRaises(deploy.DeploymentError):
                    deploy.restore_release(activation, Path('/old'), 'original upstream', True)
            activation.write.assert_called_once_with(activation.NGINX, 'original upstream')
            self.assertIn(('nginx', '-t'), calls)
            self.assertIn(('systemctl', 'reload', 'nginx'), calls)

    def test_success_records_acceptance_after_public_validation(self):
        calls = []
        result = deploy.activate_transaction(lambda: calls.append('activate'),
            lambda: calls.append('validate') or {'healthy': True},
            lambda result: calls.append(('accept', result)), lambda: calls.append('rollback'))
        self.assertEqual(calls, ['activate', 'validate', ('accept', {'healthy': True})])
        self.assertEqual(result, {'healthy': True})

    def test_failure_at_each_phase_rolls_back_without_success(self):
        for failing in ['activate', 'validate', 'accept']:
            calls = []
            def step(name):
                calls.append(name)
                if name == failing:
                    raise RuntimeError('injected failure')
            with self.subTest(failing=failing), self.assertRaises(RuntimeError):
                deploy.activate_transaction(lambda: step('activate'), lambda: step('validate'),
                    lambda result: step('accept'), lambda: calls.append('rollback'))
            self.assertEqual(calls[-1], 'rollback')
            self.assertEqual(calls.count('rollback'), 1)
            if failing != 'accept':
                self.assertNotIn('accept', calls)


class RealGitPlanTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='auto-deploy-git-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.repo = self.root / 'repository'
        self.repo.mkdir()
        self.old = self.root / 'active'
        self.old.mkdir()
        self.command('init', '--initial-branch=main')
        self.command('config', 'user.name', 'Local deployment tests')
        self.command('config', 'user.email', 'deployment-test@example.test')
        self.write('web-next/components/A.tsx', 'original\n')
        self.write('web-next/components/Removed.tsx', 'old\n')
        self.command('add', '--', 'web-next')
        self.command('commit', '-m', 'fixture baseline')
        self.base = self.command('rev-parse', 'HEAD').strip()
        shutil.copytree(self.repo / 'web-next', self.old / 'web-next')
        self.patch = patch.object(deploy, 'REPOSITORY', self.repo / '.git')
        self.patch.start()
        self.addCleanup(self.patch.stop)

    def command(self, *arguments):
        options = {'creationflags': subprocess.CREATE_NO_WINDOW} if os.name == 'nt' else {}
        result = subprocess.run(['git', *arguments], cwd=self.repo, capture_output=True, text=True, check=True, **options)
        return result.stdout

    def write(self, name, content):
        file = self.repo / name
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_text(content)

    def commit(self):
        self.command('add', '--', '.')  # The isolated synthetic repository only.
        self.command('commit', '-m', 'fixture candidate')
        return self.command('rev-parse', 'HEAD').strip()

    def test_real_diff_keeps_only_runtime_additions_changes_and_deletions(self):
        self.write('web-next/components/A.tsx', 'updated\n')
        self.write('shared/B.mjs', 'new\n')
        (self.repo / 'web-next/components/Removed.tsx').unlink()
        self.write('docs/note.md', 'documentation')
        self.write('web-next/tests/example.spec.ts', 'test source')
        changes = dict(deploy.plan(self.old, self.base, self.commit()))
        self.assertEqual(set(changes), {'web-next/components/A.tsx', 'web-next/components/Removed.tsx', 'shared/B.mjs'})
        self.assertEqual(changes['web-next/components/A.tsx'], b'updated\n')
        self.assertIsNone(changes['web-next/components/Removed.tsx'])
        self.assertEqual((self.old / 'web-next/components/A.tsx').read_text(), 'original\n')

    def test_rewritten_history_is_not_accepted(self):
        self.write('web-next/components/A.tsx', 'newer\n')
        newer = self.commit()
        with self.assertRaisesRegex(deploy.DeploymentError, 'descendant'):
            deploy.plan(self.old, newer, self.base)

    def test_dependency_update_blocks_the_entire_plan(self):
        self.write('web-next/components/A.tsx', 'updated\n')
        self.write('web-next/package.json', '{}')
        with self.assertRaisesRegex(deploy.DeploymentError, 'Protected'):
            deploy.plan(self.old, self.base, self.commit())
        self.assertEqual((self.old / 'web-next/components/A.tsx').read_text(), 'original\n')

    def test_first_fetch_creates_a_bare_cache_and_reads_main(self):
        cache = self.root / 'cache/repository.git'
        with patch.object(deploy, 'REPOSITORY', cache), patch.object(deploy, 'ORIGIN', str(self.repo)):
            self.assertEqual(deploy.fetch_main(), self.base)
            self.assertTrue(cache.is_dir())
            self.write('web-next/components/A.tsx', 'new main\n')
            head = self.commit()
            self.assertEqual(deploy.fetch_main(), head)


if __name__ == '__main__':
    unittest.main()
