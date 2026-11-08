// التحديث اليومي من Google Drive: شيت «موقف المشاريع» → الموازنات، وشيت «متابعة المقايسات» → المقايسات
// القاعدة في الاتنين: الخانة الفاضية في الشيت مش بتمسح حاجة، ومفيش حاجة بتتحذف من الموقع.
const fs = require('fs');
const path = require('path');
const { readXlsx, xlDate } = require('./xlsx');

const URL_ = 'https://qadrtqtydtgzachfzpqw.supabase.co';
const SRK = () => process.env.SUPABASE_SERVICE_ROLE_KEY;

async function sb(p, opt = {}) {
  const k = SRK();
  const r = await fetch(URL_ + p, {
    ...opt,
    headers: { apikey: k, Authorization: 'Bearer ' + k, 'Content-Type': 'application/json', ...(opt.headers || {}) },
  });
  const t = await r.text();
  if (!r.ok) throw new Error('supabase ' + r.status + ': ' + t.slice(0, 200));
  return t ? JSON.parse(t) : null;
}

// الـ id من لينك Drive أو Sheets
const driveId = (s) => { const m = /\/d\/([\w-]{20,})/.exec(s || '') || /[?&]id=([\w-]{20,})/.exec(s || ''); return m ? m[1] : (s || '').trim(); };
async function download(link) {
  const id = driveId(link);
  if (!id) throw new Error('لينك الشيت مش متسجل');
  const r = await fetch('https://drive.google.com/uc?export=download&id=' + id, { redirect: 'follow' });
  if (!r.ok) throw new Error('Drive رجّع ' + r.status + ' — اتأكد إن الملف متشارك «Anyone with the link»');
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.readUInt32LE(0) !== 0x04034b50) throw new Error('Drive مارجّعش ملف Excel — اتأكد إن الملف متشارك «Anyone with the link»');
  return buf;
}

// توحيد الكتابة للمقارنة: أ/إ/آ، ى/ي، ة/ه، الأرقام، المسافات
const norm = (s) => String(s == null ? '' : s)
  .replace(/[ً-ٟـ]/g, '').replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
  .replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[^\p{L}\p{N}]+/gu, ' ').trim().toLowerCase();

/* ======================= الموازنات ======================= */
const MZ_COLS = ['name', 'sector', 'stopped_count', 'delivered_count', 'battalion', 'reviewer', 'pricing_by', 'contracts_reviewer',
  'self_reviewer', 'date_drawings', 'date_pricing', 'date_contracts', 'date_self', 'st_drawings', 'st_budget', 'st_self',
  'st_contracts', 'blocked_on', 'action_taken', 'total_incl', 'total_excl', 'budget_status', 'file_path', 'notes']; // B..Y
const COLORS = { FF92D050: 'green', FFFFC000: 'orange', FFFFFF00: 'yellow', FF00B050: 'darkgreen', FFFF0000: 'red' };

function mzClean(v, key) {
  if (v == null) return null;
  if (typeof v === 'string') { v = v.replace(/\r\n?/g, '\n').trim().replace(/^"+|"+$/g, '').trim(); if (v === '') return null; }
  if (key === 'stopped_count' || key === 'delivered_count') return typeof v === 'number' ? Math.trunc(v) : null;
  if (key === 'total_incl' || key === 'total_excl') return typeof v === 'number' ? Math.round(v * 1e4) / 1e4 : null;
  if (key.startsWith('date_')) return xlDate(v);
  if (key.startsWith('st_')) return v === '✓' || v === '✗' ? v : null;
  return String(v);
}

