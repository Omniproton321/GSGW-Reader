// Public counts endpoint: a per-paragraph map of (comments + reactions), built from GitHub
// Discussions and cached at the edge so every reader shares one snapshot per colo.
import { cors, json } from "./http.js";
import { gql } from "./github.js";

const TTL = 120; // seconds the edge holds the full counts snapshot

// Map a discussion title to its chapter slug, or null if it isn't a chapter thread:
//   per-paragraph term thread  "ch222-p5"      -> "ch222"  (data-mapping="specific")
//   chapter-level thread       "chapters/ch222"-> "ch222"  (giscus pathname mapping)
function chapterOf(title) {
  let m = title.match(/^(ch[\w.]+)-p\d+$/);
  if (m) return m[1];
  m = title.match(/^chapters\/(ch[\w.]+)$/);
  if (m) return m[1];
  return null;
}

// GET /counts?ch=ch222 -> { "ch222-p5": 3, "ch222-p12": 1 }   (per-paragraph badges)
export async function getCounts(url, env, ctx) {
  const ch = url.searchParams.get("ch");
  if (!ch || !/^[\w-]+$/.test(ch)) return cors(json({ error: "bad ch" }, 400));
  try {
    const snap = await snapshot(env, ctx);
    return cors(json(snap.counts[ch] || {}, 200, { "Cache-Control": "public, max-age=60" }));
  } catch (e) {
    return cors(json({ error: String((e && e.message) || e) }, 502)); // surface the GitHub reason
  }
}

// GET /totals -> { "ch222": 4, "ch223": 1 } : per-chapter total for the Contents (TOC) pages.
// Each total = every per-paragraph thread PLUS the chapter-level thread, counting comments
// (incl. replies) + reactions. Reuses the same edge-cached snapshot as /counts.
export async function getTotals(url, env, ctx) {
  try {
    const snap = await snapshot(env, ctx);
    return cors(json(snap.totals, 200, { "Cache-Control": "public, max-age=60" }));
  } catch (e) {
    return cors(json({ error: String((e && e.message) || e) }, 502));
  }
}

// One edge-cached snapshot, built once per TTL per colo and shared across every reader:
//   { counts: { "ch222": { "ch222-p5": 3 } },   // per-paragraph, for badges
//     totals: { "ch222": 7 } }                   // per-chapter, incl. chapter-level thread
async function snapshot(env, ctx) {
  const cache = caches.default;
  const key = new Request("https://gsgw.internal/snapshot-v2"); // bump on snapshot shape change
  const hit = await cache.match(key);
  if (hit) return hit.json();
  const map = await buildAll(env);
  const res = json(map, 200, { "Cache-Control": "public, max-age=" + TTL });
  ctx.waitUntil(cache.put(key, res.clone()));
  return map;
}

async function buildAll(env) {
  const [owner, name] = env.GITHUB_REPO.split("/");
  const counts = {}; // per-paragraph map, drives the in-chapter badges
  const totals = {}; // per-chapter sum (paragraphs + chapter-level thread), drives the TOC
  let after = null;
  do {
    const data = await gql(
      env,
      `
      query($owner:String!,$name:String!,$after:String){
        repository(owner:$owner,name:$name){
          discussions(first:100,after:$after){
            pageInfo{ hasNextPage endCursor }
            nodes{ title comments{ totalCount } reactions{ totalCount } category{ name } }
          }
        }
      }`,
      { owner, name, after },
    );
    const d = data.repository.discussions;
    for (const n of d.nodes) {
      if (env.GITHUB_CATEGORY && n.category && n.category.name !== env.GITHUB_CATEGORY) continue;
      const ch = chapterOf(n.title);
      if (!ch) continue; // not a chapter / paragraph thread
      // Count comments (incl. replies) + reactions on the discussion body.
      const total = n.comments.totalCount + (n.reactions ? n.reactions.totalCount : 0);
      if (total <= 0) continue;
      totals[ch] = (totals[ch] || 0) + total;
      if (/-p\d+$/.test(n.title)) (counts[ch] ||= {})[n.title] = total; // per-paragraph only
    }
    after = d.pageInfo.hasNextPage ? d.pageInfo.endCursor : null;
  } while (after);
  return { counts, totals };
}
