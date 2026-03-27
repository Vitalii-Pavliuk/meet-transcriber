const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { execFile } = require('child_process');
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const http = require('http');
const url = require('url');

const app = express();
app.use(cors({ origin: '*' }));
const upload = multer({ dest: 'uploads/' });

const FOLDER_ID = '1DkilMkGHN0yRJFGTpxVyPMIpLPaS3WKD';

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
  if (loadToken()) return;

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
      if (!code) return;
      const { tokens } = await oauth2Client.getToken(code);
      oauth2Client.setCredentials(tokens);
      fs.writeFileSync('token.json', JSON.stringify(tokens));
      res.end('<h2>Авторизація успішна! Можна закрити вікно.</h2>');
      server.close(resolve);
      console.log('✓ Токен збережено в token.json');
    });
    server.listen(3001);
  });
}

app.post('/upload', upload.single('audio'), async (req, res) => {
  const webmPath = req.file.path;
  const mp3Path = webmPath + '.mp3';
  const filename = `MeetScribe_${new Date().toISOString().slice(0, 10)}`;

  try {
    await convertToMp3(webmPath, mp3Path);
    console.log('✓ Конвертація завершена');

    const transcript = await runWhisper(mp3Path);
    console.log('✓ Транскрибація завершена');

    const localDir = path.join(__dirname, 'output');
    if (!fs.existsSync(localDir)) fs.mkdirSync(localDir);
    fs.copyFileSync(mp3Path, path.join(localDir, `${filename}.mp3`));
    fs.writeFileSync(path.join(localDir, `${filename}.txt`), transcript, 'utf-8');
    console.log('✓ Збережено локально в output/');

    let driveUrl = null;
    try {
      driveUrl = await uploadToDrive(mp3Path, transcript, filename);
      console.log('✓ Завантажено на Drive:', driveUrl);
    } catch (driveErr) {
      console.warn('⚠ Drive upload пропущено:', driveErr.message);
    }

    fs.unlinkSync(webmPath);
    fs.unlinkSync(mp3Path);

    res.json({ ok: true, transcript, driveUrl });
  } catch (err) {
    console.error('Помилка:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

function convertToMp3(input, output) {
  return new Promise((resolve, reject) => {
    execFile('ffmpeg', ['-i', input, '-vn', '-ar', '16000', '-ac', '1', '-b:a', '64k', output],
      (err) => err ? reject(err) : resolve()
    );
  });
}

function runWhisper(audioPath) {
  return new Promise((resolve, reject) => {
    execFile('python', ['transcribe.py', audioPath],
      { maxBuffer: 10 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) return reject(new Error(stderr));
        try {
          resolve(JSON.parse(stdout).transcript);
        } catch {
          reject(new Error('Не вдалось розпарсити відповідь Whisper'));
        }
      }
    );
  });
}

async function uploadToDrive(mp3Path, transcript, filename) {
  await drive.files.create({
    requestBody: { name: `${filename}.mp3`, mimeType: 'audio/mpeg', parents: [FOLDER_ID] },
    media: { mimeType: 'audio/mpeg', body: fs.createReadStream(mp3Path) }
  });

  await drive.files.create({
    requestBody: { name: `${filename}.txt`, mimeType: 'text/plain', parents: [FOLDER_ID] },
    media: { mimeType: 'text/plain', body: Readable.from([transcript]) }
  });

  return `https://drive.google.com/drive/folders/${FOLDER_ID}`;
}

ensureAuth().then(() => {
  app.listen(3000, () => console.log('Server running on http://localhost:3000'));
});