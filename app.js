/**
 * ЕЖЕДНЕВНИК • БУМАЖНЫЙ PWA
 */

let swRegistration = null;
let isSubscribed = false;
let currentSubscription = null;
let subscriptionId = null;
let ws = null;
let wsReconnectTimer = null;
let isOfflineSimulated = false;
let notes = [];
let editingNoteId = null;
let deferredPrompt = null;

// ===== ИНИЦИАЛИЗАЦИЯ =====
document.addEventListener('DOMContentLoaded', () => {
    console.log('[Ежедневник] Открыт');
    loadNotes();
    initServiceWorker();
    initUI();
    checkNetworkStatus();
    detectDisplayMode();
    setupEventListeners();
    renderNotes();
    updateDateTime();
    setInterval(updateDateTime, 1000);
});

function updateDateTime() {
    const days = ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'];
    const months = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
    
    const now = new Date();
    const dayName = days[now.getDay()];
    const date = `${now.getDate()} ${months[now.getMonth()]}`;
    const time = now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    
    const dayEl = document.getElementById('currentDay');
    const dateEl = document.getElementById('currentDate');
    const timeEl = document.getElementById('currentTime');
    
    if (dayEl) dayEl.textContent = dayName;
    if (dateEl) dateEl.textContent = date;
    if (timeEl) timeEl.textContent = time;
}

// ===== ЗАМЕТКИ =====
function loadNotes() {
    try {
        const saved = localStorage.getItem('notebook_notes');
        notes = saved ? JSON.parse(saved) : [
            { id: '1', title: 'Первая запись', content: 'Это твой ежедневник. Здесь можно писать всё что угодно.', updatedAt: new Date().toISOString() },
            { id: '2', title: 'Офлайн', content: 'Записи сохраняются даже без интернета.', updatedAt: new Date().toISOString() }
        ];
        saveNotes();
    } catch (e) { notes = []; }
}

function saveNotes() { 
    try {
        localStorage.setItem('notebook_notes', JSON.stringify(notes)); 
        updateCounters(); 
    } catch (e) {}
}

function updateCounters() {
    const c = document.getElementById('notesCounter');
    if (c) c.textContent = notes.length;
}

function renderNotes() {
    const c = document.getElementById('notesList');
    if (!c) return;
    
    if (notes.length === 0) {
        c.innerHTML = '<div class="empty-record"><span class="empty-icon">📭</span><p>Пока пусто...</p><p class="handwritten-hint">напиши что-нибудь слева</p></div>';
        return;
    }
    
    c.innerHTML = notes.sort((a,b) => new Date(b.updatedAt) - new Date(a.updatedAt)).map(n => `
        <div class="record-item">
            <div class="record-item__header">
                <span class="record-item__title">${escapeHtml(n.title) || 'Без названия'}</span>
                <span class="record-item__time">${formatDate(n.updatedAt)}</span>
            </div>
            <div class="record-item__content">${escapeHtml(n.content).replace(/\n/g, '<br>')}</div>
            <div class="record-item__actions">
                <button class="record-item__btn record-item__btn--edit" data-edit="${n.id}">править</button>
                <button class="record-item__btn record-item__btn--delete" data-delete="${n.id}">удалить</button>
            </div>
        </div>
    `).join('');
    
    c.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => editNote(b.dataset.edit)));
    c.querySelectorAll('[data-delete]').forEach(b => b.addEventListener('click', () => deleteNote(b.dataset.delete)));
}

function escapeHtml(t) { 
    if (!t) return ''; 
    const d = document.createElement('div'); 
    d.textContent = t; 
    return d.innerHTML; 
}

