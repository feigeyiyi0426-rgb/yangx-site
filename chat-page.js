import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const SUPABASE_URL = "https://mhiboklauvzlhkjpvruc.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1oaWJva2xhdXZ6bGhranB2cnVjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY1MDE3OTIsImV4cCI6MjEwMjA3Nzc5Mn0.4MokXU98T4T1vpy94WVhlqNJfeXSTZTXeyqeIb692Pc";
const MESSAGE_LIMIT = 120;
const MESSAGE_TTL_MS = 60 * 60 * 1000;
const PRESENCE_TTL_MS = 2 * 60 * 1000;
const REFRESH_MS = 5000;
const PRESENCE_HEARTBEAT_MS = 25000;
const SEND_COOLDOWN_MS = 1200;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const entryForm = document.querySelector("#chat-entry-form");
const composeForm = document.querySelector("#chat-compose-form");
const panel = document.querySelector("#chat-panel");
const roomTitle = document.querySelector("#chat-room-title");
const onlineCount = document.querySelector("#chat-online-count");
const messagesContainer = document.querySelector("#chat-messages");
const entryStatus = document.querySelector("#chat-entry-status");
const chatStatus = document.querySelector("#chat-status");
const sendButton = document.querySelector("#chat-send-button");
const copyLinkButton = document.querySelector("#copy-chat-link");
const leaveButton = document.querySelector("#leave-chat");
const roomInput = document.querySelector("#chat-room");

let activeRoom = null;
let refreshTimer = null;
let presenceTimer = null;
let presenceAvailable = true;
let lastSendAt = 0;

const initialRoom = new URLSearchParams(window.location.search).get("room");
if (initialRoom) roomInput.value = initialRoom.slice(0, 60);

function setEntryStatus(message, isError = false) {
  entryStatus.textContent = message;
  entryStatus.classList.toggle("is-error", isError);
}

function setChatStatus(message, isError = false) {
  chatStatus.textContent = message;
  chatStatus.classList.toggle("is-error", isError);
}

function setOnlineCount(value) {
  if (!onlineCount) return;
  onlineCount.textContent = value;
}

function normalizeRoom(value) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, 60);
}

function normalizeName(value) {
  return String(value || "访客").trim().slice(0, 40) || "访客";
}

function getMemberId() {
  const existing = localStorage.getItem("yangx-chat-member-id");
  if (existing) return existing;

  const generated = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  localStorage.setItem("yangx-chat-member-id", generated);
  return generated;
}

function bytesToBase64(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)));
}

function base64ToBytes(value) {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

async function digestText(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function deriveRoomKey(password, roomId) {
  const baseKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"]
  );

  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: new TextEncoder().encode(`yangx-chat:${roomId}`), iterations: 180000, hash: "SHA-256" },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

async function encryptMessage(message, key) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(message));
  return JSON.stringify({ version: 1, iv: bytesToBase64(iv), data: bytesToBase64(encrypted) });
}

async function decryptMessage(payload, key) {
  const parsed = JSON.parse(payload);
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(parsed.iv) },
    key,
    base64ToBytes(parsed.data)
  );
  return new TextDecoder().decode(decrypted);
}

