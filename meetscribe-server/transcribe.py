import sys
import json
import whisper

def transcribe(audio_path):
    model = whisper.load_model("base")

    result = model.transcribe(
        audio_path,
        verbose=False,
        word_timestamps=False,
        fp16=False
    )

    lines = []
    for segment in result["segments"]:
        start = segment["start"]
        h = int(start // 3600)
        m = int((start % 3600) // 60)
        s = int(start % 60)
        timestamp = f"[{h:02d}:{m:02d}:{s:02d}]"
        text = segment["text"].strip()
        if text:
            lines.append(f"{timestamp} {text}")

    return "\n".join(lines)

if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.stdout.write(json.dumps({"error": "Не вказано шлях до аудіофайлу"}) + "\n")
        sys.stdout.flush()
        sys.exit(1)

    audio_path = sys.argv[1]

    try:
        transcript = transcribe(audio_path)
        print(json.dumps({"transcript": transcript}, ensure_ascii=False), flush=True)
    except Exception as e:
        print(json.dumps({"error": str(e)}), flush=True)
        sys.exit(1)