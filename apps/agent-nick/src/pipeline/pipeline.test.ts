import assert from "node:assert/strict";
import { generateKeyPairSync, createVerify, createHmac } from "node:crypto";
import { describe, it } from "node:test";
import { appJwt, verifyWebhookSignature, type GitHub, type TreeEntry } from "../github/client.ts";
import { generateCode } from "./codegen.ts";
import { digestPages } from "./extract.ts";
import { detectFramework, discoverPages } from "./framework.ts";
import { checkHandler } from "./handlers.ts";
import { normalize } from "./propose.ts";
import { RepoReader } from "./repo.ts";
import { normaliseUrl, planSiteFiles, writeSiteFiles } from "./sitefiles.ts";
import type { Llm } from "../llm/gemini.ts";
import type { PageDigest, ToolProposal } from "./types.ts";
import { validateChanges } from "./validate.ts";

// A small Next.js App Router site with the shapes Agent Nick has to handle.
const FILES: Record<string, string> = {
  "package.json": JSON.stringify({ dependencies: { next: "15.0.0", react: "19.0.0", "react-dom": "19.0.0" } }),
  "tsconfig.json": `{
    // comments are allowed here
    "compilerOptions": { "baseUrl": ".", "paths": { "@/*": ["./*"] }, },
  }`,
  "app/layout.tsx": `import { Header } from "@/components/Header";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Header />
        {children}
      </body>
    </html>
  );
}
`,
  "app/page.tsx": `export default function Home() {
  return (
    <main>
      <h1>Trail Shop</h1>
      <form action="/search" method="get">
        <label htmlFor="q">Search products</label>
        <input id="q" name="q" type="search" required />
        <button type="submit">Search</button>
      </form>
    </main>
  );
}
`,
  "app/contact/page.tsx": `import { ContactForm } from "@/components/ContactForm";
export default function Contact() {
  return <ContactForm />;
}
`,
  "components/ContactForm.tsx": `"use client";
import { useState } from "react";
export function ContactForm() {
  const [email, setEmail] = useState("");
  async function send(e: React.FormEvent) {
    e.preventDefault();
    await fetch("/api/contact", { method: "POST", body: JSON.stringify({ email }) });
  }
  return (
    <form onSubmit={send}>
      <input value={email} onChange={(e) => setEmail(e.target.value)} aria-label="Email" />
      <button>Send</button>
    </form>
  );
}
`,
  "app/products/[id]/page.tsx": `import { addToCart } from "@/app/actions";
import { CartButton } from "@/components/CartButton";
export default function Product() {
  return <div><h1>Boots</h1><CartButton /></div>;
}
`,
  "components/CartButton.tsx": `"use client";
export function CartButton() {
  return <button onClick={() => alert("added")}>Add to cart</button>;
}
`,
  "app/actions.ts": `"use server";
export async function addToCart(productId: string, quantity: number) {
  return { ok: true, productId, quantity };
}
`,
  "app/login/page.tsx": `export default function Login() {
  return (
    <form action="/api/login" method="post">
      <input name="email" type="email" />
      <input name="password" type="password" />
      <button>Sign in</button>
    </form>
  );
}
`,
  "components/Header.tsx": `import { subscribe } from "@/app/actions";
export function Header() {
  return (
    <header>
      <form action={subscribe}>
        <input name="email" type="email" required placeholder="you@example.com" />
        <button>Subscribe</button>
      </form>
    </header>
  );
}
`
};

function fakeRepo(files: Record<string, string> = FILES): RepoReader {
  const entries: TreeEntry[] = Object.entries(files).map(([path, text]) => ({ path, type: "blob", sha: path, size: text.length, mode: "100644" }));
  const gh = { blobText: async (_repo: string, sha: string) => files[sha] ?? "" } as unknown as GitHub;
  return new RepoReader(gh, "acme/shop", entries);
}

async function scan() {
  const reader = fakeRepo();
  const fw = await detectFramework(reader);
  const pages = discoverPages(reader, fw);
  const digests = await digestPages(reader, fw, pages);
  return { reader, fw, pages, digests };
}

const byRoute = (digests: PageDigest[], route: string) => {
  const d = digests.find((x) => x.route === route);
  assert.ok(d, `digest for ${route}`);
  return d;
};