function formatDate(d) { 
    try {
        return new Date(d).toLocaleDateString('ru-RU', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' }); 
    } catch { return ''; }
}

function addNote() {
    const title = document.getElementById('noteTitle')?.value.trim() || '';
    const content = document.getElementById('noteContent')?.value.trim() || '';
    if (!content) { showToast('Напиши хоть что-нибудь', 'error'); return; }
    
    if (editingNoteId) {
        const i = notes.findIndex(n => n.id === editingNoteId);
        if (i !== -1) notes[i] = { ...notes[i], title: title || 'Без названия', content, updatedAt: new Date().toISOString() };
        editingNoteId = null;
        const btn = document.getElementById('addNoteBtn');
        if (btn) btn.innerHTML = '<span>↧</span> В ежедневник';
    } else {
        notes.push({ id: Date.now() + Math.random().toString(36), title: title || 'Без названия', content, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
        if (isSubscribed) sendTestNotification();
    }
    saveNotes(); renderNotes();
    const titleInput = document.getElementById('noteTitle');
    const contentInput = document.getElementById('noteContent');
    if (titleInput) titleInput.value = '';
    if (contentInput) contentInput.value = '';
    showToast('Записано!', 'success');
}

function editNote(id) {
    const n = notes.find(n => n.id === id);
    if (!n) return;
    const titleInput = document.getElementById('noteTitle');
    const contentInput = document.getElementById('noteContent');
    if (titleInput) titleInput.value = n.title || '';
    if (contentInput) contentInput.value = n.content || '';
    const btn = document.getElementById('addNoteBtn');
    if (btn) btn.innerHTML = '<span>↻</span> Обновить';
    editingNoteId = id;
}

function deleteNote(id) {
    if (!confirm('Вырвать страницу?')) return;
    notes = notes.filter(n => n.id !== id);
    saveNotes(); renderNotes();
    if (editingNoteId === id) {
        editingNoteId = null;
        const btn = document.getElementById('addNoteBtn');
        if (btn) btn.innerHTML = '<span>↧</span> В ежедневник';
    }
}

// ===== SERVICE WORKER =====
async function initServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    try {
        swRegistration = await navigator.serviceWorker.register('/sw.js');
        updateSWStatus('активен', true);
        await checkPushSubscription();
    } catch (e) { updateSWStatus('ошибка', false); }
}

function updateSWStatus(t, a) {
    const el = document.getElementById('swText');
    if (el) el.textContent = t;
}

function initUI() {
    if ('PushManager' in window) {
        const b = document.getElementById('subscribeBtn');
        if (b) b.disabled = false;
    }
}

function detectDisplayMode() {
    const b = document.getElementById('displayModeBadge');
    if (b) b.textContent = window.matchMedia('(display-mode: standalone)').matches ? 'PWA' : 'Веб';
}

function checkNetworkStatus() {
    const update = () => {
        const online = navigator.onLine && !isOfflineSimulated;
        const t = document.getElementById('connectionText');
        const d = document.getElementById('connIndicator');
        const o = document.getElementById('offlineIndicator');
        if (t) t.textContent = online ? 'онлайн' : 'офлайн';
        if (d) d.className = 'margin-note__dot' + (online ? ' online' : '');
        if (o) o.style.display = online ? 'none' : 'flex';
    };
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
}

// ===== PUSH =====
async function checkPushSubscription() {
    if (!swRegistration) return;
    try {
        currentSubscription = await swRegistration.pushManager.getSubscription();
        isSubscribed = !!currentSubscription;
        updatePushUI();
    } catch (e) {}
}

async function subscribeToPush() {
    try {
        await Notification.requestPermission();
        const r = await fetch('/api/vapid-public-key');
        const { publicKey } = await r.json();
        currentSubscription = await swRegistration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8(publicKey) });
        const s = await fetch('/api/save-subscription', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(currentSubscription) });
        const d = await s.json();
        subscriptionId = d.subscriptionId;
        isSubscribed = true;
        updatePushUI();
        const idEl = document.getElementById('subscriptionIdDisplay');
        if (idEl) idEl.textContent = `id: ${subscriptionId?.slice(0,12) || ''}...`;
        showToast('Подписка оформлена', 'success');
    } catch (e) { showToast('Не вышло', 'error'); }
}

async function unsubscribeFromPush() {
    if (!currentSubscription) return;
    try {
        await currentSubscription.unsubscribe();
        if (subscriptionId) await fetch(`/api/subscription/${subscriptionId}`, { method: 'DELETE' });
        currentSubscription = null; isSubscribed = false; subscriptionId = null;
        updatePushUI();
        const idEl = document.getElementById('subscriptionIdDisplay');
        if (idEl) idEl.textContent = '';
    } catch (e) {}
}

async function sendTestNotification() {
    try {
        await fetch('/api/send-notification', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'Ежедневник', body: 'Новая запись!' }) });
    } catch (e) {}
}

