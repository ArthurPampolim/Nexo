import { db } from '../firebase.js';
import { collection, addDoc, deleteDoc, doc } from 'firebase/firestore';
import { state, currencyFormatter, escapeHTML, formatDateBR, getCurrentUserId, fetchUserScopedDocs, elements } from '../core.js';
import { parseCurrencyMask } from '../finance.js';
import { app } from '../app.js';

// --- CARTÃO DE CRÉDITO & FATURAS ---
export async function loadCreditData() {
  try {
    state.creditCards = await fetchUserScopedDocs("Cartoes");
    populateCCDropdown();
    loadCreditTransactions();
  } catch (error) {
    console.error("Erro ao carregar cartões:", error);
  }
}

export async function loadCreditTransactions() {
  try {
    state.creditTransactions = await fetchUserScopedDocs("TransacoesCartao");
    calculateInvoiceSum();
    renderCreditCardsPage();
  } catch (error) {
    console.error("Erro ao carregar faturas:", error);
  }
}

function populateCCDropdown() {
  if (!elements.cctCartaoSelect) return;
  elements.cctCartaoSelect.innerHTML = '<option value="" disabled selected>Selecione o cartão...</option>';
  state.creditCards.forEach(card => {
    const opt = document.createElement('option');
    opt.value = card.ID;
    opt.text = card.Nome;
    elements.cctCartaoSelect.appendChild(opt);
  });
  app.upgradeSelects();
}
export function calculateInvoiceSum() {
  const targetInvoiceStr = app.getSelectedYYYYMM();
  const invoiceTotal = state.creditTransactions.reduce((acc, current) => {
    if (current.MesFatura && String(current.MesFatura).startsWith(targetInvoiceStr)) return acc + (parseFloat(current.Valor) || 0);
    return acc;
  }, 0);
  if (elements.totalCreditCard) elements.totalCreditCard.innerText = currencyFormatter.format(invoiceTotal);
}
export function openCCModal() { elements.ccModal.classList.remove('hidden'); }
export function closeCCModal() { elements.ccModal.classList.add('hidden'); elements.ccForm.reset(); }
export async function submitCC(event) {
  event.preventDefault();
  elements.submitCCBtn.disabled = true;
  elements.submitCCBtn.innerHTML = 'Salvando...';

  const formDados = Object.fromEntries(new FormData(elements.ccForm).entries());

  try {
    await addDoc(collection(db, "Cartoes"), {
      userId: getCurrentUserId(),
      Nome: formDados.nome,
      Limite: parseCurrencyMask(formDados.limite),
      DiaFechamento: parseInt(formDados.diaFechamento) || 1,
      DiaVencimento: parseInt(formDados.diaVencimento) || 1
    });
    closeCCModal();
    loadCreditData();
  } catch (error) {
    AppController.showToast("Erro ao salvar cartão: " + error.message, 'error');
  } finally {
    elements.submitCCBtn.disabled = false;
    elements.submitCCBtn.innerText = 'Salvar Cartão';
  }
}
export function openCCTransModal() {
  if (state.creditCards.length === 0) { alert("Cadastre um Cartão primeiro."); return; }
  closeCCInvoiceModal();
  
  elements.ccTransForm.reset();

  const selects = elements.ccTransForm.querySelectorAll('select:not(.no-choices)');
  selects.forEach(s => {
    if (s.choicesInstance) {
      s.choicesInstance.destroy();
      s.choicesInstance = new Choices(s, { searchEnabled: false, itemSelectText: '', shouldSort: false});        
    }
  });

  elements.ccTransModal.classList.remove('hidden');
  const localISO = new Date(new Date().getTime() - (new Date().getTimezoneOffset() * 60000)).toISOString().split('T')[0];

  const dateInput = document.getElementById('cct-data');
  if (dateInput && dateInput._flatpickr) dateInput._flatpickr.setDate(localISO);
  else if (dateInput) dateInput.value = localISO;
}
export function closeCCTransModal() { elements.ccTransModal.classList.add('hidden'); elements.ccTransForm.reset(); }
export async function submitCCTrans(event) {
  event.preventDefault();
  elements.submitCCTransBtn.disabled = true;
  elements.submitCCTransBtn.innerText = 'Lançando...';

  const formDados = Object.fromEntries(new FormData(elements.ccTransForm).entries());
  const cardId = formDados.idCartao;
  const valorTotal = parseCurrencyMask(formDados.valor);
  const parcelas = parseInt(formDados.parcelas) || 1;

  try {
    const card = state.creditCards.find(c => String(c.ID) === String(cardId));
    if (!card) throw new Error("Cartão não encontrado.");

    const valorParcela = valorTotal / parcelas;
    const tDate = new Date(formDados.dataTransacao + 'T12:00:00');
    const transactionDay = tDate.getDate();

    let baseInvoiceMonth = tDate.getMonth() + 1;
    let baseInvoiceYear = tDate.getFullYear();

    if (transactionDay >= (parseInt(card.DiaFechamento) || 31)) {
      baseInvoiceMonth++;
      if (baseInvoiceMonth > 12) { baseInvoiceMonth = 1; baseInvoiceYear++; }
    }

    for (let i = 0; i < parcelas; i++) {
      let curMonth = baseInvoiceMonth + i;
      let curYear = baseInvoiceYear;
      while (curMonth > 12) { curMonth -= 12; curYear++; }

      const mesFaturaStr = `${curYear}-${String(curMonth).padStart(2, '0')}`;
      const descStr = parcelas > 1 ? `${formDados.descricao || 'Compra'} (${i + 1}/${parcelas})` : formDados.descricao;

      await addDoc(collection(db, "TransacoesCartao"), {
        userId: getCurrentUserId(),
        IdCartao: cardId,
        Data: formDados.dataTransacao,
        Categoria: formDados.categoria,
        Valor: valorParcela,
        Descricao: descStr,
        MesFatura: mesFaturaStr
      });
    }
    closeCCTransModal();
    loadCreditTransactions();
  } catch (error) {
    AppController.showToast("Erro ao lançar fatura: " + error.message, 'error');
  } finally {
    elements.submitCCTransBtn.disabled = false;
    elements.submitCCTransBtn.innerText = 'Lançar na Fatura';
  }
}