describe("framework + pages", () => {
  it("detects a Next.js App Router app with tsconfig aliases", async () => {
    const { fw, pages } = await scan();
    assert.equal(fw.kind, "next-app");
    assert.equal(fw.appDir, "app");
    assert.equal(fw.supported, true);
    assert.equal(fw.typescript, true);
    assert.equal(fw.aliases["@/"], "");
    assert.deepEqual(pages.map((p) => p.route).sort(), ["/", "/contact", "/login", "/products/[id]"]);
  });

  it("reports unsupported frameworks instead of guessing", async () => {
    const reader = fakeRepo({ "package.json": JSON.stringify({ dependencies: { "@sveltejs/kit": "2" } }), "src/routes/+page.svelte": "<h1/>" });
    const fw = await detectFramework(reader);
    assert.equal(fw.kind, "sveltekit");
    assert.equal(fw.supported, false);
  });
});

describe("action extraction", () => {
  it("digests forms, calls, server actions and site-wide components", async () => {
    const { digests } = await scan();
    const home = byRoute(digests, "/");
    assert.equal(home.title, "Trail Shop");
    assert.equal(home.forms[0]?.declarativeReady, true);
    assert.equal(home.forms[0]?.fields[0]?.label, "Search products");

    const contact = byRoute(digests, "/contact");
    assert.equal(contact.forms[0]?.declarativeReady, false, "controlled React form is not declarative-ready");
    assert.equal(contact.calls[0]?.method, "POST");
    assert.equal(contact.calls[0]?.url, "/api/contact");

    const product = byRoute(digests, "/products/[id]");
    assert.equal(product.buttons[0]?.text, "Add to cart");
    assert.deepEqual(product.serverActions.map((s) => s.name).sort(), ["addToCart"]);

    const site = byRoute(digests, "*");
    assert.equal(site.forms[0]?.action, "subscribe");
    assert.equal(site.forms[0]?.declarativeReady, true);
  });
});

describe("proposal rules", () => {
  it("keeps tools tied to real code and enforces kind, risk and auth", async () => {
    const { digests } = await scan();
    const home = byRoute(digests, "/");
    const contact = byRoute(digests, "/contact");
    const login = byRoute(digests, "/login");
    const product = byRoute(digests, "/products/[id]");
    const base = { inputSchemaJson: '{"type":"object","properties":{}}', rationale: "r" };
    const tools = normalize(
      [
        { ...base, page: "/", sourceId: home.forms[0]!.id, name: "Search Products", kind: "form", strategy: "form", description: "Search the catalog.", risk: "read" },
        { ...base, page: "/contact", sourceId: contact.forms[0]!.id, name: "contactUs", kind: "form", strategy: "form", description: "Send a message.", risk: "destructive" },
        { ...base, page: "/login", sourceId: login.forms[0]!.id, name: "sign_in", kind: "form", strategy: "form", description: "Sign in.", risk: "write" },
        { ...base, page: "/products/[id]", sourceId: product.serverActions[0]!.id, name: "add_to_cart", kind: "script", strategy: "server_action", description: "Add a product to the cart.", risk: "write" },
        { ...base, page: "/", sourceId: "f999", name: "ghost", kind: "script", strategy: "dom", description: "Not real.", risk: "read" },
        { ...base, page: "/", sourceId: home.forms[0]!.id, name: "dup", kind: "form", strategy: "form", description: "Duplicate source.", risk: "read" }
      ],
      digests
    );
    assert.deepEqual(tools.map((t) => t.name), ["search_products", "contact_us", "add_to_cart"]);
    const [search, contactTool, cart] = tools as [ToolProposal, ToolProposal, ToolProposal];
    assert.equal(search.kind, "form");
    assert.equal(search.readOnly, true);
    assert.equal(search.auth, "public");
    assert.deepEqual(search.inputSchema.required, ["q"]);
    assert.equal(contactTool.kind, "script", "non-declarative form falls back to a script tool");
    assert.equal(contactTool.strategy, "dom");
    assert.equal(contactTool.consequential, true);
    assert.equal(contactTool.auth, "scoped");
    assert.equal(cart.strategy, "server_action");
    assert.equal(cart.auth, "signed_in");
  });
});

