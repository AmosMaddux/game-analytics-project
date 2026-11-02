"""Synthetic, offline-only budget-adapter fixtures; no credentials or API calls."""
import hashlib
import json
from pathlib import Path
import sqlite3
import subprocess
import tempfile
import unittest

SCRIPT = Path(__file__).with_name('prepare-budget-baseline.py')
class BudgetAdapterTests(unittest.TestCase):
    def prepare(self, mutate=None):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        root = Path(self.tmp.name)
        db = sqlite3.connect(root/'fixture.sqlite')
        db.execute('CREATE TABLE collection_jobs(job_id,source,kind,status,started_at,finished_at,counters_json)')
        db.execute('INSERT INTO collection_jobs VALUES(?,?,?,?,?,?,?)', ('fixture-job','steam','manual','complete','2026-10-10T00:00:00Z','2026-10-10T00:01:00Z','{"requests":7}'))
        db.commit();db.close()
        state = {'version':'fieldnote-population-discovery-1.0','planHash':'a'*64,'plan':{'asOf':'2026-10-11T00:00:00.000Z'},'status':'complete','finishedAt':'2026-10-11T18:00:00.000Z','budget':{'requests':17},'candidates':[{'igdbId':2,'name':'SYNTHETIC 雪','value':1.2e-7}]}
        report = {'schemaVersion':state['version'],'planHash':state['planHash'],'asOf':state['plan']['asOf'],'status':state['status'],'counters':dict(state['budget']),'candidates':state['candidates']}
        if mutate: mutate(state, report)
        raw = json.dumps(state,ensure_ascii=False,separators=(',',':'))
        checkpoint = '{"sha256":"'+hashlib.sha256(raw.encode()).hexdigest()+'","state":'+raw+'}\n'
        (root/'checkpoint.json').write_text(checkpoint)
        (root/'candidates.json').write_text(json.dumps(report))
        return root
    def run_fixture(self, root, checkpoint=True):
        args=['python3',str(SCRIPT),'--database',str(root/'fixture.sqlite'),'--evidence',str(root/'candidates.json'),'--month','2026-10','--bootstrap-allowance','2700']
        if checkpoint: args+=['--discovery-checkpoint',str(root/'checkpoint.json')]
        return subprocess.run(args,capture_output=True,text=True)
    def test_frozen_report_joins_actual_checkpoint_time_and_budget(self):
        result=self.run_fixture(self.prepare());self.assertEqual(result.returncode,0,result.stderr)
        value=json.loads(result.stdout);self.assertEqual(value['usedRequests'],24)
        self.assertEqual(value['entries'][1]['finishedAt'],'2026-10-11T18:00:00.000Z')
        self.assertEqual(len(value['entries'][1]['checkpointSha256']),64)
    def test_counter_mismatch_rejects(self):
        result=self.run_fixture(self.prepare(lambda s,r:r['counters'].update(requests=16)));self.assertNotEqual(result.returncode,0)
    def test_missing_checkpoint_rejects(self):
        self.assertNotEqual(self.run_fixture(self.prepare(),False).returncode,0)
    def test_hash_mutation_rejects(self):
        root=self.prepare();path=root/'checkpoint.json';path.write_text(path.read_text().replace('SYNTHETIC','ALTERED'))
        self.assertNotEqual(self.run_fixture(root).returncode,0)
    def test_wrong_month_rejects(self):
        self.assertNotEqual(self.run_fixture(self.prepare(lambda s,r:s.update(finishedAt='2026-09-30T18:00:00.000Z'))).returncode,0)
    def test_running_checkpoint_rejects(self):
        def change(s,r):s['status']='running';r['status']='running'
        self.assertNotEqual(self.run_fixture(self.prepare(change)).returncode,0)
if __name__=='__main__':unittest.main()
