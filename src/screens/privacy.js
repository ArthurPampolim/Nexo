import { db, auth } from '../firebase.js';
import { doc, deleteDoc, getDoc } from 'firebase/firestore';
import { deleteUser, signOut } from 'firebase/auth';
import { OWNED_COLLECTIONS, fetchUserScopedDocs, getCurrentUserId } from '../core.js';
import { app } from '../app.js';
import { openDatePicker, downloadFile } from './transactions.js';

// ── Constantes ──
const CONFIRM_WORD = 'deletar';
const RECENT_LOGIN_MS = 5 * 60 * 1000; // limite do Firebase para apagar a conta sem novo login
const DATED_COLLECTIONS = ['Transacoes', 'TransacoesCartao', 'AportesObjetivo'];
// Comprovantes guarda imagens em base64: ficam fora da exportação
const EXPORT_COLLECTIONS = OWNED_COLLECTIONS.filter(n => n !== 'Comprovantes');

// ── Modais ──
const modal = (id) => document.getElementById(id);

function resetConfirmField(inputId, btnId) {
  modal(inputId).value = '';
  modal(btnId).disabled = true;
}

export function checkPrivacyConfirm(inputId, btnId) {
  modal(btnId).disabled = modal(inputId).value.trim().toLowerCase() !== CONFIRM_WORD;
}

export function openPrivacyModal(kind) {
  if (kind === 'reset') resetConfirmField('privacy-reset-input', 'privacy-reset-btn');
  if (kind === 'delete') resetConfirmField('privacy-delete-input', 'privacy-delete-btn');
  if (kind === 'export') {
    const now = new Date();
    setExportDate('from', new Date(now.getFullYear(), now.getMonth(), 1));
    setExportDate('to', new Date(now.getFullYear(), now.getMonth() + 1, 0));
  }
  modal(`privacy-${kind}-modal`).classList.remove('hidden');
}

export function closePrivacyModal(kind) {
  modal(`privacy-${kind}-modal`).classList.add('hidden');
}

// ── Remoção de dados ──
async function wipeUserData() {
  for (const name of OWNED_COLLECTIONS) {
    const docs = await fetchUserScopedDocs(name);
    await Promise.all(docs.map(d => deleteDoc(doc(db, name, d.ID))));
  }
}

export async function submitPrivacyReset(event) {
  event.preventDefault();
  const btn = modal('privacy-reset-btn');
  btn.disabled = true;
  btn.innerText = 'APAGANDO...';
  try {
    await wipeUserData();
    app.showToast('Dados apagados. Sua conta foi reiniciada.', 'success');
    setTimeout(() => location.reload(), 900);
  } catch (error) {
    app.showToast('Erro ao reiniciar a conta: ' + error.message, 'error');
    btn.innerText = 'APAGAR TODOS OS DADOS E COMEÇAR DO ZERO';
    btn.disabled = false;
  }
}

export async function submitPrivacyDelete(event) {
  event.preventDefault();
  const user = auth.currentUser;
  if (!user) return;

  // Antes de apagar qualquer coisa: sem login recente o Firebase recusaria apagar a conta e os dados ficariam órfãos
  if (Date.now() - new Date(user.metadata.lastSignInTime).getTime() > RECENT_LOGIN_MS) {
    app.showToast('Por segurança, entre novamente na sua conta e repita a exclusão.', 'error');
    await signOut(auth);
    return;
  }

  const btn = modal('privacy-delete-btn');
  btn.disabled = true;
  btn.innerText = 'EXCLUINDO...';
  try {
    await wipeUserData();
    await deleteDoc(doc(db, 'Usuarios', getCurrentUserId()));
    await deleteUser(user);
    app.showToast('Cadastro excluído.', 'success');
  } catch (error) {
    app.showToast('Erro ao excluir o cadastro: ' + error.message, 'error');
    btn.innerText = 'EXCLUIR CONTA';
    btn.disabled = false;
  }
}

// ── Exportação ──
function setExportDate(which, date) {
  const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  modal(`privacy-export-${which}`).value = iso;
  modal(`privacy-export-${which}-btn`).innerText = date
    .toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' }).replace(/ de /g, ' ');
}

export function pickPrivacyExportDate(which) {
  openDatePicker(modal(`privacy-export-${which}`).value, (iso) => {
    const [y, m, d] = iso.split('-').map(Number);
    setExportDate(which, new Date(y, m - 1, d));
  });
}

export async function submitPrivacyExport(event) {
  event.preventDefault();
  const from = modal('privacy-export-from').value;
  const to = modal('privacy-export-to').value;
  if (!from || !to || from > to) return app.showToast('Escolha um período válido.', 'error');

  const btn = modal('privacy-export-btn');
  btn.disabled = true;
  btn.innerText = 'EXPORTANDO...';
  try {
    const dados = { periodo: { de: from, ate: to } };
    for (const name of EXPORT_COLLECTIONS) {
      let docs = await fetchUserScopedDocs(name);
      if (DATED_COLLECTIONS.includes(name)) {
        docs = docs.filter(d => { const dia = String(d.Data || '').slice(0, 10); return dia >= from && dia <= to; });
      }
      dados[name] = docs.map(({ userId, ...resto }) => resto);
    }
    const perfil = await getDoc(doc(db, 'Usuarios', getCurrentUserId()));
    dados.Usuario = perfil.exists() ? perfil.data() : {};

    downloadFile(`nexo-dados-${from}_a_${to}.json`, 'application/json', JSON.stringify(dados, null, 2));
    closePrivacyModal('export');
  } catch (error) {
    app.showToast('Erro ao exportar: ' + error.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerText = 'EXPORTAR DADOS';
  }
}
