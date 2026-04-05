import React, { useEffect, useRef, useState } from "react";

export interface CameraModalProps {
  onCapture: (dataUrl: string) => void;
  onClose: () => void;
}

const FONT_UI =
  'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", sans-serif';

export function CameraModal({ onCapture, onClose }: CameraModalProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [videoReady, setVideoReady] = useState(false);

  function stopCamera() {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
  }

  async function startCamera() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (err) {
      const name = err instanceof Error ? err.name : "";
      if (name === "NotAllowedError") {
        setError("Camera permission was denied.");
      } else if (name === "NotFoundError") {
        setError("No camera found on this device.");
      } else {
        setError("Could not access camera.");
      }
    }
  }

  function capture() {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0) return;

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
    stopCamera();
    onCapture(dataUrl);
  }

  useEffect(() => {
    void startCamera();
    return () => {
      stopCamera();
    };
  }, []);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(15,23,42,0.65)",
        fontFamily: FONT_UI,
      }}
    >
      <div
        style={{
          background: "rgba(255,255,255,0.97)",
          borderRadius: "20px",
          padding: "24px",
          boxShadow: "0 24px 64px rgba(15,23,42,0.25)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "16px",
          minWidth: "320px",
          maxWidth: "90vw",
        }}
      >
        <p
          style={{
            margin: 0,
            fontWeight: 700,
            fontSize: "1rem",
            color: "#0f172a",
            letterSpacing: "0.02em",
          }}
        >
          Take Photo
        </p>

        {error ? (
          <>
            <p style={{ margin: 0, color: "#dc2626", fontSize: "0.9rem", textAlign: "center" }}>
              {error}
            </p>
            <button
              type="button"
              onClick={() => { stopCamera(); onClose(); }}
              style={btnStyle("#475569")}
            >
              Close
            </button>
          </>
        ) : (
          <>
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              onLoadedMetadata={() => setVideoReady(true)}
              style={{
                width: "100%",
                maxWidth: "480px",
                borderRadius: "12px",
                background: "#0f172a",
                display: "block",
              }}
            />
            <div style={{ display: "flex", gap: "12px" }}>
              <button
                type="button"
                onClick={capture}
                disabled={!videoReady}
                style={btnStyle("#0d9488", !videoReady)}
              >
                Capture
              </button>
              <button
                type="button"
                onClick={() => { stopCamera(); onClose(); }}
                style={btnStyle("#475569")}
              >
                Cancel
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function btnStyle(bg: string, disabled = false): React.CSSProperties {
  return {
    background: disabled ? "#94a3b8" : bg,
    color: "#fff",
    border: "none",
    borderRadius: "999px",
    padding: "10px 24px",
    fontWeight: 600,
    fontSize: "0.9rem",
    cursor: disabled ? "not-allowed" : "pointer",
    fontFamily: FONT_UI,
    transition: "opacity 0.15s",
    opacity: disabled ? 0.6 : 1,
  };
}
