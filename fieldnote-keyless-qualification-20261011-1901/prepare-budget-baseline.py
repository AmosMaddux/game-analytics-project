#!/usr/bin/env python3
"""Build a request baseline from actual saved job counters and source reports.

Read-only: does not open credentials, call APIs, enable schedules or mutate SQLite.
The baseline covers known saved project jobs. Independently run collectors must
be added as evidence before this baseline is used; absence is never a zero claim.
"""
import argparse
import datetime as dt
import hashlib
import json
import pathlib
import re
import sqlite3

parser = argparse.ArgumentParser()
parser.add_argument('--database', required=True)
parser.add_argument('--evidence', action='append', required=True)
parser.add_argument('--discovery-checkpoint', action='append', default=[], help='Matching sanitized checkpoint.json for frozen discovery reports lacking execution timestamps.')
parser.add_argument('--month', default=dt.datetime.now(dt.timezone.utc).strftime('%Y-%m'))
parser.add_argument('--bootstrap-allowance', type=int, default=0)
args = parser.parse_args()
assert 0 <= args.bootstrap_allowance <= 3000
dt.datetime.strptime(args.month, '%Y-%m')
db_path = pathlib.Path(args.database).resolve(strict=True)
db = sqlite3.connect(db_path.as_uri() + '?mode=ro', uri=True)
db.row_factory = sqlite3.Row
entries = []
for job in db.execute('SELECT job_id, source, kind, status, started_at, finished_at, counters_json FROM collection_jobs ORDER BY job_id'):
    if job['source'] == 'collector_control' and job['kind'] == 'lease':
        continue  # A local concurrency lease performs no source request.
    # Charge a whole spanning/unfinished saved job conservatively to this month.
    if not job['started_at'].startswith(args.month) and not (job['started_at'][:7] < args.month and (job['finished_at'] is None or job['finished_at'][:7] >= args.month)):
        continue
    counters = json.loads(job['counters_json'])
    assert isinstance(counters.get('requests'), int) and counters['requests'] >= 0, 'Saved request counter unavailable; reconcile before running.'
    entries.append({'id': job['job_id'], 'source': job['source'], 'requests': counters['requests'], 'evidence': 'saved_collection_jobs', 'status': job['status']})
checkpoints = []
for filename in args.discovery_checkpoint:
    path = pathlib.Path(filename).resolve(strict=True)
    assert path.stat().st_size <= 32 * 1024 * 1024
    raw = path.read_bytes()
    text = raw.decode('utf-8')
    # The reviewed discovery writer uses this exact compact envelope. Hash its
    # original state bytes, avoiding cross-language float/Unicode reserialization.
    prefix = re.match(r'^\{"sha256":"([a-f0-9]{64})","state":', text)
    assert prefix, 'Unsupported discovery checkpoint envelope.'
    state, end = json.JSONDecoder().raw_decode(text, prefix.end())
    assert text[end:].strip() == '}'
    assert hashlib.sha256(text[prefix.end():end].encode('utf-8')).hexdigest() == prefix[1], 'Discovery checkpoint integrity mismatch.'
    assert state.get('version') == 'fieldnote-population-discovery-1.0'
    assert isinstance(state.get('finishedAt'), str) and state['finishedAt'].startswith(args.month), 'Discovery completion month must be explicit and match.'
    assert state.get('status') in ('complete', 'partial', 'blocked'), 'Discovery must be stopped before budget reconciliation.'
    checkpoints.append({'state': state, 'sha256': hashlib.sha256(raw).hexdigest(), 'used': False})
for filename in args.evidence:
    path = pathlib.Path(filename).resolve(strict=True)
    assert path.stat().st_size <= 32 * 1024 * 1024
    raw = path.read_bytes()
    report = json.loads(raw)
    digest = hashlib.sha256(raw).hexdigest()
    checkpoint_sha = None
    if report.get('schemaVersion') == 'fieldnote-population-discovery-1.0':
        matches = [item for item in checkpoints if
            item['state'].get('planHash') == report.get('planHash') and
            item['state'].get('plan', {}).get('asOf') == report.get('asOf') and
            item['state'].get('status') == report.get('status') and
            item['state'].get('budget') == report.get('counters') and
            sorted(item['state'].get('candidates', []), key=lambda row: row['igdbId']) == report.get('candidates')]
        assert len(matches) == 1 and not matches[0]['used'], 'Exactly one unused matching discovery checkpoint is required.'
        match = matches[0]
        match['used'] = True
        when = match['state']['finishedAt']
        checkpoint_sha = match['sha256']
        if report.get('finishedAt') is not None:
            assert report['finishedAt'] == when, 'Discovery completion timestamp mismatch.'
    else:
        when = report.get('finishedAt') or report.get('collectedAt') or report.get('startedAt')
    assert isinstance(when, str) and when.startswith(args.month), 'Evidence month must be explicit and match.'
    counters = report.get('campaignCounters') or report.get('counters')
    assert isinstance(counters, dict) and isinstance(counters.get('requests'), int) and counters['requests'] >= 0, 'Evidence needs an actual aggregate request counter.'
    entry = {'id': report.get('runId', 'report-' + digest[:24]), 'source': 'source_validation_or_bootstrap', 'requests': counters['requests'], 'reportSha256': digest, 'evidence': path.name}
    if checkpoint_sha:
        entry['checkpointSha256'] = checkpoint_sha
        entry['finishedAt'] = when
    entries.append(entry)
assert all(item['used'] for item in checkpoints), 'Unused discovery checkpoint needs reconciliation.'
assert len({row['id'] for row in entries}) == len(entries), 'Duplicate job/evidence IDs need reconciliation.'
result = {
    'schemaVersion': 'fieldnote-source-budget-baseline-1.0',
    'month': args.month,
    'authoritativeLedgerPath': str(db_path.parent / ('fieldnote-source-budget-' + args.month + '.json')),
    'createdAt': dt.datetime.now(dt.timezone.utc).isoformat().replace('+00:00', 'Z'),
    'entries': entries,
    'usedRequests': sum(row['requests'] for row in entries),
    'scheduleEnabled': False,
    'reservedScheduledRequests': 0,
    'bootstrapAllowance': args.bootstrap_allowance,
    'scope': 'Actual saved collection_jobs plus explicitly supplied reports. No future weekly schedule is enabled or invented. Add any later discovery/qualification runs before starting collection. A campaign report includes its prior runs, which must not also be supplied separately.',
    'databaseIntegrity': db.execute('PRAGMA integrity_check').fetchone()[0],
}
assert result['databaseIntegrity'] == 'ok'
print(json.dumps(result, indent=2))
db.close()
