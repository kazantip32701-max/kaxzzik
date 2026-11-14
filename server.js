require('dotenv').config();
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const fs = require('fs');

const app = express();
app.use(cors({ origin: '*', methods: ['GET','POST','OPTIONS'], allowedHeaders: ['Content-Type'] }));
app.use(express.json());

const DB_FILE = './db.json';

function loadDB() {
  if (!fs.existsSync(DB_FILE)) return { users: {}, bets: [] };
  return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}
function saveDB(db) { fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2)); }

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_IDS = (process.env.ADMIN_IDS || '').split(',').map(Number).filter(Boolean);

// Упрощённая проверка — для теста
function validateInitData(initData) {
  if (!initData) return null;
  try {
    const params = new URLSearchParams(initData);
    const userStr = params.get('user');
    if (!userStr) return null;
    const user = JSON.parse(userStr);
    if (!user.id) return null;
    return user;
  } catch (e) {
    console.log('Parse error:', e.message);
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
      balance: 1.00, // стартовый баланс для теста
      created_at: Date.now(),
      last_bonus: 0,
      bonus_streak: 0
    };
  } else {
    db.users[tgUser.id].username = tgUser.username || '';
    db.users[tgUser.id].first_name = tgUser.first_name || '';
    db.users[tgUser.id].photo_url = tgUser.photo_url || '';
  }
  saveDB(db);
  return db.users[tgUser.id];
}

function getBonusAmount(streak) {
  return Math.min(0.05 + (streak - 1) * 0.05, 0.25);
}

app.get('/', (req, res) => res.send('Balls Casino Backend is running'));

app.post('/api/me', (req, res) => {
  const user = validateInitData(req.body.initData);
  if (!user) return res.status(401).json({ error: 'Unauthorized', debug: !!req.body.initData });
  const dbUser = getOrCreateUser(user);
  const now = Date.now();
  const oneDay = 24 * 60 * 60 * 1000;
  const canClaim = now - dbUser.last_bonus >= oneDay;
  const nextBonus = getBonusAmount((dbUser.bonus_streak || 0) + 1);

  res.json({
    id: dbUser.id,
    username: dbUser.username,
    first_name: dbUser.first_name,
    photo_url: dbUser.photo_url,
    balance: dbUser.balance,
    canClaimBonus: canClaim,
    nextBonusAmount: nextBonus,
    streak: dbUser.bonus_streak || 0
  });
});

app.post('/api/claim-bonus', (req, res) => {
  const user = validateInitData(req.body.initData);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  const db = loadDB();
  const dbUser = db.users[user.id];
  if (!dbUser) return res.status(404).json({ error: 'User not found' });

  const now = Date.now();
  const oneDay = 24 * 60 * 60 * 1000;
  if (now - dbUser.last_bonus < oneDay) return res.status(400).json({ error: 'Already claimed today' });

  const streak = (dbUser.bonus_streak || 0) + 1;
  const amount = getBonusAmount(streak);
  dbUser.balance += amount;
  dbUser.last_bonus = now;
  dbUser.bonus_streak = streak;
  saveDB(db);
  res.json({ success: true, amount, balance: dbUser.balance, streak });
});

app.post('/api/bet', (req, res) => {
  const user = validateInitData(req.body.initData);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  const amount = parseFloat(req.body.amount);
  if (!amount || amount < 0.1) return res.status(400).json({ error: 'Min bet 0.10' });

  const db = loadDB();
  const dbUser = db.users[user.id];
  if (!dbUser || dbUser.balance < amount) return res.status(400).json({ error: 'Insufficient balance' });

  dbUser.balance -= amount;
  db.bets.push({ user_id: user.id, amount, created_at: Date.now() });
  saveDB(db);
  res.json({ success: true, balance: dbUser.balance });
});

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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Backend running on port ${PORT}`);
  console.log('Admin IDs:', ADMIN_IDS);
});
