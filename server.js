const express = require('express');
const cors = require('cors');
const path = require('path');
const nodemailer = require('nodemailer');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ===== VERILER =====
let signals = [];
let clients = [];
let trialUsers = {};
let registeredPhones = {};
let otps = {}; // { email: { code, expires } }

// ===== TRİAL SÜRESİ (24 saat) =====
const TRIAL_DURATION = 24 * 60 * 60 * 1000;

// ===== IP ADRESİ AL =====
function getIP(req) {
    return req.headers['x-forwarded-for'] || req.connection.remoteAddress || 'unknown';
}

// ===== OUTLOOK SMTP AYARI =====
const transporter = nodemailer.createTransport({
    host: 'smtp.office365.com',
    port: 587,
    secure: false, // TLS
    auth: {
        user: 'orkun159064@outlook.com',
        pass: process.env.EMAIL_PASS // Render Dashboard'da gizli tutulacak şifre
    },
    tls: {
        ciphers: 'SSLv3'
    }
});

// ===== E-POSTA DOĞRULAMA KODU (OTP) GÖNDER =====
app.post('/api/send-otp', function(req, res) {
    var email = req.body.email;
    if (!email) return res.json({ success: false, message: 'E-posta adresi gereklidir!' });

    // 6 Haneli Rastgele Kod
    var otpCode = Math.floor(100000 + Math.random() * 900000).toString();
    otps[email] = {
        code: otpCode,
        expires: Date.now() + 5 * 60 * 1000 // 5 dakika geçerli
    };

    var mailOptions = {
        from: 'orkun159064@outlook.com',
        to: email,
        subject: '🐋 Balina Alarm - E-posta Doğrulama Kodu',
        text: 'Balina Alarm platformuna kayit olmak icin dogrulama kodunuz: ' + otpCode,
        html: `<div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 20px; border: 1px solid #e5e7eb; border-radius: 12px; background-color: #0d1b2a; color: #ffffff;">
            <div style="text-align: center; margin-bottom: 20px;">
                <span style="font-size: 40px;">🐋</span>
                <h2 style="color: #00ff88; margin-top: 10px;">Balina Alarm</h2>
            </div>
            <p style="font-size: 15px; color: #e0e0e0;">Merhaba,</p>
            <p style="font-size: 15px; color: #e0e0e0;">Balina Alarm platformuna kayıt olmak için doğrulama kodunuz aşağıdadır:</p>
            <div style="text-align: center; margin: 30px 0;">
                <span style="display: inline-block; font-size: 32px; font-weight: 800; letter-spacing: 4px; color: #00ff88; background: rgba(0,255,136,0.1); border: 2px solid #00ff88; padding: 12px 30px; border-radius: 8px;">${otpCode}</span>
            </div>
            <p style="font-size: 13px; color: #888888; text-align: center;">Bu kod 5 dakika süreyle geçerlidir.</p>
            <hr style="border-color: #1b2d45; margin: 20px 0;">
            <p style="font-size: 12px; color: #6b7280; text-align: center;">🐋 Balina Alarm Ekibi</p>
        </div>`
    };

    transporter.sendMail(mailOptions, function(error, info) {
        if (error) {
            console.log('E-posta gonderim hatasi:', error);
            return res.json({ success: false, message: 'Dogrulama kodu gonderilemedi! Lutfen e-posta adresinizi kontrol edin.' });
        }
        console.log('OTP gonderildi:', email);
        res.json({ success: true, message: 'Dogrulama kodu e-postaniza gonderildi. Lutfen kontrol edin.' });
    });
});

// ===== E-POSTA DOĞRULAMA KODU KONTROL ET =====
app.post('/api/verify-otp', function(req, res) {
    var email = req.body.email;
    var code = req.body.code;

    if (!otps[email]) {
        return res.json({ success: false, message: 'Dogrulama kodu bulunamadi. Lütfen tekrar kod isteyin.' });
    }
    if (Date.now() > otps[email].expires) {
        delete otps[email];
        return res.json({ success: false, message: 'Dogrulama kodunun suresi dolmus!' });
    }
    if (otps[email].code === code) {
        delete otps[email];
        res.json({ success: true });
    } else {
        res.json({ success: false, message: 'Girdiginiz dogrulama kodu hatali!' });
    }
});

