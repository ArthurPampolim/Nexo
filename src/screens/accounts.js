import { db } from '../firebase.js';
import { collection, addDoc, updateDoc, doc } from 'firebase/firestore';
import { state, currencyFormatter, escapeHTML, formatDateBR, balanceClass, getCurrentUserId, fetchUserScopedDocs, elements, activeTransactions } from '../core.js';
import { settledTotals, accountBalances, roundCents, parseCurrencyMask, txLocalISO } from '../finance.js';
import { openDatePicker } from './transactions.js';
import { app } from '../app.js';

// --- CONTAS BANCÁRIAS E TRANSFERÊNCIAS ---
export async function loadAccounts() {
  try {
    const data = await fetchUserScopedDocs("Contas");
    state.accounts = data;
    populateAccountsDropdown();
    await app.loadTransactions();
    renderAccountsPage();
  } catch (error) {
    console.error("Erro ao carregar contas:", error);
  }
}
function populateAccountsDropdown() {
  if (!elements.accountSelect) return;
  elements.accountSelect.innerHTML = '<option value="" disabled selected>Selecione uma conta...</option>';
  state.accounts.forEach(acc => {
    const opt = document.createElement('option');
    opt.value = acc.Nome;
    opt.text = acc.Nome;
    elements.accountSelect.appendChild(opt);
  });
  app.upgradeSelects();
}
export function renderAccountBalances(transactions) {
  const container = document.getElementById('accounts-container'); if (!container) return;
  container.innerHTML = '';
  if (state.accounts.length === 0) { container.innerHTML = '<div style="color:#888; padding:15px; font-size:14px;">Nenhuma conta.</div>'; return; }
  const balances = accountBalances(state.accounts, transactions);

  const today = new Date();
  today.setHours(23, 59, 59, 999);


  state.accounts.forEach(acc => {
    const card = document.createElement('div'); card.className = 'account-mini-card';
    const bal = roundCents(balances[acc.Nome]); const bClass = balanceClass(bal);
    card.innerHTML = `<div class="acc-name"><i class="fas fa-wallet" style="margin-right: 8px; color: #aaa;"></i>${escapeHTML(acc.Nome)}</div><div class="acc-balance ${bClass}">${currencyFormatter.format(bal)}</div>`;
    container.appendChild(card);
  });
}
export function openAccountModal() { elements.accountModal.classList.remove('hidden'); }
export function closeAccountModal() { elements.accountModal.classList.add('hidden'); elements.accountForm.reset(); }
export async function submitAccount(event) {
  event.preventDefault();
  elements.submitAccountBtn.disabled = true;
  elements.submitAccountBtn.innerHTML = 'Salvando...';

  const formDados = Object.fromEntries(new FormData(elements.accountForm).entries());

  try {
    await addDoc(collection(db, "Contas"), {
      userId: getCurrentUserId(),
      Nome: formDados.nome,
      SaldoInicial: parseCurrencyMask(formDados.saldoInicial),
      Status: 'Ativo'
    });
    closeAccountModal();
    loadAccounts();
  } catch (error) {
    AppController.showToast("Erro ao salvar conta: " + error.message, 'error');
  } finally {
    elements.submitAccountBtn.disabled = false;
    elements.submitAccountBtn.innerText = 'Salvar';
  }
}

export function openTransferModal() {
  const orig = document.getElementById('transfer-origem');
  const dest = document.getElementById('transfer-destino');
  if (orig && dest) {
    orig.innerHTML = '<option value="" disabled selected>Selecione a origem...</option>';
    dest.innerHTML = '<option value="" disabled selected>Selecione o destino...</option>';
    state.accounts.forEach(acc => {
      const safeName = escapeHTML(acc.Nome);
      orig.innerHTML += `<option value="${safeName}">${safeName}</option>`;
      dest.innerHTML += `<option value="${safeName}">${safeName}</option>`;
    });
    app.upgradeSelects();
  }
  setTransferDate(txLocalISO());
  document.getElementById('transfer-modal').classList.remove('hidden');
}

// ── Data da transferência (mesmos atalhos e calendário do lançamento) ──
function setTransferDate(iso) {
  document.getElementById('transfer-data').value = iso;
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const isToday = iso === txLocalISO();
  const isYesterday = iso === txLocalISO(yesterday);
  document.getElementById('transfer-chip-today').classList.toggle('active', isToday);
  document.getElementById('transfer-chip-yesterday').classList.toggle('active', isYesterday);
  const other = document.getElementById('transfer-chip-other');
  other.classList.toggle('active', !isToday && !isYesterday);
  other.innerText = (!isToday && !isYesterday) ? formatDateBR(iso) : 'Outros…';
}

export function setTransferDateShortcut(offsetDays) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  setTransferDate(txLocalISO(d));
}

