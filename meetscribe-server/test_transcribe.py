import sys
import json
import subprocess
import os
import tempfile

def main():
    if len(sys.argv) < 2:
        print("Використання: python test_transcribe.py <аудіофайл> [--language uk]")
        print("Підтримуються: .mp3 .wav .webm .ogg .m4a .mp4")
        sys.exit(1)

    input_path = sys.argv[1]
    language = None
    if "--language" in sys.argv:
        idx = sys.argv.index("--language")
        if idx + 1 < len(sys.argv):
            language = sys.argv[idx + 1]

    if not os.path.exists(input_path):
        print(f"Файл не знайдено: {input_path}")
        sys.exit(1)

    ext = os.path.splitext(input_path)[1].lower()
    if ext in ('.mp3', '.wav'):
        audio_path = input_path
        temp_file = None
    else:
        print(f"Конвертуємо {ext} → mp3...")
        temp_file = tempfile.NamedTemporaryFile(suffix='.mp3', delete=False)
        temp_file.close()
        audio_path = temp_file.name
        result = subprocess.run([
            'ffmpeg', '-i', input_path,
            '-vn', '-ar', '16000', '-ac', '1', '-b:a', '64k', '-y',
            audio_path
        ], capture_output=True)
        if result.returncode != 0:
            print("FFmpeg помилка:", result.stderr.decode())
            sys.exit(1)
        print("Конвертація OK")

    print(f"Запускаємо transcribe.py{'  мова: ' + language if language else ''}...")
    cmd = [sys.executable, 'transcribe.py', audio_path]
    if language:
        cmd += ['--language', language]

    proc = subprocess.run(cmd, capture_output=False, text=True,
                          cwd=os.path.dirname(os.path.abspath(__file__)))

    if temp_file:
        os.unlink(audio_path)

main()


# python test_transcribe.py C:\Users\vital\Downloads\talk.mp3