export function openCCInvoiceModal() {
  const selectedYYYYMM = app.getSelectedYYYYMM();
  document.getElementById('invoice-period-title').innerText = selectedYYYYMM;
  renderInvoiceItems();
  document.getElementById('cc-invoice-modal').classList.remove('hidden');
}
export function closeCCInvoiceModal() {
  document.getElementById('cc-invoice-modal').classList.add('hidden');
}
export function renderInvoiceItems() {
  const container = document.getElementById('invoice-items-container');
  if (!container) return;
  const selectedYYYYMM = app.getSelectedYYYYMM();

  const invoiceItems = state.creditTransactions.filter(ct => {
    return ct.MesFatura && String(ct.MesFatura).startsWith(selectedYYYYMM);
  });

  const totalVal = invoiceItems.reduce((sum, item) => sum + (parseFloat(item.Valor) || 0), 0);
  document.getElementById('invoice-modal-total').innerText = `Total: ${currencyFormatter.format(totalVal)}`;

  container.innerHTML = '';
  if (invoiceItems.length === 0) {
    container.innerHTML = '<li style="padding: 15px; color: #888;">Nenhum lançamento no cartão neste mês.</li>';
    return;
  }

  invoiceItems.forEach(item => {
    const cardObj = state.creditCards.find(c => String(c.ID) === String(item.IdCartao || item.CartaoID));
    const cardName = cardObj ? cardObj.Nome : 'Cartão';
    const safeId = escapeHTML(item.ID);
    const safeCat = escapeHTML(item.Categoria);
    const safeDesc = escapeHTML(item.Descricao || '');
    const safeCardName = escapeHTML(cardName);
    const safeDate = escapeHTML(formatDateBR(item.Data) || item.Data || '');

    const li = document.createElement('li');
    li.className = 'transaction-item';
    li.innerHTML = `
        <div class="item-details" style="flex: 1; min-width: 0;">
          <strong>${safeCat}${safeDesc ? ' - ' + safeDesc : ''}</strong><br>
          <small style="color: #888;">${safeCardName} • ${safeDate}</small>
        </div>
        <div style="width: 170px; min-width: 170px; display: flex; justify-content: flex-end; margin-right: 15px; flex-shrink: 0;">
          <div class="item-value text-red" style="text-align: right;">
            ${currencyFormatter.format(item.Valor)}
          </div>
        </div>
        <div style="flex-shrink: 0;">
          <button class="btn-delete" onclick="AppController.deleteCreditTransaction('${safeId}')" title="Excluir"><i class="fas fa-trash"></i></button>
        </div>`;
    container.appendChild(li);
  });
}

