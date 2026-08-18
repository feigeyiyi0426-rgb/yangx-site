import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const SUPABASE_URL = "https://mhiboklauvzlhkjpvruc.supabase.co";
const SUPABASE_KEY = "sb_publishable_o3CbW6HAEdH1gXhvspkQxg_c77efkXj";
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const ALLOWED_FILE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/pdf",
  "text/plain",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/zip",
  "application/x-zip-compressed",
]);
const ALLOWED_FILE_EXTENSIONS = [
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".gif",
  ".pdf",
  ".txt",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".zip",
];

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
const fileForm = document.querySelector("#diary-file-form");
const fileInput = document.querySelector("#diary-file");
const fileButton = document.querySelector("#upload-diary-file");
const fileStatus = document.querySelector("#diary-file-status");
const fileList = document.querySelector("#diary-files");

let activePassword = "";
let previewUrls = [];

function setEntryStatus(message, isError = false) {
  entryStatus.textContent = message;
  entryStatus.classList.toggle("is-error", isError);
}

function setDiaryStatus(message, isError = false) {
  diaryStatus.textContent = message;
  diaryStatus.classList.toggle("is-error", isError);
}

function setFileStatus(message, isError = false) {
  fileStatus.textContent = message;
  fileStatus.classList.toggle("is-error", isError);
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

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return "未知大小";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function bytesToBase64(bytes) {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < view.length; index += chunkSize) {
    binary += String.fromCharCode(...view.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

function base64ToBytes(value) {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

function clearPreviewUrls() {
  previewUrls.forEach((url) => URL.revokeObjectURL(url));
  previewUrls = [];
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

async function encryptFileBuffer(buffer) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveDiaryKey(activePassword, salt);
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, buffer);
  return {
    data: bytesToBase64(encrypted),
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
  };
}

async function decryptFileBuffer(file) {
  const salt = base64ToBytes(file.fileSalt);
  const iv = base64ToBytes(file.fileIv);
  const data = base64ToBytes(file.fileData);
  const key = await deriveDiaryKey(activePassword, salt);
  return crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, data);
}

function createTextNode(tag, text, className) {
  const node = document.createElement(tag);
  node.textContent = text;
  if (className) node.className = className;
  return node;
}

function createActionButton(label, className, onClick) {
  const button = document.createElement("button");
  button.className = className;
  button.type = "button";
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
}

function isAllowedFile(file) {
  if (file.type.startsWith("video/")) return false;
  if (ALLOWED_FILE_TYPES.has(file.type)) return true;
  const name = file.name.toLowerCase();
  return ALLOWED_FILE_EXTENSIONS.some((extension) => name.endsWith(extension));
}

function isImageFile(file) {
  return String(file.type || "").startsWith("image/");
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
  await Promise.all([loadDiaryEntries(), loadDiaryFiles()]);
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

async function loadDiaryFiles() {
  if (!activePassword) return;
  fileList.innerHTML = "";
  fileList.appendChild(createTextNode("p", "正在读取附件...", "forum-empty"));

  const { data, error } = await supabase.rpc("personal_diary_list_files", {
    admin_password: activePassword,
  });

  if (error) {
    fileList.innerHTML = "";
    fileList.appendChild(createTextNode("p", "附件功能还没开通。请先执行新版 supabase-diary.sql。", "forum-empty"));
    setFileStatus("附件读取失败：新版 SQL 还没执行，或密码不正确。", true);
    return;
  }

  const files = [];
  for (const row of data || []) {
    try {
      const parsed = JSON.parse(row.payload);
      const metadata = await decryptDiaryEntry(parsed.metadata);
      files.push({
        id: row.id,
        created_at: row.created_at,
        ...metadata,
        fileSalt: parsed.fileSalt,
        fileIv: parsed.fileIv,
        fileData: parsed.fileData,
      });
    } catch {
      files.push({
        id: row.id,
        created_at: row.created_at,
        name: "无法解密的附件",
        type: "application/octet-stream",
        size: 0,
      });
    }
  }

  renderDiaryFiles(files);
  setFileStatus(`已读取 ${files.length} 个附件。图片会自动显示预览。`);
}

function renderDiaryEntries(entries) {
  diaryList.innerHTML = "";

  if (!entries.length) {
    diaryList.appendChild(createTextNode("p", "还没有文字日记。可以先写第一条。", "forum-empty"));
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

    const deleteButton = createActionButton(
      "删除",
      "button secondary small-button danger-button",
      () => deleteDiaryEntry(entry)
    );

    article.append(
      meta,
      createTextNode("h4", entry.title || "未命名日记"),
      createTextNode("p", entry.body || ""),
      deleteButton
    );
    diaryList.appendChild(article);
  });
}

function renderDiaryFiles(files) {
  clearPreviewUrls();
  fileList.innerHTML = "";

  if (!files.length) {
    fileList.appendChild(createTextNode("p", "还没有附件。点击上面的选择文件，上传图片后这里会直接显示。", "forum-empty"));
    return;
  }

  files.forEach((file) => {
    const article = document.createElement("article");
    article.className = "forum-post diary-file-card";

    const meta = document.createElement("div");
    meta.className = "post-head";
    meta.append(
      createTextNode("span", isImageFile(file) ? "IMAGE" : "FILE"),
      createTextNode("time", formatDate(file.createdAt || file.created_at))
    );

    article.append(
      meta,
      createTextNode("h4", file.name || "未命名附件")
    );

    if (isImageFile(file) && file.fileData) {
      const preview = document.createElement("figure");
      preview.className = "diary-image-preview";
      preview.appendChild(createTextNode("span", "正在解密图片预览..."));
      article.appendChild(preview);
      renderImagePreview(file, preview);
    }

    const actions = document.createElement("footer");
    actions.className = "admin-actions";
    actions.append(
      createActionButton(isImageFile(file) ? "下载原图" : "下载文件", "button secondary small-button", () => downloadDiaryFile(file)),
      createActionButton("删除", "button secondary small-button danger-button", () => deleteDiaryFile(file))
    );

    article.append(
      createTextNode("p", `${formatBytes(file.size)} · ${file.type || "普通文件"}`),
      actions
    );
    fileList.appendChild(article);
  });
}

async function renderImagePreview(file, preview) {
  try {
    const decrypted = await decryptFileBuffer(file);
    const blob = new Blob([decrypted], { type: file.type || "image/jpeg" });
    const url = URL.createObjectURL(blob);
    previewUrls.push(url);

    const image = document.createElement("img");
    image.src = url;
    image.alt = file.name || "日记图片";
    preview.replaceChildren(image);
  } catch (error) {
    console.error(error);
    preview.replaceChildren(createTextNode("span", "图片预览失败。可以尝试下载原图。"));
  }
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

async function uploadDiaryFile(event) {
  event.preventDefault();
  if (!activePassword) return setFileStatus("请先进入个人日记。", true);

  const file = fileInput.files?.[0];
  if (!file) {
    setFileStatus("请先选择一个图片或文件。", true);
    return;
  }

  if (file.size > MAX_FILE_BYTES) {
    setFileStatus("文件太大。当前单个附件最多 10MB。", true);
    return;
  }

  if (!isAllowedFile(file)) {
    setFileStatus("不支持这个文件类型。这里不上传视频，只支持图片和常用文档。", true);
    return;
  }

  fileButton.disabled = true;
  fileButton.textContent = "加密保存中...";
  setFileStatus("正在本地加密附件，然后保存...", false);

  try {
    const encryptedFile = await encryptFileBuffer(await file.arrayBuffer());
    const metadata = await encryptDiaryEntry({
      name: file.name,
      type: file.type || "application/octet-stream",
      size: file.size,
      createdAt: new Date().toISOString(),
    });

    const payload = JSON.stringify({
      version: 1,
      kind: "encrypted-file",
      metadata,
      fileSalt: encryptedFile.salt,
      fileIv: encryptedFile.iv,
      fileData: encryptedFile.data,
    });

    const { error } = await supabase.rpc("personal_diary_add_file", {
      admin_password: activePassword,
      file_payload: payload,
    });

    if (error) throw error;

    fileForm.reset();
    await loadDiaryFiles();
    setFileStatus(isImageFile(file) ? "图片已加密保存，并显示在附件区。" : "附件已加密保存。", false);
  } catch (error) {
    console.error(error);
    setFileStatus("保存失败。请确认已执行新版 supabase-diary.sql，然后刷新页面再试。", true);
  } finally {
    fileButton.disabled = false;
    fileButton.textContent = "上传附件";
  }
}

async function downloadDiaryFile(file) {
  if (!activePassword) return setFileStatus("请先进入个人日记。", true);
  if (!file.fileSalt || !file.fileIv || !file.fileData) {
    setFileStatus("这个附件缺少解密信息，无法打开。", true);
    return;
  }

  setFileStatus("正在解密附件...", false);
  try {
    const decrypted = await decryptFileBuffer(file);
    const blob = new Blob([decrypted], { type: file.type || "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = file.name || "yangx-diary-file";
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 60000);
    setFileStatus("附件已解密并开始下载。", false);
  } catch (error) {
    console.error(error);
    setFileStatus("附件打开失败。可能密码不对，或内容已损坏。", true);
  }
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

async function deleteDiaryFile(file) {
  const confirmed = window.confirm(`确定删除《${file.name || "这个附件"}》吗？删除后不能恢复。`);
  if (!confirmed) return;

  const { error } = await supabase.rpc("personal_diary_delete_file", {
    admin_password: activePassword,
    file_id: file.id,
  });

  if (error) {
    setFileStatus("删除失败，请重新进入后再试。", true);
    return;
  }

  await loadDiaryFiles();
  setFileStatus("附件已删除。", false);
}

function leaveDiary() {
  activePassword = "";
  clearPreviewUrls();
  diaryList.innerHTML = "";
  fileList.innerHTML = "";
  diaryPanel.classList.add("is-hidden");
  entryForm.classList.remove("is-compact");
  entryForm.reset();
  composeForm.reset();
  fileForm.reset();
  setEntryStatus("已退出。页面不再保留日记密码。", false);
}

entryForm.addEventListener("submit", openDiary);
composeForm.addEventListener("submit", saveDiaryEntry);
fileForm.addEventListener("submit", uploadDiaryFile);
refreshButton.addEventListener("click", () => Promise.all([loadDiaryEntries(), loadDiaryFiles()]));
leaveButton.addEventListener("click", leaveDiary);
