import copy
import fcntl
import subprocess
import sys
from unittest.mock import patch
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('window', Path(__file__).parents[1] / 'scripts/watch-public-trust-window.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class FakeGitHub:
    def __init__(self):
        self.e = {'id': 20684030064, 'can_admins_bypass': True,
                  'deployment_branch_policy': {'protected_branches': False, 'custom_branch_policies': True},
                  'protection_rules': [{'type': 'branch_policy'}, {'type': 'required_reviewers', 'reviewers': [
                      {'type': 'User', 'reviewer': {'id': m.OWNER}}]}]}
        self.rules = [{'id': 11, 'name': 'main', 'type': 'branch'}, {'id': 12, 'name': m.TAG, 'type': 'tag'}]
        self.tag = {'object': {'sha': m.SHA, 'type': 'commit'}}
        self.runs = {123: {'id': 123, 'head_sha': m.SHA, 'head_branch': m.TAG, 'event': 'workflow_dispatch',
                          'run_attempt': 1, 'path': '.github/workflows/public-trust-evidence.yml', 'status': 'waiting'}}
        self.pending = {123: True}
        self.calls = []
        self.fail = None
        self.race = False
        self.delay = False

    def __call__(self, path, method='GET', data=None, missing=False):
        self.calls.append((path, method, copy.deepcopy(data)))
        if self.fail and self.fail(path, method):
            raise RuntimeError('secret=DO_NOT_PRINT; provider response body')
        if path == m.ENV:
            if method == 'PUT':
                assert all(r['status'] == 'completed' for r in self.runs.values())
                self.e['deployment_branch_policy'] = data['deployment_branch_policy']
                self.e['protection_rules'] = [{'type': 'branch_policy'}]
                if data['reviewers']:
                    self.e['protection_rules'].append({'type': 'required_reviewers', 'reviewers': [
                        {'type': 'User', 'reviewer': {'id': m.OWNER}}]})
            return copy.deepcopy(self.e)
        if path == m.ENV + '/deployment-branch-policies':
            return {'total_count': len(self.rules), 'branch_policies': copy.deepcopy(self.rules)}
        if path.startswith(m.ENV + '/deployment-branch-policies/'):
            if method == 'GET':
                return next((copy.deepcopy(r) for r in self.rules if r['id'] == int(path.split('/')[-1])), None)
            self.rules = [r for r in self.rules if r['id'] != int(path.split('/')[-1])]
            return None
        if '/git/ref' in path:
            if method == 'DELETE':
                self.tag = None
            return copy.deepcopy(self.tag)
        if path.endswith('?status=waiting&per_page=100'):
            runs = [r for r in self.runs.values() if r['status'] == 'waiting']
            return {'total_count': len(runs), 'workflow_runs': copy.deepcopy(runs)}
        rest = path.removeprefix(m.BASE + '/actions/runs/').split('/')
        run_id = int(rest[0])
        if len(rest) > 1:
            if method == 'GET':
                return [{'environment': {'id': 20684030064}}] if self.pending.get(run_id) else []
            if not self.delay:
                self.runs[run_id]['status'] = 'completed'
                self.pending[run_id] = False
            if self.race:
                raise RuntimeError('HTTP conflict body secret')
            return None
        return copy.deepcopy(self.runs[run_id])


class Cleanup(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.api = FakeGitHub()
        self.c = {'sha': m.SHA, 'tag': m.TAG, 'environmentId': 20684030064, 'ownerId': m.OWNER,
                  'createdRules': [11, 12], 'deadline': 100, 'diagnosticRunId': 123, 'restored': False}
        self.write()
        self.baseline = {'id': 20684030064, 'can_admins_bypass': True,
                         'deployment_branch_policy': m.POLICY, 'protection_rules': [{'type': 'branch_policy'}]}
        (self.root / 'one-run-policy-baseline.json').write_text(json.dumps({'environment': self.baseline}))

    def write(self):
        (self.root / 'one-run-control.json').write_text(json.dumps(self.c))

    def tick(self, now=101):
        return m.tick(self.root, self.api, now)

    def finish(self):
        for _ in range(5):
            result = self.tick()
            if result['event'] == 'restored':
                break
        self.assertEqual(result['event'], 'restored')
        self.assertEqual(self.api.e, self.baseline)
        self.assertEqual(self.api.rules, [])
        self.assertIsNone(self.api.tag)

    def test_exact_final_pair_revision_restores(self):
        self.assertEqual(m.SHA, '7735499e026b2dc3152107cca3092404bfd476ec')
        self.finish()

    def test_old_revision_rejected_at_each_identity_boundary(self):
        previous = '3a2ea7d73d8b643b67c194bebdcb2714a8661860'
        for boundary in ['control', 'run', 'tag']:
            with self.subTest(boundary=boundary):
                self.setUp()
                if boundary == 'control':
                    self.c['sha'] = previous
                    self.write()
                elif boundary == 'run':
                    self.api.runs[123]['head_sha'] = previous
                else:
                    self.api.tag['object']['sha'] = previous
                for _ in range(4):
                    result = self.tick()
                self.assertEqual(result, {'event': 'retry', 'ownerGateMustRemain': True})
                self.assertIsNotNone(self.api.tag)
                if boundary == 'control':
                    self.assertEqual(self.api.calls, [])
                if boundary == 'run':
                    self.assertTrue(all(method == 'GET' for _, method, _ in self.api.calls))
                self.assertFalse(any('/git/ref' in path and method == 'DELETE'
                                     for path, method, _ in self.api.calls))

    def test_transient_get_then_deadline_without_agent_wake(self):
        self.api.fail = lambda p, method: '/actions/runs/' in p
        for now in [90, 100, 105]:
            self.assertEqual(self.tick(now)['event'], 'retry')
        self.assertTrue(m.Window(self.root, self.api, 106).c['cleanupStarted'])
        self.api.fail = None
        self.finish()

    def test_resume_after_agent_unavailable_past_ttl(self):
        self.assertEqual(self.tick(90)['event'], 'waiting')
        self.assertEqual(self.tick(10000)['event'], 'cleanup_wait')
        self.finish()

    def test_cancel_and_reject_completion_races(self):
        for pending in [True, False]:
            with self.subTest(pending=pending):
                self.setUp()
                self.api.pending[123] = pending
                self.api.race = True
                self.finish()

    def test_unexpected_pending_must_be_terminal_before_gate_removal(self):
        self.api.runs[456] = {'id': 456, 'status': 'waiting'}
        self.api.pending[456] = True
        self.api.runs[123]['status'] = 'completed'
        self.api.pending[123] = False
        self.api.delay = True
        self.assertEqual(self.tick()['event'], 'cleanup_wait')
        self.assertFalse(any(method == 'PUT' for _, method, _ in self.api.calls))
        self.assertEqual(m.Window(self.root, self.api, 101).c['rejectedRunIds'], [456])
        self.api.delay = False
        self.finish()

    def test_partial_restore_after_gate_removed_is_idempotent(self):
        self.api.e = copy.deepcopy(self.baseline)
        self.api.rules = []
        self.api.runs[123]['status'] = 'completed'
        self.api.pending[123] = False
        self.finish()
        self.api.calls.clear()
        self.assertEqual(self.tick()['event'], 'restored')
        self.assertTrue(all(method == 'GET' for _, method, _ in self.api.calls))

    def test_lost_response_at_every_mutation_resumes(self):
        for boundary in range(6):
            with self.subTest(boundary=boundary):
                self.setUp()
                original = self.api
                mutations = [0]
                def request(p, method='GET', data=None, missing=False):
                    result = original(p, method, data, missing)
                    if method != 'GET':
                        mutations[0] += 1
                        if mutations[0] == boundary + 1:
                            raise RuntimeError('lost response')
                    return result
                for _ in range(8):
                    result = m.tick(self.root, request, 101)
                    if result['event'] == 'restored':
                        break
                self.assertEqual(result['event'], 'restored')

    def test_no_secret_exception_output(self):
        self.api.fail = lambda *_: True
        self.assertEqual(self.tick(), {'event': 'retry', 'ownerGateMustRemain': True})

    def test_preserve_unrelated_environment_rules_and_tag(self):
        for change in ['reviewer', 'timer', 'bypass', 'rule', 'tag', 'sha']:
            with self.subTest(change=change):
                self.setUp()
                if change == 'reviewer': self.api.e['protection_rules'][1]['reviewers'][0]['reviewer']['id'] = 99
                if change == 'timer': self.api.e['protection_rules'].append({'type': 'wait_timer', 'wait_timer': 10})
                if change == 'bypass': self.api.e['can_admins_bypass'] = False
                if change == 'rule': self.api.rules.append({'id': 99, 'name': 'unrelated', 'type': 'tag'})
                if change == 'tag': self.api.tag['object']['sha'] = 'f' * 40
                if change == 'sha': self.api.runs[123]['head_sha'] = 'f' * 40
                for _ in range(4): result = self.tick()
                self.assertEqual(result['event'], 'retry')
                if change == 'tag': self.assertIsNotNone(self.api.tag)
                if change == 'rule': self.assertEqual(len(self.api.rules), 3)

    def test_no_release_after_truncated_queue(self):
        original = self.api
        def request(p, method='GET', data=None, missing=False):
            if '?status=waiting' in p: return {'total_count': 101, 'workflow_runs': []}
            return original(p, method, data, missing)
        self.assertEqual(m.tick(self.root, request, 101)['event'], 'retry')
        self.assertFalse(any(method == 'PUT' for _, method, _ in self.api.calls))

    def test_cli_timeout_is_bounded_and_redacted(self):
        with patch.object(sys, 'argv', ['watch', str(self.root)]), patch.object(m.subprocess, 'run') as call:
            call.side_effect = subprocess.TimeoutExpired('secret command', 6, output='secret output')
            self.assertEqual(m.main(), {'event': 'retry', 'ownerGateMustRemain': True})
            self.assertLessEqual(call.call_args.kwargs['timeout'], 6)
            self.assertEqual(call.call_args.args[0][:2], ['gh', 'api'])

    def test_aggregate_call_budget_stops_before_host_timeout(self):
        with patch.object(sys, 'argv', ['watch', str(self.root)]), patch.object(m.time, 'monotonic', side_effect=[0, 40]), patch.object(m.subprocess, 'run') as call:
            self.assertEqual(m.main(), {'event': 'retry', 'ownerGateMustRemain': True})
            call.assert_not_called()

    def test_concurrent_tick_cannot_issue_mutations(self):
        with (self.root / 'cleanup.lock').open('w') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            with patch.object(sys, 'argv', ['watch', str(self.root)]), patch.object(m.subprocess, 'run') as call:
                self.assertEqual(m.main(), {'event': 'busy'})
                call.assert_not_called()


if __name__ == '__main__':
    unittest.main()