export async function deleteCreditTransaction(id) {
  const item = state.creditTransactions.find(x => String(x.ID) === String(id));
  if (!await app.confirmDialog({
    title: 'Excluir lançamento da fatura?',
    message: 'Esta ação não pode ser desfeita.',
    detail: app.describeTx(item)
  })) return;
  try {
    await deleteDoc(doc(db, "TransacoesCartao", id));
    loadCreditTransactions();
    setTimeout(() => { renderInvoiceItems(); renderCreditCardsPage(); }, 300);
  } catch (error) {
    AppController.showToast("Erro ao excluir: " + error.message, 'error');
  }
}

// --- RENDERIZAÇÃO DA ABA DEDICADA: CARTÕES & FATURAS ---
export function renderCreditCardsPage() {
  const titleElem = document.getElementById('cc-page-period-title');
  const totalElem = document.getElementById('cc-page-total-invoice');
  const cardsGrid = document.getElementById('cc-cards-grid');

  const selectedYYYYMM = app.getSelectedYYYYMM();
  if (titleElem) titleElem.innerText = selectedYYYYMM;

  const invoiceItems = state.creditTransactions.filter(ct => {
    return ct.MesFatura && String(ct.MesFatura).startsWith(selectedYYYYMM);
  });

  const totalInvoiceVal = invoiceItems.reduce((acc, current) => acc + (parseFloat(current.Valor) || 0), 0);
  if (totalElem) totalElem.innerText = currencyFormatter.format(totalInvoiceVal);

  if (cardsGrid) {
    cardsGrid.innerHTML = '';
    if (state.creditCards.length === 0) {
      cardsGrid.innerHTML = '<div style="color:#888; padding:15px;">Nenhum cartão de crédito cadastrado.</div>';
    } else {
      state.creditCards.forEach((card, idx) => {
        const wrap = document.createElement('div');
        wrap.className = 'cc-tile';
        wrap.tabIndex = 0;
        wrap.setAttribute('role', 'button');

        const limitVal = parseFloat(card.Limite) || 0;
        const usedLimit = state.creditTransactions
          .filter(ct => String(ct.IdCartao || ct.CartaoID) === String(card.ID) && ct.Status !== 'Pago')
          .reduce((sum, item) => sum + (parseFloat(item.Valor) || 0), 0);
        const usedPct = limitVal > 0 ? Math.min(100, (usedLimit / limitVal) * 100) : 0;
        const barClass = usedPct >= 90 ? 'danger' : (usedPct >= 70 ? 'warn' : '');

        wrap.setAttribute('aria-label', `Abrir detalhes do cartão ${card.Nome}`);
        wrap.innerHTML = `
          <div class="cc-visual cc-theme-${idx % 4}">
            <div class="cc-visual-top">
              <span class="cc-visual-name">${escapeHTML(card.Nome)}</span>
              <i class="fas fa-wifi cc-visual-wifi"></i>
            </div>
            <div class="cc-visual-chip"></div>
            <div class="cc-visual-bottom">
              <span>Fecha dia ${escapeHTML(card.DiaFechamento || '--')} · Vence dia ${escapeHTML(card.DiaVencimento || '--')}</span>
              <strong>${escapeHTML(card.Bandeira || 'NEXO')}</strong>
            </div>
          </div>
          <div class="cc-tile-meta">
            <div>
              <strong>${currencyFormatter.format(usedLimit)}</strong>
              <small>de ${currencyFormatter.format(limitVal)}</small>
            </div>
            <div class="cc-limit-bar"><span class="${barClass}" style="width:${usedPct}%"></span></div>
          </div>`;

        const open = () => openCCDrawer(card.ID);
        wrap.addEventListener('click', open);
        wrap.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
        });
        cardsGrid.appendChild(wrap);
      });
    }
  }

  if (state.ccDrawerCardId) renderCCDrawer();
}

