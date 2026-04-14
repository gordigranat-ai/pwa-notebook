const express = require('express');
const webpush = require('web-push');
const WebSocket = require('ws');
const bodyParser = require('body-parser');
const path = require('path');
const http = require('http');

const app = express();
const server = http.createServer(app);

const isProduction = process.env.NODE_ENV === 'production';
const PORT = process.env.PORT || 3000;

// ===== HTTPS РЕДИРЕКТ =====
app.use((req, res, next) => {
    const proto = req.headers['x-forwarded-proto'];
    if (isProduction && proto && proto !== 'https') {
        return res.redirect(301, `https://${req.headers.host}${req.url}`);
    }
    if (isProduction) {
        res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    next();
});

// ===== БЕЗОПАСНЫЕ ЗАГОЛОВКИ =====
app.use((req, res, next) => {
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    if (isProduction) {
        res.setHeader('Content-Security-Policy', 
            "default-src 'self'; script-src 'self' 'unsafe-inline'; " +
            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
            "font-src 'self' https://fonts.gstatic.com; " +
            "connect-src 'self' ws: wss:; img-src 'self' data:;"
        );
    }
    next();
});

// ===== СТАТИКА =====
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public'), {
    maxAge: isProduction ? '31536000' : '0',
    setHeaders: (res, filePath) => {
        if (filePath.endsWith('.html')) {
            res.setHeader('Cache-Control', 'no-cache');
        }
    }
}));

// ===== VAPID КЛЮЧИ =====
const vapidKeys = {
    publicKey: 'BHILXuiW1EmdWLdCxMIwFZWBD7fb1XFxCuIh2dKukIEetTQHf9TcNMeqDOV5Dn3OhLyz0mutCLXuOeLwUZ-5xB4',
    privateKey: 'e7o_ewAwMQAneYfEPShuF9s4L3ADqD1bunsmC6eyZFA'
};

console.log('\n' + '='.repeat(60));
console.log('🔑 VAPID PUBLIC KEY:', vapidKeys.publicKey);
console.log('='.repeat(60) + '\n');

webpush.setVapidDetails(
    'mailto:admin@pwa-workshop.local',
    vapidKeys.publicKey,
    vapidKeys.privateKey
);

// ===== ХРАНИЛИЩЕ ПОДПИСОК =====
const subscriptions = new Map();

// Автоочистка истекших подписок (каждые 30 минут)
setInterval(() => {
    const now = Date.now();
    const toRemove = [];
    
    for (const [id, sub] of subscriptions) {
        if (sub.lastUsed && now - sub.lastUsed > 7 * 24 * 60 * 60 * 1000) {
            toRemove.push(id);
        }
    }
    
    toRemove.forEach(id => subscriptions.delete(id));
    
    if (toRemove.length > 0) {
        console.log(`[Push] Удалено ${toRemove.length} истекших подписок. Осталось: ${subscriptions.size}`);
    }
}, 30 * 60 * 1000);

// ===== WEBSOCKET СЕРВЕР =====
const wss = new WebSocket.Server({ server });
const wsClients = new Map();

wss.on('connection', (ws, req) => {
    const clientId = Date.now().toString(36) + Math.random().toString(36).substr(2, 8);
    wsClients.set(clientId, { 
        ws, 
        ip: req.socket.remoteAddress,
        connectedAt: new Date().toISOString() 
    });
    
    console.log(`[WS] Клиент подключен: ${clientId} (всего: ${wsClients.size})`);
    
    ws.send(JSON.stringify({
        type: 'connected',
        message: 'Соединение установлено',
        clientId: clientId,
        timestamp: new Date().toISOString(),
        totalClients: wsClients.size
    }));

    ws.on('message', (data) => {
        try {
            const message = JSON.parse(data.toString());
            console.log(`[WS] Сообщение от ${clientId}:`, message.type || 'unknown');
            
            if (message.type === 'ping') {
                ws.send(JSON.stringify({ 
                    type: 'pong', 
                    timestamp: new Date().toISOString(),
                    originalTimestamp: message.timestamp 
                }));
            } else {
                ws.send(JSON.stringify({ 
                    type: 'echo', 
                    originalMessage: message,
                    timestamp: new Date().toISOString() 
                }));
            }
        } catch (error) {
            console.error('[WS] Ошибка парсинга:', error.message);
        }
    });

    ws.on('close', () => {
        wsClients.delete(clientId);
        console.log(`[WS] Клиент отключен: ${clientId} (осталось: ${wsClients.size})`);
    });

    ws.on('error', (error) => {
        console.error(`[WS] Ошибка клиента ${clientId}:`, error.message);
        wsClients.delete(clientId);
    });
});

function broadcastToAll(message) {
    const data = JSON.stringify(message);
    let sentCount = 0;
    
    wsClients.forEach((client) => {
        if (client.ws.readyState === WebSocket.OPEN) {
            client.ws.send(data);
            sentCount++;
        }
    });
    
    return sentCount;
}

// ===== API РОУТЫ =====

// Получение VAPID ключа
app.get('/api/vapid-public-key', (req, res) => {
    res.json({ 
        publicKey: vapidKeys.publicKey,
        timestamp: new Date().toISOString()
    });
});

