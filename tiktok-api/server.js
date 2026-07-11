const express = require('express');
const cors = require('cors');
const { exec, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const { v4: uuidv4 } = require('uuid');

const execPromise = promisify(exec);
const app = express();
const PORT = process.env.PORT || 3000;

// Prefer local `yt-dlp` from `node_modules/.bin`, fallback to global `yt-dlp`
const localYtdlp = path.join(__dirname, '..', 'node_modules', '.bin', 'yt-dlp');
const ytdlp = fs.existsSync(localYtdlp) ? localYtdlp : 'yt-dlp';

app.use(cors());
app.use(express.json());

// ─────────────────────────────────────────────────────────────────────────
// TIKTOK
// ─────────────────────────────────────────────────────────────────────────

app.get('/api/download-tiktok', async (req, res) => {
    let videoUrl = req.query.url;
    videoUrl = videoUrl ? String(videoUrl).trim().split(/\s+/)[0] : videoUrl;
    if (!videoUrl) {
        return res.status(400).json({ error: 'Parameter URL diperlukan' });
    }
    if (!videoUrl.includes('tiktok.com')) {
        return res.status(400).json({ error: 'URL tidak valid. Harus dari tiktok.com' });
    }
    try {
        const { stdout } = await execPromise(`${ytdlp} -j --no-warnings "${videoUrl}"`);
        const data = JSON.parse(stdout);
        res.json({
            status: 'success',
            video_url: data.url,
            title: data.title,
            uploader: data.uploader,
            view_count: data.view_count,
            like_count: data.like_count,
            comment_count: data.comment_count,
            repost_count: data.repost_count,
            description: data.description,
        });
    } catch (error) {
        console.error('Error metadata:', error.message);
        res.status(500).json({ error: 'Gagal memproses video TikTok', details: error.message });
    }
});

app.get('/api/download-video', (req, res) => {
    let videoUrl = req.query.url;
    videoUrl = videoUrl ? String(videoUrl).trim().split(/\s+/)[0] : videoUrl;
    if (!videoUrl) return res.status(400).json({ error: 'URL required' });
    if (!videoUrl.includes('tiktok.com')) return res.status(400).json({ error: 'Invalid TikTok URL' });

    const args = ['-f', 'best', '-o', '-', videoUrl];
    const ytdlpProc = spawn(ytdlp, args, { stdio: ['ignore', 'pipe', 'pipe'] });

    const filename = `tiktok_${uuidv4()}.mp4`;
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    ytdlpProc.stdout.pipe(res);

    let stderr = '';
    ytdlpProc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

    ytdlpProc.on('error', (err) => {
        console.error('yt-dlp spawn error:', err);
        if (!res.headersSent) res.status(500).json({ error: 'Failed to start download process', details: err.message });
    });

    ytdlpProc.on('close', (code) => {
        if (code !== 0) {
            console.error('yt-dlp exited with code', code, stderr);
            if (!res.finished) res.status(500).end();
        }
    });

    req.on('close', () => {
        if (!res.writableEnded) ytdlpProc.kill('SIGKILL');
    });
});

// ─────────────────────────────────────────────────────────────────────────
// INSTAGRAM (baru)
// yt-dlp mendukung Instagram (reels, video post, foto post/carousel item
// pertama). Endpointnya sengaja dibuat mirip pola TikTok di atas supaya
// gampang dipakai bareng: 1) ambil metadata dulu, 2) baru unduh media.
// ─────────────────────────────────────────────────────────────────────────

function isInstagramUrl(url) {
    return /instagram\.com\/(p|reel|reels|tv)\//i.test(url) || /instagram\.com/i.test(url);
}

app.get('/api/download-instagram', async (req, res) => {
    let mediaUrl = req.query.url;
    mediaUrl = mediaUrl ? String(mediaUrl).trim().split(/\s+/)[0] : mediaUrl;
    if (!mediaUrl) {
        return res.status(400).json({ error: 'Parameter URL diperlukan' });
    }
    if (!isInstagramUrl(mediaUrl)) {
        return res.status(400).json({ error: 'URL tidak valid. Harus dari instagram.com' });
    }
    try {
        const { stdout } = await execPromise(`${ytdlp} -j --no-warnings "${mediaUrl}"`);
        const data = JSON.parse(stdout);

        // Kalau kontennya foto (bukan video), yt-dlp biasanya menandai ext
        // sebagai jpg/png/webp dan tidak punya properti video khas.
        const isImage = ['jpg', 'jpeg', 'png', 'webp'].includes((data.ext || '').toLowerCase());

        res.json({
            status: 'success',
            media_type: isImage ? 'image' : 'video',
            media_url: data.url,
            title: data.title || data.description,
            uploader: data.uploader || data.channel,
            like_count: data.like_count,
            comment_count: data.comment_count,
            description: data.description,
            thumbnail: data.thumbnail,
        });
    } catch (error) {
        console.error('Error metadata IG:', error.message);
        res.status(500).json({ error: 'Gagal memproses postingan Instagram', details: error.message });
    }
});

app.get('/api/download-instagram-media', (req, res) => {
    let mediaUrl = req.query.url;
    mediaUrl = mediaUrl ? String(mediaUrl).trim().split(/\s+/)[0] : mediaUrl;
    if (!mediaUrl) return res.status(400).json({ error: 'URL required' });
    if (!isInstagramUrl(mediaUrl)) return res.status(400).json({ error: 'Invalid Instagram URL' });

    const args = ['-f', 'best', '-o', '-', mediaUrl];
    const ytdlpProc = spawn(ytdlp, args, { stdio: ['ignore', 'pipe', 'pipe'] });

    // Content-Type di-set generik dulu; kalau perlu pembeda gambar/video
    // yang lebih presisi, bot bisa memakai info dari /api/download-instagram
    // (media_type) sebelum memutuskan cara mengirim ke WhatsApp.
    const filename = `instagram_${uuidv4()}`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    ytdlpProc.stdout.pipe(res);

    let stderr = '';
    ytdlpProc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

    ytdlpProc.on('error', (err) => {
        console.error('yt-dlp spawn error:', err);
        if (!res.headersSent) res.status(500).json({ error: 'Failed to start download process', details: err.message });
    });

    ytdlpProc.on('close', (code) => {
        if (code !== 0) {
            console.error('yt-dlp exited with code', code, stderr);
            if (!res.finished) res.status(500).end();
        }
    });

    req.on('close', () => {
        if (!res.writableEnded) ytdlpProc.kill('SIGKILL');
    });
});

app.listen(PORT, () => {
    console.log(`✅ Media API berjalan di http://localhost:${PORT}`);
    console.log(`📱 TikTok metadata: http://localhost:${PORT}/api/download-tiktok?url=...`);
    console.log(`📱 Instagram metadata: http://localhost:${PORT}/api/download-instagram?url=...`);
});