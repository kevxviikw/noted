/* ═══════════════════════════════════════════════════
   Noted — app.js
   Vanilla JS PWA  ·  No dependencies
   ═══════════════════════════════════════════════════ */

'use strict';

// ── Constants ──────────────────────────────────────────────────────────────
const STORAGE_KEY   = 'noted_v2';
const WINDOW_PAST   = 7;
const WINDOW_FUTURE = 30;
const TOTAL_DAYS    = WINDOW_PAST + 1 + WINDOW_FUTURE;
const TODAY_IDX     = WINDOW_PAST;

const TYPES = [
  { id: 'task',        label: 'Task',     icon: '✓'  },
  { id: 'appointment', label: 'Appt',     icon: '📅' },
  { id: 'reminder',    label: 'Reminder', icon: '🔔' },
  { id: 'note',        label: 'Note',     icon: '📝' },
];

// ── State ──────────────────────────────────────────────────────────────────
let data           = {};
let currentIdx     = TODAY_IDX;
let editingItem    = null;
let swRegistration = null;

// itemId → timeoutId  (tracks scheduled per-item notification timers)
const itemTimers = new Map();

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
function todayKey()      { return fmtDate(new Date()); }
function tomorrowKey()   { return fmtDate(offsetDate(1)); }

function relLabel(offset) {
  if (offset === -1) return 'Yesterday';
  if (offset ===  0) return 'Today';
  if (offset ===  1) return 'Tomorrow';
  return offsetDate(offset).toLocaleDateString('en-US',
    { weekday: 'long', month: 'short', day: 'numeric' });
}
function subLabel(offset) {
  return offsetDate(offset).toLocaleDateString('en-US',
    { month: 'long', day: 'numeric', year: 'numeric' });
}
function fmtTime(hhmm) {
  if (!hhmm) return '';
  try {
    const [h, m] = hhmm.split(':').map(Number);
    return `${h % 12 || 12}:${pad(m)} ${h >= 12 ? 'PM' : 'AM'}`;
  } catch { return hhmm; }
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

// ══════════════════════════════════════════════════════════════════════════
//  NOTIFICATION SYSTEM
// ══════════════════════════════════════════════════════════════════════════

// ── Request permission ─────────────────────────────────────────────────────
async function ensureNotifPermission() {
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  const result = await Notification.requestPermission();
  return result === 'granted';
}

// ── Fire one notification via SW (supports actions) ────────────────────────
function showNotification(title, body, tag, itemId, dateKey) {
  if (!swRegistration) return;
  swRegistration.showNotification(title, {
    body,
    tag,
    icon: '/noted/icon-192.png',
    badge: '/noted/icon-192.png',
    renotify: true,
    // Action buttons — shown on lock screen & notification centre
    actions: [
      { action: 'complete', title: '✓ Done'  },
      { action: 'dismiss',  title: 'Dismiss' },
    ],
    // Pass item info so SW can route the action back to us
    data: { itemId, dateKey, url: '/noted/' },
  });
}

// ── Schedule a single item notification at its time ────────────────────────
function scheduleOneItem(item, dateKey) {
  if (!item.time || item.isCompleted) return;

  // Cancel any existing timer for this item
  cancelItemTimer(item.id);

  // Build a Date for the item's time on the item's day
  const [year, month, day] = dateKey.split('-').map(Number);
  const [hh, mm]           = item.time.split(':').map(Number);
  const fireAt = new Date(year, month - 1, day, hh, mm, 0, 0);
  const delay  = fireAt - Date.now();

  if (delay <= 0) return; // already past — don't fire

  const typeObj = TYPES.find(t => t.id === item.type) || TYPES[0];
  const title   = `${typeObj.icon} ${item.title}`;
  const body    = item.detail || `${typeObj.label} at ${fmtTime(item.time)}`;
  const tag     = `noted-item-${item.id}`;

  const timerId = setTimeout(async () => {
    itemTimers.delete(item.id);
    if (!(await ensureNotifPermission())) return;
    showNotification(title, body, tag, item.id, dateKey);
  }, delay);

  itemTimers.set(item.id, timerId);
}

// ── Cancel a pending timer ─────────────────────────────────────────────────
function cancelItemTimer(itemId) {
  if (itemTimers.has(itemId)) {
    clearTimeout(itemTimers.get(itemId));
    itemTimers.delete(itemId);
  }
}

// ── (Re-)schedule all pending timed items for today & tomorrow ─────────────
function rescheduleAllNotifications() {
  if (Notification.permission !== 'granted') return;
  // Cancel everything first
  itemTimers.forEach((t) => clearTimeout(t));
  itemTimers.clear();

  [todayKey(), tomorrowKey()].forEach(dateKey => {
    itemsFor(dateKey)
      .filter(i => i.time && !i.isCompleted)
      .forEach(i => scheduleOneItem(i, dateKey));
  });
}

// ── Morning summary notification (for items with no time) ──────────────────
let morningTimer = null;

function scheduleMorningReminder(hourMinStr) {
  clearTimeout(morningTimer);
  const [h, m] = hourMinStr.split(':').map(Number);
  const now    = new Date();
  const next   = new Date();
  next.setHours(h, m, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);

  morningTimer = setTimeout(async () => {
    if (!(await ensureNotifPermission())) return;

    const key   = todayKey();
    const items = itemsFor(key).filter(i => !i.isCompleted);
    // Items with no time — the timed ones will fire on their own
    const untimedItems = items.filter(i => !i.time);

    if (items.length === 0) {
      showNotification('🌙 Noted', "You're all clear today! ✓",
        'noted-morning', null, null);
    } else {
      const lines = untimedItems.slice(0, 3).map(i => {
        const t = TYPES.find(x => x.id === i.type) || TYPES[0];
        return `${t.icon} ${i.title}`;
      }).join('\n');
      const extra = untimedItems.length > 3
        ? `\n+${untimedItems.length - 3} more` : '';
      const timedNote = items.length > untimedItems.length
        ? ` · ${items.length - untimedItems.length} timed item${items.length - untimedItems.length > 1 ? 's' : ''} will notify on time` : '';
      showNotification(
        `🌙 Noted — ${items.length} item${items.length>1?'s':''} today`,
        (lines || 'Tap to review your day') + extra + timedNote,
        'noted-morning', null, key
      );
    }

    // Reschedule for tomorrow
    scheduleMorningReminder(hourMinStr);
    // Also reschedule timed items for today (fresh day)
    rescheduleAllNotifications();
  }, next - now);

  localStorage.setItem('noted_reminder', hourMinStr);
}

// ── Handle "✓ Done" tapped on a notification (message from SW) ────────────
function handleCompleteFromNotification(itemId, dateKey) {
  const list = data[dateKey];
  if (!list) return;
  const item = list.find(i => i.id === itemId);
  if (!item || item.isCompleted) return;
  item.isCompleted = true;
  save();
  cancelItemTimer(itemId);
  // Re-render whichever slide matches this dateKey
  for (let i = 0; i < TOTAL_DAYS; i++) {
    if (keyForIdx(i) === dateKey) { renderSlide(i); break; }
  }
}

// ── Listen for messages from the Service Worker ────────────────────────────
function listenForSWMessages() {
  if (!navigator.serviceWorker) return;
  navigator.serviceWorker.addEventListener('message', e => {
    if (!e.data) return;
    if (e.data.type === 'COMPLETE_ITEM') {
      handleCompleteFromNotification(e.data.itemId, e.data.dateKey);
    }
  });
}

// ── UI: request notifications & set morning reminder ──────────────────────
async function requestNotifications() {
  if (!('Notification' in window)) {
    alert('Notifications are not supported.\nAdd Noted to your Home Screen via Safari first.');
    return;
  }
  const granted = await ensureNotifPermission();
  if (granted) {
    const time = $('reminder-time').value || '08:00';
    scheduleMorningReminder(time);
    rescheduleAllNotifications();
    alert(
      `✓ Notifications enabled!\n\n` +
      `• Morning summary: ${fmtTime(time)} daily\n` +
      `• Items with a time: notification exactly at that time\n` +
      `• Swipe a notification to dismiss it`
    );
  } else {
    alert('Permission denied.\nGo to iPhone Settings → Notifications → Noted and enable them.');
  }
}

// ══════════════════════════════════════════════════════════════════════════
//  SLIDES / RENDERING
// ══════════════════════════════════════════════════════════════════════════

function buildTrack() {
  const track = $('days-track');
  track.innerHTML = '';
  for (let i = 0; i < TOTAL_DAYS; i++) {
    const slide = el('div', 'day-slide');
    slide.dataset.idx = i;
    slide.dataset.rel = i - TODAY_IDX;
    slide.id = `slide-${i}`;
    track.appendChild(slide);
    renderSlide(i);
  }
  const todaySlide = $(`slide-${TODAY_IDX}`);
  track.scrollLeft = todaySlide.offsetLeft;
}

function renderSlide(idx) {
  const slide = $(`slide-${idx}`);
  if (!slide) return;
  const rel   = idx - TODAY_IDX;
  const key   = keyForIdx(idx);
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
        items.map((item, ii) => renderItemCard(item, key, idx, ii)).join('')
      }
    </div>`;

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
  const hasNotif = item.time && !item.isCompleted && Notification.permission === 'granted';
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
        ${item.time ? `<span class="item-time">${esc(fmtTime(item.time))}${hasNotif ? ' 🔔' : ''}</span>` : ''}
      </div>
    </div>`;
}

