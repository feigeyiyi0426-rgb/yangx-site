const MESSAGE_TTL_MS = 60 * 60 * 1000;
const PRESENCE_TTL_MS = 2 * 60 * 1000;
const MESSAGE_LIMIT = 120;

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

function validRoomId(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function validMemberId(value) {
  return typeof value === "string" && /^[a-zA-Z0-9-]{8,80}$/.test(value);
}

function normalizeName(value) {
  return String(value || "访客").trim().slice(0, 40) || "访客";
}

function keys(roomId) {
  return { messages: `yangx:chat:messages:${roomId}`, presence: `yangx:chat:presence:${roomId}` };
}

async function syncRoom(roomId, memberId) {
  const now = Date.now();
  const roomKeys = keys(roomId);
  const results = await pipeline([
    ["ZREMRANGEBYSCORE", roomKeys.presence, "-inf", now - PRESENCE_TTL_MS],
    ["ZADD", roomKeys.presence, now, memberId],
    ["EXPIRE", roomKeys.presence, 180],
    ["ZCARD", roomKeys.presence],
    ["ZREMRANGEBYSCORE", roomKeys.messages, "-inf", now - MESSAGE_TTL_MS],
    ["EXPIRE", roomKeys.messages, 3660],
    ["ZRANGEBYSCORE", roomKeys.messages, now - MESSAGE_TTL_MS, "+inf", "LIMIT", 0, MESSAGE_LIMIT],
  ]);
  const messages = (results[6] || []).flatMap((value) => {
    try {
      const parsed = JSON.parse(value);
      return parsed && parsed.payload ? [parsed] : [];
    } catch {
      return [];
    }
  });
  return { messages, onlineCount: Math.max(1, Number(results[3]) || 1) };
}

async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") return JSON.parse(req.body || "{}");
  return {};
}

export default async function handler(req, res) {
  try {
    if (req.method === "GET") {
      const action = String(req.query.action || "sync");
      const roomId = String(req.query.room_id || "");
      const memberId = String(req.query.member_id || "");
      if (action !== "sync" || !validRoomId(roomId) || !validMemberId(memberId)) {
        return json(res, 400, { error: "请求参数无效。" });
      }
      return json(res, 200, await syncRoom(roomId, memberId));
    }

    if (req.method !== "POST") {
      res.setHeader("Allow", "GET, POST");
      return json(res, 405, { error: "请求方法不支持。" });
    }

    const body = await readBody(req);
    const action = String(body.action || "send");
    const roomId = String(body.room_id || "");
    const memberId = String(body.member_id || "");
    if (!validRoomId(roomId) || !validMemberId(memberId)) {
      return json(res, 400, { error: "请求参数无效。" });
    }

    const roomKeys = keys(roomId);
    if (action === "leave") {
      await pipeline([["ZREM", roomKeys.presence, memberId]]);
      return json(res, 200, { ok: true });
    }
    if (action !== "send") return json(res, 400, { error: "未知操作。" });

    const name = normalizeName(body.name);
    const payload = String(body.payload || "");
    if (!payload || payload.length > 6000) return json(res, 400, { error: "消息内容无效。" });

    const rateKey = `yangx:chat:rate:${roomId}:${memberId}`;
    const [allowed] = await pipeline([["SET", rateKey, "1", "NX", "EX", 1]]);
    if (!allowed) return json(res, 429, { error: "发送太快了，稍等一下。" });

    const now = Date.now();
    const message = JSON.stringify({ id: crypto.randomUUID(), name, payload, created_at: new Date(now).toISOString() });
    await pipeline([
      ["ZADD", roomKeys.messages, now, message],
      ["EXPIRE", roomKeys.messages, 3660],
      ["ZREMRANGEBYSCORE", roomKeys.messages, "-inf", now - MESSAGE_TTL_MS],
      ["ZADD", roomKeys.presence, now, memberId],
      ["EXPIRE", roomKeys.presence, 180],
    ]);
    return json(res, 201, { ok: true });
  } catch (error) {
    console.error("chat api error", error);
    return json(res, 503, { error: "聊天服务暂时不可用，请稍后再试。" });
  }
}

