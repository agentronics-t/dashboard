"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

// GitHub's install pages open in their own tab so the console stays put. When
// the install finishes, that tab tells this one (BroadcastChannel) to refresh,
// then closes itself.
const CHANNEL = "agentronics-agent-nic";

export function ConnectGitHubButton({ href, children = "Connect GitHub", className = "ag-btn ag-btn-primary" }: { href: string; children?: React.ReactNode; className?: string }) {
  return (
    <a
      className={className}
      href={href}
      target="_blank"
      onClick={(e) => {
        // window.open keeps an opener, so the finished tab may close itself.
        if (window.open(href, "agentronics-github")) e.preventDefault();
      }}
    >
      {children}
    </a>
  );
}

/** Refresh when the GitHub tab reports back, or when the visitor returns to this tab. */
export function RefreshOnGitHubReturn() {
  const router = useRouter();
  useEffect(() => {
    const refresh = () => router.refresh();
    const onVisible = () => document.visibilityState === "visible" && refresh();
    let ch: BroadcastChannel | null = null;
    try {
      ch = new BroadcastChannel(CHANNEL);
      ch.onmessage = (e) => e.data === "github-connected" && refresh();
    } catch {
      // no BroadcastChannel: the visibility refresh still covers it
    }
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      ch?.close();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [router]);
  return null;
}

/** On the page GitHub returns to: tell the console tab, and close this one if we opened it. */
export function GitHubConnectedSignal() {
  useEffect(() => {
    try {
      const ch = new BroadcastChannel(CHANNEL);
      ch.postMessage("github-connected");
      ch.close();
    } catch {
      // ignore
    }
    if (window.opener && window.name === "agentronics-github") setTimeout(() => window.close(), 300);
  }, []);
  return null;
}
