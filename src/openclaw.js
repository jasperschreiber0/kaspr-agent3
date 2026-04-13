/**
 * openclaw.js — OpenClaw event bus integration for kaspr-agent3.
 *
 * Agent 3 LISTENS for:
 *   - content.received     (from Agent 1 — new content in queue)
 *   - trend.brief.ready    (from Agent 2 — fresh trend brief available)
 *
 * Agent 3 EMITS:
 *   - post.scheduled       (post locked in for publishing)
 *   - post.failed          (posting error after retries)
 *   - preview.sent         (caption preview sent to client)
 */

const axios = require('axios');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

const HEADERS = {
  apikey: SUPABASE_SERVICE_KEY,
  Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
  'Content-Type': 'application/json',
  Prefer: 'return=representation',
};

/**
 * Emit an event to the OpenClaw event bus.
 */
async function emit(eventName, payload) {
  try {
    const resp = await axios.post(
      `${SUPABASE_URL}/rest/v1/openclaw_events`,
      {
        event_name: eventName,
        source: 'kaspr-publisher',
        payload,
        processed: false,
        created_at: new Date().toISOString(),
      },
      { headers: HEADERS, timeout: 10000 }
    );
    const record = resp.data?.[0];
    console.log(`[openclaw] Emitted: ${eventName} | id: ${record?.id ?? 'unknown'}`);
    return record;
  } catch (err) {
    console.warn(`[openclaw] Emit failed for ${eventName}:`, err.message);
    return null;
  }
}

/**
 * Poll for unprocessed events targeting this agent.
 * Agent 3 listens for content.received and trend.brief.ready.
 */
async function pollEvents(eventNames) {
  try {
    const resp = await axios.get(
      `${SUPABASE_URL}/rest/v1/openclaw_events`,
      {
        headers: HEADERS,
        params: {
          event_name: `in.(${eventNames.join(',')})`,
          processed: 'eq.false',
          order: 'created_at.asc',
          limit: 10,
        },
        timeout: 10000,
      }
    );
    return resp.data ?? [];
  } catch (err) {
    console.warn('[openclaw] Poll failed:', err.message);
    return [];
  }
}

/**
 * Mark an OpenClaw event as processed.
 */
async function markProcessed(eventId) {
  try {
    await axios.patch(
      `${SUPABASE_URL}/rest/v1/openclaw_events`,
      { processed: true, processed_at: new Date().toISOString() },
      {
        headers: HEADERS,
        params: { id: `eq.${eventId}` },
        timeout: 10000,
      }
    );
  } catch (err) {
    console.warn(`[openclaw] markProcessed failed for ${eventId}:`, err.message);
  }
}

/**
 * Update this agent's status in openclaw_agent_status table.
 */
async function logStatus(status, detail = '') {
  try {
    await axios.post(
      `${SUPABASE_URL}/rest/v1/openclaw_agent_status`,
      {
        agent: 'kaspr-publisher',
        status,
        detail,
        updated_at: new Date().toISOString(),
      },
      {
        headers: { ...HEADERS, Prefer: 'resolution=merge-duplicates' },
        timeout: 10000,
      }
    );
  } catch (err) {
    console.warn('[openclaw] logStatus failed:', err.message);
  }
}

module.exports = { emit, pollEvents, markProcessed, logStatus };
