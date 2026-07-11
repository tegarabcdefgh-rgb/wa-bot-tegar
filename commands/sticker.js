const sharp = require('sharp')
const fs = require('fs')
const path = require('path')
const axios = require('axios')
const { exec } = require('child_process')
const ffmpegPath = require('ffmpeg-static')

// ─── Konversi gambar ke WebP stiker ────────────────────────────────────────
async function imageToSticker(buffer, options = {}) {
  const {
    packName = 'Bot Stiker',
    authorName = 'WA Bot',
    crop = false,
  } = options

  try {
    let img = sharp(buffer).resize(512, 512, {
      fit: crop ? 'cover' : 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })

    const webpBuffer = await img
      .webp({ quality: 80, lossless: false })
      .toBuffer()

    return webpBuffer
  } catch (err) {
    throw new Error('Gagal mengkonversi gambar: ' + err.message)
  }
}

// ─── Konversi video/GIF ke stiker animasi ──────────────────────────────────
function videoToAnimatedSticker(inputBuffer, ext = 'mp4') {
  return new Promise((resolve, reject) => {
    const tmpDir = './tmp'
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir)

    const inputPath = path.join(tmpDir, `stiker_in_${Date.now()}.${ext}`)
    const outputPath = path.join(tmpDir, `stiker_out_${Date.now()}.webp`)

    fs.writeFileSync(inputPath, inputBuffer)

    // ffmpeg: resize ke 512x512, max 6 detik, 15fps
    const cmd = `"${ffmpegPath}" -i "${inputPath}" -vf "scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=white@0,fps=15" -loop 0 -ss 00:00:00 -t 00:00:06 -preset default -an -vsync 0 -s 512:512 "${outputPath}" -y`
    console.log('FFMPEG PATH:', ffmpegPath)

    exec(cmd, (err) => {
      // Hapus file input sementara
      try { fs.unlinkSync(inputPath) } catch (_) {}

      if (err) {
        reject(new Error('Gagal konversi video: ' + err.message))
        return
      }

      const result = fs.readFileSync(outputPath)
      try { fs.unlinkSync(outputPath) } catch (_) {}
      resolve(result)
    })
  })
}

// ─── Download media dari pesan ─────────────────────────────────────────────
async function downloadMedia(sock, msg) {
  const { downloadMediaMessage } = require('@whiskeysockets/baileys')
  const buffer = await downloadMediaMessage(msg, 'buffer', {}, {
    logger: require('pino')({ level: 'silent' }),
    reuploadRequest: sock.updateMediaMessage,
  })
  return buffer
}

// ─────────────────────────────────────────────────────────────────────────
// TEXT TO STICKER
// ─────────────────────────────────────────────────────────────────────────

// Daftar warna yang bisa dipilih via argumen (bg dan/atau teks)
const COLOR_MAP = {
  merah: '#E53935',
  biru: '#1E88E5',
  hijau: '#43A047',
  kuning: '#FBC02D',
  ungu: '#8E24AA',
  hitam: '#212121',
  putih: '#FFFFFF',
  pink: '#EC407A',
  orange: '#FB8C00',
  abu: '#757575',
}

function escapeXml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

// Pecah teks jadi beberapa baris agar tidak overflow dari kanvas
function wrapText(text, maxCharsPerLine = 14) {
  const words = text.split(/\s+/)
  const lines = []
  let current = ''

  for (const word of words) {
    if ((current + ' ' + word).trim().length > maxCharsPerLine) {
      if (current) lines.push(current.trim())
      current = word
    } else {
      current = (current + ' ' + word).trim()
    }
  }
  if (current) lines.push(current)
  return lines
}

// Generate stiker dari teks, dengan warna background & teks custom
async function textToSticker(text, options = {}) {
  const {
    bgColor = '#212121',
    textColor = '#FFFFFF',
  } = options

  const size = 512
  const lines = wrapText(text, 14)

  // Ukuran font otomatis berdasarkan jumlah baris & panjang teks
  let fontSize = 64
  if (lines.length > 4) fontSize = 44
  if (lines.length > 6) fontSize = 34
  const longestLine = Math.max(...lines.map(l => l.length))
  if (longestLine > 14) fontSize = Math.min(fontSize, Math.floor((size * 0.9) / (longestLine * 0.6)))

  const lineHeight = fontSize * 1.25
  const totalTextHeight = lines.length * lineHeight
  const startY = (size - totalTextHeight) / 2 + fontSize

  const textElements = lines.map((line, i) => {
    const y = startY + i * lineHeight
    return `<text x="50%" y="${y}" font-family="Arial, sans-serif" font-weight="bold" font-size="${fontSize}" fill="${textColor}" text-anchor="middle" dominant-baseline="middle">${escapeXml(line)}</text>`
  }).join('\n')

  const svg = `
  <svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" fill="${bgColor}" rx="40" ry="40"/>
    ${textElements}
  </svg>`

  return sharp(Buffer.from(svg))
    .resize(size, size)
    .webp({ quality: 90 })
    .toBuffer()
}

