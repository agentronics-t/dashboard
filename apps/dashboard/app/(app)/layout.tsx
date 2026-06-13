import { Sidebar } from "@/components/Sidebar";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>
      <Sidebar />
      <main style={{ flex: 1, minWidth: 0, padding: "30px 34px", maxWidth: 1240, margin: "0 auto", width: "100%" }}>
        {children}
      </main>
    </div>
  );
}
