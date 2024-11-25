const WebSocket = require('ws'); // WebSocket library

// Create a WebSocket server
const wss = new WebSocket.Server({ noServer: true });

// Store active WebSocket connections
const activeConnections = [];

// Handle new WebSocket connections
wss.on('connection', (ws) => {
    activeConnections.push(ws);

    // Handle WebSocket disconnections
    ws.on('close', () => {
        const index = activeConnections.indexOf(ws);
        if (index > -1) activeConnections.splice(index, 1);
    });
});

// Function to broadcast updates to all clients
function broadcastUpdate(data) {
    activeConnections.forEach((ws) => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(data));
        }
    });
}


require('dotenv').config();

const express = require('express');
const {
    Keypair,
    Connection,
    PublicKey,
    SystemProgram,
    Transaction,
    clusterApiUrl,
} = require('@solana/web3.js');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = 3000;

// Environment Variables
const JWT_SECRET = process.env.JWT_SECRET || 'your_jwt_secret_key';
const GAME_WALLET_SECRET_KEY = process.env.GAME_WALLET_SECRET_KEY;

// Decode the game wallet secret key
let gameWalletKeypair;
try {
    const secretKey = Uint8Array.from(JSON.parse(GAME_WALLET_SECRET_KEY));
    gameWalletKeypair = Keypair.fromSecretKey(secretKey);
} catch (error) {
    console.error('Invalid secret key in GAME_WALLET_SECRET_KEY:', error);
    process.exit(1);
}
console.log('Game wallet public key:', gameWalletKeypair.publicKey.toString());

// Paths for JSON files
const USERS_DB_FILE = path.join(__dirname, 'users.json');
const WALLETS_DB_FILE = path.join(__dirname, 'wallets.json');
const ROOMS_DB_FILE = path.join(__dirname, 'rooms.json');

// Load or initialize JSON databases
let users = fs.existsSync(USERS_DB_FILE) ? JSON.parse(fs.readFileSync(USERS_DB_FILE, 'utf8')) : {};
let wallets = fs.existsSync(WALLETS_DB_FILE) ? JSON.parse(fs.readFileSync(WALLETS_DB_FILE, 'utf8')) : {};
let rooms = fs.existsSync(ROOMS_DB_FILE) ? JSON.parse(fs.readFileSync(ROOMS_DB_FILE, 'utf8')) : {};

// Functions to save databases
function saveUsers() {
    fs.writeFileSync(USERS_DB_FILE, JSON.stringify(users, null, 2));
}
function saveWallets() {
    fs.writeFileSync(WALLETS_DB_FILE, JSON.stringify(wallets, null, 2));
}
function saveRooms() {
    fs.writeFileSync(ROOMS_DB_FILE, JSON.stringify(rooms, null, 2));
}

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'frontend')));

// Solana connection
const connection = new Connection(clusterApiUrl('mainnet-beta'), 'confirmed');

// Authenticate JWT token middleware
function authenticateToken(req, res, next) {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Unauthorized' });

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ error: 'Invalid token' });
        req.user = user;
        next();
    });
}

// Utility: Get wallet balance in SOL
async function getWalletBalance(publicKey) {
    try {
        const balance = await connection.getBalance(new PublicKey(publicKey), 'confirmed');
        return balance / 1e9; // Convert lamports to SOL
    } catch (error) {
        console.error('Error fetching wallet balance:', error);
        return 0;
    }
}

// Utility: Check deposit updates
async function checkDeposits(username) {
    const wallet = wallets[username];
    if (!wallet) return;

    const currentBalance = await getWalletBalance(wallet.publicKey);
    if (currentBalance > wallet.lastBalance) {
        const depositAmount = currentBalance - wallet.lastBalance;
        wallet.lastBalance = currentBalance;
        saveWallets();
        return depositAmount; // Return the deposit amount
    }
    return 0;
}

// User Registration
app.post('/register', async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) return res.status(400).json({ error: 'Username and password are required.' });
    if (users[username]) return res.status(400).json({ error: 'Username already exists.' });

    const hashedPassword = await bcrypt.hash(password, 10);
    const keypair = Keypair.generate();

    users[username] = { username, password: hashedPassword };
    wallets[username] = {
        publicKey: keypair.publicKey.toString(),
        secretKey: Array.from(keypair.secretKey),
        lastBalance: 0,
    };

    saveUsers();
    saveWallets();
    res.json({ message: 'Registration successful!' });
});

