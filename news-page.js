const newsList = document.querySelector("#news-list");
const newsStatus = document.querySelector("#news-status");
const refreshNewsButton = document.querySelector("#refresh-news");
const NEWS_CACHE_KEY = "yangx-news-cache-v1";
const NEWS_REQUEST_TIMEOUT_MS = 12000;

const sectorRules = [
  { label: "AI算力", keywords: ["AI", "人工智能", "英伟达", "Nvidia", "数据中心", "云计算", "算力", "GPU"] },
  { label: "芯片半导体", keywords: ["芯片", "半导体", "英伟达", "Nvidia", "GPU", "台积电", "晶圆", "处理器"] },
  { label: "内存板块", keywords: ["内存", "存储", "HBM", "DRAM", "NAND", "数据中心", "AI", "人工智能"] },
  { label: "金融机构", keywords: ["银行", "高盛", "Goldman", "贝莱德", "BlackRock", "Apollo", "KKR", "融资", "华尔街"] },
  { label: "军工防务", keywords: ["军事", "导弹", "五角大楼", "国防", "防务", "军方", "武器", "舰", "战机"] },
  { label: "能源油气", keywords: ["石油", "油价", "天然气", "能源", "海湾", "伊朗", "封锁", "油轮"] },
  { label: "航运物流", keywords: ["航运", "船只", "港口", "海峡", "货船", "供应链", "运输"] },
  { label: "医药医疗", keywords: ["病毒", "疫情", "埃博拉", "医疗", "疫苗", "患者", "医院", "卫生"] },
  { label: "政策监管", keywords: ["政府", "总统", "国会", "法院", "监管", "政策", "边境", "制裁", "关税"] },
];

function createTextNode(tag, text, className) {
  const node = document.createElement(tag);
  if (className) {
    node.className = className;
  }
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

function setNewsStatus(message, isError = false) {
  newsStatus.textContent = message;
  newsStatus.classList.toggle("is-error", isError);
}

function readCachedNews() {
  try {
    return JSON.parse(localStorage.getItem(NEWS_CACHE_KEY) || "null");
  } catch {
    return null;
  }
}

function saveCachedNews(payload) {
  try {
    localStorage.setItem(NEWS_CACHE_KEY, JSON.stringify(payload));
  } catch {
    // 缓存失败不影响新闻显示。
  }
}

async function fetchNewsPayload() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), NEWS_REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch("/api/news", {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error("news request failed");
    }

    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function getSectorNote(item) {
  const text = `${item.category || ""} ${item.source || ""} ${item.title || ""} ${item.summary || ""} ${
    item.originalTitle || ""
  } ${item.originalSummary || ""}`;

  const matched = sectorRules
    .filter((rule) => rule.keywords.some((keyword) => text.toLowerCase().includes(keyword.toLowerCase())))
    .map((rule) => rule.label);

  const sectors = [...new Set(matched)].slice(0, 4);
  return sectors.length ? `影响：${sectors.join("、")}` : "影响：相关行业、市场情绪";
}

function renderNews(items, updatedAt) {
  newsList.innerHTML = "";

  if (!items.length) {
    newsList.appendChild(createTextNode("p", "暂时没有读取到新闻，请稍后刷新。", "news-empty"));
    return;
  }

  items.forEach((item) => {
    const article = document.createElement("article");
    article.className = "news-item";

    const meta = document.createElement("div");
    meta.className = "news-meta";
    meta.append(
      createTextNode("span", item.source || "新闻来源"),
      createTextNode("span", item.category || "快讯", "news-category")
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
      createTextNode("h3", item.title),
      createTextNode("p", item.summary, "news-summary"),
      createTextNode("p", getSectorNote(item), "news-sector"),
      link
    );
    newsList.appendChild(article);
  });

  setNewsStatus(`已更新：${formatDate(updatedAt)}。显示国际、军事、财经新闻线索。`);
}

async function loadNews() {
  refreshNewsButton.disabled = true;
  setNewsStatus("正在读取最新新闻...");

  const cached = readCachedNews();
  if (cached?.items?.length) {
    renderNews(cached.items, cached.updatedAt || new Date().toISOString());
    setNewsStatus("先显示上次新闻，正在后台更新...");
  }

  try {
    const payload = await fetchNewsPayload();
    saveCachedNews(payload);
    renderNews(payload.items || [], payload.updatedAt || new Date().toISOString());
  } catch {
    if (cached?.items?.length) {
      setNewsStatus("最新新闻暂时读取较慢，已保留上次结果。", true);
      return;
    }

    setNewsStatus("新闻读取失败，请稍后再试。", true);
    newsList.innerHTML = "";
    newsList.appendChild(createTextNode("p", "暂时无法连接新闻源。", "news-empty"));
  } finally {
    refreshNewsButton.disabled = false;
  }
}

refreshNewsButton.addEventListener("click", loadNews);
loadNews();
