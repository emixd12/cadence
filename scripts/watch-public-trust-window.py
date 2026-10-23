"""One bounded cleanup tick; never creates access or approves a deployment."""
import fcntl
import json
import math
import subprocess
import sys
import time
from pathlib import Path

BASE = 'repos/emixd12/cadence'
ENV = BASE + '/environments/public-trust-preview'
POLICY = {'protected_branches': True, 'custom_branch_policies': False}
TAG = 'trust-preview-diagnostic-232'
SHA = '3a2ea7d73d8b643b67c194bebdcb2714a8661860'
OWNER = 4998651


def require(condition):
    if not condition:
        raise ValueError("Unexpected cleanup state")


def atomic_json(path, value):
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(value, indent=2))
    temporary.replace(path)


class Window:
    def __init__(self, root, request, now):
        self.root, self.request, self.now = root, request, now
        self.c = json.loads((root / 'one-run-control.json').read_text())
        self.b = json.loads((root / 'one-run-policy-baseline.json').read_text())['environment']
        require(self.c['sha'] == SHA and self.c['tag'] == TAG)
        require(self.c['environmentId'] == self.b['id'] == 20684030064)
        require(self.c['ownerId'] == OWNER and self.b['deployment_branch_policy'] == POLICY)
        require([r['type'] for r in self.b['protection_rules']] == ['branch_policy'])
        require(self.b['can_admins_bypass'] is True)
        require(len(self.c['createdRules']) <= 2)
        require(all(type(i) is int and i > 0 for i in self.c['createdRules']))
        require(self.c['diagnosticRunId'] is None or
                (type(self.c['diagnosticRunId']) is int and self.c['diagnosticRunId'] > 0))
        require(type(self.c['deadline']) in (int, float) and math.isfinite(self.c['deadline']))

    def save(self):
        atomic_json(self.root / 'one-run-control.json', self.c)

    def run(self, run_id):
        return self.request(BASE + '/actions/runs/' + str(run_id))

    def gate(self, e):
        return any(r['type'] == 'required_reviewers' and
                   [(x['type'], x['reviewer']['id']) for x in r['reviewers']] == [('User', OWNER)]
                   for r in e['protection_rules'])

    def environment(self):
        e = self.request(ENV)
        require(e['id'] == self.b['id'] and e['can_admins_bypass'] == self.b['can_admins_bypass'])
        require(all(r['type'] in ('branch_policy', 'required_reviewers') for r in e['protection_rules']))
        reviewers = [r for r in e['protection_rules'] if r['type'] == 'required_reviewers']
        require(not reviewers or self.gate(e))
        require(not any(r.get('prevent_self_review', False) for r in reviewers))
        require(e['deployment_branch_policy'] in (POLICY, {'protected_branches': False, 'custom_branch_policies': True}))
        require(e['deployment_branch_policy'] == POLICY or self.gate(e))
        return e

    def settle(self, run_id, reject=False):
        path = BASE + '/actions/runs/' + str(run_id)
        r = self.run(run_id)
        if run_id == self.c['diagnosticRunId']:
            require(r['head_sha'] == SHA and r['head_branch'] == TAG)
            require(r['event'] == 'workflow_dispatch' and r['run_attempt'] == 1)
            require(r['path'] == '.github/workflows/public-trust-evidence.yml')
        if r['status'] == 'completed':
            return True
        try:
            if reject:
                self.request(path + '/pending_deployments', 'POST', {
                    'environment_ids': [self.b['id']], 'state': 'rejected',
                    'comment': 'The approved one-run diagnostic window has ended.'})
            else:
                self.request(path + '/cancel', 'POST')
        except RuntimeError:
            # A cancel/reject may race completion or succeed despite a lost response.
            pass
        return self.run(run_id)['status'] == 'completed'

    def restore(self):
        e = self.environment()
        require(self.c['diagnosticRunId'] is not None)
        pending = self.request(BASE + '/actions/runs/' + str(self.c['diagnosticRunId']) + '/pending_deployments')
        reject = any(p['environment']['id'] == self.b['id'] for p in pending)
        if not self.settle(self.c['diagnosticRunId'], reject=reject):
            return {'event': 'cleanup_wait'}
        for run_id in self.c.get('rejectedRunIds', []):
            pending = self.request(BASE + '/actions/runs/' + str(run_id) + '/pending_deployments')
            reject = any(p['environment']['id'] == self.b['id'] for p in pending)
            if not self.settle(run_id, reject=reject):
                return {'event': 'cleanup_wait'}
        if self.gate(e):
            waiting = self.request(BASE + '/actions/runs?status=waiting&per_page=100')
            # shortcut: larger queues need manual review; never release a gate on a truncated inventory.
            require(waiting['total_count'] == len(waiting['workflow_runs']) <= 100)
            for r in waiting['workflow_runs']:
                pending = self.request(BASE + '/actions/runs/' + str(r['id']) + '/pending_deployments')
                if any(p['environment']['id'] == self.b['id'] for p in pending):
                    ids = self.c.setdefault('rejectedRunIds', [])
                    if r['id'] not in ids:
                        ids.append(r['id'])
                        self.save()
                    if not self.settle(r['id'], reject=True):
                        return {'event': 'cleanup_wait'}
            for run_id in self.c.get('rejectedRunIds', []):
                if self.run(run_id)['status'] != 'completed':
                    return {'event': 'cleanup_wait'}
        rules = self.request(ENV + '/deployment-branch-policies', missing=True)
        if rules:
            require(rules['total_count'] == len(rules['branch_policies']) <= 100)
            for rule in rules['branch_policies']:
                require(rule['id'] in self.c['createdRules'])
                require((rule['name'], rule['type']) in [('main', 'branch'), (TAG, 'tag')])
            for rule in rules['branch_policies']:
                require(self.gate(e))
                self.request(ENV + '/deployment-branch-policies/' + str(rule['id']), 'DELETE', missing=True)
        for rule_id in self.c['createdRules']:
            require(self.request(ENV + '/deployment-branch-policies/' + str(rule_id), missing=True) is None)
        current = self.environment()
        require(all(current[k] == e[k] for k in ('deployment_branch_policy', 'protection_rules', 'can_admins_bypass')))
        if e['deployment_branch_policy'] != POLICY:
            self.request(ENV, 'PUT', {'reviewers': [{'type': 'User', 'id': OWNER}],
                         'prevent_self_review': False, 'deployment_branch_policy': POLICY,
                         'can_admins_bypass': self.b['can_admins_bypass']})
            return {'event': 'cleanup_wait'}
        if self.gate(e):
            self.request(ENV, 'PUT', {'reviewers': [], 'prevent_self_review': False,
                         'deployment_branch_policy': POLICY, 'can_admins_bypass': self.b['can_admins_bypass']})
            return {'event': 'cleanup_wait'}
        # Baseline already restored: resume tag cleanup without reinstalling a gate.
        tag_path = BASE + '/git/ref/tags/' + TAG
        tag = self.request(tag_path, missing=True)
        if tag:
            require(tag['object']['type'] == 'commit' and tag['object']['sha'] == SHA)
            self.request(BASE + '/git/refs/tags/' + TAG, 'DELETE', missing=True)
        require(self.request(tag_path, missing=True) is None)
        self.c.update(restored=True, phase='restored', restoredAt=self.now)
        self.save()
        atomic_json(self.root / 'one-run-restoration.json', {
            'environment': e, 'tagAbsent': True, 'at': self.now,
            'diagnosticRunId': self.c['diagnosticRunId']})
        return {'event': 'restored', 'tagAbsent': True}

    def tick(self):
        if self.c['restored'] or self.c.get('cleanupStarted') or self.now >= self.c['deadline']:
            self.c['cleanupStarted'] = True
            self.save()
            return self.restore()
        if self.c['diagnosticRunId']:
            if self.run(self.c['diagnosticRunId'])['status'] == 'completed':
                self.c['cleanupStarted'] = True
                self.save()
                return self.restore()
        return {'event': 'waiting'}


def tick(root, request, now):
    try:
        return Window(root, request, now).tick()
    except Exception:
        # No arbitrary exception, CLI output, response body or token reaches a hook wake.
        return {'event': 'retry', 'ownerGateMustRemain': True}


def main():
    root = Path(sys.argv[1]).resolve()
    with (root / 'cleanup.lock').open('w') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return {'event': 'busy'}
        end = time.monotonic() + 40

        def request(path, method='GET', data=None, missing=False):
            remaining = end - time.monotonic()
            if remaining < 1:
                raise RuntimeError('budget')
            args = ['gh', 'api', path, '--method', method]
            if data is not None:
                args += ['--input', '-']
            p = subprocess.run(args, input=json.dumps(data) if data is not None else None,
                               capture_output=True, text=True, timeout=min(6, remaining))
            if missing and p.returncode and 'HTTP 404' in p.stderr:
                return None
            if p.returncode:
                raise RuntimeError('metadata')
            return json.loads(p.stdout) if p.stdout.strip() else None

        return tick(root, request, time.time())


if __name__ == '__main__':
    try:
        result = main()
    except Exception:
        result = {'event': 'retry', 'ownerGateMustRemain': True}
    print(json.dumps(result))
