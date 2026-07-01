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
let reviews = [];
let chats = [];
let reviewCount = 1247;
let campaignCount = 0;

function loadData() {
    try {
        if (fs.existsSync(DATA_FILE)) {
            const d = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
            users = d.users || [];
            trials = d.trials || {};
            signals = d.signals || [];
            reviews = d.reviews || [];
            chats = d.chats || [];
            reviewCount = d.reviewCount || 1247;
            campaignCount = d.campaignCount || 0;
        }
    } catch (e) { console.log('Veri yükleme hatası:', e.message); }
}

function saveData() {
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify({ users, trials, signals, reviews, chats, reviewCount, campaignCount }, null, 2));
    } catch (e) { console.log('Veri kaydetme hatası:', e.message); }
}

loadData();

// ===== VARSAYILAN YORUMLAR =====
if (reviews.length === 0) {
    reviews = [
        { id: 'default_1', name: 'Burak Y.', stars: 4, text: 'Platform genel olarak başarılı ve bildirimler zamanında geliyor. Bazen sinyaller benim işlem planıma uymayabiliyor ama zaten her sinyal her stratejiye uygun olmayabilir. Kendi analizinizle birlikte kullanmanız daha doğru olur.', time: new Date(Date.now() - 86400000 * 2).toISOString(), isAdmin: true },
        { id: 'default_2', name: 'Mehmet K.', stars: 5, text: 'Yaklaşık 2 haftadır kullanıyorum. Bildirimler gerçekten hızlı geliyor ve işlem açmadan önce bana ekstra güven veriyor. Özellikle XAUUSD sinyallerinde faydasını gördüm.', time: new Date(Date.now() - 86400000 * 3).toISOString(), isAdmin: true },
        { id: 'default_3', name: 'Ayşe D.', stars: 5, text: 'Arayüzü çok sade ve kullanımı kolay. Telefonuma bildirim gelir gelmez haberdar oluyorum. Tek başına değil ama kendi analizimle birlikte kullandığımda güzel sonuçlar alıyorum.', time: new Date(Date.now() - 86400000 * 4).toISOString(), isAdmin: true },
        { id: 'default_4', name: 'Emre T.', stars: 5, text: 'Birçok sinyal platformunu denedim. Balina Alarmın en beğendiğim yanı gereksiz bildirim göndermemesi. Gelen alarmları stratejimle doğrulayarak kullanıyorum.', time: new Date(Date.now() - 86400000 * 5).toISOString(), isAdmin: true },
        { id: 'default_5', name: 'Can A.', stars: 5, text: '8 saatlik ücretsiz deneme sayesinde rahatça test ettim. Beklediğimden daha profesyonel çıktı. Aboneliğe geçtim ve şu ana kadar memnunum.', time: new Date(Date.now() - 86400000 * 6).toISOString(), isAdmin: true }
    ];
    saveData();
}

