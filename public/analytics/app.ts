declare const React: any;
declare const ReactDOM: any;
declare const echarts: any;

type Filters = {
  start: string;
  end: string;
  companyId: string;
  currency: string;
  status: string;
  assignee: string;
};

type AuthState = {
  email: string;
  token: string;
};

type SeriesPoint = { date: string; value: number };
type BreakdownItem = { label: string; value: number };

type Kpis = {
  total_revenue: number;
  order_count: number;
  invoice_total_open: number;
  invoice_count_open: number;
  overdue_invoice_count: number;
  quotation_pipeline: number;
  company_count_active: number;
  tasks_due_7d: number;
  tasks_overdue: number;
  quotation_count: number;
  invoice_count: number;
  quotation_status_breakdown: Array<{ status: string; amount: number }>;
  contact_status_breakdown: Array<{ status: string; count: number }>;
  invoice_aging: {
    not_due: number;
    bucket_0_7: number;
    bucket_8_30: number;
    bucket_31_60: number;
    bucket_60_plus: number;
  };
};

type ForecastPayload = {
  series: SeriesPoint[];
  forecast: SeriesPoint[];
  confidence: Array<{ date: string; lower: number; upper: number }>;
  backtest: { periods: number; mape: number | null };
};

type DataQuality = {
  missing_fields: Record<string, number>;
  orphans: Record<string, number>;
  duplicates: {
    contacts_email: Array<{ value: string; count: number }>;
    contacts_phone: Array<{ value: string; count: number }>;
    contacts_name: Array<{ value: string; count: number }>;
  };
  freshness: Record<string, string | null>;
};

const h = React.createElement;
const { useEffect, useMemo, useRef, useState } = React;

const authEmailKey = "crm:email";
const authTokenKey = "crm:token";

const formatDate = (value: Date) => value.toISOString().slice(0, 10);

const formatNumber = (value: number) =>
  new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);

const formatCurrency = (value: number, currency?: string) => {
  if (currency) {
    try {
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency,
        maximumFractionDigits: 0
      }).format(value);
    } catch {
      return `$${formatNumber(value)}`;
    }
  }
  return `$${formatNumber(value)}`;
};

const escapeCsv = (value: unknown) => {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (str.includes(",") || str.includes("\"") || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
};

const downloadCsv = (filename: string, rows: Array<Record<string, unknown>>) => {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const lines = [
    headers.join(","),
    ...rows.map((row) => headers.map((key) => escapeCsv(row[key])).join(","))
  ];
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};

const downloadPng = (chart: any, filename: string) => {
  if (!chart) return;
  const url = chart.getDataURL({ type: "png", pixelRatio: 2, backgroundColor: "#0b1120" });
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
};

const readAuth = (): AuthState => {
  try {
    const email = window.localStorage.getItem(authEmailKey) || "";
    const token = window.localStorage.getItem(authTokenKey) || "";
    return { email, token };
  } catch {
    return { email: "", token: "" };
  }
};

const buildQuery = (params: Record<string, string | number | null | undefined>) => {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === null || value === undefined || value === "") return;
    search.set(key, String(value));
  });
  return search.toString();
};

const apiFetch = async (
  path: string,
  params: Record<string, string | number | null | undefined>,
  auth: AuthState
) => {
  const url = new URL(path, window.location.origin);
  const query = buildQuery(params);
  if (query) url.search = query;
  const headers = new Headers();
  if (auth.email) headers.set("x-user-email", auth.email);
  if (auth.token) headers.set("authorization", `Bearer ${auth.token}`);
  const res = await fetch(url.toString(), { headers });
  if (!res.ok) {
    const payload = await res.json().catch(() => ({}));
    const message = payload?.error || `${res.status} ${res.statusText}`;
    throw new Error(message);
  }
  return res.json();
};

const buildLineOption = (points: SeriesPoint[], label: string, color: string) => ({
  tooltip: { trigger: "axis" },
  grid: { left: 32, right: 24, top: 30, bottom: 32 },
  xAxis: {
    type: "category",
    data: points.map((point) => point.date),
    axisLabel: { color: "#94a3b8" },
    axisLine: { lineStyle: { color: "#1f2937" } }
  },
  yAxis: {
    type: "value",
    axisLabel: { color: "#94a3b8" },
    splitLine: { lineStyle: { color: "#1f2937" } }
  },
  series: [
    {
      name: label,
      type: "line",
      data: points.map((point) => point.value),
      smooth: true,
      symbol: "circle",
      symbolSize: 6,
      lineStyle: { color, width: 3 },
      itemStyle: { color },
      areaStyle: { color: `${color}33` }
    }
  ]
});

const buildBarOption = (items: BreakdownItem[], label: string, color: string) => ({
  tooltip: { trigger: "axis" },
  grid: { left: 32, right: 24, top: 30, bottom: 72 },
  xAxis: {
    type: "category",
    data: items.map((item) => item.label),
    axisLabel: { color: "#94a3b8", rotate: 25 },
    axisLine: { lineStyle: { color: "#1f2937" } }
  },
  yAxis: {
    type: "value",
    axisLabel: { color: "#94a3b8" },
    splitLine: { lineStyle: { color: "#1f2937" } }
  },
  series: [
    {
      name: label,
      type: "bar",
      data: items.map((item) => item.value),
      itemStyle: { color },
      barMaxWidth: 28,
      emphasis: { itemStyle: { color: "#38bdf8" } }
    }
  ]
});

