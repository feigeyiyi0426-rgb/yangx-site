import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const SUPABASE_URL = "https://mhiboklauvzlhkjpvruc.supabase.co";
const SUPABASE_KEY = "sb_publishable_o3CbW6HAEdH1gXhvspkQxg_c77efkXj";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

const pageKind = document.body.dataset.contentKind;
const list = document.querySelector("[data-content-list]");
const statusText = document.querySelector("[data-content-status]");

function setStatus(message, isError = false) {
  if (!statusText) return;
  statusText.textContent = message;
  statusText.classList.toggle("is-error", isError);
}

function renderEntries(entries) {
  list.innerHTML = "";

  entries.forEach((entry) => {
    const article = document.createElement("article");
    article.className = "project-item";

    const marker = document.createElement("span");
    marker.setAttribute("aria-hidden", "true");

    const body = document.createElement("div");
    const title = document.createElement("h3");
    title.textContent = entry.title;

    const summary = document.createElement("p");
    summary.textContent = entry.summary;

    body.append(title, summary);

    const footer = document.createElement("div");
    footer.className = "content-entry-meta";

    if (entry.tag) {
      const tag = document.createElement("small");
      tag.textContent = entry.tag;
      footer.appendChild(tag);
    }

    if (entry.url) {
      const link = document.createElement("a");
      link.href = entry.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = "打开链接";
      footer.appendChild(link);
    }

    if (footer.childElementCount) body.appendChild(footer);
    article.append(marker, body);
    list.appendChild(article);
  });
}

async function loadEntries() {
  if (!pageKind || !list) return;

  const { data, error } = await supabase
    .from("site_entries")
    .select("id,kind,title,summary,tag,url,sort_order,created_at")
    .eq("kind", pageKind)
    .eq("is_published", true)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: false });

  if (error) {
    setStatus("数据库列表还没启用，当前显示内置样例。", true);
    return;
  }

  if (!data || !data.length) {
    setStatus("还没有发布内容，当前显示内置样例。");
    return;
  }

  renderEntries(data);
  setStatus("内容已更新，可在管理页维护。");
}

loadEntries();
