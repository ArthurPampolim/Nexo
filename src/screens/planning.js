import { db } from '../firebase.js';
import { collection, addDoc, deleteDoc, doc } from 'firebase/firestore';
import { state, currencyFormatter, escapeHTML, getCurrentUserId, fetchUserScopedDocs, activeTransactions, monthPickerState, monthLabels } from '../core.js';
import { inkFor } from '../categoryCatalog.js';
import { isSettled, isTransferTransaction, parseLocalDate } from '../finance.js';
import { getCategoryStyle, categoryIconHTML } from './categories.js';
import { app } from '../app.js';

// --- CÁLCULO E RENDERIZAÇÃO DO DASHBOARD DE PLANEJAMENTO ---
export async function loadPlanning() {
  try {
    state.planning = await fetchUserScopedDocs("Planejamento");
    renderPlanningDashboard();
  } catch (error) {
    console.error("Erro ao carregar planejamento:", error);
  }
}

export function renderPlanningView() {
  renderPlanningDashboard();
}

function renderPlanningDashboard() {
  const selectedYYYYMM = app.getSelectedYYYYMM();
  // BLINDAGEM CONTRA O SHEETS AQUI (Prefixo PLAN-)
  const monthPlans = state.planning.filter(p => String(p.MesReferencia).trim() === ("PLAN-" + selectedYYYYMM));

  const introView = document.getElementById('planning-intro');
  const wizardView = document.getElementById('planning-wizard');
  const dashView = document.getElementById('planning-dashboard');

  // Se não houver dados, mostra a introdução
  if (!monthPlans || monthPlans.length === 0) {
    if (introView) introView.classList.remove('hidden');
    if (wizardView) wizardView.classList.add('hidden');
    if (dashView) dashView.classList.add('hidden');
    return;
  }

  // Esconde Intro e Wizard, Mostra Dashboard
  if (introView) introView.classList.add('hidden');
  if (wizardView) wizardView.classList.add('hidden');
  if (dashView) dashView.classList.remove('hidden');

  // Pega os dados do primeiro registro (Renda e % são iguais para todas as categorias)
  const basePlan = monthPlans[0];
  const totalIncome = parseFloat(basePlan.Renda) || 0;
  const savingsPct = parseFloat(basePlan.EconomiaPct) || 0;
  const totalPlanned = monthPlans.reduce((sum, p) => sum + (parseFloat(p.ValorLimite) || 0), 0);

  // Preenche o título do mês
  const mObj = monthLabels.find(m => m.number === monthPickerState.selectedMonth);
  const monthLabel = mObj ? `${mObj.full} ${monthPickerState.selectedYear}` : selectedYYYYMM;
  const dashMonthEl = document.getElementById('dash-month-label');
  if (dashMonthEl) dashMonthEl.innerText = monthLabel;

  // Coluna direita: Receitas, Gastos Planejados, Balanço e Economia
  const dashIncomeEl = document.getElementById('dash-income');
  if (dashIncomeEl) dashIncomeEl.innerText = currencyFormatter.format(totalIncome);

  const dashPlannedEl = document.getElementById('dash-planned');
  if (dashPlannedEl) dashPlannedEl.innerText = currencyFormatter.format(totalPlanned);

  const balance = totalIncome - totalPlanned;
  const dashBalanceEl = document.getElementById('dash-balance');
  if (dashBalanceEl) dashBalanceEl.innerText = currencyFormatter.format(balance);

  const dashSavingsPctEl = document.getElementById('dash-savings-pct');
  if (dashSavingsPctEl) dashSavingsPctEl.innerText = `${savingsPct.toFixed(2)}%`;

  // --- Cruza dados do planejamento com TODAS as transações reais do mês ---
  const monthlyTransactions = activeTransactions().filter(t => {
    if (!t.Data) return false;
    const tDate = parseLocalDate(t.Data);
    const tMonth = String(tDate.getMonth() + 1).padStart(2, '0');
    const tYear = tDate.getFullYear();
    return `${tYear}-${tMonth}` === selectedYYYYMM;
  });

  // Injeta os lançamentos de cartão de crédito no planejamento
  const ccTransactions = state.creditTransactions
    .filter(ct => String(ct.MesFatura) === selectedYYYYMM)
    .map(ct => {
      const cardObj = state.creditCards.find(c => String(c.ID) === String(ct.IdCartao || ct.CartaoID));
      const yearStr = ct.MesFatura.split('-')[0];
      const monthStr = ct.MesFatura.split('-')[1];
      const lastDayOfMonth = new Date(parseInt(yearStr), parseInt(monthStr), 0).getDate();
      let dueDay = cardObj && cardObj.DiaVencimento ? parseInt(cardObj.DiaVencimento) : 1;
      dueDay = Math.min(dueDay, lastDayOfMonth);
      const syntheticDate = `${ct.MesFatura}-${String(dueDay).padStart(2, '0')}`;

      return {
        ...ct,
        Tipo: 'DESPESA',
        Data: syntheticDate,
        isCreditCard: true,
        Status: ct.Status || 'Pendente'
      };
    });

  const allMonthlyTx = [...monthlyTransactions, ...ccTransactions];
  const today = new Date();
  today.setHours(23, 59, 59, 999);

  // Gastos reais por categoria (pagos = efetivados, previstos = futuros/faturas pendentes)
  const paidByCategory = {};
  const pendingByCategory = {};

  allMonthlyTx.forEach(t => {
    if (t.Tipo !== 'DESPESA' || isTransferTransaction(t)) return;
    const cat = t.Categoria || 'Outros';
    const val = parseFloat(t.Valor) || 0;

    let isPaid = false;
    if (t.isCreditCard) {
      isPaid = (t.Status === 'Pago');
    } else {
      isPaid = isSettled(t);
    }

    if (isPaid) {
      paidByCategory[cat] = (paidByCategory[cat] || 0) + val;
    } else {
      pendingByCategory[cat] = (pendingByCategory[cat] || 0) + val;
    }
  });

  let totalPaid = 0;
  let totalPending = 0;

  // Renderiza a tabela de categorias
  const tbody = document.getElementById('dash-categories-list');
  if (tbody) {
    tbody.innerHTML = '';
    monthPlans.forEach(cat => {
      const limitValue = parseFloat(cat.ValorLimite) || 0;
      const catName = cat.Categoria;
      const paid = paidByCategory[catName] || 0;
      const pending = pendingByCategory[catName] || 0;
      const totalSpent = paid + pending;

      totalPaid += paid;
      totalPending += pending;

      const catStyle = getCategoryStyle(catName);
      const spentClass = totalSpent > limitValue ? 'text-red' : '';

      const tr = document.createElement('tr');
      tr.className = 'tx-tr';
      tr.innerHTML = `
          <td class="tx-td">
            <div class="cat-badge-container">
              <div class="cat-icon-circle" style="background-color: ${catStyle.color}; color: ${catStyle.ink};">
                ${categoryIconHTML(catStyle)}
              </div>
              <span>${escapeHTML(catName)}</span>
            </div>
          </td>
          <td class="tx-td" style="font-weight: 600;">${currencyFormatter.format(limitValue)}</td>
          <td class="tx-td text-green">${currencyFormatter.format(paid)}</td>
          <td class="tx-td text-muted">${currencyFormatter.format(pending)}</td>
          <td class="tx-td ${spentClass}" style="font-weight: 600;">${currencyFormatter.format(totalSpent)}</td>
          <td class="tx-td" style="text-align: center;">
            <button class="btn-text" style="color: #888;" title="Editar"><i class="fas fa-pen"></i></button>
          </td>
        `;
      tbody.appendChild(tr);
    });
  }

  // Resumo superior da tabela
  const totalSpentAll = totalPaid + totalPending;
  const remainingBudget = totalPlanned - totalSpentAll;

  const dashRemainingEl = document.getElementById('dash-remaining-budget');
  if (dashRemainingEl) dashRemainingEl.innerText = currencyFormatter.format(Math.max(remainingBudget, 0));

  const dashSpentInfoEl = document.getElementById('dash-spent-info');
  if (dashSpentInfoEl) dashSpentInfoEl.innerText = `${currencyFormatter.format(totalSpentAll)} de ${currencyFormatter.format(totalPlanned)} gastos`;

  // Barra de progresso
  const barPct = totalPlanned > 0 ? Math.min((totalSpentAll / totalPlanned) * 100, 100) : 0;
  const dashBarEl = document.getElementById('dash-main-bar');
  if (dashBarEl) {
    dashBarEl.style.width = `${barPct}%`;
    dashBarEl.style.background = barPct > 90 ? '#F44336' : 'var(--primary-color)';
  }

  // --- Cálculo e atualização das percentagens de Pagos e Previstos ---
  const pctPaid = totalPlanned > 0 ? (totalPaid / totalPlanned) * 100 : 0;
  const pctPending = totalPlanned > 0 ? (totalPending / totalPlanned) * 100 : 0;

  const dashPctPaidEl = document.getElementById('dash-pct-paid');
  if (dashPctPaidEl) dashPctPaidEl.innerText = `${pctPaid.toFixed(1)}%`;

  const dashPctPendingEl = document.getElementById('dash-pct-pending');
  if (dashPctPendingEl) dashPctPendingEl.innerText = `${pctPending.toFixed(1)}%`;
}

