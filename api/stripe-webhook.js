const SUPA_URL         = 'https://wrtmopfvbiifmzwyrasu.supabase.co';
const SUPA_SERVICE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const WEBHOOK_SECRET   = (process.env.STRIPE_WEBHOOK_SECRET || '').trim();

function getRawBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

async function verifySignature(body, sigHeader, secret) {
  const { createHmac } = require('crypto');
  const parts = sigHeader.split(',');
  const ts    = (parts.find(p => p.startsWith('t=')) || '').slice(2);
  const sigs  = parts.filter(p => p.startsWith('v1=')).map(p => p.slice(3));
  const mac   = createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex');
  return sigs.some(s => s === mac);
}

async function upsertSubscription(data) {
  return fetch(`${SUPA_URL}/rest/v1/subscriptions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPA_SERVICE_KEY,
      'Authorization': `Bearer ${SUPA_SERVICE_KEY}`,
      'Prefer': 'resolution=merge-duplicates',
    },
    body: JSON.stringify(data),
  });
}

module.exports = async function handler(req, res) {
  try {
    if (!WEBHOOK_SECRET) {
      return res.status(500).send('Webhook secret not configured');
    }

    const sig  = req.headers['stripe-signature'];
    const body = await getRawBody(req);

    if (!sig || !await verifySignature(body, sig, WEBHOOK_SECRET)) {
      return res.status(400).send('Invalid signature');
    }

    const event = JSON.parse(body);

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      await upsertSubscription({
        user_id:                session.metadata?.user_id || session.customer_email,
        email:                  session.customer_email,
        stripe_customer_id:     session.customer,
        stripe_subscription_id: session.subscription,
        status:                 'active',
      });
    }

    if (event.type === 'customer.subscription.deleted' || event.type === 'customer.subscription.updated') {
      const sub    = event.data.object;
      const status = sub.status === 'active' ? 'active' : 'cancelled';
      await fetch(`${SUPA_URL}/rest/v1/subscriptions?stripe_subscription_id=eq.${sub.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPA_SERVICE_KEY,
          'Authorization': `Bearer ${SUPA_SERVICE_KEY}`,
        },
        body: JSON.stringify({ status }),
      });
    }

    return res.status(200).send('OK');
  } catch (err) {
    console.error('stripe-webhook error:', err);
    return res.status(500).json({ error: err.message });
  }
};
