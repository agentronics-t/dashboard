import { SignIn } from "@clerk/nextjs";
import { AuthShell } from "@/components/AuthShell";

export default function SignInPage() {
  return (
    <AuthShell>
      <SignIn signUpUrl="/sign-up" fallbackRedirectUrl="/detect" />
    </AuthShell>
  );
}
