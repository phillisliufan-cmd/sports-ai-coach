const STRIPE_KEY       = (process.env.STRIPE_SECRET_KEY || '').replace(/\s+/g, '');
const SUPA_URL         = 'https://wrtmopfvbiifmzwyrasu.supabase.co';
const SUPA_ANON        = (process.env.SUPABASE_ANON_KEY        || '').replace(/\s+/g, '');
const SUPA_SERVICE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').replace(/\s+/g, '');
const SITE_URL         = 'https://aceriq.ai';

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.replace('Bearer ', '').trim();
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  // Verify user
  const userRes = await fetch(`${SUPA_URL}/auth/v1/user`, {
    headers: { 'Authorization': `Bearer ${token}`, 'apikey': SUPA_ANON }
  });
  if (!userRes.ok) return res.status(401).json({ error: 'Invalid session' });
  const user = await userRes.json();

  // Get stripe_customer_id from subscriptions table
  const subRes = await fetch(
    `${SUPA_URL}/rest/v1/subscriptions?or=(user_id.eq.${encodeURIComponent(user.id)},email.eq.${encodeURIComponent(user.email)})&status=eq.active&limit=1&select=stripe_customer_id`,
    { headers: { 'apikey': SUPA_SERVICE_KEY, 'Authorization': `Bearer ${SUPA_SERVICE_KEY}` } }
  );
  const subs = await subRes.json();
  let customerId = Array.isArray(subs) && subs.length > 0 ? subs[0].stripe_customer_id : null;

  // Fallback: look up customer in Stripe by email if not in DB
  if (!customerId && user.email) {
    const searchRes = await fetch(
      `https://api.stripe.com/v1/customers?email=${encodeURIComponent(user.email)}&limit=1`,
      { headers: { 'Authorization': `Bearer ${STRIPE_KEY}` } }
    );
    if (searchRes.ok) {
      const searchData = await searchRes.json();
      if (searchData.data && searchData.data.length > 0) {
        customerId = searchData.data[0].id;
      }
    }
  }

  if (!customerId) {
    return res.status(400).json({ error: 'No active subscription found' });
  }

  // Create Stripe Customer Portal session
  const portalRes = await fetch('https://api.stripe.com/v1/billing_portal/sessions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${STRIPE_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      customer: customerId,
      return_url: SITE_URL,
    }).toString(),
  });

  const portalData = await portalRes.json();
  if (!portalRes.ok) {
    return res.status(400).json({ error: portalData.error?.message || 'Failed to create portal session' });
  }

  return res.status(200).json({ url: portalData.url });
};
