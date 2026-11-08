// قارئ xlsx خفيف من غير مكتبات: بيفك الـ zip ويقرا الخلايا والدمج ولون الخلفية
const zlib = require('zlib');

function unzip(buf) {
  let e = buf.length - 22;
  while (e >= 0 && buf.readUInt32LE(e) !== 0x06054b50) e--;
  if (e < 0) throw new Error('الملف مش xlsx');
  const n = buf.readUInt16LE(e + 10);
  let p = buf.readUInt32LE(e + 16);
  const files = {};
  for (let i = 0; i < n; i++) {
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20);
    const nl = buf.readUInt16LE(p + 28), xl = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32);
    const off = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nl);
    files[name] = { method, csize, off };
    p += 46 + nl + xl + cl;
  }
  return (name) => {
    const f = files[name]; if (!f) return null;
    const s = f.off + 30 + buf.readUInt16LE(f.off + 26) + buf.readUInt16LE(f.off + 28);
    const d = buf.subarray(s, s + f.csize);
    return (f.method === 8 ? zlib.inflateRawSync(d) : d).toString('utf8');
  };
}

const ent = (s) => s.replace(/&(lt|gt|quot|apos|amp|#x?[0-9a-fA-F]+);/g, (m, g) =>
  g === 'lt' ? '<' : g === 'gt' ? '>' : g === 'quot' ? '"' : g === 'apos' ? "'" : g === 'amp' ? '&'
    : String.fromCodePoint(g[1] === 'x' ? parseInt(g.slice(2), 16) : parseInt(g.slice(1), 10)));
const textOf = (x) => { let t = ''; x.replace(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g, (_, v) => { t += v; }); return ent(t); };
const attr = (tag, a) => { const m = new RegExp('\\s' + a + '="([^"]*)"').exec(tag); return m ? ent(m[1]) : null; };
const colN = (L) => { let n = 0; for (const ch of L) n = n * 26 + ch.charCodeAt(0) - 64; return n; };
const ref = (r) => { const m = /^([A-Z]+)(\d+)$/.exec(r); return [+m[2], colN(m[1])]; };

/** readXlsx(buffer) → { sheets: [{ name, get(r,c) → {v, fill}, rows: maxRow, merges: [[r1,c1,r2,c2]] }] } */
function readXlsx(buf) {
  const z = unzip(buf);
  const ss = []; const sst = z('xl/sharedStrings.xml');
  if (sst) sst.replace(/<si>([\s\S]*?)<\/si>/g, (_, x) => { ss.push(textOf(x)); });
  // ألوان الخلفية: cellXfs[s].fillId → fills[fillId] fgColor rgb
  const st = z('xl/styles.xml') || '';
  const fills = []; (/<fills[^>]*>([\s\S]*?)<\/fills>/.exec(st) || [, ''])[1].replace(/<fill>([\s\S]*?)<\/fill>|<fill\/>/g, (_, x) => {
    const m = x && /patternType="solid"[\s\S]*?<fgColor[^>]*rgb="([0-9A-Fa-f]{8})"/.exec(x); fills.push(m ? m[1].toUpperCase() : null);
  });
  const xfFill = []; (/<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/.exec(st) || [, ''])[1].replace(/<xf\s[^>]*?\/?>/g, (t) => { xfFill.push(fills[+(attr(t, 'fillId') || 0)] || null); });
  const wb = z('xl/workbook.xml'), rels = z('xl/_rels/workbook.xml.rels');
  const target = {}; rels.replace(/<Relationship\s[^>]*>/g, (t) => { target[attr(t, 'Id')] = attr(t, 'Target'); });
  const sheets = [];
  wb.replace(/<sheet\s[^>]*>/g, (t) => {
    const name = attr(t, 'name'), rid = attr(t, 'r:id');
    let path = target[rid]; if (!path) return; path = path.replace(/^\/?xl\//, '').replace(/^\//, '');
    sheets.push({ name, path: 'xl/' + path });
  });
  return {
    sheets: sheets.map(({ name, path }) => {
      let cache = null;
      const load = () => {
        if (cache) return cache;
        const x = z(path) || '';
        const cells = new Map(); let maxRow = 0;
        x.replace(/<c\s([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g, (_, a, body) => {
          const r = attr(' ' + a, 'r'); if (!r) return;
          const [ri, ci] = ref(r); const t = attr(' ' + a, 't'), s = attr(' ' + a, 's');
          let v = null;
          if (body) {
            if (t === 'inlineStr') v = textOf(body);
            else { const m = /<v>([\s\S]*?)<\/v>/.exec(body); if (m) { const raw = ent(m[1]); v = t === 's' ? ss[+raw] : t === 'str' || t === 'e' ? raw : t === 'b' ? raw === '1' : Number(raw); } }
          }
          const fill = s != null ? xfFill[+s] : null;
          if (v === null && !fill) return;
          cells.set(ri * 20000 + ci, { v, fill }); if (ri > maxRow) maxRow = ri;
        });
        const merges = []; x.replace(/<mergeCell\s+ref="([A-Z]+\d+):([A-Z]+\d+)"/g, (_, a, b) => { merges.push([...ref(a), ...ref(b)]); });
        return (cache = { cells, maxRow, merges });
      };
      return {
        name,
        get rows() { return load().maxRow; },
        get merges() { return load().merges; },
        get(r, c) { return load().cells.get(r * 20000 + c) || null; },
      };
    }),
  };
}

// تاريخ Excel (رقم) → YYYY-MM-DD
function xlDate(v) {
  if (typeof v !== 'number' || v < 20000 || v > 80000) return null;
  const d = new Date(Math.round((v - 25569) * 86400000));
  return d.toISOString().slice(0, 10);
}

module.exports = { readXlsx, xlDate };
