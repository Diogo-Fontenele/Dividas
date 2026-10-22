/* Regras de negócio do Planejamento Familiar (sem acesso a DOM / banco).
   Funciona no navegador (window.Logic), no Service Worker (importScripts) e no Node (testes). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Logic = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const pad = (n) => String(n).padStart(2, '0');
  const round2 = (v) => Math.round((v + Number.EPSILON) * 100) / 100;
  const toISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseISO = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const todayISO = () => toISO(new Date());

  // Soma meses mantendo o dia do vencimento (31 -> último dia de meses curtos).
  function addMonths(iso, n) {
    const [y, m, d] = iso.split('-').map(Number);
    const total = y * 12 + (m - 1) + n;
    const ny = Math.floor(total / 12), nm = total % 12;
    const last = new Date(ny, nm + 1, 0).getDate();
    return `${ny}-${pad(nm + 1)}-${pad(Math.min(d, last))}`;
  }
  function addDays(iso, n) { const d = parseISO(iso); d.setDate(d.getDate() + n); return toISO(d); }
  function daysBetween(aISO, bISO) {
    const a = parseISO(aISO), b = parseISO(bISO);
    return Math.round((Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) - Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) / 86400000);
  }

  // Tipos pré-cadastrados. "recorrente" = sugestão de conta mensal; "variavel" = valor costuma mudar todo mês.
  const TIPOS = [
    { nome: 'Energia elétrica', recorrente: true, variavel: true },
    { nome: 'Água', recorrente: true, variavel: true },
    { nome: 'Internet', recorrente: true },
    { nome: 'Telefone / Celular', recorrente: true },
    { nome: 'Gás', recorrente: true, variavel: true },
    { nome: 'Aluguel', recorrente: true },
    { nome: 'Condomínio', recorrente: true },
    { nome: 'IPTU', recorrente: false },
    { nome: 'IPVA', recorrente: false },
    { nome: 'Cartão de crédito', recorrente: true, variavel: true },
    { nome: 'Escola / Faculdade', recorrente: true },
    { nome: 'Plano de saúde', recorrente: true },
    { nome: 'Seguro', recorrente: false },
    { nome: 'Streaming / Assinaturas', recorrente: true },
    { nome: 'Empréstimo', recorrente: false },
    { nome: 'Financiamento', recorrente: false },
    { nome: 'Outros', recorrente: false },
  ];
  const TIPOS_RENDA = ['Salário', 'Freelance / Extra', 'Benefício', 'Aluguel recebido', 'Rendimentos', 'Outros'];
  const TIPOS_EMPRESTIMO = ['Empréstimo', 'Financiamento'];
  const isEmprestimo = (d) => TIPOS_EMPRESTIMO.includes(d.tipo);

  // ---------- Valor de cada mês (contas e receitas que se repetem) ----------
  // Ordem: valor informado para o mês > (variável) estimativa > (fixo) último reajuste vigente > valor base.
  // reajustes: [{ desde: 'YYYY-MM', valor }]   valores: { 'YYYY-MM': valor }
  function valorMes(x, key, ym) {
    const v = x.valores && x.valores[key];
    if (v != null && v !== '') return { valor: round2(Number(v) || 0), estimado: false, origem: 'mes' };
    if (x.tipoValor === 'variavel') return { valor: round2(Number(x.valor) || 0), estimado: true, origem: 'estimativa' };
    let val = Number(x.valor) || 0, origem = 'base';
    const rs = (x.reajustes || []).filter((r) => r && r.desde).slice().sort((a, b) => a.desde.localeCompare(b.desde));
    for (const r of rs) if (r.desde <= ym) { val = Number(r.valor) || 0; origem = 'reajuste'; }
    return { valor: round2(val), estimado: false, origem };
  }
  // Reajuste: vale do mês "desde" em diante (até o próximo reajuste).
  function aplicarReajuste(x, desde, valor) {
    const reajustes = (x.reajustes || []).filter((r) => r.desde !== desde).concat([{ desde, valor: round2(Number(valor) || 0) }])
      .sort((a, b) => a.desde.localeCompare(b.desde));
    const valores = Object.assign({}, x.valores); delete valores[desde];
    return Object.assign({}, x, { reajustes, valores });
  }
  // Valor só de um mês (ex.: conta de luz variável, ou um mês fora do normal).
  function definirValorMes(x, key, valor) {
    return Object.assign({}, x, { valores: Object.assign({}, x.valores, { [key]: round2(Number(valor) || 0) }) });
  }

  // ---------- Juros por atraso: valor fixo em R$ cadastrado em cada dívida ----------
  // Dívidas antigas (cadastradas com % de multa/juros) são convertidas em R$ sobre o valor cadastrado.
  function acrescimoDe(d) {
    if (d.acrescimoAtraso != null && d.acrescimoAtraso !== '') return round2(Number(d.acrescimoAtraso) || 0);
    const base = isEmprestimo(d) ? d.valorParcela : d.valor;
    return round2((Number(base) || 0) * ((Number(d.multaAtraso) || 0) + (Number(d.jurosAtraso) || 0)) / 100);
  }
  function encargos(venc, ref, acrescimo) {
    const dias = Math.max(0, daysBetween(venc, ref));
    if (!dias) return { dias: 0, multa: 0, juros: 0, total: 0 };
    const juros = round2(Number(acrescimo) || 0);
    return { dias, multa: 0, juros, total: juros };
  }

  // Gera as ocorrências (vencimentos) de uma dívida até a data "ate" (ISO).
  // key: 'u' (única), 'YYYY-MM' (recorrente) ou 'pN' (parcela de empréstimo).
  function ocorrencias(d, ate) {
    const pg = d.pagamentos || {};
    const out = [];
    if (!d.vencimento) return out;
    if (isEmprestimo(d)) {
      const total = Number(d.qtdParcelas) || 0, pagas = Number(d.parcelasPagas) || 0;
      for (let k = 0; k < Math.max(0, total - pagas); k++) {
        const key = 'p' + k;
        out.push({ debtId: d.id, key, venc: addMonths(d.vencimento, k), valor: Number(d.valorParcela) || 0, estimado: false,
          pagoEm: pg[key] || null, label: `Parcela ${pagas + k + 1}/${total}` });
      }
      return out;
    }
    if (d.recorrente) {
      for (let k = 0; k < 600; k++) {
        const venc = addMonths(d.vencimento, k);
        if (venc > ate) break;
        if (d.recorrenteAte && venc > d.recorrenteAte) break;
        const key = venc.slice(0, 7);
        const vm = valorMes(d, key, key);
        out.push({ debtId: d.id, key, venc, valor: vm.valor, estimado: vm.estimado, origem: vm.origem, pagoEm: pg[key] || null, label: 'Mensal' });
      }
      return out;
    }
    out.push({ debtId: d.id, key: 'u', venc: d.vencimento, valor: Number(d.valor) || 0, estimado: false, pagoEm: pg.u || null, label: '' });
    return out.filter((o) => o.venc <= ate);
  }

  function detalhe(o, d, hoje) {
    const enc = encargos(o.venc, o.pagoEm || hoje, acrescimoDe(d));
    let status = 'aberto';
    if (o.pagoEm) status = 'pago';
    else if (o.venc < hoje) status = 'atrasado';
    else if (o.venc === hoje) status = 'hoje';
    return Object.assign({}, o, { d, status, enc, total: round2(o.valor + enc.total), pagoComAtraso: !!o.pagoEm && enc.dias > 0 });
  }

  function occsDividas(dividas, ate, hoje) {
    const out = [];
    for (const d of dividas) for (const o of ocorrencias(d, ate)) out.push(detalhe(o, d, hoje));
    return out.sort((a, b) => a.venc.localeCompare(b.venc) || a.d.nome.localeCompare(b.d.nome));
  }

  // Receitas: mesma lógica (fixa com reajustes, ou variável informada mês a mês).
  function occsRendas(rendas, ate) {
    const out = [];
    for (const r of rendas) {
      if (!r.data) continue;
      if (r.recorrente) {
        for (let k = 0; k < 600; k++) {
          const data = addMonths(r.data, k);
          if (data > ate) break;
          if (r.recorrenteAte && data > r.recorrenteAte) break;
          const key = data.slice(0, 7);
          const vm = valorMes(r, key, key);
          out.push({ r, rendaId: r.id, key, data, valor: vm.valor, estimado: vm.estimado, origem: vm.origem });
        }
      } else if (r.data <= ate) out.push({ r, rendaId: r.id, key: 'u', data: r.data, valor: Number(r.valor) || 0, estimado: false });
    }
    return out.sort((a, b) => a.data.localeCompare(b.data));
  }

  function resumoMes(dividas, rendas, ym, hoje) {
    const fim = ym + '-31';
    const occs = occsDividas(dividas, fim, hoje).filter((o) => o.venc.startsWith(ym));
    const recs = occsRendas(rendas, fim).filter((r) => r.data.startsWith(ym));
    const soma = (arr, f) => round2(arr.reduce((s, x) => s + f(x), 0));
    const receitas = soma(recs, (r) => r.valor);
    const dividasTotal = soma(occs, (o) => o.total);
    return {
      ym, occs, recs, receitas, dividas: dividasTotal,
      pago: soma(occs.filter((o) => o.status === 'pago'), (o) => o.total),
      atrasado: soma(occs.filter((o) => o.status === 'atrasado'), (o) => o.total),
      aberto: soma(occs.filter((o) => o.status === 'aberto' || o.status === 'hoje'), (o) => o.total),
      saldo: round2(receitas - dividasTotal),
      qtd: occs.length, qtdPagas: occs.filter((o) => o.status === 'pago').length,
      estimados: occs.filter((o) => o.estimado).length + recs.filter((r) => r.estimado).length,
    };
  }

  function resumoAno(dividas, rendas, ano, hoje) {
    const meses = [];
    for (let m = 1; m <= 12; m++) meses.push(resumoMes(dividas, rendas, `${ano}-${pad(m)}`, hoje));
    const porTipo = {};
    for (const mes of meses) for (const o of mes.occs) porTipo[o.d.tipo] = round2((porTipo[o.d.tipo] || 0) + o.total);
    const receitas = round2(meses.reduce((s, m) => s + m.receitas, 0));
    const divs = round2(meses.reduce((s, m) => s + m.dividas, 0));
    const comMovimento = meses.filter((m) => m.receitas || m.dividas);
    return {
      ano, meses, receitas, dividas: divs, saldo: round2(receitas - divs), porTipo,
      estimados: meses.reduce((s, m) => s + m.estimados, 0),
      mesesPositivos: comMovimento.filter((m) => m.saldo >= 0).length,
      mesesNegativos: comMovimento.filter((m) => m.saldo < 0).length,
    };
  }

  function atrasadas(dividas, hoje) { return occsDividas(dividas, hoje, hoje).filter((o) => o.status === 'atrasado'); }
  function vencendoHoje(dividas, hoje) { return occsDividas(dividas, hoje, hoje).filter((o) => o.venc === hoje && !o.pagoEm); }
  function proximos(dividas, hoje, dias) {
    const ate = addDays(hoje, dias || 30);
    return occsDividas(dividas, ate, hoje).filter((o) => !o.pagoEm && o.venc >= hoje);
  }

  function infoEmprestimo(d) {
    const total = Number(d.qtdParcelas) || 0, inicial = Number(d.parcelasPagas) || 0;
    const marcadas = Object.keys(d.pagamentos || {}).filter((k) => /^p\d+$/.test(k) && d.pagamentos[k]).length;
    const pagas = Math.min(total, inicial + marcadas);
    const restantes = Math.max(0, total - pagas);
    return { total, pagas, restantes, valorRestante: round2(restantes * (Number(d.valorParcela) || 0)),
      progresso: total ? Math.round((pagas / total) * 100) : 0 };
  }

  // ---------- Calendário (.ics) ----------
  const icsEsc = (s) => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
  function fold(line) {
    const chars = Array.from(line), parts = [];
    let cur = '';
    for (const ch of chars) { if (cur.length + ch.length > 60) { parts.push(cur); cur = ' ' + ch; } else cur += ch; }
    parts.push(cur);
    return parts.join('\r\n');
  }
  const brl = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  function gerarICS(dividas, hoje, hora) {
    hora = /^\d{2}:\d{2}$/.test(hora || '') ? hora : '09:00';
    const [hh, mm] = hora.split(':').map(Number);
    const fimMin = Math.min(hh * 60 + mm + 30, 23 * 60 + 59);
    const hf = `${pad(Math.floor(fimMin / 60))}${pad(fimMin % 60)}00`;
    const agora = new Date();
    const stamp = `${agora.getUTCFullYear()}${pad(agora.getUTCMonth() + 1)}${pad(agora.getUTCDate())}T${pad(agora.getUTCHours())}${pad(agora.getUTCMinutes())}${pad(agora.getUTCSeconds())}Z`;
    const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Planejamento Familiar//PT-BR//', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:Vencimentos da família'];
    let count = 0;
    for (const d of dividas) {
      const acr = acrescimoDe(d);
      for (const o of ocorrencias(d, addMonths(hoje, 12))) {
        if (o.pagoEm || o.venc < hoje) continue;
        count++;
        const dia = o.venc.replace(/-/g, '');
        const titulo = `💸 Vence hoje: ${d.nome}${o.label && o.label !== 'Mensal' ? ' (' + o.label + ')' : ''}`;
        const valorTxt = o.estimado ? (o.valor > 0 ? `valor variável (estimado ${brl(o.valor)})` : 'valor variável - informe no app') : brl(o.valor);
        const desc = [`${d.tipo} · ${valorTxt}`, d.responsavel ? `Responsável: ${d.responsavel}` : '',
          acr > 0 ? `Se pagar em atraso: +${brl(acr)} de juros` : ''].filter(Boolean).join('\n');
        L.push('BEGIN:VEVENT', `UID:pf-${d.id}-${o.key}@planejamento-familiar`, `DTSTAMP:${stamp}`,
          `DTSTART:${dia}T${pad(hh)}${pad(mm)}00`, `DTEND:${dia}T${hf}`,
          fold('SUMMARY:' + icsEsc(titulo)), fold('DESCRIPTION:' + icsEsc(desc)),
          'BEGIN:VALARM', 'ACTION:DISPLAY', fold('DESCRIPTION:' + icsEsc(titulo)), 'TRIGGER:-PT0M', 'END:VALARM', 'END:VEVENT');
      }
    }
    L.push('END:VCALENDAR');
    return { ics: L.join('\r\n') + '\r\n', count };
  }

  const variavelRec = (x) => !!x.recorrente && x.tipoValor === 'variavel';

  function validarDivida(d) {
    const erros = [];
    if (!d.nome || !d.nome.trim()) erros.push('Informe o nome da dívida.');
    if (!d.vencimento) erros.push('Informe a data de vencimento.');
    if (isEmprestimo(d)) {
      if (!(Number(d.valorParcela) > 0)) erros.push('Informe o valor da parcela.');
      if (!(Number(d.qtdParcelas) > 0)) erros.push('Informe a quantidade de parcelas.');
      if (Number(d.parcelasPagas) > Number(d.qtdParcelas)) erros.push('Parcelas pagas não pode ser maior que o total.');
    } else {
      if (!variavelRec(d) && !(Number(d.valor) > 0)) erros.push('Informe o valor da dívida.');
      if (d.recorrente && d.recorrenteAte && d.vencimento && d.recorrenteAte < d.vencimento) erros.push('O fim do contrato deve ser depois do vencimento.');
    }
    return erros;
  }

  return { TIPOS, TIPOS_RENDA, TIPOS_EMPRESTIMO, isEmprestimo, variavelRec, pad, round2, toISO, parseISO, todayISO, addMonths, addDays, daysBetween,
    valorMes, aplicarReajuste, definirValorMes, acrescimoDe, encargos, ocorrencias, detalhe, occsDividas, occsRendas, resumoMes, resumoAno,
    atrasadas, vencendoHoje, proximos, infoEmprestimo, gerarICS, validarDivida, brl };
});
