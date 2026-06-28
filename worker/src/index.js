// GSGW Reader Worker — comment counts + chapter editor backend.
//
// Routes:
//   GET  /counts?ch=ch222   -> { "ch222-p5": 3, "ch222-p12": 1 }   (public, edge-cached)  [counts.js]
//   GET  /totals            -> { "ch222": 4, "ch223": 1 }          (public, edge-cached)  [counts.js]
//   POST /api/auth          -> { token }                            (password -> session)  [auth.js]
//   GET  /api/chapters      -> [ch222, ch223, ...]                  (auth)                 [chapters.js]
//   GET  /api/chapter/ch222 -> { number, title, html, ... }         (auth)                 [chapters.js]
//   POST /api/save/ch222    -> { ok }   save draft to KV            (auth)                 [chapters.js]
//   POST /api/discard/ch222 -> { ok }   drop a KV draft             (auth)
//   POST /api/create-pr     -> { pr_url }  PR all drafts, clear KV  (auth)                 [pr.js]
//   GET  /api/draft-prs     -> { ch222: {pr_url, ...} }             (auth)                 [pr.js]
//   GET  /api/chapter-drafts-> { ch222: {html, metadata} }          (auth)                 [chapters.js]
import { cors, json } from "./http.js";
import { getCounts, getTotals } from "./counts.js";
import { validateSession, authHandler } from "./auth.js";
import { getChaptersList, getChapter, saveChapter, getChapterDrafts } from "./chapters.js";
import { createPR, getDraftPRs } from "./pr.js";

export default {
  async fetch(req, env, ctx) {
    try {
      const url = new URL(req.url);
      // All /api/* routes except auth + the public chapter list require a valid session.
      const requireAuth = async (handler) => {
        const session = await validateSession(req, env);
        return session ? handler() : json({ error: "Unauthorized" }, 401);
      };
      let res;

      if (req.method === "OPTIONS") {
        res = new Response(null, { status: 204 });
      } else if (url.pathname === "/counts" && req.method === "GET") {
        res = await getCounts(url, env, ctx);
      } else if (url.pathname === "/totals" && req.method === "GET") {
        res = await getTotals(url, env, ctx);
      } else if (url.pathname === "/api/auth" && req.method === "POST") {
        res = await authHandler(req, env);
      } else if (url.pathname === "/api/chapters" && req.method === "GET") {
        res = await getChaptersList(env);
      } else if (url.pathname.match(/^\/api\/chapter\//) && req.method === "GET") {
        const ch = url.pathname.match(/\/api\/chapter\/(.+)$/)[1];
        res = await requireAuth(() => getChapter(ch, env));
      } else if (url.pathname.match(/^\/api\/save\//) && req.method === "POST") {
        const ch = url.pathname.match(/\/api\/save\/(.+)$/)[1];
        res = await requireAuth(() => saveChapter(ch, req, env));
      } else if (url.pathname.match(/^\/api\/discard\//) && req.method === "POST") {
        const ch = url.pathname.match(/\/api\/discard\/(.+)$/)[1];
        res = await requireAuth(async () => {
          await env.EDITOR_DRAFTS.delete(ch + "-draft");
          return json({ ok: true });
        });
      } else if (url.pathname === "/api/create-pr" && req.method === "POST") {
        res = await requireAuth(() => createPR(req, env));
      } else if (url.pathname === "/api/draft-prs" && req.method === "GET") {
        res = await requireAuth(() => getDraftPRs(env));
      } else if (url.pathname === "/api/chapter-drafts" && req.method === "GET") {
        res = await requireAuth(() => getChapterDrafts(env));
      } else {
        res = new Response("Not found", { status: 404 });
      }

      return cors(res);
    } catch (e) {
      return cors(json({ error: String((e && e.message) || e) }, 500));
    }
  },
};
