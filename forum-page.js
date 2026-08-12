import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const SUPABASE_URL = "https://mhiboklauvzlhkjpvruc.supabase.co";
const SUPABASE_KEY = "sb_publishable_o3CbW6HAEdH1gXhvspkQxg_c77efkXj";
const POST_LIMIT = 50;
const POST_COOLDOWN_MS = 10000;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

const forumForm = document.querySelector("#forum-form");
const postsContainer = document.querySelector("#forum-posts");
const refreshButton = document.querySelector("#refresh-forum");
const submitButton = document.querySelector("#forum-submit");
const statusText = document.querySelector("#forum-status");
const privacySelect = document.querySelector("#forum-privacy");
const passwordRow = document.querySelector("#forum-password-row");
const passwordInput = document.querySelector("#forum-password");
let forumRepliesByPost = new Map();

function setStatus(message, isError = false) {
  statusText.textContent = message;
  statusText.classList.toggle("is-error", isError);
}

function formatDate(value) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function createTextNode(tag, text, className) {
  const node = document.createElement(tag);
  if (className) {
    node.className = className;
  }
  node.textContent = text;
  return node;
}

function bytesToBase64(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)));
}

function base64ToBytes(value) {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

async function derivePrivateKey(password, salt) {
  const baseKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"]
  );

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations: 150000,
      hash: "SHA-256",
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

async function encryptPrivateMessage(message, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await derivePrivateKey(password, salt);
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(message)
  );

  return JSON.stringify({
    version: 1,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    data: bytesToBase64(encrypted),
  });
}

async function decryptPrivateMessage(payload, password) {
  const parsed = JSON.parse(payload);
  const salt = base64ToBytes(parsed.salt);
  const iv = base64ToBytes(parsed.iv);
  const data = base64ToBytes(parsed.data);
  const key = await derivePrivateKey(password, salt);
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, data);
  return new TextDecoder().decode(decrypted);
}

function renderPosts(posts) {
  postsContainer.innerHTML = "";

  if (!posts.length) {
    postsContainer.appendChild(createTextNode("p", "还没有留言，欢迎写下第一条。", "forum-empty"));
    return;
  }

  posts.forEach((post) => {
    const article = document.createElement("article");
    article.className = "forum-post";

    const head = document.createElement("div");
    head.className = "post-head";
    const categoryText = post.is_private ? `${post.category || "讨论"} / 私密` : post.category || "讨论";
    head.appendChild(createTextNode("span", categoryText));

    const time = document.createElement("time");
    time.dateTime = post.created_at;
    time.textContent = formatDate(post.created_at);
    head.appendChild(time);

    article.appendChild(head);
    article.appendChild(createTextNode("h4", post.title));

    if (post.is_private) {
      article.appendChild(createPrivateContent(post));
    } else {
      article.appendChild(createTextNode("p", post.message));
      article.appendChild(createReplySection(post));
    }

    article.appendChild(createTextNode("footer", `来自 ${post.name || "访客"}`));
    postsContainer.appendChild(article);
  });
}

function createReplySection(post) {
  const wrapper = document.createElement("section");
  wrapper.className = "reply-section";
  wrapper.setAttribute("aria-label", `${post.title} 的回复`);

  const replies = forumRepliesByPost.get(post.id) || [];
  wrapper.appendChild(createTextNode("h5", `回复 ${replies.length}`));

  const list = document.createElement("div");
  list.className = "reply-list";

  if (!replies.length) {
    list.appendChild(createTextNode("p", "还没有回复。", "reply-empty"));
  } else {
    replies.forEach((reply) => {
      const item = document.createElement("article");
      item.className = "reply-item";
      item.appendChild(createTextNode("p", reply.message));
      item.appendChild(createTextNode("footer", `${reply.name || "访客"} · ${formatDate(reply.created_at)}`));
      list.appendChild(item);
    });
  }

  const form = document.createElement("form");
  form.className = "reply-form";
  form.innerHTML = `
    <input name="name" maxlength="40" placeholder="昵称" />
    <textarea name="message" maxlength="800" rows="3" required placeholder="写一条回复"></textarea>
    <button class="button secondary small-button" type="submit">回复</button>
    <p class="reply-note">公开回复，所有人可见。</p>
  `;

  form.addEventListener("submit", (event) => submitReply(event, post.id, form));
  wrapper.append(list, form);
  return wrapper;
}

function createPrivateContent(post) {
  const content = document.createElement("div");
  content.className = "private-content";
  content.appendChild(createTextNode("p", "此内容已加密，请输入访问密码查看正文。", "private-placeholder"));
  content.appendChild(createPrivateUnlock(post, content));
  return content;
}

