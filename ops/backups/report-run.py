#!/usr/bin/env python3
"""Trusted private-repository ledger bridge. Never dispatches work."""
import json
import os
import re
import sys
import urllib.request

PROJECTS = {'acceptance':'nxossqhdfltcqdwvbewi','production':'kkpkgjrweysgvhvkhzun'}

def call(url, headers, payload=None):
    request = urllib.request.Request(url, data=None if payload is None else json.dumps(payload).encode(), headers=headers)
    with urllib.request.urlopen(request, timeout=20) as response:
        return json.load(response)

def main():
    label = os.environ['BACKUP_LABEL']
    url = os.environ['SUPABASE_URL'].rstrip('/')
    if url != f'https://{PROJECTS[label]}.supabase.co': raise ValueError('project mismatch')
    kind = os.environ['BACKUP_KIND']
    run_id = int(os.environ['TARGET_RUN_ID'])
    request_id = os.environ.get('REQUEST_ID') or None
    status, conclusion, summary = 'running', None, {}
    if '--complete' in sys.argv:
        repo = os.environ['GITHUB_REPOSITORY']
        if repo != 'hmohamed080/aladdin-backups': raise ValueError('repository mismatch')
        headers = {'Authorization':'Bearer '+os.environ['GITHUB_TOKEN'], 'Accept':'application/vnd.github+json'}
        base = f'https://api.github.com/repos/{repo}/actions/runs/{run_id}'
        run = call(base, headers)
        if run['event'] not in ('schedule','workflow_dispatch') or run['head_branch'] != 'main': raise ValueError('untrusted run')
        if run['status'] != 'completed': raise ValueError('not complete')
        match = re.search(r'\b[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\b',run.get('display_title',''))
        request_id = match.group(0) if match else None
        jobs = call(base + '/jobs?per_page=100',headers)['jobs']
        name = ('backup' if kind == 'backup' else 'restore') + f' ({label})'
        job = next((j for j in jobs if j['name'] == name),None)
        if not job or job['conclusion'] == 'skipped': return
        claim = next((s for s in job.get('steps',[]) if s['name'] == 'Claim run'),None)
        if not claim or claim['conclusion'] != 'success': return # no request was claimed
        coverage = next((s for s in job.get('steps',[]) if s['name'] == 'Verify complete coverage'),None)
        conclusion = run['conclusion']
        verified = conclusion == 'success' and job['conclusion'] == 'success' and coverage and coverage['conclusion'] == 'success'
        status = 'succeeded' if verified else 'failed'
        if job['conclusion'] == 'success' and coverage and coverage['conclusion'] == 'skipped':
            status = 'skipped'
        summary = {'coverage_verified':bool(verified),'job':name,'run_attempt':run['run_attempt']}
    key = os.environ['SUPABASE_SERVICE_ROLE_KEY']
    call(url+'/rest/v1/rpc/backup_report_run',
         {'apikey':key,'Authorization':'Bearer '+key,'Content-Type':'application/json'},
         dict(p_environment=label,p_kind=kind,p_github_run_id=run_id,p_status=status,
              p_conclusion=conclusion,p_summary=summary,p_request_id=request_id,
              p_code='workflow_failed' if status == 'failed' else None))

if __name__ == '__main__':
    try: main()
    except Exception:
        print('Ledger report failed; inspect the private workflow before retrying.',file=sys.stderr)
        sys.exit(1)
