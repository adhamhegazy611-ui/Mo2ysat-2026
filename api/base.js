const fs = require('fs');
const path = require('path');
const URL_ = 'https://qadrtqtydtgzachfzpqw.supabase.co';
const KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFhZHJ0cXR5ZHRnemFjaGZ6cHF3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI1MTI5MTksImV4cCI6MjEwODA4ODkxOX0.zngPkaxJKin9rmzABnDfmkU8-OkXAAGZ8zTwae4-fkw';

module.exports = async (req, res) => {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'unauthorized' });
  try {
    // the app_users row is only visible to its owner (RLS), so this checks both a valid login and an active account
    const r = await fetch(URL_ + '/rest/v1/app_users?select=role,battalions', {
      headers: { apikey: KEY, Authorization: 'Bearer ' + token },
    });
    const rows = r.ok ? await r.json() : [];
    if (!Array.isArray(rows) || rows.length === 0) return res.status(403).json({ error: 'forbidden' });
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'private, no-store');
    // البيانات الأساسية بقت في قاعدة البيانات (بتتحدث كل يوم من شيت Drive)، والملف احتياطي لو لسه ماتحدثتش
    let all = null;
    const SRK = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (SRK) {
      try {
        const q = await fetch(URL_ + '/rest/v1/mq_base?select=rows&id=eq.1', { headers: { apikey: SRK, Authorization: 'Bearer ' + SRK } });
        const j = q.ok ? await q.json() : [];
        if (Array.isArray(j) && j[0] && Array.isArray(j[0].rows)) all = j[0].rows;
      } catch (e) { /* fallback */ }
    }
    if (!all) all = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'api', '_data', 'base.json'), 'utf8'));
    const bats = (rows[0] && Array.isArray(rows[0].battalions)) ? rows[0].battalions.map(String) : [];
    if (!bats.length) return res.status(200).send(JSON.stringify(all));
    // حساب كتيبة: بيستلم مقايسات كتيبته بس (السيرفر هو اللي بيفلتر، مش الشاشة)
    const mine = all.filter(r => (String(r[3] || '').match(/\d+/g) || []).some(n => bats.includes(n)));
    return res.status(200).send(JSON.stringify(mine));
  } catch (e) {
    return res.status(500).json({ error: 'server' });
  }
};
