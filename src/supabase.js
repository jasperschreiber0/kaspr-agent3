const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function getPendingQueueItems() {
  const { data, error } = await supabase
    .from('content_queue')
    .select('*')
    .eq('status', 'pending')
    .neq('content_type', 'reply_signal')
    .order('received_at', { ascending: true })
    .limit(10);

  if (error) throw new Error('getPendingQueueItems: ' + error.message);
  return data ?? [];
}

async function getReplySignals(clientId) {
  const { data, error } = await supabase
    .from('content_queue')
    .select('*')
    .eq('client_id', clientId)
    .eq('content_type', 'reply_signal')
    .eq('status', 'pending')
    .order('received_at', { ascending: true })
    .limit(5);

  if (error) throw new Error('getReplySignals: ' + error.message);
  return data ?? [];
}

async function getContentQueueItem(id) {
  const { data, error } = await supabase
    .from('content_queue')
    .select('*')
    .eq('id', id)
    .single();

  if (error) throw new Error('getContentQueueItem: ' + error.message);
  return data;
}

async function updateQueueStatus(id, status, postId = null) {
  const update = { status, processed_at: new Date().toISOString() };
  if (postId) update.post_id = postId;

  const { error } = await supabase
    .from('content_queue')
    .update(update)
    .eq('id', id);

  if (error) throw new Error('updateQueueStatus: ' + error.message);
}

async function getClient(clientId) {
  const { data, error } = await supabase
    .from('clients')
    .select('*')
    .eq('id', clientId)
    .eq('active', true)
    .single();

  if (error) throw new Error('getClient: ' + error.message);
  return data;
}

async function getLatestTrendBrief(clientId) {
  const { data, error } = await supabase
    .from('trend_briefs')
    .select('*')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (error && error.code !== 'PGRST116') {
    throw new Error('getLatestTrendBrief: ' + error.message);
  }
  return data ?? null;
}

async function markBriefUsed(briefId) {
  const { error } = await supabase
    .from('trend_briefs')
    .update({ used_at: new Date().toISOString() })
    .eq('id', briefId);

  if (error) console.warn('[supabase] markBriefUsed failed: ' + error.message);
}

async function createScheduledPost({
  clientId, queueId, instagramCaption, tiktokCaption,
  instagramHashtags, tiktokHashtags, scheduledAt, trendBriefId,
}) {
  const { data, error } = await supabase
    .from('scheduled_posts')
    .insert({
      client_id: clientId,
      queue_id: queueId,
      instagram_caption: instagramCaption,
      tiktok_caption: tiktokCaption,
      instagram_hashtags: instagramHashtags,
      tiktok_hashtags: tiktokHashtags,
      scheduled_at: scheduledAt,
      status: 'scheduled',
      trend_brief_id: trendBriefId ?? null,
    })
    .select()
    .single();

  if (error) throw new Error('createScheduledPost: ' + error.message);
  return data;
}

async function updateScheduledPost(id, updates) {
  const { error } = await supabase
    .from('scheduled_posts')
    .update(updates)
    .eq('id', id);

  if (error) throw new Error('updateScheduledPost: ' + error.message);
}

async function getScheduledPostsForClient(clientId) {
  const { data, error } = await supabase
    .from('scheduled_posts')
    .select('scheduled_at')
    .eq('client_id', clientId)
    .eq('status', 'scheduled')
    .gte('scheduled_at', new Date().toISOString())
    .order('scheduled_at', { ascending: true });

  if (error) throw new Error('getScheduledPostsForClient: ' + error.message);
  return data ?? [];
}

async function getNextScheduledPost(clientId) {
  const { data, error } = await supabase
    .from('scheduled_posts')
    .select('*')
    .eq('client_id', clientId)
    .eq('status', 'scheduled')
    .order('scheduled_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error('getNextScheduledPost: ' + error.message);
  return data;
}

async function getPendingScheduledPosts() {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('scheduled_posts')
    .select('*')
    .eq('status', 'scheduled')
    .lte('scheduled_at', now)
    .order('scheduled_at', { ascending: true })
    .limit(5);

  if (error) throw new Error('getPendingScheduledPosts: ' + error.message);
  return data ?? [];
}

async function getSignedMediaUrl(storagePath, expiresIn = 3600) {
  const { data, error } = await supabase.storage
    .from('processed-content')
    .createSignedUrl(storagePath, expiresIn);

  if (error) throw new Error('getSignedMediaUrl: ' + error.message);
  return data.signedUrl;
}

module.exports = {
  getPendingQueueItems,
  getReplySignals,
  getContentQueueItem,
  updateQueueStatus,
  getClient,
  getLatestTrendBrief,
  markBriefUsed,
  createScheduledPost,
  updateScheduledPost,
  getScheduledPostsForClient,
  getNextScheduledPost,
  getPendingScheduledPosts,
  getSignedMediaUrl,
};