function formatDate(value) {
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function renderMessages(messages) {
  messagesContainer.innerHTML = "";
  if (!messages.length) {
    const empty = document.createElement("p");
    empty.className = "chat-empty";
    empty.textContent = "这个房间还没有 1 小时内的新消息。";
    messagesContainer.appendChild(empty);
    return;
  }

  messages.forEach((message) => {
    const item = document.createElement("article");
    item.className = "chat-message";
    if (message.name === activeRoom.name) item.classList.add("is-own");

    const meta = document.createElement("div");
    meta.className = "chat-message-meta";
    meta.textContent = `${message.name || "访客"} · ${formatDate(message.created_at)}`;

    const body = document.createElement("p");
    body.textContent = message.text;
    item.append(meta, body);
    messagesContainer.appendChild(item);
  });

  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

async function loadPresenceCount() {
  if (!activeRoom || !presenceAvailable) return;

  const activeAfter = new Date(Date.now() - PRESENCE_TTL_MS).toISOString();
  const { data, error } = await supabase
    .from("chat_presence")
    .select("member_id")
    .eq("room_id", activeRoom.roomId)
    .gte("updated_at", activeAfter);

  if (error) {
    presenceAvailable = false;
    setOnlineCount("在线人数：需要更新 SQL");
    return;
  }

  const count = new Set((data || []).map((item) => item.member_id)).size;
  setOnlineCount(`在线 ${count || 1} 人`);
}

async function updatePresence() {
  if (!activeRoom || !presenceAvailable) return;

  const { error } = await supabase.from("chat_presence").upsert(
    {
      room_id: activeRoom.roomId,
      member_id: activeRoom.memberId,
      name: activeRoom.name,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "room_id,member_id" }
  );

  if (error) {
    presenceAvailable = false;
    setOnlineCount("在线人数：需要更新 SQL");
    return;
  }

  await loadPresenceCount();
}

async function loadMessages({ quiet = false } = {}) {
  if (!activeRoom) return;
  if (!quiet) setChatStatus("正在读取 1 小时内的消息...");

  const expiresAfter = new Date(Date.now() - MESSAGE_TTL_MS).toISOString();
  const { data, error } = await supabase
    .from("chat_messages")
    .select("id,name,payload,created_at")
    .eq("room_id", activeRoom.roomId)
    .eq("is_hidden", false)
    .gte("created_at", expiresAfter)
    .order("created_at", { ascending: true })
    .limit(MESSAGE_LIMIT);

  if (error) {
    renderMessages([]);
    setChatStatus("聊天数据库还没打开，先需要执行 supabase-chat.sql 建表。", true);
    return;
  }

  const messages = [];
  for (const item of data || []) {
    try {
      messages.push({ id: item.id, name: item.name, created_at: item.created_at, text: await decryptMessage(item.payload, activeRoom.key) });
    } catch {
      // 密码不匹配的消息不显示，避免展示乱码。
    }
  }

  renderMessages(messages);
  setChatStatus("消息已同步；超过 1 小时的消息会自动消失。");
}

async function enterRoom(formData) {
  const name = normalizeName(formData.get("name"));
  const room = normalizeRoom(formData.get("room"));
  const password = String(formData.get("password") || "").trim();

  if (!room) return setEntryStatus("请先填写房间名。", true);
  if (password.length < 4) return setEntryStatus("房间密码至少 4 位。", true);

  setEntryStatus("正在进入房间...");
  const roomId = await digestText(`yangx-chat-room|${room.toLowerCase()}|${password}`);
  const key = await deriveRoomKey(password, roomId);
  activeRoom = { name, room, roomId, key, memberId: getMemberId() };
  presenceAvailable = true;

  roomTitle.textContent = room;
  setOnlineCount("在线人数：同步中...");
  panel.classList.remove("is-hidden");
  entryForm.classList.add("is-compact");
  localStorage.setItem("yangx-chat-name", name);
  localStorage.setItem("yangx-chat-room", room);

  if (refreshTimer) clearInterval(refreshTimer);
  if (presenceTimer) clearInterval(presenceTimer);
  refreshTimer = window.setInterval(() => loadMessages({ quiet: true }), REFRESH_MS);
  presenceTimer = window.setInterval(updatePresence, PRESENCE_HEARTBEAT_MS);
  await updatePresence();
  await loadMessages();
}

entryForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await enterRoom(new FormData(entryForm));
});

composeForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!activeRoom) return setChatStatus("请先进入房间。", true);
  if (Date.now() - lastSendAt < SEND_COOLDOWN_MS) return setChatStatus("发送太快了，稍等一下。", true);

  const messageInput = composeForm.querySelector("#chat-message");
  const message = messageInput.value.trim().slice(0, 800);
  if (!message) return setChatStatus("请先写一条消息。", true);

  sendButton.disabled = true;
  sendButton.textContent = "发送中...";
  setChatStatus("正在保存消息...");

  const payload = await encryptMessage(message, activeRoom.key);
  const { error } = await supabase.from("chat_messages").insert({ room_id: activeRoom.roomId, name: activeRoom.name, payload });

  sendButton.disabled = false;
  sendButton.textContent = "发送";
  if (error) return setChatStatus("发送失败，可能还没建好聊天数据表。", true);

  lastSendAt = Date.now();
  composeForm.reset();
  await updatePresence();
  await loadMessages();
});

copyLinkButton.addEventListener("click", async () => {
  if (!activeRoom) return;
  const url = new URL(window.location.href);
  url.searchParams.set("room", activeRoom.room);
  await navigator.clipboard.writeText(url.toString());
  setChatStatus("邀请链接已复制。密码不要放在链接里，单独告诉对方更安全。");
});

leaveButton.addEventListener("click", () => {
  activeRoom = null;
  panel.classList.add("is-hidden");
  entryForm.classList.remove("is-compact");
  messagesContainer.innerHTML = "";
  setOnlineCount("在线 -- 人");
  if (refreshTimer) clearInterval(refreshTimer);
  if (presenceTimer) clearInterval(presenceTimer);
  refreshTimer = null;
  presenceTimer = null;
  setEntryStatus("已退出房间。");
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") updatePresence();
});

document.querySelector("#chat-name").value = localStorage.getItem("yangx-chat-name") || "";
if (!initialRoom) roomInput.value = localStorage.getItem("yangx-chat-room") || "";
