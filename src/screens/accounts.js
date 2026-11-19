import { db } from '../firebase.js';
import { collection, addDoc, updateDoc, deleteDoc, doc } from 'firebase/firestore';
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

  const positiveTotal = state.accounts.reduce((sum, acc) => sum + Math.max(0, roundCents(balances[acc.Nome])), 0);

  state.accounts.forEach(acc => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'account-mini-card';
    card.title = 'Ir para Minhas Contas';
    card.onclick = () => app.switchTab('accounts');
    const bal = roundCents(balances[acc.Nome]); const bClass = balanceClass(bal);
    const share = positiveTotal > 0 ? Math.round(Math.max(0, bal) / positiveTotal * 100) : 0;
    card.innerHTML = `
      <span class="acc-top">
        <span class="acc-icon"><i class="fas fa-university"></i></span>
        <span class="acc-name">${escapeHTML(acc.Nome)}</span>
      </span>
      <span class="acc-balance ${bClass}">${currencyFormatter.format(bal)}</span>
      <span class="acc-share"><span class="acc-share-bar"><span style="width:${share}%"></span></span><small>${share}% do saldo</small></span>`;
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
        card.style.cursor = 'pointer';
        card.tabIndex = 0;
        card.setAttribute('role', 'button');
        const open = () => openAccDrawer(acc.ID);
        card.addEventListener('click', open);
        card.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
        });
        gridContainer.appendChild(card);
      });
    }
  }
  if (state.accDrawerId) renderAccDrawer();
}

// ── Painel lateral da conta (resumo, últimos lançamentos e exclusão) ──
export function openAccDrawer(accId) {
  state.accDrawerId = String(accId);
  renderAccDrawer();
  document.getElementById('acc-drawer-overlay').classList.add('open');
  document.getElementById('acc-drawer').classList.add('open');
  document.body.style.overflow = 'hidden';
}

export function closeAccDrawer() {
  state.accDrawerId = null;
  document.getElementById('acc-drawer-overlay')?.classList.remove('open');
  document.getElementById('acc-drawer')?.classList.remove('open');
  document.body.style.overflow = '';
}

const accTxns = (acc) => state.transactions.filter(t => t.Conta === acc.Nome);

function renderAccDrawer() {
  const acc = state.accounts.find(a => String(a.ID) === String(state.accDrawerId));
  const body = document.getElementById('acc-drawer-body');
  const footer = document.getElementById('acc-drawer-footer');
  if (!acc || !body || !footer) { closeAccDrawer(); return; }

  const txs = accTxns(acc);
  const totals = settledTotals(txs);
  const initial = parseFloat(acc.SaldoInicial) || 0;
  const balance = roundCents(initial + totals.income - totals.expense);
  const recent = [...txs].sort((a, b) => String(b.Data).localeCompare(String(a.Data))).slice(0, 8);

  document.getElementById('acc-drawer-title').innerText = acc.Nome;

  const rows = recent.length === 0
    ? '<li class="cc-drawer-empty">Nenhum lançamento nesta conta.</li>'
    : recent.map(t => {
      const isIncome = t.Tipo === 'RECEITA';
      return `
        <li class="cc-drawer-item">
          <div class="cc-drawer-item-info">
            <strong>${escapeHTML(t.Descricao || t.Categoria || 'Lançamento')}</strong>
            <small>${escapeHTML(formatDateBR(t.Data) || t.Data || '')} · ${escapeHTML(t.Categoria || 'Outros')}</small>
          </div>
          <div class="cc-drawer-item-value ${isIncome ? 'text-green' : 'text-red'}">${isIncome ? '+' : '-'}${currencyFormatter.format(parseFloat(t.Valor) || 0)}</div>
        </li>`;
    }).join('');

  body.innerHTML = `
    <div class="tx-drawer-hero">
      <div class="tx-drawer-amount-label">Saldo atual</div>
      <div class="tx-drawer-amount ${balanceClass(balance)}">${currencyFormatter.format(balance)}</div>
      <div class="tx-drawer-meta-pills">
        <span class="goal-pill goal-pill-success"><i class="fas fa-check"></i> Ativa</span>
      </div>
    </div>
    <div class="cc-drawer-limit">
      <div><small>Saldo inicial</small><strong>${currencyFormatter.format(initial)}</strong></div>
      <div><small>Lançamentos</small><strong>${txs.length}</strong></div>
    </div>
    <div class="cc-drawer-limit">
      <div><small>Receitas efetivadas</small><strong class="text-green">${currencyFormatter.format(totals.income)}</strong></div>
      <div><small>Despesas efetivadas</small><strong class="text-red">${currencyFormatter.format(totals.expense)}</strong></div>
    </div>
    <h3 class="cc-drawer-section-title">Últimos lançamentos <span>${recent.length} de ${txs.length}</span></h3>
    <ul class="cc-drawer-list">${rows}</ul>`;

  footer.innerHTML = `<button type="button" class="btn-danger-outline" id="acc-drawer-delete-btn"><i class="fas fa-trash"></i> Excluir conta</button>`;
  document.getElementById('acc-drawer-delete-btn').addEventListener('click', () => deleteAccount(acc.ID));
}

async function deleteAccount(accId) {
  const acc = state.accounts.find(a => String(a.ID) === String(accId));
  if (!acc) return;
  const txs = accTxns(acc);
  if (!await app.confirmDialog({
    title: 'Excluir conta?',
    message: txs.length > 0
      ? `Os ${txs.length} lançamento(s) desta conta também serão excluídos. Esta ação não pode ser desfeita.`
      : 'Esta ação não pode ser desfeita.',
    detail: acc.Nome,
    confirmLabel: 'Excluir conta'
  })) return;

  try {
    await Promise.all(txs.flatMap(t => [
      deleteDoc(doc(db, "Transacoes", t.ID)),
      ...(t.ComprovanteId ? [deleteDoc(doc(db, "Comprovantes", t.ComprovanteId))] : [])
    ]));
    await deleteDoc(doc(db, "Contas", acc.ID));
    closeAccDrawer();
    app.showToast('Conta excluída com sucesso!', 'success');
    loadAccounts();
  } catch (error) {
    app.showToast('Erro ao excluir conta: ' + error.message, 'error');
  }
}
