const entryForm = document.querySelector("#diary-entry-form");
const passwordInput = document.querySelector("#diary-password");
const enterButton = document.querySelector("#diary-enter-button");
const entryStatus = document.querySelector("#diary-entry-status");
const panel = document.querySelector("#diary-panel");
const refreshButton = document.querySelector("#refresh-diary");
const leaveButton = document.querySelector("#leave-diary");
const composeForm = document.querySelector("#diary-compose-form");
const saveButton = document.querySelector("#save-diary");
const diaryStatus = document.querySelector("#diary-status");
const noteFileInput = document.querySelector("#diary-note-file");
const fileForm = document.querySelector("#diary-file-form");
const fileInput = document.querySelector("#diary-file");
const fileButton = document.querySelector("#upload-diary-file");
const fileStatus = document.querySelector("#diary-file-status");
const diaryList = document.querySelector("#diary-list");
const diaryFiles = document.querySelector("#diary-files");

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const CHUNK_CHARS = 520000;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

let sessionToken = "";
let diaryKey = null;
let entries = [];
let files = [];
const objectUrls = new Set();

function setStatus(node, message, isError = false) {
  node.textContent = message;
  node.classList.toggle("is-error", isError);
}

function bytesToBase64(bytes) {
  let binary = "";
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function deriveKey(password) {
  const material = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: encoder.encode("yangx-personal-diary-v1"), iterations: 220000, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

async function encryptBytes(value) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, diaryKey, value));
  const output = new Uint8Array(iv.length + encrypted.length);
  output.set(iv);
  output.set(encrypted, iv.length);
  return bytesToBase64(output);
}

async function decryptBytes(payload) {
  const packed = base64ToBytes(payload);
  return new Uint8Array(await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: packed.slice(0, 12) },
    diaryKey,
    packed.slice(12)
  ));
}

async function encryptJson(value) {
  return encryptBytes(encoder.encode(JSON.stringify(value)));
}

async function decryptJson(payload) {
  return JSON.parse(decoder.decode(await decryptBytes(payload)));
}

async function api(action, data = {}, password = "") {
  const headers = { "Content-Type": "application/json" };
  if (sessionToken) headers.Authorization = `Bearer ${sessionToken}`;
  const response = await fetch("/api/diary", {
    method: "POST",
    headers,
    body: JSON.stringify({ action, ...data, ...(password ? { password } : {}) }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "个人日记请求失败。");
  return result;
}

function formatDate(value) {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }).format(new Date(value));
}

function formatSize(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function textNode(tag, text, className) {
  const node = document.createElement(tag);
  node.textContent = text;
  if (className) node.className = className;
  return node;
}

function revokeUrls() {
  objectUrls.forEach((url) => URL.revokeObjectURL(url));
  objectUrls.clear();
}

async function makeThumbnail(file) {
  if (!file.type.startsWith("image/")) return null;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 360 / bitmap.width, 260 / bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/webp", 0.72));
    return blob ? encryptBytes(new Uint8Array(await blob.arrayBuffer())) : null;
  } catch {
    return null;
  }
}

async function uploadFile(file, entryId = null) {
  if (!file || file.size < 1) throw new Error("请先选择附件。");
  if (file.size > MAX_FILE_BYTES) throw new Error("单个附件不能超过 10MB。");
  if (file.type.startsWith("video/")) throw new Error("个人日记不支持视频。");

  const [encrypted, thumbnailPayload] = await Promise.all([
    encryptBytes(new Uint8Array(await file.arrayBuffer())),
    makeThumbnail(file),
  ]);
  const chunks = [];
  for (let i = 0; i < encrypted.length; i += CHUNK_CHARS) chunks.push(encrypted.slice(i, i + CHUNK_CHARS));

  const started = await api("begin_file", {
    entry_id: entryId,
    file_name: file.name,
    mime_type: file.type || "application/octet-stream",
    size_bytes: file.size,
    chunk_count: chunks.length,
    thumbnail_payload: thumbnailPayload,
  });
  const fileId = started.file.id;

  for (let start = 0; start < chunks.length; start += 4) {
    await Promise.all(chunks.slice(start, start + 4).map((data, offset) =>
      api("put_chunk", { file_id: fileId, chunk_index: start + offset, data })
    ));
  }
  await api("complete_file", { file_id: fileId });
}

async function fetchEncryptedFile(file) {
  const parts = new Array(file.chunk_count);
  for (let start = 0; start < file.chunk_count; start += 6) {
    const batch = await Promise.all(
      Array.from({ length: Math.min(6, file.chunk_count - start) }, (_, offset) =>
        api("get_chunk", { file_id: file.id, chunk_index: start + offset })
      )
    );
    batch.forEach((result, offset) => { parts[start + offset] = result.data; });
  }
  return decryptBytes(parts.join(""));
}

