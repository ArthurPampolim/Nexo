import { state, monthLabels, currencyFormatter } from '../core.js';
import { monthPerformance, fixedCostsPaid } from '../finance.js';
import { app } from '../app.js';

// ── Tela Desempenho: economia e balanço do mês selecionado ──
const pct = (n) => `${Math.round(n)}%`;
const strong = (text) => `<strong>${text}</strong>`;

export function renderPerformance() {
  const saving = document.getElementById('perf-saving');
  const balanceEl = document.getElementById('perf-balance');
  const fixedEl = document.getElementById('perf-fixed');
  if (!saving || !balanceEl || !fixedEl) return;

  const ym = app.getSelectedYYYYMM();
  const [year, month] = ym.split('-').map(Number);
  const prev = new Date(year, month - 2, 1);
  const prevYm = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`;
  const fmt = (v) => currencyFormatter.format(v);

  const cur = monthPerformance(state.transactions, ym);
  const before = monthPerformance(state.transactions, prevYm);
  const monthName = (monthLabels.find(m => m.number === month) || {}).full || ym;

  // Economia
  if (cur.income === 0 && cur.expense === 0) {
    saving.innerHTML = 'Ainda não há receitas nem despesas efetivadas neste mês.';
  } else if (cur.income === 0) {
    saving.innerHTML = `Você gastou ${strong(fmt(cur.expense))} sem nenhuma receita neste mês.`;
  } else if (cur.expense > cur.income) {
    saving.innerHTML = `Você gastou ${strong(pct((cur.expense - cur.income) / cur.income * 100) + ' a mais')} que os seus ganhos`;
  } else {
    saving.innerHTML = `Você economizou ${strong(pct((cur.income - cur.expense) / cur.income * 100))} dos seus ganhos`;
  }

  // Balanço mensal
  let compare = '';
  if (before.balance !== 0 && cur.balance !== before.balance) {
    const change = Math.abs(cur.balance - before.balance) / Math.abs(before.balance) * 100;
    compare = `, ${strong(pct(change) + (cur.balance > before.balance ? ' a mais' : ' a menos'))} que no mês anterior`;
  }
  balanceEl.innerHTML = `Em ${monthName.toLowerCase()}, seu balanço mensal foi de ${strong(fmt(cur.balance))}${compare}`;

  const fixed = fixedCostsPaid(state.fixedCosts, ym);
  fixedEl.innerHTML = cur.income > 0
    ? `Você gastou ${strong(pct(fixed / cur.income * 100))} das suas receitas em despesas fixas efetuadas`
    : `Sem receitas neste mês para comparar. Despesas fixas efetuadas: ${strong(fmt(fixed))}`;
}