// --- LÓGICA DO WIZARD DE PLANEJAMENTO ---
const wizardState = {
  income: 0,
  savingsPct: 20,
  budget: 0,
  savingsAmount: 0
};

export function startPlanningWizard() {
  document.getElementById('planning-intro').classList.add('hidden');
  document.getElementById('planning-dashboard').classList.add('hidden');
  document.getElementById('planning-wizard').classList.remove('hidden');
  document.getElementById('wizard-step-1').classList.remove('hidden');
  document.getElementById('wizard-step-2').classList.add('hidden');
  document.getElementById('wizard-step-3').classList.add('hidden');
  document.getElementById('wizard-breadcrumbs').innerHTML = '<strong>Renda mensal</strong>';
  calculateWizardBudget();
}

export function cancelPlanningWizard() {
  document.getElementById('planning-wizard').classList.add('hidden');
  document.getElementById('planning-intro').classList.remove('hidden');
}

export async function copyPreviousPlanning() {
  try {
    const allPlans = await fetchUserScopedDocs("Planejamento");
    if (allPlans.length === 0) return alert("Nenhum planejamento anterior encontrado.");

    const sorted = [...allPlans].sort((a, b) => String(b.MesReferencia).localeCompare(String(a.MesReferencia)));
    const latestMonth = sorted[0].MesReferencia;
    const prev = sorted.filter(r => r.MesReferencia === latestMonth);

    wizardState.income = parseFloat(prev[0].Renda) || 0;
    wizardState.savingsPct = parseFloat(prev[0].EconomiaPct) || 20;
    wizardState.cardPreference = prev[0].PrefCartao || 'FATURA';
    wizardState.categories = {};

    prev.forEach(r => {
      if (r.Categoria && parseFloat(r.ValorLimite) > 0) {
        wizardState.categories[r.Categoria] = parseFloat(r.ValorLimite);
      }
    });

    const incomeInput = document.getElementById('wiz-income');
    if (incomeInput) incomeInput.value = currencyFormatter.format(wizardState.income);
    const pctInput = document.getElementById('wiz-savings-pct');
    if (pctInput) pctInput.value = wizardState.savingsPct;

    startPlanningWizard();
    alert(`Planejamento copiado com sucesso!`);
  } catch (error) {
    console.error("Erro ao copiar planejamento:", error);
  }
}

