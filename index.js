require('dotenv').config();
const { makeWASocket, DisconnectReason, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const fs = require('fs');
const path = require('path');
const express = require('express');
const app = express();
const { handleCommand } = require('./handler');
const { addMessage, syncGroupMembers } = require('./commands/messagecount');
const { handleGroupParticipants } = require('./commands/group');

// Auto group scheduler
const AUTO_GROUP_FILE = path.join(__dirname, './data/autogroup.json');
function startAutoGroupScheduler(sock) {
    setInterval(async () => {
        try {
            if (!fs.existsSync(AUTO_GROUP_FILE)) return;
            const data = JSON.parse(fs.readFileSync(AUTO_GROUP_FILE, 'utf8'));
            const now = new Date();
            const jam = String(now.getHours()).padStart(2, '0');
            const menit = String(now.getMinutes()).padStart(2, '0');
            const waktu = `${jam}:${menit}`;
            for (const groupId in data) {
                const config = data[groupId];
                if (!config.enabled) continue;
                if (waktu === config.open) {
                    await sock.groupSettingUpdate(groupId, 'not_announcement');
                    await sock.sendMessage(groupId, { text: '🔓 Grup dibuka otomatis.' });
                }
                if (waktu === config.close) {
                    await sock.groupSettingUpdate(groupId, 'announcement');
                    await sock.sendMessage(groupId, { text: '🔒 Grup ditutup otomatis.' });
                }
            }
        } catch (err) {
            console.error('[AUTO GROUP ERROR]', err);
        }
    }, 60000);
}

async function startBot() {
     console.log("🚀 startBot dijalankan");
    console.log("PAIRING_PHONE =", process.env.PAIRING_PHONE);

    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    

    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false, // Matikan QR total (pakai pairing code)
        browser: ['Ubuntu', 'Chrome', '22.04.4']
    });

    sock.ev.on('creds.update', saveCreds);

    let pairingRequested = false;

    sock.ev.on('connection.update', async ({ connection, lastDisconnect }) => {
        if (connection === 'open') {
            console.log('✅ Bot terhubung ke WhatsApp!');
            startAutoGroupScheduler(sock);
            try {
                const groups = await sock.groupFetchAllParticipating();
                for (const id in groups) {
                    await syncGroupMembers(id, groups[id].participants);
                }
            } catch (err) {
                console.error('Sync grup error:', err);
            }
        }

        // Minta pairing code jika belum terdaftar dan belum pernah minta
        if (!state.creds.registered && !pairingRequested) {
            const phoneNumber = process.env.PAIRING_PHONE;
            if (phoneNumber) {
                pairingRequested = true;
                console.log(`📱 Meminta pairing code untuk ${phoneNumber}...`);
                setTimeout(async () => {
                    try {
                        const code = await sock.requestPairingCode(phoneNumber);
                        console.log(`\n🔢 KODE PAIRING: ${code}\n`);
                        console.log('Masukkan kode ini di WhatsApp → Setelan → Perangkat Tertaut → Tautkan Perangkat → Tautkan dengan nomor telepon');
                    } catch (err) {
                        console.error('❌ Gagal meminta pairing code:', err);
                        pairingRequested = false;
                    }
                }, 3000);
            } else {
                console.log('⚠️ PAIRING_PHONE tidak diset. Set environment variable PAIRING_PHONE dengan nomor WhatsApp.');
            }
        }

        if (connection === 'close') {
            const statusCode = new Boom(lastDisconnect?.error)?.output?.statusCode;
            const isLoggedOut = statusCode === DisconnectReason.loggedOut;
            console.log('❌ Koneksi terputus, status code:', statusCode);
            if (isLoggedOut) {
                console.log('🚫 Logged out! Hapus folder auth_info dan restart bot.');
                process.exit(0);
            } else {
                console.log('🔄 Reconnecting in 5 seconds...');
                setTimeout(startBot, 5000);
            }
        }
    });

    sock.ev.on('group-participants.update', async (update) => {
        try {
            await handleGroupParticipants(sock, update);
            if (['add', 'promote', 'demote'].includes(update.action)) {
                const metadata = await sock.groupMetadata(update.id);
                await syncGroupMembers(update.id, metadata.participants);
            }
        } catch (err) {
            console.error('[GROUP PARTICIPANT ERROR]', err);
        }
    });

    sock.ev.on('messages.upsert', async ({ messages }) => {
        try {
            const msg = messages[0];
            if (!msg?.message) return;
            if (msg.key.fromMe) return;
            const from = msg.key.remoteJid;
            const body =
                msg.message.conversation ||
                msg.message.extendedTextMessage?.text ||
                msg.message.imageMessage?.caption ||
                msg.message.videoMessage?.caption ||
                '';
            const senderName = msg.pushName || 'Pemain';
            const senderId = msg.key.participant || msg.key.remoteJid;

            if (from.endsWith('@g.us')) {
                addMessage(from, senderId, senderName);
            }
            console.log(`[MSG] ${from} : ${body}`);
            await handleCommand(sock, msg, from, body.trim(), senderName);
        } catch (err) {
            console.error('[MESSAGE ERROR]', err);
        }
    });
}

startBot();

const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.send('WhatsApp Bot Running');
});

app.listen(PORT, () => {
    console.log(`Web server aktif di port ${PORT}`);
});