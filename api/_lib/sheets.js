// شيتات الموازنات من فولدر Google Drive → زرار «فتح الشيت» في خانة مكان المشروع (الموازنات)
// كل ملف Excel في الفولدر بيتطابق مع مشروعه بالاسم (واسم الملف + عنوان أول شيت)، وبيترفع ويتربط.
// الملف اللي ماتغيرش من آخر مرة مابيترفعش تاني. الملف اللي مالقيناش مشروعه بيتكتب في الملخص.
const crypto = require('crypto');
const { readXlsx } = require('./xlsx');
const URL_ = 'https://qadrtqtydtgzachfzpqw.supabase.co';
const SRK = () => process.env.SUPABASE_SERVICE_ROLE_KEY;
const H = () => ({ apikey: SRK(), Authorization: 'Bearer ' + SRK() });
async function rest(p, opt = {}) {
  const r = await fetch(URL_ + p, { ...opt, headers: { ...H(), 'Content-Type': 'application/json', ...(opt.headers || {}) } });
  const t = await r.text(); if (!r.ok) throw new Error('supabase ' + r.status + ': ' + t.slice(0, 200));
  return t ? JSON.parse(t) : null;
}
const folderId = (s) => { const m = /\/folders\/([\w-]{20,})/.exec(s || '') || /[?&]id=([\w-]{20,})/.exec(s || ''); return m ? m[1] : (s || '').trim(); };
const ent = (s) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');

const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36', 'Accept-Language': 'en-US,en;q=0.9' };
async function listFolder(link) {
  const id = folderId(link); if (!id) throw new Error('لينك فولدر الشيتات مش متسجل');
  const st = [];
  // 1) العرض المضمّن للفولدر
  try {
    const r = await fetch('https://drive.google.com/embeddedfolderview?id=' + id, { redirect: 'follow', headers: UA });
    st.push('embedded ' + r.status);
    if (r.ok) {
      const html = await r.text(), out = []; const re = /id="entry-([\w-]{20,})"[\s\S]*?class="flip-entry-title">([^<]*)</g; let m;
      while ((m = re.exec(html))) out.push({ id: m[1], name: ent(m[2]).trim() });
      if (out.length) return out;
    }
  } catch (e) { st.push('embedded ' + e.message); }
  // 2) صفحة الفولدر نفسها (البيانات جواها بصيغة JS)
  const r = await fetch('https://drive.google.com/drive/folders/' + id, { redirect: 'follow', headers: UA });
  st.push('folder ' + r.status);
  if (r.ok) {
    const html = (await r.text()).replace(/\\x([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16))).replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16))).replace(/\\\//g, '/').replace(/\\"/g, '"');
    const out = [], seen = new Set(); const re = /\["([\w-]{25,})",\["([\w-]{20,})"\],"([^"]{1,250})","(application\/[^"]+)"/g; let m;
    while ((m = re.exec(html))) { if (m[2] === id && !seen.has(m[1])) { seen.add(m[1]); out.push({ id: m[1], name: m[3] }); } }
    if (out.length) return out;
    if (/ServiceLogin|accounts\.google\.com\/v3\/signin/.test(html)) st.push('login');
  }
  throw new Error('مقدرتش أقرا الفولدر (' + st.join('، ') + ') — اتأكد إن الفولدر متشارك «Anyone with the link»');
}
async function download(id) {
  const r = await fetch('https://drive.google.com/uc?export=download&id=' + id, { redirect: 'follow', headers: UA });
  if (!r.ok) throw new Error('Drive ' + r.status);
  let buf = Buffer.from(await r.arrayBuffer());
  if (buf.readUInt32LE(0) !== 0x04034b50) { // ملف كبير: Drive بيطلب تأكيد
    const h = buf.toString('utf8'); const c = /name="confirm" value="([^"]+)"/.exec(h), u = /name="uuid" value="([^"]+)"/.exec(h);
    if (!c) throw new Error('Drive مارجّعش ملف Excel');
    const r2 = await fetch('https://drive.usercontent.google.com/download?id=' + id + '&export=download&confirm=' + c[1] + (u ? '&uuid=' + u[1] : ''));
    buf = Buffer.from(await r2.arrayBuffer()); if (buf.readUInt32LE(0) !== 0x04034b50) throw new Error('Drive مارجّعش ملف Excel');
  }
  return buf;
}
function title(buf) {
  try { const ws = readXlsx(buf).sheets[0]; for (let r = 1; r <= 8; r++) for (let c = 1; c <= 25; c++) { const x = ws.get(r, c); if (x && typeof x.v === 'string' && x.v.trim().length > 8) return x.v.trim(); } } catch (e) { /* */ }
  return '';
}
// نفس مطابقة البوابة («ربط شيتات الموازنات»)
function mzNorm(t) {
  return String(t || '').replace(/\.(xlsx|xlsm|xls|xlsb|csv)$/i, '').replace(/[ً-ْـ]/g, '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي')
    .replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).toLowerCase()
    .replace(/\d{1,2}[-/]\d{1,2}[-/]\d{2,4}/g, ' ').replace(/(\d)([؀-ۿ])/g, '$1 $2').replace(/([؀-ۿ])(\d)/g, '$1 $2').replace(/([a-z])0+(\d)/g, '$1$2').replace(/[()\-+_,،:]/g, ' ');
}
const MZ_STOP = new Set(['موازنه', 'تقديريه', 'لاعمال', 'اعمال', 'لمشروع', 'مشروع', 'اجماليه', 'ذاتي', 'طريق', 'طرق', 'بطول', 'كم', 'متر', 'خاصه', 'اداره', 'مسعره', 'منطقه', 'بنود', 'الاعمال', 'تطوير', 'انشاء']);
const mzToks = (t) => mzNorm(t).split(/\s+/).map((w) => w.replace(/^(و?ب?ال|لل)(?=..)/, '').replace(/^اجماليه(ل?مشروع)?$/, '')).filter((w) => (w.length >= 2 || /\d/.test(w)) && !MZ_STOP.has(w));
function mzMatch(text, P) {
  const a = new Set(mzToks(text)); if (!a.size) return [];
  const sc = P.map((p) => { const b = mzToks(p.name); if (!b.length) return 0; let k = 0; b.forEach((w) => { if (a.has(w) || (w.length >= 4 && [...a].some((x) => x.length >= 4 && (x.startsWith(w) || w.startsWith(x))))) k++; }); return 0.5 * k / b.length + 0.5 * Math.min(1, k / a.size); });
  const best = Math.max(...sc); if (best < 0.5) return [];
  const top = P.filter((_, i) => sc[i] >= best - 1e-9);
  return new Set(top.map((p) => mzNorm(p.name).replace(/\s+/g, ' ').trim())).size === 1 ? top.map((p) => p.id) : [];
}
function pick(name, ttl, P) {
  let ids = mzMatch(name, P); const it = ttl ? mzMatch(name + ' ' + ttl, P) : [];
  if (it.length && (!ids.length || it.length < ids.length || !ids.every((x) => it.includes(x)))) ids = it.length <= ids.length || !ids.length ? it : ids;
  return ids;
}

