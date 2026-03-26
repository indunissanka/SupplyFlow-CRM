import type { D1Queryable } from "./db";

export type Grain = "day" | "week" | "month";
export type SeriesPoint = { date: string; value: number };

export type AnalyticsFilters = {
  companyId?: number;
  contactId?: number;
  status?: string;
  assignee?: string;
  currency?: string;
};

export type BreakdownEntity = "company" | "product_category" | "status" | "assignee";

export type BreakdownMetric = "revenue" | "count";

export type ForecastMetric =
  | "revenue"
  | "orders"
  | "invoices"
  | "quotations"
  | "tasks"
  | "shipping"
  | "open_invoices"
  | "overdue_invoices";

export type DateRange = {
  start: string;
  end: string;
  startDate: Date;
  endDate: Date;
};

const PIPELINE_STATUSES = ["Draft", "Sent", "Open", "Pending"];

const normalizeDate = (value: Date) =>
  new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));

const formatDate = (value: Date) => value.toISOString().slice(0, 10);

const parseDateParam = (value?: string | null) => {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) return null;
  return normalizeDate(parsed);
};

export const parseDateRange = (searchParams: URLSearchParams, fallbackDays = 90): DateRange => {
  const now = normalizeDate(new Date());
  const endDate = parseDateParam(searchParams.get("end")) ?? now;
  const startFallback = new Date(endDate);
  startFallback.setUTCDate(startFallback.getUTCDate() - fallbackDays);
  const startDate = parseDateParam(searchParams.get("start")) ?? normalizeDate(startFallback);
  const [start, end] = startDate <= endDate ? [startDate, endDate] : [endDate, startDate];
  return { start: formatDate(start), end: formatDate(end), startDate: start, endDate: end };
};

export const parseAnalyticsFilters = (searchParams: URLSearchParams): AnalyticsFilters => {
  const companyRaw = searchParams.get("company_id");
  const contactRaw = searchParams.get("contact_id");
  const companyId = companyRaw ? Number(companyRaw) : undefined;
  const contactId = contactRaw ? Number(contactRaw) : undefined;
  const status = (searchParams.get("status") || "").trim();
  const assignee = (searchParams.get("assignee") || "").trim();
  const currency = (searchParams.get("currency") || "").trim().toUpperCase();
  return {
    companyId: Number.isFinite(companyId) ? companyId : undefined,
    contactId: Number.isFinite(contactId) ? contactId : undefined,
    status: status || undefined,
    assignee: assignee || undefined,
    currency: currency || undefined
  };
};

type FilterKey = keyof AnalyticsFilters;

const filterColumnMap: Record<FilterKey, string> = {
  companyId: "company_id",
  contactId: "contact_id",
  status: "status",
  assignee: "assignee",
  currency: "currency"
};

const buildFilterClauses = (
  filters: AnalyticsFilters,
  allowed: FilterKey[],
  alias?: string
) => {
  const prefix = alias ? `${alias}.` : "";
  const clauses: string[] = [];
  const params: Array<string | number> = [];
  for (const key of allowed) {
    const value = filters[key];
    if (value === undefined || value === "") continue;
    clauses.push(`${prefix}${filterColumnMap[key]} = ?`);
    params.push(value as string | number);
  }
  return { clauses, params };
};

const buildWhere = ({
  ownerEmail,
  dateColumn,
  range,
  filters,
  allowedFilters,
  alias
}: {
  ownerEmail: string;
  dateColumn?: string;
  range?: DateRange;
  filters?: AnalyticsFilters;
  allowedFilters?: FilterKey[];
  alias?: string;
}) => {
  const prefix = alias ? `${alias}.` : "";
  const clauses: string[] = [`${prefix}owner_email = ?`];
  const params: Array<string | number> = [ownerEmail];
  if (dateColumn && range) {
    clauses.push(`date(${prefix}${dateColumn}) BETWEEN date(?) AND date(?)`);
    params.push(range.start, range.end);
  }
  if (filters && allowedFilters?.length) {
    const extra = buildFilterClauses(filters, allowedFilters, alias);
    clauses.push(...extra.clauses);
    params.push(...extra.params);
  }
  return { clause: clauses.join(" AND "), params };
};

const getGrainExpression = (grain: Grain, column: string) => {
  switch (grain) {
    case "week":
      return `date(${column}, 'weekday 1', '-7 days')`;
    case "month":
      return `strftime('%Y-%m-01', ${column})`;
    case "day":
    default:
      return `date(${column})`;
  }
};

