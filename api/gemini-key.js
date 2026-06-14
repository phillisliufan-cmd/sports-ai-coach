// Returns Gemini API key to authenticated users so they can upload directly
// to Gemini from the browser, bypassing Vercel's 4MB body limit.
const GEMINI_KEY = (process.env.GEMINI_API_KEY    || '').replace(/\s+/g, '');
const SUPA_URL   = 'https://wrtmopfvbiifmzwyrasu.supabase.co';
const SUPA_ANON  = (process.env.SUPABASE_ANON_KEY || '').replace(/\s+/g, '');

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();
  if (!GEMINI_KEY) return res.status(500).json({ error: 'Not configured' });

  const token = (req.headers['authorization'] || '').replace('Bearer ', '').trim();
  if (!token) return res.status(401).json({ error: 'Auth required' });

  const r = await fetch(`${SUPA_URL}/auth/v1/user`, {
    headers: { 'Authorization': `Bearer ${token}`, 'apikey': SUPA_ANON }
  });
  if (!r.ok) return res.status(401).json({ error: 'Invalid session' });

  res.json({ key: GEMINI_KEY });
}
