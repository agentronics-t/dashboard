import { SignIn } from "@clerk/nextjs";
import { AuthShell } from "@/components/AuthShell";

// The page is the same for everyone (Clerk renders the form in the browser), so
// it's pre-built and served from Vercel's edge instead of rendered in iad1 on
// every visit. Signed-in visitors never reach it: the middleware redirects them.
export const dynamic = "force-static";

// The stand-in card only belongs on the form itself; Clerk's sub-steps (e.g.
// /sign-in/sso-callback after GitHub or Google) draw something else.
export default async function SignInPage({ params }: { params: Promise<{ "sign-in"?: string[] }> }) {
  const step = (await params)["sign-in"];
  return (
    <AuthShell variant="sign-in" placeholder={!step?.length}>
      <SignIn signUpUrl="/sign-up" fallbackRedirectUrl="/detect" />
    </AuthShell>
  );
}
