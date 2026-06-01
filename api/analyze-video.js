const GEMINI_KEY       = (process.env.GEMINI_API_KEY          || '').replace(/\s+/g, '');
const SUPA_URL         = 'https://wrtmopfvbiifmzwyrasu.supabase.co';
const SUPA_ANON        = (process.env.SUPABASE_ANON_KEY       || '').replace(/\s+/g, '');
const SUPA_SERVICE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY|| '').replace(/\s+/g, '');
const SERVER_FREE_LIMIT = 3;
const GEMINI_MODEL     = 'gemini-2.5-flash';

async function verifySupabaseToken(token) {
  const res = await fetch(`${SUPA_URL}/auth/v1/user`, {
    headers: { 'Authorization': `Bearer ${token}`, 'apikey': SUPA_ANON }
  });
  if (!res.ok) return null;
  return await res.json();
}

async function hasActiveSubscription(userId, email) {
  const res = await fetch(
    `${SUPA_URL}/rest/v1/subscriptions?or=(user_id.eq.${encodeURIComponent(userId)},email.eq.${encodeURIComponent(email)})&status=eq.active&limit=1`,
    { headers: { 'apikey': SUPA_SERVICE_KEY, 'Authorization': `Bearer ${SUPA_SERVICE_KEY}` } }
  );
  if (!res.ok) return false;
  const data = await res.json();
  return Array.isArray(data) && data.length > 0;
}

async function checkAndIncrementFreeUses(email) {
  const getRes = await fetch(
    `${SUPA_URL}/rest/v1/free_uses?email=eq.${encodeURIComponent(email)}&select=count`,
    { headers: { 'apikey': SUPA_SERVICE_KEY, 'Authorization': `Bearer ${SUPA_SERVICE_KEY}` } }
  );
  const data = await getRes.json();
  const current = Array.isArray(data) && data.length > 0 ? data[0].count : 0;
  if (current >= SERVER_FREE_LIMIT) return false;
  await fetch(`${SUPA_URL}/rest/v1/free_uses?on_conflict=email`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPA_SERVICE_KEY,
      'Authorization': `Bearer ${SUPA_SERVICE_KEY}`,
      'Prefer': 'resolution=merge-duplicates',
    },
    body: JSON.stringify({ email, count: current + 1 }),
  });
  return true;
}

// Poll until Gemini file is ACTIVE (max ~20s)
async function waitForFileActive(fileName) {
  for (let i = 0; i < 10; i++) {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/${fileName}?key=${GEMINI_KEY}`
    );
    if (!res.ok) return false;
    const data = await res.json();
    if (data.state === 'ACTIVE') return true;
    await new Promise(r => setTimeout(r, 2000));
  }
  return false;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  if (!GEMINI_KEY) return res.status(500).json({ error: 'Gemini API key not configured' });

  // ── Auth check (same logic as analyze.js) ─────────────────────────────
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.replace('Bearer ', '').trim();

  if (token) {
    try {
      const user = await verifySupabaseToken(token);
      if (!user || !user.id) return res.status(401).json({ error: 'Invalid session' });
      const subscribed = await hasActiveSubscription(user.id, user.email);
      if (!subscribed) {
        const allowed = await checkAndIncrementFreeUses(user.email);
        if (!allowed) return res.status(402).json({ error: 'No active subscription' });
      }
    } catch (err) {
      return res.status(500).json({ error: 'Auth check failed: ' + err.message });
    }
  }

  const { fileUri, fileName, mimeType, systemPrompt, prompt } = req.body;
  if (!fileUri) return res.status(400).json({ error: 'fileUri is required' });

  try {
    // Wait for Gemini to finish processing the video file
    if (fileName) {
      const active = await waitForFileActive(fileName);
      if (!active) return res.status(504).json({ error: 'Video still processing, try again in a moment' });
    }

    // ── Call Gemini with SSE streaming ────────────────────────────────────
    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:streamGenerateContent?alt=sse&key=${GEMINI_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: systemPrompt || '' }] },
          contents: [{
            role: 'user',
            parts: [
              { file_data: { mime_type: mimeType || 'video/mp4', file_uri: fileUri } },
              { text: prompt }
            ]
          }],
          generationConfig: { maxOutputTokens: 4096 },
        }),
      }
    );

    if (!geminiRes.ok) {
      const err = await geminiRes.text();
      return res.status(502).json({ error: 'Gemini error: ' + err });
    }

    // ── Stream back in Anthropic-compatible SSE format ────────────────────
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');

    const reader  = geminiRes.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop();

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const raw = line.slice(6).trim();
        if (!raw || raw === '[DONE]') continue;
        try {
          const ev   = JSON.parse(raw);
          const text = ev.candidates?.[0]?.content?.parts?.[0]?.text;
          if (text) {
            // Emit in Anthropic SSE format so client code is unchanged
            res.write(`data: ${JSON.stringify({
              type: 'content_block_delta',
              delta: { type: 'text_delta', text }
            })}\n\n`);
          }
        } catch {}
      }
    }

    res.write('data: [DONE]\n\n');
    res.end();

  } catch (err) {
    console.error('analyze-video error:', err);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
};
