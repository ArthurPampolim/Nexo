import { db } from '../firebase.js';
import { collection, addDoc, updateDoc, deleteDoc, doc } from 'firebase/firestore';
import { state, currencyFormatter, escapeHTML, formatDateBR, getCurrentUserId, fetchUserScopedDocs, elements } from '../core.js';
import { app } from '../app.js';

// --- OBJETIVOS E METAS COM APORTE ---
state.currentGoalId = null;
state.currentGoalDeposits = [];
state.goalsSortOrder = 'DATA'; // Começa organizando pela data de conclusão
let goalDonutChartInstance = null;

export async function loadGoals() {
  try {
    const metasBrutas = await fetchUserScopedDocs("Objetivos");

    state.goals = metasBrutas.map(goal => {
      const target = parseFloat(goal.ValorAlvo) || 0;
      const current = parseFloat(goal.ValorAtual) || 0;
      let percentage = target > 0 ? (current / target) * 100 : 0;
      return { ...goal, Progresso: parseFloat(Math.min(percentage, 100).toFixed(2)) };
    });

    renderGoalsPage();
  } catch (error) {
    console.error("Erro ao carregar objetivos:", error);
  }
}

export function renderGoalsPage() {
  const pageContainer = document.getElementById('goals-page-container');
  if (!pageContainer) return;
  pageContainer.innerHTML = '';

  const activeTab = state.goalsTab || 'ANDAMENTO';
  const targetStatus = activeTab === 'ANDAMENTO' ? 'Ativo' : 'Concluido';

  // Filtra os objetivos
  const filteredGoals = (state.goals || []).filter(g => g.Status === targetStatus);

  // Ordena a lista de acordo com a escolha do utilizador
  filteredGoals.sort((a, b) => {
    if (state.goalsSortOrder === 'DATA') {
      const dateA = a.DataLimite ? new Date(a.DataLimite).getTime() : Infinity;
      const dateB = b.DataLimite ? new Date(b.DataLimite).getTime() : Infinity;
      return dateA - dateB;
    } else if (state.goalsSortOrder === 'MAIS_AVANCADOS') {
      return (b.Progresso || 0) - (a.Progresso || 0);
    } else if (state.goalsSortOrder === 'MENOS_AVANCADOS') {
      return (a.Progresso || 0) - (b.Progresso || 0);
    }
    return 0;
  });

  if (filteredGoals.length === 0) {
    pageContainer.style.justifyContent = 'center';

    if (activeTab === 'ANDAMENTO') {
      pageContainer.innerHTML = `
        <div style="text-align: center; padding: 60px 20px; width: 100%;">
          <i class="fas fa-clipboard-list" style="font-size: 80px; color: var(--primary-color); margin-bottom: 20px; opacity: 0.8;"></i>
          <h3 style="font-size: 18px; color: #111; margin-bottom: 10px;">Definindo objetivos você alcança seus sonhos mais rápido!</h3>
          <p style="font-size: 14px; color: #888; margin-bottom: 25px;">Que tal criar um pra te ajudar?</p>
          <button class="btn-primary" style="width: auto; padding: 12px 30px; border-radius: 24px; background: var(--primary-color); font-size: 14px;" onclick="AppController.openGoalTypeModal()">CRIAR NOVO OBJETIVO</button>
        </div>
      `;
    } else {
      pageContainer.innerHTML = `
        <div style="text-align: center; padding: 60px 20px; width: 100%;">
          <i class="fas fa-clipboard-check" style="font-size: 80px; color: var(--primary-color); margin-bottom: 20px; opacity: 0.8;"></i>
          <h3 style="font-size: 18px; color: #111; margin-bottom: 10px;">Você ainda não concluiu um objetivo</h3>
          <p style="font-size: 14px; color: #888; margin-bottom: 25px;">Que tal continuar guardando dinheiro?</p>
        </div>
      `;
    }
  } else {
    pageContainer.style.justifyContent = 'flex-start';
    filteredGoals.forEach(goal => {
      const cor = goal.Cor || '#00BCD4';
      const icone = goal.Icone || 'fa-bullseye';
      const pct = goal.Progresso || 0;
      const valorRestante = Math.max(0, (parseFloat(goal.ValorAlvo) || 0) - (parseFloat(goal.ValorAtual) || 0));

      let pillHtml = '';
      let targetMonthlyHtml = '';

      if (pct >= 100 || valorRestante === 0) {
        pillHtml = `<span class="goal-pill goal-pill-success"><i class="fas fa-check-circle"></i> Concluído!</span>`;
        targetMonthlyHtml = `<span class="goal-target-text" style="color: #059669;"><i class="fas fa-trophy"></i> Meta atingida com sucesso</span>`;
      } else if (!goal.DataLimite) {
        pillHtml = `<span class="goal-pill goal-pill-neutral"><i class="fas fa-infinity"></i> Sem prazo</span>`;
        targetMonthlyHtml = `<span class="goal-target-text"><i class="fas fa-clock"></i> Saldo restante: <strong>${currencyFormatter.format(valorRestante)}</strong></span>`;
      } else {
        const today = new Date();
        const targetDate = new Date(goal.DataLimite);
        const monthsRemaining = (targetDate.getFullYear() - today.getFullYear()) * 12 + (targetDate.getMonth() - today.getMonth());

        if (monthsRemaining < 0 || (monthsRemaining === 0 && targetDate < today)) {
          pillHtml = `<span class="goal-pill goal-pill-warning"><i class="fas fa-exclamation-triangle"></i> Prazo encerrado</span>`;
          targetMonthlyHtml = `<span class="goal-target-text" style="color: #d97706;"><i class="fas fa-hourglass-end"></i> Restam <strong>${currencyFormatter.format(valorRestante)}</strong> pendentes</span>`;
        } else {
          const divisor = Math.max(1, monthsRemaining);
          const monthlyTarget = valorRestante / divisor;
          const pacing = pct >= 50 ? 'No ritmo' : 'Atenção';
          const pacingClass = pct >= 50 ? 'goal-pill-success' : 'goal-pill-info';

          pillHtml = `<span class="goal-pill ${pacingClass}"><i class="fas fa-bolt"></i> ${pacing}</span>`;
          targetMonthlyHtml = `<span class="goal-target-text"><i class="fas fa-piggy-bank"></i> Aporte sugerido: <strong>${currencyFormatter.format(monthlyTarget)}/mês</strong> (${divisor}m)</span>`;
        }
      }

      const safeGoalId = escapeHTML(goal.ID);
      const safeGoalNome = escapeHTML(goal.Nome);
      const safeCor = escapeHTML(cor);
      const safeIcone = escapeHTML(icone);

      const card = document.createElement('div');
      card.className = 'new-goal-card';
      card.innerHTML = `
        <div class="ng-header">
          <div style="display: flex; align-items: center; width: calc(100% - 25px); min-width: 0;">
            <div class="ng-icon" style="background: ${safeCor};"><i class="fas ${safeIcone}"></i></div>
            <div class="ng-title">${safeGoalNome}</div>
          </div>
          <i class="fas fa-chevron-right" style="color: #ccc; cursor: pointer; padding: 5px;" onclick="AppController.openGoalDetails('${safeGoalId}')" title="Ver detalhes do objetivo"></i>
        </div>
        <div>
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
            ${pillHtml}
            <span style="color: var(--text-muted); font-size: 12px; font-weight: 600; font-family: var(--font-mono);">${pct.toFixed(1)}%</span>
          </div>
          <div class="ng-progress-track">
            <div class="ng-progress-fill" style="width: ${pct}%; background: ${cor};"></div>
          </div>
          <div style="display: flex; justify-content: space-between; align-items: baseline; margin-top: 6px;">
            <span style="color: var(--text-main); font-weight: 700; font-size: 14px; font-family: var(--font-mono);">
              ${currencyFormatter.format(goal.ValorAtual)} 
              <span style="color: var(--text-muted); font-weight: 400; font-size: 12px; font-family: var(--font-sans);">guardados</span>
            </span>
            <span style="color: var(--text-muted); font-size: 12px; font-family: var(--font-mono);">Alvo: ${currencyFormatter.format(goal.ValorAlvo)}</span>
          </div>
        </div>
        <div class="ng-footer">
          <div class="ng-monthly-box">
            ${targetMonthlyHtml}
          </div>
          <div class="ng-date-row">
            <span><i class="far fa-calendar-check" style="margin-right: 5px;"></i> Data limite</span>
            <strong>${goal.DataLimite ? formatDateBR(goal.DataLimite) : 'Sem prazo definido'}</strong>
          </div>
        </div>
      `;
      pageContainer.appendChild(card);
    });
  }
}