function openLightbox(url, alt) {
  let box = document.querySelector("#diary-lightbox");
  if (!box) {
    box = document.createElement("div");
    box.id = "diary-lightbox";
    box.className = "diary-lightbox is-hidden";
    const close = textNode("button", "关闭", "button secondary small-button");
    close.type = "button";
    close.addEventListener("click", () => box.classList.add("is-hidden"));
    const image = document.createElement("img");
    box.append(close, image);
    box.addEventListener("click", (event) => {
      if (event.target === box) box.classList.add("is-hidden");
    });
    document.body.appendChild(box);
  }
  const image = box.querySelector("img");
  image.src = url;
  image.alt = alt;
  box.classList.remove("is-hidden");
}

async function loadOriginal(file, mode, button) {
  const oldText = button.textContent;
  button.disabled = true;
  button.textContent = "正在读取...";
  try {
    const bytes = await fetchEncryptedFile(file);
    const blob = new Blob([bytes], { type: file.mime_type });
    const url = URL.createObjectURL(blob);
    objectUrls.add(url);
    if (mode === "preview" && file.mime_type.startsWith("image/")) {
      openLightbox(url, file.file_name);
    } else {
      const link = document.createElement("a");
      link.href = url;
      link.download = file.file_name;
      link.click();
    }
  } catch (error) {
    setStatus(fileStatus, error.message, true);
  } finally {
    button.disabled = false;
    button.textContent = oldText;
  }
}

async function deleteFile(file) {
  if (!window.confirm(`确定删除附件“${file.file_name}”吗？`)) return;
  try {
    await api("delete_file", { file_id: file.id });
    await refreshDiary("附件已删除。");
  } catch (error) {
    setStatus(fileStatus, error.message, true);
  }
}

function renderFileCard(file, attached = false) {
  const card = document.createElement("article");
  card.className = `admin-post diary-file-card${attached ? " is-attached" : ""}`;
  card.append(
    textNode("p", file.mime_type.startsWith("image/") ? "IMAGE" : "FILE", "card-meta"),
    textNode("h4", file.file_name),
    textNode("p", `${formatSize(file.size_bytes)} · ${file.mime_type}`, "admin-author")
  );

  if (file.mime_type.startsWith("image/")) {
    const preview = document.createElement("div");
    preview.className = "diary-image-preview";
    const thumb = document.createElement("button");
    thumb.type = "button";
    thumb.className = "diary-image-thumb";
    thumb.appendChild(textNode("span", file.thumbnail_payload ? "正在加载小图..." : "点击查看原图"));
    thumb.addEventListener("click", () => loadOriginal(file, "preview", thumb));
    preview.appendChild(thumb);
    card.appendChild(preview);

    if (file.thumbnail_payload) {
      decryptBytes(file.thumbnail_payload).then((bytes) => {
        const url = URL.createObjectURL(new Blob([bytes], { type: "image/webp" }));
        objectUrls.add(url);
        thumb.innerHTML = "";
        const image = document.createElement("img");
        image.src = url;
        image.alt = `${file.file_name} 小图`;
        image.loading = "lazy";
        thumb.append(image, textNode("span", "点击查看原图"));
      }).catch(() => {
        thumb.querySelector("span").textContent = "小图读取失败，点击查看原图";
      });
    }
  }

  const actions = document.createElement("div");
  actions.className = "admin-actions";
  const open = textNode(
    "button",
    file.mime_type.startsWith("image/") ? "查看原图" : "下载附件",
    "button secondary small-button"
  );
  open.type = "button";
  open.addEventListener("click", () => loadOriginal(file, file.mime_type.startsWith("image/") ? "preview" : "download", open));
  const remove = textNode("button", "删除附件", "button secondary small-button danger-button");
  remove.type = "button";
  remove.addEventListener("click", () => deleteFile(file));
  actions.append(open, remove);
  card.appendChild(actions);
  return card;
}