const buildPieOption = (items: BreakdownItem[], colors: string[]) => ({
  tooltip: { trigger: "item" },
  legend: { top: "bottom", textStyle: { color: "#94a3b8" } },
  series: [
    {
      type: "pie",
      radius: ["40%", "72%"],
      itemStyle: { borderColor: "#0f172a", borderWidth: 2 },
      label: { color: "#e2e8f0" },
      data: items.map((item, index) => ({
        value: item.value,
        name: item.label,
        itemStyle: { color: colors[index % colors.length] }
      }))
    }
  ]
});

const buildForecastOption = (payload: ForecastPayload, label: string, color: string) => {
  const actual = payload.series;
  const forecast = payload.forecast;
  const confidence = payload.confidence;
  const labels = [...actual.map((point) => point.date), ...forecast.map((point) => point.date)];
  const actualValues = actual.map((point) => point.value).concat(new Array(forecast.length).fill(null));
  const forecastValues = new Array(actual.length).fill(null).concat(forecast.map((point) => point.value));
  const lower = new Array(actual.length).fill(null).concat(confidence.map((point) => point.lower));
  const upper = new Array(actual.length).fill(null).concat(confidence.map((point) => point.upper));
  const upperOffset = upper.map((value, index) => {
    if (value === null || lower[index] === null) return null;
    return value - lower[index];
  });

  return {
    tooltip: { trigger: "axis" },
    grid: { left: 32, right: 24, top: 30, bottom: 32 },
    xAxis: {
      type: "category",
      data: labels,
      axisLabel: { color: "#94a3b8" },
      axisLine: { lineStyle: { color: "#1f2937" } }
    },
    yAxis: {
      type: "value",
      axisLabel: { color: "#94a3b8" },
      splitLine: { lineStyle: { color: "#1f2937" } }
    },
    series: [
      {
        name: "Confidence",
        type: "line",
        data: lower,
        lineStyle: { opacity: 0 },
        stack: "confidence",
        areaStyle: { color: `${color}22` },
        symbol: "none"
      },
      {
        name: "Confidence Range",
        type: "line",
        data: upperOffset,
        lineStyle: { opacity: 0 },
        stack: "confidence",
        areaStyle: { color: `${color}33` },
        symbol: "none"
      },
      {
        name: `${label} (Actual)`,
        type: "line",
        data: actualValues,
        smooth: true,
        lineStyle: { color, width: 3 },
        itemStyle: { color },
        symbol: "circle",
        symbolSize: 6
      },
      {
        name: `${label} (Forecast)`,
        type: "line",
        data: forecastValues,
        smooth: true,
        lineStyle: { color: "#f97316", width: 3, type: "dashed" },
        itemStyle: { color: "#f97316" },
        symbol: "triangle",
        symbolSize: 8
      }
    ]
  };
};

const ChartCard = (props: {
  title: string;
  subtitle?: string;
  option: any;
  csvRows: Array<Record<string, unknown>>;
  height?: number;
}) => {
  const chartRef = useRef(null);
  const containerRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const chart = echarts.init(containerRef.current);
    chartRef.current = chart;
    const handleResize = () => chart.resize();
    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
      chart.dispose();
    };
  }, []);

  useEffect(() => {
    if (chartRef.current) {
      chartRef.current.setOption(props.option, true);
    }
  }, [props.option]);

  return h(
    "section",
    { className: "rounded-2xl border border-slate-800 bg-slate-900/60 p-4 shadow-[0_20px_50px_-25px_rgba(15,23,42,0.9)]" },
    h(
      "div",
      { className: "flex flex-wrap items-center justify-between gap-3" },
      h("div", null, h("h3", { className: "text-lg font-semibold text-slate-100" }, props.title), props.subtitle
        ? h("p", { className: "text-xs text-slate-400" }, props.subtitle)
        : null),
      h(
        "div",
        { className: "flex items-center gap-2 text-xs" },
        h(
          "button",
          {
            className: "rounded-full border border-slate-700 px-3 py-1 text-slate-200 transition hover:border-slate-500",
            onClick: () => downloadCsv(`${props.title}.csv`, props.csvRows)
          },
          "CSV"
        ),
        h(
          "button",
          {
            className: "rounded-full border border-slate-700 px-3 py-1 text-slate-200 transition hover:border-slate-500",
            onClick: () => downloadPng(chartRef.current, `${props.title}.png`)
          },
          "PNG"
        )
      )
    ),
    h("div", {
      ref: containerRef,
      style: { height: `${props.height ?? 260}px` },
      className: "mt-4"
    })
  );
};

const KpiCard = (props: { label: string; value: string; tone?: string }) =>
  h(
    "div",
    {
      className:
        "rounded-2xl border border-slate-800 bg-gradient-to-br from-slate-900/90 to-slate-950/80 p-4 shadow-[0_15px_40px_-30px_rgba(56,189,248,0.7)]"
    },
    h("p", { className: "text-xs uppercase tracking-[0.2em] text-slate-400" }, props.label),
    h("p", { className: `mt-3 text-2xl font-semibold ${props.tone || "text-slate-100"}` }, props.value)
  );

