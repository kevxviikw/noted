/* ═══════════════════════════════════════════════════
   Noted — app.js
   Vanilla JS PWA  ·  No dependencies
   ═══════════════════════════════════════════════════ */

'use strict';

// ── Constants ──────────────────────────────────────────────────────────────
const STORAGE_KEY   = 'noted_v2';
const WINDOW_PAST   = 7;   // days before today to render
const WINDOW_FUTURE = 30;  // days after today to render
const TOTAL_DAYS    = WINDOW_PAST + 1 + WINDOW_FUTURE;
const TODAY_IDX     = WINDOW_PAST;  // index of today in the slide array

const TYPES = [
  { id: 'task',        label: 'Task',        icon: '✓' },
  { id: 'appointment', label: 'Appt',        icon: '📅' },
  { id: 'reminder',    label: 'Reminder',    icon: '🔔' },
  { id: 'note',        label: 'Note',        icon: '📝' },
];

// ── State ──────────────────────────────────────────────────────────────────
let data          = {};   // { "yyyy-MM-dd": [items…] }
let currentIdx    = TODAY_IDX;
let editingItem   = null; // { item, dateKey } or null
let swRegistration = null;

// ── Date helpers ───────────────────────────────────────────────────────────
function fmtDate(d) {
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}
function pad(n) { return String(n).padStart(2, '0'); }
function offsetDate(offset) {
  const d = new Date();
  d.setHours(0,0,0,0);
  d.setDate(d.getDate() + offset);
  return d;
}
function dateForIdx(idx) { return offsetDate(idx - TODAY_IDX); }
function keyForIdx(idx)  { return fmtDate(dateForIdx(idx)); }
function relLabel(offset) {
  if (offset === -1) return 'Yesterday';
  if (offset ===  0) return 'Today';
  if (offset ===  1) return 'Tomorrow';
  const d = offsetDate(offset);
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
}
function subLabel(offset) {
  return offsetDate(offset).toLocaleDateString('en-US',
    { month: 'long', day: 'numeric', year: 'numeric' });
}
function fmtTime(isoStr) {
  if (!isoStr) return '';
  try {
    // Stored as "HH:MM"
    const [h, m] = isoStr.split(':').map(Number);
    const ampm = h >= 12 ? 'PM' : 'AM';
    return `${h % 12 || 12}:${pad(m)} ${ampm}`;
  } catch { return isoStr; }
}
function uuid() {
  return crypto.randomUUID
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random()*16|0;
        return (c==='x' ? r : (r&3|8)).toString(16);
      });
}

// ── Persistence ────────────────────────────────────────────────────────────
function load() {
  try { data = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); }
  catch { data = {}; }
}
function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}
function itemsFor(key) { return data[key] || []; }