// ===== ADMIN AYARLARI =====
const ADMIN_EMAIL = 'orkun159064@outlook.com';
const TRIAL_MS = 8 * 60 * 60 * 1000;
const MAX_TRIAL_PER_IP = 1;
const CAMPAIGN_MAX = 100;
const CAMPAIGN_TRIAL_MS = 12 * 60 * 60 * 1000;

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
    if (email !== ADMIN_EMAIL) return res.json({ success: false, message: 'Yetkisiz.' });

    let admin = users.find(u => u.email === ADMIN_EMAIL);
    if (!admin) {
        admin = { name: 'Admin', email: ADMIN_EMAIL, phone: '0000000000', ip: 'admin', pass: '', sub: true, subEnd: Date.now() + (365 * 24 * 60 * 60 * 1000), createdAt: Date.now() };
        users.push(admin);
    }
    admin.sub = true;
    admin.subEnd = Date.now() + (365 * 24 * 60 * 60 * 1000);
    saveData();
    console.log('Admin giriş:', email);
    res.json({ success: true, user: { name: admin.name, email: admin.email, sub: true, subEnd: admin.subEnd } });
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

    if (users.find(u => u.email === email)) return res.json({ success: false, message: 'Bu e-posta zaten kayıtlı!' });
    if (users.find(u => u.phone === phone)) return res.json({ success: false, message: 'Bu telefon numarası zaten kayıtlı!' });

    if (hasActiveTrialOnIP(ip)) {
        const existing = getTrialsByIP(ip).find(t => (Date.now() - t.start) < TRIAL_MS);
        if (existing) return res.json({ success: false, message: 'Bu cihazdan zaten bir deneme hesabı oluşturulmuş.' });
    }

    const ipTrials = getTrialsByIP(ip);
    if (ipTrials.length >= MAX_TRIAL_PER_IP) {
        const anyActive = ipTrials.some(t => (Date.now() - t.start) < TRIAL_MS);
        if (!anyActive) return res.json({ success: false, message: 'Bu cihazdan deneme hakkı daha önce kullanılmış.' });
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

    if (isAdminActive(email)) return res.json({ allowed: true, start: Date.now(), subscribed: true });

    const user = users.find(u => u.email === email);
    if (user && user.sub && user.subEnd && user.subEnd > Date.now())
        return res.json({ allowed: true, start: trials[email]?.start || Date.now(), subscribed: true });

    const trial = trials[email];
    if (!trial) {
        if (hasActiveTrialOnIP(ip)) return res.json({ allowed: false, message: 'Bu cihazdan zaten deneme kullanılmış.' });
        if (getTrialsByIP(ip).length >= MAX_TRIAL_PER_IP) return res.json({ allowed: false, message: 'Deneme süreniz dolmuştur.' });
        trials[email] = { ip, email, start: Date.now(), createdAt: Date.now() };
        saveData();
        return res.json({ allowed: true, start: Date.now() });
    }

    const elapsed = Date.now() - trial.start;
    if (elapsed >= TRIAL_MS) return res.json({ allowed: false, message: 'Deneme süreniz dolmuştur.' });

    res.json({ allowed: true, start: trial.start });
});

// ===== API: DURUM SORGULAMA =====
app.get('/api/trial-status', (req, res) => {
    const ip = getIP(req);
    const ipTrials = getTrialsByIP(ip);

    const adminUser = users.find(u => u.email === ADMIN_EMAIL);
    if (adminUser && adminUser.sub) return res.json({ exists: true, expired: false, start: Date.now(), subscribed: true, isAdmin: true });

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
    if (!email || !phone || !newPass) return res.json({ success: false, message: 'Tüm alanları doldurun.' });
    if (newPass.length < 6) return res.json({ success: false, message: 'Şifre en az 6 karakter olmalı.' });

    const user = users.find(u => u.email === email && u.phone === phone);
    if (!user) return res.json({ success: false, message: 'E-posta veya telefon numarası hatalı!' });

    user.pass = newPass;
    saveData();
    console.log('Şifre sıfırlandı:', email);
    res.json({ success: true, message: 'Şifreniz başarıyla sıfırlandı!' });
});

// ===== API: 99 TL KAMPANYA KONTROLÜ =====
app.post('/api/check-special-offer', (req, res) => {
    const { email } = req.body;
    if (!email) return res.json({ eligible: false });

    const user = users.find(u => u.email === email);
    if (!user) return res.json({ eligible: false });

    const trial = trials[email];
    if (!trial) return res.json({ eligible: false });

    const trialEnd = trial.start + TRIAL_MS;
    const specialEnd = trialEnd + CAMPAIGN_TRIAL_MS;
    const now = Date.now();

    if (now >= trialEnd && now < specialEnd) {
        const remaining = specialEnd - now;
        const h = Math.floor(remaining / 3600000);
        const m = Math.floor((remaining % 3600000) / 60000);
        return res.json({ eligible: true, price: 99, remaining: remaining, timeLeft: h + ' saat ' + m + ' dakika', spotsLeft: CAMPAIGN_MAX - campaignCount });
    }

    return res.json({ eligible: false, price: 999 });
});

// ===== API: ABONELİK =====
app.post('/api/subscribe', (req, res) => {
    const { email, plan, months } = req.body;
    const user = users.find(u => u.email === email);
    if (!user) return res.json({ success: false, message: 'Kullanıcı bulunamadı.' });

    const duration = (months || 1) * 30 * 24 * 60 * 60 * 1000;
    user.sub = true;
    user.subEnd = Date.now() + duration;
    user.plan = plan || 'normal';

    if (plan === 'special') {
        campaignCount++;
    }

    saveData();
    console.log('Abonelik:', email, '| Plan:', plan, '| Ay:', months);
    res.json({ success: true, subEnd: user.subEnd });
});

