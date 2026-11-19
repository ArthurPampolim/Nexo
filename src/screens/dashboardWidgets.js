import { state, currencyFormatter, escapeHTML, activeTransactions, formatDateBR } from '../core.js';
import { monthSummary, isSettled, isTransferTransaction } from '../finance.js';
import { auth } from '../firebase.js';
import { app } from '../app.js';

// ── Registro dos cards configuráveis ──
const CARDS = [
  { id: 'receitas-cat', side: 'left', label: 'Mostrar gráfico de receitas por categoria?' },
  { id: 'orcamento', side: 'left', label: 'Mostrar resumo do orçamento do mês atual?' },
  { id: 'frequencia', side: 'left', label: 'Mostrar gráfico de frequência de gastos?' },
  { id: 'pendentes', side: 'left', label: 'Mostrar transações pendentes?' },
  { id: 'economia', side: 'left', label: 'Mostrar informações da economia no mês atual?' },
  { id: 'contas', side: 'left', label: 'Mostrar minhas contas?' },
  { id: 'cartoes', side: 'left', label: 'Mostrar informações de cartão de crédito?' },
  { id: 'despesas-cat', side: 'right', label: 'Mostrar gráfico de despesas por categoria?' },
  { id: 'balanco-mensal', side: 'right', label: 'Mostrar gráfico do balanço mensal?' },
  { id: 'objetivos', side: 'right', label: 'Mostrar seus objetivos?' },
  { id: 'balanco-semestral', side: 'right', label: 'Mostrar gráfico do balanço semestral?' },
  { id: 'balanco-trimestral', side: 'right', label: 'Mostrar gráfico do balanço trimestral?' },
  { id: 'perfil', side: 'right', label: 'Mostrar informações de perfil?' }
];

// ── Preferências (ficam no navegador, por usuário) ──
// shortcut: localStorage não sincroniza entre dispositivos; mover para Usuarios/{uid} se for preciso.
const prefsKey = () => `nexo_dash_cards_${auth.currentUser ? auth.currentUser.uid : ''}`;

function loadPrefs() {
  try { return JSON.parse(localStorage.getItem(prefsKey())) || {}; } catch { return {}; }
}

function applyPrefs() {
  const prefs = loadPrefs();
  document.querySelectorAll('[data-dash-card]').forEach(el => {
    el.classList.toggle('hidden', prefs[el.dataset.dashCard] === false);
  });
}

let settingsBuiltFor = null;

function renderSettings() {
  const host = document.getElementById('dash-settings-body');
  const key = prefsKey();
  if (!host || settingsBuiltFor === key) return;
  settingsBuiltFor = key;

  const prefs = loadPrefs();
  const column = (side, title) => `
    <div class="dset-col">
      <h4>${title}</h4>
      ${CARDS.filter(c => c.side === side).map(c => `
        <label class="dset-row">
          <input type="checkbox" data-card="${c.id}" ${prefs[c.id] === false ? '' : 'checked'}>
          <span>${c.label}</span>
        </label>`).join('')}
    </div>`;

  host.innerHTML = `
    <h3 class="dset-title">Quais cards você deseja que apareça no dashboard?</h3>
    <div class="dset-cols">${column('left', 'Cards da esquerda')}${column('right', 'Cards da direita')}</div>
    <div class="dset-actions"><button type="button" class="btn-primary dset-save">SALVAR</button></div>`;

  host.querySelector('.dset-save').addEventListener('click', () => {
    const next = {};
    host.querySelectorAll('input[data-card]').forEach(cb => { next[cb.dataset.card] = cb.checked; });
    try { localStorage.setItem(prefsKey(), JSON.stringify(next)); } catch { /* sem storage: vale só até recarregar */ }
    applyPrefs();
    app.showToast('Dashboard atualizado!', 'success');
  });
}

// ── Helpers ──
const empty = (icon, text, tab, label) => `
  <div class="dw-empty">
    <i class="fas ${icon}"></i>
    <p>${text}</p>
    <button type="button" class="dw-link" onclick="AppController.switchTab('${tab}')">${label} <i class="fas fa-arrow-right"></i></button>
  </div>`;

const moreLink = (tab, text) => `<button type="button" class="dw-link" onclick="AppController.switchTab('${tab}')">${text} <i class="fas fa-arrow-right"></i></button>`;

const plansOf = ym => (state.planning || []).filter(p => String(p.MesReferencia).trim() === `PLAN-${ym}`);

// Receita e despesa do mês, com as faturas de cartão do mês somadas à despesa
function monthFlow(ym) {
  const monthTxs = activeTransactions().filter(t => t.Data && t.Data.slice(0, 7) === ym);
  const cardTotal = state.creditTransactions
    .filter(ct => String(ct.MesFatura).slice(0, 7) === ym)
    .reduce((sum, ct) => sum + (parseFloat(ct.Valor) || 0), 0);
  const { income, expense } = monthSummary(monthTxs);
  return { income, expense: expense + cardTotal, monthTxs };
}