const App = () => {
  const [auth] = useState(() => readAuth());
  const [darkMode, setDarkMode] = useState(true);
  const [filters, setFilters] = useState(() => {
    const end = formatDate(new Date());
    const start = formatDate(new Date(Date.now() - 1000 * 60 * 60 * 24 * 90));
    return { start, end, companyId: "", currency: "", status: "", assignee: "" };
  });
  const [activeTab, setActiveTab] = useState("overview");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [companies, setCompanies] = useState([]);
  const [kpis, setKpis] = useState(null);
  const [overview, setOverview] = useState({ revenue: [], openInvoices: [], pipeline: [] });
  const [sales, setSales] = useState({ revenue: [], orders: [], topCompanies: [], quotationStatus: [], conversions: 0 });
  const [finance, setFinance] = useState({ invoiceStatus: [], openInvoices: [] });
  const [operations, setOperations] = useState({
    tasksByStatus: [],
    tasksByAssignee: [],
    shippingStatus: [],
    samplesSeries: [],
    samplesByStatus: [],
    samplesByCourier: []
  });
  const [forecast, setForecast] = useState({ revenue: null, openInvoices: null, tasks: null, shipping: null });
  const [quality, setQuality] = useState(null);
  const [loadedKeys, setLoadedKeys] = useState({});
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const filtersKey = useMemo(() => JSON.stringify(filters), [filters]);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", darkMode);
  }, [darkMode]);

  useEffect(() => {
    if (!auth.token) return;
    apiFetch("/api/companies", { limit: 200 }, auth)
      .then((payload) => {
        const rows = Array.isArray(payload?.rows) ? payload.rows : [];
        setCompanies(rows.map((row: any) => ({ id: row.id, name: row.name || "Unknown" })));
      })
      .catch(() => setCompanies([]));
  }, [auth.token]);

  useEffect(() => {
    if (!auth.token || !auth.email) return;
    setLoading(true);
    setError("");
    const baseParams = {
      owner_email: auth.email,
      start: filters.start,
      end: filters.end,
      company_id: filters.companyId || null,
      currency: filters.currency || null,
      status: filters.status || null,
      assignee: filters.assignee || null
    };
    apiFetch("/api/kpis", baseParams, auth)
      .then((payload) => {
        setKpis(payload as Kpis);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [auth.token, auth.email, filtersKey]);

  useEffect(() => {
    if (!auth.token || !auth.email) return;
    if (loadedKeys[activeTab] === filtersKey) return;
    setLoading(true);
    setError("");
    const baseParams = {
      owner_email: auth.email,
      start: filters.start,
      end: filters.end,
      company_id: filters.companyId || null,
      currency: filters.currency || null,
      status: filters.status || null,
      assignee: filters.assignee || null
    };
    const loadOverview = async () => {
      const [revenueSeries, openInvoices, pipeline] = await Promise.all([
        apiFetch("/api/timeseries", { ...baseParams, metric: "revenue", grain: "week" }, auth),
        apiFetch("/api/timeseries", { ...baseParams, metric: "invoices", grain: "week", status: "Open" }, auth),
        apiFetch("/api/breakdown", { ...baseParams, entity: "status", source: "quotations", metric: "revenue" }, auth)
      ]);
      setOverview({
        revenue: revenueSeries.data || [],
        openInvoices: openInvoices.data || [],
        pipeline: pipeline.data || []
      });
    };
    const loadSales = async () => {
      const [revenueSeries, ordersSeries, topCompanies, quotationStatus, conversions] = await Promise.all([
        apiFetch("/api/timeseries", { ...baseParams, metric: "revenue", grain: "week" }, auth),
        apiFetch("/api/timeseries", { ...baseParams, metric: "orders", grain: "week" }, auth),
        apiFetch("/api/breakdown", { ...baseParams, entity: "company", metric: "revenue" }, auth),
        apiFetch("/api/breakdown", { ...baseParams, entity: "status", source: "quotations", metric: "count" }, auth),
        apiFetch(
          "/api/breakdown",
          { ...baseParams, entity: "status", source: "orders", metric: "count", requires_quotation: 1 },
          auth
        )
      ]);
      const conversionTotal = (conversions.data || []).reduce((sum: number, row: any) => sum + (row.value || 0), 0);
      setSales({
        revenue: revenueSeries.data || [],
        orders: ordersSeries.data || [],
        topCompanies: topCompanies.data || [],
        quotationStatus: quotationStatus.data || [],
        conversions: conversionTotal
      });
    };
    const loadFinance = async () => {
      const [invoiceStatus, openInvoices] = await Promise.all([
        apiFetch("/api/breakdown", { ...baseParams, entity: "status", source: "invoices", metric: "count" }, auth),
        apiFetch("/api/timeseries", { ...baseParams, metric: "invoices", grain: "week", status: "Open" }, auth)
      ]);
      setFinance({
        invoiceStatus: invoiceStatus.data || [],
        openInvoices: openInvoices.data || []
      });
    };
    const loadOperations = async () => {
      const [tasksStatus, tasksAssignee, shippingStatus, samplesSeries, samplesByStatus, samplesByCourier] =
        await Promise.all([
          apiFetch("/api/breakdown", { ...baseParams, entity: "status", source: "tasks", metric: "count" }, auth),
          apiFetch("/api/breakdown", { ...baseParams, entity: "assignee", metric: "count" }, auth),
          apiFetch("/api/breakdown", { ...baseParams, entity: "status", source: "shipping_schedules", metric: "count" }, auth),
          apiFetch("/api/timeseries", { ...baseParams, metric: "samples", grain: "week" }, auth),
          apiFetch("/api/breakdown", { ...baseParams, entity: "status", source: "sample_shipments", metric: "count" }, auth),
          apiFetch(
            "/api/breakdown",
            { ...baseParams, entity: "status", source: "sample_shipments", field: "courier", metric: "count" },
            auth
          )
        ]);
      setOperations({
        tasksByStatus: tasksStatus.data || [],
        tasksByAssignee: tasksAssignee.data || [],
        shippingStatus: shippingStatus.data || [],
        samplesSeries: samplesSeries.data || [],
        samplesByStatus: samplesByStatus.data || [],
        samplesByCourier: samplesByCourier.data || []
      });
    };
    const loadForecast = async () => {
      const [revenueForecast, openInvoiceForecast, tasksForecast, shippingForecast] = await Promise.all([
        apiFetch("/api/forecast", { ...baseParams, metric: "revenue", grain: "month", horizon: 12 }, auth),
        apiFetch("/api/forecast", { ...baseParams, metric: "open_invoices", grain: "month", horizon: 12 }, auth),
        apiFetch("/api/forecast", { ...baseParams, metric: "tasks", grain: "month", horizon: 12 }, auth),
        apiFetch("/api/forecast", { ...baseParams, metric: "shipping", grain: "month", horizon: 12 }, auth)
      ]);
      setForecast({
        revenue: revenueForecast,
        openInvoices: openInvoiceForecast,
        tasks: tasksForecast,
        shipping: shippingForecast
      });
    };
    const loadQuality = async () => {
      const payload = await apiFetch("/api/data-quality", { owner_email: auth.email }, auth);
      setQuality(payload.data as DataQuality);
    };
    const loaders: Record<string, () => Promise<void>> = {
      overview: loadOverview,
      sales: loadSales,
      finance: loadFinance,
      operations: loadOperations,
      forecast: loadForecast,
      quality: loadQuality
    };
    const runner = loaders[activeTab] || loadOverview;
    runner()
      .then(() => {
        setLoadedKeys((prev) => ({ ...prev, [activeTab]: filtersKey }));
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [auth.token, auth.email, filtersKey, activeTab, filters]);

  if (!auth.token || !auth.email) {
    return h(
      "div",
      { className: "flex min-h-screen items-center justify-center bg-slate-950 px-6 text-slate-100" },
      h(
        "div",
        { className: "max-w-md rounded-2xl border border-slate-800 bg-slate-900/70 p-6 text-center" },
        h("h1", { className: "font-serif text-2xl" }, "Analytics login required"),
        h("p", { className: "mt-3 text-sm text-slate-400" }, "Sign in on the main CRM app to load analytics."),
        h(
          "a",
          {
            href: "/",
            className: "mt-6 inline-flex items-center justify-center rounded-full bg-sky-500 px-4 py-2 text-sm font-semibold text-slate-900"
          },
          "Go to CRM"
        )
      )
    );
  }

  const overviewCards = kpis
    ? [
        { label: "Total revenue", value: formatCurrency(kpis.total_revenue, filters.currency) },
        { label: "Open invoices", value: formatCurrency(kpis.invoice_total_open, filters.currency) },
        { label: "Quotation pipeline", value: formatCurrency(kpis.quotation_pipeline, filters.currency) },
        { label: "Orders in period", value: formatNumber(kpis.order_count) },
        { label: "Active companies", value: formatNumber(kpis.company_count_active) },
        { label: "Tasks due soon", value: formatNumber(kpis.tasks_due_7d), tone: "text-amber-300" },
        { label: "Overdue invoices", value: formatNumber(kpis.overdue_invoice_count), tone: "text-rose-300" },
        { label: "Tasks overdue", value: formatNumber(kpis.tasks_overdue), tone: "text-rose-300" }
      ]
    : [];

  const tabs = [
    { id: "overview", label: "Overview" },
    { id: "sales", label: "Sales" },
    { id: "finance", label: "Finance" },
    { id: "operations", label: "Operations" },
    { id: "forecast", label: "Forecast" },
    { id: "quality", label: "Data Quality" }
  ];

  return h(
    "div",
    { className: "min-h-screen bg-slate-950 text-slate-100" },
    h("div", { className: "pointer-events-none fixed inset-0" }, h("div", { className: "absolute -top-40 right-0 h-72 w-72 rounded-full bg-sky-500/20 blur-[120px]" }), h("div", { className: "absolute bottom-0 left-0 h-72 w-72 rounded-full bg-orange-400/20 blur-[140px]" })),
    h(
      "header",
      { className: "relative z-10 border-b border-slate-900/80 bg-slate-950/80 px-6 py-5 backdrop-blur" },
      h(
        "div",
        { className: "mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4" },
        h(
          "div",
          null,
          h("p", { className: "text-xs uppercase tracking-[0.3em] text-slate-500" }, "CRM Analytics"),
          h("h1", { className: "font-serif text-2xl text-slate-100" }, "Performance cockpit")
        ),
        h(
          "div",
          { className: "flex items-center gap-3 text-xs text-slate-400" },
          h("span", { className: "rounded-full border border-slate-800 px-3 py-1" }, auth.email),
          h(
            "button",
            {
              className: "rounded-full border border-slate-700 px-3 py-1 text-slate-200",
              onClick: () => setFiltersOpen(true)
            },
            "Filters"
          ),
          h(
            "button",
            {
              className: "rounded-full border border-slate-700 px-3 py-1 text-slate-200",
              onClick: () => setDarkMode((prev: boolean) => !prev)
            },
            darkMode ? "Dark" : "Light"
          )
        )
      ),
      h(
        "nav",
        { className: "mx-auto mt-4 flex max-w-6xl flex-wrap gap-2" },
        tabs.map((tab) =>
          h(
            "button",
            {
              key: tab.id,
              className:
                tab.id === activeTab
                  ? "rounded-full bg-slate-100 px-4 py-1 text-xs font-semibold text-slate-900"
                  : "rounded-full border border-slate-800 px-4 py-1 text-xs text-slate-300",
              onClick: () => setActiveTab(tab.id)
            },
            tab.label
          )
        )
      )
    ),
    h(
      "main",
      { className: "relative z-10 mx-auto max-w-6xl px-6 py-10" },
      error
        ? h("div", { className: "mb-6 rounded-xl border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-rose-200" }, error)
        : null,
      loading
        ? h("div", { className: "mb-6 rounded-xl border border-slate-800 bg-slate-900/60 p-4 text-sm text-slate-400" }, "Loading analytics...")
        : null,
      activeTab === "overview" &&
        h(
          "div",
          { className: "space-y-6" },
          h(
            "section",
            { className: "grid gap-4 md:grid-cols-2 xl:grid-cols-4" },
            overviewCards.map((card) => h(KpiCard, { key: card.label, ...card }))
          ),
          h(
            "div",
            { className: "grid gap-4 lg:grid-cols-2" },
            h(ChartCard, {
              title: "Revenue trend",
              subtitle: "Weekly totals",
              option: buildLineOption(overview.revenue, "Revenue", "#38bdf8"),
              csvRows: overview.revenue
            }),
            h(ChartCard, {
              title: "Open invoices trend",
              subtitle: "Weekly open invoices count",
              option: buildLineOption(overview.openInvoices, "Open invoices", "#f97316"),
              csvRows: overview.openInvoices
            })
          ),
          h(
            "div",
            { className: "grid gap-4 lg:grid-cols-2" },
            h(ChartCard, {
              title: "Pipeline by quotation status",
              subtitle: "Sum of quotation amounts",
              option: buildBarOption(overview.pipeline, "Pipeline", "#22d3ee"),
              csvRows: overview.pipeline
            }),
            kpis
              ? h(
                  "section",
                  {
                    className:
                      "rounded-2xl border border-slate-800 bg-slate-900/60 p-5 text-sm text-slate-200 shadow-[0_15px_40px_-30px_rgba(56,189,248,0.5)]"
                  },
                  h("h3", { className: "text-base font-semibold" }, "Tasks & engagement"),
                  h(
                    "div",
                    { className: "mt-4 grid gap-3 sm:grid-cols-2" },
                    h("div", { className: "rounded-xl border border-slate-800 bg-slate-950/60 p-3" }, h("p", { className: "text-xs text-slate-400" }, "Tasks due soon"), h("p", { className: "text-xl font-semibold text-amber-300" }, formatNumber(kpis.tasks_due_7d))),
                    h("div", { className: "rounded-xl border border-slate-800 bg-slate-950/60 p-3" }, h("p", { className: "text-xs text-slate-400" }, "Tasks overdue"), h("p", { className: "text-xl font-semibold text-rose-300" }, formatNumber(kpis.tasks_overdue)))
                  ),
                  h("p", { className: "mt-4 text-xs text-slate-400" }, "Contact engagement snapshot by status."),
                  h(
                    "div",
                    { className: "mt-3 flex flex-wrap gap-2" },
                    kpis.contact_status_breakdown.map((row) =>
                      h(
                        "span",
                        {
                          key: row.status,
                          className: "rounded-full border border-slate-800 px-3 py-1 text-xs text-slate-300"
                        },
                        `${row.status}: ${formatNumber(row.count)}`
                      )
                    )
                  )
                )
              : null
          )
        ),
      activeTab === "sales" &&
        h(
          "div",
          { className: "space-y-6" },
          h(
            "div",
            { className: "grid gap-4 lg:grid-cols-2" },
            h(ChartCard, {
              title: "Revenue & orders",
              subtitle: "Weekly revenue and order volume",
              option: {
                tooltip: { trigger: "axis" },
                grid: { left: 32, right: 24, top: 30, bottom: 32 },
                xAxis: {
                  type: "category",
                  data: sales.revenue.map((point) => point.date),
                  axisLabel: { color: "#94a3b8" },
                  axisLine: { lineStyle: { color: "#1f2937" } }
                },
                yAxis: {
                  type: "value",
                  axisLabel: { color: "#94a3b8" },
                  splitLine: { lineStyle: { color: "#1f2937" } }
                },
                series: [
                  {
                    name: "Revenue",
                    type: "line",
                    data: sales.revenue.map((point) => point.value),
                    smooth: true,
                    lineStyle: { color: "#38bdf8", width: 3 },
                    itemStyle: { color: "#38bdf8" },
                    symbol: "circle",
                    symbolSize: 6
                  },
                  {
                    name: "Orders",
                    type: "bar",
                    data: sales.orders.map((point) => point.value),
                    itemStyle: { color: "#a855f7" },
                    barMaxWidth: 22
                  }
                ]
              },
              csvRows: sales.revenue.map((point, index) => ({
                date: point.date,
                revenue: point.value,
                orders: sales.orders[index]?.value ?? 0
              })),
              height: 300
            }),
            h(ChartCard, {
              title: "Top revenue companies",
              subtitle: "Largest accounts by revenue",
              option: buildBarOption(sales.topCompanies, "Revenue", "#facc15"),
              csvRows: sales.topCompanies
            })
          ),
          h(
            "section",
            { className: "rounded-2xl border border-slate-800 bg-slate-900/60 p-5" },
            h("h3", { className: "text-base font-semibold text-slate-100" }, "Quotation funnel"),
            h("p", { className: "text-xs text-slate-400" }, "Draft -> Sent -> Orders with linked quotations."),
            h(
              "div",
              { className: "mt-4 grid gap-4 md:grid-cols-3" },
              sales.quotationStatus.map((stage) =>
                h(
                  "div",
                  { key: stage.label, className: "rounded-xl border border-slate-800 bg-slate-950/60 p-4" },
                  h("p", { className: "text-xs text-slate-400" }, stage.label),
                  h("p", { className: "mt-2 text-2xl font-semibold text-slate-100" }, formatNumber(stage.value))
                )
              ),
              h(
                "div",
                { className: "rounded-xl border border-slate-800 bg-slate-950/60 p-4" },
                h("p", { className: "text-xs text-slate-400" }, "Orders from quotations"),
                h("p", { className: "mt-2 text-2xl font-semibold text-emerald-300" }, formatNumber(sales.conversions))
              )
            )
          )
        ),
      activeTab === "finance" &&
        h(
          "div",
          { className: "space-y-6" },
          h(
            "div",
            { className: "grid gap-4 lg:grid-cols-2" },
            h(ChartCard, {
              title: "Invoice status mix",
              subtitle: "Open vs paid vs other statuses",
              option: buildPieOption(finance.invoiceStatus, ["#38bdf8", "#4ade80", "#f97316", "#f43f5e"]),
              csvRows: finance.invoiceStatus
            }),
            h(ChartCard, {
              title: "Open invoices trend",
              subtitle: "Weekly open invoice count",
              option: buildLineOption(finance.openInvoices, "Open invoices", "#f97316"),
              csvRows: finance.openInvoices
            })
          ),
          kpis
            ? h(
                "section",
                { className: "rounded-2xl border border-slate-800 bg-slate-900/60 p-5" },
                h("h3", { className: "text-base font-semibold text-slate-100" }, "Aging buckets"),
                h("p", { className: "text-xs text-slate-400" }, "Open invoices by days past due."),
                h(ChartCard, {
                  title: "Invoice aging",
                  subtitle: "Days past due",
                  option: buildBarOption(
                    [
                      { label: "Not due", value: kpis.invoice_aging.not_due },
                      { label: "0-7", value: kpis.invoice_aging.bucket_0_7 },
                      { label: "8-30", value: kpis.invoice_aging.bucket_8_30 },
                      { label: "31-60", value: kpis.invoice_aging.bucket_31_60 },
                      { label: "60+", value: kpis.invoice_aging.bucket_60_plus }
                    ],
                    "Invoices",
                    "#a855f7"
                  ),
                  csvRows: [
                    { bucket: "Not due", value: kpis.invoice_aging.not_due },
                    { bucket: "0-7", value: kpis.invoice_aging.bucket_0_7 },
                    { bucket: "8-30", value: kpis.invoice_aging.bucket_8_30 },
                    { bucket: "31-60", value: kpis.invoice_aging.bucket_31_60 },
                    { bucket: "60+", value: kpis.invoice_aging.bucket_60_plus }
                  ],
                  height: 240
                })
              )
            : null
        ),
      activeTab === "operations" &&
        h(
          "div",
          { className: "space-y-6" },
          h(
            "div",
            { className: "grid gap-4 lg:grid-cols-2" },
            h(ChartCard, {
              title: "Tasks by status",
              subtitle: "Current task load",
              option: buildBarOption(operations.tasksByStatus, "Tasks", "#34d399"),
              csvRows: operations.tasksByStatus
            }),
            h(ChartCard, {
              title: "Tasks by assignee",
              subtitle: "Distribution across owners",
              option: buildBarOption(operations.tasksByAssignee, "Tasks", "#60a5fa"),
              csvRows: operations.tasksByAssignee
            })
          ),
          h(
            "div",
            { className: "grid gap-4 lg:grid-cols-2" },
            h(ChartCard, {
              title: "Shipping status",
              subtitle: "Shipping schedules grouped by status",
              option: buildBarOption(operations.shippingStatus, "Shipping", "#f97316"),
              csvRows: operations.shippingStatus
            }),
            h(ChartCard, {
              title: "Samples shipped per week",
              subtitle: "Sample shipments volume",
              option: buildLineOption(operations.samplesSeries, "Samples", "#22d3ee"),
              csvRows: operations.samplesSeries
            })
          ),
          h(
            "div",
            { className: "grid gap-4 lg:grid-cols-2" },
            h(ChartCard, {
              title: "Samples by status",
              subtitle: "Sample shipments status mix",
              option: buildBarOption(operations.samplesByStatus, "Samples", "#a855f7"),
              csvRows: operations.samplesByStatus
            }),
            h(ChartCard, {
              title: "Samples by courier",
              subtitle: "Courier volume",
              option: buildBarOption(operations.samplesByCourier, "Samples", "#facc15"),
              csvRows: operations.samplesByCourier
            })
          )
        ),
      activeTab === "forecast" &&
        h(
          "div",
          { className: "space-y-6" },
          forecast.revenue
            ? h(ChartCard, {
                title: "Revenue forecast",
                subtitle: `Backtest MAPE: ${forecast.revenue.backtest.mape ?? "n/a"}%`,
                option: buildForecastOption(forecast.revenue, "Revenue", "#38bdf8"),
                csvRows: [
                  ...forecast.revenue.series.map((point) => ({ date: point.date, actual: point.value })),
                  ...forecast.revenue.forecast.map((point) => ({ date: point.date, forecast: point.value }))
                ],
                height: 320
              })
            : null,
          forecast.openInvoices
            ? h(ChartCard, {
                title: "Open invoices forecast",
                subtitle: `Backtest MAPE: ${forecast.openInvoices.backtest.mape ?? "n/a"}%`,
                option: buildForecastOption(forecast.openInvoices, "Open invoices", "#f97316"),
                csvRows: [
                  ...forecast.openInvoices.series.map((point) => ({ date: point.date, actual: point.value })),
                  ...forecast.openInvoices.forecast.map((point) => ({ date: point.date, forecast: point.value }))
                ],
                height: 320
              })
            : null,
          forecast.tasks
            ? h(ChartCard, {
                title: "Tasks due forecast",
                subtitle: `Backtest MAPE: ${forecast.tasks.backtest.mape ?? "n/a"}%`,
                option: buildForecastOption(forecast.tasks, "Tasks", "#22d3ee"),
                csvRows: [
                  ...forecast.tasks.series.map((point) => ({ date: point.date, actual: point.value })),
                  ...forecast.tasks.forecast.map((point) => ({ date: point.date, forecast: point.value }))
                ],
                height: 320
              })
            : null,
          forecast.shipping
            ? h(ChartCard, {
                title: "Shipping volume forecast",
                subtitle: `Backtest MAPE: ${forecast.shipping.backtest.mape ?? "n/a"}%`,
                option: buildForecastOption(forecast.shipping, "Shipping", "#a855f7"),
                csvRows: [
                  ...forecast.shipping.series.map((point) => ({ date: point.date, actual: point.value })),
                  ...forecast.shipping.forecast.map((point) => ({ date: point.date, forecast: point.value }))
                ],
                height: 320
              })
            : null
        ),
      activeTab === "quality" &&
        h(
          "div",
          { className: "space-y-6" },
          quality
            ? h(
                "section",
                { className: "rounded-2xl border border-slate-800 bg-slate-900/60 p-6" },
                h("h3", { className: "text-base font-semibold text-slate-100" }, "Missing fields"),
                h(
                  "div",
                  { className: "mt-4 grid gap-3 md:grid-cols-2" },
                  Object.entries(quality.missing_fields).map(([key, value]) =>
                    h(
                      "div",
                      { key, className: "rounded-xl border border-slate-800 bg-slate-950/60 p-4" },
                      h("p", { className: "text-xs text-slate-400" }, key.replace(/_/g, " ")),
                      h("p", { className: "mt-2 text-2xl font-semibold text-slate-100" }, formatNumber(Number(value)))
                    )
                  )
                ),
                h("h3", { className: "mt-6 text-base font-semibold text-slate-100" }, "Orphan checks"),
                h(
                  "div",
                  { className: "mt-4 grid gap-3 md:grid-cols-2" },
                  Object.entries(quality.orphans).map(([key, value]) =>
                    h(
                      "div",
                      { key, className: "rounded-xl border border-slate-800 bg-slate-950/60 p-4" },
                      h("p", { className: "text-xs text-slate-400" }, key.replace(/_/g, " ")),
                      h("p", { className: "mt-2 text-2xl font-semibold text-rose-300" }, formatNumber(Number(value)))
                    )
                  )
                ),
                h("h3", { className: "mt-6 text-base font-semibold text-slate-100" }, "Duplicates"),
                h(
                  "div",
                  { className: "mt-4 grid gap-4 md:grid-cols-3" },
                  ["contacts_email", "contacts_phone", "contacts_name"].map((key) =>
                    h(
                      "div",
                      { key, className: "rounded-xl border border-slate-800 bg-slate-950/60 p-4" },
                      h("p", { className: "text-xs text-slate-400" }, key.replace(/_/g, " ")),
                      h(
                        "ul",
                        { className: "mt-3 space-y-2 text-xs text-slate-300" },
                        (quality.duplicates as any)[key].length
                          ? (quality.duplicates as any)[key].map((row: any) =>
                              h("li", { key: row.value }, `${row.value} (${formatNumber(row.count)})`)
                            )
                          : h("li", null, "No duplicates found")
                      )
                    )
                  )
                ),
                h("h3", { className: "mt-6 text-base font-semibold text-slate-100" }, "Freshness"),
                h(
                  "div",
                  { className: "mt-4 grid gap-3 md:grid-cols-2" },
                  Object.entries(quality.freshness).map(([key, value]) =>
                    h(
                      "div",
                      { key, className: "rounded-xl border border-slate-800 bg-slate-950/60 p-4" },
                      h("p", { className: "text-xs text-slate-400" }, key.replace(/_/g, " ")),
                      h("p", { className: "mt-2 text-sm text-slate-200" }, value || "No updates yet")
                    )
                  )
                )
              )
            : null
        )
    ),
    filtersOpen
      ? h(
          "div",
          { className: "fixed inset-0 z-50 flex items-end justify-end bg-slate-900/70" },
          h(
            "div",
            { className: "h-full w-full max-w-md bg-slate-950 p-6 text-slate-100" },
            h(
              "div",
              { className: "flex items-center justify-between" },
              h("h2", { className: "text-lg font-semibold" }, "Filters"),
              h(
                "button",
                { className: "rounded-full border border-slate-700 px-3 py-1 text-xs", onClick: () => setFiltersOpen(false) },
                "Close"
              )
            ),
            h(
              "div",
              { className: "mt-6 space-y-4 text-sm" },
              h(
                "label",
                { className: "block" },
                h("span", { className: "text-xs text-slate-400" }, "Start date"),
                h("input", {
                  type: "date",
                  value: filters.start,
                  onChange: (event: any) => setFilters({ ...filters, start: event.target.value }),
                  className: "mt-2 w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-slate-100"
                })
              ),
              h(
                "label",
                { className: "block" },
                h("span", { className: "text-xs text-slate-400" }, "End date"),
                h("input", {
                  type: "date",
                  value: filters.end,
                  onChange: (event: any) => setFilters({ ...filters, end: event.target.value }),
                  className: "mt-2 w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-slate-100"
                })
              ),
              h(
                "label",
                { className: "block" },
                h("span", { className: "text-xs text-slate-400" }, "Company"),
                h(
                  "select",
                  {
                    value: filters.companyId,
                    onChange: (event: any) => setFilters({ ...filters, companyId: event.target.value }),
                    className: "mt-2 w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-slate-100"
                  },
                  h("option", { value: "" }, "All companies"),
                  companies.map((company) =>
                    h("option", { key: company.id, value: String(company.id) }, company.name)
                  )
                )
              ),
              h(
                "label",
                { className: "block" },
                h("span", { className: "text-xs text-slate-400" }, "Currency"),
                h("input", {
                  type: "text",
                  placeholder: "USD",
                  value: filters.currency,
                  onChange: (event: any) => setFilters({ ...filters, currency: event.target.value.toUpperCase() }),
                  className: "mt-2 w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-slate-100"
                })
              ),
              h(
                "label",
                { className: "block" },
                h("span", { className: "text-xs text-slate-400" }, "Status"),
                h("input", {
                  type: "text",
                  placeholder: "Open",
                  value: filters.status,
                  onChange: (event: any) => setFilters({ ...filters, status: event.target.value }),
                  className: "mt-2 w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-slate-100"
                })
              ),
              h(
                "label",
                { className: "block" },
                h("span", { className: "text-xs text-slate-400" }, "Assignee"),
                h("input", {
                  type: "text",
                  placeholder: "Sales lead",
                  value: filters.assignee,
                  onChange: (event: any) => setFilters({ ...filters, assignee: event.target.value }),
                  className: "mt-2 w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-slate-100"
                })
              ),
              h(
                "div",
                { className: "flex items-center gap-3 pt-2" },
                h(
                  "button",
                  {
                    className: "rounded-full bg-sky-400 px-4 py-2 text-xs font-semibold text-slate-900",
                    onClick: () => setFiltersOpen(false)
                  },
                  "Apply"
                ),
                h(
                  "button",
                  {
                    className: "rounded-full border border-slate-700 px-4 py-2 text-xs text-slate-300",
                    onClick: () => {
                      const end = formatDate(new Date());
                      const start = formatDate(new Date(Date.now() - 1000 * 60 * 60 * 24 * 90));
                      setFilters({ start, end, companyId: "", currency: "", status: "", assignee: "" });
                    }
                  },
                  "Reset"
                )
              )
            )
          )
        )
      : null
  );
};

ReactDOM.createRoot(document.getElementById("root")).render(h(App));
