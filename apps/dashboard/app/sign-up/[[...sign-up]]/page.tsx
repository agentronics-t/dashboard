import { SignUp } from "@clerk/nextjs";
import { AuthShell } from "@/components/AuthShell";

// The page is the same for everyone (Clerk renders the form in the browser), so
// it's pre-built and served from Vercel's edge instead of rendered in iad1 on
// every visit. Signed-in visitors never reach it: the middleware redirects them.
export const dynamic = "force-static";

// The stand-in card only belongs on the form itself; Clerk's sub-steps (e.g.
// /sign-up/sso-callback after GitHub or Google) draw something else.
export default async function SignUpPage({ params }: { params: Promise<{ "sign-up"?: string[] }> }) {
  const step = (await params)["sign-up"];
  return (
    <AuthShell variant="sign-up" placeholder={!step?.length}>
      <SignUp signInUrl="/sign-in" fallbackRedirectUrl="/detect" />
    </AuthShell>
  );
}
