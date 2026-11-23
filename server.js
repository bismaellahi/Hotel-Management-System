const express = require('express');
const { DatabaseSync } = require('node:sqlite');
const crypto = require('crypto');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const db = new DatabaseSync(process.env.VERCEL ? '/tmp/hotel.db' : path.join(__dirname, 'hotel.db'));
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS rooms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_number TEXT NOT NULL UNIQUE,
    type TEXT NOT NULL,
    price REAL NOT NULL,
    capacity INTEGER NOT NULL DEFAULT 2
  );
  CREATE TABLE IF NOT EXISTS bookings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id INTEGER NOT NULL,
    guest_name TEXT NOT NULL,
    phone TEXT NOT NULL,
    check_in TEXT NOT NULL,
    check_out TEXT NOT NULL,
    services TEXT NOT NULL DEFAULT '',
    services_total REAL NOT NULL DEFAULT 0,
    total REAL NOT NULL,
    status TEXT NOT NULL DEFAULT 'confirmed',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id INTEGER NOT NULL,
    booking_id INTEGER NOT NULL UNIQUE,
    guest_name TEXT NOT NULL,
    rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
    comment TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
    FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE
  );
`);

try { db.exec("ALTER TABLE bookings ADD COLUMN services TEXT NOT NULL DEFAULT ''"); } catch (e) {}
try { db.exec("ALTER TABLE bookings ADD COLUMN services_total REAL NOT NULL DEFAULT 0"); } catch (e) {}
try { db.exec("ALTER TABLE bookings ADD COLUMN stage TEXT NOT NULL DEFAULT 'booked'"); } catch (e) {}

if (db.prepare('SELECT COUNT(*) AS c FROM rooms').get().c === 0) {
  const ins = db.prepare('INSERT INTO rooms (room_number, type, price, capacity) VALUES (?,?,?,?)');
  [
    ['101', 'Single', 5000, 1],
    ['102', 'Single', 5000, 1],
    ['201', 'Double', 8000, 2],
    ['202', 'Double', 8500, 2],
    ['301', 'Deluxe', 12000, 3],
    ['401', 'Suite', 20000, 4]
  ].forEach(r => ins.run(...r));
}

const SERVICES = [
  { id: 'breakfast', name: 'Breakfast', price: 800 },
  { id: 'laundry', name: 'Laundry', price: 500 },
  { id: 'pickup', name: 'Airport Pickup', price: 2500 },
  { id: 'extrabed', name: 'Extra Bed', price: 1500 }
];

const ADMIN = { username: 'bisma', password: 'admin123' };
const SECRET = process.env.TOKEN_SECRET || 'hotel-demo-secret-change-me';
const sign = exp => crypto.createHmac('sha256', SECRET).update(String(exp)).digest('hex');
function makeToken() {
  const exp = Date.now() + 12 * 3600 * 1000;
  return exp + '.' + sign(exp);
}
function validToken(t) {
  if (typeof t !== 'string') return false;
  const [exp, sig] = t.split('.');
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  const good = sign(exp);
  return sig.length === good.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good));
}

function adminOnly(req, res, next) {
  if (validToken(req.headers['x-token'])) return next();
  res.status(401).json({ error: 'Admin login required' });
}

app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body;
  if (username === ADMIN.username && password === ADMIN.password) {
    return res.json({ token: makeToken() });
  }
  res.status(401).json({ error: 'Wrong username or password' });
});

app.get('/api/services', (req, res) => res.json(SERVICES));

const ROOM_SELECT = `
  SELECT r.*,
    (SELECT ROUND(AVG(rating), 1) FROM reviews WHERE room_id = r.id) AS avg_rating,
    (SELECT COUNT(*) FROM reviews WHERE room_id = r.id) AS review_count
  FROM rooms r`;

app.get('/api/rooms', (req, res) => {
  const { checkin, checkout } = req.query;
  let rows;
  if (checkin && checkout) {
    rows = db.prepare(`${ROOM_SELECT}
      WHERE r.id NOT IN (
        SELECT room_id FROM bookings
        WHERE status = 'confirmed' AND check_in < ? AND check_out > ?)
      ORDER BY r.room_number`).all(checkout, checkin);
  } else {
    rows = db.prepare(`${ROOM_SELECT} ORDER BY r.room_number`).all();
  }
  res.json(rows);
});

app.post('/api/rooms', adminOnly, (req, res) => {
  const { room_number, type, price, capacity } = req.body;
  if (!room_number || !type || !price || !capacity)
    return res.status(400).json({ error: 'All fields required' });
  try {
    db.prepare('INSERT INTO rooms (room_number, type, price, capacity) VALUES (?,?,?,?)')
      .run(room_number, type, price, capacity);
    res.json({ message: 'Room added' });
  } catch (e) {
    if (String(e.message).includes('UNIQUE'))
      return res.status(400).json({ error: 'Room number already exists' });
    throw e;
  }
});

app.delete('/api/rooms/:id', adminOnly, (req, res) => {
  db.prepare('DELETE FROM rooms WHERE id = ?').run(req.params.id);
  res.json({ message: 'Room deleted' });
});

function fmt(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function pricing(room, checkIn, checkOut) {
  const start = new Date(checkIn + 'T00:00:00'), end = new Date(checkOut + 'T00:00:00');
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const ahead = Math.round((start - today) / 86400000);
  const rows = []; let total = 0;
  for (let d = new Date(start); d < end; d.setDate(d.getDate() + 1)) {
    let m = 1; const why = [];
    const dow = d.getDay(), mo = d.getMonth();
    if (dow === 5 || dow === 6) { m += 0.2; why.push('Weekend +20%'); }
    if (mo === 11 || mo === 0 || mo === 5) { m += 0.25; why.push('Peak season +25%'); }
    if (ahead >= 30) { m -= 0.1; why.push('Early bird -10%'); }
    else if (ahead <= 2) { m += 0.15; why.push('Last minute +15%'); }
    const price = Math.round(room.price * m);
    total += price;
    rows.push({ date: fmt(d), price, note: why.join(', ') || 'Standard rate' });
  }
  return { rows, total };
}

app.get('/api/quote', (req, res) => {
  const { room_id, checkin, checkout } = req.query;
  const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(room_id);
  if (!room || !checkin || !checkout || !(new Date(checkout) > new Date(checkin)))
    return res.status(400).json({ error: 'Valid room and dates required' });
  res.json(pricing(room, checkin, checkout));
});

app.post('/api/bookings', (req, res) => {
  const { room_id, guest_name, phone, check_in, check_out, services } = req.body;
  if (!room_id || !guest_name || !phone || !check_in || !check_out)
    return res.status(400).json({ error: 'All fields required' });

  const nights = Math.round((new Date(check_out) - new Date(check_in)) / 86400000);
  if (isNaN(nights) || nights < 1)
    return res.status(400).json({ error: 'Check-out must be after check-in' });

  const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(room_id);
  if (!room) return res.status(404).json({ error: 'Room not found' });

  const clash = db.prepare(`
    SELECT id FROM bookings WHERE room_id = ? AND status = 'confirmed'
    AND check_in < ? AND check_out > ?`).get(room_id, check_out, check_in);
  if (clash)
    return res.status(409).json({ error: 'Room already booked for these dates' });

  const chosen = SERVICES.filter(s => Array.isArray(services) && services.includes(s.id));
  const servicesTotal = chosen.reduce((sum, s) => sum + s.price, 0);
  const total = pricing(room, check_in, check_out).total + servicesTotal;

  const result = db.prepare(`
    INSERT INTO bookings (room_id, guest_name, phone, check_in, check_out, services, services_total, total)
    VALUES (?,?,?,?,?,?,?,?)`).run(
      room_id, String(guest_name).trim(), String(phone).trim(), check_in, check_out,
      chosen.map(s => s.name).join(', '), servicesTotal, total);

  res.json({
    message: 'Booking confirmed',
    booking_id: Number(result.lastInsertRowid),
    nights, services_total: servicesTotal, total
  });
});

app.get('/api/bookings', adminOnly, (req, res) => {
  const rows = db.prepare(`
    SELECT b.*, r.room_number, r.type
    FROM bookings b JOIN rooms r ON r.id = b.room_id
    ORDER BY b.id DESC`).all();
  res.json(rows);
});

app.put('/api/bookings/:id/cancel', adminOnly, (req, res) => {
  db.prepare("UPDATE bookings SET status = 'cancelled' WHERE id = ?").run(req.params.id);
  res.json({ message: 'Booking cancelled' });
});

app.get('/api/bookings/:id', adminOnly, (req, res) => {
  const row = db.prepare(`
    SELECT b.*, r.room_number, r.type
    FROM bookings b JOIN rooms r ON r.id = b.room_id
    WHERE b.id = ?`).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Booking not found' });
  res.json(row);
});

app.put('/api/bookings/:id/stage', adminOnly, (req, res) => {
  const b = db.prepare('SELECT * FROM bookings WHERE id = ?').get(req.params.id);
  if (!b) return res.status(404).json({ error: 'Booking not found' });
  const next = { booked: 'checked_in', checked_in: 'checked_out' }[b.stage];
  if (b.status !== 'confirmed' || !next)
    return res.status(400).json({ error: 'This booking cannot move to the next stage' });
  db.prepare('UPDATE bookings SET stage = ? WHERE id = ?').run(next, b.id);
  res.json({ message: 'Guest is now ' + next.replace('_', ' '), stage: next });
});

app.get('/api/reviews', (req, res) => {
  const base = `
    SELECT rv.id, rv.guest_name, rv.rating, rv.comment, rv.created_at, r.room_number
    FROM reviews rv JOIN rooms r ON r.id = rv.room_id`;
  const rows = req.query.room_id
    ? db.prepare(`${base} WHERE rv.room_id = ? ORDER BY rv.id DESC`).all(req.query.room_id)
    : db.prepare(`${base} ORDER BY rv.id DESC`).all();
  res.json(rows);
});

app.post('/api/reviews', (req, res) => {
  const { room_id, booking_id, phone, rating, comment } = req.body;
  const stars = Number(rating);
  if (!room_id || !booking_id || !phone || !comment || !String(comment).trim())
    return res.status(400).json({ error: 'All fields required' });
  if (!Number.isInteger(stars) || stars < 1 || stars > 5)
    return res.status(400).json({ error: 'Rating must be between 1 and 5' });

  const booking = db.prepare(`
    SELECT * FROM bookings
    WHERE id = ? AND room_id = ? AND phone = ? AND status = 'confirmed'`)
    .get(booking_id, room_id, String(phone).trim());
  if (!booking)
    return res.status(400).json({ error: 'Booking ID and phone number do not match a confirmed booking for this room' });

  const already = db.prepare('SELECT id FROM reviews WHERE booking_id = ?').get(booking_id);
  if (already)
    return res.status(409).json({ error: 'A review has already been submitted for this booking' });

  db.prepare(`INSERT INTO reviews (room_id, booking_id, guest_name, rating, comment)
              VALUES (?,?,?,?,?)`)
    .run(room_id, booking_id, booking.guest_name, stars, String(comment).trim().slice(0, 500));
  res.json({ message: 'Review submitted. Thank you!' });
});

app.delete('/api/reviews/:id', adminOnly, (req, res) => {
  db.prepare('DELETE FROM reviews WHERE id = ?').run(req.params.id);
  res.json({ message: 'Review deleted' });
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Server error' });
});

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log('Hotel app running: http://localhost:' + PORT));
}
module.exports = app;