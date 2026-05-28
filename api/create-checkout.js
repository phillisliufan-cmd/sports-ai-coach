const STRIPE_KEY = (process.env.STRIPE_SECRET_KEY || '').replace(/\s+/g, '');
const SITE_URL   = 'https://sports-ai-coach.vercel.app';

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!STRIPE_KEY) {
    return res.status(500).json({ error: 'Stripe not configured' });
  }

  const { email, userId } = req.body || {};

  try {
    const stripeRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${STRIPE_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        mode: 'subscription',
        customer_email: email || '',
        'line_items[0][price_data][currency]': 'usd',
        'line_items[0][price_data][product_data][name]': 'Sports AI Coach',
        'line_items[0][price_data][product_data][description]': 'Unlimited AI video analysis for your matches',
        'line_items[0][price_data][recurring][interval]': 'month',
        'line_items[0][price_data][unit_amount]': '2000',
        'line_items[0][quantity]': '1',
        'metadata[user_id]': userId || '',
        allow_promotion_codes: 'true',
        success_url: `${SITE_URL}?sub=ok&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${SITE_URL}`,
      }).toString(),
    });

    const data = await stripeRes.json();
    if (!stripeRes.ok) {
      return res.status(400).json({ error: data.error?.message || 'Stripe error' });
    }

    return res.status(200).json({ url: data.url });
  } catch (err) {
    console.error('create-checkout error:', err);
    return res.status(500).json({ error: err.message });
  }
};
