import { SignIn } from "@clerk/nextjs";
import { AuthShell } from "@/components/AuthShell";

// The page is the same for everyone (Clerk renders the form in the browser), so
// it's pre-built and served from Vercel's edge instead of rendered in iad1 on
// every visit. Signed-in visitors never reach it: the middleware redirects them.
export const dynamic = "force-static";

export default function SignInPage() {
  return (
    <AuthShell variant="sign-in">
      {/* withSignUp: an email or Google/GitHub account we don't know yet creates the
          account right here instead of "Couldn't find your account". */}
      <SignIn routing="path" path="/sign-in" withSignUp signUpUrl="/sign-up" fallbackRedirectUrl="/agent-nic" signUpFallbackRedirectUrl="/agent-nic" />
    </AuthShell>
  );
}
