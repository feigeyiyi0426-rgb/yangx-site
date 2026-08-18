import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const SUPABASE_URL = "https://mhiboklauvzlhkjpvruc.supabase.co";
const SUPABASE_KEY = "sb_publishable_o3CbW6HAEdH1gXhvspkQxg_c77efkXj";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

const entryForm = document.querySelector("#diary-entry-form");
const entryStatus = document.querySelector("#diary-entry-status");
const diaryPanel = document.querySelector("#diary-panel");
const diaryList = document.querySelector("#diary-list");
const composeForm = document.querySelector("#diary-compose-form");
const saveButton = document.querySelector("#save-diary");
const diaryStatus = document.querySelector("#diary-status");
const refreshButton = document.querySelector("#refresh-diary");
const leaveButton = document.querySelector("#leave-diary");

let activePassword = "";

function setEntryStatus(message, isError = false) {
  entryStatus.textContent = message;
  entryStatus.classList.toggle("is-error", isError);
}

function setDiaryStatus(message, isError = false) {
  diaryStatus.textContent = message;
  diaryStatus.classList.toggle("is-error", isError);
}

function formatDate(value) {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function bytesToBase64(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)));
}

function base64ToBytes(value) {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

async function deriveDiaryKey(password, salt) {
  const baseKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(`yangx-personal-diary:${password}`),
    "PBKDF2",
    false,
    ["deriveKey"]
  );

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations: 220000,
      hash: "SHA-256",
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

async function encryptDiaryEntry(entry) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveDiaryKey(activePassword, salt);
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(JSON.stringify(entry))
  );

  return JSON.stringify({
    version: 2,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    data: bytesToBase64(encrypted),
  });
}

async function decryptDiaryEntry(payload) {
  const parsed = JSON.parse(payload);
  const salt = base64ToBytes(parsed.salt);
  const iv = base64ToBytes(parsed.iv);
  const data = base64ToBytes(parsed.data);
  const key = await deriveDiaryKey(activePassword, salt);
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, data);
  return JSON.parse(new TextDecoder().decode(decrypted));
}

function createTextNode(tag, text, className) {
  const node = document.createElement(tag);
  node.textContent = text;
  if (className) node.className = className;
  return node;
}

async function openDiary(event) {
  event.preventDefault();
  const formData = new FormData(entryForm);
  const password = String(formData.get("password") || "");

  if (password.length < 4) {
    setEntryStatus("请输入个人日记密码。", true);
    return;
  }

  activePassword = password;
  diaryPanel.classList.remove("is-hidden");
  entryForm.classList.add("is-compact");
  setEntryStatus("个人日记已打开。密码不会保存在网页里。", false);
  await loadDiaryEntries();
}

async function loadDiaryEntries() {
  if (!activePassword) return;
  diaryList.innerHTML = "";
  diaryList.appendChild(createTextNode("p", "正在读取日记...", "forum-empty"));

  const { data, error } = await supabase.rpc("personal_diary_list_entries", {
    admin_password: activePassword,
  });

  if (error) {
    diaryList.innerHTML = "";
    diaryList.appendChild(createTextNode("p", "无法打开个人日记。请确认密码正确，并已执行新版 supabase-diary.sql。", "forum-empty"));
    setDiaryStatus("读取失败：密码错误，或新版日记 SQL 还没执行。", true);
    return;
  }

  const entries = [];
  for (const row of data || []) {
    try {
      const decrypted = await decryptDiaryEntry(row.payload);
      entries.push({ id: row.id, created_at: row.created_at, ...decrypted });
    } catch {
      entries.push({
        id: row.id,
        created_at: row.created_at,
        title: "无法解密",
        body: "这条日记可能是用旧密码保存的，或内容不属于当前加密密钥。",
      });
    }
  }

  renderDiaryEntries(entries);
  setDiaryStatus(`已读取 ${entries.length} 条个人日记。`);
}

function renderDiaryEntries(entries) {
  diaryList.innerHTML = "";

  if (!entries.length) {
    diaryList.appendChild(createTextNode("p", "还没有日记。可以先写第一条。", "forum-empty"));
    return;
  }

  entries.forEach((entry) => {
    const article = document.createElement("article");
    article.className = "forum-post";

    const meta = document.createElement("div");
    meta.className = "post-head";
    meta.append(
      createTextNode("span", "PERSONAL"),
      createTextNode("time", formatDate(entry.createdAt || entry.created_at))
    );

    const deleteButton = document.createElement("button");
    deleteButton.className = "button secondary small-button danger-button";
    deleteButton.type = "button";
    deleteButton.textContent = "删除";
    deleteButton.addEventListener("click", () => deleteDiaryEntry(entry));

    article.append(
      meta,
      createTextNode("h4", entry.title || "未命名日记"),
      createTextNode("p", entry.body || ""),
      deleteButton
    );
    diaryList.appendChild(article);
  });
}

async function saveDiaryEntry(event) {
  event.preventDefault();
  if (!activePassword) return setDiaryStatus("请先进入个人日记。", true);

  const formData = new FormData(composeForm);
  const title = String(formData.get("title") || "").trim().slice(0, 80);
  const body = String(formData.get("body") || "").trim().slice(0, 6000);

  if (!title || !body) {
    setDiaryStatus("标题和内容都要填写。", true);
    return;
  }

  saveButton.disabled = true;
  saveButton.textContent = "保存中...";

  const payload = await encryptDiaryEntry({
    title,
    body,
    createdAt: new Date().toISOString(),
  });

  const { error } = await supabase.rpc("personal_diary_add_entry", {
    admin_password: activePassword,
    entry_payload: payload,
  });

  saveButton.disabled = false;
  saveButton.textContent = "保存日记";

  if (error) {
    setDiaryStatus("保存失败。请确认密码正确，并已执行新版 supabase-diary.sql。", true);
    return;
  }

  composeForm.reset();
  await loadDiaryEntries();
  setDiaryStatus("个人日记已加密保存。", false);
}

async function deleteDiaryEntry(entry) {
  const confirmed = window.confirm(`确定删除《${entry.title || "这条日记"}》吗？删除后不能恢复。`);
  if (!confirmed) return;

  const { error } = await supabase.rpc("personal_diary_delete_entry", {
    admin_password: activePassword,
    entry_id: entry.id,
  });

  if (error) {
    setDiaryStatus("删除失败，请重新进入后再试。", true);
    return;
  }

  await loadDiaryEntries();
  setDiaryStatus("个人日记已删除。", false);
}

function leaveDiary() {
  activePassword = "";
  diaryList.innerHTML = "";
  diaryPanel.classList.add("is-hidden");
  entryForm.classList.remove("is-compact");
  entryForm.reset();
  composeForm.reset();
  setEntryStatus("已退出。页面不再保留日记密码。", false);
}

entryForm.addEventListener("submit", openDiary);
composeForm.addEventListener("submit", saveDiaryEntry);
refreshButton.addEventListener("click", loadDiaryEntries);
leaveButton.addEventListener("click", leaveDiary);
