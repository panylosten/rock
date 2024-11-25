// Key for storing the JWT token
// Connect to WebSocket server
const socket = new WebSocket('ws://localhost:3000');

// Handle incoming WebSocket messages
socket.onmessage = (event) => {
    const data = JSON.parse(event.data);

    switch (data.type) {
        case 'ROOM_CREATED':
            showNotification(`New room created by ${data.room.creator}`, 'info');
            loadRooms(); // Refresh active rooms
            break;
        case 'ROOM_JOINED':
            showNotification(`Room joined: ${data.room.roomId}`, 'success');
            loadRooms(); // Refresh active rooms
            break;
        case 'GAME_RESOLVED':
            showNotification(`Game resolved: ${data.room.result}`, 'success');
            loadRooms(); // Refresh active and finished rooms
            break;
        case 'ROOM_DELETED':
            showNotification(`Room deleted: ${data.roomId}`, 'info');
            loadRooms(); // Refresh room lists
            break;
        case 'BALANCE_UPDATE':
            if (data.username === document.getElementById('userUsername').textContent) {
                document.getElementById('walletBalance').textContent = `${data.balance} SOL`;
                document.getElementById('userBalance').textContent = `Balance: ${data.balance} SOL`;
            }
            break;
        default:
            console.log('Unknown WebSocket message type:', data.type);
    }
};

setInterval(async () => {
    const token = localStorage.getItem(tokenKey);
    if (token) {
        await fetchBalance(); // Update the wallet balance
    }
}, 5000);

// Handle WebSocket connection errors
socket.onerror = (error) => {
    console.error('WebSocket error:', error);
};

const tokenKey = 'authToken';

// Utility: Show Notifications
function showNotification(message, type = 'info') {
    const notifications = document.getElementById('notifications');
    const notification = document.createElement('div');
    notification.textContent = message;
    notification.className = `notification ${type}`;
    notifications.appendChild(notification);
    setTimeout(() => notification.remove(), 5000); // Remove after 5 seconds
}

// Utility: Copy wallet address
function copyWalletAddress() {
    const walletAddress = document.getElementById('walletPublicKey').textContent;
    navigator.clipboard.writeText(walletAddress).then(() => {
        showNotification('Wallet address copied!', 'success');
    });
}

// Utility: Set "MAX" withdrawal amount
function setMaxWithdraw() {
    const balanceText = document.getElementById('walletBalance').textContent;
    const maxBalance = parseFloat(balanceText.replace(' SOL', ''));
    if (isNaN(maxBalance) || maxBalance <= 0) {
        showNotification('Invalid balance.', 'error');
        return;
    }
    document.getElementById('withdrawAmount').value = maxBalance;
}

// Utility: Show specific section
function showSection(sectionId) {
    const sections = ['accountSection', 'rpsSection', 'loginSection'];
    sections.forEach((id) => {
        document.getElementById(id).classList.add('hidden');
    });
    document.getElementById(sectionId).classList.remove('hidden');
}
// Handle Login
async function handleLogin() {
    const username = document.getElementById('loginUsername').value;
    const password = document.getElementById('loginPassword').value;

    try {
        const response = await fetch('/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password }),
        });

        const data = await response.json();
        if (!response.ok) {
            showNotification(data.error || 'Login failed.', 'error');
            return;
        }

        localStorage.setItem(tokenKey, data.token);
        showNotification('Login successful!', 'success');
        loadUserInfo();
        showSection('accountSection');
    } catch (error) {
        console.error('Error during login:', error);
        showNotification('Login failed.', 'error');
    }
}

// Handle Logout
function handleLogout() {
    localStorage.removeItem(tokenKey);
    showNotification('Logged out successfully.', 'success');
    showSection('loginSection');
}

// Load User Info and Wallet Details
async function loadUserInfo() {
    const token = localStorage.getItem(tokenKey);
    if (!token) return;

    try {
        const response = await fetch('/wallet', {
            headers: { Authorization: `Bearer ${token}` },
        });

        if (!response.ok) {
            localStorage.removeItem(tokenKey);
            throw new Error('Failed to fetch wallet info.');
        }

        const walletData = await response.json();
        document.getElementById('walletPublicKey').textContent = walletData.publicKey;
        document.getElementById('userUsername').textContent = walletData.username;
        fetchBalance();

        if (walletData.depositNotification) {
            showNotification(walletData.depositNotification, 'success');
        }
    } catch (error) {
        console.error('Error loading user info:', error);
        showNotification('Failed to load wallet info.', 'error');
    }
}