// Сохранение подписки
app.post('/api/save-subscription', (req, res) => {
    const subscription = req.body;
    
    if (!subscription || !subscription.endpoint) {
        return res.status(400).json({ error: 'Невалидная подписка' });
    }
    
    const subscriptionId = Date.now().toString(36) + Math.random().toString(36).substr(2, 8);
    
    subscriptions.set(subscriptionId, {
        ...subscription,
        createdAt: new Date().toISOString(),
        lastUsed: Date.now(),
        userAgent: req.headers['user-agent'] || 'unknown'
    });
    
    console.log(`[Push] Новая подписка (ID: ${subscriptionId}), всего: ${subscriptions.size}`);
    
    broadcastToAll({
        type: 'push_subscription_added',
        totalSubscriptions: subscriptions.size,
        timestamp: new Date().toISOString()
    });
    
    res.status(201).json({
        success: true,
        subscriptionId: subscriptionId,
        message: 'Подписка сохранена'
    });
});

// Удаление подписки
app.delete('/api/subscription/:id', (req, res) => {
    const { id } = req.params;
    
    if (subscriptions.has(id)) {
        subscriptions.delete(id);
        console.log(`[Push] Подписка удалена (ID: ${id})`);
        
        broadcastToAll({
            type: 'push_subscription_removed',
            totalSubscriptions: subscriptions.size,
            timestamp: new Date().toISOString()
        });
        
        res.json({ success: true, message: 'Подписка удалена' });
    } else {
        res.status(404).json({ error: 'Подписка не найдена' });
    }
});

// Отправка Push-уведомления
app.post('/api/send-notification', async (req, res) => {
    const { title, body } = req.body;
    
    if (subscriptions.size === 0) {
        return res.status(404).json({ error: 'Нет активных подписок' });
    }
    
    const payload = JSON.stringify({
        title: title || 'PWA Заметки',
        body: body || 'Тестовое push-уведомление!',
        icon: '/images/icon-192.png',
        badge: '/images/icon-192.png',
        vibrate: [200, 100, 200],
        data: {
            url: '/',
            timestamp: new Date().toISOString()
        },
        actions: [
            { action: 'open', title: 'Открыть' },
            { action: 'close', title: 'Закрыть' }
        ]
    });
    
    const results = { success: 0, failed: 0, removed: 0 };
    const toRemove = [];
    
    for (const [id, subscription] of subscriptions) {
        try {
            await webpush.sendNotification(subscription, payload);
            results.success++;
            subscription.lastUsed = Date.now();
            console.log(`[Push] Отправлено (ID: ${id})`);
        } catch (error) {
            console.error(`[Push] Ошибка (ID: ${id}):`, error.statusCode);
            
            if (error.statusCode === 410 || error.statusCode === 404) {
                toRemove.push(id);
                results.removed++;
            } else {
                results.failed++;
            }
        }
    }
    
    toRemove.forEach(id => subscriptions.delete(id));
    
    broadcastToAll({
        type: 'notification_sent',
        results: results,
        timestamp: new Date().toISOString()
    });
    
    res.json({
        success: true,
        totalSubscriptions: subscriptions.size,
        results: results
    });
});

// Статистика сервера
app.get('/api/stats', (req, res) => {
    res.json({
        totalSubscriptions: subscriptions.size,
        websocketClients: wsClients.size,
        uptime: process.uptime(),
        environment: isProduction ? 'production' : 'development',
        nodeVersion: process.version,
        memory: {
            rss: Math.round(process.memoryUsage().rss / 1024 / 1024) + ' MB',
            heapTotal: Math.round(process.memoryUsage().heapTotal / 1024 / 1024) + ' MB',
            heapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + ' MB'
        },
        timestamp: new Date().toISOString()
    });
});

// Тестовые данные
app.get('/api/test-data', (req, res) => {
    const delay = isProduction ? 0 : Math.random() * 200;
    
    setTimeout(() => {
        res.json({
            message: 'Данные с сервера успешно получены',
            items: [
                { id: 1, name: 'Элемент 1', value: Math.random() },
                { id: 2, name: 'Элемент 2', value: Math.random() },
                { id: 3, name: 'Элемент 3', value: Math.random() }
            ],
            timestamp: new Date().toISOString()
        });
    }, delay);
});

// 404
app.use((req, res) => {
    res.status(404).json({ 
        error: 'Not Found', 
        path: req.path,
        method: req.method
    });
});

// Обработка ошибок
app.use((err, req, res, next) => {
    console.error('[Server] Ошибка:', err.stack);
    res.status(500).json({ 
        error: 'Internal Server Error',
        message: isProduction ? 'Произошла ошибка' : err.message
    });
});

// ===== ЗАПУСК СЕРВЕРА =====
server.listen(PORT, () => {
    console.log('\n' + '='.repeat(60));
    console.log('🚀 PWA WORKSHOP СЕРВЕР ЗАПУЩЕН');
    console.log('='.repeat(60));
    console.log(`📍 Режим: ${isProduction ? 'PRODUCTION' : 'DEVELOPMENT'}`);
    console.log(`🌐 Адрес: http://localhost:${PORT}`);
    console.log('='.repeat(60));
    
    if (isProduction) {
        console.log('⚠️  PRODUCTION: HTTPS редирект включен');
    } else {
        console.log('💡 DEVELOPMENT: HTTPS редирект отключен');
    }
    
    console.log('='.repeat(60));
    console.log('⌨️  Нажмите Ctrl+C для остановки\n');
});

// ===== GRACEFUL SHUTDOWN =====
process.on('SIGINT', () => {
    console.log('\n[Server] Завершение работы...');
    
    wsClients.forEach((client) => {
        if (client.ws.readyState === WebSocket.OPEN) {
            client.ws.send(JSON.stringify({
                type: 'server_shutdown',
                message: 'Сервер завершает работу',
                timestamp: new Date().toISOString()
            }));
            client.ws.close();
        }
    });
    
    server.close(() => {
        console.log(`[Push] Сохранено ${subscriptions.size} подписок`);
        console.log('[Server] Сервер остановлен');
        process.exit(0);
    });
});