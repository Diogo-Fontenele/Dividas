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

  const state = { tab: 'resumo', ym: hoje().slice(0, 7), ano: +hoje().slice(0, 4), filtro: 'todas', dividas: [], rendas: [], cfg: { hora: '09:00' } };
  let cur = null; // ocorrência aberta no sheet
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
    state.cfg = Object.assign({ hora: '09:00' }, await DB.getConfig());
  }
  async function pedirPersistencia() { try { if (navigator.storage && navigator.storage.persist) await navigator.storage.persist(); } catch (e) { /* ignore */ } }

  // ---------- componentes ----------
  const monthNav = (label, act) => `<div class="monthnav"><button class="iconbtn" data-act="${act}" data-n="-1" aria-label="Anterior">‹</button><strong>${esc(label)}</strong><button class="iconbtn" data-act="${act}" data-n="1" aria-label="Próximo">›</button></div>`;
  const CHIP = { pago: 'Pago', atrasado: 'Atrasado', hoje: 'Vence hoje', aberto: 'Em aberto' };

  function itemOcc(o) {
    const { dia, mes } = diaMes(o.venc);
    const sub = [o.d.tipo, o.d.responsavel, o.label && o.label !== 'Mensal' ? o.label : ''].filter(Boolean).join(' · ');
    const enc = o.enc.total > 0 ? `<small class="neg-t">+${brl(o.enc.total)} encargos</small>` : '';
    return `<button class="item ${o.status}" data-act="occ" data-id="${esc(o.debtId)}" data-key="${esc(o.key)}">
      <div class="day">${dia}<small>${mes}</small></div>
      <div class="main"><b>${esc(o.d.nome)}</b><span>${esc(sub)}</span></div>
      <div class="val">${brl(o.total)}<small><span class="chip ${o.status}">${CHIP[o.status]}</span></small>${enc}</div></button>`;
  }
  function itemRenda(o) {
    const { dia, mes } = diaMes(o.data);
    const sub = [o.r.tipo, o.r.responsavel, o.r.recorrente ? 'Mensal' : ''].filter(Boolean).join(' · ');
    return `<button class="item" data-act="renda" data-id="${esc(o.rendaId)}">
      <div class="day" style="background:var(--green-soft);color:var(--green)">${dia}<small>${mes}</small></div>
      <div class="main"><b>${esc(o.r.descricao)}</b><span>${esc(sub)}</span></div>
      <div class="val pos-t">${brl(o.valor)}</div></button>`;
  }

  // ---------- views ----------
  const views = {
    resumo() {
      const h = hoje();
      const r = L.resumoMes(state.dividas, state.rendas, state.ym, h);
      const atras = L.atrasadas(state.dividas, h), hojeL = L.vencendoHoje(state.dividas, h);
      const prox = L.proximos(state.dividas, h, 30).filter((o) => o.venc > h).slice(0, 6);
      let html = '';
      if (hojeL.length) html += `<div class="banner amber">⏰ <div><b>Vence hoje:</b> ${hojeL.map((o) => esc(o.d.nome) + ' (' + brl(o.total) + ')').join(', ')}</div></div>`;
      if (atras.length) html += `<div class="banner red">⚠️ <div><b>${atras.length} em atraso</b> · ${brl(atras.reduce((s, o) => s + o.total, 0))} com juros e multa. Veja na aba Dívidas.</div></div>`;
      html += monthNav(labelYM(state.ym), 'mes');
      if (!state.dividas.length && !state.rendas.length) {
        return html + `<div class="card empty">Comece cadastrando as <b>dívidas</b> e as <b>receitas</b> da família.<br><br><button class="btn" data-act="novaDivida">+ Cadastrar primeira dívida</button></div>`;
      }
      html += `<div class="saldo ${r.saldo >= 0 ? 'pos' : 'neg'}"><small>Saldo de ${esc(MESES[+state.ym.slice(5, 7) - 1])}</small><b>${brl(r.saldo)}</b><small>${r.saldo >= 0 ? 'Mês no azul 👍' : 'Mês no vermelho — atenção!'}</small></div>`;
      html += `<div class="grid3"><div class="stat"><small>Receitas</small><b class="pos-t">${brl(r.receitas)}</b></div>
        <div class="stat"><small>Dívidas</small><b class="neg-t">${brl(r.dividas)}</b></div>
        <div class="stat"><small>Já pago</small><b>${brl(r.pago)}</b></div></div>`;
      const pct = r.qtd ? Math.round((r.qtdPagas / r.qtd) * 100) : 0;
      html += `<div class="card"><h2>Contas pagas no mês</h2><b>${r.qtdPagas} de ${r.qtd}</b> · falta pagar ${brl(r.aberto + r.atrasado)}<div class="progress"><i style="width:${pct}%"></i></div></div>`;
      html += `<h2 style="font-size:15px;color:var(--muted);margin:16px 0 8px">Próximos vencimentos (30 dias)</h2>`;
      html += prox.length ? `<div class="list">${prox.map(itemOcc).join('')}</div>` : `<div class="card empty">Nada a vencer nos próximos 30 dias 🎉</div>`;
      return html;
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
      const a = L.resumoAno(state.dividas, state.rendas, state.ano, hoje());
      let html = monthNav(String(state.ano), 'ano');
      if (!a.receitas && !a.dividas) return html + `<div class="card empty">Sem dados em ${state.ano}.</div>`;
      html += `<div class="saldo ${a.saldo >= 0 ? 'pos' : 'neg'}"><small>Resultado de ${state.ano}</small><b>${brl(a.saldo)}</b><small>${a.mesesPositivos} mês(es) positivo(s) · ${a.mesesNegativos} negativo(s)</small></div>`;
      html += `<div class="grid3"><div class="stat"><small>Receitas</small><b class="pos-t">${brl(a.receitas)}</b></div><div class="stat"><small>Dívidas</small><b class="neg-t">${brl(a.dividas)}</b></div><div class="stat"><small>Saldo</small><b class="${a.saldo >= 0 ? 'pos-t' : 'neg-t'}">${brl(a.saldo)}</b></div></div>`;
      // gráfico
      const max = Math.max(1, ...a.meses.flatMap((m) => [m.receitas, m.dividas]));
      const base = 130, alt = 110;
      let bars = '';
      a.meses.forEach((m, i) => {
        const x = 8 + i * 29, hr = (m.receitas / max) * alt, hd = (m.dividas / max) * alt;
        bars += `<rect x="${x}" y="${base - hr}" width="11" height="${hr}" rx="2" style="fill:var(--green)"/><rect x="${x + 12}" y="${base - hd}" width="11" height="${hd}" rx="2" style="fill:var(--red)"/><text x="${x + 11.5}" y="144" text-anchor="middle">${MES_CURTO[i]}</text>`;
        if (m.receitas || m.dividas) bars += `<circle cx="${x + 11.5}" cy="153" r="3" style="fill:var(${m.saldo >= 0 ? '--green' : '--red'})"/>`;
      });
      html += `<div class="card"><h2>Receitas × dívidas por mês</h2><svg class="chart" viewBox="0 0 360 160" role="img" aria-label="Gráfico anual">${bars}<line x1="4" x2="356" y1="${base}" y2="${base}" style="stroke:var(--line)"/></svg>
        <div class="legend"><span><i style="background:var(--green)"></i>Receitas</span><span><i style="background:var(--red)"></i>Dívidas</span><span>● saldo do mês</span></div></div>`;
      // tabela
      const linhas = a.meses.map((m, i) => `<tr><td>${MES_CURTO[i]}</td><td>${n2(m.receitas)}</td><td>${n2(m.dividas)}</td><td class="${m.saldo >= 0 ? 'pos-t' : 'neg-t'}">${m.receitas || m.dividas ? n2(m.saldo) : '–'}</td></tr>`).join('');
      html += `<div class="card"><h2>Relatório gerencial (R$)</h2><table><thead><tr><th>Mês</th><th>Receitas</th><th>Dívidas</th><th>Saldo</th></tr></thead><tbody>${linhas}</tbody>
        <tfoot><tr><td>Total</td><td>${n2(a.receitas)}</td><td>${n2(a.dividas)}</td><td class="${a.saldo >= 0 ? 'pos-t' : 'neg-t'}">${n2(a.saldo)}</td></tr></tfoot></table></div>`;
      const tipos = Object.entries(a.porTipo).sort((x, y) => y[1] - x[1]);
      if (tipos.length) html += `<div class="card"><h2>Dívidas por tipo em ${state.ano}</h2>${tipos.map(([t, v]) => `<div class="bar-row"><span>${esc(t)}</span><b>${brl(v)}</b></div>`).join('')}</div>`;
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
    $('#title').textContent = { resumo: 'Planejamento Familiar', dividas: 'Dívidas', receitas: 'Receitas', relatorio: 'Relatório anual', mais: 'Mais opções' }[state.tab];
    $('#fab').style.display = ['resumo', 'dividas', 'receitas'].includes(state.tab) ? '' : 'none';
    $('#view').innerHTML = views[state.tab]();
  }

  // ---------- formulário de dívida ----------
  function formDivida(id) {
    const d = id ? state.dividas.find((x) => x.id === id) : null;
    const v = d || { tipo: 'Energia elétrica', nome: '', responsavel: '', vencimento: '', valor: '', jurosAtraso: 1, multaAtraso: 2, recorrente: true, recorrenteAte: '', valorParcela: '', jurosMensal: '', qtdParcelas: '', parcelasPagas: 0, pagamentos: {} };
    const preset = L.TIPOS.some((t) => t.nome === v.tipo);
    const opts = L.TIPOS.map((t) => `<option ${v.tipo === t.nome ? 'selected' : ''}>${esc(t.nome)}</option>`).join('') + `<option value="__custom" ${preset ? '' : 'selected'}>➕ Outro (digitar)</option>`;
    const resp = [...new Set([...state.dividas.map((x) => x.responsavel), ...state.rendas.map((x) => x.responsavel)].filter(Boolean))];
    const dataPg = d && !L.isEmprestimo(d) ? (d.pagamentos || {})[firstKey(d)] || '' : '';
    openSheet(`<h3>${d ? 'Editar dívida' : 'Nova dívida'}</h3>
      <form id="fDivida" data-id="${esc(id || '')}" autocomplete="off">
        <label class="field"><span>Tipo de dívida</span><select name="tipo">${opts}</select></label>
        <label class="field" id="wrapCustom" hidden><span>Nome do tipo</span><input name="tipoCustom" value="${preset ? '' : esc(v.tipo)}" placeholder="Ex.: Pensão, Mensalidade clube"></label>
        <label class="field"><span>Nome da dívida</span><input name="nome" required value="${esc(v.nome)}" placeholder="Ex.: Conta de luz da casa"></label>
        <label class="field"><span>Responsável pela dívida</span><input name="responsavel" list="dlResp" value="${esc(v.responsavel)}" placeholder="Ex.: Diogo"></label>
        <datalist id="dlResp">${resp.map((r) => `<option value="${esc(r)}">`).join('')}</datalist>
        <label class="field"><span id="lblVenc">Data de vencimento</span><input type="date" name="vencimento" required value="${esc(v.vencimento)}"></label>
        <div id="blocoComum">
          <label class="field"><span>Valor da dívida (R$)</span><input type="number" name="valor" step="0.01" min="0" inputmode="decimal" value="${esc(L.isEmprestimo(v) ? '' : v.valor)}"></label>
          <label class="check"><input type="checkbox" name="recorrente" ${v.recorrente ? 'checked' : ''}> Conta que se repete todo mês</label>
          <label class="field" id="wrapAte" hidden><span>Repetir até (opcional)</span><input type="date" name="recorrenteAte" value="${esc(v.recorrenteAte || '')}"></label>
          <label class="field"><span>Data do pagamento (se já foi paga)</span><input type="date" name="dataPagamento" value="${esc(dataPg)}" data-orig="${esc(dataPg)}"></label>
          <p class="hint">Em contas mensais, informe o <b>próximo</b> vencimento. Depois marque cada mês como pago na lista.</p>
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
        <div class="row2">
          <label class="field"><span>Juros por atraso (% ao mês)</span><input type="number" name="jurosAtraso" step="0.01" min="0" inputmode="decimal" value="${esc(v.jurosAtraso)}"></label>
          <label class="field"><span>Multa por atraso (%)</span><input type="number" name="multaAtraso" step="0.01" min="0" inputmode="decimal" value="${esc(v.multaAtraso)}"></label>
        </div>
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
    $('#wrapCustom').hidden = f.tipo.value !== '__custom';
    $('#blocoComum').hidden = emp; $('#blocoEmp').hidden = !emp;
    $('#lblVenc').textContent = emp ? 'Vencimento da próxima parcela' : 'Data de vencimento';
    $('#wrapAte').hidden = !f.recorrente.checked;
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
      jurosAtraso: num(f.jurosAtraso.value), multaAtraso: num(f.multaAtraso.value) });
    if (L.isEmprestimo(d)) {
      Object.assign(d, { valor: num(f.valorEmp.value), valorParcela: num(f.valorParcela.value), jurosMensal: num(f.jurosMensal.value),
        qtdParcelas: Math.round(num(f.qtdParcelas.value)), parcelasPagas: Math.round(num(f.parcelasPagas.value)), recorrente: false, recorrenteAte: '' });
    } else {
      Object.assign(d, { valor: num(f.valor.value), recorrente: f.recorrente.checked, recorrenteAte: f.recorrente.checked ? f.recorrenteAte.value : '' });
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
    const v = r || { descricao: '', tipo: 'Salário', responsavel: '', valor: '', data: '', recorrente: true, recorrenteAte: '' };
    const resp = [...new Set([...state.dividas.map((x) => x.responsavel), ...state.rendas.map((x) => x.responsavel)].filter(Boolean))];
    openSheet(`<h3>${r ? 'Editar receita' : 'Nova receita'}</h3>
      <form id="fRenda" data-id="${esc(id || '')}" autocomplete="off">
        <label class="field"><span>Descrição</span><input name="descricao" required value="${esc(v.descricao)}" placeholder="Ex.: Salário do Diogo"></label>
        <label class="field"><span>Tipo</span><select name="tipo">${L.TIPOS_RENDA.map((t) => `<option ${v.tipo === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></label>
        <label class="field"><span>Quem recebe</span><input name="responsavel" list="dlResp2" value="${esc(v.responsavel)}"></label>
        <datalist id="dlResp2">${resp.map((x) => `<option value="${esc(x)}">`).join('')}</datalist>
        <div class="row2">
          <label class="field"><span>Valor (R$)</span><input type="number" name="valor" step="0.01" min="0" inputmode="decimal" required value="${esc(v.valor)}"></label>
          <label class="field"><span>Data de recebimento</span><input type="date" name="data" required value="${esc(v.data)}"></label>
        </div>
        <label class="check"><input type="checkbox" name="recorrente" ${v.recorrente ? 'checked' : ''}> Recebo todo mês</label>
        <label class="field" id="wrapAteR" ${v.recorrente ? '' : 'hidden'}><span>Repetir até (opcional)</span><input type="date" name="recorrenteAte" value="${esc(v.recorrenteAte || '')}"></label>
        <div class="err" id="err"></div>
        <button class="btn" type="submit">Salvar receita</button>
      </form>
      <div class="btns" style="margin-top:8px">${r ? `<button class="btn danger" data-act="delRenda" data-id="${esc(r.id)}">Excluir receita</button>` : ''}<button class="btn alt" data-act="fechar">Cancelar</button></div>`);
  }

  async function salvarRenda(f) {
    const id = f.dataset.id, old = id ? state.rendas.find((x) => x.id === id) : null;
    const r = Object.assign(old ? {} : { id: uid(), criadoEm: Date.now() }, old || {}, {
      descricao: f.descricao.value.trim(), tipo: f.tipo.value, responsavel: f.responsavel.value.trim(), valor: num(f.valor.value),
      data: f.data.value, recorrente: f.recorrente.checked, recorrenteAte: f.recorrente.checked ? f.recorrenteAte.value : '' });
    if (!r.descricao || !(r.valor > 0) || !r.data) { $('#err').textContent = 'Preencha descrição, valor e data.'; return; }
    await DB.put('rendas', r);
    pedirPersistencia();
    await reload(); closeSheet(); render(); toast('Receita salva ✔');
  }

  // ---------- ocorrência (pagar / desfazer) ----------
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
    const info = `<div class="box"><b>${esc(d.tipo)}</b>${d.responsavel ? ' · ' + esc(d.responsavel) : ''}${o.label && o.label !== 'Mensal' ? ' · ' + esc(o.label) : ''}<br>Vencimento: <b>${fmtData(o.venc)}</b> · Valor: <b>${brl(o.valor)}</b></div>`;
    let body;
    if (o.pagoEm) {
      body = `${info}<div class="box" style="background:var(--green-soft);color:var(--green)">✅ Pago em <b>${fmtData(o.pagoEm)}</b>${o.pagoComAtraso ? `<br>Com ${o.enc.dias} dia(s) de atraso: multa ${brl(o.enc.multa)} + juros ${brl(o.enc.juros)} = <b>${brl(o.total)}</b>` : ''}</div>
        <div class="btns"><button class="btn alt" data-act="desfazer">Desfazer pagamento</button>`;
    } else {
      body = `${info}<label class="field"><span>Data do pagamento</span><input type="date" id="payDate" value="${hoje()}"></label><div class="box" id="boxEnc"></div>
        <div class="btns"><button class="btn" data-act="pagar">✔ Marcar como pago</button><button class="btn alt" data-act="calOcc">📅 Adicionar ao calendário</button>`;
    }
    openSheet(`<h3>${esc(d.nome)}</h3>${body}<button class="btn alt" data-act="editDivida" data-id="${esc(d.id)}">✏️ Editar dívida</button><button class="btn alt" data-act="fechar">Fechar</button></div>`);
    if (!o.pagoEm) atualizarEnc();
  }
  function atualizarEnc() {
    const f = cur && findOcc(cur.id, cur.key); const inp = $('#payDate'); if (!f || !inp || !inp.value) return;
    const e = L.encargos(f.o.valor, f.o.venc, inp.value, f.d.jurosAtraso, f.d.multaAtraso);
    $('#boxEnc').innerHTML = e.dias ? `⚠️ <b>${e.dias} dia(s) de atraso</b>: multa ${brl(e.multa)} + juros ${brl(e.juros)}<br>Total a pagar: <b>${brl(f.o.valor + e.total)}</b>` : `Pagamento em dia ✔ — total <b>${brl(f.o.valor)}</b>`;
  }
  async function setPagamento(data) {
    const f = findOcc(cur.id, cur.key); if (!f) return;
    const d = Object.assign({}, f.d, { pagamentos: Object.assign({}, f.d.pagamentos) });
    if (data) d.pagamentos[cur.key] = data; else delete d.pagamentos[cur.key];
    await DB.put('dividas', d); await reload(); closeSheet(); render();
    toast(data ? 'Pagamento registrado ✔' : 'Pagamento desfeito');
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
    const data = { app: 'planejamento-familiar', versao: 1, exportadoEm: new Date().toISOString(), dividas: state.dividas, rendas: state.rendas, config: state.cfg };
    baixar(new File([JSON.stringify(data, null, 2)], `backup-planejamento-familiar-${hoje()}.json`, { type: 'application/json' }));
    toast('Backup exportado ✔');
  }
  async function importarJSON(file) {
    try {
      const data = JSON.parse(await file.text());
      if (data.app !== 'planejamento-familiar' || !Array.isArray(data.dividas) || !Array.isArray(data.rendas)) throw new Error('formato');
      for (const d of data.dividas) if (d && d.id) await DB.put('dividas', d);
      for (const r of data.rendas) if (r && r.id) await DB.put('rendas', r);
      if (data.config && data.config.hora) await DB.setConfig('hora', data.config.hora);
      await reload(); render(); toast(`Importado: ${data.dividas.length} dívida(s) e ${data.rendas.length} receita(s).`);
    } catch (e) { toast('Arquivo inválido. Use um backup exportado por este app.'); }
  }
  function exportarCSV() {
    const a = L.resumoAno(state.dividas, state.rendas, state.ano, hoje());
    const c = (v) => String(v.toFixed ? v.toFixed(2) : v).replace('.', ',');
    const rows = [['Mês', 'Receitas', 'Dívidas', 'Saldo', 'Situação']];
    a.meses.forEach((m, i) => rows.push([MESES[i], c(m.receitas), c(m.dividas), c(m.saldo), m.receitas || m.dividas ? (m.saldo >= 0 ? 'Positivo' : 'Negativo') : '']));
    rows.push(['Total', c(a.receitas), c(a.dividas), c(a.saldo), a.saldo >= 0 ? 'Positivo' : 'Negativo'], [], ['Tipo de dívida', 'Total no ano']);
    Object.entries(a.porTipo).sort((x, y) => y[1] - x[1]).forEach(([t, v]) => rows.push([t, c(v)]));
    const csv = '﻿' + rows.map((r) => r.map((x) => `"${String(x).replace(/"/g, '""')}"`).join(';')).join('\r\n');
    baixar(new File([csv], `relatorio-${state.ano}.csv`, { type: 'text/csv' }));
  }

  // ---------- eventos ----------
  const actions = {
    mes: (t) => { state.ym = shiftYM(state.ym, +t.dataset.n); render(); },
    ano: (t) => { state.ano += +t.dataset.n; render(); },
    filtro: (t) => { state.filtro = t.dataset.v; render(); },
    occ: (t) => sheetOcc(t.dataset.id, t.dataset.key),
    renda: (t) => formRenda(t.dataset.id),
    novaDivida: () => formDivida(),
    novaRenda: () => formRenda(),
    editDivida: (t) => formDivida(t.dataset.id),
    fechar: closeSheet,
    pagar: () => { const v = $('#payDate').value; if (!v) { toast('Informe a data do pagamento.'); return; } setPagamento(v); },
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
      if (!confirm('Apagar TODAS as dívidas e receitas deste celular? Isso não pode ser desfeito.')) return;
      if (!confirm('Tem certeza? Faça um backup antes se tiver dúvida.')) return;
      await DB.clear('dividas'); await DB.clear('rendas'); await reload(); render(); toast('Dados apagados');
    },
  };

  document.addEventListener('click', (e) => {
    const tab = e.target.closest('[data-tab]');
    if (tab) { state.tab = tab.dataset.tab; render(); window.scrollTo(0, 0); return; }
    if (e.target.closest('#fab')) {
      if (state.tab === 'receitas') formRenda();
      else if (state.tab === 'dividas') formDivida();
      else openSheet(`<h3>O que deseja adicionar?</h3><div class="btns"><button class="btn" data-act="novaDivida">🧾 Nova dívida</button><button class="btn alt" data-act="novaRenda">💰 Nova receita</button><button class="btn alt" data-act="fechar">Cancelar</button></div>`);
      return;
    }
    const a = e.target.closest('[data-act]');
    if (a && actions[a.dataset.act]) actions[a.dataset.act](a);
  });
  sheet.addEventListener('click', (e) => { if (e.target === sheet) closeSheet(); });

  $('#sheetBody').addEventListener('input', (e) => {
    if (e.target.id === 'payDate') return atualizarEnc();
    if (e.target.form && e.target.form.id === 'fDivida') syncForm();
    if (e.target.form && e.target.form.id === 'fRenda' && e.target.name === 'recorrente') $('#wrapAteR').hidden = !e.target.checked;
  });
  $('#sheetBody').addEventListener('change', (e) => {
    const f = e.target.form;
    if (f && f.id === 'fDivida' && e.target.name === 'tipo') {
      const t = L.TIPOS.find((x) => x.nome === e.target.value);
      if (t) { f.recorrente.checked = t.recorrente; if (!f.nome.value.trim()) f.nome.value = t.nome; }
      else f.recorrente.checked = false;
      syncForm();
    }
    if (f && f.id === 'fRenda' && e.target.name === 'recorrente') $('#wrapAteR').hidden = !e.target.checked;
  });
  $('#sheetBody').addEventListener('submit', (e) => {
    e.preventDefault();
    if (e.target.id === 'fDivida') salvarDivida(e.target);
    if (e.target.id === 'fRenda') salvarRenda(e.target);
  });
  document.addEventListener('change', async (e) => {
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
