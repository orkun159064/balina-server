const express = require('express');
const cors = require('cors');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

var signals = [];
var clients = [];
var trialUsers = {};
var registeredPhones = {};

var TRIAL_DURATION = 24 * 60 * 60 * 1000;

function getIP(req) {
    return req.headers['x-forwarded-for'] || req.connection.remoteAddress || 'unknown';
}

app.post('/api/check-phone', function(req, res) {
    var phone = (req.body.phone || '').replace(/\s/g, '');
    if (registeredPhones[phone]) {
        res.json({ available: false, message: 'Bu telefon numarasi zaten kayitli!' });
    } else {
        res.json({ available: true, message: 'Uygun.' });
    }
});

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

app.post('/api/check-trial', function(req, res) {
    var ip = getIP(req);
    var email = req.body.email || '';
    if (trialUsers[ip]) {
        var elapsed = Date.now() - trialUsers[ip].start;
        if (elapsed >= TRIAL_DURATION) {
            res.json({ allowed: false, message: 'Deneme sureniz dolmustur.', remaining: 0 });
        } else {
            res.json({ allowed: true, message: 'Deneme devam ediyor.', remaining: TRIAL_DURATION - elapsed, start: trialUsers[ip].start });
        }
    } else {
        trialUsers[ip] = { start: Date.now(), email: email };
        res.json({ allowed: true, message: 'Deneme baslatildi.', remaining: TRIAL_DURATION, start: Date.now() });
    }
});

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

app.post('/webhook', function(req, res) {
    console.log('Webhook alindi:', JSON.stringify(req.body));
    var body = req.body;
    var symbol = body.symbol || body.ticker || 'BILINMIYOR';
    var action = body.action || body.signal || body.side || 'BILINMIYOR';
    action = action.toString().toLowerCase();
    if (action.includes('buy') || action.includes('long') || action === 'al') { action = 'buy'; }
    else if (action.includes('sell') || action.includes('short') || action === 'sat') { action = 'sell'; }
    var signal = { id: Date.now(), time: new Date().toISOString(), symbol: symbol.toUpperCase(), action: action, price: body.price || body.close || '', message: body.message || '' };
    signals.unshift(signal);
    if (signals.length > 100) signals = signals.slice(0, 100);
    sendToAllClients(signal);
    console.log('Sinyal gonderildi:', signal.symbol, signal.action);
    res.status(200).json({ success: true, signal: signal });
});

app.get('/events', function(req, res) {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive', 'Access-Control-Allow-Origin': '*' });
    clients.push(res);
    res.write('data: ' + JSON.stringify({ type: 'init', signals: signals }) + '\n\n');
    req.on('close', function() { clients = clients.filter(function(c) { return c !== res; }); });
});

function sendToAllClients(signal) {
    var data = JSON.stringify({ type: 'new_signal', signal: signal });
    clients.forEach(function(client) { client.write('data: ' + data + '\n\n'); });
}

app.get('/api/signals', function(req, res) { res.json({ signals: signals, count: signals.length }); });
app.delete('/api/signals', function(req, res) { signals = []; res.json({ success: true }); });
app.get('/api/test/:symbol/:action', function(req, res) {
    var test = { id: Date.now(), time: new Date().toISOString(), symbol: req.params.symbol.toUpperCase(), action: req.params.action.toLowerCase(), price: '0', message: 'Test sinyali' };
    signals.unshift(test); sendToAllClients(test); res.json({ success: true, signal: test });
});

app.get('/', function(req, res) { res.sendFile(path.join(__dirname, 'public', 'index.html')); });
app.listen(PORT, function() { console.log('Balina sunucu aktif! Port: ' + PORT); });
