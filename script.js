//stockscope shared javascript: stock analysis + company insights

//get a free key at https://www.alphavantage.co/support/#api-key
const API_KEY = "DJI9PT216NT89SCH";

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

//----- api -----

//returns { data, cached }
async function fetchAlphaVantage(params) {
  const cached = readCache(params);
  if (cached) return { data: cached, cached: true };

  if (!API_KEY || API_KEY === "YOUR_API_KEY") {
    throw new Error("Add your Alpha Vantage API key in script.js before searching.");
  }

  const url = new URL("https://www.alphavantage.co/query");

  Object.entries({ ...params, apikey: API_KEY }).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`The data service returned HTTP ${response.status}. Please try again later.`);
  }

  const data = await response.json();

  if (data.Note || data.Information || data["Error Message"]) {
    throw new Error(
      data.Note ||
      data.Information ||
      data["Error Message"] ||
      "The data provider could not complete this request."
    );
  }

  writeCache(params, data);
  return { data, cached: false };
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
      const { data, cached } = await fetchAlphaVantage({
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
        `${records.length} daily closing prices · Latest date: ${latestDate}${cached ? " · saved data" : ""}`;

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

      try {
        const result = await fetchAlphaVantage(overviewParams);
        overview = result.data;
        if (!result.cached) await sleep(1200);
      } catch (error) {
        firstError = error;
        await sleep(1200);
      }

      try {
        income = (await fetchAlphaVantage(incomeParams)).data;
      } catch (error) {
        firstError = firstError || error;
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
