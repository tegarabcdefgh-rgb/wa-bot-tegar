const fs   = require('fs')
const path = require('path')

const { handleSticker }                          = require('./commands/sticker')
const { handleGroup }                            = require('./commands/group')
const { handleTebakKata, handleAyoTebak }        = require('./commands/tebakkata')
const { handleTikTok }                           = require('./commands/tiktok')
const { handleInstagram }                        = require('./commands/instagram')
const { handleSiapaAku, handleAyoTebakSiapa }    = require('./commands/tebaksiapaaku')
const { handleTebakEmoji, handleAyoTebakEmoji }  = require('./commands/tebakemoji')
const { handleKuis, handleJawabKuis }            = require('./commands/kuismtk')
const { handleSambungKata, handleJawabSambungKata } = require('./commands/sambungkata')
const { handleMessageStats }                     = require('./commands/messagecount')
const { handleAfk, checkAfkReturn, checkAfkMention } = require('./commands/afk')
const { handleIntro }                            = require('./commands/intro')
const { handleWarn }                             = require('./commands/warn')
const { handleGacha }                            = require('./commands/gacha');
// ─────────────────────────────────────────
// AUTO GROUP HELPERS
// ─────────────────────────────────────────

const AUTO_GROUP_FILE = path.join(__dirname, './data/autogroup.json')

function loadAutoGroup() {
    if (!fs.existsSync(AUTO_GROUP_FILE)) {
        fs.writeFileSync(AUTO_GROUP_FILE, JSON.stringify({}))
    }
    return JSON.parse(fs.readFileSync(AUTO_GROUP_FILE, 'utf8'))
}

function saveAutoGroup(data) {
    fs.writeFileSync(AUTO_GROUP_FILE, JSON.stringify(data, null, 2))
}

// ─────────────────────────────────────────
// TEKS MENU
// ─────────────────────────────────────────

const MENU_TEXT = `👾💜 *KIM JU-EUN (JUUN)* 💜👾

━━━━━━━━━━━━━━━━━━

💬 Apa yang dapat *JUUN HEARTS2HEARTS* lakukan untuk membantu Anda?

👾 *STIKER*
- !stiker / !sticker / !s

👾 *MANAJEMEN GRUP*
- !kick @user
- !add 628xxxx
- !promote @user
- !demote @user
- !mute / !unmute
- !tagall
- !grupinfo
- !link / !resetlink

👾 *DOWNLOAD*
- !tiktok <link>
- !tt <link>
- !ig <link> — foto/video Instagram

👾 *AUTO GROUP*
- !autogroup
- !statusautogroup
- !setbuka <jam>
- !settutup <jam>
- !offautogroup

👾 *INTRO GRUP*
- !intro
- !setintro [teks]
- !resetintro

👾 *SISTEM WARNING*
- !warn @user [alasan]
- !unwarn @user
- !resetwarn @user
- !checkwarn @user
- !setwarnlimit <angka>
- !warnlimit

👾 *GAME*
- !tebak — mulai tebak kata
- ayo tebak <jawaban>
- !siapaaku — tebak siapa aku
- !tebakemoji — tebak arti emoji
- !kuis — kuis matematika cepat
- !stoptebak — hentikan game

👾 *SAMBUNG KATA*
- !joinsambungkata
- !mulaipermainan
- !statussambungkata
- !keluarsambungkata
- !stopsambungkata

🎮 *PERINGKAT*
- !leaderboard
- !poin

👾 *STATISTIK CHAT*
- !pesan
- !topchat
- !totalgrup
- !listchat
- !resetchat

👾 *UTILITAS*
- !ping
- !hi / !halo
- !afk [alasan]

━━━━━━━━━━━━━━━━━━

💜 JUUN siap membantu Anda!
👾 Powered by Hearts2Hearts 👾`

// ─────────────────────────────────────────
// COMMAND HANDLER UTAMA
// ─────────────────────────────────────────

const PREFIX = '!'

// Command yang ditangani handleMessageStats
const STATS_COMMANDS = ['pesan', 'topchat', 'totalgrup', 'listchat', 'resetchat']