// --- DRAWER LATERAL DO CARTÃO (LANÇAMENTOS + PAGAR FATURA) ---
export function openCCDrawer(cardId) {
  state.ccDrawerCardId = String(cardId);
  renderCCDrawer();
  document.getElementById('cc-drawer-overlay').classList.add('open');
  document.getElementById('cc-drawer').classList.add('open');
  document.body.style.overflow = 'hidden';
}

export function closeCCDrawer() {
  state.ccDrawerCardId = null;
  const overlay = document.getElementById('cc-drawer-overlay');
  const drawer = document.getElementById('cc-drawer');
  if (overlay) overlay.classList.remove('open');
  if (drawer) drawer.classList.remove('open');
  document.body.style.overflow = '';
}

async function deleteCreditCard(cardId) {
  const card = state.creditCards.find(c => String(c.ID) === String(cardId));
  if (!card) return;
  const cardTxns = state.creditTransactions.filter(ct => String(ct.IdCartao || ct.CartaoID) === String(cardId));
  if (!await app.confirmDialog({
    title: 'Excluir cartão?',
    message: cardTxns.length > 0
      ? `Os ${cardTxns.length} lançamento(s) deste cartão também serão excluídos. Esta ação não pode ser desfeita.`
      : 'Esta ação não pode ser desfeita.',
    detail: card.Nome,
    confirmLabel: 'Excluir cartão'
  })) return;

  try {
    await Promise.all(cardTxns.map(ct => deleteDoc(doc(db, "TransacoesCartao", ct.ID))));
    await deleteDoc(doc(db, "Cartoes", cardId));
    closeCCDrawer();
    app.showToast('Cartão excluído com sucesso!', 'success');
    loadCreditData();
  } catch (error) {
    app.showToast('Erro ao excluir cartão: ' + error.message, 'error');
  }
}

