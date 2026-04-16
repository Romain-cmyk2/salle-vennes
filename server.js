require('dotenv').config();
require('dotenv').config({ path: '.env.local', override: true });
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const path = require('path');
const brevo = require('@getbrevo/brevo');
const ics = require('ics');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const ROOM_NAME = process.env.ROOM_NAME || 'Salle IMMO C';
const ROOM_LOCATION = process.env.ROOM_LOCATION || 'Salle IMMO C - Rue des Vennes 294, 4020 Liège';

app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 1000 * 60 * 60 * 24 * 30
  }
}));

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Non authentifié' });
  next();
}

// --- Brevo API client (lazy) ---
let brevoClient = null;
function getBrevoClient() {
  if (brevoClient) return brevoClient;
  if (!process.env.BREVO_API_KEY) return null;
  brevoClient = new brevo.BrevoClient({ apiKey: process.env.BREVO_API_KEY });
  return brevoClient;
}
const MAIL_SENDER_EMAIL = process.env.MAIL_SENDER_EMAIL || 'romain@sconseil.be';
const MAIL_SENDER_NAME = process.env.MAIL_SENDER_NAME || ROOM_NAME;

// --- Auth routes ---
app.post('/api/register', (req, res) => {
  const { username, email, password } = req.body || {};
  if (!username || !email || !password) return res.status(400).json({ error: 'Champs requis manquants' });
  if (password.length < 6) return res.status(400).json({ error: 'Mot de passe trop court (min. 6 caractères)' });
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'Email invalide' });
  try {
    const hash = bcrypt.hashSync(password, 10);
    const info = db.prepare('INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)')
      .run(username.trim(), email.trim().toLowerCase(), hash);
    req.session.userId = info.lastInsertRowid;
    req.session.username = username.trim();
    req.session.email = email.trim().toLowerCase();
    res.json({ ok: true, username: req.session.username });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return res.status(409).json({ error: 'Nom d\'utilisateur ou email déjà utilisé' });
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Champs requis manquants' });
  const u = db.prepare('SELECT * FROM users WHERE username = ? OR email = ?').get(username.trim(), username.trim().toLowerCase());
  if (!u) return res.status(401).json({ error: 'Identifiants invalides' });
  if (!bcrypt.compareSync(password, u.password_hash)) return res.status(401).json({ error: 'Identifiants invalides' });
  req.session.userId = u.id;
  req.session.username = u.username;
  req.session.email = u.email;
  res.json({ ok: true, username: u.username });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/me', (req, res) => {
  if (!req.session.userId) return res.json({ user: null });
  res.json({ user: { id: req.session.userId, username: req.session.username, email: req.session.email } });
});

// --- Bookings ---
app.get('/api/bookings', requireAuth, (req, res) => {
  const { from, to } = req.query;
  let rows;
  if (from && to) {
    rows = db.prepare(`
      SELECT b.*, u.username AS owner_username
      FROM bookings b JOIN users u ON u.id = b.user_id
      WHERE b.end_iso > ? AND b.start_iso < ?
      ORDER BY b.start_iso ASC
    `).all(from, to);
  } else {
    rows = db.prepare(`
      SELECT b.*, u.username AS owner_username
      FROM bookings b JOIN users u ON u.id = b.user_id
      ORDER BY b.start_iso ASC
    `).all();
  }
  res.json({ bookings: rows });
});

function overlaps(startIso, endIso, excludeId = null) {
  const q = excludeId
    ? `SELECT b.id, b.title, b.start_iso, b.end_iso, u.username
       FROM bookings b JOIN users u ON u.id = b.user_id
       WHERE b.end_iso > ? AND b.start_iso < ? AND b.id != ?`
    : `SELECT b.id, b.title, b.start_iso, b.end_iso, u.username
       FROM bookings b JOIN users u ON u.id = b.user_id
       WHERE b.end_iso > ? AND b.start_iso < ?`;
  const args = excludeId ? [startIso, endIso, excludeId] : [startIso, endIso];
  return db.prepare(q).get(...args);
}

function formatConflict(c) {
  const s = new Date(c.start_iso), e = new Date(c.end_iso);
  const d = s.toLocaleString('fr-BE', { dateStyle: 'short', timeStyle: 'short' });
  const eh = e.toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' });
  return `« ${c.title} » par ${c.username} (${d} → ${eh})`;
}

