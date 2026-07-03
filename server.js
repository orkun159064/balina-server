const express = require('express');
const path = require('path');
const fs = require('fs');
const app = express();

app.use(express.json());
app.use(express.static('public'));

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

const ADMIN_EMAIL = 'orkun159064@outlook.com';
const TRIAL_MS = 8 * 60 * 60 * 1000;
const MAX_TRIAL_PER_IP = 1;
const CAMPAIGN_MAX = 100;
const CAMPAIGN_TRIAL_MS = 12 * 60 * 60 * 1000;

function getIP(req) {
    return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.connection.remoteAddress || req.socket.remoteAddress || 'unknown';
}
function getTrialsByIP(ip) { return Object.values(trials).filter(t => t.ip === ip); }
function hasActiveTrialOnIP(ip) { return getTrialsByIP(ip).some(t => (Date.now() - t.start) < TRIAL_MS); }

// ===== ADMIN GİRİŞ =====
app.post('/api/admin-login', (req, res) => {
    const { email } = req.body;
    if (email !== ADMIN_EMAIL) return res.json({ success: false });
    let admin = users.find(u => u.email === ADMIN_EMAIL);
    if (!admin) {
        admin = { name: 'Admin', email: ADMIN_EMAIL, phone: '0000000000', ip: 'admin', pass: '', sub: true, subEnd: Date.now() + (365 * 24 * 60 * 60 * 1000), createdAt: Date.now() };
        users.push(admin);
    }
    admin.sub = true;
    admin.subEnd = Date.now() + (365 * 24 * 60 * 60 * 1000);
    saveData();
    res.json({ success: true, user: { name: admin.name, email: admin.email, sub: true, subEnd: admin.subEnd } });
});

// ===== TELEFON KONTROL =====
app.post('/api/check-phone', (req, res) => {
    const { phone } = req.body;
    if (!phone) return res.json({ available: false, message: 'Telefon numarası gerekli.' });
    if (users.find(u => u.phone === phone)) return res.json({ available: false, message: 'Bu telefon numarası zaten kayıtlı!' });
    res.json({ available: true });
});

// ===== KAYIT =====
app.post('/api/register', (req, res) => {
    const { phone, email, name, pass } = req.body;
    const ip = getIP(req);
    if (users.find(u => u.email === email)) return res.json({ success: false, message: 'Bu e-posta zaten kayıtlı!' });
    if (users.find(u => u.phone === phone)) return res.json({ success: false, message: 'Bu telefon numarası zaten kayıtlı!' });
    if (hasActiveTrialOnIP(ip)) return res.json({ success: false, message: 'Bu cihazdan zaten bir deneme hesabı oluşturulmuş.' });
    const ipTrials = getTrialsByIP(ip);
    if (ipTrials.length >= MAX_TRIAL_PER_IP && !ipTrials.some(t => (Date.now() - t.start) < TRIAL_MS))
        return res.json({ success: false, message: 'Bu cihazdan deneme hakkı daha önce kullanılmış.' });
    const user = { name, email, phone, ip, pass: pass || '', sub: false, subEnd: null, createdAt: Date.now() };
    users.push(user);
    trials[email] = { ip, email, start: Date.now(), createdAt: Date.now() };
    saveData();
    console.log('Yeni kayıt:', email);
    res.json({ success: true, trialStart: trials[email].start });
});

// ===== DENEME KONTROLÜ =====
app.post('/api/check-trial', (req, res) => {
    const { email } = req.body;
    const ip = getIP(req);
    if (!email) return res.json({ allowed: false });

    if (email === ADMIN_EMAIL) {
        return res.json({ allowed: true, start: Date.now(), subscribed: true, subEnd: Date.now() + (365 * 24 * 60 * 60 * 1000) });
    }

    const user = users.find(u => u.email === email);
    if (user && user.sub && user.subEnd && user.subEnd > Date.now()) {
        return res.json({ allowed: true, start: trials[email] ? trials[email].start : Date.now(), subscribed: true, subEnd: user.subEnd });
    }

    const trial = trials[email];
    if (trial) {
        if ((Date.now() - trial.start) >= TRIAL_MS) return res.json({ allowed: false, message: 'Deneme süreniz dolmuştur.' });
        return res.json({ allowed: true, start: trial.start });
    }

    if (hasActiveTrialOnIP(ip)) return res.json({ allowed: false, message: 'Bu cihazdan zaten deneme kullanılmış.' });
    if (getTrialsByIP(ip).length >= MAX_TRIAL_PER_IP) return res.json({ allowed: false, message: 'Deneme süreniz dolmuştur.' });

    trials[email] = { ip, email, start: Date.now(), createdAt: Date.now() };
    saveData();
    return res.json({ allowed: true, start: trials[email].start });
});

// ===== DURUM SORGULAMA =====
app.get('/api/trial-status', (req, res) => {
    const email = req.query.email || '';
    const ip = getIP(req);

    if (email === ADMIN_EMAIL) {
        return res.json({ exists: true, expired: false, start: Date.now(), subscribed: true, isAdmin: true, subEnd: Date.now() + (365 * 24 * 60 * 60 * 1000) });
    }

    const trial = trials[email];
    if (trial) {
        const user = users.find(u => u.email === email);
        const subscribed = user && user.sub && user.subEnd > Date.now();
        const expired = !subscribed && (Date.now() - trial.start >= TRIAL_MS);
        return res.json({ exists: true, expired, start: trial.start, subscribed, isAdmin: false, subEnd: user ? user.subEnd : null });
    }

    const ipTrials = getTrialsByIP(ip);
    if (ipTrials.length === 0) return res.json({ exists: false });

    const latest = ipTrials[ipTrials.length - 1];
    const user = users.find(u => u.email === latest.email);
    const subscribed = user && user.sub && user.subEnd > Date.now();
    const expired = !subscribed && (Date.now() - latest.start >= TRIAL_MS);

    res.json({ exists: true, expired, start: latest.start, subscribed, isAdmin: false, subEnd: user ? user.subEnd : null });
});

