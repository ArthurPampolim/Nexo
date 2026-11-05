import { db } from '../firebase.js';
import { collection, addDoc, updateDoc, deleteDoc, doc } from 'firebase/firestore';
import { state, currencyFormatter, escapeHTML, getCurrentUserId, fetchUserScopedDocs, elements } from '../core.js';
import { parseCurrencyMask } from '../finance.js';
import { loadCreditData } from './cards.js';
import { app } from '../app.js';

// --- CUSTOS FIXOS ---
export async function loadFixedCosts() {
  try {
    state.fixedCosts = await fetchUserScopedDocs("CustosFixos");

    // Ordena por dia de vencimento
    state.fixedCosts.sort((a, b) => (parseInt(a.DiaVencimento) || 0) - (parseInt(b.DiaVencimento) || 0));
    renderFixedCosts(state.fixedCosts);
  } catch (error) {
    console.error("Erro ao carregar custos fixos:", error);
  }
}

function createFixedCostListItem(cost, isPaid) {
  const safeCostId = escapeHTML(cost.ID);
  const safeCostNome = escapeHTML(cost.Nome);
  const safeDia = escapeHTML(cost.DiaVencimento);

  const li = document.createElement('li'); li.className = 'transaction-item';
  li.innerHTML = `
      <div class="item-details" style="flex: 1; min-width: 0; ${isPaid ? 'opacity:0.5;' : ''}">
        <strong>${safeCostNome}</strong>${isPaid ? '<span style="color:green; margin-left:5px; font-size:12px; font-weight:600;">(Pago)</span>' : '<span style="color:#ff9800; margin-left:5px; font-size:12px; font-weight:600;">(Pendente)</span>'}<br>
        <small style="color:#777;">Vence dia: ${safeDia}</small>
      </div>
      <div style="width: 170px; min-width: 170px; display: flex; justify-content: flex-end; margin-right: 15px; flex-shrink: 0;">
        <div class="item-value text-red" style="text-align: right; ${isPaid ? 'opacity:0.5;' : ''}">${currencyFormatter.format(cost.Valor)}</div>
      </div>
      <div style="display:flex; gap:10px; flex-shrink: 0;">
        ${!isPaid
      ? `<button class="btn-text" style="color:var(--primary-color);" onclick="AppController.markFixedCostPaid('${safeCostId}')" title="Pagar"><i class="fas fa-check-circle"></i> Pagar</button>`
      : `<button class="btn-text" style="color:#ff9800;" onclick="AppController.unmarkFixedCostPaid('${safeCostId}')" title="Desmarcar Pago"><i class="fas fa-undo"></i> Desmarcar</button>`
    }
        <button class="btn-text" style="color:var(--primary-color);" onclick="AppController.editFixedCost('${safeCostId}')" title="Editar"><i class="fas fa-edit"></i></button>
        <button class="btn-delete" onclick="AppController.deleteFixedCost('${safeCostId}')" title="Excluir"><i class="fas fa-trash"></i></button>
      </div>`;
  return li;
}

export function renderFixedCosts(costs) {
  const selectedYYYYMM = app.getSelectedYYYYMM();
  const dashContainer = elements.fixedCostsContainer;
  const pageContainer = document.getElementById('fc-page-items-container');

  const titleElem = document.getElementById('fc-page-period-title');
  const totalElem = document.getElementById('fc-page-total-cost');
  const paidElem = document.getElementById('fc-page-total-paid');
  const pendingElem = document.getElementById('fc-page-total-pending');
  const countBadge = document.getElementById('fc-count-badge');

  if (titleElem) titleElem.innerText = selectedYYYYMM;

  let totalCost = 0;
  let totalPaid = 0;
  let totalPending = 0;

  const safeCosts = costs || [];

  // Mapeia os custos verificando se há exceções para o mês atual
  const computedCosts = safeCosts.map(cost => {
    let val = parseFloat(cost.Valor) || 0;
    let nome = cost.Nome;
    let dia = cost.DiaVencimento;

    // Se houver uma exceção salva para o mês selecionado, ela sobrepõe os valores padrão
    if (cost.Excecoes && cost.Excecoes[selectedYYYYMM]) {
      const ex = cost.Excecoes[selectedYYYYMM];
      val = ex.Valor !== undefined ? parseFloat(ex.Valor) : val;
      if (isNaN(val)) val = parseFloat(cost.Valor) || 0;
      nome = ex.Nome || nome;
      dia = ex.DiaVencimento || dia;
    }

    const paidList = cost.MesesPagos ? String(cost.MesesPagos).split(',').map(s => s.trim()).filter(Boolean) : [];
    const isPaid = paidList.includes(selectedYYYYMM);

    totalCost += val;
    if (isPaid) totalPaid += val;
    else totalPending += val;

    return { ...cost, Valor: val, Nome: nome, DiaVencimento: dia, _isPaid: isPaid };
  });

  if (totalElem) totalElem.innerText = currencyFormatter.format(totalCost);
  if (paidElem) paidElem.innerText = currencyFormatter.format(totalPaid);
  if (pendingElem) pendingElem.innerText = currencyFormatter.format(totalPending);
  if (countBadge) countBadge.innerText = `${safeCosts.length} custo(s) cadastrado(s)`;

  if (dashContainer) {
    dashContainer.innerHTML = '';
    if (computedCosts.length === 0) {
      dashContainer.innerHTML = '<li style="color:#888; padding:15px;">Nenhum custo fixo.</li>';
    } else {
      computedCosts.forEach(c => dashContainer.appendChild(createFixedCostListItem(c, c._isPaid)));
    }
  }

  if (pageContainer) {
    pageContainer.innerHTML = '';
    if (computedCosts.length === 0) {
      pageContainer.innerHTML = '<li style="color:#888; padding:15px;">Nenhum custo fixo cadastrado.</li>';
    } else {
      computedCosts.forEach(c => pageContainer.appendChild(createFixedCostListItem(c, c._isPaid)));
    }
  }
}

