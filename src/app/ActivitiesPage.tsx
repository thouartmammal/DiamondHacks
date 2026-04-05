interface Props {
  onBack: () => void;
}

export function ActivitiesPage({ onBack }: Props) {
  return (
    <div className="size-full flex flex-col" style={{ backgroundColor: "#f0f7ff" }}>
      {/* Back button */}
      <div className="p-8">
        <button
          onClick={onBack}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            background: "transparent",
            border: "none",
            color: "#2563eb",
            fontSize: "1.1rem",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          ← back
        </button>
      </div>

      {/* Buttons */}
      <div className="flex flex-col gap-6 px-12 flex-1 justify-center" style={{ maxWidth: "800px", margin: "0 auto", width: "100%" }}>
        {/* Digital activities */}
        <button
          style={{
            width: "100%",
            padding: "2.5rem 3rem",
            borderRadius: "9999px",
            border: "none",
            backgroundImage: "linear-gradient(to right, #93c5fd, #2563eb)",
            cursor: "pointer",
            textAlign: "left",
            fontSize: "1.4rem",
            color: "#1e3a5f",
          }}
        >
          click here to see your{" "}
          <span style={{ color: "#f8fbff", fontWeight: 700 }}>digital activities</span>
        </button>
      </div>
    </div>
  );
}