describe("codegen + validation", () => {
  it("writes anchors, one imperative tools module and a layout mount that all parse", async () => {
    const { reader, fw, digests } = await scan();
    const home = byRoute(digests, "/");
    const contact = byRoute(digests, "/contact");
    const product = byRoute(digests, "/products/[id]");
    const tool = (t: Partial<ToolProposal> & Pick<ToolProposal, "name" | "page" | "sourceId" | "kind" | "strategy">): ToolProposal => ({
      description: "Does a thing.",
      inputSchema: { type: "object", properties: {} },
      risk: "read",
      readOnly: true,
      consequential: false,
      auth: "public",
      rationale: "",
      ...t
    });
    const tools = [
      tool({ name: "search_products", page: "/", sourceId: home.forms[0]!.id, kind: "form", strategy: "form", fieldDescriptions: { q: "Words to search for, e.g. hiking boots" } }),
      tool({ name: "contact_us", page: "/contact", sourceId: contact.forms[0]!.id, kind: "script", strategy: "dom", readOnly: false, risk: "write" }),
      tool({ name: "add_to_cart", page: "/products/[id]", sourceId: product.serverActions[0]!.id, kind: "script", strategy: "server_action", readOnly: false, risk: "write" })
    ];
    const handlers = { add_to_cart: { body: `const id = input.productId;\nif (typeof id !== "string") return { error: "Pass productId." };\nreturn await addToCart(id, Number(input.quantity ?? 1));` } };
    const out = await generateCode({ reader, fw, digests, tools, handlers });

    const get = (p: string) => out.changes.find((c) => c.path === p)?.content ?? "";
    // The declarative API left the WebMCP spec: forms get an anchor and an imperative tool.
    assert.match(get("app/page.tsx"), /<form data-agent-tool="search_products" action="\/search"/);
    assert.doesNotMatch(get("app/page.tsx"), /toolname|toolparamdescription/);
    assert.match(get("components/ContactForm.tsx"), /<form data-agent-tool="contact_us" onSubmit/);
    const mod = get("agentronics/webmcp-tools.ts");
    assert.match(mod, /import \{ addToCart \} from "\.\.\/app\/actions";/);
    assert.match(mod, /registerTool\(tool, \{ signal \}\)/);
    assert.match(mod, /name: "search_products",\n\s+title: "Search products",/);
    assert.match(mod, /return fillAndAct\("search_products", "\/", input, signal\);/);
    assert.match(mod, /export function registerAgentronicsTools\(pathname: string, signal: AbortSignal, client\?: AgentronicsClientLike\)/);
    assert.match(mod, /"\^\/products\/\[\^\/\]\+\/\?\$"/);
    assert.match(get("app/layout.tsx"), /import \{ AgentronicsWebMcp \} from "\.\.\/agentronics\/AgentronicsWebMcp";/);
    assert.match(get("app/layout.tsx"), /\{children\}\n\s+<AgentronicsWebMcp \/>/);
    assert.ok(out.changes.some((c) => c.path === "agentronics/AgentronicsWebMcp.tsx"));
    assert.deepEqual(validateChanges(out.changes), []);
    assert.deepEqual(out.manualSteps, []);
  });

  it("flags broken files", () => {
    const issues = validateChanges([{ path: "a.tsx", content: "export const x = <div>;", before: null, reason: "" }]);
    assert.equal(issues.length, 1);
  });
});

describe("handler checks", () => {
  const t = { strategy: "fetch" } as ToolProposal;
  it("accepts a correct fetch body", () => {
    assert.deepEqual(checkHandler(t, `const r = await fetch("/api/x", { signal });\nreturn await r.json();`), []);
  });
  it("rejects throws, missing signal and removed APIs", () => {
    const issues = checkHandler(t, `const r = await fetch("/api/x");\nif (!r.ok) throw new Error("bad");\nnavigator.modelContext;\nreturn r;`);
    assert.ok(issues.includes("fetch() must pass `signal`"));
    assert.ok(issues.includes("throws instead of returning an error value"));
    assert.ok(issues.includes("uses a removed WebMCP API"));
  });
  it("allows re-throwing on abort", () => {
    assert.deepEqual(checkHandler(t, `try { const r = await fetch("/a", { signal }); return r.status; } catch (e) { if (signal?.aborted) throw e; return { error: String(e) }; }`), []);
  });
});

describe("github auth helpers", () => {
  it("signs app JWTs with RS256", () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const jwt = appJwt("123", privateKey.export({ type: "pkcs1", format: "pem" }).toString(), 1_000_000);
    const [h, p, s] = jwt.split(".") as [string, string, string];
    assert.deepEqual(JSON.parse(Buffer.from(p, "base64url").toString()), { iat: 999_940, exp: 1_000_540, iss: "123" });
    const v = createVerify("RSA-SHA256");
    v.update(`${h}.${p}`);
    assert.ok(v.verify(publicKey, Buffer.from(s, "base64url")));
  });
  it("verifies webhook signatures in constant time", () => {
    const body = '{"a":1}';
    const sig = `sha256=${createHmac("sha256", "s3cret").update(body).digest("hex")}`;
    assert.equal(verifyWebhookSignature("s3cret", body, sig), true);
    assert.equal(verifyWebhookSignature("s3cret", `${body} `, sig), false);
    assert.equal(verifyWebhookSignature("s3cret", body, undefined), false);
  });
});

