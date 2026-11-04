import { db } from './firebase';
import { collection, getDocs, addDoc, updateDoc, deleteDoc, doc, setDoc, getDoc, query, where } from 'firebase/firestore';
import { auth } from './firebase.js';
import { signInWithEmailAndPassword, onAuthStateChanged, signOut, createUserWithEmailAndPassword, sendPasswordResetEmail, updatePassword } from "firebase/auth";
import { ChartManager } from './charts.js';
import { ICON_LIST, COLOR_PALETTE, DEFAULT_CATEGORIES, iconSvg, inkFor, isHexColor, isValidIcon } from './categories.js';


const AppController = (function () {
  // VARIÁVEL PARA O GRÁFICO
  let expensesChartInstance = null;

  // UTILITÁRIO ANTI-XSS
  function escapeHTML(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function getCurrentUserId() {
    return auth.currentUser ? auth.currentUser.uid : null;
  }

  async function fetchUserScopedDocs(collectionName) {
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

  const OWNED_COLLECTIONS = ["Transacoes", "Contas", "Cartoes", "TransacoesCartao", "Objetivos", "AportesObjetivo", "CustosFixos", "Planejamento", "Categorias", "Eventos"];

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

  // 1. ESTADO
  const state = {
    accounts: [], creditCards: [], creditTransactions: [],
    transactions: [], goals: [], fixedCosts: [], planning: [],
    editingId: null, editingType: null, currentTab: 'dashboard',
    txFilter: 'ALL'
  };

  // ── Bloqueio de rolagem da página com modal aberto ──
  const MODAL_SELECTOR = '.modal-overlay:not(.hidden), .confirm-overlay, .dp-overlay';

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

  // Transações marcadas como "Ignorar" não entram em totais, saldos, gráficos nem planejamento
  const activeTransactions = () => state.transactions.filter(t => !t.Ignorar);

  // Arredonda para centavos e elimina o -0 gerado por erros de ponto flutuante
  function roundCents(value) {
    return Math.round((parseFloat(value) || 0) * 100) / 100 + 0;
  }

  function balanceClass(bal) {
    if (bal < 0) return 'text-red';
    return bal === 0 ? 'text-zero' : 'text-green';
  }

  function parseCurrencyMask(str) {
    if (typeof str === 'number') return str;
    if (!str) return 0;

    const rawVal = str.replace(/\D/g, '');
    return (parseFloat(rawVal) / 100) || 0;
  }

  state.txSortCol = 'Data';
  state.txSortDir = 'desc';

  state.currentGoalId = null;
  state.currentGoalDeposits = [];
  state.goalsSortOrder = 'DATA'; // Começa organizando pela data de conclusão
  let goalDonutChartInstance = null;

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

  // ── Categorias ──
  const freshDefaultCategories = () => DEFAULT_CATEGORIES.map((c, i) => ({ ...c, ID: `def-${i}` }));
  state.categories = freshDefaultCategories();
  state.categoriesPersisted = false;
  state.catUI = { kind: 'DESPESA', editingId: null, formKind: 'DESPESA', color: COLOR_PALETTE[0], icon: 'tag', touched: false };

  let categoriesSeeding = false;
  const stripAccents = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
  const catKey = (s) => stripAccents(s).trim().toLowerCase();
  const safeId = (id) => String(id).replace(/[^\w-]/g, '');
  const byCatOrder = (a, b) => a.Ordem - b.Ordem || a.Nome.localeCompare(b.Nome, 'pt-BR');
  const findCategory = (id) => (id ? state.categories.find(c => c.ID === id) || null : null);
  const catParents = (kind) => state.categories.filter(c => !c.ParentId && (!kind || c.Tipo === kind)).sort(byCatOrder);
  const catChildren = (id) => state.categories.filter(c => c.ParentId === id).sort(byCatOrder);

  function normalizeCategory(raw) {
    return {
      ID: raw.ID,
      Nome: String(raw.Nome || '').trim().slice(0, 40),
      Cor: isHexColor(raw.Cor) ? raw.Cor : '#9e9e9e',
      Icone: isValidIcon(raw.Icone) ? raw.Icone : 'tag',
      Tipo: raw.Tipo === 'RECEITA' ? 'RECEITA' : 'DESPESA',
      ParentId: raw.ParentId || null,
      Ordem: Number.isFinite(Number(raw.Ordem)) ? Number(raw.Ordem) : 0
    };
  }

  /** Estilo (ícone Lucide + cores) de uma categoria pelo nome gravado na transação. */
  function getCategoryStyle(name) {
    const key = catKey(name);
    const cat = state.categories.find(c => catKey(c.Nome) === key);
    const color = cat ? cat.Cor : '#9e9e9e';
    return { icon: cat ? cat.Icone : 'tag', color, ink: inkFor(color) };
  }

  const categoryIconHTML = (style, size = 14) => iconSvg(style.icon, size);

  async function loadCategories() {
    const uid = getCurrentUserId();
    if (!uid) return;
    state.categories = freshDefaultCategories();
    state.categoriesPersisted = false;

    try {
      const snap = await getDocs(query(collection(db, "Categorias"), where("userId", "==", uid)));
      let list = snap.docs.map(d => normalizeCategory({ ID: d.id, ...d.data() })).filter(c => c.Nome);

      if (list.length === 0 && !categoriesSeeding) {
        // Primeira vez do usuário: grava as categorias padrão para ele poder editá-las
        categoriesSeeding = true;
        try {
          list = await Promise.all(DEFAULT_CATEGORIES.map(async (c) => {
            const ref = await addDoc(collection(db, "Categorias"), { userId: uid, ...c });
            return normalizeCategory({ ID: ref.id, ...c });
          }));
        } finally {
          categoriesSeeding = false;
        }
      }

      const ids = new Set(list.map(c => c.ID));
      list.forEach(c => { if (c.ParentId && !ids.has(c.ParentId)) c.ParentId = null; });
      state.categories = list;
      state.categoriesPersisted = true;
    } catch (error) {
      console.warn("Categorias indisponíveis, usando padrões em memória:", error);
    }

    populateCategorySelects();
    if (state.currentTab === 'categories') renderCategoriesPage();
  }

  // ── Selects de categoria (lançamentos, cartão, custo fixo) ──
  function categoryOptionsHTML(kind) {
    const opt = (value, label) => `<option value="${escapeHTML(value)}">${escapeHTML(label)}</option>`;
    const out = [];
    catParents(kind).forEach(p => {
      out.push(opt(p.Nome, p.Nome));
      catChildren(p.ID).forEach(s => out.push(opt(s.Nome, `${p.Nome} › ${s.Nome}`)));
    });
    return out.join('');
  }

  /** Reconstrói um select de categoria; `extraValue` mantém uma categoria que já não existe mais. */
  function rebuildCategorySelect(sel, extraValue = '') {
    const current = extraValue || sel.value;
    const inst = sel.choicesInstance;
    if (inst) inst.destroy();

    const placeholder = sel.dataset.placeholder;
    let html = placeholder ? `<option value="" disabled selected>${escapeHTML(placeholder)}</option>` : '';
    html += categoryOptionsHTML(sel.dataset.categoryKind || '');
    if (extraValue && !state.categories.some(c => c.Nome === extraValue)) {
      html += `<option value="${escapeHTML(extraValue)}">${escapeHTML(extraValue)}</option>`;
    }
    sel.innerHTML = html;

    const known = Array.from(sel.options).some(o => o.value && o.value === current);
    if (known) sel.value = current;
    else if (placeholder) sel.value = '';

    if (inst) sel.choicesInstance = new Choices(sel, { searchEnabled: false, itemSelectText: '', shouldSort: false });
  }

  function populateCategorySelects() {
    document.querySelectorAll('select[data-category-select]').forEach(sel => rebuildCategorySelect(sel));
  }

  function setCategorySelectValue(sel, name) {
    if (!sel) return;
    const value = name || '';
    if (value && !Array.from(sel.options).some(o => o.value === value)) rebuildCategorySelect(sel, value);
    if (sel.choicesInstance) sel.choicesInstance.setChoiceByValue(value);
    else sel.value = value;
  }

  // ── Página Categorias ──
  function categoryUsage() {
    const counts = new Map();
    [...state.transactions, ...state.creditTransactions].forEach(t => {
      const key = catKey(t.Categoria);
      if (key) counts.set(key, (counts.get(key) || 0) + 1);
    });
    return counts;
  }

  function renderCategoriesPage(animate = false) {
    const grid = document.getElementById('cat-grid');
    if (!grid) return;
    const usage = categoryUsage();
    const used = (c) => usage.get(catKey(c.Nome)) || 0;
    const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
    const parents = catParents(state.catUI.kind);

    if (!parents.length) {
      grid.innerHTML = `<div class="cat-empty">Nenhuma categoria de ${state.catUI.kind === 'RECEITA' ? 'receita' : 'despesa'} ainda.
        Use "Nova categoria" para criar a primeira.</div>`;
    } else {
      grid.innerHTML = parents.map(p => {
        const subs = catChildren(p.ID);
        const style = { icon: p.Icone, color: p.Cor, ink: inkFor(p.Cor) };
        const id = safeId(p.ID);
        return `
        <article class="cat-card">
          <header class="cat-card-head">
            <span class="cat-bubble" style="background-color:${style.color};color:${style.ink}">${categoryIconHTML(style, 20)}</span>
            <div class="cat-card-title">
              <strong>${escapeHTML(p.Nome)}</strong>
              <small>${plural(subs.length, 'subcategoria', 'subcategorias')} · ${plural(used(p), 'lançamento', 'lançamentos')}</small>
            </div>
            <div class="cat-card-actions">
              <button type="button" class="cat-icon-btn" title="Adicionar subcategoria" aria-label="Adicionar subcategoria"
                onclick="AppController.openCategoryModal(null, '${id}')">${iconSvg('plus', 16)}</button>
              <button type="button" class="cat-icon-btn" title="Editar" aria-label="Editar categoria"
                onclick="AppController.openCategoryModal('${id}')">${iconSvg('pencil', 16)}</button>
              <button type="button" class="cat-icon-btn danger" title="Excluir" aria-label="Excluir categoria"
                onclick="AppController.deleteCategory('${id}')">${iconSvg('trash-2', 16)}</button>
            </div>
          </header>
          ${subs.length ? `<ul class="cat-sub-list">${subs.map(s => {
            const sStyle = { icon: s.Icone, color: s.Cor, ink: inkFor(s.Cor) };
            const sid = safeId(s.ID);
            return `
            <li class="cat-sub">
              <span class="cat-sub-branch">${iconSvg('corner-down-right', 14)}</span>
              <span class="cat-bubble cat-bubble-sm" style="background-color:${sStyle.color};color:${sStyle.ink}">${categoryIconHTML(sStyle, 14)}</span>
              <span class="cat-sub-name">${escapeHTML(s.Nome)}</span>
              <span class="cat-sub-count">${used(s)}</span>
              <button type="button" class="cat-icon-btn" title="Editar" aria-label="Editar subcategoria"
                onclick="AppController.openCategoryModal('${sid}')">${iconSvg('pencil', 14)}</button>
              <button type="button" class="cat-icon-btn danger" title="Excluir" aria-label="Excluir subcategoria"
                onclick="AppController.deleteCategory('${sid}')">${iconSvg('trash-2', 14)}</button>
            </li>`;
          }).join('')}</ul>` : ''}
        </article>`;
      }).join('');
    }

    if (animate) {
      grid.classList.remove('tab-pane-enter');
      void grid.offsetWidth;
      grid.classList.add('tab-pane-enter');
    }
  }

  function setCategoryKind(kind) {
    state.catUI.kind = kind === 'RECEITA' ? 'RECEITA' : 'DESPESA';
    document.getElementById('cat-seg-despesa').classList.toggle('active', state.catUI.kind === 'DESPESA');
    document.getElementById('cat-seg-receita').classList.toggle('active', state.catUI.kind === 'RECEITA');
    moveSegPill('cat-seg');
    renderCategoriesPage(true);
  }

  // ── Modal de categoria ──
  function fillCategoryParentSelect(selectedParentId, editing) {
    const sel = document.getElementById('cat-parent-select');
    const hasChildren = Boolean(editing) && catChildren(editing.ID).length > 0;
    const opts = ['<option value="">Nenhuma (categoria principal)</option>'];
    catParents().forEach(p => {
      if (editing && p.ID === editing.ID) return;
      opts.push(`<option value="${safeId(p.ID)}">${escapeHTML(p.Nome)}</option>`);
    });
    sel.innerHTML = opts.join('');
    sel.value = selectedParentId ? safeId(selectedParentId) : '';
    sel.disabled = hasChildren;
    sel.title = hasChildren ? 'Esta categoria tem subcategorias e não pode virar subcategoria.' : '';
  }

  function refreshCategoryModalTitle() {
    const editing = state.catUI.editingId;
    const isSub = Boolean(document.getElementById('cat-parent-select').value);
    document.getElementById('category-modal-title').innerText =
      `${editing ? 'Editar' : 'Nova'} ${isSub ? 'subcategoria' : 'categoria'}`;
    document.getElementById('category-submit-btn').innerText =
      editing ? 'Salvar alterações' : `Salvar ${isSub ? 'subcategoria' : 'categoria'}`;
  }

  function setCategoryFormKind(kind) {
    state.catUI.formKind = kind === 'RECEITA' ? 'RECEITA' : 'DESPESA';
    document.querySelectorAll('#cat-kind-picker .event-type-btn').forEach(btn =>
      btn.classList.toggle('active', btn.dataset.kind === state.catUI.formKind));
  }

  function renderColorSwatches() {
    const host = document.getElementById('cat-colors');
    host.innerHTML = COLOR_PALETTE.map(c =>
      `<button type="button" class="cat-swatch" data-color="${c}" style="--sw:${c}" aria-label="Cor ${c}"
        onclick="AppController.pickCategoryColor('${c}')"></button>`).join('') +
      `<label class="cat-swatch cat-swatch-custom" title="Cor personalizada">
        <input type="color" id="cat-color-custom" value="${state.catUI.color}"
          oninput="AppController.pickCategoryColor(this.value)"></label>`;
    syncColorSelection();
  }

  function syncColorSelection() {
    const host = document.getElementById('cat-colors');
    const current = state.catUI.color.toLowerCase();
    let matched = false;
    host.querySelectorAll('.cat-swatch[data-color]').forEach(btn => {
      const on = btn.dataset.color.toLowerCase() === current;
      btn.classList.toggle('active', on);
      if (on) matched = true;
    });
    const custom = host.querySelector('.cat-swatch-custom');
    if (custom) {
      custom.classList.toggle('active', !matched);
      custom.style.setProperty('--sw', matched ? 'transparent' : state.catUI.color);
      custom.querySelector('input').value = state.catUI.color;
    }
  }

  function pickCategoryColor(hex) {
    if (!isHexColor(hex)) return;
    state.catUI.color = hex;
    state.catUI.touched = true;
    syncColorSelection();
    updateCategoryPreview();
  }

  function renderIconGrid() {
    const host = document.getElementById('cat-icons');
    const query = stripAccents(document.getElementById('cat-icon-search').value).trim().toLowerCase();
    const list = query ? ICON_LIST.filter(i => stripAccents(i.search).includes(query)) : ICON_LIST;
    host.innerHTML = list.length
      ? list.map(i => `<button type="button" role="option" class="cat-icon-opt${i.name === state.catUI.icon ? ' active' : ''}"
          data-icon="${i.name}" title="${i.name}" aria-selected="${i.name === state.catUI.icon}"
          onclick="AppController.pickCategoryIcon('${i.name}')">${iconSvg(i.name, 20)}</button>`).join('')
      : '<p class="cat-icons-empty">Nenhum ícone encontrado.</p>';
  }

  function pickCategoryIcon(name) {
    if (!isValidIcon(name)) return;
    state.catUI.icon = name;
    state.catUI.touched = true;
    document.querySelectorAll('#cat-icons .cat-icon-opt').forEach(btn => {
      const on = btn.dataset.icon === name;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-selected', String(on));
    });
    updateCategoryPreview();
  }

  function updateCategoryPreview() {
    const bubble = document.getElementById('cat-preview-bubble');
    bubble.style.backgroundColor = state.catUI.color;
    bubble.style.color = inkFor(state.catUI.color);
    bubble.innerHTML = iconSvg(state.catUI.icon, 26);
    document.getElementById('cat-preview-name').innerText =
      document.getElementById('cat-name-input').value.trim() || 'Nova categoria';
  }

  function onCategoryParentChange() {
    const parent = findCategory(document.getElementById('cat-parent-select').value);
    document.getElementById('cat-kind-group').classList.toggle('hidden', Boolean(parent));
    if (parent) {
      setCategoryFormKind(parent.Tipo);
      if (!state.catUI.touched) {
        state.catUI.color = parent.Cor;
        state.catUI.icon = parent.Icone;
        syncColorSelection();
        renderIconGrid();
      }
    }
    refreshCategoryModalTitle();
    updateCategoryPreview();
  }

  function openCategoryModal(id = null, parentId = null) {
    if (!state.categoriesPersisted) {
      showToast('Não foi possível carregar suas categorias. Verifique se as regras do Firestore foram publicadas.', 'error');
      return;
    }
    const editing = id ? findCategory(id) : null;
    const parent = editing ? findCategory(editing.ParentId) : findCategory(parentId);

    state.catUI.editingId = editing ? editing.ID : null;
    state.catUI.touched = Boolean(editing);
    state.catUI.color = editing ? editing.Cor : (parent ? parent.Cor : COLOR_PALETTE[0]);
    state.catUI.icon = editing ? editing.Icone : (parent ? parent.Icone : 'tag');

    document.getElementById('cat-name-input').value = editing ? editing.Nome : '';
    document.getElementById('cat-icon-search').value = '';
    fillCategoryParentSelect(parent ? parent.ID : null, editing);
    document.getElementById('cat-kind-group').classList.toggle('hidden', Boolean(parent));
    setCategoryFormKind(editing ? editing.Tipo : (parent ? parent.Tipo : state.catUI.kind));
    renderColorSwatches();
    renderIconGrid();
    refreshCategoryModalTitle();
    updateCategoryPreview();

    document.getElementById('category-modal').classList.remove('hidden');
    document.getElementById('cat-name-input').focus();
    const active = document.querySelector('#cat-icons .cat-icon-opt.active');
    if (active) active.scrollIntoView({ block: 'nearest' });
  }

  function closeCategoryModal() {
    document.getElementById('category-modal').classList.add('hidden');
    state.catUI.editingId = null;
  }

  /** Renomear uma categoria atualiza os lançamentos que usam o nome antigo. */
  async function renameCategoryInRecords(oldName, newName) {
    const sources = [
      ['Transacoes', state.transactions], ['TransacoesCartao', state.creditTransactions],
      ['Planejamento', state.planning], ['Custos Fixos', state.fixedCosts]
    ];
    const jobs = [];
    sources.forEach(([collectionName, rows]) => rows.forEach(row => {
      if (row.ID && !row.isCreditCard && row.Categoria === oldName) jobs.push({ collectionName, row });
    }));
    const results = await Promise.allSettled(jobs.map(({ collectionName, row }) =>
      updateDoc(doc(db, collectionName, row.ID), { Categoria: newName })));
    let failed = 0;
    results.forEach((res, i) => {
      if (res.status === 'fulfilled') jobs[i].row.Categoria = newName;
      else failed++;
    });
    return { total: jobs.length, failed };
  }

  async function submitCategory(event) {
    event.preventDefault();
    const btn = document.getElementById('category-submit-btn');
    const nome = document.getElementById('cat-name-input').value.trim().replace(/\s+/g, ' ');
    const parent = findCategory(document.getElementById('cat-parent-select').value);
    const editing = state.catUI.editingId ? findCategory(state.catUI.editingId) : null;

    if (!nome) { showToast('Dê um nome para a categoria.', 'error'); return; }
    if (catKey(nome) === 'transferencia') { showToast('"Transferência" é um nome reservado do sistema.', 'error'); return; }
    if (state.categories.some(c => c.ID !== (editing && editing.ID) && catKey(c.Nome) === catKey(nome))) {
      showToast('Já existe uma categoria com esse nome.', 'error');
      return;
    }
    if (!isHexColor(state.catUI.color) || !isValidIcon(state.catUI.icon)) {
      showToast('Escolha uma cor e um ícone válidos.', 'error');
      return;
    }

    const payload = {
      Nome: nome,
      Icone: state.catUI.icon,
      Cor: state.catUI.color,
      Tipo: parent ? parent.Tipo : state.catUI.formKind,
      ParentId: parent ? parent.ID : null
    };

    btn.disabled = true;
    try {
      let renameInfo = null;
      if (editing) {
        const oldName = editing.Nome;
        await updateDoc(doc(db, "Categorias", editing.ID), payload);
        Object.assign(editing, payload);

        // Tipo da categoria principal vale para as subcategorias
        if (!editing.ParentId) {
          const stale = catChildren(editing.ID).filter(s => s.Tipo !== editing.Tipo);
          await Promise.all(stale.map(s => updateDoc(doc(db, "Categorias", s.ID), { Tipo: editing.Tipo })));
          stale.forEach(s => { s.Tipo = editing.Tipo; });
        }
        if (oldName !== nome) renameInfo = await renameCategoryInRecords(oldName, nome);
      } else {
        const Ordem = state.categories.reduce((max, c) => Math.max(max, c.Ordem), -1) + 1;
        const ref = await addDoc(collection(db, "Categorias"), { userId: getCurrentUserId(), ...payload, Ordem });
        state.categories.push(normalizeCategory({ ID: ref.id, ...payload, Ordem }));
      }

      closeCategoryModal();
      if (parent) state.catUI.kind = parent.Tipo;
      populateCategorySelects();
      renderCategoriesPage();
      renderTransactions();

      if (renameInfo && renameInfo.failed) {
        showToast(`Categoria salva, mas ${renameInfo.failed} de ${renameInfo.total} lançamentos não foram atualizados.`, 'error');
      } else if (renameInfo && renameInfo.total) {
        showToast(`Categoria salva. ${renameInfo.total} lançamento(s) atualizado(s).`, 'success');
      } else {
        showToast('Categoria salva com sucesso!', 'success');
      }
    } catch (error) {
      showToast('Erro ao salvar categoria: ' + error.message, 'error');
    } finally {
      btn.disabled = false;
    }
  }

  async function deleteCategory(id) {
    const cat = findCategory(id);
    if (!cat || !state.categoriesPersisted) return;
    const subs = catChildren(cat.ID);
    const usage = categoryUsage();
    const inUse = [cat, ...subs].reduce((sum, c) => sum + (usage.get(catKey(c.Nome)) || 0), 0);

    const parts = [];
    if (subs.length) parts.push(`${subs.length} subcategoria(s) serão excluídas junto`);
    if (inUse) parts.push(`${inUse} lançamento(s) manterão o nome, sem cor nem ícone`);
    if (!await confirmDialog({
      title: cat.ParentId ? 'Excluir subcategoria?' : 'Excluir categoria?',
      message: parts.join('; ') || 'Esta ação não pode ser desfeita.',
      detail: cat.Nome
    })) return;

    try {
      const doomed = [cat, ...subs];
      await Promise.all(doomed.map(c => deleteDoc(doc(db, "Categorias", c.ID))));
      const gone = new Set(doomed.map(c => c.ID));
      state.categories = state.categories.filter(c => !gone.has(c.ID));
      populateCategorySelects();
      renderCategoriesPage();
      renderTransactions();
      showToast('Categoria excluída.', 'success');
    } catch (error) {
      showToast('Erro ao excluir: ' + error.message, 'error');
    }
  }

  document.querySelectorAll('[data-lucide-inline]').forEach(el => { el.innerHTML = iconSvg(el.dataset.lucideInline, 16); });

  // ── Calendário ──
  const CAL_HOUR_PX = 44;
  const CAL_TYPES = {
    COMPROMISSO: { label: 'Compromisso', color: '#6fa9a8' },
    PAGAMENTO: { label: 'Pagamento', color: '#36454f' },
    PRAZO: { label: 'Prazo', color: '#e11d48' },
    LEMBRETE: { label: 'Lembrete', color: '#d97706' }
  };

  state.events = [];
  state.cal = { weekStart: null, mini: null, editingId: null, type: 'COMPROMISSO' };

  const calPad = (n) => String(n).padStart(2, '0');
  const calISO = (d) => `${d.getFullYear()}-${calPad(d.getMonth() + 1)}-${calPad(d.getDate())}`;
  const calAddDays = (d, n) => { const r = new Date(d); r.setDate(r.getDate() + n); return r; };
  const calMondayOf = (d) => {
    const r = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    r.setDate(r.getDate() - ((r.getDay() + 6) % 7));
    return r;
  };
  const calToMin = (hhmm) => {
    const [h, m] = String(hhmm || '00:00').split(':').map(n => parseInt(n, 10) || 0);
    return h * 60 + m;
  };
  const calFromMin = (min) => `${calPad(Math.floor(min / 60))}:${calPad(min % 60)}`;
  const calShort = (d) => d.toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' }).replace('.', '');

  function ensureCalState() {
    if (!state.cal.weekStart) state.cal.weekStart = calMondayOf(new Date());
    if (!state.cal.mini) state.cal.mini = { y: state.cal.weekStart.getFullYear(), m: state.cal.weekStart.getMonth() };
  }

  async function loadEvents() {
    try {
      state.events = await fetchUserScopedDocs("Eventos");
      if (state.currentTab === 'calendar') renderCalendar();
    } catch (error) {
      console.error("Erro ao carregar eventos:", error);
    }
  }

  // Itens automáticos: vencimentos de custos fixos e faturas de cartão
  function calAutoItems(date) {
    const ym = `${date.getFullYear()}-${calPad(date.getMonth() + 1)}`;
    const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
    const items = [];

    state.fixedCosts.forEach(cost => {
      const ex = cost.Excecoes && cost.Excecoes[ym];
      const dia = parseInt(ex && ex.DiaVencimento ? ex.DiaVencimento : cost.DiaVencimento) || 1;
      if (Math.min(dia, lastDay) !== date.getDate()) return;
      const paid = String(cost.MesesPagos || '').split(',').map(s => s.trim()).includes(ym);
      const valor = parseFloat(ex && ex.Valor !== undefined ? ex.Valor : cost.Valor) || 0;
      items.push({
        auto: true, tab: 'fixed-costs', tipo: 'PAGAMENTO', paid,
        titulo: `${(ex && ex.Nome) || cost.Nome} · ${currencyFormatter.format(valor)}`
      });
    });

    state.creditCards.forEach(card => {
      const dia = parseInt(card.DiaVencimento) || 1;
      if (Math.min(dia, lastDay) !== date.getDate()) return;
      const pending = state.creditTransactions
        .filter(ct => String(ct.IdCartao || ct.CartaoID) === String(card.ID) && String(ct.MesFatura).startsWith(ym) && ct.Status !== 'Pago')
        .reduce((sum, ct) => sum + (parseFloat(ct.Valor) || 0), 0);
      if (pending <= 0) return;
      items.push({
        auto: true, tab: 'credit-cards', tipo: 'PRAZO', paid: false,
        titulo: `Fatura ${card.Nome} · ${currencyFormatter.format(pending)}`
      });
    });
    return items;
  }

  function calEventsOn(dateStr) {
    return state.events.filter(ev => ev.Data === dateStr);
  }

  // Distribui eventos sobrepostos lado a lado
  function calLayout(events) {
    const sorted = [...events].sort((a, b) => calToMin(a.Inicio) - calToMin(b.Inicio));
    const placed = [];
    let cluster = [];
    let clusterEnd = -1;
    const flush = () => {
      const lanes = cluster.reduce((max, e) => Math.max(max, e.lane + 1), 1);
      cluster.forEach(e => { e.lanes = lanes; });
      placed.push(...cluster);
      cluster = [];
    };
    sorted.forEach(ev => {
      const start = calToMin(ev.Inicio);
      const end = Math.max(calToMin(ev.Fim), start + 30);
      if (cluster.length && start >= clusterEnd) flush();
      const used = cluster.filter(c => c.end > start).map(c => c.lane);
      let lane = 0;
      while (used.includes(lane)) lane++;
      cluster.push({ ev, start, end, lane });
      clusterEnd = Math.max(clusterEnd, end);
    });
    if (cluster.length) flush();
    return placed;
  }

  function renderCalendar(resetScroll = false) {
    const host = document.getElementById('cal-week');
    if (!host) return;
    ensureCalState();

    const prevScroll = document.getElementById('cal-scroll');
    const keepTop = prevScroll ? prevScroll.scrollTop : null;

    const start = state.cal.weekStart;
    const days = Array.from({ length: 7 }, (_, i) => calAddDays(start, i));
    const todayStr = calISO(new Date());
    const weekEvents = days.reduce((sum, d) => sum + calEventsOn(calISO(d)).length, 0);

    const sub = document.getElementById('cal-subtitle');
    if (sub) {
      sub.innerText = `${calShort(days[0])} – ${calShort(days[6])} de ${days[6].getFullYear()} · ${weekEvents} compromisso(s) · arraste para mover, clique em um horário vazio para adicionar`;
    }
    const todayBtn = document.getElementById('cal-today-btn');
    if (todayBtn) todayBtn.disabled = days.some(d => calISO(d) === todayStr);

    const head = days.map(d => {
      const wd = d.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '').toUpperCase();
      return `<div class="cal-dayhead ${calISO(d) === todayStr ? 'today' : ''}"><span>${wd}</span><b>${d.getDate()}</b></div>`;
    }).join('');

    const allday = days.map(d => {
      const ds = calISO(d);
      const userAll = calEventsOn(ds).filter(ev => ev.DiaInteiro);
      const chips = [
        ...calAutoItems(d).map(it => `<button type="button" class="cal-chip auto ${it.paid ? 'paid' : ''}" style="--ev:${CAL_TYPES[it.tipo].color}" data-tab="${it.tab}" title="Abrir ${it.tab === 'fixed-costs' ? 'Custos Fixos' : 'Cartões & Faturas'}"><i class="fas ${it.tab === 'fixed-costs' ? 'fa-calendar-check' : 'fa-credit-card'}"></i> ${escapeHTML(it.titulo)}</button>`),
        ...userAll.map(ev => `<button type="button" class="cal-chip" style="--ev:${(CAL_TYPES[ev.Tipo] || CAL_TYPES.COMPROMISSO).color}" data-event="${escapeHTML(ev.ID)}">${escapeHTML(ev.Titulo)}</button>`)
      ].join('');
      return `<div class="cal-allday-cell">${chips}</div>`;
    }).join('');

    const hourLabels = Array.from({ length: 24 }, (_, h) =>
      h === 0 ? '' : `<span style="top:${h * CAL_HOUR_PX}px">${h}h</span>`).join('');

    const cols = days.map(d => {
      const ds = calISO(d);
      const timed = calEventsOn(ds).filter(ev => !ev.DiaInteiro);
      const blocks = calLayout(timed).map(({ ev, start: s, end: e, lane, lanes }) => {
        const top = (s / 60) * CAL_HOUR_PX;
        const height = Math.max(((e - s) / 60) * CAL_HOUR_PX, 22);
        const t = CAL_TYPES[ev.Tipo] || CAL_TYPES.COMPROMISSO;
        return `<div class="cal-event" data-event="${escapeHTML(ev.ID)}" style="--ev:${t.color}; top:${top}px; height:${height}px; left:calc(${(lane / lanes) * 100}% + 2px); width:calc(${100 / lanes}% - 4px)">
          <strong>${escapeHTML(ev.Titulo)}</strong>
          <small>${escapeHTML(ev.Inicio)} – ${escapeHTML(ev.Fim)}${ev.Descricao ? ' · ' + escapeHTML(ev.Descricao) : ''}</small>
        </div>`;
      }).join('');
      return `<div class="cal-col ${ds === todayStr ? 'today' : ''}" data-date="${ds}">${blocks}${ds === todayStr ? '<div class="cal-now" id="cal-now"></div>' : ''}</div>`;
    }).join('');

    host.innerHTML = `
      <div class="cal-row cal-head"><div class="cal-gutter"></div>${head}</div>
      <div class="cal-row cal-allday"><div class="cal-gutter">dia todo</div>${allday}</div>
      <div class="cal-scroll" id="cal-scroll">
        <div class="cal-grid" style="height:${24 * CAL_HOUR_PX}px">
          <div class="cal-times">${hourLabels}</div>${cols}
        </div>
      </div>`;

    const legend = document.getElementById('cal-legend');
    if (legend) {
      legend.innerHTML = Object.values(CAL_TYPES).map(t =>
        `<span><i style="background:${t.color}"></i>${t.label}</span>`).join('') +
        '<span><i class="auto"></i>Automático (custos fixos e faturas)</span>';
    }

    const scroller = document.getElementById('cal-scroll');
    if (scroller) {
      scroller.scrollTop = (resetScroll || keepTop === null) ? CAL_HOUR_PX * 7 : keepTop;
    }

    bindCalendarEvents();
    updateCalNow();
    renderMiniCalendar();
  }

  function updateCalNow() {
    const line = document.getElementById('cal-now');
    if (!line) return;
    const now = new Date();
    line.style.top = `${((now.getHours() * 60 + now.getMinutes()) / 60) * CAL_HOUR_PX}px`;
  }
  setInterval(updateCalNow, 60000);

  function renderMiniCalendar() {
    const host = document.getElementById('cal-mini');
    if (!host) return;
    ensureCalState();
    const { y, m } = state.cal.mini;
    const first = new Date(y, m, 1);
    const gridStart = calMondayOf(first);
    const weekDays = new Set(Array.from({ length: 7 }, (_, i) => calISO(calAddDays(state.cal.weekStart, i))));
    const todayStr = calISO(new Date());
    const title = first.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });

    let cells = '';
    for (let i = 0; i < 42; i++) {
      const d = calAddDays(gridStart, i);
      if (i >= 35 && d.getMonth() !== m) break;
      const ds = calISO(d);
      const has = calEventsOn(ds).length > 0 || calAutoItems(d).length > 0;
      cells += `<button type="button" class="cal-mini-day ${d.getMonth() !== m ? 'other' : ''} ${weekDays.has(ds) ? 'in-week' : ''} ${ds === todayStr ? 'today' : ''}" data-date="${ds}">${d.getDate()}${has ? '<i></i>' : ''}</button>`;
    }

    host.innerHTML = `
      <div class="cal-mini-head">
        <strong>${escapeHTML(title)}</strong>
        <div><button type="button" id="cal-mini-prev" aria-label="Mês anterior"><i class="fas fa-chevron-left"></i></button>
        <button type="button" id="cal-mini-next" aria-label="Próximo mês"><i class="fas fa-chevron-right"></i></button></div>
      </div>
      <div class="cal-mini-grid">${['S', 'T', 'Q', 'Q', 'S', 'S', 'D'].map(l => `<span class="wd">${l}</span>`).join('')}${cells}</div>`;

    const shiftMini = (delta) => {
      const d = new Date(y, m + delta, 1);
      state.cal.mini = { y: d.getFullYear(), m: d.getMonth() };
      renderMiniCalendar();
    };
    document.getElementById('cal-mini-prev').addEventListener('click', () => shiftMini(-1));
    document.getElementById('cal-mini-next').addEventListener('click', () => shiftMini(1));
    host.querySelectorAll('.cal-mini-day').forEach(btn => btn.addEventListener('click', () => {
      state.cal.weekStart = calMondayOf(parseLocalDate(btn.dataset.date));
      renderCalendar();
    }));
  }

  function bindCalendarEvents() {
    const host = document.getElementById('cal-week');

    host.querySelectorAll('.cal-chip[data-tab]').forEach(chip =>
      chip.addEventListener('click', () => switchTab(chip.dataset.tab)));
    host.querySelectorAll('.cal-chip[data-event]').forEach(chip =>
      chip.addEventListener('click', () => openEventModal(chip.dataset.event)));

    host.querySelectorAll('.cal-col').forEach(col => col.addEventListener('click', (e) => {
      if (e.target !== col && !e.target.classList.contains('cal-now')) return;
      const y = e.clientY - col.getBoundingClientRect().top;
      const startMin = Math.min(Math.floor(((y / CAL_HOUR_PX) * 60) / 30) * 30, 23 * 60);
      openEventModal(null, { date: col.dataset.date, start: calFromMin(startMin), end: calFromMin(Math.min(startMin + 60, 24 * 60 - 1)) });
    }));

    host.querySelectorAll('.cal-event').forEach(el => el.addEventListener('pointerdown', (e) => startEventDrag(e, el)));
  }

  // Arrastar para mover (snap de 15 min entre horários e dias)
  function startEventDrag(e, el) {
    if (e.button !== 0) return;
    const ev = state.events.find(x => String(x.ID) === String(el.dataset.event));
    if (!ev) return;

    const col = el.parentElement;
    const colW = col.getBoundingClientRect().width;
    const startMin = calToMin(ev.Inicio);
    const dur = Math.max(calToMin(ev.Fim) - startMin, 30);
    const originX = e.clientX;
    const originY = e.clientY;
    const dayIdx = Array.from(col.parentElement.querySelectorAll('.cal-col')).indexOf(col);
    let moved = false;
    let newMin = startMin;
    let dayDelta = 0;

    el.setPointerCapture(e.pointerId);

    const onMove = (m) => {
      const dx = m.clientX - originX;
      const dy = m.clientY - originY;
      if (!moved && Math.hypot(dx, dy) < 5) return;
      moved = true;
      el.classList.add('dragging');
      const rawMin = startMin + (dy / CAL_HOUR_PX) * 60;
      newMin = Math.max(0, Math.min(Math.round(rawMin / 15) * 15, 24 * 60 - dur));
      dayDelta = Math.max(-dayIdx, Math.min(Math.round(dx / colW), 6 - dayIdx));
      el.style.transform = `translate(${dayDelta * colW}px, ${((newMin - startMin) / 60) * CAL_HOUR_PX}px)`;
    };

    const onUp = async () => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      if (!moved) { openEventModal(ev.ID); return; }

      const newDate = calISO(calAddDays(state.cal.weekStart, dayIdx + dayDelta));
      if (newDate === ev.Data && newMin === startMin) { renderCalendar(); return; }
      try {
        await updateDoc(doc(db, "Eventos", ev.ID), { Data: newDate, Inicio: calFromMin(newMin), Fim: calFromMin(newMin + dur) });
        ev.Data = newDate; ev.Inicio = calFromMin(newMin); ev.Fim = calFromMin(newMin + dur);
      } catch (error) {
        showToast('Erro ao mover evento: ' + error.message, 'error');
      }
      renderCalendar();
    };

    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
  }

  function calPrev() { ensureCalState(); state.cal.weekStart = calAddDays(state.cal.weekStart, -7); syncMiniToWeek(); renderCalendar(); }
  function calNext() { ensureCalState(); state.cal.weekStart = calAddDays(state.cal.weekStart, 7); syncMiniToWeek(); renderCalendar(); }
  function calToday() { state.cal.weekStart = calMondayOf(new Date()); syncMiniToWeek(); renderCalendar(); }
  function syncMiniToWeek() {
    const mid = calAddDays(state.cal.weekStart, 3);
    state.cal.mini = { y: mid.getFullYear(), m: mid.getMonth() };
  }

  // ── Modal de evento ──
  function setEventType(type) {
    state.cal.type = type;
    document.getElementById('event-type-val').value = type;
    document.querySelectorAll('#event-type-picker .event-type-btn').forEach(btn =>
      btn.classList.toggle('active', btn.dataset.type === type));
  }

  function toggleEventAllDay() {
    const allDay = document.getElementById('event-allday').checked;
    document.getElementById('event-times').classList.toggle('hidden', allDay);
  }

  function openEventModal(id, preset) {
    ensureCalState();
    const form = document.getElementById('event-form');
    form.reset();
    const ev = id ? state.events.find(x => String(x.ID) === String(id)) : null;
    state.cal.editingId = ev ? ev.ID : null;

    document.getElementById('event-modal-title').innerText = ev ? 'Editar evento' : 'Novo evento';
    document.getElementById('event-delete-btn').classList.toggle('hidden', !ev);
    document.getElementById('event-submit-btn').innerText = ev ? 'Salvar alterações' : 'Salvar evento';

    const today = calISO(new Date());
    const base = ev || { Titulo: '', Tipo: 'COMPROMISSO', Data: (preset && preset.date) || today, Inicio: (preset && preset.start) || '09:00', Fim: (preset && preset.end) || '10:00', DiaInteiro: false, Descricao: '' };
    form.elements.titulo.value = base.Titulo;
    form.elements.data.value = base.Data;
    form.elements.inicio.value = base.Inicio || '09:00';
    form.elements.fim.value = base.Fim || '10:00';
    form.elements.descricao.value = base.Descricao || '';
    document.getElementById('event-allday').checked = Boolean(base.DiaInteiro);
    toggleEventAllDay();
    setEventType(CAL_TYPES[base.Tipo] ? base.Tipo : 'COMPROMISSO');

    document.getElementById('event-modal').classList.remove('hidden');
    form.elements.titulo.focus();
  }

  function closeEventModal() {
    document.getElementById('event-modal').classList.add('hidden');
    state.cal.editingId = null;
  }

  async function submitEvent(event) {
    event.preventDefault();
    const form = document.getElementById('event-form');
    const btn = document.getElementById('event-submit-btn');
    const allDay = document.getElementById('event-allday').checked;
    const inicio = form.elements.inicio.value || '09:00';
    let fim = form.elements.fim.value || inicio;

    if (!allDay && calToMin(fim) <= calToMin(inicio)) {
      showToast('O horário final deve ser depois do início.', 'error');
      return;
    }
    if (allDay) fim = inicio;

    const payload = {
      Titulo: form.elements.titulo.value.trim(),
      Tipo: document.getElementById('event-type-val').value,
      Data: form.elements.data.value,
      Inicio: allDay ? '00:00' : inicio,
      Fim: allDay ? '23:59' : fim,
      DiaInteiro: allDay,
      Descricao: form.elements.descricao.value.trim()
    };

    btn.disabled = true;
    try {
      if (state.cal.editingId) {
        await updateDoc(doc(db, "Eventos", state.cal.editingId), payload);
      } else {
        await addDoc(collection(db, "Eventos"), { userId: getCurrentUserId(), ...payload });
      }
      // Leva a semana visível até a data do evento salvo
      state.cal.weekStart = calMondayOf(parseLocalDate(payload.Data));
      syncMiniToWeek();
      closeEventModal();
      showToast('Evento salvo com sucesso!', 'success');
      await loadEvents();
      renderCalendar();
    } catch (error) {
      showToast('Erro ao salvar evento: ' + error.message, 'error');
    } finally {
      btn.disabled = false;
    }
  }

  async function deleteEventFromModal() {
    const ev = state.events.find(x => String(x.ID) === String(state.cal.editingId));
    if (!ev) return;
    if (!await confirmDialog({
      title: 'Excluir evento?',
      message: 'Esta ação não pode ser desfeita.',
      detail: `${ev.Titulo} · ${formatDateBR(ev.Data)}`
    })) return;
    try {
      await deleteDoc(doc(db, "Eventos", ev.ID));
      closeEventModal();
      showToast('Evento excluído.', 'success');
      await loadEvents();
      renderCalendar();
    } catch (error) {
      showToast('Erro ao excluir: ' + error.message, 'error');
    }
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
  onAuthStateChanged(auth, (user) => {
    if (user) {
      // Esconde o Login e MOSTRA o Sistema
      document.getElementById('login-screen').style.display = 'none';
      document.getElementById('app-container').style.display = 'block';
      requestAnimationFrame(() => moveTabIndicator(false));

      definirMesAtual();
      init();
      loadUserProfile();
    } else {
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

  // Ação de Criar Conta
  document.getElementById('create-account-btn')?.addEventListener('click', async (e) => {
    e.preventDefault();
    const email = document.getElementById('login-email').value;
    const pass = document.getElementById('login-password').value;
    const errorMsg = document.getElementById('login-error');

    if (!email || !pass) return alert("Preencha e-mail e senha no formulário para criar a conta.");

    try {
      await createUserWithEmailAndPassword(auth, email, pass);
      AppController.showToast("Conta criada com sucesso! O sistema fará o login automático.", 'success');
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
      const credential = await createUserWithEmailAndPassword(auth, email, pass);

      // Salva o cadastro do novo usuário para o nome aparecer no sistema
      await setDoc(doc(db, "Usuarios", credential.user.uid), {
        nome: `${nome} ${sobrenome}`.trim(),
        apelido: nome,
        nascimento
      }, { merge: true });
      loadUserProfile();

      AppController.showToast(`Conta criada com sucesso, ${nome}! O login será feito automaticamente.`, 'success');
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
      const data = await fetchUserScopedDocs("Contas");
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
    state.accounts.forEach(acc => {
      const opt = document.createElement('option');
      opt.value = acc.Nome;
      opt.text = acc.Nome;
      elements.accountSelect.appendChild(opt);
    });
    upgradeSelects();
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
      const bal = roundCents(balances[acc.Nome]); const bClass = balanceClass(bal);
      card.innerHTML = `<div class="acc-name"><i class="fas fa-wallet" style="margin-right: 8px; color: #aaa;"></i>${escapeHTML(acc.Nome)}</div><div class="acc-balance ${bClass}">${currencyFormatter.format(bal)}</div>`;
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
        userId: getCurrentUserId(),
        Nome: formDados.nome,
        SaldoInicial: parseFloat(formDados.saldoInicial) || 0,
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

  function openTransferModal() {
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
      loadTransactions();
      if (formDados.tipoTransferencia === 'OBJETIVO') loadGoals();
    } catch (error) {
      AppController.showToast("Erro na transferência: " + error.message, 'error');
    } finally {
      btn.disabled = false;
      btn.innerText = 'Realizar Transferência';
    }
  }

  // --- TRANSAÇÕES GERAIS ---
  async function loadTransactions() {
    try {
      state.transactions = await fetchUserScopedDocs("Transacoes");
      renderTransactions();
    } catch (error) {
      console.error("Erro ao carregar transações:", error);
    }
  }

  function renderTransactions() {
    updateTransactionSummary();
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
    const globalSummary = activeTransactions().reduce((acc, current) => {
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
      if (isTransferTransaction(current) || current.Ignorar) return acc;
      const amount = parseFloat(current.Valor) || 0;
      if (current.Tipo === 'RECEITA') acc.income += amount;
      else if (current.Tipo === 'DESPESA') acc.expense += amount;
      return acc;
    }, { income: 0, expense: 0 });

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

      ChartManager.updateDashboardCharts(activeTransactions(), selectedYYYYMM);
      renderDashboardInsights(selectedYYYYMM);
      return;
    }

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
      const isPending = t.isCreditCard ? (t.Status !== 'Pago') : (!isTransf && tDate > today);

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
      const safeId = escapeHTML(t.ID);
      const actionButtons = t.isCreditCard
        ? `<button class="btn-text" style="color: #64748b;" onclick="event.stopPropagation(); AppController.openTxDrawer('${safeId}', true)" title="Ver Detalhes da Fatura"><i class="fas fa-eye"></i></button>`
        : `<button class="btn-text" style="color: #64748b;" onclick="event.stopPropagation(); AppController.openTxDrawer('${safeId}', false)" title="Ver Detalhes e Editar"><i class="fas fa-pen"></i></button>
           <button class="btn-delete" onclick="event.stopPropagation(); AppController.deleteTransaction('${safeId}')" title="Excluir"><i class="fas fa-trash"></i></button>`;

      tr.innerHTML = `
          <td class="tx-td" style="text-align: center;"><input type="checkbox" class="tx-checkbox" ${!isPending ? 'checked' : ''} disabled></td>
          <td class="tx-td" style="text-align: center;">${statusHtml}</td>
          <td class="tx-td" style="${isPending ? 'opacity:0.6;' : ''}">${escapeHTML(currentDateStr)}</td>
          <td class="tx-td" style="${isPending ? 'opacity:0.6;' : ''}; font-weight: 500;">${escapeHTML(mainDesc)}</td>
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

    ChartManager.updateDashboardCharts(activeTransactions(), selectedYYYYMM);
    renderDashboardInsights(selectedYYYYMM);
  }

  // ── Modal de lançamento ──
  const txLocalISO = (d = new Date()) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  // Soma meses mantendo o dia (ou o último dia do mês, se não existir)
  function txAddMonths(iso, n) {
    const [y, m, d] = iso.split('-').map(Number);
    const target = new Date(y, m - 1 + n, 1);
    const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
    target.setDate(Math.min(d, last));
    return txLocalISO(target);
  }

  function setTxType(tipo) {
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
  }

  function setTxDateShortcut(offsetDays) {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    setTxDate(txLocalISO(d));
  }

  function validateTxAmount() {
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

  function toggleTxDetails() {
    setTxDetailsOpen(!document.getElementById('tx-modal-box').classList.contains('expanded'));
  }

  function toggleTxRepeat() {
    const on = document.getElementById('tx-repeat').checked;
    document.getElementById('tx-repeat-fields').classList.toggle('hidden', !on);
  }

  // Seletor de data em calendário (aberto por "Outros…")
  function openTxDatePicker() {
    const current = document.getElementById('dataTransacao').value || txLocalISO();
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
    overlay.querySelector('#dp-ok').addEventListener('click', () => { setTxDate(selected); close(); });

    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(overlay);
    render();
  }

  function resetTxChoices() {
    elements.form.querySelectorAll('select:not(.no-choices)').forEach(s => {
      if (s.choicesInstance) {
        s.choicesInstance.destroy();
        s.choicesInstance = new Choices(s, { searchEnabled: false, itemSelectText: '', shouldSort: false });
      }
    });
  }

  function openModal() {
    state.editingId = null;
    state.editingType = null;
    elements.form.reset();
    resetTxChoices();

    document.getElementById('tx-repeat-block').classList.remove('hidden');
    document.getElementById('tx-repeat-fields').classList.add('hidden');
    document.getElementById('tx-save-new-btn').classList.remove('hidden');
    setTxDetailsOpen(false);
    setTxType('DESPESA');
    setTxDate(txLocalISO());
    validateTxAmount();

    elements.submitBtn.innerText = 'Salvar';
    elements.modal.classList.remove('hidden');
    document.getElementById('tx-valor').focus();
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
  function editTransaction(id) {
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

    // Edição: sem repetição e sem "salvar e criar nova"
    document.getElementById('tx-repeat-block').classList.add('hidden');
    document.getElementById('tx-save-new-btn').classList.add('hidden');
    elements.submitBtn.innerText = 'Atualizar';
  }

  function closeModal() {
    elements.modal.classList.add('hidden');
    elements.form.reset();
    state.editingId = null;
    state.editingType = null;
    elements.submitBtn.innerText = 'Salvar';
  }


  async function submitTransaction(event, andNew = false) {
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
      Ignorar: formDados.ignorar === 'on'
    };
    const repeat = !editing && document.getElementById('tx-repeat').checked
      ? Math.max(2, Math.min(parseInt(formDados.repeticoes) || 2, 60))
      : 1;

    try {
      if (editing) {
        await updateDoc(doc(db, "Transacoes", state.editingId), base);
      } else {
        for (let i = 0; i < repeat; i++) {
          await addDoc(collection(db, "Transacoes"), {
            ...base,
            Data: i === 0 ? base.Data : txAddMonths(base.Data, i),
            Descricao: repeat > 1 ? `${base.Descricao} (${i + 1}/${repeat})`.trim() : base.Descricao
          });
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
        validateTxAmount();
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

  function describeTx(t) {
    if (!t) return '';
    const name = t.Descricao || t.Categoria || 'Lançamento';
    return `${name} · ${currencyFormatter.format(parseFloat(t.Valor) || 0)}`;
  }

  async function deleteTransaction(id) {
    const t = state.transactions.find(x => String(x.ID) === String(id));
    if (!await confirmDialog({
      title: 'Excluir transação?',
      message: 'Esta ação não pode ser desfeita.',
      detail: describeTx(t)
    })) return;
    try {
      await deleteDoc(doc(db, "Transacoes", id));
      loadTransactions();
    } catch (error) {
      AppController.showToast("Erro ao excluir: " + error.message, 'error');
    }
  }

  // --- DRAWER & BOTTOM SHEET DE TRANSAÇÕES (HUMANIST LEDGER) ---
  function openTxDrawer(id, isCC) {
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
    const isPending = isCreditCard ? (t.Status !== 'Pago') : (!isTransf && tDate > today);

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

    overlay.classList.add('open');
    drawer.classList.add('open');
    document.body.style.overflow = 'hidden';
  }

  function closeTxDrawer() {
    const overlay = document.getElementById('tx-drawer-overlay');
    const drawer = document.getElementById('tx-drawer');
    if (overlay) overlay.classList.remove('open');
    if (drawer) drawer.classList.remove('open');
    document.body.style.overflow = '';
    state.drawerTx = null;
    state.drawerIsCC = false;
  }

  async function submitTxDrawer(event) {
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
      showToast('Transação atualizada com sucesso!', 'success');
    } catch (err) {
      showToast('Erro ao atualizar: ' + err.message, 'error');
    } finally {
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.innerText = 'Salvar Alterações';
      }
    }
  }

  async function deleteTxFromDrawer() {
    if (!state.drawerTx) return;
    const id = state.drawerTx.ID;
    const isCC = state.drawerIsCC;

    if (!await confirmDialog({
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
        await deleteDoc(doc(db, "Transacoes", id));
        loadTransactions();
      }
      closeTxDrawer();
      showToast('Transação excluída com sucesso!', 'success');
    } catch (err) {
      showToast('Erro ao excluir: ' + err.message, 'error');
    }
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

  // --- OBJETIVOS E METAS COM APORTE ---
  async function loadGoals() {
    try {
      const metasBrutas = await fetchUserScopedDocs("Objetivos");

      state.goals = metasBrutas.map(goal => {
        const target = parseFloat(goal.ValorAlvo) || 0;
        const current = parseFloat(goal.ValorAtual) || 0;
        let percentage = target > 0 ? (current / target) * 100 : 0;
        return { ...goal, Progresso: parseFloat(Math.min(percentage, 100).toFixed(2)) };
      });

      renderGoalsPage();
    } catch (error) {
      console.error("Erro ao carregar objetivos:", error);
    }
  }

  function renderGoalsPage() {
    const pageContainer = document.getElementById('goals-page-container');
    if (!pageContainer) return;
    pageContainer.innerHTML = '';

    const activeTab = state.goalsTab || 'ANDAMENTO';
    const targetStatus = activeTab === 'ANDAMENTO' ? 'Ativo' : 'Concluido';

    // Filtra os objetivos
    const filteredGoals = (state.goals || []).filter(g => g.Status === targetStatus);

    // Ordena a lista de acordo com a escolha do utilizador
    filteredGoals.sort((a, b) => {
      if (state.goalsSortOrder === 'DATA') {
        const dateA = a.DataLimite ? new Date(a.DataLimite).getTime() : Infinity;
        const dateB = b.DataLimite ? new Date(b.DataLimite).getTime() : Infinity;
        return dateA - dateB;
      } else if (state.goalsSortOrder === 'MAIS_AVANCADOS') {
        return (b.Progresso || 0) - (a.Progresso || 0);
      } else if (state.goalsSortOrder === 'MENOS_AVANCADOS') {
        return (a.Progresso || 0) - (b.Progresso || 0);
      }
      return 0;
    });

    if (filteredGoals.length === 0) {
      pageContainer.style.justifyContent = 'center';

      if (activeTab === 'ANDAMENTO') {
        pageContainer.innerHTML = `
          <div style="text-align: center; padding: 60px 20px; width: 100%;">
            <i class="fas fa-clipboard-list" style="font-size: 80px; color: var(--primary-color); margin-bottom: 20px; opacity: 0.8;"></i>
            <h3 style="font-size: 18px; color: #111; margin-bottom: 10px;">Definindo objetivos você alcança seus sonhos mais rápido!</h3>
            <p style="font-size: 14px; color: #888; margin-bottom: 25px;">Que tal criar um pra te ajudar?</p>
            <button class="btn-primary" style="width: auto; padding: 12px 30px; border-radius: 24px; background: var(--primary-color); font-size: 14px;" onclick="AppController.openGoalTypeModal()">CRIAR NOVO OBJETIVO</button>
          </div>
        `;
      } else {
        pageContainer.innerHTML = `
          <div style="text-align: center; padding: 60px 20px; width: 100%;">
            <i class="fas fa-clipboard-check" style="font-size: 80px; color: var(--primary-color); margin-bottom: 20px; opacity: 0.8;"></i>
            <h3 style="font-size: 18px; color: #111; margin-bottom: 10px;">Você ainda não concluiu um objetivo</h3>
            <p style="font-size: 14px; color: #888; margin-bottom: 25px;">Que tal continuar guardando dinheiro?</p>
          </div>
        `;
      }
    } else {
      pageContainer.style.justifyContent = 'flex-start';
      filteredGoals.forEach(goal => {
        const cor = goal.Cor || '#00BCD4';
        const icone = goal.Icone || 'fa-bullseye';
        const pct = goal.Progresso || 0;
        const valorRestante = Math.max(0, (parseFloat(goal.ValorAlvo) || 0) - (parseFloat(goal.ValorAtual) || 0));

        let pillHtml = '';
        let targetMonthlyHtml = '';

        if (pct >= 100 || valorRestante === 0) {
          pillHtml = `<span class="goal-pill goal-pill-success"><i class="fas fa-check-circle"></i> Concluído!</span>`;
          targetMonthlyHtml = `<span class="goal-target-text" style="color: #059669;"><i class="fas fa-trophy"></i> Meta atingida com sucesso</span>`;
        } else if (!goal.DataLimite) {
          pillHtml = `<span class="goal-pill goal-pill-neutral"><i class="fas fa-infinity"></i> Sem prazo</span>`;
          targetMonthlyHtml = `<span class="goal-target-text"><i class="fas fa-clock"></i> Saldo restante: <strong>${currencyFormatter.format(valorRestante)}</strong></span>`;
        } else {
          const today = new Date();
          const targetDate = new Date(goal.DataLimite);
          const monthsRemaining = (targetDate.getFullYear() - today.getFullYear()) * 12 + (targetDate.getMonth() - today.getMonth());

          if (monthsRemaining < 0 || (monthsRemaining === 0 && targetDate < today)) {
            pillHtml = `<span class="goal-pill goal-pill-warning"><i class="fas fa-exclamation-triangle"></i> Prazo encerrado</span>`;
            targetMonthlyHtml = `<span class="goal-target-text" style="color: #d97706;"><i class="fas fa-hourglass-end"></i> Restam <strong>${currencyFormatter.format(valorRestante)}</strong> pendentes</span>`;
          } else {
            const divisor = Math.max(1, monthsRemaining);
            const monthlyTarget = valorRestante / divisor;
            const pacing = pct >= 50 ? 'No ritmo' : 'Atenção';
            const pacingClass = pct >= 50 ? 'goal-pill-success' : 'goal-pill-info';

            pillHtml = `<span class="goal-pill ${pacingClass}"><i class="fas fa-bolt"></i> ${pacing}</span>`;
            targetMonthlyHtml = `<span class="goal-target-text"><i class="fas fa-piggy-bank"></i> Aporte sugerido: <strong>${currencyFormatter.format(monthlyTarget)}/mês</strong> (${divisor}m)</span>`;
          }
        }

        const safeGoalId = escapeHTML(goal.ID);
        const safeGoalNome = escapeHTML(goal.Nome);
        const safeCor = escapeHTML(cor);
        const safeIcone = escapeHTML(icone);

        const card = document.createElement('div');
        card.className = 'new-goal-card';
        card.innerHTML = `
          <div class="ng-header">
            <div style="display: flex; align-items: center; width: calc(100% - 25px); min-width: 0;">
              <div class="ng-icon" style="background: ${safeCor};"><i class="fas ${safeIcone}"></i></div>
              <div class="ng-title">${safeGoalNome}</div>
            </div>
            <i class="fas fa-chevron-right" style="color: #ccc; cursor: pointer; padding: 5px;" onclick="AppController.openGoalDetails('${safeGoalId}')" title="Ver detalhes do objetivo"></i>
          </div>
          <div>
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
              ${pillHtml}
              <span style="color: var(--text-muted); font-size: 12px; font-weight: 600; font-family: var(--font-mono);">${pct.toFixed(1)}%</span>
            </div>
            <div class="ng-progress-track">
              <div class="ng-progress-fill" style="width: ${pct}%; background: ${cor};"></div>
            </div>
            <div style="display: flex; justify-content: space-between; align-items: baseline; margin-top: 6px;">
              <span style="color: var(--text-main); font-weight: 700; font-size: 14px; font-family: var(--font-mono);">
                ${currencyFormatter.format(goal.ValorAtual)} 
                <span style="color: var(--text-muted); font-weight: 400; font-size: 12px; font-family: var(--font-sans);">guardados</span>
              </span>
              <span style="color: var(--text-muted); font-size: 12px; font-family: var(--font-mono);">Alvo: ${currencyFormatter.format(goal.ValorAlvo)}</span>
            </div>
          </div>
          <div class="ng-footer">
            <div class="ng-monthly-box">
              ${targetMonthlyHtml}
            </div>
            <div class="ng-date-row">
              <span><i class="far fa-calendar-check" style="margin-right: 5px;"></i> Data limite</span>
              <strong>${goal.DataLimite ? formatDateBR(goal.DataLimite) : 'Sem prazo definido'}</strong>
            </div>
          </div>
        `;
        pageContainer.appendChild(card);
      });
    }
  }

  function openGoalTypeModal() {
    document.getElementById('goal-type-modal').classList.remove('hidden');
  }

  function openGoalForm(nome, icone, cor) {
    document.getElementById('goal-type-modal').classList.add('hidden');
    state.editingId = null;
    elements.goalForm.reset();

    document.getElementById('goal-name-input').value = nome;
    document.getElementById('goal-icon-val').value = icone;
    document.getElementById('goal-color-val').value = cor;
    document.getElementById('submit-goal-btn').innerText = 'CRIAR OBJETIVO';

    elements.goalModal.classList.remove('hidden');
  }

  function closeGoalModal() {
    elements.goalModal.classList.add('hidden');
    elements.goalForm.reset();
    state.editingId = null;
  }

  async function submitGoal(event) {
    event.preventDefault();
    const btn = document.getElementById('submit-goal-btn');
    btn.disabled = true;
    btn.innerHTML = 'Salvando...';

    const formDados = Object.fromEntries(new FormData(elements.goalForm).entries());

    const valorAlvoNum = parseFloat(formDados.valorAlvo.replace(/\D/g, "")) / 100 || 0;
    const valorAtualNum = formDados.valorAtual ? (parseFloat(formDados.valorAtual.replace(/\D/g, "")) / 100 || 0) : 0;

    const payloadFormatado = {
      userId: getCurrentUserId(),
      Nome: formDados.nome,
      ValorAlvo: valorAlvoNum,
      ValorAtual: valorAtualNum,
      DataLimite: formDados.dataLimite || '',
      Icone: formDados.icone,
      Cor: formDados.cor,
      Status: 'Ativo'
    };

    try {
      if (state.editingId) {
        await updateDoc(doc(db, "Objetivos", state.editingId), payloadFormatado);
      } else {
        await addDoc(collection(db, "Objetivos"), payloadFormatado);
      }
      closeGoalModal();
      loadGoals();
    } catch (error) {
      AppController.showToast("Erro ao salvar objetivo: " + error.message, 'error');
    } finally {
      btn.disabled = false;
    }
  }

  function editGoal(id) {
    const g = state.goals.find(x => String(x.ID) === String(id)); if (!g) return;
    state.editingId = id;

    document.querySelector(`#goal-form input[name="nome"]`).value = g.Nome;
    document.querySelector(`#goal-form input[name="valorAlvo"]`).value = currencyFormatter.format(g.ValorAlvo);
    document.querySelector(`#goal-form input[name="valorAtual"]`).value = currencyFormatter.format(g.ValorAtual || 0);
    document.getElementById('goal-icon-val').value = g.Icone || 'fa-bullseye';
    document.getElementById('goal-color-val').value = g.Cor || '#36454f';

    const dateStr = g.DataLimite ? String(g.DataLimite).split('T')[0] : '';
    const dateInput = document.querySelector(`#goal-form input[name="dataLimite"]`);
    if (dateInput) dateInput.value = dateStr;

    document.getElementById('submit-goal-btn').innerText = 'ATUALIZAR OBJETIVO';
    elements.goalModal.classList.remove('hidden');
  }

  async function deleteGoal(id) {
    if (!confirm("Tem certeza que deseja excluir este objetivo?")) return;
    try {
      await deleteDoc(doc(db, "Objetivos", id));
      loadGoals();
    } catch (error) {
      AppController.showToast("Erro ao excluir: " + error.message, 'error');
    }
  }

  function openGoalDepositModal(goalId, type = 'deposit') {
    const g = state.goals.find(x => String(x.ID) === String(goalId));
    if (!g) return;

    document.getElementById('gd-goal-id').value = g.ID;
    document.getElementById('gd-goal-name').value = g.Nome;
    document.getElementById('gd-deposit-id').value = '';
    document.getElementById('gd-transaction-type').value = type;
    document.querySelector('#goal-deposit-form input[name="valor"]').value = '';

    const title = document.getElementById('gd-modal-title');
    const btn = document.getElementById('submit-gd-btn');

    if (type === 'withdraw') {
      title.innerText = 'Resgatar Valor';
      btn.innerText = 'Confirmar Resgate';
    } else {
      title.innerText = 'Adicionar Depósito';
      btn.innerText = 'Confirmar Aporte';
    }

    document.getElementById('goal-deposit-modal').classList.remove('hidden');
  }
  function closeGoalDepositModal() {
    document.getElementById('goal-deposit-modal').classList.add('hidden');
    document.getElementById('goal-deposit-form').reset();
  }

  async function submitGoalDeposit(event) {
    event.preventDefault();
    const btn = document.getElementById('submit-gd-btn');
    const originalText = btn.innerText;
    btn.disabled = true;
    btn.innerHTML = 'Processando...';

    const formDados = Object.fromEntries(new FormData(document.getElementById('goal-deposit-form')).entries());
    let depositAmount = parseFloat(formDados.valor.replace(/\D/g, "")) / 100 || 0;

    const type = formDados.type;
    if (type === 'withdraw') depositAmount = -Math.abs(depositAmount);
    else depositAmount = Math.abs(depositAmount);

    const goalId = formDados.id;
    const depositId = formDados.depositId;

    try {
      const goal = state.goals.find(g => String(g.ID) === String(goalId));
      if (!goal) throw new Error("Objetivo não encontrado.");

      const localISO = new Date(new Date().getTime() - (new Date().getTimezoneOffset() * 60000)).toISOString().split('T')[0];

      if (depositId) {
        const oldDeposit = state.currentGoalDeposits.find(d => String(d.ID) === String(depositId));
        const difference = depositAmount - (parseFloat(oldDeposit.Valor) || 0);

        await updateDoc(doc(db, "AportesObjetivo", depositId), { Valor: depositAmount });
        await updateDoc(doc(db, "Objetivos", goalId), { ValorAtual: (parseFloat(goal.ValorAtual) || 0) + difference });
      } else {
        if (type === 'withdraw' && Math.abs(depositAmount) > (parseFloat(goal.ValorAtual) || 0)) {
          throw new Error("Saldo insuficiente no objetivo para este resgate.");
        }

        await addDoc(collection(db, "AportesObjetivo"), {
          userId: getCurrentUserId(),
          IdObjetivo: goalId,
          Valor: depositAmount,
          Data: localISO
        });
        await updateDoc(doc(db, "Objetivos", goalId), { ValorAtual: (parseFloat(goal.ValorAtual) || 0) + depositAmount });
      }

      closeGoalDepositModal();
      await loadGoals();

      if (!document.getElementById('view-goal-details').classList.contains('hidden')) {
        openGoalDetails(goalId);
      }

      // Usa o novo sistema de Toasts!
      AppController.showToast(type === 'withdraw' ? "Resgate realizado com sucesso!" : "Aporte realizado com sucesso!", 'success');

    } catch (error) {
      AppController.showToast(error.message, 'error');
    } finally {
      btn.disabled = false;
      btn.innerText = originalText;
    }
  }

  // --- CUSTOS FIXOS ---
  async function loadFixedCosts() {
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

  function renderFixedCostsPage() {
    renderFixedCosts(state.fixedCosts);
  }

  function openFixedCostModal() {
    state.editingId = null;
    state.editingType = null;
    state.editingScope = 'ALL';
    elements.fixedCostForm.reset();
    elements.submitFixedCostBtn.innerText = 'Salvar Custo Fixo';
    elements.fixedCostModal.classList.remove('hidden');
  }
  function editFixedCost(id) {
    // Em vez de abrir o formulário, abre a pergunta
    state.pendingEditId = id;
    document.getElementById('fc-edit-scope-modal').classList.remove('hidden');
  }

  function closeFCEditScopeModal() {
    document.getElementById('fc-edit-scope-modal').classList.add('hidden');
    state.pendingEditId = null;
  }

  function proceedEditFixedCost(scope) {
    const id = state.pendingEditId; // 1º GUARDAMOS O ID ENQUANTO ELE EXISTE
    closeFCEditScopeModal();        // 2º AGORA SIM, FECHAMOS A PERGUNTA

    const fc = state.fixedCosts.find(x => String(x.ID) === String(id));
    if (!fc) return;

    state.editingId = id;
    state.editingType = 'FIXED_COST';
    state.editingScope = scope; // 'MONTH_ONLY' ou 'ALL'

    const currentMonth = getSelectedYYYYMM();
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

  function closeFixedCostModal() {
    elements.fixedCostModal.classList.add('hidden');
    elements.fixedCostForm.reset();
    state.editingId = null;
    state.editingType = null;
    elements.submitFixedCostBtn.innerText = 'Salvar Custo Fixo';
  }

  async function submitFixedCost(event) {
    event.preventDefault();
    elements.submitFixedCostBtn.disabled = true;
    elements.submitFixedCostBtn.innerHTML = 'Salvando...';

    const formDados = Object.fromEntries(new FormData(elements.fixedCostForm).entries());
    const currentMonth = getSelectedYYYYMM();

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

  async function deleteFixedCost(id) {
    const cost = state.fixedCosts.find(c => String(c.ID) === String(id));
    if (!await confirmDialog({
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

  async function submitFixedCostPay(event) {
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

      const currentTargetMonth = getSelectedYYYYMM();
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
      loadTransactions();

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
    const currentMonth = getSelectedYYYYMM();
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
    upgradeSelects();

    document.getElementById('fc-pay-modal').classList.remove('hidden');
  }

  function closeFCPayModal() {
    document.getElementById('fc-pay-modal').classList.add('hidden');
    document.getElementById('fc-pay-form').reset();
  }

  function openPayInvoiceModal(cardId) {
    const selectedYYYYMM = getSelectedYYYYMM();

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
      upgradeSelects();
    }

    const modal = document.getElementById('cc-pay-invoice-modal');
    if (modal) modal.classList.remove('hidden');
  }

  function closePayInvoiceModal() {
    const modal = document.getElementById('cc-pay-invoice-modal');
    const form = document.getElementById('cc-pay-invoice-form');
    if (modal) modal.classList.add('hidden');
    if (form) form.reset();
  }

  async function submitPayInvoice(event) {
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
      loadTransactions();

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


  async function unmarkFixedCostPaid(id) {
    const currentTargetMonth = getSelectedYYYYMM();
    const cost = state.fixedCosts.find(c => String(c.ID) === String(id));
    if (!cost) return;

    if (!await confirmDialog({
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
      loadTransactions();
    } catch (error) {
      AppController.showToast("Erro ao desmarcar pagamento: " + error.message, 'error');
    }
  }

  // --- CARTÃO DE CRÉDITO & FATURAS ---
  async function loadCreditData() {
    try {
      state.creditCards = await fetchUserScopedDocs("Cartoes");
      populateCCDropdown();
      loadCreditTransactions();
    } catch (error) {
      console.error("Erro ao carregar cartões:", error);
    }
  }

  async function loadCreditTransactions() {
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
  function openCCTransModal() {
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
  function closeCCTransModal() { elements.ccTransModal.classList.add('hidden'); elements.ccTransForm.reset(); }
  async function submitCCTrans(event) {
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

  async function deleteCreditTransaction(id) {
    const item = state.creditTransactions.find(x => String(x.ID) === String(id));
    if (!await confirmDialog({
      title: 'Excluir lançamento da fatura?',
      message: 'Esta ação não pode ser desfeita.',
      detail: describeTx(item)
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
  function renderCreditCardsPage() {
    const titleElem = document.getElementById('cc-page-period-title');
    const totalElem = document.getElementById('cc-page-total-invoice');
    const cardsGrid = document.getElementById('cc-cards-grid');

    const selectedYYYYMM = getSelectedYYYYMM();
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
  function openCCDrawer(cardId) {
    state.ccDrawerCardId = String(cardId);
    renderCCDrawer();
    document.getElementById('cc-drawer-overlay').classList.add('open');
    document.getElementById('cc-drawer').classList.add('open');
    document.body.style.overflow = 'hidden';
  }

  function closeCCDrawer() {
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
    if (!await confirmDialog({
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
      showToast('Cartão excluído com sucesso!', 'success');
      loadCreditData();
    } catch (error) {
      showToast('Erro ao excluir cartão: ' + error.message, 'error');
    }
  }

  function renderCCDrawer() {
    const card = state.creditCards.find(c => String(c.ID) === String(state.ccDrawerCardId));
    const body = document.getElementById('cc-drawer-body');
    const footer = document.getElementById('cc-drawer-footer');
    if (!card || !body || !footer) { closeCCDrawer(); return; }

    const selectedYYYYMM = getSelectedYYYYMM();
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
        openPayInvoiceModal(id);
      });
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

    activeTransactions().forEach(t => {
      const tDate = parseLocalDate(t.Data);
      if (tDate > today) return;

      if (t.Conta && balances[t.Conta] !== undefined) {
        const amount = parseFloat(t.Valor) || 0;
        if (t.Tipo === 'RECEITA') balances[t.Conta] += amount;
        else if (t.Tipo === 'DESPESA') balances[t.Conta] -= amount;
      }
    });

    const baseBalance = state.accounts.reduce((acc, currentAcc) => acc + (parseFloat(currentAcc.SaldoInicial) || 0), 0);
    const globalSummary = activeTransactions().reduce((acc, current) => {
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

  // --- CÁLCULO E RENDERIZAÇÃO DO DASHBOARD DE PLANEJAMENTO ---
  async function loadPlanning() {
    try {
      state.planning = await fetchUserScopedDocs("Planejamento");
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

    // --- Cruza dados do planejamento com TODAS as transações reais do mês ---
    const monthlyTransactions = activeTransactions().filter(t => {
      if (!t.Data) return false;
      const tDate = parseLocalDate(t.Data);
      const tMonth = String(tDate.getMonth() + 1).padStart(2, '0');
      const tYear = tDate.getFullYear();
      return `${tYear}-${tMonth}` === selectedYYYYMM;
    });

    // Injeta os lançamentos de cartão de crédito no planejamento
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
          ...ct,
          Tipo: 'DESPESA',
          Data: syntheticDate,
          isCreditCard: true,
          Status: ct.Status || 'Pendente'
        };
      });

    const allMonthlyTx = [...monthlyTransactions, ...ccTransactions];
    const today = new Date();
    today.setHours(23, 59, 59, 999);

    // Gastos reais por categoria (pagos = efetivados, previstos = futuros/faturas pendentes)
    const paidByCategory = {};
    const pendingByCategory = {};

    allMonthlyTx.forEach(t => {
      if (t.Tipo !== 'DESPESA' || isTransferTransaction(t)) return;
      const cat = t.Categoria || 'Outros';
      const val = parseFloat(t.Valor) || 0;

      let isPaid = false;
      if (t.isCreditCard) {
        isPaid = (t.Status === 'Pago');
      } else {
        const tDate = parseLocalDate(t.Data);
        isPaid = (tDate <= today);
      }

      if (isPaid) {
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

        const catStyle = getCategoryStyle(catName);
        const spentClass = totalSpent > limitValue ? 'text-red' : '';

        const tr = document.createElement('tr');
        tr.className = 'tx-tr';
        tr.innerHTML = `
            <td class="tx-td">
              <div class="cat-badge-container">
                <div class="cat-icon-circle" style="background-color: ${catStyle.color}; color: ${catStyle.ink};">
                  ${categoryIconHTML(catStyle)}
                </div>
                <span>${escapeHTML(catName)}</span>
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

    // --- Cálculo e atualização das percentagens de Pagos e Previstos ---
    const pctPaid = totalPlanned > 0 ? (totalPaid / totalPlanned) * 100 : 0;
    const pctPending = totalPlanned > 0 ? (totalPending / totalPlanned) * 100 : 0;

    const dashPctPaidEl = document.getElementById('dash-pct-paid');
    if (dashPctPaidEl) dashPctPaidEl.innerText = `${pctPaid.toFixed(1)}%`;

    const dashPctPendingEl = document.getElementById('dash-pct-pending');
    if (dashPctPendingEl) dashPctPendingEl.innerText = `${pctPending.toFixed(1)}%`;
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
      const allPlans = await fetchUserScopedDocs("Planejamento");
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

  // Categorias de despesa do usuário (principais e subcategorias) para definir limites
  const wizardCategories = () => [...state.categories]
    .filter(c => c.Tipo === 'DESPESA')
    .sort((x, y) => x.Ordem - y.Ordem)
    .map(c => ({ name: c.Nome, icon: c.Icone, color: c.Cor, ink: inkFor(c.Cor) }));

  function renderWizardCategories() {
    const container = document.getElementById('wizard-categories-list');
    if (!container) return;
    container.innerHTML = '';

    wizardCategories().forEach(cat => {
      const val = wizardState.categories[cat.name] || 0;

      const card = document.createElement('div');
      card.className = 'wiz-cat-card';
      card.innerHTML = `
          <div style="display: flex; align-items: center; gap: 15px;">
            <div class="wiz-cat-icon" style="background-color: ${cat.color}; color: ${cat.ink};">
              ${categoryIconHTML(cat, 20)}
            </div>
            <strong style="font-size: 16px; color: #333;">${escapeHTML(cat.name)}</strong>
          </div>
          <div class="wiz-cat-input-group">
            <label>Total</label>
            <input type="text" class="wiz-cat-input" data-category="${escapeHTML(cat.name)}" value="R$ ${val.toFixed(2).replace('.', ',')}" oninput="AppController.maskCurrency(this); AppController.calculateWizardCategoryTotals()">
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
      // 1. Limpa os planejamentos antigos do mesmo mês pertencentes ao usuário
      const existingPlans = await fetchUserScopedDocs("Planejamento");
      const deletePromises = [];
      existingPlans.forEach(plan => {
        if (String(plan.MesReferencia).trim() === searchKey) {
          deletePromises.push(deleteDoc(doc(db, "Planejamento", plan.ID)));
        }
      });
      await Promise.all(deletePromises);

      // 2. Salva as novas metas por categoria com isolamento de usuário
      const insertPromises = [];
      const uid = getCurrentUserId();
      for (const [catName, val] of Object.entries(wizardState.categories)) {
        if (parseFloat(val) > 0) {
          insertPromises.push(addDoc(collection(db, "Planejamento"), {
            userId: uid,
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
      AppController.showToast("Erro ao salvar planejamento: " + error.message, 'error');
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
    document.querySelectorAll('#theme-selector-settings, #theme-selector').forEach(el => {
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
    const selector = document.getElementById('theme-selector');

    if (selector) selector.value = savedTheme;
    document.querySelectorAll('#theme-selector-settings').forEach(el => { el.value = savedTheme; });

    changeTheme(savedTheme);
  }

  // Salvar Preferências (Tema, Idioma e Moeda)
  // Salvar Preferências (Tema, Idioma e Moeda)
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
  // LÓGICA DA TELA DE DETALHES DO OBJETIVO
  // ==========================================

  function calculateMonthlySavings(targetValue, currentValue, targetDateStr) {
    const remaining = targetValue - currentValue;
    if (remaining <= 0) return 0;
    if (!targetDateStr) return -1; // Sem data definida

    const today = new Date();
    const target = new Date(targetDateStr + 'T12:00:00');

    let months = (target.getFullYear() - today.getFullYear()) * 12;
    months -= today.getMonth();
    months += target.getMonth();
    if (target.getDate() < today.getDate()) months--; // Mês incompleto

    if (months <= 0) months = 1; // Evita divisão por zero
    return remaining / months;
  }

  function renderGoalChart(pct, color) {
    const canvas = document.getElementById('goalDonutChart');
    if (!canvas) return;
    if (goalDonutChartInstance) goalDonutChartInstance.destroy();

    goalDonutChartInstance = new Chart(canvas.getContext('2d'), {
      type: 'doughnut',
      data: {
        datasets: [{
          data: [pct, Math.max(0, 100 - pct)],
          backgroundColor: [color, '#f0f0f0'],
          borderWidth: 0,
          cutout: '80%',
          borderRadius: [20, 0] // Arredonda as pontas do gráfico
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { tooltip: { enabled: false } },
        animation: { animateScale: true }
      }
    });
  }

  async function openGoalDetails(id) {
    const g = state.goals.find(x => String(x.ID) === String(id));
    if (!g) return;
    state.currentGoalId = id;

    // Troca as telas
    document.getElementById('view-goals').classList.add('hidden');
    document.getElementById('view-goal-details').classList.remove('hidden');

    // Preenche os textos
    document.getElementById('gd-page-title').innerText = g.Nome;
    document.getElementById('gd-target-val').innerText = currencyFormatter.format(g.ValorAlvo);
    document.getElementById('gd-name-val').innerText = g.Nome;
    document.getElementById('gd-date-val').innerText = formatDateBR(g.DataLimite) || '--/--/----';

    const pct = g.Progresso || 0;
    document.getElementById('gd-pct-val').innerText = `${pct.toFixed(0)}%`;

    // Cálculo de quanto poupar por mês
    const monthly = calculateMonthlySavings(g.ValorAlvo, g.ValorAtual || 0, g.DataLimite);
    const box = document.getElementById('gd-monthly-box');
    if (monthly === 0) {
      box.innerHTML = `<i class="fas fa-check-circle" style="color: #4CAF50; font-size: 20px; margin-top: 2px;"></i><div style="font-size: 13px; color: #555;">Parabéns! Você já alcançou a meta deste objetivo.</div>`;
    } else if (monthly < 0) {
      box.innerHTML = `<i class="fas fa-info-circle" style="color: #2196F3; font-size: 20px; margin-top: 2px;"></i><div style="font-size: 13px; color: #555;">Edite o objetivo e defina uma <strong>Data Limite</strong> para calcular sua meta mensal.</div>`;
    } else {
      box.innerHTML = `<i class="fas fa-chess-board" style="color: ${g.Cor || '#36454f'}; font-size: 20px; margin-top: 2px;"></i><div style="font-size: 13px; color: #555;">Para atingir seu objetivo a tempo, você precisa poupar a cada mês <strong style="color: #111;">${currencyFormatter.format(monthly)}</strong></div>`;
    }

    renderGoalChart(pct, g.Cor || '#00BCD4');

    // Carrega a lista de Depósitos
    await loadGoalDeposits(id);
  }

  function closeGoalDetails() {
    document.getElementById('view-goal-details').classList.add('hidden');
    document.getElementById('view-goals').classList.remove('hidden');
    state.currentGoalId = null;
  }

  function editGoalFromDetails() {
    if (state.currentGoalId) editGoal(state.currentGoalId);
  }

  async function loadGoalDeposits(id) {
    const listEl = document.getElementById('gd-deposits-list');
    listEl.innerHTML = '<div style="color:#888; font-size:14px; margin-top:10px;">Carregando depósitos...</div>';

    try {
      const todosAportes = await fetchUserScopedDocs("AportesObjetivo");

      state.currentGoalDeposits = todosAportes.filter(a => String(a.IdObjetivo) === String(id));
      state.currentGoalDeposits.sort((a, b) => new Date(b.Data).getTime() - new Date(a.Data).getTime());

      renderGoalDeposits();
    } catch (e) {
      console.error(e);
      listEl.innerHTML = '<div style="color:#F44336; font-size:14px;">Erro ao carregar aportes.</div>';
    }
  }

  function renderGoalDeposits() {
    const listEl = document.getElementById('gd-deposits-list');
    listEl.innerHTML = '';

    if (state.currentGoalDeposits.length === 0) {
      listEl.innerHTML = '<div style="color:#888; font-size:14px; margin-top:10px;">Nenhuma movimentação realizada ainda.</div>';
      return;
    }

    state.currentGoalDeposits.forEach(dep => {
      const isWithdraw = dep.Valor < 0;
      const displayValue = Math.abs(dep.Valor);
      const color = isWithdraw ? '#F44336' : '#4CAF50';
      const sign = isWithdraw ? '-' : '+';
      const label = isWithdraw ? 'Resgate' : 'Depósito';
      const safeDepId = escapeHTML(dep.ID);
      const safeGoalId = escapeHTML(dep.IdObjetivo);

      const li = document.createElement('li');
      li.className = 'gd-deposit-item';
      li.innerHTML = `
        <div>
          <div style="font-size: 13px; color: #888;">${formatDateBR(dep.Data)}</div>
          <div style="font-size: 12px; color: ${color}; font-weight: 500;">${label}</div>
        </div>
        <div style="display: flex; align-items: center; gap: 15px;">
          <strong style="color: ${color}; font-size: 14px;">${sign} ${currencyFormatter.format(displayValue)}</strong>
          <button class="btn-text" style="color: #bbb; font-size: 13px; padding: 0;" onclick="AppController.deleteGoalDeposit('${safeDepId}', '${safeGoalId}', ${dep.Valor})" title="Excluir"><i class="fas fa-trash"></i></button>
          <button class="btn-text" style="color: #bbb; font-size: 13px; padding: 0;" onclick="AppController.editGoalDeposit('${safeDepId}', '${safeGoalId}', ${dep.Valor})" title="Editar"><i class="fas fa-pen"></i></button>
        </div>
      `;
      listEl.appendChild(li);
    });
  }

  async function deleteGoalDeposit(idAporte, idObjetivo, valorAporte) {
    if (!confirm("Excluir este depósito? O valor será subtraído do progresso do objetivo.")) return;
    try {
      await deleteDoc(doc(db, "AportesObjetivo", idAporte));

      // Subtrai o valor apagado do saldo principal do objetivo
      const goal = state.goals.find(g => String(g.ID) === String(idObjetivo));
      if (goal) {
        const newVal = Math.max(0, (parseFloat(goal.ValorAtual) || 0) - valorAporte);
        await updateDoc(doc(db, "Objetivos", idObjetivo), { ValorAtual: newVal });
      }

      await loadGoals();
      openGoalDetails(idObjetivo); // Atualiza a tela inteira
    } catch (e) {
      AppController.showToast("Erro ao excluir: " + e.message, 'error');
    }
  }

  function editGoalDeposit(idAporte, idObjetivo, valorAporte) {
    const g = state.goals.find(x => String(x.ID) === String(idObjetivo));
    if (!g) return;

    const isWithdraw = valorAporte < 0;

    document.getElementById('gd-goal-id').value = g.ID;
    document.getElementById('gd-goal-name').value = g.Nome;
    document.getElementById('gd-deposit-id').value = idAporte;
    document.getElementById('gd-transaction-type').value = isWithdraw ? 'withdraw' : 'deposit';

    document.querySelector('#goal-deposit-form input[name="valor"]').value = currencyFormatter.format(Math.abs(valorAporte));

    const title = document.getElementById('gd-modal-title');
    const btn = document.getElementById('submit-gd-btn');

    if (isWithdraw) {
      title.innerText = 'Editar Resgate';
      btn.innerText = 'Atualizar Resgate';
    } else {
      title.innerText = 'Editar Depósito';
      btn.innerText = 'Atualizar Aporte';
    }

    document.getElementById('goal-deposit-modal').classList.remove('hidden');
  }

  // Lógica do Menu de Opções Suspenso
  function toggleGoalOptions(event) {
    if (event) event.stopPropagation();
    const dropdown = document.getElementById('goal-options-dropdown');
    if (dropdown) {
      dropdown.style.display = (dropdown.style.display === 'none' || dropdown.style.display === '') ? 'block' : 'none';
    }
  }

  // Fechar o menu de opções ao clicar fora dele
  document.addEventListener('click', (e) => {
    const dropdown = document.getElementById('goal-options-dropdown');
    if (dropdown && dropdown.style.display === 'block') {
      dropdown.style.display = 'none';
    }
  });

  // Abrir modal de depósito para o objetivo que está aberto na tela
  function openCurrentGoalDepositModal() {
    if (state.currentGoalId) openGoalDepositModal(state.currentGoalId, 'deposit');
  }

  function openCurrentGoalWithdrawModal() {
    if (state.currentGoalId) openGoalDepositModal(state.currentGoalId, 'withdraw');
  }

  // Apagar o objetivo que está aberto na tela
  async function deleteCurrentGoal() {
    if (!state.currentGoalId) return;
    if (!confirm("Tem certeza que deseja excluir este objetivo completamente?")) return;

    try {
      await deleteDoc(doc(db, "Objetivos", state.currentGoalId));
      closeGoalDetails();
      loadGoals();
    } catch (error) {
      AppController.showToast("Erro ao excluir: " + error.message, 'error');
    }
  }

  // Alterna entre a aba Em Andamento e Concluídos
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

  function switchGoalsTab(tabName) {
    state.goalsTab = tabName;
    const btnAndamento = document.getElementById('btn-goal-andamento');
    const btnConcluidos = document.getElementById('btn-goal-concluidos');
    btnAndamento.classList.toggle('active', tabName === 'ANDAMENTO');
    btnConcluidos.classList.toggle('active', tabName !== 'ANDAMENTO');
    moveGoalsPill();

    renderGoalsPage();
  }

  // Marca o objetivo atual como Concluído
  async function markGoalAsCompleted() {
    if (!state.currentGoalId) return;
    if (!confirm("Deseja marcar este objetivo como concluído? Ele será movido para a aba 'Concluídos'.")) return;

    try {
      await updateDoc(doc(db, "Objetivos", state.currentGoalId), { Status: 'Concluido' });
      closeGoalDetails();
      await loadGoals();
    } catch (error) {
      AppController.showToast("Erro ao concluir objetivo: " + error.message, 'error');
    }
  }

  // ==========================================
  // LÓGICA DE ORDENAÇÃO DE OBJETIVOS
  // ==========================================
  function toggleGoalsSortDropdown(event) {
    if (event) event.stopPropagation();
    const dropdown = document.getElementById('goals-sort-dropdown');
    if (dropdown) {
      dropdown.style.display = (dropdown.style.display === 'none' || dropdown.style.display === '') ? 'block' : 'none';
    }
  }

  function setGoalsSortOrder(order) {
    state.goalsSortOrder = order;

    // Esconde o menu após clicar
    const dropdown = document.getElementById('goals-sort-dropdown');
    if (dropdown) dropdown.style.display = 'none';

    // Atualiza a tela com a nova ordem
    renderGoalsPage();
  }

  // Fechar menus suspensos ao clicar fora
  document.addEventListener('click', (e) => {
    const optionsDropdown = document.getElementById('goal-options-dropdown');
    if (optionsDropdown && optionsDropdown.style.display === 'block') {
      optionsDropdown.style.display = 'none';
    }
    const sortDropdown = document.getElementById('goals-sort-dropdown');
    if (sortDropdown && sortDropdown.style.display === 'block') {
      sortDropdown.style.display = 'none';
    }
  });

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
        const tDate = parseLocalDate(t.Data);
        isPaid = (tDate <= today);
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
    const globalSummary = activeTransactions().reduce((acc, current) => {
      const tDate = parseLocalDate(current.Data);
      if (tDate <= today) {
        const amount = parseFloat(current.Valor) || 0;
        if (current.Tipo === 'RECEITA') acc.income += amount;
        else if (current.Tipo === 'DESPESA') acc.expense += amount;
      }
      return acc;
    }, { income: 0, expense: 0 });

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

  return {
    init, claimLegacyData, switchTab, toggleTxDetails, toggleTxRepeat, setTxDateShortcut, openTxDatePicker, validateTxAmount, calPrev, calNext, calToday, openEventModal, closeEventModal, submitEvent, deleteEventFromModal, setEventType, toggleEventAllDay, setTransactionFilter, renderCreditCardsPage, renderFixedCostsPage, renderGoalsPage, renderAccountsPage, renderPlanningView, openMonthPicker, closeMonthPicker, changePickerYear, selectCurrentMonth, openModal, closeModal, submitTransaction, editTransaction, deleteTransaction, openAccountModal, closeAccountModal, submitAccount, openTransferModal, closeTransferModal, submitTransfer,
    openGoalTypeModal, openGoalForm, closeGoalModal, submitGoal, editGoal, deleteGoal, openGoalDepositModal, closeGoalDepositModal, submitGoalDeposit,
    openGoalDetails, closeGoalDetails, editGoalFromDetails, deleteGoalDeposit, editGoalDeposit, toggleGoalOptions, openCurrentGoalDepositModal, deleteCurrentGoal, switchGoalsTab, markGoalAsCompleted, toggleGoalsSortDropdown, setGoalsSortOrder, openFixedCostModal, closeFixedCostModal, submitFixedCost, editFixedCost, deleteFixedCost, markFixedCostPaid, unmarkFixedCostPaid, openFCPayModal, closeFCPayModal, openCCModal, closeCCModal, submitCC, openCCTransModal, closeCCTransModal, submitCCTrans, openCCInvoiceModal, closeCCInvoiceModal, deleteCreditTransaction, toggleFabMenu, closeFabMenu, openNewTransaction, openNewCCTransaction, openNewTransfer, startPlanningWizard, cancelPlanningWizard, copyPreviousPlanning, maskCurrency, calculateWizardBudget, prevWizardStep, nextWizardStep, calculateWizardCategoryTotals, renderWizardCategories, selectCardPreference, finishPlanningWizard, closeFixedCostPayModal, submitFixedCostPay, logout, switchProfileTab, maskCPF, maskPhone, maskCEP, changeTheme, loadUserProfile, openPayInvoiceModal, closePayInvoiceModal, submitPayInvoice, showToast, openCurrentGoalWithdrawModal, updateTransactionSummary, switchSettingsTab, toggleAllDevices, checkDeviceSelection, disconnectSelectedDevices, savePreferences, openCategoryModal, closeCategoryModal, submitCategory, deleteCategory, setCategoryKind, setCategoryFormKind, updateCategoryPreview, onCategoryParentChange, filterCategoryIcons: renderIconGrid, pickCategoryIcon, pickCategoryColor, changeTxPage, changeTxItemsPerPage, setTransactionSort, proceedEditFixedCost, closeFCEditScopeModal, parseCurrencyMask,
    openTxDrawer, closeTxDrawer, openCCDrawer, closeCCDrawer, submitTxDrawer, deleteTxFromDrawer, renderDashboardInsights
  };
})();

document.addEventListener('DOMContentLoaded', AppController.init);

window.AppController = AppController;