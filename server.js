const express = require('express');
const path = require('path');
const fs = require('fs');
const app = express();

app.use(express.json());
app.use(express.static('public'));

// ===== VERİ DOSYASI =====
const DATA_FILE = './data.json';
let users = [];
let trials = {};
let signals = [];

function loadData() {
    try {
        if (fs.existsSync(DATA_FILE)) {
            const d = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
            users = d.users || [];
            trials = d.trials || {};
            signals = d.signals || [];
        }
    } catch (e) { console.log('Veri yükleme hatası:', e.message); }
}

function saveData() {
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify({ users, trials, signals }, null, 2));
    } catch (e) { console.log('Veri kaydetme hatası:', e.message); }
}

loadData();

// ===== ADMIN AYARLARI =====
const ADMIN_EMAIL = 'orkun159064@outlook.com';
const TRIAL_MS = 8 * 60 * 60 * 1000;
const MAX_TRIAL_PER_IP = 1;

function getIP(req) {
    return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
           req.connection.remoteAddress ||
           req.socket.remoteAddress ||
           'unknown';
}

function getTrialsByIP(ip) {
    return Object.values(trials).filter(t => t.ip === ip);
}

function hasActiveTrialOnIP(ip) {
    return getTrialsByIP(ip).some(t => (Date.now() - t.start) < TRIAL_MS);
}

function isAdminActive(email) {
    return email === ADMIN_EMAIL;
}

// ===== API: ADMIN GİRİŞ =====
app.post('/api/admin-login', (req, res) => {
    const { email } = req.body;
    if (email !== ADMIN_EMAIL) {
        return res.json({ success: false, message: 'Yetkisiz.' });
    }

    let admin = users.find(u => u.email === ADMIN_EMAIL);
    if (!admin) {
        admin = {
            name: 'Admin',
            email: ADMIN_EMAIL,
            phone: '0000000000',
            ip: 'admin',
            pass: '',
            sub: true,
            subEnd: Date.now() + (365 * 24 * 60 * 60 * 1000),
            createdAt: Date.now()
        };
        users.push(admin);
    }

    admin.sub = true;
    admin.subEnd = Date.now() + (365 * 24 * 60 * 60 * 1000);
    saveData();

    console.log('Admin giriş:', email);
    res.json({
        success: true,
        user: {
            name: admin.name,
            email: admin.email,
            sub: true,
            subEnd: admin.subEnd
        }
    });
});

// ===== API: TELEFON KONTROL =====
app.post('/api/check-phone', (req, res) => {
    const { phone } = req.body;
    if (!phone) return res.json({ available: false, message: 'Telefon numarası gerekli.' });
    const exists = users.find(u => u.phone === phone);
    if (exists) return res.json({ available: false, message: 'Bu telefon numarası zaten kayıtlı!' });
    res.json({ available: true });
});

// ===== API: KAYIT =====
app.post('/api/register', (req, res) => {
    const { phone, email, name, pass } = req.body;
    const ip = getIP(req);

    if (users.find(u => u.email === email))
        return res.json({ success: false, message: 'Bu e-posta zaten kayıtlı!' });
    if (users.find(u => u.phone === phone))
        return res.json({ success: false, message: 'Bu telefon numarası zaten kayıtlı!' });

    if (hasActiveTrialOnIP(ip)) {
        const existing = getTrialsByIP(ip).find(t => (Date.now() - t.start) < TRIAL_MS);
        if (existing)
            return res.json({ success: false, message: 'Bu cihazdan zaten bir deneme hesabı oluşturulmuş.' });
    }

    const ipTrials = getTrialsByIP(ip);
    if (ipTrials.length >= MAX_TRIAL_PER_IP) {
        const anyActive = ipTrials.some(t => (Date.now() - t.start) < TRIAL_MS);
        if (!anyActive)
            return res.json({ success: false, message: 'Bu cihazdan deneme hakkı daha önce kullanılmış.' });
    }

    const user = { name, email, phone, ip, pass: pass || '', sub: false, subEnd: null, createdAt: Date.now() };
    users.push(user);
    trials[email] = { ip, email, start: Date.now(), createdAt: Date.now() };
    saveData();
    console.log('Yeni kayıt:', email, '| IP:', ip);
    res.json({ success: true });
});

