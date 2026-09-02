const SOURCES = [
  {
    name: "Product Hunt",
    category: "新产品",
    homepage: "https://www.producthunt.com/",
    url: "https://www.producthunt.com/feed",
    type: "atom",
  },
  {
    name: "Hacker News",
    category: "技术讨论",
    homepage: "https://news.ycombinator.com/show",
    url: "https://hacker-news.firebaseio.com/v0/showstories.json",
    type: "hn",
  },
  {
    name: "GitHub Trending",
    category: "开源项目",
    homepage: "https://github.com/trending",
    url: "https://github.com/trending?since=daily",
    type: "github-trending",
  },
  {
    name: "arXiv AI",
    category: "AI 前沿",
    homepage: "https://arxiv.org/list/cs.AI/new",
    url: "https://export.arxiv.org/api/query?search_query=cat:cs.AI%20OR%20cat:cs.LG&sortBy=submittedDate&sortOrder=descending&max_results=8",
    type: "atom",
  },
];

const USER_AGENT = "YANGX Project Radar/1.0 (+https://www.yangx.xyz)";
const GOOGLE_TRANSLATE_ENDPOINT = "https://translate.googleapis.com/translate_a/single";
const MYMEMORY_TRANSLATE_ENDPOINT = "https://api.mymemory.translated.net/get";
const SOURCE_TIMEOUT_MS = 7000;
const TRANSLATE_TIMEOUT_MS = 3300;

async function fetchWithTimeout(url, options = {}, timeoutMs = SOURCE_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function decodeHtml(value = "") {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, "/");
}

function stripTags(value = "") {
  return decodeHtml(value)
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function textBetween(block, tagName) {
  const match = block.match(new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "i"));
  return stripTags(match?.[1] || "");
}