export function renderFixedCostsPage() {
  renderFixedCosts(state.fixedCosts);
}

export function openFixedCostModal() {
  state.editingId = null;
  state.editingType = null;
  state.editingScope = 'ALL';
  elements.fixedCostForm.reset();
  elements.submitFixedCostBtn.innerText = 'Salvar Custo Fixo';
  elements.fixedCostModal.classList.remove('hidden');
}
export function editFixedCost(id) {
  // Em vez de abrir o formulário, abre a pergunta
  state.pendingEditId = id;
  document.getElementById('fc-edit-scope-modal').classList.remove('hidden');
}

export function closeFCEditScopeModal() {
  document.getElementById('fc-edit-scope-modal').classList.add('hidden');
  state.pendingEditId = null;
}

export function proceedEditFixedCost(scope) {
  const id = state.pendingEditId; // 1º GUARDAMOS O ID ENQUANTO ELE EXISTE
  closeFCEditScopeModal();        // 2º AGORA SIM, FECHAMOS A PERGUNTA

  const fc = state.fixedCosts.find(x => String(x.ID) === String(id));
  if (!fc) return;

  state.editingId = id;
  state.editingType = 'FIXED_COST';
  state.editingScope = scope; // 'MONTH_ONLY' ou 'ALL'

  const currentMonth = app.getSelectedYYYYMM();
  let defaultName = fc.Nome;
  let defaultValue = fc.Valor;
  let defaultDay = fc.DiaVencimento;

  // Se for apenas neste mês, pré-preenche com a exceção existente (se houver)
  if (scope === 'MONTH_ONLY' && fc.Excecoes && fc.Excecoes[currentMonth]) {
    defaultName = fc.Excecoes[currentMonth].Nome || defaultName;
    defaultValue = fc.Excecoes[currentMonth].Valor !== undefined ? fc.Excecoes[currentMonth].Valor : defaultValue;
    defaultDay = fc.Excecoes[currentMonth].DiaVencimento || defaultDay;
  }

  document.querySelector(`#fixed-cost-form input[name="nome"]`).value = defaultName;
  document.querySelector(`#fixed-cost-form input[name="valor"]`).value = currencyFormatter.format(parseFloat(defaultValue) || 0);
  document.querySelector(`#fixed-cost-form input[name="diaVencimento"]`).value = defaultDay;

  const btnSubmit = document.getElementById('submit-fc-btn');
  if (btnSubmit) {
    btnSubmit.innerText = scope === 'MONTH_ONLY' ? 'Salvar Exceção' : 'Atualizar Custo';
  }

  document.getElementById('fixed-cost-modal').classList.remove('hidden');
}

export function closeFixedCostModal() {
  elements.fixedCostModal.classList.add('hidden');
  elements.fixedCostForm.reset();
  state.editingId = null;
  state.editingType = null;
  elements.submitFixedCostBtn.innerText = 'Salvar Custo Fixo';
}