async function runSheets(link, dry) {
  const files = (await listFolder(link)).filter((f) => /\.(xlsx|xlsm|xls)$/i.test(f.name));
  const P = await rest('/rest/v1/mz_projects?select=id,name,battalion,sheet_path');
  const state = new Map((await rest('/rest/v1/mz_sheet_files?select=file_id,sha,name,project_ids')).map((s) => [s.file_id, s]));
  let linked = 0, same = 0; const none = [], errs = [];
  for (const f of files) {
    try {
      const buf = await download(f.id), sha = crypto.createHash('sha1').update(buf).digest('hex');
      const ids = pick(f.name, title(buf), P);
      if (!ids.length) { none.push(f.name); if (!dry) await rest('/rest/v1/mz_sheet_files', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates' }, body: JSON.stringify({ file_id: f.id, name: f.name, sha, project_ids: [], status: 'no-match', updated_at: new Date().toISOString() }) }); continue; }
      const st = state.get(f.id), ext = (/\.(xlsx|xlsm|xls)$/i.exec(f.name) || [0, 'xlsx'])[1].toLowerCase();
      const allOk = st && st.sha === sha && st.name === f.name && ids.every((id) => (P.find((p) => p.id === id) || {}).sheet_path === id + '/drive-' + f.id + '.' + ext);
      if (allOk) { same++; continue; }
      if (dry) { linked += ids.length; continue; }
      for (const id of ids) {
        const p = P.find((x) => x.id === id), path = id + '/drive-' + f.id + '.' + ext;
        const up = await fetch(URL_ + '/storage/v1/object/mz/' + path, { method: 'POST', headers: { ...H(), 'Content-Type': 'application/octet-stream', 'x-upsert': 'true' }, body: buf });
        if (!up.ok) throw new Error('رفع ' + up.status);
        await rest('/rest/v1/mz_projects?id=eq.' + id, { method: 'PATCH', body: JSON.stringify({ sheet_path: path, sheet_name: f.name }) });
        if (p.sheet_path && p.sheet_path !== path) await fetch(URL_ + '/storage/v1/object/mz', { method: 'DELETE', headers: { ...H(), 'Content-Type': 'application/json' }, body: JSON.stringify({ prefixes: [p.sheet_path] }) }).catch(() => {});
        p.sheet_path = path; linked++;
      }
      await rest('/rest/v1/mz_sheet_files', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates' }, body: JSON.stringify({ file_id: f.id, name: f.name, sha, project_ids: ids, status: 'linked', updated_at: new Date().toISOString() }) });
    } catch (e) { errs.push(f.name + ': ' + e.message); }
  }
  const parts = ['شيتات: ' + files.length + ' ملف في الفولدر', linked ? 'اتربط ' + linked + ' مشروع' : null, same ? same + ' ملف زي ما هو' : null,
    none.length ? 'مالقيتش مشروع لـ: ' + none.join('، ') : null, errs.length ? 'أخطاء: ' + errs.join(' | ') : null].filter(Boolean);
  return { summary: parts.join(' — '), stats: { files: files.length, linked, same, none: none.length, errors: errs.length } };
}
module.exports = { runSheets, listFolder, pick, mzMatch };
