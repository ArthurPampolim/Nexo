import { db, auth } from './firebase.js';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { parseLocalDate } from './finance.js';

// ── Estado compartilhado entre as telas ──
export const state = {
  accounts: [], creditCards: [], creditTransactions: [],
  transactions: [], goals: [], fixedCosts: [], planning: [],
  editingId: null, editingType: null, currentTab: 'dashboard',
  txFilter: 'ALL'
};

export const OWNED_COLLECTIONS = ["Transacoes", "Contas", "Cartoes", "TransacoesCartao", "Objetivos", "AportesObjetivo", "CustosFixos", "Planejamento", "Categorias", "Eventos", "Comprovantes"];

export const currencyFormatter = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

// ── Utilitários ──
export function escapeHTML(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function formatDateBR(dateInput) {
  if (!dateInput) return '';
  const d = parseLocalDate(dateInput);
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  return `${day}/${month}/${d.getFullYear()}`;
}

export function balanceClass(bal) {
  if (bal < 0) return 'text-red';
  return bal === 0 ? 'text-zero' : 'text-green';
}

// ── Firestore do usuário logado ──
export function getCurrentUserId() {
  return auth.currentUser ? auth.currentUser.uid : null;
}

export async function fetchUserScopedDocs(collectionName) {
  const uid = getCurrentUserId();
  if (!uid) return [];

  // Somente documentos do próprio usuário: nunca baixa a coleção inteira
  try {
    const snap = await getDocs(query(collection(db, collectionName), where("userId", "==", uid)));
    return snap.docs.map(d => ({ ID: d.id, ...d.data() }));
  } catch (err) {
    console.warn(`Erro ao ler ${collectionName}:`, err);
    return [];
  }
}

// ── Bloqueio de rolagem da página com modal aberto ──
const MODAL_SELECTOR = '.modal-overlay:not(.hidden), .confirm-overlay, .dp-overlay, .receipt-overlay';

function syncScrollLock() {
  const root = document.documentElement;
  const shouldLock = Boolean(document.querySelector(MODAL_SELECTOR));
  if (shouldLock === root.classList.contains('modal-open')) return;

  if (shouldLock) {
    // Compensa a largura da barra de rolagem para a página não "pular"
    const gap = window.innerWidth - root.clientWidth;
    if (gap > 0) root.style.paddingRight = `${gap}px`;
    root.classList.add('modal-open');
  } else {
    root.classList.remove('modal-open');
    root.style.paddingRight = '';
  }
}

new MutationObserver(syncScrollLock).observe(document.body, {
  subtree: true, childList: true, attributes: true, attributeFilter: ['class']
});

// ── Elementos da página ──
export const elements = {
  totalBalance: document.getElementById('total-balance'), totalIncome: document.getElementById('total-income'), totalExpense: document.getElementById('total-expense'), totalCreditCard: document.getElementById('total-credit-card'),
  transactionsContainer: document.getElementById('transactions-container'), modal: document.getElementById('transaction-modal'), form: document.getElementById('transaction-form'), submitBtn: document.getElementById('submit-btn'), accountSelect: document.getElementById('conta'),
  accountModal: document.getElementById('account-modal'), accountForm: document.getElementById('account-form'), submitAccountBtn: document.getElementById('submit-acc-btn'),
  goalsContainer: document.getElementById('goals-container'), goalModal: document.getElementById('goal-modal'), goalForm: document.getElementById('goal-form'), submitGoalBtn: document.getElementById('submit-goal-btn'),
  fixedCostsContainer: document.getElementById('fixed-costs-container'), fixedCostModal: document.getElementById('fixed-cost-modal'), fixedCostForm: document.getElementById('fixed-cost-form'), submitFixedCostBtn: document.getElementById('submit-fc-btn'),
  ccModal: document.getElementById('cc-modal'), ccForm: document.getElementById('cc-form'), submitCCBtn: document.getElementById('submit-cc-btn'), ccTransModal: document.getElementById('cc-trans-modal'), ccTransForm: document.getElementById('cc-trans-form'), submitCCTransBtn: document.getElementById('submit-cct-btn'), cctCartaoSelect: document.getElementById('cct-cartao')
};

// Transações marcadas como "Ignorar" não entram em totais, saldos, gráficos nem planejamento
export const activeTransactions = () => state.transactions.filter(t => !t.Ignorar);

// ── Seletor de mês ──
export const monthPickerState = {
  viewYear: new Date().getFullYear(),
  selectedYear: new Date().getFullYear(),
  selectedMonth: new Date().getMonth() + 1 // 1-12
};

export const monthLabels = [
  { number: 1, label: 'JAN', full: 'Janeiro' },
  { number: 2, label: 'FEV', full: 'Fevereiro' },
  { number: 3, label: 'MAR', full: 'Março' },
  { number: 4, label: 'ABR', full: 'Abril' },
  { number: 5, label: 'MAI', full: 'Maio' },
  { number: 6, label: 'JUN', full: 'Junho' },
  { number: 7, label: 'JUL', full: 'Julho' },
  { number: 8, label: 'AGO', full: 'Agosto' },
  { number: 9, label: 'SET', full: 'Setembro' },
  { number: 10, label: 'OUT', full: 'Outubro' },
  { number: 11, label: 'NOV', full: 'Novembro' },
  { number: 12, label: 'DEZ', full: 'Dezembro' }
];
