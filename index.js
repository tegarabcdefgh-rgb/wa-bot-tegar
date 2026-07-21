require('dotenv').config();
const { makeWASocket, DisconnectReason, useMultiFileAuthState, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
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

// Simpan interval id di luar fungsi supaya bisa di-clear saat reconnect,
// mencegah interval numpuk tiap kali koneksi dibuka ulang.
let autoGroupInterval = null;

function startAutoGroupScheduler(sock) {
    if (autoGroupInterval) {
        clearInterval(autoGroupInterval);
        autoGroupInterval = null;
    }

    autoGroupInterval = setInterval(async () => {
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

// Timer countdown pairing code disimpan global supaya tidak numpuk.
// Sebelumnya `interval` adalah variabel lokal di dalam mulaiCountdown(),
// jadi tiap kali fungsi ini dipanggil ulang, interval lama TIDAK pernah
// di-clear -> beberapa countdown jalan bersamaan dan angka di terminal
// jadi lompat-lompat / berubah-ubah.
let countdownInterval = null;

function mulaiCountdown(detik) {
    if (countdownInterval) {
        clearInterval(countdownInterval);
        countdownInterval = null;
    }

    let sisa = detik;
    process.stdout.write(`   ⏱ Kode baru dalam: ${sisa} detik`);

    countdownInterval = setInterval(() => {
        sisa--;
        process.stdout.write(`\r   ⏱ Kode baru dalam: ${sisa} detik`);

        if (sisa <= 0) {
            clearInterval(countdownInterval);
            countdownInterval = null;
        }
    }, 1000);
}

// Mencegah beberapa instance startBot() jalan bersamaan (mis. dipanggil
// dari beberapa setTimeout yang menumpuk saat koneksi gagal berulang kali).
let botStarting = false;

// Hitung berapa kali gagal connect berturut-turut selagi BELUM registered.
// Dipakai untuk backoff -> supaya tidak spam request pairing code ke
// WhatsApp dalam waktu singkat (itu yang memicu server menolak dengan 405).
let unregisteredFailCount = 0;

// Interval refresh pairing code (dalam detik)
const PAIRING_REFRESH_SECONDS = 80;

async function startBot() {
    if (botStarting) {
        console.log('⏳ startBot() sudah berjalan, lewati pemanggilan ganda...');
        return;
    }
    botStarting = true;

    console.log("🚀 startBot dijalankan");
    console.log("PAIRING_PHONE =", process.env.PAIRING_PHONE);

    const { state, saveCreds } = await useMultiFileAuthState('auth_info');

    // FIX untuk bug "405 Connection Failure" saat pairing (lihat GitHub
    // WhiskeySockets/Baileys issue #2370). Baileys butuh nomor versi
    // WhatsApp Web yang sesuai dengan yang sedang dipakai server WA saat
    // ini -> ambil otomatis lewat fetchLatestBaileysVersion(), jangan
    // biarkan Baileys pakai default bawaannya yang bisa basi.
    let waVersion;
    try {
        const versionInfo = await fetchLatestBaileysVersion();
        waVersion = versionInfo.version;
        console.log('ℹ️  Menggunakan WA Web version:', waVersion, '| terbaru:', versionInfo.isLatest);
    } catch (err) {
        console.error('⚠️ Gagal mengambil versi WA terbaru, lanjut pakai default:', err.message);
    }

    const sock = makeWASocket({
        auth: state,
        version: waVersion, // penting: mencegah 405 Connection Failure
        printQRInTerminal: false, // Matikan QR total (pakai pairing code)
        browser: ['Ubuntu', 'Chrome', '22.04.4']
    });

    sock.ev.on('creds.update', saveCreds);

    let pairingRequested = false;
    let refreshInterval = null;

    // Di dalam startBot()
    const phoneNumber = process.env.PAIRING_PHONE; // ambil dari env

    async function mintaPairingCode() {
        try {
            if (!phoneNumber) {
                console.error('❌ PAIRING_PHONE tidak diatur di .env');
                return;
            }
            console.log(`📱 Meminta pairing code untuk ${phoneNumber}...`);
            const code = await sock.requestPairingCode(phoneNumber);
            const formatCode = code.match(/.{1,4}/g)?.join('-') || code;
            console.log('\n====================');
            console.log('🔢 KODE PAIRING:', formatCode);
            console.log('====================\n');
            console.log('WhatsApp HP → Setelan → Perangkat tertaut → Tautkan perangkat → Tautkan dengan nomor telepon');
            mulaiCountdown(PAIRING_REFRESH_SECONDS);
        } catch (err) {
            console.error('❌ Pairing gagal:', err.message);
            pairingRequested = false;
            // Jika error karena timeout, mungkin perlu refresh
        }
    }

    // Event connection.update
    sock.ev.on('connection.update', async ({ connection, lastDisconnect }) => {
        if (connection === 'open') {
            console.log('✅ Bot terhubung ke WhatsApp!');
            unregisteredFailCount = 0; // reset backoff, koneksi berhasil
            // Hentikan interval pairing jika masih berjalan
            if (refreshInterval) {
                clearInterval(refreshInterval);
                refreshInterval = null;
            }
            if (countdownInterval) {
                clearInterval(countdownInterval);
                countdownInterval = null;
            }
            pairingRequested = true; // tandai sudah minta pairing (tidak perlu lagi)
            startAutoGroupScheduler(sock);
            // sync grup ...
        }

        // Pairing code (hanya jika belum terdaftar dan belum diminta)
        if (!state.creds.registered && !pairingRequested) {
            pairingRequested = true;
            // Delay kecil (2 detik) agar socket stabil
            await new Promise(resolve => setTimeout(resolve, 2000));
            await mintaPairingCode();

            // Interval untuk refresh kode (jika belum terdaftar)
            refreshInterval = setInterval(async () => {
                if (state.creds.registered) {
                    clearInterval(refreshInterval);
                    refreshInterval = null;
                    return;
                }
                await mintaPairingCode();
            }, PAIRING_REFRESH_SECONDS * 1000);
        }

        if (connection === 'close') {
            const statusCode = new Boom(lastDisconnect?.error)?.output?.statusCode;
            const isLoggedOut = statusCode === DisconnectReason.loggedOut;
            console.log('❌ Koneksi terputus, status code:', statusCode);

            // Bersihkan timer punya sesi ini supaya tidak numpuk dengan sesi baru
            if (refreshInterval) {
                clearInterval(refreshInterval);
                refreshInterval = null;
            }
            if (countdownInterval) {
                clearInterval(countdownInterval);
                countdownInterval = null;
            }

            botStarting = false; // izinkan startBot() dipanggil lagi

            if (isLoggedOut || statusCode === 401) {
                // Sesi memang invalid (logout/unauthorized) -> auth_info WAJIB dihapus
                // supaya proses pairing bisa diminta ulang dari awal.
                console.log('🚫 Logged out atau unauthorized! Menghapus auth_info...');
                fs.rmSync('auth_info', { recursive: true, force: true });
                process.exit(0);
            } else if (!state.creds.registered) {
                // Belum berhasil pairing dan koneksi gagal lagi (mis. 405/408).
                // JANGAN langsung retry dalam hitungan detik -> itu yang bikin
                // WhatsApp menganggap ini spam pairing request dan menolak
                // dengan 405 berulang-ulang, sekaligus bikin beberapa
                // "🔢 KODE PAIRING" dan countdown numpuk.
                // Pakai backoff yang makin lama tiap gagal berturut-turut.
                unregisteredFailCount++;
                const delaySec = Math.min(30 * unregisteredFailCount, 180); // maks 3 menit
                console.log(`🔄 Belum ter-pairing (percobaan ke-${unregisteredFailCount}), reconnect dalam ${delaySec} detik...`);
                setTimeout(startBot, delaySec * 1000);
            } else {
                // Disconnect biasa/sementara (mis. restart required, koneksi putus)
                // setelah SUDAH pernah berhasil registered -> JANGAN hapus auth_info,
                // cukup reconnect dengan jeda wajar.
                console.log('🔄 Koneksi terputus sementara, reconnect tanpa hapus auth_info...');
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
    res.send('WhatsAppp Bot Running');
});

app.listen(PORT, () => {
    console.log(`Web server aktif di port ${PORT}`);
});