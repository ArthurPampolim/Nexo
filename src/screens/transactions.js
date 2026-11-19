import { db } from '../firebase.js';
import { collection, addDoc, updateDoc, deleteDoc, doc, getDoc } from 'firebase/firestore';
import { state, currencyFormatter, escapeHTML, formatDateBR, getCurrentUserId, fetchUserScopedDocs, elements, activeTransactions } from '../core.js';
import { isSettled, settledTotals, monthSummary, parseCurrencyMask, isTransferTransaction, parseLocalDate, txLocalISO, txAddMonths } from '../finance.js';
import { ChartManager } from '../charts.js';
import { renderAccountBalances } from './accounts.js';
import { loadCreditTransactions, renderInvoiceItems } from './cards.js';
import { getCategoryStyle, categoryIconHTML, rebuildCategorySelect, setCategorySelectValue } from './categories.js';
import { app } from '../app.js';

// --- TRANSAÇÕES GERAIS ---
export async function loadTransactions() {
  try {
    state.transactions = await fetchUserScopedDocs("Transacoes");
    renderTransactions();
  } catch (error) {
    console.error("Erro ao carregar transações:", error);
  }
}

export function renderTransactions() {
  app.updateTransactionSummary();
  const selectedYYYYMM = app.getSelectedYYYYMM();
  const today = new Date();
  today.setHours(23, 59, 59, 999);

  // 1. Filtra as transações do mês selecionado
  const monthlyTransactions = state.transactions.filter(t => {
    if (!t.Data) return false;
    const tDate = parseLocalDate(t.Data);
    const tMonth = String(tDate.getMonth() + 1).padStart(2, '0');
    const tYear = tDate.getFullYear();
    return `${tYear}-${tMonth}` === selectedYYYYMM;
  });

  // --- INJETAR LANÇAMENTOS DO CARTÃO ---
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
        ID: ct.ID, Tipo: 'DESPESA', Data: syntheticDate, Categoria: ct.Categoria,
        Conta: cardObj ? cardObj.Nome : 'Cartão de Crédito', Valor: ct.Valor,
        Descricao: ct.Descricao + ` (Comprado: ${formatDateBR(ct.Data)})`,
        isCreditCard: true, Status: ct.Status || 'Pendente'
      };
    });

  monthlyTransactions.push(...ccTransactions);

  // 2. Aplicação do filtro de abas (Receitas, Despesas, Transferências)
  const displayTransactions = monthlyTransactions.filter(t => {
    const isTransf = isTransferTransaction(t);
    if (state.txFilter === 'DESPESA') return t.Tipo === 'DESPESA' && !isTransf;
    if (state.txFilter === 'RECEITA') return t.Tipo === 'RECEITA' && !isTransf;
    if (state.txFilter === 'TRANSFERENCIA') return isTransf;
    return true;
  });

  // 3. ORDENAÇÃO DINÂMICA (A MÁGICA DOS CABEÇALHOS)
  displayTransactions.sort((a, b) => {
    let valA, valB;

    if (state.txSortCol === 'Data') {
      valA = parseLocalDate(a.Data).getTime();
      valB = parseLocalDate(b.Data).getTime();
    } else if (state.txSortCol === 'Descricao') {
      valA = String(a.Descricao || a.Categoria || '').toLowerCase();
      valB = String(b.Descricao || b.Categoria || '').toLowerCase();
    } else if (state.txSortCol === 'Categoria') {
      valA = String(a.Categoria || '').toLowerCase();
      valB = String(b.Categoria || '').toLowerCase();
    } else if (state.txSortCol === 'Conta') {
      valA = String(a.Conta || '').toLowerCase();
      valB = String(b.Conta || '').toLowerCase();
    } else if (state.txSortCol === 'Valor') {
      valA = parseFloat(a.Valor) || 0;
      valB = parseFloat(b.Valor) || 0;
    }

    if (valA < valB) return state.txSortDir === 'asc' ? -1 : 1;
    if (valA > valB) return state.txSortDir === 'asc' ? 1 : -1;

    // Desempate (ID) para itens exatamente iguais
    return String(b.ID || '').localeCompare(String(a.ID || ''));
  });

  // Seleção em lote: descarta o que saiu da lista (outro mês/filtro, item excluído)
  state.txSelected = state.txSelected || new Set();
  const visibleIds = new Set(displayTransactions.filter(t => !t.isCreditCard).map(t => String(t.ID)));
  state.txSelected.forEach(id => { if (!visibleIds.has(id)) state.txSelected.delete(id); });

  state.txExport = {
    rows: displayTransactions,
    month: selectedYYYYMM,
    label: new Date(+selectedYYYYMM.slice(0, 4), +selectedYYYYMM.slice(5, 7) - 1, 1)
      .toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
  };

  // 4. LÓGICA DO SALDO DO FINAL DO DIA
  const baseBalance = state.accounts.reduce((acc, currentAcc) => acc + (parseFloat(currentAcc.SaldoInicial) || 0), 0);
  const allSortedChronologically = [...activeTransactions()].sort((a, b) => {
    return parseLocalDate(a.Data).getTime() - parseLocalDate(b.Data).getTime();
  });

  let runningBalance = baseBalance;
  const endOfDayBalances = {};

  allSortedChronologically.forEach(t => {
    const amount = parseFloat(t.Valor) || 0;
    if (t.Tipo === 'RECEITA') runningBalance += amount;
    else if (t.Tipo === 'DESPESA') runningBalance -= amount;

    endOfDayBalances[formatDateBR(t.Data)] = runningBalance;
  });

  // 5. MÁGICA DA PAGINAÇÃO
  state.txItemsPerPage = state.txItemsPerPage || 50;
  state.txCurrentPage = state.txCurrentPage || 1;

  const totalItems = displayTransactions.length;
  const totalPages = Math.ceil(totalItems / state.txItemsPerPage);

  // Corrigir página se estiver fora dos limites
  if (state.txCurrentPage > totalPages && totalPages > 0) state.txCurrentPage = totalPages;
  if (state.txCurrentPage < 1) state.txCurrentPage = 1;

  const startIndex = (state.txCurrentPage - 1) * state.txItemsPerPage;
  const endIndex = Math.min(startIndex + state.txItemsPerPage, totalItems);

  // FATIA a lista para mostrar apenas os itens desta página
  const paginatedTransactions = displayTransactions.slice(startIndex, endIndex);

  const countBadge = document.getElementById('tx-count-badge');
  if (countBadge) countBadge.innerText = `${totalItems} registro(s)`;

  // Resumos Superiores
  const globalSummary = settledTotals(activeTransactions());
  const currentGlobalBalance = baseBalance + globalSummary.income - globalSummary.expense;

  const monthlySummary = monthSummary(monthlyTransactions);

  if (elements.totalBalance) elements.totalBalance.innerText = currencyFormatter.format(currentGlobalBalance);
  if (elements.totalIncome) elements.totalIncome.innerText = currencyFormatter.format(monthlySummary.income);
  if (elements.totalExpense) elements.totalExpense.innerText = currencyFormatter.format(monthlySummary.expense);

  renderAccountBalances(activeTransactions());
  elements.transactionsContainer.innerHTML = '';

  // =========================================================
  // ATUALIZAR ÍCONES DE ORDENAÇÃO NOS CABEÇALHOS
  // =========================================================
  ['Data', 'Descricao', 'Categoria', 'Conta', 'Valor'].forEach(col => {
    const iconSpan = document.getElementById(`sort-icon-${col}`);
    if (iconSpan) {
      if (state.txSortCol === col) {
        iconSpan.innerHTML = state.txSortDir === 'asc'
          ? '<i class="fas fa-arrow-up" style="font-size: 10px; margin-left: 6px; color: #888;"></i>'
          : '<i class="fas fa-arrow-down" style="font-size: 10px; margin-left: 6px; color: #888;"></i>';
      } else {
        iconSpan.innerHTML = '';
      }
    }
  });

  // =========================================================
  // SE NÃO HOUVER TRANSAÇÕES
  // =========================================================
  if (displayTransactions.length === 0) {
    elements.transactionsContainer.innerHTML = '<tr><td colspan="8" style="padding:15px; color:#888; text-align:center;">Nenhuma transação encontrada com este filtro.</td></tr>';

    const pagInfo = document.getElementById('tx-pagination-info');
    if (pagInfo) pagInfo.innerText = `0-0 de 0`;
    ['first', 'prev', 'next', 'last'].forEach(id => {
      const btn = document.getElementById(`tx-page-${id}`);
      if (btn) btn.disabled = true;
    });

    state.txPageIds = [];
    syncTxSelection();
    ChartManager.updateDashboardCharts(activeTransactions(), selectedYYYYMM);
    app.renderDashboardInsights(selectedYYYYMM);
    return;
  }

  state.txPageIds = paginatedTransactions.filter(t => !t.isCreditCard).map(t => String(t.ID));

  // DESENHAR LINHAS PAGINADAS
  paginatedTransactions.forEach((t, index) => {
    const tr = document.createElement('tr');
    tr.className = 'tx-tr';
    tr.style.cursor = 'pointer';
    tr.title = 'Clique para ver detalhes e editar no painel lateral';
    tr.onclick = (e) => {
      if (e.target.closest('button') || e.target.closest('input')) return;
      AppController.openTxDrawer(t.ID, t.isCreditCard);
    };

    const isTransf = isTransferTransaction(t);
    const isExp = t.Tipo === 'DESPESA';
    const tDate = parseLocalDate(t.Data);
    const isPending = t.isCreditCard ? (t.Status !== 'Pago') : (!isTransf && !isSettled(t));

    let valClass = '';
    let sign = '';

    if (isTransf) {
      valClass = 'text-blue';
      sign = isExp ? '<i class="fas fa-arrow-right" style="font-size:10px;"></i>' : '<i class="fas fa-arrow-left" style="font-size:10px;"></i>';
    } else if (isExp) {
      valClass = 'text-red';
      sign = '-';
    } else {
      valClass = 'text-green';
      sign = '+';
    }

    const canToggle = !t.isCreditCard && !isTransf;
    const toggleAttr = canToggle
      ? ` role="button" tabindex="0" onclick="event.stopPropagation();AppController.toggleTxStatus('${escapeHTML(String(t.ID))}')"`
      : '';
    const statusHtml = isPending
      ? `<div class="status-icon status-pending${canToggle ? ' status-toggle' : ''}" title="${canToggle ? 'Agendado: clique para marcar como efetivado' : 'Agendado/Pendente'}"${toggleAttr}><i class="fas fa-hourglass-half"></i></div>`
      : `<div class="status-icon status-paid${canToggle ? ' status-toggle' : ''}" title="${canToggle ? 'Efetivado: clique para marcar como agendado' : 'Efetivado'}"${toggleAttr}><i class="fas fa-check"></i></div>`;

    const catStyle = getCategoryStyle(t.Categoria);
    let mainDesc = t.Descricao || t.Categoria;
    if (isTransf && t.Descricao) mainDesc = t.Descricao;

    const currentDateStr = formatDateBR(t.Data);
    const safeId = escapeHTML(t.ID);
    const actionButtons = t.isCreditCard
      ? `<button class="btn-text" style="color: #64748b;" onclick="event.stopPropagation(); AppController.openTxDrawer('${safeId}', true)" title="Ver Detalhes da Fatura"><i class="fas fa-eye"></i></button>`
      : `<button class="btn-text" style="color: #64748b;" onclick="event.stopPropagation(); AppController.openTxDrawer('${safeId}', false)" title="Ver Detalhes e Editar"><i class="fas fa-pen"></i></button>
         <button class="btn-delete" onclick="event.stopPropagation(); AppController.deleteTransaction('${safeId}')" title="Excluir"><i class="fas fa-trash"></i></button>`;

    tr.innerHTML = `
        <td class="tx-td" style="text-align: center;" onclick="event.stopPropagation()"><input type="checkbox" class="tx-checkbox" ${t.isCreditCard ? 'disabled title="Lançamentos de cartão não entram na edição em lote"' : `onchange="AppController.toggleTxSelect('${safeId}', this.checked)"`} ${state.txSelected.has(String(t.ID)) ? 'checked' : ''}></td>
        <td class="tx-td" style="text-align: center;">${statusHtml}</td>
        <td class="tx-td" style="${isPending ? 'opacity:0.6;' : ''}">${escapeHTML(currentDateStr)}</td>
        <td class="tx-td" style="${isPending ? 'opacity:0.6;' : ''}; font-weight: 500;">${escapeHTML(mainDesc)}${t.ComprovanteId ? ' <i class="fas fa-paperclip tx-clip" title="Comprovante anexado"></i>' : ''}</td>
        <td class="tx-td" style="${isPending ? 'opacity:0.6;' : ''}">
          <div class="cat-badge-container">
            <div class="cat-icon-circle" style="background-color: ${catStyle.color}; color: ${catStyle.ink};">${categoryIconHTML(catStyle)}</div>
            <span>${escapeHTML(t.Categoria || 'Outros')}</span>
          </div>
        </td>
        <td class="tx-td" style="${isPending ? 'opacity:0.6;' : ''}">${escapeHTML(t.Conta || '--')}</td>
        <td class="tx-td ${valClass}" style="text-align: right; ${isPending ? 'opacity:0.6;' : ''}">${sign} ${currencyFormatter.format(t.Valor)}</td>
        <td class="tx-td" style="text-align: center;"><div class="action-btn-group" style="${t.isCreditCard ? 'opacity: 1;' : ''}">${actionButtons}</div></td>`;
    if (t.Ignorar) {
      tr.style.opacity = '0.5';
      tr.title = 'Transação ignorada: não entra nos totais';
    }

    elements.transactionsContainer.appendChild(tr);

    // PÍLULA DE SALDO DO DIA 
    // (Só injeta a pílula de saldos se estivermos a ordenar de forma cronológica por Data!)
    if (state.txSortCol === 'Data') {
      const absoluteIndex = startIndex + index;
      const nextTx = displayTransactions[absoluteIndex + 1];
      const nextDateStr = nextTx ? formatDateBR(nextTx.Data) : null;

      if (currentDateStr !== nextDateStr) {
        const balanceOfDay = endOfDayBalances[currentDateStr] || 0;
        const balanceRow = document.createElement('tr');
        balanceRow.innerHTML = `
            <td colspan="8" style="padding: 20px; text-align: center; border-bottom: 1px solid var(--border-color); background-color: var(--bg-color);">
              <span style="background: var(--bg-light); color: var(--text-main); padding: 8px 16px; border-radius: 20px; font-size: 13.5px; border: 1px solid var(--border-color);">
                Saldo do Final do Dia <strong>${currencyFormatter.format(balanceOfDay)}</strong>
              </span>
            </td>`;
        elements.transactionsContainer.appendChild(balanceRow);
      }
    }
  });

  // ATUALIZAR INTERFACE DA PAGINAÇÃO
  const pagInfo = document.getElementById('tx-pagination-info');
  if (pagInfo) pagInfo.innerText = `${startIndex + 1}-${endIndex} de ${totalItems}`;

  const btnFirst = document.getElementById('tx-page-first');
  const btnPrev = document.getElementById('tx-page-prev');
  const btnNext = document.getElementById('tx-page-next');
  const btnLast = document.getElementById('tx-page-last');

  if (btnFirst) btnFirst.disabled = state.txCurrentPage === 1;
  if (btnPrev) btnPrev.disabled = state.txCurrentPage === 1;
  if (btnNext) btnNext.disabled = state.txCurrentPage === totalPages || totalPages === 0;
  if (btnLast) btnLast.disabled = state.txCurrentPage === totalPages || totalPages === 0;

  syncTxSelection();
  ChartManager.updateDashboardCharts(activeTransactions(), selectedYYYYMM);
  app.renderDashboardInsights(selectedYYYYMM);
}

