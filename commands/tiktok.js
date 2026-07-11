// commands/tiktok.js
function formatNumber(num) {
    if (!num && num !== 0) return '0';
    return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

// BUG SEBELUMNYA: URL API di-hardcode ke http://localhost:3000, padahal
// tiktok-api dan bot WA ini adalah DUA SERVICE TERPISAH di Railway.
// "localhost" di container bot cuma merujuk ke dirinya sendiri, tidak
// pernah bisa menjangkau service tiktok-api -> itu sebabnya request selalu
// kena express bot sendiri (404 HTML) alih-alih tiktok-api yang sebenarnya.
//
// Sekarang base URL diambil dari environment variable TIKTOK_API_URL,
// yang diisi dengan URL publik/internal service tiktok-api di Railway.
// Set di Variables bot: TIKTOK_API_URL=https://tiktok-api-production.up.railway.app
const TIKTOK_API_BASE = process.env.TIKTOK_API_URL || 'http://localhost:3000';

async function handleTikTok(sock, msg, from, args) {
    if (!args[0]) {
        return sock.sendMessage(from, { text: `❌ Masukkan link TikTok.\nContoh: !tiktok https://vt.tiktok.com/xxxx` }, { quoted: msg });
    }
    let videoUrl = args[0];
    if (!videoUrl.includes('tiktok.com')) {
        return sock.sendMessage(from, { text: '❌ Link TikTok tidak valid.' }, { quoted: msg });
    }
    await sock.sendMessage(from, { text: '⏳ Sedang memproses video TikTok...' }, { quoted: msg });

    try {
        // 1. Ambil metadata dari API
        const metaUrl = `${TIKTOK_API_BASE}/api/download-tiktok?url=${encodeURIComponent(videoUrl)}`;
        const metaRes = await fetch(metaUrl);

        const contentType = metaRes.headers.get('content-type') || '';
        if (!contentType.includes('application/json')) {
            // Kalau bukan JSON, kemungkinan besar TIKTOK_API_URL salah/belum
            // di-set, atau service tiktok-api belum jalan/tidak terjangkau.
            throw new Error(
                `API TikTok tidak merespons dengan JSON (kemungkinan URL/endpoint salah atau service belum aktif). Base URL saat ini: ${TIKTOK_API_BASE}`
            );
        }

        const meta = await metaRes.json();
        if (!metaRes.ok || meta.status !== 'success') throw new Error(meta.error || 'Gagal ambil metadata');

        // 2. Unduh video dari endpoint download-video
        const videoEndpoint = `${TIKTOK_API_BASE}/api/download-video?url=${encodeURIComponent(videoUrl)}`;
        const videoRes = await fetch(videoEndpoint);
        if (!videoRes.ok) throw new Error(`Gagal unduh video: ${videoRes.status}`);
        const videoBuffer = Buffer.from(await videoRes.arrayBuffer());

        // 3. Buat caption
        const caption = `🎬 *${meta.uploader}*\n\n📝 *Deskripsi:* ${meta.description || '-'}\n\n📊 *Statistik:*\n👀 Views: ${formatNumber(meta.view_count)}\n❤️ Likes: ${formatNumber(meta.like_count)}\n💬 Komentar: ${formatNumber(meta.comment_count)}\n🔄 Share: ${formatNumber(meta.repost_count)}\n\n✅ Diunduh oleh Juun 👾`;

        // 4. Kirim video
        await sock.sendMessage(from, {
            video: videoBuffer,
            mimetype: 'video/mp4',
            caption: caption
        }, { quoted: msg });
    } catch (err) {
        console.error('[TikTok Error]', err);
        await sock.sendMessage(from, { text: `❌ Gagal: ${err.message}` }, { quoted: msg });
    }
}

module.exports = { handleTikTok };