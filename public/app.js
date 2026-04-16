// ---------- State ----------
let currentUser = null;
let weekStart = mondayOf(new Date()); // Monday 00:00 local
let bookings = [];
let autosaveTimer = null;

const DAY_NAMES = ['Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi','Dimanche'];
const HOUR_START = 7;  // 07:00
const HOUR_END = 21;   // 21:00
const SLOT_MINUTES = 30;

// ---------- Helpers ----------
function mondayOf(d) {
  const x = new Date(d);
  x.setHours(0,0,0,0);
  const dow = (x.getDay() + 6) % 7; // 0=Mon
  x.setDate(x.getDate() - dow);
  return x;
}
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate()+n); return x; }
function sameDay(a,b){ return a.getFullYear()===b.getFullYear() && a.getMonth()===b.getMonth() && a.getDate()===b.getDate(); }
function fmtDate(d) { return d.toLocaleDateString('fr-BE', { day:'2-digit', month:'short' }); }
function toLocalInput(d) {
  const pad = n => String(n).padStart(2,'0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fromLocalInput(s) { return new Date(s); }
function fmtTime(d) { return d.toLocaleTimeString('fr-BE', { hour:'2-digit', minute:'2-digit' }); }

async function api(path, options = {}) {
  const opts = { ...options, headers: { 'Content-Type':'application/json', ...(options.headers||{}) } };
  if (opts.body && typeof opts.body !== 'string') opts.body = JSON.stringify(opts.body);
  const res = await fetch(path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`);
  return data;
}

// ---------- Auth ----------
const authView = document.getElementById('auth-view');
const appView = document.getElementById('app-view');

document.getElementById('tab-login').onclick = () => switchTab('login');
document.getElementById('tab-register').onclick = () => switchTab('register');

function switchTab(which) {
  document.getElementById('tab-login').classList.toggle('active', which==='login');
  document.getElementById('tab-register').classList.toggle('active', which==='register');
  document.getElementById('login-form').classList.toggle('hidden', which!=='login');
  document.getElementById('register-form').classList.toggle('hidden', which!=='register');
  document.getElementById('auth-msg').textContent = '';
}

document.getElementById('login-form').addEventListener('submit', async e => {
  e.preventDefault();
  const fd = new FormData(e.target);
  try {
    const data = await api('/api/login', { method:'POST', body: { username: fd.get('username'), password: fd.get('password') } });
    currentUser = { username: data.username };
    await loadMe();
    showApp();
  } catch (err) { showAuthMsg(err.message, 'error'); }
});

document.getElementById('register-form').addEventListener('submit', async e => {
  e.preventDefault();
  const fd = new FormData(e.target);
  try {
    const data = await api('/api/register', { method:'POST', body: {
      username: fd.get('username'), email: fd.get('email'), password: fd.get('password')
    }});
    currentUser = { username: data.username };
    await loadMe();
    showApp();
  } catch (err) { showAuthMsg(err.message, 'error'); }
});

function showAuthMsg(m, cls='') {
  const el = document.getElementById('auth-msg');
  el.textContent = m; el.className = 'msg ' + cls;
}

document.getElementById('logout-btn').onclick = async () => {
  await api('/api/logout', { method:'POST' });
  currentUser = null;
  appView.classList.add('hidden');
  authView.classList.remove('hidden');
};

async function loadMe() {
  const { user } = await api('/api/me');
  currentUser = user;
  if (user) {
    document.getElementById('user-label').textContent = user.username;
  }
}

function showApp() {
  authView.classList.add('hidden');
  appView.classList.remove('hidden');
  renderWeek();
  loadBookings();
  startAutosavePoll();
}

// ---------- Calendar rendering ----------
const calEl = document.getElementById('calendar');

document.getElementById('prev-week').onclick = () => { weekStart = addDays(weekStart, -7); renderWeek(); loadBookings(); };
document.getElementById('next-week').onclick = () => { weekStart = addDays(weekStart, 7); renderWeek(); loadBookings(); };
document.getElementById('this-week').onclick = () => { weekStart = mondayOf(new Date()); renderWeek(); loadBookings(); };
document.getElementById('refresh-btn').onclick = () => loadBookings(true);

function renderWeek() {
  const today = new Date();
  const days = Array.from({length:7}, (_,i) => addDays(weekStart, i));
  const weekEnd = addDays(weekStart, 6);
  document.getElementById('week-label').textContent =
    `Semaine du ${fmtDate(weekStart)} au ${fmtDate(weekEnd)} ${weekStart.getFullYear()}`;

  calEl.innerHTML = '';

  // Header row
  const corner = document.createElement('div');
  corner.className = 'cal-corner';
  calEl.appendChild(corner);
  days.forEach(d => {
    const h = document.createElement('div');
    h.className = 'cal-header' + (sameDay(d, today) ? ' today' : '');
    h.innerHTML = `${DAY_NAMES[(d.getDay()+6)%7]}<br><span class="muted">${fmtDate(d)}</span>`;
    calEl.appendChild(h);
  });

  // Hour rows
  const totalSlots = (HOUR_END - HOUR_START) * (60 / SLOT_MINUTES);
  for (let i = 0; i < totalSlots; i++) {
    const minutes = i * SLOT_MINUTES;
    const hh = HOUR_START + Math.floor(minutes / 60);
    const mm = minutes % 60;
    const label = document.createElement('div');
    label.className = 'cal-hour-label';
    label.textContent = mm === 0 ? `${String(hh).padStart(2,'0')}:00` : '';
    calEl.appendChild(label);

    days.forEach((day, dayIdx) => {
      const cell = document.createElement('div');
      cell.className = 'cal-cell';
      const slotDate = new Date(day);
      slotDate.setHours(hh, mm, 0, 0);
      cell.dataset.start = slotDate.toISOString();
      cell.onclick = (ev) => {
        if (ev.target.classList.contains('booking') || ev.target.closest('.booking')) return;
        openCreateModal(slotDate);
      };
      calEl.appendChild(cell);
    });
  }

  renderBookings();
}

function renderBookings() {
  // Remove existing booking elements
  calEl.querySelectorAll('.booking').forEach(b => b.remove());

  const weekEnd = addDays(weekStart, 7);
  const visible = bookings.filter(b => {
    const s = new Date(b.start_iso), e = new Date(b.end_iso);
    return e > weekStart && s < weekEnd;
  });

  const pxPerSlot = 40; // matches CSS height
  const slotsPerDay = (HOUR_END - HOUR_START) * (60 / SLOT_MINUTES);

  visible.forEach(b => {
    const s = new Date(b.start_iso), e = new Date(b.end_iso);
    // Clip to day
    const dayIdx = Math.floor((new Date(s.getFullYear(), s.getMonth(), s.getDate()) - weekStart) / 86400000);
    if (dayIdx < 0 || dayIdx > 6) return;

    const startMin = Math.max(0, (s.getHours() - HOUR_START) * 60 + s.getMinutes());
    const endMin = Math.min(slotsPerDay * SLOT_MINUTES, (e.getHours() - HOUR_START) * 60 + e.getMinutes() + (sameDay(s,e) ? 0 : slotsPerDay*SLOT_MINUTES));
    const top = (startMin / SLOT_MINUTES) * pxPerSlot;
    const height = Math.max(pxPerSlot * 0.6, ((endMin - startMin) / SLOT_MINUTES) * pxPerSlot - 2);

    // Find the first cell of this day-hour to anchor the booking via its column
    const firstSlotIndex = dayIdx; // column index among day columns
    // Build overlay: we need day column container. Simpler: append to calendar with absolute positioning via left %
    const bookingEl = document.createElement('div');
    bookingEl.className = 'booking' + (currentUser && b.owner_username === currentUser.username ? ' mine' : '');
    bookingEl.style.position = 'absolute';
    bookingEl.innerHTML = `<div class="b-title">${escapeHtml(b.title)}</div><div class="b-meta">${fmtTime(s)}–${fmtTime(e)} · ${escapeHtml(b.owner_username)}</div>`;
    bookingEl.onclick = (ev) => { ev.stopPropagation(); openEditModal(b); };

    // Place using grid cell: find one cell for this day at the start slot
    const startSlotIdx = Math.floor(startMin / SLOT_MINUTES);
    const cells = calEl.querySelectorAll('.cal-cell');
    const cellIndex = startSlotIdx * 7 + dayIdx;
    const anchor = cells[cellIndex];
    if (!anchor) return;
    anchor.style.position = 'relative';
    bookingEl.style.top = '0px';
    bookingEl.style.height = height + 'px';
    bookingEl.style.left = '2px';
    bookingEl.style.right = '2px';
    anchor.appendChild(bookingEl);
  });
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

async function loadBookings(showToast = false) {
  const from = weekStart.toISOString();
  const to = addDays(weekStart, 7).toISOString();
  try {
    const data = await api(`/api/bookings?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
    bookings = data.bookings;
    renderBookings();
    if (showToast) flashAutosave('Données rechargées');
  } catch (e) {
    if (e.message.includes('Non authentifié')) {
      appView.classList.add('hidden');
      authView.classList.remove('hidden');
    }
  }
}

// Auto-refresh every 30s to pick up others' bookings
function startAutosavePoll() {
  if (autosaveTimer) clearInterval(autosaveTimer);
  autosaveTimer = setInterval(() => loadBookings(false), 30000);
}

// ---------- Booking modal ----------
const modal = document.getElementById('modal');
const bookingForm = document.getElementById('booking-form');

function openCreateModal(startDate) {
  bookingForm.reset();
  bookingForm.id.value = '';
  const end = new Date(startDate); end.setHours(end.getHours()+1);
  bookingForm.start.value = toLocalInput(startDate);
  bookingForm.end.value = toLocalInput(end);
  bookingForm.sendInvite.checked = true;
  document.getElementById('invite-row').classList.remove('hidden');
  document.getElementById('modal-title').textContent = 'Nouvelle réservation';
  document.getElementById('delete-btn').classList.add('hidden');
  document.getElementById('booking-msg').textContent = '';
  modal.classList.remove('hidden');
}

function openEditModal(b) {
  bookingForm.reset();
  bookingForm.id.value = b.id;
  bookingForm.title.value = b.title;
  bookingForm.description.value = b.description || '';
  bookingForm.start.value = toLocalInput(new Date(b.start_iso));
  bookingForm.end.value = toLocalInput(new Date(b.end_iso));
  try { bookingForm.guests.value = (JSON.parse(b.guests || '[]')).join(', '); } catch { bookingForm.guests.value = ''; }
  bookingForm.sendInvite.checked = false;
  document.getElementById('invite-row').classList.add('hidden');
  document.getElementById('modal-title').textContent = 'Modifier la réservation';
  const isOwner = currentUser && b.owner_username === currentUser.username;
  document.getElementById('delete-btn').classList.toggle('hidden', !isOwner);
  document.getElementById('save-btn').disabled = !isOwner;
  if (isOwner) {
    document.getElementById('booking-msg').textContent = 'Attention : la modification ne renvoie pas d\u2019invitation aux participants.';
    document.getElementById('booking-msg').className = 'msg warning';
  } else {
    document.getElementById('booking-msg').textContent = 'Lecture seule : cette réservation appartient à ' + b.owner_username;
    document.getElementById('booking-msg').className = 'msg muted';
  }
  modal.classList.remove('hidden');
}

function closeModal() { modal.classList.add('hidden'); document.getElementById('save-btn').disabled = false; }
document.getElementById('modal-close').onclick = closeModal;
document.getElementById('cancel-btn').onclick = closeModal;
modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });

