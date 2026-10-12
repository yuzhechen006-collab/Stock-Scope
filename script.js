//stockscope shared javascript: stock analysis + company insights

//get a free key at https://www.alphavantage.co/support/#api-key
const API_KEY = "ZLQQTKVW58WS222S";

//optional: url of your ai proxy (see worker.js). leave empty to hide the ai panel
const AI_ENDPOINT = "";

//cached responses are reused for this long (free tier only allows ~25 calls a day)
const CACHE_HOURS = 12;

const $ = (id) => document.getElementById(id);

//----- helpers -----

function showMessage(id, message) {
  const element = $(id);
  if (!element) return;

  element.textContent = message;
  element.hidden = !message;
}

function setLoading(button, loading, loadingText = "Loading…") {
  if (!button) return;

  if (loading) {
    button.dataset.originalText = button.innerHTML;
    button.innerHTML = loadingText;
    button.disabled = true;
  } else {
    button.innerHTML = button.dataset.originalText || button.innerHTML;
    button.disabled = false;
  }
}

function cleanTicker(value) {
  return value.trim().toUpperCase();
}

function isValidTicker(ticker) {
  //allows formats like BRK.B
  return /^[A-Z0-9][A-Z0-9.-]{0,9}$/.test(ticker);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function setUrlTicker(ticker) {
  try {
    const url = new URL(window.location.href);
    url.searchParams.set("ticker", ticker);
    window.history.replaceState(null, "", url);
  } catch (error) {
    //not critical
  }
}

//----- cache -----

function cacheKey(params) {
  return "stockscope:" + Object.values(params).join("|");
}

function readCache(params) {
  try {
    const raw = localStorage.getItem(cacheKey(params));
    if (!raw) return null;

    const { time, data } = JSON.parse(raw);
    if (Date.now() - time > CACHE_HOURS * 3600 * 1000) return null;

    return data;
  } catch (error) {
    return null;
  }
}

function writeCache(params, data) {
  try {
    localStorage.setItem(
      cacheKey(params),
      JSON.stringify({ time: Date.now(), data })
    );
  } catch (error) {
    //storage full or blocked, just skip caching
  }
}

//----- demo mode -----

//shown automatically when the live api can't answer (usually the free daily limit).
//the figures below are illustrative sample data, not real market prices.
//to add a ticker, add a profile here: price is the last close, vol/drift are daily % moves,
//financials are [fiscal year, revenue in $bn, net income in $bn], roughly rounded.
const DEMO_PROFILES = {
  AAPL: {
    name: "Apple Inc.", sector: "Technology", industry: "Consumer Electronics", exchange: "NASDAQ",
    description: "Apple designs and sells smartphones, computers, tablets and wearables, and earns a growing share of its income from services such as the App Store, iCloud and Apple Music.",
    employees: 164000, price: 230, vol: 1.5, drift: 0.05, beta: 1.1, pe: 35, dividend: 0.004, marketCap: 3.4e12,
    fiscalEnd: "09-30",
    financials: [[2020, 274.5, 57.4], [2021, 365.8, 94.7], [2022, 394.3, 99.8], [2023, 383.3, 97.0], [2024, 391.0, 93.7]]
  },
  MSFT: {
    name: "Microsoft Corporation", sector: "Technology", industry: "Software - Infrastructure", exchange: "NASDAQ",
    description: "Microsoft develops software, cloud services and devices, including Windows, Office, Azure cloud computing, LinkedIn and Xbox.",
    employees: 228000, price: 480, vol: 1.3, drift: 0.05, beta: 0.9, pe: 35, dividend: 0.008, marketCap: 3.6e12,
    fiscalEnd: "06-30",
    financials: [[2020, 143.0, 44.3], [2021, 168.1, 61.3], [2022, 198.3, 72.7], [2023, 211.9, 72.4], [2024, 245.1, 88.1]]
  },
  NVDA: {
    name: "NVIDIA Corporation", sector: "Technology", industry: "Semiconductors", exchange: "NASDAQ",
    description: "NVIDIA designs graphics processors and AI computing hardware and software, used in gaming, data centres, professional visualisation and autonomous vehicles.",
    employees: 36000, price: 180, vol: 2.8, drift: 0.7, beta: 1.8, pe: 50, dividend: 0.0003, marketCap: 4.4e12,
    fiscalEnd: "01-31",
    financials: [[2021, 16.7, 4.3], [2022, 26.9, 9.8], [2023, 27.0, 4.4], [2024, 60.9, 29.8], [2025, 130.5, 72.9]]
  },
  IBM: {
    name: "International Business Machines Corporation", sector: "Technology", industry: "Information Technology Services", exchange: "NYSE",
    description: "IBM provides hybrid cloud, AI, consulting and enterprise software and hardware to large organisations around the world.",
    employees: 270000, price: 280, vol: 1.4, drift: 0.04, beta: 0.7, pe: 40, dividend: 0.025, marketCap: 2.6e11,
    fiscalEnd: "12-31",
    financials: [[2020, 55.2, 5.6], [2021, 57.4, 5.7], [2022, 60.5, 1.6], [2023, 61.9, 7.5], [2024, 62.8, 6.0]]
  }
};

const DEMO_TICKERS = Object.keys(DEMO_PROFILES);

function hashString(text) {
  let hash = 2166136261;

  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

//small seeded random generator, so a ticker always gets the same demo chart
function seededRandom(seed) {
  let a = seed >>> 0;

  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

//the last `count` weekdays, oldest first, ending yesterday
function demoTradingDays(count) {
  const days = [];
  const date = new Date();
  date.setUTCHours(12, 0, 0, 0);

  while (days.length < count) {
    date.setUTCDate(date.getUTCDate() - 1);
    const weekday = date.getUTCDay();
    if (weekday !== 0 && weekday !== 6) days.push(date.toISOString().slice(0, 10));
  }

  return days.reverse();
}

function buildDemoSeries(ticker, profile) {
  const random = seededRandom(hashString(ticker));
  const gaussian = () => Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random());

  const days = demoTradingDays(100);
  const raw = [];
  let price = 100;

  days.forEach(() => {
    price *= 1 + (profile.drift + gaussian() * profile.vol) / 100;
    raw.push(price);
  });

  //rescale so the series ends at the profile's price
  const scale = profile.price / raw[raw.length - 1];
  const series = {};

  days.forEach((date, i) => {
    series[date] = { "4. close": (raw[i] * scale).toFixed(2) };
  });

  return series;
}

//returns data in the same shape as alpha vantage, or null if there is no demo for this ticker
function demoResponse(params) {
  const ticker = String(params.symbol || "").toUpperCase();
  const profile = DEMO_PROFILES[ticker];

  if (!profile) return null;

  if (params.function === "TIME_SERIES_DAILY") {
    return { "Time Series (Daily)": buildDemoSeries(ticker, profile) };
  }

  if (params.function === "OVERVIEW") {
    return {
      Symbol: ticker,
      Name: profile.name,
      Sector: profile.sector,
      Industry: profile.industry,
      Exchange: profile.exchange,
      Currency: "USD",
      Description: profile.description,
      FullTimeEmployees: String(profile.employees),
      MarketCapitalization: String(profile.marketCap),
      PERatio: String(profile.pe),
      Beta: String(profile.beta),
      DividendYield: String(profile.dividend),
      "52WeekLow": (profile.price * 0.78).toFixed(2),
      "52WeekHigh": (profile.price * 1.08).toFixed(2)
    };
  }

  if (params.function === "INCOME_STATEMENT") {
    return {
      symbol: ticker,
      annualReports: profile.financials.map(([year, revenue, netIncome]) => ({
        fiscalDateEnding: `${year}-${profile.fiscalEnd}`,
        totalRevenue: String(Math.round(revenue * 1e9)),
        netIncome: String(Math.round(netIncome * 1e9))
      }))
    };
  }

  return null;
}

//notice shown above the results while demo data is on screen
function setDemoBanner(anchorId, show) {
  let banner = $("demoBanner");

  if (!show) {
    if (banner) banner.hidden = true;
    return;
  }

  if (!banner) {
    const style = document.createElement("style");
    style.textContent = `
      .demo-banner {
        margin: 0 0 1.25rem;
        padding: 0.85rem 1.1rem;
        border: 1px solid #f5c997;
        border-radius: 12px;
        background: #fff7ed;
        color: #8a4b0f;
        font-size: 0.92rem;
        line-height: 1.5;
      }
    `;
    document.head.append(style);

    banner = document.createElement("p");
    banner.id = "demoBanner";
    banner.className = "demo-banner";
    banner.setAttribute("role", "status");

    const strong = document.createElement("strong");
    strong.textContent = "Demo data, live limit reached. ";

    banner.append(
      strong,
      "The live data service has hit its daily request limit, so this page is showing illustrative sample figures, not real market prices. Live data returns automatically once the limit resets."
    );
  }

  const anchor = $(anchorId);
  if (anchor) anchor.before(banner);
  banner.hidden = false;
}

//----- api -----

//one live request. errors flagged fallbackToDemo mean "the live service can't answer right now"
async function liveRequest(params) {
  const url = new URL("https://www.alphavantage.co/query");

  Object.entries({ ...params, apikey: API_KEY }).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });

  let response;

  try {
    response = await fetch(url);
  } catch (error) {
    const networkError = new Error("Could not reach the data service. Check your connection and try again.");
    networkError.fallbackToDemo = true;
    throw networkError;
  }

  if (!response.ok) {
    const httpError = new Error(`The data service returned HTTP ${response.status}. Please try again later.`);
    httpError.fallbackToDemo = true;
    throw httpError;
  }

  const data = await response.json();

  //"Note" and "Information" are how alpha vantage reports the daily or per-minute limit
  if (data.Note || data.Information) {
    const limitError = new Error(data.Note || data.Information);
    limitError.fallbackToDemo = true;
    throw limitError;
  }

  //a bad ticker is a real error, not a reason to show demo data
  if (data["Error Message"]) {
    throw new Error(data["Error Message"]);
  }

  return data;
}

