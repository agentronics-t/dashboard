"use client";

import { ErrorScreen } from "@/components/ErrorScreen";

// Last resort, when the root layout itself fails: its own <html> and <body>.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", background: "#f4f4f2" }}>
        <ErrorScreen error={error} reset={reset} />
      </body>
    </html>
  );
}