// ── Swipe-to-delete ────────────────────────────────────────────────────────
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
    if (!dragging && Math.abs(dx) > 10 && dy < 30) dragging = true;
    if (dragging && dx < -20) { card.classList.add('swipe-reveal'); e.stopPropagation(); }
    else if (dragging && dx > 10) card.classList.remove('swipe-reveal');
  }, { passive: true });
  card.addEventListener('touchend', e => {
    if (dragging && card.classList.contains('swipe-reveal')) {
      if (e.changedTouches[0].clientX - startX < -60) {
        deleteItem(itemId, key, slideIdx);
        return;
      }
    }
    if (dragging) card.classList.remove('swipe-reveal');
  });
}

// ── CRUD ───────────────────────────────────────────────────────────────────
function toggleItem(id, key, slideIdx) {
  const list = data[key];
  if (!list) return;
  const item = list.find(i => i.id === id);
  if (!item) return;
  item.isCompleted = !item.isCompleted;
  save();
  renderSlide(slideIdx);
  if (item.isCompleted) cancelItemTimer(id);
  else scheduleOneItem(item, key);
}

function deleteItem(id, key, slideIdx) {
  if (!data[key]) return;
  cancelItemTimer(id);
  data[key] = data[key].filter(i => i.id !== id);
  save();
  renderSlide(slideIdx);
  updateDots();
}

