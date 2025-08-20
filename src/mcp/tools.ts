// src/mcp/tools.ts
import { cfDocsSearch } from "./tools/cfDocsSearch";

export const tools = [
  {
    name: "cf_docs.search",
    description: "Search Cloudflare Developer Docs (Algolia DocSearch).",
    inputSchema: {
      type: "object",
      properties: {
        q: { type: "string" },
        topK: { type: "integer", minimum: 1, maximum: 20 }
      },
      required: ["q"]
    },
    handler: async (env: Env, input: { q: string; topK?: number }) =>
      ({ items: await cfDocsSearch(env, input.q, input.topK ?? 8) })
  }
];
