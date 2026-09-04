import { db } from './firebase';
import { collection, getDocs, addDoc, updateDoc, deleteDoc, doc } from 'firebase/firestore';
import { auth } from './firebase.js';
import { signInWithEmailAndPassword, onAuthStateChanged, signOut, createUserWithEmailAndPassword, sendPasswordResetEmail } from "firebase/auth";


const AppController = (function () {
  // VARIÁVEL PARA O GRÁFICO
  let expensesChartInstance = null;
  // 1. ESTADO
  const state = {
    accounts: [], creditCards: [], creditTransactions: [],
    transactions: [], goals: [], fixedCosts: [], planning: [],
    editingId: null, editingType: null, currentTab: 'dashboard',
    txFilter: 'ALL'
  };

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

  function isTransferTransaction(t) {
    const cat = String(t ? t.Categoria : '').toLowerCase();
    return cat.includes('transferência') || cat.includes('transferencia');
  }

  function switchTab(tabName) {
    state.currentTab = tabName;
    ['dashboard', 'transactions', 'credit-cards', 'fixed-costs', 'goals', 'accounts', 'planning'].forEach(t => {
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

    if (tabName === 'credit-cards') renderCreditCardsPage();
    if (tabName === 'fixed-costs') renderFixedCostsPage();
    if (tabName === 'goals') renderGoalsPage();
    if (tabName === 'accounts') renderAccountsPage();
    if (tabName === 'planning') renderPlanningView();
  }

  // 2. SELETOR DE MÊS / ANO (MONTH PICKER)
  const monthPickerState = {
    viewYear: new Date().getFullYear(),
    selectedYear: new Date().getFullYear(),
    selectedMonth: new Date().getMonth() + 1 // 1-12
  };

  const monthLabels = [
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

  // 3. ELEMENTOS E FORMATADORES
  const elements = {
    totalBalance: document.getElementById('total-balance'), totalIncome: document.getElementById('total-income'), totalExpense: document.getElementById('total-expense'), totalCreditCard: document.getElementById('total-credit-card'),
    transactionsContainer: document.getElementById('transactions-container'), modal: document.getElementById('transaction-modal'), form: document.getElementById('transaction-form'), submitBtn: document.getElementById('submit-btn'), accountSelect: document.getElementById('conta'),
    accountModal: document.getElementById('account-modal'), accountForm: document.getElementById('account-form'), submitAccountBtn: document.getElementById('submit-acc-btn'),
    goalsContainer: document.getElementById('goals-container'), goalModal: document.getElementById('goal-modal'), goalForm: document.getElementById('goal-form'), submitGoalBtn: document.getElementById('submit-goal-btn'),
    fixedCostsContainer: document.getElementById('fixed-costs-container'), fixedCostModal: document.getElementById('fixed-cost-modal'), fixedCostForm: document.getElementById('fixed-cost-form'), submitFixedCostBtn: document.getElementById('submit-fc-btn'),
    ccModal: document.getElementById('cc-modal'), ccForm: document.getElementById('cc-form'), submitCCBtn: document.getElementById('submit-cc-btn'), ccTransModal: document.getElementById('cc-trans-modal'), ccTransForm: document.getElementById('cc-trans-form'), submitCCTransBtn: document.getElementById('submit-cct-btn'), cctCartaoSelect: document.getElementById('cct-cartao')
  };

  const currencyFormatter = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

  function parseLocalDate(dateInput) {
    if (!dateInput) return new Date();
    if (dateInput instanceof Date) return dateInput;
    const str = String(dateInput).split('T')[0];
    const parts = str.split('-');
    if (parts.length === 3) {
      return new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10), 12, 0, 0);
    }
    return new Date(dateInput);
  }

  function formatDateBR(dateInput) {
    if (!dateInput) return '';
    const d = parseLocalDate(dateInput);
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    return `${day}/${month}/${year}`;
  }

  // Sincroniza selects nativos com a interface do Choices.js
  function upgradeSelects() {
    const config = { searchEnabled: false, itemSelectText: '', shouldSort: false };
    document.querySelectorAll('select').forEach(selectEl => {
      if (selectEl.choicesInstance) selectEl.choicesInstance.destroy();
      selectEl.choicesInstance = new Choices(selectEl, config);
    });
  }
  function init() {
    try {
      loadAccounts();
      loadTransactions();
      loadGoals();
      loadFixedCosts();
      loadCreditData();
      loadPlanning();
    } catch (e) {
      console.error("Erro na inicialização:", e);
    }
  }

  // Monitor de Sessão: Tranca ou destranca a tela
  onAuthStateChanged(auth, (user) => {
    if (user) {
      document.getElementById('login-screen').style.display = 'none';
      definirMesAtual()
      init(); // Só baixa os dados do banco se tiver permissão
    } else {
      document.getElementById('login-screen').style.display = 'flex';
    }
  });

  // Evento do formulário de Login
  // Sistema de Bloqueio Client-Side
  function verificarBloqueio() {
    const bloqueioAte = localStorage.getItem('nexo_lockout');
    if (bloqueioAte && Date.now() < parseInt(bloqueioAte)) {
      const minutosRestantes = Math.ceil((parseInt(bloqueioAte) - Date.now()) / 60000);
      return `Sistema bloqueado. Tente novamente em ${minutosRestantes} minuto(s).`;
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
      return `Muitas falhas. Bloqueado por ${tempoPenalidade} minuto(s).`;
    }
    return `Senha incorreta. Tentativa ${tentativas} de 3 antes do bloqueio.`;
  }

  // Ação do Botão Entrar
  // Sistema de Bloqueio Client-Side
  function verificarBloqueio() {
    const bloqueioAte = localStorage.getItem('nexo_lockout');
    if (bloqueioAte && Date.now() < parseInt(bloqueioAte)) {
      const minutosRestantes = Math.ceil((parseInt(bloqueioAte) - Date.now()) / 60000);
      return `Sistema bloqueado. Tente novamente em ${minutosRestantes} minuto(s).`;
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
      return `Muitas falhas. Bloqueado por ${tempoPenalidade} minuto(s).`;
    }
    return `Senha incorreta. Tentativa ${tentativas} de 3 antes do bloqueio.`;
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
      errorMsg.innerText = registrarFalhaLogin();
      errorMsg.style.display = 'block';
      btn.disabled = false;
      btn.innerText = 'Entrar';
    }
  });

  // Ação de Criar Conta
  document.getElementById('create-account-btn')?.addEventListener('click', async (e) => {
    e.preventDefault();
    const email = document.getElementById('login-email').value;
    const pass = document.getElementById('login-password').value;
    const errorMsg = document.getElementById('login-error');

    if (!email || !pass) return alert("Preencha e-mail e senha no formulário para criar a conta.");

    try {
      await createUserWithEmailAndPassword(auth, email, pass);
      alert("Conta criada com sucesso! O sistema fará o login automático.");
    } catch (error) {
      errorMsg.innerText = "Erro ao criar: A senha deve ter no mínimo 6 caracteres.";
      errorMsg.style.display = 'block';
    }
  });

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
      await createUserWithEmailAndPassword(auth, email, pass);

      // (Opcional) Aqui você poderá enviar o nome/nascimento para uma tabela "Usuarios" no banco de dados posteriormente

      alert(`Conta criada com sucesso, ${nome}! O login será feito automaticamente.`);
    } catch (error) {
      errorMsg.innerText = "Erro ao criar conta: " + error.message;
      errorMsg.style.display = 'block';
      btn.disabled = false;
      btn.innerText = 'Confirmar Cadastro';
    }
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

  // --- CONTAS BANCÁRIAS E TRANSFERÊNCIAS ---
  async function loadAccounts() {
    try {
      // Puxa todos os documentos da coleção "Contas"
      const querySnapshot = await getDocs(collection(db, "Contas"));

      // Transforma a resposta bruta do Firebase em um Array limpo
      const data = querySnapshot.docs.map(doc => ({ ID: doc.id, ...doc.data() }));

      // Alimenta o estado da sua aplicação exatamente como antes
      state.accounts = data;
      populateAccountsDropdown();
      loadTransactions();
    } catch (error) {
      console.error("Erro ao carregar contas:", error);
    }
  }
  function populateAccountsDropdown() {
    if (!elements.accountSelect) return;
    elements.accountSelect.innerHTML = '<option value="" disabled selected>Selecione uma conta...</option>';
    state.accounts.forEach(acc => { const opt = document.createElement('option'); opt.value = acc.Nome; opt.text = acc.Nome; elements.accountSelect.appendChild(opt); });
    upgradeSelects()
  }
  function renderAccountBalances(transactions) {
    const container = document.getElementById('accounts-container'); if (!container) return;
    container.innerHTML = '';
    if (state.accounts.length === 0) { container.innerHTML = '<div style="color:#888; padding:15px; font-size:14px;">Nenhuma conta.</div>'; return; }
    const balances = {}; state.accounts.forEach(acc => { balances[acc.Nome] = parseFloat(acc.SaldoInicial) || 0; });

    const today = new Date();
    today.setHours(23, 59, 59, 999);

    transactions.forEach(t => {
      const tDate = parseLocalDate(t.Data);
      if (tDate > today) return;

      if (t.Conta && balances[t.Conta] !== undefined) {
        const amount = parseFloat(t.Valor) || 0;
        if (t.Tipo === 'RECEITA') balances[t.Conta] += amount; else if (t.Tipo === 'DESPESA') balances[t.Conta] -= amount;
      }
    });

    state.accounts.forEach(acc => {
      const card = document.createElement('div'); card.className = 'account-mini-card';
      const bal = balances[acc.Nome]; const bClass = bal < 0 ? 'text-red' : 'text-green';
      card.innerHTML = `<div class="acc-name"><i class="fas fa-wallet" style="margin-right: 8px; color: #aaa;"></i>${acc.Nome}</div><div class="acc-balance ${bClass}">${currencyFormatter.format(bal)}</div>`;
      container.appendChild(card);
    });
  }
  function openAccountModal() { elements.accountModal.classList.remove('hidden'); }
  function closeAccountModal() { elements.accountModal.classList.add('hidden'); elements.accountForm.reset(); }
  async function submitAccount(event) {
    event.preventDefault();
    elements.submitAccountBtn.disabled = true;
    elements.submitAccountBtn.innerHTML = 'Salvando...';

    const formDados = Object.fromEntries(new FormData(elements.accountForm).entries());

    try {
      await addDoc(collection(db, "Contas"), {
        Nome: formDados.nome,
        SaldoInicial: parseFloat(formDados.saldoInicial) || 0,
        Status: 'Ativo'
      });
      closeAccountModal();
      loadAccounts();
    } catch (error) {
      alert("Erro ao salvar conta: " + error.message);
    } finally {
      elements.submitAccountBtn.disabled = false;
      elements.submitAccountBtn.innerText = 'Salvar';
    }
  }

  function openTransferModal() {
    const orig = document.getElementById('transfer-origem');
    const dest = document.getElementById('transfer-destino');
    if (orig && dest) {
      orig.innerHTML = '<option value="" disabled selected>Selecione a origem...</option>';
      dest.innerHTML = '<option value="" disabled selected>Selecione o destino...</option>';
      state.accounts.forEach(acc => {
        orig.innerHTML += `<option value="${acc.Nome}">${acc.Nome}</option>`;
        dest.innerHTML += `<option value="${acc.Nome}">${acc.Nome}</option>`;
      });
      upgradeSelects();
    }
    document.getElementById('transfer-modal').classList.remove('hidden');
  }
  function closeTransferModal() {
    document.getElementById('transfer-modal').classList.add('hidden');
    document.getElementById('transfer-form').reset();
  }
  async function submitTransfer(event) {
    event.preventDefault();
    const btn = document.getElementById('submit-transfer-btn');
    btn.disabled = true;
    btn.innerText = 'Transferindo...';

    const formDados = Object.fromEntries(new FormData(document.getElementById('transfer-form')).entries());
    const valorTransf = parseFloat(formDados.valor) || 0;
    const localISO = new Date(new Date().getTime() - (new Date().getTimezoneOffset() * 60000)).toISOString().split('T')[0];

    try {
      if (formDados.tipoTransferencia === 'OBJETIVO') {
        const goal = state.goals.find(g => String(g.ID) === String(formDados.origem));
        if (!goal) throw new Error("Objetivo não encontrado.");
        if (valorTransf > (parseFloat(goal.ValorAtual) || 0)) throw new Error("Saldo insuficiente no objetivo.");

        await updateDoc(doc(db, "Objetivos", goal.ID), { ValorAtual: (parseFloat(goal.ValorAtual) || 0) - valorTransf });
        await addDoc(collection(db, "Transacoes"), { Tipo: 'RECEITA', Categoria: 'Investimentos', Valor: valorTransf, Descricao: `Resgate de Objetivo: ${goal.Nome}`, Conta: formDados.destino, Data: localISO });
      } else {
        if (formDados.origem === formDados.destino) throw new Error("Origem e destino devem ser diferentes.");
        await addDoc(collection(db, "Transacoes"), { Tipo: 'DESPESA', Categoria: 'Transferência', Valor: valorTransf, Descricao: `Transf. para ${formDados.destino}`, Conta: formDados.origem, Data: localISO });
        await addDoc(collection(db, "Transacoes"), { Tipo: 'RECEITA', Categoria: 'Transferência', Valor: valorTransf, Descricao: `Transf. de ${formDados.origem}`, Conta: formDados.destino, Data: localISO });
      }

      closeTransferModal();
      loadTransactions();
      if (formDados.tipoTransferencia === 'OBJETIVO') loadGoals();
    } catch (error) {
      alert("Erro na transferência: " + error.message);
    } finally {
      btn.disabled = false;
      btn.innerText = 'Realizar Transferência';
    }
  }

  // --- TRANSAÇÕES GERAIS ---
  async function loadTransactions() {
    try {
      const querySnapshot = await getDocs(collection(db, "Transacoes"));
      state.transactions = querySnapshot.docs.map(doc => ({ ID: doc.id, ...doc.data() }));
      renderTransactions();
    } catch (error) {
      console.error("Erro ao carregar transações:", error);
    }
  }
  function renderTransactions() {
    const selectedYYYYMM = getSelectedYYYYMM();

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

    // 2. Aplicação do filtro de abas (Todas, Despesas, Receitas, Transferências)
    const displayTransactions = monthlyTransactions.filter(t => {
      const isTransf = isTransferTransaction(t);
      if (state.txFilter === 'DESPESA') return t.Tipo === 'DESPESA' && !isTransf;
      if (state.txFilter === 'RECEITA') return t.Tipo === 'RECEITA' && !isTransf;
      if (state.txFilter === 'TRANSFERENCIA') return isTransf;
      return true;
    });

    // 3. Ordenação decrescente para exibição na tabela (Mais recente no topo)
    displayTransactions.sort((a, b) => {
      const dateA = parseLocalDate(a.Data).getTime();
      const dateB = parseLocalDate(b.Data).getTime();
      if (dateB !== dateA) return dateB - dateA;
      return String(b.ID || '').localeCompare(String(a.ID || ''));
    });

    // ============================================================================
    // A MÁGICA DO SALDO DO FINAL DO DIA
    // Calculamos o saldo cronológico (do passado para o futuro) para gravar o 
    // saldo exato que a conta tinha no final de cada dia específico.
    // ============================================================================
    const baseBalance = state.accounts.reduce((acc, currentAcc) => acc + (parseFloat(currentAcc.SaldoInicial) || 0), 0);

    const allSortedChronologically = [...state.transactions].sort((a, b) => {
      return parseLocalDate(a.Data).getTime() - parseLocalDate(b.Data).getTime();
    });

    let runningBalance = baseBalance;
    const endOfDayBalances = {};

    allSortedChronologically.forEach(t => {
      // Transferências não afetam o saldo global consolidado
      if (!isTransferTransaction(t)) {
        const amount = parseFloat(t.Valor) || 0;
        if (t.Tipo === 'RECEITA') runningBalance += amount;
        else if (t.Tipo === 'DESPESA') runningBalance -= amount;
      }
      endOfDayBalances[formatDateBR(t.Data)] = runningBalance;
    });
    // ============================================================================

    const countBadge = document.getElementById('tx-count-badge');
    if (countBadge) countBadge.innerText = `${displayTransactions.length} registro(s)`;

    // Atualiza os Cards Superiores do Dashboard
    const globalSummary = state.transactions.reduce((acc, current) => {
      const tDate = parseLocalDate(current.Data);
      if (tDate <= today) {
        const amount = parseFloat(current.Valor) || 0;
        if (current.Tipo === 'RECEITA') acc.income += amount;
        else if (current.Tipo === 'DESPESA') acc.expense += amount;
      }
      return acc;
    }, { income: 0, expense: 0 });
    const currentGlobalBalance = baseBalance + globalSummary.income - globalSummary.expense;

    const monthlySummary = monthlyTransactions.reduce((acc, current) => {
      if (isTransferTransaction(current)) return acc;
      const amount = parseFloat(current.Valor) || 0;
      if (current.Tipo === 'RECEITA') acc.income += amount;
      else if (current.Tipo === 'DESPESA') acc.expense += amount;
      return acc;
    }, { income: 0, expense: 0 });

    if (elements.totalBalance) elements.totalBalance.innerText = currencyFormatter.format(currentGlobalBalance);
    if (elements.totalIncome) elements.totalIncome.innerText = currencyFormatter.format(monthlySummary.income);
    if (elements.totalExpense) elements.totalExpense.innerText = currencyFormatter.format(monthlySummary.expense);

    renderAccountBalances(state.transactions);

    elements.transactionsContainer.innerHTML = '';

    if (displayTransactions.length === 0) {
      elements.transactionsContainer.innerHTML = '<tr><td colspan="8" style="padding:15px; color:#888; text-align:center;">Nenhuma transação encontrada com este filtro.</td></tr>';
      updateChart(monthlyTransactions);
      return;
    }

    // Função auxiliar para cores e ícones das categorias
    function getCategoryStyle(cat) {
      const styles = {
        'Alimentação': { icon: 'fa-utensils', color: '#E91E63' },
        'Salário': { icon: 'fa-money-bill-wave', color: '#F44336' },
        'Investimentos': { icon: 'fa-chart-line', color: '#8BC34A' },
        'Moradia / Contas': { icon: 'fa-home', color: '#3F51B5' },
        'Transporte': { icon: 'fa-car', color: '#FF9800' },
        'Lazer': { icon: 'fa-cocktail', color: '#9C27B0' },
        'Saúde': { icon: 'fa-heartbeat', color: '#00BCD4' },
        'Educação': { icon: 'fa-book', color: '#607D8B' },
        'Supermercado': { icon: 'fa-shopping-cart', color: '#795548' },
        'Roupas': { icon: 'fa-tshirt', color: '#FF5722' },
        'Outros': { icon: 'fa-tag', color: '#9e9e9e' }
      };
      return styles[cat] || { icon: 'fa-tag', color: '#9e9e9e' };
    }

    displayTransactions.forEach((t, index) => {
      const tr = document.createElement('tr');
      tr.className = 'tx-tr';

      const isTransf = isTransferTransaction(t);
      const isExp = t.Tipo === 'DESPESA';
      const tDate = parseLocalDate(t.Data);
      const isPending = !isTransf && tDate > today;

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

      const statusHtml = isPending
        ? `<div class="status-icon status-pending" title="Agendado/Pendente"><i class="fas fa-hourglass-half"></i></div>`
        : `<div class="status-icon status-paid" title="Efetivado"><i class="fas fa-check"></i></div>`;

      const catStyle = getCategoryStyle(t.Categoria);
      let mainDesc = t.Descricao || t.Categoria;
      if (isTransf && t.Descricao) mainDesc = t.Descricao;

      const currentDateStr = formatDateBR(t.Data);

      tr.innerHTML = `
          <td class="tx-td" style="text-align: center;">
            <input type="checkbox" class="tx-checkbox" ${!isPending ? 'checked' : ''} disabled>
          </td>
          <td class="tx-td" style="text-align: center;">
            ${statusHtml}
          </td>
          <td class="tx-td" style="${isPending ? 'opacity:0.6;' : ''}">
            ${currentDateStr}
          </td>
          <td class="tx-td" style="${isPending ? 'opacity:0.6;' : ''}; font-weight: 500;">
            ${mainDesc}
          </td>
          <td class="tx-td" style="${isPending ? 'opacity:0.6;' : ''}">
            <div class="cat-badge-container">
              <div class="cat-icon-circle" style="background-color: ${catStyle.color};">
                <i class="fas ${catStyle.icon}"></i>
              </div>
              <span>${t.Categoria || 'Outros'}</span>
            </div>
          </td>
          <td class="tx-td" style="${isPending ? 'opacity:0.6;' : ''}">
            ${t.Conta || '--'}
          </td>
          <td class="tx-td ${valClass}" style="text-align: right; ${isPending ? 'opacity:0.6;' : ''}">
            ${sign} ${currencyFormatter.format(t.Valor)}
          </td>
          <td class="tx-td" style="text-align: center;">
            <div class="action-btn-group">
              <button class="btn-text" style="color: #64748b;" onclick="AppController.editTransaction('${t.ID}')" title="Editar"><i class="fas fa-pen"></i></button>
              <button class="btn-delete" onclick="AppController.deleteTransaction('${t.ID}')" title="Excluir"><i class="fas fa-trash"></i></button>
            </div>
          </td>`;

      elements.transactionsContainer.appendChild(tr);

      // --- INJEÇÃO DA PÍLULA DE SALDO DO DIA ---
      // Verifica se a PRÓXIMA transação pertence a um dia diferente. 
      // Se pertencer, significa que as transações deste dia acabaram e devemos mostrar o saldo!
      const nextTx = displayTransactions[index + 1];
      const nextDateStr = nextTx ? formatDateBR(nextTx.Data) : null;

      if (currentDateStr !== nextDateStr) {
        const balanceOfDay = endOfDayBalances[currentDateStr] || 0;

        const balanceRow = document.createElement('tr');
        balanceRow.innerHTML = `
            <td colspan="8" style="padding: 20px; text-align: center; border-bottom: 1px solid var(--border-color); background-color: #ffffff;">
              <span style="background: #f8fafc; color: #333; padding: 8px 16px; border-radius: 20px; font-size: 13.5px; border: 1px solid #e2e8f0;">
                Saldo do Final do Dia <strong>${currencyFormatter.format(balanceOfDay)}</strong>
              </span>
            </td>`;
        elements.transactionsContainer.appendChild(balanceRow);
      }
    });

    // Atualiza o gráfico de gastos por categoria do mês selecionado
    updateChart(monthlyTransactions);
  }
  // --- LÓGICA DO GRÁFICO (CHART.JS) ---
  function updateChart(transactions) {
    const canvas = document.getElementById('expensesChart');
    if (!canvas) return;

    // 1. Filtrar apenas DESPESAS (ignora transferências)
    const expenseTxn = (transactions || []).filter(t => t.Tipo === 'DESPESA' && !isTransferTransaction(t));

    // 2. Agrupar por Categoria (soma valores positivos de gastos)
    const categoryTotals = expenseTxn.reduce((acc, t) => {
      const cat = t.Categoria || 'Outros';
      const value = parseFloat(t.Valor) || 0;
      acc[cat] = (acc[cat] || 0) + value;
      return acc;
    }, {});

    const labels = Object.keys(categoryTotals);
    const dataValues = Object.values(categoryTotals);

    // 3. Preparar Dados para o Chart.js
    const chartData = {
      labels: labels.length > 0 ? labels : ['Sem despesas'],
      datasets: [{
        label: 'Gastos por Categoria',
        data: dataValues.length > 0 ? dataValues : [0],
        backgroundColor: [
          '#6200ea', '#2196F3', '#4CAF50', '#FF9800', '#E91E63',
          '#9C27B0', '#00BCD4', '#009688', '#8BC34A', '#FFC107',
          '#FF5722', '#795548', '#607D8B', '#f44336'
        ],
        borderWidth: 0
      }]
    };

    // 4. Desenhar ou Atualizar o Gráfico Donut
    const ctx = canvas.getContext('2d');

    if (expensesChartInstance) {
      expensesChartInstance.data = chartData;
      expensesChartInstance.update();
    } else {
      expensesChartInstance = new Chart(ctx, {
        type: 'doughnut',
        data: chartData,
        options: {
          responsive: true,
          maintainAspectRatio: false,
          cutout: '65%',
          plugins: {
            legend: {
              position: 'bottom',
              labels: {
                boxWidth: 12,
                font: {
                  size: 12,
                  family: 'Segoe UI, sans-serif'
                }
              }
            },
            tooltip: {
              callbacks: {
                label: function (context) {
                  const val = context.raw || 0;
                  return ` ${context.label}: ${currencyFormatter.format(val)}`;
                }
              }
            }
          }
        }
      });
    }
  }
  function openModal() {
    state.editingId = null;
    state.editingType = null;
    elements.form.reset();
    elements.submitBtn.innerText = 'Salvar Transação';
    elements.modal.classList.remove('hidden');
    const localISO = new Date(new Date().getTime() - (new Date().getTimezoneOffset() * 60000)).toISOString().split('T')[0];

    const dateInput = document.getElementById('dataTransacao');
    if (dateInput && dateInput._flatpickr) dateInput._flatpickr.setDate(localISO);
    else if (dateInput) dateInput.value = localISO;
  }
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

    const toggleDiv = document.querySelector('#transaction-form .type-toggle');
    if (toggleDiv) toggleDiv.style.display = 'none';

    const radio = document.querySelector(`#transaction-form input[name="tipo"][value="${tipo}"]`);
    if (radio) radio.checked = true;

    const header = document.querySelector('#transaction-modal .modal-header h2');
    const valueInput = document.querySelector('#transaction-form input[name="valor"]');

    // Captura o campo de texto visual (altInput) gerado pelo Flatpickr
    const dateElement = document.getElementById('dataTransacao');
    const dateInput = dateElement && dateElement._flatpickr ? dateElement._flatpickr.altInput : null;

    if (tipo === 'RECEITA') {
      if (header) { header.innerText = 'Nova Receita'; header.style.color = '#333'; }
      if (valueInput) { valueInput.style.color = '#4CAF50'; valueInput.style.borderBottomColor = '#4CAF50'; }
      if (dateInput) {
        dateInput.style.color = '#4CAF50';
        dateInput.style.fontWeight = '600';
      }
    } else {
      if (header) { header.innerText = 'Nova Despesa'; header.style.color = '#333'; }
      if (valueInput) { valueInput.style.color = '#F44336'; valueInput.style.borderBottomColor = '#F44336'; }
      if (dateInput) {
        dateInput.style.color = '#F44336';
        dateInput.style.fontWeight = '600';
      }
    }
  }

  function openNewCCTransaction() {
    closeFabMenu();
    openCCTransModal();
  }

  function openNewTransfer() {
    closeFabMenu();
    openTransferModal();

    const valueInput = document.querySelector('#transfer-form input[name="valor"]');
    if (valueInput) { valueInput.style.color = '#2196F3'; valueInput.style.borderBottomColor = '#2196F3'; }

    const dateElement = document.getElementById('transfer-data');
    const dateInput = dateElement && dateElement._flatpickr ? dateElement._flatpickr.altInput : null;
    if (dateInput) {
      dateInput.style.color = '#2196F3';
      dateInput.style.fontWeight = '600';
    }
  }
  function editTransaction(id) {
    const t = state.transactions.find(x => String(x.ID) === String(id));
    if (!t) return;
    state.editingId = id; state.editingType = 'TRANSACTION';
    const typeInput = document.querySelector(`#transaction-form input[name="tipo"][value="${t.Tipo}"]`);
    if (typeInput) typeInput.checked = true;
    if (t.Data) {
      const d = parseLocalDate(t.Data);
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      const dateStr = `${yyyy}-${mm}-${dd}`;

      const dateInput = document.getElementById('dataTransacao');
      if (dateInput && dateInput._flatpickr) dateInput._flatpickr.setDate(dateStr);
      else if (dateInput) dateInput.value = dateStr;
    }
    const contaSelect = document.getElementById('conta');
    if (contaSelect) {
      if (contaSelect.choicesInstance) contaSelect.choicesInstance.setChoiceByValue(t.Conta);
      else contaSelect.value = t.Conta;
    }
    const valorInput = document.querySelector(`#transaction-form input[name="valor"]`);
    if (valorInput) valorInput.value = t.Valor;
    const catSelect = document.querySelector(`#transaction-form select[name="categoria"]`);
    if (catSelect) {
      if (catSelect.choicesInstance) catSelect.choicesInstance.setChoiceByValue(t.Categoria);
      else catSelect.value = t.Categoria;
    }
    const descInput = document.querySelector(`#transaction-form input[name="descricao"]`);
    if (descInput) descInput.value = t.Descricao || '';
    elements.submitBtn.innerText = 'Atualizar Transação';
    elements.modal.classList.remove('hidden');
  }
  function closeModal() { elements.modal.classList.add('hidden'); elements.form.reset(); state.editingId = null; state.editingType = null; elements.submitBtn.innerText = 'Salvar Transação'; }

  async function submitTransaction(event) {
    event.preventDefault();
    elements.submitBtn.disabled = true;
    elements.submitBtn.innerHTML = 'Salvando...';

    const formDados = Object.fromEntries(new FormData(elements.form).entries());
    const payloadFormatado = {
      Tipo: formDados.tipo,
      Data: formDados.dataTransacao,
      Conta: formDados.conta,
      Valor: parseFloat(formDados.valor) || 0,
      Categoria: formDados.categoria,
      Descricao: formDados.descricao || ''
    };

    try {
      if (state.editingId && state.editingType === 'TRANSACTION') {
        await updateDoc(doc(db, "Transacoes", state.editingId), payloadFormatado);
      } else {
        await addDoc(collection(db, "Transacoes"), payloadFormatado);
      }
      closeModal();
      loadTransactions();
    } catch (error) {
      alert("Erro ao salvar transação: " + error.message);
    } finally {
      elements.submitBtn.disabled = false;
    }
  }

  async function deleteTransaction(id) {
    if (!confirm("Excluir?")) return;
    try {
      await deleteDoc(doc(db, "Transacoes", id));
      loadTransactions();
    } catch (error) {
      alert("Erro ao excluir: " + error.message);
    }
  }

  // --- OBJETIVOS E METAS COM APORTE ---
  async function loadGoals() {
    try {
      const querySnapshot = await getDocs(collection(db, "Objetivos"));
      const metasBrutas = querySnapshot.docs.map(doc => ({ ID: doc.id, ...doc.data() }));

      // Recalcula o progresso matemático para a interface gráfica
      state.goals = metasBrutas.map(goal => {
        const target = parseFloat(goal.ValorAlvo) || 0;
        const current = parseFloat(goal.ValorAtual) || 0;
        let percentage = target > 0 ? (current / target) * 100 : 0;
        return { ...goal, Progresso: parseFloat(Math.min(percentage, 100).toFixed(2)) };
      });

      renderGoals(state.goals);
    } catch (error) {
      console.error("Erro ao carregar objetivos:", error);
    }
  }

  function createGoalCard(goal) {
    const card = document.createElement('div'); card.className = 'goal-card';
    card.innerHTML = `
        <div class="goal-header"><h4>${goal.Nome}</h4>
          <div>
            <span class="goal-percentage">${goal.Progresso}%</span>
            <button class="btn-text" style="color: #2196F3; margin-left:8px;" onclick="AppController.openGoalDepositModal('${goal.ID}')" title="Aportar"><i class="fas fa-plus-circle"></i></button>
            <button class="btn-text" style="color: var(--primary-color); margin-left:8px;" onclick="AppController.editGoal('${goal.ID}')" title="Editar"><i class="fas fa-edit"></i></button>
            <button class="btn-text" style="color:#ff5252; margin-left:8px;" onclick="AppController.deleteGoal('${goal.ID}')" title="Excluir"><i class="fas fa-trash"></i></button>
          </div>
        </div>
        <div class="progress-container"><div class="progress-fill" style="width: 0%" data-target="${goal.Progresso}%"></div></div>
        <div class="goal-footer"><span>${currencyFormatter.format(goal.ValorAtual)}</span><span>de ${currencyFormatter.format(goal.ValorAlvo)}</span></div>`;
    return card;
  }

  function renderGoals(goals) {
    const dashContainer = elements.goalsContainer;
    const pageContainer = document.getElementById('goals-page-container');

    const countElem = document.getElementById('goals-page-count');
    const targetElem = document.getElementById('goals-page-total-target');
    const currentElem = document.getElementById('goals-page-total-current');
    const countBadge = document.getElementById('goals-count-badge');

    const safeGoals = goals || [];
    let totalTarget = 0;
    let totalCurrent = 0;

    safeGoals.forEach(g => {
      totalTarget += parseFloat(g.ValorAlvo) || 0;
      totalCurrent += parseFloat(g.ValorAtual) || 0;
    });

    if (countElem) countElem.innerText = safeGoals.length;
    if (targetElem) targetElem.innerText = currencyFormatter.format(totalTarget);
    if (currentElem) currentElem.innerText = currencyFormatter.format(totalCurrent);
    if (countBadge) countBadge.innerText = `${safeGoals.length} objetivo(s) cadastrado(s)`;

    if (dashContainer) {
      dashContainer.innerHTML = '';
      if (safeGoals.length === 0) {
        dashContainer.innerHTML = '<div style="color:#888; font-size:14px;">Nenhum objetivo.</div>';
      } else {
        safeGoals.forEach(goal => dashContainer.appendChild(createGoalCard(goal)));
      }
    }

    if (pageContainer) {
      pageContainer.innerHTML = '';
      if (safeGoals.length === 0) {
        pageContainer.innerHTML = '<div style="color:#888; font-size:14px;">Nenhum objetivo cadastrado.</div>';
      } else {
        safeGoals.forEach(goal => pageContainer.appendChild(createGoalCard(goal)));
      }
    }

    setTimeout(() => { document.querySelectorAll('.progress-fill').forEach(bar => { bar.style.width = bar.getAttribute('data-target'); }); }, 100);
  }

  function renderGoalsPage() {
    renderGoals(state.goals);
  }
  function openGoalModal() {
    state.editingId = null;
    state.editingType = null;
    elements.goalForm.reset();
    elements.submitGoalBtn.innerText = 'Salvar Objetivo';
    elements.goalModal.classList.remove('hidden');
  }
  function editGoal(id) {
    const g = state.goals.find(x => String(x.ID) === String(id)); if (!g) return;
    state.editingId = id; state.editingType = 'GOAL';
    document.querySelector(`#goal-form input[name="nome"]`).value = g.Nome;
    document.querySelector(`#goal-form input[name="valorAlvo"]`).value = g.ValorAlvo;

    const dateStr = g.DataLimite ? String(g.DataLimite).split('T')[0] : '';
    const dateInput = document.querySelector(`#goal-form input[name="dataLimite"]`);
    if (dateInput && dateInput._flatpickr) dateInput._flatpickr.setDate(dateStr);
    else if (dateInput) dateInput.value = dateStr;

    elements.submitGoalBtn.innerText = 'Atualizar Objetivo'; elements.goalModal.classList.remove('hidden');
  }
  function closeGoalModal() { elements.goalModal.classList.add('hidden'); elements.goalForm.reset(); state.editingId = null; state.editingType = null; elements.submitGoalBtn.innerText = 'Salvar Objetivo'; }

  async function submitGoal(event) {
    event.preventDefault();
    elements.submitGoalBtn.disabled = true;
    elements.submitGoalBtn.innerHTML = 'Salvando...';

    const formDados = Object.fromEntries(new FormData(elements.goalForm).entries());
    const payloadFormatado = {
      Nome: formDados.nome,
      ValorAlvo: parseFloat(formDados.valorAlvo) || 0,
      DataLimite: formDados.dataLimite || ''
    };

    try {
      if (state.editingId && state.editingType === 'GOAL') {
        await updateDoc(doc(db, "Objetivos", state.editingId), payloadFormatado);
      } else {
        // Na criação, injeta os campos iniciais
        payloadFormatado.ValorAtual = 0;
        payloadFormatado.Status = 'Ativo';
        await addDoc(collection(db, "Objetivos"), payloadFormatado);
      }
      closeGoalModal();
      loadGoals();
    } catch (error) {
      alert("Erro ao salvar objetivo: " + error.message);
    } finally {
      elements.submitGoalBtn.disabled = false;
    }
  }

  async function deleteGoal(id) {
    if (!confirm("Excluir meta?")) return;
    try {
      await deleteDoc(doc(db, "Objetivos", id));
      loadGoals();
    } catch (error) {
      alert("Erro ao excluir: " + error.message);
    }
  }

  function openGoalDepositModal(goalId) {
    const g = state.goals.find(x => String(x.ID) === String(goalId));
    if (!g) return;
    document.getElementById('gd-goal-id').value = g.ID;
    document.getElementById('gd-goal-name').value = g.Nome;
    document.getElementById('goal-deposit-modal').classList.remove('hidden');
  }
  function closeGoalDepositModal() {
    document.getElementById('goal-deposit-modal').classList.add('hidden');
    document.getElementById('goal-deposit-form').reset();
  }

  async function submitGoalDeposit(event) {
    event.preventDefault();
    const btn = document.getElementById('submit-gd-btn');
    btn.disabled = true;
    btn.innerText = 'Guardando...';

    const formDados = Object.fromEntries(new FormData(document.getElementById('goal-deposit-form')).entries());
    const depositAmount = parseFloat(formDados.valor) || 0;

    try {
      const goal = state.goals.find(g => String(g.ID) === String(formDados.id));
      if (!goal) throw new Error("Objetivo não encontrado.");

      const newVal = (parseFloat(goal.ValorAtual) || 0) + depositAmount;
      await updateDoc(doc(db, "Objetivos", goal.ID), { ValorAtual: newVal });

      closeGoalDepositModal();
      loadGoals();
    } catch (error) {
      alert("Erro ao salvar aporte: " + error.message);
    } finally {
      btn.disabled = false;
      btn.innerText = 'Confirmar Aporte';
    }
  }

  // --- CUSTOS FIXOS ---
  async function loadFixedCosts() {
    try {
      const querySnapshot = await getDocs(collection(db, "Custos Fixos"));
      state.fixedCosts = querySnapshot.docs.map(doc => ({ ID: doc.id, ...doc.data() }));

      // Ordena por dia de vencimento
      state.fixedCosts.sort((a, b) => (parseInt(a.DiaVencimento) || 0) - (parseInt(b.DiaVencimento) || 0));
      renderFixedCosts(state.fixedCosts);
    } catch (error) {
      console.error("Erro ao carregar custos fixos:", error);
    }
  }

  function createFixedCostListItem(cost, isPaid) {
    const li = document.createElement('li'); li.className = 'transaction-item';
    li.innerHTML = `
        <div class="item-details" style="flex: 1; min-width: 0; ${isPaid ? 'opacity:0.5;' : ''}">
          <strong>${cost.Nome}</strong>${isPaid ? '<span style="color:green; margin-left:5px; font-size:12px; font-weight:600;">(Pago)</span>' : '<span style="color:#ff9800; margin-left:5px; font-size:12px; font-weight:600;">(Pendente)</span>'}<br>
          <small style="color:#777;">Vence dia: ${cost.DiaVencimento}</small>
        </div>
        <div style="width: 170px; min-width: 170px; display: flex; justify-content: flex-end; margin-right: 15px; flex-shrink: 0;">
          <div class="item-value text-red" style="text-align: right; ${isPaid ? 'opacity:0.5;' : ''}">${currencyFormatter.format(cost.Valor)}</div>
        </div>
        <div style="display:flex; gap:10px; flex-shrink: 0;">
          ${!isPaid
        ? `<button class="btn-text" style="color:var(--primary-color);" onclick="AppController.markFixedCostPaid('${cost.ID}')" title="Pagar"><i class="fas fa-check-circle"></i> Pagar</button>`
        : `<button class="btn-text" style="color:#ff9800;" onclick="AppController.unmarkFixedCostPaid('${cost.ID}')" title="Desmarcar Pago"><i class="fas fa-undo"></i> Desmarcar</button>`
      }
          <button class="btn-text" style="color:var(--primary-color);" onclick="AppController.editFixedCost('${cost.ID}')" title="Editar"><i class="fas fa-edit"></i></button>
          <button class="btn-delete" onclick="AppController.deleteFixedCost('${cost.ID}')" title="Excluir"><i class="fas fa-trash"></i></button>
        </div>`;
    return li;
  }

  function renderFixedCosts(costs) {
    const selectedYYYYMM = getSelectedYYYYMM();
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
    safeCosts.forEach(cost => {
      const val = parseFloat(cost.Valor) || 0;
      totalCost += val;

      const paidList = cost.MesesPagos ? String(cost.MesesPagos).split(',').map(s => s.trim()).filter(Boolean) : [];
      const isPaid = paidList.includes(selectedYYYYMM);

      if (isPaid) totalPaid += val;
      else totalPending += val;
    });

    if (totalElem) totalElem.innerText = currencyFormatter.format(totalCost);
    if (paidElem) paidElem.innerText = currencyFormatter.format(totalPaid);
    if (pendingElem) pendingElem.innerText = currencyFormatter.format(totalPending);
    if (countBadge) countBadge.innerText = `${safeCosts.length} custo(s) cadastrado(s)`;

    if (dashContainer) {
      dashContainer.innerHTML = '';
      if (safeCosts.length === 0) {
        dashContainer.innerHTML = '<li style="color:#888; padding:15px;">Nenhum custo fixo.</li>';
      } else {
        safeCosts.forEach(cost => {
          const paidList = cost.MesesPagos ? String(cost.MesesPagos).split(',').map(s => s.trim()).filter(Boolean) : [];
          const isPaid = paidList.includes(selectedYYYYMM);
          dashContainer.appendChild(createFixedCostListItem(cost, isPaid));
        });
      }
    }

    if (pageContainer) {
      pageContainer.innerHTML = '';
      if (safeCosts.length === 0) {
        pageContainer.innerHTML = '<li style="color:#888; padding:15px;">Nenhum custo fixo cadastrado.</li>';
      } else {
        safeCosts.forEach(cost => {
          const paidList = cost.MesesPagos ? String(cost.MesesPagos).split(',').map(s => s.trim()).filter(Boolean) : [];
          const isPaid = paidList.includes(selectedYYYYMM);
          pageContainer.appendChild(createFixedCostListItem(cost, isPaid));
        });
      }
    }
  }

  function renderFixedCostsPage() {
    renderFixedCosts(state.fixedCosts);
  }
  function openFixedCostModal() {
    state.editingId = null;
    state.editingType = null;
    elements.fixedCostForm.reset();
    elements.submitFixedCostBtn.innerText = 'Salvar Custo Fixo';
    elements.fixedCostModal.classList.remove('hidden');
  }
  function editFixedCost(id) {
    const fc = state.fixedCosts.find(x => String(x.ID) === String(id)); if (!fc) return;
    state.editingId = id; state.editingType = 'FIXED_COST';
    document.querySelector(`#fixed-cost-form input[name="nome"]`).value = fc.Nome;
    document.querySelector(`#fixed-cost-form input[name="valor"]`).value = fc.Valor;
    document.querySelector(`#fixed-cost-form input[name="diaVencimento"]`).value = fc.DiaVencimento;
    elements.submitFixedCostBtn.innerText = 'Atualizar Custo';
    elements.fixedCostModal.classList.remove('hidden');
  }
  function closeFixedCostModal() {
    elements.fixedCostModal.classList.add('hidden'); elements.fixedCostForm.reset();
    state.editingId = null; state.editingType = null;
    elements.submitFixedCostBtn.innerText = 'Salvar Custo Fixo';
  }
  async function submitFixedCost(event) {
    event.preventDefault();
    elements.submitFixedCostBtn.disabled = true;
    elements.submitFixedCostBtn.innerHTML = 'Salvando...';

    const formDados = Object.fromEntries(new FormData(elements.fixedCostForm).entries());
    const payloadFormatado = {
      Nome: formDados.nome,
      Valor: parseFloat(formDados.valor) || 0,
      DiaVencimento: parseInt(formDados.diaVencimento) || 1
    };

    try {
      if (state.editingId && state.editingType === 'FIXED_COST') {
        await updateDoc(doc(db, "Custos Fixos", state.editingId), payloadFormatado);
      } else {
        payloadFormatado.Status = 'Pendente';
        payloadFormatado.MesesPagos = '';
        await addDoc(collection(db, "Custos Fixos"), payloadFormatado);
      }
      closeFixedCostModal();
      loadFixedCosts();
    } catch (error) {
      alert("Erro ao salvar custo fixo: " + error.message);
    } finally {
      elements.submitFixedCostBtn.disabled = false;
    }
  }

  async function deleteFixedCost(id) {
    if (!confirm("Excluir?")) return;
    try {
      await deleteDoc(doc(db, "Custos Fixos", id));
      loadFixedCosts();
    } catch (error) {
      alert("Erro ao excluir: " + error.message);
    }
  }

  async function submitFixedCostPay(event) {
    event.preventDefault();
    const btn = document.getElementById('submit-fc-pay-btn');

    try {
      // 1. Altera o visual do botão para "Processando..."
      if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processando...';
      }

      // 2. Busca o formulário no HTML
      const formElement = document.getElementById('fc-pay-form');
      if (!formElement) throw new Error("A tag <form> perdeu o id 'fc-pay-form'.");

      // 3. Extrai as informações que você preencheu na tela
      const formData = new FormData(formElement);
      const costId = formData.get('id');
      const contaNome = formData.get('conta');
      const categoriaNome = formData.get('categoria');

      // 4. Valida se tudo foi preenchido
      if (!costId) throw new Error("ID do custo fixo não encontrado.");
      if (!contaNome) throw new Error("Selecione uma conta bancária.");
      if (!categoriaNome) throw new Error("Selecione a categoria da despesa."); // <-- AVISA SE ESQUECER DE PREENCHER

      // 5. Encontra o Custo Fixo original no sistema
      const currentTargetMonth = getSelectedYYYYMM();
      const cost = state.fixedCosts.find(c => String(c.ID) === String(costId));
      if (!cost) throw new Error("Custo não encontrado na base de dados.");

      // 6. Atualiza o Custo Fixo no Firebase (Marca como 'Pago' no mês atual)
      let paidList = cost.MesesPagos ? String(cost.MesesPagos).split(',').map(s => s.trim()).filter(Boolean) : [];
      if (!paidList.includes(currentTargetMonth)) {
        paidList.push(currentTargetMonth);
      }
      await updateDoc(doc(db, "Custos Fixos", costId), { MesesPagos: paidList.join(','), Status: 'Pago' });

      // 7. Calcula o dia exato para o lançamento
      const amount = parseFloat(cost.Valor) || 0;
      const [yearStr, monthStr] = currentTargetMonth.split('-');
      const lastDayOfMonth = new Date(parseInt(yearStr, 10), parseInt(monthStr, 10), 0).getDate();
      const dueDayStr = String(Math.min(parseInt(cost.DiaVencimento || 1, 10), lastDayOfMonth)).padStart(2, '0');

      // 8. Lança a despesa automática no seu Extrato (Firebase)
      await addDoc(collection(db, "Transacoes"), {
        Tipo: 'DESPESA',
        Categoria: categoriaNome, // <-- AQUI ELE SALVA A CATEGORIA QUE VOCÊ ESCOLHEU
        Valor: amount,
        Descricao: `Pagamento autom.: ${cost.Nome}`,
        Conta: contaNome,
        Data: `${currentTargetMonth}-${dueDayStr}`
      });

      // 9. Atualiza a tela
      closeFixedCostPayModal();
      loadFixedCosts();
      loadTransactions();

    } catch (error) {
      console.error("Erro no pagamento:", error);
      alert(error.message);
    } finally {
      // 10. Devolve o botão ao normal, dando erro ou sucesso
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-check"></i> Confirmar Pagamento';
      }
    }
  }

  function closeFixedCostPayModal() {
    const modal = document.getElementById('fc-pay-modal');
    const form = document.getElementById('fc-pay-form');
    if (modal) modal.classList.add('hidden');
    if (form) form.reset();
  }

  function markFixedCostPaid(id) {
    const fc = state.fixedCosts.find(x => String(x.ID) === String(id));
    if (!fc) return;
    openFCPayModal(fc);
  }

  function openFCPayModal(fc) {
    document.getElementById('fc-pay-id').value = fc.ID;
    document.getElementById('fc-pay-name').innerText = fc.Nome;
    document.getElementById('fc-pay-value').innerText = currencyFormatter.format(parseFloat(fc.Valor) || 0);

    const select = document.getElementById('fc-pay-account');
    select.innerHTML = '<option value="" disabled selected>Selecione a conta...</option>';
    state.accounts.forEach(acc => {
      const opt = document.createElement('option');
      opt.value = acc.Nome;
      opt.text = acc.Nome;
      select.appendChild(opt);
    });
    upgradeSelects();

    document.getElementById('fc-pay-modal').classList.remove('hidden');
  }

  function closeFCPayModal() {
    document.getElementById('fc-pay-modal').classList.add('hidden');
    document.getElementById('fc-pay-form').reset();
  }

  async function unmarkFixedCostPaid(id) {
    if (!confirm("Desmarcar como pago? A despesa automática será removida do histórico.")) return;

    const currentTargetMonth = getSelectedYYYYMM();
    const cost = state.fixedCosts.find(c => String(c.ID) === String(id));
    if (!cost) return;

    try {
      // 1. Remove a marcação de pago
      let paidList = cost.MesesPagos ? String(cost.MesesPagos).split(',').map(s => s.trim()).filter(Boolean) : [];
      paidList = paidList.filter(m => m !== currentTargetMonth);
      await updateDoc(doc(db, "Custos Fixos", id), { MesesPagos: paidList.join(','), Status: paidList.length > 0 ? 'Pago' : 'Pendente' });

      // 2. Busca e remove a transação automática correspondente (se existir)
      const autoTx = state.transactions.find(t => {
        if (t.Tipo !== 'DESPESA' || !(t.Descricao && t.Descricao.includes(cost.Nome))) return false;
        const tMonth = t.Data ? String(t.Data).slice(0, 7) : '';
        return tMonth === currentTargetMonth;
      });

      if (autoTx && autoTx.ID) {
        await deleteDoc(doc(db, "Transacoes", autoTx.ID));
      }

      loadFixedCosts();
      loadTransactions();
    } catch (error) {
      alert("Erro ao desmarcar pagamento: " + error.message);
    }
  }

  // --- CARTÃO DE CRÉDITO & FATURAS ---
  async function loadCreditData() {
    try {
      const querySnapshot = await getDocs(collection(db, "Cartoes"));
      state.creditCards = querySnapshot.docs.map(doc => ({ ID: doc.id, ...doc.data() }));
      populateCCDropdown();
      loadCreditTransactions();
    } catch (error) {
      console.error("Erro ao carregar cartões:", error);
    }
  }

  async function loadCreditTransactions() {
    try {
      const querySnapshot = await getDocs(collection(db, "TransacoesCartao"));
      state.creditTransactions = querySnapshot.docs.map(doc => ({ ID: doc.id, ...doc.data() }));
      calculateInvoiceSum();
      renderCreditCardsPage();
    } catch (error) {
      console.error("Erro ao carregar faturas:", error);
    }
  }

  function populateCCDropdown() {
    if (!elements.cctCartaoSelect) return;
    elements.cctCartaoSelect.innerHTML = '<option value="" disabled selected>Selecione o cartão...</option>';
    state.creditCards.forEach(card => { const opt = document.createElement('option'); opt.value = card.ID; opt.text = card.Nome; elements.cctCartaoSelect.appendChild(opt); });
    upgradeSelects();
  }
  function calculateInvoiceSum() {
    const targetInvoiceStr = getSelectedYYYYMM();
    const invoiceTotal = state.creditTransactions.reduce((acc, current) => {
      if (current.MesFatura && String(current.MesFatura).startsWith(targetInvoiceStr)) return acc + (parseFloat(current.Valor) || 0);
      return acc;
    }, 0);
    if (elements.totalCreditCard) elements.totalCreditCard.innerText = currencyFormatter.format(invoiceTotal);
  }
  function openCCModal() { elements.ccModal.classList.remove('hidden'); }
  function closeCCModal() { elements.ccModal.classList.add('hidden'); elements.ccForm.reset(); }
  async function submitCC(event) {
    event.preventDefault();
    elements.submitCCBtn.disabled = true;
    elements.submitCCBtn.innerHTML = 'Salvando...';

    const formDados = Object.fromEntries(new FormData(elements.ccForm).entries());

    try {
      await addDoc(collection(db, "Cartoes"), {
        Nome: formDados.nome,
        Limite: parseFloat(formDados.limite) || 0,
        DiaFechamento: parseInt(formDados.diaFechamento) || 1,
        DiaVencimento: parseInt(formDados.diaVencimento) || 1
      });
      closeCCModal();
      loadCreditData();
    } catch (error) {
      alert("Erro ao salvar cartão: " + error.message);
    } finally {
      elements.submitCCBtn.disabled = false;
      elements.submitCCBtn.innerText = 'Salvar Cartão';
    }
  }
  function openCCTransModal() {
    if (state.creditCards.length === 0) { alert("Cadastre um Cartão primeiro."); return; }
    closeCCInvoiceModal();
    elements.ccTransModal.classList.remove('hidden');
    const localISO = new Date(new Date().getTime() - (new Date().getTimezoneOffset() * 60000)).toISOString().split('T')[0];

    const dateInput = document.getElementById('cct-data');
    if (dateInput && dateInput._flatpickr) dateInput._flatpickr.setDate(localISO);
    else if (dateInput) dateInput.value = localISO;
  }
  function closeCCTransModal() { elements.ccTransModal.classList.add('hidden'); elements.ccTransForm.reset(); }
  async function submitCCTrans(event) {
    event.preventDefault();
    elements.submitCCTransBtn.disabled = true;
    elements.submitCCTransBtn.innerText = 'Lançando...';

    const formDados = Object.fromEntries(new FormData(elements.ccTransForm).entries());
    const cardId = formDados.idCartao;
    const valorTotal = parseFloat(formDados.valor) || 0;
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
      alert("Erro ao lançar fatura: " + error.message);
    } finally {
      elements.submitCCTransBtn.disabled = false;
      elements.submitCCTransBtn.innerText = 'Lançar na Fatura';
    }
  }

  function openCCInvoiceModal() {
    const selectedYYYYMM = getSelectedYYYYMM();
    document.getElementById('invoice-period-title').innerText = selectedYYYYMM;
    renderInvoiceItems();
    document.getElementById('cc-invoice-modal').classList.remove('hidden');
  }
  function closeCCInvoiceModal() {
    document.getElementById('cc-invoice-modal').classList.add('hidden');
  }
  function renderInvoiceItems() {
    const container = document.getElementById('invoice-items-container');
    if (!container) return;
    const selectedYYYYMM = getSelectedYYYYMM();

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
      const li = document.createElement('li');
      li.className = 'transaction-item';
      li.innerHTML = `
          <div class="item-details" style="flex: 1; min-width: 0;">
            <strong>${item.Categoria} ${item.Descricao ? ' - ' + item.Descricao : ''}</strong><br>
            <small style="color: #888;">${cardName} • ${formatDateBR(item.Data) || item.Data || ''}</small>
          </div>
          <div style="width: 170px; min-width: 170px; display: flex; justify-content: flex-end; margin-right: 15px; flex-shrink: 0;">
            <div class="item-value text-red" style="text-align: right;">
              ${currencyFormatter.format(item.Valor)}
            </div>
          </div>
          <div style="flex-shrink: 0;">
            <button class="btn-delete" onclick="AppController.deleteCreditTransaction('${item.ID}')" title="Excluir"><i class="fas fa-trash"></i></button>
          </div>`;
      container.appendChild(li);
    });
  }

  async function deleteCreditTransaction(id) {
    if (!confirm("Excluir lançamento da fatura?")) return;
    try {
      await deleteDoc(doc(db, "TransacoesCartao", id));
      loadCreditTransactions();
      setTimeout(() => { renderInvoiceItems(); renderCreditCardsPage(); }, 300);
    } catch (error) {
      alert("Erro ao excluir: " + error.message);
    }
  }

  // --- RENDERIZAÇÃO DA ABA DEDICADA: CARTÕES & FATURAS ---
  function renderCreditCardsPage() {
    const titleElem = document.getElementById('cc-page-period-title');
    const totalElem = document.getElementById('cc-page-total-invoice');
    const cardsGrid = document.getElementById('cc-cards-grid');
    const itemsContainer = document.getElementById('cc-page-items-container');
    const countBadge = document.getElementById('cc-items-count-badge');

    const selectedYYYYMM = getSelectedYYYYMM();
    if (titleElem) titleElem.innerText = selectedYYYYMM;

    const invoiceItems = state.creditTransactions.filter(ct => {
      return ct.MesFatura && String(ct.MesFatura).startsWith(selectedYYYYMM);
    });

    const totalInvoiceVal = invoiceItems.reduce((acc, current) => acc + (parseFloat(current.Valor) || 0), 0);
    if (totalElem) totalElem.innerText = currencyFormatter.format(totalInvoiceVal);
    if (countBadge) countBadge.innerText = `${invoiceItems.length} registro(s)`;

    if (cardsGrid) {
      cardsGrid.innerHTML = '';
      if (state.creditCards.length === 0) {
        cardsGrid.innerHTML = '<div style="color:#888; padding:15px;">Nenhum cartão de crédito cadastrado.</div>';
      } else {
        state.creditCards.forEach(card => {
          const cardDiv = document.createElement('div');
          cardDiv.className = 'summary-card';
          cardDiv.style.flexDirection = 'column';
          cardDiv.style.alignItems = 'flex-start';
          cardDiv.style.gap = '8px';

          const limitVal = parseFloat(card.Limite) || 0;
          const cardTxns = state.creditTransactions.filter(ct => String(ct.IdCartao || ct.CartaoID) === String(card.ID));
          const usedLimit = cardTxns.reduce((sum, item) => sum + (parseFloat(item.Valor) || 0), 0);
          const remainingLimit = limitVal - usedLimit;
          const remClass = remainingLimit < 0 ? 'text-red' : 'text-green';

          cardDiv.innerHTML = `
              <div style="display:flex; justify-content:space-between; width:100%; align-items:center;">
                <strong style="font-size:16px; color:#333;"><i class="fas fa-credit-card" style="color:var(--primary-color); margin-right:8px;"></i>${card.Nome}</strong>
                <span style="font-size:12px; color:#777; background:#f0f0f0; padding:2px 8px; border-radius:10px;">${card.Bandeira || 'Cartão'}</span>
              </div>
              <div style="font-size:13px; color:#666; margin-top:4px;">
                Limite: <strong>${currencyFormatter.format(limitVal)}</strong>
              </div>
              <div style="font-size:13px; color:#666; margin-top:2px;">
                Saldo Restante: <strong class="${remClass}">${currencyFormatter.format(remainingLimit)}</strong>
              </div>
              <div style="font-size:12px; color:#888; display:flex; gap:15px; margin-top:4px;">
                <span>Fecha dia: <strong>${card.DiaFechamento || '--'}</strong></span>
                <span>Vence dia: <strong>${card.DiaVencimento || '--'}</strong></span>
              </div>`;
          cardsGrid.appendChild(cardDiv);
        });
      }
    }

    if (itemsContainer) {
      itemsContainer.innerHTML = '';
      if (invoiceItems.length === 0) {
        itemsContainer.innerHTML = '<li style="padding:15px; color:#888;">Nenhum lançamento nesta fatura para o mês selecionado.</li>';
      } else {
        invoiceItems.forEach(item => {
          const cardObj = state.creditCards.find(c => String(c.ID) === String(item.IdCartao || item.CartaoID));
          const cardName = cardObj ? cardObj.Nome : 'Cartão';

          const li = document.createElement('li');
          li.className = 'transaction-item';
          li.innerHTML = `
              <div class="item-details" style="flex: 1; min-width: 0;">
                <strong>${item.Categoria} ${item.Descricao ? ' - ' + item.Descricao : ''}</strong><br>
                <small style="color: #888;">${cardName} • ${formatDateBR(item.Data) || item.Data || ''}</small>
              </div>
              <div style="width: 170px; min-width: 170px; display: flex; justify-content: flex-end; margin-right: 15px; flex-shrink: 0;">
                <div class="item-value text-red" style="text-align: right;">
                  ${currencyFormatter.format(item.Valor)}
                </div>
              </div>
              <div style="flex-shrink: 0;">
                <button class="btn-delete" onclick="AppController.deleteCreditTransaction('${item.ID}')" title="Excluir"><i class="fas fa-trash"></i></button>
              </div>`;
          itemsContainer.appendChild(li);
        });
      }
    }
  }

  // --- RENDERIZAÇÃO DA ABA DEDICADA: MINHAS CONTAS ---
  function renderAccountsPage() {
    const totalElem = document.getElementById('acc-page-total-balance');
    const countBadge = document.getElementById('acc-count-badge');
    const gridContainer = document.getElementById('acc-page-grid');

    const today = new Date();
    today.setHours(23, 59, 59, 999);

    const balances = {};
    state.accounts.forEach(acc => { balances[acc.Nome] = parseFloat(acc.SaldoInicial) || 0; });

    state.transactions.forEach(t => {
      const tDate = parseLocalDate(t.Data);
      if (tDate > today) return;

      if (t.Conta && balances[t.Conta] !== undefined) {
        const amount = parseFloat(t.Valor) || 0;
        if (t.Tipo === 'RECEITA') balances[t.Conta] += amount;
        else if (t.Tipo === 'DESPESA') balances[t.Conta] -= amount;
      }
    });

    const baseBalance = state.accounts.reduce((acc, currentAcc) => acc + (parseFloat(currentAcc.SaldoInicial) || 0), 0);
    const globalSummary = state.transactions.reduce((acc, current) => {
      const tDate = parseLocalDate(current.Data);
      if (tDate <= today) {
        const amount = parseFloat(current.Valor) || 0;
        if (current.Tipo === 'RECEITA') acc.income += amount;
        else if (current.Tipo === 'DESPESA') acc.expense += amount;
      }
      return acc;
    }, { income: 0, expense: 0 });

    const currentGlobalBalance = baseBalance + globalSummary.income - globalSummary.expense;
    if (totalElem) totalElem.innerText = currencyFormatter.format(currentGlobalBalance);
    if (countBadge) countBadge.innerText = `${state.accounts.length} conta(s)`;

    if (gridContainer) {
      gridContainer.innerHTML = '';
      if (state.accounts.length === 0) {
        gridContainer.innerHTML = '<div style="color:#888; padding:15px;">Nenhuma conta bancária cadastrada.</div>';
      } else {
        state.accounts.forEach(acc => {
          const bal = balances[acc.Nome];
          const bClass = bal < 0 ? 'text-red' : 'text-green';
          const card = document.createElement('div');
          card.className = 'summary-card';
          card.style.flexDirection = 'column';
          card.style.alignItems = 'flex-start';
          card.style.gap = '10px';
          card.style.padding = '20px';

          card.innerHTML = `
              <div style="display:flex; justify-content:space-between; width:100%; align-items:center;">
                <strong style="font-size:16px; color:#333;"><i class="fas fa-university" style="color:#2196F3; margin-right:8px;"></i>${acc.Nome}</strong>
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

  // --- CÁLCULO E RENDERIZAÇÃO DO DASHBOARD DE PLANEJAMENTO ---
  async function loadPlanning() {
    try {
      const querySnapshot = await getDocs(collection(db, "Planejamento"));
      state.planning = querySnapshot.docs.map(doc => ({ ID: doc.id, ...doc.data() }));
      renderPlanningDashboard();
    } catch (error) {
      console.error("Erro ao carregar planejamento:", error);
    }
  }

  function renderPlanningView() {
    renderPlanningDashboard();
  }

  function renderPlanningDashboard() {
    const selectedYYYYMM = getSelectedYYYYMM();
    // BLINDAGEM CONTRA O SHEETS AQUI (Prefixo PLAN-)
    const monthPlans = state.planning.filter(p => String(p.MesReferencia).trim() === ("PLAN-" + selectedYYYYMM));

    const introView = document.getElementById('planning-intro');
    const wizardView = document.getElementById('planning-wizard');
    const dashView = document.getElementById('planning-dashboard');

    // Se não houver dados, mostra a introdução
    if (!monthPlans || monthPlans.length === 0) {
      if (introView) introView.classList.remove('hidden');
      if (wizardView) wizardView.classList.add('hidden');
      if (dashView) dashView.classList.add('hidden');
      return;
    }

    // Esconde Intro e Wizard, Mostra Dashboard
    if (introView) introView.classList.add('hidden');
    if (wizardView) wizardView.classList.add('hidden');
    if (dashView) dashView.classList.remove('hidden');

    // Pega os dados do primeiro registro (Renda e % são iguais para todas as categorias)
    const basePlan = monthPlans[0];
    const totalIncome = parseFloat(basePlan.Renda) || 0;
    const savingsPct = parseFloat(basePlan.EconomiaPct) || 0;
    const totalPlanned = monthPlans.reduce((sum, p) => sum + (parseFloat(p.ValorLimite) || 0), 0);

    // Preenche o título do mês
    const mObj = monthLabels.find(m => m.number === monthPickerState.selectedMonth);
    const monthLabel = mObj ? `${mObj.full} ${monthPickerState.selectedYear}` : selectedYYYYMM;
    const dashMonthEl = document.getElementById('dash-month-label');
    if (dashMonthEl) dashMonthEl.innerText = monthLabel;

    // Coluna direita: Receitas, Gastos Planejados, Balanço e Economia
    const dashIncomeEl = document.getElementById('dash-income');
    if (dashIncomeEl) dashIncomeEl.innerText = currencyFormatter.format(totalIncome);

    const dashPlannedEl = document.getElementById('dash-planned');
    if (dashPlannedEl) dashPlannedEl.innerText = currencyFormatter.format(totalPlanned);

    const balance = totalIncome - totalPlanned;
    const dashBalanceEl = document.getElementById('dash-balance');
    if (dashBalanceEl) dashBalanceEl.innerText = currencyFormatter.format(balance);

    const dashSavingsPctEl = document.getElementById('dash-savings-pct');
    if (dashSavingsPctEl) dashSavingsPctEl.innerText = `${savingsPct.toFixed(2)}%`;

    // --- Cruza dados do planejamento com transações reais do mês ---
    const monthlyTransactions = state.transactions.filter(t => {
      if (!t.Data) return false;
      const tDate = parseLocalDate(t.Data);
      const tMonth = String(tDate.getMonth() + 1).padStart(2, '0');
      const tYear = tDate.getFullYear();
      return `${tYear}-${tMonth}` === selectedYYYYMM;
    });

    const today = new Date();
    today.setHours(23, 59, 59, 999);

    // Gastos reais por categoria (pagos = efetivados, previstos = futuros)
    const paidByCategory = {};
    const pendingByCategory = {};
    monthlyTransactions.forEach(t => {
      if (t.Tipo !== 'DESPESA' || isTransferTransaction(t)) return;
      const cat = t.Categoria || 'Outros';
      const val = parseFloat(t.Valor) || 0;
      const tDate = parseLocalDate(t.Data);
      if (tDate <= today) {
        paidByCategory[cat] = (paidByCategory[cat] || 0) + val;
      } else {
        pendingByCategory[cat] = (pendingByCategory[cat] || 0) + val;
      }
    });

    let totalPaid = 0;
    let totalPending = 0;

    // Renderiza a tabela de categorias
    const tbody = document.getElementById('dash-categories-list');
    if (tbody) {
      tbody.innerHTML = '';
      monthPlans.forEach(cat => {
        const limitValue = parseFloat(cat.ValorLimite) || 0;
        const catName = cat.Categoria;
        const paid = paidByCategory[catName] || 0;
        const pending = pendingByCategory[catName] || 0;
        const totalSpent = paid + pending;

        totalPaid += paid;
        totalPending += pending;

        const catStyle = getCategoryStyleGlobal(catName);
        const spentClass = totalSpent > limitValue ? 'text-red' : '';

        const tr = document.createElement('tr');
        tr.className = 'tx-tr';
        tr.innerHTML = `
            <td class="tx-td">
              <div class="cat-badge-container">
                <div class="cat-icon-circle" style="background-color: ${catStyle.color};">
                  <i class="fas ${catStyle.icon}"></i>
                </div>
                <span>${catName}</span>
              </div>
            </td>
            <td class="tx-td" style="font-weight: 600;">${currencyFormatter.format(limitValue)}</td>
            <td class="tx-td text-green">${currencyFormatter.format(paid)}</td>
            <td class="tx-td text-muted">${currencyFormatter.format(pending)}</td>
            <td class="tx-td ${spentClass}" style="font-weight: 600;">${currencyFormatter.format(totalSpent)}</td>
            <td class="tx-td" style="text-align: center;">
              <button class="btn-text" style="color: #888;" title="Editar"><i class="fas fa-pen"></i></button>
            </td>
          `;
        tbody.appendChild(tr);
      });
    }

    // Resumo superior da tabela
    const totalSpentAll = totalPaid + totalPending;
    const remainingBudget = totalPlanned - totalSpentAll;

    const dashRemainingEl = document.getElementById('dash-remaining-budget');
    if (dashRemainingEl) dashRemainingEl.innerText = currencyFormatter.format(Math.max(remainingBudget, 0));

    const dashSpentInfoEl = document.getElementById('dash-spent-info');
    if (dashSpentInfoEl) dashSpentInfoEl.innerText = `${currencyFormatter.format(totalSpentAll)} de ${currencyFormatter.format(totalPlanned)} gastos`;

    // Barra de progresso
    const barPct = totalPlanned > 0 ? Math.min((totalSpentAll / totalPlanned) * 100, 100) : 0;
    const dashBarEl = document.getElementById('dash-main-bar');
    if (dashBarEl) {
      dashBarEl.style.width = `${barPct}%`;
      dashBarEl.style.background = barPct > 90 ? '#F44336' : 'var(--primary-color)';
    }
  }

  // Função auxiliar global para estilos de categoria (reutilizada no planning dashboard)
  function getCategoryStyleGlobal(cat) {
    const styles = {
      'Alimentação': { icon: 'fa-utensils', color: '#E91E63' },
      'Salário': { icon: 'fa-money-bill-wave', color: '#F44336' },
      'Investimentos': { icon: 'fa-chart-line', color: '#8BC34A' },
      'Moradia / Contas': { icon: 'fa-home', color: '#3F51B5' },
      'Transporte': { icon: 'fa-car', color: '#FF9800' },
      'Lazer': { icon: 'fa-cocktail', color: '#9C27B0' },
      'Saúde': { icon: 'fa-heartbeat', color: '#00BCD4' },
      'Educação': { icon: 'fa-book', color: '#607D8B' },
      'Supermercado': { icon: 'fa-shopping-cart', color: '#795548' },
      'Bar / Restaurante': { icon: 'fa-wine-glass-alt', color: '#BA68C8' },
      'Eletrônicos': { icon: 'fa-laptop', color: '#607D8B' },
      'Roupas': { icon: 'fa-tshirt', color: '#FF5722' },
      'Outros': { icon: 'fa-tag', color: '#9e9e9e' }
    };
    return styles[cat] || { icon: 'fa-tag', color: '#9e9e9e' };
  }

  // --- LÓGICA DO WIZARD DE PLANEJAMENTO ---
  const wizardState = {
    income: 0,
    savingsPct: 20,
    budget: 0,
    savingsAmount: 0
  };

  function startPlanningWizard() {
    document.getElementById('planning-intro').classList.add('hidden');
    document.getElementById('planning-dashboard').classList.add('hidden');
    document.getElementById('planning-wizard').classList.remove('hidden');
    document.getElementById('wizard-step-1').classList.remove('hidden');
    document.getElementById('wizard-step-2').classList.add('hidden');
    document.getElementById('wizard-step-3').classList.add('hidden');
    document.getElementById('wizard-breadcrumbs').innerHTML = '<strong>Renda mensal</strong>';
    calculateWizardBudget();
  }

  function cancelPlanningWizard() {
    document.getElementById('planning-wizard').classList.add('hidden');
    document.getElementById('planning-intro').classList.remove('hidden');
  }

  async function copyPreviousPlanning() {
    try {
      const querySnapshot = await getDocs(collection(db, "Planejamento"));
      const allPlans = querySnapshot.docs.map(doc => doc.data());
      if (allPlans.length === 0) return alert("Nenhum planejamento anterior encontrado.");

      const sorted = [...allPlans].sort((a, b) => String(b.MesReferencia).localeCompare(String(a.MesReferencia)));
      const latestMonth = sorted[0].MesReferencia;
      const prev = sorted.filter(r => r.MesReferencia === latestMonth);

      wizardState.income = parseFloat(prev[0].Renda) || 0;
      wizardState.savingsPct = parseFloat(prev[0].EconomiaPct) || 20;
      wizardState.cardPreference = prev[0].PrefCartao || 'FATURA';
      wizardState.categories = {};

      prev.forEach(r => {
        if (r.Categoria && parseFloat(r.ValorLimite) > 0) {
          wizardState.categories[r.Categoria] = parseFloat(r.ValorLimite);
        }
      });

      const incomeInput = document.getElementById('wiz-income');
      if (incomeInput) incomeInput.value = currencyFormatter.format(wizardState.income);
      const pctInput = document.getElementById('wiz-savings-pct');
      if (pctInput) pctInput.value = wizardState.savingsPct;

      startPlanningWizard();
      alert(`Planejamento copiado com sucesso!`);
    } catch (error) {
      console.error("Erro ao copiar planejamento:", error);
    }
  }

  function maskCurrency(input) {
    let value = input.value.replace(/\D/g, "");
    value = (value / 100).toFixed(2) + "";
    value = value.replace(".", ",");
    value = value.replace(/(\d)(?=(\d{3})+(?!\d))/g, "$1.");
    input.value = "R$ " + value;
  }

  function calculateWizardBudget() {
    const incomeInput = document.getElementById('wiz-income').value;
    const rawIncome = parseFloat(incomeInput.replace("R$ ", "").replace(/\./g, "").replace(",", ".")) || 0;

    const pctInput = parseFloat(document.getElementById('wiz-savings-pct').value) || 0;
    const safePct = Math.min(Math.max(pctInput, 0), 100); // Trava entre 0 e 100%

    wizardState.income = rawIncome;
    wizardState.savingsPct = safePct;
    wizardState.savingsAmount = (rawIncome * safePct) / 100;
    wizardState.budget = rawIncome - wizardState.savingsAmount;

    document.getElementById('wiz-calc-budget').innerText = currencyFormatter.format(wizardState.budget);
    document.getElementById('wiz-calc-savings').innerText = currencyFormatter.format(wizardState.savingsAmount);
  }

  // Define a variável "categories" no objeto wizardState existente
  wizardState.categories = {};

  const defaultCategories = [
    { name: 'Moradia / Contas', icon: 'fa-home', color: '#3F51B5' },
    { name: 'Alimentação', icon: 'fa-utensils', color: '#E91E63' },
    { name: 'Transporte', icon: 'fa-car', color: '#FF9800' },
    { name: 'Saúde', icon: 'fa-heartbeat', color: '#00BCD4' },
    { name: 'Educação', icon: 'fa-book', color: '#607D8B' },
    { name: 'Lazer', icon: 'fa-cocktail', color: '#9C27B0' },
    { name: 'Supermercado', icon: 'fa-shopping-cart', color: '#795548' },
    { name: 'Bar / Restaurante', icon: 'fa-wine-glass-alt', color: '#BA68C8' },
    { name: 'Eletrônicos', icon: 'fa-laptop', color: '#607D8B' },
    { name: 'Roupas', icon: 'fa-tshirt', color: '#FF5722' },
    { name: 'Outros', icon: 'fa-tag', color: '#9e9e9e' }
  ];

  function renderWizardCategories() {
    const container = document.getElementById('wizard-categories-list');
    if (!container) return;
    container.innerHTML = '';

    defaultCategories.forEach(cat => {
      const val = wizardState.categories[cat.name] || 0;

      const card = document.createElement('div');
      card.className = 'wiz-cat-card';
      card.innerHTML = `
          <div style="display: flex; align-items: center; gap: 15px;">
            <div class="wiz-cat-icon" style="background-color: ${cat.color};">
              <i class="fas ${cat.icon}"></i>
            </div>
            <strong style="font-size: 16px; color: #333;">${cat.name}</strong>
          </div>
          <div class="wiz-cat-input-group">
            <label>Total</label>
            <input type="text" class="wiz-cat-input" data-category="${cat.name}" value="R$ ${val.toFixed(2).replace('.', ',')}" oninput="AppController.maskCurrency(this); AppController.calculateWizardCategoryTotals()">
          </div>
        `;
      container.appendChild(card);
    });
    calculateWizardCategoryTotals(); // Faz o cálculo inicial assim que carrega
  }

  function calculateWizardCategoryTotals() {
    const inputs = document.querySelectorAll('.wiz-cat-input');
    let sum = 0;

    inputs.forEach(input => {
      const catName = input.getAttribute('data-category');
      const rawVal = parseFloat(input.value.replace("R$ ", "").replace(/\./g, "").replace(",", ".")) || 0;
      wizardState.categories[catName] = rawVal;
      sum += rawVal;
    });

    const remaining = wizardState.budget - sum;

    // Atualiza os Textos
    document.getElementById('wiz-sum-categorized').innerText = currencyFormatter.format(sum);
    const remainingEl = document.getElementById('wiz-sum-remaining');

    if (remaining < 0) {
      remainingEl.innerText = `${currencyFormatter.format(Math.abs(remaining))} excedido do orçamento`;
      remainingEl.style.color = '#F44336';
    } else {
      remainingEl.innerText = `${currencyFormatter.format(remaining)} sem categorização`;
      remainingEl.style.color = '#888';
    }

    // Atualiza o Gráfico Circular (Anel de Progresso)
    const pct = wizardState.budget > 0 ? (sum / wizardState.budget) * 100 : 0;
    const safePct = Math.min(pct, 100);
    const ring = document.querySelector('.progress-ring');

    if (ring) {
      let ringColor = 'var(--primary-color)';
      if (pct > 100) ringColor = '#F44336'; // Fica vermelho se ultrapassar 100%
      ring.style.background = `conic-gradient(${ringColor} ${safePct}%, #f1f5f9 ${safePct}%)`;
    }
  }

  // Navegação Reversa (Voltar)
  function prevWizardStep(stepNumber) {
    if (stepNumber === 1) {
      document.getElementById('wizard-step-2').classList.add('hidden');
      document.getElementById('wizard-step-1').classList.remove('hidden');
      document.getElementById('wizard-breadcrumbs').innerHTML = '<strong>Renda mensal</strong>';
    } else if (stepNumber === 2) {
      document.getElementById('wizard-step-3').classList.add('hidden');
      document.getElementById('wizard-step-2').classList.remove('hidden');
      document.getElementById('wizard-breadcrumbs').innerHTML = '<span style="color:#aaa;">Renda mensal</span> <span style="margin: 0 5px;">/</span> <strong>Categorização de gastos</strong>';
    }
  }

  // Navegação de Avanço (Substitua a sua função atual por esta)
  function nextWizardStep(stepNumber) {
    if (stepNumber === 2) {
      if (wizardState.income <= 0) return alert("Por favor, informe uma renda.");
      document.getElementById('wizard-step-1').classList.add('hidden');
      document.getElementById('wizard-step-2').classList.remove('hidden');
      document.getElementById('wizard-breadcrumbs').innerHTML = '<span style="color:#aaa;">Renda mensal</span> <span style="margin: 0 5px;">/</span> <strong>Categorização de gastos</strong>';
      renderWizardCategories();
    }
    else if (stepNumber === 3) {
      document.getElementById('wizard-step-2').classList.add('hidden');
      document.getElementById('wizard-step-3').classList.remove('hidden');
      document.getElementById('wizard-breadcrumbs').innerHTML = '<span style="color:#aaa;">Renda mensal / Categorização de gastos</span> <span style="margin: 0 5px;">/</span> <strong>Visualização das despesas do cartão</strong>';
      if (!wizardState.cardPreference) selectCardPreference('FATURA'); // Padrão
    }
  }

  // Define a preferência visual do cartão
  function selectCardPreference(pref) {
    wizardState.cardPreference = pref;
    document.getElementById('rc-COMPRA').classList.remove('active');
    document.getElementById('rc-FATURA').classList.remove('active');
    document.querySelector('#rc-COMPRA input').checked = false;
    document.querySelector('#rc-FATURA input').checked = false;

    document.getElementById(`rc-${pref}`).classList.add('active');
    document.querySelector(`#rc-${pref} input`).checked = true;
  }
  // FINALIZAÇÃO DO WIZARD E RENDERIZAÇÃO DO DASHBOARD
  async function finishPlanningWizard() {
    const btn = document.querySelector('#wizard-step-3 .plan-main-btn');
    const originalBtnText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = 'Salvando... <i class="fas fa-spinner fa-spin" style="margin-left: 8px;"></i>';

    const monthStr = getSelectedYYYYMM();
    const searchKey = "PLAN-" + monthStr;

    try {
      // 1. Limpa os planejamentos antigos do mesmo mês
      const querySnapshot = await getDocs(collection(db, "Planejamento"));
      const deletePromises = [];
      querySnapshot.docs.forEach(docSnap => {
        if (String(docSnap.data().MesReferencia).trim() === searchKey) {
          deletePromises.push(deleteDoc(doc(db, "Planejamento", docSnap.id)));
        }
      });
      await Promise.all(deletePromises);

      // 2. Salva as novas metas por categoria
      const insertPromises = [];
      for (const [catName, val] of Object.entries(wizardState.categories)) {
        if (parseFloat(val) > 0) {
          insertPromises.push(addDoc(collection(db, "Planejamento"), {
            MesReferencia: searchKey,
            Renda: parseFloat(wizardState.income),
            EconomiaPct: parseFloat(wizardState.savingsPct),
            PrefCartao: wizardState.cardPreference,
            Categoria: catName,
            ValorLimite: parseFloat(val)
          }));
        }
      }
      await Promise.all(insertPromises);

      document.getElementById('planning-wizard').classList.add('hidden');
      document.getElementById('planning-dashboard').classList.remove('hidden');
      loadPlanning();
    } catch (error) {
      alert("Erro ao salvar planejamento: " + error.message);
    } finally {
      btn.disabled = false;
      btn.innerHTML = originalBtnText;
    }
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

  return {
    init, switchTab, setTransactionFilter, renderCreditCardsPage, renderFixedCostsPage, renderGoalsPage, renderAccountsPage, renderPlanningView, openMonthPicker, closeMonthPicker, changePickerYear, selectCurrentMonth, openModal, closeModal, submitTransaction, editTransaction, deleteTransaction, openAccountModal, closeAccountModal, submitAccount, openTransferModal, closeTransferModal, submitTransfer,
    openGoalModal, closeGoalModal, submitGoal, editGoal, deleteGoal, openGoalDepositModal, closeGoalDepositModal, submitGoalDeposit,
    openFixedCostModal, closeFixedCostModal, submitFixedCost, editFixedCost, deleteFixedCost, markFixedCostPaid, unmarkFixedCostPaid, openFCPayModal, closeFCPayModal, openCCModal, closeCCModal, submitCC, openCCTransModal, closeCCTransModal, submitCCTrans, openCCInvoiceModal, closeCCInvoiceModal, deleteCreditTransaction, toggleFabMenu, closeFabMenu, openNewTransaction, openNewCCTransaction, openNewTransfer, startPlanningWizard, cancelPlanningWizard, copyPreviousPlanning, maskCurrency, calculateWizardBudget, prevWizardStep, nextWizardStep, calculateWizardCategoryTotals, renderWizardCategories, selectCardPreference, finishPlanningWizard, closeFixedCostPayModal, submitFixedCostPay, logout
  };
})();

document.addEventListener('DOMContentLoaded', AppController.init);

window.AppController = AppController;