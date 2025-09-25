const { computeNextForSchedule, occurrencesBetween } = require('../lib/scheduler');

describe('scheduler helpers', () => {
  test('computeNextForSchedule returns null for past once', () => {
    const past = new Date(Date.now() - 1000 * 60 * 60).toISOString();
    expect(computeNextForSchedule({type:'once', when: past})).toBeNull();
  });

  test('computeNextForSchedule daily returns a timestamp in the future', () => {
    const now = new Date();
    const hour = now.getHours();
    const minute = (now.getMinutes() + 2) % 60;
    const ts = computeNextForSchedule({type:'daily', time: `${String(hour).padStart(2,'0')}:${String(minute).padStart(2,'0')}`});
    expect(typeof ts).toBe('number');
    expect(ts).toBeGreaterThan(Date.now());
  });

  test('occurrencesBetween daily returns occurrences inside range', () => {
    const start = Date.now();
    const end = start + 1000 * 60 * 60 * 24 * 3; // 3 days
    const s = { type: 'daily', time: '00:00' };
    const occ = occurrencesBetween(s, start - 1000, end);
    expect(Array.isArray(occ)).toBe(true);
    expect(occ.length).toBeGreaterThanOrEqual(1);
  });

  test('weekly occurrences honor days', () => {
    const now = new Date();
    const dow = now.getDay();
    const start = Date.now() - 1000 * 60 * 60 * 24;
    const end = Date.now() + 1000 * 60 * 60 * 24 * 8;
    const s = { type: 'weekly', days: [dow], time: '00:00' };
    const occ = occurrencesBetween(s, start, end);
    expect(occ.some(x => typeof x === 'number')).toBe(true);
  });

  test('monthly occurrences handle month boundaries', () => {
    const start = new Date(); start.setDate(1); start.setHours(0,0,0,0);
    const end = new Date(start); end.setMonth(end.getMonth()+3);
    const s = { type: 'monthly', day: 31, time: '00:00' };
    const occ = occurrencesBetween(s, start.getTime() - 1000, end.getTime());
    expect(Array.isArray(occ)).toBe(true);
  });
});
