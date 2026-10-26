// طلب إنشاء حساب جديد — بيتعمل من السيرفر بمفتاح service_role
// عشان Supabase مايحاولش يبعت إيميل تأكيد لعنوان @mo2ysaat.app (ده اللي كان بيوقّع الطلب).
// الحساب بيتعمل "غير مؤكَّد"، ومايقدرش يدخل غير لما المسؤول يوافق من "طلبات إنشاء الحساب".
const URL_ = 'https://qadrtqtydtgzachfzpqw.supabase.co';
const DOM = '@mo2ysaat.app';
const UN_RE = /^[a-z0-9._-]{3,30}$/;

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method' });
  const SRK = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SRK) return res.status(503).json({ error: 'not_configured' });

  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = {}; } }
  b = b || {};
  const u = String(b.username || '').trim().toLowerCase();
  const p = String(b.password || '');
  if (!UN_RE.test(u)) return res.status(400).json({ error: 'bad_username' });
  if (p.length < 8 || p.length > 72) return res.status(400).json({ error: 'bad_password' });

  const H = { apikey: SRK, Authorization: 'Bearer ' + SRK, 'Content-Type': 'application/json' };
  try {
    const r = await fetch(URL_ + '/auth/v1/admin/users', {
      method: 'POST',
      headers: H,
      body: JSON.stringify({
        email: u + DOM,
        password: p,
        email_confirm: false,
        user_metadata: { signup_request: 'true' },
      }),
    });
    const txt = await r.text();
    if (!r.ok) {
      if (/already|registered|exists/i.test(txt)) return res.status(409).json({ error: 'exists' });
      return res.status(502).json({ error: 'auth', status: r.status, detail: txt.slice(0, 300) });
    }
    // الـ trigger بيسجّل الطلب تلقائيًا؛ ده احتياطي لو الـ trigger مش شغال
    let id = null;
    try { const j = JSON.parse(txt); id = j.id || (j.user && j.user.id); } catch (e) {}
    if (id) {
      try {
        await fetch(URL_ + '/rest/v1/signup_requests?on_conflict=user_id', {
          method: 'POST',
          headers: { ...H, Prefer: 'resolution=ignore-duplicates,return=minimal' },
          body: JSON.stringify({ user_id: id, username: u }),
        });
      } catch (e) {}
    }
    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: 'server' });
  }
};
