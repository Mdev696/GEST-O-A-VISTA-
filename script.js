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

// ---- tickets exibidos (começa vazio; vem da importação da planilha ou do repositório de bases) ----
let rows = [];
// ---- afetação (base HL4, soma de clientes por hostname) e hostname automático ----
let afet = {};    // HL4  (P0 e P2) - tabela afetacao_hl4 do Supabase
let p2map = {};   // código P2 (ex.: essea_g1n06) -> {host, cli}, da coluna P2 da tabela afetacao_hl4
let afet5 = {};   // HL5D (P1)      - tabela afetacao_hl5d do Supabase
let sbAlarme = {};   // alarmes dos P1 vindos do Supabase (casos_backup)
const HRX = /i-br-[a-z]{2}-[a-z0-9]{3}-[a-z0-9]{3}-hl\d[a-z]?-\d+/gi;
// Preencha aqui se quiser deixar a conexão fixa no código (ou use o botão Supabase na tela)
const SUPABASE_URL = 'https://fgcrdoyquvzihgnmvspf.supabase.co';   // ex.: https://xxxx.supabase.co
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZnY3Jkb3lxdXZ6aWhnbm12c3BmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTEwNTY3NzksImV4cCI6MjEwNjYzMjc3OX0.V8hsgf52PlIjukEyQmhtwtjzN26Mv0OVePEwkjXwtS0';   // chave anon public
const sbCfg = () => ({ url: (store.get('sb_url') || SUPABASE_URL).replace(/\/+$/, ''), key: store.get('sb_key') || SUPABASE_KEY });
const alarmOf = r => ((r.pri === 'P1' || r.pri === 'P2') && sbAlarme[r.seq]) || r.alarme || '';   // P1: casos_backup | P2: fechamos_historico
let siteIdx = {};   // SITE (e último trecho do hostname) -> hostnames HL5D
const bySite = r => { const uf = 'i-br-' + norm(r.uf) + '-', sl = norm(r.sloc), l = (siteIdx[norm(r.site)] || []).filter(h => h.startsWith(uf)); return (sl && l.find(h => h.startsWith(uf + sl + '-'))) || l[0] || '' };
// P3, P4 e P5: não têm tabela de afetação; o hostname vem do alarme (NODE:..., ou o equipamento da Ponta A, ex.: MS-ESCCA_O1I01)
const nodeHost = r => {
    const al = String(alarmOf(r));
    const m = al.match(/NODE:\s*([A-Za-z0-9_-]+)/i) || al.match(/(MS-[A-Z]{2}[A-Z0-9]{3}_[A-Z0-9]{4,5})(?![A-Z0-9])/i);
    return m ? m[1] : (al.match(HRX) || [])[0] || '';
};
const autoHost = r => {
    if (PO[r.pri] > 2) return nodeHost(r);   // P3, P4, P5
    const c = [...new Set((String(alarmOf(r)).match(HRX) || []).map(norm))];
    if (r.pri === 'P1') { const h5 = c.filter(h => /-hl5d?-/.test(h)); return h5.find(h => h in afet5) || bySite(r) || h5[0] || '' }   // P1 = HL5D
    // P2: o hostname vem do alarme da fechamos_historico (qualquer tipo: HL4, HL5D, HL5G...); o 1º que aparece no texto é o do nó do ticket
    if (r.pri === 'P2') return c.find(h => h in afet) || c.find(h => h in afet5) || c[0] || '';
    return c.find(h => h in afet) || c.find(h => /-hl4-/.test(h)) || '';
};

