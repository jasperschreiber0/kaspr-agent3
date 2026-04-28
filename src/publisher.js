/**
 * publisher.js — Core pipeline for kaspr-agent3.
 *
 * Handles two loops:
 *  1. processQueue()  — picks up pending content_queue items, generates captions,
 *                       calculates schedule, creates scheduled_posts rows.
 *  2. publishDue()    — fires posts that have reached their scheduled_at time
 *                       via Instagram Graph API + TikTok Content Posting API.
 */

const db = require('./supabase');
const { generateCaptions } = require('./captionWriter');
const { getNextPostTime, formatScheduledTime } = require('./scheduler');
const { scheduleImagePost, scheduleReelPost, publishContainer } = require('./instagramPoster');
const { postPhoto, postVideo } = require('./tiktokPoster');
const notifier = require('./notifier');
const discord = require('./discord');
const openclaw = require('./openclaw');

// ─── QUEUE PROCESSING ────────────────────────────────────────────────────────

/**
 * Pull pending items from content_queue and create scheduled_posts.
 */
async function processQueue() {
  const items = await db.getPendingQueueItems();
  if (items.length === 0) return;

  console.log(`[publisher] Processing ${items.length} queued item(s)`);

  for (const item of items) {
    try {
      await processQueueItem(item);
    } catch (err) {
      console.error(`[publisher] Failed to process queue item ${item.id}:`, err.message);
      await db.updateQueueStatus(item.id, 'failed');
      await discord.captionGenFailed({
        businessName: item.client_id,
        clientId: item.client_id,
        error: err.message,
      });
    }
  }
}

async function processQueueItem(item) {
  console.log(`[publisher] Processing queue item ${item.id} | type: ${item.content_type}`);

  // Load client + trend brief
  const client = await db.getClient(item.client_id);
  const trendBrief = await db.getLatestTrendBrief(item.client_id);

  // Check for pending EDIT instructions for this client
  const signals = await db.getReplySignals(item.client_id);
  const editSignal = signals.find(s => s.raw_caption?.startsWith('EDIT_REQUEST:'));
  const editInstructions = editSignal
    ? editSignal.raw_caption.replace('EDIT_REQUEST:', '').trim()
    : null;

  // Generate captions
  const captions = await generateCaptions({
    client,
    trendBrief,
    rawCaption: item.raw_caption,
    contentType: item.content_type,
    editInstructions,
  });

  // Calculate best post time
  const scheduledAt = await getNextPostTime(client);
  const formattedTime = formatScheduledTime(scheduledAt);

  // Create scheduled_posts row
  const post = await db.createScheduledPost({
    clientId: client.id,
    queueId: item.id,
    instagramCaption: captions.instagramCaption,
    tiktokCaption: captions.tiktokCaption,
    instagramHashtags: captions.instagramHashtags,
    tiktokHashtags: captions.tiktokHashtags,
    scheduledAt,
    trendBriefId: trendBrief?.id ?? null,
  });

  // Mark queue item as scheduled
  await db.updateQueueStatus(item.id, 'scheduled', post.id);

  // Mark trend brief as used
  if (trendBrief) await db.markBriefUsed(trendBrief.id);

  // Mark any edit signal as processed
  if (editSignal) await db.updateQueueStatus(editSignal.id, 'processed');

  // Notify client via WhatsApp
  await notifier.notifyClient(
    client,
    notifier.scheduledMessage(client.business_name, formattedTime, formattedTime)
  );

  // Emit OpenClaw event
  await openclaw.emit('post.scheduled', {
    client_id: client.id,
    post_id: post.id,
    scheduled_at: scheduledAt,
    business_name: client.business_name,
  });

  // Discord log
  await discord.postScheduled({
    businessName: client.business_name,
    clientId: client.id,
    scheduledAt: formattedTime,
    platform: 'Instagram + TikTok',
    postId: post.id,
  });

  console.log(`[publisher] ✅ Scheduled post ${post.id} for ${client.business_name} at ${formattedTime}`);
}

// ─── PUBLISHING DUE POSTS ────────────────────────────────────────────────────

/**
 * Find posts that are due and publish them to Instagram + TikTok.
 */
async function publishDue() {
  const duePosts = await db.getPendingScheduledPosts();
  if (duePosts.length === 0) return;

  console.log(`[publisher] Publishing ${duePosts.length} due post(s)`);

  for (const post of duePosts) {
    try {
      await publishPost(post);
    } catch (err) {
      console.error(`[publisher] Publish failed for post ${post.id}:`, err.message);
      await db.updateScheduledPost(post.id, { status: 'failed' });

      const client = await db.getClient(post.client_id).catch(() => null);
      if (client) {
        await notifier.notifyClient(client, notifier.errorMessage(client.business_name));
        await discord.postFailed({
          businessName: client.business_name,
          clientId: post.client_id,
          platform: 'Instagram + TikTok',
          error: err.message,
        });
      }

      await openclaw.emit('post.failed', {
        post_id: post.id,
        client_id: post.client_id,
        error: err.message,
      });
    }
  }
}

