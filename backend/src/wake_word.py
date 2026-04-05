"""
Wake word listener using PyAudio + Google Speech Recognition (Python 3.12).
Listens for "hi boomer" / "hey boomer" and POSTs to the backend.
"""
import time
import requests
import speech_recognition as sr

BACKEND = "http://127.0.0.1:3001"
WAKE_PHRASES = ["hi boomer", "hey boomer", "hi boomers", "hey boomers", "hi booma", "hey booma", "high boomer", "hi boom"]

recognizer = sr.Recognizer()
recognizer.energy_threshold = 150        # lower = more sensitive (default 300)
recognizer.dynamic_energy_threshold = False  # disable auto-adjust so it stays sensitive
recognizer.pause_threshold = 0.5        # shorter pause before considering speech done
recognizer.phrase_threshold = 0.1       # lower = picks up quieter phrases

def listen_loop():
    print("[wake] Starting wake word listener...", flush=True)
    while True:
        try:
            with sr.Microphone() as source:
                audio = recognizer.listen(source, timeout=10, phrase_time_limit=5)
            try:
                text = recognizer.recognize_google(audio).lower()
                print(f"[wake] Heard: {text}", flush=True)
                if any(phrase in text for phrase in WAKE_PHRASES):
                    print("[wake] Wake word detected!", flush=True)
                    try:
                        requests.post(f"{BACKEND}/wake-word", timeout=2)
                    except Exception:
                        pass
            except sr.UnknownValueError:
                pass
            except sr.RequestError as e:
                print(f"[wake] Speech API error: {e}", flush=True)
                time.sleep(2)
        except sr.WaitTimeoutError:
            pass
        except Exception as e:
            print(f"[wake] Error: {e}", flush=True)
            time.sleep(1)

if __name__ == "__main__":
    listen_loop()