// ===== API: KAMPANYA DURUMU =====
app.get('/api/campaign-status', (req, res) => {
    res.json({ total: CAMPAIGN_MAX, used: campaignCount, left: CAMPAIGN_MAX - campaignCount });
});

// ===== API: YORUMLAR =====
app.get('/api/reviews', (req, res) => {
    res.json({ reviews: reviews.slice(0, 5), total: reviewCount });
});

app.post('/api/reviews', (req, res) => {
    const { name, text, stars } = req.body;
    if (!name || !text || !stars) return res.json({ success: false, message: 'Tüm alanları doldurun.' });
    if (stars < 1 || stars > 5) return res.json({ success: false, message: 'Yıldız 1-5 arasında olmalı.' });

    const review = { id: 'r_' + Date.now(), name: name.trim(), text: text.trim(), stars: parseInt(stars), time: new Date().toISOString(), isAdmin: false };

    reviews.unshift(review);
    if (reviews.length > 5) reviews = reviews.slice(0, 5);
    reviewCount++;
    saveData();

    console.log('Yeni yorum:', name, '| Yıldız:', stars);
    res.json({ success: true, review: review, total: reviewCount });
});

app.delete('/api/reviews/:id', (req, res) => {
    const { id } = req.params;
    const index = reviews.findIndex(r => r.id === id);
    if (index === -1) return res.json({ success: false, message: 'Yorum bulunamadı.' });

    reviews.splice(index, 1);
    if (reviewCount > 0) reviewCount--;
    saveData();

    console.log('Yorum silindi:', id);
    res.json({ success: true });
});

// ===== API: DESTEK CHAT =====
app.get('/api/chat/:email', (req, res) => {
    const { email } = req.params;
    const userChats = chats.filter(c => c.email === email).slice(-50);
    res.json({ messages: userChats });
});

app.get('/api/chat/admin/all', (req, res) => {
    const grouped = {};
    chats.forEach(c => {
        if (!grouped[c.email]) grouped[c.email] = [];
        grouped[c.email].push(c);
    });

    const conversations = Object.keys(grouped).map(email => {
        const msgs = grouped[email];
        const lastMsg = msgs[msgs.length - 1];
        const unread = msgs.filter(m => m.from !== 'admin' && !m.read).length;
        return { email: email, name: msgs[0]?.name || email, lastMessage: lastMsg.text, lastTime: lastMsg.time, unread: unread, messages: msgs.slice(-20) };
    });

    res.json({ conversations: conversations });
});

app.post('/api/chat', (req, res) => {
    const { email, name, text } = req.body;
    if (!email || !text) return res.json({ success: false, message: 'Mesaj boş olamaz.' });

    const msg = { id: 'msg_' + Date.now(), email: email, name: name || email, text: text.trim(), from: 'user', time: new Date().toISOString(), read: false };
    chats.push(msg);
    saveData();

    console.log('Yeni mesaj:', email, ':', text.substring(0, 50));
    res.json({ success: true, message: msg });
});

app.post('/api/chat/reply', (req, res) => {
    const { email, text } = req.body;
    if (!email || !text) return res.json({ success: false, message: 'Mesaj boş olamaz.' });

    const msg = { id: 'msg_' + Date.now(), email: email, name: 'Admin', text: text.trim(), from: 'admin', time: new Date().toISOString(), read: true };
    chats.push(msg);
    saveData();

    // Okundu olarak işaretle
    chats.forEach(c => { if (c.email === email && c.from !== 'admin') c.read = true; });
    saveData();

    console.log('Admin cevap:', email, ':', text.substring(0, 50));
    res.json({ success: true, message: msg });
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
    if (!validActions.includes(action.toLowerCase())) return res.status(400).json({ error: 'Geçersiz action.' });

    const signal = { symbol: symbol.toUpperCase(), action: action.toLowerCase(), time: new Date().toISOString() };
    signals.unshift(signal);
    if (signals.length > 100) signals = signals.slice(0, 100);
    saveData();

    const msg = JSON.stringify({ type: 'new_signal', signal });
    sseClients.forEach(client => { try { client.write(`data: ${msg}\n\n`); } catch (e) {} });

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
