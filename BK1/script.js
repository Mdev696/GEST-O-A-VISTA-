const $ = s => document.querySelector(s);
const norm = s => String(s == null ? '' : s).trim().toLowerCase();
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const H = 36e5;

// ---- armazenamento (hostname digitado fica guardado por Sequência) ----
const mem = {};
const store = {
    get(k) { try { return localStorage.getItem(k) } catch (e) { return mem[k] || null } },
    set(k, v) { try { localStorage.setItem(k, v) } catch (e) { mem[k] = v } }
};

// ---- dados de exemplo (horas atrás em vez de data fixa) ----
const now0 = Date.now();
const D = (a, b, p, ag, g, l, ge, uf, s, h) => ({ seq: a, raiz: b, pri: p, aging: ag, grupo: g, loc: l, gestor: ge, uf, site: s, criacao: new Date(now0 - h * H) });
let rows = [
    D(369506618, 369506620, 'P0', '<=24h', 'SWAP', 'RESENDE', 'O&M-RE_SUDESTE_SWAP_OPERADORAS', 'RJ', 'RRS', 8.55),
    D(369506624, 369512139, 'P0', '<=24h', 'SWAP', 'PARATY', 'O&M-RE_SUDESTE_SWAP_OPERADORAS', 'RJ', 'PAT', 8.55),
    D(369521737, 0, 'P0', '<=24h', 'PI', 'RIO DE JANEIRO', 'TEL_O&M-RJ/ES(Terceiro)', 'RJ', 'DJU', 3.28),
    D(368802996, 0, 'P1', '+24h', 'PI', 'VASSOURAS', 'O&M ACESSO VIVO_N1_RJ/ES_Acesso', 'RJ', 'VAR', 15 * 24 + 8.6),
    D(369472387, 369475842, 'P1', '+24h', 'RE', 'CABO FRIO', 'O&M-RE_RJ/ES', 'RJ', 'TCF', 28.7),
    D(369507050, 369506196, 'P1', '<=24h', 'SWAP', 'RIO CLARO', 'O&M-RE_SUDESTE_SWAP_OPERADORAS', 'RJ', 'ASA', 8.38),
    D(369515004, 369514038, 'P1', '<=24h', 'SWAP', 'JUIZ DE FORA', 'O&M-RE_SUDESTE_SWAP_OPERADORAS', 'MG', 'SDE', 5.65),
    D(369515507, 369522711, 'P1', '<=24h', 'SWAP', 'ALEGRE', 'OPERADORAS - Protocolo de Abertura', 'ES', 'ALC', 5.46),
    D(369503729, 369513995, 'P2', '<=24h', 'RE', 'VITÓRIA', 'O&M-RE_RJ/ES', 'ES', 'GVT', 9.62),
    D(369512319, 369520947, 'P2', '<=24h', 'RE', 'VILA VELHA', 'O&M-RE_RJ/ES', 'ES', 'VEC', 6.52),
    D(369514414, 0, 'P2', '<=24h', 'PI', 'SERRA', 'TEL_O&M-RJ/ES(Terceiro)', 'ES', 'MAS', 5.85),
    D(369521811, 0, 'P2', '<=24h', 'PI', 'SERRA', 'TEL_O&M-RJ/ES(Terceiro)', 'ES', 'PFR', 3.23)
];
let afet = { 'i-br-rj-rjo-msj-hl4-01': 7210 };   // exemplo; a real vem da aba AFETAÇÃO
if (!store.get('hn:369512139')) store.set('hn:369512139', 'I-BR-RJ-RJO-MSJ-HL4-01');

// ---- regras (iguais às da planilha) ----
const PO = { P0: 0, P1: 1, P2: 2 };
const PC = { P0: 'var(--p0)', P1: 'var(--p1)', P2: 'var(--p2)' };
const GREEN = ['RE', 'SWAP', 'CIRE'], PURP = ['CENTRALIZADO', 'OUTRO', 'PI', 'MONIT_N1_BL', 'SOBRESSALENTES'];
const gcol = g => GREEN.includes(g) ? 'var(--g1)' : (PURP.includes(g) || g === '') ? 'var(--g2)' : 'var(--g3)';
function status(ms) { const h = ms / H; return h >= 72 ? '>72HS' : h >= 48 ? '>48HS' : h >= 36 ? '>36HS' : h >= 24 ? '>24HS' : h >= 8 ? '>8HS' : '<8HS' }
function fmt(ms) { const m = Math.max(0, Math.floor(ms / 6e4)); const d = Math.floor(m / 1440), h = Math.floor(m % 1440 / 60), mm = m % 60; return d + 'd ' + h + ':' + String(mm).padStart(2, '0') }
const hostOf = r => store.get('hn:' + r.seq) || '';
const riskOf = r => { const v = afet[norm(hostOf(r))]; return v == null ? 0 : v };