export async function submitFixedCost(event) {
  event.preventDefault();
  elements.submitFixedCostBtn.disabled = true;
  elements.submitFixedCostBtn.innerHTML = 'Salvando...';

  const formDados = Object.fromEntries(new FormData(elements.fixedCostForm).entries());
  const currentMonth = app.getSelectedYYYYMM();

  try {
    if (state.editingId && state.editingType === 'FIXED_COST') {
      const fc = state.fixedCosts.find(x => String(x.ID) === String(state.editingId));

      if (state.editingScope === 'MONTH_ONLY') {
        // Salva apenas como exceção do mês atual na base de dados
        const excecoes = fc.Excecoes || {};
        excecoes[currentMonth] = {
          Nome: formDados.nome,
          Valor: parseCurrencyMask(formDados.valor) || 0,
          DiaVencimento: parseInt(formDados.diaVencimento) || 1
        };
        await updateDoc(doc(db, "CustosFixos", state.editingId), { Excecoes: excecoes });
      } else {
        // Atualiza globalmente (Este mês e seguintes / ALL)
        const payloadFormatado = {
          Nome: formDados.nome,
          Valor: parseCurrencyMask(formDados.valor),
          DiaVencimento: parseInt(formDados.diaVencimento) || 1
        };
        await updateDoc(doc(db, "CustosFixos", state.editingId), payloadFormatado);
      }
    } else {
      // Criação de um NOVO custo
      const payloadFormatado = {
        userId: getCurrentUserId(),
        Nome: formDados.nome,
        Valor: parseCurrencyMask(formDados.valor),
        DiaVencimento: parseInt(formDados.diaVencimento) || 1,
        Status: 'Pendente',
        MesesPagos: ''
      };
      await addDoc(collection(db, "CustosFixos"), payloadFormatado);
    }
    closeFixedCostModal();
    loadFixedCosts();
  } catch (error) {
    AppController.showToast("Erro ao salvar custo fixo: " + error.message, 'error');
  } finally {
    elements.submitFixedCostBtn.disabled = false;
  }
}

export async function deleteFixedCost(id) {
  const cost = state.fixedCosts.find(c => String(c.ID) === String(id));
  if (!await app.confirmDialog({
    title: 'Excluir custo fixo?',
    message: 'Esta ação não pode ser desfeita.',
    detail: cost ? `${cost.Nome} · ${currencyFormatter.format(parseFloat(cost.Valor) || 0)}` : ''
  })) return;
  try {
    await deleteDoc(doc(db, "CustosFixos", id));
    loadFixedCosts();
  } catch (error) {
    AppController.showToast("Erro ao excluir: " + error.message, 'error');
  }
}

export async function submitFixedCostPay(event) {
  event.preventDefault();
  const btn = document.getElementById('submit-fc-pay-btn');

  try {
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processando...';
    }

    const formElement = document.getElementById('fc-pay-form');
    if (!formElement) throw new Error("A tag <form> perdeu o id 'fc-pay-form'.");

    const formData = new FormData(formElement);
    const costId = formData.get('id');
    const contaNome = formData.get('conta');
    const categoriaNome = formData.get('categoria');

    if (!costId) throw new Error("ID do custo fixo não encontrado.");
    if (!contaNome) throw new Error("Selecione uma conta bancária.");
    if (!categoriaNome) throw new Error("Selecione a categoria da despesa.");

    const currentTargetMonth = app.getSelectedYYYYMM();
    const cost = state.fixedCosts.find(c => String(c.ID) === String(costId));
    if (!cost) throw new Error("Custo não encontrado na base de dados.");

    let paidList = cost.MesesPagos ? String(cost.MesesPagos).split(',').map(s => s.trim()).filter(Boolean) : [];
    if (!paidList.includes(currentTargetMonth)) {
      paidList.push(currentTargetMonth);
    }
    await updateDoc(doc(db, "CustosFixos", costId), { MesesPagos: paidList.join(','), Status: 'Pago' });

    // Cálculos com as exceções na hora do pagamento
    let amount = parseFloat(cost.Valor) || 0;
    let nome = cost.Nome;
    let dia = cost.DiaVencimento || 1;

    if (cost.Excecoes && cost.Excecoes[currentTargetMonth]) {
      const ex = cost.Excecoes[currentTargetMonth];
      amount = ex.Valor !== undefined ? parseFloat(ex.Valor) : amount;
      if (isNaN(amount)) amount = parseFloat(cost.Valor) || 0;
      nome = ex.Nome || nome;
      dia = ex.DiaVencimento || dia;
    }

    const [yearStr, monthStr] = currentTargetMonth.split('-');
    const lastDayOfMonth = new Date(parseInt(yearStr, 10), parseInt(monthStr, 10), 0).getDate();
    const dueDayStr = String(Math.min(parseInt(dia, 10), lastDayOfMonth)).padStart(2, '0');

    await addDoc(collection(db, "Transacoes"), {
      userId: getCurrentUserId(),
      Tipo: 'DESPESA',
      Categoria: categoriaNome,
      Valor: amount,
      Descricao: `Pagamento autom.: ${nome}`,
      Conta: contaNome,
      Data: `${currentTargetMonth}-${dueDayStr}`
    });

    closeFixedCostPayModal();
    loadFixedCosts();
    app.loadTransactions();

  } catch (error) {
    console.error("Erro no pagamento:", error);
    alert(error.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i class="fas fa-check-circle" style="margin-right: 6px;"></i>Confirmar Pagamento';
    }
  }
}