//returns { data, cached, demo }
async function fetchAlphaVantage(params) {
  const cached = readCache(params);
  if (cached) return { data: cached, cached: true, demo: false };

  if (!API_KEY || API_KEY === "YOUR_API_KEY") {
    throw new Error("Add your Alpha Vantage API key in script.js before searching.");
  }

  try {
    const data = await liveRequest(params);
    writeCache(params, data);
    return { data, cached: false, demo: false };
  } catch (error) {
    if (!error.fallbackToDemo) throw error;

    const data = demoResponse(params);

    //demo data is never cached, so live data takes over as soon as the limit resets
    if (data) return { data, cached: false, demo: true };

    throw new Error(
      `The live data limit has been reached, and demo data is only available for ${DEMO_TICKERS.join(", ")}. Try one of those, or come back tomorrow.`
    );
  }
}

//----- formatting -----

function formatPercent(value, decimals = 2) {
  if (!Number.isFinite(value)) return "—";

  return `${value >= 0 ? "+" : ""}${value.toFixed(decimals)}%`;
}

function formatMoney(value, currency = "USD", decimals = 2) {
  if (!Number.isFinite(value)) return "—";

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: decimals,
    minimumFractionDigits: decimals
  }).format(value);
}

function formatLargeNumber(value, currency = "USD") {
  if (!Number.isFinite(value)) return "—";

  const abs = Math.abs(value);

  if (abs >= 1e12) return `${currency} ${(value / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${currency} ${(value / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${currency} ${(value / 1e6).toFixed(2)}M`;

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0
  }).format(value);
}

