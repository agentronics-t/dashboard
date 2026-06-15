import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import "./globals.css";

export const metadata: Metadata = {
  title: "Agentronics Console",
  description: "AI-agent traffic intelligence"
};

const hasClerk = !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // Restore persisted theme before paint to avoid a flash.
  const themeScript = `(function(){try{var t=localStorage.getItem('ag-theme');if(t==='dark')document.documentElement.classList.add('dark');}catch(e){}})();`;

  const body = (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>{children}</body>
    </html>
  );

  // sign-in URL is overridable via env so it can point at the landing page
  // once that hosts auth; defaults to the dashboard-hosted /sign-in.
  return hasClerk ? (
    <ClerkProvider
      signInUrl={process.env.NEXT_PUBLIC_CLERK_SIGN_IN_URL || "/sign-in"}
      signUpUrl={process.env.NEXT_PUBLIC_CLERK_SIGN_UP_URL || "/sign-up"}
    >
      {body}
    </ClerkProvider>
  ) : (
    body
  );
}