function createPrivateUnlock(post, content) {
  const wrapper = document.createElement("div");
  wrapper.className = "private-unlock";

  const input = document.createElement("input");
  input.type = "password";
  input.placeholder = "输入访问密码";
  input.maxLength = 80;

  const button = document.createElement("button");
  button.className = "button secondary small-button";
  button.type = "button";
  button.textContent = "查看";

  const note = createTextNode("p", "私密正文只在本机解密显示。", "private-note");

  button.addEventListener("click", async () => {
    const password = input.value.trim();
    if (!password) {
      note.textContent = "请先输入访问密码。";
      note.classList.add("is-error");
      return;
    }

    button.disabled = true;
    button.textContent = "解密中...";

    try {
      const message = await decryptPrivateMessage(post.private_payload || "", password);
      content.replaceWith(createTextNode("p", message));
    } catch {
      note.textContent = "密码不正确，或者内容无法解密。";
      note.classList.add("is-error");
    } finally {
      button.disabled = false;
      button.textContent = "查看";
    }
  });

  wrapper.append(input, button, note);
  return wrapper;
}

async function loadPosts() {
  setStatus("正在读取最新留言...");

  const { data, error } = await supabase
    .from("forum_posts")
    .select("id,name,title,category,message,created_at,is_private,private_payload")
    .eq("is_hidden", false)
    .order("created_at", { ascending: false })
    .limit(POST_LIMIT);

  if (error) {
    setStatus("留言读取失败，请稍后再试。", true);
    renderPosts([]);
    return;
  }

  const posts = data || [];
  const publicPostIds = posts.filter((post) => !post.is_private).map((post) => post.id);
  forumRepliesByPost = await loadReplies(publicPostIds);
  renderPosts(posts);
  setStatus("公开留言所有人可见；私密留言会加密保存，输入访问密码后才能查看正文。");
}

async function loadReplies(postIds) {
  if (!postIds.length) {
    return new Map();
  }

  const { data, error } = await supabase
    .from("forum_replies")
    .select("id,post_id,name,message,created_at")
    .in("post_id", postIds)
    .eq("is_hidden", false)
    .order("created_at", { ascending: true });

  if (error) {
    return new Map();
  }

  return (data || []).reduce((groups, reply) => {
    const current = groups.get(reply.post_id) || [];
    current.push(reply);
    groups.set(reply.post_id, current);
    return groups;
  }, new Map());
}

async function submitReply(event, postId, form) {
  event.preventDefault();

  const note = form.querySelector(".reply-note");
  const button = form.querySelector("button");
  const formData = new FormData(form);
  const reply = {
    post_id: postId,
    name: String(formData.get("name") || "访客").trim().slice(0, 40) || "访客",
    message: String(formData.get("message") || "").trim().slice(0, 800),
  };

  if (!reply.message) {
    note.textContent = "请先填写回复内容。";
    note.classList.add("is-error");
    return;
  }

  button.disabled = true;
  button.textContent = "保存中...";
  note.textContent = "正在保存回复...";
  note.classList.remove("is-error");

  const { error } = await supabase.from("forum_replies").insert(reply);

  button.disabled = false;
  button.textContent = "回复";

  if (error) {
    note.textContent = "回复失败，请稍后再试。";
    note.classList.add("is-error");
    return;
  }

  form.reset();
  await loadPosts();
  setStatus("回复已发布。");
}

function normalizePost(formData) {
  return {
    name: String(formData.get("name") || "访客").trim().slice(0, 40) || "访客",
    title: String(formData.get("title") || "").trim().slice(0, 80),
    category: String(formData.get("category") || "讨论"),
    privacy: String(formData.get("privacy") || "public"),
    password: String(formData.get("password") || "").trim(),
    message: String(formData.get("message") || "").trim().slice(0, 1000),
  };
}

forumForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const lastPostAt = Number(localStorage.getItem("yangx-last-post-at") || 0);
  if (Date.now() - lastPostAt < POST_COOLDOWN_MS) {
    setStatus("发布太快了，请等几秒再试。", true);
    return;
  }

  const nextPost = normalizePost(new FormData(forumForm));
  if (!nextPost.title || !nextPost.message) {
    setStatus("请填写主题和留言内容。", true);
    return;
  }

  if (nextPost.privacy === "private" && nextPost.password.length < 4) {
    setStatus("私密留言请设置至少 4 位访问密码。", true);
    return;
  }

  submitButton.disabled = true;
  submitButton.textContent = "发布中...";
  setStatus("正在保存留言...");

  const postPayload = {
    name: nextPost.name,
    title: nextPost.title,
    category: nextPost.category,
    message: nextPost.message,
    is_private: nextPost.privacy === "private",
    private_payload: null,
  };

  if (postPayload.is_private) {
    postPayload.private_payload = await encryptPrivateMessage(nextPost.message, nextPost.password);
    postPayload.message = "此内容已加密，请输入访问密码查看。";
  }

  const { error } = await supabase.from("forum_posts").insert(postPayload);

  submitButton.disabled = false;
  submitButton.textContent = "发布留言";

  if (error) {
    setStatus("留言保存失败，请稍后再试。", true);
    return;
  }

  localStorage.setItem("yangx-last-post-at", String(Date.now()));
  forumForm.reset();
  await loadPosts();
  setStatus("留言已发布并公开保存。");
});

privacySelect.addEventListener("change", () => {
  const isPrivate = privacySelect.value === "private";
  passwordRow.classList.toggle("is-hidden", !isPrivate);
  passwordInput.required = isPrivate;
  if (!isPrivate) {
    passwordInput.value = "";
  }
});

refreshButton.addEventListener("click", loadPosts);
loadPosts();
