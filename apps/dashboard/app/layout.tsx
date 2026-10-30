import type { Metadata } from "next";
import { Funnel_Display, Funnel_Sans, Martian_Mono } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import { CLERK_JS_VERSION, clerkFrontendApi, clerkScriptUrl } from "@/lib/clerkAssets";
import "./globals.css";

const display = Funnel_Display({ subsets: ["latin"], variable: "--font-display", display: "swap" });
const sans = Funnel_Sans({ subsets: ["latin"], variable: "--font-funnel-sans", display: "swap" });
const mono = Martian_Mono({ subsets: ["latin"], variable: "--font-martian", display: "swap" });

export const metadata: Metadata = {
  title: "Agentronics Console",
  description: "See and govern the AI agents using your site."
};

const hasClerk = !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

// Sign-in also signs new people up (withSignUp), so say so. Keep in step with
// the copy in components/AuthStaticCard.tsx.
// Email codes often land in spam or Promotions (Gmail), so every code screen says where to look.
const CODE_HINT = "Enter the 6-digit code we emailed you. Can’t find it? Check your spam, junk or Promotions folder.";
const CLERK_LOCALIZATION = {
  signIn: {
    start: { titleCombined: "Sign in to agentronics", subtitleCombined: "New here? We’ll create your account." },
    emailCode: { subtitle: CODE_HINT },
    emailCodeMfa: { subtitle: CODE_HINT }
  },
  signUp: { emailCode: { subtitle: CODE_HINT, formSubtitle: CODE_HINT } },
  // Clerk refuses passwords that appear in public breach lists (Have I Been Pwned).
  unstable__errors: {
    form_password_pwned:
      "This password appears in a public list of leaked passwords, so anyone could guess it. Pick one you haven’t used elsewhere, or continue with Google or GitHub.",
    form_password_pwned__sign_in:
      "This password appears in a public list of leaked passwords, so it can’t be used any more. Reset it with “Forgot password”, or continue with Google or GitHub."
  }
};

// Clerk's sign-in, user menu and org switcher in the design system: lime
// primary with ink text, white surfaces, the same fonts.
const CLERK_APPEARANCE = {
  variables: {
    colorPrimary: "#D4FF3A",
    colorTextOnPrimaryBackground: "#0B0B0C",
    colorText: "#0B0B0C",
    colorTextSecondary: "rgba(11,11,12,.65)",
    colorBackground: "#FFFFFF",
    colorInputBackground: "#FFFFFF",
    colorInputText: "#0B0B0C",
    colorSuccess: "#4D6B00",
    colorDanger: "#C2320A",
    borderRadius: "10px",
    fontFamily: "var(--font-funnel-sans), sans-serif"
  },
  // Clerk colours text links with colorPrimary; lime text on white is unreadable.
  elements: {
    cardBox: "ag-clerk-card",
    formButtonPrimary: "ag-clerk-primary",
    footerActionLink: "ag-clerk-link",
    formFieldAction: "ag-clerk-link",
    identityPreviewEditButton: "ag-clerk-link",
    formResendCodeLink: "ag-clerk-link"
  }
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // Restore persisted theme before paint to avoid a flash.
  const themeScript = `(function(){try{var t=localStorage.getItem('ag-theme');if(t==='dark')document.documentElement.classList.add('dark');}catch(e){}})();`;

  const body = (
    <html lang="en" className={`${display.variable} ${sans.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        {/* Clerk's script and API live here; open the connection before React asks for it. */}
        {clerkFrontendApi && <link rel="preconnect" href={clerkFrontendApi} crossOrigin="" />}
        {/* Start downloading Clerk's script while the HTML parses, not after hydration.
            crossOrigin matches the tag Clerk injects, so the preload is reused. */}
        {clerkFrontendApi && (
          <link rel="preload" as="script" crossOrigin="anonymous" href={clerkScriptUrl!} />
        )}
      </head>
      <body>{children}</body>
    </html>
  );

  // sign-in URL is overridable via env so it can point at the landing page
  // once that hosts auth; defaults to the dashboard-hosted /sign-in.
  return hasClerk ? (
    <ClerkProvider
      appearance={CLERK_APPEARANCE}
      localization={CLERK_LOCALIZATION}
      clerkJSVersion={CLERK_JS_VERSION}
      signInUrl={process.env.NEXT_PUBLIC_CLERK_SIGN_IN_URL || "/sign-in"}
      signUpUrl={process.env.NEXT_PUBLIC_CLERK_SIGN_UP_URL || "/sign-up"}
    >
      {body}
    </ClerkProvider>
  ) : (
    body
  );
}
