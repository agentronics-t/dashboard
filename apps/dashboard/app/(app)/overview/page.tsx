import { redirect } from "next/navigation";

// Interim: /overview is the post-sign-in landing URL (landing page's
// NEXT_PUBLIC_DASHBOARD_URL). The agent-auth Overview replaces this.
export default function OverviewPage() {
  redirect("/detect");
}
