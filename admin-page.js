import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const SUPABASE_URL = "https://mhiboklauvzlhkjpvruc.supabase.co";
const SUPABASE_KEY = "sb_publishable_o3CbW6HAEdH1gXhvspkQxg_c77efkXj";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

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

let adminPassword = "";

function setAdminStatus(message, isError = false) {
  adminStatus.textContent = message;
  adminStatus.classList.toggle("is-error", isError);
}

function formatDate(value) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
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
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}...`;
}

async function loadDashboard() {
  const results = await Promise.allSettled([loadForumPosts(), loadContentEntries()]);
  const failed = results.filter((result) => result.status === "fulfilled" && result.value === false).length;
  if (!failed) setAdminStatus("后台已登录，可以管理论坛留言和内容列表。");
}

async function loadContentEntries() {
  contentTools.classList.remove("is-hidden");
  contentList.innerHTML = "";
  contentCount.textContent = "正在读取...";

  const { data, error } = await supabase.rpc("site_admin_list_entries", {
    admin_password: adminPassword,
  });

  if (error) {
    contentCount.textContent = "读取失败";
    contentList.appendChild(textNode("p", "内容列表读取失败，请确认内容 SQL 已执行。", "forum-empty"));
    setAdminStatus("部分后台功能读取失败，请确认密码正确，或检查 SQL 是否已执行。", true);
    return false;
  }

  contentCount.textContent = `共 ${(data || []).length} 条内容`;
  renderContentEntries(data || []);
  return true;
}

function renderContentEntries(entries) {
  contentList.innerHTML = "";

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

    const editButton = document.createElement("button");
    editButton.className = "button secondary small-button";
    editButton.type = "button";
    editButton.textContent = "编辑";
    editButton.addEventListener("click", () => fillContentForm(entry));

    const deleteButton = document.createElement("button");
    deleteButton.className = "button secondary small-button danger-button";
    deleteButton.type = "button";
    deleteButton.textContent = "删除";
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

async function loadForumPosts() {
  forumTools.classList.remove("is-hidden");
  forumList.innerHTML = "";
  forumCount.textContent = "正在读取...";

  const { data, error } = await supabase.rpc("site_admin_list_forum_posts", {
    admin_password: adminPassword,
  });

  if (error) {
    forumCount.textContent = "需要执行 SQL";
    forumList.appendChild(textNode("p", "论坛管理还没启用，请先执行 supabase-forum-admin.sql。", "forum-empty"));
    setAdminStatus("论坛留言管理还没启用；内容列表可以继续使用。", true);
    return false;
  }

  forumCount.textContent = `共 ${(data || []).length} 条公开留言`;
  renderForumPosts(data || []);
  return true;
}

function renderForumPosts(posts) {
  forumList.innerHTML = "";

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

    const actions = document.createElement("div");
    actions.className = "admin-actions";

    const hideButton = document.createElement("button");
    hideButton.className = "button secondary small-button danger-button";
    hideButton.type = "button";
    hideButton.textContent = "隐藏留言";
    hideButton.addEventListener("click", () => hideForumPost(post));
    actions.appendChild(hideButton);

    const message = post.is_private ? "私密留言正文已加密，后台不显示原文。" : shortText(post.message);
    card.append(
      meta,
      textNode("h2", post.title || "未命名留言"),
      textNode("p", message, "admin-message"),
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

async function saveContentEntry(event) {
  event.preventDefault();
  if (!adminPassword) return setAdminStatus("请先输入后台密码。", true);

  const formData = new FormData(contentForm);
  const payload = {
    admin_password: adminPassword,
    entry_id: formData.get("id") || null,
    entry_kind: String(formData.get("kind") || "idea"),
    entry_title: String(formData.get("title") || "").trim().slice(0, 80),
    entry_summary: String(formData.get("summary") || "").trim().slice(0, 360),
    entry_tag: String(formData.get("tag") || "").trim().slice(0, 40),
    entry_url: String(formData.get("url") || "").trim().slice(0, 300),
    entry_published: Boolean(formData.get("is_published")),
    entry_sort_order: Number(formData.get("sort_order") || 100),
  };

  if (!payload.entry_title || !payload.entry_summary) {
    setAdminStatus("标题和简介都要填写。", true);
    return;
  }

  contentSave.disabled = true;
  contentSave.textContent = "保存中...";

  const { error } = await supabase.rpc("site_admin_upsert_entry", payload);

  contentSave.disabled = false;
  contentSave.textContent = payload.entry_id ? "保存修改" : "保存内容";

  if (error) {
    setAdminStatus("保存失败，请刷新后再试。", true);
    return;
  }

  resetContentForm();
  await loadContentEntries();
  setAdminStatus("内容已保存。网站页面会自动读取最新列表。");
}

async function deleteContentEntry(entry) {
  const confirmed = window.confirm(`确定删除《${entry.title}》吗？删除后不能恢复。`);
  if (!confirmed) return;

  const { error } = await supabase.rpc("site_admin_delete_entry", {
    admin_password: adminPassword,
    entry_id: entry.id,
  });

  if (error) {
    setAdminStatus("删除失败，请重新登录后再试。", true);
    return;
  }

  await loadContentEntries();
  setAdminStatus("内容已删除。");
}

async function hideForumPost(post) {
  const confirmed = window.confirm(`确定隐藏《${post.title || "这条留言"}》吗？前台会立即不显示。`);
  if (!confirmed) return;

  const { error } = await supabase.rpc("site_admin_hide_forum_post", {
    admin_password: adminPassword,
    target_post_id: post.id,
  });

  if (error) {
    setAdminStatus("隐藏留言失败，请确认论坛管理 SQL 已执行。", true);
    return;
  }

  await loadForumPosts();
  setAdminStatus("留言已隐藏，前台不会再显示。");
}

loginButton.addEventListener("click", () => {
  adminPassword = passwordInput.value.trim();
  if (!adminPassword) {
    setAdminStatus("请输入后台密码。", true);
    return;
  }

  loadDashboard();
});

contentRefresh.addEventListener("click", loadContentEntries);
contentReset.addEventListener("click", resetContentForm);
contentForm.addEventListener("submit", saveContentEntry);
forumRefresh.addEventListener("click", loadForumPosts);
passwordInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") loginButton.click();
});