export function calculateWizardBudget() {
  const incomeInput = document.getElementById('wiz-income').value;
  const rawIncome = parseFloat(incomeInput.replace("R$ ", "").replace(/\./g, "").replace(",", ".")) || 0;

  const pctInput = parseFloat(document.getElementById('wiz-savings-pct').value) || 0;
  const safePct = Math.min(Math.max(pctInput, 0), 100); // Trava entre 0 e 100%

  wizardState.income = rawIncome;
  wizardState.savingsPct = safePct;
  wizardState.savingsAmount = (rawIncome * safePct) / 100;
  wizardState.budget = rawIncome - wizardState.savingsAmount;

  document.getElementById('wiz-calc-budget').innerText = currencyFormatter.format(wizardState.budget);
  document.getElementById('wiz-calc-savings').innerText = currencyFormatter.format(wizardState.savingsAmount);
}

// Define a variável "categories" no objeto wizardState existente
wizardState.categories = {};

// Categorias de despesa do usuário (principais e subcategorias) para definir limites
const wizardCategories = () => [...state.categories]
  .filter(c => c.Tipo === 'DESPESA')
  .sort((x, y) => x.Ordem - y.Ordem)
  .map(c => ({ name: c.Nome, icon: c.Icone, color: c.Cor, ink: inkFor(c.Cor) }));

