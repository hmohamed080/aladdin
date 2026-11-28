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

class FreshnessTests(unittest.TestCase):
    NOW = dt.datetime(2026, 11, 26, 5, tzinfo=s.UTC)
    def limit(self, label='acceptance', event='schedule', drill='', **changes):
        settings = dict(initialized=True, environment=label, production_enabled=label == 'production',
            acceptance_schedule='daily', schedule_time='01:30', schedule_weekday=0, paused_until=None) | changes
        return s.freshness_limit(settings, label, event, self.NOW, drill)
    def test_limit_follows_the_console_frequency(self):
        self.assertEqual(self.limit(), 26)
        self.assertEqual(self.limit(acceptance_schedule='weekly'), 194)
        self.assertEqual(self.limit('production'), 26)
        self.assertEqual(self.limit('production', acceptance_schedule='weekly'), 194)
    def test_scheduled_check_skips_what_the_console_switched_off(self):
        self.assertIsNone(self.limit(acceptance_schedule='off'))
        self.assertIsNone(self.limit(paused_until='2026-11-27T00:00:00+00:00'))
        self.assertEqual(self.limit(paused_until='2026-11-26T04:00:00Z'), 26)
    def test_inactive_production_is_never_watched(self):
        for event in ('schedule', 'workflow_dispatch'):
            self.assertIsNone(self.limit('production', event, production_enabled=False))
    def test_manual_check_runs_while_off_or_paused(self):
        self.assertEqual(self.limit(event='workflow_dispatch', acceptance_schedule='off'), 26)
        self.assertEqual(self.limit(event='workflow_dispatch', acceptance_schedule='weekly',
            paused_until='2026-11-27T00:00:00+00:00'), 194)
    def test_drill_only_lowers_a_manual_limit(self):
        self.assertEqual(self.limit(event='workflow_dispatch', drill='1'), 1)
        self.assertEqual(self.limit(event='workflow_dispatch', acceptance_schedule='weekly', drill='24'), 24)
        self.assertEqual(self.limit(drill='1'), 26)
        for bad in ('26', '999', '0', '01', '1h', '-1', ' 1'):
            with self.assertRaises(ValueError, msg=bad): self.limit(event='workflow_dispatch', drill=bad)
    def test_unreadable_settings_are_refused(self):
        with self.assertRaises(ValueError): self.limit(environment='production')
        with self.assertRaises(ValueError): self.limit(initialized=False)
        with self.assertRaises(ValueError): self.limit(acceptance_schedule='hourly')
        with self.assertRaises(ValueError): self.limit(event='push')

class TargetTests(unittest.TestCase):
    def test_answers_become_the_check_matrix(self):
        self.assertEqual(s.freshness_targets({'acceptance': '194', 'production': '26'}),
            [{'label': 'acceptance', 'max_age_hours': 194}, {'label': 'production', 'max_age_hours': 26}])
        self.assertEqual(s.freshness_targets({'acceptance': 'skip', 'production': 'skip'}), [])
    def test_no_answer_is_checked_strictly_instead_of_ignored(self):
        self.assertEqual(s.freshness_targets({'acceptance': 'skip', 'production': ''}),
            [{'label': 'production', 'max_age_hours': 26}])
        self.assertEqual(s.freshness_targets({'acceptance': 'nonsense'}),
            [{'label': 'acceptance', 'max_age_hours': 26}])

if __name__ == '__main__': unittest.main()