export function openGoalTypeModal() {
  document.getElementById('goal-type-modal').classList.remove('hidden');
}

export function openGoalForm(nome, icone, cor) {
  document.getElementById('goal-type-modal').classList.add('hidden');
  state.editingId = null;
  elements.goalForm.reset();

  document.getElementById('goal-name-input').value = nome;
  document.getElementById('goal-icon-val').value = icone;
  document.getElementById('goal-color-val').value = cor;
  document.getElementById('submit-goal-btn').innerText = 'CRIAR OBJETIVO';

  elements.goalModal.classList.remove('hidden');
}

export function closeGoalModal() {
  elements.goalModal.classList.add('hidden');
  elements.goalForm.reset();
  state.editingId = null;
}

export async function submitGoal(event) {
  event.preventDefault();
  const btn = document.getElementById('submit-goal-btn');
  btn.disabled = true;
  btn.innerHTML = 'Salvando...';

  const formDados = Object.fromEntries(new FormData(elements.goalForm).entries());

  const valorAlvoNum = parseFloat(formDados.valorAlvo.replace(/\D/g, "")) / 100 || 0;
  const valorAtualNum = formDados.valorAtual ? (parseFloat(formDados.valorAtual.replace(/\D/g, "")) / 100 || 0) : 0;

  const payloadFormatado = {
    userId: getCurrentUserId(),
    Nome: formDados.nome,
    ValorAlvo: valorAlvoNum,
    ValorAtual: valorAtualNum,
    DataLimite: formDados.dataLimite || '',
    Icone: formDados.icone,
    Cor: formDados.cor,
    Status: 'Ativo'
  };

  try {
    if (state.editingId) {
      await updateDoc(doc(db, "Objetivos", state.editingId), payloadFormatado);
    } else {
      await addDoc(collection(db, "Objetivos"), payloadFormatado);
    }
    closeGoalModal();
    loadGoals();
  } catch (error) {
    AppController.showToast("Erro ao salvar objetivo: " + error.message, 'error');
  } finally {
    btn.disabled = false;
  }
}