async function renderDiary() {
  revokeUrls();
  diaryList.innerHTML = "";
  diaryFiles.innerHTML = "";

  const standalone = files.filter((file) => !file.entry_id);
  if (!standalone.length) diaryFiles.appendChild(textNode("p", "还没有单独附件。", "forum-empty"));
  standalone.forEach((file) => diaryFiles.appendChild(renderFileCard(file)));

  if (!entries.length) {
    diaryList.appendChild(textNode("p", "还没有日记，先写下第一条记录。", "forum-empty"));
    return;
  }

  for (const entry of entries) {
    const card = document.createElement("article");
    card.className = "forum-post";
    try {
      const note = await decryptJson(entry.payload);
      const meta = document.createElement("div");
      meta.className = "admin-post-meta";
      meta.append(textNode("span", "PERSONAL"), textNode("time", formatDate(entry.created_at)));
      const remove = textNode("button", "删除日记", "button secondary small-button danger-button");
      remove.type = "button";
      remove.addEventListener("click", () => deleteEntry(entry, note.title));
      card.append(meta, textNode("h3", note.title || "无标题"), textNode("p", note.body || ""), remove);

      const attached = files.filter((file) => file.entry_id === entry.id);
      if (attached.length) {
        const wrap = document.createElement("div");
        wrap.className = "diary-entry-attachments";
        wrap.appendChild(textNode("h5", `附件 ${attached.length}`));
        attached.forEach((file) => wrap.appendChild(renderFileCard(file, true)));
        card.appendChild(wrap);
      }
    } catch {
      card.append(textNode("h3", "无法解密的日记"), textNode("p", "这条记录可能使用了不同密码。"));
    }
    diaryList.appendChild(card);
  }
}

async function refreshDiary(message = "日记已刷新。") {
  const result = await api("list");
  entries = result.entries || [];
  files = result.files || [];
  await renderDiary();
  setStatus(diaryStatus, `${message} 共 ${entries.length} 条记录。`);
  setStatus(fileStatus, `已读取 ${files.length} 个附件。单个不超过 10MB。`);
}

async function enterDiary(event) {
  event.preventDefault();
  const password = passwordInput.value;
  if (!password) return setStatus(entryStatus, "请输入个人日记密码。", true);
  enterButton.disabled = true;
  enterButton.textContent = "正在进入...";
  try {
    const key = await deriveKey(password);
    const result = await api("login", {}, password);
    diaryKey = key;
    sessionToken = result.token;
    entries = result.entries || [];
    files = result.files || [];
    passwordInput.value = "";
    panel.classList.remove("is-hidden");
    await renderDiary();
    setStatus(entryStatus, "个人日记已打开。");
    setStatus(diaryStatus, `已读取 ${entries.length} 条个人日记。`);
    setStatus(fileStatus, `已读取 ${files.length} 个附件。单个不超过 10MB。`);
  } catch (error) {
    diaryKey = null;
    sessionToken = "";
    setStatus(entryStatus, error.message, true);
  } finally {
    enterButton.disabled = false;
    enterButton.textContent = "进入日记";
  }
}

async function saveEntry(event) {
  event.preventDefault();
  const title = composeForm.elements.title.value.trim();
  const body = composeForm.elements.body.value.trim();
  const file = noteFileInput.files[0] || null;
  if (!title || !body) return setStatus(diaryStatus, "标题和内容都要填写。", true);
  saveButton.disabled = true;
  saveButton.textContent = file ? "保存并上传..." : "保存中...";
  try {
    const payload = await encryptJson({ title, body });
    const result = await api("add_entry", { payload });
    if (file) await uploadFile(file, result.entry.id);
    composeForm.reset();
    await refreshDiary(file ? "日记和附件已保存。" : "日记已保存。");
  } catch (error) {
    setStatus(diaryStatus, error.message, true);
  } finally {
    saveButton.disabled = false;
    saveButton.textContent = "保存日记";
  }
}

async function uploadStandalone(event) {
  event.preventDefault();
  const file = fileInput.files[0];
  fileButton.disabled = true;
  fileButton.textContent = "加密上传中...";
  try {
    await uploadFile(file);
    fileForm.reset();
    await refreshDiary("附件已上传。");
  } catch (error) {
    setStatus(fileStatus, error.message, true);
  } finally {
    fileButton.disabled = false;
    fileButton.textContent = "上传附件";
  }
}

async function deleteEntry(entry, title) {
  if (!window.confirm(`确定删除日记《${title || "这条记录"}》及其附件吗？`)) return;
  try {
    await api("delete_entry", { entry_id: entry.id });
    await refreshDiary("日记已删除。");
  } catch (error) {
    setStatus(diaryStatus, error.message, true);
  }
}

function leaveDiary() {
  sessionToken = "";
  diaryKey = null;
  entries = [];
  files = [];
  revokeUrls();
  diaryList.innerHTML = "";
  diaryFiles.innerHTML = "";
  panel.classList.add("is-hidden");
  setStatus(entryStatus, "已退出个人日记，解密密钥已从当前页面清除。");
}

entryForm.addEventListener("submit", enterDiary);
composeForm.addEventListener("submit", saveEntry);
fileForm.addEventListener("submit", uploadStandalone);
refreshButton.addEventListener("click", () => refreshDiary().catch((error) => setStatus(diaryStatus, error.message, true)));
leaveButton.addEventListener("click", leaveDiary);
window.addEventListener("beforeunload", revokeUrls);