// ---- regras (iguais às da planilha) ----
const PO = { P0: 0, P1: 1, P2: 2, P3: 3, P4: 4, P5: 5 };
const PC = { P0: 'var(--p0)', P1: 'var(--p1)', P2: 'var(--p2)', P3: 'var(--p3)', P4: 'var(--p4)', P5: 'var(--p5)' };
const GREEN = ['RE', 'SWAP', 'CIRE'], PURP = ['CENTRALIZADO', 'OUTRO', 'PI', 'MONIT_N1_BL', 'SOBRESSALENTES'];
const gcol = g => GREEN.includes(g) ? 'var(--g1)' : (PURP.includes(g) || g === '') ? 'var(--g2)' : 'var(--g3)';
// Status pelo tempo decorrido: < 2h normal | 2h a 4h atenção | > 4h crítico (bolinha piscando)
const STATUS_TXT = { ok: 'NORMAL', warn: 'ATENÇÃO', crit: 'CRÍTICO' };   // troque os textos aqui (ex.: 'OK', 'ALERTA', 'ESTOUROU')
function statusKey(ms) { const h = ms / H; return h < 2 ? 'ok' : h <= 4 ? 'warn' : 'crit' }
function statusCell(ms) { const k = statusKey(ms); return `<span class="st ${k}"><i></i>${STATUS_TXT[k]}</span>` }
function fmt(ms) { const m = Math.max(0, Math.floor(ms / 6e4)); const d = Math.floor(m / 1440), h = Math.floor(m % 1440 / 60), mm = m % 60; return d + 'd ' + h + ':' + String(mm).padStart(2, '0') }
// P2: lê o alarme e acha o código P2 da base HL4 (hostname + clientes daquele P2)
const p2Of = r => {
    if (r.pri !== 'P2' || !Object.keys(p2map).length) return null;
    const al = String(alarmOf(r)).toLowerCase();
    // 1) código P2 escrito no alarme (ex.: IP_SRV#10G#ESSEA_G1N06_1#...)
    let best = null, bestK = '', pos = 1e9, len = 0;
    for (const k in p2map) { const i = al.indexOf(k); if (i >= 0 && (i < pos || (i === pos && k.length > len))) { pos = i; len = k.length; best = p2map[k]; bestK = k } }
    if (best) return { ...best, code: bestK };
    // 2) forma curta LOC_SITE (ex.: RJO_M85_1_GPON...) + UF do ticket -> UFLOC_G1SITE (ex.: rjrjo_g1m85)
    for (const m of al.matchAll(/\b([a-z]{3})_([a-z]\d{2})_/g)) { const k = norm(r.uf) + m[1] + '_g1' + m[2], c = p2map[k]; if (c) return { ...c, code: k } }
    return null;
};
// P2 sem hostname: mostra o motivo no próprio campo (e o texto do alarme aparece ao passar o mouse)
const hnHint = r => {
    if (r.pri !== 'P2' || hostOf(r)) return 'I-BR-UF-...';
    if (!sbCfg().url || !sbCfg().key) return 'sem conexão Supabase';
    if (!Object.keys(p2map).length) return 'base HL4 (P2) não carregada';
    return sbAlarme[r.seq] ? 'alarme sem código P2 da base' : 'Sequência não achada na fechamos_historico';
};
// P2: se o alarme tem "Alarm Source: XXXX", esse é o hostname (ex.: RJO_M85_1_GPON_VLAN_103_104_105-FPT)
const alarmSource = r => { if (r.pri !== 'P2') return ''; const m = String(alarmOf(r)).match(/alarm\s*source\s*:\s*([^\s,\]]+)/i); return m ? m[1] : '' };
const hostRaw = r => store.get('hn:' + r.seq) || ((p2Of(r) || {}).code || '').toUpperCase() || alarmSource(r) || autoHost(r);   // P2: código P2 (ex.: RJRJO_G1M85); sem código, fica o Alarm Source/hostname do alarme
// todas as prioridades, menos P2: hostname em caixa alta
const hostOf = r => { const h = hostRaw(r); return r.pri !== 'P2' ? h.toUpperCase() : h };
const riskOf = r => { if (r.pri === 'P2') { const man = store.get('hn:' + r.seq), p2 = man ? p2map[norm(man)] : p2Of(r); if (p2) return p2.cli } const h = norm(hostOf(r)), p = r.pri === 'P1' ? afet5 : afet, o = r.pri === 'P1' ? afet : afet5; return !h ? null : h in p ? p[h] : h in o ? o[h] : null };