function parseNumeric(value) {
  if (value === null || value === undefined || value === "" || value === "None" || value === "-") {
    return null;
  }

  const number = Number(value);

  return Number.isFinite(number) ? number : null;
}

function formatWholeNumber(value) {
  if (!Number.isFinite(value)) return "—";

  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}

//----- ai explainer (hidden unless AI_ENDPOINT is set) -----

let aiContext = null;

function initAiPanel() {
  const panel = $("aiPanel");
  if (!panel) return;

  if (!AI_ENDPOINT) {
    panel.hidden = true;
    return;
  }

  const form = $("aiForm");
  const input = $("aiQuestion");
  const button = $("aiBtn");
  const answer = $("aiAnswer");

  document.querySelectorAll("[data-ai-prompt]").forEach((chip) => {
    chip.addEventListener("click", () => {
      input.value = chip.dataset.aiPrompt;
      form.requestSubmit();
    });
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const question = input.value.trim();
    if (!question || !aiContext) return;

    setLoading(button, true, "Thinking…");
    answer.hidden = false;
    answer.textContent = "…";

    try {
      const response = await fetch(AI_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, context: aiContext })
      });

      if (!response.ok) throw new Error(`The AI service returned HTTP ${response.status}.`);

      const result = await response.json();
      answer.textContent = result.answer || "No answer was returned.";
    } catch (error) {
      answer.textContent = error.message || "Could not reach the AI service.";
    } finally {
      setLoading(button, false);
    }
  });
}

function setAiContext(context) {
  aiContext = context;

  const panel = $("aiPanel");
  if (panel && AI_ENDPOINT) panel.hidden = false;

  const answer = $("aiAnswer");
  if (answer) {
    answer.hidden = true;
    answer.textContent = "";
  }
}

