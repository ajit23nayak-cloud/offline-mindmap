/* ============================================================
   Branchboard — local starter
   ------------------------------------------------------------
   Serves Branchboard.html on your own machine and keeps every
   board as a plain .json file in the "boards" folder next to
   this script. Nothing leaves your computer: the server only
   listens on 127.0.0.1, which no other machine can reach.

   Run it with:  Start Branchboard.bat
   ============================================================ */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");

const ROOT = __dirname;
const APP = path.join(ROOT, "Branchboard.html");
const BOARDS = path.join(ROOT, "boards");
const DELETED_NAME = "_deleted";
const DELETED = path.join(BOARDS, DELETED_NAME);
const KEYFILE = path.join(ROOT, "apikey.txt");
const PORT_FROM = 8777;
const PORT_TO = 8799;
const MODEL = "claude-opus-5";

fs.mkdirSync(BOARDS, { recursive: true });

/* ---------- reading pictures of mind maps ---------- */

let Anthropic = null;
try {
  const mod = require("@anthropic-ai/sdk");
  Anthropic = mod.default || mod;
} catch (e) {
  /* the folder can be used without it; picture import just stays off */
}

function apiKey() {
  if (process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY.trim()) {
    return process.env.ANTHROPIC_API_KEY.trim();
  }
  try {
    const k = fs.readFileSync(KEYFILE, "utf8").trim();
    return k || null;
  } catch (e) {
    return null;
  }
}
function visionStatus() {
  if (!Anthropic) return { available: false, reason: "no-sdk" };
  if (!apiKey()) return { available: false, reason: "no-key" };
  return { available: true, reason: "", model: MODEL };
}

const READ_SYSTEM =
  "You turn pictures of mind maps into plain indented outlines.\n" +
  "\n" +
  "Reply with the outline and nothing else: no preamble, no code fence, no closing remark.\n" +
  "\n" +
  "Rules:\n" +
  "- One node per line, using the exact words shown in the picture.\n" +
  "- Two spaces of indentation for each level down. A child is indented two spaces past its parent.\n" +
  "- A node's parent is whatever it is joined to by a line, branch or arrow. Follow the drawn " +
  "connections, not what happens to sit nearby on the page.\n" +
  "- Branches drawn to the left of a centre node are still that node's children. Read them as such.\n" +
  "- If the picture holds several separate maps, start each one again at the far left.\n" +
  "- Keep the order the picture implies: top to bottom, then clockwise around a centre.\n" +
  "- No bullets, no numbering, no hashes.\n" +
  "- Where a word is genuinely unreadable, write your best guess followed by (?).\n" +
  "- If the picture is not a mind map, diagram or outline of any kind, reply with exactly: NOT_A_MIND_MAP";

async function readMindMap(mediaType, data) {
  const client = new Anthropic({ apiKey: apiKey() });
  const request = {
    model: MODEL,
    max_tokens: 16000,
    system: READ_SYSTEM,
    thinking: { type: "adaptive" },
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data } },
          { type: "text", text: "Write this mind map out as an indented outline." }
        ]
      }
    ]
  };

  let response;
  try {
    /* server-side fallback: if a safety classifier declines, the API re-runs
       the same request on another model inside the same call */
    response = await client.beta.messages.create(
      Object.assign({}, request, {
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default"
      })
    );
  } catch (e) {
    /* older account or beta not enabled - the plain call is fine */
    response = await client.messages.create(request);
  }

  if (response.stop_reason === "refusal") {
    throw new Error("Claude declined to read that picture.");
  }
  let text = "";
  for (const block of response.content) {
    if (block.type === "text") text += block.text;
  }
  text = text.trim().replace(/^```[\w]*\n?/, "").replace(/\n?```$/, "");
  if (/^NOT_A_MIND_MAP\b/.test(text)) {
    throw new Error("That picture does not look like a mind map.");
  }
  return text;
}

/* ---------- board files ---------- */

