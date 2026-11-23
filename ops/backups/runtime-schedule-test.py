import datetime as dt
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('schedule', Path(__file__).with_name('runtime-schedule.py'))
s = importlib.util.module_from_spec(spec)
spec.loader.exec_module(s)

class ScheduleTests(unittest.TestCase):
    def setUp(self):
        self.settings = dict(initialized=True, environment='acceptance', production_enabled=False,
            acceptance_schedule='daily', schedule_time='01:30', schedule_weekday=0, paused_until=None)
    def run_at(self, at, event='schedule', **changes):
        return s.decision(self.settings | changes, 'acceptance', event, dt.datetime.fromisoformat(at))
    def test_winter_and_summer(self):
        self.assertTrue(self.run_at('2026-11-06T23:30:00+00:00'))
        self.assertTrue(self.run_at('2026-07-06T22:30:00+00:00'))
    def test_delayed_and_weekly(self):
        self.assertTrue(self.run_at('2026-11-08T08:00:00+00:00', acceptance_schedule='weekly'))
        self.assertFalse(self.run_at('2026-11-10T08:00:00+00:00', acceptance_schedule='weekly'))
    def test_manual_during_pause(self):
        changes = dict(paused_until='2026-11-08T00:00:00+00:00', acceptance_schedule='off')
        self.assertFalse(self.run_at('2026-11-07T12:00:00+00:00', **changes))
        self.assertTrue(self.run_at('2026-11-07T12:00:00+00:00', event='workflow_dispatch', **changes))
    def test_pause_expires(self):
        self.assertTrue(self.run_at('2026-11-07T12:00:00+00:00', paused_until='2026-11-07T11:00:00+00:00'))
    def test_isolation(self):
        with self.assertRaises(ValueError): self.run_at('2026-11-07T12:00:00+00:00', environment='production')
        with self.assertRaises(ValueError): self.run_at('2026-11-07T12:00:00+00:00', initialized=False)
    def test_dst_gap(self):
        self.assertTrue(self.run_at('2026-04-23T22:45:00+00:00', schedule_time='00:30'))
    def test_restore_independent_of_pause(self):
        settings = self.settings | dict(environment='production', production_enabled=True,
            production_restore_schedule_enabled=True, paused_until='2027-01-01T00:00:00+00:00')
        self.assertTrue(s.decision(settings,'production','schedule',dt.datetime(2026,11,7,tzinfo=s.UTC),'restore_test'))

if __name__ == '__main__': unittest.main()