// ---- estado de filtros ----
let fp = '', fq = '', fuf = '', fgr = '', fs = '';
let LIM = Math.min(100, Math.max(10, Number(store.get('lim')) || 50));   // limite de linhas exibidas (10 a 100)

function fill(sel, vals) {
    const el = $(sel), cur = el.value; const first = el.firstElementChild.outerHTML;
    el.innerHTML = first + [...new Set(vals)].filter(Boolean).sort().map(v => `<option>${esc(v)}</option>`).join(''); el.value = cur
}

// ---- Ações: bloco de notas por ticket (texto simples; guardado neste navegador, por Sequência) ----
const NOTE_SVG = '<svg viewBox="0 0 24 24"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 13h8M8 17h5"/></svg>';
const notasOf = seq => { try { return JSON.parse(store.get('nt:' + seq) || '[]') } catch (e) { return [] } };
const notasSet = (seq, arr) => store.set('nt:' + seq, JSON.stringify(arr));
const notaBtn = r => { const n = notasOf(r.seq).length; return `<button type="button" class="notebtn${n ? ' has' : ''}" data-seq="${r.seq}" title="${n ? n + ' atualização(ões)' : 'Adicionar notas'}" aria-label="Notas do ticket ${r.seq}">${NOTE_SVG}${n ? '<b>' + n + '</b>' : ''}</button>` };
let notaSeq = 0;
function listarNotas() {
    const l = notasOf(notaSeq), box = $('#notasLista');
    box.innerHTML = l.length ? l.map((n, i) => ({ n, i })).reverse().map(({ n, i }) => `<div class="nt"><div class="mt"><span>${repoQuando(n.t)}${n.a ? ' · ' + esc(n.a) : ''}</span><button type="button" data-i="${i}" title="Remover esta atualização" aria-label="Remover atualização">×</button></div><div class="txt">${esc(n.x)}</div></div>`).join('') : '<div class="sub">Nenhuma atualização ainda.</div>';
    box.querySelectorAll('button').forEach(b => b.onclick = () => { const l2 = notasOf(notaSeq); l2.splice(Number(b.dataset.i), 1); notasSet(notaSeq, l2); listarNotas(); render() });
}
function abrirNotas(seq) {
    notaSeq = seq; const r = rows.find(x => x.seq === seq);
    $('#notasTit').textContent = 'Notas · ' + seq;
    $('#notasSub').textContent = r ? [r.pri, r.site, r.loc, hostOf(r)].filter(Boolean).join(' · ') : '';
    $('#notasTxt').value = ''; listarNotas(); $('#notas').showModal(); setTimeout(() => $('#notasTxt').focus(), 0);
}
function addNota() {
    const x = $('#notasTxt').value.trim(); if (!x) return;
    const l = notasOf(notaSeq); l.push({ t: new Date().toISOString(), a: store.get('user_name') || '', x });
    notasSet(notaSeq, l); $('#notasTxt').value = ''; listarNotas(); render();
}
$('#notasAdd').onclick = addNota;
$('#notasClose').onclick = () => $('#notas').close();
$('#notasTxt').onkeydown = e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); addNota() } };

function strip() {
    // cartões de prioridade: sempre mostram o total (não mudam quando se seleciona um grupo)
    const c = p => rows.filter(r => r.pri === p).length;
    const items = [['', 'Total', rows.length, ''], ['P0', 'P0', c('P0'), 'var(--p0)'], ['P1', 'P1', c('P1'), 'var(--p1)'], ['P2', 'P2', c('P2'), 'var(--p2)'], ['P3', 'P3', c('P3'), 'var(--p3)'], ['P4', 'P4', c('P4'), 'var(--p4)'], ['P5', 'P5', c('P5'), 'var(--p5)'], ['+24h', 'Aging +24h', rows.filter(r => r.aging === '+24h').length, 'var(--tx)']];
    $('#strip').innerHTML = items.map(([k, l, n, col]) => `<button type="button" data-k="${k}" aria-pressed="${fp === k}" style="--c:${col || 'var(--tx)'}"><b>${n}</b><span>${l}</span></button>`).join('');
    $('#strip').querySelectorAll('button').forEach(b => b.onclick = () => { fp = (fp === b.dataset.k) ? '' : b.dataset.k; render() });
}

