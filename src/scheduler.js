/**
 * scheduler.js — Calculates the optimal next posting time per client niche.
 * Respects existing scheduled posts (max 1/day) and blackout dates.
 */

const { getScheduledPostsForClient } = require('./supabase');

// Best posting windows per niche (Australia/Sydney local hours)
const NICHE_SCHEDULE = {
  beauty_salon:    { days: [2, 3, 4], hours: [7, 18] },      // Tue/Wed/Thu 7am or 6pm
  nail_studio:     { days: [2, 3, 4], hours: [11, 18] },     // Tue/Wed/Thu 11am or 6pm
  pilates_yoga:    { days: [1, 3, 5], hours: [6, 17] },      // Mon/Wed/Fri 6am or 5pm
  allied_health:   { days: [1, 3, 5], hours: [8, 12] },      // Mon/Wed/Fri 8am or 12pm
  cafe_brunch:     { days: [1, 2, 3, 4, 5], hours: [7] },    // Weekdays 7:30am
  boutique_retail: { days: [2, 4, 6], hours: [11, 19] },     // Tue/Thu/Sat 11am or 7pm
  pet_grooming:    { days: [2, 4, 6], hours: [9, 17] },      // Tue/Thu/Sat 9am or 5pm
  personal_training: { days: [1, 3, 5], hours: [6, 16] },    // Mon/Wed/Fri 6am or 4pm
  wellness:        { days: [1, 3, 5], hours: [8, 19] },      // Mon/Wed/Fri 8am or 7pm
};

const DEFAULT_SCHEDULE = { days: [1, 3, 5], hours: [9, 17] };

const SYDNEY_TZ = 'Australia/Sydney';

/**
 * Given a client, return the next optimal UTC datetime to post.
 * Ensures no duplicate posts on the same day.
 */
async function getNextPostTime(client) {
  const niche = client.niche || 'default';
  const schedule = NICHE_SCHEDULE[niche] || DEFAULT_SCHEDULE;
  const blackoutDates = client.blackout_dates || [];

  // Get already-scheduled posts for this client
  const existing = await getScheduledPostsForClient(client.id);
  const scheduledDays = new Set(
    existing.map(p => toAESTDateString(new Date(p.scheduled_at)))
  );

  // Try to find next available slot within 14 days
  const now = new Date();

  for (let dayOffset = 0; dayOffset < 14; dayOffset++) {
    const candidateDate = new Date(now);
    candidateDate.setDate(candidateDate.getDate() + dayOffset);

    const dayOfWeek = toAESTDay(candidateDate); // 0=Sun, 1=Mon... 6=Sat
    const aestDateStr = toAESTDateString(candidateDate);

    // Check blackout
    if (blackoutDates.includes(aestDateStr)) continue;

    // Check if this day of week is in schedule
    if (!schedule.days.includes(dayOfWeek)) continue;

    // Check if already have a post this day
    if (scheduledDays.has(aestDateStr)) continue;

    // Find the best hour slot that's still in the future
    for (const aestHour of schedule.hours) {
      const slotUTC = toUTCFromAEST(candidateDate, aestHour);

      // Must be at least 30 minutes in the future
      if (slotUTC.getTime() > now.getTime() + 30 * 60 * 1000) {
        return slotUTC.toISOString();
      }
    }
  }

  // Fallback: next day at 9am AEST
  const fallback = new Date(now);
  fallback.setDate(fallback.getDate() + 1);
  return toUTCFromAEST(fallback, 9).toISOString();
}

// Formats a Date into Sydney wall-clock components using an all-numeric
// skeleton. Intl's format matcher can silently substitute fields (e.g.
// expanding a "short" month to full) when a skeleton mixes numeric and
// text styles, so every field here is numeric to keep the output exact.
const SYDNEY_PARTS_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: SYDNEY_TZ,
  hour12: false,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

function sydneyParts(date) {
  const parts = SYDNEY_PARTS_FORMATTER.formatToParts(date).reduce((acc, p) => {
    if (p.type !== 'literal') acc[p.type] = Number(p.value);
    return acc;
  }, {});
  if (parts.hour === 24) parts.hour = 0; // midnight can format as "24" with hour12:false
  return parts;
}

/**
 * Sydney's UTC offset, in minutes, in effect at `date` — 600 for AEST,
 * 660 for AEDT. Read from IANA tzdata via Intl instead of a hardcoded
 * constant, so it's correct across the daylight-saving transition
 * (roughly early Oct to early Apr, Sydney runs AEDT/+11, not AEST/+10).
 */
function sydneyOffsetMinutes(date) {
  const p = sydneyParts(date);
  const asUTC = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUTC - date.getTime()) / 60000);
}

function toAESTDay(date) {
  const p = sydneyParts(date);
  return new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
}

function toAESTDateString(date) {
  const p = sydneyParts(date);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/**
 * Converts a Sydney wall-clock hour on the Sydney calendar day
 * corresponding to `date` into the correct UTC instant. Uses a naive
 * guess-then-correct pass against the real tzdata offset, which is
 * unambiguous here because none of NICHE_SCHEDULE's posting hours fall
 * in the 2am-3am window where the AEST/AEDT transition itself happens.
 */
function toUTCFromAEST(date, sydneyHour) {
  const p = sydneyParts(date);
  const naiveUTC = Date.UTC(p.year, p.month - 1, p.day, sydneyHour, 0, 0);
  const offsetMin = sydneyOffsetMinutes(new Date(naiveUTC));
  return new Date(naiveUTC - offsetMin * 60000);
}

/**
 * Format a UTC ISO string into a human-readable Sydney-local string.
 * e.g. "Thursday 24 April at 6:00pm AEST" (or AEDT during daylight saving).
 */
function formatScheduledTime(isoString) {
  const date = new Date(isoString);
  const p = sydneyParts(date);
  const label = sydneyOffsetMinutes(date) === 660 ? 'AEDT' : 'AEST';

  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  const dayName = days[new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay()];
  const ampm = p.hour >= 12 ? 'pm' : 'am';
  const displayHour = p.hour > 12 ? p.hour - 12 : p.hour === 0 ? 12 : p.hour;

  return `${dayName} ${p.day} ${months[p.month - 1]} at ${displayHour}:00${ampm} ${label}`;
}

module.exports = { getNextPostTime, formatScheduledTime };