async function publishPost(post) {
  const client = await db.getClient(post.client_id);
  const queueItem = await getQueueItem(post.queue_id);

  // Build full caption strings
  const igCaption = buildCaption(post.instagram_caption, post.instagram_hashtags);
  const ttCaption = buildCaption(post.tiktok_caption, post.tiktok_hashtags, true);

  let igPostId = null;
  let ttPostId = null;

  // ── INSTAGRAM ──
  try {
    const mediaUrl = queueItem?.storage_path
      ? await db.getSignedMediaUrl(queueItem.storage_path)
      : null;

    if (mediaUrl && client.instagram_access_token && client.instagram_account_id) {
     if (queueItem.content_type === 'video' || queueItem.content_type === 'reel') {
        const containerId = await scheduleReelPost({
          accessToken: client.instagram_access_token,
          igUserId: client.instagram_account_id,
          videoUrl: mediaUrl,
          caption: igCaption,
        });
        igPostId = await publishContainer({
          accessToken: client.instagram_access_token,
          igUserId: client.instagram_account_id,
          containerId,
        });
      } else {
        const containerId = await scheduleImagePost({
          accessToken: client.instagram_access_token,
          igUserId: client.instagram_account_id,
          imageUrl: mediaUrl,
          caption: igCaption,
        });
        igPostId = await publishContainer({
          accessToken: client.instagram_access_token,
          igUserId: client.instagram_account_id,
          containerId,
        });
      }

      await discord.postPublished({ businessName: client.business_name, platform: 'Instagram', postId: igPostId });
      await notifier.notifyClient(client, notifier.postedMessage(client.business_name, 'Instagram'));
    }
  } catch (err) {
    console.error(`[publisher] Instagram post failed for ${post.id}:`, err.message);
    await discord.postFailed({ businessName: client.business_name, clientId: client.id, platform: 'Instagram', error: err.message });
  }

  // ── TIKTOK ──
  try {
    const mediaUrl = queueItem?.storage_path
      ? await db.getSignedMediaUrl(queueItem.storage_path)
      : null;

    if (mediaUrl && client.tiktok_access_token && client.tiktok_account_id) {
      if (queueItem.content_type === 'video' || queueItem.content_type === 'reel') {
        ttPostId = await postVideo({
          accessToken: client.tiktok_access_token,
          videoUrl: mediaUrl,
          caption: ttCaption,
        });
      } else {
        ttPostId = await postPhoto({
          accessToken: client.tiktok_access_token,
          imageUrl: mediaUrl,
          caption: ttCaption,
        });
      }

      await discord.postPublished({ businessName: client.business_name, platform: 'TikTok', postId: ttPostId });
      await notifier.notifyClient(client, notifier.postedMessage(client.business_name, 'TikTok'));
    }
  } catch (err) {
    console.error(`[publisher] TikTok post failed for ${post.id}:`, err.message);
    await discord.postFailed({ businessName: client.business_name, clientId: client.id, platform: 'TikTok', error: err.message });
  }

  // Update scheduled_post record
  await db.updateScheduledPost(post.id, {
    status: 'posted',
    posted_at: new Date().toISOString(),
    instagram_post_id: igPostId,
    tiktok_post_id: ttPostId,
  });

  console.log(`[publisher] ✅ Published post ${post.id} | IG: ${igPostId} | TT: ${ttPostId}`);
}

// ─── PREVIEW FLOW ────────────────────────────────────────────────────────────

/**
 * Handle a PREVIEW_REQUESTED signal — send caption preview to client.
 */
async function handlePreviewRequest(clientId) {
  const client = await db.getClient(clientId);

  // Get the most recently scheduled post for this client
  const posts = await db.getScheduledPostsForClient(clientId);
  if (posts.length === 0) {
    await notifier.notifyClient(client, `No posts scheduled yet. Send some content first! 📸`);
    return;
  }

  // Get the full post record
  const { createClient } = require('@supabase/supabase-js');
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  const { data: post } = await supabase
    .from('scheduled_posts')
    .select('*')
    .eq('client_id', clientId)
    .eq('status', 'scheduled')
    .order('scheduled_at', { ascending: true })
    .limit(1)
    .single();

  if (!post) return;

  await notifier.notifyClient(
    client,
    notifier.previewMessage(
      post.instagram_caption,
      post.instagram_hashtags,
      post.tiktok_caption,
      post.tiktok_hashtags
    )
  );

  await openclaw.emit('preview.sent', { client_id: clientId, post_id: post.id });
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function buildCaption(caption, hashtags, inline = false) {
  const tags = (hashtags || []).map(t => `#${t.replace(/^#/, '')}`).join(' ');
  return inline ? `${caption} ${tags}` : `${caption}\n\n${tags}`;
}

async function getQueueItem(queueId) {
  const { createClient } = require('@supabase/supabase-js');
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  const { data } = await supabase
    .from('content_queue')
    .select('*')
    .eq('id', queueId)
    .single();
  return data;
}

module.exports = { processQueue, publishDue, handlePreviewRequest };
