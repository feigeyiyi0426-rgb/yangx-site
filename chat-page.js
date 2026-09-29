const REFRESH_MS = 5000;
const SEND_COOLDOWN_MS = 1200;
const REQUEST_TIMEOUT_MS = 12000;

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
  if (onlineCount) onlineCount.textContent = value;
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
  const baseKey = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
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

async function chatRequest(path, options = {}) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(path, {
      credentials: "same-origin",
      cache: "no-store",
      ...options,
      signal: controller.signal,
      headers: options.body ? { "Content-Type": "application/json", ...(options.headers || {}) } : options.headers,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "聊天服务请求失败");
    return data;
  } finally {
    window.clearTimeout(timer);
  }
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

async function loadMessages({ quiet = false } = {}) {
  if (!activeRoom) return;
  if (!quiet) setChatStatus("正在读取 1 小时内的消息...");
  try {
    const params = new URLSearchParams({ action: "sync", room_id: activeRoom.roomId, member_id: activeRoom.memberId });
    const data = await chatRequest(`/api/chat?${params}`);
    if (!activeRoom) return;
    setOnlineCount(`在线 ${data.onlineCount || 1} 人`);
    const messages = [];
    for (const item of data.messages || []) {
      try {
        messages.push({ ...item, text: await decryptMessage(item.payload, activeRoom.key) });
      } catch {
        // 密码不同的消息无法解密，不显示乱码。
      }
    }
    renderMessages(messages);
    setChatStatus("消息已同步；超过 1 小时的消息会自动消失。");
  } catch (error) {
    if (!quiet) renderMessages([]);
    setOnlineCount("在线人数暂时不可用");
    setChatStatus(error.name === "AbortError" ? "连接超时，请稍后再试。" : error.message, true);
  }
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
  roomTitle.textContent = room;
  setOnlineCount("在线人数同步中...");
  panel.classList.remove("is-hidden");
  entryForm.classList.add("is-compact");
  localStorage.setItem("yangx-chat-name", name);
  localStorage.setItem("yangx-chat-room", room);
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = window.setInterval(() => loadMessages({ quiet: true }), REFRESH_MS);
  await loadMessages();
  setEntryStatus("已进入房间。");
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
  try {
    const payload = await encryptMessage(message, activeRoom.key);
    await chatRequest("/api/chat", {
      method: "POST",
      body: JSON.stringify({ action: "send", room_id: activeRoom.roomId, member_id: activeRoom.memberId, name: activeRoom.name, payload }),
    });
    lastSendAt = Date.now();
    composeForm.reset();
    await loadMessages();
  } catch (error) {
    setChatStatus(error.name === "AbortError" ? "发送超时，请稍后再试。" : error.message, true);
  } finally {
    sendButton.disabled = false;
    sendButton.textContent = "发送";
  }
});

copyLinkButton.addEventListener("click", async () => {
  if (!activeRoom) return;
  const url = new URL(window.location.href);
  url.searchParams.set("room", activeRoom.room);
  await navigator.clipboard.writeText(url.toString());
  setChatStatus("邀请链接已复制。密码不要放在链接里，单独告诉对方更安全。");
});

leaveButton.addEventListener("click", () => {
  const leavingRoom = activeRoom;
  activeRoom = null;
  if (leavingRoom) {
    fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "leave", room_id: leavingRoom.roomId, member_id: leavingRoom.memberId }),
      keepalive: true,
    }).catch(() => {});
  }
  panel.classList.add("is-hidden");
  entryForm.classList.remove("is-compact");
  messagesContainer.innerHTML = "";
  setOnlineCount("在线 -- 人");
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = null;
  setEntryStatus("已退出房间。");
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") loadMessages({ quiet: true });
});

document.querySelector("#chat-name").value = localStorage.getItem("yangx-chat-name") || "";
if (!initialRoom) roomInput.value = localStorage.getItem("yangx-chat-room") || "";