export const getKpis = async (
  db: D1Queryable,
  ownerEmail: string,
  range: DateRange,
  filters: AnalyticsFilters
) => {
  const orderWhere = buildWhere({
    ownerEmail,
    dateColumn: "created_at",
    range,
    filters,
    allowedFilters: ["companyId", "contactId", "currency", "status"]
  });
  const invoiceOpenWhere = buildWhere({
    ownerEmail,
    filters,
    allowedFilters: ["companyId", "contactId", "currency"]
  });
  const invoiceOverdueWhere = buildWhere({
    ownerEmail,
    filters,
    allowedFilters: ["companyId", "contactId", "currency"]
  });
  const quotationWhere = buildWhere({
    ownerEmail,
    dateColumn: "created_at",
    range,
    filters,
    allowedFilters: ["companyId", "contactId", "currency", "status"]
  });
  const companyWhere = buildWhere({ ownerEmail });
  const contactWhere = buildWhere({ ownerEmail });
  const tasksDueWhere = buildWhere({
    ownerEmail,
    filters,
    allowedFilters: ["assignee", "status"]
  });

  const today = formatDate(normalizeDate(new Date()));
  const dueSoonEnd = normalizeDate(new Date());
  dueSoonEnd.setUTCDate(dueSoonEnd.getUTCDate() + 7);
  const dueSoonEndText = formatDate(dueSoonEnd);

  const invoiceCountWhere = buildWhere({
    ownerEmail,
    dateColumn: "created_at",
    range,
    filters,
    allowedFilters: ["companyId", "contactId", "currency", "status"]
  });

  const statements = [
    db
      .prepare(
        `SELECT COALESCE(SUM(total_amount), 0) AS total_revenue,
                COUNT(*) AS order_count
         FROM orders
         WHERE ${orderWhere.clause}`
      )
      .bind(...orderWhere.params),
    db
      .prepare(
        `SELECT COALESCE(SUM(total_amount), 0) AS invoice_total_open,
                COUNT(*) AS invoice_count_open
         FROM invoices
         WHERE ${invoiceOpenWhere.clause} AND status = 'Open'`
      )
      .bind(...invoiceOpenWhere.params),
    db
      .prepare(
        `SELECT COUNT(*) AS overdue_invoice_count
         FROM invoices
         WHERE ${invoiceOverdueWhere.clause}
           AND status = 'Open'
           AND due_date IS NOT NULL
           AND date(due_date) < date(?)`
      )
      .bind(...invoiceOverdueWhere.params, today),
    db
      .prepare(
        `SELECT status, COALESCE(SUM(amount), 0) AS amount
         FROM quotations
         WHERE ${quotationWhere.clause}
         GROUP BY status`
      )
      .bind(...quotationWhere.params),
    db
      .prepare(
        `SELECT COUNT(*) AS company_count_active
         FROM companies
         WHERE ${companyWhere.clause} AND status = 'Active'`
      )
      .bind(...companyWhere.params),
    db
      .prepare(
        `SELECT status, COUNT(*) AS count
         FROM contacts
         WHERE ${contactWhere.clause}
         GROUP BY status`
      )
      .bind(...contactWhere.params),
    db
      .prepare(
        `SELECT COUNT(*) AS tasks_due_7d
         FROM tasks
         WHERE ${tasksDueWhere.clause}
           AND due_date IS NOT NULL
           AND date(due_date) BETWEEN date(?) AND date(?)`
      )
      .bind(...tasksDueWhere.params, today, dueSoonEndText),
    db
      .prepare(
        `SELECT COUNT(*) AS tasks_overdue
         FROM tasks
         WHERE ${tasksDueWhere.clause}
           AND due_date IS NOT NULL
           AND date(due_date) < date(?)`
      )
      .bind(...tasksDueWhere.params, today),
    db
      .prepare(
        `SELECT
          SUM(CASE WHEN status = 'Open' AND due_date IS NOT NULL AND julianday('now') - julianday(due_date) < 0 THEN 1 ELSE 0 END) AS not_due,
          SUM(CASE WHEN status = 'Open' AND due_date IS NOT NULL AND julianday('now') - julianday(due_date) BETWEEN 0 AND 7 THEN 1 ELSE 0 END) AS bucket_0_7,
          SUM(CASE WHEN status = 'Open' AND due_date IS NOT NULL AND julianday('now') - julianday(due_date) BETWEEN 8 AND 30 THEN 1 ELSE 0 END) AS bucket_8_30,
          SUM(CASE WHEN status = 'Open' AND due_date IS NOT NULL AND julianday('now') - julianday(due_date) BETWEEN 31 AND 60 THEN 1 ELSE 0 END) AS bucket_31_60,
          SUM(CASE WHEN status = 'Open' AND due_date IS NOT NULL AND julianday('now') - julianday(due_date) >= 61 THEN 1 ELSE 0 END) AS bucket_60_plus
         FROM invoices
         WHERE ${invoiceOpenWhere.clause}`
      )
      .bind(...invoiceOpenWhere.params),
    db
      .prepare(
        `SELECT COUNT(*) AS quotation_count
         FROM quotations
         WHERE ${quotationWhere.clause}`
      )
      .bind(...quotationWhere.params),
    db
      .prepare(
        `SELECT COUNT(*) AS invoice_count
         FROM invoices
         WHERE ${invoiceCountWhere.clause}`
      )
      .bind(...invoiceCountWhere.params),
    db
      .prepare(
        `SELECT
          SUM(CASE WHEN status = 'Not Started' OR status IS NULL OR TRIM(status) = '' THEN 1 ELSE 0 END) AS tasks_not_started,
          SUM(CASE WHEN status = 'In Progress' THEN 1 ELSE 0 END) AS tasks_in_progress,
          SUM(CASE WHEN status = 'Done' THEN 1 ELSE 0 END) AS tasks_done
         FROM tasks
         WHERE owner_email = ?`
      )
      .bind(ownerEmail)
  ];

  const [
    orderStats,
    invoiceStats,
    overdueStats,
    quotationStats,
    companyStats,
    contactStatus,
    tasksDue,
    tasksOverdue,
    invoiceAging,
    quotationCount,
    invoiceCount,
    tasksStatusBreakdown
  ] = await db.batch<any>(statements);

  const orderRow = orderStats.results?.[0] ?? {};
  const invoiceRow = invoiceStats.results?.[0] ?? {};
  const overdueRow = overdueStats.results?.[0] ?? {};
  const companyRow = companyStats.results?.[0] ?? {};
  const quotationCountRow = quotationCount.results?.[0] ?? {};
  const invoiceCountRow = invoiceCount.results?.[0] ?? {};
  const invoiceAgingRow = invoiceAging.results?.[0] ?? {};

  const quotationStatusRows = (quotationStats.results ?? []) as Array<{ status: string | null; amount: number }>;
  const pipelineStatusSet = new Set(PIPELINE_STATUSES.map((status) => status.toLowerCase()));
  const hasPipelineStatus = quotationStatusRows.some((row) =>
    row.status ? pipelineStatusSet.has(row.status.toLowerCase()) : false
  );
  const quotationPipeline = quotationStatusRows.reduce((sum, row) => {
    if (!row.status) return sum;
    const inPipeline = pipelineStatusSet.has(row.status.toLowerCase());
    return sum + (hasPipelineStatus ? (inPipeline ? row.amount : 0) : row.amount);
  }, 0);

  return {
    total_revenue: Number(orderRow.total_revenue ?? 0),
    order_count: Number(orderRow.order_count ?? 0),
    invoice_total_open: Number(invoiceRow.invoice_total_open ?? 0),
    invoice_count_open: Number(invoiceRow.invoice_count_open ?? 0),
    overdue_invoice_count: Number(overdueRow.overdue_invoice_count ?? 0),
    quotation_pipeline: Number(quotationPipeline ?? 0),
    company_count_active: Number(companyRow.company_count_active ?? 0),
    tasks_due_7d: Number(tasksDue.results?.[0]?.tasks_due_7d ?? 0),
    tasks_overdue: Number(tasksOverdue.results?.[0]?.tasks_overdue ?? 0),
    tasks_not_started: Number(tasksStatusBreakdown.results?.[0]?.tasks_not_started ?? 0),
    tasks_in_progress: Number(tasksStatusBreakdown.results?.[0]?.tasks_in_progress ?? 0),
    tasks_done: Number(tasksStatusBreakdown.results?.[0]?.tasks_done ?? 0),
    quotation_count: Number(quotationCountRow.quotation_count ?? 0),
    invoice_count: Number(invoiceCountRow.invoice_count ?? 0),
    quotation_status_breakdown: quotationStatusRows.map((row) => ({
      status: row.status ?? "Unknown",
      amount: Number(row.amount ?? 0)
    })),
    contact_status_breakdown: (contactStatus.results ?? []).map((row: any) => ({
      status: row.status ?? "Unknown",
      count: Number(row.count ?? 0)
    })),
    invoice_aging: {
      not_due: Number(invoiceAgingRow.not_due ?? 0),
      bucket_0_7: Number(invoiceAgingRow.bucket_0_7 ?? 0),
      bucket_8_30: Number(invoiceAgingRow.bucket_8_30 ?? 0),
      bucket_31_60: Number(invoiceAgingRow.bucket_31_60 ?? 0),
      bucket_60_plus: Number(invoiceAgingRow.bucket_60_plus ?? 0)
    }
  };
};