// ── Comprovantes ──
const RECEIPT_MAX_CHARS = 700000;
state.txFile = null;
state.txFileRemoved = false;
state.txExistingReceipt = null;

function readAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

// Reduz a foto até caber no limite do documento do Firestore
async function compressImage(file) {
  const bitmap = await createImageBitmap(file);
  for (const scale of [1, 0.75, 0.5]) {
    const ratio = Math.min(1, 1280 / Math.max(bitmap.width, bitmap.height)) * scale;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * ratio);
    canvas.height = Math.round(bitmap.height * ratio);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.72, 0.6, 0.45]) {
      const url = canvas.toDataURL('image/jpeg', quality);
      if (url.length <= RECEIPT_MAX_CHARS) return url;
    }
  }
  throw new Error('Imagem muito grande para anexar.');
}

async function processReceiptFile(file) {
  if (file.type.startsWith('image/')) {
    return { Nome: file.name.slice(0, 80), Tipo: 'image/jpeg', Dados: await compressImage(file) };
  }
  if (file.type === 'application/pdf') {
    const dados = await readAsDataURL(file);
    if (dados.length > RECEIPT_MAX_CHARS) throw new Error('PDF acima de cerca de 500 KB. Use um arquivo menor ou uma foto.');
    return { Nome: file.name.slice(0, 80), Tipo: file.type, Dados: dados };
  }
  throw new Error('Anexe uma imagem ou um PDF.');
}