export function closeFixedCostPayModal() {
  const modal = document.getElementById('fc-pay-modal');
  const form = document.getElementById('fc-pay-form');
  if (modal) modal.classList.add('hidden');
  if (form) form.reset();
}

export function markFixedCostPaid(id) {
  const fc = state.fixedCosts.find(x => String(x.ID) === String(id));
  if (!fc) return;
  openFCPayModal(fc);
}

export function openFCPayModal(fc) {
  const currentMonth = app.getSelectedYYYYMM();
  let val = parseFloat(fc.Valor) || 0;
  let nome = fc.Nome;

  if (fc.Excecoes && fc.Excecoes[currentMonth]) {
    const ex = fc.Excecoes[currentMonth];
    val = ex.Valor !== undefined ? parseFloat(ex.Valor) : val;
    if (isNaN(val)) val = parseFloat(fc.Valor) || 0;
    nome = ex.Nome || nome;
  }

  document.getElementById('fc-pay-id').value = fc.ID;
  document.getElementById('fc-pay-name').innerText = nome;
  document.getElementById('fc-pay-value').innerText = currencyFormatter.format(val);

  const select = document.getElementById('fc-pay-account');
  select.innerHTML = '<option value="" disabled selected>Selecione a conta...</option>';
  state.accounts.forEach(acc => {
    const opt = document.createElement('option');
    opt.value = acc.Nome;
    opt.text = acc.Nome;
    select.appendChild(opt);
  });
  app.upgradeSelects();

  document.getElementById('fc-pay-modal').classList.remove('hidden');
}

export function closeFCPayModal() {
  document.getElementById('fc-pay-modal').classList.add('hidden');
  document.getElementById('fc-pay-form').reset();
}

export function openPayInvoiceModal(cardId) {
  const selectedYYYYMM = app.getSelectedYYYYMM();

  // Filtra os lançamentos APENAS do cartão selecionado que NÃO foram pagos
  const invoiceItems = state.creditTransactions.filter(ct =>
    String(ct.MesFatura) === selectedYYYYMM &&
    String(ct.IdCartao || ct.CartaoID) === String(cardId) &&
    ct.Status !== 'Pago'
  );

  const totalAmount = invoiceItems.reduce((acc, tx) => acc + (parseFloat(tx.Valor) || 0), 0);

  if (totalAmount <= 0) {
    alert("Não há fatura pendente para pagar neste cartão.");
    return;
  }

  const cardObj = state.creditCards.find(c => String(c.ID) === String(cardId));
  const cardName = cardObj ? cardObj.Nome : 'Cartão';
  const monthTitle = document.getElementById('cc-page-period-title') ? document.getElementById('cc-page-period-title').innerText : selectedYYYYMM;

  document.getElementById('cc-pay-invoice-amount').value = totalAmount;
  document.getElementById('cc-pay-invoice-month').value = selectedYYYYMM;
  document.getElementById('cc-pay-invoice-card-id').value = cardId;

  const nameEl = document.getElementById('cc-pay-invoice-name');
  if (nameEl) nameEl.innerText = `Fatura ${cardName} - ${monthTitle}`;

  const valueEl = document.getElementById('cc-pay-invoice-value');
  if (valueEl) valueEl.innerText = currencyFormatter.format(totalAmount);

  const select = document.getElementById('cc-pay-invoice-account');
  if (select) {
    select.innerHTML = '<option value="" disabled selected>Selecione a conta...</option>';
    state.accounts.forEach(acc => {
      const opt = document.createElement('option');
      opt.value = acc.Nome;
      opt.text = acc.Nome;
      select.appendChild(opt);
    });
    app.upgradeSelects();
  }

  const modal = document.getElementById('cc-pay-invoice-modal');
  if (modal) modal.classList.remove('hidden');
}