export function renderWizardCategories() {
  const container = document.getElementById('wizard-categories-list');
  if (!container) return;
  container.innerHTML = '';

  wizardCategories().forEach(cat => {
    const val = wizardState.categories[cat.name] || 0;

    const card = document.createElement('div');
    card.className = 'wiz-cat-card';
    card.innerHTML = `
        <div style="display: flex; align-items: center; gap: 15px;">
          <div class="wiz-cat-icon" style="background-color: ${cat.color}; color: ${cat.ink};">
            ${categoryIconHTML(cat, 20)}
          </div>
          <strong style="font-size: 16px; color: #333;">${escapeHTML(cat.name)}</strong>
        </div>
        <div class="wiz-cat-input-group">
          <label>Total</label>
          <input type="text" class="wiz-cat-input" data-category="${escapeHTML(cat.name)}" value="R$ ${val.toFixed(2).replace('.', ',')}" oninput="AppController.maskCurrency(this); AppController.calculateWizardCategoryTotals()">
        </div>
      `;
    container.appendChild(card);
  });
  calculateWizardCategoryTotals(); // Faz o cálculo inicial assim que carrega
}

export function calculateWizardCategoryTotals() {
  const inputs = document.querySelectorAll('.wiz-cat-input');
  let sum = 0;

  inputs.forEach(input => {
    const catName = input.getAttribute('data-category');
    const rawVal = parseFloat(input.value.replace("R$ ", "").replace(/\./g, "").replace(",", ".")) || 0;
    wizardState.categories[catName] = rawVal;
    sum += rawVal;
  });

  const remaining = wizardState.budget - sum;

  // Atualiza os Textos
  document.getElementById('wiz-sum-categorized').innerText = currencyFormatter.format(sum);
  const remainingEl = document.getElementById('wiz-sum-remaining');

  if (remaining < 0) {
    remainingEl.innerText = `${currencyFormatter.format(Math.abs(remaining))} excedido do orçamento`;
    remainingEl.style.color = '#F44336';
  } else {
    remainingEl.innerText = `${currencyFormatter.format(remaining)} sem categorização`;
    remainingEl.style.color = '#888';
  }

  // Atualiza o Gráfico Circular (Anel de Progresso)
  const pct = wizardState.budget > 0 ? (sum / wizardState.budget) * 100 : 0;
  const safePct = Math.min(pct, 100);
  const ring = document.querySelector('.progress-ring');

  if (ring) {
    let ringColor = 'var(--primary-color)';
    if (pct > 100) ringColor = '#F44336'; // Fica vermelho se ultrapassar 100%
    ring.style.background = `conic-gradient(${ringColor} ${safePct}%, #f1f5f9 ${safePct}%)`;
  }
}

