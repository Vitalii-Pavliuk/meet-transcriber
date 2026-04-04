import sys
import json
import argparse
import os
import warnings
warnings.filterwarnings("ignore")

from dotenv import load_dotenv
load_dotenv()

def transcribe(audio_path, language=None):
    from faster_whisper import WhisperModel

    hf_token = os.getenv("HF_TOKEN")

    model = WhisperModel(
        "base",
        device="cpu",
        compute_type="int8",       
        cpu_threads=4,              
    )

    segments_gen, info = model.transcribe(
        audio_path,
        language=language,          
        beam_size=5,
        vad_filter=True,            
        vad_parameters=dict(
            min_silence_duration_ms=500, 
        ),
        word_timestamps=False,     
    )

    segments = list(segments_gen)
    detected = info.language

    speaker_segments = []
    if hf_token:
        try:
            from pyannote.audio import Pipeline

            pipeline = Pipeline.from_pretrained(
                "pyannote/speaker-diarization-3.1",
                use_auth_token=hf_token,
            )
            diarization = pipeline(audio_path)

            for turn, _, speaker in diarization.itertracks(yield_label=True):
                speaker_segments.append({
                    "start": turn.start,
                    "end":   turn.end,
                    "speaker": speaker,
                })
        except ImportError:
            sys.stderr.write("[warning] pyannote не встановлено\n")
        except Exception as e:
            sys.stderr.write(f"[warning] Diarization пропущено: {e}\n")
    else:
        sys.stderr.write("[warning] HF_TOKEN не знайдено — diarization вимкнено\n")

    def get_speaker(start, end):
        if not speaker_segments:
            return None
        best_speaker = None
        best_overlap = 0
        check_end = start + min(end - start, 3.0)
        for seg in speaker_segments:
            overlap = min(check_end, seg["end"]) - max(start, seg["start"])
            if overlap > best_overlap:
                best_overlap = overlap
                best_speaker = seg["speaker"]
        return best_speaker

    lines = []
    current_speaker = None
    current_start = None
    current_texts = []

    def flush():
        if not current_texts:
            return
        h = int(current_start // 3600)
        m = int((current_start % 3600) // 60)
        s = int(current_start % 60)
        ts = f"[{h:02d}:{m:02d}:{s:02d}]"
        label = f"{current_speaker}: " if current_speaker else ""
        lines.append(f"{ts} {label}{' '.join(current_texts).strip()}")

    for seg in segments:
        start   = seg.start
        end     = seg.end
        text    = seg.text.strip()
        if not text:
            continue
        speaker = get_speaker(start, end)
        if speaker != current_speaker:
            flush()
            current_speaker = speaker
            current_start   = start
            current_texts   = [text]
        else:
            current_texts.append(text)

    flush()

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
            "language":   detected_lang,
        }, ensure_ascii=False), flush=True)
    except Exception as e:
        print(json.dumps({"error": str(e)}), flush=True)
        sys.exit(1)