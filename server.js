const WebSocket = require('ws');
const http = require('http');
const express = require('express');

const PORT = process.env.PORT || 8080;
const app = express();

// Middleware
app.use(express.json());
app.use(express.static('public'));

// Create HTTP server
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Store connected clients
const clients = new Set();
let messageHistory = [];

// Function to check if a message is a real notification (not system message)
function isRealNotification(message) {
    const systemKeywords = [
        'Initial Sync',
        'Connected to',
        'Connection successful',
        'request_initial_data',
        'ping',
        'pong',
        'heartbeat',
        'system_',
        'debug_',
        'test_connection'
    ];
    
    const lowerMessage = message.toLowerCase();
    return !systemKeywords.some(keyword => lowerMessage.includes(keyword.toLowerCase()));
}

// WebSocket connection handling
wss.on('connection', function connection(ws, req) {
    console.log('New client connected from:', req.socket.remoteAddress);
    clients.add(ws);
    
    // Send recent message history to new client (last 5 messages)
    // Only send real notifications, not system messages
    const realNotifications = messageHistory
        .filter(msg => isRealNotification(msg))
        .slice(-5);
    
    realNotifications.forEach(msg => {
        ws.send(msg);
    });

    ws.on('message', function incoming(message) {
        console.log('Received:', message.toString());
        
        try {
            const msgStr = message.toString();
            
            // Handle initial data request - No automatic notification
            if (msgStr.includes('request_initial_data')) {
                console.log('Client requested initial data - no notification sent');
                return;
            }
            
            // Only store and broadcast real notifications (filter out system messages)
            if (isRealNotification(msgStr)) {
                // Store message in history (avoid duplicates)
                if (!messageHistory.includes(msgStr)) {
                    messageHistory.push(msgStr);
                    if (messageHistory.length > 50) {
                        messageHistory = messageHistory.slice(-50);
                    }
                }
                
                // Broadcast to all clients except sender
                broadcastToOthers(ws, msgStr);
            } else {
                console.log('System message filtered out:', msgStr);
            }
            
        } catch (error) {
            console.error('Error processing message:', error);
        }
    });
    
    ws.on('close', function close() {
        console.log('Client disconnected');
        clients.delete(ws);
    });
    
    ws.on('error', function error(err) {
        console.error('WebSocket error:', err);
        clients.delete(ws);
    });
});

// Broadcast to all clients
function broadcastToAll(message) {
    console.log('Broadcasting to', clients.size, 'clients:', message);
    clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            try {
                client.send(message);
            } catch (error) {
                console.error('Error sending to client:', error);
                clients.delete(client);
            }
        }
    });
}

// Broadcast to all clients except sender
function broadcastToOthers(sender, message) {
    clients.forEach(client => {
        if (client !== sender && client.readyState === WebSocket.OPEN) {
            try {
                client.send(message);
            } catch (error) {
                console.error('Error sending to client:', error);
                clients.delete(client);
            }
        }
    });
}

// HTTP Routes
app.get('/', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>WallMob WebSocket Server</title>
            <style>
                body { font-family: Arial, sans-serif; margin: 40px; }
                .status { padding: 20px; background: #e8f5e8; border-radius: 5px; margin: 20px 0; }
                .endpoint { background: #f5f5f5; padding: 10px; margin: 10px 0; border-radius: 3px; }
                code { background: #f0f0f0; padding: 2px 5px; }
            </style>
        </head>
        <body>
            <h1>WallMob WebSocket Server</h1>
            <div class="status">
                <h3>Server Status: Online ✅</h3>
                <p>Connected clients: <strong>${clients.size}</strong></p>
                <p>Uptime: <strong>${Math.floor(process.uptime())} seconds</strong></p>
            </div>
            
            <h3>WebSocket Connection:</h3>
            <div class="endpoint">
                <code>wss://${req.get('host')}</code>
            </div>
            
            <h3>HTTP API Endpoints:</h3>
            <div class="endpoint">
                <strong>POST</strong> <code>/send-notification</code> - Send notification to all clients
            </div>
            <div class="endpoint">
                <strong>GET</strong> <code>/status</code> - Server status JSON
            </div>
            
            <h3>Test WebSocket:</h3>
            <button onclick="testConnection()">Test Connection</button>
            <div id="output" style="margin-top: 20px; padding: 10px; background: #f9f9f9;"></div>
            
            <script>
                function testConnection() {
                    const output = document.getElementById('output');
                    output.innerHTML = 'Connecting...';
                    
                    const ws = new WebSocket('wss://${req.get('host')}');
                    
                    ws.onopen = () => {
                        output.innerHTML += '<br>✅ Connected!';
                        ws.send('new_wallpaper|Test|Connection successful!');
                    };
                    
                    ws.onmessage = (e) => {
                        output.innerHTML += '<br>📩 Received: ' + e.data;
                    };
                    
                    ws.onerror = (e) => {
                        output.innerHTML += '<br>❌ Error: ' + e;
                    };
                    
                    setTimeout(() => {
                        ws.close();
                        output.innerHTML += '<br>🔌 Connection closed';
                    }, 5000);
                }
            </script>
        </body>
        </html>
    `);
});

app.get('/status', (req, res) => {
    const realNotifications = messageHistory.filter(msg => isRealNotification(msg));
    
    res.json({
        status: 'online',
        clients: clients.size,
        uptime: process.uptime(),
        totalMessages: messageHistory.length,
        realNotifications: realNotifications.length,
        timestamp: new Date().toISOString()
    });
});

app.post('/send-notification', (req, res) => {
    try {
        const { type, title, message, extraData = '' } = req.body;
        
        if (!type || !title || !message) {
            return res.status(400).json({ 
                success: false, 
                error: 'Missing required fields: type, title, message' 
            });
        }
        
        const notification = `${type}|${title}|${message}|${extraData}`;
        
        // Only store and broadcast real notifications
        if (isRealNotification(notification)) {
            // Add to message history (avoid duplicates)
            if (!messageHistory.includes(notification)) {
                messageHistory.push(notification);
                if (messageHistory.length > 50) {
                    messageHistory = messageHistory.slice(-50);
                }
            }
            
            broadcastToAll(notification);
            
            res.json({
                success: true,
                message: 'Real notification sent successfully',
                clients: clients.size,
                notification: notification
            });
        } else {
            res.json({
                success: false,
                message: 'System message filtered out - not a real notification',
                notification: notification
            });
        }
        
    } catch (error) {
        console.error('Error in /send-notification:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// Health check
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'healthy' });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({ error: 'Endpoint not found' });
});

// Start server
server.listen(PORT, '0.0.0.0', () => {
    console.log(`WebSocket server running on port ${PORT}`);
});

// Clean up disconnected clients periodically
setInterval(() => {
    const disconnectedClients = [];
    clients.forEach(client => {
        if (client.readyState !== WebSocket.OPEN) {
            disconnectedClients.push(client);
        }
    });
    
    disconnectedClients.forEach(client => {
        clients.delete(client);
    });
    
    if (disconnectedClients.length > 0) {
        console.log(`Cleaned up ${disconnectedClients.length} disconnected clients`);
    }
}, 30000);

// Keep alive ping
setInterval(() => {
    clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            try {
                client.ping();
            } catch (error) {
                console.error('Error pinging client:', error);
                clients.delete(client);
            }
        }
    });
}, 30000);