//----- page 1: stock analysis -----

function movingAverage(values, windowSize) {
  return values.map((_, i) => {
    if (i < windowSize - 1) return null;

    let sum = 0;
    for (let j = i - windowSize + 1; j <= i; j++) sum += values[j];

    return sum / windowSize;
  });
}

function calculateStockStats(prices) {
  const returns = [];

  for (let i = 1; i < prices.length; i++) {
    if (prices[i - 1] !== 0) returns.push((prices[i] / prices[i - 1] - 1) * 100);
  }

  if (returns.length === 0) return null;

  const meanReturn = returns.reduce((sum, v) => sum + v, 0) / returns.length;

  //sample standard deviation, annualised with 252 trading days
  const variance = returns.length > 1
    ? returns.reduce((sum, v) => sum + (v - meanReturn) ** 2, 0) / (returns.length - 1)
    : 0;

  const dailyVol = Math.sqrt(variance);
  const annualVol = dailyVol * Math.sqrt(252);

  //biggest fall from a previous peak
  let peak = prices[0];
  let maxDrawdown = 0;

  prices.forEach((price) => {
    peak = Math.max(peak, price);
    maxDrawdown = Math.min(maxDrawdown, (price / peak - 1) * 100);
  });

  const latest = prices[prices.length - 1];

  return {
    meanReturn,
    dailyVol,
    annualVol,
    maxDrawdown,
    periodReturn: (latest / prices[0] - 1) * 100,
    dayChange: (latest / prices[prices.length - 2] - 1) * 100,
    bestDay: Math.max(...returns),
    worstDay: Math.min(...returns),
    minPrice: Math.min(...prices),
    maxPrice: Math.max(...prices),
    latest
  };
}

function initStockAnalysis() {
  const form = $("stockSearchForm");
  if (!form) return;

  const tickerInput = $("tickerInput");
  const analyseButton = $("analyseBtn");

  let priceChart = null;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const ticker = cleanTicker(tickerInput.value);

    showMessage("error", "");

    if (!ticker || !isValidTicker(ticker)) {
      showMessage("error", "Enter a valid ticker symbol, such as AAPL, MSFT or IBM.");
      return;
    }

    setLoading(analyseButton, true, "Analysing…");
    showMessage("stockLoading", "Fetching historical stock prices…");

    try {
      const { data, cached, demo } = await fetchAlphaVantage({
        function: "TIME_SERIES_DAILY",
        symbol: ticker,
        outputsize: "compact"
      });

      const timeSeries = data["Time Series (Daily)"];

      if (!timeSeries) {
        throw new Error("No daily price data was returned. Check the ticker symbol or try again later.");
      }

      const records = Object.entries(timeSeries)
        .map(([date, values]) => ({ date, close: Number(values["4. close"]) }))
        .filter((item) => Number.isFinite(item.close))
        .sort((a, b) => a.date.localeCompare(b.date));

      if (records.length < 2) {
        throw new Error("There is not enough historical data to calculate returns.");
      }

      const prices = records.map((item) => item.close);
      const dates = records.map((item) => item.date);
      const stats = calculateStockStats(prices);

      if (!stats) {
        throw new Error("Daily returns could not be calculated for this stock.");
      }

      const latestDate = dates[dates.length - 1];

      $("stockTitle").textContent = `${ticker} Stock Analysis`;
      $("stockSubtitle").textContent =
        `${records.length} daily closing prices · Latest date: ${latestDate}${demo ? " · demo data" : cached ? " · saved data" : ""}`;

      $("latestClose").textContent = formatMoney(stats.latest);
      $("latestChange").textContent = `${formatPercent(stats.dayChange)} vs previous close`;
      $("periodReturn").textContent = formatPercent(stats.periodReturn);
      $("maxDrawdown").textContent = `${stats.maxDrawdown.toFixed(2)}%`;
      $("minMax").textContent = `${formatMoney(stats.minPrice)} – ${formatMoney(stats.maxPrice)}`;

      $("meanReturn").textContent = formatPercent(stats.meanReturn);
      $("dailyVol").textContent = `${stats.dailyVol.toFixed(2)}%`;
      $("annualVol").textContent = `${stats.annualVol.toFixed(2)}%`;
      $("bestWorst").textContent =
        `${formatPercent(stats.bestDay)} / ${formatPercent(stats.worstDay)}`;

      const insightsUrl = `company.html?ticker=${encodeURIComponent(ticker)}`;

      $("companyInsightsLink").href = insightsUrl;
      $("companyInsightsCta").href = insightsUrl;

      $("stockResults").hidden = false;
      $("stockWelcome").hidden = true;

      setDemoBanner("stockResults", demo);

      drawPriceChart(dates, prices, ticker, priceChart, (chart) => {
        priceChart = chart;
      });

      setUrlTicker(ticker);

      setAiContext({
        page: "stock analysis",
        ticker,
        days: records.length,
        latestDate,
        latestClose: stats.latest,
        periodReturnPct: stats.periodReturn,
        avgDailyReturnPct: stats.meanReturn,
        dailyVolatilityPct: stats.dailyVol,
        annualisedVolatilityPct: stats.annualVol,
        maxDrawdownPct: stats.maxDrawdown,
        bestDayPct: stats.bestDay,
        worstDayPct: stats.worstDay
      });

      $("stockResults").scrollIntoView({ behavior: "smooth", block: "start" });

    } catch (error) {
      showMessage("error", error.message || "Unable to load stock data.");
    } finally {
      showMessage("stockLoading", "");
      setLoading(analyseButton, false);
    }
  });

  document.querySelectorAll("[data-ticker]").forEach((button) => {
    button.addEventListener("click", () => {
      tickerInput.value = button.dataset.ticker;
      form.requestSubmit();
    });
  });

  //open with a ticker from the company page
  const selectedTicker = new URLSearchParams(window.location.search).get("ticker");

  if (selectedTicker && isValidTicker(cleanTicker(selectedTicker))) {
    tickerInput.value = cleanTicker(selectedTicker);
    form.requestSubmit();
  }
}

