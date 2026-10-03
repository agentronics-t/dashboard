import { SignUp } from "@clerk/nextjs";

export default function SignUpPage() {
  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "var(--canvas)" }}>
      <SignUp signInUrl="/sign-in" fallbackRedirectUrl="/overview" />
    </div>
  );
}
