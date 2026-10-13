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

  // Tipos pré-cadastrados. "recorrente" = sugestão inicial (conta que vem todo mês).
  const TIPOS = [
    { nome: 'Energia elétrica', recorrente: true },
    { nome: 'Água', recorrente: true },
    { nome: 'Internet', recorrente: true },
    { nome: 'Telefone / Celular', recorrente: true },
    { nome: 'Gás', recorrente: true },
    { nome: 'Aluguel', recorrente: true },
    { nome: 'Condomínio', recorrente: true },
    { nome: 'IPTU', recorrente: false },
    { nome: 'IPVA', recorrente: false },
    { nome: 'Cartão de crédito', recorrente: true },
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

  // Multa fixa + juros simples pro rata (% ao mês / 30 por dia de atraso).
  function encargos(valor, venc, ref, jurosMes, multaPct) {
    const dias = Math.max(0, daysBetween(venc, ref));
    if (!dias) return { dias: 0, multa: 0, juros: 0, total: 0 };
    const multa = round2(valor * (Number(multaPct) || 0) / 100);
    const juros = round2(valor * ((Number(jurosMes) || 0) / 100 / 30) * dias);
    return { dias, multa, juros, total: round2(multa + juros) };
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
        out.push({ debtId: d.id, key, venc: addMonths(d.vencimento, k), valor: Number(d.valorParcela) || 0,
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
        out.push({ debtId: d.id, key, venc, valor: Number(d.valor) || 0, pagoEm: pg[key] || null, label: 'Mensal' });
      }
      return out;
    }
    out.push({ debtId: d.id, key: 'u', venc: d.vencimento, valor: Number(d.valor) || 0, pagoEm: pg.u || null, label: '' });
    return out.filter((o) => o.venc <= ate);
  }

  function detalhe(o, d, hoje) {
    const enc = encargos(o.valor, o.venc, o.pagoEm || hoje, d.jurosAtraso, d.multaAtraso);
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

  function occsRendas(rendas, ate) {
    const out = [];
    for (const r of rendas) {
      if (!r.data) continue;
      if (r.recorrente) {
        for (let k = 0; k < 600; k++) {
          const data = addMonths(r.data, k);
          if (data > ate) break;
          if (r.recorrenteAte && data > r.recorrenteAte) break;
          out.push({ r, rendaId: r.id, data, valor: Number(r.valor) || 0 });
        }
      } else if (r.data <= ate) out.push({ r, rendaId: r.id, data: r.data, valor: Number(r.valor) || 0 });
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
      for (const o of ocorrencias(d, addMonths(hoje, 12))) {
        if (o.pagoEm || o.venc < hoje) continue;
        count++;
        const dia = o.venc.replace(/-/g, '');
        const titulo = `💸 Vence hoje: ${d.nome}${o.label && o.label !== 'Mensal' ? ' (' + o.label + ')' : ''}`;
        const desc = [`${d.tipo} · ${brl(o.valor)}`, d.responsavel ? `Responsável: ${d.responsavel}` : '',
          Number(d.jurosAtraso) || Number(d.multaAtraso) ? `Atraso: multa ${Number(d.multaAtraso) || 0}% + juros ${Number(d.jurosAtraso) || 0}% ao mês` : ''].filter(Boolean).join('\n');
        L.push('BEGIN:VEVENT', `UID:pf-${d.id}-${o.key}@planejamento-familiar`, `DTSTAMP:${stamp}`,
          `DTSTART:${dia}T${pad(hh)}${pad(mm)}00`, `DTEND:${dia}T${hf}`,
          fold('SUMMARY:' + icsEsc(titulo)), fold('DESCRIPTION:' + icsEsc(desc)),
          'BEGIN:VALARM', 'ACTION:DISPLAY', fold('DESCRIPTION:' + icsEsc(titulo)), 'TRIGGER:-PT0M', 'END:VALARM', 'END:VEVENT');
      }
    }
    L.push('END:VCALENDAR');
    return { ics: L.join('\r\n') + '\r\n', count };
  }

  function validarDivida(d) {
    const erros = [];
    if (!d.nome || !d.nome.trim()) erros.push('Informe o nome da dívida.');
    if (!d.vencimento) erros.push('Informe a data de vencimento.');
    if (isEmprestimo(d)) {
      if (!(Number(d.valorParcela) > 0)) erros.push('Informe o valor da parcela.');
      if (!(Number(d.qtdParcelas) > 0)) erros.push('Informe a quantidade de parcelas.');
      if (Number(d.parcelasPagas) > Number(d.qtdParcelas)) erros.push('Parcelas pagas não pode ser maior que o total.');
    } else if (!(Number(d.valor) > 0)) erros.push('Informe o valor da dívida.');
    return erros;
  }

  return { TIPOS, TIPOS_RENDA, TIPOS_EMPRESTIMO, isEmprestimo, pad, round2, toISO, parseISO, todayISO, addMonths, addDays, daysBetween,
    encargos, ocorrencias, detalhe, occsDividas, occsRendas, resumoMes, resumoAno, atrasadas, vencendoHoje, proximos,
    infoEmprestimo, gerarICS, validarDivida, brl };
});