function parseMz(wb) {
  const ws = wb.sheets.find((s) => s.name.trim() === 'موقف المشاريع (2)') || wb.sheets.find((s) => /موقف المشاريع/.test(s.name));
  if (!ws) throw new Error('مش لاقي شيت «موقف المشاريع» جوه الملف');
  const hdr = (c) => String((ws.get(2, c) || {}).v || '').trim();
  if (!/بيان الاعمال/.test(hdr(2)) || !/الكتيبة/.test(hdr(6)) || !/مكان المشروع/.test(hdr(24))) throw new Error('شكل الشيت اتغير (عناوين الأعمدة مش في مكانها) — مفيش حاجة اتحدثت');
  const top = new Map();
  for (const [r1, c1, r2, c2] of ws.merges) for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) top.set(r * 20000 + c, [r1, c1]);
  const tl = (r, c) => top.get(r * 20000 + c) || [r, c];
  const val = (r, c) => { const [rr, cc] = tl(r, c); if (cc !== c) return null; const x = ws.get(rr, cc); return x ? x.v : null; };
  let TOT = 0;
  for (let r = 3; r <= ws.rows; r++) if (/^الاجم/.test(String(val(r, 1) || '').trim())) { TOT = r; break; }
  if (!TOT) TOT = ws.rows + 1;
  const ROWS = [];
  for (let r = 3; r < TOT; r++) ROWS.push(r);
  for (let r = TOT + 1; r <= ws.rows; r++) if (val(r, 2) != null) ROWS.push(r);
  const out = [];
  for (const r of ROWS) {
    const b = (ws.get(r, 2) || {}).v, c = (ws.get(r, 3) || {}).v;
    if (b == null && c == null && top.has(r * 20000 + 2) && tl(r, 2)[0] !== r) continue;
    const rec = {}, colors = {};
    MZ_COLS.forEach((key, i) => {
      const ci = i + 2, cv = mzClean(val(r, ci), key);
      rec[key] = cv;
      const [rr, cc] = tl(r, ci), f = (ws.get(rr, cc) || {}).fill, col = f && COLORS[f];
      if (col && cv != null) colors[key] = col;
    });
    if (rec.name == null) continue;
    rec.colors = colors; rec.sort_order = out.length + 1;
    out.push(rec);
  }
  if (out.length < 20) throw new Error('الشيت فيه ' + out.length + ' مشروع بس — شكله ناقص، مفيش حاجة اتحدثت');
  return out;
}

const same = (a, b) => {
  if (a == null || b == null) return a == b;
  if (typeof a === 'number' || typeof b === 'number') return Math.abs(Number(a) - Number(b)) < 1e-6;
  return String(a).trim() === String(b).trim();
};

