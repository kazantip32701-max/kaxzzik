require('dotenv').config();
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(express.json());

const DB_FILE = './db.json';

function loadDB() {
  if (!fs.existsSync(DB_FILE)) {
    return { users: {}, bets: [] };
  }
  return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}

function saveDB(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_IDS = (process.env.ADMIN_IDS || '').split(',').map(Number).filter(Boolean);

function validateInitData(initData) {
  if (!initData || !BOT_TOKEN) return null;
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    params.delete('hash');
    params.delete('signature');
    const dataCheckString = Array.from(params.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join('\n');
    const secret = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
    const calculated = crypto.createHmac('sha256', secret).update(dataCheckString).digest('hex');
    if (calculated !== hash) return null;
    const user = JSON.parse(params.get('user') || '{}');
    return user;
  } catch (e) {
    return null;
  }
}

function getOrCreateUser(tgUser) {
  const db = loadDB();
  if (!db.users[tgUser.id]) {
    db.users[tgUser.id] = {
      id: tgUser.id,
      username: tgUser.username || '',
      first_name: tgUser.first_name || '',
      photo_url: tgUser.photo_url || '',
      balance: 0,
      created_at: Date.now()
    };
  } else {
    db.users[tgUser.id].username = tgUser.username || '';
    db.users[tgUser.id].first_name = tgUser.first_name || '';
    db.users[tgUser.id].photo_url = tgUser.photo_url || '';
  }
  saveDB(db);
  return db.users[tgUser.id];
}

// ===== API =====

app.post('/api/me', (req, res) => {
  const user = validateInitData(req.body.initData);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  const dbUser = getOrCreateUser(user);
  res.json({
    id: dbUser.id,
    username: dbUser.username,
    first_name: dbUser.first_name,
    photo_url: dbUser.photo_url,
    balance: dbUser.balance
  });
});

app.post('/api/bet', (req, res) => {
  const user = validateInitData(req.body.initData);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  const amount = parseFloat(req.body.amount);
  if (!amount || amount < 0.1) return res.status(400).json({ error: 'Min bet 0.10' });

  const db = loadDB();
  const dbUser = db.users[user.id] || getOrCreateUser(user);
  if (dbUser.balance < amount) return res.status(400).json({ error: 'Insufficient balance' });

  dbUser.balance -= amount;
  db.bets.push({
    user_id: user.id,
    amount,
    round_id: req.body.roundId || 'demo',
    created_at: Date.now()
  });
  saveDB(db);

  res.json({ success: true, balance: dbUser.balance });
});

// ===== ADMIN =====
function isAdmin(req) {
  const user = validateInitData(req.body.initData || req.query.initData);
  return user && ADMIN_IDS.includes(Number(user.id));
}

app.post('/api/admin/add-balance', (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Forbidden' });
  const { userId, amount } = req.body;
  const db = loadDB();
  if (!db.users[userId]) return res.status(404).json({ error: 'User not found' });
  db.users[userId].balance += parseFloat(amount);
  saveDB(db);
  res.json({ success: true, balance: db.users[userId].balance });
});

app.get('/api/admin/users', (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Forbidden' });
  const db = loadDB();
  const users = Object.values(db.users).sort((a, b) => b.balance - a.balance);
  res.json(users);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Backend running on http://localhost:${PORT}`);
  console.log('Admin IDs:', ADMIN_IDS);
});
