import { collection, getDocs, addDoc, updateDoc, deleteDoc, doc, setDoc, getDoc, query, where } from 'firebase/firestore';
import { db, auth } from './firebase.js';
import { signInWithEmailAndPassword, onAuthStateChanged, signOut, createUserWithEmailAndPassword, sendPasswordResetEmail, sendEmailVerification, updatePassword } from "firebase/auth";
import { isSettled, settledTotals, isTransferTransaction, parseLocalDate } from './finance.js';
import { state, monthPickerState, monthLabels, elements, activeTransactions, OWNED_COLLECTIONS, currencyFormatter, escapeHTML, getCurrentUserId } from './core.js';
import { app } from './app.js';
import { closeCategoryModal, deleteCategory, loadCategories, onCategoryParentChange, openCategoryModal, pickCategoryColor, pickCategoryIcon, populateCategorySelects, renderCategoriesPage, renderIconGrid, setCategoryFormKind, setCategoryKind, submitCategory, updateCategoryPreview } from './screens/categories.js';
import { calNext, calPrev, calToday, closeEventModal, deleteEventFromModal, loadEvents, openEventModal, renderCalendar, setEventType, submitEvent, toggleEventAllDay } from './screens/calendar.js';
import { closeAccountModal, closeTransferModal, loadAccounts, openAccountModal, openTransferModal, renderAccountsPage, submitAccount, submitTransfer } from './screens/accounts.js';
import { calculateInvoiceSum, closeCCDrawer, closeCCInvoiceModal, closeCCModal, closeCCTransModal, deleteCreditTransaction, loadCreditData, openCCInvoiceModal, openCCModal, openCCTransModal, renderCreditCardsPage, submitCC, submitCCTrans } from './screens/cards.js';
import { closeFCEditScopeModal, closeFCPayModal, closeFixedCostModal, closePayInvoiceModal, deleteFixedCost, editFixedCost, loadFixedCosts, markFixedCostPaid, openFixedCostModal, openPayInvoiceModal, proceedEditFixedCost, renderFixedCosts, renderFixedCostsPage, submitFixedCost, submitFixedCostPay, submitPayInvoice, unmarkFixedCostPaid } from './screens/fixedCosts.js';
import { closeGoalDepositModal, closeGoalDetails, closeGoalModal, deleteCurrentGoal, deleteGoalDeposit, editGoalDeposit, editGoalFromDetails, loadGoals, markGoalAsCompleted, openCurrentGoalDepositModal, openCurrentGoalWithdrawModal, openGoalDetails, openGoalForm, openGoalTypeModal, renderGoalsPage, setGoalsSortOrder, submitGoal, submitGoalDeposit, switchGoalsTab, toggleGoalOptions, toggleGoalsSortDropdown } from './screens/goals.js';
import { calculateWizardBudget, calculateWizardCategoryTotals, cancelPlanningWizard, copyPreviousPlanning, finishPlanningWizard, loadPlanning, nextWizardStep, prevWizardStep, renderPlanningView, selectCardPreference, startPlanningWizard } from './screens/planning.js';
import { clearReceipt, clearTxSelection, closeTxBulkEdit, deleteTxBulk, openTxBulkEdit, submitTxBulkEdit, toggleTxSelect, toggleTxSelectAll, closeModal, closeTxDrawer, deleteTransaction, deleteTxFromDrawer, describeTx, exportTransactionsCSV, exportTransactionsPDF, handleDrawerReceipt, handleReceiptFile, loadTransactions, openModal, openTxDatePicker, openTxDrawer, renderTransactions, setTxDateShortcut, setTxType, submitTransaction, submitTxDrawer, toggleTxDetails, toggleTxRepeat, toggleTxStatus, validateTxAmount } from './screens/transactions.js';