// User Login
app.post('/login', async (req, res) => {
    const { username, password } = req.body;

    const user = users[username];
    if (!user) return res.status(400).json({ error: 'Invalid username or password.' });

    const isPasswordCorrect = await bcrypt.compare(password, user.password);
    if (!isPasswordCorrect) return res.status(400).json({ error: 'Invalid username or password.' });

    const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: '24h' });
    res.json({ token, username });
});

// Get Wallet Info
app.get('/wallet', authenticateToken, async (req, res) => {
    const wallet = wallets[req.user.username];
    if (!wallet) return res.status(404).json({ error: 'Wallet not found.' });

    // Check for new deposits
    const depositAmount = await checkDeposits(req.user.username);
    if (depositAmount > 0) {
        res.json({
            publicKey: wallet.publicKey,
            username: req.user.username,
            depositNotification: `${depositAmount} SOL deposited!`,
        });
    } else {
        res.json({ publicKey: wallet.publicKey, username: req.user.username });
    }
});

// Get Wallet Balance
app.get('/balance', authenticateToken, async (req, res) => {
    const wallet = wallets[req.user.username];
    if (!wallet) return res.status(404).json({ error: 'Wallet not found.' });

    const balance = await getWalletBalance(wallet.publicKey);
    res.json({ balance });
});

// Withdraw SOL
app.post('/withdraw', authenticateToken, async (req, res) => {
    const { recipientPublicKey, amount } = req.body;
    const wallet = wallets[req.user.username];

    if (!wallet) return res.status(404).json({ error: 'Wallet not found.' });
    if (!recipientPublicKey || !amount || amount <= 0) return res.status(400).json({ error: 'Invalid recipient or amount.' });

    const balance = await getWalletBalance(wallet.publicKey);
    if (amount > balance) return res.status(400).json({ error: 'Insufficient balance.' });

    try {
        const senderKeypair = Keypair.fromSecretKey(Uint8Array.from(wallet.secretKey));
        const transaction = new Transaction().add(
            SystemProgram.transfer({
                fromPubkey: senderKeypair.publicKey,
                toPubkey: new PublicKey(recipientPublicKey),
                lamports: amount * 1e9, // Convert SOL to lamports
            })
        );

        const signature = await connection.sendTransaction(transaction, [senderKeypair]);
        await connection.confirmTransaction(signature);

        wallet.lastBalance -= amount; // Deduct from local balance
        saveWallets();
        res.json({ message: 'Withdrawal successful!', signature });
    } catch (error) {
        console.error('Error during withdrawal:', error);
        res.status(500).json({ error: 'Withdrawal failed.' });
    }
});

// Create Rock-Paper-Scissors Room
app.post('/create-room', authenticateToken, async (req, res) => {
    const { username } = req.user;
    const { creatorChoice, betAmount } = req.body;

    if (!creatorChoice || !betAmount || betAmount <= 0) {
        return res.status(400).json({ error: 'Invalid choice or bet amount.' });
    }

    const wallet = wallets[username];
    if (!wallet) return res.status(404).json({ error: 'Wallet not found.' });

    const balance = await getWalletBalance(wallet.publicKey);
    if (balance < betAmount) {
        return res.status(400).json({ error: 'Insufficient balance.' });
    }

    try {
        const senderKeypair = Keypair.fromSecretKey(Uint8Array.from(wallet.secretKey));
        const transaction = new Transaction().add(
            SystemProgram.transfer({
                fromPubkey: senderKeypair.publicKey,
                toPubkey: gameWalletKeypair.publicKey,
                lamports: betAmount * 1e9, // Convert SOL to lamports
            })
        );

        const signature = await connection.sendTransaction(transaction, [senderKeypair]);
        await connection.confirmTransaction(signature);

        wallet.lastBalance -= betAmount;
        saveWallets();

        const roomId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        rooms[roomId] = {
            roomId,
            creator: username,
            creatorChoice,
            betAmount,
            resolved: false,
            joiner: null,
            joinerChoice: null,
            result: null,
        };

        saveRooms();
        
        broadcastUpdate({ type: 'ROOM_CREATED', room: rooms[roomId] });

        res.json({ message: 'Room created successfully!', roomId });
    } catch (error) {
        console.error('Error during room creation:', error);
        res.status(500).json({ error: 'Failed to create room.' });
    }
});