// ===== TELEFON KONTROL API =====
app.post('/api/check-phone', function(req, res) {
    var phone = (req.body.phone || '').replace(/\s/g, '');
    if (registeredPhones[phone]) {
        res.json({ available: false, message: 'Bu telefon numarasi zaten kayitli!' });
    } else {
        res.json({ available: true, message: 'Uygun.' });
    }
});

// ===== KAYIT API =====
app.post('/api/register', function(req, res) {
    var phone = (req.body.phone || '').replace(/\s/g, '');
    var email = req.body.email || '';
    var name = req.body.name || '';

    if (registeredPhones[phone]) {
        res.json({ success: false, message: 'Bu telefon numarasi zaten kayitli!' });
        return;
    }

    registeredPhones[phone] = { email: email, name: name, time: Date.now() };
    console.log('Yeni kayit:', name, email, phone);
    res.json({ success: true, message: 'Kayit basarili.' });
});

// ===== TRİAL KONTROL API =====
app.post('/api/check-trial', function(req, res) {
    var ip = getIP(req);
    var email = req.body.email || '';

    if (trialUsers[ip]) {
        var elapsed = Date.now() - trialUsers[ip].start;
        if (elapsed >= TRIAL_DURATION) {
            res.json({ allowed: false, message: 'Deneme süreniz dolmustur.', remaining: 0 });
        } else {
            var remaining = TRIAL_DURATION - elapsed;
            res.json({ allowed: true, message: 'Deneme devam ediyor.', remaining: remaining, start: trialUsers[ip].start });
        }
    } else {
        trialUsers[ip] = { start: Date.now(), email: email };
        res.json({ allowed: true, message: 'Deneme baslatildi.', remaining: TRIAL_DURATION, start: Date.now() });
    }
});

// ===== TRİAL DURUMU SORGULA =====
app.get('/api/trial-status', function(req, res) {
    var ip = getIP(req);

    if (trialUsers[ip]) {
        var elapsed = Date.now() - trialUsers[ip].start;
        var remaining = Math.max(0, TRIAL_DURATION - elapsed);
        res.json({ exists: true, remaining: remaining, start: trialUsers[ip].start, expired: remaining <= 0 });
    } else {
        res.json({ exists: false, remaining: 0, expired: false });
    }
});

// ===== WEBHOOK =====
app.post('/webhook', function(req, res) {
    console.log('Webhook alindi:', JSON.stringify(req.body));
    var body = req.body;
    var symbol = body.symbol || body.ticker || 'BILINMIYOR';
    var action = body.action || body.signal || body.side || 'BILINMIYOR';
    action = action.toString().toLowerCase();
    if (action.includes('buy') || action.includes('long') || action === 'al') {
        action = 'buy';
    } else if (action.includes('sell') || action.includes('short') || action === 'sat') {
        action = 'sell';
    }
    var signal = {
        id: Date.now(),
        time: new Date().toISOString(),
        symbol: symbol.toUpperCase(),
        action: action,
        price: body.price || body.close || '',
        message: body.message || ''
    };
    signals.unshift(signal);
    if (signals.length > 100) signals = signals.slice(0, 100);
    sendToAllClients(signal);
    console.log('Sinyal gonderildi:', signal.symbol, signal.action);
    res.status(200).json({ success: true, signal: signal });
});

// ===== SSE =====
app.get('/events', function(req, res) {
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*'
    });
    clients.push(res);
    res.write('data: ' + JSON.stringify({ type: 'init', signals: signals }) + '\n\n');
    req.on('close', function() {
        clients = clients.filter(function(c) { return c !== res; });
    });
});

function sendToAllClients(signal) {
    var data = JSON.stringify({ type: 'new_signal', signal: signal });
    clients.forEach(function(client) {
        client.write('data: ' + data + '\n\n');
    });
}

// ===== API =====
app.get('/api/signals', function(req, res) {
    res.json({ signals: signals, count: signals.length });
});

app.delete('/api/signals', function(req, res) {
    signals = [];
    res.json({ success: true });
});

app.get('/api/test/:symbol/:action', function(req, res) {
    var test = {
        id: Date.now(),
        time: new Date().toISOString(),
        symbol: req.params.symbol.toUpperCase(),
        action: req.params.action.toLowerCase(),
        price: '0',
        message: 'Test sinyali'
    };
    signals.unshift(test);
    sendToAllClients(test);
    res.json({ success: true, signal: test });
});

app.get('/', function(req, res) {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, function() {
    console.log('Balina sunucu aktif! Port: ' + PORT);
});