function drawPriceChart(dates, prices, ticker, oldChart, setChart) {
  const canvas = $("priceChart");
  if (!canvas || typeof Chart === "undefined") return;

  if (oldChart) oldChart.destroy();

  const context = canvas.getContext("2d");

  const gradient = context.createLinearGradient(0, 0, 0, 320);
  gradient.addColorStop(0, "rgba(52, 104, 245, 0.22)");
  gradient.addColorStop(1, "rgba(52, 104, 245, 0.01)");

  const chart = new Chart(context, {
    type: "line",
    data: {
      labels: dates,
      datasets: [
        {
          label: `${ticker} close`,
          data: prices,
          borderColor: "#3468f5",
          backgroundColor: gradient,
          fill: true,
          borderWidth: 2.5,
          pointRadius: 0,
          pointHoverRadius: 5,
          pointHoverBackgroundColor: "#3468f5",
          tension: 0.22
        },
        {
          label: "20-day average",
          data: movingAverage(prices, 20),
          borderColor: "#d9822b",
          borderDash: [6, 4],
          borderWidth: 1.8,
          pointRadius: 0,
          pointHoverRadius: 0,
          fill: false,
          tension: 0.22
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { intersect: false, mode: "index" },
      plugins: {
        legend: {
          display: true,
          align: "end",
          labels: {
            usePointStyle: true,
            boxWidth: 8,
            color: "#718096",
            font: { size: 11 }
          }
        },
        tooltip: {
          backgroundColor: "#172b4d",
          padding: 12,
          displayColors: false,
          callbacks: {
            label: (item) => ` ${item.dataset.label}: ${formatMoney(item.parsed.y)}`
          }
        }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { maxTicksLimit: 7, color: "#718096", font: { size: 10 } },
          border: { display: false }
        },
        y: {
          grid: { color: "#edf0f6" },
          ticks: {
            color: "#718096",
            maxTicksLimit: 6,
            callback: (value) => `$${Number(value).toFixed(0)}`
          },
          border: { display: false }
        }
      }
    }
  });

  setChart(chart);
}

//----- page 2: company insights -----

function initCompanyInsights() {
  const form = $("companySearchForm");
  if (!form) return;

  const tickerInput = $("companyTicker");
  const searchButton = $("companySearchBtn");

  let revenueChart = null;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const ticker = cleanTicker(tickerInput.value);

    showMessage("companyError", "");

    if (!ticker || !isValidTicker(ticker)) {
      showMessage("companyError", "Enter a valid ticker symbol, such as AAPL, MSFT or IBM.");
      return;
    }

    setLoading(searchButton, true, "Loading company…");
    showMessage("companyLoading", "Gathering available company information…");

    try {
      //one after the other with a short gap, free keys reject bursts of requests
      const overviewParams = { function: "OVERVIEW", symbol: ticker };
      const incomeParams = { function: "INCOME_STATEMENT", symbol: ticker };

      let overview = null;
      let income = null;
      let firstError = null;
      let usedDemo = false;

      try {
        const result = await fetchAlphaVantage(overviewParams);
        overview = result.data;
        usedDemo = usedDemo || result.demo;
        if (!result.cached && !result.demo) await sleep(1200);
      } catch (error) {
        firstError = error;
        await sleep(1200);
      }

      try {
        const result = await fetchAlphaVantage(incomeParams);
        income = result.data;
        usedDemo = usedDemo || result.demo;
      } catch (error) {
        firstError = firstError || error;
      }

      //never mix live and sample figures for one company
      if (usedDemo) {
        overview = demoResponse(overviewParams);
        income = demoResponse(incomeParams);
      }

      const hasOverview = Boolean(overview && (overview.Name || overview.Symbol));

      const annualReports = income && Array.isArray(income.annualReports)
        ? income.annualReports
        : [];

      if (!hasOverview && annualReports.length === 0) {
        throw new Error(
          firstError?.message ||
          "No company information was returned. Check the ticker or API limits."
        );
      }

      renderCompanyOverview(ticker, hasOverview ? overview : null, annualReports, revenueChart,
        (chart) => {
          revenueChart = chart;
        });

      $("companyResults").hidden = false;
      $("companyWelcome").hidden = true;

      setDemoBanner("companyResults", usedDemo);

      const analysisUrl = `index.html?ticker=${encodeURIComponent(ticker)}`;

      $("analyseCompanyLink").href = analysisUrl;
      $("analyseCompanyCta").href = analysisUrl;

      setUrlTicker(ticker);

      if (!hasOverview || annualReports.length === 0) {
        const missing = [];

        if (!hasOverview) missing.push("company overview");
        if (annualReports.length === 0) missing.push("annual financial statements");

        showMessage(
          "companyError",
          `Some data was unavailable (${missing.join(" and ")}). Displayed figures may be incomplete. Check the API limits or try again later.`
        );
      }

      $("companyResults").scrollIntoView({ behavior: "smooth", block: "start" });

    } catch (error) {
      showMessage("companyError", error.message || "Unable to load company information.");
    } finally {
      showMessage("companyLoading", "");
      setLoading(searchButton, false);
    }
  });

  document.querySelectorAll("[data-company-ticker]").forEach((button) => {
    button.addEventListener("click", () => {
      tickerInput.value = button.dataset.companyTicker;
      form.requestSubmit();
    });
  });

  const selectedTicker = new URLSearchParams(window.location.search).get("ticker");

  if (selectedTicker && isValidTicker(cleanTicker(selectedTicker))) {
    tickerInput.value = cleanTicker(selectedTicker);
    form.requestSubmit();
  }
}

