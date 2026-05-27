export const config = { runtime: 'edge' };

const SUPA_URL         = 'https://wrtmopfvbiifmzwyrasu.supabase.co';
const SUPA_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const WEBHOOK_SECRET   = process.env.STRIPE_WEBHOOK_SECRET;

async function verifySignature(body, sigHeader, secret) {
  const parts = sigHeader.split(',');
  const ts    = (parts.find(p => p.startsWith('t=')) || '').slice(2);
  const sigs  = parts.filter(p => p.startsWith('v1=')).map(p => p.slice(3));
  const enc   = new TextEncoder();
  const key   = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac   = await crypto.subtle.sign('HMAC', key, enc.encode(`${ts}.${body}`));
  const hex   = Array.from(new Uint8Array(mac)).map(b => b.toString(16).padStart(2, '0')).join('');
  return sigs.some(s => s === hex);
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

export default async function handler(req) {
  const sig  = req.headers.get('stripe-signature');
  const body = await req.text();

  if (!WEBHOOK_SECRET)
    return new Response('Webhook secret not configured', { status: 500 });

  if (!sig || !await verifySignature(body, sig, WEBHOOK_SECRET))
    return new Response('Invalid signature', { status: 400 });

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
    const sub = event.data.object;
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

  return new Response('OK', { status: 200 });
}