describe("site files (llms.txt, sitemap, structured data)", () => {
  const draft = {
    name: "Trail Shop",
    summary: "Outdoor gear for hikers.",
    sections: [{ title: "Shop", links: [{ path: "/", label: "Home", note: "Search the catalogue" }, { path: "/made-up", label: "Ghost", note: "" }] }]
  };
  const fakeLlm = { usage: { tokensIn: 0, tokensOut: 0, costUsd: 0 }, json: async <T,>(call: { parse: (v: unknown) => T }) => call.parse(draft) } as unknown as Llm;

  it("finds what's missing, drafts it, and writes it on top of the tool changes", async () => {
    const files = { ...FILES, "README.md": "# Trail Shop\nGear for hikers.", "public/robots.txt": "User-agent: *\nAllow: /\n" };
    const reader = fakeRepo(files);
    const fw = await detectFramework(reader);
    const pages = discoverPages(reader, fw);
    const digests = await digestPages(reader, fw, pages);
    const plan = await planSiteFiles({ reader, fw, pages, digests, llm: fakeLlm, repoFullName: "acme/shop", githubHomepage: "shop.example.com" });

    assert.equal(plan.facts.url, "https://shop.example.com");
    assert.deepEqual(plan.fixes.map((f) => f.kind), ["llms-txt", "sitemap", "structured-data"]);
    assert.deepEqual(plan.routes, ["/", "/contact"]); // no /products/[id], no /login
    assert.ok(!plan.llms?.sections[0]?.links.some((l) => l.path === "/made-up"), "drops links to pages that don't exist");

    // Same layout edited by both the WebMCP mount and the structured data → one change.
    const home = byRoute(digests, "/");
    const tools: ToolProposal[] = [
      { name: "search_products", page: "/", sourceId: home.forms[0]!.id, kind: "form", strategy: "form", description: "Search.", inputSchema: { type: "object", properties: {} }, risk: "read", readOnly: true, consequential: false, auth: "public", rationale: "" }
    ];
    const out = await generateCode({ reader, fw, digests, tools, handlers: {} });
    await writeSiteFiles({ result: out, reader, fw, plan, kinds: ["llms-txt", "sitemap", "structured-data"], url: null });

    const get = (p: string) => out.changes.find((c) => c.path === p)?.content ?? "";
    assert.equal(out.changes.filter((c) => c.path === "app/layout.tsx").length, 1);
    assert.match(get("app/layout.tsx"), /<AgentronicsWebMcp \/>/);
    assert.match(get("app/layout.tsx"), /import \{ AgentronicsStructuredData \} from "\.\.\/agentronics\/AgentronicsStructuredData";/);
    assert.match(get("app/layout.tsx"), /\{children\}\n\s+<AgentronicsStructuredData \/>/);
    assert.match(get("agentronics/AgentronicsStructuredData.tsx"), /"@type": "Organization"/);
    assert.match(get("app/sitemap.ts"), /const ROUTES = \["\/","\/contact"\];/);
    assert.match(get("public/llms.txt"), /^# Trail Shop\n\n> Outdoor gear for hikers\.\n\n## Shop\n\n- \[Home\]\(https:\/\/shop\.example\.com\/\): Search the catalogue\n$/);
    assert.match(get("public/robots.txt"), /Sitemap: https:\/\/shop\.example\.com\/sitemap\.xml\n$/);
    assert.deepEqual(validateChanges(out.changes), []);
  });

  it("skips what the repo already has", async () => {
    const files = {
      ...FILES,
      "public/llms.txt": "# Shop\n",
      "app/sitemap.ts": "export default function sitemap() { return []; }",
      "app/layout.tsx": FILES["app/layout.tsx"]!.replace("<body>", '<body><script type="application/ld+json">{}</script>')
    };
    const reader = fakeRepo(files);
    const fw = await detectFramework(reader);
    const pages = discoverPages(reader, fw);
    const plan = await planSiteFiles({ reader, fw, pages, digests: [], llm: null, repoFullName: "acme/shop", githubHomepage: null });
    assert.deepEqual(plan.fixes, []);
    assert.deepEqual(plan.present.sort(), ["llms-txt", "sitemap", "structured-data"]);
  });

  it("writes static files and head JSON-LD for a plain HTML site", async () => {
    const files = {
      "index.html": "<!doctype html>\n<html>\n  <head>\n    <title>Bakery</title>\n  </head>\n  <body><h1>Bakery</h1></body>\n</html>\n",
      "about.html": "<html><head><title>About</title></head><body><h1>About us</h1></body></html>",
      CNAME: "bakery.example.org\n"
    };
    const reader = fakeRepo(files);
    const fw = await detectFramework(reader);
    const pages = discoverPages(reader, fw);
    const plan = await planSiteFiles({ reader, fw, pages, digests: [], llm: null, repoFullName: "acme/bakery", githubHomepage: null });
    assert.equal(plan.facts.url, "https://bakery.example.org");
    const out = { changes: [], toolFiles: {}, manualSteps: [], skipped: [] } as Parameters<typeof writeSiteFiles>[0]["result"];
    await writeSiteFiles({ result: out, reader, fw, plan, kinds: ["llms-txt", "sitemap", "structured-data"], url: null });
    const get = (p: string) => out.changes.find((c) => c.path === p)?.content ?? "";
    assert.match(get("sitemap.xml"), /<loc>https:\/\/bakery\.example\.org\/about<\/loc>/);
    assert.match(get("index.html"), /<script type="application\/ld\+json">[\s\S]*"WebSite"[\s\S]*<\/script>\n {2}<\/head>/);
    assert.ok(get("llms.txt").startsWith("# "));
    assert.deepEqual(validateChanges(out.changes), []);
  });

  it("mounts structured data in _app on the Pages Router", async () => {
    const files = {
      "package.json": JSON.stringify({ name: "pages-site", dependencies: { next: "14.0.0", react: "18.0.0" } }),
      "pages/index.tsx": "export default function Home() { return <h1>Home</h1>; }",
      "pages/_app.tsx": 'import type { AppProps } from "next/app";\nexport default function App({ Component, pageProps }: AppProps) {\n  return <Component {...pageProps} />;\n}\n'
    };
    const reader = fakeRepo(files);
    const fw = await detectFramework(reader);
    const pages = discoverPages(reader, fw);
    const plan = await planSiteFiles({ reader, fw, pages, digests: [], llm: null, repoFullName: "acme/pages-site", githubHomepage: "https://pages.example.com" });
    const out = { changes: [], toolFiles: {}, manualSteps: [], skipped: [] } as Parameters<typeof writeSiteFiles>[0]["result"];
    await writeSiteFiles({ result: out, reader, fw, plan, kinds: ["structured-data", "sitemap"], url: null });
    const get = (p: string) => out.changes.find((c) => c.path === p)?.content ?? "";
    assert.match(get("pages/_app.tsx"), /<Component \{\.\.\.pageProps\} \/>\n\s+<AgentronicsStructuredData \/>/);
    assert.match(get("agentronics/AgentronicsStructuredData.jsx"), /import Head from "next\/head";/); // no tsconfig → JavaScript
    assert.match(get("public/sitemap.xml"), /<loc>https:\/\/pages\.example\.com\/<\/loc>/);
    assert.deepEqual(validateChanges(out.changes), []);
  });

  it("normalises addresses and refuses local ones", () => {
    assert.equal(normaliseUrl("shop.example.com/"), "https://shop.example.com");
    assert.equal(normaliseUrl("http://localhost:3000"), null);
    assert.equal(normaliseUrl("not a url"), null);
  });
});

describe("Pages Router mount", () => {
  it("wraps a bare `return <Component />` in a fragment instead of breaking the JSX", async () => {
    const files = {
      "package.json": JSON.stringify({ dependencies: { next: "14.0.0", react: "18.0.0" } }),
      "tsconfig.json": "{}",
      "pages/index.tsx": 'export default function Home() {\n  return (\n    <form action="/search">\n      <input name="q" aria-label="Search" />\n      <button>Go</button>\n    </form>\n  );\n}\n',
      "pages/_app.tsx": 'import type { AppProps } from "next/app";\nexport default function App({ Component, pageProps }: AppProps) {\n  return <Component {...pageProps} />;\n}\n'
    };
    const reader = fakeRepo(files);
    const fw = await detectFramework(reader);
    const digests = await digestPages(reader, fw, discoverPages(reader, fw));
    const home = byRoute(digests, "/");
    const tools: ToolProposal[] = [
      { name: "search", page: "/", sourceId: home.forms[0]!.id, kind: "form", strategy: "form", description: "Search.", inputSchema: { type: "object", properties: {} }, risk: "read", readOnly: true, consequential: false, auth: "public", rationale: "" }
    ];
    const out = await generateCode({ reader, fw, digests, tools, handlers: {} });
    const app = out.changes.find((c) => c.path === "pages/_app.tsx")?.content ?? "";
    assert.match(app, /return <>\n\s+<Component \{\.\.\.pageProps\} \/>\n\s+<AgentronicsWebMcp \/>\n\s+<\/>;/);
    assert.deepEqual(validateChanges(out.changes), []);
  });
});
