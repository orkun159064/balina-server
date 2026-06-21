const express = require('express');
const cors = require('cors');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

let signals = [];

// TradingView Webhook
app.post('/webhook', (req, res) => {
    console.log('Webhook alindi:', req.body);

    const signal = {
        id: Date.now(),
        time: new Date().toLocaleString('tr-TR'),
        symbol: req.body.symbol || req.body.ticker || 'Bilinmiyor',
        action: req.body.action || req.body.side || 'Bilinmiyor',
        price: req.body.price || req.body.close || 'Bilinmiyor',
        message: req.body.message || ''
    };

    signals.unshift(signal);
    if (signals.length > 100) signals = signals.slice(0, 100);
    sendToAllClients(signal);

    res.status(200).json({ success: true, signal });
});

// Canli guncelleme (SSE)
let clients = [];

app.get('/events', (req, res) => {
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
    });

    clients.push(res);
    res.write('data: ' + JSON.stringify({ type: 'init', signals }) + '\n\n');

    req.on('close', () => {
        clients = clients.filter(c => c !== res);
    });
});

function sendToAllClients(signal) {
    clients.forEach(client => {
        client.write('data: ' + JSON.stringify({ type: 'new_signal', signal }) + '\n\n');
    });
}

// Tum sinyaller
app.get('/api/signals', (req, res) => {
    res.json({ signals });
});

// Sinyal temizle
app.delete('/api/signals', (req, res) => {
    signals = [];
    res.json({ success: true });
});

// Test sinyali
app.get('/api/test', (req, res) => {
    const test = {
        id: Date.now(),
        time: new Date().toLocaleString('tr-TR'),
        symbol: 'BTCUSDT',
        action: 'BUY',
        price: '67500',
        message: 'Test sinyali - Balina hareketi!'
    };
    signals.unshift(test);
    sendToAllClients(test);
    res.json({ success: true, signal: test });
});

// Ana sayfa
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/public/index.html');
});

app.listen(PORT, () => {
    console.log('Balina sunucu aktif! Port: ' + PORT);
});
