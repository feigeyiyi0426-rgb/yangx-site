const passwordInput = document.querySelector("#admin-password");
const loginButton = document.querySelector("#admin-login-button");
const adminStatus = document.querySelector("#admin-status");
const contentTools = document.querySelector("#content-tools");
const contentCount = document.querySelector("#content-count");
const contentList = document.querySelector("#content-list");
const contentForm = document.querySelector("#content-form");
const contentRefresh = document.querySelector("#content-refresh");
const contentReset = document.querySelector("#content-reset");
const contentSave = document.querySelector("#content-save");
const forumTools = document.querySelector("#forum-tools");
const forumCount = document.querySelector("#forum-count");
const forumList = document.querySelector("#forum-list");
const forumRefresh = document.querySelector("#forum-refresh");

let sessionToken = "";

function setAdminStatus(message, isError = false) {
  adminStatus.textContent = message;
  adminStatus.classList.toggle("is-error", isError);
}

function formatDate(value) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }).format(new Date(value));
}

function textNode(tag, text, className) {
  const node = document.createElement(tag);
  node.textContent = text;
  if (className) node.className = className;
  return node;
}

function kindLabel(kind) {
  return kind === "project" ? "项目" : "想法";
}

function shortText(value, maxLength = 180) {
  const text = String(value || "").trim();
  return text.length <= maxLength ? text : `${text.slice(0, maxLength)}...`;
}

