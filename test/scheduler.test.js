const test = require('node:test');
const assert = require('node:assert/strict');
const { formatScheduledTime } = require('../src/scheduler');

test('formatScheduledTime matches "Weekday D Mon at H:MMam/pm AEST"', () => {
  const iso = new Date(Date.UTC(2026, 0, 15, 8, 0, 0)).toISOString();
  const result = formatScheduledTime(iso);
  assert.match(result, /^[A-Za-z]+ \d{1,2} [A-Za-z]{3} at \d{1,2}:00(am|pm) AEST$/);
});

test('formatScheduledTime converts UTC to AEST (+10h)', () => {
  // 08:00 UTC -> 18:00 AEST -> "6:00pm"
  const iso = new Date(Date.UTC(2026, 0, 15, 8, 0, 0)).toISOString();
  assert.match(formatScheduledTime(iso), /at 6:00pm AEST$/);
});

test('formatScheduledTime handles the day rollover at 14:00 UTC (midnight AEST)', () => {
  // 14:00 UTC -> 00:00 AEST the next day
  const iso = new Date(Date.UTC(2026, 0, 15, 14, 0, 0)).toISOString();
  assert.match(formatScheduledTime(iso), /at 12:00am AEST$/);
});

test('formatScheduledTime handles noon UTC correctly (10pm AEST)', () => {
  const iso = new Date(Date.UTC(2026, 0, 15, 12, 0, 0)).toISOString();
  assert.match(formatScheduledTime(iso), /at 10:00pm AEST$/);
});
