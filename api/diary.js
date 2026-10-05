import crypto from "node:crypto";

const ENTRY_IDS = "yangx:diary:entries";
const FILE_IDS = "yangx:diary:files";
const SESSION_SECONDS = 8 * 60 * 60;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_CHUNKS = 32;

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

async function bodyOf(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") return JSON.parse(req.body || "{}");
  return {};
}

function clean(value, max) {
  return String(value || "").trim().slice(0, max);
}

function passwordOk(password) {
  const expected = process.env.SITE_ADMIN_PASSWORD_HASH;
  if (!expected || !/^[a-f0-9]{64}$/i.test(expected)) return false;
  const actual = crypto.pbkdf2Sync(String(password || ""), "yangx-admin-v1", 210000, 32, "sha256").toString("hex");
  return crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(expected.toLowerCase()));
}

function signature(exp) {
  return crypto.createHmac("sha256", config().token).update(`diary:${exp}`).digest("base64url");
}

function makeSession() {
  const exp = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
  return `${exp}.${signature(exp)}`;
}

function hasSession(req) {
  const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const [expText, sign] = token.split(".");
  const exp = Number(expText);
  if (!exp || exp < Date.now() / 1000 || !sign) return false;
  const expected = signature(exp);
  return sign.length === expected.length && crypto.timingSafeEqual(Buffer.from(sign), Buffer.from(expected));
}

function entryKey(id) { return `yangx:diary:entry:${id}`; }
function fileKey(id) { return `yangx:diary:file:${id}`; }
function chunkKey(id, index) { return `yangx:diary:file:${id}:chunk:${index}`; }

async function listRecords(idsKey, keyFn, limit) {
  const [ids] = await pipeline([["ZREVRANGE", idsKey, 0, limit - 1]]);
  if (!ids?.length) return [];
  const values = await pipeline(ids.map((id) => ["GET", keyFn(id)]));
  return values.flatMap((value) => {
    try { return value ? [JSON.parse(value)] : []; } catch { return []; }
  });
}

async function listAll() {
  const [entries, files] = await Promise.all([
    listRecords(ENTRY_IDS, entryKey, 300),
    listRecords(FILE_IDS, fileKey, 500),
  ]);
  return {
    entries,
    files: files.filter((file) => file.upload_complete).map(({ upload_complete, ...file }) => file),
  };
}

async function saveEntry(body) {
  const payload = clean(body.payload, 20000);
  if (!payload) throw new Error("日记内容无效");
  const now = Date.now();
  const entry = {
    id: crypto.randomUUID(),
    payload,
    created_at: new Date(now).toISOString(),
  };
  await pipeline([
    ["SET", entryKey(entry.id), JSON.stringify(entry)],
    ["ZADD", ENTRY_IDS, now, entry.id],
  ]);
  return entry;
}

async function beginFile(body) {
  const size = Number(body.size_bytes) || 0;
  const count = Number(body.chunk_count) || 0;
  if (size < 1 || size > MAX_FILE_BYTES || count < 1 || count > MAX_CHUNKS) throw new Error("附件大小无效");
  const now = Date.now();
  const file = {
    id: crypto.randomUUID(),
    entry_id: /^[a-f0-9-]{36}$/i.test(String(body.entry_id || "")) ? body.entry_id : null,
    file_name: clean(body.file_name, 180) || "附件",
    mime_type: clean(body.mime_type, 120) || "application/octet-stream",
    size_bytes: size,
    chunk_count: count,
    thumbnail_payload: clean(body.thumbnail_payload, 300000) || null,
    upload_complete: false,
    created_at: new Date(now).toISOString(),
  };
  await pipeline([
    ["SET", fileKey(file.id), JSON.stringify(file)],
    ["ZADD", FILE_IDS, now, file.id],
  ]);
  return file;
}

async function putChunk(body) {
  const id = clean(body.file_id, 80);
  const index = Number(body.chunk_index);
  const data = String(body.data || "");
  if (!/^[a-f0-9-]{36}$/i.test(id) || !Number.isInteger(index) || index < 0 || index >= MAX_CHUNKS || !data || data.length > 850000) {
    throw new Error("附件分块无效");
  }
  const [raw] = await pipeline([["GET", fileKey(id)]]);
  if (!raw) throw new Error("附件不存在");
  const file = JSON.parse(raw);
  if (index >= file.chunk_count) throw new Error("附件分块超出范围");
  await pipeline([["SET", chunkKey(id, index), data]]);
}

async function completeFile(body) {
  const id = clean(body.file_id, 80);
  const [raw] = await pipeline([["GET", fileKey(id)]]);
  if (!raw) throw new Error("附件不存在");
  const file = JSON.parse(raw);
  const chunks = await pipeline(Array.from({ length: file.chunk_count }, (_, i) => ["EXISTS", chunkKey(id, i)]));
  if (chunks.some((value) => !value)) throw new Error("附件上传不完整");
  file.upload_complete = true;
  await pipeline([["SET", fileKey(id), JSON.stringify(file)]]);
  return file;
}

async function deleteFile(id) {
  const [raw] = await pipeline([["GET", fileKey(id)]]);
  if (!raw) return;
  const file = JSON.parse(raw);
  const commands = [["DEL", fileKey(id)], ["ZREM", FILE_IDS, id]];
  for (let index = 0; index < file.chunk_count; index += 1) commands.push(["DEL", chunkKey(id, index)]);
  await pipeline(commands);
}

async function deleteEntry(id) {
  if (!/^[a-f0-9-]{36}$/i.test(id)) throw new Error("日记编号无效");
  const files = await listRecords(FILE_IDS, fileKey, 500);
  for (const file of files.filter((item) => item.entry_id === id)) await deleteFile(file.id);
  await pipeline([["DEL", entryKey(id)], ["ZREM", ENTRY_IDS, id]]);
}

async function getChunk(body) {
  const id = clean(body.file_id, 80);
  const index = Number(body.chunk_index);
  if (!/^[a-f0-9-]{36}$/i.test(id) || !Number.isInteger(index) || index < 0 || index >= MAX_CHUNKS) throw new Error("附件分块无效");
  const [data] = await pipeline([["GET", chunkKey(id, index)]]);
  if (!data) throw new Error("附件分块不存在");
  return data;
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
      return json(res, 200, { ok: true, token: makeSession(), ...(await listAll()) });
    }
    if (!hasSession(req)) return json(res, 401, { error: "登录已过期，请重新进入日记。" });
    if (action === "list") return json(res, 200, await listAll());
    if (action === "add_entry") return json(res, 200, { ok: true, entry: await saveEntry(body) });
    if (action === "begin_file") return json(res, 200, { ok: true, file: await beginFile(body) });
    if (action === "put_chunk") {
      await putChunk(body);
      return json(res, 200, { ok: true });
    }
    if (action === "complete_file") return json(res, 200, { ok: true, file: await completeFile(body) });
    if (action === "get_chunk") return json(res, 200, { data: await getChunk(body) });
    if (action === "delete_file") {
      await deleteFile(clean(body.file_id, 80));
      return json(res, 200, { ok: true });
    }
    if (action === "delete_entry") {
      await deleteEntry(clean(body.entry_id, 80));
      return json(res, 200, { ok: true });
    }
    return json(res, 400, { error: "未知操作。" });
  } catch (error) {
    console.error("diary api error", error);
    const known = ["日记内容无效", "附件大小无效", "附件分块无效", "附件上传不完整", "附件不存在", "附件分块不存在"];
    return json(res, 503, { error: known.includes(error.message) ? error.message : "个人日记服务暂时不可用。" });
  }
}
