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
