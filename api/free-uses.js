const SUPA_URL         = 'https://wrtmopfvbiifmzwyrasu.supabase.co';
const SUPA_ANON        = (process.env.SUPABASE_ANON_KEY        || '').replace(/\s+/g, '');
const SUPA_SERVICE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').replace(/\s+/g, '');
const SERVER_FREE_LIMIT = 3;

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.replace('Bearer ', '').trim();
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  // Verify token and get email
  const userRes = await fetch(`${SUPA_URL}/auth/v1/user`, {
    headers: { 'Authorization': `Bearer ${token}`, 'apikey': SUPA_ANON }
  });
  if (!userRes.ok) return res.status(401).json({ error: 'Invalid session' });
  const user = await userRes.json();

  // Get free_uses count
  const getRes = await fetch(
    `${SUPA_URL}/rest/v1/free_uses?email=eq.${encodeURIComponent(user.email)}&select=count`,
    { headers: { 'apikey': SUPA_SERVICE_KEY, 'Authorization': `Bearer ${SUPA_SERVICE_KEY}` } }
  );
  const data = await getRes.json();
  const used = Array.isArray(data) && data.length > 0 ? data[0].count : 0;
  const remaining = Math.max(0, SERVER_FREE_LIMIT - used);

  return res.status(200).json({ used, remaining, limit: SERVER_FREE_LIMIT });
};
