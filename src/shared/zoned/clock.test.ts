// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { formatClock, formatHour, parseClock, type TimeLabels } from './clock';

const EN: TimeLabels = { am: 'AM', pm: 'PM' };
const UK: TimeLabels = { am: 'дп', pm: 'пп' };

describe('formatClock', () => {
  it.each([
    [0, '12:00 AM', '00:00'],
    [5, '12:05 AM', '00:05'],
    [60, '1:00 AM', '01:00'],
    [9 * 60 + 30, '9:30 AM', '09:30'],
    [12 * 60, '12:00 PM', '12:00'],
    [12 * 60 + 59, '12:59 PM', '12:59'],
    [13 * 60, '1:00 PM', '13:00'],
    [23 * 60 + 59, '11:59 PM', '23:59'],
  ])('%i minutes -> %s / %s', (minutes, twelve, twentyFour) => {
    expect(formatClock(minutes, '12h', EN)).toBe(twelve);
    expect(formatClock(minutes, '24h', EN)).toBe(twentyFour);
  });

  it('uses the locale labels and a plain ASCII space (stable between server and browser)', () => {
    const text = formatClock(15 * 60, '12h', UK);
    expect(text).toBe('3:00 пп');
    for (const code of [0x202f, 0x00a0])
      expect(text.includes(String.fromCharCode(code))).toBe(false);
  });

  it('hour labels for the time axis', () => {
    expect(formatHour(0, '12h', EN)).toBe('12 AM');
    expect(formatHour(12, '12h', EN)).toBe('12 PM');
    expect(formatHour(15, '12h', EN)).toBe('3 PM');
    expect(formatHour(9, '24h', EN)).toBe('09:00');
    expect(formatHour(24, '24h', EN)).toBe('00:00');
  });
});

describe('parseClock', () => {
  it.each([
    ['9', 540],
    ['09', 540],
    ['9:30', 570],
    ['9.30', 570],
    ['930', 570],
    ['0930', 570],
    ['905', 545],
    ['21:30', 1290],
    ['23:59', 1439],
    ['0', 0],
    ['00:00', 0],
    ['  9:30  ', 570],
    ['9am', 540],
    ['9 AM', 540],
    ['9:30pm', 1290],
    ['9:30 PM', 1290],
    ['12am', 0],
    ['12pm', 720],
    ['12:30am', 30],
    ['12:30 pm', 750],
    ['1p', 780],
    ['1 a', 60],
  ])('%j -> %i minutes', (text, minutes) => {
    expect(parseClock(text, EN)).toBe(minutes);
  });

  it.each([
    '',
    ' ',
    'abc',
    '24:00',
    '25',
    '99',
    '9:60',
    '9:5',
    '13pm',
    '0am',
    '13am',
    '9:30 xm',
    '9:30:15',
    '-1',
    '9,30',
    '１２',
  ])('rejects %j', (text) => {
    expect(parseClock(text, EN)).toBeNull();
  });

  it('never guesses PM: a bare "9" is 09:00, a bare "15" is 15:00 in either style', () => {
    expect(parseClock('9', EN)).toBe(540);
    expect(parseClock('15', EN)).toBe(900);
  });

  it('understands Ukrainian day-period labels as well as am/pm', () => {
    expect(parseClock('3:15 пп', UK)).toBe(15 * 60 + 15);
    expect(parseClock('3:15 дп', UK)).toBe(3 * 60 + 15);
    expect(parseClock('3:15 pm', UK)).toBe(15 * 60 + 15);
  });

  it('round-trips every minute of the day in both styles and both label sets', () => {
    for (const labels of [EN, UK]) {
      for (let m = 0; m < 1440; m += 1) {
        expect(parseClock(formatClock(m, '24h', labels), labels), `24h ${m}`).toBe(m);
        expect(parseClock(formatClock(m, '12h', labels), labels), `12h ${m}`).toBe(m);
      }
    }
  });
});