function renderCompanyOverview(ticker, overview, annualReports, oldChart, setChart) {
  const companyName = overview?.Name || ticker;
  const sector = overview?.Sector || "Not available";
  const industry = overview?.Industry || "Not available";
  const description = overview?.Description || "No company description was provided by the data source.";

  const marketCap = parseNumeric(overview?.MarketCapitalization);
  const peRatio = parseNumeric(overview?.PERatio);
  const employees = parseNumeric(overview?.FullTimeEmployees);
  const beta = parseNumeric(overview?.Beta);
  const dividendYield = parseNumeric(overview?.DividendYield);
  const weekLow = parseNumeric(overview?.["52WeekLow"]);
  const weekHigh = parseNumeric(overview?.["52WeekHigh"]);

  const currency = overview?.Currency || "USD";

  //newest first
  const reports = [...annualReports].sort((a, b) =>
    String(b.fiscalDateEnding || "").localeCompare(String(a.fiscalDateEnding || ""))
  );

  const latest = reports[0] || null;

  const latestRevenue = parseNumeric(latest?.totalRevenue);
  const latestNetIncome = parseNumeric(latest?.netIncome);

  const profitMargin =
    latestRevenue && latestNetIncome !== null
      ? (latestNetIncome / latestRevenue) * 100
      : null;

  $("companyName").textContent = companyName;
  $("companySubtitle").textContent = `${ticker} · ${sector} · ${industry}`;
  $("companyMonogram").textContent = companyName.trim().charAt(0).toUpperCase() || "S";
  $("overviewHeading").textContent = `About ${companyName}`;
  $("companyDescription").textContent = description;

  $("companySector").textContent = sector;
  $("companyIndustry").textContent = industry;
  $("companyEmployees").textContent =
    employees === null ? "Not available" : formatWholeNumber(employees);
  $("companyExchange").textContent = overview?.Exchange || "Not available";

  $("companyWeekRange").textContent =
    weekLow !== null && weekHigh !== null
      ? `${formatMoney(weekLow, currency)} – ${formatMoney(weekHigh, currency)}`
      : "Not available";

  $("companyDividend").textContent =
    dividendYield === null
      ? "Not available"
      : dividendYield === 0 ? "None" : `${(dividendYield * 100).toFixed(2)}%`;

  $("companyBeta").textContent = beta === null ? "Not available" : beta.toFixed(2);

  $("companyMargin").textContent =
    profitMargin === null ? "Not available" : `${profitMargin.toFixed(1)}%`;

  $("companyMarketCap").textContent =
    marketCap === null ? "—" : formatLargeNumber(marketCap, currency);

  $("companyRevenue").textContent =
    latestRevenue === null ? "—" : formatLargeNumber(latestRevenue, currency);

  $("companyNetIncome").textContent =
    latestNetIncome === null ? "—" : formatLargeNumber(latestNetIncome, currency);

  $("companyPE").textContent =
    peRatio === null ? "—" : peRatio <= 0 ? "Not positive" : `${peRatio.toFixed(2)}×`;

  drawRevenueChart(reports, currency, oldChart, setChart);

  const observations = buildObservations({
    companyName,
    currency,
    reports,
    latestRevenue,
    latestNetIncome,
    profitMargin,
    peRatio,
    beta
  });

  renderObservations(observations.cards);

  setAiContext({
    page: "company insights",
    ticker,
    company: companyName,
    sector,
    industry,
    currency,
    marketCap,
    latestRevenue,
    latestNetIncome,
    profitMarginPct: profitMargin,
    peRatio,
    beta,
    revenueChangeYoYPct: observations.yoy,
    revenueByYear: reports.slice(0, 5).map((r) => ({
      year: String(r.fiscalDateEnding || "").slice(0, 4),
      revenue: parseNumeric(r.totalRevenue)
    }))
  });
}