// ---- estado de filtros ----
let fp = '', fq = '', fuf = '', fgr = '';

function fill(sel, vals) {
    const el = $(sel), cur = el.value; const first = el.firstElementChild.outerHTML;
    el.innerHTML = first + [...new Set(vals)].filter(Boolean).sort().map(v => `<option>${esc(v)}</option>`).join(''); el.value = cur
}

function strip() {
    const c = p => rows.filter(r => r.pri === p).length;
    const items = [['', 'Total', rows.length, ''], ['P0', 'P0', c('P0'), 'var(--p0)'], ['P1', 'P1', c('P1'), 'var(--p1)'], ['P2', 'P2', c('P2'), 'var(--p2)'], ['+24h', 'Aging +24h', rows.filter(r => r.aging === '+24h').length, 'var(--tx)']];
    $('#strip').innerHTML = items.map(([k, l, n, col]) => `<button type="button" data-k="${k}" aria-pressed="${fp === k}" style="--c:${col || 'var(--tx)'}"><b>${n}</b><span>${l}</span></button>`).join('');
    $('#strip').querySelectorAll('button').forEach(b => b.onclick = () => { fp = (fp === b.dataset.k) ? '' : b.dataset.k; render() });
}

function render() {
    strip();
    fill('#uf', rows.map(r => r.uf)); fill('#gr', rows.map(r => r.grupo));
    const t = Date.now();
    const list = rows.filter(r => {
        if (fp === '+24h' ? r.aging !== '+24h' : (fp && r.pri !== fp)) return false;
        if (fuf && r.uf !== fuf) return false; if (fgr && r.grupo !== fgr) return false;
        if (fq) { const s = norm([r.seq, r.raiz, r.loc, r.site, r.gestor, hostOf(r)].join(' ')); if (!s.includes(fq)) return false }
        return true;
    }).sort((a, b) => (PO[a.pri] - PO[b.pri]) || (a.criacao - b.criacao));
    $('#empty').textContent = rows.length ? 'Nenhum ticket com esses filtros.' : 'Tabela vazia. Importe uma planilha para começar.';
    $('#empty').hidden = list.length > 0;
    $('#tb').innerHTML = list.map(r => {
        const ms = t - r.criacao, late = ms >= 864e5, rk = riskOf(r);
        return `<tr style="--c:${PC[r.pri] || 'var(--mt)'}">
<td class="num">${r.seq}</td>
<td class="num ${r.raiz ? '' : 'muted'}">${r.raiz || '—'}</td>
<td><span class="chip" style="--c:${PC[r.pri] || 'var(--mt)'}">${esc(r.pri)}</span></td>
<td>${esc(r.aging)}</td>
<td><span class="chip" style="--c:${gcol(r.grupo)}">${esc(r.grupo)}</span></td>
<td>${esc(r.loc)}</td>
<td class="gest muted" title="${esc(r.gestor)}">${esc(r.gestor)}</td>
<td>${esc(r.uf)}</td>
<td><span class="site">${esc(r.site)}</span></td>
<td class="num muted">${r.criacao.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })}</td>
<td><span class="t${late ? ' late' : ''}" data-ts="${+r.criacao}">${fmt(ms)}</span></td>
<td class="muted">${status(ms)}</td>
<td><input class="hn" data-seq="${r.seq}" value="${esc(hostOf(r))}" placeholder="I-BR-UF-..." aria-label="Hostname do ticket ${r.seq}"></td>
<td class="risk${rk ? ' on' : ''}">${rk.toLocaleString('pt-BR')}</td></tr>`
    }).join('');
    $('#tb').querySelectorAll('.hn').forEach(i => i.onchange = () => { store.set('hn:' + i.dataset.seq, i.value.trim()); render() });
}

// atualiza os tempos sem recriar a tabela
setInterval(() => { if (document.activeElement && document.activeElement.classList.contains('hn')) return; render() }, 60000);

$('#q').oninput = e => { fq = norm(e.target.value); render() };
$('#uf').onchange = e => { fuf = e.target.value; render() };
$('#gr').onchange = e => { fgr = e.target.value; render() };
$('#theme').onclick = () => { const r = document.documentElement, dark = r.dataset.theme ? r.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme:dark)').matches; r.dataset.theme = dark ? 'light' : 'dark' };