const metricConfig: Record<
  Exclude<ForecastMetric, "open_invoices" | "overdue_invoices"> | "samples",
  { table: string; value: string; dateColumn: string; amountColumn?: string }
> = {
  revenue: { table: "orders", value: "SUM(total_amount)", dateColumn: "created_at", amountColumn: "total_amount" },
  orders: { table: "orders", value: "COUNT(*)", dateColumn: "created_at" },
  invoices: { table: "invoices", value: "COUNT(*)", dateColumn: "created_at" },
  quotations: { table: "quotations", value: "COUNT(*)", dateColumn: "created_at" },
  samples: { table: "sample_shipments", value: "COUNT(*)", dateColumn: "created_at" },
  tasks: { table: "tasks", value: "COUNT(*)", dateColumn: "due_date" },
  shipping: { table: "shipping_schedules", value: "COUNT(*)", dateColumn: "created_at" }
};

export const getTimeSeries = async (
  db: D1Queryable,
  ownerEmail: string,
  metric: "revenue" | "orders" | "invoices" | "quotations" | "samples" | "tasks" | "shipping",
  grain: Grain,
  range: DateRange,
  filters: AnalyticsFilters
) => {
  const config = metricConfig[metric];
  const periodExpr = getGrainExpression(grain, config.dateColumn);
  let allowedFilters: FilterKey[] = ["companyId", "contactId", "currency", "status"];
  if (metric === "samples") {
    allowedFilters = ["companyId", "status"];
  } else if (metric === "tasks") {
    allowedFilters = ["assignee", "status"];
  } else if (metric === "shipping") {
    allowedFilters = ["companyId", "status"];
  }
  const where = buildWhere({
    ownerEmail,
    dateColumn: config.dateColumn,
    range,
    filters,
    allowedFilters
  });
  const { results } = await db
    .prepare(
      `SELECT ${periodExpr} AS period,
              ${config.value} AS value
       FROM ${config.table}
       WHERE ${where.clause}
       GROUP BY period
       ORDER BY period`
    )
    .bind(...where.params)
    .all<{ period: string; value: number }>();
  return (results ?? []).map((row: { period: string; value: number }) => ({ date: row.period, value: Number(row.value ?? 0) }));
};

