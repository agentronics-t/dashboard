"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const NAV = [
  { href: "/overview", label: "Overview", icon: "grid" },
  { href: "/forecast", label: "Forecast", icon: "trend" },
  { href: "/insights", label: "Insights", icon: "spark" },
  { href: "/activity", label: "Activity", icon: "pulse" },
  { href: "/chat", label: "Agent Chat", icon: "chat" }
];
const BOTTOM = [
  { href: "/settings", label: "Settings", icon: "gear" },
  { href: "/account", label: "Account", icon: "user" }
];

const ICONS: Record<string, React.ReactElement> = {
  grid: <path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z" />,
  trend: <path d="M3 17l5-5 4 3 8-9" />,
  spark: <path d="M12 3l2.2 6.3L20 11l-5.8 1.7L12 19l-2.2-6.3L4 11l5.8-1.7z" />,
  pulse: <path d="M3 12h4l3 8 4-16 3 8h4" />,
  chat: <path d="M4 5h16v11H8l-4 4z" />,
  gear: <path d="M12 9a3 3 0 100 6 3 3 0 000-6zM4 12h2M18 12h2M12 4v2M12 18v2" />,
  user: <path d="M12 12a4 4 0 100-8 4 4 0 000 8zM5 21a7 7 0 0114 0" />,
  chevron: <path d="M15 6l-6 6 6 6" />,
  sun: <path d="M12 8a4 4 0 100 8 4 4 0 000-8zM12 2v2M12 20v2M4 12H2M22 12h-2M5 5l1.5 1.5M19 19l-1.5-1.5M5 19l1.5-1.5M19 5l-1.5 1.5" />,
  moon: <path d="M20 14A8 8 0 119 3a6 6 0 0011 11z" />
};

function Icon({ name, style }: { name: string; style?: React.CSSProperties }) {
  return (
    <svg viewBox="0 0 24 24" width={19} height={19} fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" style={{ flex: "none", ...style }}>
      {ICONS[name]}
    </svg>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(true);
  const [dark, setDark] = useState(false);

  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
  }, []);

  const toggleTheme = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("ag-theme", next ? "dark" : "light");
    } catch {}
  };

  const labelStyle: React.CSSProperties = {
    whiteSpace: "nowrap",
    opacity: open ? 1 : 0,
    transition: "opacity .15s",
    overflow: "hidden"
  };

  const NavBtn = ({ href, label, icon }: { href: string; label: string; icon: string }) => (
    <Link href={href} className="ag-nav-btn" data-active={pathname.startsWith(href)} title={label} style={{ justifyContent: open ? "flex-start" : "center" }}>
      <Icon name={icon} />
      <span style={labelStyle}>{label}</span>
    </Link>
  );

  return (
    <aside
      style={{
        width: open ? 244 : 68,
        flex: "none",
        background: "var(--surface)",
        borderRight: "1px solid var(--border)",
        padding: 14,
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        position: "sticky",
        top: 0,
        transition: "width .2s var(--ease-out)"
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 11, padding: "6px 8px 2px", minHeight: 40 }}>
        <div style={{ width: 38, height: 38, borderRadius: 10, background: "var(--brand-solid)", display: "grid", placeItems: "center", boxShadow: "var(--shadow-glow)", flex: "none" }}>
          <svg viewBox="0 0 24 24" width={20} height={20}>
            <rect x={8} y={3.5} width={8} height={7.5} rx={1.4} fill="var(--accent)" />
            <rect x={8} y={13} width={8} height={7.5} rx={1.4} fill="var(--accent)" />
          </svg>
        </div>
        {open && (
          <div>
            <div style={{ fontWeight: 700, fontSize: 16, letterSpacing: "-0.01em", lineHeight: 1.1 }}>Agentronics</div>
            <div style={{ fontSize: 11, color: "var(--content-muted)", letterSpacing: "0.04em", textTransform: "uppercase", fontWeight: 600 }}>Intelligence</div>
          </div>
        )}
      </div>

      <nav style={{ display: "flex", flexDirection: "column", gap: 2, marginTop: 26, flex: 1, minHeight: 0, overflowY: "auto" }}>
        {open && <div style={sectionLabel}>Intelligence</div>}
        {NAV.map((n) => <NavBtn key={n.href} {...n} />)}
      </nav>

      <div style={{ borderTop: "1px solid var(--border)", paddingTop: 10, marginTop: 8, display: "flex", flexDirection: "column", gap: 2 }}>
        <button className="ag-nav-btn" onClick={() => setOpen((o) => !o)} style={{ justifyContent: open ? "flex-start" : "center" }} title="Collapse sidebar">
          <Icon name="chevron" style={{ transform: open ? "none" : "rotate(180deg)" }} />
          <span style={labelStyle}>Collapse</span>
        </button>
        {BOTTOM.map((n) => <NavBtn key={n.href} {...n} />)}
        <button className="ag-nav-btn" onClick={toggleTheme} style={{ justifyContent: open ? "flex-start" : "center" }} title="Toggle theme">
          <Icon name={dark ? "sun" : "moon"} />
          <span style={labelStyle}>{dark ? "Light mode" : "Dark mode"}</span>
        </button>
      </div>
    </aside>
  );
}

const sectionLabel: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "var(--content-muted)",
  padding: "8px 11px 4px"
};
