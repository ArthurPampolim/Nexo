import { db } from '../firebase.js';
import { collection, getDocs, addDoc, updateDoc, deleteDoc, doc, query, where } from 'firebase/firestore';
import { state, escapeHTML, getCurrentUserId } from '../core.js';
import { ICON_LIST, COLOR_PALETTE, DEFAULT_CATEGORIES, iconSvg, inkFor, isHexColor, isValidIcon } from '../categories.js';
import { app } from '../app.js';

// ── Categorias ──
const freshDefaultCategories = () => DEFAULT_CATEGORIES.map((c, i) => ({ ...c, ID: `def-${i}` }));
state.categories = freshDefaultCategories();
state.categoriesPersisted = false;
state.catUI = { kind: 'DESPESA', editingId: null, formKind: 'DESPESA', color: COLOR_PALETTE[0], icon: 'tag', touched: false };

let categoriesSeeding = false;
const stripAccents = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
const catKey = (s) => stripAccents(s).trim().toLowerCase();
export const safeId = (id) => String(id).replace(/[^\w-]/g, '');
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
export function getCategoryStyle(name) {
  const key = catKey(name);
  const cat = state.categories.find(c => catKey(c.Nome) === key);
  const color = cat ? cat.Cor : '#9e9e9e';
  return { icon: cat ? cat.Icone : 'tag', color, ink: inkFor(color) };
}

export const categoryIconHTML = (style, size = 14) => iconSvg(style.icon, size);

export async function loadCategories() {
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
export function rebuildCategorySelect(sel, extraValue = '') {
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

export function populateCategorySelects() {
  document.querySelectorAll('select[data-category-select]').forEach(sel => rebuildCategorySelect(sel));
}

export function setCategorySelectValue(sel, name) {
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

export function renderCategoriesPage(animate = false) {
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

export function setCategoryKind(kind) {
  state.catUI.kind = kind === 'RECEITA' ? 'RECEITA' : 'DESPESA';
  document.getElementById('cat-seg-despesa').classList.toggle('active', state.catUI.kind === 'DESPESA');
  document.getElementById('cat-seg-receita').classList.toggle('active', state.catUI.kind === 'RECEITA');
  app.moveSegPill('cat-seg');
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

export function setCategoryFormKind(kind) {
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

export function pickCategoryColor(hex) {
  if (!isHexColor(hex)) return;
  state.catUI.color = hex;
  state.catUI.touched = true;
  syncColorSelection();
  updateCategoryPreview();
}

export function renderIconGrid() {
  const host = document.getElementById('cat-icons');
  const query = stripAccents(document.getElementById('cat-icon-search').value).trim().toLowerCase();
  const list = query ? ICON_LIST.filter(i => stripAccents(i.search).includes(query)) : ICON_LIST;
  host.innerHTML = list.length
    ? list.map(i => `<button type="button" role="option" class="cat-icon-opt${i.name === state.catUI.icon ? ' active' : ''}"
        data-icon="${i.name}" title="${i.name}" aria-selected="${i.name === state.catUI.icon}"
        onclick="AppController.pickCategoryIcon('${i.name}')">${iconSvg(i.name, 20)}</button>`).join('')
    : '<p class="cat-icons-empty">Nenhum ícone encontrado.</p>';
}

export function pickCategoryIcon(name) {
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

export function updateCategoryPreview() {
  const bubble = document.getElementById('cat-preview-bubble');
  bubble.style.backgroundColor = state.catUI.color;
  bubble.style.color = inkFor(state.catUI.color);
  bubble.innerHTML = iconSvg(state.catUI.icon, 26);
  document.getElementById('cat-preview-name').innerText =
    document.getElementById('cat-name-input').value.trim() || 'Nova categoria';
}

export function onCategoryParentChange() {
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

export function openCategoryModal(id = null, parentId = null) {
  if (!state.categoriesPersisted) {
    app.showToast('Não foi possível carregar suas categorias. Verifique se as regras do Firestore foram publicadas.', 'error');
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

export function closeCategoryModal() {
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

export async function submitCategory(event) {
  event.preventDefault();
  const btn = document.getElementById('category-submit-btn');
  const nome = document.getElementById('cat-name-input').value.trim().replace(/\s+/g, ' ');
  const parent = findCategory(document.getElementById('cat-parent-select').value);
  const editing = state.catUI.editingId ? findCategory(state.catUI.editingId) : null;

  if (!nome) { app.showToast('Dê um nome para a categoria.', 'error'); return; }
  if (catKey(nome) === 'transferencia') { app.showToast('"Transferência" é um nome reservado do sistema.', 'error'); return; }
  if (state.categories.some(c => c.ID !== (editing && editing.ID) && catKey(c.Nome) === catKey(nome))) {
    app.showToast('Já existe uma categoria com esse nome.', 'error');
    return;
  }
  if (!isHexColor(state.catUI.color) || !isValidIcon(state.catUI.icon)) {
    app.showToast('Escolha uma cor e um ícone válidos.', 'error');
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
    app.renderTransactions();

    if (renameInfo && renameInfo.failed) {
      app.showToast(`Categoria salva, mas ${renameInfo.failed} de ${renameInfo.total} lançamentos não foram atualizados.`, 'error');
    } else if (renameInfo && renameInfo.total) {
      app.showToast(`Categoria salva. ${renameInfo.total} lançamento(s) atualizado(s).`, 'success');
    } else {
      app.showToast('Categoria salva com sucesso!', 'success');
    }
  } catch (error) {
    app.showToast('Erro ao salvar categoria: ' + error.message, 'error');
  } finally {
    btn.disabled = false;
  }
}

export async function deleteCategory(id) {
  const cat = findCategory(id);
  if (!cat || !state.categoriesPersisted) return;
  const subs = catChildren(cat.ID);
  const usage = categoryUsage();
  const inUse = [cat, ...subs].reduce((sum, c) => sum + (usage.get(catKey(c.Nome)) || 0), 0);

  const parts = [];
  if (subs.length) parts.push(`${subs.length} subcategoria(s) serão excluídas junto`);
  if (inUse) parts.push(`${inUse} lançamento(s) manterão o nome, sem cor nem ícone`);
  if (!await app.confirmDialog({
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
    app.renderTransactions();
    app.showToast('Categoria excluída.', 'success');
  } catch (error) {
    app.showToast('Erro ao excluir: ' + error.message, 'error');
  }
}

document.querySelectorAll('[data-lucide-inline]').forEach(el => { el.innerHTML = iconSvg(el.dataset.lucideInline, 16); });
