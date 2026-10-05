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
  try {
    const response = await fetch(`/api/content?kind=${encodeURIComponent(pageKind)}`);
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "读取失败");
    if (!result.entries?.length) {
      setStatus("还没有发布内容，当前显示内置样例。");
      return;
    }
    renderEntries(result.entries);
    setStatus("内容已更新，可在网站后台维护。");
  } catch {
    setStatus("内容服务暂时不可用，当前显示内置样例。", true);
  }
}

loadEntries();
