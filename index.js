/**
 * index.js — kaspr-agent3 entry point.
 *
 * Runs as a daemon on Railway. Two concurrent loops:
 *
 *  FAST LOOP (every 30s):
 *    - processQueue()  → caption gen + scheduling for new content
 *    - publishDue()    → fire posts that have hit their scheduled_at time
 *    - poll OpenClaw events (content.received, trend.brief.ready)
 *    - process reply signals (PREVIEW / GO / EDIT)
 *
 *  HEALTH endpoint:
 *    GET /health → 200 OK
 */

require('dotenv').config();

const express = require('express');
const { processQueue, publishDue, handlePreviewRequest } = require('./src/publisher');
const openclaw = require('./src/openclaw');
const db = require('./src/supabase');

// ─── ENV VALIDATION ──────────────────────────────────────────────────────────

const REQUIRED = [
  'ANTHROPIC_API_KEY',
  'SUPABASE_URL',
'SUPABASE_SERVICE_ROLE_KEY',
  'TWILIO_ACCOUNT_SID',
  'TWILIO_AUTH_TOKEN',
  'TWILIO_WHATSAPP_NUMBER',
];

const missing = REQUIRED.filter(k => !process.env[k]);
if (missing.length > 0) {
  console.error(`[startup] ❌ Missing env vars: ${missing.join(', ')}`);
  process.exit(1);
}

// ─── HEALTH SERVER ───────────────────────────────────────────────────────────

const app = express();
app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ status: 'ok', agent: 'kaspr-publisher', ts: new Date().toISOString() });
});

const PORT = process.env.PORT || 3003;
app.listen(PORT, () => {
  console.log(`[kaspr-agent3] Health check on port ${PORT}`);
});

// ─── MAIN DAEMON LOOP ────────────────────────────────────────────────────────

let isRunning = false;

async function tick() {
  if (isRunning) return; // Prevent overlapping ticks
  isRunning = true;

  try {
    // 1. Process any pending OpenClaw events
    const events = await openclaw.pollEvents(['content.received', 'trend.brief.ready']);
    for (const event of events) {
      console.log(`[daemon] OpenClaw event: ${event.event_name} | ${event.id}`);
      await openclaw.markProcessed(event.id);
      // Events are informational — actual work happens via DB polling below
    }

    // 2. Handle reply signals (PREVIEW / GO / EDIT) from Agent 1
    await handleReplySignals();

    // 3. Process new content queue items → generate captions + schedule
    await processQueue();

    // 4. Publish any posts that are now due
    await publishDue();

    await openclaw.logStatus('idle', `Last tick: ${new Date().toISOString()}`);

  } catch (err) {
    console.error('[daemon] Tick error:', err.message);
    await openclaw.logStatus('error', err.message);
  } finally {
    isRunning = false;
  }
}

/**
 * Poll content_queue for reply_signal rows and handle them.
 */
async function handleReplySignals() {
  const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  const { data: signals } = await supabase
    .from('content_queue')
    .select('*')
    .eq('content_type', 'reply_signal')
    .eq('status', 'pending')
    .order('received_at', { ascending: true })
    .limit(10);

  if (!signals || signals.length === 0) return;

  for (const signal of signals) {
    const raw = signal.raw_caption || '';

    try {
      if (raw === 'PREVIEW_REQUESTED') {
        console.log(`[daemon] Handling PREVIEW for client ${signal.client_id}`);
        await handlePreviewRequest(signal.client_id);

      } else if (raw === 'GO_CONFIRMED') {
        // Post is already scheduled — just mark signal done
        console.log(`[daemon] GO confirmed for client ${signal.client_id}`);

      } else if (raw.startsWith('EDIT_REQUEST:')) {
        // Edit instructions are picked up by processQueueItem during next caption gen
        console.log(`[daemon] Edit request queued for client ${signal.client_id}`);
        // Leave as pending — publisher.js reads it during processQueue
        continue;
      }

      // Mark signal as processed
      await supabase
        .from('content_queue')
        .update({ status: 'processed', processed_at: new Date().toISOString() })
        .eq('id', signal.id);

    } catch (err) {
      console.error(`[daemon] Signal handling failed for ${signal.id}:`, err.message);
    }
  }
}

// ─── START ───────────────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 30 * 1000; // 30 seconds

console.log(`\n${'='.repeat(60)}`);
console.log(`[kaspr-agent3] Kaspr Publisher starting`);
console.log(`[kaspr-agent3] Poll interval: ${POLL_INTERVAL_MS / 1000}s`);
console.log(`${'='.repeat(60)}\n`);

openclaw.logStatus('running', 'Publisher daemon started');

// Run immediately on boot, then on interval
tick();
setInterval(tick, POLL_INTERVAL_MS);
