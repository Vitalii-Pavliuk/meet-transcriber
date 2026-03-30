import sys
import json
import argparse
import whisper

def transcribe(audio_path, language=None):
    model = whisper.load_model("base")

    kwargs = dict(
        verbose=False,
        word_timestamps=False,
        fp16=False,
    )
    if language:
        kwargs['language'] = language

    result = model.transcribe(audio_path, **kwargs)

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

    detected = result.get("language", language or "unknown")
    return "\n".join(lines), detected

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("audio_path")
    parser.add_argument("--language", default=None)
    args = parser.parse_args()

    try:
        transcript, detected_lang = transcribe(args.audio_path, args.language)
        print(json.dumps({
            "transcript": transcript,
            "language": detected_lang,
        }, ensure_ascii=False), flush=True)
    except Exception as e:
        print(json.dumps({"error": str(e)}), flush=True)
        sys.exit(1)