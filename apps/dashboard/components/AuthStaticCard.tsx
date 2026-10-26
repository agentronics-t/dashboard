// A static copy of Clerk's sign-in / sign-up card (see AuthShell). It has the
// same text and measurements as the live card, so the swap to Clerk's own card
// is invisible. Styles: .ag-authcard in globals.css.
export type AuthVariant = "sign-in" | "sign-up";

const COPY = {
  "sign-in": {
    title: "Sign in to agentronics",
    subtitle: "Welcome back! Please sign in to continue",
    footer: ["Don’t have an account?", "Sign up"]
  },
  "sign-up": {
    title: "Create your account",
    subtitle: "Welcome! Please fill in the details to get started.",
    footer: ["Already have an account?", "Sign in"]
  }
} as const;

function Field({ label, placeholder, hint, password }: { label: string; placeholder: string; hint?: string; password?: boolean }) {
  return (
    <div className="ag-authcard__field">
      <div className="ag-authcard__label">
        <span>{label}</span>
        {hint && <span className="ag-authcard__hint">{hint}</span>}
      </div>
      <div className="ag-authcard__input">
        {placeholder}
        {password && (
          <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
            <path fill="rgba(11,11,12,.45)" d="M8 3C4.4 3 1.6 5.3.5 8c1.1 2.7 3.9 5 7.5 5s6.4-2.3 7.5-5C14.4 5.3 11.6 3 8 3zm0 8.2A3.2 3.2 0 118 4.8a3.2 3.2 0 010 6.4zM8 6.3a1.7 1.7 0 100 3.4 1.7 1.7 0 000-3.4z" />
          </svg>
        )}
      </div>
    </div>
  );
}

/** Not interactive: it only holds the card's place for the second before Clerk's own card replaces it. */
export function StaticCard({ variant }: { variant: AuthVariant }) {
  const copy = COPY[variant];
  return (
    <div className="ag-authcard" aria-busy="true" aria-label={`Loading ${copy.title.toLowerCase()}`} inert>
      <div className="ag-authcard__main">
        <p className="ag-authcard__title">{copy.title}</p>
        <p className="ag-authcard__sub">{copy.subtitle}</p>
        <div className="ag-authcard__social">
          <span className="ag-authcard__btn">
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
              <path fill="#0b0b0c" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
            </svg>
            GitHub
          </span>
          <span className="ag-authcard__btn">
            <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
              <path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.6-.4-3.9z" />
              <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
              <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
              <path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.6-.4-3.9z" />
            </svg>
            Google
          </span>
        </div>
        <div className="ag-authcard__or">or</div>
        <div className="ag-authcard__fields">
          {variant === "sign-up" && (
            <div className="ag-authcard__row">
              <Field label="First name" hint="Optional" placeholder="First name" />
              <Field label="Last name" hint="Optional" placeholder="Last name" />
            </div>
          )}
          <Field label="Email address" placeholder="Enter your email address" />
          {variant === "sign-up" && <Field label="Password" placeholder="Enter your password" password />}
        </div>
        <div className="ag-authcard__primary">
          Continue <span style={{ fontSize: 9 }}>▶</span>
        </div>
      </div>
      <div className="ag-authcard__footer">
        <div className="ag-authcard__switch">
          {copy.footer[0]} <b>{copy.footer[1]}</b>
        </div>
        <div className="ag-authcard__secured">
          Secured by <b>clerk</b>
        </div>
      </div>
    </div>
  );
}