export function editGoal(id) {
  const g = state.goals.find(x => String(x.ID) === String(id)); if (!g) return;
  state.editingId = id;

  document.querySelector(`#goal-form input[name="nome"]`).value = g.Nome;
  document.querySelector(`#goal-form input[name="valorAlvo"]`).value = currencyFormatter.format(g.ValorAlvo);
  document.querySelector(`#goal-form input[name="valorAtual"]`).value = currencyFormatter.format(g.ValorAtual || 0);
  document.getElementById('goal-icon-val').value = g.Icone || 'fa-bullseye';
  document.getElementById('goal-color-val').value = g.Cor || '#36454f';

  const dateStr = g.DataLimite ? String(g.DataLimite).split('T')[0] : '';
  const dateInput = document.querySelector(`#goal-form input[name="dataLimite"]`);
  if (dateInput) dateInput.value = dateStr;

  document.getElementById('submit-goal-btn').innerText = 'ATUALIZAR OBJETIVO';
  elements.goalModal.classList.remove('hidden');
}

export async function deleteGoal(id) {
  if (!confirm("Tem certeza que deseja excluir este objetivo?")) return;
  try {
    await deleteDoc(doc(db, "Objetivos", id));
    loadGoals();
  } catch (error) {
    AppController.showToast("Erro ao excluir: " + error.message, 'error');
  }
}

