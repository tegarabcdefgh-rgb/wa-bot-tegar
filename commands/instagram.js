// commands/instagram.js
function formatNumber(num) {
    if (!num && num !== 0) return '0';
    return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

// Pakai base URL yang sama dengan service tiktok-api (satu service, dua
// fitur), diisi lewat environment variable di bot. Kalau service API-nya
// mau dipisah lagi, tinggal buat env var sendiri, misal IG_API_URL.
const MEDIA_API_BASE = process.env.TIKTOK_API_URL || 'http://localhost:3000';

async function handleInstagram(sock, msg, from, args) {
    if (!args[0]) {
        return sock.sendMessage(from, {
            text: `❌ Masukkan link Instagram.\nContoh: !ig https://www.instagram.com/reel/xxxxx/`,
        }, { quoted: msg });
    }

    let postUrl = args[0];
    if (!postUrl.includes('instagram.com')) {
        return sock.sendMessage(from, { text: '❌ Link Instagram tidak valid.' }, { quoted: msg });
    }

    await sock.sendMessage(from, { text: '⏳ Sedang memproses postingan Instagram...' }, { quoted: msg });

    try {
        // 1. Ambil metadata dulu (sekaligus tahu ini foto atau video)
        const metaUrl = `${MEDIA_API_BASE}/api/download-instagram?url=${encodeURIComponent(postUrl)}`;
        const metaRes = await fetch(metaUrl);

        const contentType = metaRes.headers.get('content-type') || '';
        if (!contentType.includes('application/json')) {
            throw new Error(
                `API tidak merespons dengan JSON (kemungkinan service belum aktif atau URL API salah). Base URL: ${MEDIA_API_BASE}`
            );
        }

        const meta = await metaRes.json();
        if (!metaRes.ok || meta.status !== 'success') {
            throw new Error(meta.error || 'Gagal ambil metadata Instagram');
        }

        // 2. Unduh medianya
        const mediaEndpoint = `${MEDIA_API_BASE}/api/download-instagram-media?url=${encodeURIComponent(postUrl)}`;
        const mediaRes = await fetch(mediaEndpoint);
        if (!mediaRes.ok) throw new Error(`Gagal unduh media: ${mediaRes.status}`);
        const mediaBuffer = Buffer.from(await mediaRes.arrayBuffer());

        // 3. Caption
        const caption =
            `📸 *${meta.uploader || 'Tidak diketahui'}*\n\n` +
            `📝 *Deskripsi:* ${meta.description || meta.title || '-'}\n\n` +
            `❤️ Likes: ${formatNumber(meta.like_count)}\n` +
            `💬 Komentar: ${formatNumber(meta.comment_count)}\n\n` +
            `✅ Diunduh oleh Juun 👾`;

        // 4. Kirim sesuai jenis medianya
        if (meta.media_type === 'image') {
            await sock.sendMessage(from, {
                image: mediaBuffer,
                caption,
            }, { quoted: msg });
        } else {
            await sock.sendMessage(from, {
                video: mediaBuffer,
                mimetype: 'video/mp4',
                caption,
            }, { quoted: msg });
        }
    } catch (err) {
        console.error('[Instagram Error]', err);
        await sock.sendMessage(from, { text: `❌ Gagal: ${err.message}` }, { quoted: msg });
    }
}

module.exports = { handleInstagram };