$('#max').onclick = () => { const on = document.body.classList.toggle('max'); $('#max').textContent = on ? 'Restaurar tamanho' : 'Maximizar tabela'; $('#max').setAttribute('aria-pressed', on) };
document.addEventListener('keydown', e => { if (e.key === 'Escape' && document.body.classList.contains('max')) $('#max').click() });
let armT;
$('#clear').onclick = () => {
    const b = $('#clear');
    if (!b.classList.contains('arm')) { b.classList.add('arm'); b.textContent = 'Confirmar limpeza?'; armT = setTimeout(() => { b.classList.remove('arm'); b.textContent = 'Limpar tabela' }, 3500); return }
    clearTimeout(armT); b.classList.remove('arm'); b.textContent = 'Limpar tabela';
    rows = []; afet = {}; fp = fq = fuf = fgr = ''; $('#q').value = ''; $('#uf').value = ''; $('#gr').value = '';
    $('#meta').textContent = 'Tabela vazia · importe uma nova planilha (.xlsx)'; render()
};

// ---- importação do .xlsx (abas BACKLOG ATUAL e AFETAÇÃO) ----
// leitor de .xlsx independente (para arquivos exportados por sistemas que o SheetJS não lê direito)
async function rawRead(buf) {
    const u8 = new Uint8Array(buf), dv = new DataView(buf), td = new TextDecoder();
    let e = u8.length - 22; while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--;
    if (e < 0) return null;
    const n = dv.getUint16(e + 10, true); let p = dv.getUint32(e + 16, true); const F = {};
    for (let i = 0; i < n; i++) {
        const m = dv.getUint16(p + 10, true), cs = dv.getUint32(p + 20, true), nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), off = dv.getUint32(p + 42, true);
        const name = td.decode(u8.subarray(p + 46, p + 46 + nl));
        const lh = off + 30 + dv.getUint16(off + 26, true) + dv.getUint16(off + 28, true);
        F[name] = { m, d: u8.subarray(lh, lh + cs) }; p += 46 + nl + xl + cl;
    }
    const txt = async k => {
        const f = F[k]; if (!f) return ''; let d = f.d;
        if (f.m === 8) d = new Uint8Array(await new Response(new Blob([d]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
        return td.decode(d)
    };
    const un = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, c) => String.fromCharCode(c)).replace(/&amp;/g, '&');
    const tt = x => un([...x.matchAll(/<(?:\w+:)?t\b[^>]*>([\s\S]*?)<\/(?:\w+:)?t>/g)].map(m => m[1]).join(''));
    const sheetKey = Object.keys(F).filter(k => /^xl\/worksheets\/[^/]+\.xml$/.test(k)).sort()[0];
    if (!sheetKey) return null;
    const sheet = await txt(sheetKey);
    const ss = [...(await txt('xl/sharedStrings.xml')).matchAll(/<(?:\w+:)?si\b[^>]*>([\s\S]*?)<\/(?:\w+:)?si>/g)].map(m => tt(m[1]));
    const styles = await txt('xl/styles.xml'), fm = {};
    for (const m of styles.matchAll(/<(?:\w+:)?numFmt\b[^>]*?numFmtId="(\d+)"[^>]*?formatCode="([^"]*)"/g)) fm[m[1]] = un(m[2]);
    const xb = (styles.match(/<(?:\w+:)?cellXfs\b[\s\S]*?<\/(?:\w+:)?cellXfs>/) || [''])[0];
    const isD = id => (id >= 14 && id <= 22) || (id >= 45 && id <= 47) || (fm[id] != null && /[ymdhs]/i.test(fm[id].replace(/"[^"]*"|\\.|\[[^\]]*\]/g, '')));
    const xfDate = [...xb.matchAll(/<(?:\w+:)?xf\b([^>]*)>/g)].map(m => { const i = m[1].match(/numFmtId="(\d+)"/); return i ? isD(+i[1]) : false });
    const colIdx = s => { let n = 0; for (const ch of s) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1 };
    const aoa = [];
    for (const rm of sheet.matchAll(/<(?:\w+:)?row\b[^>]*?(?:\/>|>([\s\S]*?)<\/(?:\w+:)?row>)/g)) {
        const row = []; let col = 0;
        for (const cm of (rm[1] || '').matchAll(/<(?:\w+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g)) {
            const at = cm[1], body = cm[2] || '';
            const r = at.match(/\br="([A-Z]+)\d+"/); if (r) col = colIdx(r[1]);
            const t = (at.match(/\bt="(\w+)"/) || [])[1], s = (at.match(/\bs="(\d+)"/) || [])[1];
            const v = (body.match(/<(?:\w+:)?v\b[^>]*>([\s\S]*?)<\/(?:\w+:)?v>/) || [])[1];
            let val = '';
            if (t === 'inlineStr') { const is = body.match(/<(?:\w+:)?is\b[^>]*>([\s\S]*?)<\/(?:\w+:)?is>/); val = is ? tt(is[1]) : '' }
            else if (v !== undefined) {
                if (t === 's') val = ss[+v] ?? '';
                else if (t === 'str') val = un(v);
                else if (t === 'b') val = v === '1';
                else if (t === 'e') val = '';
                else { const num = Number(v); val = (s !== undefined && xfDate[+s]) ? (() => { const d = new Date(Math.round(num * 864e5) + Date.UTC(1899, 11, 30)); return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()) })() : num }
            }
            row[col] = val; col++;
        }
        aoa.push(row);
    }
    const hi = aoa.findIndex(r => r.some(v => v !== '' && v != null)); if (hi < 0) return null;
    const hdr = aoa[hi].map(h => String(h == null ? '' : h));
    return aoa.slice(hi + 1).filter(r => r.some(v => v !== '' && v != null)).map(r => { const o = {}; hdr.forEach((h, i) => { if (h) o[h] = r[i] == null ? '' : r[i] }); return o });
}

$('#file').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try {
        const buf = await f.arrayBuffer();
        const wb = XLSX.read(buf, { cellDates: true });
        const find = n => wb.SheetNames.find(s => s.trim().toUpperCase() === n) || null;
        const bs = find('BACKLOG ATUAL') || wb.SheetNames[0];
        const key = s => norm(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
        const keyObj = o => { const n = {}; for (const k in o) n[key(k)] = o[k]; return n };
        const pick = (o, ...names) => { for (const n of names) { const v = o[key(n)]; if (v !== '' && v != null) return v } return '' };
        const num = v => { if (typeof v === 'number') return v > 0 ? Math.floor(v) : 0; const s = String(v).trim(); return /^\d+$/.test(s) ? Number(s) : 0 };
        const toDate = v => { if (v instanceof Date) return v; if (typeof v === 'number') return new Date(Math.round((v - 25569) * 864e5)); const m = String(v).match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:\s+(\d{1,2}):(\d{2}))?/); if (m) return new Date(+(m[3].length == 2 ? '20' + m[3] : m[3]), m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0)); return new Date(v) };
        // só entra linha com Sequência numérica e data de criação válida (ignora "Total", "Filtros aplicados" e linhas vazias)
        const build = js => js.map(o => ({ seq: num(pick(o, 'Sequencia', 'Sequência', 'Ticket', 'Nº Ticket', 'Numero')), raiz: num(pick(o, 'SequenciaRaiz', 'Sequência Raiz', 'Raiz')), pri: String(pick(o, 'Prioridade')).trim().toUpperCase(), aging: pick(o, 'Aging'), grupo: pick(o, 'Grupo Responsável', 'Grupo'), loc: pick(o, 'Localidade'), gestor: pick(o, 'Gestor Atual', 'Gestor'), uf: pick(o, 'UF'), site: pick(o, 'Sigla Site', 'Site'), criacao: toDate(pick(o, 'DataCriacao', 'Data Criação', 'Criação')) })).filter(r => r.seq > 0 && !isNaN(r.criacao));
        let js = XLSX.utils.sheet_to_json(wb.Sheets[bs], { defval: '' }).map(keyObj);
        let imp = build(js);
        if (!imp.length) { // base crua exportada por outro sistema: leitor alternativo
            try { const alt = await rawRead(buf); if (alt) { const j2 = alt.map(keyObj), i2 = build(j2); if (i2.length) { js = j2; imp = i2 } } } catch (_) { }
        }
        const ign = js.filter(o => Object.values(o).some(v => v !== '' && v != null)).length - imp.length;
        if (!imp.length) throw new Error('nenhuma linha válida na aba ' + bs + '. Colunas encontradas: ' + ((XLSX.utils.sheet_to_json(wb.Sheets[bs], { header: 1 })[0]) || []).join(', '));
        rows = imp;
        const as = find('AFETAÇÃO');
        if (as) { afet = {}; XLSX.utils.sheet_to_json(wb.Sheets[as], { defval: '' }).forEach(o => { const k = norm(o['HL4']); if (k) afet[k] = Number(o['CLIENTES']) || 0 }) }
        $('#meta').textContent = f.name + ' · ' + rows.length + ' tickets' + (ign > 0 ? ' · ' + ign + ' linhas ignoradas (Total/Filtros/vazias)' : '') + (as ? ' · ' + Object.keys(afet).length + ' HL4 na afetação' : '');
        fp = fuf = fgr = ''; render();
    } catch (err) { $('#meta').textContent = 'Não consegui ler o arquivo: ' + err.message }
    e.target.value = '';
};
render();