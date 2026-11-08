// /api/sync — التحديث من Google Drive
// كل يوم أوتوماتيك (Vercel Cron)، أو من زرار «حدّث من Drive» للمدير في الموازنات والمقايسات.
// ?site=mz (الموازنات) | mq (المقايسات) | all — ?dry=1 بيوري اللي هيتغير من غير ما يحفظ
const { sb, runMz, runMq, log } = require('./_lib/sync');
const URL_ = 'https://qadrtqtydtgzachfzpqw.supabase.co';

async function isAdmin(token) {
  const k = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const r = await fetch(URL_ + '/auth/v1/user', { headers: { apikey: k, Authorization: 'Bearer ' + token } });
  if (!r.ok) return false;
  const u = await r.json(); if (!u || !u.id) return false;
  const [a, m] = await Promise.all([
    sb('/rest/v1/app_users?select=role&user_id=eq.' + u.id),
    sb('/rest/v1/mz_members?select=role&user_id=eq.' + u.id),
  ]);
  return (a[0] && a[0].role === 'admin') || (m[0] && m[0].role === 'admin');
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return res.status(503).json({ error: 'not_configured' });

  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  let trigger;
  const q = req.query || {};
  if (process.env.CRON_SECRET && token === process.env.CRON_SECRET) trigger = 'cron';
  else if (process.env.CRON_SECRET && q.key === process.env.CRON_SECRET) trigger = 'key';
  else if (token && (await isAdmin(token).catch(() => false))) trigger = 'manual';
  else return res.status(401).json({ error: 'unauthorized' });

  const site = trigger === 'cron' ? 'all' : String(q.site || 'all');
  const dry = q.dry === '1';
  const jobs = [];
  if (site === 'all' || site === 'mz') jobs.push(['mz', process.env.SHEET_MZ, runMz]);
  if (site === 'all' || site === 'mq') jobs.push(['mq', process.env.SHEET_MQ, runMq]);
  const out = {};
  for (const [s, link, fn] of jobs) {
    try {
      const r = await fn(link, dry);
      out[s] = { ok: true, ...r };
      if (!dry) await log(s, true, trigger, r.summary, r.stats);
    } catch (e) {
      out[s] = { ok: false, error: e.message };
      if (!dry) await log(s, false, trigger, e.message, null);
    }
  }
  return res.status(200).json({ dry, trigger, ...out });
};
