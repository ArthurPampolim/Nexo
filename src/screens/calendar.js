import { db } from '../firebase.js';
import { collection, addDoc, updateDoc, deleteDoc, doc } from 'firebase/firestore';
import { state, currencyFormatter, escapeHTML, formatDateBR, getCurrentUserId, fetchUserScopedDocs } from '../core.js';
import { parseLocalDate } from '../finance.js';
import { app } from '../app.js';

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

export async function loadEvents() {
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

export function renderCalendar(resetScroll = false) {
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
    chip.addEventListener('click', () => app.switchTab(chip.dataset.tab)));
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
      app.showToast('Erro ao mover evento: ' + error.message, 'error');
    }
    renderCalendar();
  };

  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerup', onUp);
  el.addEventListener('pointercancel', onUp);
}

export function calPrev() { ensureCalState(); state.cal.weekStart = calAddDays(state.cal.weekStart, -7); syncMiniToWeek(); renderCalendar(); }
export function calNext() { ensureCalState(); state.cal.weekStart = calAddDays(state.cal.weekStart, 7); syncMiniToWeek(); renderCalendar(); }
export function calToday() { state.cal.weekStart = calMondayOf(new Date()); syncMiniToWeek(); renderCalendar(); }
function syncMiniToWeek() {
  const mid = calAddDays(state.cal.weekStart, 3);
  state.cal.mini = { y: mid.getFullYear(), m: mid.getMonth() };
}

// ── Modal de evento ──
export function setEventType(type) {
  state.cal.type = type;
  document.getElementById('event-type-val').value = type;
  document.querySelectorAll('#event-type-picker .event-type-btn').forEach(btn =>
    btn.classList.toggle('active', btn.dataset.type === type));
}

export function toggleEventAllDay() {
  const allDay = document.getElementById('event-allday').checked;
  document.getElementById('event-times').classList.toggle('hidden', allDay);
}

export function openEventModal(id, preset) {
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

export function closeEventModal() {
  document.getElementById('event-modal').classList.add('hidden');
  state.cal.editingId = null;
}

export async function submitEvent(event) {
  event.preventDefault();
  const form = document.getElementById('event-form');
  const btn = document.getElementById('event-submit-btn');
  const allDay = document.getElementById('event-allday').checked;
  const inicio = form.elements.inicio.value || '09:00';
  let fim = form.elements.fim.value || inicio;

  if (!allDay && calToMin(fim) <= calToMin(inicio)) {
    app.showToast('O horário final deve ser depois do início.', 'error');
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
    app.showToast('Evento salvo com sucesso!', 'success');
    await loadEvents();
    renderCalendar();
  } catch (error) {
    app.showToast('Erro ao salvar evento: ' + error.message, 'error');
  } finally {
    btn.disabled = false;
  }
}

export async function deleteEventFromModal() {
  const ev = state.events.find(x => String(x.ID) === String(state.cal.editingId));
  if (!ev) return;
  if (!await app.confirmDialog({
    title: 'Excluir evento?',
    message: 'Esta ação não pode ser desfeita.',
    detail: `${ev.Titulo} · ${formatDateBR(ev.Data)}`
  })) return;
  try {
    await deleteDoc(doc(db, "Eventos", ev.ID));
    closeEventModal();
    app.showToast('Evento excluído.', 'success');
    await loadEvents();
    renderCalendar();
  } catch (error) {
    app.showToast('Erro ao excluir: ' + error.message, 'error');
  }
}
