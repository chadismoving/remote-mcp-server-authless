// src/tools/cfDocsSearch.ts
export async function cfDocsSearch(env: Env, q: string, topK = 8) {
  const endpoint = `https://${env.ALGOLIA_CF_APP_ID}-dsn.algolia.net/1/indexes/${encodeURIComponent(env.ALGOLIA_CF_INDEX)}/query`;
  const r = await fetch(endpoint, {
    method: "POST",
    headers: {
      "X-Algolia-Application-Id": env.ALGOLIA_CF_APP_ID,
      "X-Algolia-API-Key": env.ALGOLIA_CF_SEARCH_KEY, // search-only
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      query: q,
      hitsPerPage: topK,
      attributesToRetrieve: ["hierarchy","url","content"],
      attributesToSnippet: ["content:20"]
    })
  });

  if (!r.ok) throw new Error(`Algolia error: ${r.status} ${await r.text()}`);
  const { hits } = await r.json();

  return hits.map((h: any) => ({
    title: h.hierarchy?.lvl0 || h.hierarchy?.lvl1 || h.content?.slice?.(0,80) || "Cloudflare Docs",
    url: h.url,
    snippet: h.content,
    score: h._rankingInfo?.nbTypos != null ? 1 / (1 + h._rankingInfo.nbTypos) : undefined
  }));
}
