#!/usr/bin/env python3
"""
Wake word detection using openWakeWord.
Communicates with the Electron main process via stdin/stdout JSON.
Listens for "Jarvis" from the microphone and signals when detected.
"""

import json
import os
import sys
import threading
import time

import numpy as np
import sounddevice as sd
from openwakeword.model import Model

# ── Resolve model path ──────────────────────────────────────────────────
# When running as PyInstaller binary, the model is in _MEIPASS/wakeword_models/
# When running as script, it's next to this file
if getattr(sys, 'frozen', False):
    # PyInstaller bundle
    base = sys._MEIPASS
else:
    base = os.path.dirname(os.path.abspath(__file__))

MODEL_PATH = os.path.join(base, 'wakeword_models', 'jarvis.onnx')

# ── Audio settings ──────────────────────────────────────────────────────
SAMPLE_RATE = 16000
FRAME_SIZE = 1280  # 80ms at 16kHz

# ── State ───────────────────────────────────────────────────────────────
running = True
threshold = 0.5
mic_in_use = False
last_detect_time = 0.0
debounce_seconds = 1.5


def send(event: str, **kwargs):
    """Send a JSON message to stdout."""
    msg = {"event": event, **kwargs}
    print(json.dumps(msg), flush=True)


def stdin_listener():
    """Listen for commands on stdin from the parent process."""
    global running, threshold, mic_in_use
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            cmd = json.loads(line)
        except json.JSONDecodeError:
            continue

        command = cmd.get("command")
        if command == "stop":
            running = False
            break
        elif command == "set_threshold":
            threshold = max(0.0, min(1.0, float(cmd.get("value", 0.5))))
            send("status", threshold=threshold)
        elif command == "set_mic_in_use":
            new_val = bool(cmd.get("value", False))
            if new_val != mic_in_use:
                mic_in_use = new_val
                send("status", mic_in_use=mic_in_use)


def main():
    global last_detect_time

    # Start stdin listener thread
    listener_thread = threading.Thread(target=stdin_listener, daemon=True)
    listener_thread.start()

    # Load the model
    send("status", message=f"Loading model from {MODEL_PATH}")
    if not os.path.exists(MODEL_PATH):
        send("error", message=f"Model file not found: {MODEL_PATH}")
        return

    try:
        model = Model(wakeword_model_paths=[MODEL_PATH])
    except Exception as e:
        send("error", message=f"Failed to load model: {e}")
        return

    def open_stream():
        audio_stream = sd.InputStream(
            samplerate=SAMPLE_RATE,
            channels=1,
            blocksize=FRAME_SIZE,
            dtype='int16',
        )
        audio_stream.start()
        send("status", message="Listening for 'Jarvis'...", listening=True, threshold=threshold)
        return audio_stream

    def close_stream(audio_stream):
        if audio_stream is None:
            return None
        audio_stream.stop()
        audio_stream.close()
        send("status", message="Wake word paused", listening=False)
        return None

    send("status", message="Model loaded, starting audio stream")

    # Start audio stream
    try:
        stream = open_stream()
    except Exception as e:
        send("error", message=f"Failed to start audio stream: {e}")
        return

    # Main detection loop
    while running:
        if mic_in_use:
            stream = close_stream(stream)
            time.sleep(0.05)
            continue

        if stream is None:
            try:
                stream = open_stream()
            except Exception as e:
                send("error", message=f"Failed to restart audio stream: {e}")
                time.sleep(0.5)
                continue

        try:
            frame, overflow = stream.read(FRAME_SIZE)
        except Exception as e:
            send("error", message=f"Audio read error: {e}")
            continue

        # Predict
        try:
            prediction = model.predict(frame.flatten())
        except Exception as e:
            send("error", message=f"Prediction error: {e}")
            continue

        # Check score for the jarvis model
        # The model key is the basename of the model file without extension
        score = prediction.get("jarvis", 0.0)
        if score > threshold:
            now = time.time()
            if now - last_detect_time > debounce_seconds:
                last_detect_time = now
                send("detected", score=round(float(score), 4))

    # Cleanup
    close_stream(stream)
    send("status", message="Stopped", listening=False)


if __name__ == "__main__":
    main()
