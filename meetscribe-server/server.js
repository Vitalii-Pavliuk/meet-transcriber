require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { execFile, spawn } = require('child_process');
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const http = require('http');
const url = require('url');

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());

const upload = multer({
  dest: 'uploads/',
  limits: { fileSize: 500 * 1024 * 1024 }
});

const FOLDER_ID = process.env.DRIVE_FOLDER_ID || '1DkilMkGHN0yRJFGTpxVyPMIpLPaS3WKD';

const oauth2Client = new google.auth.OAuth2(
  process.env.CLIENT_ID,
  process.env.CLIENT_SECRET,
  'http://localhost:3001/callback'
);

const drive = google.drive({ version: 'v3', auth: oauth2Client });

function loadToken() {
  try {
    const token = JSON.parse(fs.readFileSync('token.json'));
    oauth2Client.setCredentials(token);
    return true;
  } catch {
    return false;
  }
}

async function ensureAuth() {
  if (loadToken()) {
    console.log('✓ Google Drive авторизація завантажена');
    return;
  }

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/drive.file'],
  });

  console.log('\n=== ПОТРІБНА АВТОРИЗАЦІЯ ===');
  console.log('Відкрийте це посилання в браузері:');
  console.log(authUrl);
  console.log('============================\n');

  await new Promise((resolve) => {
    const server = http.createServer(async (req, res) => {
      const code = new url.URL(req.url, 'http://localhost:3001').searchParams.get('code');
      if (!code) { res.end('Очікуємо код...'); return; }
      try {
        const { tokens } = await oauth2Client.getToken(code);
        oauth2Client.setCredentials(tokens);
        fs.writeFileSync('token.json', JSON.stringify(tokens));
        res.end('<h2>Авторизація успішна! Можна закрити вікно.</h2>');
        console.log('✓ Токен збережено в token.json');
        server.close(resolve);
      } catch (err) {
        res.end('<h2>Помилка: ' + err.message + '</h2>');
      }
    });
    server.listen(3001);
  });
}

function cleanup(...files) {
  for (const f of files) {
    try { if (f && fs.existsSync(f)) fs.unlinkSync(f); } catch {}
  }
}

app.post('/upload', upload.single('audio'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ ok: false, error: 'Файл не отримано' });
  }

  const webmPath = req.file.path;
  const mp3Path = webmPath + '.mp3';
  const timestamp = new Date().toISOString().slice(0, 16).replace('T', '_').replace(':', '-');
  const rawTitle = req.body?.meetTitle || '';
  const safeTitle = rawTitle.replace(/[^a-zA-Z0-9а-яА-ЯіІїЇєЄ\s\-_]/g, '').trim().slice(0, 60);
  const filename = safeTitle ? `${safeTitle}_${timestamp}` : `MeetScribe_${timestamp}`;
  const language = req.body?.language || null;

  try {
    console.log(`\n→ Отримано файл: ${req.file.originalname} (${(req.file.size / 1024 / 1024).toFixed(1)} МБ)`);

    await convertToMp3(webmPath, mp3Path);
    console.log('✓ Конвертація в mp3 завершена');

    const transcript = await runWhisper(mp3Path, language);
    console.log('✓ Транскрибація завершена, символів:', transcript.length);

    const localDir = path.join(__dirname, 'output');
    if (!fs.existsSync(localDir)) fs.mkdirSync(localDir);
    fs.copyFileSync(mp3Path, path.join(localDir, `${filename}.mp3`));
    fs.writeFileSync(path.join(localDir, `${filename}.txt`), transcript, 'utf-8');
    console.log(`✓ Збережено локально: output/${filename}`);

    let driveUrl = `https://drive.google.com/drive/folders/${FOLDER_ID}`;

    try {
      const driveData = await uploadMp3ToDrive(mp3Path, filename);
      driveUrl = driveData.folderUrl;
      console.log('✓ MP3 завантажено на Drive:', driveUrl);
    } catch (driveErr) {
      console.warn('⚠ Drive upload пропущено:', driveErr.message);
    }

    cleanup(webmPath, mp3Path);
    res.json({ ok: true, transcript, driveUrl, driveFilename: filename });

  } catch (err) {
    console.error('✗ Помилка:', err.message);
    cleanup(webmPath, mp3Path);
    res.status(500).json({ ok: false, error: err.message });
  }
});