// Grava o anexo pendente e devolve os campos a gravar na transação (ou null se nada mudou)
async function persistReceipt(txId, oldId) {
  if (state.txFile) {
    if (oldId) await deleteDoc(doc(db, "Comprovantes", oldId));
    const ref = await addDoc(collection(db, "Comprovantes"), { userId: getCurrentUserId(), TransacaoId: txId, ...state.txFile });
    return { ComprovanteId: ref.id, ComprovanteNome: state.txFile.Nome, ComprovanteTipo: state.txFile.Tipo };
  }
  if (state.txFileRemoved && oldId) {
    await deleteDoc(doc(db, "Comprovantes", oldId));
    return { ComprovanteId: null, ComprovanteNome: null, ComprovanteTipo: null };
  }
  return null;
}

async function deleteReceiptDoc(t) {
  if (t && t.ComprovanteId) await deleteDoc(doc(db, "Comprovantes", t.ComprovanteId));
}

function renderReceiptRow() {
  const name = state.txFile
    ? state.txFile.Nome
    : (!state.txFileRemoved && state.txExistingReceipt ? state.txExistingReceipt.Nome : '');
  document.getElementById('tx-attach-btn').classList.toggle('hidden', Boolean(name));
  const label = document.getElementById('tx-attach-name');
  label.innerText = name;
  label.classList.toggle('hidden', !name);
  document.getElementById('tx-attach-remove').classList.toggle('hidden', !name);
}

function resetReceipt(existing = null) {
  state.txFile = null;
  state.txFileRemoved = false;
  state.txExistingReceipt = existing;
  renderReceiptRow();
}

export async function handleReceiptFile(input) {
  const file = input.files[0];
  input.value = '';
  if (!file) return;
  try {
    state.txFile = await processReceiptFile(file);
    state.txFileRemoved = false;
    renderReceiptRow();
  } catch (err) {
    app.showToast(err.message, 'error');
  }
}

export function clearReceipt() {
  state.txFile = null;
  if (state.txExistingReceipt) state.txFileRemoved = true;
  renderReceiptRow();
}

// Imagem abre em tela cheia; PDF é baixado
async function viewReceipt(id) {
  try {
    const snap = await getDoc(doc(db, "Comprovantes", id));
    if (!snap.exists()) { app.showToast('Comprovante não encontrado.', 'error'); return; }
    const { Dados, Tipo, Nome } = snap.data();

    if (!Tipo.startsWith('image/')) {
      const link = document.createElement('a');
      link.href = Dados;
      link.download = Nome;
      link.click();
      return;
    }

    const overlay = document.createElement('div');
    overlay.className = 'receipt-overlay';
    overlay.innerHTML = `
      <div class="receipt-box">
        <button type="button" class="receipt-close" aria-label="Fechar"><i class="fas fa-times"></i></button>
        <img alt="Comprovante">
      </div>`;
    overlay.querySelector('img').src = Dados;

    const close = () => { document.removeEventListener('keydown', onKey, true); overlay.remove(); };
    const onKey = (e) => { if (e.key === 'Escape') { e.stopImmediatePropagation(); close(); } };
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    overlay.querySelector('.receipt-close').addEventListener('click', close);
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(overlay);
  } catch (err) {
    app.showToast('Erro ao abrir comprovante: ' + err.message, 'error');
  }
}

// ── Comprovante no painel lateral da transação ──
function renderDrawerReceipt() {
  const t = state.drawerTx;
  const group = document.getElementById('tx-drawer-receipt-group');
  const box = document.getElementById('tx-drawer-receipt');
  if (!group || !box) return;
  group.classList.toggle('hidden', !t || state.drawerIsCC);
  if (!t || state.drawerIsCC) return;

  if (t.ComprovanteId) {
    box.innerHTML = `
      <button type="button" class="tx-receipt-open"><i class="fas fa-paperclip"></i> ${escapeHTML(t.ComprovanteNome || 'Comprovante')}</button>
      <button type="button" class="tx-receipt-remove" aria-label="Remover comprovante"><i class="fas fa-times"></i></button>`;
    box.querySelector('.tx-receipt-open').addEventListener('click', () => viewReceipt(t.ComprovanteId));
    box.querySelector('.tx-receipt-remove').addEventListener('click', removeDrawerReceipt);
  } else {
    box.innerHTML = '<button type="button" class="tx-receipt-add"><i class="fas fa-paperclip"></i> Anexar comprovante</button>';
    box.querySelector('.tx-receipt-add').addEventListener('click', () => document.getElementById('tx-drawer-file').click());
  }
}

