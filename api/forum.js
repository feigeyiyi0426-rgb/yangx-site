const POST_LIMIT = 50;
const REPLY_LIMIT = 100;
const POST_RATE_SECONDS = 10;
const REPLY_RATE_SECONDS = 3;
const POSTS_KEY = "yangx:forum:posts";

function json(res, status, body) {
  res.status(status);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store, max-age=0");
  return res.end(JSON.stringify(body));
}

function redisConfig() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) throw new Error("Redis environment variables are missing");
  return { url: url.replace(/\/$/, ""), token };
}

async function pipeline(commands) {
  const { url, token } = redisConfig();
  const response = await fetch(`${url}/pipeline`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(commands),
  });
  if (!response.ok) throw new Error(`Redis request failed with ${response.status}`);
  const results = await response.json();
  const failure = results.find((item) => item && item.error);
  if (failure) throw new Error(failure.error);
  return results.map((item) => item?.result);
}

function clean(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
}

function clientId(req) {
  return clean(req.headers["x-forwarded-for"] || req.headers["x-real-ip"] || "unknown", 80)
    .split(",")[0]
    .replace(/[^a-zA-Z0-9:.-]/g, "");
}

function replyKey(postId) {
  return `yangx:forum:replies:${postId}`;
}

function parseList(values) {
  return (values || []).flatMap((value) => {
    try {
      const item = JSON.parse(value);
      return item && item.id && !item.is_hidden ? [item] : [];
    } catch {
      return [];
    }
  });
}

async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") return JSON.parse(req.body || "{}");
  return {};
}

async function listPosts() {
  const [rawPosts] = await pipeline([["ZREVRANGE", POSTS_KEY, 0, POST_LIMIT - 1]]);
  const posts = parseList(rawPosts);
  if (!posts.length) return [];

  const replyResults = await pipeline(
    posts.map((post) => ["ZRANGE", replyKey(post.id), 0, REPLY_LIMIT - 1])
  );

  return posts.map((post, index) => ({
    ...post,
    replies: parseList(replyResults[index]),
  }));
}

async function allowRequest(key, seconds) {
  const [allowed] = await pipeline([["SET", key, "1", "NX", "EX", seconds]]);
  return Boolean(allowed);
}

async function createPost(req, body) {
  const title = clean(body.title, 80);
  const message = clean(body.message, 1000);
  const name = clean(body.name, 40) || "访客";
  const category = clean(body.category, 20) || "讨论";
  const isPrivate = Boolean(body.is_private);
  const privatePayload = isPrivate ? clean(body.private_payload, 5000) : "";

  if (!title || !message || (isPrivate && !privatePayload)) {
    return { status: 400, body: { error: "请完整填写主题和留言。" } };
  }

  const rateKey = `yangx:forum:rate:post:${clientId(req)}`;
  if (!(await allowRequest(rateKey, POST_RATE_SECONDS))) {
    return { status: 429, body: { error: "发布太快了，请稍后再试。" } };
  }

  const now = Date.now();
  const post = {
    id: crypto.randomUUID(),
    name,
    title,
    category,
    message,
    is_private: isPrivate,
    private_payload: privatePayload || null,
    is_hidden: false,
    created_at: new Date(now).toISOString(),
  };

  await pipeline([["ZADD", POSTS_KEY, now, JSON.stringify(post)]]);
  return { status: 201, body: { ok: true, post } };
}

async function createReply(req, body) {
  const postId = clean(body.post_id, 80);
  const message = clean(body.message, 800);
  const name = clean(body.name, 40) || "访客";
  if (!/^[a-f0-9-]{36}$/.test(postId) || !message) {
    return { status: 400, body: { error: "回复内容无效。" } };
  }

  const rateKey = `yangx:forum:rate:reply:${clientId(req)}`;
  if (!(await allowRequest(rateKey, REPLY_RATE_SECONDS))) {
    return { status: 429, body: { error: "回复太快了，请稍后再试。" } };
  }

  const now = Date.now();
  const reply = {
    id: crypto.randomUUID(),
    post_id: postId,
    name,
    message,
    is_hidden: false,
    created_at: new Date(now).toISOString(),
  };

  await pipeline([["ZADD", replyKey(postId), now, JSON.stringify(reply)]]);
  return { status: 201, body: { ok: true, reply } };
}

export default async function handler(req, res) {
  try {
    if (req.method === "GET") {
      return json(res, 200, { posts: await listPosts() });
    }

    if (req.method !== "POST") {
      res.setHeader("Allow", "GET, POST");
      return json(res, 405, { error: "请求方法不支持。" });
    }

    const body = await readBody(req);
    const action = String(body.action || "create_post");
    const result =
      action === "create_reply"
        ? await createReply(req, body)
        : action === "create_post"
          ? await createPost(req, body)
          : { status: 400, body: { error: "未知操作。" } };

    return json(res, result.status, result.body);
  } catch (error) {
    console.error("forum api error", error);
    return json(res, 503, { error: "留言服务暂时不可用，请稍后再试。" });
  }
}
