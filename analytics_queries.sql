-- Analytics dashboard query reference (Cloudflare D1 / SQLite)
-- All queries are scoped by owner_email and use ISO-8601 text timestamps.

-- KPI: total revenue and order count in date range
SELECT COALESCE(SUM(total_amount), 0) AS total_revenue,
       COUNT(*) AS order_count
FROM orders
WHERE owner_email = ?
  AND date(created_at) BETWEEN date(?) AND date(?);

-- KPI: open invoices total + count (current)
SELECT COALESCE(SUM(total_amount), 0) AS invoice_total_open,
       COUNT(*) AS invoice_count_open
FROM invoices
WHERE owner_email = ?
  AND status = 'Open';

-- KPI: invoice aging buckets (open invoices)
SELECT
  SUM(CASE WHEN status = 'Open' AND due_date IS NOT NULL AND julianday('now') - julianday(due_date) < 0 THEN 1 ELSE 0 END) AS not_due,
  SUM(CASE WHEN status = 'Open' AND due_date IS NOT NULL AND julianday('now') - julianday(due_date) BETWEEN 0 AND 7 THEN 1 ELSE 0 END) AS bucket_0_7,
  SUM(CASE WHEN status = 'Open' AND due_date IS NOT NULL AND julianday('now') - julianday(due_date) BETWEEN 8 AND 30 THEN 1 ELSE 0 END) AS bucket_8_30,
  SUM(CASE WHEN status = 'Open' AND due_date IS NOT NULL AND julianday('now') - julianday(due_date) BETWEEN 31 AND 60 THEN 1 ELSE 0 END) AS bucket_31_60,
  SUM(CASE WHEN status = 'Open' AND due_date IS NOT NULL AND julianday('now') - julianday(due_date) >= 61 THEN 1 ELSE 0 END) AS bucket_60_plus
FROM invoices
WHERE owner_email = ?;

-- KPI: overdue open invoices
SELECT COUNT(*) AS overdue_invoice_count
FROM invoices
WHERE owner_email = ?
  AND status = 'Open'
  AND due_date IS NOT NULL
  AND date(due_date) < date(?);

-- KPI: quotation pipeline by status (date range)
SELECT status, COALESCE(SUM(amount), 0) AS amount
FROM quotations
WHERE owner_email = ?
  AND date(created_at) BETWEEN date(?) AND date(?)
GROUP BY status;

-- KPI: active companies
SELECT COUNT(*) AS company_count_active
FROM companies
WHERE owner_email = ?
  AND status = 'Active';

-- KPI: tasks due soon (next 7 days) + overdue
SELECT COUNT(*) AS tasks_due_7d
FROM tasks
WHERE owner_email = ?
  AND due_date IS NOT NULL
  AND date(due_date) BETWEEN date(?) AND date(?);

SELECT COUNT(*) AS tasks_overdue
FROM tasks
WHERE owner_email = ?
  AND due_date IS NOT NULL
  AND date(due_date) < date(?);

-- Timeseries: revenue / order count / invoice count / quotation count / sample shipments
-- Replace {value_expr} with SUM(total_amount) or COUNT(*)
-- Replace {table} with orders/invoices/quotations/sample_shipments
-- Replace {period_expr} with:
--   day   -> date(created_at)
--   week  -> date(created_at, 'weekday 1', '-7 days')
--   month -> strftime('%Y-%m-01', created_at)
SELECT {period_expr} AS period,
       {value_expr} AS value
FROM {table}
WHERE owner_email = ?
  AND date(created_at) BETWEEN date(?) AND date(?)
GROUP BY period
ORDER BY period;

-- Timeseries: tasks due (by due_date) / shipping volume (created_at)
SELECT {period_expr} AS period,
       COUNT(*) AS value
FROM tasks
WHERE owner_email = ?
  AND date(due_date) BETWEEN date(?) AND date(?)
GROUP BY period
ORDER BY period;

