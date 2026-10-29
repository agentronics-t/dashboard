import { redirect } from "next/navigation";

// Teams were removed: a workspace is one person's. Old links land on Account.
export default function TeamPage() {
  redirect("/account");
}