async function api(action, data = {}, password = "") {
  const headers = { "Content-Type": "application/json" };
  if (sessionToken) headers.Authorization = `Bearer ${sessionToken}`;
  const response = await fetch("/api/admin", {
    method: "POST",
    headers,
    body: JSON.stringify({ action, ...data, ...(password ? { password } : {}) }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "后台请求失败。");
  return result;
}

function showDashboard(data) {
  contentTools.classList.remove("is-hidden");
  forumTools.classList.remove("is-hidden");
  renderContentEntries(data.entries || []);
  renderForumPosts(data.posts || []);
}

function renderContentEntries(entries) {
  contentList.innerHTML = "";
  contentCount.textContent = `共 ${entries.length} 条内容`;
  if (!entries.length) {
    contentList.appendChild(textNode("p", "暂无内容，可以先新增一条。", "forum-empty"));
    return;
  }
  entries.forEach((entry) => {
    const card = document.createElement("article");
    card.className = "admin-post";
    const meta = document.createElement("div");
    meta.className = "admin-post-meta";
    meta.append(
      textNode("span", kindLabel(entry.kind)),
      textNode("span", entry.is_published ? "公开显示" : "已隐藏"),
      textNode("span", entry.tag || "无标签"),
      textNode("time", formatDate(entry.updated_at || entry.created_at))
    );
    const actions = document.createElement("div");
    actions.className = "admin-actions";
    const editButton = textNode("button", "编辑", "button secondary small-button");
    editButton.type = "button";
    editButton.addEventListener("click", () => fillContentForm(entry));
    const deleteButton = textNode("button", "删除", "button secondary small-button danger-button");
    deleteButton.type = "button";
    deleteButton.addEventListener("click", () => deleteContentEntry(entry));
    actions.append(editButton, deleteButton);
    card.append(
      meta,
      textNode("h2", entry.title),
      textNode("p", entry.summary, "admin-message"),
      textNode("p", entry.url ? `链接：${entry.url}` : `排序：${entry.sort_order}`, "admin-author"),
      actions
    );
    contentList.appendChild(card);
  });
}

function renderForumPosts(posts) {
  forumList.innerHTML = "";
  forumCount.textContent = `共 ${posts.length} 条公开留言`;
  if (!posts.length) {
    forumList.appendChild(textNode("p", "暂无公开留言。", "forum-empty"));
    return;
  }
  posts.forEach((post) => {
    const card = document.createElement("article");
    card.className = "admin-post";
    const meta = document.createElement("div");
    meta.className = "admin-post-meta";
    meta.append(
      textNode("span", post.is_private ? "私密留言" : "公开留言"),
      textNode("span", post.category || "讨论"),
      textNode("span", `${Number(post.reply_count || 0)} 条回复`),
      textNode("time", formatDate(post.created_at))
    );
    const hideButton = textNode("button", "隐藏留言", "button secondary small-button danger-button");
    hideButton.type = "button";
    hideButton.addEventListener("click", () => hideForumPost(post));
    const actions = document.createElement("div");
    actions.className = "admin-actions";
    actions.appendChild(hideButton);
    card.append(
      meta,
      textNode("h2", post.title || "未命名留言"),
      textNode("p", post.is_private ? "私密留言正文已加密，后台不显示原文。" : shortText(post.message), "admin-message"),
      textNode("p", `来自 ${post.name || "访客"}`, "admin-author"),
      actions
    );
    forumList.appendChild(card);
  });
}

function fillContentForm(entry) {
  contentForm.elements.id.value = entry.id;
  contentForm.elements.kind.value = entry.kind;
  contentForm.elements.title.value = entry.title || "";
  contentForm.elements.summary.value = entry.summary || "";
  contentForm.elements.tag.value = entry.tag || "";
  contentForm.elements.url.value = entry.url || "";
  contentForm.elements.sort_order.value = entry.sort_order || 100;
  contentForm.elements.is_published.checked = Boolean(entry.is_published);
  contentSave.textContent = "保存修改";
  contentForm.scrollIntoView({ behavior: "smooth", block: "start" });
}

function resetContentForm() {
  contentForm.reset();
  contentForm.elements.id.value = "";
  contentForm.elements.sort_order.value = 100;
  contentForm.elements.is_published.checked = true;
  contentSave.textContent = "保存内容";
}

async function refreshAll(message = "后台数据已刷新。") {
  try {
    const data = await api("list");
    showDashboard(data);
    setAdminStatus(message);
  } catch (error) {
    setAdminStatus(error.message, true);
  }
}

async function login() {
  const password = passwordInput.value.trim();
  if (!password) return setAdminStatus("请输入后台密码。", true);
  loginButton.disabled = true;
  loginButton.textContent = "登录中...";
  try {
    const data = await api("login", {}, password);
    sessionToken = data.token;
    passwordInput.value = "";
    showDashboard(data);
    setAdminStatus("后台已登录，可以管理论坛留言和内容列表。");
  } catch (error) {
    setAdminStatus(error.message, true);
  } finally {
    loginButton.disabled = false;
    loginButton.textContent = "进入后台";
  }
}

async function saveContentEntry(event) {
  event.preventDefault();
  if (!sessionToken) return setAdminStatus("请先登录后台。", true);
  const formData = new FormData(contentForm);
  const data = {
    entry_id: formData.get("id") || null,
    entry_kind: String(formData.get("kind") || "idea"),
    entry_title: String(formData.get("title") || "").trim().slice(0, 80),
    entry_summary: String(formData.get("summary") || "").trim().slice(0, 360),
    entry_tag: String(formData.get("tag") || "").trim().slice(0, 40),
    entry_url: String(formData.get("url") || "").trim().slice(0, 300),
    entry_published: Boolean(formData.get("is_published")),
    entry_sort_order: Number(formData.get("sort_order") || 100),
  };
  if (!data.entry_title || !data.entry_summary) return setAdminStatus("标题和简介都要填写。", true);
  contentSave.disabled = true;
  contentSave.textContent = "保存中...";
  try {
    await api("upsert_entry", data);
    resetContentForm();
    await refreshAll("内容已保存，网站页面会自动读取最新列表。");
  } catch (error) {
    setAdminStatus(error.message, true);
  } finally {
    contentSave.disabled = false;
    if (contentSave.textContent === "保存中...") contentSave.textContent = "保存内容";
  }
}

async function deleteContentEntry(entry) {
  if (!window.confirm(`确定删除《${entry.title}》吗？删除后不能恢复。`)) return;
  try {
    await api("delete_entry", { entry_id: entry.id });
    await refreshAll("内容已删除。");
  } catch (error) {
    setAdminStatus(error.message, true);
  }
}

async function hideForumPost(post) {
  if (!window.confirm(`确定隐藏《${post.title || "这条留言"}》吗？前台会立即不显示。`)) return;
  try {
    await api("hide_forum", { post_id: post.id });
    await refreshAll("留言已隐藏，前台不会再显示。");
  } catch (error) {
    setAdminStatus(error.message, true);
  }
}

loginButton.addEventListener("click", login);
contentRefresh.addEventListener("click", () => refreshAll());
forumRefresh.addEventListener("click", () => refreshAll());
contentReset.addEventListener("click", resetContentForm);
contentForm.addEventListener("submit", saveContentEntry);
passwordInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") login();
});