export const getBreakdown = async (
  db: D1Queryable,
  ownerEmail: string,
  entity: BreakdownEntity,
  metric: BreakdownMetric,
  range: DateRange,
  filters: AnalyticsFilters,
  options?: { source?: string; field?: string; limit?: number; requireQuotation?: boolean }
) => {
  const limit = Math.min(Math.max(options?.limit ?? 10, 1), 50);
  if (entity === "company") {
    const valueExpr = metric === "revenue" ? "COALESCE(SUM(o.total_amount), 0)" : "COUNT(*)";
    const where = buildWhere({
      ownerEmail,
      dateColumn: "created_at",
      range,
      filters,
      allowedFilters: ["companyId", "contactId", "currency", "status"],
      alias: "o"
    });
    const { results } = await db
      .prepare(
        `SELECT COALESCE(NULLIF(TRIM(co.name), ''), 'Unknown') AS label,
                ${valueExpr} AS value
         FROM orders o
         LEFT JOIN companies co ON co.id = o.company_id AND co.owner_email = ?
         WHERE ${where.clause}
         GROUP BY o.company_id
         ORDER BY value DESC
         LIMIT ?`
      )
      .bind(ownerEmail, ...where.params, limit)
      .all<{ label: string; value: number }>();
    return (results ?? []).map((row) => ({ label: row.label, value: Number(row.value ?? 0) }));
  }

  if (entity === "product_category") {
    const valueExpr = metric === "revenue" ? "COALESCE(SUM(qi.line_total), 0)" : "COUNT(*)";
    const baseWhere = buildWhere({
      ownerEmail,
      dateColumn: "created_at",
      range,
      alias: "qi"
    });
    const extraFilters = buildFilterClauses(filters, ["companyId", "currency"], "q");
    const whereClause = [baseWhere.clause, ...extraFilters.clauses].join(" AND ");
    const whereParams = [...baseWhere.params, ...extraFilters.params];
    const { results } = await db
      .prepare(
        `SELECT COALESCE(NULLIF(TRIM(p.category), ''), 'Uncategorized') AS label,
                ${valueExpr} AS value
         FROM quotation_items qi
         LEFT JOIN products p ON p.id = qi.product_id AND p.owner_email = ?
         LEFT JOIN quotations q ON q.id = qi.quotation_id AND q.owner_email = ?
         WHERE ${whereClause}
         GROUP BY label
         ORDER BY value DESC
         LIMIT ?`
      )
      .bind(ownerEmail, ownerEmail, ...whereParams, limit)
      .all<{ label: string; value: number }>();
    return (results ?? []).map((row) => ({ label: row.label, value: Number(row.value ?? 0) }));
  }

  if (entity === "assignee") {
    const where = buildWhere({
      ownerEmail,
      dateColumn: "created_at",
      range,
      filters,
      allowedFilters: ["status", "assignee"]
    });
    const { results } = await db
      .prepare(
        `SELECT COALESCE(NULLIF(TRIM(assignee), ''), 'Unassigned') AS label,
                COUNT(*) AS value
         FROM tasks
         WHERE ${where.clause}
         GROUP BY label
         ORDER BY value DESC
         LIMIT ?`
      )
      .bind(...where.params, limit)
      .all<{ label: string; value: number }>();
    return (results ?? []).map((row) => ({ label: row.label, value: Number(row.value ?? 0) }));
  }

  const source = options?.source || "quotations";
  const field = options?.field || "status";
  const statusSources = new Set([
    "orders",
    "invoices",
    "quotations",
    "tasks",
    "shipping_schedules",
    "sample_shipments",
    "contacts",
    "companies"
  ]);
  if (!statusSources.has(source)) {
    return [];
  }
  const amountColumn =
    source === "orders"
      ? "total_amount"
      : source === "invoices"
        ? "total_amount"
        : source === "quotations"
          ? "amount"
          : "";
  const valueExpr = metric === "revenue" && amountColumn
    ? `COALESCE(SUM(${amountColumn}), 0)`
    : "COUNT(*)";

  const allowedFieldMap: Record<string, string[]> = {
    orders: ["status"],
    invoices: ["status"],
    quotations: ["status"],
    tasks: ["status"],
    shipping_schedules: ["status", "carrier"],
    sample_shipments: ["status", "courier"],
    contacts: ["status"],
    companies: ["status"]
  };
  const allowedFields = allowedFieldMap[source] ?? ["status"];
  const groupColumn = allowedFields.includes(field) ? field : "status";
  const allowedFilterMap: Record<string, FilterKey[]> = {
    orders: ["companyId", "contactId", "currency", "status"],
    invoices: ["companyId", "contactId", "currency", "status"],
    quotations: ["companyId", "contactId", "currency", "status"],
    tasks: ["assignee", "status"],
    shipping_schedules: ["companyId", "status"],
    sample_shipments: ["companyId", "status"],
    contacts: ["companyId", "status"],
    companies: ["status"]
  };
  // Tasks show current workload across all time — don't restrict by date range
  const where = buildWhere({
    ownerEmail,
    dateColumn: source === "tasks" ? undefined : "created_at",
    range: source === "tasks" ? undefined : range,
    filters,
    allowedFilters: allowedFilterMap[source] ?? ["status"]
  });
  const extraClauses: string[] = [];
  if (options?.requireQuotation && source === "orders") {
    extraClauses.push("quotation_id IS NOT NULL");
  }
  const combinedClause = [where.clause, ...extraClauses].join(" AND ");
  const { results } = await db
    .prepare(
      `SELECT COALESCE(NULLIF(TRIM(${groupColumn}), ''), 'Unknown') AS label,
              ${valueExpr} AS value
       FROM ${source}
       WHERE ${combinedClause}
       GROUP BY label
       ORDER BY value DESC
       LIMIT ?`
    )
    .bind(...where.params, limit)
    .all<{ label: string; value: number }>();
  return (results ?? []).map((row) => ({ label: row.label, value: Number(row.value ?? 0) }));
};

