

import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import { mouse, screen, Point, Button, straightTo, keyboard, Key } from '@nut-tree-fork/nut-js';
import path from 'path';
import { fileURLToPath } from 'url';

mouse.config.mouseSpeed = 10000;
mouse.config.autoDelayMs = 0;



const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

app.get('/host', (req, res) => res.sendFile(path.join(__dirname, 'public', 'host.html')));
app.get('/client', (req, res) => res.sendFile(path.join(__dirname, 'public', 'client.html')));

// Map to track which room (8-digit code) a socket belongs to
const socketRooms = new Map();

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    // --- Session Management ---
    socket.on('create_session', () => {
        // Generate a random 8-digit code
        const code = Math.floor(10000000 + Math.random() * 90000000).toString();
        socket.join(code);
        socketRooms.set(socket.id, code);
        socket.emit('session_created', code);
        console.log(`Session created: ${code}`);
    });

    socket.on('join_session', (code) => {
        // Check if the room exists and has a host
        if (io.sockets.adapter.rooms.has(code)) {
            socket.join(code);
            socketRooms.set(socket.id, code);
            socket.emit('session_joined');

            // Tell the host inside this room to start the WebRTC offer
            socket.to(code).emit('client_joined');
        } else {
            socket.emit('join_error', 'Invalid code or session expired.');
        }
    });

    // --- WebRTC Signaling (Room-Isolated) ---
    // Instead of broadcasting to everyone, we only send to the specific 8-digit room
    socket.on('offer', (data) => {
        const room = socketRooms.get(socket.id);
        if (room) socket.to(room).emit('offer', data);
    });

    socket.on('answer', (data) => {
        const room = socketRooms.get(socket.id);
        if (room) socket.to(room).emit('answer', data);
    });

    socket.on('ice-candidate', (data) => {
        const room = socketRooms.get(socket.id);
        if (room) socket.to(room).emit('ice-candidate', data);
    });

    // --- Hardware Control (Authorized Only) ---
    socket.on('mouse_move', async (data) => {
        const room = socketRooms.get(socket.id);
        if (!room) return; // Prevent unauthorized commands

        try {
            const screenWidth = await screen.width();
            const screenHeight = await screen.height();
            const targetX = Math.round(screenWidth * data.x);
            const targetY = Math.round(screenHeight * data.y);
            await mouse.setPosition(new Point(targetX, targetY));
        } catch (err) {
            console.error('Mouse move error:', err);
        }
    });



    // --- Hardware Control (Authorized Only) ---
    // ... existing mouse_move listener ...

    socket.on('mouse_down', async () => {
        const room = socketRooms.get(socket.id);
        if (!room) return;
        try { await mouse.pressButton(Button.LEFT); } catch (err) { }
    });

    socket.on('mouse_up', async () => {
        const room = socketRooms.get(socket.id);
        if (!room) return;
        try { await mouse.releaseButton(Button.LEFT); } catch (err) { }
    });

    socket.on('mouse_right_click', async () => {
        const room = socketRooms.get(socket.id);
        if (!room) return;
        try { await mouse.rightClick(); } catch (err) { }
    });

    socket.on('mouse_left_click', async () => {
        const room = socketRooms.get(socket.id);
        if (!room) return;
        try { await mouse.leftClick(); } catch (err) { }
    });

    socket.on('mouse_scroll', async (direction) => {
        const room = socketRooms.get(socket.id);
        if (!room) return;

        try {
            // The value (50) determines how many "lines" or pixels it scrolls per tick.
            // You can increase or decrease this number to adjust scroll speed.
            if (direction === 'up') {
                await mouse.scrollUp(50);
            } else if (direction === 'down') {
                await mouse.scrollDown(50);
            }
        } catch (err) {
            console.error('Mouse scroll error:', err);
        }
    });


    // --- Keyboard Control ---
    socket.on('key_type', async (text) => {
        const room = socketRooms.get(socket.id);
        if (!room) return;
        try {
            // Types out standard strings (including pasted text)
            await keyboard.type(text);
        } catch (err) {
            console.error('Keyboard type error:', err);
        }
    });

    socket.on('key_press', async (keyName) => {
        const room = socketRooms.get(socket.id);
        if (!room) return;
        try {
            // Maps string commands from the client to nut.js physical keys
            const keyMap = {
                'Backspace': Key.Backspace,
                'Enter': Key.Enter,
                'Up': Key.Up,
                'Down': Key.Down,
                'Left': Key.Left,
                'Right': Key.Right
            };

            if (keyMap[keyName]) {
                await keyboard.type(keyMap[keyName]);
            }
        } catch (err) {
            console.error('Key press error:', err);
        }
    });


    // --- Modifier Keys (Ctrl / Shift) ---
    socket.on('shift_down', async () => {
        const room = socketRooms.get(socket.id);
        if (!room) return;
        try { await keyboard.pressKey(Key.LeftShift); } catch (err) { }
    });

    socket.on('shift_up', async () => {
        const room = socketRooms.get(socket.id);
        if (!room) return;
        try { await keyboard.releaseKey(Key.LeftShift); } catch (err) { }
    });

    socket.on('ctrl_down', async () => {
        const room = socketRooms.get(socket.id);
        if (!room) return;
        try { await keyboard.pressKey(Key.LeftControl); } catch (err) { } // Change to Key.LeftSuper for macOS
    });

    socket.on('ctrl_up', async () => {
        const room = socketRooms.get(socket.id);
        if (!room) return;
        try { await keyboard.releaseKey(Key.LeftControl); } catch (err) { } // Change to Key.LeftSuper for macOS
    });

    socket.on('disconnect', async () => {
        socketRooms.delete(socket.id);
        console.log('User disconnected:', socket.id);

        // PANIC RELEASE: Ensure no keys or mouse buttons are stuck down on the host
        try {
            await mouse.releaseButton(Button.LEFT);
            await keyboard.releaseKey(Key.LeftShift);
            await keyboard.releaseKey(Key.LeftControl); // Change to Key.LeftSuper for macOS
        } catch (err) {
            console.error('Error during panic release:', err);
        }
    });


});

const PORT = 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running.`);
    console.log(`Host: http://localhost:${PORT}/host`);
    console.log(`Client: http://<YOUR_LAPTOP_IP>:${PORT}/client`);
});