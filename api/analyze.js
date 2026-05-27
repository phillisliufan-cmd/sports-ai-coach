export const config = { runtime: 'edge' };

const SUPA_URL         = 'https://wrtmopfvbiifmzwyrasu.supabase.co';
const SUPA_ANON        = process.env.SUPABASE_ANON_KEY;
const SUPA_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANTHROPIC_KEY    = process.env.ANTHROPIC_API_KEY;

async function verifySupabaseToken(token) {
  const res = await fetch(`${SUPA_URL}/auth/v1/user`, {
    headers: { 'Authorization': `Bearer ${token}`, 'apikey': SUPA_ANON }
  });
  if (!res.ok) return null;
  return await res.json();
}

async function hasActiveSubscription(userId, email) {
  // Check by user_id first, then by email as fallback
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

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  const authHeader = req.headers.get('authorization') || '';
  const token = authHeader.replace('Bearer ', '').trim();

  if (token) {
    // Authenticated user — must have active subscription
    const user = await verifySupabaseToken(token);
    if (!user || !user.id) {
      return new Response(JSON.stringify({ error: 'Invalid session' }), {
        status: 401, headers: { 'Content-Type': 'application/json' }
      });
    }
    const subscribed = await hasActiveSubscription(user.id, user.email);
    if (!subscribed) {
      return new Response(JSON.stringify({ error: 'No active subscription' }), {
        status: 402, headers: { 'Content-Type': 'application/json' }
      });
    }
  }
  // No token = free tier (client enforces 3-use limit)

  if (!ANTHROPIC_KEY) {
    return new Response(JSON.stringify({ error: 'API key not configured' }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    });
  }

  let body;
  try { body = await req.json(); }
  catch {
    return new Response(JSON.stringify({ error: 'Invalid request body' }), {
      status: 400, headers: { 'Content-Type': 'application/json' }
    });
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  return new Response(response.body, {
    status: response.status,
    headers: {
      'Content-Type': response.headers.get('content-type') || 'text/event-stream',
      'Cache-Control': 'no-cache',
    },
  });
}
