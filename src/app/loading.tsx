export default function Loading() {
  return (
    <div style={{ minHeight: "100vh", background: "var(--c0)", fontFamily: "var(--font)" }}>
      <header style={{ borderBottom: "1px solid var(--cb)", background: "var(--c1)", padding: "12px 24px" }}>
        <div style={{ maxWidth: "960px", margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
            <div style={{ width: "28px", height: "28px", borderRadius: "8px", background: "var(--c3)" }} className="er-pulse" />
            <div style={{ width: "96px", height: "14px", borderRadius: "6px", background: "var(--c3)" }} className="er-pulse" />
          </div>
          <div style={{ width: "120px", height: "30px", borderRadius: "10px", background: "var(--c3)" }} className="er-pulse" />
        </div>
      </header>
      <main style={{ maxWidth: "960px", margin: "0 auto", padding: "40px 24px" }}>
        <div style={{ marginBottom: "28px", display: "flex", flexDirection: "column", gap: "8px" }}>
          <div style={{ width: "120px", height: "18px", borderRadius: "6px", background: "var(--c3)" }} className="er-pulse" />
          <div style={{ width: "200px", height: "12px", borderRadius: "6px", background: "var(--c2)" }} className="er-pulse" />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "16px" }}>
          {[0,1,2].map((i) => (
            <div key={i} style={{ background: "var(--c1)", border: "1px solid var(--cb)", borderRadius: "16px", padding: "16px", display: "flex", flexDirection: "column", gap: "12px", animationDelay: `${i*80}ms` }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: "8px" }}>
                <div style={{ width: "140px", height: "14px", borderRadius: "6px", background: "var(--c3)" }} className="er-pulse" />
                <div style={{ width: "40px", height: "14px", borderRadius: "6px", background: "var(--c2)" }} className="er-pulse" />
              </div>
              <div style={{ width: "100px", height: "10px", borderRadius: "6px", background: "var(--c2)" }} className="er-pulse" />
              <div style={{ width: "120px", height: "10px", borderRadius: "6px", background: "var(--c2)" }} className="er-pulse" />
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