const parseSeriesDate = (value: string) => new Date(`${value}T00:00:00Z`);

const addGrain = (date: Date, grain: Grain) => {
  const next = new Date(date);
  if (grain === "week") {
    next.setUTCDate(next.getUTCDate() + 7);
    return next;
  }
  if (grain === "month") {
    next.setUTCMonth(next.getUTCMonth() + 1, 1);
    return next;
  }
  next.setUTCDate(next.getUTCDate() + 1);
  return next;
};

export const fillSeries = (series: SeriesPoint[], range: DateRange, grain: Grain) => {
  const lookup = new Map(series.map((point) => [point.date, point.value]));
  const filled: SeriesPoint[] = [];
  const startKey = series.length ? series[0].date : range.start;
  const endKey = series.length ? series[series.length - 1].date : range.end;
  let cursor = parseSeriesDate(startKey);
  const endDate = parseSeriesDate(endKey);
  while (cursor <= endDate) {
    const key = formatDate(cursor);
    filled.push({ date: key, value: Number(lookup.get(key) ?? 0) });
    cursor = addGrain(cursor, grain);
  }
  return filled;
};

const toSeasonIndex = (grain: Grain) => (grain === "month" ? 12 : 52);

const computeSeasonalIndex = (values: number[], seasonLength: number) => {
  const totals = new Array(seasonLength).fill(0);
  const counts = new Array(seasonLength).fill(0);
  values.forEach((value, index) => {
    const slot = index % seasonLength;
    totals[slot] += value;
    counts[slot] += 1;
  });
  const overall = values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);
  return totals.map((total, index) => {
    const count = counts[index] || 1;
    const avg = total / count;
    return overall > 0 ? avg / overall : 1;
  });
};

const linearRegression = (values: number[]) => {
  const n = values.length;
  if (n === 0) return { slope: 0, intercept: 0 };
  const meanX = (n - 1) / 2;
  const meanY = values.reduce((sum, value) => sum + value, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i += 1) {
    const dx = i - meanX;
    num += dx * (values[i] - meanY);
    den += dx * dx;
  }
  const slope = den === 0 ? 0 : num / den;
  const intercept = meanY - slope * meanX;
  return { slope, intercept };
};

