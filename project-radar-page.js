const radarList = document.querySelector("#project-radar-list");
const radarStatus = document.querySelector("#project-radar-status");
const refreshRadarButton = document.querySelector("#refresh-project-radar");
const RADAR_CACHE_KEY = "yangx-project-radar-cache-v1";
const RADAR_REQUEST_TIMEOUT_MS = 14000;

function createTextNode(tag, text, className) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.textContent = text;
  return node;
}

function formatDate(value) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function setRadarStatus(message, isError = false) {
  if (!radarStatus) return;
  radarStatus.textContent = message;
  radarStatus.classList.toggle("is-error", isError);
}

function readCachedRadar() {
  try {
    return JSON.parse(localStorage.getItem(RADAR_CACHE_KEY) || "null");
  } catch {
    return null;
  }
}

function saveCachedRadar(payload) {
  try {
    localStorage.setItem(RADAR_CACHE_KEY, JSON.stringify(payload));
  } catch {
    // 缓存失败不影响显示。
  }
}

async function fetchRadarPayload() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), RADAR_REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch("/api/project-radar", {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });

    if (!response.ok) throw new Error("project radar request failed");
    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function renderRadar(items, updatedAt) {
  radarList.innerHTML = "";

  if (!items.length) {
    radarList.appendChild(createTextNode("p", "暂时没有读取到项目资讯，请稍后刷新。", "news-empty"));
    return;
  }

  items.forEach((item) => {
    const article = document.createElement("article");
    article.className = "news-item project-radar-item";

    const meta = document.createElement("div");
    meta.className = "news-meta";
    meta.append(
      createTextNode("span", item.source || "项目来源"),
      createTextNode("span", item.category || "项目线索", "news-category")
    );

    const time = document.createElement("time");
    time.dateTime = item.publishedAt;
    time.textContent = formatDate(item.publishedAt);
    meta.appendChild(time);

    const link = document.createElement("a");
    link.className = "news-source-link";
    link.href = item.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = "查看来源";

    article.append(
      meta,
      createTextNode("h3", item.title || "项目线索"),
      createTextNode("p", item.summary || "点击来源查看详情。", "news-summary"),
      createTextNode("p", `关注：${item.focus || "科技项目观察"}`, "news-sector"),
      link
    );
    radarList.appendChild(article);
  });

  setRadarStatus(`已更新：${formatDate(updatedAt)}。显示全球科技项目线索。`);
}

async function loadRadar() {
  if (!radarList || !refreshRadarButton) return;

  refreshRadarButton.disabled = true;
  setRadarStatus("正在读取全球科技项目资讯...");

  const cached = readCachedRadar();
  if (cached?.items?.length) {
    renderRadar(cached.items, cached.updatedAt || new Date().toISOString());
    setRadarStatus("先显示上次项目资讯，正在后台更新...");
  }

  try {
    const payload = await fetchRadarPayload();
    saveCachedRadar(payload);
    renderRadar(payload.items || [], payload.updatedAt || new Date().toISOString());
  } catch {
    if (cached?.items?.length) {
      setRadarStatus("最新项目资讯暂时读取较慢，已保留上次结果。", true);
      return;
    }

    setRadarStatus("项目资讯读取失败，请稍后再试。", true);
    radarList.innerHTML = "";
    radarList.appendChild(createTextNode("p", "暂时无法连接项目资讯源。", "news-empty"));
  } finally {
    refreshRadarButton.disabled = false;
  }
}

refreshRadarButton?.addEventListener("click", loadRadar);
loadRadar();
