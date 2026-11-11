// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { ruleSyntaxProblem } from './validation';

/** The syntax gate in front of the rrule library (which loops forever on e.g. INTERVAL=-1). */
describe('ruleSyntaxProblem', () => {
  it.each([
    'FREQ=DAILY',
    'FREQ=DAILY;COUNT=10',
    'FREQ=WEEKLY;BYDAY=MO',
    'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE',
    'FREQ=WEEKLY;BYDAY=MO;UNTIL=20301231T235959Z',
    'FREQ=MONTHLY;BYDAY=1FR;UNTIL=20271231T235959Z',
    'FREQ=MONTHLY;BYDAY=-1MO',
    'FREQ=MONTHLY;BYMONTHDAY=31',
    'FREQ=MONTHLY;BYMONTHDAY=-1',
    'FREQ=DAILY;INTERVAL=99;COUNT=1000',
  ])('accepts %s', (rule) => {
    expect(ruleSyntaxProblem(rule)).toBeNull();
  });

  it.each([
    ['FREQ=DAILY;INTERVAL=-1', 'invalid INTERVAL'],
    ['FREQ=DAILY;INTERVAL=0', 'invalid INTERVAL'],
    ['FREQ=DAILY;INTERVAL=100', 'invalid INTERVAL'],
    ['FREQ=DAILY;INTERVAL=1.5', 'invalid INTERVAL'],
    ['FREQ=DAILY;INTERVAL=', 'invalid INTERVAL'],
    ['FREQ=DAILY;INTERVAL=2;INTERVAL=3', 'INTERVAL given twice'],
    ['FREQ=DAILY;INTERVAL=2;INTERVAL=-1', 'invalid INTERVAL'],
    ['FREQ=DAILY;COUNT=-1', 'invalid COUNT'],
    ['FREQ=DAILY;COUNT=0', 'invalid COUNT'],
    ['FREQ=DAILY;COUNT=10000', 'invalid COUNT'],
    ['FREQ=WEEKLY;BYDAY=', 'invalid BYDAY'],
    ['FREQ=WEEKLY;BYDAY=XX', 'invalid BYDAY'],
    ['FREQ=MONTHLY;BYMONTHDAY=32', 'invalid BYMONTHDAY'],
    ['FREQ=MONTHLY;BYMONTHDAY=0', 'invalid BYMONTHDAY'],
    ['FREQ=DAILY;UNTIL=tomorrow', 'invalid UNTIL'],
    ['FREQ=DAILY;BYHOUR=1', 'unsupported rule part "BYHOUR"'],
    ['FREQ=WEEKLY;BYSETPOS=1', 'unsupported rule part "BYSETPOS"'],
    [`FREQ=WEEKLY;BYDAY=${'MO,'.repeat(7)}MO`, 'too many values in BYDAY'],
    [
      `FREQ=MONTHLY;BYMONTHDAY=${Array.from({ length: 32 }, () => 1).join(',')}`,
      'too many values in BYMONTHDAY',
    ],
    ['INTERVAL=2', 'FREQ is required'],
    ['FREQ=YEARLY', 'invalid FREQ'],
    ['FREQ=DAILY;;COUNT=2', 'unsupported rule part ""'],
    ['FREQ=DAILY=1', 'invalid FREQ'],
  ])('refuses %s (%s)', (rule, why) => {
    expect(ruleSyntaxProblem(rule)).toBe(why);
  });
});
