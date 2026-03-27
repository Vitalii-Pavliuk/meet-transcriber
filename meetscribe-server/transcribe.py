import sys
import json
import whisper

def transcribe(audio_path):
    model = whisper.load_model("base")
    result = model.transcribe(
        audio_path,
        language="uk",
        verbose=False,
        word_timestamps=True
    )

    lines = []
    for segment in result["segments"]:
        start = segment["start"]
        h = int(start // 3600)
        m = int((start % 3600) // 60)
        s = int(start % 60)
        timestamp = f"[{h:02d}:{m:02d}:{s:02d}]"
        lines.append(f"{timestamp} {segment['text'].strip()}")

    return "\n".join(lines)

if __name__ == "__main__":
    audio_path = sys.argv[1]
    transcript = transcribe(audio_path)
    print(json.dumps({ "transcript": transcript }))