// Fetch Wallet Balance
async function fetchBalance() {
    const token = localStorage.getItem(tokenKey);
    if (!token) return;

    try {
        const response = await fetch('/balance', {
            headers: { Authorization: `Bearer ${token}` },
        });

        if (!response.ok) {
            throw new Error('Failed to fetch balance.');
        }

        const balanceData = await response.json();
        document.getElementById('walletBalance').textContent = `${balanceData.balance} SOL`;
        document.getElementById('userBalance').textContent = `Balance: ${balanceData.balance} SOL`;
    } catch (error) {
        console.error('Error fetching balance:', error);
        showNotification('Failed to fetch balance.', 'error');
    }
}
// Handle Withdrawals
async function handleWithdraw() {
    const token = localStorage.getItem(tokenKey);
    const recipientPublicKey = document.getElementById('recipientPublicKey').value;
    const amount = parseFloat(document.getElementById('withdrawAmount').value);

    if (!recipientPublicKey || isNaN(amount) || amount <= 0) {
        showNotification('Invalid withdrawal input.', 'error');
        return;
    }

    try {
        const response = await fetch('/withdraw', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ recipientPublicKey, amount }),
        });

        const data = await response.json();
        if (!response.ok) {
            showNotification(data.error || 'Withdrawal failed.', 'error');
            return;
        }

        showNotification('Withdrawal successful!', 'success');
        fetchBalance();
    } catch (error) {
        console.error('Error during withdrawal:', error);
        showNotification('Withdrawal failed.', 'error');
    }
}
// Load Rooms (Active and Finished)
async function loadRooms() {
    const token = localStorage.getItem(tokenKey);
    if (!token) return;

    try {
        const response = await fetch('/rooms', {
            headers: { Authorization: `Bearer ${token}` },
        });

        const data = await response.json();
        const activeRoomsDiv = document.getElementById('activeRooms');
        const finishedRoomsDiv = document.getElementById('finishedRooms');

        activeRoomsDiv.innerHTML = '';
        finishedRoomsDiv.innerHTML = '';

        // Populate Active Rooms
        data.activeRooms.forEach((room) => {
            const roomDiv = document.createElement('div');
            roomDiv.className = 'room';
            roomDiv.innerHTML = `
                <p><strong>Room ID:</strong> ${room.roomId}</p>
                <p><strong>Creator:</strong> ${room.creator}</p>
                <p><strong>Bet Amount:</strong> ${room.betAmount} SOL</p>
                <button onclick="joinRoom('${room.roomId}', 'rock')">Join with Rock</button>
                <button onclick="joinRoom('${room.roomId}', 'paper')">Join with Paper</button>
                <button onclick="joinRoom('${room.roomId}', 'scissors')">Join with Scissors</button>
            `;
            activeRoomsDiv.appendChild(roomDiv);
        });

        // Populate Finished Rooms
        data.finishedRooms.forEach((room) => {
            const roomDiv = document.createElement('div');
            roomDiv.className = 'room';
            roomDiv.innerHTML = `
                <p><strong>Room ID:</strong> ${room.roomId}</p>
                <p><strong>Winner:</strong> <strong>${room.result}</strong></p>
                <p><strong>Picks:</strong> ${room.creatorChoice} (vs. ${room.joinerChoice})</p>
                <p><strong>Bet Amount:</strong> ${room.betAmount} SOL</p>
            `;
            finishedRoomsDiv.appendChild(roomDiv);
        });
    } catch (error) {
        console.error('Error loading rooms:', error);
        showNotification('Failed to load rooms.', 'error');
    }
}

// Create Room
async function createRoom() {
    const token = localStorage.getItem(tokenKey);
    const creatorChoice = document.getElementById('creatorChoice').value;
    const betAmount = parseFloat(document.getElementById('betAmount').value);

    if (!creatorChoice || isNaN(betAmount) || betAmount <= 0) {
        showNotification('Invalid room input.', 'error');
        return;
    }

    try {
        const response = await fetch('/create-room', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ creatorChoice, betAmount }),
        });

        const data = await response.json();
        if (!response.ok) {
            showNotification(data.error || 'Failed to create room.', 'error');
            return;
        }

        showNotification('Room created successfully!', 'success');
        loadRooms();
    } catch (error) {
        console.error('Error creating room:', error);
        showNotification('Failed to create room.', 'error');
    }
}

// Join Room
async function joinRoom(roomId, choice) {
    const token = localStorage.getItem(tokenKey);

    try {
        const response = await fetch('/join-room', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ roomId, joinerChoice: choice }),
        });

        const data = await response.json();
        if (!response.ok) {
            showNotification(data.error || 'Failed to join room.', 'error');
            return;
        }

        showNotification(`Game resolved: ${data.room.result}`, 'success');
        loadRooms();
    } catch (error) {
        console.error('Error joining room:', error);
        showNotification('Failed to join room.', 'error');
    }
}
// Event Listeners
document.getElementById('loginButton').addEventListener('click', handleLogin);
document.getElementById('logoutButton').addEventListener('click', handleLogout);
document.getElementById('copyButton').addEventListener('click', copyWalletAddress);
document.getElementById('maxButton').addEventListener('click', setMaxWithdraw);
document.getElementById('withdrawButton').addEventListener('click', handleWithdraw);
document.getElementById('createRoomButton').addEventListener('click', createRoom);
document.getElementById('accountMenu').addEventListener('click', () => showSection('accountSection'));
document.getElementById('rpsMenu').addEventListener('click', () => showSection('rpsSection'));
document.getElementById('loginMenu').addEventListener('click', () => showSection('loginSection'));

// On Page Load
window.onload = () => {
    loadUserInfo();
    loadRooms();
};