function addItem(title, detail, type, timeVal, key, slideIdx) {
  if (!data[key]) data[key] = [];
  const item = { id: uuid(), title, detail, type,
    time: timeVal || null, isCompleted: false, createdAt: new Date().toISOString() };
  data[key].push(item);
  save();
  renderSlide(slideIdx);
  updateDots();
  // Schedule notification if it has a time and notifications are on
  if (item.time && Notification.permission === 'granted') scheduleOneItem(item, key);
}

function updateItem(id, key, slideIdx, changes) {
  const list = data[key];
  if (!list) return;
  const item = list.find(i => i.id === id);
  if (!item) return;
  Object.assign(item, changes);
  save();
  cancelItemTimer(id);
  if (item.time && !item.isCompleted && Notification.permission === 'granted') {
    scheduleOneItem(item, key);
  }
  renderSlide(slideIdx);
  updateDots();
}

// ── Sheets ─────────────────────────────────────────────────────────────────
function openSheet(id) {
  const o = $(id);
  o.style.display = 'block';
  requestAnimationFrame(() => o.classList.add('open'));
  document.body.style.overflow = 'hidden';
}
function closeSheet(id) {
  const o = $(id);
  o.classList.remove('open');
  document.body.style.overflow = '';
  setTimeout(() => { o.style.display = 'none'; }, 380);
}

function openAddSheet() {
  $('add-title').value = '';
  $('add-detail').value = '';
  $('add-time-check').checked = false;
  $('add-time-val').disabled = true;
  $('add-time-val').value = '';
  selectType('add', 'task');
  openSheet('add-overlay');
  setTimeout(() => $('add-title').focus(), 400);
}

function selectType(prefix, typeId) {
  document.querySelectorAll(`#${prefix}-type-row .type-pill`)
    .forEach(p => p.classList.toggle('selected', p.dataset.type === typeId));
}

function submitAdd() {
  const title = $('add-title').value.trim();
  if (!title) return;
  const detail  = $('add-detail').value.trim();
  const typeEl  = document.querySelector('#add-type-row .type-pill.selected');
  const type    = typeEl ? typeEl.dataset.type : 'task';
  const hasTime = $('add-time-check').checked;
  const timeVal = hasTime ? $('add-time-val').value : null;
  addItem(title, detail, type, timeVal, keyForIdx(currentIdx), currentIdx);
  closeSheet('add-overlay');
}

