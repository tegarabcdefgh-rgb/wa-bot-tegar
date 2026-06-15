require('dotenv').config();
const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');
dns.setServers(['8.8.8.8', '1.1.1.1']);

const { makeWASocket, DisconnectReason } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');


const { handleCommand } = require('./handler');
const { addMessage, syncGroupMembers } = require('./commands/messagecount');
const { handleGroupParticipants } = require('./commands/group');

// Auto group scheduler (sesuaikan dengan milik Anda)
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
 const { useMultiFileAuthState } = require('@whiskeysockets/baileys');
const { state, saveCreds } = await useMultiFileAuthState('auth_info');

    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: true,   // QR muncul di log (cocok untuk Railway)
        browser: ['Ubuntu', 'Chrome', '22.04.4']
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
        if (qr) {
            console.log('\n📱 SCAN QR CODE INI DENGAN WHATSAPP:\n');
            qrcode.generate(qr, { small: true });
            console.log('\nAtau salin teks QR di atas dan scan dari perangkat lain.\n');
        }

        if (connection === 'open') {
            console.log('✅ Bot terhubung ke WhatsApp!');
            startAutoGroupScheduler(sock);
            // Sync grup
            const groups = await sock.groupFetchAllParticipating();
            for (const id in groups) {
                await syncGroupMembers(id, groups[id].participants);
            }
        }

        if (connection === 'close') {
            const statusCode = new Boom(lastDisconnect?.error)?.output?.statusCode;
            const isLoggedOut = statusCode === DisconnectReason.loggedOut;
            console.log('❌ Koneksi terputus, status code:', statusCode);
            if (isLoggedOut) {
                console.log('🚫 Logged out! Menghapus sesi dari MongoDB...');
                await clear();
                console.log('🔄 Restart bot untuk scan QR baru.');
                startBot();
            } else {
                console.log('🔄 Reconnecting...');
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