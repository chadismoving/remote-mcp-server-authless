// src/index.ts
import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

/** Worker env bindings (set via `wrangler secret put ...`) */
interface Env {
  ALGOLIA_CF_APP_ID: string;       // e.g. "D32WIYFTUF"
  ALGOLIA_CF_SEARCH_KEY: string;   // search-only key from DevTools
  ALGOLIA_CF_INDEX: string;        // e.g. "docs_cloudflare"
}

/** Small helper to ensure secrets exist */
const need = (v: string | undefined, name: string) => {
  if (!v) throw new Error(`Missing secret: ${name}`);
  return v;
};

/** Algolia -> Cloudflare Docs search (DocSearch index) */
export async function cfDocsSearch(env: Env, q: string, topK = 8) {
  const appId   = need(env.ALGOLIA_CF_APP_ID, "ALGOLIA_CF_APP_ID");
  const apiKey  = need(env.ALGOLIA_CF_SEARCH_KEY, "ALGOLIA_CF_SEARCH_KEY");
  const index   = need(env.ALGOLIA_CF_INDEX, "ALGOLIA_CF_INDEX");

  const endpoint = `https://${appId}-dsn.algolia.net/1/indexes/${encodeURIComponent(index)}/query`;

  const r = await fetch(endpoint, {
    method: "POST",
    headers: {
      "X-Algolia-Application-Id": appId,
      "X-Algolia-API-Key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: q,
      hitsPerPage: topK,
      attributesToRetrieve: ["hierarchy", "url", "content"],
      attributesToSnippet: ["content:20"],
    }),
  });

  if (!r.ok) {
    const txt = await r.text().catch(() => "");
    throw new Error(`Algolia error ${r.status}: ${txt}`);
  }

  const data = await r.json() as { hits: any[] };
  return (data.hits || []).map((h: any) => ({
    title:
      h.hierarchy?.lvl0 ||
      h.hierarchy?.lvl1 ||
      (typeof h.content === "string" ? h.content.slice(0, 80) : "Cloudflare Docs"),
    url: h.url,
    snippet: h.content,
    score: h._rankingInfo?.firstMatchedWord ?? undefined,
  }));
}

// ---------------------------------------------
// MCP Agent with built-in tools + cf_docs.search
// ---------------------------------------------
export class MyMCP extends McpAgent {
  server = new McpServer({
    name: "Authless Calculator",
    version: "1.0.0",
  });

  async init() {
    // Simple addition tool
    this.server.tool("add", { a: z.number(), b: z.number() }, async ({ a, b }) => ({
      content: [{ type: "text", text: String(a + b) }],
    }));

    // Calculator tool with multiple operations
    this.server.tool(
      "calculate",
      {
        operation: z.enum(["add", "subtract", "multiply", "divide"]),
        a: z.number(),
        b: z.number(),
      },
      async ({ operation, a, b }) => {
        let result: number;
        switch (operation) {
          case "add": result = a + b; break;
          case "subtract": result = a - b; break;
          case "multiply": result = a * b; break;
          case "divide":
            if (b === 0) {
              return { content: [{ type: "text", text: "Error: Cannot divide by zero" }] };
            }
            result = a / b; break;
        }
        return { content: [{ type: "text", text: String(result) }] };
      }
    );

    // ---- Cloudflare Docs search (Algolia) ----
    // inside MyMCP.init()
this.server.tool(
  "cf_docs.search",
	{
		q: z.string(),
		topK: z.union([z.number().int().min(1).max(20), z.string().regex(/^\d+$/)]).optional()
	},
	async ({ q, topK }) => {
		const k = typeof topK === "string" ? parseInt(topK, 10) : topK ?? 8;
		const items = await cfDocsSearch(this.env as Env, q, k);

		// ✅ Return plain text; MCP Playground expects "text" | "image" | "audio" | "resource(_link)"
		return {
		content: [
			{
			type: "text",
			text: JSON.stringify({ items }, null, 2)
			}
		]
		};

		// If you prefer a downloadable JSON blob instead, use "resource":
		// return {
		//   content: [{
		//     type: "resource",
		//     resource: {
		//       mimeType: "application/json",
		//       data: btoa(unescape(encodeURIComponent(JSON.stringify({ items }, null, 2)))),
		//       name: "cf_docs_search.json",
		//     }
		//   }]
		// };
	}
	);
  }
}

// ---------------------------------------------
// Worker fetch with SSE + optional HTTP test route
// ---------------------------------------------
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // --- Quick curl test route (optional) ---
    if (request.method === "POST" && url.pathname === "/test/cf_docs.search") {
      try {
        const body = await request.json().catch(() => ({} as any));
        const q = typeof body.q === "string" ? body.q : "workers";
        const topK = Number.isFinite(body.topK) ? body.topK : 3;
        const items = await cfDocsSearch(env, q, topK);
        return new Response(JSON.stringify({ items }, null, 2), {
          headers: { "content-type": "application/json" },
        });
      } catch (err: any) {
        return new Response(JSON.stringify({ error: String(err?.message || err) }, null, 2), {
          status: 500,
          headers: { "content-type": "application/json" },
        });
      }
    }

    // --- MCP endpoints ---
    if (url.pathname === "/sse" || url.pathname === "/sse/message") {
      return MyMCP.serveSSE("/sse").fetch(request, env, ctx);
    }
    if (url.pathname === "/mcp") {
      return MyMCP.serve("/mcp").fetch(request, env, ctx);
    }

    return new Response("Not found", { status: 404 });
  },
};