export function openGoalDepositModal(goalId, type = 'deposit') {
  const g = state.goals.find(x => String(x.ID) === String(goalId));
  if (!g) return;

  document.getElementById('gd-goal-id').value = g.ID;
  document.getElementById('gd-goal-name').value = g.Nome;
  document.getElementById('gd-deposit-id').value = '';
  document.getElementById('gd-transaction-type').value = type;
  document.querySelector('#goal-deposit-form input[name="valor"]').value = '';

  const title = document.getElementById('gd-modal-title');
  const btn = document.getElementById('submit-gd-btn');

  if (type === 'withdraw') {
    title.innerText = 'Resgatar Valor';
    btn.innerText = 'Confirmar Resgate';
  } else {
    title.innerText = 'Adicionar Depósito';
    btn.innerText = 'Confirmar Aporte';
  }

  document.getElementById('goal-deposit-modal').classList.remove('hidden');
}
export function closeGoalDepositModal() {
  document.getElementById('goal-deposit-modal').classList.add('hidden');
  document.getElementById('goal-deposit-form').reset();
}

export async function submitGoalDeposit(event) {
  event.preventDefault();
  const btn = document.getElementById('submit-gd-btn');
  const originalText = btn.innerText;
  btn.disabled = true;
  btn.innerHTML = 'Processando...';

  const formDados = Object.fromEntries(new FormData(document.getElementById('goal-deposit-form')).entries());
  let depositAmount = parseFloat(formDados.valor.replace(/\D/g, "")) / 100 || 0;

  const type = formDados.type;
  if (type === 'withdraw') depositAmount = -Math.abs(depositAmount);
  else depositAmount = Math.abs(depositAmount);

  const goalId = formDados.id;
  const depositId = formDados.depositId;

  try {
    const goal = state.goals.find(g => String(g.ID) === String(goalId));
    if (!goal) throw new Error("Objetivo não encontrado.");

    const localISO = new Date(new Date().getTime() - (new Date().getTimezoneOffset() * 60000)).toISOString().split('T')[0];

    if (depositId) {
      const oldDeposit = state.currentGoalDeposits.find(d => String(d.ID) === String(depositId));
      const difference = depositAmount - (parseFloat(oldDeposit.Valor) || 0);

      await updateDoc(doc(db, "AportesObjetivo", depositId), { Valor: depositAmount });
      await updateDoc(doc(db, "Objetivos", goalId), { ValorAtual: (parseFloat(goal.ValorAtual) || 0) + difference });
    } else {
      if (type === 'withdraw' && Math.abs(depositAmount) > (parseFloat(goal.ValorAtual) || 0)) {
        throw new Error("Saldo insuficiente no objetivo para este resgate.");
      }

      await addDoc(collection(db, "AportesObjetivo"), {
        userId: getCurrentUserId(),
        IdObjetivo: goalId,
        Valor: depositAmount,
        Data: localISO
      });
      await updateDoc(doc(db, "Objetivos", goalId), { ValorAtual: (parseFloat(goal.ValorAtual) || 0) + depositAmount });
    }

    closeGoalDepositModal();
    await loadGoals();

    if (!document.getElementById('view-goal-details').classList.contains('hidden')) {
      openGoalDetails(goalId);
    }

    // Usa o novo sistema de Toasts!
    AppController.showToast(type === 'withdraw' ? "Resgate realizado com sucesso!" : "Aporte realizado com sucesso!", 'success');

  } catch (error) {
    AppController.showToast(error.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerText = originalText;
  }
}

// ==========================================
// LÓGICA DA TELA DE DETALHES DO OBJETIVO
// ==========================================

function calculateMonthlySavings(targetValue, currentValue, targetDateStr) {
  const remaining = targetValue - currentValue;
  if (remaining <= 0) return 0;
  if (!targetDateStr) return -1; // Sem data definida

  const today = new Date();
  const target = new Date(targetDateStr + 'T12:00:00');

  let months = (target.getFullYear() - today.getFullYear()) * 12;
  months -= today.getMonth();
  months += target.getMonth();
  if (target.getDate() < today.getDate()) months--; // Mês incompleto

  if (months <= 0) months = 1; // Evita divisão por zero
  return remaining / months;
}

function renderGoalChart(pct, color) {
  const canvas = document.getElementById('goalDonutChart');
  if (!canvas) return;
  if (goalDonutChartInstance) goalDonutChartInstance.destroy();

  goalDonutChartInstance = new Chart(canvas.getContext('2d'), {
    type: 'doughnut',
    data: {
      datasets: [{
        data: [pct, Math.max(0, 100 - pct)],
        backgroundColor: [color, '#f0f0f0'],
        borderWidth: 0,
        cutout: '80%',
        borderRadius: [20, 0] // Arredonda as pontas do gráfico
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { tooltip: { enabled: false } },
      animation: { animateScale: true }
    }
  });
}

export async function openGoalDetails(id) {
  const g = state.goals.find(x => String(x.ID) === String(id));
  if (!g) return;
  state.currentGoalId = id;

  // Troca as telas
  document.getElementById('view-goals').classList.add('hidden');
  document.getElementById('view-goal-details').classList.remove('hidden');

  // Preenche os textos
  document.getElementById('gd-page-title').innerText = g.Nome;
  document.getElementById('gd-target-val').innerText = currencyFormatter.format(g.ValorAlvo);
  document.getElementById('gd-name-val').innerText = g.Nome;
  document.getElementById('gd-date-val').innerText = formatDateBR(g.DataLimite) || '--/--/----';

  const pct = g.Progresso || 0;
  document.getElementById('gd-pct-val').innerText = `${pct.toFixed(0)}%`;

  // Cálculo de quanto poupar por mês
  const monthly = calculateMonthlySavings(g.ValorAlvo, g.ValorAtual || 0, g.DataLimite);
  const box = document.getElementById('gd-monthly-box');
  if (monthly === 0) {
    box.innerHTML = `<i class="fas fa-check-circle" style="color: #4CAF50; font-size: 20px; margin-top: 2px;"></i><div style="font-size: 13px; color: #555;">Parabéns! Você já alcançou a meta deste objetivo.</div>`;
  } else if (monthly < 0) {
    box.innerHTML = `<i class="fas fa-info-circle" style="color: #2196F3; font-size: 20px; margin-top: 2px;"></i><div style="font-size: 13px; color: #555;">Edite o objetivo e defina uma <strong>Data Limite</strong> para calcular sua meta mensal.</div>`;
  } else {
    box.innerHTML = `<i class="fas fa-chess-board" style="color: ${g.Cor || '#36454f'}; font-size: 20px; margin-top: 2px;"></i><div style="font-size: 13px; color: #555;">Para atingir seu objetivo a tempo, você precisa poupar a cada mês <strong style="color: #111;">${currencyFormatter.format(monthly)}</strong></div>`;
  }

  renderGoalChart(pct, g.Cor || '#00BCD4');

  // Carrega a lista de Depósitos
  await loadGoalDeposits(id);
}

export function closeGoalDetails() {
  document.getElementById('view-goal-details').classList.add('hidden');
  document.getElementById('view-goals').classList.remove('hidden');
  state.currentGoalId = null;
}

export function editGoalFromDetails() {
  if (state.currentGoalId) editGoal(state.currentGoalId);
}

async function loadGoalDeposits(id) {
  const listEl = document.getElementById('gd-deposits-list');
  listEl.innerHTML = '<div style="color:#888; font-size:14px; margin-top:10px;">Carregando depósitos...</div>';

  try {
    const todosAportes = await fetchUserScopedDocs("AportesObjetivo");

    state.currentGoalDeposits = todosAportes.filter(a => String(a.IdObjetivo) === String(id));
    state.currentGoalDeposits.sort((a, b) => new Date(b.Data).getTime() - new Date(a.Data).getTime());

    renderGoalDeposits();
  } catch (e) {
    console.error(e);
    listEl.innerHTML = '<div style="color:#F44336; font-size:14px;">Erro ao carregar aportes.</div>';
  }
}

function renderGoalDeposits() {
  const listEl = document.getElementById('gd-deposits-list');
  listEl.innerHTML = '';

  if (state.currentGoalDeposits.length === 0) {
    listEl.innerHTML = '<div style="color:#888; font-size:14px; margin-top:10px;">Nenhuma movimentação realizada ainda.</div>';
    return;
  }

  state.currentGoalDeposits.forEach(dep => {
    const isWithdraw = dep.Valor < 0;
    const displayValue = Math.abs(dep.Valor);
    const color = isWithdraw ? '#F44336' : '#4CAF50';
    const sign = isWithdraw ? '-' : '+';
    const label = isWithdraw ? 'Resgate' : 'Depósito';
    const safeDepId = escapeHTML(dep.ID);
    const safeGoalId = escapeHTML(dep.IdObjetivo);

    const li = document.createElement('li');
    li.className = 'gd-deposit-item';
    li.innerHTML = `
      <div>
        <div style="font-size: 13px; color: #888;">${formatDateBR(dep.Data)}</div>
        <div style="font-size: 12px; color: ${color}; font-weight: 500;">${label}</div>
      </div>
      <div style="display: flex; align-items: center; gap: 15px;">
        <strong style="color: ${color}; font-size: 14px;">${sign} ${currencyFormatter.format(displayValue)}</strong>
        <button class="btn-text" style="color: #bbb; font-size: 13px; padding: 0;" onclick="AppController.deleteGoalDeposit('${safeDepId}', '${safeGoalId}', ${dep.Valor})" title="Excluir"><i class="fas fa-trash"></i></button>
        <button class="btn-text" style="color: #bbb; font-size: 13px; padding: 0;" onclick="AppController.editGoalDeposit('${safeDepId}', '${safeGoalId}', ${dep.Valor})" title="Editar"><i class="fas fa-pen"></i></button>
      </div>
    `;
    listEl.appendChild(li);
  });
}

export async function deleteGoalDeposit(idAporte, idObjetivo, valorAporte) {
  if (!confirm("Excluir este depósito? O valor será subtraído do progresso do objetivo.")) return;
  try {
    await deleteDoc(doc(db, "AportesObjetivo", idAporte));

    // Subtrai o valor apagado do saldo principal do objetivo
    const goal = state.goals.find(g => String(g.ID) === String(idObjetivo));
    if (goal) {
      const newVal = Math.max(0, (parseFloat(goal.ValorAtual) || 0) - valorAporte);
      await updateDoc(doc(db, "Objetivos", idObjetivo), { ValorAtual: newVal });
    }

    await loadGoals();
    openGoalDetails(idObjetivo); // Atualiza a tela inteira
  } catch (e) {
    AppController.showToast("Erro ao excluir: " + e.message, 'error');
  }
}

export function editGoalDeposit(idAporte, idObjetivo, valorAporte) {
  const g = state.goals.find(x => String(x.ID) === String(idObjetivo));
  if (!g) return;

  const isWithdraw = valorAporte < 0;

  document.getElementById('gd-goal-id').value = g.ID;
  document.getElementById('gd-goal-name').value = g.Nome;
  document.getElementById('gd-deposit-id').value = idAporte;
  document.getElementById('gd-transaction-type').value = isWithdraw ? 'withdraw' : 'deposit';

  document.querySelector('#goal-deposit-form input[name="valor"]').value = currencyFormatter.format(Math.abs(valorAporte));

  const title = document.getElementById('gd-modal-title');
  const btn = document.getElementById('submit-gd-btn');

  if (isWithdraw) {
    title.innerText = 'Editar Resgate';
    btn.innerText = 'Atualizar Resgate';
  } else {
    title.innerText = 'Editar Depósito';
    btn.innerText = 'Atualizar Aporte';
  }

  document.getElementById('goal-deposit-modal').classList.remove('hidden');
}

// Lógica do Menu de Opções Suspenso
export function toggleGoalOptions(event) {
  if (event) event.stopPropagation();
  const dropdown = document.getElementById('goal-options-dropdown');
  if (dropdown) {
    dropdown.style.display = (dropdown.style.display === 'none' || dropdown.style.display === '') ? 'block' : 'none';
  }
}

// Fechar o menu de opções ao clicar fora dele
document.addEventListener('click', (e) => {
  const dropdown = document.getElementById('goal-options-dropdown');
  if (dropdown && dropdown.style.display === 'block') {
    dropdown.style.display = 'none';
  }
});

// Abrir modal de depósito para o objetivo que está aberto na tela
export function openCurrentGoalDepositModal() {
  if (state.currentGoalId) openGoalDepositModal(state.currentGoalId, 'deposit');
}

export function openCurrentGoalWithdrawModal() {
  if (state.currentGoalId) openGoalDepositModal(state.currentGoalId, 'withdraw');
}

// Apagar o objetivo que está aberto na tela
export async function deleteCurrentGoal() {
  if (!state.currentGoalId) return;
  if (!confirm("Tem certeza que deseja excluir este objetivo completamente?")) return;

  try {
    await deleteDoc(doc(db, "Objetivos", state.currentGoalId));
    closeGoalDetails();
    loadGoals();
  } catch (error) {
    AppController.showToast("Erro ao excluir: " + error.message, 'error');
  }
}

// Alterna entre a aba Em Andamento e Concluídos
export function switchGoalsTab(tabName) {
  state.goalsTab = tabName;
  const btnAndamento = document.getElementById('btn-goal-andamento');
  const btnConcluidos = document.getElementById('btn-goal-concluidos');
  btnAndamento.classList.toggle('active', tabName === 'ANDAMENTO');
  btnConcluidos.classList.toggle('active', tabName !== 'ANDAMENTO');
  app.moveGoalsPill();

  renderGoalsPage();
}

// Marca o objetivo atual como Concluído
export async function markGoalAsCompleted() {
  if (!state.currentGoalId) return;
  if (!confirm("Deseja marcar este objetivo como concluído? Ele será movido para a aba 'Concluídos'.")) return;

  try {
    await updateDoc(doc(db, "Objetivos", state.currentGoalId), { Status: 'Concluido' });
    closeGoalDetails();
    await loadGoals();
  } catch (error) {
    AppController.showToast("Erro ao concluir objetivo: " + error.message, 'error');
  }
}

// ==========================================
// LÓGICA DE ORDENAÇÃO DE OBJETIVOS
// ==========================================
export function toggleGoalsSortDropdown(event) {
  if (event) event.stopPropagation();
  const dropdown = document.getElementById('goals-sort-dropdown');
  if (dropdown) {
    dropdown.style.display = (dropdown.style.display === 'none' || dropdown.style.display === '') ? 'block' : 'none';
  }
}

export function setGoalsSortOrder(order) {
  state.goalsSortOrder = order;

  // Esconde o menu após clicar
  const dropdown = document.getElementById('goals-sort-dropdown');
  if (dropdown) dropdown.style.display = 'none';

  // Atualiza a tela com a nova ordem
  renderGoalsPage();
}

// Fechar menus suspensos ao clicar fora
document.addEventListener('click', (e) => {
  const optionsDropdown = document.getElementById('goal-options-dropdown');
  if (optionsDropdown && optionsDropdown.style.display === 'block') {
    optionsDropdown.style.display = 'none';
  }
  const sortDropdown = document.getElementById('goals-sort-dropdown');
  if (sortDropdown && sortDropdown.style.display === 'block') {
    sortDropdown.style.display = 'none';
  }
});