SELECT {period_expr} AS period,
       COUNT(*) AS value
FROM shipping_schedules
WHERE owner_email = ?
  AND date(created_at) BETWEEN date(?) AND date(?)
GROUP BY period
ORDER BY period;

-- Breakdown: revenue by company
SELECT COALESCE(NULLIF(TRIM(c.name), ''), 'Unknown') AS label,
       COALESCE(SUM(o.total_amount), 0) AS value
FROM orders o
LEFT JOIN companies c ON c.id = o.company_id AND c.owner_email = ?
WHERE o.owner_email = ?
  AND date(o.created_at) BETWEEN date(?) AND date(?)
GROUP BY o.company_id
ORDER BY value DESC
LIMIT ?;

-- Breakdown: quotation items by product category
SELECT COALESCE(NULLIF(TRIM(p.category), ''), 'Uncategorized') AS label,
       COALESCE(SUM(qi.line_total), 0) AS value
FROM quotation_items qi
LEFT JOIN products p ON p.id = qi.product_id AND p.owner_email = ?
LEFT JOIN quotations q ON q.id = qi.quotation_id AND q.owner_email = ?
WHERE qi.owner_email = ?
  AND date(qi.created_at) BETWEEN date(?) AND date(?)
GROUP BY label
ORDER BY value DESC
LIMIT ?;

-- Breakdown: status counts (replace {table} with orders/invoices/quotations/tasks/shipping_schedules/sample_shipments)
SELECT COALESCE(NULLIF(TRIM(status), ''), 'Unknown') AS label,
       COUNT(*) AS value
FROM {table}
WHERE owner_email = ?
  AND date(created_at) BETWEEN date(?) AND date(?)
GROUP BY label
ORDER BY value DESC
LIMIT ?;

-- Forecast: base series for revenue/orders/invoices/quotations
SELECT {period_expr} AS period,
       {value_expr} AS value
FROM {table}
WHERE owner_email = ?
  AND date(created_at) BETWEEN date(?) AND date(?)
GROUP BY period
ORDER BY period;

-- Forecast: open invoices count by period
SELECT {period_expr} AS period,
       COUNT(*) AS value
FROM invoices
WHERE owner_email = ?
  AND status = 'Open'
  AND date(created_at) BETWEEN date(?) AND date(?)
GROUP BY period
ORDER BY period;

-- Data quality: missing fields (examples)
SELECT
  SUM(CASE WHEN name IS NULL OR TRIM(name) = '' THEN 1 ELSE 0 END) AS companies_missing_name,
  SUM(CASE WHEN email IS NULL OR TRIM(email) = '' THEN 1 ELSE 0 END) AS companies_missing_email
FROM companies
WHERE owner_email = ?;

SELECT
  SUM(CASE WHEN (first_name IS NULL OR TRIM(first_name) = '') AND (last_name IS NULL OR TRIM(last_name) = '') THEN 1 ELSE 0 END) AS contacts_missing_name,
  SUM(CASE WHEN email IS NULL OR TRIM(email) = '' THEN 1 ELSE 0 END) AS contacts_missing_email
FROM contacts
WHERE owner_email = ?;

-- Data quality: orphan checks (orders -> companies)
SELECT COUNT(*) AS orders_orphan_company
FROM orders o
LEFT JOIN companies c ON c.id = o.company_id AND c.owner_email = o.owner_email
WHERE o.owner_email = ?
  AND o.company_id IS NOT NULL
  AND c.id IS NULL;

-- Data quality: duplicate contacts by email
SELECT email, COUNT(*) AS count
FROM contacts
WHERE owner_email = ?
  AND email IS NOT NULL
  AND TRIM(email) != ''
GROUP BY email
HAVING COUNT(*) > 1
ORDER BY count DESC
LIMIT 10;

-- Data quality: freshness
SELECT MAX(updated_at) AS latest
FROM orders
WHERE owner_email = ?;
