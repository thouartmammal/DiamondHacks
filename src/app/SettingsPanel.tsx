import { useState, useEffect } from "react";

interface Props { onClose: () => void; }

async function parseResponseJson<T extends Record<string, unknown>>(res: Response, fallback: T): Promise<T> {
  const text = await res.text();
  if (!text.trim()) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

export function SettingsPanel({ onClose }: Props) {
  const [healthcareEmail, setHealthcareEmail] = useState("");
  const [emailFrom, setEmailFrom] = useState("");
  const [emailPassword, setEmailPassword] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const r = await fetch("/api/settings");
        const d = await parseResponseJson<{ healthcareEmail?: string; emailFrom?: string }>(r, {});
        setHealthcareEmail(d.healthcareEmail || "");
        setEmailFrom(d.emailFrom || "");
      } catch {
        /* ignore */
      }
    })();
  }, []);

  async function sendReport() {
    setSending(true);
    setStatus(null);
    try {
      const res = await fetch("/api/send-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ healthcareEmail, emailFrom, emailPassword }),
      });
      const data = await parseResponseJson<{ error?: string; message?: string }>(res, {});
      if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
      try {
        sessionStorage.setItem(
          "boomer-report-email",
          JSON.stringify({ healthcareEmail, emailFrom, emailPassword }),
        );
      } catch {
        /* private mode */
      }
      setStatus(`✓ ${data.message}`);
    } catch (e: any) {
      setStatus(`✗ ${e.message}`);
    } finally {
      setSending(false);
    }
  }

  const inputStyle: React.CSSProperties = {
    padding: "0.85rem 1rem", borderRadius: "0.75rem",
    border: "2px solid #4a5f4b", backgroundColor: "transparent",
    fontSize: "1rem", color: "#2d3c2e", outline: "none", width: "100%",
  };

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: "rgba(0,0,0,0.6)" }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ backgroundColor: "#e8e6dc", borderRadius: "1.5rem", padding: "2rem", width: "480px", display: "flex", flexDirection: "column", gap: "1.2rem" }}>
        <div className="flex justify-between items-center">
          <h2 style={{ fontSize: "1.5rem", fontWeight: 700, color: "#2d3c2e" }}>settings</h2>
          <button onClick={onClose} style={{ background: "transparent", border: "none", fontSize: "1.5rem", cursor: "pointer", color: "#4a5f4b" }}>✕</button>
        </div>

        <h3 style={{ fontSize: "1.1rem", fontWeight: 600, color: "#4a5f4b", marginBottom: "-0.5rem" }}>health report email</h3>

        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          <input placeholder="your Gmail address (sender)" value={emailFrom}
            onChange={e => setEmailFrom(e.target.value)} style={inputStyle} />
          <input placeholder="Gmail app password" type="password" value={emailPassword}
            onChange={e => setEmailPassword(e.target.value)} style={inputStyle} />
          <input placeholder="healthcare provider email (recipient)" value={healthcareEmail}
            onChange={e => setHealthcareEmail(e.target.value)} style={inputStyle} />
        </div>

        <p style={{ fontSize: "0.85rem", color: "#5a6b5b", lineHeight: 1.5 }}>
          The report includes recent browsing activity and family contacts.
          Turn on{" "}
          <a href="https://myaccount.google.com/signinoptions/two-step-verification" target="_blank" rel="noopener noreferrer" style={{ color: "#4a5f4b" }}>2-Step Verification</a>,{" "}
          then create a Gmail{" "}
          <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noopener noreferrer" style={{ color: "#4a5f4b" }}>App Password</a>{" "}
          (not your normal sign-in password). The sender address must be that same Google account.
        </p>

        <button
          onClick={sendReport}
          disabled={sending || !healthcareEmail || !emailFrom || !emailPassword}
          style={{
            padding: "1rem", borderRadius: "0.75rem", border: "none",
            backgroundColor: "#4a5f4b", color: "#e8e6dc",
            fontSize: "1.1rem", fontWeight: 600, cursor: "pointer",
            opacity: (sending || !healthcareEmail || !emailFrom || !emailPassword) ? 0.5 : 1,
          }}
        >
          {sending ? "sending…" : "send report now"}
        </button>

        {status && (
          <p style={{ fontSize: "1rem", color: status.startsWith("✓") ? "#4a5f4b" : "#c45c4a", fontWeight: 600 }}>
            {status}
          </p>
        )}
      </div>
    </div>
  );
}