export function openTransferDatePicker() {
  openDatePicker(document.getElementById('transfer-data').value, setTransferDate);
}
export function closeTransferModal() {
  document.getElementById('transfer-modal').classList.add('hidden');
  document.getElementById('transfer-form').reset();
}
export async function submitTransfer(event) {
  event.preventDefault();
  const btn = document.getElementById('submit-transfer-btn');
  btn.disabled = true;
  btn.innerText = 'Transferindo...';

  const formDados = Object.fromEntries(new FormData(document.getElementById('transfer-form')).entries());
  const valorTransf = parseCurrencyMask(formDados.valor);
  const localISO = formDados.dataTransacao;
  const uid = getCurrentUserId();

  try {
    if (formDados.tipoTransferencia === 'OBJETIVO') {
      const goal = state.goals.find(g => String(g.ID) === String(formDados.origem));
      if (!goal) throw new Error("Objetivo não encontrado.");
      if (valorTransf > (parseFloat(goal.ValorAtual) || 0)) throw new Error("Saldo insuficiente no objetivo.");

      await updateDoc(doc(db, "Objetivos", goal.ID), { ValorAtual: (parseFloat(goal.ValorAtual) || 0) - valorTransf });
      await addDoc(collection(db, "Transacoes"), { userId: uid, Tipo: 'RECEITA', Categoria: 'Investimentos', Valor: valorTransf, Descricao: `Resgate de Objetivo: ${goal.Nome}`, Conta: formDados.destino, Data: localISO });
    } else {
      if (formDados.origem === formDados.destino) throw new Error("Origem e destino devem ser diferentes.");
      await addDoc(collection(db, "Transacoes"), { userId: uid, Tipo: 'DESPESA', Categoria: 'Transferência', Valor: valorTransf, Descricao: `Transf. para ${formDados.destino}`, Conta: formDados.origem, Data: localISO });
      await addDoc(collection(db, "Transacoes"), { userId: uid, Tipo: 'RECEITA', Categoria: 'Transferência', Valor: valorTransf, Descricao: `Transf. de ${formDados.origem}`, Conta: formDados.destino, Data: localISO });
    }

    closeTransferModal();
    app.loadTransactions();
    if (formDados.tipoTransferencia === 'OBJETIVO') app.loadGoals();
  } catch (error) {
    AppController.showToast("Erro na transferência: " + error.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerText = 'Realizar Transferência';
  }
}

// --- RENDERIZAÇÃO DA ABA DEDICADA: MINHAS CONTAS ---
export function renderAccountsPage() {
  const totalElem = document.getElementById('acc-page-total-balance');
  const countBadge = document.getElementById('acc-count-badge');
  const gridContainer = document.getElementById('acc-page-grid');

  const today = new Date();
  today.setHours(23, 59, 59, 999);

  const balances = accountBalances(state.accounts, activeTransactions());


  const baseBalance = state.accounts.reduce((acc, currentAcc) => acc + (parseFloat(currentAcc.SaldoInicial) || 0), 0);
  const globalSummary = settledTotals(activeTransactions());

  const currentGlobalBalance = baseBalance + globalSummary.income - globalSummary.expense;
  if (totalElem) totalElem.innerText = currencyFormatter.format(currentGlobalBalance);
  if (countBadge) countBadge.innerText = `${state.accounts.length} conta(s)`;

  if (gridContainer) {
    gridContainer.innerHTML = '';
    //Injeta o Cartão Fixo de "Nova Conta" idêntico à sua referência
    const newAccountCard = document.createElement('div');
    newAccountCard.className = 'summary-card new-account-card';
    newAccountCard.style.flexDirection = 'column';
    newAccountCard.style.alignItems = 'center';
    newAccountCard.style.justifyContent = 'center';
    newAccountCard.style.padding = '30px 20px';
    newAccountCard.style.cursor = 'pointer';
    newAccountCard.style.border = '2px dashed var(--primary-color)'; // Borda tracejada
    newAccountCard.style.backgroundColor = 'transparent';
    newAccountCard.style.boxShadow = 'none';
    newAccountCard.style.minHeight = '145px';
    newAccountCard.onclick = AppController.openAccountModal;

    newAccountCard.innerHTML = `
      <div style="width: 48px; height: 48px; border-radius: 50%; border: 2px solid var(--primary-color); display: flex; justify-content: center; align-items: center; color: var(--primary-color); font-size: 18px; margin-bottom: 12px; transition: transform 0.2s;">
        <i class="fas fa-plus"></i>
      </div>
      <strong style="color: var(--primary-color); font-size: 15px; font-weight: 600;">Nova conta</strong>
    `;
    gridContainer.appendChild(newAccountCard);
    if (state.accounts.length > 0) {
      state.accounts.forEach(acc => {
        const bal = roundCents(balances[acc.Nome]);
        const bClass = balanceClass(bal);
        const card = document.createElement('div');
        card.className = 'summary-card';
        card.style.flexDirection = 'column';
        card.style.alignItems = 'flex-start';
        card.style.gap = '10px';
        card.style.padding = '20px';

        const safeAccNome = escapeHTML(acc.Nome);
        card.innerHTML = `
            <div style="display:flex; justify-content:space-between; width:100%; align-items:center;">
              <strong style="font-size:16px; color:#333;"><i class="fas fa-university" style="color:#2196F3; margin-right:8px;"></i>${safeAccNome}</strong>
              <span style="font-size:12px; color:#666; background:#e3f2fd; padding:2px 8px; border-radius:10px;">Ativa</span>
            </div>
            <div style="margin-top:5px;">
              <div style="font-size:12px; color:#888;">Saldo Atual</div>
              <div class="acc-balance ${bClass}" style="font-size:20px; font-weight:bold;">${currencyFormatter.format(bal)}</div>
            </div>
            <div style="font-size:12px; color:#888; border-top:1px solid #f0f0f0; width:100%; padding-top:8px; margin-top:4px;">
              Saldo Inicial: <strong>${currencyFormatter.format(parseFloat(acc.SaldoInicial) || 0)}</strong>
            </div>`;
        gridContainer.appendChild(card);
      });
    }
  }
}
