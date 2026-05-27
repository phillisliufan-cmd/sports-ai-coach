export const config = { runtime: 'edge' };

const STRIPE_KEY = (process.env.STRIPE_SECRET_KEY || '').trim();
const SITE_URL   = 'https://sports-ai-coach.vercel.app';

export default async function handler(req) {
  if (req.method !== 'POST')
    return new Response('Method not allowed', { status: 405 });

  let email, userId;
  try { ({ email, userId } = await req.json()); }
  catch { return new Response(JSON.stringify({ error: 'Invalid body' }), { status: 400 }); }

  if (!STRIPE_KEY)
    return new Response(JSON.stringify({ error: 'Stripe not configured' }), { status: 500 });

  const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${STRIPE_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      mode: 'subscription',
      customer_email: email,
      'line_items[0][price_data][currency]': 'usd',
      'line_items[0][price_data][product_data][name]': 'Sports AI Coach',
      'line_items[0][price_data][product_data][description]': 'Unlimited AI video analysis for your matches',
      'line_items[0][price_data][recurring][interval]': 'month',
      'line_items[0][price_data][unit_amount]': '2000',
      'line_items[0][quantity]': '1',
      'metadata[user_id]': userId || '',
      success_url: `${SITE_URL}?sub=ok&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${SITE_URL}`,
    }).toString(),
  });

  const data = await res.json();
  if (!res.ok)
    return new Response(JSON.stringify({ error: data.error?.message || 'Stripe error' }), {
      status: 400, headers: { 'Content-Type': 'application/json' }
    });

  return new Response(JSON.stringify({ url: data.url }), {
    headers: { 'Content-Type': 'application/json' }
  });
}
