import { PersonalWorkspace } from "@/components/PersonalWorkspace";
import { Sidebar } from "@/components/Sidebar";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>
      <PersonalWorkspace />
      <Sidebar />
      <main style={{ flex: 1, minWidth: 0, padding: "clamp(16px, 4vw, 30px) clamp(16px, 4vw, 34px)", maxWidth: 1240, margin: "0 auto", width: "100%" }}>
        {children}
      </main>
    </div>
  );
}