bookingForm.addEventListener('submit', async e => {
  e.preventDefault();
  const fd = new FormData(bookingForm);
  const id = fd.get('id');
  const guests = String(fd.get('guests') || '').split(',').map(x => x.trim()).filter(Boolean);
  const payload = {
    title: fd.get('title'),
    description: fd.get('description'),
    start_iso: fromLocalInput(fd.get('start')).toISOString(),
    end_iso: fromLocalInput(fd.get('end')).toISOString(),
    guests,
    sendInvite: fd.get('sendInvite') === 'on'
  };
  try {
    const url = id ? `/api/bookings/${id}` : '/api/bookings';
    const method = id ? 'PUT' : 'POST';
    const data = await api(url, { method, body: payload });
    flashAutosave(id ? 'Réservation modifiée' : 'Réservation enregistrée');
    if (payload.sendInvite && guests.length > 0) {
      if (data.email && data.email.sent) flashAutosave('Invitation envoyée ✓');
      else if (data.email && data.email.error) showBookingMsg('Enregistré, mais email non envoyé : ' + data.email.error, 'error');
    }
    closeModal();
    await loadBookings();
  } catch (err) { showBookingMsg(err.message, 'error'); }
});

document.getElementById('delete-btn').onclick = async () => {
  const id = bookingForm.id.value;
  if (!id) return;
  if (!confirm('Supprimer cette réservation ?')) return;
  try {
    await api(`/api/bookings/${id}`, { method:'DELETE' });
    flashAutosave('Réservation supprimée');
    closeModal();
    await loadBookings();
  } catch (err) { showBookingMsg(err.message, 'error'); }
};

function showBookingMsg(m, cls='') {
  const el = document.getElementById('booking-msg');
  el.textContent = m; el.className = 'msg ' + cls;
}

// Autosave of draft form (localStorage) while typing
['title','description','start','end','guests'].forEach(name => {
  bookingForm[name].addEventListener('input', () => {
    const draft = {
      title: bookingForm.title.value,
      description: bookingForm.description.value,
      start: bookingForm.start.value,
      end: bookingForm.end.value,
      guests: bookingForm.guests.value
    };
    localStorage.setItem('salle-vennes-draft', JSON.stringify(draft));
    flashAutosave('Brouillon sauvegardé', 800);
  });
});

function flashAutosave(msg = 'Sauvegardé', ms = 1500) {
  const b = document.getElementById('autosave-badge');
  b.textContent = msg;
  b.classList.add('show');
  clearTimeout(b._t);
  b._t = setTimeout(() => b.classList.remove('show'), ms);
}

// ---------- Boot ----------
(async function init() {
  try {
    await loadMe();
    if (currentUser) showApp();
    else { authView.classList.remove('hidden'); }
  } catch {
    authView.classList.remove('hidden');
  }
})();