app.post('/api/bookings', requireAuth, async (req, res) => {
  const { title, description, start_iso, end_iso, guests, sendInvite } = req.body || {};
  if (!title || !start_iso || !end_iso) return res.status(400).json({ error: 'Champs requis manquants' });
  const s = new Date(start_iso), e = new Date(end_iso);
  if (isNaN(s) || isNaN(e) || e <= s) return res.status(400).json({ error: 'Horaires invalides' });
  if ((e - s) > 8 * 3600_000) return res.status(400).json({ error: 'Durée maximale : 8 heures' });
  if (s < new Date(Date.now() - 60_000)) return res.status(400).json({ error: 'Impossible de réserver dans le passé' });
  { const c = overlaps(start_iso, end_iso); if (c) return res.status(409).json({ error: 'Ce créneau chevauche ' + formatConflict(c) }); }

  const guestList = Array.isArray(guests) ? guests.filter(Boolean).map(x => String(x).trim()).filter(Boolean) : [];
  const info = db.prepare(`
    INSERT INTO bookings (user_id, title, description, start_iso, end_iso, guests)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(req.session.userId, title.trim(), description || '', start_iso, end_iso, JSON.stringify(guestList));

  const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(info.lastInsertRowid);

  let emailResult = { sent: false };
  if (sendInvite && guestList.length > 0) {
    emailResult = await sendIcsInvite({
      booking,
      organizer: { name: req.session.username, email: req.session.email },
      guests: guestList
    });
  }

  res.json({ ok: true, booking, email: emailResult });
});

app.put('/api/bookings/:id', requireAuth, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const existing = db.prepare('SELECT * FROM bookings WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Réservation introuvable' });
  if (existing.user_id !== req.session.userId) return res.status(403).json({ error: 'Non autorisé' });

  const { title, description, start_iso, end_iso, guests, sendInvite } = req.body || {};
  if (!title || !start_iso || !end_iso) return res.status(400).json({ error: 'Champs requis manquants' });
  const s = new Date(start_iso), e = new Date(end_iso);
  if (isNaN(s) || isNaN(e) || e <= s) return res.status(400).json({ error: 'Horaires invalides' });
  if ((e - s) > 8 * 3600_000) return res.status(400).json({ error: 'Durée maximale : 8 heures' });
  { const c = overlaps(start_iso, end_iso, id); if (c) return res.status(409).json({ error: 'Ce créneau chevauche ' + formatConflict(c) }); }

  const guestList = Array.isArray(guests) ? guests.filter(Boolean).map(x => String(x).trim()).filter(Boolean) : [];
  db.prepare(`
    UPDATE bookings SET title=?, description=?, start_iso=?, end_iso=?, guests=?, updated_at=datetime('now')
    WHERE id = ?
  `).run(title.trim(), description || '', start_iso, end_iso, JSON.stringify(guestList), id);

  const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(id);

  res.json({ ok: true, booking, email: { sent: false } });
});

app.delete('/api/bookings/:id', requireAuth, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const existing = db.prepare('SELECT * FROM bookings WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Réservation introuvable' });
  if (existing.user_id !== req.session.userId) return res.status(403).json({ error: 'Non autorisé' });
  db.prepare('DELETE FROM bookings WHERE id = ?').run(id);
  res.json({ ok: true });
});

// --- ICS invite ---
function toIcsDate(iso) {
  const d = new Date(iso);
  return [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes()];
}

async function sendIcsInvite({ booking, organizer, guests }) {
  const client = getBrevoClient();
  if (!client) return { sent: false, error: 'Clé API Brevo non configurée (BREVO_API_KEY manquant dans .env.local)' };

  const { error, value } = ics.createEvent({
    start: toIcsDate(booking.start_iso),
    startInputType: 'utc',
    end: toIcsDate(booking.end_iso),
    endInputType: 'utc',
    title: `${booking.title} — ${ROOM_NAME}`,
    description: (booking.description || '') + `\n\nOrganisé par : ${organizer.name} <${organizer.email}>`,
    location: ROOM_LOCATION,
    organizer: { name: MAIL_SENDER_NAME, email: MAIL_SENDER_EMAIL },
    attendees: [
      { name: organizer.name, email: organizer.email, rsvp: true, partstat: 'ACCEPTED', role: 'CHAIR' },
      ...guests.map(g => ({ email: g, rsvp: true, partstat: 'NEEDS-ACTION', role: 'REQ-PARTICIPANT' }))
    ],
    status: 'CONFIRMED',
    method: 'REQUEST'
  });
  if (error) return { sent: false, error: String(error) };

  const allRecipients = [organizer.email, ...guests];

  try {
    await client.transactionalEmails.sendTransacEmail({
      sender: { name: `${organizer.name} (via ${MAIL_SENDER_NAME})`, email: MAIL_SENDER_EMAIL },
      replyTo: { name: organizer.name, email: organizer.email },
      to: allRecipients.map(email => ({ email })),
      subject: `Invitation : ${booking.title} (${ROOM_NAME})`,
      textContent: `Vous êtes invité à la réunion "${booking.title}" organisée par ${organizer.name} (${organizer.email}).\n\nLieu : ${ROOM_LOCATION}\nDu : ${booking.start_iso}\nAu : ${booking.end_iso}\n\n${booking.description || ''}`,
      attachment: [{
        name: 'invitation.ics',
        content: Buffer.from(value).toString('base64')
      }]
    });
    return { sent: true, to: allRecipients };
  } catch (e) {
    const msg = e.body?.message || e.message || String(e);
    return { sent: false, error: msg };
  }
}

// Fallback: serve index.html for root
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => {
  console.log(`Salle Vennes — serveur démarré sur http://localhost:${PORT}`);
});