// ── DOM helpers ────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
}
function esc(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;')
                       .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Build slides ───────────────────────────────────────────────────────────
function buildTrack() {
  const track = $('days-track');
  track.innerHTML = '';
  for (let i = 0; i < TOTAL_DAYS; i++) {
    const slide = el('div', 'day-slide');
    const rel = i - TODAY_IDX;
    slide.dataset.idx = i;
    slide.dataset.rel = rel;
    slide.id = `slide-${i}`;
    track.appendChild(slide);
    renderSlide(i);
  }
  // Scroll to today immediately (no animation)
  const todaySlide = $(`slide-${TODAY_IDX}`);
  track.scrollLeft = todaySlide.offsetLeft;
}

function renderSlide(idx) {
  const slide = $(`slide-${idx}`);
  if (!slide) return;
  const rel  = idx - TODAY_IDX;
  const key  = keyForIdx(idx);
  const items = itemsFor(key);
  const pending = items.filter(i => !i.isCompleted);
  const done    = items.length - pending.length;
  const pct     = items.length ? (done / items.length * 100).toFixed(1) : 0;

  slide.innerHTML = `
    <div class="day-header">
      <div class="day-label-row">
        <div>
          <div class="day-name">${esc(relLabel(rel))}</div>
          <div class="day-date">${esc(subLabel(rel))}</div>
        </div>
        ${items.length ? `
          <div class="count-badge">
            <span class="num">${pending.length}</span>
            <span class="lbl">left</span>
          </div>` : ''}
      </div>
      ${items.length ? `
        <div class="progress-row">
          <div class="progress-fill" style="width:${pct}%"></div>
        </div>` : ''}
    </div>
    <div class="header-divider"></div>
    <div class="items-scroll" id="items-${idx}">
      ${items.length === 0 ? `
        <div class="empty-state">
          <div class="icon">${rel < 0 ? '🌙' : rel === 0 ? '⭐' : '🌤'}</div>
          <div class="title">${rel === 0 ? 'Nothing yet today' : rel < 0 ? 'All clear' : 'Nothing planned'}</div>
          <div class="sub">Tap + to add something</div>
        </div>` :
        items.map((item, itemIdx) => renderItemCard(item, key, idx, itemIdx)).join('')
      }
    </div>`;

  // Attach card event listeners
  items.forEach(item => {
    const card = slide.querySelector(`[data-id="${item.id}"]`);
    if (!card) return;
    card.querySelector('.item-check').addEventListener('click', e => {
      e.stopPropagation();
      toggleItem(item.id, key, idx);
    });
    card.addEventListener('click', () => openEditSheet(item, key, idx));
    attachSwipe(card, item.id, key, idx);
  });
}

function renderItemCard(item, key, idx, itemIdx) {
  const typeObj = TYPES.find(t => t.id === item.type) || TYPES[0];
  return `
    <div class="item-card ${item.isCompleted ? 'completed' : ''}"
         data-id="${esc(item.id)}"
         style="animation-delay:${itemIdx * 0.04}s">
      <div class="item-check ${item.isCompleted ? 'done' : ''}">
        <svg class="check-icon" viewBox="0 0 12 12" fill="none">
          <polyline points="1.5,6 5,9.5 10.5,2.5"
            stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </div>
      <div class="item-body">
        <div class="item-title">${esc(item.title)}</div>
        ${item.detail ? `<div class="item-detail">${esc(item.detail)}</div>` : ''}
      </div>
      <div class="item-meta">
        <span class="type-icon">${typeObj.icon}</span>
        ${item.time ? `<span class="item-time">${esc(fmtTime(item.time))}</span>` : ''}
      </div>
    </div>`;
}

// ── Swipe-to-delete on item cards ─────────────────────────────────────────
function attachSwipe(card, itemId, key, slideIdx) {
  let startX = 0, startY = 0, dragging = false;

  card.addEventListener('touchstart', e => {
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    dragging = false;
  }, { passive: true });

  card.addEventListener('touchmove', e => {
    const dx = e.touches[0].clientX - startX;
    const dy = Math.abs(e.touches[0].clientY - startY);
    if (!dragging && Math.abs(dx) > 10 && dy < 30) {
      dragging = true;
    }
    if (dragging && dx < -20) {
      card.classList.add('swipe-reveal');
      e.stopPropagation();
    } else if (dragging && dx > 10) {
      card.classList.remove('swipe-reveal');
    }
  }, { passive: true });

  card.addEventListener('touchend', e => {
    if (dragging && card.classList.contains('swipe-reveal')) {
      const dx = e.changedTouches[0].clientX - startX;
      if (dx < -60) {
        deleteItem(itemId, key, slideIdx);
        return;
      }
    }
    if (!dragging) return;
    card.classList.remove('swipe-reveal');
  });
}

// ── CRUD ───────────────────────────────────────────────────────────────────
function toggleItem(id, key, slideIdx) {
  const list = data[key];
  if (!list) return;
  const item = list.find(i => i.id === id);
  if (item) { item.isCompleted = !item.isCompleted; save(); renderSlide(slideIdx); }
}

function deleteItem(id, key, slideIdx) {
  if (!data[key]) return;
  data[key] = data[key].filter(i => i.id !== id);
  save();
  renderSlide(slideIdx);
  updateDots();
}

function addItem(title, detail, type, timeVal, key, slideIdx) {
  if (!data[key]) data[key] = [];
  data[key].push({
    id: uuid(), title, detail, type,
    time: timeVal || null,
    isCompleted: false,
    createdAt: new Date().toISOString()
  });
  save();
  renderSlide(slideIdx);
  updateDots();
}

function updateItem(id, key, slideIdx, changes) {
  const list = data[key];
  if (!list) return;
  const item = list.find(i => i.id === id);
  if (item) { Object.assign(item, changes); save(); renderSlide(slideIdx); updateDots(); }
}

// ── Sheets ─────────────────────────────────────────────────────────────────
function openSheet(overlayId) {
  const overlay = $(overlayId);
  overlay.style.display = 'block';
  requestAnimationFrame(() => overlay.classList.add('open'));
  document.body.style.overflow = 'hidden';
}
function closeSheet(overlayId) {
  const overlay = $(overlayId);
  overlay.classList.remove('open');
  document.body.style.overflow = '';
  setTimeout(() => { overlay.style.display = 'none'; }, 380);
}

// ── Add sheet ──────────────────────────────────────────────────────────────
function openAddSheet() {
  resetAddForm();
  openSheet('add-overlay');
  setTimeout(() => $('add-title').focus(), 400);
}

function resetAddForm() {
  $('add-title').value = '';
  $('add-detail').value = '';
  $('add-time-check').checked = false;
  $('add-time-val').disabled = true;
  $('add-time-val').value = '';
  selectType('add', 'task');
}

function selectType(prefix, typeId) {
  document.querySelectorAll(`#${prefix}-type-row .type-pill`).forEach(p => {
    p.classList.toggle('selected', p.dataset.type === typeId);
  });
}

function submitAdd() {
  const title = $('add-title').value.trim();
  if (!title) return;
  const detail  = $('add-detail').value.trim();
  const typeEl  = document.querySelector('#add-type-row .type-pill.selected');
  const type    = typeEl ? typeEl.dataset.type : 'task';
  const hasTime = $('add-time-check').checked;
  const timeVal = hasTime ? $('add-time-val').value : null;
  const key     = keyForIdx(currentIdx);
  addItem(title, detail, type, timeVal, key, currentIdx);
  closeSheet('add-overlay');
}

// ── Edit sheet ─────────────────────────────────────────────────────────────
function openEditSheet(item, key, slideIdx) {
  editingItem = { item, key, slideIdx };
  $('edit-title').value  = item.title || '';
  $('edit-detail').value = item.detail || '';
  selectType('edit', item.type || 'task');
  const hasTime = !!item.time;
  $('edit-time-check').checked = hasTime;
  $('edit-time-val').disabled  = !hasTime;
  $('edit-time-val').value     = item.time || '';
  openSheet('edit-overlay');
  setTimeout(() => $('edit-title').focus(), 400);
}

function submitEdit() {
  if (!editingItem) return;
  const title = $('edit-title').value.trim();
  if (!title) return;
  const detail  = $('edit-detail').value.trim();
  const typeEl  = document.querySelector('#edit-type-row .type-pill.selected');
  const type    = typeEl ? typeEl.dataset.type : editingItem.item.type;
  const hasTime = $('edit-time-check').checked;
  const timeVal = hasTime ? $('edit-time-val').value : null;
  updateItem(editingItem.item.id, editingItem.key, editingItem.slideIdx,
    { title, detail, type, time: timeVal });
  closeSheet('edit-overlay');
  editingItem = null;
}

function submitDelete() {
  if (!editingItem) return;
  deleteItem(editingItem.item.id, editingItem.key, editingItem.slideIdx);
  closeSheet('edit-overlay');
  editingItem = null;
}

// ── Day dots ────────────────────────────────────────────────────────────────
function buildDots() {
  const container = $('day-dots');
  container.innerHTML = '';
  // Show dots for today ±3
  for (let i = TODAY_IDX - 3; i <= TODAY_IDX + 3; i++) {
    const dot = el('div', 'day-dot' + (i === TODAY_IDX ? ' active' : ''));
    dot.dataset.idx = i;
    container.appendChild(dot);
  }
}

function updateDots() {
  document.querySelectorAll('.day-dot').forEach(dot => {
    const idx = parseInt(dot.dataset.idx);
    dot.classList.toggle('active', idx === currentIdx);
  });
}

// ── Scroll / snap tracking ─────────────────────────────────────────────────
function initScrollTracking() {
  const track = $('days-track');
  let scrollTimer;
  track.addEventListener('scroll', () => {
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => {
      const slideW = track.offsetWidth;
      const newIdx = Math.round(track.scrollLeft / slideW);
      if (newIdx !== currentIdx && newIdx >= 0 && newIdx < TOTAL_DAYS) {
        currentIdx = newIdx;
        updateDots();
      }
    }, 80);
  }, { passive: true });
}

