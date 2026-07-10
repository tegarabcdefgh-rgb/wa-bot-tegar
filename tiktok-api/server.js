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

// Endpoint untuk mendapatkan metadata video
app.get('/api/download-tiktok', async (req, res) => {
    let videoUrl = req.query.url;
    // sanitize input: trim and take first token in case user pasted extra text
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

// Endpoint untuk mengunduh video (langsung mengirim file)
app.get('/api/download-video', (req, res) => {
    let videoUrl = req.query.url;
    // sanitize input: trim and take first token in case user pasted extra text
    videoUrl = videoUrl ? String(videoUrl).trim().split(/\s+/)[0] : videoUrl;
    if (!videoUrl) return res.status(400).json({ error: 'URL required' });
    if (!videoUrl.includes('tiktok.com')) return res.status(400).json({ error: 'Invalid TikTok URL' });

    // Stream output directly from yt-dlp to response
    // Use output to stdout with `-o -` and binary mode
    const args = [ '-f','best','-o','-',videoUrl];
    const ytdlpProc = spawn(ytdlp, args, { stdio: ['ignore', 'pipe', 'pipe'] });

    // Set headers for download
    const filename = `tiktok_${uuidv4()}.mp4`;
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    // Pipe stdout to response
    ytdlpProc.stdout.pipe(res);

    // Capture errors
    let stderr = '';
    ytdlpProc.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
    });

    ytdlpProc.on('error', (err) => {
        console.error('yt-dlp spawn error:', err);
        if (!res.headersSent) res.status(500).json({ error: 'Failed to start download process', details: err.message });
    });

    ytdlpProc.on('close', (code) => {
        if (code !== 0) {
            console.error('yt-dlp exited with code', code, stderr);
            // If response not finished, send error
            if (!res.finished) {
                res.status(500).end();
            }
        }
    });

    // If client disconnects, kill the child process
    req.on('close', () => {
        if (!res.writableEnded) {
            ytdlpProc.kill('SIGKILL');
        }
    });
});

app.listen(PORT, () => {
    console.log(`✅ TikTok API berjalan di http://localhost:${PORT}`);
    console.log(`📱 Contoh metadata: http://localhost:${PORT}/api/download-tiktok?url=https://vt.tiktok.com/ZSQfvJaFC/`);
    console.log(`📥 Contoh unduh video: http://localhost:${PORT}/api/download-video?url=https://vt.tiktok.com/ZSQfvJaFC/`);
});