function drawRevenueChart(reports, currency, oldChart, setChart) {
  const canvas = $("revenueChart");
  if (!canvas || typeof Chart === "undefined") return;

  if (oldChart) oldChart.destroy();

  //chart.js wants oldest first
  const chartReports = reports
    .filter((report) => parseNumeric(report.totalRevenue) !== null)
    .slice(0, 8)
    .reverse();

  if (chartReports.length === 0) {
    canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
    setChart(null);
    return;
  }

  const labels = chartReports.map((report) =>
    String(report.fiscalDateEnding || "Unknown").slice(0, 4)
  );

  const revenuesInBillions = chartReports.map((report) =>
    parseNumeric(report.totalRevenue) / 1e9
  );

  const netIncomeInBillions = chartReports.map((report) => {
    const value = parseNumeric(report.netIncome);
    return value === null ? null : value / 1e9;
  });

  const chart = new Chart(canvas.getContext("2d"), {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: "Revenue",
          data: revenuesInBillions,
          backgroundColor: "#7394ff",
          hoverBackgroundColor: "#3468f5",
          borderRadius: 6,
          maxBarThickness: 38
        },
        {
          label: "Net income",
          data: netIncomeInBillions,
          backgroundColor: "#4cc9a1",
          hoverBackgroundColor: "#169b73",
          borderRadius: 6,
          maxBarThickness: 38
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: true,
          align: "end",
          labels: { usePointStyle: true, boxWidth: 8, color: "#718096", font: { size: 11 } }
        },
        tooltip: {
          backgroundColor: "#172b4d",
          padding: 12,
          displayColors: false,
          callbacks: {
            label: (item) =>
              ` ${item.dataset.label}: ${currency} ${item.parsed.y.toLocaleString("en-US", {
                maximumFractionDigits: 2
              })}B`
          }
        }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { color: "#718096", font: { size: 10 } },
          border: { display: false }
        },
        y: {
          beginAtZero: true,
          grid: { color: "#edf0f6" },
          ticks: { color: "#718096", maxTicksLimit: 6, callback: (value) => `${value}B` },
          border: { display: false }
        }
      }
    }
  });

  setChart(chart);
}