function planMz(recs, db) {
  const key = (x) => norm(x.name) + '|' + norm(x.sector);
  const byKey = new Map(), byName = new Map();
  db.forEach((d) => { (byKey.get(key(d)) || byKey.set(key(d), []).get(key(d))).push(d); (byName.get(norm(d.name)) || byName.set(norm(d.name), []).get(norm(d.name))).push(d); });
  const used = new Set(), match = new Array(recs.length).fill(null);
  const take = (list) => { const d = (list || []).find((x) => !used.has(x.id)); if (d) used.add(d.id); return d || null; };
  recs.forEach((r, i) => { match[i] = take(byKey.get(key(r))); });
  recs.forEach((r, i) => { if (!match[i]) match[i] = take(byName.get(norm(r.name))); });
  // اسم اتعدّل في الشيت: نفس الترتيب ومشروع الموقع ده ملوش مقابل
  recs.forEach((r, i) => { if (!match[i]) match[i] = take(db.filter((d) => d.sort_order === r.sort_order)); });
  const updates = [], inserts = [];
  recs.forEach((r, i) => {
    const d = match[i];
    if (!d) { inserts.push(r); return; }
    const patch = {};
    for (const k of [...MZ_COLS, 'sort_order']) {
      const v = r[k]; if (v == null) continue;                       // فاضي في الشيت → سيبه زي ما هو
      if (k === 'file_path' && /^https?:\/\//i.test(String(d.file_path || ''))) continue; // لينك Drive متحطوط في الموقع
      if (!same(v, d[k])) patch[k] = v;
    }
    const col = { ...(d.colors || {}), ...r.colors };
    const sk = (o) => JSON.stringify(Object.keys(o).sort().map((k) => [k, o[k]]));
    if (sk(col) !== sk(d.colors || {})) patch.colors = col;
    if (Object.keys(patch).length) updates.push({ id: d.id, name: d.name, patch });
  });
  return { updates, inserts };
}

async function runMz(link, dry) {
  const recs = parseMz(readXlsx(await download(link)));
  const db = await sb('/rest/v1/mz_projects?select=*&order=sort_order');
  const { updates, inserts } = planMz(recs, db);
  if (!dry) {
    for (let i = 0; i < updates.length; i += 8) await Promise.all(updates.slice(i, i + 8).map((u) => sb('/rest/v1/mz_projects?id=eq.' + u.id, { method: 'PATCH', body: JSON.stringify({ ...u.patch, updated_at: new Date().toISOString() }) })));
    if (inserts.length) await sb('/rest/v1/mz_projects', { method: 'POST', body: JSON.stringify(inserts) });
  }
  const fields = {}; updates.forEach((u) => Object.keys(u.patch).forEach((k) => { fields[k] = (fields[k] || 0) + 1; }));
  return {
    summary: `اتعدّل ${updates.length} مشروع واتضاف ${inserts.length}`,
    stats: { sheet: recs.length, updated: updates.length, inserted: inserts.length, fields,
      sample: updates.slice(0, 15).map((u) => ({ name: u.name, ...u.patch })), new: inserts.map((r) => r.name) },
  };
}

/* ======================= المقايسات ======================= */
// المقايسات: بنضيف بس المقايسات اللي بعد آخر مقايسة اتاخدت من الشيت (last_n)، ومش بنعدّل القديم.
// صف المقايسة: [م، الشركة، المشروع، الكتيبة، تاريخ الاستلام، تاريخ التسليم، ملاحظات، ملف PDF]
const tx = (v) => (v == null ? '' : String(v).replace(/\r\n?/g, '\n').trim());
function parseMqAfter(wb, lastN) {
  const ws = wb.sheets[0];
  const h = (c) => tx((ws.get(1, c) || {}).v);
  if (!/الشركة/.test(h(2)) || !/المشروع/.test(h(3)) || !/الكتيبة/.test(h(4))) throw new Error('شكل شيت المقايسات اتغير (عناوين الأعمدة مش في مكانها) — مفيش حاجة اتحدثت');
  const out = []; let seen = false, maxN = 0;
  for (let r = 2; r <= ws.rows; r++) {
    const g = (c) => { const x = ws.get(r, c); return x ? x.v : null; };
    const n0 = g(1), n = typeof n0 === 'number' ? n0 : '';
    if (n !== '' && n > maxN) maxN = n;
    if (n === lastN) { seen = true; continue; }
    const c = tx(g(2)); if (!c) continue;
    // بعد آخر مقايسة: أي رقم أكبر منها، أو صف من غير رقم جاي بعدها في الشيت
    if (n !== '' ? n <= lastN : !seen) continue;
    const notes = [];
    const dt = (v) => { if (v == null || v === '') return ''; const d = xlDate(v); if (d) return d; notes.push(tx(v)); return ''; };
    const rd = dt(g(5)), dd = dt(g(6));
    out.push([n, c, tx(g(3)), tx(g(4)), rd, dd, notes.filter(Boolean).join(' '), tx(g(7))]);
  }
  if (maxN < lastN) throw new Error('آخر رقم في الشيت ' + maxN + ' وده أقل من آخر مقايسة اتاخدت (' + lastN + ') — اتأكد إنه الشيت الصح، مفيش حاجة اتحدثت');
  return out;
}

async function runMq(link, dry) {
  const rowsDb = await sb('/rest/v1/mq_base?select=rows,last_n&id=eq.1');
  const base = rowsDb.length ? rowsDb[0].rows : JSON.parse(fs.readFileSync(path.join(process.cwd(), 'api', '_data', 'base.json'), 'utf8'));
  const lastN = rowsDb.length && rowsDb[0].last_n != null ? rowsDb[0].last_n : Number(process.env.MQ_AFTER);
  if (!lastN) throw new Error('آخر مقايسة مش متسجلة');
  const add = parseMqAfter(readXlsx(await download(link)), lastN);
  const newLast = add.reduce((m, a) => (typeof a[0] === 'number' && a[0] > m ? a[0] : m), lastN);
  if (!dry && (add.length || !rowsDb.length)) {
    await sb('/rest/v1/mq_base', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify({ id: 1, rows: base.concat(add), last_n: newLast, updated_at: new Date().toISOString() }) });
  }
  return {
    summary: add.length ? `اتضاف ${add.length} مقايسة جديدة (من ${add[0][0] || '—'} لحد ${newLast})` : `مفيش مقايسات جديدة بعد رقم ${lastN}`,
    stats: { after: lastN, added: add.length, last: newLast, total: base.length + add.length, first: add.slice(0, 3), lastRows: add.slice(-2) },
  };
}

async function log(site, ok, trigger, summary, stats) {
  try { await sb('/rest/v1/sync_log', { method: 'POST', body: JSON.stringify({ site, ok, trigger, summary, stats }) }); } catch (e) { /* ignore */ }
}

module.exports = { sb, runMz, runMq, log, parseMz, parseMqAfter, planMz, norm };
