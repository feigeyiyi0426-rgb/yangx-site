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
const refreshButton = document.querySelector("#admin-refresh");
const adminTools = document.querySelector("#admin-tools");
const adminStatus = document.querySelector("#admin-status");
const adminCount = document.querySelector("#admin-count");
const adminPosts = document.querySelector("#admin-posts");

const contentTools = document.querySelector("#content-tools");
const contentCount = document.querySelector("#content-count");
const contentList = document.querySelector("#content-list");
const contentForm = document.querySelector("#content-form");
const contentRefresh = document.querySelector("#content-refresh");
const contentReset = document.querySelector("#content-reset");
const contentSave = document.querySelector("#content-save");

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

async function loadAll() {
  const contentLoaded = await loadContentEntries();
  await loadPosts({ quiet: contentLoaded });
}

async function loadPosts({ quiet = false } = {}) {
  adminPosts.innerHTML = "";
  adminCount.textContent = "正在读取...";

  const { data, error } = await supabase.rpc("forum_admin_list_posts", {
    admin_password: adminPassword,
  });

  if (error) {
    adminTools.classList.remove("is-hidden");
    adminCount.textContent = "论坛后台暂时不可用";
    adminPosts.appendChild(textNode("p", "想法/项目后台可以先正常使用。论坛留言管理稍后再修。", "forum-empty"));
    if (!quiet) setAdminStatus("论坛后台读取失败，但想法/项目后台可以继续使用。", true);
    return false;
  }

  adminTools.classList.remove("is-hidden");
  if (!quiet) setAdminStatus("后台已登录。");
  adminCount.textContent = `共 ${data.length} 条留言`;
  renderPosts(data || []);
  return true;
}

function publicMessage(post) {
  if (post.is_private) return "私密留言：正文已加密，后台不显示私密正文。";
  return post.message || "";
}

function renderPosts(posts) {
  adminPosts.innerHTML = "";

  if (!posts.length) {
    adminPosts.appendChild(textNode("p", "暂无留言。", "forum-empty"));
    return;
  }

  posts.forEach((post) => {
    const card = document.createElement("article");
    card.className = "admin-post";

    const meta = document.createElement("div");
    meta.className = "admin-post-meta";
    meta.append(
      textNode("span", post.is_private ? `${post.category} / 私密` : post.category),
      textNode("span", post.is_hidden ? "已隐藏" : "公开显示"),
      textNode("time", formatDate(post.created_at))
    );

    const actions = document.createElement("div");
    actions.className = "admin-actions";

    const toggleButton = document.createElement("button");
    toggleButton.className = "button secondary small-button";
    toggleButton.type = "button";
    toggleButton.textContent = post.is_hidden ? "恢复显示" : "隐藏";
    toggleButton.addEventListener("click", () => setHidden(post.id, !post.is_hidden));

    const deleteButton = document.createElement("button");
    deleteButton.className = "button secondary small-button danger-button";
    deleteButton.type = "button";
    deleteButton.textContent = "删除";
    deleteButton.addEventListener("click", () => deletePost(post));

    actions.append(toggleButton, deleteButton);

    card.append(
      meta,
      textNode("h2", post.title),
      textNode("p", publicMessage(post), "admin-message"),
      textNode("p", `发布者：${post.name || "访客"}`, "admin-author"),
      actions
    );

    adminPosts.appendChild(card);
  });
}

async function setHidden(postId, hidden) {
  const { error } = await supabase.rpc("forum_admin_set_hidden", {
    admin_password: adminPassword,
    post_id: postId,
    hidden,
  });

  if (error) {
    setAdminStatus("论坛操作失败，稍后我再修论坛后台。", true);
    return;
  }

  await loadPosts();
}

async function deletePost(post) {
  const confirmed = window.confirm(`确定删除《${post.title}》吗？删除后不能恢复。`);
  if (!confirmed) return;

  const { error } = await supabase.rpc("forum_admin_delete_post", {
    admin_password: adminPassword,
    post_id: post.id,
  });

  if (error) {
    setAdminStatus("论坛删除失败，稍后我再修论坛后台。", true);
    return;
  }

  await loadPosts();
}

async function loadContentEntries() {
  contentList.innerHTML = "";
  contentCount.textContent = "正在读取...";

  const { data, error } = await supabase.rpc("site_admin_list_entries", {
    admin_password: adminPassword,
  });

  if (error) {
    contentTools.classList.add("is-hidden");
    contentCount.textContent = "读取失败";
    setAdminStatus("想法/项目后台读取失败。请确认修复版 SQL 已执行成功。", true);
    return false;
  }

  contentTools.classList.remove("is-hidden");
  contentCount.textContent = `共 ${(data || []).length} 条内容`;
  renderContentEntries(data || []);
  setAdminStatus("后台已登录。想法/项目可以使用。论坛管理如不可用，不影响这里。", false);
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
    setAdminStatus("保存失败。请确认修复版 SQL 已执行成功。", true);
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

loginButton.addEventListener("click", () => {
  adminPassword = passwordInput.value.trim();
  if (!adminPassword) {
    setAdminStatus("请输入后台密码。", true);
    return;
  }

  loadAll();
});

refreshButton.addEventListener("click", () => loadPosts());
contentRefresh.addEventListener("click", loadContentEntries);
contentReset.addEventListener("click", resetContentForm);
contentForm.addEventListener("submit", saveContentEntry);
passwordInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") loginButton.click();
});