function buildObservations({
  companyName,
  currency,
  reports,
  latestRevenue,
  latestNetIncome,
  profitMargin,
  peRatio,
  beta
}) {
  const cards = [];
  let yoy = null;

  if (latestRevenue !== null) {
    cards.push({
      title: "Revenue snapshot",
      text: `The latest available annual revenue is ${formatLargeNumber(latestRevenue, currency)}. Compare it with previous periods to understand the company's sales trend.`
    });
  } else {
    cards.push({
      title: "Revenue data unavailable",
      text: "A latest annual revenue figure was not available. This can happen when the data source does not cover the selected company."
    });
  }

  if (latestNetIncome !== null) {
    cards.push({
      title: latestNetIncome >= 0 ? "Reported profit" : "Reported loss",
      text: `${companyName} reported ${latestNetIncome >= 0 ? "positive" : "negative"} net income of ${formatLargeNumber(latestNetIncome, currency)} in its latest available annual statement.`
    });
  } else {
    cards.push({
      title: "Net income unavailable",
      text: "The latest annual net income figure was not available, so profitability cannot be assessed from this figure."
    });
  }

  if (profitMargin !== null) {
    cards.push({
      title: "Profit margin",
      text: `Net income was ${profitMargin.toFixed(1)}% of revenue in the latest annual statement. Margins vary a lot between industries, so compare with similar companies rather than the whole market.`
    });
  } else {
    cards.push({
      title: "Profit margin",
      text: "A profit margin could not be calculated because revenue or net income was missing."
    });
  }

  const revenueReports = reports
    .map((report) => ({ date: report.fiscalDateEnding, revenue: parseNumeric(report.totalRevenue) }))
    .filter((report) => report.revenue !== null);

  if (revenueReports.length >= 2 && revenueReports[1].revenue !== 0) {
    yoy = ((revenueReports[0].revenue - revenueReports[1].revenue) /
      Math.abs(revenueReports[1].revenue)) * 100;

    cards.push({
      title: "Year-on-year revenue",
      text: `Reported annual revenue ${yoy >= 0 ? "increased" : "decreased"} by ${Math.abs(yoy).toFixed(2)}% between the two latest annual statements. Past growth does not guarantee future performance.`
    });
  } else {
    cards.push({
      title: "Revenue trend",
      text: "At least two comparable annual revenue reports are needed to calculate a year-on-year change."
    });
  }

  //average yearly growth across all the years we have
  const newest = revenueReports[0];
  const oldest = revenueReports[Math.min(revenueReports.length, 8) - 1];
  const years = Math.min(revenueReports.length, 8) - 1;

  if (years >= 2 && newest.revenue > 0 && oldest.revenue > 0) {
    const cagr = ((newest.revenue / oldest.revenue) ** (1 / years) - 1) * 100;

    cards.push({
      title: "Longer-term growth",
      text: `Across ${years} years of reports, revenue grew at an average of ${cagr.toFixed(1)}% a year (compound annual growth rate). A longer view smooths out one-off good or bad years.`
    });
  } else {
    cards.push({
      title: "Longer-term growth",
      text: "Three or more annual reports are needed to estimate average yearly growth."
    });
  }

  if (peRatio !== null && peRatio > 0) {
    const betaText = beta !== null
      ? ` Its beta is ${beta.toFixed(2)}, where values above 1 suggest the share price has tended to move more than the market.`
      : "";

    cards.push({
      title: "Valuation context",
      text: `The reported P/E ratio is ${peRatio.toFixed(2)}×. Compare it with similar companies and growth expectations; the ratio alone does not show whether a stock is cheap or expensive.${betaText}`
    });
  } else {
    cards.push({
      title: "P/E ratio",
      text: "A positive P/E ratio was not available. This can occur when earnings are negative, data is missing or the company is not covered by the source."
    });
  }

  return { cards, yoy };
}

function renderObservations(cards) {
  const container = $("companyObservations");
  container.replaceChildren();

  cards.forEach((observation) => {
    const card = document.createElement("article");
    card.className = "observation-card";

    const heading = document.createElement("h3");
    heading.textContent = observation.title;

    const paragraph = document.createElement("p");
    paragraph.textContent = observation.text;

    card.append(heading, paragraph);
    container.append(card);
  });
}

//----- start -----

document.addEventListener("DOMContentLoaded", () => {
  const page = document.body.dataset.page;

  initAiPanel();

  if (page === "analysis") initStockAnalysis();
  if (page === "insights") initCompanyInsights();
});