// ── Orçamento do mês ──
function renderPlanningWidget(ym) {
  const host = document.getElementById('dash-planning-body');
  if (!host) return;
  const plans = plansOf(ym);
  if (!plans.length) {
    host.innerHTML = empty('fa-route', 'Nenhum planejamento definido para este mês.', 'planning', 'Planejar agora');
    return;
  }

  const planned = plans.reduce((sum, p) => sum + (parseFloat(p.ValorLimite) || 0), 0);
  const income = parseFloat(plans[0].Renda) || 0;
  const spent = monthFlow(ym).expense;

  const pct = planned > 0 ? Math.round(spent / planned * 100) : 0;
  const level = pct > 100 ? 'bad' : pct >= 80 ? 'warn' : 'good';
  const left = planned - spent;
  host.innerHTML = `
    <div class="dw-plan-top">
      <strong>${currencyFormatter.format(spent)}</strong>
      <span>de ${currencyFormatter.format(planned)} planejados</span>
    </div>
    <div class="dw-bar dw-${level}" role="progressbar" aria-valuenow="${Math.min(pct, 100)}" aria-valuemin="0" aria-valuemax="100"><span style="width:${Math.min(pct, 100)}%"></span></div>
    <div class="dw-plan-meta">
      <span>${pct}% usado</span>
      <span class="dw-${level}-text">${left >= 0 ? `Restam ${currencyFormatter.format(left)}` : `Estourou ${currencyFormatter.format(-left)}`}</span>
    </div>
    <div class="dw-plan-income">Renda planejada: <strong>${currencyFormatter.format(income)}</strong></div>`;
}

// ── Objetivos ──
function renderGoalsWidget() {
  const host = document.getElementById('dash-goals-body');
  if (!host) return;
  const active = (state.goals || []).filter(g => g.Status === 'Ativo');
  if (!active.length) {
    host.innerHTML = empty('fa-bullseye', 'Você ainda não tem objetivos em andamento.', 'goals', 'Criar objetivo');
    return;
  }
  const top = [...active].sort((a, b) => (b.Progresso || 0) - (a.Progresso || 0)).slice(0, 3);
  host.innerHTML = `<ul class="dw-goals">${top.map(g => {
    const pct = Math.round(g.Progresso || 0);
    return `
      <li>
        <div class="dw-goal-row">
          <strong>${escapeHTML(g.Nome)}</strong>
          <span>${pct}%</span>
        </div>
        <div class="dw-bar dw-good" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><span style="width:${pct}%"></span></div>
        <small>${currencyFormatter.format(parseFloat(g.ValorAtual) || 0)} de ${currencyFormatter.format(parseFloat(g.ValorAlvo) || 0)}</small>
      </li>`;
  }).join('')}</ul>
  ${active.length > top.length ? moreLink('goals', `Ver todos (${active.length})`) : ''}`;
}

// ── Transações pendentes (agendadas) do mês ──
function renderPendingWidget(ym) {
  const host = document.getElementById('dash-pending-body');
  if (!host) return;
  const pending = monthFlow(ym).monthTxs
    .filter(t => !t.Ignorar && !isTransferTransaction(t) && !isSettled(t))
    .sort((a, b) => String(a.Data).localeCompare(String(b.Data)));
  if (!pending.length) {
    host.innerHTML = empty('fa-circle-check', 'Nenhuma transação pendente neste mês.', 'transactions', 'Ver transações');
    return;
  }

  const sum = tipo => pending.filter(t => t.Tipo === tipo).reduce((s, t) => s + (parseFloat(t.Valor) || 0), 0);
  const top = pending.slice(0, 5);
  host.innerHTML = `
    <div class="dw-pend-totals">
      <span>A receber <strong class="dw-good-text">${currencyFormatter.format(sum('RECEITA'))}</strong></span>
      <span>A pagar <strong class="dw-bad-text">${currencyFormatter.format(sum('DESPESA'))}</strong></span>
    </div>
    <ul class="dw-list">${top.map(t => `
      <li>
        <span class="dw-list-main"><strong>${escapeHTML(t.Descricao || t.Categoria || '-')}</strong><small>${formatDateBR(t.Data)}</small></span>
        <span class="${t.Tipo === 'RECEITA' ? 'dw-good-text' : 'dw-bad-text'}">${t.Tipo === 'RECEITA' ? '+' : '-'}${currencyFormatter.format(parseFloat(t.Valor) || 0)}</span>
      </li>`).join('')}</ul>
    ${pending.length > top.length ? moreLink('transactions', `Ver todas (${pending.length})`) : ''}`;
}

