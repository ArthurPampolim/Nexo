import { state, currencyFormatter, escapeHTML, activeTransactions } from '../core.js';
import { monthSummary } from '../finance.js';
import { app } from '../app.js';

// ── Cards "Planejamento mensal" e "Meus objetivos" do dashboard ──
const empty = (icon, text, tab, label) => `
  <div class="dw-empty">
    <i class="fas ${icon}"></i>
    <p>${text}</p>
    <button type="button" class="dw-link" onclick="AppController.switchTab('${tab}')">${label} <i class="fas fa-arrow-right"></i></button>
  </div>`;

function renderPlanningWidget(ym) {
  const host = document.getElementById('dash-planning-body');
  if (!host) return;
  const plans = (state.planning || []).filter(p => String(p.MesReferencia).trim() === `PLAN-${ym}`);
  if (!plans.length) {
    host.innerHTML = empty('fa-route', 'Nenhum planejamento definido para este mês.', 'planning', 'Planejar agora');
    return;
  }

  const planned = plans.reduce((sum, p) => sum + (parseFloat(p.ValorLimite) || 0), 0);
  const income = parseFloat(plans[0].Renda) || 0;
  const monthTxs = activeTransactions().filter(t => t.Data && t.Data.slice(0, 7) === ym);
  const cardTotal = state.creditTransactions
    .filter(ct => String(ct.MesFatura).slice(0, 7) === ym)
    .reduce((sum, ct) => sum + (parseFloat(ct.Valor) || 0), 0);
  const spent = monthSummary(monthTxs).expense + cardTotal;

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
  ${active.length > top.length ? `<button type="button" class="dw-link" onclick="AppController.switchTab('goals')">Ver todos (${active.length}) <i class="fas fa-arrow-right"></i></button>` : ''}`;
}

export function renderDashboardWidgets() {
  renderPlanningWidget(app.getSelectedYYYYMM());
  renderGoalsWidget();
}