const AppController = (function () {
  // VARIÁVEL PARA O GRÁFICO
  let expensesChartInstance = null;

  /**
   * Migração única: vincula à conta atual os documentos antigos que não têm userId.
   * Rode apenas logado na conta dona dos dados antigos: AppController.claimLegacyData()
   */
  async function claimLegacyData() {
    const uid = getCurrentUserId();
    if (!uid) return;
    if (!await confirmDialog({
      title: 'Vincular dados antigos a esta conta?',
      message: `Todos os registros sem dono passarão a pertencer a ${auth.currentUser.email}. Faça isso só na conta que criou esses dados.`,
      confirmLabel: 'Vincular',
      danger: false
    })) return;

    let total = 0;
    for (const name of OWNED_COLLECTIONS) {
      try {
        const snap = await getDocs(collection(db, name));
        const orphans = snap.docs.filter(d => !d.data().userId);
        await Promise.all(orphans.map(d => updateDoc(doc(db, name, d.id), { userId: uid })));
        total += orphans.length;
      } catch (err) {
        console.warn(`Migração de ${name} falhou:`, err);
      }
    }
    showToast(`${total} registro(s) vinculados à sua conta.`, 'success');
    init();
  }


  state.txSortCol = 'Data';
  state.txSortDir = 'desc';


  function setTransactionFilter(filterType) {
    state.txFilter = filterType;
    ['ALL', 'DESPESA', 'RECEITA', 'TRANSFERENCIA'].forEach(type => {
      const btn = document.getElementById(`tx-filter-${type}`);
      if (btn) {
        if (type === filterType) btn.classList.add('active');
        else btn.classList.remove('active');
      }
    });
    renderTransactions();
  }


  // ── Indicador deslizante das abas ──
  let tabIndicatorTimer = null;

  function moveTabIndicator(animate = true) {
    const ind = document.getElementById('tab-indicator');
    const btn = document.getElementById(`tab-btn-${state.currentTab}`);
    if (!ind || !btn || btn.offsetParent === null) return;

    const horizontal = window.matchMedia('(max-width: 768px)').matches;
    const posProp = horizontal ? 'left' : 'top';
    const sizeProp = horizontal ? 'width' : 'height';
    const newPos = horizontal ? btn.offsetLeft : btn.offsetTop;
    const newSize = horizontal ? btn.offsetWidth : btn.offsetHeight;

    clearTimeout(tabIndicatorTimer);
    const first = !ind.classList.contains('ready');
    if (first || !animate || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      ind.classList.add('no-anim');
      ind.style[posProp] = `${newPos}px`;
      ind.style[sizeProp] = `${newSize}px`;
      void ind.offsetWidth;
      ind.classList.remove('no-anim');
      ind.classList.add('ready');
      return;
    }

    // Estica até cobrir origem e destino, depois encolhe no destino
    const oldPos = parseFloat(ind.style[posProp]) || 0;
    const oldSize = parseFloat(ind.style[sizeProp]) || 0;
    const start = Math.min(oldPos, newPos);
    const end = Math.max(oldPos + oldSize, newPos + newSize);
    ind.style[posProp] = `${start}px`;
    ind.style[sizeProp] = `${end - start}px`;
    tabIndicatorTimer = setTimeout(() => {
      ind.style[posProp] = `${newPos}px`;
      ind.style[sizeProp] = `${newSize}px`;
    }, 240);
  }

  window.addEventListener('resize', () => moveTabIndicator(false));

  function switchTab(tabName) {
    if (state.currentTab === 'transactions' && tabName !== 'transactions') {
      state.txSortCol = 'Data';
      state.txSortDir = 'desc';
    }
    state.currentTab = tabName;
    ['dashboard', 'transactions', 'credit-cards', 'fixed-costs', 'goals', 'accounts', 'planning', 'calendar', 'categories', 'settings'].forEach(t => {
      const btn = document.getElementById(`tab-btn-${t}`);
      const view = document.getElementById(`view-${t}`);
      if (btn) {
        if (t === tabName) btn.classList.add('active');
        else btn.classList.remove('active');
      }
      if (view) {
        if (t === tabName) view.classList.remove('hidden');
        else view.classList.add('hidden');
      }
    });

    moveTabIndicator();
    if (tabName === 'goals') requestAnimationFrame(() => moveGoalsPill(false));
    if (tabName === 'settings') requestAnimationFrame(() => moveSegPill('set-seg', false));

    if (tabName === 'dashboard') renderDashboardInsights();
    if (tabName === 'credit-cards') renderCreditCardsPage();
    if (tabName === 'fixed-costs') renderFixedCostsPage();
    if (tabName === 'goals') renderGoalsPage();
    if (tabName === 'accounts') renderAccountsPage();
    if (tabName === 'planning') renderPlanningView();
    if (tabName === 'calendar') renderCalendar(true);
    if (tabName === 'categories') {
      renderCategoriesPage(true);
      requestAnimationFrame(() => moveSegPill('cat-seg', false));
    }
  }

  // 2. SELETOR DE MÊS / ANO (MONTH PICKER)
  function getSelectedYYYYMM() {
    const mStr = String(monthPickerState.selectedMonth).padStart(2, '0');
    return `${monthPickerState.selectedYear}-${mStr}`;
  }

  function updateTriggerLabel() {
    const labelEl = document.getElementById('selected-month-label');
    if (!labelEl) return;
    const mObj = monthLabels.find(m => m.number === monthPickerState.selectedMonth);
    const mName = mObj ? mObj.full : '';
    labelEl.innerText = `${mName} ${monthPickerState.selectedYear}`;
  }

  function openMonthPicker() {
    monthPickerState.viewYear = monthPickerState.selectedYear;
    renderMonthGrid();
    document.getElementById('month-picker-modal').classList.remove('hidden');
  }

  function closeMonthPicker() {
    document.getElementById('month-picker-modal').classList.add('hidden');
  }

  function changePickerYear(delta) {
    monthPickerState.viewYear += delta;
    renderMonthGrid();
  }

  function renderMonthGrid() {
    const yearDisplay = document.getElementById('picker-year-display');
    const gridContainer = document.getElementById('month-grid-container');
    if (yearDisplay) yearDisplay.innerText = monthPickerState.viewYear;
    if (!gridContainer) return;

    gridContainer.innerHTML = '';
    monthLabels.forEach(m => {
      const isSelected = (monthPickerState.viewYear === monthPickerState.selectedYear && m.number === monthPickerState.selectedMonth);
      const cell = document.createElement('div');
      cell.className = `month-cell ${isSelected ? 'selected' : ''}`;
      cell.innerText = m.label;
      cell.onclick = () => selectMonth(m.number);
      gridContainer.appendChild(cell);
    });
  }

  function selectMonth(monthNumber) {
    monthPickerState.selectedYear = monthPickerState.viewYear;
    monthPickerState.selectedMonth = monthNumber;
    updateTriggerLabel();
    closeMonthPicker();
    calculateInvoiceSum();
    renderTransactions();
    renderFixedCosts(state.fixedCosts);
    renderCreditCardsPage();
    renderAccountsPage();
    renderPlanningView();
  }

  function selectCurrentMonth() {
    const now = new Date();
    monthPickerState.viewYear = now.getFullYear();
    monthPickerState.selectedYear = now.getFullYear();
    monthPickerState.selectedMonth = now.getMonth() + 1;
    updateTriggerLabel();
    closeMonthPicker();
    calculateInvoiceSum();
    renderTransactions();
    renderFixedCosts(state.fixedCosts);
    renderCreditCardsPage();
    renderAccountsPage();
    renderPlanningView();
  }

  // Sincroniza selects nativos com a interface do Choices.js
  function upgradeSelects() {
    const config = { searchEnabled: false, itemSelectText: '', shouldSort: false };
    document.querySelectorAll('select:not(.no-choices)').forEach(selectEl => {
      if (selectEl.choicesInstance) selectEl.choicesInstance.destroy();
      selectEl.choicesInstance = new Choices(selectEl, config);
    });
    syncThemeSelectors(localStorage.getItem('nexo_theme') === 'dark' ? 'dark' : 'light');
  }
  function init() {
    try {
      loadTheme();
      populateCategorySelects();
      loadCategories();
      loadAccounts();
      loadTransactions();
      loadGoals();
      loadFixedCosts();
      loadCreditData();
      loadPlanning();
      loadEvents();
    } catch (e) {
      console.error("Erro na inicialização:", e);
    }
  }

  // Monitor de Sessão: Tranca ou destranca a tela
  function entrarNoSistema() {
    // Esconde o Login e MOSTRA o Sistema
    document.getElementById('verify-email-view').style.display = 'none';
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('app-container').style.display = 'block';
    requestAnimationFrame(() => moveTabIndicator(false));

    definirMesAtual();
    init();
    loadUserProfile();
  }

  function mostrarAvisoVerificacao(texto, cor) {
    const msg = document.getElementById('verify-msg');
    msg.innerText = texto;
    msg.style.color = cor;
    msg.style.display = 'block';
  }

  onAuthStateChanged(auth, (user) => {
    if (user && !user.emailVerified) {
      // shortcut: bloqueio só na tela; para valer no servidor, exigir request.auth.token.email_verified em firestore.rules
      document.getElementById('login-screen').style.display = 'grid';
      document.getElementById('app-container').style.display = 'none';
      ['login-view', 'register-view', 'forgot-pass-view'].forEach(id => { document.getElementById(id).style.display = 'none'; });
      document.getElementById('verify-email-address').innerText = user.email;
      document.getElementById('verify-msg').style.display = 'none';
      document.getElementById('verify-email-view').style.display = 'block';
    } else if (user) {
      entrarNoSistema();
    } else {
      document.getElementById('verify-email-view').style.display = 'none';
      // Descarta os dados do usuário anterior da memória
      Object.assign(state, {
        accounts: [], creditCards: [], creditTransactions: [], transactions: [],
        goals: [], fixedCosts: [], planning: [], events: []
      });

      // Mostra o Login e ESCONDE o Sistema
      document.getElementById('login-screen').style.display = 'grid';
      document.getElementById('app-container').style.display = 'none';
      document.getElementById('login-view').style.display = 'block';
      const regView = document.getElementById('register-view');
      if (regView) regView.style.display = 'none';
      const forgotView = document.getElementById('forgot-pass-view');
      if (forgotView) forgotView.style.display = 'none';
    }
  });

  // Evento do formulário de Login
  // Sistema de Bloqueio Client-Side & Detecção de Rate-Limit
  function verificarBloqueio() {
    const bloqueioAte = localStorage.getItem('nexo_lockout');
    if (bloqueioAte && Date.now() < parseInt(bloqueioAte)) {
      const minutosRestantes = Math.ceil((parseInt(bloqueioAte) - Date.now()) / 60000);
      return `Sistema temporariamente bloqueado. Tente novamente em ${minutosRestantes} minuto(s).`;
    }
    return null;
  }

  function registrarFalhaLogin() {
    let tentativas = parseInt(localStorage.getItem('nexo_tentativas') || '0');
    tentativas++;
    localStorage.setItem('nexo_tentativas', tentativas);

    if (tentativas >= 3) {
      let tempoPenalidade = 1; // 3 tentativas = 1 min
      if (tentativas === 4) tempoPenalidade = 5; // 4 tentativas = 5 min
      if (tentativas >= 5) tempoPenalidade = 10; // 5+ tentativas = 10 min

      const bloqueioTempo = Date.now() + (tempoPenalidade * 60000);
      localStorage.setItem('nexo_lockout', bloqueioTempo);
      return `Muitas falhas consecutivas. Bloqueado por ${tempoPenalidade} minuto(s).`;
    }
    return `Credenciais incorretas. Tentativa ${tentativas} de 3 antes do bloqueio temporário.`;
  }

  // Ação do Botão Entrar
  document.getElementById('login-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('login-email').value;
    const pass = document.getElementById('login-password').value;
    const btn = document.getElementById('login-btn');
    const errorMsg = document.getElementById('login-error');

    const avisoBloqueio = verificarBloqueio();
    if (avisoBloqueio) {
      errorMsg.innerText = avisoBloqueio;
      errorMsg.style.display = 'block';
      return;
    }

    try {
      btn.disabled = true;
      btn.innerText = 'Autenticando...';
      errorMsg.style.display = 'none';

      await signInWithEmailAndPassword(auth, email, pass);

      // Login com sucesso: limpa o histórico de falhas
      localStorage.removeItem('nexo_tentativas');
      localStorage.removeItem('nexo_lockout');
      btn.disabled = false;
      btn.innerText = 'Entrar';
      document.getElementById('login-form').reset();
    } catch (error) {
      console.error("Erro de autenticação:", error);

      if (error.code === 'auth/too-many-requests') {
        const bloqueioTempo = Date.now() + (15 * 60000);
        localStorage.setItem('nexo_lockout', bloqueioTempo);
        errorMsg.innerText = "Acesso temporariamente suspenso pela segurança por excesso de tentativas. Tente novamente mais tarde ou redefina sua senha.";
      } else if (error.code === 'auth/wrong-password' || error.code === 'auth/user-not-found' || error.code === 'auth/invalid-credential') {
        errorMsg.innerText = registrarFalhaLogin();
      } else {
        errorMsg.innerText = "Falha no login: " + error.code;
      }

      errorMsg.style.display = 'block';
      btn.disabled = false;
      btn.innerText = 'Entrar';
    }
  });

  // Toggle de Visibilidade da Senha (SVG nativo)
  const eyeOpenSvg = '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z"/><circle cx="12" cy="12" r="3"/>';
  const eyeSlashSvg = '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>';

  function setupPasswordToggle(btnId, inputId, iconId) {
    const btn = document.getElementById(btnId);
    const input = document.getElementById(inputId);
    const icon = document.getElementById(iconId);
    if (!btn || !input || !icon) return;

    btn.addEventListener('click', () => {
      const isPassword = input.getAttribute('type') === 'password';
      input.setAttribute('type', isPassword ? 'text' : 'password');
      btn.setAttribute('aria-label', isPassword ? 'Ocultar senha' : 'Mostrar senha');
      icon.innerHTML = isPassword ? eyeSlashSvg : eyeOpenSvg;
    });
  }

  setupPasswordToggle('toggle-password-btn', 'login-password', 'eye-icon');
  setupPasswordToggle('toggle-reg-password-btn', 'reg-password', 'reg-eye-icon');
  setupPasswordToggle('toggle-reg-confirm-password-btn', 'reg-confirm-password', 'reg-confirm-eye-icon');

  // Alternar entre as telas de Login e Cadastro
  document.getElementById('show-register-btn')?.addEventListener('click', (e) => {
    e.preventDefault();
    document.getElementById('login-view').style.display = 'none';
    document.getElementById('register-view').style.display = 'block';
  });

  document.getElementById('back-to-login-btn')?.addEventListener('click', () => {
    document.getElementById('register-view').style.display = 'none';
    document.getElementById('login-view').style.display = 'block';
  });

  // Processamento e Validação do Cadastro
  document.getElementById('register-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();

    const nome = document.getElementById('reg-nome').value;
    const sobrenome = document.getElementById('reg-sobrenome').value;
    const nascimento = document.getElementById('reg-nascimento').value;
    const email = document.getElementById('reg-email').value;
    const pass = document.getElementById('reg-password').value;
    const confirmPass = document.getElementById('reg-confirm-password').value;
    const errorMsg = document.getElementById('register-error');
    const btn = document.getElementById('submit-register-btn');

    // 1. Validação de Confirmação de Senha
    if (pass !== confirmPass) {
      errorMsg.innerText = "Erro: As senhas não coincidem.";
      errorMsg.style.display = 'block';
      return;
    }

    // 2. Validação de Força da Senha (Maiúscula, Minúscula, Número e Símbolo)
    const regexSenha = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[\W_]).{6,}$/;
    if (!regexSenha.test(pass)) {
      errorMsg.innerText = "Sua senha deve conter pelo menos uma letra maiúscula, uma minúscula, um número e um símbolo.";
      errorMsg.style.display = 'block';
      return;
    }

    try {
      btn.disabled = true;
      btn.innerText = 'Processando...';
      errorMsg.style.display = 'none';

      // Cria a conta no Firebase
      const credential = await createUserWithEmailAndPassword(auth, email, pass);

      // Salva o cadastro do novo usuário para o nome aparecer no sistema
      await setDoc(doc(db, "Usuarios", credential.user.uid), {
        nome: `${nome} ${sobrenome}`.trim(),
        apelido: nome,
        nascimento
      }, { merge: true });

      // Se o envio falhar, a tela de confirmação tem o botão de reenviar
      await sendEmailVerification(credential.user).catch(() => undefined);
      AppController.showToast(`Conta criada, ${nome}! Confirme seu e-mail para entrar.`, 'success');
    } catch (error) {
      errorMsg.innerText = "Erro ao criar conta: " + error.message;
      errorMsg.style.display = 'block';
    } finally {
      btn.disabled = false;
      btn.innerText = 'Confirmar Cadastro';
    }
  });

  // --- CONFIRMAÇÃO DE E-MAIL ---
  document.getElementById('verify-check-btn')?.addEventListener('click', async () => {
    try {
      await auth.currentUser.reload();
      if (auth.currentUser.emailVerified) entrarNoSistema();
      else mostrarAvisoVerificacao('Ainda não confirmado. Abra o link enviado para o seu e-mail.', '#F44336');
    } catch (error) {
      mostrarAvisoVerificacao('Erro ao verificar: ' + error.message, '#F44336');
    }
  });

  document.getElementById('verify-resend-btn')?.addEventListener('click', async (e) => {
    e.preventDefault();
    try {
      await sendEmailVerification(auth.currentUser);
      mostrarAvisoVerificacao('E-mail reenviado.', '#059669');
    } catch (error) {
      mostrarAvisoVerificacao(error.code === 'auth/too-many-requests'
        ? 'Muitos envios seguidos. Aguarde alguns minutos e tente de novo.'
        : 'Erro ao reenviar: ' + error.message, '#F44336');
    }
  });

  document.getElementById('verify-logout-btn')?.addEventListener('click', (e) => {
    e.preventDefault();
    signOut(auth);
  });

  // Ação de Esqueci a Senha
  // Navegação: Abrir Tela de Recuperação
  document.getElementById('forgot-pass-btn')?.addEventListener('click', (e) => {
    e.preventDefault();
    document.getElementById('login-view').style.display = 'none';
    document.getElementById('register-view').style.display = 'none';
    document.getElementById('forgot-pass-view').style.display = 'block';
  });

  // Navegação: Voltar da Recuperação para o Login
  document.getElementById('back-to-login-forgot-btn')?.addEventListener('click', () => {
    document.getElementById('forgot-pass-view').style.display = 'none';
    document.getElementById('login-view').style.display = 'block';
    document.getElementById('forgot-success').style.display = 'none';
    document.getElementById('forgot-error').style.display = 'none';
  });

  // Processamento do E-mail de Recuperação
  document.getElementById('forgot-pass-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('forgot-email').value;
    const errorMsg = document.getElementById('forgot-error');
    const successMsg = document.getElementById('forgot-success');
    const btn = document.getElementById('submit-forgot-btn');

    try {
      btn.disabled = true;
      btn.innerText = 'Verificando...';
      errorMsg.style.display = 'none';
      successMsg.style.display = 'none';

      // O Firebase processa o envio e valida a existência do e-mail simultaneamente
      await sendPasswordResetEmail(auth, email);

      successMsg.innerText = "E-mail validado! O link de redefinição foi enviado para sua caixa de entrada.";
      successMsg.style.display = 'block';
      document.getElementById('forgot-email').value = '';
    } catch (error) {
      // Captura o erro específico se o e-mail não existir no banco
      if (error.code === 'auth/user-not-found' || error.code === 'auth/invalid-credential') {
        errorMsg.innerText = "Este e-mail não está cadastrado em nosso sistema.";
      } else {
        errorMsg.innerText = "Erro ao enviar: " + error.message;
      }
      errorMsg.style.display = 'block';
    } finally {
      btn.disabled = false;
      btn.innerText = 'Enviar Link';
    }
  });

  // --- LÓGICA DO MENU FAB E ROTEAMENTO ---
  function toggleFabMenu() {
    document.getElementById('fab-menu').classList.toggle('hidden');
  }

  function closeFabMenu() {
    const menu = document.getElementById('fab-menu');
    if (menu && !menu.classList.contains('hidden')) {
      menu.classList.add('hidden');
    }
  }

  function openNewTransaction(tipo) {
    closeFabMenu();
    openModal();
    setTxType(tipo);
  }

  function openNewCCTransaction() {
    closeFabMenu();
    openCCTransModal();
  }

  function openNewTransfer() {
    closeFabMenu();
    openTransferModal();

    // 1. Pega a data atual no formato YYYY-MM-DD
    const localISO = new Date(new Date().getTime() - (new Date().getTimezoneOffset() * 60000)).toISOString().split('T')[0];

    // 2. Pré-preenche o campo (compatibilidade com flatpickr e input normal)
    const dateElement = document.getElementById('transfer-data');
    if (dateElement && dateElement._flatpickr) {
      dateElement._flatpickr.setDate(localISO);
    } else if (dateElement) {
      dateElement.value = localISO;
    }

    const valueInput = document.querySelector('#transfer-form input[name="valor"]');
    if (valueInput) { valueInput.style.color = '#2196F3'; valueInput.style.borderBottomColor = '#2196F3'; }

    const dateInput = dateElement && dateElement._flatpickr ? dateElement._flatpickr.altInput : null;
    if (dateInput) {
      dateInput.style.color = '#2196F3';
      dateInput.style.fontWeight = '600';
    }
  }
  // ── Diálogo de confirmação ──
  /**
   * Substitui window.confirm: retorna uma Promise<boolean>.
   * Esc e clique no fundo cancelam; o foco inicial fica em "Cancelar".
   */
  function confirmDialog({ title, message = '', detail = '', confirmLabel = 'Excluir', cancelLabel = 'Cancelar', danger = true }) {
    return new Promise(resolve => {
      const previousFocus = document.activeElement;
      const overlay = document.createElement('div');
      overlay.className = 'confirm-overlay';
      overlay.innerHTML = `
        <div class="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title">
          <div class="confirm-icon ${danger ? 'danger' : ''}"><i class="fas ${danger ? 'fa-trash-alt' : 'fa-question'}"></i></div>
          <h3 id="confirm-title" class="confirm-title">${escapeHTML(title)}</h3>
          ${message ? `<p class="confirm-message">${escapeHTML(message)}</p>` : ''}
          ${detail ? `<div class="confirm-detail">${escapeHTML(detail)}</div>` : ''}
          <div class="confirm-actions">
            <button type="button" class="confirm-btn cancel">${escapeHTML(cancelLabel)}</button>
            <button type="button" class="confirm-btn ok ${danger ? 'danger' : ''}">${escapeHTML(confirmLabel)}</button>
          </div>
        </div>`;

      const finish = (result) => {
        document.removeEventListener('keydown', onKey, true);
        overlay.classList.remove('open');
        setTimeout(() => overlay.remove(), 200);
        if (previousFocus && previousFocus.focus) previousFocus.focus();
        resolve(result);
      };
      const onKey = (e) => {
        if (e.key === 'Escape') {
          e.stopImmediatePropagation();
          finish(false);
        }
      };

      overlay.addEventListener('click', (e) => { if (e.target === overlay) finish(false); });
      overlay.querySelector('.cancel').addEventListener('click', () => finish(false));
      overlay.querySelector('.ok').addEventListener('click', () => finish(true));
      document.addEventListener('keydown', onKey, true);

      document.body.appendChild(overlay);
      requestAnimationFrame(() => overlay.classList.add('open'));
      overlay.querySelector('.cancel').focus();
    });
  }

  // --- DASHBOARD: INSIGHTS & ALERTAS DINÂMICOS (OPÇÃO B) ---
  function renderDashboardInsights(selectedYYYYMM) {
    const container = document.getElementById('dashboard-insights-banner');
    if (!container) return;

    const period = selectedYYYYMM || getSelectedYYYYMM();
    const insights = [];

    // 1. INSIGHT DE CARTÃO DE CRÉDITO
    const ccTransactionsMonth = state.creditTransactions.filter(ct => String(ct.MesFatura) === period);
    const totalCC = ccTransactionsMonth.reduce((acc, c) => acc + (parseFloat(c.Valor) || 0), 0);

    if (state.creditCards.length > 0) {
      const today = new Date();
      const currentDay = today.getDate();

      const cardWithClosestDue = [...state.creditCards].sort((a, b) => {
        const dueA = parseInt(a.DiaVencimento) || 30;
        const dueB = parseInt(b.DiaVencimento) || 30;
        return Math.abs(dueA - currentDay) - Math.abs(dueB - currentDay);
      })[0];

      const dueDay = parseInt(cardWithClosestDue.DiaVencimento) || 10;
      const daysUntilDue = dueDay - currentDay;

      if (daysUntilDue >= 0 && daysUntilDue <= 7) {
        insights.push({
          tag: 'Fatura a Vencer',
          title: `Fatura ${cardWithClosestDue.Nome} vence em ${daysUntilDue === 0 ? 'HOJE' : `${daysUntilDue} dia(s)`}`,
          desc: `Total de ${currencyFormatter.format(totalCC)}. Clique para conferir lançamentos.`,
          icon: 'fa-credit-card',
          status: 'alert-warning',
          tab: 'credit-cards'
        });
      } else {
        insights.push({
          tag: 'Cartões & Faturas',
          title: `Faturas sob controle (${currencyFormatter.format(totalCC)})`,
          desc: `${state.creditCards.length} cartão(ões) cadastrado(s) com faturas organizadas.`,
          icon: 'fa-shield-halved',
          status: 'alert-info',
          tab: 'credit-cards'
        });
      }
    } else {
      insights.push({
        tag: 'Cartões',
        title: 'Nenhum cartão cadastrado',
        desc: 'Adicione seus cartões para controlar faturas e limites em um só lugar.',
        icon: 'fa-credit-card',
        status: 'alert-info',
        tab: 'credit-cards'
      });
    }

    // 2. INSIGHT DE METAS (GOALS)
    const activeGoals = (state.goals || []).filter(g => g.Status === 'Ativo');
    if (activeGoals.length > 0) {
      const topGoal = [...activeGoals].sort((a, b) => (b.Progresso || 0) - (a.Progresso || 0))[0];
      const remaining = Math.max(0, (topGoal.ValorAlvo || 0) - (topGoal.ValorAtual || 0));

      insights.push({
        tag: 'Objetivo em Foco',
        title: `${topGoal.Nome} atingiu ${topGoal.Progresso.toFixed(0)}%`,
        desc: remaining > 0 ? `Restam ${currencyFormatter.format(remaining)} para a meta ser concluída.` : 'Meta 100% concluída! 🎉',
        icon: 'fa-bullseye',
        status: topGoal.Progresso >= 75 ? 'alert-accent' : 'alert-info',
        tab: 'goals'
      });
    } else {
      insights.push({
        tag: 'Metas Financeiras',
        title: 'Defina seu primeiro objetivo',
        desc: 'Economizar com um propósito claro acelera sua independência.',
        icon: 'fa-trophy',
        status: 'alert-info',
        tab: 'goals'
      });
    }

    // 3. INSIGHT DE SAÚDE DE CAIXA NO MÊS
    const monthlyTransactions = activeTransactions().filter(t => {
      if (!t.Data || isTransferTransaction(t)) return false;
      const tDate = parseLocalDate(t.Data);
      const tMonth = String(tDate.getMonth() + 1).padStart(2, '0');
      const tYear = tDate.getFullYear();
      return `${tYear}-${tMonth}` === period;
    });

    const sumInc = monthlyTransactions.filter(t => t.Tipo === 'RECEITA').reduce((acc, t) => acc + (parseFloat(t.Valor) || 0), 0);
    const sumExp = monthlyTransactions.filter(t => t.Tipo === 'DESPESA').reduce((acc, t) => acc + (parseFloat(t.Valor) || 0), 0) + totalCC;

    if (sumInc > sumExp && sumInc > 0) {
      const eco = sumInc - sumExp;
      const rate = ((eco / sumInc) * 100).toFixed(0);
      insights.push({
        tag: 'Superávit Mensal',
        title: `Taxa de economia de ${rate}% no mês`,
        desc: `Saldo positivo de ${currencyFormatter.format(eco)} em relação às despesas totais.`,
        icon: 'fa-arrow-trend-up',
        status: 'alert-success',
        tab: 'transactions'
      });
    } else if (sumExp > sumInc && sumExp > 0) {
      const def = sumExp - sumInc;
      insights.push({
        tag: 'Atenção ao Caixa',
        title: `Despesas superam receitas em ${currencyFormatter.format(def)}`,
        desc: 'Acompanhe seus lançamentos para reequilibrar as contas antes do fechamento.',
        icon: 'fa-arrow-trend-down',
        status: 'alert-warning',
        tab: 'transactions'
      });
    } else {
      insights.push({
        tag: 'Balanço Mensal',
        title: 'Fluxo em equilíbrio contábil',
        desc: 'Suas receitas e despesas registradas estão alinhadas no período.',
        icon: 'fa-scale-balanced',
        status: 'alert-info',
        tab: 'transactions'
      });
    }

    container.innerHTML = insights.map(item => `
      <div class="insight-card ${item.status}" onclick="AppController.switchTab('${item.tab}')" title="Clique para abrir detalhes">
        <div class="insight-icon-box">
          <i class="fas ${item.icon}"></i>
        </div>
        <div class="insight-content">
          <div class="insight-tag">${item.tag}</div>
          <div class="insight-title">${item.title}</div>
          <div class="insight-desc">${item.desc}</div>
        </div>
      </div>
    `).join('');
  }

  // Tecla ESC fecha o Drawer de Transações
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const drawer = document.getElementById('tx-drawer');
      if (drawer && drawer.classList.contains('open')) {
        closeTxDrawer();
      }
      const ccDrawer = document.getElementById('cc-drawer');
      if (ccDrawer && ccDrawer.classList.contains('open')) {
        closeCCDrawer();
      }
      if (elements.modal && !elements.modal.classList.contains('hidden')) {
        closeModal();
      }
      const eventModal = document.getElementById('event-modal');
      if (eventModal && !eventModal.classList.contains('hidden')) {
        closeEventModal();
      }
    }
  });

  // ── Pílula deslizante dos seletores segmentados ──
  const segPillTimers = {};

  function moveSegPill(containerId, animate = true) {
    const container = document.getElementById(containerId);
    const pill = container && container.querySelector('.seg-pill');
    const btn = container && container.querySelector('.seg-btn.active');
    if (!pill || !btn || btn.offsetParent === null) return;

    const newLeft = btn.offsetLeft;
    const newWidth = btn.offsetWidth;
    clearTimeout(segPillTimers[containerId]);

    const first = !pill.classList.contains('ready');
    if (first || !animate || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      pill.classList.add('no-anim');
      pill.style.left = `${newLeft}px`;
      pill.style.width = `${newWidth}px`;
      void pill.offsetWidth;
      pill.classList.remove('no-anim');
      pill.classList.add('ready');
      return;
    }

    // Estica cobrindo origem e destino, depois encolhe no destino
    const oldLeft = parseFloat(pill.style.left) || 0;
    const oldWidth = parseFloat(pill.style.width) || 0;
    const start = Math.min(oldLeft, newLeft);
    const end = Math.max(oldLeft + oldWidth, newLeft + newWidth);
    pill.style.left = `${start}px`;
    pill.style.width = `${end - start}px`;
    segPillTimers[containerId] = setTimeout(() => {
      pill.style.left = `${newLeft}px`;
      pill.style.width = `${newWidth}px`;
    }, 240);
  }

  function moveGoalsPill(animate = true) {
    moveSegPill('goals-seg', animate);
  }

  window.addEventListener('resize', () => {
    moveGoalsPill(false);
    moveSegPill('prof-seg', false);
    moveSegPill('set-seg', false);
    moveSegPill('cat-seg', false);
  });

  function maskCurrency(input) {
    let value = input.value.replace(/\D/g, "");

    if (value === "") {
      input.value = "";
      return;
    }

    const numericValue = parseInt(value, 10) / 100;

    input.value = new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
      minimumFractionDigits: 2
    }).format(numericValue)
  }

  // Máscaras de Formatação
  function maskCPF(input) {
    let v = input.value.replace(/\D/g, ""); // Remove o que não é número
    if (v.length > 11) v = v.slice(0, 11);
    v = v.replace(/(\d{3})(\d)/, "$1.$2");
    v = v.replace(/(\d{3})(\d)/, "$1.$2");
    v = v.replace(/(\d{3})(\d{1,2})$/, "$1-$2");
    input.value = v;
  }

  function maskPhone(input) {
    let v = input.value.replace(/\D/g, "");
    if (v.length > 11) v = v.slice(0, 11);
    v = v.replace(/(\d{2})(\d)/, "$1 $2");
    v = v.replace(/(\d{5})(\d)/, "$1-$2");
    input.value = v;
  }

  function maskCEP(input) {
    let v = input.value.replace(/\D/g, "");
    if (v.length > 8) v = v.slice(0, 8);
    v = v.replace(/(\d{5})(\d)/, "$1-$2");
    input.value = v;
  }

  async function logout() {
    try {
      await signOut(auth);
    } catch (error) {
      console.error("Erro ao deslogar:", error);
    }
  }

  // Controle do Menu Dropdown do Usuário
  const userTrigger = document.getElementById('user-menu-trigger');
  const userDropdown = document.getElementById('user-dropdown');

  if (userTrigger && userDropdown) {
    userTrigger.addEventListener('click', (e) => {
      e.stopPropagation(); // Impede que o clique feche o menu instantaneamente
      const isVisible = userDropdown.style.display === 'block';
      userDropdown.style.display = isVisible ? 'none' : 'block';
    });

    // Fecha o menu ao clicar em qualquer outro lugar da tela
    document.addEventListener('click', (e) => {
      if (!userTrigger.contains(e.target) && !userDropdown.contains(e.target)) {
        userDropdown.style.display = 'none';
      }
    });
  }

  function definirMesAtual() {
    const meses = [
      'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
      'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
    ];
    const dataAtual = new Date();
    const nomeMes = meses[dataAtual.getMonth()];
    const ano = dataAtual.getFullYear();

    const label = document.getElementById('selected-month-label');
    if (label) {
      label.innerText = `${nomeMes} ${ano}`;
    }
  }

  // Abrir a tela de Perfil
  document.getElementById('nav-profile-btn')?.addEventListener('click', (e) => {
    e.preventDefault();
    document.getElementById('main-dashboard-content').style.display = 'none';
    document.getElementById('profile-view').style.display = 'block';
    requestAnimationFrame(() => moveSegPill('prof-seg', false));

    // Fecha o menu dropdown após clicar
    const userDropdown = document.getElementById('user-dropdown');
    if (userDropdown) userDropdown.style.display = 'none';
  });

  document.getElementById('nav-settings-btn')?.addEventListener('click', (e) => {
    e.preventDefault();
    // Esconde o painel de perfil caso esteja aberto
    document.getElementById('profile-view').style.display = 'none';
    // Garante que o container principal está visível
    document.getElementById('main-dashboard-content').style.display = 'block';

    // Abre a nova tela de configurações
    AppController.switchTab('settings');

    // Fecha o menu dropdown após clicar
    const userDropdown = document.getElementById('user-dropdown');
    if (userDropdown) userDropdown.style.display = 'none';
  });

  // Voltar para o Dashboard (Adicione o id="nav-dashboard-btn" no botão "Dashboard" do seu menu superior)
  document.getElementById('nav-dashboard-btn')?.addEventListener('click', (e) => {
    e.preventDefault();
    document.getElementById('profile-view').style.display = 'none';
    document.getElementById('main-dashboard-content').style.display = 'block';
  });

  // Processamento do Formulário de Atualização de Cadastro
  document.getElementById('update-profile-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();

    const btn = e.target.querySelector('button[type="submit"]');
    const originalText = btn.innerText;

    // Captura os dados de texto
    const formData = {
      nome: document.getElementById('edit-nome').value,
      apelido: document.getElementById('edit-apelido').value,
      telefone: document.getElementById('edit-telefone').value,
      cep: document.getElementById('edit-cep').value,
      estado: document.getElementById('edit-estado').value,
      cidade: document.getElementById('edit-cidade').value,
      nascimento: document.getElementById('edit-nascimento').value,
      sexo: document.getElementById('edit-sexo').value,
      cpf: document.getElementById('edit-cpf').value,
      objetivo: document.getElementById('edit-objetivo').value,
      // Para radio buttons, pegamos o que está marcado (checked)
      nacionalidade: document.querySelector('input[name="nacionalidade"]:checked')?.value || '',
      pesquisas: document.querySelector('input[name="pesquisas"]:checked')?.value || ''
    };

    // Captura as senhas (se o usuário preencheu)
    const newPass = document.getElementById('edit-password').value;
    const confirmPass = document.getElementById('edit-confirm-password').value;

    try {
      btn.disabled = true;
      btn.innerText = 'Salvando...';

      const user = auth.currentUser;
      if (!user) {
        alert("Erro: Nenhum usuário autenticado no momento.");
        return;
      }

      // 1. SALVA OS DADOS NO FIRESTORE
      // Usamos merge: true para atualizar apenas os campos enviados, sem apagar o resto do documento
      await setDoc(doc(db, "Usuarios", user.uid), formData, { merge: true });

      let mensagemSucesso = "Dados pessoais atualizados com sucesso!";

      // 2. TENTA ATUALIZAR A SENHA (SE PREENCHIDA)
      if (newPass || confirmPass) {
        if (newPass !== confirmPass) {
          throw new Error("As senhas digitadas não coincidem.");
        }

        const regexSenha = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[\W_]).{6,}$/;
        if (!regexSenha.test(newPass)) {
          throw new Error("A nova senha deve conter pelo menos uma letra maiúscula, uma minúscula, um número e um símbolo.");
        }

        await updatePassword(user, newPass);
        mensagemSucesso = "Dados e senha atualizados com sucesso!";

        // Limpa os campos de senha após o sucesso
        document.getElementById('edit-password').value = '';
        document.getElementById('edit-confirm-password').value = '';
      }

      AppController.showToast(mensagemSucesso, 'success');

    } catch (error) {
      console.error("Erro ao atualizar perfil:", error);

      if (error.code === 'auth/requires-recent-login') {
        alert("Por segurança, você precisa sair e fazer login novamente para alterar sua senha.");
        logout();
      } else {
        AppController.showToast("Atenção: " + error.message, 'error');
      }
    } finally {
      btn.disabled = false;
      btn.innerText = originalText;
    }
  });

  // Alternar as abas internas da Tela de Perfil
  function switchProfileTab(tabName) {
    const panes = {
      overview: document.getElementById('prof-content-overview'),
      registration: document.getElementById('prof-content-registration')
    };
    const buttons = {
      overview: document.getElementById('tab-prof-overview'),
      registration: document.getElementById('tab-prof-registration')
    };

    Object.keys(panes).forEach(key => {
      const active = key === tabName;
      if (buttons[key]) buttons[key].classList.toggle('active', active);
      if (panes[key]) {
        panes[key].style.display = active ? 'block' : 'none';
        panes[key].classList.remove('tab-pane-enter');
        if (active) {
          void panes[key].offsetWidth;
          panes[key].classList.add('tab-pane-enter');
        }
      }
    });

    moveSegPill('prof-seg');
  }

  // Retornar ao Dashboard clicando no Logotipo
  document.getElementById('logo-home-btn')?.addEventListener('click', (e) => {
    e.preventDefault();
    document.getElementById('profile-view').style.display = 'none';
    document.getElementById('main-dashboard-content').style.display = 'block';
  });

  // --- MODO ESCURO (THEME) ---
  // Mantém todos os seletores de tema (Perfil e Configurações) iguais ao tema ativo
  function syncThemeSelectors(theme) {
    document.querySelectorAll('#theme-selector-settings').forEach(el => {
      el.value = theme;
      if (el.choicesInstance) el.choicesInstance.setChoiceByValue(theme);
    });
  }

  function changeTheme(theme) {
    if (theme === 'dark') {
      document.body.classList.add('dark-mode');
      localStorage.setItem('nexo_theme', 'dark');
    } else {
      document.body.classList.remove('dark-mode');
      localStorage.setItem('nexo_theme', 'light');
    }
    syncThemeSelectors(theme === 'dark' ? 'dark' : 'light');
  }

  function loadTheme() {
    const savedTheme = localStorage.getItem('nexo_theme') || 'light';

    // Atualiza os selects visuais
    document.querySelectorAll('#theme-selector-settings').forEach(el => { el.value = savedTheme; });

    changeTheme(savedTheme);
  }

  // Salvar Preferências (Tema, Idioma e Moeda)
  function savePreferences(trigger) {
    // Há dois formulários com os mesmos ids (Perfil e Configurações): usa o do botão clicado
    const scope = (trigger && trigger.closest('#profile-view, #view-settings')) || document;
    const themeSelector = scope.querySelector('#theme-selector-settings');
    const langSelector = scope.querySelector('#lang-selector-settings');
    const currencySelector = scope.querySelector('#currency-selector-settings');

    // 1. Aplica o Tema escolhido
    if (themeSelector) {
      changeTheme(themeSelector.value);
    }

    // 2. Guarda o Idioma (fica gravado no navegador)
    if (langSelector) {
      localStorage.setItem('nexo_lang', langSelector.value);
    }

    // 3. Guarda a Moeda (fica gravado no navegador)
    if (currencySelector) {
      localStorage.setItem('nexo_currency', currencySelector.value);
    }

    // 4. Mostra a mensagem de sucesso
    AppController.showToast("Preferências guardadas com sucesso!", 'success');
  }

  // --- CARREGAR PERFIL DO USUÁRIO ---
  async function loadUserProfile() {
    const user = auth.currentUser;
    if (!user) return;

    try {
      const docRef = doc(db, "Usuarios", user.uid);
      const docSnap = await getDoc(docRef);

      // Preenche sempre o e-mail (vem direto do sistema de login de segurança)
      const emailInputs = document.querySelectorAll('input[type="email"]');
      emailInputs.forEach(el => el.value = user.email);

      const bannerEmail = document.querySelector('#prof-content-overview p');
      if (bannerEmail) bannerEmail.innerText = user.email;

      // Limpa o perfil anterior e usa um nome provisório até haver cadastro salvo
      ['edit-nome', 'edit-apelido', 'edit-telefone', 'edit-cep', 'edit-estado', 'edit-cidade', 'edit-nascimento', 'edit-cpf']
        .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
      const provisionalName = user.displayName || (user.email || 'Usuário').split('@')[0];
      const provisionalTrigger = document.querySelector('#user-menu-trigger span');
      if (provisionalTrigger) provisionalTrigger.innerText = provisionalName;
      const provisionalBanner = document.querySelector('#prof-content-overview h3');
      if (provisionalBanner) provisionalBanner.innerText = provisionalName;

      // Se o usuário já salvou o perfil no banco, preenche o restante:
      if (docSnap.exists()) {
        const data = docSnap.data();

        // Inputs de Texto
        if (document.getElementById('edit-nome')) document.getElementById('edit-nome').value = data.nome || '';
        if (document.getElementById('edit-apelido')) document.getElementById('edit-apelido').value = data.apelido || '';
        if (document.getElementById('edit-telefone')) document.getElementById('edit-telefone').value = data.telefone || '';
        if (document.getElementById('edit-cep')) document.getElementById('edit-cep').value = data.cep || '';
        if (document.getElementById('edit-estado')) document.getElementById('edit-estado').value = data.estado || '';
        if (document.getElementById('edit-cidade')) document.getElementById('edit-cidade').value = data.cidade || '';
        if (document.getElementById('edit-nascimento')) document.getElementById('edit-nascimento').value = data.nascimento || '';
        if (document.getElementById('edit-cpf')) document.getElementById('edit-cpf').value = data.cpf || '';

        // Selects
        if (document.getElementById('edit-sexo')) document.getElementById('edit-sexo').value = data.sexo || '';
        if (document.getElementById('edit-objetivo')) document.getElementById('edit-objetivo').value = data.objetivo || '';

        // Radio Buttons
        if (data.nacionalidade) {
          const radioNac = document.querySelector(`input[name="nacionalidade"][value="${data.nacionalidade}"]`);
          if (radioNac) radioNac.checked = true;
        }
        if (data.pesquisas) {
          const radioPesq = document.querySelector(`input[name="pesquisas"][value="${data.pesquisas}"]`);
          if (radioPesq) radioPesq.checked = true;
        }

        // Atualiza a Identidade Visual na tela (Nome do Banner e Menu Superior)
        const bannerName = document.querySelector('#prof-content-overview h3');
        if (bannerName) bannerName.innerText = data.nome || 'Usuário';

        const triggerName = document.querySelector('#user-menu-trigger span');
        if (triggerName) triggerName.innerText = data.apelido || data.nome || 'Usuário';
      }
    } catch (error) {
      console.error("Erro ao carregar dados do perfil:", error);
    }
  }

  // ==========================================
  // SISTEMA DE NOTIFICAÇÕES (TOASTS)
  // ==========================================
  function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    // Cria o elemento
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    // Define o ícone com base no tipo
    let icon = 'fa-check-circle';
    if (type === 'error') icon = 'fa-exclamation-circle';
    if (type === 'info') icon = 'fa-info-circle';

    toast.innerHTML = `<i class="fas ${icon}" style="font-size: 18px;"></i> <span>${escapeHTML(message)}</span>`;
    container.appendChild(toast);

    // Remove o Toast automaticamente após 3.5 segundos
    setTimeout(() => {
      toast.classList.add('hiding');
      toast.addEventListener('animationend', () => toast.remove());
      setTimeout(() => toast.remove(), 600);
    }, 3500);
  }

  // RESUMO DINÂMICO DE TRANSAÇÕES
  function updateTransactionSummary() {
    const container = document.getElementById('transactions-summary-container');
    if (!container) return;

    const selectedYYYYMM = getSelectedYYYYMM();
    const today = new Date();
    today.setHours(23, 59, 59, 999);

    // 1. Filtra as transações normais do mês selecionado
    const monthlyTransactions = activeTransactions().filter(t => {
      if (!t.Data) return false;
      const tDate = parseLocalDate(t.Data);
      const tMonth = String(tDate.getMonth() + 1).padStart(2, '0');
      const tYear = tDate.getFullYear();
      return `${tYear}-${tMonth}` === selectedYYYYMM;
    });

    // 2. Injeta os lançamentos de cartão de crédito do mês
    const ccTransactions = (state.creditTransactions || [])
      .filter(ct => String(ct.MesFatura) === selectedYYYYMM)
      .map(ct => ({
        ...ct,
        Tipo: 'DESPESA',
        isCreditCard: true,
        Status: ct.Status || 'Pendente'
      }));

    const currentTxs = [...monthlyTransactions, ...ccTransactions];

    let recPagas = 0, recPendentes = 0;
    let desPagas = 0, desPendentes = 0;

    // 3. Distribuição de valores (Ignorando Transferências como no Dashboard)
    currentTxs.forEach(t => {
      if (isTransferTransaction(t)) return;

      const v = Math.abs(parseFloat(t.Valor) || 0);

      let isPaid = false;
      if (t.isCreditCard) {
        isPaid = (t.Status === 'Pago');
      } else {
        isPaid = isSettled(t);
      }

      if (t.Tipo === 'RECEITA') {
        if (isPaid) recPagas += v; else recPendentes += v;
      } else if (t.Tipo === 'DESPESA') {
        if (isPaid) desPagas += v; else desPendentes += v;
      }
    });

    const totalRec = recPagas + recPendentes;
    const totalDes = desPagas + desPendentes;
    const balanco = totalRec - totalDes;

    // 4. Saldo Atual Global (A matemática exata do Dashboard)
    const baseBalance = (state.accounts || []).reduce((acc, currentAcc) => acc + (parseFloat(currentAcc.SaldoInicial) || 0), 0);
    const globalSummary = settledTotals(activeTransactions());

    const saldoAtual = baseBalance + globalSummary.income - globalSummary.expense;
    const filter = state.txFilter || 'ALL';

    // 5. Construtor HTML
    const buildCard = (icon, iconBg, title, value) => `
      <div style="background: white; border-radius: 16px; padding: 20px; display: flex; align-items: center; gap: 15px; border: 1px solid #eaeaea; min-width: 240px; flex: 1; box-shadow: 0 2px 10px rgba(0,0,0,0.02);">
        <div style="width: 48px; height: 48px; border-radius: 50%; background: ${iconBg}; display: flex; justify-content: center; align-items: center; flex-shrink: 0;">
          <i class="fas ${icon}" style="color: white; font-size: 20px;"></i>
        </div>
        <div style="display: flex; flex-direction: column; gap: 4px; width: 100%;">
          <div style="display: flex; justify-content: space-between; align-items: center; color: #888; font-size: 14px; font-weight: 500;">
            ${title} <i class="fas fa-chevron-right" style="font-size: 12px; color: #ccc;"></i>
          </div>
          <div style="color: #111; font-size: 18px; font-weight: 600;">${currencyFormatter.format(value)}</div>
        </div>
      </div>
    `;

    let html = '';
    if (filter === 'RECEITA') {
      html += buildCard('fa-arrow-up', '#4CAF50', 'Receitas pendentes', recPendentes);
      html += buildCard('fa-arrow-down', '#4CAF50', 'Receitas recebidas', recPagas);
      html += buildCard('fa-balance-scale', '#4CAF50', 'Total (Receitas)', totalRec);
    } else if (filter === 'DESPESA') {
      html += buildCard('fa-arrow-up', '#F44336', 'Despesas pendentes', desPendentes);
      html += buildCard('fa-arrow-down', '#F44336', 'Despesas pagas', desPagas);
      html += buildCard('fa-balance-scale', '#F44336', 'Total (Despesas)', totalDes);
    } else {
      html += buildCard('fa-wallet', 'var(--primary-color)', 'Saldo Atual', saldoAtual);
      html += buildCard('fa-arrow-up', '#4CAF50', 'Receitas do Mês', totalRec);
      html += buildCard('fa-arrow-down', '#F44336', 'Despesas do Mês', totalDes);
      html += buildCard('fa-coins', balanco >= 0 ? '#4CAF50' : '#F44336', 'Balanço Mensal', Math.abs(balanco));
    }

    container.innerHTML = html;
  }

  function switchSettingsTab(tabName) {
    ['pref', 'alerts', 'dash', 'sec'].forEach(t => {
      const btn = document.getElementById(`tab-set-${t}`);
      const content = document.getElementById(`set-content-${t}`);
      const active = t === tabName;

      if (btn) btn.classList.toggle('active', active);
      if (content) {
        content.classList.toggle('hidden', !active);
        content.classList.remove('tab-pane-enter');
        if (active) {
          void content.offsetWidth;
          content.classList.add('tab-pane-enter');
        }
      }
    });

    moveSegPill('set-seg');
  }

  // Lógica de Seleção de Dispositivos
  function toggleAllDevices(isChecked) {
    const checkboxes = document.querySelectorAll('.device-checkbox');
    checkboxes.forEach(cb => cb.checked = isChecked);
    checkDeviceSelection();
  }

  function checkDeviceSelection() {
    const checkboxes = document.querySelectorAll('.device-checkbox');
    const selectAll = document.getElementById('select-all-devices');
    const btn = document.getElementById('btn-disconnect-devices');

    const allChecked = Array.from(checkboxes).every(cb => cb.checked);
    const anyChecked = Array.from(checkboxes).some(cb => cb.checked);

    if (selectAll) selectAll.checked = allChecked;

    if (anyChecked) {
      btn.style.background = 'var(--primary-color)';
      btn.style.color = 'white';
      btn.style.cursor = 'pointer';
      btn.disabled = false;
    } else {
      btn.style.background = '#e0e0e0';
      btn.style.color = '#999';
      btn.style.cursor = 'not-allowed';
      btn.disabled = true;
    }
  }

  function disconnectSelectedDevices() {
    // Aqui no futuro entrará a lógica real de Backend
    AppController.showToast("Os dispositivos selecionados foram desconectados com sucesso.", 'success');

    // Simula a remoção visual da tela
    const checkboxes = document.querySelectorAll('.device-checkbox');
    checkboxes.forEach(cb => {
      if (cb.checked) {
        cb.closest('div[style*="display: flex"]').style.display = 'none';
        cb.checked = false;
      }
    });
    checkDeviceSelection();
  }

  // Controlos de Paginação
  function changeTxPage(action) {
    if (action === 'first') state.txCurrentPage = 1;
    else if (action === 'prev') state.txCurrentPage--;
    else if (action === 'next') state.txCurrentPage++;
    else if (action === 'last') state.txCurrentPage = 999999; // A renderTransactions vai corrigir para a última página real

    renderTransactions();
  }

  function changeTxItemsPerPage(val) {
    state.txItemsPerPage = parseInt(val);
    state.txCurrentPage = 1; // Volta à página 1 sempre que muda a quantidade
    renderTransactions();
  }

  function setTransactionSort(col) {
    if (state.txSortCol === col) {
      // Se clicou na mesma coluna, inverte a ordem (asc <-> desc)
      state.txSortDir = state.txSortDir === 'asc' ? 'desc' : 'asc';
    } else {
      // Se clicou numa coluna nova, muda para ela. Valor e Data começam decrescentes por padrão.
      state.txSortCol = col;
      state.txSortDir = (col === 'Data' || col === 'Valor') ? 'desc' : 'asc';
    }
    state.txCurrentPage = 1; // Volta à página 1 quando muda a ordem
    renderTransactions();
  }

  Object.assign(app, { showToast, confirmDialog, moveSegPill, renderTransactions, switchTab, loadGoals, loadTransactions, upgradeSelects, describeTx, getSelectedYYYYMM, openPayInvoiceModal, moveGoalsPill, renderDashboardInsights, updateTransactionSummary });

  return {
    init, claimLegacyData, exportTransactionsCSV, exportTransactionsPDF, toggleTxStatus, handleReceiptFile, clearReceipt, handleDrawerReceipt, switchTab, toggleTxDetails, toggleTxRepeat, setTxDateShortcut, openTxDatePicker, validateTxAmount, calPrev, calNext, calToday, openEventModal, closeEventModal, submitEvent, deleteEventFromModal, setEventType, toggleEventAllDay, setTransactionFilter, openMonthPicker, closeMonthPicker, changePickerYear, selectCurrentMonth, closeModal, submitTransaction, deleteTransaction, openAccountModal, closeAccountModal, submitAccount, closeTransferModal, submitTransfer,
    openGoalTypeModal, openGoalForm, closeGoalModal, submitGoal, closeGoalDepositModal, submitGoalDeposit,
    openGoalDetails, closeGoalDetails, editGoalFromDetails, deleteGoalDeposit, editGoalDeposit, toggleGoalOptions, openCurrentGoalDepositModal, deleteCurrentGoal, switchGoalsTab, markGoalAsCompleted, toggleGoalsSortDropdown, setGoalsSortOrder, openFixedCostModal, closeFixedCostModal, submitFixedCost, editFixedCost, deleteFixedCost, markFixedCostPaid, unmarkFixedCostPaid, closeFCPayModal, openCCModal, closeCCModal, submitCC, openCCTransModal, closeCCTransModal, submitCCTrans, openCCInvoiceModal, closeCCInvoiceModal, deleteCreditTransaction, toggleFabMenu, openNewTransaction, openNewCCTransaction, openNewTransfer, startPlanningWizard, cancelPlanningWizard, copyPreviousPlanning, maskCurrency, calculateWizardBudget, prevWizardStep, nextWizardStep, calculateWizardCategoryTotals, selectCardPreference, finishPlanningWizard, submitFixedCostPay, logout, switchProfileTab, maskCPF, maskPhone, maskCEP, closePayInvoiceModal, submitPayInvoice, showToast, openCurrentGoalWithdrawModal, switchSettingsTab, toggleAllDevices, checkDeviceSelection, disconnectSelectedDevices, savePreferences, openCategoryModal, closeCategoryModal, submitCategory, deleteCategory, setCategoryKind, setCategoryFormKind, updateCategoryPreview, onCategoryParentChange, filterCategoryIcons: renderIconGrid, pickCategoryIcon, pickCategoryColor, changeTxPage, changeTxItemsPerPage, setTransactionSort, proceedEditFixedCost, closeFCEditScopeModal, 
    openTxDrawer, closeTxDrawer, closeCCDrawer, submitTxDrawer, deleteTxFromDrawer, 
    toggleTxSelect, toggleTxSelectAll, clearTxSelection, openTxBulkEdit, closeTxBulkEdit, submitTxBulkEdit, deleteTxBulk
  };
})();

document.addEventListener('DOMContentLoaded', AppController.init);

window.AppController = AppController;