const clampNonNegative = (value: number) => (value < 0 ? 0 : value);

export const buildForecast = (
  series: SeriesPoint[],
  grain: Grain,
  horizon: number,
  isCountMetric: boolean
) => {
  const values = series.map((point) => point.value);
  if (values.length === 0) {
    return {
      forecast: [],
      confidence: [],
      backtest: { periods: 0, mape: null }
    };
  }

  const seasonLength = toSeasonIndex(grain);
  const useSeason = values.length >= seasonLength * 2;
  const seasonalIndex = useSeason ? computeSeasonalIndex(values, seasonLength) : new Array(seasonLength).fill(1);
  const deseasonalized = values.map((value, index) => value / seasonalIndex[index % seasonLength]);
  const { slope, intercept } = linearRegression(deseasonalized);

  const fitted = deseasonalized.map((_, index) => (intercept + slope * index) * seasonalIndex[index % seasonLength]);
  const residuals = values.map((value, index) => value - fitted[index]);
  const variance =
    residuals.length > 2
      ? residuals.reduce((sum, value) => sum + value * value, 0) / (residuals.length - 2)
      : 0;
  const stdDev = Math.sqrt(variance);
  const confidence = [];
  const forecast = [];
  for (let i = 0; i < horizon; i += 1) {
    const index = values.length + i;
    const base = (intercept + slope * index) * seasonalIndex[index % seasonLength];
    const projected = isCountMetric ? clampNonNegative(base) : base;
    const point = {
      date: formatDate(addGrain(parseSeriesDate(series[series.length - 1].date), grain)),
      value: Number(projected.toFixed(2))
    };
    if (forecast.length) {
      point.date = formatDate(addGrain(parseSeriesDate(forecast[forecast.length - 1].date), grain));
    }
    forecast.push(point);
    const lower = clampNonNegative(projected - 1.96 * stdDev);
    const upper = clampNonNegative(projected + 1.96 * stdDev);
    confidence.push({ date: point.date, lower: Number(lower.toFixed(2)), upper: Number(upper.toFixed(2)) });
  }

  const backtestPeriods =
    values.length >= 8 ? Math.min(Math.max(Math.floor(values.length / 4), 4), 8) : 0;
  let mape: number | null = null;
  if (backtestPeriods > 0 && values.length > backtestPeriods) {
    const training = values.slice(0, values.length - backtestPeriods);
    const trainingSeasonal = useSeason ? computeSeasonalIndex(training, seasonLength) : new Array(seasonLength).fill(1);
    const trainingDeseasonal = training.map(
      (value, index) => value / trainingSeasonal[index % seasonLength]
    );
    const { slope: trainSlope, intercept: trainIntercept } = linearRegression(trainingDeseasonal);
    const errors = [];
    for (let i = 0; i < backtestPeriods; i += 1) {
      const idx = training.length + i;
      const base = (trainIntercept + trainSlope * idx) * trainingSeasonal[idx % seasonLength];
      const actual = values[idx];
      const denom = actual === 0 ? 1 : actual;
      errors.push(Math.abs((actual - base) / denom));
    }
    const avg = errors.reduce((sum, value) => sum + value, 0) / errors.length;
    mape = Number((avg * 100).toFixed(2));
  }

  return {
    forecast,
    confidence,
    backtest: { periods: backtestPeriods, mape }
  };
};

export const getForecastSeries = async (
  db: D1Queryable,
  ownerEmail: string,
  metric: ForecastMetric,
  grain: Grain,
  range: DateRange,
  filters: AnalyticsFilters
) => {
  if (metric === "open_invoices" || metric === "overdue_invoices") {
    const periodExpr = getGrainExpression(grain, "created_at");
    const baseWhere = buildWhere({
      ownerEmail,
      dateColumn: "created_at",
      range,
      filters,
      allowedFilters: ["companyId", "contactId", "currency"]
    });
    const extra =
      metric === "overdue_invoices"
        ? "AND status = 'Open' AND due_date IS NOT NULL AND date(due_date) < date('now')"
        : "AND status = 'Open'";
    const { results } = await db
      .prepare(
        `SELECT ${periodExpr} AS period,
                COUNT(*) AS value
         FROM invoices
         WHERE ${baseWhere.clause} ${extra}
         GROUP BY period
         ORDER BY period`
      )
      .bind(...baseWhere.params)
      .all<{ period: string; value: number }>();
    return (results ?? []).map((row) => ({ date: row.period, value: Number(row.value ?? 0) }));
  }
  return getTimeSeries(
    db,
    ownerEmail,
    metric === "revenue" ? "revenue" : metric,
    grain,
    range,
    filters
  );
};

