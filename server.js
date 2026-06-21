const express = require('express');
const cors = require('cors');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

let signals = [];
let clients = [];

app.post('/webhook', (req, res) => {
    console.log('Webhook alindi:', JSON.stringify(req.body));
    const body = req.body;
    const symbol = body.symbol || body.ticker || 'BILINMIYOR';
    let action = body.action || body.signal || body.side || 'BILINMIYOR';
    action = action.toString().toLowerCase();
    if (action.includes('buy') || action.includes('long') || action === 'al') {
        action = 'buy';
    } else if (action.includes('sell') || action.includes('short') || action === 'sat') {
        action = 'sell';
    }
    const signal = {
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
    res.status(200).json({ success: true, signal });
});

app.get('/events', (req, res) => {
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*'
    });
    clients.push(res);
    res.write('data: ' + JSON.stringify({ type: 'init', signals: signals }) + '\n\n');
    req.on('close', () => {
        clients = clients.filter(c => c !== res);
    });
});

function sendToAllClients(signal) {
    const data = JSON.stringify({ type: 'new_signal', signal: signal });
    clients.forEach(client => {
        client.write('data: ' + data + '\n\n');
    });
}

app.get('/api/signals', (req, res) => {
    res.json({ signals, count: signals.length });
});

app.delete('/api/signals', (req, res) => {
    signals = [];
    res.json({ success: true });
});

app.get('/api/test/:symbol/:action', (req, res) => {
    const test = {
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

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log('Balina sunucu aktif! Port: ' + PORT);
});
