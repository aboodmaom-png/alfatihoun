// المبلغ المجموع: قراءة (GET) وتحديث من صفحة الإدارة (POST مع الرمز)
// المبلغ يُخزَّن بالريال (تكلفة الحفل 7,000 ريال)، والصفحة العامة تعرضه بالشيكل حسب سعر الصرف
// يحتاج على Vercel: قاعدة Upstash Redis مربوطة بالمشروع + متغير ADMIN_PIN

const GOAL_SAR = 7000;
const KEY = 'fatihoun:raised';
const RATE_KEY = 'fatihoun:rate';
const RATE_FALLBACK = 0.83;            // شيكل لكل ريال، يُستخدم فقط إذا تعذّر جلب السعر
const RATE_MAX_AGE = 12 * 60 * 60e3;   // تحديث السعر كل 12 ساعة

const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

async function redis(path) {
  const r = await fetch(URL_ + path, { headers: { Authorization: 'Bearer ' + TOKEN } });
  if (!r.ok) throw new Error('redis ' + r.status);
  return r.json();
}

// ILS per SAR, cached in Redis; on any failure use the last saved value
async function getRate() {
  let saved = null;
  try { const { result } = await redis('/get/' + RATE_KEY); saved = result ? JSON.parse(result) : null; } catch (e) {}
  if (saved && Date.now() - saved.ts < RATE_MAX_AGE) return saved;
  try {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 2500);
    const r = await fetch('https://open.er-api.com/v6/latest/SAR', { signal: ctl.signal });
    clearTimeout(t);
    const d = await r.json();
    const rate = d && d.rates && Number(d.rates.ILS);
    if (rate > 0) {
      const fresh = { rate, ts: Date.now() };
      await redis('/set/' + RATE_KEY + '/' + encodeURIComponent(JSON.stringify(fresh)));
      return fresh;
    }
  } catch (e) {}
  return saved || { rate: RATE_FALLBACK, ts: 0 };
}

async function payload(raisedSar) {
  const { rate, ts } = await getRate();
  return { goalSar: GOAL_SAR, raisedSar, rate, rateUpdated: ts,
           // للتوافق مع النسخ القديمة من الصفحات
           goal: GOAL_SAR, raised: raisedSar };
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');

  if (!URL_ || !TOKEN) {
    return res.status(500).json({ error: 'storage-not-connected' });
  }

  try {
    if (req.method === 'GET') {
      const { result } = await redis('/get/' + KEY);
      return res.status(200).json(await payload(Number(result) || 0));
    }

    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
      if (!process.env.ADMIN_PIN || String(body.pin || '') !== String(process.env.ADMIN_PIN)) {
        await new Promise(r => setTimeout(r, 800));
        return res.status(401).json({ error: 'wrong-pin' });
      }
      const raisedSar = Math.round(Number(body.raisedSar ?? body.raised));
      if (!Number.isFinite(raisedSar) || raisedSar < 0 || raisedSar > 1000000) {
        return res.status(400).json({ error: 'bad-amount' });
      }
      await redis('/set/' + KEY + '/' + raisedSar);
      return res.status(200).json(await payload(raisedSar));
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'method' });
  } catch (e) {
    return res.status(500).json({ error: 'server' });
  }
};
