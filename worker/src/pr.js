// Pull-request endpoints: bundle all saved KV drafts into a GitHub PR (creating or
// updating the editor's draft branch), and list which chapters already have an open editor PR.
import { json } from "./http.js";
import { repo, ghFetch, decodeDraft, EDITOR_BRANCH_PREFIX } from "./github.js";

// Search open PRs for an existing editor branch that already touches one of `drafts`.
// Returns { branch, number } (both null when none found).
async function findExistingEditorPR(env, owner, name, drafts) {
  try {
    const prsRes = await ghFetch(
      env,
      `https://api.github.com/repos/${owner}/${name}/pulls?state=open&per_page=50`,
    );
    if (prsRes.ok) {
      const prs = await prsRes.json();
      for (const pr of prs) {
        if (pr.head.ref.startsWith(EDITOR_BRANCH_PREFIX)) {
          // Check if this PR touches any of our draft chapters
          const filesRes = await ghFetch(
            env,
            `https://api.github.com/repos/${owner}/${name}/pulls/${pr.number}/files?per_page=100`,
          );
          if (filesRes.ok) {
            const files = await filesRes.json();
            for (const file of files) {
              const match = file.filename.match(/chapters\/(\d+)\.html$/);
              if (match && drafts["ch" + match[1]]) {
                return { branch: pr.head.ref, number: pr.number };
              }
            }
          }
        }
      }
    }
  } catch (e) {
    // Silently fail, will create new PR
  }
  return { branch: null, number: null };
}

