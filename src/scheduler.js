/**
 * scheduler.js — Calculates the optimal next posting time per client niche.
 * Respects existing scheduled posts (max 1/day) and blackout dates.
 */

const { getScheduledPostsForClient } = require('./supabase');

// Best posting windows per niche (AEST hours)
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

// AEST = UTC+10
const AEST_OFFSET_HOURS = 10;

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

function toAESTDay(date) {
  const aest = new Date(date.getTime() + AEST_OFFSET_HOURS * 60 * 60 * 1000);
  return aest.getUTCDay();
}

function toAESTDateString(date) {
  const aest = new Date(date.getTime() + AEST_OFFSET_HOURS * 60 * 60 * 1000);
  return aest.toISOString().split('T')[0];
}

function toUTCFromAEST(date, aestHour) {
  const aest = new Date(date);
  aest.setUTCHours(aestHour - AEST_OFFSET_HOURS, 0, 0, 0);
  return aest;
}

/**
 * Format a UTC ISO string into a human-readable AEST string.
 * e.g. "Thursday 24 April at 6:00pm AEST"
 */
function formatScheduledTime(isoString) {
  const date = new Date(isoString);
  const aest = new Date(date.getTime() + AEST_OFFSET_HOURS * 60 * 60 * 1000);

  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  const dayName = days[aest.getUTCDay()];
  const day = aest.getUTCDate();
  const month = months[aest.getUTCMonth()];
  const hour = aest.getUTCHours();
  const ampm = hour >= 12 ? 'pm' : 'am';
  const displayHour = hour > 12 ? hour - 12 : hour === 0 ? 12 : hour;

  return `${dayName} ${day} ${month} at ${displayHour}:00${ampm} AEST`;
}

module.exports = { getNextPostTime, formatScheduledTime };