// cartões de grupo (PI, RE, SWAP): substituem o filtro "Todos os grupos"
function strip2() {
    // cartões de grupo: se uma prioridade (ou o Aging +24h) estiver selecionada, contam só os tickets dela
    const base = rows.filter(r => fp === '+24h' ? r.aging === '+24h' : (!fp || r.pri === fp));
    const c = g => base.filter(r => r.grupo === g).length;
    $('#strip2').innerHTML = ['PI', 'RE', 'SWAP'].map(g => `<button type="button" data-g="${g}" aria-pressed="${fgr === g}" style="--c:${gcol(g)}"><b>${c(g)}</b><span>${g}</span></button>`).join('');
    $('#strip2').querySelectorAll('button').forEach(b => b.onclick = () => { fgr = (fgr === b.dataset.g) ? '' : b.dataset.g; render() });
}

function render() {
    strip(); strip2();
    fill('#uf', rows.map(r => r.uf));
    const t = Date.now();
    const list = rows.filter(r => {
        if (fp === '+24h' ? r.aging !== '+24h' : (fp && r.pri !== fp)) return false;
        if (fuf && r.uf !== fuf) return false; if (fgr && r.grupo !== fgr) return false;
        if (fs && statusKey(t - r.criacao) !== fs) return false;
        if (fq) { const s = norm([r.seq, r.raiz, r.loc, r.site, r.gestor, hostOf(r)].join(' ')); if (!s.includes(fq)) return false }
        return true;
    }).sort((a, b) => (PO[a.pri] - PO[b.pri]) || (a.criacao - b.criacao));
    $('#empty').textContent = rows.length ? 'Nenhum ticket com esses filtros.' : 'Tabela vazia. Importe uma planilha para começar.';
    $('#empty').hidden = list.length > 0;
    $('#tb').innerHTML = list.slice(0, LIM).map(r => {
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
<td>${statusCell(ms)}</td>
<td><input class="hn" data-seq="${r.seq}" value="${esc(hostOf(r))}" placeholder="${esc(hnHint(r))}" aria-label="Hostname do ticket ${r.seq}"></td>
<td class="risk${rk ? ' on' : ''}">${!hostOf(r) ? '—' : rk == null && PO[r.pri] > 2 ? '—' : rk == null && r.pri === 'P1' && Object.keys(afet5).length ? '0' : rk == null ? '<span class="muted">' + (Object.keys(afet).length + Object.keys(afet5).length ? 'sem registro' : 'sem base') + '</span>' : rk.toLocaleString('pt-BR')}</td>
<td class="act">${notaBtn(r)}</td></tr>`
    }).join('');
    $('#more').hidden = list.length <= LIM; $('#more').textContent = 'Mostrando ' + LIM + ' de ' + list.length + ' tickets. Aumente o limite ou use os filtros.';
    $('#tb').querySelectorAll('.notebtn').forEach(b => b.onclick = () => abrirNotas(Number(b.dataset.seq)));
    $('#tb').querySelectorAll('.hn').forEach(i => i.onchange = () => { store.set('hn:' + i.dataset.seq, i.value.trim()); render() });
}

// atualiza os tempos sem recriar a tabela
setInterval(() => { if (document.activeElement && document.activeElement.classList.contains('hn')) return; render() }, 60000);

$('#q').oninput = e => { fq = norm(e.target.value); render() };
$('#uf').onchange = e => { fuf = e.target.value; render() };
// filtro de Status: as opções saem de STATUS_TXT (se trocar os textos lá, o filtro acompanha)
$('#fst').innerHTML += Object.entries(STATUS_TXT).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
$('#fst').onchange = e => { fs = e.target.value; render() };
$('#lim').value = String(LIM); $('#lim').onchange = e => { LIM = Math.min(100, Math.max(10, Number(e.target.value) || 50)); store.set('lim', LIM); render() };
$('#theme').onclick = () => { const r = document.documentElement, dark = r.dataset.theme ? r.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme:dark)').matches; r.dataset.theme = dark ? 'light' : 'dark' };

$('#max').onclick = () => { const on = document.body.classList.toggle('max'); $('#max').textContent = on ? 'Restaurar tamanho' : 'Maximizar tabela'; $('#max').setAttribute('aria-pressed', on) };
document.addEventListener('keydown', e => { if (e.key === 'Escape' && document.body.classList.contains('max')) $('#max').click() });
let armT;
$('#clear').onclick = () => {
    const b = $('#clear');
    if (!b.classList.contains('arm')) { b.classList.add('arm'); b.textContent = 'Confirmar limpeza?'; armT = setTimeout(() => { b.classList.remove('arm'); b.textContent = 'Limpar tabela' }, 3500); return }
    clearTimeout(armT); b.classList.remove('arm'); b.textContent = 'Limpar tabela';
    rows = []; sbAlarme = {}; fp = fq = fuf = fgr = fs = ''; $('#q').value = ''; $('#uf').value = ''; $('#fst').value = '';
    $('#meta').textContent = 'Tabela vazia · importe uma nova planilha (.xlsx)'; render()
};

// ---- importação do .xlsx (abas BACKLOG ATUAL e AFETAÇÃO) ----
// ---- Supabase: alarme dos P1 na tabela casos_backup (para achar o hostname) ----
async function sbLoad() {
    const { url, key } = sbCfg();
    if (!url || !key) return;
    // alarme (onde está o hostname) por Sequência: P1 -> casos_backup | P2 -> fechamos_historico
    const jobs = [['casos_backup', 'P1'], ['fechamos_historico', 'P2']]
        .map(([t, p]) => [t, p, rows.filter(r => r.pri === p).map(r => r.seq)])
        .filter(j => j[2].length);
    if (!jobs.length) return;
    setInfo('p1', 'Supabase: buscando alarmes…');
    const msgs = [];
    for (const [t, p, seqs] of jobs) {
        try {
            for (let i = 0; i < seqs.length; i += 100) {
                const res = await fetch(`${url}/rest/v1/${t}?select=sequencia,alarme&sequencia=in.(${seqs.slice(i, i + 100).join(',')})`, { headers: { apikey: key, Authorization: 'Bearer ' + key } });
                if (!res.ok) throw new Error('HTTP ' + res.status);
                (await res.json()).forEach(x => { sbAlarme[x.sequencia] = x.alarme || '' });
            }
            msgs.push(p + ': ' + seqs.filter(q => sbAlarme[q]).length + '/' + seqs.length + ' em ' + t);
        } catch (err) { msgs.push(p + ': erro em ' + t + ' (' + err.message + ')') }
    }
    setInfo('p1', 'Supabase · ' + msgs.join(' · '));
    render();
}
$('#sbbtn').onclick = () => { const c = sbCfg(); $('#sburl').value = c.url; $('#sbkey').value = c.key; $('#sbnome').value = store.get('user_name') || ''; $('#cfg').showModal() };
$('#sbclose').onclick = () => $('#cfg').close();
$('#sbsave').onclick = () => { store.set('sb_url', $('#sburl').value.trim()); store.set('sb_key', $('#sbkey').value.trim()); store.set('user_name', $('#sbnome').value.trim()); $('#cfg').close(); sbAfet(); sbLoad(); repoUltima() };

// ---- Supabase: base de afetação (tabela afetacao_hl4, soma de clientes por hostname) ----
const st = {}; const setInfo = (k, v) => { st[k] = v; $('#info').textContent = Object.values(st).filter(Boolean).join(' · ') };
async function sbTable(url, key, path) {
    const out = [];
    for (let o = 0; ; o += 1000) {
        const res = await fetch(`${url}/rest/v1/${path}&limit=1000&offset=${o}`, { headers: { apikey: key, Authorization: 'Bearer ' + key } });
        if (!res.ok) throw new Error(path.split('?')[0] + ' HTTP ' + res.status);
        const p = await res.json(); out.push(...p); if (p.length < 1000) break;
    }
    return out;
}
async function sbAfet() {
    const { url, key } = sbCfg(); if (!url || !key) return;
    const m = {}, m5 = {}, ix = {}, pm = {}; let erro = '';
    setInfo('afet', 'Supabase: carregando a afetação…');
    try {
        (await sbTable(url, key, 'afetacao_hl4?select=hostname,p2_codigo,clientes&order=id')).forEach(x => {
            const h = norm(x.hostname); if (!h) return; const c = Number(x.clientes) || 0; m[h] = (m[h] || 0) + c;
            const k = norm(x.p2_codigo); if (k && k !== '-' && (!pm[k] || c > pm[k].cli)) pm[k] = { host: h, cli: c };   // código repetido: vale a linha com mais clientes
        });
    }
    catch (err) { erro += ' · ' + err.message }
    try {
        (await sbTable(url, key, 'afetacao_hl5d?select=hostname,site,afetacao&order=id')).forEach(x => {
            const h = norm(x.hostname); if (!h) return; m5[h] = (m5[h] || 0) + (Number(x.afetacao) || 0);
            [norm(x.site), (h.match(/-([a-z0-9]{3})-hl5d?-/) || [])[1]].filter(Boolean).forEach(s => { (ix[s] = ix[s] || []); if (!ix[s].includes(h)) ix[s].push(h) })
        })
    }
    catch (err) { erro += ' · ' + err.message }
    // afetação por código P2 (tabela afetacao_p2): é o número que vale para o P2; se a tabela não existir, ficam os valores da afetacao_hl4
    try {
        (await sbTable(url, key, 'afetacao_p2?select=p2_codigo,afetacao&order=p2_codigo')).forEach(x => {
            const k = norm(x.p2_codigo); if (!k || k === '-') return; const a = Number(x.afetacao) || 0;
            if (pm[k]) pm[k].cli = a; else pm[k] = { host: '', cli: a };
        });
    } catch (err) { erro += ' · ' + err.message }
    afet = m; afet5 = m5; p2map = pm; siteIdx = ix;
    setInfo('afet', 'Afetação: ' + Object.keys(m).length + ' HL4 + ' + Object.keys(m5).length + ' HL5D · ' + Object.keys(pm).length + ' códigos P2 (Supabase)' + (erro ? ' · erro' + erro : '')); render();
}

// ---- Repositório de bases (tabela bases_importadas no Supabase) ----
// Ao importar uma planilha, a base é guardada lá; ao abrir o painel, a última base guardada é carregada.
let importouAgora = false;   // true depois que o usuário importa/escolhe uma base nesta sessão (a "última" não sobrescreve)
const repoHeaders = (key, extra) => ({ apikey: key, Authorization: 'Bearer ' + key, ...extra });
const repoQuando = d => new Date(d).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
async function repoSalvar(nome) {
    const { url, key } = sbCfg(); if (!url || !key) return;
    try {
        const tickets = rows.map(r => ({ ...r, alarme: String(r.alarme || '').slice(0, 2000) }));
        const res = await fetch(`${url}/rest/v1/bases_importadas`, { method: 'POST', headers: repoHeaders(key, { 'Content-Type': 'application/json', Prefer: 'return=minimal' }), body: JSON.stringify({ nome_arquivo: nome, importado_por: store.get('user_name') || 'anônimo', importado_em: new Date().toISOString(), total_tickets: rows.length, tickets }) });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        setInfo('repo', 'Repositório: base salva');
    } catch (err) { setInfo('repo', 'Repositório: não salvou (' + err.message + ')') }
}
function aplicarBase(b) {
    rows = (b.tickets || []).map(t => ({ ...t, criacao: new Date(t.criacao) })).filter(r => r.seq > 0 && !isNaN(r.criacao));
    fp = fuf = fgr = ''; sbAlarme = {};
    $('#meta').textContent = 'Repositório: ' + b.nome_arquivo + ' · ' + rows.length + ' tickets · importada por ' + (b.importado_por || '—') + ' em ' + repoQuando(b.importado_em);
    render(); sbLoad();
}
async function repoUltima() {
    const { url, key } = sbCfg(); if (!url || !key) return;
    try {
        const res = await fetch(`${url}/rest/v1/bases_importadas?select=nome_arquivo,importado_por,importado_em,total_tickets,tickets&order=importado_em.desc&limit=1`, { headers: repoHeaders(key) });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const [b] = await res.json();
        if (!b) { setInfo('repo', 'Repositório: vazio'); return }
        if (importouAgora) return;
        aplicarBase(b); setInfo('repo', 'Repositório: última base carregada');
    } catch (err) { setInfo('repo', 'Repositório: não carregou (' + err.message + ')') }
}
async function repoLista() {
    const { url, key } = sbCfg(), box = $('#baseslista');
    if (!url || !key) { box.textContent = 'Configure o Supabase primeiro (botão Supabase).'; return }
    box.textContent = 'Carregando…';
    try {
        const res = await fetch(`${url}/rest/v1/bases_importadas?select=id,nome_arquivo,importado_por,importado_em,total_tickets&order=importado_em.desc&limit=20`, { headers: repoHeaders(key) });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const l = await res.json();
        box.innerHTML = l.length ? l.map(b => `<div class="bl"><div><b>${esc(b.nome_arquivo)}</b><br><span class="sub">${esc(b.importado_por || '—')} · ${repoQuando(b.importado_em)} · ${b.total_tickets} tickets</span></div><button type="button" data-id="${b.id}">Carregar</button></div>`).join('') : 'Nenhuma base guardada ainda.';
        box.querySelectorAll('button').forEach(btn => btn.onclick = async () => {
            btn.textContent = '…';
            try {
                const r2 = await fetch(`${url}/rest/v1/bases_importadas?id=eq.${btn.dataset.id}&select=nome_arquivo,importado_por,importado_em,total_tickets,tickets`, { headers: repoHeaders(key) });
                if (!r2.ok) throw new Error('HTTP ' + r2.status);
                const [b] = await r2.json(); importouAgora = true; aplicarBase(b); $('#bases').close();
            } catch (err) { btn.textContent = 'erro: ' + err.message }
        });
    } catch (err) { box.textContent = 'Erro ao listar: ' + err.message }
}
$('#basesbtn').onclick = () => { $('#bases').showModal(); repoLista() };
$('#basesclose').onclick = () => $('#bases').close();

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
        const build = js => js.map(o => ({ seq: num(pick(o, 'Sequencia', 'Sequência', 'Ticket', 'Nº Ticket', 'Numero')), raiz: num(pick(o, 'SequenciaRaiz', 'Sequência Raiz', 'Raiz')), pri: String(pick(o, 'Prioridade')).trim().toUpperCase(), aging: pick(o, 'Aging'), grupo: pick(o, 'Grupo Responsável', 'Grupo'), loc: pick(o, 'Localidade'), gestor: pick(o, 'Gestor Atual', 'Gestor'), uf: pick(o, 'UF'), site: pick(o, 'Sigla Site', 'Site'), criacao: toDate(pick(o, 'DataCriacao', 'Data Criação', 'Criação')), alarme: String(pick(o, 'Alarme')), sloc: String(pick(o, 'SiglaLocalidade')) })).filter(r => r.seq > 0 && !isNaN(r.criacao));
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
        fp = fuf = fgr = ''; render(); sbLoad(); importouAgora = true; repoSalvar(f.name);   // importar > salva a base e registra a hora
    } catch (err) { $('#meta').textContent = 'Não consegui ler o arquivo: ' + err.message }
    e.target.value = '';
};
// mensagens de status (afetação, Supabase, importação) ficam escondidas; só aparecem quando há erro
['#info', '#meta'].forEach(sel => new MutationObserver(() => $(sel).classList.toggle('err', /erro|não consegui|não carregou|não salvou|nenhuma linha/i.test($(sel).textContent))).observe($(sel), { childList: true, characterData: true, subtree: true }));
render();
sbAfet();
repoUltima();