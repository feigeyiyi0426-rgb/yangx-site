const CONTENT_KEY = "yangx:content:ids";

function json(res, status, body) {
  res.status(status);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=30, s-maxage=60, stale-while-revalidate=300");
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
  if (!response.ok) throw new Error("Redis request failed");
  const rows = await response.json();
  return rows.map((row) => row?.result);
}

export default async function handler(req, res) {
  try {
    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
      return json(res, 405, { error: "请求方法不支持。" });
    }
    const kind = req.query.kind === "idea" ? "idea" : "project";
    const [ids] = await pipeline([["ZREVRANGE", CONTENT_KEY, 0, 499]]);
    if (!ids?.length) return json(res, 200, { entries: [] });
    const values = await pipeline(ids.map((id) => ["GET", `yangx:content:item:${id}`]));
    const entries = values.flatMap((value) => {
      try {
        const entry = value ? JSON.parse(value) : null;
        return entry?.kind === kind && entry.is_published ? [entry] : [];
      } catch { return []; }
    }).sort((a, b) => (a.sort_order - b.sort_order) || (new Date(b.created_at) - new Date(a.created_at)));
    return json(res, 200, { entries });
  } catch (error) {
    console.error("content api error", error);
    return json(res, 503, { error: "内容服务暂时不可用。" });
  }
}