// Parsing argumen dengan format: <teks> | <warna_bg> | <warna_teks>
// Pemisah "|" diletakkan di AKHIR agar teks bebas tidak salah dianggap nama warna.
// Contoh: !stikertext balonku berwarna kuning
//           -> teks: "balonku berwarna kuning", bg default, teks putih
//         !stikertext balonku berwarna kuning | biru
//           -> teks: "balonku berwarna kuning", bg biru, teks putih
//         !stikertext aku sayang kamu | merah | kuning
//           -> teks: "aku sayang kamu", bg merah, teks kuning
function parseStickerTextArgs(args) {
  const fullText = args.join(' ')
  const parts = fullText.split('|').map(p => p.trim())

  const text = parts[0] || ''
  let bgColor = '#212121'
  let textColor = '#FFFFFF'

  if (parts[1] && COLOR_MAP[parts[1].toLowerCase()]) {
    bgColor = COLOR_MAP[parts[1].toLowerCase()]
  }
  if (parts[2] && COLOR_MAP[parts[2].toLowerCase()]) {
    textColor = COLOR_MAP[parts[2].toLowerCase()]
  }

  return { bgColor, textColor, text }
}

// Handler untuk command !stikertext
async function handleStickerText(sock, msg, from, args) {
  if (!args.length) {
    return sock.sendMessage(from, {
      text:
        `📝 *Cara buat stiker teks:*\n\n` +
        `*!stikertext <teks>*\n` +
        `*!stikertext <teks> | <warna_bg>*\n` +
        `*!stikertext <teks> | <warna_bg> | <warna_teks>*\n\n` +
        `🎨 Warna tersedia:\n` +
        `${Object.keys(COLOR_MAP).join(', ')}\n\n` +
        `Contoh:\n` +
        `*!stikertext Balonku berwarna kuning*\n` +
        `*!stikertext Balonku berwarna kuning | biru*\n` +
        `*!stikertext Aku sayang kamu | merah | kuning*`,
    }, { quoted: msg })
  }

  const { bgColor, textColor, text } = parseStickerTextArgs(args)

  if (!text.trim()) {
    return sock.sendMessage(from, {
      text: '❌ Teks tidak boleh kosong.\n\nContoh: *!stikertext Halo Dunia*',
    }, { quoted: msg })
  }

  try {
    await sock.sendMessage(from, { react: { text: '⏳', key: msg.key } })

    const webp = await textToSticker(text, { bgColor, textColor })

    await sock.sendMessage(from, { sticker: webp, mimetype: 'image/webp' })
    await sock.sendMessage(from, { react: { text: '✅', key: msg.key } })
  } catch (err) {
    await sock.sendMessage(from, {
      text: '❌ Gagal membuat stiker teks: ' + err.message,
    }, { quoted: msg })
  }
}