export async function handleDrawerReceipt(input) {
  const t = state.drawerTx;
  const file = input.files[0];
  input.value = '';
  if (!t || !file) return;
  try {
    state.txFile = await processReceiptFile(file);
    state.txFileRemoved = false;
    const fields = await persistReceipt(t.ID, t.ComprovanteId);
    await updateDoc(doc(db, "Transacoes", t.ID), fields);
    Object.assign(t, fields);
    app.showToast('Comprovante anexado!', 'success');
    renderDrawerReceipt();
    loadTransactions();
  } catch (err) {
    app.showToast(err.message, 'error');
  } finally {
    state.txFile = null;
  }
}

async function removeDrawerReceipt() {
  const t = state.drawerTx;
  if (!t || !t.ComprovanteId) return;
  if (!await app.confirmDialog({
    title: 'Remover comprovante?',
    message: 'O arquivo anexado será excluído.',
    detail: t.ComprovanteNome || '',
    confirmLabel: 'Remover'
  })) return;
  try {
    state.txFile = null;
    state.txFileRemoved = true;
    const fields = await persistReceipt(t.ID, t.ComprovanteId);
    await updateDoc(doc(db, "Transacoes", t.ID), fields);
    Object.assign(t, fields);
    renderDrawerReceipt();
    loadTransactions();
  } catch (err) {
    app.showToast('Erro ao remover: ' + err.message, 'error');
  } finally {
    state.txFileRemoved = false;
  }
}

// ── Exportação (CSV / PDF) ──

// Linhas do mês e filtro atuais, guardadas a cada renderização da lista
function txExportRows() {
  return (state.txExport && state.txExport.rows) || [];
}

function txRowStatus(t) {
  if (t.Ignorar) return 'Ignorada';
  if (isTransferTransaction(t)) return 'Transferência';
  const settled = t.isCreditCard ? t.Status === 'Pago' : isSettled(t);
  return settled ? 'Efetivado' : 'Agendado';
}

// Células que o Excel leria como fórmula ganham aspa na frente
function csvCell(v) {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return `"${s.replace(/"/g, '""')}"`;
}

export function downloadFile(name, mime, content) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportTransactionsCSV() {
  const rows = txExportRows();
  if (!rows.length) return AppController.showToast('Nada para exportar neste mês.', 'error');
  const head = ['Data', 'Descrição', 'Categoria', 'Conta', 'Tipo', 'Situação', 'Valor'];
  const lines = rows.map(t => {
    const signed = t.Tipo === 'DESPESA' ? -(parseFloat(t.Valor) || 0) : (parseFloat(t.Valor) || 0);
    return [formatDateBR(t.Data), t.Descricao || '', t.Categoria || '', t.Conta || '', t.Tipo || '',
      txRowStatus(t)].map(csvCell).concat(String(signed.toFixed(2)).replace('.', ',')).join(';');
  });
  // BOM + ";" para o Excel pt-BR abrir com acentos e colunas certas
  downloadFile(`nexo-${state.txExport.month}.csv`, 'text/csv;charset=utf-8',
    '\ufeff' + [head.map(csvCell).join(';'), ...lines].join('\r\n'));
}