function openEditSheet(item, key, slideIdx) {
  editingItem = { item, key, slideIdx };
  $('edit-title').value        = item.title || '';
  $('edit-detail').value       = item.detail || '';
  $('edit-time-check').checked = !!item.time;
  $('edit-time-val').disabled  = !item.time;
  $('edit-time-val').value     = item.time || '';
  selectType('edit', item.type || 'task');
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

// ── Dots ───────────────────────────────────────────────────────────────────
function buildDots() {
  const c = $('day-dots');
  c.innerHTML = '';
  for (let i = TODAY_IDX - 3; i <= TODAY_IDX + 3; i++) {
    const d = el('div', 'day-dot' + (i === TODAY_IDX ? ' active' : ''));
    d.dataset.idx = i;
    c.appendChild(d);
  }
}
function updateDots() {
  document.querySelectorAll('.day-dot').forEach(d => {
    d.classList.toggle('active', parseInt(d.dataset.idx) === currentIdx);
  });
}

// ── Scroll tracking ────────────────────────────────────────────────────────
function initScrollTracking() {
  const track = $('days-track');
  let t;
  track.addEventListener('scroll', () => {
    clearTimeout(t);
    t = setTimeout(() => {
      const newIdx = Math.round(track.scrollLeft / track.offsetWidth);
      if (newIdx !== currentIdx && newIdx >= 0 && newIdx < TOTAL_DAYS) {
        currentIdx = newIdx;
        updateDots();
      }
    }, 80);
  }, { passive: true });
}

// ── Export / Import ────────────────────────────────────────────────────────
function exportData() {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement('a'),
    { href: url, download: `noted-backup-${fmtDate(new Date())}.json` });
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
      if (typeof imported !== 'object') throw 0;
      data = { ...data, ...imported };
      save(); buildTrack(); updateDots(); rescheduleAllNotifications();
      closeSheet('settings-overlay');
      alert('✓ Data imported!');
    } catch { alert('Invalid file. Use a Noted backup JSON.'); }
  };
  reader.readAsText(file);
  e.target.value = '';
}

// ── Build type pills ────────────────────────────────────────────────────────
function buildTypeRow(prefix) {
  const row = $(`${prefix}-type-row`);
  if (!row) return;
  row.innerHTML = TYPES.map(t => `
    <button class="type-pill ${t.id==='task'?'selected':''}" data-type="${t.id}">
      <span class="tp-icon">${t.icon}</span><span>${t.label}</span>
    </button>`).join('');
  row.querySelectorAll('.type-pill').forEach(btn =>
    btn.addEventListener('click', () => selectType(prefix, btn.dataset.type))
  );
}

// ── Service Worker ──────────────────────────────────────────────────────────
async function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  try {
    swRegistration = await navigator.serviceWorker.register('./sw.js');
    listenForSWMessages();
  } catch (e) {
    console.warn('SW registration failed:', e.message);
  }
}

// ── Keyboard shortcuts ──────────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.key === 'Escape')
    ['add-overlay','edit-overlay','settings-overlay'].forEach(closeSheet);
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
    if ($('add-overlay').classList.contains('open'))  submitAdd();
    if ($('edit-overlay').classList.contains('open')) submitEdit();
  }
});

// ── Init ────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  load();
  buildTrack();
  buildDots();
  buildTypeRow('add');
  buildTypeRow('edit');
  initScrollTracking();
  await registerSW();

  // Ask SW for any "Done" actions that fired while app was closed
  if (navigator.serviceWorker && navigator.serviceWorker.controller) {
    navigator.serviceWorker.controller.postMessage({ type: 'GET_PENDING_COMPLETIONS' });
  }
  // Also handle them if they arrive later
  if (navigator.serviceWorker) {
    navigator.serviceWorker.addEventListener('message', e => {
      if (e.data && e.data.type === 'PENDING_COMPLETIONS') {
        e.data.items.forEach(({ itemId, dateKey }) =>
          handleCompleteFromNotification(itemId, dateKey)
        );
      }
    });
  }

  // Restore morning reminder
  const saved = localStorage.getItem('noted_reminder');
  if (saved) {
    const ri = $('reminder-time');
    if (ri) ri.value = saved;
    if (Notification.permission === 'granted') {
      scheduleMorningReminder(saved);
      rescheduleAllNotifications();
    }
  }

  // ── Wire up all buttons ──────────────────────────────────────────────
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