function updatePushUI() {
    const s = document.getElementById('subscribeBtn'), u = document.getElementById('unsubscribeBtn'), send = document.getElementById('sendTestPushBtn');
    const st = document.getElementById('pushStatusText'), d = document.getElementById('pushDot');
    if (isSubscribed) {
        if (s) s.disabled = true; if (u) u.disabled = false; if (send) send.disabled = false;
        if (st) st.textContent = 'подписан'; if (d) d.className = 'ink-dot online';
    } else {
        if (s) s.disabled = false; if (u) u.disabled = true; if (send) send.disabled = true;
        if (st) st.textContent = 'не подписан'; if (d) d.className = 'ink-dot';
    }
}

// ===== WEBSOCKET =====
function connectWebSocket() {
    if (ws?.readyState === WebSocket.OPEN) return;
    try {
        ws = new WebSocket(`${location.protocol==='https:'?'wss:':'ws:'}//${location.host}`);
        updateWSStatus('off', 'подключение...');
        ws.onopen = () => { updateWSStatus('on', 'подключен'); updateWSButtons(true); addLog('Соединение установлено', 'success'); };
        ws.onclose = () => { updateWSStatus('off', 'отключен'); updateWSButtons(false); };
        ws.onerror = () => addLog('Ошибка', 'error');
        ws.onmessage = (e) => { 
            try { 
                const d = JSON.parse(e.data); 
                if (d.type==='connected') addLog(`ID: ${d.clientId}`); 
            } catch {} 
        };
    } catch (e) { updateWSStatus('off', 'ошибка'); }
}

function disconnectWebSocket() { 
    if (ws) { ws.close(); ws = null; } 
    updateWSStatus('off', 'отключен'); 
    updateWSButtons(false); 
}

function sendWSMessage() { 
    if (ws?.readyState === WebSocket.OPEN) { 
        ws.send(JSON.stringify({ type: 'ping' })); 
        addLog('Ping'); 
    } 
}

function updateWSStatus(s, t) { 
    const d = document.getElementById('wsDot'), st = document.getElementById('wsStatusText');
    if (d) d.className = 'ink-dot' + (s==='on'?' online':'');
    if (st) st.textContent = t;
}

function updateWSButtons(c) {
    const conn = document.getElementById('wsConnectBtn');
    const disconn = document.getElementById('wsDisconnectBtn');
    const send = document.getElementById('wsSendBtn');
    if (conn) conn.disabled = c;
    if (disconn) disconn.disabled = !c;
    if (send) send.disabled = !c;
}

function addLog(txt, type='') {
    const out = document.getElementById('wsOutput');
    if (!out) return;
    const time = new Date().toLocaleTimeString('ru-RU');
    out.innerHTML = `<div class="ink-log__line${type?' ink-log__line--'+type:''}">[${time}] ${txt}</div>` + out.innerHTML;
    while (out.children.length > 10) out.removeChild(out.lastChild);
}

// ===== КЕШ =====
async function fetchData() {
    const drawer = document.getElementById('dataOutput');
    const content = document.getElementById('drawerContent');
    if (!drawer || !content) return;
    
    content.innerHTML = '<div class="ink-log__line ink-log__line--muted">загрузка...</div>';
    drawer.style.display = 'block';
    
    try {
        const r = await fetch('/api/test-data');
        const d = await r.json();
        content.innerHTML = `<div class="ink-log__line ink-log__line--success">Статус: ${r.status}</div>`;
        d.items.forEach(i => { content.innerHTML += `<div class="ink-log__line">• ${i.name}: ${i.value.toFixed(4)}</div>`; });
        updateCacheInfo();
    } catch (e) { 
        content.innerHTML = `<div class="ink-log__line ink-log__line--error">Ошибка: ${e.message}</div>`; 
    }
}

async function clearCache() {
    if (!('caches' in window)) return;
    try {
        const n = await caches.keys();
        await Promise.all(n.map(k => caches.delete(k)));
        updateCacheInfo();
        showToast(`Кеш очищен (${n.length})`, 'success');
    } catch (e) { showToast('Ошибка очистки', 'error'); }
}

async function updateCacheInfo() {
    const el = document.getElementById('cacheInfo');
    if (!el || !('caches' in window)) return;
    try {
        const n = await caches.keys();
        let c = 0;
        for (const k of n) { const cache = await caches.open(k); c += (await cache.keys()).length; }
        el.textContent = `${c} файлов`;
    } catch { el.textContent = 'ошибка'; }
}

