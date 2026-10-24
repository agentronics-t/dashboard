import type { Metadata } from "next";
import { Inter, JetBrains_Mono, Space_Grotesk } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import "./globals.css";

const display = Space_Grotesk({ subsets: ["latin"], weight: ["500", "600", "700"], variable: "--font-display", display: "swap" });
const inter = Inter({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-inter", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], weight: ["400", "500", "700"], variable: "--font-jetbrains", display: "swap" });

export const metadata: Metadata = {
  title: "Agentronics Console",
  description: "See and govern the AI agents using your site."
};

const hasClerk = !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

// Clerk's sign-in, user menu and org switcher in Circuit Copper: Copper primary
// with PCB Black text, Bone surfaces, the same fonts.
const CLERK_APPEARANCE = {
  variables: {
    colorPrimary: "#E8763A",
    colorTextOnPrimaryBackground: "#0D1A16",
    colorText: "#0D1A16",
    colorTextSecondary: "#5E6B66",
    colorBackground: "#FBF8F2",
    colorInputBackground: "#FBF8F2",
    colorInputText: "#0D1A16",
    colorSuccess: "#12715F",
    colorDanger: "#B42318",
    borderRadius: "8px",
    fontFamily: "var(--font-inter), sans-serif"
  }
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // Restore persisted theme before paint to avoid a flash.
  const themeScript = `(function(){try{var t=localStorage.getItem('ag-theme');if(t==='dark')document.documentElement.classList.add('dark');}catch(e){}})();`;

  const body = (
    <html lang="en" className={`${display.variable} ${inter.variable} ${mono.variable}`} suppressHydrationWarning>
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
      appearance={CLERK_APPEARANCE}
      signInUrl={process.env.NEXT_PUBLIC_CLERK_SIGN_IN_URL || "/sign-in"}
      signUpUrl={process.env.NEXT_PUBLIC_CLERK_SIGN_UP_URL || "/sign-up"}
    >
      {body}
    </ClerkProvider>
  ) : (
    body
  );
}