// Navegação Reversa (Voltar)
export function prevWizardStep(stepNumber) {
  if (stepNumber === 1) {
    document.getElementById('wizard-step-2').classList.add('hidden');
    document.getElementById('wizard-step-1').classList.remove('hidden');
    document.getElementById('wizard-breadcrumbs').innerHTML = '<strong>Renda mensal</strong>';
  } else if (stepNumber === 2) {
    document.getElementById('wizard-step-3').classList.add('hidden');
    document.getElementById('wizard-step-2').classList.remove('hidden');
    document.getElementById('wizard-breadcrumbs').innerHTML = '<span style="color:#aaa;">Renda mensal</span> <span style="margin: 0 5px;">/</span> <strong>Categorização de gastos</strong>';
  }
}

// Navegação de Avanço (Substitua a sua função atual por esta)
export function nextWizardStep(stepNumber) {
  if (stepNumber === 2) {
    if (wizardState.income <= 0) return alert("Por favor, informe uma renda.");
    document.getElementById('wizard-step-1').classList.add('hidden');
    document.getElementById('wizard-step-2').classList.remove('hidden');
    document.getElementById('wizard-breadcrumbs').innerHTML = '<span style="color:#aaa;">Renda mensal</span> <span style="margin: 0 5px;">/</span> <strong>Categorização de gastos</strong>';
    renderWizardCategories();
  }
  else if (stepNumber === 3) {
    document.getElementById('wizard-step-2').classList.add('hidden');
    document.getElementById('wizard-step-3').classList.remove('hidden');
    document.getElementById('wizard-breadcrumbs').innerHTML = '<span style="color:#aaa;">Renda mensal / Categorização de gastos</span> <span style="margin: 0 5px;">/</span> <strong>Visualização das despesas do cartão</strong>';
    if (!wizardState.cardPreference) selectCardPreference('FATURA'); // Padrão
  }
}

// Define a preferência visual do cartão
export function selectCardPreference(pref) {
  wizardState.cardPreference = pref;
  document.getElementById('rc-COMPRA').classList.remove('active');
  document.getElementById('rc-FATURA').classList.remove('active');
  document.querySelector('#rc-COMPRA input').checked = false;
  document.querySelector('#rc-FATURA input').checked = false;

  document.getElementById(`rc-${pref}`).classList.add('active');
  document.querySelector(`#rc-${pref} input`).checked = true;
}
// FINALIZAÇÃO DO WIZARD E RENDERIZAÇÃO DO DASHBOARD
export async function finishPlanningWizard() {
  const btn = document.querySelector('#wizard-step-3 .plan-main-btn');
  const originalBtnText = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = 'Salvando... <i class="fas fa-spinner fa-spin" style="margin-left: 8px;"></i>';

  const monthStr = app.getSelectedYYYYMM();
  const searchKey = "PLAN-" + monthStr;

  try {
    // 1. Limpa os planejamentos antigos do mesmo mês pertencentes ao usuário
    const existingPlans = await fetchUserScopedDocs("Planejamento");
    const deletePromises = [];
    existingPlans.forEach(plan => {
      if (String(plan.MesReferencia).trim() === searchKey) {
        deletePromises.push(deleteDoc(doc(db, "Planejamento", plan.ID)));
      }
    });
    await Promise.all(deletePromises);

    // 2. Salva as novas metas por categoria com isolamento de usuário
    const insertPromises = [];
    const uid = getCurrentUserId();
    for (const [catName, val] of Object.entries(wizardState.categories)) {
      if (parseFloat(val) > 0) {
        insertPromises.push(addDoc(collection(db, "Planejamento"), {
          userId: uid,
          MesReferencia: searchKey,
          Renda: parseFloat(wizardState.income),
          EconomiaPct: parseFloat(wizardState.savingsPct),
          PrefCartao: wizardState.cardPreference,
          Categoria: catName,
          ValorLimite: parseFloat(val)
        }));
      }
    }
    await Promise.all(insertPromises);

    document.getElementById('planning-wizard').classList.add('hidden');
    document.getElementById('planning-dashboard').classList.remove('hidden');
    loadPlanning();
  } catch (error) {
    AppController.showToast("Erro ao salvar planejamento: " + error.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalBtnText;
  }
}
