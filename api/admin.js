import crypto from "node:crypto";

const CONTENT_KEY = "yangx:content:ids";
const FORUM_KEY = "yangx:forum:posts";
const SESSION_SECONDS = 8 * 60 * 60;

function json(res, status, body) {
  res.status(status);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store, max-age=0");
  return res.end(JSON.stringify(body));
}

function config() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) throw new Error("Redis environment variables are missing");
  return { url: url.replace(/\/$/, ""), token };
}

async function pipeline(commands) {
  const { url, token } = config();
  const response = await fetch(`${url}/pipeline`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(commands),
  });
  if (!response.ok) throw new Error(`Redis request failed with ${response.status}`);
  const rows = await response.json();
  const failure = rows.find((row) => row?.error);
  if (failure) throw new Error(failure.error);
  return rows.map((row) => row?.result);
}

function clean(value, max) {
  return String(value || "").trim().slice(0, max);
}

async function bodyOf(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") return JSON.parse(req.body || "{}");
  return {};
}

function passwordOk(password) {
  const expected = process.env.SITE_ADMIN_PASSWORD_HASH;
  if (!expected || !/^[a-f0-9]{64}$/i.test(expected)) return false;
  const actual = crypto.pbkdf2Sync(String(password || ""), "yangx-admin-v1", 210000, 32, "sha256").toString("hex");
  return crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(expected.toLowerCase()));
}

function signSession(exp) {
  const secret = config().token;
  return crypto.createHmac("sha256", secret).update(String(exp)).digest("base64url");
}

function makeSession() {
  const exp = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
  return `${exp}.${signSession(exp)}`;
}

function hasSession(req) {
  const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const [expText, signature] = token.split(".");
  const exp = Number(expText);
  if (!exp || exp < Date.now() / 1000 || !signature) return false;
  const expected = signSession(exp);
  if (expected.length !== signature.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

function contentKey(id) {
  return `yangx:content:item:${id}`;
}

async function listContent() {
  const [ids] = await pipeline([["ZREVRANGE", CONTENT_KEY, 0, 499]]);
  if (!ids?.length) return [];
  const rows = await pipeline(ids.map((id) => ["GET", contentKey(id)]));
  return rows.flatMap((value) => {
    try { return value ? [JSON.parse(value)] : []; } catch { return []; }
  }).sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
}

async function listForum() {
  const [members] = await pipeline([["ZREVRANGE", FORUM_KEY, 0, 199]]);
  const records = (members || []).flatMap((member) => {
    try {
      const post = JSON.parse(member);
      return post?.id && !post.is_hidden ? [{ post, member }] : [];
    } catch { return []; }
  });
  if (!records.length) return [];
  const counts = await pipeline(records.map(({ post }) => ["ZCARD", `yangx:forum:replies:${post.id}`]));
  return records.map(({ post }, index) => ({ ...post, reply_count: Number(counts[index] || 0) }));
}

async function dashboard() {
  const [entries, posts] = await Promise.all([listContent(), listForum()]);
  return { entries, posts };
}

async function upsertEntry(body) {
  const now = new Date().toISOString();
  const id = /^[a-f0-9-]{36}$/i.test(String(body.entry_id || "")) ? body.entry_id : crypto.randomUUID();
  let createdAt = now;
  const [old] = await pipeline([["GET", contentKey(id)]]);
  if (old) {
    try { createdAt = JSON.parse(old).created_at || now; } catch {}
  }
  const entry = {
    id,
    kind: body.entry_kind === "project" ? "project" : "idea",
    title: clean(body.entry_title, 80),
    summary: clean(body.entry_summary, 360),
    tag: clean(body.entry_tag, 40),
    url: clean(body.entry_url, 300),
    is_published: Boolean(body.entry_published),
    sort_order: Math.max(-9999, Math.min(9999, Number(body.entry_sort_order) || 100)),
    created_at: createdAt,
    updated_at: now,
  };
  if (!entry.title || !entry.summary) throw new Error("标题和简介不能为空");
  await pipeline([
    ["SET", contentKey(id), JSON.stringify(entry)],
    ["ZADD", CONTENT_KEY, Date.now(), id],
  ]);
  return entry;
}

async function deleteEntry(id) {
  if (!/^[a-f0-9-]{36}$/i.test(String(id || ""))) throw new Error("内容编号无效");
  await pipeline([["DEL", contentKey(id)], ["ZREM", CONTENT_KEY, id]]);
}

async function hideForum(id) {
  const [members] = await pipeline([["ZREVRANGE", FORUM_KEY, 0, 499]]);
  const member = (members || []).find((value) => {
    try { return JSON.parse(value)?.id === id; } catch { return false; }
  });
  if (!member) throw new Error("留言不存在");
  await pipeline([["ZREM", FORUM_KEY, member]]);
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return json(res, 405, { error: "请求方法不支持。" });
    }
    const body = await bodyOf(req);
    const action = String(body.action || "login");
    if (action === "login") {
      if (!passwordOk(body.password)) return json(res, 401, { error: "密码错误。" });
      return json(res, 200, { ok: true, token: makeSession(), ...(await dashboard()) });
    }
    if (!hasSession(req)) return json(res, 401, { error: "登录已过期，请重新进入后台。" });
    if (action === "list") return json(res, 200, await dashboard());
    if (action === "upsert_entry") return json(res, 200, { ok: true, entry: await upsertEntry(body) });
    if (action === "delete_entry") {
      await deleteEntry(body.entry_id);
      return json(res, 200, { ok: true });
    }
    if (action === "hide_forum") {
      await hideForum(clean(body.post_id, 80));
      return json(res, 200, { ok: true });
    }
    return json(res, 400, { error: "未知操作。" });
  } catch (error) {
    console.error("admin api error", error);
    return json(res, 503, { error: error.message === "标题和简介不能为空" ? error.message : "后台服务暂时不可用。" });
  }
}
