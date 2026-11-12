/* Planejamento Familiar — interface. Dados 100% locais (IndexedDB). */
(function () {
  'use strict';
  const L = window.Logic, DB = window.DB;
  const $ = (s, r) => (r || document).querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const brl = L.brl;
  const num = (v) => { const n = parseFloat(String(v).replace(',', '.')); return isNaN(n) ? 0 : n; };
  const n2 = (v) => Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  const MES_CURTO = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  const fmtData = (iso) => (iso ? iso.split('-').reverse().join('/') : '');
  const diaMes = (iso) => ({ dia: iso.slice(8, 10), mes: MES_CURTO[+iso.slice(5, 7) - 1] });
  const uid = () => (window.crypto && crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2, 8));
  const hoje = () => L.todayISO();
  const shiftYM = (ym, n) => L.addMonths(ym + '-01', n).slice(0, 7);
  const labelYM = (ym) => `${MESES[+ym.slice(5, 7) - 1]} ${ym.slice(0, 4)}`;
  const firstKey = (d) => (d.recorrente ? d.vencimento.slice(0, 7) : 'u');
  const lsGet = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } };

  const state = { tab: 'resumo', ym: hoje().slice(0, 7), ano: +hoje().slice(0, 4), filtro: 'todas', g: { periodo: 'mes', data: hoje(), formas: [], tipos: [] }, gOpen: new Set(), dividas: [], rendas: [], compras: [], cfg: { hora: '09:00' } };
  let cur = null; // ocorrência de dívida aberta no sheet
  let curR = null; // ocorrência de receita aberta no sheet
  let installEvt = null;

  // ---------- util de UI ----------
  const sheet = $('#sheet');
  const openSheet = (html) => { $('#sheetBody').innerHTML = html; if (!sheet.open) sheet.showModal(); sheet.scrollTop = 0; };
  const closeSheet = () => { if (sheet.open) sheet.close(); };
  let toastTimer = null;
  function toast(msg, label, fn) {
    const t = $('#toast');
    t.innerHTML = `<span>${esc(msg)}</span>${label ? `<button id="toastBtn">${esc(label)}</button>` : ''}`;
    t.classList.add('show');
    if (label) $('#toastBtn').onclick = () => { t.classList.remove('show'); fn(); };
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 7000);
  }
  function baixar(file) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(file); a.download = file.name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  // ---------- dados ----------
  async function reload() {
    state.dividas = await DB.all('dividas');
    state.rendas = await DB.all('rendas');
    state.compras = await DB.all('compras');
    state.cfg = Object.assign({ hora: '09:00' }, await DB.getConfig());
  }
  async function pedirPersistencia() { try { if (navigator.storage && navigator.storage.persist) await navigator.storage.persist(); } catch (e) { /* ignore */ } }

  // ---------- componentes ----------
  const monthNav = (label, act) => `<div class="monthnav"><button class="iconbtn" data-act="${act}" data-n="-1" aria-label="Anterior">‹</button><strong>${esc(label)}</strong><button class="iconbtn" data-act="${act}" data-n="1" aria-label="Próximo">›</button></div>`;
  const CHIP = { pago: 'Pago', atrasado: 'Atrasado', hoje: 'Vence hoje', aberto: 'Em aberto' };

  function itemOcc(o) {
    const { dia, mes } = diaMes(o.venc);
    const sub = [o.d.tipo, o.d.responsavel, o.label && o.label !== 'Mensal' ? o.label : ''].filter(Boolean).join(' · ');
    const enc = o.enc.total > 0 ? `<small class="neg-t">+${brl(o.enc.total)} de juros</small>` : '';
    const semValor = o.estimado && o.valor <= 0;
    const valTxt = semValor ? (o.enc.total > 0 ? brl(o.total) : '—') : (o.estimado ? '~' : '') + brl(o.total);
    const est = o.estimado ? `<small style="color:var(--amber)">${semValor ? 'informe o valor' : 'valor estimado'}</small>` : '';
    return `<button class="item ${o.status}" data-act="occ" data-id="${esc(o.debtId)}" data-key="${esc(o.key)}">
      <div class="day">${dia}<small>${mes}</small></div>
      <div class="main"><b>${esc(o.d.nome)}</b><span>${esc(sub)}</span></div>
      <div class="val">${valTxt}<small><span class="chip ${o.status}">${CHIP[o.status]}</span></small>${est}${enc}</div></button>`;
  }
  function itemRenda(o) {
    const { dia, mes } = diaMes(o.data);
    const sub = [o.r.tipo, o.r.responsavel, o.r.recorrente ? (o.r.tipoValor === 'variavel' ? 'Mensal variável' : 'Mensal') : ''].filter(Boolean).join(' · ');
    const semValor = o.estimado && o.valor <= 0;
    return `<button class="item" data-act="renda" data-id="${esc(o.rendaId)}" data-key="${esc(o.key)}">
      <div class="day" style="background:var(--green-soft);color:var(--green)">${dia}<small>${mes}</small></div>
      <div class="main"><b>${esc(o.r.descricao)}</b><span>${esc(sub)}</span></div>
      <div class="val pos-t">${semValor ? '—' : (o.estimado ? '~' : '') + brl(o.valor)}${o.estimado ? `<small style="color:var(--amber)">${semValor ? 'informe o valor' : 'valor estimado'}</small>` : ''}</div></button>`;
  }
  // Editor de reajustes (mês a partir do qual o valor muda) — usado em dívidas e receitas.
  function reajRow(r) {
    return `<div class="reajrow"><input type="month" name="reajMes" value="${esc((r && r.desde) || '')}" aria-label="A partir do mês"><input type="number" name="reajValor" step="0.01" min="0" inputmode="decimal" placeholder="Novo valor (R$)" value="${esc(r && r.valor != null ? r.valor : '')}" aria-label="Novo valor"><button type="button" class="iconbtn" data-act="delReaj" aria-label="Remover">✕</button></div>`;
  }
  function reajEditor(lista) {
    return `<div class="box" id="wrapReaj"><b>Reajustes de valor</b><p class="hint" style="margin:2px 0 8px">Para quando o valor mudar (novo ano, fim de contrato). Informe o mês em que o novo valor começa a valer.</p><div id="reajList">${(lista || []).map(reajRow).join('')}</div><button type="button" class="btn alt" data-act="addReaj" style="margin-top:0">+ Adicionar reajuste</button></div>`;
  }
  function lerReajustes(form) {
    const meses = [...form.querySelectorAll('input[name=reajMes]')], vals = [...form.querySelectorAll('input[name=reajValor]')];
    const mapa = {}; let erro = false;
    meses.forEach((m, i) => {
      const vv = vals[i].value;
      if (!m.value && vv === '') return;
      if (!m.value || vv === '') { erro = true; return; }
      mapa[m.value] = { desde: m.value, valor: num(vv) };
    });
    return { erro, lista: Object.values(mapa).sort((a, b) => a.desde.localeCompare(b.desde)) };
  }

  const svg = (inner, sz) => `<svg width="${sz || 20}" height="${sz || 20}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
  const ICO = {
    credito: svg('<rect x="2.5" y="5" width="19" height="14" rx="3"/><path d="M2.5 10h19M6 15h4"/>'),
    debito: svg('<path d="M4 7h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4z"/><path d="M4 7V6a2 2 0 0 1 2-2h10"/><path d="M16 14h2"/>'),
    pix: svg('<path d="M12 3l5 5-5 5-5-5z"/><path d="M12 11l5 5-5 5-5-5z"/>'),
  };
  const DIAS_SEM = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
  const diaSem = (iso) => DIAS_SEM[L.parseISO(iso).getDay()];
  const compacto = (v) => (v >= 1000 ? (v / 1000).toFixed(v >= 10000 ? 0 : 1).replace('.', ',') + ' mil' : String(Math.round(v)));
  const CHEV = svg('<path d="M6 9l6 6 6-6"/>', 18).replace('<svg ', '<svg class="chev" ');
  const FUNIL = svg('<path d="M3 5h18l-7 8v6l-4 2v-8z"/>', 20);

  // Gráfico de barras (diário no mês/dia; mensal no ano). Toque numa barra para detalhar.
  function barChart(pts, o) {
    const base = 112, alt = 92, n = pts.length, slot = 340 / n, bw = Math.max(4, slot - (n > 20 ? 2.5 : 9));
    const max = Math.max(1, ...pts.map((p) => p.valor));
    let g = '<defs><linearGradient id="gBar" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#a78bfa"/><stop offset="1" stop-color="#3b82f6"/></linearGradient></defs>';
    [0.5, 1].forEach((f) => { g += `<line x1="10" x2="350" y1="${base - alt * f}" y2="${base - alt * f}" style="stroke:var(--line-soft)"/>`; });
    g += `<text x="10" y="${base - alt - 4}">R$ ${compacto(max)}</text>`;
    pts.forEach((p, i) => {
      const x = 10 + i * slot + (slot - bw) / 2, hh = p.valor > 0 ? Math.max(3, (p.valor / max) * alt) : 0, sel = p.chave === o.sel;
      if (hh) g += `<rect x="${x.toFixed(1)}" y="${(base - hh).toFixed(1)}" width="${bw.toFixed(1)}" height="${hh.toFixed(1)}" rx="${Math.min(3, bw / 2).toFixed(1)}" fill="${sel ? '#f5f3ff' : 'url(#gBar)'}"/>`;
      if (p.rot) g += `<text x="${(x + bw / 2).toFixed(1)}" y="${base + 14}" text-anchor="middle" style="${sel ? 'fill:#fff;font-weight:700' : ''}">${p.rot}</text>`;
      if (p.hoje) g += `<circle cx="${(x + bw / 2).toFixed(1)}" cy="${base + 22}" r="2.5" style="fill:var(--violet-2)"/>`;
      g += `<rect x="${(10 + i * slot).toFixed(1)}" y="${base - alt}" width="${slot.toFixed(1)}" height="${alt + 18}" fill="transparent" style="cursor:pointer" data-act="${o.act}" data-d="${p.data}"/>`;
    });
    return `<svg class="chart" viewBox="0 0 360 ${base + 28}" role="img" aria-label="${esc(o.aria)}">${g}</svg>`;
  }

  // Detalhes de um lançamento (aparece ao tocar no cartão).
  function detalheHtml(i) {
    const c = i.c, rows = [['Data da compra', fmtData(c.data)], ['Forma de pagamento', L.FORMAS[c.forma]], ['Tipo de compra', c.tipo]];
    if (c.descricao) rows.push(['Descrição', c.descricao]);
    rows.push(['Valor da compra', brl(c.valor)]);
    if (c.forma === 'credito') {
      const calc = L.calcParcelamento(c.valor, c.parcelas, c.valorParcela);
      if (calc.n > 1) {
        const rest = L.itensCompra(c, state.cfg).filter((x) => x.n > i.n);
        rows.push(['Parcelamento', `${calc.n}x de ${brl(calc.parcela)}`],
          ['Juros informados', c.jurosManual > 0 ? brl(c.jurosManual) : 'Não informado'],
          ['Esta parcela', `${i.n} de ${i.de} · ${fmtData(i.venc)}`],
          ['Parcelas restantes', rest.length ? `${rest.length} (${brl(L.round2(rest.reduce((s2, x) => s2 + x.valor, 0)))})` : 'Nenhuma, é a última']);
      } else rows.push(['Vencimento', fmtData(i.venc)]);
    }
    return `<dl class="gd">${rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
      <div class="row2"><button class="btn alt" data-act="compra" data-id="${esc(c.id)}">✏️ Editar</button><button class="btn danger" data-act="delCompra" data-id="${esc(c.id)}">Excluir</button></div>`;
  }
  // Cada lançamento mostra o valor DA PARCELA daquele mês (não o total da compra).
  function gItem(i) {
    const c = i.c, k = i.compraId + ':' + i.key, open = state.gOpen.has(k);
    const sub = [L.FORMAS[c.forma], i.de > 1 ? `Parcela ${i.n}/${i.de}` : (c.forma === 'credito' ? 'À vista' : ''), c.descricao].filter(Boolean).join(' · ');
    return `<div class="gitem${open ? ' open' : ''}" style="--tc:${L.corTipo(c.tipo)}" data-k="${esc(k)}">
      <button class="ghead" data-act="toggleG" aria-expanded="${open}"><span class="dot"></span>
        <span class="main"><b>${esc(c.tipo)}</b><span>${esc(sub)}</span></span>
        <span class="val">${brl(i.valor)}<small>${i.de > 1 ? `parcela ${i.n}/${i.de}` : fmtData(i.venc).slice(0, 5)}</small></span>${CHEV}</button>
      <div class="gdetail" ${open ? '' : 'hidden'}>${detalheHtml(i)}</div></div>`;
  }
  function sheetFiltro() {
    const g = state.g;
    openSheet(`<h3>Filtrar gastos</h3><form id="fFiltro">
      <div class="field"><span>Forma de pagamento</span><div class="fchips">${['credito', 'debito', 'pix'].map((k) => `<label class="fchip"><input type="checkbox" name="forma" value="${k}" ${g.formas.includes(k) ? 'checked' : ''}><span>${ICO[k]}${L.FORMAS[k]}</span></label>`).join('')}</div></div>
      <div class="field"><span>Tipo de compra</span><div class="fchips">${L.tiposUsados(state.compras).map((t) => `<label class="fchip"><input type="checkbox" name="tipo" value="${esc(t)}" ${g.tipos.includes(t) ? 'checked' : ''}><span><i class="dot" style="background:${L.corTipo(t)}"></i>${esc(t)}</span></label>`).join('')}</div></div>
      <p class="hint">Sem nenhuma seleção, todos os gastos aparecem.</p>
      <div class="btns"><button class="btn" type="submit">Aplicar filtro</button><button class="btn alt" type="button" data-act="limparFiltroG">Limpar filtros</button><button class="btn alt" type="button" data-act="fechar">Cancelar</button></div></form>`);
  }

  // ---------- views ----------
  const views = {
    resumo() {
      const h = hoje();
      const r = L.resumoMes(state.dividas, state.rendas, state.ym, h, state.compras, state.cfg);
      const atras = L.atrasadas(state.dividas, h), hojeL = L.vencendoHoje(state.dividas, h);
      let html = '';
      if (hojeL.length) html += `<div class="banner amber">⏰ <div><b>Vence hoje:</b> ${hojeL.map((o) => esc(o.d.nome) + ' (' + brl(o.total) + ')').join(', ')}</div></div>`;
      if (atras.length) html += `<div class="banner red">⚠️ <div><b>${atras.length} em atraso</b> · ${brl(atras.reduce((s2, o) => s2 + o.total, 0))}. Veja na aba Dívidas.</div></div>`;
      html += monthNav(labelYM(state.ym), 'mes');
      if (!state.dividas.length && !state.rendas.length && !state.compras.length) {
        return html + `<div class="card empty">Comece lançando seus <b>gastos</b>, <b>dívidas</b> e <b>receitas</b>.<br><br><div class="btns"><button class="btn" data-act="novoGasto">Lançar um gasto</button><button class="btn alt" data-act="novaDivida">Cadastrar uma dívida</button></div></div>`;
      }
      const [yy, mm] = state.ym.split('-').map(Number);
      const ymAnt = mm === 1 ? `${yy - 1}-12` : `${yy}-${String(mm - 1).padStart(2, '0')}`;
      const ant = L.resumoMes(state.dividas, state.rendas, ymAnt, h, state.compras, state.cfg);
      const gp = r.gastosPorForma;
      // Gastos = Pix + débito + contas pagas (bate com o extrato do banco). Cartão entra só no saldo projetado.
      const gastosTile = L.round2(gp.pix + gp.debito + r.pago);
      const gastosTileAnt = L.round2(ant.gastosPorForma.pix + ant.gastosPorForma.debito + ant.pago);
      const saldoAtual = L.round2(r.receitas - r.pago - gp.pix - gp.debito);
      const saldoProj = L.round2(saldoAtual - gp.credito);
      const vsAnt = (a, b) => (b > 0 ? `${a >= b ? '▲' : '▼'} ${Math.abs(Math.round(((a - b) / b) * 100))}% vs mês anterior` : 'sem dados do mês anterior');
      const pctGastos = r.receitas > 0 ? Math.min(100, Math.round((gastosTile / r.receitas) * 100)) : 0;
      const pctContas = r.qtd ? Math.round((r.qtdPagas / r.qtd) * 100) : 0;
      const ordem = { atrasado: 0, hoje: 1, aberto: 2, pago: 3 };
      const occs = r.occs.slice().sort((x, y) => (ordem[x.status] - ordem[y.status]) || x.venc.localeCompare(y.venc));
      const chip = (s) => ({ atrasado: '<span class="chip red">Atrasada</span>', hoje: '<span class="chip amber">Vence hoje</span>', aberto: '<span class="chip blue">A vencer</span>', pago: '<span class="chip green">Paga</span>' })[s] || '';
      const semanas = [[1, 7, '1–7'], [8, 14, '8–14'], [15, 21, '15–21'], [22, 31, '22+']];
      const bk = semanas.map(([a, b]) => L.round2(r.itensGastos.filter((i) => { const d = +i.venc.slice(8, 10); return d >= a && d <= b; }).reduce((s2, i) => s2 + i.valor, 0)));
      const maxB = Math.max(1, ...bk);
      const ult = r.itensGastos.slice().sort((x, y) => (y.c.criadoEm || 0) - (x.c.criadoEm || 0)).slice(0, 5);
      html += `<div class="hero"><div class="hero-top"><small>Saldo atual</small><small>${MESES[mm - 1]}</small></div>
        <b>${brl(saldoAtual)}</b><span class="hero-sub">Projetado com cartão de crédito: ${brl(saldoProj)}</span></div>`;
      if (r.estimados) html += `<div class="banner blue">ℹ️ <div>${r.estimados} lançamento(s) deste mês com <b>valor variável ainda não informado</b>. Toque neles para informar o valor real.</div></div>`;
      html += `<div class="tiles">
        <div class="tile green"><small>Receitas</small><b>${brl(r.receitas)}</b><span>${vsAnt(r.receitas, ant.receitas)}</span></div>
        <div class="tile red"><small>Gastos</small><b>${brl(gastosTile)}</b><span class="brk">Pix ${brl(gp.pix)} · Débito ${brl(gp.debito)} · Contas ${brl(r.pago)}</span><span>${vsAnt(gastosTile, gastosTileAnt)}</span></div></div>`;
      html += `<div class="card"><h2>Visão geral do mês</h2>
        <div class="meter"><div><small>Gastos sobre receitas</small><b>${pctGastos}%</b></div><div class="progress"><i style="width:${pctGastos}%"></i></div></div>
        <div class="meter"><div><small>Contas pagas</small><b>${r.qtdPagas} de ${r.qtd}</b></div><div class="progress"><i style="width:${pctContas}%"></i></div></div></div>`;
      html += `<div class="card"><h2>Dívidas do mês</h2>${occs.length ? occs.map((o) => `<div class="drow"><div><b>${esc(o.d.nome)}</b><small>${fmtData(o.venc).slice(0, 5)}${o.d.tipo ? ' · ' + esc(o.d.tipo) : ''}</small></div><div class="dright"><b>${brl(o.total)}</b>${chip(o.status)}</div></div>`).join('') : '<p class="hint">Nenhuma dívida neste mês.</p>'}</div>`;
      html += `<div class="card"><h2>Gastos por semana</h2><div class="wk">${bk.map((v, i) => `<div title="${brl(v)}"><i style="height:${Math.round((v / maxB) * 100)}%"></i><small>${semanas[i][2]}</small></div>`).join('')}</div></div>`;
      html += `<div class="card"><h2>Últimas transações</h2>${ult.length ? ult.map((i) => `<div class="trx"><span class="ico">${ICO[i.c.forma] || ''}</span><div><b>${esc(i.c.tipo || 'Compra')}</b><small>${fmtData(i.c.data).slice(0, 5)} · ${L.FORMAS[i.c.forma]}${i.c.parcelas > 1 ? ` · parcela ${i.n}/${i.c.parcelas}` : ''}</small></div><b class="tv">${brl(i.valor)}</b></div>`).join('') : '<p class="hint">Nenhum gasto neste mês.</p>'}</div>`;
      return html;
    },

    gastos() {
      const g = state.g, h = hoje(), P = g.periodo;
      const A = L.analiseGastos(state.compras, state.cfg, g, h);
      const label = P === 'dia' ? `${diaSem(g.data)}, ${fmtData(g.data)}` : P === 'mes' ? labelYM(g.data.slice(0, 7)) : g.data.slice(0, 4);
      const nFiltros = g.formas.length + g.tipos.length;
      let html = `<div class="toolbar"><div class="segment">${[['dia', 'Dia'], ['mes', 'Mês'], ['ano', 'Ano']].map(([k, t]) => `<button class="${P === k ? 'on' : ''}" data-act="periodoG" data-v="${k}">${t}</button>`).join('')}</div>
        <button class="filterbtn${nFiltros ? ' on' : ''}" data-act="filtroG" aria-label="Filtrar">${FUNIL}${nFiltros ? `<i class="badge">${nFiltros}</i>` : ''}</button></div>`;
      if (nFiltros) html += `<div class="achips">${[...g.formas.map((k) => ['forma', k, L.FORMAS[k]]), ...g.tipos.map((t) => ['tipo', t, t])].map(([k, v, t]) => `<button class="achip" data-act="rmF" data-k="${k}" data-v="${esc(v)}">${esc(t)} ✕</button>`).join('')}</div>`;
      html += `<div class="monthnav"><button class="iconbtn" data-act="navG" data-n="-1" aria-label="Anterior">‹</button><strong>${esc(label)}</strong><button class="iconbtn" data-act="navG" data-n="1" aria-label="Próximo">›</button></div>`;

      const nomeP = { dia: 'do dia', mes: 'do mês', ano: 'do ano' }[P], antP = { dia: 'dia anterior', mes: 'mês anterior', ano: 'ano anterior' }[P];
      let delta = '';
      if (A.total > 0 || A.totalAnt > 0) {
        delta = A.totalAnt > 0 ? `<span class="delta ${A.delta > 0 ? 'up' : 'down'}">${A.delta > 0 ? '▲' : '▼'} ${brl(Math.abs(A.delta))}${A.deltaPct != null ? ` (${Math.abs(A.deltaPct).toFixed(0)}%)` : ''} vs ${antP}</span>`
          : `<span class="delta">sem gastos no ${antP}</span>`;
      }
      html += `<div class="card"><h2>Gastos ${nomeP}</h2><b class="big">${brl(A.total)}</b>${delta}<span class="sub">${A.qtd} lançamento(s)${P === 'ano' ? '' : ' · crédito parcelado mostra só a parcela'}</span>
        <div class="pillrow">${['credito', 'debito', 'pix'].map((k) => `<span class="pill">${ICO[k]}${L.FORMAS[k]} <b>${brl(A.porForma[k])}</b></span>`).join('')}</div>
        ${A.media != null ? `<div class="grid2"><div class="mini"><small>${A.mediaRotulo}</small><b>${brl(A.media)}</b></div><div class="mini"><small>Maior ${P === 'ano' ? 'mês' : 'dia'}</small><b>${A.maior && A.maior.valor > 0 ? brl(A.maior.valor) : '—'}</b>${A.maior && A.maior.valor > 0 ? `<small>${P === 'ano' ? MESES[+A.maior.data.slice(5, 7) - 1] : fmtData(A.maior.data).slice(0, 5)}</small>` : ''}</div></div>` : ''}</div>`;

      const ym = g.data.slice(0, 7), hoyKey = P === 'ano' ? h.slice(0, 7) : h;
      const pts = A.serie.map((p, i) => P === 'ano'
        ? { data: p.data, chave: p.ym, valor: p.valor, rot: MES_CURTO[i], hoje: p.ym === hoyKey }
        : { data: p.data, chave: p.data, valor: p.valor, rot: (i + 1 === 1 || (i + 1) % 5 === 0) ? String(i + 1) : '', hoje: p.data === hoyKey });
      html += `<div class="card"><h2>${P === 'ano' ? 'Gastos por mês' : 'Gastos por dia · ' + esc(MESES[+ym.slice(5, 7) - 1])}</h2>${barChart(pts, { sel: P === 'dia' ? g.data : null, act: P === 'ano' ? 'mesG' : 'diaG', aria: 'Gráfico de gastos' })}
        <p class="hint" style="margin:6px 0 0">Toque em uma barra para ${P === 'ano' ? 'abrir o mês' : 'ver o dia'}.</p></div>`;

      if (A.porTipo.length) {
        html += `<div class="card"><h2>Onde mais gastei</h2><div class="stack">${A.porTipo.map((t) => `<i style="flex:${t.valor};background:${t.cor}" title="${esc(t.tipo)}"></i>`).join('')}</div>
          ${A.porTipo.map((t) => `<div class="trow"><span class="dot" style="background:${t.cor}"></span><span class="tn">${esc(t.tipo)}</span><span class="tp">${t.pct.toFixed(0)}%</span><b>${brl(t.valor)}</b></div>`).join('')}</div>`;
      }

      if (!A.items.length) return html + `<div class="card empty">Nenhum gasto ${P === 'dia' ? 'neste dia' : P === 'mes' ? 'neste mês' : 'neste ano'}${nFiltros ? ' com esses filtros' : ''}.<br><br><button class="btn" data-act="novoGasto">+ Lançar gasto</button></div>`;
      if (P === 'ano') {
        const max = Math.max(1, ...A.serie.map((p) => p.valor));
        return html + `<h2 class="sec">Mês a mês</h2><div class="list">${A.serie.map((p, i) => (p.valor > 0 ? `<button class="item" data-act="mesG" data-d="${p.data}"><div class="day">${MES_CURTO[i]}<small>${g.data.slice(0, 4)}</small></div>
          <div class="main"><b style="text-transform:capitalize">${MESES[i]}</b><div class="mbar"><i style="width:${Math.round((p.valor / max) * 100)}%"></i></div></div><div class="val">${brl(p.valor)}<small>${p.n} lançamento(s)</small></div></button>` : '')).join('')}</div>`;
      }
      const itens = A.items.slice().sort((x, y) => y.venc.localeCompare(x.venc) || (y.c.criadoEm || 0) - (x.c.criadoEm || 0));
      if (P === 'dia') return html + `<h2 class="sec">Lançamentos</h2><div class="list">${itens.map(gItem).join('')}</div>`;
      const dias = [...new Set(itens.map((i) => i.venc))];
      return html + `<h2 class="sec">Lançamentos</h2>` + dias.map((d) => {
        const doDia = itens.filter((i) => i.venc === d), tot = L.round2(doDia.reduce((s2, i) => s2 + i.valor, 0));
        return `<div class="dayhead"><span>${diaSem(d)}, ${fmtData(d).slice(0, 5)}</span><b>${brl(tot)}</b></div><div class="list" style="margin-bottom:10px">${doDia.map(gItem).join('')}</div>`;
      }).join('');
    },

    dividas() {
      const h = hoje();
      const r = L.resumoMes(state.dividas, state.rendas, state.ym, h);
      let occs = r.occs;
      if (state.filtro === 'abertas') occs = occs.filter((o) => o.status !== 'pago');
      if (state.filtro === 'pagas') occs = occs.filter((o) => o.status === 'pago');
      const seg = ['todas', 'abertas', 'pagas'].map((f) => `<button class="${state.filtro === f ? 'on' : ''}" data-act="filtro" data-v="${f}">${{ todas: 'Todas', abertas: 'Em aberto', pagas: 'Pagas' }[f]}</button>`).join('');
      let html = monthNav(labelYM(state.ym), 'mes') + `<div class="segment">${seg}</div>`;
      html += `<div class="card"><h2>Total do mês</h2><b style="font-size:22px">${brl(r.dividas)}</b><div class="progress"><i style="width:${r.dividas ? Math.round((r.pago / r.dividas) * 100) : 0}%"></i></div><small style="color:var(--muted)">Pago ${brl(r.pago)} · Falta ${brl(r.aberto + r.atrasado)}</small></div>`;
      html += occs.length ? `<div class="list">${occs.map(itemOcc).join('')}</div>` : `<div class="card empty">Nenhuma dívida neste filtro/mês.</div>`;
      const emps = state.dividas.filter(L.isEmprestimo);
      if (emps.length) {
        html += `<h2 style="font-size:15px;color:var(--muted);margin:18px 0 8px">Empréstimos e financiamentos</h2>`;
        html += emps.map((d) => {
          const i = L.infoEmprestimo(d);
          return `<button class="item" style="flex-direction:column;align-items:stretch" data-act="editDivida" data-id="${esc(d.id)}">
            <div style="display:flex;justify-content:space-between"><b>${esc(d.nome)}</b><span>${i.pagas}/${i.total} pagas</span></div>
            <div class="progress"><i style="width:${i.progresso}%"></i></div>
            <span style="color:var(--muted);font-size:13px">Parcela ${brl(d.valorParcela)} · juros ${n2(d.jurosMensal)}% a.m. · restam ${i.restantes} (${brl(i.valorRestante)})</span></button>`;
        }).join('');
      }
      return html;
    },

    receitas() {
      const h = hoje();
      const r = L.resumoMes(state.dividas, state.rendas, state.ym, h);
      let html = monthNav(labelYM(state.ym), 'mes');
      html += `<div class="card"><h2>Receitas do mês</h2><b class="pos-t" style="font-size:22px">${brl(r.receitas)}</b></div>`;
      html += r.recs.length ? `<div class="list">${r.recs.map(itemRenda).join('')}</div>` : `<div class="card empty">Nenhuma receita neste mês.<br><br><button class="btn" data-act="novaRenda">+ Cadastrar receita</button></div>`;
      return html;
    },

    relatorio() {
      const a = L.resumoAno(state.dividas, state.rendas, state.ano, hoje(), state.compras, state.cfg);
      let html = monthNav(String(state.ano), 'ano');
      if (!a.receitas && !a.dividas && !a.gastos) return html + `<div class="card empty">Sem dados em ${state.ano}.</div>`;
      if (a.estimados) html += `<div class="banner blue">ℹ️ <div>Este relatório inclui ${a.estimados} lançamento(s) variável(is) ainda sem valor real — o saldo é uma previsão até você informar cada mês.</div></div>`;
      html += `<div class="saldo ${a.saldo >= 0 ? 'pos' : 'neg'}"><small>Resultado de ${state.ano}</small><b>${brl(a.saldo)}</b><small>${a.mesesPositivos} mês(es) positivo(s) · ${a.mesesNegativos} negativo(s)</small></div>`;
      html += `<div class="grid3"><div class="stat"><small>Receitas</small><b class="pos-t">${brl(a.receitas)}</b></div><div class="stat"><small>Dívidas</small><b class="neg-t">${brl(a.dividas)}</b></div><div class="stat"><small>Gastos</small><b class="violet-t">${brl(a.gastos)}</b></div></div>`;
      const max = Math.max(1, ...a.meses.flatMap((m) => [m.receitas, m.dividas, m.gastos]));
      const base = 130, alt = 110;
      let bars = '';
      a.meses.forEach((m, i) => {
        const x = 8 + i * 29, bw = 7;
        [[m.receitas, '--c-rec'], [m.dividas, '--c-div'], [m.gastos, '--c-gas']].forEach(([v, cor], j) => {
          const hh = (v / max) * alt;
          bars += `<rect x="${x + j * (bw + 1)}" y="${base - hh}" width="${bw}" height="${hh}" rx="2" style="fill:var(${cor})"/>`;
        });
        bars += `<text x="${x + 11.5}" y="144" text-anchor="middle">${MES_CURTO[i]}</text>`;
        if (m.receitas || m.dividas || m.gastos) bars += `<circle cx="${x + 11.5}" cy="153" r="3" style="fill:var(${m.saldo >= 0 ? '--green' : '--red'})"/>`;
      });
      html += `<div class="card"><h2>Receitas × dívidas × gastos</h2><svg class="chart" viewBox="0 0 360 160" role="img" aria-label="Gráfico anual">${bars}<line x1="4" x2="356" y1="${base}" y2="${base}" style="stroke:var(--line)"/></svg>
        <div class="legend"><span><i style="background:var(--c-rec)"></i>Receitas</span><span><i style="background:var(--c-div)"></i>Dívidas</span><span><i style="background:var(--c-gas)"></i>Gastos</span><span>● saldo do mês</span></div></div>`;
      const linhas = a.meses.map((m, i) => `<tr><td>${MES_CURTO[i]}</td><td>${n2(m.receitas)}</td><td>${n2(m.dividas)}</td><td>${n2(m.gastos)}</td><td class="${m.saldo >= 0 ? 'pos-t' : 'neg-t'}">${m.receitas || m.dividas || m.gastos ? n2(m.saldo) : '–'}</td></tr>`).join('');
      html += `<div class="card"><h2>Relatório gerencial (R$)</h2><table><thead><tr><th>Mês</th><th>Receitas</th><th>Dívidas</th><th>Gastos</th><th>Saldo</th></tr></thead><tbody>${linhas}</tbody>
        <tfoot><tr><td>Total</td><td>${n2(a.receitas)}</td><td>${n2(a.dividas)}</td><td>${n2(a.gastos)}</td><td class="${a.saldo >= 0 ? 'pos-t' : 'neg-t'}">${n2(a.saldo)}</td></tr></tfoot></table></div>`;
      const tipos = Object.entries(a.porTipo).sort((x, y) => y[1] - x[1]);
      if (tipos.length) html += `<div class="card"><h2>Dívidas por tipo em ${state.ano}</h2>${tipos.map(([t, v]) => `<div class="bar-row"><span>${esc(t)}</span><b>${brl(v)}</b></div>`).join('')}</div>`;
      const tg = Object.entries(a.porTipoGasto).sort((x, y) => y[1] - x[1]);
      if (tg.length) html += `<div class="card"><h2>Gastos por tipo de compra em ${state.ano}</h2>${tg.map(([t, v]) => `<div class="bar-row"><span>${esc(t)}</span><b>${brl(v)}</b></div>`).join('')}${a.jurosCartao > 0 ? `<p class="hint" style="margin:10px 0 0">Juros pagos em compras parceladas no crédito: <b>${brl(a.jurosCartao)}</b></p>` : ''}</div>`;
      html += `<button class="btn alt" data-act="expCSV">⬇️ Exportar relatório (CSV para Excel)</button>`;
      return html;
    },

    mais() {
      const perm = 'Notification' in window ? Notification.permission : 'unsupported';
      const permTxt = { granted: '✅ Ativadas', denied: '🚫 Bloqueadas (libere nas configurações do navegador)', default: 'Desativadas', unsupported: 'Não suportadas neste navegador' }[perm];
      return `<div class="card"><h2>🔔 Notificações</h2><p style="margin:0 0 10px">Status: <b>${permTxt}</b></p>
        <div class="btns">${perm === 'granted' ? '<button class="btn alt" data-act="testNotif">Testar notificação</button>' : '<button class="btn" data-act="notif">Ativar notificações</button>'}</div>
        <p class="hint" style="margin-top:10px">O app avisa ao abrir e, no Chrome instalado, tenta avisar em segundo plano. O Android pode atrasar avisos de apps web — para um alarme garantido no dia, use o calendário abaixo.</p></div>
      <div class="card"><h2>📅 Calendário do celular</h2>
        <label class="field"><span>Hora do lembrete no dia do vencimento</span><input type="time" id="hora" value="${esc(state.cfg.hora)}"></label>
        <button class="btn" data-act="calTodos">Salvar todos os vencimentos no calendário</button>
        <p class="hint" style="margin-top:10px">Cria um evento com alarme no dia de cada vencimento em aberto (próximos 12 meses). Se repetir a ação, o calendário atualiza os eventos existentes.</p></div>
      <div class="card"><h2>💳 Cartão de crédito</h2>
        <div class="row2"><label class="field"><span>Dia em que a fatura fecha</span><input type="number" id="cartaoFecha" min="1" max="31" inputmode="numeric" value="${esc(state.cfg.cartaoFecha || '')}" placeholder="Ex.: 25"></label>
        <label class="field"><span>Dia do vencimento</span><input type="number" id="cartaoVenc" min="1" max="31" inputmode="numeric" value="${esc(state.cfg.cartaoVenc || '')}" placeholder="Ex.: 5"></label></div>
        <p class="hint">Compras feitas depois do fechamento caem na fatura seguinte. Se deixar vazio, a 1ª parcela entra no mês da compra.</p></div>
      <div class="card"><h2>💾 Backup dos dados</h2><div class="btns">
        <button class="btn alt" data-act="expJSON">⬇️ Exportar backup (.json)</button>
        <button class="btn alt" data-act="impJSON">⬆️ Importar backup</button></div>
        <p class="hint" style="margin-top:10px">Os dados ficam só neste celular. Faça backup de vez em quando e antes de trocar de aparelho. Para compartilhar com outro membro da família, exporte aqui e importe no outro celular.</p></div>
      ${installEvt ? '<div class="card"><button class="btn" data-act="instalar">📲 Instalar app no celular</button></div>' : '<div class="card"><h2>📲 Instalar</h2><p class="hint" style="margin:0">No Chrome: menu ⋮ → <b>Instalar app</b> (ou “Adicionar à tela inicial”).</p></div>'}
      <div class="card"><h2>Zona de perigo</h2><button class="btn danger" data-act="limpar">Apagar todos os dados</button></div>`;
    },
  };

  function render() {
    document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === state.tab));
    $('#title').textContent = { resumo: 'Planejamento Familiar', dividas: 'Dívidas', gastos: 'Gastos', receitas: 'Receitas', relatorio: 'Relatório anual', mais: 'Mais opções' }[state.tab];
    $('#fab').style.display = ['resumo', 'dividas', 'gastos', 'receitas'].includes(state.tab) ? '' : 'none';
    $('#view').innerHTML = views[state.tab]();
  }

  // ---------- formulário de dívida ----------
  function formDivida(id) {
    const d = id ? state.dividas.find((x) => x.id === id) : null;
    const v = d || { tipo: 'Energia elétrica', nome: '', responsavel: '', vencimento: '', valor: '', recorrente: true, tipoValor: 'variavel', recorrenteAte: '', reajustes: [], valorParcela: '', jurosMensal: '', qtdParcelas: '', parcelasPagas: 0, pagamentos: {} };
    const preset = L.TIPOS.some((t) => t.nome === v.tipo);
    const opts = L.TIPOS.map((t) => `<option ${v.tipo === t.nome ? 'selected' : ''}>${esc(t.nome)}</option>`).join('') + `<option value="__custom" ${preset ? '' : 'selected'}>➕ Outro (digitar)</option>`;
    const resp = [...new Set([...state.dividas.map((x) => x.responsavel), ...state.rendas.map((x) => x.responsavel)].filter(Boolean))];
    const dataPg = d && !L.isEmprestimo(d) ? (d.pagamentos || {})[firstKey(d)] || '' : '';
    const acr = d ? L.acrescimoDe(d) : '';
    openSheet(`<h3>${d ? 'Editar dívida' : 'Nova dívida'}</h3>
      <form id="fDivida" data-id="${esc(id || '')}" autocomplete="off">
        <label class="field"><span>Tipo de dívida</span><select name="tipo">${opts}</select></label>
        <label class="field" id="wrapCustom" hidden><span>Nome do tipo</span><input name="tipoCustom" value="${preset ? '' : esc(v.tipo)}" placeholder="Ex.: Pensão, Mensalidade clube"></label>
        <label class="field"><span>Nome da dívida</span><input name="nome" required value="${esc(v.nome)}" placeholder="Ex.: Conta de luz da casa"></label>
        <label class="field"><span>Responsável pela dívida</span><input name="responsavel" list="dlResp" value="${esc(v.responsavel)}" placeholder="Ex.: Diogo"></label>
        <datalist id="dlResp">${resp.map((r) => `<option value="${esc(r)}">`).join('')}</datalist>
        <label class="field"><span id="lblVenc">Data de vencimento</span><input type="date" name="vencimento" required value="${esc(v.vencimento)}"></label>
        <div id="blocoComum">
          <label class="check"><input type="checkbox" name="recorrente" ${v.recorrente ? 'checked' : ''}> Conta que se repete todo mês</label>
          <label class="field" id="wrapTipoValor"><span>Como é o valor dessa conta?</span>
            <select name="tipoValor"><option value="fixo" ${v.tipoValor !== 'variavel' ? 'selected' : ''}>Fixo — o mesmo valor todo mês</option><option value="variavel" ${v.tipoValor === 'variavel' ? 'selected' : ''}>Variável — muda todo mês</option></select></label>
          <label class="field"><span id="lblValor">Valor da dívida (R$)</span><input type="number" name="valor" step="0.01" min="0" inputmode="decimal" value="${esc(L.isEmprestimo(v) || !v.valor ? '' : v.valor)}"></label>
          <p class="hint" id="hintValor"></p>
          <label class="field" id="wrapAte"><span>Fim do contrato / última cobrança (opcional)</span><input type="date" name="recorrenteAte" value="${esc(v.recorrenteAte || '')}"></label>
          ${reajEditor(v.reajustes)}
          <label class="field"><span>Data do pagamento (se já foi paga)</span><input type="date" name="dataPagamento" value="${esc(dataPg)}" data-orig="${esc(dataPg)}"></label>
          <p class="hint">Em contas mensais, informe o <b>próximo</b> vencimento. Depois toque em cada mês na lista para pagar (e, se for variável, informar o valor do mês).</p>
        </div>
        <div id="blocoEmp" hidden>
          <label class="field"><span>Valor emprestado / financiado (R$)</span><input type="number" name="valorEmp" step="0.01" min="0" inputmode="decimal" value="${esc(L.isEmprestimo(v) ? v.valor : '')}"></label>
          <div class="row2">
            <label class="field"><span>Valor da parcela (R$)</span><input type="number" name="valorParcela" step="0.01" min="0" inputmode="decimal" value="${esc(v.valorParcela)}"></label>
            <label class="field"><span>Juros mensal (%)</span><input type="number" name="jurosMensal" step="0.01" min="0" inputmode="decimal" value="${esc(v.jurosMensal)}"></label>
          </div>
          <div class="row2">
            <label class="field"><span>Qtd. de parcelas</span><input type="number" name="qtdParcelas" step="1" min="1" inputmode="numeric" value="${esc(v.qtdParcelas)}"></label>
            <label class="field"><span>Parcelas já pagas</span><input type="number" name="parcelasPagas" step="1" min="0" inputmode="numeric" value="${esc(v.parcelasPagas)}"></label>
          </div>
          <div class="box" id="boxRest"></div>
        </div>
        <label class="field"><span>Juros de atraso sugerido (R$)</span><input type="number" name="acrescimoAtraso" step="0.01" min="0" inputmode="decimal" value="${esc(acr)}" placeholder="Ex.: 15,00"></label>
        <p class="hint">Sugestão para quando a conta atrasar. Não é somada sozinha: ao marcar como pago com atraso, você digita o juros cobrado.</p>
        <div class="err" id="err"></div>
        <button class="btn" type="submit">Salvar dívida</button>
      </form>
      <div class="btns" style="margin-top:8px">${d ? `<button class="btn danger" data-act="delDivida" data-id="${esc(d.id)}">Excluir dívida</button>` : ''}<button class="btn alt" data-act="fechar">Cancelar</button></div>`);
    syncForm();
  }

  function syncForm() {
    const f = $('#fDivida'); if (!f) return;
    const tipo = f.tipo.value === '__custom' ? f.tipoCustom.value.trim() : f.tipo.value;
    const emp = L.isEmprestimo({ tipo });
    const rec = !emp && f.recorrente.checked, variavel = rec && f.tipoValor.value === 'variavel';
    $('#wrapCustom').hidden = f.tipo.value !== '__custom';
    $('#blocoComum').hidden = emp; $('#blocoEmp').hidden = !emp;
    $('#lblVenc').textContent = emp ? 'Vencimento da próxima parcela' : 'Data de vencimento';
    $('#wrapTipoValor').hidden = !rec; $('#wrapAte').hidden = !rec; $('#wrapReaj').hidden = !(rec && !variavel);
    $('#lblValor').textContent = !rec ? 'Valor da dívida (R$)' : variavel ? 'Valor estimado (R$) — opcional' : 'Valor mensal (R$)';
    $('#hintValor').textContent = variavel ? 'Serve só como previsão. O valor real você informa mês a mês, tocando na conta na lista.' : '';
    $('#hintValor').hidden = !variavel;
    if (emp) {
      const total = Math.round(num(f.qtdParcelas.value)), pagas = Math.round(num(f.parcelasPagas.value));
      const rest = Math.max(0, total - pagas);
      $('#boxRest').innerHTML = `Pagas: <b>${Math.min(pagas, total)}</b> · Restantes: <b>${rest}</b> · A pagar: <b>${brl(rest * num(f.valorParcela.value))}</b>`;
    }
  }

  async function salvarDivida(f) {
    const id = f.dataset.id, old = id ? state.dividas.find((x) => x.id === id) : null;
    const tipo = f.tipo.value === '__custom' ? f.tipoCustom.value.trim() : f.tipo.value;
    const d = old ? Object.assign({}, old) : { id: uid(), criadoEm: Date.now() };
    d.pagamentos = Object.assign({}, (old && old.pagamentos) || {});
    Object.assign(d, { tipo: tipo || 'Outros', nome: f.nome.value.trim(), responsavel: f.responsavel.value.trim(), vencimento: f.vencimento.value,
      acrescimoAtraso: num(f.acrescimoAtraso.value) });
    delete d.jurosAtraso; delete d.multaAtraso; // substituídos pelo valor fixo em R$
    if (L.isEmprestimo(d)) {
      Object.assign(d, { valor: num(f.valorEmp.value), valorParcela: num(f.valorParcela.value), jurosMensal: num(f.jurosMensal.value),
        qtdParcelas: Math.round(num(f.qtdParcelas.value)), parcelasPagas: Math.round(num(f.parcelasPagas.value)), recorrente: false, recorrenteAte: '', tipoValor: 'fixo', reajustes: [] });
    } else {
      const rec = f.recorrente.checked, variavel = rec && f.tipoValor.value === 'variavel';
      const rj = lerReajustes(f);
      if (rec && !variavel && rj.erro) { $('#err').textContent = 'Cada reajuste precisa de um mês e de um valor.'; return; }
      Object.assign(d, { valor: num(f.valor.value), recorrente: rec, tipoValor: rec ? f.tipoValor.value : 'fixo', recorrenteAte: rec ? f.recorrenteAte.value : '',
        reajustes: rec && !variavel ? rj.lista : (d.reajustes || []) });
      const novo = f.dataPagamento.value;
      if (novo !== (f.dataPagamento.dataset.orig || '') && d.vencimento) {
        if (novo) d.pagamentos[firstKey(d)] = novo; else delete d.pagamentos[firstKey(d)];
      }
    }
    const erros = L.validarDivida(d);
    if (erros.length) { $('#err').textContent = erros.join(' '); return; }
    await DB.put('dividas', d);
    pedirPersistencia();
    await reload(); closeSheet(); render();
    const temFuturo = L.ocorrencias(d, L.addMonths(hoje(), 12)).some((o) => !o.pagoEm && o.venc >= hoje());
    toast('Dívida salva ✔', temFuturo ? '📅 Calendário' : null, () => salvarCalendario([d], 'vencimento-' + d.nome.replace(/\W+/g, '-').toLowerCase()));
  }

  // ---------- formulário de receita ----------
  function formRenda(id) {
    const r = id ? state.rendas.find((x) => x.id === id) : null;
    const v = r || { descricao: '', tipo: 'Salário', responsavel: '', valor: '', data: '', recorrente: true, tipoValor: 'fixo', recorrenteAte: '', reajustes: [] };
    const resp = [...new Set([...state.dividas.map((x) => x.responsavel), ...state.rendas.map((x) => x.responsavel)].filter(Boolean))];
    openSheet(`<h3>${r ? 'Editar receita' : 'Nova receita'}</h3>
      <form id="fRenda" data-id="${esc(id || '')}" autocomplete="off">
        <label class="field"><span>Descrição</span><input name="descricao" required value="${esc(v.descricao)}" placeholder="Ex.: Aluguel do apartamento"></label>
        <label class="field"><span>Tipo</span><select name="tipo">${L.TIPOS_RENDA.map((t) => `<option ${v.tipo === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></label>
        <label class="field"><span>Quem recebe</span><input name="responsavel" list="dlResp2" value="${esc(v.responsavel)}"></label>
        <datalist id="dlResp2">${resp.map((x) => `<option value="${esc(x)}">`).join('')}</datalist>
        <label class="check"><input type="checkbox" name="recorrente" ${v.recorrente ? 'checked' : ''}> Recebo todo mês</label>
        <label class="field" id="wrapTipoValorR"><span>Como é o valor?</span>
          <select name="tipoValor"><option value="fixo" ${v.tipoValor !== 'variavel' ? 'selected' : ''}>Fixo — o mesmo valor todo mês</option><option value="variavel" ${v.tipoValor === 'variavel' ? 'selected' : ''}>Variável — muda todo mês</option></select></label>
        <div class="row2">
          <label class="field"><span id="lblValorR">Valor (R$)</span><input type="number" name="valor" step="0.01" min="0" inputmode="decimal" value="${esc(v.valor || '')}"></label>
          <label class="field"><span>Data de recebimento</span><input type="date" name="data" required value="${esc(v.data)}"></label>
        </div>
        <label class="field" id="wrapAteR"><span>Fim do contrato (opcional)</span><input type="date" name="recorrenteAte" value="${esc(v.recorrenteAte || '')}"></label>
        ${reajEditor(v.reajustes)}
        <div class="err" id="err"></div>
        <button class="btn" type="submit">Salvar receita</button>
      </form>
      <div class="btns" style="margin-top:8px">${r ? `<button class="btn danger" data-act="delRenda" data-id="${esc(r.id)}">Excluir receita</button>` : ''}<button class="btn alt" data-act="fechar">Cancelar</button></div>`);
    syncRenda();
  }

  function syncRenda() {
    const f = $('#fRenda'); if (!f) return;
    const rec = f.recorrente.checked, variavel = rec && f.tipoValor.value === 'variavel';
    $('#wrapTipoValorR').hidden = !rec; $('#wrapAteR').hidden = !rec; $('#wrapReaj').hidden = !(rec && !variavel);
    $('#lblValorR').textContent = !rec ? 'Valor (R$)' : variavel ? 'Valor estimado (R$)' : 'Valor mensal (R$)';
  }

  async function salvarRenda(f) {
    const id = f.dataset.id, old = id ? state.rendas.find((x) => x.id === id) : null;
    const rec = f.recorrente.checked, variavel = rec && f.tipoValor.value === 'variavel';
    const rj = lerReajustes(f);
    if (rec && !variavel && rj.erro) { $('#err').textContent = 'Cada reajuste precisa de um mês e de um valor.'; return; }
    const r = Object.assign(old ? {} : { id: uid(), criadoEm: Date.now() }, old || {}, {
      descricao: f.descricao.value.trim(), tipo: f.tipo.value, responsavel: f.responsavel.value.trim(), valor: num(f.valor.value),
      data: f.data.value, recorrente: rec, tipoValor: rec ? f.tipoValor.value : 'fixo', recorrenteAte: rec ? f.recorrenteAte.value : '',
      reajustes: rec && !variavel ? rj.lista : ((old && old.reajustes) || []) });
    if (!r.descricao || !r.data || (!variavel && !(r.valor > 0))) { $('#err').textContent = variavel ? 'Preencha descrição e data.' : 'Preencha descrição, valor e data.'; return; }
    if (rec && r.recorrenteAte && r.recorrenteAte < r.data) { $('#err').textContent = 'O fim do contrato deve ser depois da data de recebimento.'; return; }
    await DB.put('rendas', r);
    pedirPersistencia();
    await reload(); closeSheet(); render(); toast('Receita salva ✔');
  }

  // ---------- gastos: lançamento rápido (Crédito, Débito ou Pix) ----------
  function formCompra(id, forma0) {
    const c = id ? state.compras.find((x) => x.id === id) : null;
    const v = c || { forma: forma0 || lsGet('pf-forma') || 'credito', valor: '', parcelas: 1, valorParcela: '', tipo: 'Mercado', descricao: '', data: hoje() };
    const preset = L.TIPOS_COMPRA.includes(v.tipo);
    const tipos = L.TIPOS_COMPRA.map((t) => `<option ${v.tipo === t ? 'selected' : ''}>${esc(t)}</option>`).join('') + `<option value="__custom" ${preset ? '' : 'selected'}>➕ Outro (digitar)</option>`;
    const parcs = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => `<option value="${n}" ${+v.parcelas === n ? 'selected' : ''}>${n === 1 ? 'À vista' : n + 'x'}</option>`).join('');
    openSheet(`<h3>${c ? 'Editar gasto' : 'Lançar gasto'}</h3>
      <form id="fCompra" data-id="${esc(id || '')}" autocomplete="off">
        <input type="hidden" name="forma" value="${esc(v.forma)}">
        <div class="forma">${['credito', 'debito', 'pix'].map((k) => `<button type="button" data-act="forma" data-v="${k}" class="${v.forma === k ? 'on' : ''}">${ICO[k].replace('width="20" height="20"', 'width="24" height="24"')}${L.FORMAS[k]}</button>`).join('')}</div>
        <label class="field big"><span id="lblValorC">Valor (R$)</span><input type="number" name="valor" step="0.01" min="0" inputmode="decimal" required placeholder="0,00" value="${esc(v.valor)}"></label>
        <div id="blocoCred">
          <label class="field"><span>Número de parcelas</span><select name="parcelas">${parcs}</select></label>
          <label class="field" id="wrapParcela"><span>Valor de cada parcela (R$)</span><input type="number" name="valorParcela" step="0.01" min="0" inputmode="decimal" placeholder="Valor que o cartão cobra por parcela" value="${esc(v.valorParcela || '')}"></label>
          <label class="field"><span>Juros cobrados no parcelamento (R$, opcional)</span><input type="number" name="jurosManual" step="0.01" min="0" inputmode="decimal" placeholder="Digite o juros, se houver" value="${esc(v.jurosManual || '')}"></label>
          <div class="box" id="boxJuros"></div>
        </div>
        <label class="field"><span>Tipo de compra</span><select name="tipo">${tipos}</select></label>
        <label class="field" id="wrapCustomC" hidden><span>Qual tipo?</span><input name="tipoCustom" value="${preset ? '' : esc(v.tipo)}" placeholder="Ex.: Pet, Academia"></label>
        <label class="field"><span>Descrição (opcional)</span><input name="descricao" value="${esc(v.descricao || '')}" placeholder="Ex.: Supermercado Extra"></label>
        <label class="field"><span>Data da compra</span><input type="date" name="data" required value="${esc(v.data)}"></label>
        <div class="err" id="err"></div>
        <button class="btn" type="submit">Salvar gasto</button>
      </form>
      <div class="btns" style="margin-top:8px">${c ? `<button class="btn danger" data-act="delCompra" data-id="${esc(c.id)}">Excluir gasto</button>` : ''}<button class="btn alt" data-act="fechar">Cancelar</button></div>`);
    syncCompra();
    if (!c) setTimeout(() => { const i = $('#fCompra input[name=valor]'); if (i) i.focus(); }, 60);
  }

  function syncCompra() {
    const f = $('#fCompra'); if (!f) return;
    const forma = f.forma.value, cred = forma === 'credito';
    document.querySelectorAll('#fCompra .forma button').forEach((b) => b.classList.toggle('on', b.dataset.v === forma));
    $('#blocoCred').hidden = !cred;
    $('#wrapCustomC').hidden = f.tipo.value !== '__custom';
    $('#lblValorC').textContent = cred ? 'Valor da compra à vista (R$)' : 'Valor (R$)';
    if (!cred) return;
    const n = +f.parcelas.value || 1;
    $('#wrapParcela').hidden = n <= 1;
    const prim = fmtData(L.vencimentoParcela(f.data.value || hoje(), state.cfg, 0));
    $('#boxJuros').innerHTML = n <= 1
      ? `À vista no crédito · entra em <b>${prim}</b>`
      : `Cada parcela entra no custo do mês em que vencer. 1ª parcela em <b>${prim}</b> · as demais, nos meses seguintes.`;
  }

  async function salvarCompra(f) {
    const id = f.dataset.id, old = id ? state.compras.find((x) => x.id === id) : null;
    const forma = f.forma.value;
    const tipo = f.tipo.value === '__custom' ? f.tipoCustom.value.trim() : f.tipo.value;
    const cred = forma === 'credito', n = cred ? +f.parcelas.value || 1 : 1;
    const c = Object.assign(old ? {} : { id: uid(), criadoEm: Date.now() }, old || {}, {
      forma, valor: num(f.valor.value), tipo: tipo || 'Outros', descricao: f.descricao.value.trim(), data: f.data.value,
      parcelas: n, valorParcela: cred && n > 1 && f.valorParcela.value !== '' ? num(f.valorParcela.value) : 0,
      jurosManual: cred && f.jurosManual && f.jurosManual.value !== '' ? num(f.jurosManual.value) : 0 });
    const erros = L.validarCompra(c);
    if (erros.length) { $('#err').textContent = erros.join(' '); return; }
    await DB.put('compras', c);
    pedirPersistencia(); lsSet('pf-forma', forma);
    if (state.tab === 'gastos') state.g.data = c.data;
    await reload(); closeSheet(); render();
    toast('Gasto salvo ✔', '➕ Outro', () => formCompra(null, forma));
  }

  // ---------- ocorrência (valor do mês / pagar / desfazer) ----------
  function findOcc(id, key) {
    const d = state.dividas.find((x) => x.id === id); if (!d) return null;
    const ate = /^\d{4}-\d{2}$/.test(key) ? key + '-31' : '9999-12-31';
    const o = L.occsDividas([d], ate, hoje()).find((x) => x.key === key);
    return o ? { d, o } : null;
  }

  function sheetOcc(id, key) {
    const f = findOcc(id, key); if (!f) return;
    cur = { id, key };
    const { d, o } = f;
    const rec = !!d.recorrente && !L.isEmprestimo(d), variavel = rec && d.tipoValor === 'variavel';
    const sub = o.estimado ? (o.valor > 0 ? `Estimado: <b>${brl(o.valor)}</b>` : 'Valor: <b>ainda não informado</b>') : `Valor: <b>${brl(o.valor)}</b>`;
    const info = `<div class="box"><b>${esc(d.tipo)}</b>${d.responsavel ? ' · ' + esc(d.responsavel) : ''}${o.label && o.label !== 'Mensal' ? ' · ' + esc(o.label) : ''}<br>Vencimento: <b>${fmtData(o.venc)}</b> · ${sub}${o.origem === 'reajuste' ? ' <small>(valor reajustado)</small>' : ''}</div>`;
    let valorSec = '';
    if (rec) {
      const prefill = o.estimado && o.valor <= 0 ? '' : o.valor;
      valorSec = `<details class="box" ${variavel ? 'open' : ''}><summary>${variavel ? '💲 Valor desta conta neste mês' : '💲 Alterar valor / reajuste'}</summary>
        <label class="field" style="margin-top:10px"><span>Valor em ${esc(labelYM(key))} (R$)</span><input type="number" id="valorOcc" step="0.01" min="0" inputmode="decimal" value="${esc(prefill)}" placeholder="Informe o valor"></label>
        ${variavel ? '' : `<label class="field"><span>Esse valor vale…</span><select id="escopoOcc"><option value="mes">só neste mês</option><option value="desde">neste mês e nos próximos (reajuste)</option></select></label>`}
        <button class="btn alt" data-act="salvarValor" style="margin-top:0">Salvar valor</button></details>`;
    }
    let corpo, botoes;
    if (o.pagoEm) {
      corpo = `${info}${valorSec}<div class="box" style="background:var(--green-soft);color:var(--green)">✅ Pago em <b>${fmtData(o.pagoEm)}</b>${o.pagoComAtraso ? `<br>Com ${o.enc.dias} dia(s) de atraso: juros de ${brl(o.enc.juros)} · total <b>${brl(o.total)}</b>` : ''}</div>`;
      botoes = `<button class="btn alt" data-act="desfazer">Desfazer pagamento</button>`;
    } else {
      const acrSug = L.acrescimoDe(d);
      corpo = `${info}${valorSec}<label class="field"><span>Data do pagamento</span><input type="date" id="payDate" value="${hoje()}"></label><label class="field" id="wrapJuros" hidden><span>Juros cobrados por atraso (R$)</span><input type="number" id="jurosPago" step="0.01" min="0" inputmode="decimal" value="" placeholder="${acrSug ? 'Ex.: ' + n2(acrSug) : '0,00'}"></label><div class="box" id="boxEnc"></div>`;
      botoes = `<button class="btn" data-act="pagar">✔ Marcar como pago</button><button class="btn alt" data-act="calOcc">📅 Adicionar ao calendário</button>`;
    }
    openSheet(`<h3>${esc(d.nome)}</h3>${corpo}<div class="btns">${botoes}<button class="btn alt" data-act="editDivida" data-id="${esc(d.id)}">✏️ Editar dívida</button><button class="btn alt" data-act="fechar">Fechar</button></div>`);
    if (!o.pagoEm) atualizarEnc();
  }

  function valorOccAtual(f) { const inp = $('#valorOcc'); return inp && inp.value !== '' ? num(inp.value) : f.o.valor; }

  function atualizarEnc() {
    const f = cur && findOcc(cur.id, cur.key); const inp = $('#payDate'); if (!f || !inp || !inp.value) return;
    const jIn = $('#jurosPago'), jTyped = jIn && jIn.value !== '' ? num(jIn.value) : 0;
    const e = L.encargos(f.o.venc, inp.value, jTyped);
    const val = valorOccAtual(f);
    const faltaValor = f.o.estimado && $('#valorOcc') && $('#valorOcc').value === '';
    const atraso = e.dias ? `⚠️ <b>${e.dias} dia(s) de atraso</b>${jTyped ? ': juros de ' + brl(e.juros) : ' · informe os juros cobrados, se houver'}` : '';
    if ($('#wrapJuros')) $('#wrapJuros').hidden = !e.dias;
    $('#boxEnc').innerHTML = faltaValor ? `${atraso ? atraso + '<br>' : ''}Informe o valor da conta acima para ver o total.`
      : e.dias ? `${atraso}<br>Total a pagar: <b>${brl(val + e.total)}</b>` : `Pagamento em dia ✔ — total <b>${brl(val)}</b>`;
  }

  // Aplica o valor digitado em "Valor deste mês": só neste mês, ou como reajuste daqui em diante.
  function aplicarValorOcc(f) {
    const inp = $('#valorOcc');
    if (!inp || inp.value === '') return { d: f.d, mudou: false };
    const nv = num(inp.value);
    if (!f.o.estimado && Math.abs(nv - f.o.valor) < 0.005) return { d: f.d, mudou: false };
    const escopo = $('#escopoOcc') ? $('#escopoOcc').value : 'mes';
    const d = escopo === 'desde' ? L.aplicarReajuste(f.d, cur.key, nv) : L.definirValorMes(f.d, cur.key, nv);
    return { d, mudou: true, desde: escopo === 'desde' };
  }
  async function salvarValor() {
    const f = findOcc(cur.id, cur.key); if (!f) return;
    if ($('#valorOcc').value === '') { toast('Informe o valor.'); return; }
    const r = aplicarValorOcc(f);
    if (r.mudou) { await DB.put('dividas', r.d); await reload(); }
    closeSheet(); render();
    toast(!r.mudou ? 'Valor mantido' : r.desde ? 'Reajuste salvo: novo valor a partir de ' + labelYM(cur.key) : 'Valor salvo ✔');
  }
  async function pagar() {
    const dt = $('#payDate').value; if (!dt) { toast('Informe a data do pagamento.'); return; }
    const f = findOcc(cur.id, cur.key); if (!f) return;
    if ($('#valorOcc') && f.o.estimado && $('#valorOcc').value === '') { toast('Informe o valor desta conta antes de pagar.'); return; }
    const r = aplicarValorOcc(f);
    const jIn = $('#jurosPago'), jv = jIn && jIn.value !== '' ? num(jIn.value) : 0;
    const jp = Object.assign({}, r.d.jurosPagos || {});
    if (jv > 0) jp[cur.key] = jv; else delete jp[cur.key];
    const d = Object.assign({}, r.d, { pagamentos: Object.assign({}, r.d.pagamentos, { [cur.key]: dt }), jurosPagos: jp });
    await DB.put('dividas', d); await reload(); closeSheet(); render();
    toast('Pagamento registrado ✔');
  }
  async function setPagamento(data) {
    const f = findOcc(cur.id, cur.key); if (!f) return;
    const d = Object.assign({}, f.d, { pagamentos: Object.assign({}, f.d.pagamentos) });
    if (data) d.pagamentos[cur.key] = data; else delete d.pagamentos[cur.key];
    if (!data && d.jurosPagos) { d.jurosPagos = Object.assign({}, d.jurosPagos); delete d.jurosPagos[cur.key]; }
    await DB.put('dividas', d); await reload(); closeSheet(); render();
    toast(data ? 'Pagamento registrado ✔' : 'Pagamento desfeito');
  }

  // ---------- receita recorrente: valor do mês / reajuste ----------
  function findOccRenda(id, key) {
    const r = state.rendas.find((x) => x.id === id); if (!r) return null;
    const ate = /^\d{4}-\d{2}$/.test(key) ? key + '-31' : '9999-12-31';
    const o = L.occsRendas([r], ate).find((x) => x.key === key);
    return o ? { r, o } : null;
  }
  function sheetRenda(id, key) {
    const f = findOccRenda(id, key); if (!f) return;
    curR = { id, key };
    const { r, o } = f, variavel = r.tipoValor === 'variavel';
    const sub = o.estimado ? (o.valor > 0 ? `Estimado: <b>${brl(o.valor)}</b>` : 'Valor: <b>ainda não informado</b>') : `Valor: <b>${brl(o.valor)}</b>`;
    openSheet(`<h3>${esc(r.descricao)}</h3>
      <div class="box"><b>${esc(r.tipo)}</b>${r.responsavel ? ' · ' + esc(r.responsavel) : ''}<br>Recebimento: <b>${fmtData(o.data)}</b> · ${sub}${o.origem === 'reajuste' ? ' <small>(valor reajustado)</small>' : ''}</div>
      <label class="field"><span>Valor em ${esc(labelYM(key))} (R$)</span><input type="number" id="valorRenda" step="0.01" min="0" inputmode="decimal" value="${esc(o.estimado && o.valor <= 0 ? '' : o.valor)}" placeholder="Informe o valor"></label>
      ${variavel ? '' : `<label class="field"><span>Esse valor vale…</span><select id="escopoRenda"><option value="mes">só neste mês</option><option value="desde">neste mês e nos próximos (reajuste)</option></select></label>`}
      <div class="btns"><button class="btn" data-act="salvarValorRenda">Salvar valor</button><button class="btn alt" data-act="editRenda" data-id="${esc(r.id)}">✏️ Editar receita</button><button class="btn alt" data-act="fechar">Fechar</button></div>`);
  }
  async function salvarValorRenda() {
    const f = findOccRenda(curR.id, curR.key); if (!f) return;
    const inp = $('#valorRenda'); if (!inp || inp.value === '') { toast('Informe o valor.'); return; }
    const escopo = $('#escopoRenda') ? $('#escopoRenda').value : 'mes';
    const r2 = escopo === 'desde' ? L.aplicarReajuste(f.r, curR.key, num(inp.value)) : L.definirValorMes(f.r, curR.key, num(inp.value));
    await DB.put('rendas', r2); await reload(); closeSheet(); render();
    toast(escopo === 'desde' ? 'Reajuste salvo: novo valor a partir de ' + labelYM(curR.key) : 'Valor salvo ✔');
  }

  // ---------- calendário ----------
  async function salvarCalendario(lista, nome) {
    const { ics, count } = L.gerarICS(lista, hoje(), state.cfg.hora);
    if (!count) { toast('Nenhum vencimento futuro em aberto para salvar.'); return; }
    const file = new File([ics], (nome || 'vencimentos') + '.ics', { type: 'text/calendar' });
    try {
      if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: 'Vencimentos da família' }); return; }
    } catch (e) { if (e && e.name === 'AbortError') return; }
    baixar(file);
    toast(`${count} evento(s) gerado(s). Abra o arquivo .ics baixado para salvar no Calendário.`);
  }

  // ---------- notificações ----------
  async function swReg() { try { return await navigator.serviceWorker.ready; } catch (e) { return null; } }
  async function ativarNotificacoes() {
    if (!('Notification' in window)) { toast('Este navegador não suporta notificações.'); return; }
    const p = await Notification.requestPermission();
    if (p === 'granted') {
      try { const reg = await swReg(); if (reg && 'periodicSync' in reg) await reg.periodicSync.register('vencimentos', { minInterval: 6 * 3600 * 1000 }); } catch (e) { /* ignore */ }
      await checarVencimentos(true);
    }
    render();
  }
  async function checarVencimentos(forcar) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const h = hoje();
    if (!forcar && lsGet('pf-last-notify') === h) return;
    const hojeL = L.vencendoHoje(state.dividas, h), atras = L.atrasadas(state.dividas, h);
    if (!hojeL.length && !atras.length) { if (forcar) toast('Nada vencendo hoje ✅'); return; }
    const partes = [];
    if (hojeL.length) partes.push('Vence hoje: ' + hojeL.map((o) => o.d.nome).join(', '));
    if (atras.length) partes.push(atras.length + ' em atraso');
    const reg = await swReg();
    if (reg) { await reg.showNotification('Planejamento Familiar', { body: partes.join(' · '), icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', tag: 'vencimentos-' + h }); lsSet('pf-last-notify', h); }
  }
  async function testarNotificacao() {
    const reg = await swReg();
    if (reg) await reg.showNotification('Planejamento Familiar', { body: 'Tudo certo! Os avisos de vencimento chegarão assim.', icon: 'icons/icon-192.png', tag: 'teste' });
  }

  // ---------- backup / exportação ----------
  function exportarJSON() {
    const data = { app: 'planejamento-familiar', versao: 2, exportadoEm: new Date().toISOString(), dividas: state.dividas, rendas: state.rendas, compras: state.compras, config: state.cfg };
    baixar(new File([JSON.stringify(data, null, 2)], `backup-planejamento-familiar-${hoje()}.json`, { type: 'application/json' }));
    toast('Backup exportado ✔');
  }
  async function importarJSON(file) {
    try {
      const data = JSON.parse(await file.text());
      if (data.app !== 'planejamento-familiar' || !Array.isArray(data.dividas) || !Array.isArray(data.rendas)) throw new Error('formato');
      const compras = Array.isArray(data.compras) ? data.compras : [];
      for (const d of data.dividas) if (d && d.id) await DB.put('dividas', d);
      for (const r of data.rendas) if (r && r.id) await DB.put('rendas', r);
      for (const c of compras) if (c && c.id) await DB.put('compras', c);
      if (data.config) for (const k of ['hora', 'cartaoFecha', 'cartaoVenc']) if (data.config[k]) await DB.setConfig(k, data.config[k]);
      await reload(); render(); toast(`Importado: ${data.dividas.length} dívida(s), ${data.rendas.length} receita(s) e ${compras.length} gasto(s).`);
    } catch (e) { toast('Arquivo inválido. Use um backup exportado por este app.'); }
  }
  function exportarCSV() {
    const a = L.resumoAno(state.dividas, state.rendas, state.ano, hoje(), state.compras, state.cfg);
    const c = (v) => String(v.toFixed ? v.toFixed(2) : v).replace('.', ',');
    const sit = (m) => (m.receitas || m.dividas || m.gastos ? (m.saldo >= 0 ? 'Positivo' : 'Negativo') : '');
    const rows = [['Mês', 'Receitas', 'Dívidas', 'Gastos', 'Saldo', 'Situação']];
    a.meses.forEach((m, i) => rows.push([MESES[i], c(m.receitas), c(m.dividas), c(m.gastos), c(m.saldo), sit(m)]));
    rows.push(['Total', c(a.receitas), c(a.dividas), c(a.gastos), c(a.saldo), a.saldo >= 0 ? 'Positivo' : 'Negativo'], [], ['Tipo de dívida', 'Total no ano']);
    Object.entries(a.porTipo).sort((x, y) => y[1] - x[1]).forEach(([t, v]) => rows.push([t, c(v)]));
    rows.push([], ['Tipo de compra', 'Total no ano']);
    Object.entries(a.porTipoGasto).sort((x, y) => y[1] - x[1]).forEach(([t, v]) => rows.push([t, c(v)]));
    rows.push([], ['Juros pagos em parcelamentos no crédito', c(a.jurosCartao)]);
    const csv = '﻿' + rows.map((r) => r.map((x) => `"${String(x).replace(/"/g, '""')}"`).join(';')).join('\r\n');
    baixar(new File([csv], `relatorio-${state.ano}.csv`, { type: 'text/csv' }));
  }

  // ---------- eventos ----------
  const actions = {
    mes: (t) => { state.ym = shiftYM(state.ym, +t.dataset.n); render(); },
    ano: (t) => { state.ano += +t.dataset.n; render(); },
    filtro: (t) => { state.filtro = t.dataset.v; render(); },
    periodoG: (t) => { state.g.periodo = t.dataset.v; render(); },
    navG: (t) => {
      const g = state.g, n = +t.dataset.n;
      g.data = g.periodo === 'dia' ? L.addDays(g.data, n) : L.addMonths(g.data, g.periodo === 'ano' ? 12 * n : n);
      render();
    },
    diaG: (t) => { state.g.data = t.dataset.d; state.g.periodo = 'dia'; render(); window.scrollTo(0, 0); },
    mesG: (t) => { state.g.data = t.dataset.d; state.g.periodo = 'mes'; render(); window.scrollTo(0, 0); },
    filtroG: sheetFiltro,
    limparFiltroG: () => { state.g.formas = []; state.g.tipos = []; closeSheet(); render(); },
    rmF: (t) => { const k = t.dataset.k === 'forma' ? 'formas' : 'tipos'; state.g[k] = state.g[k].filter((x) => x !== t.dataset.v); render(); },
    toggleG: (t) => {
      const box = t.closest('.gitem'), k = box.dataset.k, abre = !state.gOpen.has(k);
      if (abre) state.gOpen.add(k); else state.gOpen.delete(k);
      box.classList.toggle('open', abre); t.setAttribute('aria-expanded', String(abre)); box.querySelector('.gdetail').hidden = !abre;
    },
    novoGasto: () => formCompra(),
    compra: (t) => formCompra(t.dataset.id),
    forma: (t) => { const f = t.closest('form'); f.forma.value = t.dataset.v; syncCompra(); },
    delCompra: async (t) => { if (!confirm('Excluir este gasto?')) return; await DB.del('compras', t.dataset.id); await reload(); closeSheet(); render(); toast('Gasto excluído'); },
    occ: (t) => sheetOcc(t.dataset.id, t.dataset.key),
    renda: (t) => { const r = state.rendas.find((x) => x.id === t.dataset.id); if (r && r.recorrente) sheetRenda(r.id, t.dataset.key); else formRenda(t.dataset.id); },
    editRenda: (t) => formRenda(t.dataset.id),
    salvarValor, salvarValorRenda,
    addReaj: (t) => {
      const f = t.closest('form'), ref = (f.vencimento && f.vencimento.value) || (f.data && f.data.value) || hoje();
      const l = $('#reajList'); l.insertAdjacentHTML('beforeend', reajRow({ desde: L.addMonths(ref, 12).slice(0, 7) }));
      l.lastElementChild.querySelector('input[name=reajValor]').focus();
    },
    delReaj: (t) => t.closest('.reajrow').remove(),
    novaDivida: () => formDivida(),
    novaRenda: () => formRenda(),
    editDivida: (t) => formDivida(t.dataset.id),
    fechar: closeSheet,
    pagar,
    desfazer: () => setPagamento(null),
    calOcc: () => { const f = cur && findOcc(cur.id, cur.key); if (f) salvarCalendario([Object.assign({}, f.d, { pagamentos: Object.assign({}, f.d.pagamentos) })], 'vencimento-' + f.d.nome.replace(/\W+/g, '-').toLowerCase()); },
    calTodos: () => salvarCalendario(state.dividas, 'vencimentos-familia'),
    delDivida: async (t) => { if (!confirm('Excluir esta dívida e todo o histórico de pagamentos?')) return; await DB.del('dividas', t.dataset.id); await reload(); closeSheet(); render(); toast('Dívida excluída'); },
    delRenda: async (t) => { if (!confirm('Excluir esta receita?')) return; await DB.del('rendas', t.dataset.id); await reload(); closeSheet(); render(); toast('Receita excluída'); },
    notif: ativarNotificacoes,
    testNotif: testarNotificacao,
    expJSON: exportarJSON,
    impJSON: () => $('#importFile').click(),
    expCSV: exportarCSV,
    instalar: async () => { if (installEvt) { installEvt.prompt(); await installEvt.userChoice; installEvt = null; render(); } },
    limpar: async () => {
      if (!confirm('Apagar TODAS as dívidas, receitas e gastos deste celular? Isso não pode ser desfeito.')) return;
      if (!confirm('Tem certeza? Faça um backup antes se tiver dúvida.')) return;
      await DB.clear('dividas'); await DB.clear('rendas'); await DB.clear('compras'); await reload(); render(); toast('Dados apagados');
    },
  };

  document.addEventListener('click', (e) => {
    const tab = e.target.closest('[data-tab]');
    if (tab) { state.tab = tab.dataset.tab; render(); window.scrollTo(0, 0); return; }
    if (e.target.closest('#fab')) {
      if (state.tab === 'receitas') formRenda();
      else if (state.tab === 'dividas') formDivida();
      else if (state.tab === 'gastos') formCompra();
      else openSheet(`<h3>O que deseja adicionar?</h3><div class="btns"><button class="btn" data-act="novoGasto">💳 Lançar gasto (Crédito, Débito ou Pix)</button><button class="btn alt" data-act="novaDivida">🧾 Nova dívida</button><button class="btn alt" data-act="novaRenda">💰 Nova receita</button><button class="btn alt" data-act="fechar">Cancelar</button></div>`);
      return;
    }
    const a = e.target.closest('[data-act]');
    if (a && actions[a.dataset.act]) actions[a.dataset.act](a);
  });
  sheet.addEventListener('click', (e) => { if (e.target === sheet) closeSheet(); });

  $('#sheetBody').addEventListener('input', (e) => {
    if (e.target.id === 'payDate' || e.target.id === 'valorOcc' || e.target.id === 'jurosPago') return atualizarEnc();
    if (e.target.form && e.target.form.id === 'fDivida') syncForm();
    if (e.target.form && e.target.form.id === 'fRenda') syncRenda();
    if (e.target.form && e.target.form.id === 'fCompra') syncCompra();
  });
  $('#sheetBody').addEventListener('change', (e) => {
    const f = e.target.form;
    if (f && f.id === 'fDivida' && e.target.name === 'tipo') {
      const t = L.TIPOS.find((x) => x.nome === e.target.value);
      if (t) { f.recorrente.checked = t.recorrente; f.tipoValor.value = t.variavel ? 'variavel' : 'fixo'; if (!f.nome.value.trim()) f.nome.value = t.nome; }
      else f.recorrente.checked = false;
      syncForm();
    }
    if (f && f.id === 'fRenda') syncRenda();
    if (f && f.id === 'fCompra') syncCompra();
  });
  $('#sheetBody').addEventListener('submit', (e) => {
    e.preventDefault();
    if (e.target.id === 'fDivida') salvarDivida(e.target);
    if (e.target.id === 'fRenda') salvarRenda(e.target);
    if (e.target.id === 'fCompra') salvarCompra(e.target);
    if (e.target.id === 'fFiltro') {
      const fd = new FormData(e.target);
      state.g.formas = fd.getAll('forma'); state.g.tipos = fd.getAll('tipo'); closeSheet(); render();
    }
  });
  document.addEventListener('change', async (e) => {
    if (e.target.id === 'cartaoFecha' || e.target.id === 'cartaoVenc') {
      const n = parseInt(e.target.value, 10), val = n >= 1 && n <= 31 ? String(n) : '';
      state.cfg[e.target.id] = val; e.target.value = val; await DB.setConfig(e.target.id, val); toast('Dia do cartão salvo');
    }
    if (e.target.id === 'hora') { state.cfg.hora = e.target.value || '09:00'; await DB.setConfig('hora', state.cfg.hora); toast('Hora do lembrete salva'); }
    if (e.target.id === 'importFile' && e.target.files[0]) { await importarJSON(e.target.files[0]); e.target.value = ''; }
  });
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e; if (state.tab === 'mais') render(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { render(); checarVencimentos(false); } });

  // ---------- início ----------
  async function init() {
    try { await DB.open(); await reload(); } catch (e) { $('#view').innerHTML = '<div class="card empty">Não foi possível abrir o banco de dados local. Verifique se o navegador está em modo privado.</div>'; return; }
    render();
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
    setTimeout(() => checarVencimentos(false), 1200);
  }
  init();
})();