function renderCCDrawer() {
  const card = state.creditCards.find(c => String(c.ID) === String(state.ccDrawerCardId));
  const body = document.getElementById('cc-drawer-body');
  const footer = document.getElementById('cc-drawer-footer');
  if (!card || !body || !footer) { closeCCDrawer(); return; }

  const selectedYYYYMM = app.getSelectedYYYYMM();
  const monthLabelEl = document.getElementById('selected-month-label');
  const monthLabel = monthLabelEl ? monthLabelEl.innerText : selectedYYYYMM;
  const limitVal = parseFloat(card.Limite) || 0;
  const cardTxns = state.creditTransactions.filter(ct => String(ct.IdCartao || ct.CartaoID) === String(card.ID));
  const usedLimit = cardTxns.filter(ct => ct.Status !== 'Pago').reduce((sum, i) => sum + (parseFloat(i.Valor) || 0), 0);
  const available = limitVal - usedLimit;

  const invoiceItems = cardTxns
    .filter(ct => ct.MesFatura && String(ct.MesFatura).startsWith(selectedYYYYMM))
    .sort((a, b) => String(b.Data).localeCompare(String(a.Data)));
  const invoiceTotal = invoiceItems.reduce((sum, i) => sum + (parseFloat(i.Valor) || 0), 0);
  const pendingTotal = invoiceItems.filter(i => i.Status !== 'Pago').reduce((sum, i) => sum + (parseFloat(i.Valor) || 0), 0);
  const hasPending = pendingTotal > 0;

  document.getElementById('cc-drawer-title').innerText = card.Nome;

  const rows = invoiceItems.length === 0
    ? '<li class="cc-drawer-empty">Nenhum lançamento neste cartão para o mês selecionado.</li>'
    : invoiceItems.map(item => {
      const safeId = escapeHTML(item.ID);
      const desc = escapeHTML(item.Descricao || item.Categoria || 'Lançamento');
      const cat = escapeHTML(item.Categoria || 'Outros');
      const date = escapeHTML(formatDateBR(item.Data) || item.Data || '');
      const paid = item.Status === 'Pago';
      return `
        <li class="cc-drawer-item">
          <div class="cc-drawer-item-info">
            <strong>${desc}</strong>
            <small>${date} · ${cat}${paid ? ' · <span class="text-green">Pago</span>' : ''}</small>
          </div>
          <div class="cc-drawer-item-value">${currencyFormatter.format(parseFloat(item.Valor) || 0)}</div>
          <button class="btn-delete" onclick="AppController.deleteCreditTransaction('${safeId}')" title="Excluir"><i class="fas fa-trash"></i></button>
        </li>`;
    }).join('');

  body.innerHTML = `
    <div class="tx-drawer-hero">
      <div class="tx-drawer-amount-label">Fatura de ${escapeHTML(monthLabel)}</div>
      <div class="tx-drawer-amount ${hasPending ? 'text-red' : 'text-green'}">${currencyFormatter.format(invoiceTotal)}</div>
      <div class="tx-drawer-meta-pills">
        <span class="goal-pill ${hasPending ? 'goal-pill-warning' : 'goal-pill-success'}">
          <i class="fas ${hasPending ? 'fa-hourglass-half' : 'fa-check'}"></i> ${hasPending ? 'Em aberto' : 'Paga ou vazia'}
        </span>
        <span class="goal-pill goal-pill-neutral"><i class="fas fa-calendar-alt"></i> Vence dia ${escapeHTML(card.DiaVencimento || '--')}</span>
        <span class="goal-pill goal-pill-neutral"><i class="fas fa-lock"></i> Fecha dia ${escapeHTML(card.DiaFechamento || '--')}</span>
      </div>
    </div>
    <div class="cc-drawer-limit">
      <div><small>Limite disponível</small><strong class="${available < 0 ? 'text-red' : ''}">${currencyFormatter.format(available)}</strong></div>
      <div><small>Limite total</small><strong>${currencyFormatter.format(limitVal)}</strong></div>
    </div>
    <h3 class="cc-drawer-section-title">Lançamentos da fatura <span>${invoiceItems.length} registro(s)</span></h3>
    <ul class="cc-drawer-list">${rows}</ul>`;

  footer.innerHTML = `
    <button type="button" class="btn-danger-outline" id="cc-drawer-delete-btn"><i class="fas fa-trash"></i> Excluir cartão</button>
    ${hasPending
      ? `<button type="button" class="btn-primary" id="cc-drawer-pay-btn" style="flex:1; margin:0;"><i class="fas fa-check-circle"></i> Pagar fatura (${currencyFormatter.format(pendingTotal)})</button>`
      : `<span class="text-green" style="font-weight:600;"><i class="fas fa-check-double"></i> Sem fatura pendente</span>`}`;

  document.getElementById('cc-drawer-delete-btn').addEventListener('click', () => deleteCreditCard(card.ID));

  const payBtn = document.getElementById('cc-drawer-pay-btn');
  if (payBtn) {
    payBtn.addEventListener('click', () => {
      const id = card.ID;
      closeCCDrawer();
      app.openPayInvoiceModal(id);
    });
  }
}