// ===== API: DENEME KONTROLÜ =====
app.post('/api/check-trial', (req, res) => {
    const { email } = req.body;
    const ip = getIP(req);
    if (!email) return res.json({ allowed: false });

    if (isAdminActive(email)) {
        return res.json({ allowed: true, start: Date.now(), subscribed: true });
    }

    const user = users.find(u => u.email === email);
    if (user && user.sub && user.subEnd && user.subEnd > Date.now())
        return res.json({ allowed: true, start: trials[email]?.start || Date.now(), subscribed: true });

    const trial = trials[email];
    if (!trial) {
        if (hasActiveTrialOnIP(ip))
            return res.json({ allowed: false, message: 'Bu cihazdan zaten deneme kullanılmış.' });
        if (getTrialsByIP(ip).length >= MAX_TRIAL_PER_IP)
            return res.json({ allowed: false, message: 'Deneme süreniz dolmuştur.' });

        trials[email] = { ip, email, start: Date.now(), createdAt: Date.now() };
        saveData();
        return res.json({ allowed: true, start: Date.now() });
    }

    const elapsed = Date.now() - trial.start;
    if (elapsed >= TRIAL_MS)
        return res.json({ allowed: false, message: 'Deneme süreniz dolmuştur.' });

    res.json({ allowed: true, start: trial.start });
});

// ===== API: DURUM SORGULAMA =====
app.get('/api/trial-status', (req, res) => {
    const ip = getIP(req);
    const ipTrials = getTrialsByIP(ip);

    const adminUser = users.find(u => u.email === ADMIN_EMAIL);
    if (adminUser && adminUser.sub) {
        return res.json({ exists: true, expired: false, start: Date.now(), subscribed: true, isAdmin: true });
    }

    if (ipTrials.length === 0) return res.json({ exists: false });

    const latest = ipTrials[ipTrials.length - 1];
    const user = users.find(u => u.email === latest.email);
    const subscribed = user && user.sub && user.subEnd > Date.now();
    const expired = !subscribed && (Date.now() - latest.start >= TRIAL_MS);

    res.json({ exists: true, expired, start: latest.start, subscribed });
});

// ===== API: ŞİFRE SIFIRLAMA =====
app.post('/api/reset-password', (req, res) => {
    const { email, phone, newPass } = req.body;

    if (!email || !phone || !newPass) {
        return res.json({ success: false, message: 'Tüm alanları doldurun.' });
    }

    if (newPass.length < 6) {
        return res.json({ success: false, message: 'Şifre en az 6 karakter olmalı.' });
    }

    const user = users.find(u => u.email === email && u.phone === phone);
    if (!user) {
        return res.json({ success: false, message: 'E-posta veya telefon numarası hatalı!' });
    }

    user.pass = newPass;
    saveData();

    console.log('Şifre sıfırlandı:', email);
    res.json({ success: true, message: 'Şifreniz başarıyla sıfırlandı!' });
});

// ===== SSE =====
let sseClients = [];

app.get('/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');

    const initMsg = JSON.stringify({ type: 'init', signals: signals.slice(0, 20) });
    res.write(`data: ${initMsg}\n\n`);

    sseClients.push(res);
    console.log('SSE bağlandı. Aktif:', sseClients.length);

    req.on('close', () => {
        sseClients = sseClients.filter(c => c !== res);
    });
});

// ===== WEBHOOK =====
app.post('/webhook', (req, res) => {
    const { symbol, action } = req.body;
    if (!symbol || !action) return res.status(400).json({ error: 'symbol ve action gerekli' });

    const validActions = ['buy', 'sell', 'long', 'short'];
    if (!validActions.includes(action.toLowerCase()))
        return res.status(400).json({ error: 'Geçersiz action.' });

    const signal = {
        symbol: symbol.toUpperCase(),
        action: action.toLowerCase(),
        time: new Date().toISOString()
    };

    signals.unshift(signal);
    if (signals.length > 100) signals = signals.slice(0, 100);
    saveData();

    const msg = JSON.stringify({ type: 'new_signal', signal });
    sseClients.forEach(client => {
        try { client.write(`data: ${msg}\n\n`); } catch (e) {}
    });

    console.log('Sinyal:', signal.symbol, signal.action);
    res.json({ success: true, signal });
});

// ===== ANA SAYFA =====
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ===== SUNUCU =====
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log('🐋 Balina Alarm: port ' + PORT);
    console.log('📡 Webhook: http://localhost:' + PORT + '/webhook');
    console.log('📊 Dashboard: http://localhost:' + PORT);
});
