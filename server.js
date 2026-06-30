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

// ===== YARDIMCI FONKSİYONLAR =====
function getIP(req) {
    return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
           req.connection.remoteAddress ||
           req.socket.remoteAddress ||
           'unknown';
}

const TRIAL_MS = 8 * 60 * 60 * 1000; // 8 saat
const MAX_TRIAL_PER_IP = 1;

function getActiveTrialByEmail(email) {
    return trials[email] || null;
}

function getTrialsByIP(ip) {
    return Object.values(trials).filter(t => t.ip === ip);
}

function hasActiveTrialOnIP(ip) {
    const ipTrials = getTrialsByIP(ip);
    return ipTrials.some(t => {
        const elapsed = Date.now() - t.start;
        return elapsed < TRIAL_MS;
    });
}

// ===== API: TELEFON KONTROL =====
app.post('/api/check-phone', (req, res) => {
    const { phone } = req.body;
    if (!phone) return res.json({ available: false, message: 'Telefon numarası gerekli.' });

    const exists = users.find(u => u.phone === phone);
    if (exists) {
        return res.json({ available: false, message: 'Bu telefon numarası zaten kayıtlı!' });
    }
    res.json({ available: true });
});

// ===== API: KAYIT =====
app.post('/api/register', (req, res) => {
    const { phone, email, name } = req.body;
    const ip = getIP(req);

    // E-posta kontrolü
    if (users.find(u => u.email === email)) {
        return res.json({ success: false, message: 'Bu e-posta zaten kayıtlı!' });
    }

    // Telefon kontrolü
    if (users.find(u => u.phone === phone)) {
        return res.json({ success: false, message: 'Bu telefon numarası zaten kayıtlı!' });
    }

    // IP bazlı deneme hakkı kontrolü
    if (hasActiveTrialOnIP(ip)) {
        const existing = getTrialsByIP(ip).find(t => (Date.now() - t.start) < TRIAL_MS);
        const existingUser = users.find(u => u.email === existing?.email);
        if (existingUser) {
            return res.json({
                success: false,
                message: 'Bu cihazdan zaten bir deneme hesabı oluşturulmuş. Lütfen giriş yapın veya abone olun.'
            });
        }
    }

    // IP'de süresi dolmuş deneme varsa yeni deneme verilmez
    const ipTrials = getTrialsByIP(ip);
    if (ipTrials.length >= MAX_TRIAL_PER_IP) {
        const anyActive = ipTrials.some(t => (Date.now() - t.start) < TRIAL_MS);
        if (!anyActive) {
            return res.json({
                success: false,
                message: 'Bu cihazdan deneme hakkı daha önce kullanılmış. Abone olmak için ödeme yapın.'
            });
        }
    }

    // Kullanıcı oluştur
    const user = {
        name, email, phone, ip,
        sub: false, subEnd: null,
        createdAt: Date.now()
    };
    users.push(user);

    // Deneme hakkı oluştur
    trials[email] = {
        ip, email,
        start: Date.now(),
        createdAt: Date.now()
    };

    saveData();
    console.log(`Yeni kayıt: ${email} | IP: ${ip}`);
    res.json({ success: true });
});

// ===== API: DENEME KONTROLÜ =====
app.post('/api/check-trial', (req, res) => {
    const { email } = req.body;
    const ip = getIP(req);

    if (!email) return res.json({ allowed: false });

    // Abonelik kontrolü
    const user = users.find(u => u.email === email);
    if (user && user.sub && user.subEnd && user.subEnd > Date.now()) {
        return res.json({ allowed: true, start: trials[email]?.start || Date.now(), subscribed: true });
    }

    // Deneme hakkı kontrolü
    const trial = trials[email];
    if (!trial) {
        // Yeni deneme - IP kontrolü
        if (hasActiveTrialOnIP(ip)) {
            return res.json({ allowed: false, message: 'Bu cihazdan zaten deneme kullanılmış.' });
        }
        if (getTrialsByIP(ip).length >= MAX_TRIAL_PER_IP) {
            return res.json({ allowed: false, message: 'Deneme süreniz dolmuştur.' });
        }

        trials[email] = { ip, email, start: Date.now(), createdAt: Date.now() };
        saveData();
        return res.json({ allowed: true, start: Date.now() });
    }

    // Süre kontrolü
    const elapsed = Date.now() - trial.start;
    if (elapsed >= TRIAL_MS) {
        return res.json({ allowed: false, message: 'Deneme süreniz dolmuştur.' });
    }

    res.json({ allowed: true, start: trial.start });
});

// ===== API: DURUM SORGULAMA =====
app.get('/api/trial-status', (req, res) => {
    const ip = getIP(req);
    const ipTrials = getTrialsByIP(ip);

    if (ipTrials.length === 0) return res.json({ exists: false });

    const latest = ipTrials[ipTrials.length - 1];
    const user = users.find(u => u.email === latest.email);
    const subscribed = user && user.sub && user.subEnd > Date.now();
    const expired = !subscribed && (Date.now() - latest.start >= TRIAL_MS);

    res.json({ exists: true, expired, start: latest.start, subscribed });
});

// ===== SSE: GERÇEK ZAMANLI SİNYAL =====
let sseClients = [];

app.get('/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');

    const initMsg = JSON.stringify({ type: 'init', signals: signals.slice(0, 20) });
    res.write(`data: ${initMsg}\n\n`);

    sseClients.push(res);
    console.log(`SSE bağlandı. Aktif: ${sseClients.length}`);

    req.on('close', () => {
        sseClients = sseClients.filter(c => c !== res);
        console.log(`SSE ayrıldı. Aktif: ${sseClients.length}`);
    });
});

// ===== WEBHOOK: TRADINGVIEW =====
app.post('/webhook', (req, res) => {
    const { symbol, action } = req.body;

    if (!symbol || !action) {
        return res.status(400).json({ error: 'symbol ve action gerekli' });
    }

    const validActions = ['buy', 'sell', 'long', 'short'];
    if (!validActions.includes(action.toLowerCase())) {
        return res.status(400).json({ error: 'Geçersiz action. buy/sell/long/short olmalı.' });
    }

    const signal = {
        symbol: symbol.toUpperCase(),
        action: action.toLowerCase(),
        time: new Date().toISOString()
    };

    signals.unshift(signal);
    if (signals.length > 100) signals = signals.slice(0, 100);
    saveData();

    // Tüm bağlı istemcilere gönder
    const msg = JSON.stringify({ type: 'new_signal', signal });
    sseClients.forEach(client => {
        try { client.write(`data: ${msg}\n\n`); } catch (e) {}
    });

    console.log(`Sinyal alındı: ${signal.symbol} ${signal.action}`);
    res.json({ success: true, signal });
});

// ===== ANA SAYFA =====
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ===== SUNUCUYU BAŞLAT =====
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🐋 Balina Alarm sunucusu çalışıyor: port ${PORT}`);
    console.log(`📡 Webhook: http://localhost:${PORT}/webhook`);
    console.log(`📊 Dashboard: http://localhost:${PORT}`);
});