// ── Settings / notifications ─────────────────────────────────────────────────
let reminderTimer = null;

function scheduleLocalReminder(hourMinStr) {
  // hourMinStr = "HH:MM"
  clearTimeout(reminderTimer);
  const [h, m] = hourMinStr.split(':').map(Number);
  const now  = new Date();
  const next = new Date();
  next.setHours(h, m, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  const delay = next - now;

  reminderTimer = setTimeout(() => {
    const todayKey = fmtDate(new Date());
    const items = itemsFor(todayKey).filter(i => !i.isCompleted);
    const body = items.length === 0
      ? "You're all clear today! ✓"
      : `${items.length} item${items.length>1?'s':''} today — tap to review.`;

    if (swRegistration) {
      swRegistration.showNotification('🌙 Noted', { body, tag: 'noted-daily', icon: '/icon-192.png' });
    } else if (Notification.permission === 'granted') {
      new Notification('🌙 Noted', { body, tag: 'noted-daily' });
    }
    // Schedule tomorrow
    scheduleLocalReminder(hourMinStr);
  }, delay);

  localStorage.setItem('noted_reminder', hourMinStr);
}

async function requestNotifications() {
  if (!('Notification' in window)) {
    alert('Notifications are not supported in this browser.\nTry Safari on iPhone with Noted added to your Home Screen.');
    return;
  }
  const perm = await Notification.requestPermission();
  if (perm === 'granted') {
    const time = $('reminder-time').value || '08:00';
    scheduleLocalReminder(time);
    alert(`✓ Morning reminder set for ${fmtTime(time)} every day!`);
  } else {
    alert('Notification permission denied. Enable it in Settings → Safari → Notifications.');
  }
}

// ── Export / Import ─────────────────────────────────────────────────────────
function exportData() {
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = `noted-backup-${fmtDate(new Date())}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function importData(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const imported = JSON.parse(ev.target.result);
      if (typeof imported !== 'object') throw new Error();
      // Merge: imported keys win
      data = { ...data, ...imported };
      save();
      buildTrack();
      updateDots();
      closeSheet('settings-overlay');
      alert('✓ Data imported successfully!');
    } catch {
      alert('Invalid file. Please use a Noted backup JSON.');
    }
  };
  reader.readAsText(file);
  e.target.value = '';
}

// ── Build type rows ──────────────────────────────────────────────────────────
function buildTypeRow(prefix) {
  const row = $(`${prefix}-type-row`);
  if (!row) return;
  row.innerHTML = TYPES.map(t => `
    <button class="type-pill ${t.id==='task' ? 'selected' : ''}" data-type="${t.id}">
      <span class="tp-icon">${t.icon}</span>
      <span>${t.label}</span>
    </button>`).join('');
  row.querySelectorAll('.type-pill').forEach(btn => {
    btn.addEventListener('click', () => selectType(prefix, btn.dataset.type));
  });
}

// ── Service Worker registration ──────────────────────────────────────────────
async function registerSW() {
  if ('serviceWorker' in navigator) {
    try {
      swRegistration = await navigator.serviceWorker.register('/sw.js');
    } catch (e) {
      // sw registration failure is non-fatal (e.g. file:// protocol)
      console.warn('SW registration failed (ok if running from file://):', e.message);
    }
  }
}

// ── Key events ───────────────────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    ['add-overlay','edit-overlay','settings-overlay'].forEach(closeSheet);
  }
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
    if ($('add-overlay').classList.contains('open')) submitAdd();
    if ($('edit-overlay').classList.contains('open')) submitEdit();
  }
});

// ── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  load();
  buildTrack();
  buildDots();
  buildTypeRow('add');
  buildTypeRow('edit');
  initScrollTracking();
  await registerSW();

  // Restore reminder if set
  const savedReminder = localStorage.getItem('noted_reminder');
  if (savedReminder) {
    const ri = $('reminder-time');
    if (ri) ri.value = savedReminder;
    if (Notification.permission === 'granted') {
      scheduleLocalReminder(savedReminder);
    }
  }

  // ── Event listeners ──────────────────────────────────────────────────
  // Add sheet
  $('add-btn').addEventListener('click', openAddSheet);
  $('add-cancel').addEventListener('click', () => closeSheet('add-overlay'));
  $('add-save').addEventListener('click', submitAdd);
  $('add-overlay').addEventListener('click', e => {
    if (e.target === $('add-overlay')) closeSheet('add-overlay');
  });
  $('add-title').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitAdd(); }
  });
  $('add-title').addEventListener('input', () => {
    $('add-save').disabled = !$('add-title').value.trim();
  });
  $('add-time-check').addEventListener('change', e => {
    $('add-time-val').disabled = !e.target.checked;
    if (e.target.checked) $('add-time-val').focus();
  });

  // Edit sheet
  $('edit-cancel').addEventListener('click', () => closeSheet('edit-overlay'));
  $('edit-save').addEventListener('click', submitEdit);
  $('edit-delete').addEventListener('click', submitDelete);
  $('edit-overlay').addEventListener('click', e => {
    if (e.target === $('edit-overlay')) closeSheet('edit-overlay');
  });
  $('edit-title').addEventListener('input', () => {
    $('edit-save').disabled = !$('edit-title').value.trim();
  });
  $('edit-time-check').addEventListener('change', e => {
    $('edit-time-val').disabled = !e.target.checked;
    if (e.target.checked) $('edit-time-val').focus();
  });

  // Settings
  $('settings-btn').addEventListener('click', () => openSheet('settings-overlay'));
  $('settings-close').addEventListener('click', () => closeSheet('settings-overlay'));
  $('settings-overlay').addEventListener('click', e => {
    if (e.target === $('settings-overlay')) closeSheet('settings-overlay');
  });
  $('btn-notif').addEventListener('click', requestNotifications);
  $('btn-export').addEventListener('click', exportData);
  $('btn-import').addEventListener('click', () => $('import-input').click());
  $('import-input').addEventListener('change', importData);
});