// ─────────────────────────────────────────────────────────────────────────
// HANDLER UTAMA STIKER (DARI GAMBAR/VIDEO/URL)
// ─────────────────────────────────────────────────────────────────────────
async function handleSticker(sock, msg, from, args) {
  const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage
  const msgType = Object.keys(msg.message || {})[0]

  // Opsi tambahan dari argumen
  const crop = args.includes('--crop') || args.includes('-c')
  const stickerOptions = { packName: 'Bot Stiker', authorName: 'WA Bot', crop }

  // ── Kasus 1: Reply ke pesan gambar/video/GIF ──
  if (quoted) {
    const quotedType = Object.keys(quoted)[0]

    // Bangun objek "pesan quoted" yang valid SEKALI saja, dengan urutan
    // properti yang benar (message: quoted harus di baris TERAKHIR supaya
    // tidak ketimpa oleh ...msg). Dipakai bareng untuk gambar & video/GIF.
    const quotedMsg = {
      ...msg,
      key: { ...msg.key, id: msg.message.extendedTextMessage.contextInfo.stanzaId },
      message: quoted,
    }

    if (quotedType === 'imageMessage') {
      await sock.sendMessage(from, { react: { text: '⏳', key: msg.key } })

      const buffer = await downloadMedia(sock, quotedMsg)
      const webp = await imageToSticker(buffer, stickerOptions)

      await sock.sendMessage(from, {
        sticker: webp,
        mimetype: 'image/webp',
      })
      await sock.sendMessage(from, { react: { text: '✅', key: msg.key } })
      return
    }

    if (quotedType === 'videoMessage' || quotedType === 'gifMessage') {
      await sock.sendMessage(from, { react: { text: '⏳', key: msg.key } })
      await sock.sendMessage(from, { text: '⏳ Memproses stiker animasi, harap tunggu...' }, { quoted: msg })

      // BUG SEBELUMNYA: downloadMedia(sock, { message: quoted, ...msg })
      // -> ...msg disebar SETELAH message: quoted, sehingga msg.message
      // (isi pesan reply, bukan video) menimpa balik `quoted`. Akibatnya
      // Baileys mencoba download media dari pesan yang salah dan selalu
      // gagal -> makanya stiker animasi dari reply tidak pernah jadi.
      // Sekarang pakai quotedMsg yang sudah dibangun dengan urutan benar.
      const ext = quotedType === 'gifMessage' ? 'gif' : 'mp4'
      const buffer = await downloadMedia(sock, quotedMsg)
      const webp = await videoToAnimatedSticker(buffer, ext)

      await sock.sendMessage(from, {
        sticker: webp,
        mimetype: 'image/webp',
      })
      await sock.sendMessage(from, { react: { text: '✅', key: msg.key } })
      return
    }
  }

  // ── Kasus 2: Kirim gambar langsung dengan caption !stiker ──
  if (msgType === 'imageMessage') {
    await sock.sendMessage(from, { react: { text: '⏳', key: msg.key } })
    const buffer = await downloadMedia(sock, msg)
    const webp = await imageToSticker(buffer, stickerOptions)

    await sock.sendMessage(from, { sticker: webp, mimetype: 'image/webp' })
    await sock.sendMessage(from, { react: { text: '✅', key: msg.key } })
    return
  }

  // ── Kasus 2B: Kirim video langsung dengan caption !stiker ──
  if (msgType === 'videoMessage') {
    await sock.sendMessage(from, {
      react: { text: '⏳', key: msg.key }
    })

    await sock.sendMessage(from, {
      text: '⏳ Memproses stiker animasi, harap tunggu...'
    }, { quoted: msg })

    const buffer = await downloadMedia(sock, msg)
    const webp = await videoToAnimatedSticker(buffer, 'mp4')

    await sock.sendMessage(from, {
      sticker: webp,
      mimetype: 'image/webp'
    })

    await sock.sendMessage(from, {
      react: { text: '✅', key: msg.key }
    })

    return
  }

  // ── Kasus 3: URL gambar dari argumen ──
  const urlArg = args.find(a => a.startsWith('http'))
  if (urlArg) {
    try {
      await sock.sendMessage(from, { react: { text: '⏳', key: msg.key } })

      // BUG SEBELUMNYA: tidak ada header User-Agent -> banyak situs/CDN
      // (mis. Pinterest, Instagram, beberapa image host) menolak request
      // tanpa User-Agent browser dan membalas 403 / halaman HTML, bukan
      // gambar. sharp() lalu gagal decode buffer itu, tapi error aslinya
      // ketutup karena "catch {}" tidak menangkap err sama sekali.
      const res = await axios.get(urlArg, {
        responseType: 'arraybuffer',
        timeout: 15000,
        maxRedirects: 5,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36',
          Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
        },
      })

      const contentType = res.headers['content-type'] || ''
      if (!contentType.startsWith('image/')) {
        throw new Error(`URL tidak mengembalikan gambar (content-type: ${contentType || 'tidak diketahui'})`)
      }

      const buffer = Buffer.from(res.data)
      const webp = await imageToSticker(buffer, stickerOptions)

      await sock.sendMessage(from, { sticker: webp, mimetype: 'image/webp' })
      await sock.sendMessage(from, { react: { text: '✅', key: msg.key } })
    } catch (err) {
      // Log penyebab asli ke console supaya gampang di-debug,
      // dan kasih pesan yang lebih jelas ke user.
      console.error('[STICKER URL ERROR]', err.message)
      await sock.sendMessage(from, {
        text: `❌ Gagal mengambil gambar dari URL.\n(${err.message})`,
      }, { quoted: msg })
    }
    return
  }

  // ── Kasus 4: Teks langsung setelah !stiker -> arahkan ke stikertext ──
  // (misal user ketik "!stiker Halo Dunia" tanpa media)
  const nonFlagArgs = args.filter(a => !a.startsWith('-') && !a.startsWith('http'))
  if (nonFlagArgs.length > 0) {
    return handleStickerText(sock, msg, from, args)
  }

  // ── Panduan jika tidak ada media ──
  await sock.sendMessage(from, {
    text: `🖼️ *Cara buat stiker:*\n\n` +
      `1️⃣ Kirim gambar dengan caption *!stiker*\n` +
      `2️⃣ Reply gambar/GIF/video lalu ketik *!stiker*\n` +
      `3️⃣ *!stiker [URL gambar]*\n` +
      `4️⃣ *!stikertext <teks>* — stiker dari teks\n\n` +
      `📌 Tambah \`--crop\` untuk stiker kotak penuh\n` +
      `Contoh: *!stiker --crop*`,
  }, { quoted: msg })
}

module.exports = { handleSticker, handleStickerText }