export function closePayInvoiceModal() {
  const modal = document.getElementById('cc-pay-invoice-modal');
  const form = document.getElementById('cc-pay-invoice-form');
  if (modal) modal.classList.add('hidden');
  if (form) form.reset();
}

export async function submitPayInvoice(event) {
  event.preventDefault();
  const btn = document.getElementById('submit-cc-pay-btn');

  try {
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processando...';
    }

    const formElement = document.getElementById('cc-pay-invoice-form');
    if (!formElement) throw new Error("A tag <form> perdeu o id 'cc-pay-invoice-form'.");

    const formData = new FormData(formElement);
    const amount = parseFloat(formData.get('amount')) || 0;
    const monthStr = formData.get('month');
    const cardId = formData.get('cardId');
    const contaNome = formData.get('conta');

    if (!contaNome) throw new Error("Selecione uma conta bancária.");
    if (amount <= 0) throw new Error("Valor inválido para pagamento.");

    const cardObj = state.creditCards.find(c => String(c.ID) === String(cardId));
    const cardName = cardObj ? cardObj.Nome : 'Cartão de Crédito';

    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

    // 1. Desconta o dinheiro da conta sem gerar uma nova "Despesa" no painel
    await addDoc(collection(db, "Transacoes"), {
      userId: getCurrentUserId(),
      Tipo: 'DESPESA',
      Categoria: 'Transferência', // <-- A MÁGICA ACONTECE AQUI
      Valor: amount,
      Descricao: `Pagamento Fatura ${cardName} - ${monthStr}`,
      Conta: contaNome,
      Data: todayStr
    });

    // 2. Efetiva (Pago) SOMENTE os itens do cartão selecionado
    const invoiceItems = state.creditTransactions.filter(ct =>
      String(ct.MesFatura) === monthStr &&
      String(ct.IdCartao || ct.CartaoID) === String(cardId) &&
      ct.Status !== 'Pago'
    );

    const updatePromises = invoiceItems.map(item => updateDoc(doc(db, "TransacoesCartao", item.ID), { Status: 'Pago' }));
    await Promise.all(updatePromises);

    closePayInvoiceModal();

    loadCreditData();
    app.loadTransactions();

    AppController.showToast("Fatura paga com sucesso!", 'success');

  } catch (error) {
    console.error("Erro no pagamento da fatura:", error);
    alert(error.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i class="fas fa-check-circle" style="margin-right: 6px;"></i>Confirmar Pagamento';
    }
  }
}


export async function unmarkFixedCostPaid(id) {
  const currentTargetMonth = app.getSelectedYYYYMM();
  const cost = state.fixedCosts.find(c => String(c.ID) === String(id));
  if (!cost) return;

  if (!await app.confirmDialog({
    title: 'Desmarcar como pago?',
    message: 'A despesa automática será removida do histórico.',
    detail: `${cost.Nome} · ${currencyFormatter.format(parseFloat(cost.Valor) || 0)}`,
    confirmLabel: 'Desmarcar',
    danger: false
  })) return;

  try {
    let paidList = cost.MesesPagos ? String(cost.MesesPagos).split(',').map(s => s.trim()).filter(Boolean) : [];
    paidList = paidList.filter(m => m !== currentTargetMonth);
    await updateDoc(doc(db, "CustosFixos", id), { MesesPagos: paidList.join(','), Status: paidList.length > 0 ? 'Pago' : 'Pendente' });

    // Identifica o nome correto (em caso de exceção) para buscar a transação e apagá-la
    let nomeParaBusca = cost.Nome;
    if (cost.Excecoes && cost.Excecoes[currentTargetMonth]) {
      nomeParaBusca = cost.Excecoes[currentTargetMonth].Nome || nomeParaBusca;
    }

    const autoTx = state.transactions.find(t => {
      if (t.Tipo !== 'DESPESA' || !(t.Descricao && t.Descricao.includes(nomeParaBusca))) return false;
      const tMonth = t.Data ? String(t.Data).slice(0, 7) : '';
      return tMonth === currentTargetMonth;
    });

    if (autoTx && autoTx.ID) {
      await deleteDoc(doc(db, "Transacoes", autoTx.ID));
    }

    loadFixedCosts();
    app.loadTransactions();
  } catch (error) {
    AppController.showToast("Erro ao desmarcar pagamento: " + error.message, 'error');
  }
}
