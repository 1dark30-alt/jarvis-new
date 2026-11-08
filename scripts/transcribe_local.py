"""Offline microphone transcription. Download base.en once during setup."""
import json
import sys
from faster_whisper import WhisperModel

model = WhisperModel("base.en", device="cpu", compute_type="int8", local_files_only=True)
segments, _ = model.transcribe(sys.argv[1], language="en", beam_size=3,
                               vad_filter=True, condition_on_previous_text=False)
text = " ".join(segment.text.strip() for segment in segments if segment.no_speech_prob < 0.6)
print(json.dumps({"text": text}, ensure_ascii=True))
