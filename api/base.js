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
    const file = path.join(process.cwd(), 'api', '_data', 'base.json');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'private, no-store');
    const bats = (rows[0] && Array.isArray(rows[0].battalions)) ? rows[0].battalions.map(String) : [];
    if (!bats.length) return res.status(200).send(fs.readFileSync(file));
    // حساب كتيبة: بيستلم مقايسات كتيبته بس (السيرفر هو اللي بيفلتر، مش الشاشة)
    const all = JSON.parse(fs.readFileSync(file, 'utf8'));
    const mine = all.filter(r => (String(r[3] || '').match(/\d+/g) || []).some(n => bats.includes(n)));
    return res.status(200).send(JSON.stringify(mine));
  } catch (e) {
    return res.status(500).json({ error: 'server' });
  }
};