export const getDataQuality = async (db: D1Queryable, ownerEmail: string) => {
  const statements = [
    db
      .prepare(
        `SELECT
          SUM(CASE WHEN name IS NULL OR TRIM(name) = '' THEN 1 ELSE 0 END) AS companies_missing_name,
          SUM(CASE WHEN email IS NULL OR TRIM(email) = '' THEN 1 ELSE 0 END) AS companies_missing_email
         FROM companies
         WHERE owner_email = ?`
      )
      .bind(ownerEmail),
    db
      .prepare(
        `SELECT
          SUM(CASE WHEN (first_name IS NULL OR TRIM(first_name) = '') AND (last_name IS NULL OR TRIM(last_name) = '') THEN 1 ELSE 0 END) AS contacts_missing_name,
          SUM(CASE WHEN email IS NULL OR TRIM(email) = '' THEN 1 ELSE 0 END) AS contacts_missing_email,
          SUM(CASE WHEN phone IS NULL OR TRIM(phone) = '' THEN 1 ELSE 0 END) AS contacts_missing_phone
         FROM contacts
         WHERE owner_email = ?`
      )
      .bind(ownerEmail),
    db
      .prepare(
        `SELECT
          SUM(CASE WHEN due_date IS NULL OR TRIM(due_date) = '' THEN 1 ELSE 0 END) AS invoices_missing_due_date,
          SUM(CASE WHEN total_amount IS NULL THEN 1 ELSE 0 END) AS invoices_missing_total
         FROM invoices
         WHERE owner_email = ?`
      )
      .bind(ownerEmail),
    db
      .prepare(
        `SELECT
          SUM(CASE WHEN company_id IS NULL THEN 1 ELSE 0 END) AS orders_missing_company,
          SUM(CASE WHEN contact_id IS NULL THEN 1 ELSE 0 END) AS orders_missing_contact
         FROM orders
         WHERE owner_email = ?`
      )
      .bind(ownerEmail),
    db
      .prepare(
        `SELECT
          SUM(CASE WHEN due_date IS NULL OR TRIM(due_date) = '' THEN 1 ELSE 0 END) AS tasks_missing_due_date,
          SUM(CASE WHEN title IS NULL OR TRIM(title) = '' THEN 1 ELSE 0 END) AS tasks_missing_title
         FROM tasks
         WHERE owner_email = ?`
      )
      .bind(ownerEmail),
    db
      .prepare(
        `SELECT COUNT(*) AS orders_orphan_company
         FROM orders o
         LEFT JOIN companies c ON c.id = o.company_id AND c.owner_email = o.owner_email
         WHERE o.owner_email = ? AND o.company_id IS NOT NULL AND c.id IS NULL`
      )
      .bind(ownerEmail),
    db
      .prepare(
        `SELECT COUNT(*) AS orders_orphan_contact
         FROM orders o
         LEFT JOIN contacts c ON c.id = o.contact_id AND c.owner_email = o.owner_email
         WHERE o.owner_email = ? AND o.contact_id IS NOT NULL AND c.id IS NULL`
      )
      .bind(ownerEmail),
    db
      .prepare(
        `SELECT COUNT(*) AS quotations_orphan_company
         FROM quotations q
         LEFT JOIN companies c ON c.id = q.company_id AND c.owner_email = q.owner_email
         WHERE q.owner_email = ? AND q.company_id IS NOT NULL AND c.id IS NULL`
      )
      .bind(ownerEmail),
    db
      .prepare(
        `SELECT COUNT(*) AS quotations_orphan_contact
         FROM quotations q
         LEFT JOIN contacts c ON c.id = q.contact_id AND c.owner_email = q.owner_email
         WHERE q.owner_email = ? AND q.contact_id IS NOT NULL AND c.id IS NULL`
      )
      .bind(ownerEmail),
    db
      .prepare(
        `SELECT COUNT(*) AS invoices_orphan_company
         FROM invoices i
         LEFT JOIN companies c ON c.id = i.company_id AND c.owner_email = i.owner_email
         WHERE i.owner_email = ? AND i.company_id IS NOT NULL AND c.id IS NULL`
      )
      .bind(ownerEmail),
    db
      .prepare(
        `SELECT COUNT(*) AS invoices_orphan_contact
         FROM invoices i
         LEFT JOIN contacts c ON c.id = i.contact_id AND c.owner_email = i.owner_email
         WHERE i.owner_email = ? AND i.contact_id IS NOT NULL AND c.id IS NULL`
      )
      .bind(ownerEmail),
    db
      .prepare(
        `SELECT email, COUNT(*) AS count
         FROM contacts
         WHERE owner_email = ? AND email IS NOT NULL AND TRIM(email) != ''
         GROUP BY email
         HAVING COUNT(*) > 1
         ORDER BY count DESC
         LIMIT 10`
      )
      .bind(ownerEmail),
    db
      .prepare(
        `SELECT phone, COUNT(*) AS count
         FROM contacts
         WHERE owner_email = ? AND phone IS NOT NULL AND TRIM(phone) != ''
         GROUP BY phone
         HAVING COUNT(*) > 1
         ORDER BY count DESC
         LIMIT 10`
      )
      .bind(ownerEmail),
    db
      .prepare(
        `SELECT TRIM(first_name || ' ' || last_name) AS name, COUNT(*) AS count
         FROM contacts
         WHERE owner_email = ? AND (first_name IS NOT NULL OR last_name IS NOT NULL)
         GROUP BY name
         HAVING COUNT(*) > 1
         ORDER BY count DESC
         LIMIT 10`
      )
      .bind(ownerEmail),
    db.prepare("SELECT MAX(updated_at) AS latest FROM companies WHERE owner_email = ?").bind(ownerEmail),
    db.prepare("SELECT MAX(updated_at) AS latest FROM contacts WHERE owner_email = ?").bind(ownerEmail),
    db.prepare("SELECT MAX(updated_at) AS latest FROM orders WHERE owner_email = ?").bind(ownerEmail),
    db.prepare("SELECT MAX(updated_at) AS latest FROM quotations WHERE owner_email = ?").bind(ownerEmail),
    db.prepare("SELECT MAX(updated_at) AS latest FROM invoices WHERE owner_email = ?").bind(ownerEmail),
    db.prepare("SELECT MAX(updated_at) AS latest FROM tasks WHERE owner_email = ?").bind(ownerEmail),
    db.prepare("SELECT MAX(updated_at) AS latest FROM shipping_schedules WHERE owner_email = ?").bind(ownerEmail),
    db.prepare("SELECT MAX(updated_at) AS latest FROM sample_shipments WHERE owner_email = ?").bind(ownerEmail)
  ];

  const results = await db.batch<any>(statements);

  const missingCompanies = results[0].results?.[0] ?? {};
  const missingContacts = results[1].results?.[0] ?? {};
  const missingInvoices = results[2].results?.[0] ?? {};
  const missingOrders = results[3].results?.[0] ?? {};
  const missingTasks = results[4].results?.[0] ?? {};

  const freshnessKeys = [
    "companies",
    "contacts",
    "orders",
    "quotations",
    "invoices",
    "tasks",
    "shipping_schedules",
    "sample_shipments"
  ];
  const freshnessStart = results.length - freshnessKeys.length;
  const freshness: Record<string, string | null> = {};
  freshnessKeys.forEach((key, index) => {
    const row = results[freshnessStart + index].results?.[0] ?? {};
    freshness[key] = row.latest ?? null;
  });

  return {
    missing_fields: {
      companies_missing_name: Number(missingCompanies.companies_missing_name ?? 0),
      companies_missing_email: Number(missingCompanies.companies_missing_email ?? 0),
      contacts_missing_name: Number(missingContacts.contacts_missing_name ?? 0),
      contacts_missing_email: Number(missingContacts.contacts_missing_email ?? 0),
      contacts_missing_phone: Number(missingContacts.contacts_missing_phone ?? 0),
      invoices_missing_due_date: Number(missingInvoices.invoices_missing_due_date ?? 0),
      invoices_missing_total: Number(missingInvoices.invoices_missing_total ?? 0),
      orders_missing_company: Number(missingOrders.orders_missing_company ?? 0),
      orders_missing_contact: Number(missingOrders.orders_missing_contact ?? 0),
      tasks_missing_due_date: Number(missingTasks.tasks_missing_due_date ?? 0),
      tasks_missing_title: Number(missingTasks.tasks_missing_title ?? 0)
    },
    orphans: {
      orders_orphan_company: Number(results[5].results?.[0]?.orders_orphan_company ?? 0),
      orders_orphan_contact: Number(results[6].results?.[0]?.orders_orphan_contact ?? 0),
      quotations_orphan_company: Number(results[7].results?.[0]?.quotations_orphan_company ?? 0),
      quotations_orphan_contact: Number(results[8].results?.[0]?.quotations_orphan_contact ?? 0),
      invoices_orphan_company: Number(results[9].results?.[0]?.invoices_orphan_company ?? 0),
      invoices_orphan_contact: Number(results[10].results?.[0]?.invoices_orphan_contact ?? 0)
    },
    duplicates: {
      contacts_email: (results[11].results ?? []).map((row: any) => ({
        value: row.email,
        count: Number(row.count ?? 0)
      })),
      contacts_phone: (results[12].results ?? []).map((row: any) => ({
        value: row.phone,
        count: Number(row.count ?? 0)
      })),
      contacts_name: (results[13].results ?? []).map((row: any) => ({
        value: row.name,
        count: Number(row.count ?? 0)
      }))
    },
    freshness
  };
};