// Join Rock-Paper-Scissors Room
app.post('/join-room', authenticateToken, async (req, res) => {
    const { username } = req.user;
    const { roomId, joinerChoice } = req.body;

    if (!roomId || !joinerChoice) {
        return res.status(400).json({ error: 'Room ID and choice are required.' });
    }

    const room = rooms[roomId];
    if (!room) {
        return res.status(404).json({ error: 'Room not found.' });
    }
    if (room.resolved) {
        return res.status(400).json({ error: 'Room already resolved.' });
    }
    if (room.joiner) {
        return res.status(400).json({ error: 'Room already has a joiner.' });
    }

    const wallet = wallets[username];
    if (!wallet) {
        return res.status(404).json({ error: 'Wallet not found.' });
    }

    const balance = await getWalletBalance(wallet.publicKey);
    if (balance < room.betAmount) {
        return res.status(400).json({ error: 'Insufficient balance to join the room.' });
    }

    try {
        // Fetch the latest blockhash
        const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();

        // Deduct the joiner's SOL and send it to the game wallet
        const senderKeypair = Keypair.fromSecretKey(Uint8Array.from(wallet.secretKey));
        const transaction = new Transaction({
            recentBlockhash: blockhash,
            feePayer: senderKeypair.publicKey,
        }).add(
            SystemProgram.transfer({
                fromPubkey: senderKeypair.publicKey,
                toPubkey: gameWalletKeypair.publicKey,
                lamports: room.betAmount * 1e9, // Convert SOL to lamports
            })
        );

        const signature = await connection.sendTransaction(transaction, [senderKeypair], {
            skipPreflight: false,
            preflightCommitment: 'confirmed',
        });
        await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed');

        // Deduct the amount from the joiner's balance
        wallet.lastBalance -= room.betAmount;
        saveWallets();

        // Update the room with joiner details
        room.joiner = username;
        room.joinerChoice = joinerChoice;

        // Determine the winner and resolve the game
        const { creator, creatorChoice, betAmount } = room;
        let result;

        if (creatorChoice === joinerChoice) {
            result = 'TIE';
        } else if (
            (creatorChoice === 'rock' && joinerChoice === 'scissors') ||
            (creatorChoice === 'scissors' && joinerChoice === 'paper') ||
            (creatorChoice === 'paper' && joinerChoice === 'rock')
        ) {
            result = `${creator} wins`;
            wallets[creator].lastBalance += betAmount * 2; // Winner gets the pot
        } else {
            result = `${username} wins`;
            wallets[username].lastBalance += betAmount * 2; // Winner gets the pot
        }

        // Transfer funds from the game wallet to the winner
        const winnerKeypair =
            result.includes(creator) && !result.includes('TIE')
                ? Keypair.fromSecretKey(Uint8Array.from(wallets[creator].secretKey))
                : Keypair.fromSecretKey(Uint8Array.from(wallets[username].secretKey));

        const payoutTransaction = new Transaction({
            recentBlockhash: blockhash,
            feePayer: gameWalletKeypair.publicKey,
        }).add(
            SystemProgram.transfer({
                fromPubkey: gameWalletKeypair.publicKey,
                toPubkey: winnerKeypair.publicKey,
                lamports: betAmount * 2 * 1e9, // Total pot size
            })
        );

        const payoutSignature = await connection.sendTransaction(payoutTransaction, [gameWalletKeypair], {
            skipPreflight: false,
            preflightCommitment: 'confirmed',
        });
        await connection.confirmTransaction(payoutSignature);

        // Update room as resolved
        room.resolved = true;
        room.result = result;
        saveRooms();
        saveWallets();

        // **Broadcast to all clients that the room was joined**
        broadcastUpdate({
            type: 'ROOM_JOINED',
            room,
        });

        // **Broadcast to all clients that the game was resolved**
        broadcastUpdate({
            type: 'GAME_RESOLVED',
            room,
        });

        res.json({ message: 'Game resolved!', room });
    } catch (error) {
        console.error('Error during room join transaction:', error);
        res.status(500).json({ error: 'Failed to join room.' });
    }
});



// Fetch all rooms
app.get('/rooms', authenticateToken, (req, res) => {
    const activeRooms = Object.values(rooms).filter((room) => !room.resolved);
    const finishedRooms = Object.values(rooms).filter((room) => room.resolved);

    res.json({ activeRooms, finishedRooms });
});

// Periodic room cleanup (removes finished rooms after 5 minutes)
setInterval(() => {
    const now = Date.now();
    for (const roomId in rooms) {
        const room = rooms[roomId];
        if (room.resolved && now - parseInt(room.roomId.split('-')[0]) >= 5 * 60 * 1000) {
            delete rooms[roomId];

            // **Broadcast room deletion**
            broadcastUpdate({
                type: 'ROOM_DELETED',
                roomId,
            });
        }
    }
    saveRooms();
}, 60 * 1000);


// Start the server
const server = app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});

// Attach WebSocket server to the HTTP server
server.on('upgrade', (request, socket, head) => {
    wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
    });
});