// ===== ŞİFRE SIFIRLAMA =====
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

// ===== 99 TL KAMPANYA =====
app.post('/api/check-special-offer', (req, res) => {
    const { email } = req.body;
    if (!email) return res.json({ eligible: false });
    const trial = trials[email];
    if (!trial) return res.json({ eligible: false });
    const trialEnd = trial.start + TRIAL_MS;
    const specialEnd = trialEnd + CAMPAIGN_TRIAL_MS;
    const now = Date.now();
    if (now >= trialEnd && now < specialEnd) {
        const remaining = specialEnd - now;
        const h = Math.floor(remaining / 3600000);
        const m = Math.floor((remaining % 3600000) / 60000);
        return res.json({ eligible: true, price: 99, remaining, timeLeft: h + ' saat ' + m + ' dakika', spotsLeft: CAMPAIGN_MAX - campaignCount });
    }
    return res.json({ eligible: false, price: 999 });
});

// ===== ABONELİK =====
app.post('/api/subscribe', (req, res) => {
    const { email, plan, months } = req.body;
    const user = users.find(u => u.email === email);
    if (!user) return res.json({ success: false });
    user.sub = true;
    user.subEnd = Date.now() + ((months || 1) * 30 * 24 * 60 * 60 * 1000);
    user.plan = plan || 'normal';
    if (plan === 'special') campaignCount++;
    saveData();
    console.log('Abonelik:', email, plan, months + ' ay');
    res.json({ success: true, subEnd: user.subEnd });
});

// ===== KAMPANYA DURUMU =====
app.get('/api/campaign-status', (req, res) => {
    res.json({ total: CAMPAIGN_MAX, used: campaignCount, left: CAMPAIGN_MAX - campaignCount });
});

// ===== YORUMLAR =====
app.get('/api/reviews', (req, res) => { res.json({ reviews: reviews.slice(0, 5), total: reviewCount }); });
app.post('/api/reviews', (req, res) => {
    const { name, text, stars } = req.body;
    if (!name || !text || !stars) return res.json({ success: false, message: 'Tüm alanları doldurun.' });
    const review = { id: 'r_' + Date.now(), name: name.trim(), text: text.trim(), stars: parseInt(stars), time: new Date().toISOString(), isAdmin: false };
    reviews.unshift(review);
    if (reviews.length > 5) reviews = reviews.slice(0, 5);
    reviewCount++;
    saveData();
    res.json({ success: true, review, total: reviewCount });
});
app.delete('/api/reviews/:id', (req, res) => {
    const index = reviews.findIndex(r => r.id === req.params.id);
    if (index === -1) return res.json({ success: false });
    reviews.splice(index, 1);
    if (reviewCount > 0) reviewCount--;
    saveData();
    res.json({ success: true });
});

// ===== CHAT =====
app.get('/api/chat/:email', (req, res) => { res.json({ messages: chats.filter(c => c.email === req.params.email).slice(-50) }); });
app.get('/api/chat/admin/all', (req, res) => {
    const grouped = {};
    chats.forEach(c => { if (!grouped[c.email]) grouped[c.email] = []; grouped[c.email].push(c); });
    const conversations = Object.keys(grouped).map(email => {
        const msgs = grouped[email];
        const lastMsg = msgs[msgs.length - 1];
        return { email, name: msgs[0]?.name || email, lastMessage: lastMsg.text, lastTime: lastMsg.time, unread: msgs.filter(m => m.from !== 'admin' && !m.read).length };
    });
    res.json({ conversations });
});
app.post('/api/chat', (req, res) => {
    const { email, name, text } = req.body;
    if (!email || !text) return res.json({ success: false });
    const msg = { id: 'msg_' + Date.now(), email, name: name || email, text: text.trim(), from: 'user', time: new Date().toISOString(), read: false };
    chats.push(msg);
    saveData();
    res.json({ success: true, message: msg });
});
app.post('/api/chat/reply', (req, res) => {
    const { email, text } = req.body;
    if (!email || !text) return res.json({ success: false });
    const msg = { id: 'msg_' + Date.now(), email, name: 'Admin', text: text.trim(), from: 'admin', time: new Date().toISOString(), read: true };
    chats.push(msg);
    chats.forEach(c => { if (c.email === email && c.from !== 'admin') c.read = true; });
    saveData();
    res.json({ success: true, message: msg });
});

// ===== SSE =====
let sseClients = [];
app.get('/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.write('data: ' + JSON.stringify({ type: 'init', signals: signals.slice(0, 20) }) + '\n\n');
    sseClients.push(res);
    req.on('close', () => { sseClients = sseClients.filter(c => c !== res); });
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
    sseClients.forEach(client => { try { client.write('data: ' + msg + '\n\n'); } catch (e) {} });
    console.log('Sinyal:', signal.symbol, signal.action);
    res.json({ success: true, signal });
});

app.get('/', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'index.html')); });

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log('🐋 Balina Alarm: port ' + PORT);
    console.log('📡 Webhook: http://localhost:' + PORT + '/webhook');
});
