const SUPA_URL         = 'https://wrtmopfvbiifmzwyrasu.supabase.co';
const SUPA_ANON        = (process.env.SUPABASE_ANON_KEY        || '').replace(/\s+/g, '');
const SUPA_SERVICE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').replace(/\s+/g, '');
const ANTHROPIC_KEY    = (process.env.ANTHROPIC_API_KEY         || '').replace(/\s+/g, '');

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
    {
      headers: {
        'apikey': SUPA_SERVICE_KEY,
        'Authorization': `Bearer ${SUPA_SERVICE_KEY}`,
      }
    }
  );
  if (!res.ok) return false;
  const data = await res.json();
  return Array.isArray(data) && data.length > 0;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.replace('Bearer ', '').trim();

  if (token) {
    try {
      const user = await verifySupabaseToken(token);
      if (!user || !user.id) {
        return res.status(401).json({ error: 'Invalid session' });
      }
      const subscribed = await hasActiveSubscription(user.id, user.email);
      if (!subscribed) {
        return res.status(402).json({ error: 'No active subscription' });
      }
    } catch (err) {
      return res.status(500).json({ error: 'Auth check failed: ' + err.message });
    }
  }
  // No token = free tier (client enforces 3-use limit)

  if (!ANTHROPIC_KEY) {
    return res.status(500).json({ error: 'API key not configured' });
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify(req.body),
    });

    res.status(response.status);
    res.setHeader('Content-Type', response.headers.get('content-type') || 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');

    // Stream Anthropic response to client
    const reader = response.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
    }
    res.end();
  } catch (err) {
    console.error('analyze error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    }
  }
};