function simulateOffline() {
    isOfflineSimulated = !isOfflineSimulated;
    const b = document.getElementById('testOfflineBtn');
    if (b) b.style.background = isOfflineSimulated ? '#d4a017' : '';
    checkNetworkStatus();
    showToast(isOfflineSimulated ? 'Офлайн-режим' : 'Онлайн', 'warning');
}

async function loadStats() {
    const o = document.getElementById('statsOutput');
    if (!o) return;
    
    try {
        const r = await fetch('/api/stats');
        const s = await r.json();
        const uptime = formatUptime(s.uptime || 0);
        o.innerHTML = `
            <div class="stats-scribble__item"><span class="stats-scribble__key">Режим</span><span class="stats-scribble__value">${s.environment || 'dev'}</span></div>
            <div class="stats-scribble__item"><span class="stats-scribble__key">Push-подписки</span><span class="stats-scribble__value">${s.totalSubscriptions || 0}</span></div>
            <div class="stats-scribble__item"><span class="stats-scribble__key">WebSocket</span><span class="stats-scribble__value">${s.websocketClients || 0}</span></div>
            <div class="stats-scribble__item"><span class="stats-scribble__key">Аптайм</span><span class="stats-scribble__value">${uptime}</span></div>
            <div class="stats-scribble__item"><span class="stats-scribble__key">Память</span><span class="stats-scribble__value">${s.memory?.heapUsed || '—'}</span></div>
        `;
    } catch (e) { 
        o.innerHTML = '<span class="stats-scribble__placeholder">ошибка загрузки</span>'; 
    }
}

function formatUptime(sec) {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = Math.floor(sec % 60);
    return `${h}ч ${m}м ${s}с`;
}

// ===== ВСПОМОГАТЕЛЬНЫЕ =====
function urlB64ToUint8(b) { 
    try {
        const p='='.repeat((4-b.length%4)%4); 
        const base64=(b+p).replace(/\-/g,'+').replace(/_/g,'/'); 
        const r=window.atob(base64); 
        const a=new Uint8Array(r.length); 
        for(let i=0;i<r.length;i++)a[i]=r.charCodeAt(i); 
        return a; 
    } catch (e) { return new Uint8Array(0); }
}

function showToast(m, t='success') {
    const old = document.querySelector('.sticker');
    if (old) old.remove();
    const toast = document.createElement('div');
    toast.className = 'sticker' + (t==='error'?' sticker--error':'');
    toast.innerHTML = `<span>${t==='error'?'✕':'✓'}</span><span>${m}</span>`;
    document.body.appendChild(toast);
    setTimeout(() => { toast.style.opacity='0'; setTimeout(() => toast.remove(), 200); }, 2500);
}

function setupEventListeners() {
    document.getElementById('addNoteBtn')?.addEventListener('click', addNote);
    document.getElementById('subscribeBtn')?.addEventListener('click', subscribeToPush);
    document.getElementById('unsubscribeBtn')?.addEventListener('click', unsubscribeFromPush);
    document.getElementById('sendTestPushBtn')?.addEventListener('click', sendTestNotification);
    document.getElementById('wsConnectBtn')?.addEventListener('click', connectWebSocket);
    document.getElementById('wsDisconnectBtn')?.addEventListener('click', disconnectWebSocket);
    document.getElementById('wsSendBtn')?.addEventListener('click', sendWSMessage);
    document.getElementById('fetchDataBtn')?.addEventListener('click', fetchData);
    document.getElementById('clearCacheBtn')?.addEventListener('click', clearCache);
    document.getElementById('testOfflineBtn')?.addEventListener('click', simulateOffline);
    document.getElementById('refreshStatsBtn')?.addEventListener('click', loadStats);
    document.getElementById('refreshBtn')?.addEventListener('click', () => { fetchData(); loadStats(); });
    document.getElementById('closeDrawerBtn')?.addEventListener('click', () => {
        const d = document.getElementById('dataOutput');
        if (d) d.style.display = 'none';
    });
    
    window.addEventListener('beforeinstallprompt', (e) => { 
        e.preventDefault(); 
        deferredPrompt = e; 
        const b = document.getElementById('installBtn');
        if (b) b.style.display = 'inline'; 
    });
    document.getElementById('installBtn')?.addEventListener('click', async () => { 
        if (deferredPrompt) { 
            deferredPrompt.prompt(); 
            await deferredPrompt.userChoice; 
            deferredPrompt = null; 
        } 
    });
    
    updateCacheInfo();
}