// POST /api/create-pr — commit every saved draft to a branch and open/refresh its PR.
export async function createPR(req, env) {
  try {
    // Fetch all drafts from KV
    const list = await env.EDITOR_DRAFTS.list();
    const drafts = {};
    for (const item of list.keys) {
      const ch = item.name.replace("-draft", "");
      // Handle both old format (plain html string) and new format (JSON with metadata)
      drafts[ch] = decodeDraft(await env.EDITOR_DRAFTS.get(item.name));
    }

    if (Object.keys(drafts).length === 0) {
      return json({ error: "No drafts to create PR" }, 400);
    }

    const [owner, repoName] = repo(env);
    const baseRef = "main";

    // Reuse an existing editor PR branch if one already covers any of these chapters.
    const { branch: existingBranch, number: existingPrNumber } = await findExistingEditorPR(
      env,
      owner,
      repoName,
      drafts,
    );
    const branch = existingBranch || EDITOR_BRANCH_PREFIX + Date.now();

    // Get the latest commit SHA on main
    const tokenValue = env.GITHUB_TOKEN
      ? `Bearer ${env.GITHUB_TOKEN.slice(0, 10)}...`
      : "UNDEFINED";
    const refRes = await ghFetch(
      env,
      `https://api.github.com/repos/${owner}/${repoName}/git/refs/heads/${baseRef}`,
      {
        headers: { Accept: "application/vnd.github.v3+json" },
      },
    );
    if (!refRes.ok) {
      const text = await refRes.text();
      throw new Error(
        `Failed to fetch ref: ${refRes.status} (token: ${tokenValue}) - ${text.slice(0, 200)}`,
      );
    }
    const refData = await refRes.json();
    const baseCommitSha = refData.object.sha;

    // Get the tree from the latest commit
    const commitRes = await ghFetch(
      env,
      `https://api.github.com/repos/${owner}/${repoName}/git/commits/${baseCommitSha}`,
    );
    if (!commitRes.ok) throw new Error("Failed to fetch commit: " + commitRes.statusText);
    const commitData = await commitRes.json();
    const baseTreeSha = commitData.tree.sha;

    // Get chapter numbers for commit/PR title
    const chapterNumbers = Object.keys(drafts)
      .map((ch) => ch.replace(/^ch/, ""))
      .sort((a, b) => parseInt(a) - parseInt(b));

    // Create a new tree with the updated chapters (with frontmatter)
    const treeItems = Object.entries(drafts).map(([ch, draft]) => {
      const num = ch.replace(/^ch/, "");
      const meta = draft.metadata || {};
      const frontmatter = `---\nnumber: ${meta.number || num}\ntitle: ${meta.title || "Chapter " + num}\n---\n`;
      // Ensure a single trailing newline so editor commits match the repo's source files
      // (and don't show a spurious "No newline at end of file" diff on the last line).
      const body = draft.html.endsWith("\n") ? draft.html : draft.html + "\n";
      const content = frontmatter + body;
      return {
        path: "chapters/" + num + ".html",
        mode: "100644",
        type: "blob",
        content,
      };
    });

    const treeRes = await ghFetch(
      env,
      `https://api.github.com/repos/${owner}/${repoName}/git/trees`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ base_tree: baseTreeSha, tree: treeItems }),
      },
    );
    if (!treeRes.ok) throw new Error("Failed to create tree: " + treeRes.statusText);
    const treeData = await treeRes.json();
    const newTreeSha = treeData.sha;

    // Create a new commit
    const newCommitRes = await ghFetch(
      env,
      `https://api.github.com/repos/${owner}/${repoName}/git/commits`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: "Update chapters " + chapterNumbers.join(", "),
          tree: newTreeSha,
          parents: [baseCommitSha],
        }),
      },
    );
    if (!newCommitRes.ok) throw new Error("Failed to create commit: " + newCommitRes.statusText);
    const newCommitData = await newCommitRes.json();
    const newCommitSha = newCommitData.sha;

    // If updating existing PR, just update the branch ref; otherwise create new branch
    let prData;
    if (existingBranch) {
      // Update existing branch
      const updateRefRes = await ghFetch(
        env,
        `https://api.github.com/repos/${owner}/${repoName}/git/refs/heads/${existingBranch}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          // force: the new commit is rebuilt from main + all current drafts (a full
          // replacement of the branch), so it isn't a fast-forward of the branch tip.
          body: JSON.stringify({ sha: newCommitSha, force: true }),
        },
      );
      if (!updateRefRes.ok) {
        const text = await updateRefRes.text();
        throw new Error(
          `Failed to update branch: ${updateRefRes.status} ${updateRefRes.statusText} - ${text.slice(0, 200)}`,
        );
      }
      // Return existing PR URL
      prData = { html_url: `https://github.com/${owner}/${repoName}/pull/${existingPrNumber}` };
    } else {
      // Create new branch
      const branchRes = await ghFetch(
        env,
        `https://api.github.com/repos/${owner}/${repoName}/git/refs`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ref: "refs/heads/" + branch, sha: newCommitSha }),
        },
      );
      if (!branchRes.ok) throw new Error("Failed to create branch: " + branchRes.statusText);

      // Create a PR with specific chapter numbers in title
      let prTitle = "Chapter " + chapterNumbers.join(", ") + " edit";
      if (chapterNumbers.length > 3) {
        prTitle = "Chapters " + chapterNumbers.length + " edits";
      }

      const prRes = await ghFetch(env, `https://api.github.com/repos/${owner}/${repoName}/pulls`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: prTitle,
          body: "Chapter updates from the web editor. Created at " + new Date().toISOString(),
          head: branch,
          base: baseRef,
        }),
      });
      if (!prRes.ok) throw new Error("Failed to create PR: " + prRes.statusText);
      prData = await prRes.json();
    }

    // Clear all drafts from KV
    for (const item of list.keys) {
      await env.EDITOR_DRAFTS.delete(item.name);
    }

    return json({ ok: true, pr_url: prData.html_url });
  } catch (e) {
    return json({ error: String((e && e.message) || e) }, 500);
  }
}

// GET /api/draft-prs — map of chapter slug -> open editor PR info { pr_number, pr_url, pr_title }.
export async function getDraftPRs(env) {
  try {
    const [owner, name] = repo(env);
    // Get all open PRs with editor- prefix
    const prsRes = await ghFetch(
      env,
      `https://api.github.com/repos/${owner}/${name}/pulls?state=open&head=${owner}:&per_page=100`,
    );
    if (!prsRes.ok) return json({});
    const prs = await prsRes.json();

    const draftMap = {};
    for (const pr of prs) {
      // Look for editor draft PRs (branch name starts with editor-draft-)
      if (pr.head.ref.startsWith(EDITOR_BRANCH_PREFIX)) {
        // Get files changed in this PR
        const filesRes = await ghFetch(
          env,
          `https://api.github.com/repos/${owner}/${name}/pulls/${pr.number}/files?per_page=100`,
        );
        if (filesRes.ok) {
          const files = await filesRes.json();
          for (const file of files) {
            // Extract chapter slug from path (chapters/222.html -> ch222)
            const match = file.filename.match(/chapters\/(\d+)\.html$/);
            if (match) {
              const ch = "ch" + match[1];
              draftMap[ch] = { pr_number: pr.number, pr_url: pr.html_url, pr_title: pr.title };
            }
          }
        }
      }
    }
    return json(draftMap);
  } catch (e) {
    return json({});
  }
}
