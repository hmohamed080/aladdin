#!/usr/bin/env python3
"""Runtime schedule decision. Read-only RPC; no writes or dispatches.

The scheduler polls independently of the frontend. A due slot remains eligible
for 24h (including delayed GitHub jobs); completed-snapshot checks deduplicate it.
Never use repository schedule defaults after an API failure.
"""
import datetime as dt
import json
import os
import sys
import urllib.request
from zoneinfo import ZoneInfo

UTC = dt.timezone.utc
CAIRO = ZoneInfo('Africa/Cairo')
PROJECTS = {'acceptance': 'nxossqhdfltcqdwvbewi', 'production': 'kkpkgjrweysgvhvkhzun'}

def due_slot(settings, now):
    clock = dt.time.fromisoformat(settings['schedule_time'])
    weekday = settings['schedule_weekday']
    if type(weekday) is not int or not 0 <= weekday <= 6:
        raise ValueError('invalid weekday')
    for days in range(2):
        date = now.astimezone(CAIRO).date() - dt.timedelta(days=days)
        if settings['acceptance_schedule'] == 'weekly' and (date.weekday() + 1) % 7 != weekday:
            continue
        slot = dt.datetime.combine(date, clock, CAIRO).astimezone(UTC)
        if dt.timedelta(0) <= now - slot < dt.timedelta(hours=24):
            return date
    return None

def decision(settings, label, event, now, kind='backup'):
    if settings.get('initialized') is not True or settings.get('environment') != label:
        raise ValueError('environment not initialized or mismatched')
    if label == 'production' and settings.get('production_enabled') is not True:
        return False
    if event == 'workflow_dispatch':
        return True  # Pausing automatic backups never prevents a manual operation.
    if event != 'schedule':
        raise ValueError('unsupported event')
    if kind == 'restore_test':
        return label == 'production' and settings.get('production_restore_schedule_enabled') is True
    pause = settings.get('paused_until')
    if pause and dt.datetime.fromisoformat(pause.replace('Z', '+00:00')) > now:
        return False
    frequency = settings.get('acceptance_schedule')
    if frequency == 'off':
        return False
    if frequency not in ('daily', 'weekly'):
        raise ValueError('invalid frequency')
    return due_slot(settings, now) is not None

FRESHNESS_HOURS = {'daily': 26, 'weekly': 194}  # one slot plus 2 h of grace
STRICT_HOURS = FRESHNESS_HOURS['daily']

def freshness_limit(settings, label, event, now, drill=''):
    """Oldest age, in hours, the newest backup may have; None when the alarm does not watch this project now."""
    # A manual check only reads the bucket: a pause or an "off" schedule does not stop it.
    if not decision(settings, label, 'workflow_dispatch', now):
        return None
    if event not in ('schedule', 'workflow_dispatch'):
        raise ValueError('unsupported event')
    frequency = settings.get('acceptance_schedule')
    if frequency not in ('off', *FRESHNESS_HOURS):
        raise ValueError('invalid frequency')
    if event == 'schedule':
        pause = settings.get('paused_until')
        if frequency == 'off' or (pause and dt.datetime.fromisoformat(pause.replace('Z', '+00:00')) > now):
            return None
    limit = FRESHNESS_HOURS.get(frequency, STRICT_HOURS)
    # Alarm drill: a manual run may tighten the limit, never loosen it.
    if event == 'workflow_dispatch' and drill:
        if not (drill.isascii() and drill.isdigit() and not drill.startswith('0') and int(drill) < limit):
            raise ValueError('max_age_hours may only be lowered')
        return int(drill)
    return limit

def freshness_targets(answers):
    """The check matrix from the control jobs' answers. No answer is not "skip": it is checked with the strict limit."""
    targets = []
    for label, answer in answers.items():
        if answer != 'skip':
            hours = int(answer) if answer.isascii() and answer.isdigit() else STRICT_HOURS
            targets.append({'label': label, 'max_age_hours': hours})
    return targets

def print_targets():
    targets = freshness_targets({label: os.environ.get('MAX_AGE_' + label.upper(), '') for label in PROJECTS})
    line = json.dumps(targets, separators=(',', ':'))
    with open(os.environ['GITHUB_OUTPUT'], 'a') as output:
        output.write('targets=' + line + '\n')
    # Never let "nothing to check" look like a pass.
    print('Checking: ' + line if targets else
          'NOTHING WAS CHECKED: the Admin console has every backup schedule off, paused or not activated.')

def main():
    label = os.environ['BACKUP_LABEL']
    url = os.environ['SUPABASE_URL'].rstrip('/')
    if url != f'https://{PROJECTS[label]}.supabase.co':
        raise ValueError('project mismatch')
    key = os.environ['SUPABASE_SERVICE_ROLE_KEY']
    request = urllib.request.Request(url + '/rest/v1/rpc/backup_schedule_read', data=b'{}',
        headers={'apikey': key, 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json'})
    with urllib.request.urlopen(request, timeout=20) as response:
        settings = json.load(response)
    now = dt.datetime.now(UTC)
    if os.environ.get('BACKUP_KIND') == 'freshness':
        limit = freshness_limit(settings, label, os.environ['EVENT'], now, os.environ.get('INPUT_MAX_AGE_HOURS', ''))
        with open(os.environ['GITHUB_OUTPUT'], 'a') as output:
            output.write('max_age_hours=' + ('skip' if limit is None else str(limit)) + '\n')
        return
    run = decision(settings, label, os.environ['EVENT'], now, os.environ.get('BACKUP_KIND','backup'))
    with open(os.environ['GITHUB_OUTPUT'], 'a') as output:
        output.write('run=' + str(run).lower() + '\n')
        # The data job reads the slot from this job's output; it never holds the credential that produced it.
        if run and os.environ['EVENT'] == 'schedule' and os.environ.get('BACKUP_KIND','backup') == 'backup':
            output.write('slot_date=' + due_slot(settings, now).isoformat() + '\n')

if __name__ == '__main__':
    try:
        print_targets() if sys.argv[1:] == ['targets'] else main()
    except Exception:
        # Provider errors can contain credentials or private project data.
        print('Runtime schedule unavailable or invalid; no work authorized.', file=sys.stderr)
        sys.exit(1)