async function handleCommand(sock, msg, from, body, senderName) {

    // ── Handler yang berjalan untuk SETIAP pesan (tanpa prefix) ──
    await handleAyoTebak(sock, msg, from, body, senderName)
    await handleAyoTebakSiapa(sock, msg, from, body, senderName)
    await handleAyoTebakEmoji(sock, msg, from, body, senderName)
    await handleJawabKuis(sock, msg, from, body, senderName)
    await handleJawabSambungKata(sock, msg, from, body, senderName)
    await checkAfkReturn(sock, msg, from)
    await checkAfkMention(sock, msg, from)

    // Abaikan jika bukan command dengan prefix
    if (!body || !body.startsWith(PREFIX)) return

    const [rawCmd, ...args] = body.slice(PREFIX.length).trim().split(/\s+/)
    const cmd = rawCmd.toLowerCase()

    console.log('[CMD]', cmd)

    // ── Statistik chat (ditangani tersendiri lalu keluar) ──
    if (STATS_COMMANDS.includes(cmd)) {
        return handleMessageStats(sock, msg, from, cmd)
    }

    // ── Switch command utama ──
    switch (cmd) {

        // ── Info / Salam ─────────────────────
        case 'halo':
        case 'hi':
            return sock.sendMessage(from, {
                text:
                    '👋 Halo!\n\n' +
                    'Saya *Kim Ju-eun (JUUN)* dari Hearts2Hearts 💙\n' +
                    'Apa yang bisa saya bantu hari ini?\n\n' +
                    'Ketik *!menu* untuk melihat fitur yang tersedia.'
            })

        case 'ping':
            return sock.sendMessage(from, {
                text:
                    '👾💜 Hai, JUUN disini!\n\n' +
                    '✨ Status Bot : Online\n' +
                    '💜 Kim Ju-eun siap membantu Anda.\n\n' +
                    'Ketik *!menu* untuk melihat fitur yang tersedia.'
            })
        case 'gacha':
            return handleGacha(sock, msg, from, cmd, args, senderName);

        // ── Menu / Help ──────────────────────
        // BUG SEBELUMNYA: case 'he  lp' punya dua spasi di tengah (typo),
        // jadi tidak pernah cocok dengan cmd = 'help' hasil parsing -> !help
        // tidak pernah merespons. Sudah diperbaiki jadi 'help'.
        case 'menu':
        case 'help': {
            const menuDir    = path.join(__dirname, 'assets', 'menu')
            const assetsDir  = path.join(__dirname, 'assets')
            let imageBuffer  = null

            // Cari gambar di folder menu, fallback ke assets
            for (const dir of [menuDir, assetsDir]) {
                if (fs.existsSync(dir)) {
                    const images = fs.readdirSync(dir).filter(f => /\.(jpg|jpeg|png)$/i.test(f))
                    if (images.length > 0) {
                        const pick = images[Math.floor(Math.random() * images.length)]
                        imageBuffer = fs.readFileSync(path.join(dir, pick))
                        break
                    }
                }
            }

            if (imageBuffer) {
                return sock.sendMessage(from, { image: imageBuffer, caption: MENU_TEXT })
            }
            return sock.sendMessage(from, { text: MENU_TEXT })
        }

        // ── Stiker ───────────────────────────
        case 'stiker':
        case 'sticker':
        case 's':
            return handleSticker(sock, msg, from, args)

        // ── Download ─────────────────────────
        case 'tiktok':
        case 'tt':
            return handleTikTok(sock, msg, from, args)

        case 'ig':
        case 'instagram':
            return handleInstagram(sock, msg, from, args)

        // ── Manajemen Grup ───────────────────
        case 'kick':
        case 'add':
        case 'promote':
        case 'demote':
        case 'mute':
        case 'unmute':
        case 'grupinfo':
        case 'link':
        case 'resetlink':
        case 'tagall':
            console.log('[GROUP CMD]', cmd)
            return handleGroup(sock, msg, from, cmd, args)

        // ── Warning System ───────────────────
        case 'warn':
        case 'unwarn':
        case 'resetwarn':
        case 'checkwarn':
        case 'setwarnlimit':
        case 'warnlimit':
            return handleWarn(sock, msg, from, cmd, args, senderName)

        // ── Auto Group ───────────────────────
        case 'autogroup': {
            const data = loadAutoGroup()
            if (!data[from]) {
                data[from] = { enabled: true, open: '18:00', close: '23:00' }
            } else {
                data[from].enabled = !data[from].enabled
            }
            saveAutoGroup(data)
            return sock.sendMessage(from, {
                text: data[from].enabled
                    ? '✅ Auto buka/tutup grup aktif'
                    : '❌ Auto buka/tutup grup nonaktif'
            })
        }

        case 'statusautogroup': {
            const data = loadAutoGroup()
            if (!data[from]) {
                return sock.sendMessage(from, { text: '❌ AutoGroup belum diaktifkan' })
            }
            return sock.sendMessage(from, {
                text:
                    `🤖 *AUTO GROUP*\n\n` +
                    `Status : ${data[from].enabled ? '✅ Aktif' : '❌ Nonaktif'}\n` +
                    `Buka   : ${data[from].open}\n` +
                    `Tutup  : ${data[from].close}`
            })
        }

        case 'setbuka': {
            if (!args[0]) {
                return sock.sendMessage(from, { text: 'Contoh penggunaan:\n!setbuka 18:00' })
            }
            const data = loadAutoGroup()
            if (!data[from]) {
                data[from] = { enabled: true, open: args[0], close: '23:00' }
            } else {
                data[from].open = args[0]
            }
            saveAutoGroup(data)
            return sock.sendMessage(from, { text: `✅ Jam buka diubah menjadi ${args[0]}` })
        }

        case 'settutup': {
            if (!args[0]) {
                return sock.sendMessage(from, { text: 'Contoh penggunaan:\n!settutup 23:00' })
            }
            const data = loadAutoGroup()
            if (!data[from]) {
                data[from] = { enabled: true, open: '18:00', close: args[0] }
            } else {
                data[from].close = args[0]
            }
            saveAutoGroup(data)
            return sock.sendMessage(from, { text: `✅ Jam tutup diubah menjadi ${args[0]}` })
        }

        case 'offautogroup': {
            const data = loadAutoGroup()
            if (data[from]) data[from].enabled = false
            saveAutoGroup(data)
            return sock.sendMessage(from, { text: '❌ Auto buka/tutup grup dimatikan' })
        }

        case 'tutupgrup':
            await sock.groupSettingUpdate(from, 'announcement')
            return sock.sendMessage(from, { text: '🔒 Grup ditutup' })

        case 'bukagrup':
            await sock.groupSettingUpdate(from, 'not_announcement')
            return sock.sendMessage(from, { text: '🔓 Grup dibuka' })

        // ── Intro Grup ───────────────────────
        case 'intro':
        case 'setintro':
        case 'resetintro':
            return handleIntro(sock, msg, from,cmd, args, senderName)

        // ── Game: Tebak Kata ─────────────────
        case 'tebak':
        case 'stoptebak':
        case 'leaderboard':
        case 'poin':
            return handleTebakKata(sock, msg, from, cmd, args, senderName)

        // ── Game: Siapa Aku ──────────────────
        case 'siapaaku':
        case 'stopsiapaaku':
            return handleSiapaAku(sock, msg, from, cmd, args, senderName)

        // ── Game: Tebak Emoji ────────────────
        case 'tebakemoji':
        case 'stoptebakemoji':
            return handleTebakEmoji(sock, msg, from, cmd, args, senderName)

        // ── Game: Kuis MTK ───────────────────
        case 'kuis':
        case 'stopkuis':
            return handleKuis(sock, msg, from, cmd, args, senderName)

        // ── Game: Sambung Kata ───────────────
        case 'joinsambungkata':
        case 'mulaipermainan':
        case 'keluarsambungkata':
        case 'statussambungkata':
        case 'stopsambungkata':
            return handleSambungKata(sock, msg, from, cmd, args, senderName)

        // ── AFK ──────────────────────────────
        case 'afk':
            return handleAfk(sock, msg, from, args, senderName)

        // ── Command Tidak Dikenal ────────────
        default:
            return sock.sendMessage(from, {
                text:
                    `❌ Command *!${cmd}* tidak ditemukan.\n\n` +
                    `Ketik *!menu* untuk melihat daftar command yang tersedia.`
            })
    }
}

module.exports = { handleCommand }