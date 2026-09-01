const SOURCES = [
  {
    name: "CoinDesk",
    category: "币圈快讯",
    homepage: "https://www.coindesk.com/",
    feed: "https://www.coindesk.com/arc/outboundfeeds/rss/?outputType=xml",
    type: "rss",
  },
  {
    name: "Cointelegraph",
    category: "币圈快讯",
    homepage: "https://cointelegraph.com/",
    feed: "https://cointelegraph.com/rss",
    type: "rss",
  },
];

const USER_AGENT = "YANGX News Module/1.0 (+https://www.yangx.xyz)";
const TRANSLATE_ENDPOINT = "https://api.mymemory.translated.net/get";
const SOURCE_TIMEOUT_MS = 6500;
const TRANSLATE_TIMEOUT_MS = 2600;

async function fetchWithTimeout(url, options = {}, timeoutMs = SOURCE_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
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

function linkFromItem(block) {
  const linkText = textBetween(block, "link");
  if (linkText) {
    return linkText;
  }

  const hrefMatch = block.match(/<link[^>]+href=["']([^"']+)["'][^>]*>/i);
  return decodeHtml(hrefMatch?.[1] || "");
}

function normalizeDate(value) {
  const timestamp = Date.parse(value || "");
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : new Date().toISOString();
}

function summarize(value) {
  const clean = stripTags(value);
  if (!clean) {
    return "新闻线索来自原始来源，请点击来源链接查看完整报道。";
  }

  return clean.length > 110 ? `${clean.slice(0, 110).trim()}...` : clean;
}

function hasChinese(value = "") {
  return /[\u3400-\u9fff]/.test(value);
}

function limitForTranslation(value = "") {
  const clean = String(value).replace(/\s+/g, " ").trim();
  const bytes = Buffer.from(clean, "utf8");

  if (bytes.length <= 460) {
    return clean;
  }

  let output = "";
  for (const char of clean) {
    const next = `${output}${char}`;
    if (Buffer.from(next, "utf8").length > 460) {
      break;
    }
    output = next;
  }

  return `${output.trim()}...`;
}

async function translateToChinese(value) {
  const text = limitForTranslation(value);

  if (!text || hasChinese(text)) {
    return text;
  }

  const url = new URL(TRANSLATE_ENDPOINT);
  url.searchParams.set("q", text);
  url.searchParams.set("langpair", "en|zh-CN");

  const result = await fetchWithTimeout(
    url,
    {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/json",
      },
    },
    TRANSLATE_TIMEOUT_MS
  );

  if (!result.ok) {
    throw new Error(`translation responded with ${result.status}`);
  }

  const payload = await result.json();
  return stripTags(payload?.responseData?.translatedText || text);
}

async function translateItem(item) {
  const originalTitle = item.title;
  const originalSummary = item.summary;

  try {
    const [title, summary] = await Promise.all([
      translateToChinese(item.title),
      translateToChinese(item.summary),
    ]);

    return {
      ...item,
      title: title || item.title,
      summary: compactText(summary || item.summary, 88),
      originalTitle,
      originalSummary,
      translation: "MyMemory 自动翻译",
    };
  } catch {
    return {
      ...item,
      originalTitle,
      originalSummary,
      translation: "自动翻译暂时不可用，已显示原文",
    };
  }
}

function compactText(value = "", maxLength = 88) {
  const clean = stripTags(value).replace(/\s+/g, " ").trim();
  return clean.length > maxLength ? `${clean.slice(0, maxLength).trim()}...` : clean;
}

function parseRss(xml, source) {
  const itemBlocks = xml.match(/<item[\s\S]*?<\/item>/gi) || xml.match(/<entry[\s\S]*?<\/entry>/gi) || [];

  return itemBlocks.slice(0, 12).map((block) => {
    const title = textBetween(block, "title");
    const summary =
      textBetween(block, "description") ||
      textBetween(block, "summary") ||
      textBetween(block, "content:encoded");

    return {
      source: source.name,
      category: source.category,
      title,
      summary: summarize(summary),
      url: linkFromItem(block) || source.homepage,
      publishedAt: normalizeDate(
        textBetween(block, "pubDate") || textBetween(block, "updated") || textBetween(block, "published")
      ),
      label: "转载摘要 / 新闻线索",
    };
  });
}

async function fetchSource(source) {
  const response = await fetchWithTimeout(source.feed, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "application/rss+xml, application/xml, text/xml",
    },
  });

  if (!response.ok) {
    throw new Error(`${source.name} responded with ${response.status}`);
  }

  const body = await response.text();
  return parseRss(body, source);
}

function interleaveBySource(items) {
  const grouped = new Map();

  for (const source of SOURCES) {
    grouped.set(source.name, items.filter((item) => item.source === source.name).slice(0, 10));
  }

  const mixed = [];
  for (let index = 0; index < 10; index += 1) {
    for (const source of SOURCES) {
      const nextItem = grouped.get(source.name)?.[index];
      if (nextItem) {
        mixed.push(nextItem);
      }
    }
  }

  return mixed;
}

module.exports = async function handler(_request, response) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=900");

  const settled = await Promise.allSettled(SOURCES.map(fetchSource));
  const errors = [];
  const items = settled.flatMap((result, index) => {
    if (result.status === "fulfilled") {
      return result.value;
    }

    errors.push({
      source: SOURCES[index].name,
      message: result.reason?.message || "source failed",
    });
    return [];
  });

  const unique = [];
  const seenUrls = new Set();

  for (const item of items) {
    if (!item.title || !item.url || seenUrls.has(item.url)) {
      continue;
    }

    seenUrls.add(item.url);
    unique.push(item);
  }

  const mixed = interleaveBySource(unique).slice(0, 20);
  const translated = await Promise.all(mixed.map(translateItem));

  response.status(200).json({
    updatedAt: new Date().toISOString(),
    disclaimer: "以下内容为自动翻译的转载摘要 / 新闻线索，完整内容以原始来源页面为准。",
    sources: SOURCES.map(({ name, homepage }) => ({ name, homepage })),
    items: translated,
    errors,
  });
};