function getLink(block, source) {
  const rssLink = textBetween(block, "link");
  if (rssLink) return rssLink;

  const alternate = block.match(/<link[^>]+rel=["']alternate["'][^>]+href=["']([^"']+)["']/i);
  if (alternate?.[1]) return decodeHtml(alternate[1]);

  const anyHref = block.match(/<link[^>]+href=["']([^"']+)["']/i);
  if (anyHref?.[1]) return decodeHtml(anyHref[1]);

  return textBetween(block, "id") || source.homepage;
}

function normalizeDate(value) {
  const timestamp = Date.parse(value || "");
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : new Date().toISOString();
}

function compactText(value = "", maxLength = 92) {
  const clean = stripTags(value).replace(/\s+/g, " ").trim();
  return clean.length > maxLength ? `${clean.slice(0, maxLength).trim()}...` : clean;
}

function hasChinese(value = "") {
  return /[\u3400-\u9fff]/.test(value);
}

function mostlyEnglish(value = "") {
  const letters = String(value).match(/[A-Za-z]/g)?.length || 0;
  const chinese = String(value).match(/[\u3400-\u9fff]/g)?.length || 0;
  return letters > chinese * 2 + 12;
}

function limitForTranslation(value = "") {
  const clean = String(value).replace(/\s+/g, " ").trim();
  const bytes = Buffer.from(clean, "utf8");
  if (bytes.length <= 430) return clean;

  let output = "";
  for (const char of clean) {
    const next = `${output}${char}`;
    if (Buffer.from(next, "utf8").length > 430) break;
    output = next;
  }
  return `${output.trim()}...`;
}

function parseGoogleTranslation(payload) {
  if (!Array.isArray(payload?.[0])) return "";
  return payload[0]
    .map((part) => (Array.isArray(part) ? part[0] : ""))
    .join("")
    .trim();
}

async function translateWithGoogle(text) {
  const url = new URL(GOOGLE_TRANSLATE_ENDPOINT);
  url.searchParams.set("client", "gtx");
  url.searchParams.set("sl", "en");
  url.searchParams.set("tl", "zh-CN");
  url.searchParams.set("dt", "t");
  url.searchParams.set("q", text);

  const result = await fetchWithTimeout(
    url,
    { headers: { "User-Agent": USER_AGENT, Accept: "application/json, text/plain, */*" } },
    TRANSLATE_TIMEOUT_MS
  );

  if (!result.ok) throw new Error(`google translation responded with ${result.status}`);
  return stripTags(parseGoogleTranslation(await result.json()));
}

async function translateWithMyMemory(text) {
  const url = new URL(MYMEMORY_TRANSLATE_ENDPOINT);
  url.searchParams.set("q", text);
  url.searchParams.set("langpair", "en|zh-CN");

  const result = await fetchWithTimeout(
    url,
    { headers: { "User-Agent": USER_AGENT, Accept: "application/json" } },
    TRANSLATE_TIMEOUT_MS
  );

  if (!result.ok) throw new Error(`mymemory translation responded with ${result.status}`);
  const payload = await result.json();
  return stripTags(payload?.responseData?.translatedText || text);
}

async function translateToChinese(value) {
  const text = limitForTranslation(value);
  if (!text || (hasChinese(text) && !mostlyEnglish(text))) return text;

  try {
    const translated = await translateWithGoogle(text);
    if (translated && !mostlyEnglish(translated)) return translated;
  } catch {
    // 备用翻译继续尝试。
  }

  return translateWithMyMemory(text);
}

function getProjectFocus(item) {
  const text = `${item.source} ${item.category} ${item.title} ${item.summary} ${item.originalTitle || ""} ${item.originalSummary || ""}`.toLowerCase();
  const rules = [
    { label: "AI 工具", words: ["ai", "agent", "llm", "model", "chatbot", "人工智能", "模型"] },
    { label: "开发者工具", words: ["developer", "api", "sdk", "github", "cli", "devtool", "code", "代码", "开源"] },
    { label: "创业产品", words: ["startup", "launch", "product", "founder", "saas", "创业", "产品"] },
    { label: "数据/自动化", words: ["data", "automation", "workflow", "database", "analytics", "自动化", "数据"] },
    { label: "机器人/硬件", words: ["robot", "hardware", "chip", "sensor", "机器人", "硬件", "芯片"] },
    { label: "安全", words: ["security", "privacy", "auth", "安全", "隐私", "加密"] },
  ];

  const matched = rules
    .filter((rule) => rule.words.some((word) => text.includes(word)))
    .map((rule) => rule.label);

  return [...new Set(matched)].slice(0, 3).join("、") || "科技项目观察";
}

async function translateItem(item) {
  const originalTitle = item.title;
  const originalSummary = item.summary;

  try {
    const [title, summary] = await Promise.all([
      translateToChinese(item.title),
      translateToChinese(item.summary),
    ]);
    const translated = {
      ...item,
      title: compactText(title || item.title, 76),
      summary: compactText(summary || item.summary, 92),
      originalTitle,
      originalSummary,
      translation: "自动中文翻译",
    };
    return { ...translated, focus: getProjectFocus(translated) };
  } catch {
    const fallback = {
      ...item,
      title: compactText(item.title, 76),
      summary: compactText(item.summary, 92),
      originalTitle,
      originalSummary,
      translation: "自动翻译暂时不可用，已显示原文",
    };
    return { ...fallback, focus: getProjectFocus(fallback) };
  }
}

function parseXmlFeed(xml, source) {
  const blocks = xml.match(/<item[\s\S]*?<\/item>/gi) || xml.match(/<entry[\s\S]*?<\/entry>/gi) || [];

  return blocks.slice(0, 7).map((block) => {
    const summary =
      textBetween(block, "description") ||
      textBetween(block, "summary") ||
      textBetween(block, "content") ||
      textBetween(block, "content:encoded") ||
      "项目线索来自原始来源，点击来源查看详情。";

    return {
      source: source.name,
      category: source.category,
      title: textBetween(block, "title"),
      summary: compactText(summary),
      url: getLink(block, source),
      publishedAt: normalizeDate(textBetween(block, "pubDate") || textBetween(block, "updated") || textBetween(block, "published")),
      label: "转载摘要 / 项目线索",
    };
  });
}

function parseGithubTrending(html, source) {
  const articleBlocks = html.match(/<article[\s\S]*?<\/article>/gi) || [];

  return articleBlocks.slice(0, 7).map((block) => {
    const repoMatch = block.match(/href=["'](\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)["']/i);
    const repoPath = repoMatch?.[1] || "";
    const title = repoPath ? repoPath.slice(1).replace("/", " / ") : textBetween(block, "h2");
    const descMatch = block.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
    const summary = compactText(descMatch?.[1] || "GitHub 今日热门开源项目，点击来源查看代码和趋势。", 92);

    return {
      source: source.name,
      category: source.category,
      title,
      summary,
      url: repoPath ? `https://github.com${repoPath}` : source.homepage,
      publishedAt: new Date().toISOString(),
      label: "转载摘要 / 项目线索",
    };
  });
}

async function parseHackerNews(source) {
  const idsResponse = await fetchWithTimeout(source.url, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
  });
  if (!idsResponse.ok) throw new Error(`${source.name} responded with ${idsResponse.status}`);

  const ids = (await idsResponse.json()).slice(0, 10);
  const settled = await Promise.allSettled(
    ids.map((id) =>
      fetchWithTimeout(`https://hacker-news.firebaseio.com/v0/item/${id}.json`, {
        headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      }).then((result) => result.json())
    )
  );

  return settled
    .filter((result) => result.status === "fulfilled" && result.value?.title)
    .slice(0, 7)
    .map((result) => {
      const item = result.value;
      return {
        source: source.name,
        category: source.category,
        title: item.title,
        summary: item.text ? compactText(item.text) : "Hacker News 技术圈项目讨论，点击来源查看评论和原帖。",
        url: item.url || `https://news.ycombinator.com/item?id=${item.id}`,
        publishedAt: item.time ? new Date(item.time * 1000).toISOString() : new Date().toISOString(),
        label: "转载摘要 / 项目线索",
      };
    });
}

async function fetchSource(source) {
  if (source.type === "hn") return parseHackerNews(source);

  const response = await fetchWithTimeout(source.url, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: source.type === "github-trending" ? "text/html" : "application/rss+xml, application/xml, text/xml",
    },
  });

  if (!response.ok) throw new Error(`${source.name} responded with ${response.status}`);
  const body = await response.text();

  if (source.type === "github-trending") return parseGithubTrending(body, source);
  return parseXmlFeed(body, source);
}

function interleaveBySource(items) {
  const grouped = new Map();
  for (const source of SOURCES) {
    grouped.set(source.name, items.filter((item) => item.source === source.name).slice(0, 4));
  }

  const mixed = [];
  for (let index = 0; index < 4; index += 1) {
    for (const source of SOURCES) {
      const nextItem = grouped.get(source.name)?.[index];
      if (nextItem) mixed.push(nextItem);
    }
  }

  return mixed;
}

module.exports = async function handler(_request, response) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Cache-Control", "s-maxage=900, stale-while-revalidate=1800");

  const settled = await Promise.allSettled(SOURCES.map(fetchSource));
  const errors = [];
  const items = settled.flatMap((result, index) => {
    if (result.status === "fulfilled") return result.value;
    errors.push({ source: SOURCES[index].name, message: result.reason?.message || "source failed" });
    return [];
  });

  const unique = [];
  const seenUrls = new Set();
  for (const item of items) {
    if (!item.title || !item.url || seenUrls.has(item.url)) continue;
    seenUrls.add(item.url);
    unique.push(item);
  }

  const mixed = interleaveBySource(unique).slice(0, 16);
  const translated = await Promise.all(mixed.map(translateItem));

  response.status(200).json({
    updatedAt: new Date().toISOString(),
    disclaimer: "以下内容为自动翻译的转载摘要 / 项目线索，完整内容以原始来源页面为准。",
    sources: SOURCES.map(({ name, homepage }) => ({ name, homepage })),
    items: translated,
    errors,
  });
};
