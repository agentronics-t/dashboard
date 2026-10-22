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
  it("writes declarative attributes, a tools module and a layout mount that all parse", async () => {
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
    assert.match(get("app/page.tsx"), /<form \{\.\.\.\{ toolname: "search_products", tooldescription: "Does a thing\.", toolautosubmit: "" \}\} action="\/search"/);
    assert.match(get("app/page.tsx"), /<input \{\.\.\.\{ toolparamdescription: "Words to search for, e\.g\. hiking boots" \}\} id="q"/);
    assert.match(get("components/ContactForm.tsx"), /<form data-agent-tool="contact_us" onSubmit/);
    const mod = get("agentronics/webmcp-tools.ts");
    assert.match(mod, /import \{ addToCart \} from "\.\.\/app\/actions";/);
    assert.match(mod, /registerTool\(tool, \{ signal \}\)/);
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