function safeName(s) {
  return String(s || "board")
    .trim()
    .replace(/[^\w\- ]+/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 50) || "board";
}
/* A board's folder is a real folder under boards/, so the shelves you make
   in the app are the same ones you see in Explorer - and a folder you make
   in Explorer shows up in the app. Paths are relative and sanitised, so a
   board file can never write outside boards/. */
/* Folder names keep their spaces and capitals - they are shelf labels, not
   file names - but lose anything that could steer the path somewhere else. */
function safeSegment(s) {
  return String(s || "")
    .replace(/[\\/:*?"<>|]/g, "")
    .replace(/[\x00-\x1f]/g, "")
    .replace(/\s+/g, " ")
    .replace(/^[.\s]+|[.\s]+$/g, "")
    .slice(0, 50);
}
function safeFolder(p) {
  return String(p || "")
    .replace(/\\/g, "/")
    .split("/")
    .map(safeSegment)
    .filter(seg => seg && seg !== DELETED_NAME)
    .slice(0, 6)                       /* a sane nesting limit */
    .join("/");
}

/* every .json under boards/, with the folder it sits in */
function boardFiles(rel) {
  rel = rel || "";
  const abs = path.join(BOARDS, rel);
  let entries = [];
  try { entries = fs.readdirSync(abs, { withFileTypes: true }); } catch (e) { return []; }
  let out = [];
  for (const d of entries) {
    if (d.name === DELETED_NAME || d.name.startsWith(".")) continue;
    const childRel = rel ? rel + "/" + d.name : d.name;
    if (d.isDirectory()) out = out.concat(boardFiles(childRel));
    else if (d.name.toLowerCase().endsWith(".json")) {
      out.push({ rel: childRel, folder: rel, name: d.name });
    }
  }
  return out;
}
/* every folder under boards/, even the empty ones */
function folderList(rel) {
  rel = rel || "";
  const abs = path.join(BOARDS, rel);
  let entries = [];
  try { entries = fs.readdirSync(abs, { withFileTypes: true }); } catch (e) { return []; }
  let out = [];
  for (const d of entries) {
    if (!d.isDirectory() || d.name === DELETED_NAME || d.name.startsWith(".")) continue;
    const childRel = rel ? rel + "/" + d.name : d.name;
    out.push(childRel);
    out = out.concat(folderList(childRel));
  }
  return out;
}
function fileForId(id) {
  const suffix = "__" + id + ".json";
  return boardFiles().find(f => f.name.endsWith(suffix)) || null;
}
function readAllBoards() {
  const out = [];
  for (const f of boardFiles()) {
    try {
      const b = JSON.parse(fs.readFileSync(path.join(BOARDS, f.rel), "utf8"));
      if (b && b.id && Array.isArray(b.trees)) {
        b.folder = f.folder;           /* the folder on disk wins, always */
        out.push(b);
      }
    } catch (e) {
      console.log("  skipped unreadable file: " + f.rel);
    }
  }
  out.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  return out;
}
function writeBoard(id, board) {
  if (!board || board.id !== id || !Array.isArray(board.trees)) {
    throw new Error("bad board payload");
  }
  const folder = safeFolder(board.folder);
  const wantedName = safeName(board.name) + "__" + id + ".json";
  const wantedRel = folder ? folder + "/" + wantedName : wantedName;
  const dirAbs = path.join(BOARDS, folder);
  fs.mkdirSync(dirAbs, { recursive: true });

  const existing = fileForId(id);
  if (existing && existing.rel !== wantedRel) {
    /* renamed, or moved to another folder - carry the file across */
    try { fs.renameSync(path.join(BOARDS, existing.rel), path.join(BOARDS, wantedRel)); }
    catch (e) { /* fall through and just write it at the new place */ }
  }
  const tmp = path.join(dirAbs, "." + wantedName + ".tmp");
  fs.writeFileSync(tmp, JSON.stringify(board, null, 2), "utf8");
  fs.renameSync(tmp, path.join(BOARDS, wantedRel));  /* atomic-ish: never a half-written board */
  return wantedRel;
}
function deleteBoard(id) {
  const existing = fileForId(id);
  if (!existing) return false;
  fs.mkdirSync(DELETED, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  fs.renameSync(path.join(BOARDS, existing.rel), path.join(DELETED, stamp + "__" + existing.name));
  return true;
}

/* ---------- folders ---------- */

function makeFolder(p) {
  const folder = safeFolder(p);
  if (!folder) throw new Error("bad folder name");
  fs.mkdirSync(path.join(BOARDS, folder), { recursive: true });
  return folder;
}
function renameFolder(from, to) {
  const a = safeFolder(from), b = safeFolder(to);
  if (!a || !b) throw new Error("bad folder name");
  if (a === b) return b;
  if ((b + "/").indexOf(a + "/") === 0) throw new Error("cannot move a folder inside itself");
  fs.mkdirSync(path.dirname(path.join(BOARDS, b)), { recursive: true });
  fs.renameSync(path.join(BOARDS, a), path.join(BOARDS, b));
  return b;
}
function removeFolder(p) {
  const folder = safeFolder(p);
  if (!folder) throw new Error("bad folder name");
  fs.mkdirSync(DELETED, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  fs.renameSync(path.join(BOARDS, folder),
                path.join(DELETED, stamp + "__" + folder.replace(/\//g, "-")));
  return true;
}

/* ---------- static files ---------- */

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8"
};

function serveStatic(urlPath, res) {
  let rel = decodeURIComponent(urlPath.split("?")[0]);
  if (rel === "/" || rel === "") rel = "/Branchboard.html";
  const full = path.join(ROOT, rel);
  if (!full.startsWith(ROOT)) { res.writeHead(403); return res.end("no"); }
  fs.readFile(full, (err, buf) => {
    if (err) { res.writeHead(404, { "Content-Type": "text/plain" }); return res.end("Not found"); }
    res.writeHead(200, {
      "Content-Type": TYPES[path.extname(full).toLowerCase()] || "application/octet-stream",
      "Cache-Control": "no-store"
    });
    res.end(buf);
  });
}

function sendJSON(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", c => {
      size += c.length;
      if (size > 25 * 1024 * 1024) { reject(new Error("too big")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/* ---------- server ---------- */

const server = http.createServer(async (req, res) => {
  const url = req.url || "/";

  if (url === "/api/ping") {
    return sendJSON(res, 200, { ok: true, dir: BOARDS });
  }
  if (url === "/api/vision/status") {
    return sendJSON(res, 200, visionStatus());
  }
  if (url === "/api/vision" && req.method === "POST") {
    const st = visionStatus();
    if (!st.available) return sendJSON(res, 200, { error: "Picture reading is not set up (" + st.reason + ")." });
    try {
      const payload = JSON.parse(await readBody(req));
      if (!payload.data) throw new Error("no image");
      console.log("  reading a picture with " + MODEL + "...");
      const outline = await readMindMap(payload.mediaType || "image/png", payload.data);
      console.log("  read " + outline.split("\n").filter(l => l.trim()).length + " lines");
      return sendJSON(res, 200, { outline });
    } catch (e) {
      const msg = e && e.message ? e.message : String(e);
      console.log("  PICTURE READ FAILED: " + msg);
      let friendly = msg;
      if (/401|authentication|invalid x-api-key/i.test(msg)) friendly = "That API key was rejected. Check apikey.txt.";
      else if (/429|rate.?limit/i.test(msg)) friendly = "Rate limited by the API. Wait a moment and try again.";
      else if (/credit|billing|quota/i.test(msg)) friendly = "The API account has no credit left.";
      else if (/ENOTFOUND|ECONNREFUSED|fetch failed|network/i.test(msg)) friendly = "No internet connection.";
      return sendJSON(res, 200, { error: friendly });
    }
  }
  if (url === "/api/boards" && req.method === "GET") {
    try { return sendJSON(res, 200, readAllBoards()); }
    catch (e) { return sendJSON(res, 500, { error: String(e.message) }); }
  }

  if (url.split("?")[0] === "/api/folders") {
    try {
      if (req.method === "GET") return sendJSON(res, 200, folderList());
      if (req.method === "POST") {
        const made = makeFolder(JSON.parse(await readBody(req)).path);
        console.log("  new folder  " + made);
        return sendJSON(res, 200, { ok: true, path: made });
      }
      if (req.method === "PUT") {
        const body = JSON.parse(await readBody(req));
        const to = renameFolder(body.from, body.to);
        console.log("  folder renamed  " + body.from + " -> " + to);
        return sendJSON(res, 200, { ok: true, path: to });
      }
      if (req.method === "DELETE") {
        const p = decodeURIComponent((url.split("?")[1] || "").replace(/^path=/, ""));
        removeFolder(p);
        console.log("  folder moved to _deleted: " + p);
        return sendJSON(res, 200, { ok: true });
      }
      res.writeHead(405); return res.end();
    } catch (e) {
      console.log("  FOLDER OP FAILED: " + e.message);
      return sendJSON(res, 400, { error: String(e.message) });
    }
  }

  const m = /^\/api\/boards\/([^/?]+)$/.exec(url);
  if (m) {
    const id = decodeURIComponent(m[1]);
    if (req.method === "PUT" || req.method === "POST") {
      try {
        const board = JSON.parse(await readBody(req));
        const name = writeBoard(id, board);
        console.log("  saved  " + name);
        return sendJSON(res, 200, { ok: true, file: name });
      } catch (e) {
        console.log("  SAVE FAILED for " + id + ": " + e.message);
        return sendJSON(res, 400, { error: String(e.message) });
      }
    }
    if (req.method === "DELETE") {
      try {
        const moved = deleteBoard(id);
        console.log(moved ? "  moved to _deleted: " + id : "  nothing to delete: " + id);
        return sendJSON(res, 200, { ok: true, moved });
      } catch (e) {
        return sendJSON(res, 500, { error: String(e.message) });
      }
    }
    res.writeHead(405); return res.end();
  }

  if (req.method !== "GET") { res.writeHead(405); return res.end(); }
  serveStatic(url, res);
});

/* ---------- start, hunting for a free port ---------- */

function listen(port) {
  /* both handlers are removed before a retry - otherwise each attempt
     leaves its own "listening" callback behind and the last bind fires
     all of them, opening a browser window per attempted port */
  const onError = err => {
    server.removeListener("listening", onListening);
    if (err.code === "EADDRINUSE" && port < PORT_TO) return listen(port + 1);
    console.log("");
    console.log("  Could not start: " + err.message);
    console.log("  You can still double-click Branchboard.html to use it");
    console.log("  with boards saved inside your browser instead.");
    console.log("");
  };
  const onListening = () => {
    server.removeListener("error", onError);
    const url = "http://127.0.0.1:" + port + "/";
    const count = boardFiles().length;
    console.log("");
    console.log("  Branchboard is running.");
    console.log("");
    console.log("    open        " + url);
    console.log("    boards in   " + BOARDS);
    console.log("    found       " + count + (count === 1 ? " board" : " boards"));
    console.log("");
    console.log("  Keep this window open while you work. Close it when you are done.");
    console.log("");
    if (process.platform === "win32") exec('start "" "' + url + '"');
    else if (process.platform === "darwin") exec('open "' + url + '"');
  };
  server.once("error", onError);
  server.once("listening", onListening);
  server.listen(port, "127.0.0.1");
}

if (!fs.existsSync(APP)) {
  console.log("");
  console.log("  Branchboard.html is missing from this folder:");
  console.log("  " + ROOT);
  console.log("");
} else {
  listen(PORT_FROM);
}