// ── Economia do mês ──
function renderSavingsWidget(ym) {
  const host = document.getElementById('dash-savings-body');
  if (!host) return;
  const { income, expense } = monthFlow(ym);
  if (!income && !expense) {
    host.innerHTML = empty('fa-piggy-bank', 'Sem movimentações neste mês para calcular a economia.', 'transactions', 'Ver transações');
    return;
  }

  const saved = income - expense;
  const pct = income > 0 ? Math.round(saved / income * 100) : 0;
  const plan = plansOf(ym)[0];
  const goal = plan ? parseFloat(plan.EconomiaPct) || 0 : 0;
  const level = saved < 0 ? 'bad' : goal && pct < goal ? 'warn' : 'good';
  host.innerHTML = `
    <div class="dw-plan-top">
      <strong class="dw-${level}-text">${currencyFormatter.format(saved)}</strong>
      <span>${saved >= 0 ? 'economizados' : 'no vermelho'} no mês</span>
    </div>
    <div class="dw-bar dw-${level}" role="progressbar" aria-valuenow="${Math.max(0, Math.min(pct, 100))}" aria-valuemin="0" aria-valuemax="100"><span style="width:${Math.max(0, Math.min(pct, 100))}%"></span></div>
    <div class="dw-plan-meta">
      <span>${pct}% da renda</span>
      <span>${goal ? `Meta: ${goal}%` : 'Sem meta definida'}</span>
    </div>
    <div class="dw-plan-income">Receitas <strong>${currencyFormatter.format(income)}</strong> · Despesas <strong>${currencyFormatter.format(expense)}</strong></div>`;
}

// ── Cartões de crédito ──
function renderCardsWidget(ym) {
  const host = document.getElementById('dash-cards-body');
  if (!host) return;
  if (!state.creditCards.length) {
    host.innerHTML = empty('fa-credit-card', 'Nenhum cartão cadastrado.', 'credit-cards', 'Cadastrar cartão');
    return;
  }

  const top = state.creditCards.slice(0, 3);
  host.innerHTML = `<ul class="dw-goals">${top.map(card => {
    const own = state.creditTransactions.filter(ct => String(ct.IdCartao || ct.CartaoID) === String(card.ID));
    const used = own.filter(ct => ct.Status !== 'Pago').reduce((s, ct) => s + (parseFloat(ct.Valor) || 0), 0);
    const invoice = own.filter(ct => String(ct.MesFatura).slice(0, 7) === ym).reduce((s, ct) => s + (parseFloat(ct.Valor) || 0), 0);
    const limit = parseFloat(card.Limite) || 0;
    const pct = limit > 0 ? Math.min(100, Math.round(used / limit * 100)) : 0;
    const level = pct >= 90 ? 'bad' : pct >= 70 ? 'warn' : 'good';
    return `
      <li>
        <div class="dw-goal-row">
          <strong>${escapeHTML(card.Nome)}</strong>
          <span>Fatura ${currencyFormatter.format(invoice)}</span>
        </div>
        <div class="dw-bar dw-${level}" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><span style="width:${pct}%"></span></div>
        <small>${currencyFormatter.format(used)} usados de ${currencyFormatter.format(limit)} · vence dia ${parseInt(card.DiaVencimento) || '-'}</small>
      </li>`;
  }).join('')}</ul>
  ${state.creditCards.length > top.length ? moreLink('credit-cards', `Ver todos (${state.creditCards.length})`) : moreLink('credit-cards', 'Ver cartões & faturas')}`;
}

// ── Perfil ──
function renderProfileWidget() {
  const host = document.getElementById('dash-profile-body');
  if (!host) return;
  const user = auth.currentUser;
  if (!user) return;
  const name = (document.querySelector('#user-menu-trigger span')?.innerText || '').trim() || user.displayName || (user.email || 'Usuário').split('@')[0];
  host.innerHTML = `
    <div class="dw-profile">
      <span class="dw-avatar" aria-hidden="true">${escapeHTML(name.charAt(0).toUpperCase())}</span>
      <div class="dw-profile-info">
        <strong>${escapeHTML(name)}</strong>
        <small>${escapeHTML(user.email || '')}</small>
      </div>
    </div>
    <div class="dw-profile-stats">
      <span><strong>${state.accounts.length}</strong> conta(s)</span>
      <span><strong>${state.creditCards.length}</strong> cartão(ões)</span>
      <span><strong>${(state.goals || []).filter(g => g.Status === 'Ativo').length}</strong> objetivo(s)</span>
    </div>
    <button type="button" class="dw-link" onclick="document.getElementById('nav-profile-btn').click()">Ver meu perfil <i class="fas fa-arrow-right"></i></button>`;
}

export function renderDashboardWidgets() {
  const ym = app.getSelectedYYYYMM();
  renderPlanningWidget(ym);
  renderGoalsWidget();
  renderPendingWidget(ym);
  renderSavingsWidget(ym);
  renderCardsWidget(ym);
  renderProfileWidget();
  renderSettings();
  applyPrefs();
}