function convertToMp3(input, output) {
  return new Promise((resolve, reject) => {
    execFile('ffmpeg', [
      '-i', input, '-vn', '-ar', '16000', '-ac', '1', '-b:a', '64k', '-y', output
    ], (err, stdout, stderr) => {
      if (err) reject(new Error('FFmpeg: ' + stderr));
      else resolve();
    });
  });
}

function runWhisper(audioPath, language = null) {
  return new Promise((resolve, reject) => {
    const timeout = 20 * 60 * 1000;
    const langArg = language ? ['--language', language] : [];

    const proc = spawn('python', ['-u', 'transcribe.py', audioPath, ...langArg], {
      cwd: __dirname,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    });

    let stdoutData = '';
    let stderrData = '';
    let killed = false;

    const timer = setTimeout(() => {
      killed = true;
      proc.kill();
      reject(new Error('Whisper перевищив ліміт часу (20 хв)'));
    }, timeout);

    proc.stdout.on('data', (chunk) => {
      stdoutData += chunk.toString();
    });

    proc.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderrData += text;
      process.stdout.write(text);
    });

    proc.on('close', (code) => {
      clearTimeout(timer);
      if (killed) return;

      const jsonMatch = stdoutData.match(/\{.*\}/s);
      if (!jsonMatch) {
        reject(new Error(`Whisper не повернув JSON. Exit: ${code}`));
        return;
      }

      try {
        const result = JSON.parse(jsonMatch[0]);
        if (result.error) {
          reject(new Error(result.error));
        } else if (typeof result.transcript !== 'string') {
          reject(new Error('Whisper повернув неочікуваний формат'));
        } else {
          resolve(result.transcript);
        }
      } catch (e) {
        reject(new Error('JSON.parse failed'));
      }
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error('Не вдалось запустити Python: ' + err.message));
    });
  });
}

async function uploadMp3ToDrive(mp3Path, filename) {
  await drive.files.create({
    requestBody: { name: `${filename}.mp3`, mimeType: 'audio/mpeg', parents: [FOLDER_ID] },
    media: { mimeType: 'audio/mpeg', body: fs.createReadStream(mp3Path) }
  });

  return {
    folderUrl: `https://drive.google.com/drive/folders/${FOLDER_ID}`,
  };
}

function sanitizeDriveFilename(name) {
  if (typeof name !== 'string') return '';
  return name.replace(/[^a-zA-Z0-9а-яА-ЯіІїЇєЄ\s\-_]/g, '').trim().slice(0, 80);
}

app.post('/save-transcript', async (req, res) => {
  const filename = sanitizeDriveFilename(req.body?.filename);
  const transcript = req.body?.transcript;
  if (!filename || typeof transcript !== 'string') {
    return res.status(400).json({ ok: false, error: 'filename або transcript відсутній' });
  }

  try {
    await drive.files.create({
      requestBody: { name: `${filename}.txt`, mimeType: 'text/plain', parents: [FOLDER_ID] },
      media: { mimeType: 'text/plain', body: Readable.from([transcript]) }
    });
    res.json({
      ok: true,
      driveUrl: `https://drive.google.com/drive/folders/${FOLDER_ID}`,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/health', (req, res) => res.json({ ok: true }));

ensureAuth().then(() => {
  app.listen(3000, () => {
    console.log('\n✓ MeetScribe сервер запущено: http://localhost:3000');
    console.log('  Очікуємо аудіо від Extension...\n');
  });
}).catch(err => {
  console.error('Помилка запуску:', err.message);
  process.exit(1);
});