export function exportTransactionsPDF() {
  const rows = txExportRows();
  if (!rows.length) return AppController.showToast('Nada para exportar neste mês.', 'error');
  const fmt = v => currencyFormatter.format(v);
  let income = 0, expense = 0;
  rows.forEach(t => {
    if (t.Ignorar || isTransferTransaction(t)) return;
    const v = parseFloat(t.Valor) || 0;
    if (t.Tipo === 'RECEITA') income += v; else if (t.Tipo === 'DESPESA') expense += v;
  });
  const body = rows.map(t => {
    const v = parseFloat(t.Valor) || 0;
    const neg = t.Tipo === 'DESPESA';
    return `<tr><td>${escapeHTML(formatDateBR(t.Data))}</td><td>${escapeHTML(t.Descricao || '')}</td>
      <td>${escapeHTML(t.Categoria || '')}</td><td>${escapeHTML(t.Conta || '')}</td>
      <td>${escapeHTML(txRowStatus(t))}</td>
      <td class="num ${neg ? 'neg' : 'pos'}">${neg ? '-' : ''}${escapeHTML(fmt(v))}</td></tr>`;
  }).join('');
  const win = window.open('', '_blank');
  if (!win) return AppController.showToast('Permita pop-ups para gerar o PDF.', 'error');
  win.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
    <title>Nexo - ${escapeHTML(state.txExport.label)}</title>
    <style>
      body{font-family:Arial,sans-serif;color:#212b31;margin:32px}
      h1{font-size:20px;margin:0 0 4px}
      .sub{color:#667;font-size:12px;margin-bottom:16px}
      .sum{display:flex;gap:24px;margin-bottom:16px;font-size:13px}
      .sum b{display:block;font-size:16px}
      table{width:100%;border-collapse:collapse;font-size:12px}
      th,td{padding:6px 8px;border-bottom:1px solid #dde;text-align:left}
      th{background:#f1f4f5}
      .num{text-align:right;white-space:nowrap}
      .neg{color:#e11d48}.pos{color:#059669}
      tr{page-break-inside:avoid}
    </style></head><body>
    <h1>Nexo · Lançamentos de ${escapeHTML(state.txExport.label)}</h1>
    <div class="sub">Gerado em ${escapeHTML(new Date().toLocaleDateString('pt-BR'))} · ${rows.length} registro(s)</div>
    <div class="sum"><div>Receitas<b>${escapeHTML(fmt(income))}</b></div>
      <div>Despesas<b>${escapeHTML(fmt(expense))}</b></div>
      <div>Resultado<b>${escapeHTML(fmt(income - expense))}</b></div></div>
    <table><thead><tr><th>Data</th><th>Descrição</th><th>Categoria</th><th>Conta</th><th>Situação</th>
      <th class="num">Valor</th></tr></thead><tbody>${body}</tbody></table>
    <script>window.onload=function(){window.print()}<\/script></body></html>`);
  win.document.close();
}

// ── Modal de lançamento ──
export function setTxType(tipo) {
  const radio = document.querySelector(`#transaction-form input[name="tipo"][value="${tipo}"]`);
  if (radio) radio.checked = true;
  document.getElementById('tx-modal-box').dataset.type = tipo;
  const catSel = document.querySelector('#transaction-form select[name="categoria"]');
  if (catSel && catSel.dataset.categoryKind !== tipo) {
    catSel.dataset.categoryKind = tipo;
    rebuildCategorySelect(catSel);
  }
  const label = tipo === 'RECEITA' ? 'Receita' : 'Despesa';
  document.getElementById('tx-modal-title').innerText = state.editingId ? `Editar ${label}` : `Nova ${label}`;
}

function setTxDate(iso) {
  document.getElementById('dataTransacao').value = iso;
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const isToday = iso === txLocalISO();
  const isYesterday = iso === txLocalISO(yesterday);

  document.getElementById('tx-chip-today').classList.toggle('active', isToday);
  document.getElementById('tx-chip-yesterday').classList.toggle('active', isYesterday);
  const other = document.getElementById('tx-chip-other');
  other.classList.toggle('active', !isToday && !isYesterday);
  other.innerText = (!isToday && !isYesterday) ? formatDateBR(iso) : 'Outros…';
  // Data futura sugere agendado; passado/hoje sugere efetivado. O usuário pode trocar depois.
  elements.form.elements.efetivado.checked = iso <= txLocalISO();
}

export function setTxDateShortcut(offsetDays) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  setTxDate(txLocalISO(d));
}

export function validateTxAmount() {
  const input = document.getElementById('tx-valor');
  const valid = parseCurrencyMask(input.value) !== 0;
  document.getElementById('tx-amount-hint').classList.toggle('hidden', valid);
  return valid;
}

function setTxDetailsOpen(open) {
  document.getElementById('tx-modal-box').classList.toggle('expanded', open);
  document.getElementById('tx-details').setAttribute('aria-hidden', String(!open));
  document.getElementById('tx-more-btn').setAttribute('aria-expanded', String(open));
  document.getElementById('tx-more-label').innerText = open ? 'Menos detalhes' : 'Mais detalhes';
  document.getElementById('tx-more-icon').className = `fas ${open ? 'fa-chevron-left' : 'fa-chevron-right'}`;
}

export function toggleTxDetails() {
  setTxDetailsOpen(!document.getElementById('tx-modal-box').classList.contains('expanded'));
}

export function toggleTxRepeat() {
  const on = document.getElementById('tx-repeat').checked;
  document.getElementById('tx-repeat-fields').classList.toggle('hidden', !on);
}

// Seletor de data em calendário (aberto por "Outros…")
export function openTxDatePicker() {
  openDatePicker(document.getElementById('dataTransacao').value, setTxDate);
}

// Seletor reutilizado por outras telas: onPick recebe a data ISO escolhida
export function openDatePicker(initialISO, onPick) {
  const current = initialISO || txLocalISO();
  let selected = current;
  let [viewY, viewM] = current.split('-').map(Number);
  viewM -= 1;

  const overlay = document.createElement('div');
  overlay.className = 'dp-overlay';
  overlay.innerHTML = `
    <div class="dp-card" role="dialog" aria-modal="true" aria-label="Selecionar data">
      <div class="dp-head"><small id="dp-year"></small><strong id="dp-title"></strong></div>
      <div class="dp-body">
        <div class="dp-nav">
          <button type="button" id="dp-prev" aria-label="Mês anterior"><i class="fas fa-chevron-left"></i></button>
          <span id="dp-month"></span>
          <button type="button" id="dp-next" aria-label="Próximo mês"><i class="fas fa-chevron-right"></i></button>
        </div>
        <div class="dp-grid" id="dp-grid"></div>
        <div class="dp-actions">
          <button type="button" id="dp-cancel">CANCELAR</button>
          <button type="button" id="dp-ok">OK</button>
        </div>
      </div>
    </div>`;

  const render = () => {
    const [sy, sm, sd] = selected.split('-').map(Number);
    const selDate = new Date(sy, sm - 1, sd);
    const wd = selDate.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '');
    const mon = selDate.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '');
    overlay.querySelector('#dp-year').innerText = sy;
    overlay.querySelector('#dp-title').innerText = `${wd}, ${mon} ${sd}`;
    overlay.querySelector('#dp-month').innerText = new Date(viewY, viewM, 1)
      .toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });

    const firstWeekday = new Date(viewY, viewM, 1).getDay();
    const daysInMonth = new Date(viewY, viewM + 1, 0).getDate();
    const today = txLocalISO();
    let html = ['Do', '2ª', '3ª', '4ª', '5ª', '6ª', 'Sá'].map(l => `<span class="dp-wd">${l}</span>`).join('');
    html += '<span></span>'.repeat(firstWeekday);
    for (let day = 1; day <= daysInMonth; day++) {
      const iso = `${viewY}-${String(viewM + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      html += `<button type="button" class="dp-day ${iso === selected ? 'selected' : ''} ${iso === today ? 'today' : ''}" data-iso="${iso}">${day}</button>`;
    }
    overlay.querySelector('#dp-grid').innerHTML = html;
  };

  const close = () => {
    document.removeEventListener('keydown', onKey, true);
    overlay.remove();
  };
  const onKey = (e) => {
    if (e.key === 'Escape') { e.stopImmediatePropagation(); close(); }
  };

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) { close(); return; }
    const dayBtn = e.target.closest('.dp-day');
    if (dayBtn) { selected = dayBtn.dataset.iso; render(); }
  });
  overlay.querySelector('#dp-prev').addEventListener('click', () => {
    const d = new Date(viewY, viewM - 1, 1); viewY = d.getFullYear(); viewM = d.getMonth(); render();
  });
  overlay.querySelector('#dp-next').addEventListener('click', () => {
    const d = new Date(viewY, viewM + 1, 1); viewY = d.getFullYear(); viewM = d.getMonth(); render();
  });
  overlay.querySelector('#dp-cancel').addEventListener('click', close);
  overlay.querySelector('#dp-ok').addEventListener('click', () => { onPick(selected); close(); });

  document.addEventListener('keydown', onKey, true);
  document.body.appendChild(overlay);
  render();
}

// ── Sugestão de descrição (a partir dos lançamentos já feitos) ──
let txSuggestions = [];
let txSuggestActive = -1;
const plain = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

function renderTxSuggest() {
  const list = document.getElementById('tx-desc-suggest');
  list.classList.toggle('hidden', txSuggestions.length === 0);
  list.innerHTML = txSuggestions.map((t, i) => `
    <li role="option" class="${i === txSuggestActive ? 'active' : ''}"
        onmousedown="event.preventDefault(); AppController.pickTxSuggestion(${i})">
      <span class="tx-suggest-dot" style="background:${escapeHTML(getCategoryStyle(t.Categoria).color)}"></span>
      <div><strong>${escapeHTML(t.Descricao)}</strong><small>${escapeHTML(t.Categoria || 'Sem categoria')} | ${escapeHTML(t.Conta || '')}</small></div>
    </li>`).join('');
}

export function hideTxSuggest() {
  txSuggestions = [];
  txSuggestActive = -1;
  const list = document.getElementById('tx-desc-suggest');
  if (list) { list.classList.add('hidden'); list.innerHTML = ''; }
}

export function suggestTxDescription() {
  const term = plain(elements.form.elements.descricao.value);
  if (!term || state.editingId) return hideTxSuggest();

  const tipo = document.getElementById('tx-modal-box').dataset.type;
  const seen = new Set();
  // Mais recentes primeiro; um item por descrição + categoria + conta
  txSuggestions = state.transactions
    .filter(t => t.Descricao && t.Tipo === tipo && !isTransferTransaction(t) && plain(t.Descricao).includes(term))
    .sort((a, b) => String(b.Data).localeCompare(String(a.Data)))
    .filter(t => { const k = plain(t.Descricao) + '|' + t.Categoria + '|' + t.Conta; return !seen.has(k) && seen.add(k); })
    .slice(0, 5);
  txSuggestActive = -1;
  renderTxSuggest();
}

export function pickTxSuggestion(i) {
  const t = txSuggestions[i];
  if (!t) return;
  elements.form.elements.descricao.value = t.Descricao;
  setCategorySelectValue(elements.form.querySelector('select[name="categoria"]'), t.Categoria);
  const conta = document.getElementById('conta');
  if (conta.choicesInstance) conta.choicesInstance.setChoiceByValue(t.Conta);
  else conta.value = t.Conta;
  hideTxSuggest();
}

export function txSuggestKey(e) {
  if (!txSuggestions.length) return;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const step = e.key === 'ArrowDown' ? 1 : -1;
    txSuggestActive = (txSuggestActive + step + txSuggestions.length) % txSuggestions.length;
    renderTxSuggest();
  } else if (e.key === 'Enter' && txSuggestActive >= 0) {
    e.preventDefault();
    pickTxSuggestion(txSuggestActive);
  } else if (e.key === 'Escape') {
    e.stopPropagation();
    hideTxSuggest();
  }
}

function resetTxChoices() {
  elements.form.querySelectorAll('select:not(.no-choices)').forEach(s => {
    if (s.choicesInstance) {
      s.choicesInstance.destroy();
      s.choicesInstance = new Choices(s, { searchEnabled: false, itemSelectText: '', shouldSort: false });
    }
  });
}

export function openModal() {
  hideTxSuggest();
  state.editingId = null;
  state.editingType = null;
  elements.form.reset();
  resetTxChoices();
  resetReceipt();

  document.getElementById('tx-repeat-block').classList.remove('hidden');
  document.getElementById('tx-repeat-fields').classList.add('hidden');
  document.getElementById('tx-save-new-btn').classList.remove('hidden');
  setTxDetailsOpen(false);
  setTxType('DESPESA');
  setTxDate(txLocalISO());
  document.getElementById("tx-amount-hint").classList.add("hidden");

  elements.submitBtn.innerText = 'Salvar';
  elements.modal.classList.remove('hidden');
  document.getElementById('tx-valor').focus();
}
export function editTransaction(id) {
  const t = state.transactions.find(x => String(x.ID) === String(id));
  if (!t) return;
  openModal();
  state.editingId = id; state.editingType = 'TRANSACTION';
  setTxType(t.Tipo);

  setTxDate(t.Data ? txLocalISO(parseLocalDate(t.Data)) : txLocalISO());

  const contaSelect = document.getElementById('conta');
  if (contaSelect) {
    if (contaSelect.choicesInstance) contaSelect.choicesInstance.setChoiceByValue(t.Conta);
    else contaSelect.value = t.Conta;
  }
  const catSelect = elements.form.querySelector('select[name="categoria"]');
  if (catSelect) {
    setCategorySelectValue(catSelect, t.Categoria);
  }

  document.getElementById('tx-valor').value = currencyFormatter.format(parseFloat(t.Valor) || 0);
  validateTxAmount();
  elements.form.elements.descricao.value = t.Descricao || '';
  elements.form.elements.observacao.value = t.Observacao || '';
  elements.form.elements.tags.value = Array.isArray(t.Tags) ? t.Tags.join(', ') : '';
  elements.form.elements.ignorar.checked = Boolean(t.Ignorar);
  elements.form.elements.efetivado.checked = isSettled(t);
  resetReceipt(t.ComprovanteId ? { Id: t.ComprovanteId, Nome: t.ComprovanteNome } : null);

  // Edição: sem repetição e sem "salvar e criar nova"
  document.getElementById('tx-repeat-block').classList.add('hidden');
  document.getElementById('tx-save-new-btn').classList.add('hidden');
  elements.submitBtn.innerText = 'Atualizar';
}

export function closeModal() {
  hideTxSuggest();
  elements.modal.classList.add('hidden');
  elements.form.reset();
  state.editingId = null;
  state.editingType = null;
  elements.submitBtn.innerText = 'Salvar';
}


export async function submitTransaction(event, andNew = false) {
  event.preventDefault();
  const form = elements.form;
  if (!form.reportValidity()) return;
  if (!validateTxAmount()) {
    document.getElementById('tx-valor').focus();
    return;
  }

  const saveNewBtn = document.getElementById('tx-save-new-btn');
  elements.submitBtn.disabled = true;
  saveNewBtn.disabled = true;
  elements.submitBtn.innerHTML = 'Salvando...';

  const formDados = Object.fromEntries(new FormData(form).entries());
  const editing = state.editingId && state.editingType === 'TRANSACTION';
  const base = {
    userId: getCurrentUserId(),
    Tipo: formDados.tipo,
    Data: formDados.dataTransacao,
    Conta: formDados.conta,
    Valor: parseCurrencyMask(formDados.valor),
    Categoria: formDados.categoria,
    Descricao: formDados.descricao || '',
    Observacao: (formDados.observacao || '').trim(),
    Tags: (formDados.tags || '').split(',').map(s => s.trim()).filter(Boolean),
    Ignorar: formDados.ignorar === 'on',
    Efetivado: formDados.efetivado === 'on'
  };
  const repeat = !editing && document.getElementById('tx-repeat').checked
    ? Math.max(2, Math.min(parseInt(formDados.repeticoes) || 2, 60))
    : 1;

  try {
    if (editing) {
      const receiptFields = await persistReceipt(state.editingId, state.txExistingReceipt && state.txExistingReceipt.Id);
      await updateDoc(doc(db, "Transacoes", state.editingId), { ...base, ...receiptFields });
    } else {
      for (let i = 0; i < repeat; i++) {
        const newRef = await addDoc(collection(db, "Transacoes"), {
          ...base,
          Data: i === 0 ? base.Data : txAddMonths(base.Data, i),
          // Parcelas seguintes só nascem efetivadas se a data já passou
          Efetivado: i === 0 ? base.Efetivado : txAddMonths(base.Data, i) <= txLocalISO(),
          Descricao: repeat > 1 ? `${base.Descricao} (${i + 1}/${repeat})`.trim() : base.Descricao
        });
        // Em lançamentos repetidos, o comprovante fica só no primeiro
        if (i === 0) {
          const receiptFields = await persistReceipt(newRef.id, null);
          if (receiptFields) await updateDoc(newRef, receiptFields);
        }
      }
    }

    AppController.showToast(repeat > 1 ? `${repeat} lançamentos criados!` : 'Transação salva com sucesso!', 'success');
    if (andNew && !editing) {
      // Mantém tipo, data, categoria e conta; limpa o restante
      document.getElementById('tx-valor').value = '';
      form.elements.descricao.value = '';
      form.elements.observacao.value = '';
      form.elements.tags.value = '';
      form.elements.ignorar.checked = false;
      document.getElementById('tx-repeat').checked = false;
      toggleTxRepeat();
      resetReceipt();
      document.getElementById("tx-amount-hint").classList.add("hidden");
      document.getElementById('tx-valor').focus();
    } else {
      closeModal();
    }
    loadTransactions();
  } catch (error) {
    AppController.showToast("Erro ao salvar transação: " + error.message, 'error');
  } finally {
    elements.submitBtn.disabled = false;
    saveNewBtn.disabled = false;
    elements.submitBtn.innerText = state.editingId ? 'Atualizar' : 'Salvar';
  }
}

export function describeTx(t) {
  if (!t) return '';
  const name = t.Descricao || t.Categoria || 'Lançamento';
  return `${name} · ${currencyFormatter.format(parseFloat(t.Valor) || 0)}`;
}

export async function deleteTransaction(id) {
  const t = state.transactions.find(x => String(x.ID) === String(id));
  if (!await app.confirmDialog({
    title: 'Excluir transação?',
    message: 'Esta ação não pode ser desfeita.',
    detail: describeTx(t)
  })) return;
  try {
    await deleteReceiptDoc(t);
    await deleteDoc(doc(db, "Transacoes", id));
    loadTransactions();
  } catch (error) {
    AppController.showToast("Erro ao excluir: " + error.message, 'error');
  }
}

// ── Seleção e edição/exclusão em lote ──
const selectedTxs = () => state.transactions.filter(t => state.txSelected.has(String(t.ID)));

function syncTxSelection() {
  const n = state.txSelected.size;
  const bar = document.getElementById('tx-bulk-bar');
  if (bar) bar.classList.toggle('hidden', n === 0);
  const count = document.getElementById('tx-bulk-count');
  if (count) count.innerText = `${n} selecionada${n === 1 ? '' : 's'}`;
  const all = document.getElementById('tx-select-all');
  if (all) {
    const onPage = (state.txPageIds || []).filter(id => state.txSelected.has(id)).length;
    all.checked = onPage > 0 && onPage === state.txPageIds.length;
    all.indeterminate = onPage > 0 && onPage < state.txPageIds.length;
  }
}

export function toggleTxSelect(id, on) {
  if (on) state.txSelected.add(String(id)); else state.txSelected.delete(String(id));
  syncTxSelection();
}

export function toggleTxSelectAll(on) {
  (state.txPageIds || []).forEach(id => { if (on) state.txSelected.add(id); else state.txSelected.delete(id); });
  renderTransactions();
}

export function clearTxSelection() {
  state.txSelected.clear();
  renderTransactions();
}

export function openTxBulkEdit() {
  const list = selectedTxs();
  if (!list.length) return;
  if (list.some(isTransferTransaction)) {
    AppController.showToast('Transferências não podem ser editadas em lote. Desmarque-as ou use Excluir.', 'error');
    return;
  }
  document.getElementById('tx-bulk-title').innerText = `Editar ${list.length} transaç${list.length === 1 ? 'ão' : 'ões'}`;
  document.getElementById('tx-bulk-desc').value = '';

  const cat = document.getElementById('tx-bulk-cat');
  const tipos = new Set(list.map(t => t.Tipo));
  cat.dataset.categoryKind = tipos.size === 1 ? [...tipos][0] : '';
  rebuildCategorySelect(cat);

  const acc = document.getElementById('tx-bulk-account');
  acc.innerHTML = '<option value="" disabled selected>Manter atual</option>' +
    state.accounts.map(a => `<option value="${escapeHTML(a.Nome)}">🏦 ${escapeHTML(a.Nome)}</option>`).join('');
  app.upgradeSelects();

  const dates = new Set(list.map(t => txLocalISO(parseLocalDate(t.Data))));
  const dateInput = document.getElementById('tx-bulk-date');
  const sameDay = dates.size === 1;
  dateInput.value = sameDay ? [...dates][0] : '';
  dateInput.disabled = !sameDay;
  document.getElementById('tx-bulk-date-hint').classList.toggle('hidden', sameDay);

  document.getElementById('tx-bulk-modal').classList.remove('hidden');
}

export function closeTxBulkEdit() {
  document.getElementById('tx-bulk-modal').classList.add('hidden');
}

export async function submitTxBulkEdit(e) {
  e.preventDefault();
  const list = selectedTxs();
  const desc = document.getElementById('tx-bulk-desc').value.trim();
  const cat = document.getElementById('tx-bulk-cat').value;
  const conta = document.getElementById('tx-bulk-account').value;
  const dateInput = document.getElementById('tx-bulk-date');
  const newDate = dateInput.disabled ? '' : dateInput.value;

  const changes = {};
  if (desc) changes.Descricao = desc;
  if (cat) changes.Categoria = cat;
  if (conta) changes.Conta = conta;
  if (newDate && list.length && newDate !== txLocalISO(parseLocalDate(list[0].Data))) changes.Data = newDate;
  if (!Object.keys(changes).length) {
    AppController.showToast('Nenhum campo alterado.', 'error');
    return;
  }

  try {
    await Promise.all(list.map(t => updateDoc(doc(db, "Transacoes", t.ID), changes)));
    closeTxBulkEdit();
    state.txSelected.clear();
    await loadTransactions();
    AppController.showToast(`${list.length} transaç${list.length === 1 ? 'ão atualizada' : 'ões atualizadas'}.`);
  } catch (error) {
    AppController.showToast("Erro ao editar em lote: " + error.message, 'error');
  }
}

export async function deleteTxBulk() {
  const list = selectedTxs();
  if (!list.length) return;
  if (!await app.confirmDialog({
    title: `Excluir ${list.length} transaç${list.length === 1 ? 'ão' : 'ões'}?`,
    message: 'Esta ação não pode ser desfeita.',
    detail: list.slice(0, 5).map(describeTx).join('\n') + (list.length > 5 ? `\n… e mais ${list.length - 5}` : '')
  })) return;
  try {
    await Promise.all(list.map(async t => {
      await deleteReceiptDoc(t);
      await deleteDoc(doc(db, "Transacoes", t.ID));
    }));
    state.txSelected.clear();
    await loadTransactions();
    AppController.showToast(`${list.length} transaç${list.length === 1 ? 'ão excluída' : 'ões excluídas'}.`);
  } catch (error) {
    await loadTransactions();
    AppController.showToast("Erro ao excluir em lote: " + error.message, 'error');
  }
}

// --- DRAWER & BOTTOM SHEET DE TRANSAÇÕES (HUMANIST LEDGER) ---
export function openTxDrawer(id, isCC) {
  let t = state.transactions.find(x => String(x.ID) === String(id));
  let isCreditCard = Boolean(isCC);

  if (!t) {
    t = state.creditTransactions.find(x => String(x.ID) === String(id));
    if (t) isCreditCard = true;
  }
  if (!t) return;

  state.drawerTx = t;
  state.drawerIsCC = isCreditCard;

  const overlay = document.getElementById('tx-drawer-overlay');
  const drawer = document.getElementById('tx-drawer');
  const idInput = document.getElementById('tx-drawer-id');
  const isCcInput = document.getElementById('tx-drawer-is-cc');
  const descInput = document.getElementById('tx-drawer-desc');
  const valInput = document.getElementById('tx-drawer-val');
  const dateInput = document.getElementById('tx-drawer-date');
  const catSelect = document.getElementById('tx-drawer-cat');
  const accSelect = document.getElementById('tx-drawer-account');
  const typeBadge = document.getElementById('tx-drawer-type-badge');
  const heroVal = document.getElementById('tx-drawer-hero-val');
  const heroPills = document.getElementById('tx-drawer-hero-pills');
  const statusDisplay = document.getElementById('tx-drawer-status-display');
  const deleteBtn = document.getElementById('tx-drawer-delete-btn');

  if (!drawer || !overlay) return;

  idInput.value = t.ID || '';
  isCcInput.value = isCreditCard ? 'true' : 'false';
  descInput.value = t.Descricao || '';
  valInput.value = currencyFormatter.format(parseFloat(t.Valor) || 0);

  if (t.Data) {
    const d = parseLocalDate(t.Data);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    dateInput.value = `${yyyy}-${mm}-${dd}`;
  } else {
    dateInput.value = '';
  }

  if (catSelect) {
    catSelect.dataset.categoryKind = t.Tipo === 'RECEITA' ? 'RECEITA' : 'DESPESA';
    rebuildCategorySelect(catSelect);
  }
  setCategorySelectValue(catSelect, t.Categoria || 'Outros');

  // Popular contas
  if (accSelect) {
    accSelect.innerHTML = '';
    if (isCreditCard) {
      const cardObj = state.creditCards.find(c => String(c.ID) === String(t.IdCartao || t.CartaoID));
      const cardName = cardObj ? cardObj.Nome : (t.Conta || 'Cartão de Crédito');
      const opt = document.createElement('option');
      opt.value = cardName;
      opt.innerText = `💳 ${cardName} (Fatura)`;
      opt.selected = true;
      accSelect.appendChild(opt);
      accSelect.disabled = true;
    } else {
      accSelect.disabled = false;
      state.accounts.forEach(acc => {
        const opt = document.createElement('option');
        opt.value = acc.Nome;
        opt.innerText = `🏦 ${acc.Nome}`;
        if (acc.Nome === t.Conta) opt.selected = true;
        accSelect.appendChild(opt);
      });
      if (!state.accounts.some(acc => acc.Nome === t.Conta)) {
        const opt = document.createElement('option');
        opt.value = t.Conta || 'Outra';
        opt.innerText = t.Conta || 'Outra';
        opt.selected = true;
        accSelect.appendChild(opt);
      }
    }
  }

  // Hero do Valor e Badges
  const isExp = t.Tipo === 'DESPESA';
  const isTransf = isTransferTransaction(t);
  let colorClass = isTransf ? 'text-blue' : (isExp ? 'text-red' : 'text-green');
  let signPrefix = isTransf ? '⇄ ' : (isExp ? '- ' : '+ ');

  if (heroVal) {
    heroVal.innerText = `${signPrefix}${currencyFormatter.format(parseFloat(t.Valor) || 0)}`;
    heroVal.className = `tx-drawer-amount ${colorClass}`;
  }

  if (typeBadge) {
    let badgeText = isCreditCard ? 'CARTÃO' : (isTransf ? 'TRANSFERÊNCIA' : (isExp ? 'DESPESA' : 'RECEITA'));
    let badgeClass = isCreditCard ? 'badge-cartao' : (isTransf ? 'badge-transferencia' : (isExp ? 'badge-despesa' : 'badge-receita'));
    typeBadge.innerText = badgeText;
    typeBadge.className = `tx-drawer-badge ${badgeClass}`;
  }

  const tDate = parseLocalDate(t.Data);
  const today = new Date();
  today.setHours(23, 59, 59, 999);
  const isPending = isCreditCard ? (t.Status !== 'Pago') : (!isTransf && !isSettled(t));

  if (heroPills) {
    heroPills.innerHTML = `
      <span class="goal-pill ${isPending ? 'goal-pill-warning' : 'goal-pill-success'}">
        <i class="fas ${isPending ? 'fa-hourglass-half' : 'fa-check'}"></i>
        ${isPending ? 'Agendado / Pendente' : 'Efetivado'}
      </span>
      <span class="goal-pill goal-pill-neutral">
        <i class="fas fa-calendar-alt"></i> ${formatDateBR(t.Data)}
      </span>
    `;
  }

  if (statusDisplay) {
    statusDisplay.innerHTML = isPending
      ? `<i class="fas fa-hourglass-half" style="color: #d97706;"></i> Agendado / A liquidar`
      : `<i class="fas fa-check-circle" style="color: #059669;"></i> Lançamento Efetivado`;
  }

  const statusBtn = document.getElementById('tx-drawer-status-btn');
  if (statusBtn) {
    statusBtn.classList.toggle('hidden', isCreditCard || isTransf);
    statusBtn.innerText = isPending ? 'Marcar como efetivado' : 'Marcar como agendado';
  }

  renderDrawerReceipt();

  overlay.classList.add('open');
  drawer.classList.add('open');
  document.body.style.overflow = 'hidden';
}

export async function toggleTxStatus(id) {
  const t = state.transactions.find(x => String(x.ID) === String(id || (state.drawerTx && state.drawerTx.ID)));
  if (!t) return;
  const next = !isSettled(t);
  try {
    await updateDoc(doc(db, "Transacoes", t.ID), { Efetivado: next });
    closeTxDrawer();
    AppController.showToast(next ? 'Marcada como efetivada.' : 'Marcada como agendada.', 'success');
    loadTransactions();
  } catch (error) {
    AppController.showToast("Erro ao atualizar situação: " + error.message, 'error');
  }
}

export function closeTxDrawer() {
  const overlay = document.getElementById('tx-drawer-overlay');
  const drawer = document.getElementById('tx-drawer');
  if (overlay) overlay.classList.remove('open');
  if (drawer) drawer.classList.remove('open');
  document.body.style.overflow = '';
  state.drawerTx = null;
  state.drawerIsCC = false;
}

export async function submitTxDrawer(event) {
  event.preventDefault();
  const saveBtn = document.getElementById('tx-drawer-save-btn');
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Salvando...';
  }

  const form = document.getElementById('tx-drawer-form');
  const formDados = Object.fromEntries(new FormData(form).entries());
  const id = formDados.id;
  const isCreditCard = formDados.isCreditCard === 'true';

  try {
    if (isCreditCard) {
      const payloadCC = {
        Descricao: formDados.descricao,
        Valor: parseCurrencyMask(formDados.valor),
        Data: formDados.data,
        Categoria: formDados.categoria
      };
      await updateDoc(doc(db, "TransacoesCartao", id), payloadCC);
      loadCreditTransactions();
      setTimeout(() => { if (typeof renderInvoiceItems === 'function') renderInvoiceItems(); }, 300);
    } else {
      const tOriginal = state.transactions.find(x => String(x.ID) === String(id));
      const payload = {
        Tipo: tOriginal ? tOriginal.Tipo : 'DESPESA',
        Descricao: formDados.descricao || '',
        Valor: parseCurrencyMask(formDados.valor),
        Data: formDados.data,
        Categoria: formDados.categoria,
        Conta: formDados.conta
      };
      await updateDoc(doc(db, "Transacoes", id), payload);
      loadTransactions();
    }
    closeTxDrawer();
    app.showToast('Transação atualizada com sucesso!', 'success');
  } catch (err) {
    app.showToast('Erro ao atualizar: ' + err.message, 'error');
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.innerText = 'Salvar Alterações';
    }
  }
}

export async function deleteTxFromDrawer() {
  if (!state.drawerTx) return;
  const id = state.drawerTx.ID;
  const isCC = state.drawerIsCC;

  if (!await app.confirmDialog({
    title: 'Excluir transação?',
    message: 'Esta ação não pode ser desfeita.',
    detail: describeTx(state.drawerTx)
  })) return;

  try {
    if (isCC) {
      await deleteDoc(doc(db, "TransacoesCartao", id));
      loadCreditTransactions();
      setTimeout(() => { if (typeof renderInvoiceItems === 'function') renderInvoiceItems(); }, 300);
    } else {
      await deleteReceiptDoc(state.drawerTx);
      await deleteDoc(doc(db, "Transacoes", id));
      loadTransactions();
    }
    closeTxDrawer();
    app.showToast('Transação excluída com sucesso!', 'success');
  } catch (err) {
    app.showToast('Erro ao excluir: ' + err.message, 'error');
  }
}
