console.log('app.js module evaluation start');
window.addEventListener('error', (event) => {
  console.error('Global error:', event.error);
});

const authTokenKey = "crm:authenticated";
const authRoleKey = "crm:role";
const authEmailKey = "crm:email";
const authAccessKey = "crm:access";
const userStoreKey = "crm:users";
const demoPasswordKey = "crm:demo-password";
const demoEmailKey = "crm:demo-email";
const demoDisabledKey = "crm:demo-disabled";
const adminRole = "Admin";
const salesRole = "Salesperson";
const demoCredentials = {
  email: "admin@salesaid.com",
  password: "demo1234"
};
const salesContentKey = "crm:sales-content";
const salesStatusCycle = ["New", "In progress", "Ready"];

const addUserRoleOptions = [
  "Salesperson"
];

const accessOptions = [
  { id: "tags", label: "Tags", aliases: ["tag", "tags"] },
  { id: "companies", label: "Companies", aliases: ["company", "companies"] },
  { id: "contacts", label: "Contacts", aliases: ["contact", "contacts"] },
  { id: "products", label: "Products", aliases: ["product", "products"] },
  { id: "pricing", label: "Pricing", aliases: ["pricing", "plan", "plans"] },
  { id: "orders", label: "Orders", aliases: ["order", "orders"] },
  { id: "quotations", label: "Quotations", aliases: ["quotation", "quotations", "quote", "quotes"] },
  { id: "invoices", label: "Invoices", aliases: ["invoice", "invoices"] },
  { id: "documents", label: "Documents", aliases: ["document", "documents", "docs"] },
  { id: "shipping", label: "Shipping", aliases: ["shipping", "schedule", "schedules"] },
  { id: "sample_shipments", label: "Samples", aliases: ["sample", "samples", "sample_shipments"] },
  { id: "tasks", label: "Tasks", aliases: ["task", "tasks"] },
  { id: "notes", label: "Notes", aliases: ["note", "notes"] },
  { id: "settings", label: "Settings", aliases: ["setting", "settings"] }
];

const accessLookup = new Map();
accessOptions.forEach((option) => {
  [option.id, option.label, ...(option.aliases || [])].forEach((key) => {
    accessLookup.set(String(key).trim().toLowerCase(), option.id);
  });
});

let currentRole = adminRole;
let currentUserEmail = "";
let currentAccessList = [];
let salesContentItems = [];
let navItems = [];

const loginScreen = document.querySelector(".login-screen");
const appShell = document.querySelector(".app-shell");
const loginForm = document.getElementById("login-form");
const loginError = document.getElementById("login-error");
const logoutButton = document.getElementById("logout-button");
const userDisplay = document.getElementById("user-display");
const salesLogoutButton = document.getElementById("sales-logout-button");
const salesWorkspace = document.getElementById("sales-workspace");
const salesContentList = document.getElementById("sales-content-list");
const salesAddForm = document.getElementById("sales-add-content-form");

function safeLocalStorageSet(key, value) {
  try {
    window.localStorage.setItem(key, value);
  } catch (error) {
    console.warn("Unable to write to localStorage", key, error);
  }
}

function safeLocalStorageGet(key) {
  try {
    return window.localStorage.getItem(key);
  } catch (error) {
    console.warn("Unable to read from localStorage", key, error);
    return null;
  }
}

function safeLocalStorageRemove(key) {
  try {
    window.localStorage.removeItem(key);
  } catch (error) {
    console.warn("Unable to remove from localStorage", key, error);
  }
}

function safeLocalStorageJsonGet(key) {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (error) {
    console.warn("Unable to parse localStorage JSON", key, error);
    return null;
  }
}

function safeLocalStorageJsonSet(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.warn("Unable to write JSON to localStorage", key, error);
  }
}

function getDemoCredentials() {
  let demoEmail = demoCredentials.email;
  let demoPassword = demoCredentials.password;
  try {
    const storedEmail = window.localStorage.getItem(demoEmailKey);
    if (storedEmail) demoEmail = storedEmail;
  } catch (error) {
    console.warn("Unable to read demo email", error);
  }
  try {
    const storedPassword = window.localStorage.getItem(demoPasswordKey);
    if (storedPassword) demoPassword = storedPassword;
  } catch (error) {
    console.warn("Unable to read demo password", error);
  }
  return { demoEmail, demoPassword };
}

function showAppShell() {
  loginScreen?.classList.add("hidden");
  appShell?.classList.remove("hidden");
  if (userDisplay) {
    userDisplay.textContent = currentUserEmail || "Unknown user";
  }
  applyRoleRestrictions();
}

function showLoginScreen() {
  loginScreen?.classList.remove("hidden");
  appShell?.classList.add("hidden");
  applyRoleRestrictions();
}

function handleLogout() {
  safeLocalStorageRemove(authTokenKey);
  safeLocalStorageRemove(authRoleKey);
  safeLocalStorageRemove(authEmailKey);
  safeLocalStorageRemove(authAccessKey);
  currentRole = adminRole;
  currentUserEmail = "";
  currentAccessList = [];
  showLoginScreen();
  loginForm?.reset();
  if (loginError) {
    loginError.textContent = "";
  }
}

function initAuthentication() {
  const storedRole = safeLocalStorageGet(authRoleKey);
  const storedEmail = safeLocalStorageGet(authEmailKey);
  const storedAccess = safeLocalStorageJsonGet(authAccessKey);
  currentRole = storedRole || adminRole;
  currentUserEmail = storedEmail || "";
  currentAccessList = Array.isArray(storedAccess) ? storedAccess : [];
  salesContentItems = loadSalesContentState();
  if (safeLocalStorageGet(authTokenKey) === "true") {
    if (!currentUserEmail) {
      handleLogout();
      return;
    }
    showAppShell();
    syncSiteConfigFromServer();
    return;
  }
  showLoginScreen();
}

if (logoutButton) {
  logoutButton.addEventListener("click", () => {
    handleLogout();
  });
}

if (salesLogoutButton) {
  salesLogoutButton.addEventListener("click", () => {
    handleLogout();
  });
}

if (loginForm) {
  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(loginForm);
    const email = (formData.get("email") || "").toString().trim().toLowerCase();
    const password = (formData.get("password") || "").toString().trim();
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail || !password) {
      if (loginError) {
        loginError.textContent = "Email and password are required.";
      }
      return;
    }
    try {
      const res = await apiFetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: normalizedEmail, password })
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        const message = payload?.error || "Invalid credentials. Try your admin account.";
        if (loginError) {
          loginError.textContent = message;
        }
        return;
      }
      const data = await res.json().catch(() => ({}));
      const user = normalizeUserRecord(data.user || { email: normalizedEmail, role: adminRole });
      currentRole = user.role || adminRole;
      currentUserEmail = user.email || normalizedEmail;
      currentAccessList = Array.isArray(user.accessList) ? user.accessList : [];
      safeLocalStorageSet(authEmailKey, currentUserEmail);
      safeLocalStorageSet(authRoleKey, currentRole);
      safeLocalStorageJsonSet(authAccessKey, currentAccessList);
      safeLocalStorageSet(authTokenKey, "true");
      showAppShell();
      setActiveNav("dashboard");
      renderSection("dashboard");
      syncSiteConfigFromServer();
      if (loginError) {
        loginError.textContent = "";
      }
    } catch (error) {
      console.error("Login failed", error);
      if (loginError) {
        loginError.textContent = "Unable to reach authentication service.";
      }
    }
  });
}

initAuthentication();

function tryLoginFromQuery() {
  if (!loginForm) return;
  if (safeLocalStorageGet(authTokenKey) === "true") return;
  const params = new URLSearchParams(window.location.search);
  const emailParam = params.get("email");
  const passwordParam = params.get("password");
  if (!emailParam || !passwordParam) return;
  const roleParam = params.get("workspaceRole") || adminRole;
  const emailInput = loginForm.querySelector('input[name="email"]');
  const passInput = loginForm.querySelector('input[name="password"]');
  const roleSelect = loginForm.querySelector('select[name="workspaceRole"]');
  if (emailInput) emailInput.value = emailParam;
  if (passInput) passInput.value = passwordParam;
  if (roleSelect) roleSelect.value = roleParam;
  if (typeof loginForm.requestSubmit === "function") {
    loginForm.requestSubmit();
  } else {
    loginForm.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
  }
  window.history.replaceState({}, document.title, window.location.pathname);
}

tryLoginFromQuery();

function applyRoleRestrictions() {
  document.body?.classList.remove("salesperson-mode");
  if (salesWorkspace) {
    salesWorkspace.classList.add("hidden");
  }
  applyAccessRestrictions();
}

navItems = Array.from(document.querySelectorAll(".nav-item"));
console.log('app.js loaded, navItems count:', navItems.length);
const sectionContent = document.getElementById("section-content");
const sectionTitle = document.getElementById("section-title");
let currentSection = "dashboard";
const cacheBypassTables = new Set();

const fallback = {
  companies: [],
  contacts: [],
  products: [],
  orders: [],
  quotations: [],
  invoices: [],
  documents: [],
  sample_shipments: [],
  shipping_schedules: [],
  tasks: [],
  notes: [],
  tags: [],
  doc_types: []
};

const defaultBankChargeMethods = ["Shared", "Customer pays", "We pay"];

const statDefaults = {
  companies: 0,
  contacts: 0,
  openOrders: 0,
  invoices: 0,
  quotations: 0,
  tasksOpen: 0
};

let privilegedUsers = [];

const timezoneOptions = [
  { value: "Asia/Taipei", label: "Taipei · Asia/Taipei (CST)" },
  { value: "Asia/Shanghai", label: "Shanghai · Asia/Shanghai (CST)" },
  { value: "Asia/Singapore", label: "Singapore · Asia/Singapore (SGT)" },
  { value: "Asia/Tokyo", label: "Tokyo · Asia/Tokyo (JST)" },
  { value: "Australia/Sydney", label: "Sydney · Australia/Sydney (AEST)" },
  { value: "Asia/Dubai", label: "Dubai · Asia/Dubai (GST)" },
  { value: "Europe/London", label: "London · Europe/London (GMT/BST)" },
  { value: "Europe/Berlin", label: "Berlin · Europe/Berlin (CET/CEST)" },
  { value: "America/New_York", label: "New York · America/New_York (ET)" },
  { value: "America/Chicago", label: "Chicago · America/Chicago (CT)" },
  { value: "America/Los_Angeles", label: "Los Angeles · America/Los_Angeles (PT)" },
  { value: "America/Sao_Paulo", label: "Sao Paulo · America/Sao_Paulo (BRT)" },
  { value: "Pacific/Auckland", label: "Auckland · Pacific/Auckland (NZST)" }
];

function deriveSiteNameFromDom() {
  if (typeof window === "undefined") return "";
  const brandTitle = document.querySelector(".brand-title");
  if (brandTitle?.textContent?.trim()) {
    return brandTitle.textContent.trim();
  }
  const loginTitle = document.querySelector(".login-title");
  if (loginTitle?.textContent) {
    const cleaned = loginTitle.textContent.replace(/\s*Workspace\s*$/i, "").trim();
    if (cleaned) return cleaned;
  }
  const titleEl = document.querySelector("title");
  if (titleEl?.textContent?.trim()) {
    return titleEl.textContent.trim();
  }
  return "";
}

const defaultSiteConfig = {
  activeTheme: "Professional",
  siteName: deriveSiteNameFromDom() || "Sales Aid",
  baseCompany: "",
  region: "Taipei (CST)",
  timezone: "Asia/Taipei",
  theme: "Professional",
  invoiceName: "",
  invoiceAddress: "",
  invoicePhone: "",
  showFooter: true
};

function normalizeBoolean(value, fallback) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "on", "yes"].includes(normalized)) return true;
    if (["false", "0", "off", "no"].includes(normalized)) return false;
  }
  return fallback;
}

function normalizeSiteConfigState(config) {
  const merged = { ...defaultSiteConfig, ...config };
  merged.showFooter = normalizeBoolean(config?.showFooter, merged.showFooter);
  return merged;
}

function loadSiteConfigState() {
  if (typeof window === "undefined") {
    return { ...defaultSiteConfig };
  }
  try {
    const stored = window.localStorage.getItem("siteConfigState");
    if (!stored) {
      return { ...defaultSiteConfig };
    }
    const parsed = JSON.parse(stored);
    return normalizeSiteConfigState(parsed);
  } catch (error) {
    console.warn("Unable to read saved site config", error);
    return { ...defaultSiteConfig };
  }
}

function persistSiteConfigState(state) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem("siteConfigState", JSON.stringify(state));
  } catch (error) {
    console.warn("Unable to persist site config", error);
  }
}

async function saveSiteConfigToServer(state) {
  const res = await apiFetch("/api/settings/site-config", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ...state,
      showFooter: !!state.showFooter
    })
  });
  if (!res.ok) {
    throw new Error("Unable to save site config");
  }
  return res.json().catch(() => ({}));
}

let siteConfigState = loadSiteConfigState();

async function fetchSiteConfigFromServer() {
  const res = await apiFetch("/api/settings/site-config");
  if (!res.ok) {
    return null;
  }
  const data = await res.json().catch(() => ({}));
  if (!data?.config || typeof data.config !== "object") {
    return null;
  }
  if (!Object.keys(data.config).length) {
    return null;
  }
  return normalizeSiteConfigState(data.config);
}

async function syncSiteConfigFromServer() {
  if (!currentUserEmail) return;
  try {
    const serverConfig = await fetchSiteConfigFromServer();
    if (!serverConfig) return;
    siteConfigState = serverConfig;
    persistSiteConfigState(siteConfigState);
    applySiteConfig();
    if (currentSection === "settings") {
      renderSection("settings");
    }
  } catch (error) {
    console.warn("Unable to sync site config", error);
  }
}

function applySiteConfig() {
  const brandTitle = document.querySelector(".brand-title");
  if (brandTitle) {
    brandTitle.textContent = siteConfigState.siteName;
  }
  const loginTitle = document.querySelector(".login-title");
  if (loginTitle) {
    loginTitle.textContent = siteConfigState.siteName
      ? `${siteConfigState.siteName} Workspace`
      : "Workspace";
  }
  const chip = document.querySelector(".topbar .chip");
  if (chip) {
    if (siteConfigState.siteName) {
      chip.textContent = siteConfigState.siteName;
      chip.style.display = "inline-flex";
    } else {
      chip.textContent = "";
      chip.style.display = "none";
    }
  }
  const titleEl = document.querySelector("title");
  if (titleEl) {
    titleEl.textContent = siteConfigState.siteName;
  }
}

applySiteConfig();

function generateTempPassword() {
  return Array.from({ length: 3 }, () => Math.random().toString(36).slice(2, 8)).join("-");
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (char) => {
    const map = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    };
    return map[char] || char;
  });
}

function loadSalesContentState() {
  try {
    const stored = window.localStorage.getItem(salesContentKey);
    if (!stored) return [];
    const parsed = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.warn("Unable to load sales content", error);
    return [];
  }
}

function persistSalesContentState(items) {
  try {
    window.localStorage.setItem(salesContentKey, JSON.stringify(items));
  } catch (error) {
    console.warn("Unable to persist sales content", error);
  }
}

function normalizeEmail(email) {
  return email.trim().toLowerCase();
}

function parseAccessList(accessText) {
  if (!accessText) return [];
  const tokens = String(accessText)
    .split(/[^a-z0-9]+/i)
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean);
  const resolved = [];
  tokens.forEach((token) => {
    const id = accessLookup.get(token);
    if (id && !resolved.includes(id)) {
      resolved.push(id);
    }
  });
  return resolved;
}

function formatAccessText(accessList) {
  if (!Array.isArray(accessList) || !accessList.length) {
    return "Custom access";
  }
  const labels = accessList
    .map((id) => accessOptions.find((option) => option.id === id)?.label || id)
    .filter(Boolean);
  return labels.join(" · ");
}

function normalizeUserRecord(user) {
  const email = normalizeEmail(user.email || "");
  const accessList = Array.isArray(user.accessList)
    ? user.accessList
    : Array.isArray(user.access_list)
      ? user.access_list
      : parseAccessList(user.access || "");
  const normalizedAccessList =
    accessList.length || user.role !== adminRole ? accessList : accessOptions.map((option) => option.id);
  const accessText = normalizedAccessList.length ? formatAccessText(normalizedAccessList) : user.access || "Custom access";
  return {
    ...user,
    email,
    accessList: normalizedAccessList,
    access: accessText,
    enabled: user.enabled !== false
  };
}

function getAllowedAccessList() {
  if (currentRole === adminRole) {
    return accessOptions.map((option) => option.id);
  }
  if (!Array.isArray(currentAccessList) || currentAccessList.length === 0) {
    return accessOptions.map((option) => option.id);
  }
  return currentAccessList;
}

function canAccessSection(section) {
  if (!section || section === "dashboard") return true;
  const allowed = getAllowedAccessList();
  return allowed.includes(section);
}

function applyAccessRestrictions() {
  const allowed = new Set(getAllowedAccessList());
  navItems.forEach((item) => {
    const section = item.dataset.section;
    if (!section || section === "dashboard") return;
    const canAccess = allowed.has(section);
    item.classList.toggle("hidden", !canAccess);
    if (!canAccess) {
      item.setAttribute("aria-disabled", "true");
    } else {
      item.removeAttribute("aria-disabled");
    }
  });
}

function loadUserAccounts() {
  try {
    const stored = window.localStorage.getItem(userStoreKey);
    if (!stored) return [];
    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((user) => user && typeof user.email === "string" && typeof user.password === "string")
      .map((user) => normalizeUserRecord(user));
  } catch (error) {
    console.warn("Unable to load user accounts", error);
    return [];
  }
}

function persistUserAccounts(users) {
  try {
    window.localStorage.setItem(userStoreKey, JSON.stringify(users));
  } catch (error) {
    console.warn("Unable to persist user accounts", error);
  }
}

async function readApiError(res, fallbackMessage) {
  try {
    const payload = await res.json();
    if (payload && payload.error) return payload.error;
  } catch {
    // ignore
  }
  try {
    const text = await res.text();
    if (text) return text;
  } catch {
    // ignore
  }
  return fallbackMessage;
}

async function fetchUsersFromApi() {
  const res = await apiFetch("/api/auth/users");
  if (!res.ok) {
    throw new Error(await readApiError(res, "Unable to load users"));
  }
  const data = await res.json().catch(() => ({}));
  const users = Array.isArray(data.users) ? data.users : [];
  return users.map((user) => normalizeUserRecord(user));
}

async function createUserOnServer(payload) {
  const res = await apiFetch("/api/auth/users", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    throw new Error(await readApiError(res, "Unable to create user"));
  }
  const data = await res.json().catch(() => ({}));
  return data.user ? normalizeUserRecord(data.user) : null;
}

async function updateUserOnServer(id, payload) {
  const res = await apiFetch(`/api/auth/users/${id}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    throw new Error(await readApiError(res, "Unable to update user"));
  }
  const data = await res.json().catch(() => ({}));
  return data.user ? normalizeUserRecord(data.user) : null;
}

async function updateUserPasswordOnServer(id, password) {
  const res = await apiFetch(`/api/auth/users/${id}/password`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password })
  });
  if (!res.ok) {
    throw new Error(await readApiError(res, "Unable to reset password"));
  }
  return true;
}

async function deleteUserOnServer(id) {
  const res = await apiFetch(`/api/auth/users/${id}`, { method: "DELETE" });
  if (!res.ok) {
    throw new Error(await readApiError(res, "Unable to delete user"));
  }
  return true;
}

const baseFetch = window.fetch.bind(window);

async function apiFetch(input, init = {}) {
  const url = typeof input === "string" ? input : input.url;
  let isApiRequest = false;
  try {
    const parsed = new URL(url, window.location.origin);
    isApiRequest = parsed.origin === window.location.origin && parsed.pathname.startsWith("/api/");
  } catch {
    isApiRequest = typeof url === "string" && url.startsWith("/api/");
  }

  if (!isApiRequest) {
    return baseFetch(input, init);
  }

  const headers = new Headers(init.headers || (input instanceof Request ? input.headers : undefined));
  if (currentUserEmail) {
    headers.set("x-user-email", currentUserEmail);
  }

  if (input instanceof Request) {
    const request = new Request(input, { ...init, headers });
    return baseFetch(request);
  }

  return baseFetch(url, { ...init, headers });
}

function renderSalesContent() {
  if (!salesContentList) return;
  if (!salesContentItems.length) {
    salesContentList.innerHTML = `<div class="sales-empty">No content yet. Capture a new talking point or asset above.</div>`;
    return;
  }
  salesContentList.innerHTML = salesContentItems
    .map((item) => {
      const safeTitle = escapeHtml(item.title);
      const safeDescription = escapeHtml(item.description);
      const displayDate = new Date(item.createdAt).toLocaleString();
      return `
        <article class="sales-card" data-id="${item.id}">
          <div class="sales-card-header">
            <h3>${safeTitle}</h3>
            <span class="sales-card-status" data-status="${item.status}">${item.status}</span>
          </div>
          <p>${safeDescription}</p>
          <div class="sales-card-meta">Captured ${displayDate}</div>
          <div class="sales-card-actions">
            <button type="button" class="btn ghost small" data-action="toggle-status">Advance status</button>
            <button type="button" class="btn cancel small" data-action="remove">Archive</button>
          </div>
        </article>
      `;
    })
    .join("");
}

salesAddForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  const data = new FormData(salesAddForm);
  const title = (data.get("title") || "").toString().trim();
  const description = (data.get("description") || "").toString().trim();
  if (!title || !description) {
    showToast("Give the content a title and description");
    return;
  }

  const entry = {
    id: Date.now(),
    title,
    description,
    status: "New",
    createdAt: new Date().toISOString()
  };
  salesContentItems.unshift(entry);
  persistSalesContentState(salesContentItems);
  renderSalesContent();
  salesAddForm.reset();
  showToast("Sales content saved");
});

salesContentList?.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  const card = target.closest(".sales-card");
  if (!card) return;
  const entryId = Number(card.dataset.id);
  if (Number.isNaN(entryId)) return;
  const index = salesContentItems.findIndex((item) => item.id === entryId);
  if (index < 0) return;
  const action = target.dataset.action;
  if (action === "toggle-status") {
    const currentStatus = salesContentItems[index].status;
    const nextStatus = salesStatusCycle[(salesStatusCycle.indexOf(currentStatus) + 1) % salesStatusCycle.length];
    salesContentItems[index].status = nextStatus;
    persistSalesContentState(salesContentItems);
    renderSalesContent();
    showToast(`Status moved to ${nextStatus}`);
    return;
  }
  if (action === "remove") {
    salesContentItems.splice(index, 1);
    persistSalesContentState(salesContentItems);
    renderSalesContent();
    showToast("Content archived");
  }
});

function renderPrivilegeItem(user) {
  const safeName = escapeHtml(user.name || "");
  const safeRole = escapeHtml(user.role || "");
  const safeEmail = user.email ? escapeHtml(user.email) : "";
  const emailAttr = safeEmail ? ` data-email="${safeEmail}"` : "";
  const idAttr = user.id ? ` data-id="${user.id}"` : "";
  const canEdit = currentRole === adminRole;
  const canRemove = user.role !== adminRole;
  const accessList = Array.isArray(user.accessList) ? user.accessList : parseAccessList(user.access || "");
  const accessText = formatAccessText(accessList);
  const enabled = user.enabled !== false;
  const statusClass = enabled ? "on" : "off";
  const accessButtons = accessOptions
    .map((option) => {
      const isActive = accessList.includes(option.id);
      const buttonClass = isActive ? "access-toggle active" : "access-toggle";
      return `<button type="button" class="${buttonClass}" data-action="toggle-access" data-access="${option.id}">${option.label}</button>`;
    })
    .join("");
  const accessMarkup = canEdit
    ? `<div class="access-toggles">${accessButtons}</div>`
    : `<div class="access-tags">${accessList.map((id) => {
        const label = accessOptions.find((option) => option.id === id)?.label || id;
        return `<span class="access-tag">${label}</span>`;
      }).join("")}</div>`;
  return `
    <div class="privilege-item${enabled ? "" : " disabled"}"${emailAttr}${idAttr}>
      <div>
        <p class="privilege-name">${safeName}</p>
        <p class="privilege-role">${safeRole}</p>
      </div>
      <div class="privilege-access">
        ${accessMarkup}
        <span class="privilege-access-text">${accessText}</span>
      </div>
      <div class="privilege-actions">
        ${canEdit ? `<button type="button" class="toggle-pill ${statusClass}" data-action="toggle-user">${enabled ? "On" : "Off"}</button>` : `<span class="privilege-status ${statusClass}">${enabled ? "On" : "Off"}</span>`}
        ${canEdit ? `<button type="button" class="btn ghost small" data-action="edit-user">Edit</button>` : ""}
        <button type="button" class="btn ghost small" data-action="reset-user">Reset password</button>
        ${canEdit && canRemove ? `<button type="button" class="btn ghost" data-action="remove-user">Remove</button>` : ""}
      </div>
    </div>
  `;
}

function renderPrivilegeList(listElement) {
  if (!listElement) return;
  listElement.innerHTML = privilegedUsers.map((user) => renderPrivilegeItem(user)).join("");
}

const sectionRenderers = {
  dashboard: renderDashboard,
  companies: renderCompanies,
  contacts: renderContacts,
  products: renderProducts,
  pricing: renderPricing,
  orders: renderOrders,
  quotations: renderQuotations,
  invoices: renderInvoices,
  documents: renderDocuments,
  shipping: renderShipping,
  sample_shipments: renderSampleShipments,
  tasks: renderTasks,
  notes: renderNotes,
  tags: renderTags,
  settings: renderSettings
};

const tableRecords = {};


const formConfigs = {
  companies: {
    title: "Add Company",
    endpoint: "/api/companies",
    fields: [
      { name: "name", label: "Name", required: true, placeholder: "Acme Corp" },
      { name: "company_code", label: "Company Code", placeholder: "e.g. ACME-001" },
      { name: "address", label: "Address", type: "textarea", placeholder: "Street, city, state, postal code" },
      { name: "website", label: "Website", placeholder: "acme.com" },
      { name: "email", label: "Email", type: "email" },
      { name: "phone", label: "Phone" },
      { name: "owner", label: "Owner" },
      { name: "industry", label: "Industry", placeholder: "e.g. Manufacturing" },
      { name: "status", label: "Status", type: "select", options: ["Active", "Prospect", "Churn Risk"] },
      { name: "tags", label: "Tags (optional)", type: "select", multiple: true, options: [] }
    ],
    transform(values) {
      return {
        name: values.name,
        company_code: values.company_code?.toString().trim() || null,
        address: values.address,
        website: values.website,
        email: values.email,
        phone: values.phone,
        owner: values.owner,
        industry: values.industry,
        status: values.status,
        tags: values.tags
      };
    }
  },
  contacts: {
    title: "Add Contact",
    endpoint: "/api/contacts",
    fields: [
      { name: "first_name", label: "First Name", required: true },
      { name: "last_name", label: "Last Name", required: true },
      { name: "company_id", label: "Company (optional)", type: "select", options: ["-- Select company --"] },
      { name: "email", label: "Email", type: "email" },
      { name: "phone", label: "Phone" },
      { name: "role", label: "Role" },
      { name: "status", label: "Status", type: "select", options: ["Engaged", "New", "Nurture"] },
      { name: "tags", label: "Tags (optional)", type: "select", multiple: true, options: [] }
    ],
    transform(values) {
      return {
        company_id: num(values.company_id),
        first_name: values.first_name,
        last_name: values.last_name,
        email: values.email,
        phone: values.phone,
        role: values.role,
        status: values.status,
        tags: values.tags
      };
    }
  },
  products: {
    title: "Add Product",
    endpoint: "/api/products",
    fields: [
      { name: "name", label: "Name", required: true },
      { name: "sku", label: "SKU" },
      { name: "category", label: "Category" },
      { name: "price", label: "Price", type: "number", step: "0.01" },
      { name: "currency", label: "Currency", placeholder: "USD" },
      { name: "status", label: "Status", type: "select", options: ["Active", "Draft"] },
      { name: "description", label: "Description", type: "textarea" },
      { name: "tags", label: "Tags (optional)", type: "select", multiple: true, options: [] }
    ],
    transform(values) {
      return {
        name: values.name,
        sku: values.sku,
        category: values.category,
        price: num(values.price) ?? 0,
        currency: values.currency || "USD",
        status: values.status || "Active",
        description: values.description,
        tags: values.tags
      };
    }
  },
  orders: {
    title: "Add Order",
    endpoint: "/api/orders",
    fields: [
      { name: "order_title", label: "Order Title", placeholder: "e.g. Q1 Supply" },
      { name: "currency", label: "Currency", placeholder: "USD" },
      {
        name: "status",
        label: "Status",
        type: "select",
        options: ["Pending", "In Progress", "Factory exit", "Dispatched", "Cut Off", "Shipped", "Delivered", "Completed"]
      },
      { name: "company_id", label: "Company (optional)", type: "select", options: ["-- Select company --"] },
      { name: "contact_id", label: "Contact (optional)", type: "select", options: ["-- Select contact --"] },
      { name: "quotation_id", label: "Quotation (optional)", type: "select", options: ["-- Select quotation --"] },
      { name: "invoice_links", label: "Link existing invoices (optional)", type: "select", multiple: true, options: [] },
      { name: "tags", label: "Tags (optional)", type: "select", multiple: true, options: [] }
    ],
    transform(values) {
      const orderTitle = (values.order_title || "").trim();
      const invoiceLinks = Array.isArray(values.invoice_links)
        ? values.invoice_links
        : values.invoice_links
          ? [values.invoice_links]
          : [];
      return {
        company_id: num(values.company_id),
        contact_id: num(values.contact_id),
        quotation_id: num(values.quotation_id),
        status: values.status || "Pending",
        currency: values.currency || "USD",
        reference: orderTitle || undefined,
        tags: values.tags,
        invoice_ids: invoiceLinks
      };
    },
    submit: async (values) => {
      const orderTitle = (values.order_title || "").trim();
      const invoiceLinks = Array.isArray(values.invoice_links)
        ? values.invoice_links
        : values.invoice_links
          ? [values.invoice_links]
          : [];
      const payload = {
        company_id: num(values.company_id),
        contact_id: num(values.contact_id),
        quotation_id: num(values.quotation_id),
        total_amount: 0,
        currency: values.currency || "USD",
        status: values.status || "Pending",
        reference: orderTitle || values.reference || `SO-${Date.now().toString().slice(-6)}`,
        tags: values.tags,
        invoice_ids: invoiceLinks
      };
      await submitJson("/api/orders", payload);
    }
  },
  quotations: {
    title: "Add Quotation",
    endpoint: "/api/quotations",
    fields: [
      { name: "reference", label: "Quote #", placeholder: "Auto" },
      { name: "title", label: "Title", placeholder: "e.g. Q1 supply proposal" },
      { name: "status", label: "Status", type: "select", options: ["Draft", "Sent", "Accepted"] },
      { name: "company_id", label: "Company", type: "select", options: ["-- Select company --"] },
      { name: "company_id_manual", label: "Company ID (manual)", type: "number", placeholder: "Enter ID" },
      { name: "contact_id", label: "Contact", type: "select", options: ["-- Select contact --"] },
      { name: "contact_id_manual", label: "Contact ID (manual)", type: "number", placeholder: "Enter ID" },
      { name: "customer_name", label: "Customer name", placeholder: "Autofilled from contact/company" },
      { name: "currency", label: "Currency", placeholder: "USD" },
      { name: "tax_rate", label: "Tax rate (%)", type: "number", step: "0.01", placeholder: "0" },
      { name: "valid_until", label: "Valid until", type: "date" },
      { name: "notes", label: "Notes / Terms", type: "textarea", placeholder: "Payment terms, delivery timelines, or special notes." },
      { name: "tags", label: "Tags (optional)", type: "select", multiple: true, options: [] },
      { name: "bank_charge_method", label: "Bank charge method", type: "select", options: ["-- Select option --", "Shared", "Customer pays", "We pay"] },
      { name: "attachment_key", label: "Choose document (optional)", type: "select", options: ["-- Select document --"] }
    ],
    submit: async (values) => {
      const manualCompanyId = num(values.company_id_manual);
      const manualContactId = num(values.contact_id_manual);
      const payload = {
        company_id: manualCompanyId ?? num(values.company_id),
        contact_id: manualContactId ?? num(values.contact_id),
        customer_name: values.customer_name,
        currency: values.currency || "USD",
        status: values.status || "Draft",
        valid_until: values.valid_until,
        reference: values.reference || undefined,
        title: values.title,
        tax_rate: parsePercent(values.tax_rate),
        notes: values.notes,
        bank_charge_method: values.bank_charge_method,
        attachment_key: values.attachment_key || undefined,
        items: values.items || [],
        tags: values.tags
      };

      const items = Array.isArray(values.items) ? values.items : [];
      const subtotal = items.reduce((sum, item) => sum + resolveQuoteLineTotal(item), 0);
      const tax = subtotal * (parsePercent(payload.tax_rate) / 100);
      const grandTotal = subtotal + tax;
      payload.amount = Number.isFinite(grandTotal) ? grandTotal : 0;

      if (payload.bank_charge_method) {
        payload.notes = `${payload.notes || ""}\nBank charge method: ${payload.bank_charge_method}`.trim();
      }

      await submitJson("/api/quotations", payload);
    }
  },
  invoices: {
    title: "Add Invoice",
    endpoint: "/api/invoices",
    fields: [
      { name: "reference", label: "Invoice number (auto-generated if empty)", placeholder: "INV-2025" },
      { name: "attachment_key", label: "Choose document (optional)", type: "select", options: ["-- Select document --"] },
      { name: "contact_id", label: "Contact (optional)", type: "select", options: ["-- Select contact (optional) --"] },
      { name: "company_id", label: "Company (optional)", type: "select", options: ["-- Select company (optional) --"] },
      { name: "customer_name", label: "Customer name (auto-filled if contact/company selected)", placeholder: "Customer name" },
      { name: "total_amount", label: "Total amount", type: "number", step: "0.01" },
      { name: "currency", label: "Currency", placeholder: "USD" },
      {
        name: "status",
        label: "Status",
        type: "select",
        options: ["Unpaid", "Open", "Paid", "Overdue", "Factory exit", "Dispatched", "Cut Off", "Shipped", "Delivered"]
      },
      { name: "tags", label: "Tags (optional)", type: "select", multiple: true, options: [] }
    ],
    async submit(values) {
      const payload = {
        company_id: num(values.company_id),
        contact_id: num(values.contact_id),
        total_amount: num(values.total_amount) ?? 0,
        currency: values.currency || "USD",
        status: values.status || "Unpaid",
        reference: values.reference || undefined,
        tags: values.tags,
        attachment_key: values.attachment_key || undefined
      };

      await submitJson("/api/invoices", payload);
    }
  },
  documents: {
    title: "Add Document",
    endpoint: "/api/documents",
    fields: [
      { name: "title", label: "Title", required: true, placeholder: "Document title" },
      { name: "company_id", label: "Company (optional)", type: "select", options: ["-- Select company --"] },
      { name: "invoice_id", label: "Invoice (optional)", type: "select", options: ["-- Select invoice --"] },
      { name: "doc_type_id", label: "Document Type", type: "select", options: ["-- Select document type --"] },
      { name: "tags", label: "Tags (optional)", type: "select", multiple: true, options: [] },
      { name: "contentType", label: "Content Type", placeholder: "application/pdf" },
      { name: "file", label: "Select Files (multiple allowed)", type: "file", multiple: true }
    ],
    async submit(values) {
      const files = Array.from(values.file || values.fileList || []).filter((f) => f && f.size > 0);
      const tags = Array.isArray(values.tags) ? values.tags.map((t) => Number(t)).filter((n) => Number.isFinite(n)) : [];

      if (!files.length) {
        showToast("Please select at least one file to upload");
        return;
      }

      const formData = new FormData();
      formData.append("title", values.title || "Untitled");
      if (values.company_id) formData.append("company_id", values.company_id);
      if (values.contact_id) formData.append("contact_id", values.contact_id);
      if (values.invoice_id) formData.append("invoice_id", values.invoice_id);
      if (values.doc_type_id) formData.append("doc_type_id", values.doc_type_id);
      if (values.contentType) formData.append("contentType", values.contentType);
      tags.forEach((tag) => formData.append("tags", String(tag)));

      files.forEach((file) => formData.append("file", file));

      try {
        const res = await apiFetch("/api/upload", {
          method: "POST",
          body: formData
        });
        if (!res.ok) {
          const err = await res.text();
          throw new Error(err);
        }
        const data = await res.json();
        showToast(`Uploaded ${data.uploaded || 0} documents successfully`);
      } catch (err) {
        console.error(err);
        showToast("Upload failed: " + err.message);
      }
    }
  },
  sample_shipments: {
    title: "Add Sample Shipment",
    endpoint: "/api/sample_shipments",
    fields: [
      { name: "company_id", label: "Company", type: "select", options: ["-- Select company --"] },
      { name: "receiving_address", label: "Receiving Address", type: "textarea", placeholder: "Street, city, postal code" },
      { name: "phone", label: "Telephone", placeholder: "+1 410 555 0101" },
      { name: "product_id", label: "Product", type: "select", options: ["-- Select product --"] },
      { name: "quantity", label: "Quantity", type: "number", step: "1", placeholder: "1" },
      { name: "waybill_number", label: "Waybill Number", placeholder: "WB-12345" },
      { name: "document_id", label: "Related Document", type: "select", options: ["-- Select document (optional) --"] },
      { name: "courier", label: "Courier", type: "select", options: ["-- Choose courier --", "DHL", "FedEx", "UPS", "SF Express", "Aramex", "Royal Mail", "Other"] },
      { name: "status", label: "Status", type: "select", options: ["Preparing", "Dispatched", "Delivered"] },
      { name: "notes", label: "Notes", type: "textarea", placeholder: "Special handling, recipient contact, etc." }
    ],
    transform(values) {
      return {
        company_id: num(values.company_id),
        product_id: num(values.product_id),
        document_id: num(values.document_id),
        receiving_address: values.receiving_address,
        phone: values.phone,
        quantity: num(values.quantity) ?? 0,
        waybill_number: values.waybill_number,
        courier: values.courier,
        status: values.status || "Preparing",
        notes: values.notes
      };
    },
    async submit(values) {
      const lines = Array.isArray(values.sample_lines) ? values.sample_lines.filter((l) => l?.product_id) : [];
      if (!lines.length) {
        showToast("Add at least one product");
        return;
      }

      const base = {
        company_id: num(values.company_id),
        document_id: num(values.document_id),
        receiving_address: values.receiving_address,
        phone: values.phone,
        waybill_number: values.waybill_number,
        courier: values.courier,
        status: values.status || "Preparing",
        notes: values.notes
      };

      for (const line of lines) {
        const payload = {
          ...base,
          product_id: num(line.product_id),
          quantity: num(line.quantity) ?? 0
        };
        await submitJson("/api/sample_shipments", payload);
      }
    }
  },
  shipping: {
    title: "Add Shipping Schedule",
    endpoint: "/api/shipping_schedules",
    fields: [
      { name: "order_id", label: "Order (optional)", type: "select", options: ["-- Optional: select an order --"] },
      { name: "invoice_id", label: "Invoice (optional)", type: "select", options: ["-- Optional: select an invoice --"] },
      { name: "factory_exit_date", label: "Factory exit date", type: "datetime-local" },
      { name: "etc_date", label: "ETC", type: "datetime-local" },
      { name: "etd_date", label: "ETD", type: "datetime-local" },
      { name: "eta", label: "ETA", type: "datetime-local" },
      { name: "company_id", label: "Company (auto)", type: "select", options: ["Select an order or invoice"] },
      { name: "tags", label: "Tags (optional)", type: "select", multiple: true, options: [] },
      { name: "notes", label: "Notes", type: "textarea", placeholder: "Shipment details, vessel, port info, etc." },
      {
        name: "status",
        label: "Status",
        type: "select",
        options: ["Factory exit", "Dispatched", "Cut Off", "Shipped", "Delivered"]
      }
    ],
    transform(values) {
      return {
        order_id: num(values.order_id),
        invoice_id: num(values.invoice_id),
        company_id: num(values.company_id),
        factory_exit_date: values.factory_exit_date ? new Date(values.factory_exit_date).toISOString() : null,
        etc_date: values.etc_date ? new Date(values.etc_date).toISOString() : null,
        etd_date: values.etd_date ? new Date(values.etd_date).toISOString() : null,
        eta: values.eta ? new Date(values.eta).toISOString() : null,
        notes: values.notes,
        status: values.status || "Factory exit",
        tags: values.tags
      };
    }
  },
  tasks: {
    title: "Add Task",
    endpoint: "/api/tasks",
    fields: [
      { name: "title", label: "Title", required: true },
      { name: "assignee", label: "Assignee" },
      { name: "due_date", label: "Due Date", type: "date" },
      { name: "status", label: "Status", type: "select", options: ["Not Started", "In Progress", "Done"] },
      {
        name: "related_type",
        label: "Related Type",
        type: "select",
        options: ["company", "contact", "order", "invoice", "document", "other"]
      },
      { name: "related_company_id", label: "Related Company", type: "select", options: ["-- Select company --"] },
      { name: "related_id", label: "Related ID", type: "number", placeholder: "Enter ID for other types" },
      { name: "tags", label: "Tags (optional)", type: "select", multiple: true, options: [] }
    ],
    transform(values) {
      const relatedType = values.related_type || (num(values.related_company_id) ? "company" : undefined);
      const relatedIdForCompany = num(values.related_company_id);
      const relatedIdValue =
        relatedType === "company" ? relatedIdForCompany : num(values.related_id);
      return {
        title: values.title,
        assignee: values.assignee,
        due_date: values.due_date,
        status: values.status || "Not Started",
        related_type: relatedType,
        related_id: relatedIdValue,
        tags: values.tags
      };
    }
  },
  notes: {
    title: "Add Note",
    endpoint: "/api/notes",
    fields: [
      { name: "body", label: "Text", type: "textarea", required: true, placeholder: "Write a note" },
      { name: "note_date", label: "Note Date (optional)", type: "datetime-local" },
      { name: "company_id", label: "Company (optional)", type: "select", options: ["-- Select company --"] },
      { name: "related_type", label: "Related Type (optional)", type: "select", options: ["-- Select type --", "company", "contact", "order", "invoice", "document", "other"] },
      { name: "related_id", label: "Related ID (optional)", type: "number", placeholder: "Enter ID number" },
      { name: "author", label: "Author" },
      { name: "tags", label: "Tags (optional)", type: "select", multiple: true, options: [] }
    ],
    transform(values) {
      const companyId = num(values.company_id);
      const relatedId = num(values.related_id);
      const effectiveId = relatedId ?? companyId;
      const effectiveType = values.related_type || (companyId ? "company" : "note");
      const noteDate = values.note_date ? new Date(values.note_date).toISOString() : null;
      return {
        entity_type: effectiveType,
        entity_id: effectiveId,
        body: values.body,
        author: values.author,
        note_date: noteDate,
        tags: values.tags
      };
    }
  },
  tags: {
    title: "Add Tag",
    endpoint: "/api/tags",
    fields: [
      { name: "name", label: "Name", required: true },
      { name: "color", label: "Color", placeholder: "#2563eb" }
    ]
  }
};

function initNavigation() {
  // Re-query nav items after DOM is ready
  navItems = Array.from(document.querySelectorAll(".nav-item"));
  console.log('navItems count after init:', navItems.length);
  applyAccessRestrictions();
  navItems.forEach((item) => {
    item.addEventListener("click", () => {
      console.log('Nav item clicked', item.dataset.section);
      const section = item.dataset.section;
      if (!canAccessSection(section)) {
        showToast("Access restricted. Ask an admin for access.");
        return;
      }
      setActiveNav(section);
      renderSection(section);
    });
  });
  renderSection("dashboard");
}

if (document.readyState === 'loading') {
  document.addEventListener("DOMContentLoaded", initNavigation);
} else {
  initNavigation();
}

function setActiveNav(section) {
  currentSection = section;
  navItems.forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.section === section);
  });
  sectionTitle.textContent = capitalize(section);
}

async function renderSection(section) {
  const renderer = sectionRenderers[section];
  if (!renderer) {
    sectionContent.innerHTML = `<div class="panel"><div class="empty">No view configured yet.</div></div>`;
    lucide?.createIcons();
    return;
  }

  if (!canAccessSection(section)) {
    sectionContent.innerHTML = `
      <div class="panel">
        <div class="empty">Access restricted. Contact an admin to enable this section.</div>
      </div>
    `;
    lucide?.createIcons();
    return;
  }

  await renderer();
  attachFormHandlers();
  lucide?.createIcons();
}

async function renderDashboard() {
  sectionTitle.textContent = "Dashboard";
  sectionContent.innerHTML = `
    <div class="page-header">
      <div>
        <div class="eyebrow">Workspace Overview</div>
        <h2 class="page-title">Dashboard</h2>
        <div class="page-meta">Live counts from D1 with quick pipeline and activity views.</div>
      </div>
      <div class="actions">
        <button class="btn" id="refresh-dashboard">
          <i data-lucide="refresh-ccw"></i>
          Refresh
        </button>
      </div>
    </div>
    <div class="stat-grid" id="stat-grid"></div>
    <div class="panel">
      <div class="panel-header">
        <h3 class="panel-title">Pipeline Snapshot</h3>
        <div class="stat-label">Recent orders and invoices</div>
      </div>
      <div id="pipeline-table"></div>
    </div>
    <div class="panel">
      <div class="panel-header">
        <h3 class="panel-title">Activity</h3>
        <div class="stat-label">Latest updates across the workspace</div>
      </div>
      <div id="activity-feed"></div>
    </div>
  `;

  let stats = { ...statDefaults };
  let activity = [];
  let pipelineRows = [];

  try {
    const res = await apiFetch("/api/dashboard");
    if (res.ok) {
      const data = await res.json();
      stats = { ...stats, ...data.stats };
      activity = data.activity ?? activity;
      pipelineRows = data.pipeline
        ? data.pipeline.map((item) => [
            item.ref,
            item.account,
            item.amount,
            badge(item.statusType || "info", item.status)
          ])
        : pipelineRows;
    }
  } catch (err) {
    console.debug("Falling back to default dashboard data", err);
  }

  document.getElementById("refresh-dashboard")?.addEventListener("click", () => renderSection("dashboard"));

  const statGrid = document.getElementById("stat-grid");
  if (statGrid) {
    statGrid.innerHTML = [
      { label: "Companies", value: stats.companies },
      { label: "Contacts", value: stats.contacts },
      { label: "Open Orders", value: stats.openOrders },
      { label: "Quotations", value: stats.quotations },
      { label: "Invoices", value: stats.invoices },
      { label: "Open Tasks", value: stats.tasksOpen }
    ]
      .map(
        (stat) => `
          <div class="stat-card">
            <div class="stat-label">${stat.label}</div>
            <div class="stat-value">${stat.value}</div>
            <div class="stat-pill">
              <span class="badge-dot" style="background:${accentColor(stat.label)}"></span>
              Synced from D1
            </div>
          </div>
        `
      )
      .join("");
  }

  const pipelineTable = document.getElementById("pipeline-table");
  if (pipelineTable) {
    pipelineTable.innerHTML = renderTable(
      ["Ref", "Account", "Amount", "Status"],
      pipelineRows,
      "pipeline",
      false
    );
  }

  const activityFeed = document.getElementById("activity-feed");
  if (activityFeed) {
    activityFeed.innerHTML = `
      <div class="activity-feed">
        ${activity
          .map(
            (item) => `
              <div class="activity-item">
                <div class="activity-header">
                  <span class="activity-tag" style="background:${soften(item.color)};color:${item.color}">${item.tag}</span>
                  <span class="activity-time">Just now</span>
                </div>
                <div class="activity-title">${item.title}</div>
                ${item.author ? `<div class="activity-author">by ${item.author}</div>` : ""}
              </div>
            `
          )
          .join("")}
      </div>
    `;
  }
}

async function renderCompanies() {
  sectionTitle.textContent = "Companies";
  const rows = await loadTableFromApi(
    "companies",
    (r) => [
      r.company_code || "-",
      r.name,
      r.industry || "-",
      r.website || "-",
      r.email || "-",
      r.phone || "-",
      r.owner || "-",
      r.status || "-"
    ],
    fallback.companies
  );

  sectionContent.innerHTML = `
    <div class="page-header">
      <div>
        <div class="eyebrow">Accounts</div>
        <h2 class="page-title">Companies</h2>
        <div class="page-meta">Track active customers and prospects.</div>
      </div>
      <div class="actions">
        <button class="btn" data-form="companies">
          <i data-lucide="upload"></i>
          Import
        </button>
        <button class="btn primary" data-form="companies">
          <i data-lucide="plus"></i>
          New Company
        </button>
      </div>
    </div>
    <div class="panel">
      <div class="panel-header">
        <h3 class="panel-title">Bulk Actions</h3>
        <div class="stat-label">Import or export companies as CSV.</div>
      </div>
      <div class="bulk-actions">
        <input type="file" id="upload-companies-input" accept=".csv,text/csv" style="display:none" />
        <button class="btn" id="btn-upload-companies">
          <i data-lucide="upload"></i>
          Import CSV
        </button>
        <button class="btn" id="btn-download-companies">
          <i data-lucide="download"></i>
          Export CSV
        </button>
      </div>
    </div>
    <div class="stat-grid">
      <div class="stat-card">
        <div class="stat-label">Active</div>
        <div class="stat-value">12</div>
        <div class="stat-pill"><span class="badge-dot" style="background:#16a34a"></span>Low churn</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Prospects</div>
        <div class="stat-value">5</div>
        <div class="stat-pill"><span class="badge-dot" style="background:#2563eb"></span>In nurture</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Churn Risk</div>
        <div class="stat-value">1</div>
        <div class="stat-pill"><span class="badge-dot" style="background:#f59e0b"></span>Monitor</div>
      </div>
    </div>
    <div class="panel">
      <div class="panel-header">
        <div>
          <h3 class="panel-title">All Companies</h3>
          <div class="stat-label">Synced from D1, editable inline.</div>
        </div>
      <div class="table-actions">
        <button class="btn">
          <i data-lucide="filter"></i>
          Filter
        </button>
        <button class="btn">
          <i data-lucide="download"></i>
          Export
        </button>
      </div>
    </div>
      ${renderPaginatedTable(["Code", "Name", "Industry", "Website", "Email", "Phone", "Owner", "Status"], rows, "companies")}
    </div>
  `;

  attachBulkCsvHandlers({
    uploadBtnId: "btn-upload-companies",
    uploadInputId: "upload-companies-input",
    downloadBtnId: "btn-download-companies",
    parseFn: parseCompaniesCsv,
    uploadEndpoint: "/api/companies/bulk",
    downloadEndpoint: "/api/companies/csv",
    section: "companies"
  });
}

async function renderContacts() {
  sectionTitle.textContent = "Contacts";
  const companies = await fetchCompaniesList();
  const companyLookup = new Map(companies.map((company) => [String(company.id), company.name]));
  const rows = await loadTableFromApi(
    "contacts",
    (r) => [
      `${r.first_name} ${r.last_name}`,
      r.company_name || r.company || companyLookup.get(String(r.company_id)) || "-",
      r.role || "-",
      r.email || "-",
      r.phone || "-",
      r.status || "-"
    ],
    fallback.contacts
  );

  sectionContent.innerHTML = `
    <div class="page-header">
      <div>
        <div class="eyebrow">People</div>
        <h2 class="page-title">Contacts</h2>
        <div class="page-meta">Key people linked to each company.</div>
      </div>
      <div class="actions">
        <button class="btn" data-form="contacts">
          <i data-lucide="user-plus"></i>
          New Contact
        </button>
      </div>
    </div>
    <div class="panel">
      <div class="panel-header">
        <h3 class="panel-title">Bulk Actions</h3>
        <div class="stat-label">Import or export contacts as CSV.</div>
      </div>
      <div class="bulk-actions">
        <input type="file" id="upload-contacts-input" accept=".csv,text/csv" style="display:none" />
        <button class="btn" id="btn-upload-contacts">
          <i data-lucide="upload"></i>
          Import CSV
        </button>
        <button class="btn" id="btn-download-contacts">
          <i data-lucide="download"></i>
          Export CSV
        </button>
      </div>
    </div>
    <div class="panel">
      <div class="panel-header">
        <h3 class="panel-title">People Directory</h3>
        <div class="stat-label">Filter by role, company, or status.</div>
      </div>
      ${renderPaginatedTable(["Name", "Company", "Role", "Email", "Phone", "Status"], rows, "contacts")}
    </div>
  `;

  attachBulkCsvHandlers({
    uploadBtnId: "btn-upload-contacts",
    uploadInputId: "upload-contacts-input",
    downloadBtnId: "btn-download-contacts",
    parseFn: parseContactsCsv,
    uploadEndpoint: "/api/contacts/bulk",
    downloadEndpoint: "/api/contacts/csv",
    section: "contacts"
  });
}

async function renderProducts() {
  sectionTitle.textContent = "Products";
  const rows = await loadTableFromApi(
    "products",
    (r) => [
      r.name,
      r.sku || "-",
      r.category || "-",
      r.price ? formatCurrency(r.price, r.currency) : "-",
      r.currency || "USD",
      r.status || "-"
    ],
    fallback.products,
    { fetchAll: true }
  );

  sectionContent.innerHTML = `
    <div class="page-header">
      <div>
        <div class="eyebrow">Catalog</div>
        <h2 class="page-title">Products</h2>
        <div class="page-meta">Items used across quotations, orders, and invoices.</div>
      </div>
      <div class="actions">
        <button class="btn primary" data-form="products">
          <i data-lucide="plus"></i>
          New Product
        </button>
      </div>
    </div>
    <div class="stat-grid">
      <div class="stat-card">
        <div class="stat-label">Live SKUs</div>
        <div class="stat-value">12</div>
        <div class="stat-pill"><span class="badge-dot" style="background:#2563eb"></span>Visible to sales</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Drafts</div>
        <div class="stat-value">3</div>
        <div class="stat-pill"><span class="badge-dot" style="background:#f59e0b"></span>Need review</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Most Popular</div>
        <div class="stat-value">Premium Kit</div>
        <div class="stat-pill"><span class="badge-dot" style="background:#16a34a"></span>+22% MoM</div>
      </div>
    </div>
    <div class="panel">
      <div class="panel-header">
        <h3 class="panel-title">Bulk Actions</h3>
        <div class="stat-label">Import or export products as CSV.</div>
      </div>
      <div class="bulk-actions">
        <input type="file" id="upload-products-input" accept=".csv,text/csv" style="display:none" />
        <button class="btn" id="btn-upload-products">
          <i data-lucide="upload"></i>
          Import CSV
        </button>
        <button class="btn" id="btn-download-products">
          <i data-lucide="download"></i>
          Export CSV
        </button>
      </div>
    </div>
    <div class="panel">
      <div class="panel-header">
        <h3 class="panel-title">Catalog</h3>
        <div class="stat-label">Pricing synced to quotations and invoices.</div>
      </div>
      ${renderPaginatedTable(["Name", "SKU", "Category", "Price", "Currency", "Status"], rows, "products")}
    </div>
  `;

  const uploadBtn = document.getElementById("btn-upload-products");
  const uploadInput = document.getElementById("upload-products-input");
  const downloadBtn = document.getElementById("btn-download-products");

  uploadBtn?.addEventListener("click", () => uploadInput?.click());
  uploadInput?.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const csvText = await file.text();
      const records = parseProductsCsv(csvText);
      if (!records.length) {
        showToast("No products found in CSV");
        return;
      }
      await submitJson("/api/products/bulk", records);
      showToast(`Imported ${records.length} products`);
      renderSection("products");
    } catch (err) {
      console.error(err);
      const message = err instanceof Error && err.message ? err.message : "Import failed";
      showToast(message);
    } finally {
      if (uploadInput) uploadInput.value = "";
    }
  });

  downloadBtn?.addEventListener("click", async () => {
    try {
      const res = await apiFetch("/api/products/csv");
      if (!res.ok) throw new Error("Download failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "products.csv";
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error(err);
      showToast("Export failed");
    }
  });
}

async function renderPricing() {
  sectionTitle.textContent = "Pricing";
  sectionContent.innerHTML = `
    <div class="page-header">
      <div>
        <div class="eyebrow">Quotations</div>
        <h2 class="page-title">Pricing</h2>
        <div class="page-meta">Line items pulled from live quotations.</div>
      </div>
    </div>
    <div class="panel">
      <div class="panel-header">
        <h3 class="panel-title">Quotation line items</h3>
        <div class="stat-label">Grouped by quote with company and date context.</div>
      </div>
      <div class="doc-filter-bar">
        <label class="document-filter-field">
          <span>Company</span>
          <select id="pricing-filter-company">
            <option value="">All companies</option>
          </select>
        </label>
        <label class="document-filter-field">
          <span>Item</span>
          <select id="pricing-filter-item">
            <option value="">All items</option>
          </select>
        </label>
        <label class="document-search-field">
          <span>Date from</span>
          <input id="pricing-filter-date-from" type="date" />
        </label>
        <label class="document-search-field">
          <span>Date to</span>
          <input id="pricing-filter-date-to" type="date" />
        </label>
      </div>
      <div id="pricing-table-slot" class="table-wrapper">
        <div class="empty">Loading quotation line items...</div>
      </div>
    </div>
  `;

  const formatPricingDate = (value) => {
    if (!value) return "-";
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toLocaleDateString();
    }
    return sanitizeText(value);
  };
  const formatPricingDateKey = (value) => {
    if (!value) return "";
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return "";
    const year = parsed.getFullYear();
    const month = String(parsed.getMonth() + 1).padStart(2, "0");
    const day = String(parsed.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  let quotations = [];
  try {
    const res = await apiFetch("/api/quotations");
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.rows)) {
        quotations = data.rows;
        tableRecords.quotations = data.rows;
      }
    }
  } catch (err) {
    console.debug("Unable to load quotations for pricing", err);
  }

  const items = await loadQuotationItems();
  if (!Array.isArray(items) || !items.length) {
    const emptyPanel = sectionContent.querySelector(".panel");
    if (emptyPanel) {
      emptyPanel.innerHTML = `<div class="empty">No quotation line items yet.</div>`;
    }
    return;
  }

  const quoteLookup = new Map(quotations.map((quote) => [String(quote.id), quote]));
  let companyLookup = null;
  if (quotations.some((quote) => !quote.company_name && quote.company_id)) {
    const companies = await fetchCompaniesList();
    companyLookup = new Map(companies.map((company) => [String(company.id), company.name]));
  }

  const rows = items.map((item) => {
    const quote = quoteLookup.get(String(item.quotation_id)) || {};
    const reference = quote.reference || quote.title || (item.quotation_id ? `Quotation #${item.quotation_id}` : "-");
    const companyName =
      quote.company_name || (companyLookup ? companyLookup.get(String(quote.company_id)) : null) || "-";
    const quoteDateRaw = quote.created_at || quote.updated_at || quote.valid_until || item.created_at;
    const quoteDate = formatPricingDate(quoteDateRaw);
    const quoteDateKey = formatPricingDateKey(quoteDateRaw);
    const productName = item.product_name || (item.product_id ? `Product #${item.product_id}` : "Item");
    const currency = (quote.currency || "USD").toUpperCase();
    const qty = 1;
    const unit = Number(item.unit_price) || 0;
    const drums = Number(item.drums_price) || 0;
    const bank = Number(item.bank_charge_price) || 0;
    const shipping = Number(item.shipping_price) || 0;
    const commission = Number(item.customer_commission) || 0;
    const lineTotal = qty * (unit + drums + bank + shipping + commission);
    return {
      companyKey: String(companyName || "").toLowerCase(),
      itemKey: String(productName || "").toLowerCase(),
      dateKey: quoteDateKey,
      cells: [
        sanitizeText(reference),
        sanitizeText(companyName),
        quoteDate,
        sanitizeText(productName),
        qty,
        formatCurrency(unit, currency),
        formatCurrency(drums, currency),
        formatCurrency(bank, currency),
        formatCurrency(shipping, currency),
        formatCurrency(commission, currency),
        formatCurrency(lineTotal, currency)
      ]
    };
  });

  const columns = [
    "Quote",
    "Company",
    "Date",
    "Item",
    "Qty",
    "Unit",
    "Drums",
    "Bank charge",
    "Shipping",
    "Commission",
    "Line total"
  ];
  const tableSlot = sectionContent.querySelector("#pricing-table-slot");
  const companyInput = sectionContent.querySelector("#pricing-filter-company");
  const itemInput = sectionContent.querySelector("#pricing-filter-item");
  const dateFromInput = sectionContent.querySelector("#pricing-filter-date-from");
  const dateToInput = sectionContent.querySelector("#pricing-filter-date-to");
  if (!tableSlot) return;

  const sortedCompanies = Array.from(
    new Map(
      rows
        .map((row) => row.cells[1])
        .filter((name) => name && name !== "-")
        .map((name) => [String(name), String(name)])
    ).values()
  ).sort((a, b) => a.localeCompare(b));
  const sortedItems = Array.from(
    new Map(
      rows
        .map((row) => row.cells[3])
        .filter((name) => name && name !== "-")
        .map((name) => [String(name), String(name)])
    ).values()
  ).sort((a, b) => a.localeCompare(b));
  if (companyInput instanceof HTMLSelectElement) {
    companyInput.innerHTML =
      `<option value="">All companies</option>` +
      sortedCompanies.map((name) => `<option value="${sanitizeText(name)}">${sanitizeText(name)}</option>`).join("");
  }
  if (itemInput instanceof HTMLSelectElement) {
    itemInput.innerHTML =
      `<option value="">All items</option>` +
      sortedItems.map((name) => `<option value="${sanitizeText(name)}">${sanitizeText(name)}</option>`).join("");
  }

  const rowsPerPage = 10;
  let currentPage = 1;
  let filteredRows = rows;

  const renderPagination = (totalPages) => {
    if (totalPages <= 1) return "";
    return `
      <div class="table-pagination">
        <button class="btn ghost small" data-page="prev" ${currentPage === 1 ? "disabled" : ""}>Prev</button>
        <span class="page-indicator">Page ${currentPage} of ${totalPages}</span>
        <button class="btn ghost small" data-page="next" ${currentPage === totalPages ? "disabled" : ""}>Next</button>
      </div>
    `;
  };

  const renderTablePage = (pageRows) => {
    tableSlot.innerHTML = renderTable(
      columns,
      pageRows.map((row) => row.cells),
      "quotation_items",
      false
    );
  };

  const applyFilters = () => {
    const companyQuery = (companyInput?.value || "").trim().toLowerCase();
    const itemQuery = (itemInput?.value || "").trim().toLowerCase();
    const dateFrom = (dateFromInput?.value || "").trim();
    const dateTo = (dateToInput?.value || "").trim();
    filteredRows = rows.filter((row) => {
      if (companyQuery && row.companyKey !== companyQuery) return false;
      if (itemQuery && row.itemKey !== itemQuery) return false;
      if (dateFrom && row.dateKey && row.dateKey < dateFrom) return false;
      if (dateTo && row.dateKey && row.dateKey > dateTo) return false;
      if ((dateFrom || dateTo) && !row.dateKey) return false;
      return true;
    });
    currentPage = 1;
    if (!filteredRows.length) {
      tableSlot.innerHTML = `<div class="empty">No matching line items.</div>`;
      return;
    }
    const totalPages = Math.max(1, Math.ceil(filteredRows.length / rowsPerPage));
    const start = (currentPage - 1) * rowsPerPage;
    const pageRows = filteredRows.slice(start, start + rowsPerPage);
    renderTablePage(pageRows);
    tableSlot.insertAdjacentHTML("beforeend", renderPagination(totalPages));
    const pager = tableSlot.querySelector(".table-pagination");
    pager?.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const action = target.dataset.page;
      if (!action) return;
      const total = Math.max(1, Math.ceil(filteredRows.length / rowsPerPage));
      if (action === "prev" && currentPage > 1) currentPage -= 1;
      if (action === "next" && currentPage < total) currentPage += 1;
      const offset = (currentPage - 1) * rowsPerPage;
      const pageSlice = filteredRows.slice(offset, offset + rowsPerPage);
      renderTablePage(pageSlice);
      tableSlot.insertAdjacentHTML("beforeend", renderPagination(total));
    });
  };

  companyInput?.addEventListener("change", applyFilters);
  itemInput?.addEventListener("change", applyFilters);
  dateFromInput?.addEventListener("input", applyFilters);
  dateToInput?.addEventListener("input", applyFilters);
  applyFilters();
}

async function renderOrders() {
  sectionTitle.textContent = "Orders";
  const rows = await loadTableFromApi(
    "orders",
    (r) => {
      const status = r?.status || "";
      const tone = status.includes("Progress") ? "success" : status.includes("Completed") ? "info" : "warning";
      return [
        r?.reference || "-",
        r.company_name || "-",
        r.contact_name || "-",
        badge(tone, status || "Pending"),
        formatCurrency(r?.total_amount || 0, r?.currency || "USD"),
        r?.updated_at ? new Date(r.updated_at).toLocaleDateString() : "-"
      ];
    },
    fallback.orders
  );

  sectionContent.innerHTML = `
    <div class="page-header">
      <div>
        <div class="eyebrow">Fulfillment</div>
        <h2 class="page-title">Orders</h2>
        <div class="page-meta">Sales orders ready for fulfillment.</div>
      </div>
      <div class="actions">
        <button class="btn">
          <i data-lucide="filter"></i>
          Filter
        </button>
        <button class="btn primary" data-form="orders">
          <i data-lucide="plus"></i>
          New Order
        </button>
      </div>
    </div>
    <div class="panel">
      <div class="panel-header">
        <h3 class="panel-title">Order Board</h3>
        <div class="stat-label">Statuses sync to shipping schedules automatically.</div>
      </div>
      ${renderPaginatedTable(["Order #", "Company", "Contact", "Status", "Total", "Updated"], rows, "orders")}
    </div>
  `;
}

async function renderQuotations() {
  sectionTitle.textContent = "Quotations";
  const rows = await loadTableFromApi(
    "quotations",
    (r) => {
      const tone = r.status === "Accepted" ? "success" : r.status === "Draft" ? "warning" : "info";
      const companyName = r.company_name || "-";
      return [
        r.reference,
        r.title || "-",
        companyName,
        badge(tone, r.status || "Draft"),
        formatCurrency(r.amount, r.currency),
        r.valid_until || "-"
      ];
    },
    fallback.quotations.map((row) => {
      const tone = row[4] === "Accepted" ? "success" : row[4] === "Draft" ? "warning" : "info";
      return [row[0], "-", row[1], badge(tone, row[4]), row[3], row[5]];
    })
  );

  sectionContent.innerHTML = `
    <div class="page-header">
      <div>
        <div class="eyebrow">Pricing</div>
        <h2 class="page-title">Quotations</h2>
        <div class="page-meta">Draft and sent quotes linked to companies and contacts.</div>
      </div>
      <div class="actions">
        <button class="btn primary" data-form="quotations">
          <i data-lucide="plus"></i>
          New Quote
        </button>
      </div>
    </div>
    <div class="panel">
      <div class="panel-header">
        <h3 class="panel-title">Quotes</h3>
        <div class="stat-label">Convert to orders with one click.</div>
      </div>
      ${renderPaginatedTable(["Quote #", "Title", "Company", "Status", "Amount", "Valid Until"], rows, "quotations")}
    </div>
  `;
}

async function renderInvoices() {
  sectionTitle.textContent = "Invoices";
  const rows = await loadTableFromApi(
    "invoices",
    (r) => {
      const tone = r.status === "Paid" ? "success" : r.status === "Overdue" ? "warning" : "info";
      return [
        r.reference,
        r.company_name || "-",
        formatCurrency(r.total_amount, r.currency),
        r.due_date || "-",
        badge(tone, r.status || "Open"),
        r.contact_name || "-"
      ];
    },
    fallback.invoices.map((row) => {
      const tone = row[4] === "Paid" ? "success" : row[4] === "Overdue" ? "warning" : "info";
      return [row[0], row[1], row[2], row[3], badge(tone, row[4]), row[5]];
    })
  );

  sectionContent.innerHTML = `
    <div class="page-header">
      <div>
        <div class="eyebrow">Billing</div>
        <h2 class="page-title">Invoices</h2>
        <div class="page-meta">Billing items connected to orders.</div>
      </div>
      <div class="actions">
        <button class="btn">
          <i data-lucide="download"></i>
          Export
        </button>
        <button class="btn primary" data-form="invoices">
          <i data-lucide="plus"></i>
          New Invoice
        </button>
      </div>
    </div>
    <div class="panel">
      <div class="panel-header">
        <h3 class="panel-title">Receivables</h3>
        <div class="stat-label">Overdue invoices surface alerts.</div>
      </div>
      ${renderPaginatedTable(["Invoice #", "Company", "Total", "Due Date", "Status", "Owner"], rows, "invoices")}
    </div>
  `;
}

async function renderDocuments() {
  sectionTitle.textContent = "Documents";
  await loadTableFromApi("documents", (row) => row, fallback.documents);
  await loadLookupTable("tags", fallback.tags);
  const docs = tableRecords.documents || [];
  const companies = await fetchCompaniesList();
  const invoices = await fetchInvoicesList();

  const docTypes = Array.from(
    new Set(
      docs
        .map((doc) => doc.doc_type_name || doc.content_type || "")
        .map((type) => String(type).trim())
        .filter(Boolean)
    )
  ).sort();

  sectionContent.innerHTML = `
    <div class="page-header">
      <div>
        <div class="eyebrow">Files</div>
        <h2 class="page-title">Documents</h2>
        <div class="page-meta">Upload, preview, and manage shipping paperwork.</div>
      </div>
      <div class="actions">
        <button class="btn" id="btn-download-docs">
          <i data-lucide="download"></i>
          Download Documents (ZIP)
        </button>
        <button class="btn primary" data-form="documents">
          <i data-lucide="upload-cloud"></i>
          Upload Documents
        </button>
      </div>
    </div>
    <div class="panel">
      <div class="doc-filter-bar">
        <label class="document-search-field">
          <span>Search documents</span>
          <input
            id="document-search-input"
            type="search"
            autocomplete="off"
            placeholder="Search documents..."
            aria-label="Search documents"
          />
        </label>
        <label class="document-filter-field">
          <span>Company</span>
          <select id="document-company-filter" aria-label="Filter documents by company">
            <option value="">All Companies</option>
            ${companies.map((company) => `<option value="${company.id}">${company.name}</option>`).join("")}
          </select>
        </label>
        <label class="document-filter-field">
          <span>Invoice</span>
          <select id="document-invoice-filter" aria-label="Filter documents by invoice">
            <option value="">All Invoices</option>
            ${invoices.map((invoice) => `<option value="${invoice.id}">${invoice.reference || invoice.id}</option>`).join("")}
          </select>
        </label>
        <label class="document-filter-field">
          <span>Document type</span>
          <select id="document-type-filter" aria-label="Filter documents by document type">
            <option value="">All Document Types</option>
            ${docTypes.map((type) => `<option value="${type}">${type}</option>`).join("")}
          </select>
        </label>
        <label class="document-filter-field">
          <span>Sort by</span>
          <select id="document-sort-filter" aria-label="Sort documents">
            <option value="date">Sort by Date</option>
          </select>
        </label>
        <label class="document-filter-field">
          <span>Order</span>
          <select id="document-order-filter" aria-label="Sort order">
            <option value="desc">Newest First</option>
            <option value="asc">Oldest First</option>
          </select>
        </label>
        <div class="document-filter-actions">
          <button class="btn ghost" id="document-apply-filter">Filter</button>
        </div>
      </div>
      <div class="document-filter-meta" aria-live="polite" id="document-filter-meta">Showing ${docs.length} documents</div>
      <div class="table-wrapper">
        <table class="doc-table" data-table="documents">
          <thead>
            <tr>
              <th class="doc-select-cell">
                <input type="checkbox" id="doc-select-all" aria-label="Select all documents" />
              </th>
              <th>Doc No.</th>
              <th>Company</th>
              <th>Invoice</th>
              <th>Type</th>
              <th>Tags</th>
              <th>Upload Date</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody data-doc-table-body></tbody>
        </table>
      </div>
      <div class="table-pagination" data-doc-pagination></div>
    </div>
  `;

  const searchInput = sectionContent.querySelector("#document-search-input");
  const companySelect = sectionContent.querySelector("#document-company-filter");
  const invoiceSelect = sectionContent.querySelector("#document-invoice-filter");
  const typeSelect = sectionContent.querySelector("#document-type-filter");
  const sortSelect = sectionContent.querySelector("#document-sort-filter");
  const orderSelect = sectionContent.querySelector("#document-order-filter");
  const filterButton = sectionContent.querySelector("#document-apply-filter");
  const filterMeta = sectionContent.querySelector("#document-filter-meta");
  const tableBody = sectionContent.querySelector("[data-doc-table-body]");
  const downloadButton = sectionContent.querySelector("#btn-download-docs");
  const paginationSlot = sectionContent.querySelector("[data-doc-pagination]");

  const docItems = docs.map((doc, idx) => ({ doc, idx }));
  const pageSize = 10;
  let currentPage = 1;
  const selectedDocKeys = new Set();
  const docLookup = new Map();

  const getDocNumber = (doc) => {
    if (doc.reference) return doc.reference;
    if (doc.id) return `DOC-${String(doc.id).padStart(4, "0")}`;
    return "-";
  };

  const getDocKey = (doc, idx) => String(doc.id ?? doc.storage_key ?? doc.title ?? idx);

  docItems.forEach(({ doc, idx }) => {
    docLookup.set(getDocKey(doc, idx), doc);
  });

  const getDocDate = (doc) => {
    const raw = doc.created_at || doc.updated_at;
    if (!raw) return "-";
    const date = new Date(raw);
    return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString();
  };

  const getDocFilename = (doc, fallback) => {
    const raw = doc.title || doc.storage_key || doc.reference || `document-${fallback}`;
    const trimmed = String(raw).trim();
    if (!trimmed) return `document-${fallback}`;
    const parts = trimmed.split("/");
    return parts[parts.length - 1] || `document-${fallback}`;
  };

  const fetchDocumentBlob = async (doc) => {
    const url = getDocumentUrl(doc);
    if (!url) return null;
    const res = await apiFetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    if (!blob || blob.size === 0) return null;
    return blob;
  };

  const downloadDocument = async (doc, fallbackIndex) => {
    try {
      const blob = await fetchDocumentBlob(doc);
      if (!blob) {
        showToast("No document to download");
        return;
      }
      const filename = getDocFilename(doc, fallbackIndex);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.debug("Document download failed", err);
      showToast("Unable to download document");
    }
  };

  const renderDocRows = (items) => {
    if (!tableBody) return;
    if (!items.length) {
      tableBody.innerHTML = `<tr><td colspan="8" class="empty">${
        docs.length ? "No documents match your filters." : "No documents yet. Upload to see them here."
      }</td></tr>`;
      return;
    }
    tableBody.innerHTML = items
      .map(({ doc, idx }) => {
        const docKey = getDocKey(doc, idx);
        const companyLabel = doc.company_name || doc.contact_name || "-";
        const invoiceLabel = doc.invoice_reference || (doc.invoice_id ? `INV-${doc.invoice_id}` : "-");
        const typeLabel = doc.doc_type_name || doc.content_type || "File";
        const tags = resolveTagList(doc.tags);
        const tagMarkup = tags.length
          ? tags.map((tag) => `<span class="pill info doc-tag">${sanitizeText(tag)}</span>`).join(" ")
          : `<span class="stat-label">None</span>`;
        const checked = selectedDocKeys.has(docKey) ? "checked" : "";
        const downloadUrl = getDocumentUrl(doc);
        const downloadAction = downloadUrl
          ? `<button class="btn ghost" type="button" data-doc-download="${idx}">Download</button>`
          : `<button class="btn ghost" type="button" disabled>Download</button>`;
        const canDelete = Number.isFinite(Number(doc.id));
        const deleteAction = canDelete
          ? `<button class="btn danger ghost" data-action="delete" data-entity="documents" data-row-index="${idx}">Delete</button>`
          : `<button class="btn danger ghost" type="button" disabled>Delete</button>`;
        return `
          <tr>
            <td class="doc-select-cell">
              <input class="doc-select" type="checkbox" data-doc-key="${sanitizeText(docKey)}" aria-label="Select document" ${checked} />
            </td>
            <td>${sanitizeText(getDocNumber(doc))}</td>
            <td>${sanitizeText(companyLabel)}</td>
            <td>${sanitizeText(invoiceLabel)}</td>
            <td>${sanitizeText(typeLabel)}</td>
            <td>${tagMarkup}</td>
            <td>${sanitizeText(getDocDate(doc))}</td>
            <td class="doc-actions">
              <button class="btn ghost" data-action="preview" data-entity="documents" data-row-index="${idx}">Preview</button>
              <button class="btn ghost" data-action="edit" data-entity="documents" data-row-index="${idx}">Edit</button>
              ${downloadAction}
              ${deleteAction}
            </td>
          </tr>
        `;
      })
      .join("");
  };

  let visibleItems = [];
  const selectAllControl = sectionContent.querySelector("#doc-select-all");

  const updateSelectAllState = (items) => {
    if (!selectAllControl) return;
    const keys = items.map(({ doc, idx }) => getDocKey(doc, idx));
    const selectedCount = keys.filter((key) => selectedDocKeys.has(key)).length;
    selectAllControl.indeterminate = selectedCount > 0 && selectedCount < keys.length;
    selectAllControl.checked = keys.length > 0 && selectedCount === keys.length;
  };

  const wireRowSelections = (items) => {
    tableBody?.querySelectorAll(".doc-select").forEach((input) => {
      input.addEventListener("change", (event) => {
        const target = event.target;
        if (!(target instanceof HTMLInputElement)) return;
        const key = target.dataset.docKey;
        if (!key) return;
        if (target.checked) {
          selectedDocKeys.add(key);
        } else {
          selectedDocKeys.delete(key);
        }
        updateSelectAllState(items);
      });
    });
  };

  tableBody?.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const downloadBtn = target.closest("[data-doc-download]");
    if (!downloadBtn) return;
    const rowIndex = Number(downloadBtn.getAttribute("data-doc-download"));
    const doc = Number.isFinite(rowIndex) ? docs[rowIndex] : null;
    if (!doc) {
      showToast("Document not found");
      return;
    }
    downloadDocument(doc, rowIndex + 1);
  });

  const renderDocPagination = (totalPages, page) => {
    if (!paginationSlot) return;
    if (totalPages <= 1) {
      paginationSlot.innerHTML = "";
      return;
    }
    paginationSlot.innerHTML = `
      <button class="btn ghost small" data-doc-page="prev" ${page === 1 ? "disabled" : ""}>Prev</button>
      <span class="page-indicator">Page ${page} of ${totalPages}</span>
      <button class="btn ghost small" data-doc-page="next" ${page === totalPages ? "disabled" : ""}>Next</button>
    `;
  };

  const applyFilters = (resetPage = true) => {
    if (resetPage) currentPage = 1;
    const query = searchInput?.value.trim().toLowerCase() || "";
    const selectedCompany = companySelect?.value || "";
    const selectedInvoice = invoiceSelect?.value || "";
    const selectedType = typeSelect?.value || "";
    const sortKey = sortSelect?.value || "date";
    const sortOrder = orderSelect?.value || "desc";

    const filtered = docItems.filter(({ doc }) => {
      if (selectedCompany && String(doc.company_id || "") !== selectedCompany) return false;
      if (selectedInvoice && String(doc.invoice_id || "") !== selectedInvoice) return false;
      if (selectedType && String(doc.doc_type_name || doc.content_type || "") !== selectedType) return false;
      if (!query) return true;
      const searchStack = [
        doc.title,
        doc.storage_key,
        doc.content_type,
        doc.doc_type_name,
        doc.company_name,
        doc.contact_name,
        doc.invoice_reference,
        doc.invoice_id ? `INV-${doc.invoice_id}` : "",
        doc.tags
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return searchStack.includes(query);
    });

    const sorted = filtered.sort((a, b) => {
      if (sortKey !== "date") return 0;
      const aDate = new Date(a.doc.created_at || a.doc.updated_at || 0).getTime();
      const bDate = new Date(b.doc.created_at || b.doc.updated_at || 0).getTime();
      const diff = aDate - bDate;
      return sortOrder === "asc" ? diff : -diff;
    });

    const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
    if (currentPage > totalPages) currentPage = totalPages;
    const start = (currentPage - 1) * pageSize;
    const pageItems = sorted.slice(start, start + pageSize);

    renderDocRows(pageItems);
    visibleItems = pageItems;
    updateSelectAllState(pageItems);
    wireRowSelections(pageItems);
    renderDocPagination(totalPages, currentPage);
    if (filterMeta) {
      filterMeta.textContent = `Showing ${pageItems.length} of ${sorted.length} documents`;
    }
    return sorted;
  };

  const downloadSelected = async () => {
    const selectedDocs = Array.from(selectedDocKeys)
      .map((key) => docLookup.get(key))
      .filter(Boolean);
    if (!selectedDocs.length) {
      showToast("Select documents to download");
      return;
    }
    if (!window.JSZip) {
      showToast("Zip download is unavailable");
      return;
    }
    if (downloadButton) downloadButton.disabled = true;
    try {
      const zip = new window.JSZip();
      const usedNames = new Set();
      let added = 0;

      for (let i = 0; i < selectedDocs.length; i += 1) {
        const doc = selectedDocs[i];
        try {
          const blob = await fetchDocumentBlob(doc);
          if (!blob) continue;
          const rawName = getDocFilename(doc, i + 1);
          const dotIndex = rawName.lastIndexOf(".");
          const base = dotIndex > 0 ? rawName.slice(0, dotIndex) : rawName;
          const ext = dotIndex > 0 ? rawName.slice(dotIndex) : "";
          let name = rawName;
          let suffix = 1;
          while (usedNames.has(name)) {
            name = `${base}-${suffix}${ext}`;
            suffix += 1;
          }
          usedNames.add(name);
          zip.file(name, blob);
          added += 1;
        } catch (err) {
          console.debug("Document download failed", err);
        }
      }

      if (!added) {
        showToast("No downloadable documents found");
        return;
      }

      const zipBlob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(zipBlob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `documents-${new Date().toISOString().slice(0, 10)}.zip`;
      link.click();
      URL.revokeObjectURL(url);
    } finally {
      if (downloadButton) downloadButton.disabled = false;
    }
  };

  searchInput?.addEventListener("input", applyFilters);
  companySelect?.addEventListener("change", applyFilters);
  invoiceSelect?.addEventListener("change", applyFilters);
  typeSelect?.addEventListener("change", applyFilters);
  orderSelect?.addEventListener("change", applyFilters);
  sortSelect?.addEventListener("change", applyFilters);
  filterButton?.addEventListener("click", applyFilters);
  downloadButton?.addEventListener("click", downloadSelected);
  paginationSlot?.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const action = target.dataset.docPage;
    if (!action) return;
    const filtered = applyFilters(false) || [];
    const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
    if (action === "prev" && currentPage > 1) currentPage -= 1;
    if (action === "next" && currentPage < totalPages) currentPage += 1;
    applyFilters(false);
  });
  selectAllControl?.addEventListener("change", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    visibleItems.forEach(({ doc, idx }) => {
      const key = getDocKey(doc, idx);
      if (target.checked) {
        selectedDocKeys.add(key);
      } else {
        selectedDocKeys.delete(key);
      }
    });
    tableBody?.querySelectorAll(".doc-select").forEach((input) => {
      if (input instanceof HTMLInputElement) {
        input.checked = target.checked;
      }
    });
    updateSelectAllState(visibleItems);
  });
  applyFilters();
}

async function renderShipping() {
  sectionTitle.textContent = "Shipping Schedules";
  const rows = await loadTableFromApi(
    "shipping_schedules",
    (r) => {
      const tone = r.status === "Delivered" ? "success" : r.status === "Shipped" ? "info" : "warning";
      return [
        r.order_reference || "-",
        r.invoice_reference || "-",
        r.factory_exit_date ? new Date(r.factory_exit_date).toLocaleString() : "-",
        r.etc_date ? new Date(r.etc_date).toLocaleString() : "-",
        r.etd_date ? new Date(r.etd_date).toLocaleString() : "-",
        r.eta ? new Date(r.eta).toLocaleString() : "-",
        badge(tone, r.status || "Factory exit")
      ];
    },
    fallback.shipping_schedules.map((row) => {
      const tone = row.status === "Delivered" ? "success" : row.status === "Shipped" ? "info" : "warning";
      return [
        row.order,
        row.invoice,
        row.factory_exit || "-",
        row.etc || "-",
        row.etd || "-",
        row.eta || "-",
        badge(tone, row.status)
      ];
    })
  );

  sectionContent.innerHTML = `
    <div class="page-header">
      <div>
        <div class="eyebrow">Logistics</div>
        <h2 class="page-title">Shipping Schedules</h2>
        <div class="page-meta">Upcoming and in-transit shipments.</div>
      </div>
      <div class="actions">
        <button class="btn primary" data-form="shipping">
          <i data-lucide="plus"></i>
          Add Shipment
        </button>
      </div>
    </div>
    <div class="panel">
      <div class="panel-header">
        <h3 class="panel-title">Timeline</h3>
        <div class="stat-label">Auto-sync from orders.</div>
      </div>
      ${renderPaginatedTable(["Order #", "Invoice #", "Factory exit date", "ETC", "ETD", "ETA", "Status"], rows, "shipping_schedules")}
    </div>
  `;
}

async function renderSampleShipments() {
  sectionTitle.textContent = "Samples";
  const rows = await loadTableFromApi(
    "sample_shipments",
    (r) => [
      r.company_name || "Unknown Company",
      r.receiving_address || "-",
      r.phone || "-",
      r.product_name || "Unknown Product",
      r.quantity ?? "-",
      r.waybill_number || "-",
      r.courier || "-",
      badge(statusToneFront(r.status || ""), r.status || "Preparing")
    ],
    fallback.sample_shipments
  );

  sectionContent.innerHTML = `
    <div class="page-header">
      <div>
        <div class="eyebrow">Logistics</div>
        <h2 class="page-title">Sample Shipments</h2>
        <div class="page-meta">Record sample dispatches with courier and waybill details.</div>
      </div>
      <div class="actions">
        <button class="btn primary" data-form="sample_shipments">
          <i data-lucide="plus"></i>
          Add Sample
        </button>
      </div>
    </div>
    <div class="panel">
      <div class="panel-header">
        <h3 class="panel-title">Recent Samples</h3>
        <div class="stat-label">Includes receiving contact, product, and courier info.</div>
      </div>
      ${renderPaginatedTable(["Company", "Receiving Address", "Tel", "Product", "Qty", "Waybill #", "Courier", "Status"], rows, "sample_shipments")}
    </div>
  `;
}

async function renderTasks() {
  sectionTitle.textContent = "Tasks";
  const rows = await loadTableFromApi(
    "tasks",
    (r) => {
      const tone = r.status === "Done" ? "success" : r.status === "Not Started" ? "info" : "warning";
      return [r.title, r.assignee || "-", r.due_date || "-", badge(tone, r.status || "Not Started"), r.related_type || "-"];
    },
    fallback.tasks.map((row) => {
      const tone = row[3] === "Done" ? "success" : row[3] === "Not Started" ? "info" : "warning";
      return [row[0], row[1], row[2], badge(tone, row[3]), row[4]];
    })
  );

  sectionContent.innerHTML = `
    <div class="page-header">
      <div>
        <div class="eyebrow">Work</div>
        <h2 class="page-title">Tasks</h2>
        <div class="page-meta">Work items tied to deals and contacts.</div>
      </div>
      <div class="actions">
        <button class="btn primary" data-form="tasks">
          <i data-lucide="plus"></i>
          New Task
        </button>
      </div>
    </div>
    <div class="panel">
      <div class="panel-header">
        <h3 class="panel-title">Task List</h3>
        <div class="stat-label">Sortable by due date.</div>
      </div>
      ${renderPaginatedTable(["Task", "Owner", "Due", "Status", "Related To"], rows, "tasks")}
    </div>
  `;
}

async function renderNotes() {
  sectionTitle.textContent = "Notes";
  const rows = await loadTableFromApi(
    "notes",
    (r) => [
      r.body,
      r.author || "-",
      r.entity_type || "-",
      r.note_date ? new Date(r.note_date).toLocaleString() : r.updated_at || "Today"
    ],
    fallback.notes
  );

  sectionContent.innerHTML = `
    <div class="page-header">
      <div>
        <div class="eyebrow">Context</div>
        <h2 class="page-title">Notes</h2>
        <div class="page-meta">Recent interactions to keep context aligned.</div>
      </div>
      <div class="actions">
        <button class="btn primary" data-form="notes">
          <i data-lucide="plus"></i>
          Add Note
        </button>
      </div>
    </div>
    <div class="panel">
      <div class="panel-header">
        <h3 class="panel-title">Latest</h3>
      </div>
      <div class="note-grid"></div>
      <div class="table-pagination" data-notes-pagination></div>
    </div>
  `;

  const pageSize = 10;
  let currentPage = 1;
  const noteGrid = sectionContent.querySelector(".note-grid");
  const paginationSlot = sectionContent.querySelector("[data-notes-pagination]");

  const renderNotesPagination = (totalPages, page) => {
    if (!paginationSlot) return;
    if (totalPages <= 1) {
      paginationSlot.innerHTML = "";
      return;
    }
    paginationSlot.innerHTML = `
      <button class="btn ghost small" data-note-page="prev" ${page === 1 ? "disabled" : ""}>Prev</button>
      <span class="page-indicator">Page ${page} of ${totalPages}</span>
      <button class="btn ghost small" data-note-page="next" ${page === totalPages ? "disabled" : ""}>Next</button>
    `;
  };

  const renderNotesPage = () => {
    if (!noteGrid) return;
    if (!rows.length) {
      noteGrid.innerHTML = `<div class="empty">No notes yet.</div>`;
      renderNotesPagination(0, 0);
      return;
    }
    const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
    if (currentPage > totalPages) currentPage = totalPages;
    const start = (currentPage - 1) * pageSize;
    const pageRows = rows.slice(start, start + pageSize);
    noteGrid.innerHTML = pageRows
      .map(
        (note, idx) => `
          <div class="note-card">
            <div class="note-title">${note[0]}</div>
            <div class="note-meta">${note[3]} - ${note[1]}</div>
            <div class="stat-label">Related: ${note[2]}</div>
            <div class="note-actions">
              <button class="btn ghost" data-action="preview" data-entity="notes" data-row-index="${idx + start}">Preview</button>
              <button class="btn ghost" data-action="edit" data-entity="notes" data-row-index="${idx + start}">Edit</button>
              <button class="btn danger ghost" data-action="delete" data-entity="notes" data-row-index="${idx + start}">Delete</button>
            </div>
          </div>
        `
      )
      .join("");
    renderNotesPagination(totalPages, currentPage);
  };

  paginationSlot?.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const action = target.dataset.notePage;
    if (!action) return;
    const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
    if (action === "prev" && currentPage > 1) currentPage -= 1;
    if (action === "next" && currentPage < totalPages) currentPage += 1;
    renderNotesPage();
  });

  renderNotesPage();
}

async function renderTags() {
  sectionTitle.textContent = "Tags & Document Types";

  const tags = await fetchRecords("tags", fallback.tags);
  const docTypes = await fetchRecords("doc_types", fallback.doc_types);
  const bankMethods = getBankChargeMethods();

  sectionContent.innerHTML = `
    <div class="page-header">
      <div>
        <div class="eyebrow">Metadata</div>
        <h2 class="page-title">Tags & Document Types</h2>
        <div class="page-meta">Quickly add or remove labels and document classifications.</div>
      </div>
    </div>
    <div class="two-col">
      <div class="panel">
        <div class="panel-header">
          <h3 class="panel-title">Tags</h3>
        </div>
        <form id="tag-form" class="inline-form">
          <input type="text" name="name" placeholder="Tag name" required />
          <button class="btn primary" type="submit">Create tag</button>
        </form>
        <div id="tag-list" class="pill-list">
          ${renderPillList(tags, "tag")}
        </div>
      </div>
      <div class="panel">
        <div class="panel-header">
          <h3 class="panel-title">Document Types</h3>
        </div>
        <form id="doctype-form" class="inline-form">
          <input type="text" name="name" placeholder="Document type name" required />
          <button class="btn primary" type="submit">Create document type</button>
        </form>
        <div id="doctype-list" class="pill-list">
          ${renderPillList(docTypes, "doctype")}
        </div>
      </div>
      <div class="panel">
        <div class="panel-header">
          <h3 class="panel-title">Bank Charge Methods</h3>
          <div class="stat-label">Options that show on quotations.</div>
        </div>
        <form id="bankcharge-form" class="inline-form">
          <input type="text" name="method" placeholder="e.g. Shared / We pay" required />
          <button class="btn primary" type="submit">Add method</button>
        </form>
        <div id="bankcharge-list" class="pill-list">
          ${renderBankChargePills(bankMethods)}
        </div>
      </div>
    </div>
  `;

  const tagForm = document.getElementById("tag-form");
  tagForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = new FormData(tagForm).get("name")?.toString().trim();
    if (!name) return;
    try {
      await submitJson("/api/tags", { name });
      showToast("Tag created");
      renderSection("tags");
    } catch (err) {
      console.error(err);
      showToast("Could not create tag");
    }
  });

  const docForm = document.getElementById("doctype-form");
  docForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = new FormData(docForm).get("name")?.toString().trim();
    if (!name) return;
    try {
      await submitJson("/api/doc_types", { name });
      showToast("Document type created");
      renderSection("tags");
    } catch (err) {
      console.error(err);
      showToast("Could not create document type");
    }
  });

  const bankForm = document.getElementById("bankcharge-form");
  bankForm?.addEventListener("submit", (e) => {
    e.preventDefault();
    const method = new FormData(bankForm).get("method")?.toString().trim();
    if (!method) return;
    addBankChargeMethod(method);
    showToast("Bank charge method saved");
    renderSection("tags");
  });

  document.querySelectorAll("[data-delete]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = Number(btn.getAttribute("data-id"));
      const kind = btn.getAttribute("data-delete");
      if (!Number.isFinite(id)) {
        showToast("Seed item only (cannot delete)");
        return;
      }
      const endpoint = kind === "doctype" ? `/api/doc_types/${id}` : `/api/tags/${id}`;
      try {
        await apiFetch(endpoint, { method: "DELETE" });
        showToast("Deleted");
        renderSection("tags");
      } catch (err) {
        console.error(err);
        showToast("Delete failed");
      }
    });
  });

  document.querySelectorAll("[data-bank-method]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const method = btn.getAttribute("data-bank-method");
      removeBankChargeMethod(method);
      showToast("Bank charge method deleted");
      renderSection("tags");
    });
  });
}

async function renderSettings() {
  const canManageUsers = currentRole === adminRole;
  if (canManageUsers) {
    try {
      privilegedUsers = await fetchUsersFromApi();
    } catch (error) {
      privilegedUsers = [];
      showToast(error instanceof Error ? error.message : "Unable to load users");
    }
  } else {
    privilegedUsers = [];
  }
  sectionTitle.textContent = "Settings";
  sectionContent.innerHTML = `
    <div class="page-header">
      <div>
        <div class="eyebrow">Workspace</div>
        <h2 class="page-title">Settings</h2>
        <div class="page-meta">Cloudflare bindings and data sources.</div>
      </div>
    </div>
    <div class="panel">
      <div class="panel-header">
        <h3 class="panel-title">Cloudflare Bindings</h3>
        <div class="stat-label">D1 for relational data, R2 for documents.</div>
      </div>
      <div class="stat-grid">
        <div class="stat-card">
          <div class="stat-label">D1 Database</div>
          <div class="stat-value">crmforall-db</div>
          <div class="stat-pill">
            <span class="badge-dot" style="background:#22c55e"></span>
            Binding: DB
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-label">R2 Bucket</div>
          <div class="stat-value">crmforall-files</div>
          <div class="stat-pill">
            <span class="badge-dot" style="background:#0ea5e9"></span>
            Binding: FILES
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Static Assets</div>
          <div class="stat-value">public/</div>
          <div class="stat-pill">
            <span class="badge-dot" style="background:#6366f1"></span>
            Binding: ASSETS
          </div>
        </div>
      </div>
    </div>
    <div class="settings-layout">
      <div class="tabs-container">
        <div class="tabs">
          <button class="tab active" data-tab="site-config">Site configuration</button>
          ${canManageUsers ? `<button class="tab" data-tab="add-user">Add user</button>` : ""}
          <button class="tab" data-tab="change-password">Change password</button>
          ${canManageUsers ? `<button class="tab" data-tab="users-privilege">Users with privilege</button>` : ""}
        </div>
        <div class="tab-content active" id="site-config">
          <div class="panel configuration-panel">
            <div class="panel-header">
              <h3 class="panel-title">Site configuration</h3>
              <div class="stat-label">Fine-tune the brand, locale, and invoice defaults.</div>
            </div>
            <form id="site-config-form" class="form-grid">
              <div class="config-row">
                <span>Active theme:</span>
                <div class="active-theme-pill">${siteConfigState.activeTheme}</div>
              </div>
              <label>
                <span>Site name</span>
                <input name="siteName" type="text" value="${siteConfigState.siteName}" required />
              </label>
              <label>
                <span>Base company</span>
                <input name="baseCompany" type="text" value="${siteConfigState.baseCompany}" placeholder="Base company name" required />
              </label>
              <label>
                <span>Region</span>
                <input name="region" type="text" value="${siteConfigState.region}" />
              </label>
              <label>
                <span>Timezone</span>
                <select name="timezone">
                  <option value="">Auto (browser locale)</option>
                  ${timezoneOptions
                    .map(
                      (tz) => `<option value="${tz.value}" ${
                        siteConfigState.timezone === tz.value ? "selected" : ""
                      }>${tz.label}</option>`
                    )
                    .join("")}
                </select>
              </label>
              <label>
                <span>Theme</span>
                <input name="theme" type="text" value="${siteConfigState.theme}" />
              </label>
              <label>
                <span>Invoice company name</span>
                <input name="invoiceName" type="text" placeholder="Company name to display on invoices" value="${siteConfigState.invoiceName}" />
              </label>
              <label>
                <span>Invoice company address</span>
                <textarea name="invoiceAddress">${siteConfigState.invoiceAddress}</textarea>
              </label>
              <label>
                <span>Invoice company phone</span>
                <input name="invoicePhone" type="text" placeholder="Primary invoice contact" value="${siteConfigState.invoicePhone}" />
              </label>
              <label class="toggle-row">
                <span>Display footer on all pages</span>
                <input name="showFooter" type="checkbox" ${siteConfigState.showFooter ? "checked" : ""} />
              </label>
              <div class="form-actions">
                <button type="submit" class="btn primary gradient">Save settings</button>
              </div>
            </form>
          </div>
        </div>
        ${canManageUsers ? `
        <div class="tab-content" id="add-user">
          <div class="panel add-user-panel">
            <div class="panel-header">
              <h3 class="panel-title">Add user</h3>
              <div class="stat-label">Grant access and keep the roster up to date.</div>
            </div>
            <form id="add-user-form" class="form-grid">
              <label>
                <span>Name</span>
                <input name="name" type="text" placeholder="Full name" required />
              </label>
              <label>
                <span>Email</span>
                <input name="email" type="email" placeholder="name@example.com" required />
              </label>
              <label class="role-field">
                <span>Role</span>
                <div class="role-row">
                  <select name="role" required>
                    <option value="">Select a role</option>
                    ${addUserRoleOptions.map((role) => `<option value="${role}">${role}</option>`).join("")}
                    <option value="custom">Custom role</option>
                  </select>
                  <input
                    name="customRole"
                    class="custom-role-input hidden"
                    type="text"
                    placeholder="Describe the custom role"
                    aria-label="Custom role"
                  />
                </div>
                <p class="field-hint">Pick a clear role title or describe a custom team/assignment.</p>
              </label>
              <label>
                <span>Access</span>
                <input name="access" type="text" placeholder="Products · Quotes · Contacts" />
              </label>
              <label class="input-with-action">
                <span>Initial password</span>
                <div class="input-action-row">
                  <input name="initialPassword" type="password" placeholder="Set temporary password" required />
                  <button type="button" class="btn ghost small" data-action="generate-password">Generate</button>
                </div>
              </label>
              <div class="form-actions">
                <button type="submit" class="btn primary">Add to privileged list</button>
              </div>
            </form>
          </div>
        </div>
        ` : ""}
        <div class="tab-content" id="change-password">
          <div class="panel password-panel">
            <div class="panel-header">
              <h3 class="panel-title">Change password</h3>
              <div class="stat-label">Keep your account secure by updating your password regularly.</div>
            </div>
            <form id="password-form" class="password-form">
              <label>
                <span>Current Password</span>
                <input type="password" name="current" placeholder="Enter current password" autocomplete="current-password" required />
              </label>
              <label>
                <span>New Email (optional)</span>
                <input type="email" name="newEmail" placeholder="Enter new email" autocomplete="email" />
              </label>
              <label>
                <span>Confirm New Email</span>
                <input type="email" name="confirmEmail" placeholder="Re-enter new email" autocomplete="email" />
              </label>
              <label>
                <span>New Password</span>
                <input type="password" name="new" placeholder="Enter new password" autocomplete="new-password" />
              </label>
              <p class="hint">Leave email/password blank if you only want to update the other.</p>
              <label>
                <span>Confirm New Password</span>
                <input type="password" name="confirm" placeholder="Re-enter new password" autocomplete="new-password" />
              </label>
              <div class="password-actions">
                <button type="submit" class="btn primary gradient">Update Password</button>
                <button type="button" class="btn cancel" data-action="cancel">Cancel</button>
              </div>
            </form>
          </div>
        </div>
        ${canManageUsers ? `
        <div class="tab-content" id="users-privilege">
          <div class="panel privilege-panel">
            <div class="panel-header">
              <h3 class="panel-title">Users with privilege</h3>
              <div class="stat-label">Review who currently has elevated access.</div>
            </div>
            <div class="privilege-list">
              ${privilegedUsers.map((user) => renderPrivilegeItem(user)).join("")}
            </div>
          </div>
        </div>
        ` : ""}
      </div>
    </div>
  `;

  // Tab switching logic
  const tabs = document.querySelectorAll(".tabs .tab");
  const tabContents = document.querySelectorAll(".tab-content");
  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const tabId = tab.dataset.tab;
      tabs.forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      tabContents.forEach((content) => {
        content.classList.remove("active");
        if (content.id === tabId) {
          content.classList.add("active");
        }
      });
    });
  });

  const passwordForm = document.getElementById("password-form");
  const cancelButton = passwordForm?.querySelector("[data-action='cancel']");

  passwordForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(passwordForm);
    const current = data.get("current")?.toString() || "";
    const next = data.get("new")?.toString() || "";
    const confirm = data.get("confirm")?.toString() || "";
    const newEmailRaw = data.get("newEmail")?.toString().trim() || "";
    const confirmEmailRaw = data.get("confirmEmail")?.toString().trim() || "";
    const wantsPassword = next.length > 0 || confirm.length > 0;
    const wantsEmail = newEmailRaw.length > 0 || confirmEmailRaw.length > 0;

    if (!wantsPassword && !wantsEmail) {
      showToast("Enter a new email or password");
      return;
    }

    if (wantsPassword) {
      if (next.length < 8) {
        showToast("New password must be at least 8 characters");
        return;
      }
      if (next !== confirm) {
        showToast("New passwords do not match");
        return;
      }
    }

    let newEmail = "";
    if (wantsEmail) {
      if (!newEmailRaw || !confirmEmailRaw) {
        showToast("Confirm your new email");
        return;
      }
      const normalizedNew = normalizeEmail(newEmailRaw);
      const normalizedConfirm = normalizeEmail(confirmEmailRaw);
      if (!normalizedNew || !normalizedConfirm || normalizedNew !== normalizedConfirm) {
        showToast("New emails do not match");
        return;
      }
      if (!normalizedNew.includes("@")) {
        showToast("Enter a valid email address");
        return;
      }
      newEmail = normalizedNew;
    }

    if (!currentUserEmail) {
      showToast("Please log in again to update your password");
      return;
    }

    try {
      const res = await apiFetch("/api/auth/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentPassword: current,
          newPassword: wantsPassword ? next : undefined,
          newEmail: wantsEmail ? newEmail : undefined
        })
      });
      if (!res.ok) {
        showToast(await readApiError(res, "Unable to update password"));
        return;
      }
      const payload = await res.json().catch(() => ({}));
      const updatedEmail = payload.email || (newEmail || currentUserEmail);
      if (wantsEmail && updatedEmail && updatedEmail !== currentUserEmail) {
        currentUserEmail = updatedEmail;
        window.localStorage.setItem(authEmailKey, currentUserEmail);
        if (userDisplay) userDisplay.textContent = currentUserEmail;
      }
      if (currentRole === adminRole) {
        try {
          privilegedUsers = await fetchUsersFromApi();
          renderPrivilegeList(document.querySelector(".privilege-panel .privilege-list"));
        } catch (err) {
          console.warn("Unable to refresh users list", err);
        }
      }
      showToast("Account updated");
      passwordForm.reset();
    } catch (error) {
      console.error(error);
      showToast("Unable to update password");
    }
  });

  cancelButton?.addEventListener("click", () => passwordForm?.reset());

  const addUserForm = document.getElementById("add-user-form");
  const privilegeList = document.querySelector(".privilege-panel .privilege-list");
  if (!canManageUsers) {
    addUserForm
      ?.querySelectorAll("input, select, button, textarea")
      .forEach((el) => {
        if (el instanceof HTMLButtonElement || el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement) {
          el.disabled = true;
        }
      });
  }

  privilegeList?.addEventListener("click", async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const action = target.dataset.action;
    if (!action) return;
    const item = target.closest(".privilege-item");
    if (!item) return;
    const nameElement = item.querySelector(".privilege-name");
    const userName = nameElement?.textContent?.trim() || "User";
    const userId = item.dataset.id ? Number(item.dataset.id) : NaN;
    const email = item.dataset.email ? normalizeEmail(item.dataset.email) : "";
    const user = Number.isFinite(userId)
      ? privilegedUsers.find((entry) => entry.id === userId)
      : privilegedUsers.find((entry) => entry.email === email);

    if (action === "edit-user") {
      if (currentRole !== adminRole) {
        showToast("Only admins can edit users");
        return;
      }
      if (!user) return;
      const safeName = escapeHtml(user.name || "");
      const safeRole = escapeHtml(user.role || "");
      const safeAccess = escapeHtml(user.access || "");
      item.innerHTML = `
        <div class="privilege-edit-fields">
          <label>
            <span>Name</span>
            <input class="privilege-input" name="name" type="text" value="${safeName}" required />
          </label>
          <label>
            <span>Role</span>
            <input class="privilege-input" name="role" type="text" value="${safeRole}" required />
          </label>
        </div>
        <div class="privilege-actions">
          <button type="button" class="btn primary small" data-action="save-user">Save</button>
          <button type="button" class="btn ghost small" data-action="cancel-edit">Cancel</button>
        </div>
      `;
      return;
    }

    if (action === "save-user") {
      const nameInput = item.querySelector("input[name='name']");
      const roleInput = item.querySelector("input[name='role']");
      if (!(nameInput instanceof HTMLInputElement) || !(roleInput instanceof HTMLInputElement)) return;
      const name = nameInput.value.trim();
      const role = roleInput.value.trim();
      if (!name || !role) {
        showToast("Name and role are required");
        return;
      }
      if (!user || !Number.isFinite(userId)) return;
      try {
        const updated = await updateUserOnServer(userId, { name, role });
        if (updated) {
          privilegedUsers = privilegedUsers.map((entry) => (entry.id === updated.id ? updated : entry));
          renderPrivilegeList(privilegeList);
        }
        showToast("User updated");
      } catch (error) {
        console.error(error);
        showToast(error instanceof Error ? error.message : "Unable to update user");
      }
      return;
    }

    if (action === "cancel-edit") {
      renderPrivilegeList(privilegeList);
      return;
    }

    if (action === "remove-user") {
      if (currentRole !== adminRole) {
        showToast("Only admins can remove users");
        return;
      }
      if (!Number.isFinite(userId)) return;
      try {
        await deleteUserOnServer(userId);
        privilegedUsers = privilegedUsers.filter((entry) => entry.id !== userId);
        renderPrivilegeList(privilegeList);
        showToast(`${userName} removed from privileged list`);
      } catch (error) {
        console.error(error);
        showToast(error instanceof Error ? error.message : "Unable to remove user");
      }
      return;
    }

    if (action === "toggle-user") {
      if (currentRole !== adminRole) {
        showToast("Only admins can update access");
        return;
      }
      if (!user || !Number.isFinite(userId)) return;
      try {
        const updated = await updateUserOnServer(userId, { enabled: !user.enabled });
        if (updated) {
          privilegedUsers = privilegedUsers.map((entry) => (entry.id === updated.id ? updated : entry));
          renderPrivilegeList(privilegeList);
        }
      } catch (error) {
        console.error(error);
        showToast(error instanceof Error ? error.message : "Unable to update user");
      }
      return;
    }

    if (action === "toggle-access") {
      if (currentRole !== adminRole) {
        showToast("Only admins can update access");
        return;
      }
      const accessId = target.dataset.access;
      if (!accessId) return;
      if (!user || !Number.isFinite(userId)) return;
      const list = Array.isArray(user.accessList) ? [...user.accessList] : parseAccessList(user.access || "");
      const next = list.includes(accessId)
        ? list.filter((id) => id !== accessId)
        : [...list, accessId];
      try {
        const updated = await updateUserOnServer(userId, { accessList: next, access: formatAccessText(next) });
        if (updated) {
          privilegedUsers = privilegedUsers.map((entry) => (entry.id === updated.id ? updated : entry));
          renderPrivilegeList(privilegeList);
        }
      } catch (error) {
        console.error(error);
        showToast(error instanceof Error ? error.message : "Unable to update access");
      }
      return;
    }

    if (action === "reset-user") {
      const tempPassword = generateTempPassword();
      if (currentRole !== adminRole) {
        showToast("Only admins can reset passwords");
        return;
      }
      if (!Number.isFinite(userId)) return;
      try {
        await updateUserPasswordOnServer(userId, tempPassword);
        showToast(`${userName} password reset: ${tempPassword}`);
      } catch (error) {
        console.error(error);
        showToast(error instanceof Error ? error.message : "Unable to reset password");
      }
      return;
    }
  });

  addUserForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    if (currentRole !== adminRole) {
      showToast("Only admins can add users");
      return;
    }
    const data = new FormData(addUserForm);
    const name = data.get("name")?.toString().trim();
    const email = data.get("email")?.toString().trim();
    const selectedRole = data.get("role")?.toString().trim();
    const customRole = data.get("customRole")?.toString().trim();
    const access = data.get("access")?.toString().trim() || "";
    const password = data.get("initialPassword")?.toString().trim();

    let role = selectedRole;
    if (selectedRole === "custom") {
      if (!customRole) {
        showToast("Describe the custom role before saving");
        return;
      }
      role = customRole;
    }

    const normalizedEmail = email ? normalizeEmail(email) : "";
    if (!name || !normalizedEmail || !role || !password) {
      showToast("Provide name, email, and role");
      return;
    }

    if (privilegedUsers.some((user) => user.email === normalizedEmail)) {
      showToast("A user with that email already exists");
      return;
    }

    const accessList = parseAccessList(access);
    const accessText = accessList.length ? formatAccessText(accessList) : access || "Custom access";
    createUserOnServer({
      name,
      email: normalizedEmail,
      role,
      access: accessText,
      accessList,
      password
    })
      .then((created) => {
        if (created) {
          privilegedUsers = [created, ...privilegedUsers];
        }
        renderPrivilegeList(privilegeList);
        showToast(`${name} added with elevated access and initial password set`);
        addUserForm.reset();
      })
      .catch((error) => {
        console.error(error);
        showToast(error instanceof Error ? error.message : "Unable to add user");
      });
  });

  const initialPasswordField = addUserForm?.querySelector("input[name='initialPassword']");
  const generatePassword = addUserForm?.querySelector("[data-action='generate-password']");
  generatePassword?.addEventListener("click", () => {
    const temp = generateTempPassword();
    if (initialPasswordField instanceof HTMLInputElement) {
      initialPasswordField.value = temp;
    }
    showToast("Temporary password generated");
  });

  const roleSelect = addUserForm?.querySelector("select[name='role']");
  const customRoleInput = addUserForm?.querySelector("input[name='customRole']");

  function updateCustomRoleVisibility() {
    if (!roleSelect || !customRoleInput) return;
    const customField = customRoleInput instanceof HTMLInputElement ? customRoleInput : null;
    if (roleSelect.value === "custom") {
      customRoleInput.classList.remove("hidden");
      if (customField) {
        customField.required = true;
        customField.focus();
      }
    } else {
      customRoleInput.classList.add("hidden");
      if (customField) {
        customField.required = false;
        customField.value = "";
      }
    }
  }

  roleSelect?.addEventListener("change", updateCustomRoleVisibility);
  addUserForm?.addEventListener("reset", () => {
    if (customRoleInput) {
      customRoleInput.classList.add("hidden");
      if (customRoleInput instanceof HTMLInputElement) {
        customRoleInput.required = false;
        customRoleInput.value = "";
      }
    }
  });
  updateCustomRoleVisibility();

  const siteConfigForm = document.getElementById("site-config-form");
  siteConfigForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(siteConfigForm);
    const newTheme = data.get("theme")?.toString().trim() || siteConfigState.theme;
    const updatedConfig = {
      ...siteConfigState,
      siteName: data.get("siteName")?.toString().trim() || siteConfigState.siteName,
      baseCompany: data.get("baseCompany")?.toString().trim() || siteConfigState.baseCompany,
      region: data.get("region")?.toString().trim() || "",
      timezone: data.get("timezone")?.toString().trim() || "",
      theme: newTheme,
      activeTheme: newTheme,
      invoiceName: data.get("invoiceName")?.toString().trim() || "",
      invoiceAddress: data.get("invoiceAddress")?.toString().trim() || "",
      invoicePhone: data.get("invoicePhone")?.toString().trim() || "",
      showFooter: data.get("showFooter") === "on"
    };
    siteConfigState = updatedConfig;
    persistSiteConfigState(siteConfigState);
    applySiteConfig();
    try {
      await saveSiteConfigToServer(siteConfigState);
      showToast("Site configuration saved");
    } catch (error) {
      console.warn("Unable to sync site config", error);
      showToast("Saved locally. Unable to sync settings.");
    }
  });
}

async function fetchCompaniesList() {
  try {
    const res = await apiFetch("/api/companies");
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.rows)) {
        return data.rows.map((row) => ({ id: row.id, name: row.name }));
      }
    }
  } catch (err) {
    console.debug("Fallback companies", err);
  }
  return fallback.companies.map((c, idx) => ({
    id: c?.id ?? idx + 1,
    name: c?.name || c?.[0] || `Company ${idx + 1}`
  }));
}

async function fetchContactsList() {
  try {
    const res = await apiFetch("/api/contacts");
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.rows)) {
        return data.rows.map((row) => ({ id: row.id, name: `${row.first_name} ${row.last_name}` }));
      }
    }
  } catch (err) {
    console.debug("Fallback contacts", err);
  }
  return [];
}

async function fetchProductsList() {
  try {
    const res = await apiFetch("/api/products");
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.rows)) {
        return data.rows.map((row) => ({ id: row.id, name: row.name, price: row.price || 0 }));
      }
    }
  } catch (err) {
    console.debug("Fallback products", err);
  }
  return [];
}

async function fetchOrdersList() {
  try {
    const res = await apiFetch("/api/orders");
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.rows)) {
        return data.rows.map((row) => ({
          id: row.id,
          reference: row.reference,
          company_id: row.company_id,
          company: row.company_id || row.company
        }));
      }
    }
  } catch (err) {
    console.debug("Fallback orders", err);
  }
  return [];
}

async function fetchInvoicesList() {
  try {
    const res = await apiFetch("/api/invoices");
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.rows)) {
        return data.rows.map((row) => ({
          id: row.id,
          reference: row.reference,
          company_id: row.company_id,
          company: row.company_id || row.company,
          created_at: row.created_at,
          due_date: row.due_date
        }));
      }
    }
  } catch (err) {
    console.debug("Fallback invoices", err);
  }
  return [];
}

async function fetchShippingSchedulesList() {
  try {
    const res = await apiFetch("/api/shipping_schedules");
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.rows)) {
        return data.rows.map((row) => ({
          id: row.id,
          order_id: row.order_id,
          invoice_id: row.invoice_id,
          order_reference: row.order_reference,
          invoice_reference: row.invoice_reference
        }));
      }
    }
  } catch (err) {
    console.debug("Fallback shipping schedules", err);
  }
  return [];
}

async function fetchQuotationsList() {
  try {
    const res = await apiFetch("/api/quotations");
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.rows)) {
        return data.rows.map((row) => ({
          id: row.id,
          reference: row.reference,
          title: row.title,
          company_id: row.company_id,
          currency: row.currency,
          tax_rate: row.tax_rate
        }));
      }
    }
  } catch (err) {
    console.debug("Fallback quotations", err);
  }
  return [];
}

async function fetchDocumentsList() {
  try {
    const res = await apiFetch("/api/documents");
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.rows)) {
        return data.rows.map((row) => ({
          id: row.id,
          title: row.title,
          storage_key: row.storage_key || row.key,
          content_type: row.content_type,
          company_id: row.company_id,
          contact_id: row.contact_id,
          doc_type_id: row.doc_type_id,
          invoice_id: row.invoice_id || row.invoiceId
        }));
      }
    }
  } catch (err) {
    console.debug("Fallback documents", err);
  }
  return [];
}

async function fetchDocumentById(id) {
  if (!id) return null;
  const docs = await fetchDocumentsList();
  return docs.find((d) => d.id == id) || null;
}



async function fetchRecords(table, fallbackRows) {
  try {
    const res = await apiFetch(`/api/${table}`);
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.rows)) {
        const live = data.rows.map((row) => ({
          id: row.id,
          name: row.name,
          color: row.color
        }));
        // Merge fallback (seed) with live to ensure new items always show
        const merged = [...live];
        (fallbackRows || []).forEach((f) => {
          if (!merged.find((r) => r.name === f.name)) merged.push(f);
        });
        return merged;
      }
    }
  } catch (err) {
    console.debug(`Falling back for ${table}`, err);
    showToast(`Unable to load ${table} from API, showing cached list`);
  }
  return fallbackRows || [];
}

async function loadTableFromApi(table, mapper, fallbackRows, options = {}) {
  const { fetchAll = false, limit = 200, maxPages = 20 } = options || {};
  try {
    const bypass = cacheBypassTables.has(table);
    const buildUrl = (offset) => {
      const params = new URLSearchParams();
      if (bypass) params.set("cache", "0");
      if (fetchAll || limit) params.set("limit", String(limit));
      if (offset) params.set("offset", String(offset));
      const qs = params.toString();
      return qs ? `/api/${table}?${qs}` : `/api/${table}`;
    };

    if (fetchAll) {
      const collected = [];
      const seenIds = new Set();
      let offset = 0;
      let pages = 0;
      while (pages < maxPages) {
        const res = await apiFetch(buildUrl(offset));
        if (!res.ok) break;
        const data = await res.json();
        if (!Array.isArray(data.rows) || !data.rows.length) break;
        let rows = data.rows;
        if (offset > 0) {
          rows = rows.filter((row) => {
            const key = row?.id != null ? String(row.id) : "";
            if (!key || seenIds.has(key)) return false;
            return true;
          });
          if (!rows.length) break;
        }
        rows.forEach((row) => {
          if (row?.id != null) seenIds.add(String(row.id));
        });
        collected.push(...rows);
        if (data.rows.length < limit) break;
        offset += limit;
        pages += 1;
      }
      if (bypass) cacheBypassTables.delete(table);
      if (collected.length) {
        tableRecords[table] = collected;
        return collected.map(mapper);
      }
    } else {
      const res = await apiFetch(buildUrl(0));
      if (bypass) cacheBypassTables.delete(table);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.rows) && data.rows.length) {
          tableRecords[table] = data.rows;
          return data.rows.map(mapper);
        }
      }
    }
  } catch (err) {
    console.debug(`Falling back for ${table}`, err);
  }
  if (fallbackRows) {
    const mappedRecords = fallbackRows.map((row, idx) => mapFallbackRow(table, row, idx));
    tableRecords[table] = mappedRecords;
    return typeof mapper === "function" ? mappedRecords.map(mapper) : fallbackRows;
  }
  return [];
}

async function loadLookupTable(table, fallbackRows) {
  try {
    const res = await apiFetch(`/api/${table}`);
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.rows) && data.rows.length) {
        tableRecords[table] = data.rows;
        return;
      }
    }
  } catch (err) {
    console.debug(`Unable to preload ${table}`, err);
  }
  if (fallbackRows) {
    tableRecords[table] = fallbackRows.map((row, idx) => mapFallbackRow(table, row, idx));
  }
}

let lookupTablesReadyPromise = null;
async function ensureLookupTablesReady() {
  if (lookupTablesReadyPromise) return lookupTablesReadyPromise;
  lookupTablesReadyPromise = Promise.all([
    loadLookupTable("doc_types", fallback.doc_types),
    loadLookupTable("tags", fallback.tags)
  ]).catch((err) => {
    console.warn("Lookup preload failed", err);
    lookupTablesReadyPromise = null;
  });
  return lookupTablesReadyPromise;
}



function mapFallbackRow(table, row, idx) {
  const isObj = row && typeof row === "object" && !Array.isArray(row);
  if (isObj) {
    // Ensure all fallback objects have proper IDs
    return { ...row, id: row.id || (idx + 1) };
  }
  
  const safeId = idx + 1;
  // Legacy array format support (for backwards compatibility)
  if (table === "companies" && Array.isArray(row)) {
    const [name, website, email, phone, owner, status] = row;
    return { id: safeId, name, website, email, phone, owner, status };
  }
  if (table === "contacts" && Array.isArray(row)) {
    const [name, company, role, email, phone, status] = row;
    // Parse name to first_name and last_name
    const nameParts = name.split(" ");
    const first_name = nameParts[0] || "";
    const last_name = nameParts.slice(1).join(" ") || "";
    const company_id = company === "Northwind Traders" ? 1 : company === "Globex Inc" ? 2 : company === "Initech" ? 3 : 4;
    return { id: safeId, first_name, last_name, company_id, role, email, phone, status };
  }
  if (table === "products" && Array.isArray(row)) {
    const [name, sku, category, priceStr, currency, status] = row;
    const price = parseFloat(priceStr.replace("$", "").replace(",", "")) || 0;
    return { id: safeId, name, sku, category, price, currency, status };
  }
  if (table === "orders" && Array.isArray(row)) {
    const [reference, company, contact, status, totalStr, updated] = row;
    const total = parseFloat(totalStr.replace("$", "").replace(",", "")) || 0;
    const company_id = company === "Northwind Traders" ? 1 : company === "Globex Inc" ? 2 : company === "Initech" ? 3 : 4;
    // Extract contact ID from contact name
    const contact_id = contact === "Sarah Alvarez" ? 1 : contact === "Tim Rudd" ? 2 : contact === "Jan Levinson" ? 3 : 4;
    return { id: safeId, reference, company_id, contact_id, status, total_amount: total, updated_at: updated };
  }
  if (table === "quotations" && Array.isArray(row)) {
    const [reference, company, owner, amountStr, status, valid] = row;
    const amount = parseFloat(amountStr.replace("$", "").replace(",", "")) || 0;
    const company_id = company === "Northwind Traders" ? 1 : company === "Globex Inc" ? 2 : company === "Initech" ? 3 : 4;
    return { id: safeId, reference, company_id, title: `${reference} Proposal`, amount, status, valid_until: valid };
  }
  if (table === "invoices" && Array.isArray(row)) {
    const [reference, company, totalStr, due, status, owner] = row;
    const total = parseFloat(totalStr.replace("$", "").replace(",", "")) || 0;
    const company_id = company === "Northwind Traders" ? 1 : company === "Globex Inc" ? 2 : company === "Initech" ? 3 : 4;
    return { id: safeId, reference, company_id, total_amount: total, due_date: due, status };
  }
  if (table === "documents" && Array.isArray(row)) {
    const [title, linked, type, sizeStr, owner, updated] = row;
    const size = sizeStr.includes("MB") ? parseFloat(sizeStr) * 1024 * 1024 : parseFloat(sizeStr) * 1024;
    return { id: safeId, title, content_type: type, size, updated_at: updated };
  }
  if (table === "shipping_schedules" && Array.isArray(row)) {
    const [order, invoice, third, fourth, fifth, sixth, seventh] = row;
    const hasFactoryExit = row.length >= 7;
    const factoryExit = hasFactoryExit ? third : null;
    const etc = hasFactoryExit ? fourth : third;
    const etd = hasFactoryExit ? fifth : fourth;
    const eta = hasFactoryExit ? sixth : fifth;
    const status = hasFactoryExit ? seventh : sixth;
    return {
      id: safeId,
      order_id: parseInt(order.replace("SO-", "")) || idx + 1,
      invoice_id: parseInt(invoice.replace("INV-", "")) || idx + 1,
      factory_exit_date: factoryExit,
      etc_date: etc,
      etd_date: etd,
      eta,
      status
    };
  }
  if (table === "sample_shipments" && Array.isArray(row)) {
    const [company, product, address, phone, qty, waybill, courier, status] = row;
    return {
      id: safeId,
      company_id: company === "Northwind Traders" ? 1 : company === "Globex Inc" ? 2 : company === "Initech" ? 3 : 4,
      product_id: product === "Standard Widget" ? 1 : product === "Premium Kit" ? 2 : 3,
      document_id: null,
      receiving_address: address,
      phone,
      quantity: Number(qty) || 0,
      waybill_number: waybill,
      courier,
      status: status || "Preparing"
    };
  }
  if (table === "tasks" && Array.isArray(row)) {
    const [title, owner, due, status, related] = row;
    const related_id = related === "Northwind" ? 1 : related === "Globex" ? 2 : related === "Initech" ? 3 : 4;
    return { id: safeId, title, assignee: owner, due_date: due, status, related_type: "company", related_id };
  }
  if (table === "notes" && Array.isArray(row)) {
    const [body, author, entity, date] = row;
    const entity_id = entity === "Northwind" ? 1 : entity === "Globex" ? 2 : entity === "Initech" ? 3 : 4;
    return { id: safeId, body, author, entity_type: "company", entity_id, note_date: date };
  }
  return { id: safeId, value: row };
}

function renderPillList(items, type) {
  if (!items.length) return `<div class="empty">No records yet</div>`;
  return items
    .map(
      (item) => `
        <div class="pill-row">
          <span>${item.name}</span>
          <button class="btn danger" data-delete="${type}" data-id="${item.id ?? ""}">Delete</button>
        </div>
      `
    )
    .join("");
}

function loadBankChargeMethods() {
  if (typeof window === "undefined") return [...defaultBankChargeMethods];
  try {
    const saved = window.localStorage.getItem("bankChargeMethods");
    if (!saved) return [...defaultBankChargeMethods];
    const parsed = JSON.parse(saved);
    if (Array.isArray(parsed) && parsed.length) {
      return Array.from(new Set(parsed.map((m) => m.toString().trim()).filter(Boolean)));
    }
  } catch (err) {
    console.warn("Unable to load bank charge methods", err);
  }
  return [...defaultBankChargeMethods];
}

function persistBankChargeMethods(methods) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem("bankChargeMethods", JSON.stringify(methods));
  } catch (err) {
    console.warn("Unable to save bank charge methods", err);
  }
}

let bankChargeMethods = loadBankChargeMethods();

function getBankChargeMethods() {
  return bankChargeMethods && bankChargeMethods.length ? [...bankChargeMethods] : [...defaultBankChargeMethods];
}

function getBankChargeOptions() {
  return ["-- Select option --", ...getBankChargeMethods()];
}

function addBankChargeMethod(name) {
  const normalized = name?.toString().trim();
  if (!normalized) return getBankChargeMethods();
  const next = Array.from(new Set([...getBankChargeMethods(), normalized]));
  bankChargeMethods = next;
  persistBankChargeMethods(next);
  refreshBankChargeSelects();
  return next;
}

function removeBankChargeMethod(name) {
  const normalized = name?.toString().trim();
  if (!normalized) return getBankChargeMethods();
  const next = getBankChargeMethods().filter((m) => m.toLowerCase() !== normalized.toLowerCase());
  bankChargeMethods = next.length ? next : [...defaultBankChargeMethods];
  persistBankChargeMethods(bankChargeMethods);
  refreshBankChargeSelects();
  return bankChargeMethods;
}

function renderBankChargePills(methods) {
  if (!methods.length) {
    return `<div class="empty">No bank charge methods yet</div>`;
  }
  return methods
    .map(
      (m) => `
        <div class="pill-row">
          <span>${m}</span>
          <button class="btn danger" data-bank-method="${m}">Delete</button>
        </div>
      `
    )
    .join("");
}

function populateBankChargeSelect(selectEl, selectedValue) {
  if (!selectEl) return;
  const options = getBankChargeOptions();
  const current = selectedValue ?? selectEl.value;
  const optionHtml = options.map((opt) => `<option value="${opt === "-- Select option --" ? "" : opt}">${opt}</option>`);
  if (current && !options.some((opt) => opt.toLowerCase() === current.toLowerCase())) {
    optionHtml.push(`<option value="${current}">${current}</option>`);
  }
  selectEl.innerHTML = optionHtml.join("");
  if (current) {
    selectEl.value = current;
  }
}

function refreshBankChargeSelects(root = document) {
  const selects = root.querySelectorAll('select[name="bank_charge_method"]');
  selects.forEach((sel) => populateBankChargeSelect(sel));
}

function renderTable(columns, rows, tableKey = "", includeActions = true, rowIndexOffset = 0) {
  if (!rows.length) {
    return `<div class="empty">No records yet. Connect D1 to start storing data.</div>`;
  }

  const header =
    columns.map((col) => `<th>${col}</th>`).join("") + (includeActions ? `<th class="actions-col">Actions</th>` : "");
  const body = rows
    .map(
      (row, idx) => {
        return `<tr data-row-index="${idx + rowIndexOffset}">${row.map((cell) => `<td>${cell}</td>`).join("")}${
          includeActions
            ? `<td class="actions-col"><button class="btn ghost" data-action="preview">Preview</button><button class="btn ghost" data-action="edit">Edit</button><button class="btn danger ghost" data-action="delete">Delete</button></td>`
            : ""
        }</tr>`;
      }
    )
    .join("");
  return `
    <div class="table-wrapper">
      <table data-table="${tableKey || ""}">
        <thead><tr>${header}</tr></thead>
        <tbody>${body}</tbody>
      </table>
    </div>
  `;
}

const paginationState = new Map();

function renderPaginatedTable(columns, rows, tableKey = "", includeActions = true, pageSize = 10) {
  if (!rows.length) {
    return renderTable(columns, rows, tableKey, includeActions);
  }
  const state = {
    columns,
    rows,
    tableKey,
    includeActions,
    pageSize,
    currentPage: 1
  };
  paginationState.set(tableKey, state);
  return buildPaginatedTableMarkup(state);
}

function renderPaginationControls(totalPages, currentPage) {
  if (totalPages <= 1) return "";
  return `
    <div class="table-pagination">
      <button class="btn ghost small" data-page="prev" ${currentPage === 1 ? "disabled" : ""}>Prev</button>
      <span class="page-indicator">Page ${currentPage} of ${totalPages}</span>
      <button class="btn ghost small" data-page="next" ${currentPage === totalPages ? "disabled" : ""}>Next</button>
    </div>
  `;
}

function buildPaginatedTableInner(state) {
  const totalPages = Math.max(1, Math.ceil(state.rows.length / state.pageSize));
  const page = Math.min(state.currentPage, totalPages);
  const start = (page - 1) * state.pageSize;
  const pageRows = state.rows.slice(start, start + state.pageSize);
  const tableHtml = renderTable(state.columns, pageRows, state.tableKey, state.includeActions, start);
  return `${tableHtml}${renderPaginationControls(totalPages, page)}`;
}

function buildPaginatedTableMarkup(state) {
  return `
    <div class="paginated-table" data-pagination-table="${state.tableKey}">
      ${buildPaginatedTableInner(state)}
    </div>
  `;
}

async function hydrateRelatedCompany(record) {
  if (!record) return record;
  if (record.company_name) return record;
  const relatedType = record.related_type || record.entity_type;
  const relatedId = record.related_id ?? record.entity_id;
  if (relatedType !== "company" || !relatedId) return record;
  let companies = Array.isArray(tableRecords.companies) ? tableRecords.companies : null;
  if (!companies || !companies.length) {
    companies = await fetchCompaniesList();
  }
  const match = (companies || []).find((company) => String(company.id) === String(relatedId));
  if (match?.name) {
    record.company_name = match.name;
  }
  return record;
}

async function openPreviewModal(tableKey, record) {
  await ensureLookupTablesReady();
  if (tableKey === "tasks" || tableKey === "notes") {
    record = await hydrateRelatedCompany(record);
  }
  if (tableKey === "invoices") {
    record = await hydrateInvoiceAttachment(record);
  }
  let content = renderRecordPreview(tableKey, record);
  if (tableKey === "orders") {
    try {
      content = await renderOrderPreview(record);
    } catch (err) {
      console.warn("Order preview fell back", err);
      content = renderRecordPreview(tableKey, record);
    }
  } else if (tableKey === "quotations") {
    try {
      content = await renderQuotationPreview(record);
    } catch (err) {
      console.warn("Quotation preview fell back", err);
      content = renderRecordPreview(tableKey, record);
    }
  } else if (tableKey === "invoices") {
    try {
      content = renderInvoicePreview(record);
    } catch (err) {
      console.warn("Invoice preview fell back", err);
      content = renderRecordPreview(tableKey, record);
    }
  }
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  const canDelete = Boolean(record?.id);
  overlay.innerHTML = `
    <div class="modal modal-large">
      <div class="modal-header">
        <h3>Preview ${capitalize(tableKey)}</h3>
        <button class="btn-close" aria-label="Close">&times;</button>
      </div>
      <div class="modal-body preview-body">${content}</div>
      <div class="form-actions">
        ${tableKey === "quotations" ? `<button class="btn ghost" data-print-preview>Print</button>` : ""}
        ${canDelete ? `<button class="btn danger" data-delete>Delete</button>` : ""}
        <button class="btn" data-close>Close</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  hydratePdfPreviews(overlay).catch((err) => console.error("PDF preview failed", err));
  overlay.querySelector(".btn-close")?.addEventListener("click", () => overlay.remove());
  overlay.querySelector("[data-close]")?.addEventListener("click", () => overlay.remove());
  if (canDelete) {
    overlay.querySelector("[data-delete]")?.addEventListener("click", () => {
      overlay.remove();
      openDeleteConfirm(tableKey, record);
    });
  }
  if (tableKey === "quotations") {
    overlay.querySelector("[data-print-preview]")?.addEventListener("click", async () => {
      const items = await getQuotationItems(record.id);
      const payload = buildQuotePayloadFromRecord(record, items);
      openQuotationPrintView(payload);
    });
    const attachmentBtn = overlay.querySelector("[data-open-quote-attachment]");
    if (attachmentBtn) {
      attachmentBtn.addEventListener("click", (e) => {
        e.preventDefault();
        const url = attachmentBtn.dataset.url;
        if (!url) return;
        const mime = attachmentBtn.dataset.mime || "application/octet-stream";
        const title = attachmentBtn.dataset.title || "Attachment";
        const key = attachmentBtn.dataset.key || null;
        const slot = overlay.querySelector("[data-attachment-slot]");
        if (slot) {
          slot.innerHTML = `
            <div class="doc-preview-loader">
              <div class="spinner" aria-hidden="true"></div>
              <span>Loading attachment...</span>
            </div>
          `;
          resolveFileUrlForPreview(key || url)
            .then((resolved) => {
              const viewerUrl = resolved.url || url;
              const viewerMime = resolved.mime || mime || "application/pdf";
              slot.innerHTML = renderDocumentViewer(viewerUrl, viewerMime, title, {
                storage_key: key,
                content_type: viewerMime,
                forceIframe: false
              });
              hydratePdfPreviews(slot).catch((err) => console.error("PDF preview failed", err));
              slot.scrollIntoView({ behavior: "smooth", block: "start" });
            })
            .catch(() => {
              slot.innerHTML = renderDocumentViewer(url, mime, title, {
                storage_key: key,
                content_type: mime,
                forceIframe: false
              });
            });
        } else {
          window.open(url, "_blank", "noopener");
        }
      });
    }
  } else if (tableKey === "invoices") {
    const attachmentBtn = overlay.querySelector("[data-open-invoice-attachment]");
    if (attachmentBtn) {
      const slot = overlay.querySelector("[data-invoice-attachment-slot]");
      const loadInvoiceAttachment = () => {
        const url = attachmentBtn.dataset.url;
        if (!url) return;
        const mime = attachmentBtn.dataset.mime || "application/pdf";
        const title = attachmentBtn.dataset.title || "Attachment";
        const key = attachmentBtn.dataset.key || null;
        if (slot) {
          slot.innerHTML = `
            <div class="doc-preview-loader">
              <div class="spinner" aria-hidden="true"></div>
              <span>Loading attachment...</span>
            </div>
          `;
          resolveFileUrlForPreview(key || url)
            .then((resolved) => {
              const viewerUrl = resolved.url || url;
              const viewerMime = resolved.mime || mime || "application/pdf";
              slot.innerHTML = renderDocumentViewer(viewerUrl, viewerMime, title, {
                storage_key: key,
                content_type: viewerMime,
                forceIframe: false
              });
              hydratePdfPreviews(slot).catch((err) => console.error("PDF preview failed", err));
              slot.scrollIntoView({ behavior: "smooth", block: "start" });
            })
            .catch(() => {
              slot.innerHTML = renderDocumentViewer(url, mime, title, {
                storage_key: key,
                content_type: mime,
                forceIframe: false
              });
            });
        } else {
          window.open(url, "_blank", "noopener");
        }
      };
      attachmentBtn.addEventListener("click", (e) => {
        e.preventDefault();
        loadInvoiceAttachment();
      });
      loadInvoiceAttachment();
    }
  } else if (tableKey === "sample_shipments") {
    const docBtn = overlay.querySelector("[data-sample-doc]");
    docBtn?.addEventListener("click", async () => {
      const docId = docBtn.dataset.sampleDoc;
      if (!docId) {
        showToast("No document linked");
        return;
      }
      try {
        const doc = await fetchDocumentById(docId);
        if (!doc) {
          showToast("Document not found");
          return;
        }
        openPreviewModal("documents", doc);
      } catch (err) {
        console.error("Document preview failed", err);
        showToast("Unable to open document");
      }
    });
  } else if (tableKey === "documents") {
    const previewSlot = overlay.querySelector("[data-doc-preview]");
    const openLink = overlay.querySelector("[data-doc-open]");
    const fileKey = record?.storage_key || record?.key || record?.attachment_key || record?.attachment;
    if (!previewSlot || !fileKey) {
      openLink?.remove();
      return;
    }
    resolveFileUrlForPreview(fileKey)
      .then((resolved) => {
        if (!resolved.url) {
          previewSlot.innerHTML = renderDocumentViewer(null, record?.content_type || "", record?.title || "Document", record);
          openLink?.remove();
          return;
        }
        const mime = resolved.mime || record?.content_type || guessMimeFromKey(fileKey) || "application/octet-stream";
        previewSlot.innerHTML = renderDocumentViewer(resolved.url, mime, record?.title || "Document", record);
        hydratePdfPreviews(previewSlot).catch((err) => console.error("PDF preview failed", err));
        if (openLink) {
          openLink.href = resolved.url;
          openLink.target = "_blank";
          openLink.rel = "noopener";
        }
      })
      .catch((err) => {
        console.error("Document preview failed", err);
        previewSlot.innerHTML = renderDocumentViewer(null, record?.content_type || "", record?.title || "Document", record);
        openLink?.remove();
      });
  }
}

function renderInvoicePreview(record) {
  const currency = record.currency || "USD";
  const tone = statusToneFront(record.status || "Unpaid");
  const updated = record.updated_at ? new Date(record.updated_at).toLocaleDateString() : "";
  const company = record.company_name || record.company || "—";
  const contact = record.contact_name || record.contact || "—";
  const customer = record.customer_name || company || contact || "—";
  const dueDate = record.due_date || record.due_on || record.due || "—";
  const attachmentKey = record.attachment_key || record.attachment || record.storage_key || null;
  const attachmentUrl = attachmentKey ? getFileUrl(attachmentKey) : null;
  const attachmentTitle = attachmentKey ? (record.attachment_name || attachmentKey) : "";
  const attachmentMime =
    record.attachment_mime || record.attachment_content_type || record.content_type || guessMimeFromKey(attachmentKey);

  return `
    <div class="quote-preview-card">
      <div class="quote-preview-header">
        <div>
          <h2>${record.reference || `Invoice #${record.id}`}</h2>
          <p class="muted">${formatCurrency(record.total_amount, currency)}</p>
        </div>
        <div class="quote-badges">
          <span class="badge ${tone}">${record.status || "Unpaid"}</span>
          ${updated ? `<span class="stat-label">Updated ${updated}</span>` : ""}
          <span class="stat-label">${currency}</span>
        </div>
      </div>
      <div class="quote-meta-grid">
        <div><strong>Company</strong><span>${company}</span></div>
        <div><strong>Contact</strong><span>${contact}</span></div>
        <div><strong>Customer</strong><span>${customer}</span></div>
        <div><strong>Total</strong><span>${formatCurrency(record.total_amount, currency)}</span></div>
        <div><strong>Status</strong><span>${record.status || "Unpaid"}</span></div>
        <div><strong>Due date</strong><span>${dueDate}</span></div>
      </div>
      ${attachmentUrl ? `
        <section class="quote-attachment">
          <div class="preview-header">
            <div class="preview-title-section">
              <div class="preview-title">Attachment</div>
              <div class="preview-meta"><span class="stat-label">${attachmentTitle}</span></div>
            </div>
            <a class="btn ghost" href="#" role="button" data-open-invoice-attachment data-url="${attachmentUrl}" data-mime="${attachmentMime || ""}" data-title="${attachmentTitle}" data-key="${attachmentKey}">Preview attachment</a>
          </div>
          <div class="quote-attachment-viewer" data-invoice-attachment-slot></div>
        </section>
      ` : ""}
    </div>
  `;
}

async function hydrateInvoiceAttachment(record) {
  const invoice = { ...(record || {}) };
  if (invoice.attachment_key || invoice.attachment || invoice.storage_key) {
    return invoice;
  }
  if (!invoice.id) return invoice;
  try {
    const docs = await fetchDocumentsList();
    const match = docs.find((d) => d.invoice_id == invoice.id && d.storage_key);
    if (match) {
      invoice.attachment_key = match.storage_key;
      invoice.attachment_mime = match.content_type;
      invoice.attachment_name = match.title;
    }
  } catch (err) {
    console.debug("Invoice attachment hydrate failed", err);
  }
  return invoice;
}

function openEditModal(tableKey, record) {
  if (tableKey === "quotations") {
    openForm("quotations", { initialValues: record, mode: "edit" });
    return;
  }
  if (tableKey === "orders") {
    openForm("orders", { initialValues: record, mode: "edit" });
    return;
  }
  if (tableKey === "invoices") {
    openForm("invoices", { initialValues: record, mode: "edit" });
    return;
  }
  if (tableKey === "sample_shipments") {
    openForm("sample_shipments", { initialValues: record, mode: "edit" });
    return;
  }
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  const isQuotation = tableKey === "quotations";
  const fields = Object.entries(record || {}).filter(
    ([key]) => !["id", "created_at", "updated_at", "company_name", "contact_name", "product_name"].includes(key)
  );
  const formFields = fields
    .map(
      ([key, val]) => {
        if (isQuotation && key === "attachment_key") {
          return `
            <label>
              <span>Attachment (choose document)</span>
              <select name="attachment_key" data-edit-attachment>
                <option value="">-- Select document --</option>
              </select>
            </label>
          `;
        }
        return `
          <label>
            <span>${capitalize(key)}</span>
            <input name="${key}" value="${val ?? ""}" />
          </label>
        `;
      }
    )
    .join("");

  overlay.innerHTML = `
    <div class="modal modal-large">
      <div class="modal-header">
        <h3>Edit ${capitalize(tableKey)}</h3>
        <button class="btn-close" aria-label="Close">&times;</button>
      </div>
      <form class="form-grid">
        ${formFields || "<div class='empty'>No editable fields</div>"}
        <div class="form-actions">
          <button type="button" class="btn" data-close>Cancel</button>
          <button type="submit" class="btn primary">Save</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.querySelector(".btn-close")?.addEventListener("click", () => overlay.remove());
  overlay.querySelector("[data-close]")?.addEventListener("click", () => overlay.remove());

  if (isQuotation) {
    const attachmentSelect = overlay.querySelector('select[name="attachment_key"][data-edit-attachment]');
    if (attachmentSelect) {
      fetchDocumentsList().then((docs) => {
        attachmentSelect.innerHTML =
          `<option value="">-- Select document --</option>` +
          docs
            .filter((d) => d.storage_key)
            .map((d) => `<option value="${d.storage_key}">${d.title || d.storage_key}</option>`)
            .join("");
        if (record.attachment_key) {
          attachmentSelect.value = record.attachment_key;
        }
      });
    }
  }

  const form = overlay.querySelector("form");

  if (record && form) {
    Object.entries(record).forEach(([name, val]) => {
      const field = form.querySelector(`[name="${name}"]`);
      if (!field || field.type === "file") return;
      if (field.tagName === "SELECT") {
        field.value = val ?? "";
      } else {
        field.value = val ?? "";
      }
    });
  }
  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const formData = new FormData(form);
    const payload = Object.fromEntries(formData.entries());
    try {
      await updateRecord(tableKey, record.id, payload);
      showToast("Updated");
      overlay.remove();
      renderSection(currentSection);
    } catch (err) {
      console.error(err);
      showToast("Update failed");
    }
  });
}

function openDeleteConfirm(tableKey, record) {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal">
      <div class="modal-header">
        <h3>Delete ${capitalize(tableKey)}</h3>
        <button class="btn-close" aria-label="Close">&times;</button>
      </div>
      <div class="modal-body">Are you sure you want to delete this record?</div>
      <div class="form-actions">
        <button class="btn" data-close>Cancel</button>
        <button class="btn danger" data-confirm>Delete</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.querySelector(".btn-close")?.addEventListener("click", () => overlay.remove());
  overlay.querySelector("[data-close]")?.addEventListener("click", () => overlay.remove());
  overlay.querySelector("[data-confirm]")?.addEventListener("click", async () => {
    try {
      await deleteRecord(tableKey, record.id);
      showToast("Deleted");
      overlay.remove();
      renderSection(currentSection);
    } catch (err) {
      console.error(err);
      const message = err instanceof Error && err.message ? err.message : "Delete failed";
      showToast(message);
    }
  });
}

async function updateRecord(table, id, payload) {
  if (!id) throw new Error("Missing id");
  const res = await apiFetch(`/api/${table}/${id}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || "Update failed");
  }
  cacheBypassTables.add(table);
  return res.json().catch(() => ({}));
}

async function deleteRecord(table, id) {
  if (!id) throw new Error("Missing id");
  const res = await apiFetch(`/api/${table}/${id}`, { method: "DELETE" });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || "Delete failed");
  }
  cacheBypassTables.add(table);
  return res.json().catch(() => ({}));
}

function renderRecordPreview(tableKey, record) {
  if (!record) return "<div class='empty'>No data</div>";
  if (tableKey === "documents") {
    return renderDocumentPreview(record);
  }
  if (tableKey === "sample_shipments") {
    return renderSampleShipmentPreview(record);
  }

  // Enhanced title generation based on entity type
  let title = "";
  let subtitle = "";
  let relatedInfo = "";

  switch (tableKey) {
    case "companies":
      title = record.name || `Company #${record.id}`;
      subtitle = record.owner ? `Owner: ${record.owner}` : "";
      break;
    case "contacts":
      title = `${record.first_name || ""} ${record.last_name || ""}`.trim() || `Contact #${record.id}`;
      subtitle = record.role || "";
      if (record.company_name) {
        relatedInfo = `Company: ${record.company_name}`;
      }
      break;
    case "orders":
      title = record.reference || `Order #${record.id}`;
      subtitle = formatCurrency(record.total_amount, record.currency);
      if (record.company_name) {
        relatedInfo = `Company: ${record.company_name}`;
      }
      if (record.contact_name) {
        relatedInfo += relatedInfo ? ` | Contact: ${record.contact_name}` : `Contact: ${record.contact_name}`;
      }
      break;
    case "quotations":
      title = record.reference || `Quotation #${record.id}`;
      subtitle = record.title || formatCurrency(record.amount, record.currency);
      if (record.company_name) {
        relatedInfo = `Company: ${record.company_name}`;
      }
      if (record.contact_name) {
        relatedInfo += relatedInfo ? ` | Contact: ${record.contact_name}` : `Contact: ${record.contact_name}`;
      }
      break;
    case "invoices":
      title = record.reference || `Invoice #${record.id}`;
      subtitle = formatCurrency(record.total_amount, record.currency);
      if (record.company_name) {
        relatedInfo = `Company: ${record.company_name}`;
      }
      if (record.contact_name) {
        relatedInfo += relatedInfo ? ` | Contact: ${record.contact_name}` : `Contact: ${record.contact_name}`;
      }
      break;
    case "products":
      title = record.name || `Product #${record.id}`;
      subtitle = record.sku ? `SKU: ${record.sku}` : formatCurrency(record.price, record.currency);
      break;
    case "tasks":
      title = record.title || `Task #${record.id}`;
      subtitle = record.assignee ? `Assignee: ${record.assignee}` : "";
      if (record.related_type && record.related_id) {
        if (record.related_type === "company" && record.company_name) {
          relatedInfo = `Company: ${record.company_name}`;
        } else {
          relatedInfo = `Related: ${record.related_type} #${record.related_id}`;
        }
      }
      break;
    case "notes":
      title = record.body || `Note #${record.id}`;
      subtitle = record.author ? `Author: ${record.author}` : "";
      if (record.entity_type && record.entity_id) {
        if (record.entity_type === "company" && record.company_name) {
          relatedInfo = `Company: ${record.company_name}`;
        } else {
          relatedInfo = `Related: ${record.entity_type} #${record.entity_id}`;
        }
      }
      break;
    case "sample_shipments":
      title = record.waybill_number || `Sample #${record.id}`;
      subtitle = record.courier ? `Courier: ${record.courier}` : "";
      if (record.company_name) {
        relatedInfo = record.company_name;
      }
      if (record.product_name) {
        relatedInfo += relatedInfo ? ` | ${record.product_name}` : record.product_name;
      }
      break;
    default:
      title = record.name || record.title || record.reference || `${capitalize(tableKey)} #${record.id || ""}`;
      subtitle = "";
  }

  const tone = statusToneFront(record.status || "");
  const statusBadge = record.status ? `<span class="badge ${tone}">${record.status}</span>` : "";
  const updatedMeta = record.updated_at ? `<span class="stat-label">Updated ${formatPreviewValue(record.updated_at, "updated_at", record)}</span>` : "";

  // Enhanced field display with better formatting
  const ignore = new Set(["id", "created_at", "updated_at", "company_id", "contact_id", "product_id"]);
  if (tableKey === "orders") {
    ["created_at", "updated_at"].forEach((key) => ignore.delete(key));
    ["quotation_id", "invoice_id", "invoice_ids", "invoice_links"].forEach((key) => ignore.add(key));
  }
  if (tableKey === "invoices") {
    ["company_name", "contact_name", "customer_name"].forEach((k) => ignore.add(k));
  }
  const orderedKeys = orderPreviewKeys(Object.keys(record).filter((k) => !ignore.has(k)));
  const rows = orderedKeys
    .map(
      (key) => {
        const value = formatPreviewValue(record[key], key, record);
        const label = formatPreviewLabel(key, record);
        return `
          <div class="preview-row">
            <div class="preview-label">${label}</div>
            <div class="preview-value">${value}</div>
          </div>
        `;
      }
    )
    .join("");

  return `
    <div class="preview-card">
      <div class="preview-header">
        <div class="preview-title-section">
          <div class="preview-title">${title}</div>
          ${subtitle ? `<div class="preview-subtitle">${subtitle}</div>` : ""}
          ${relatedInfo ? `<div class="preview-related">${relatedInfo}</div>` : ""}
          <div class="preview-meta">${statusBadge} ${updatedMeta}</div>
        </div>
      </div>
      <div class="preview-grid">
        ${rows}
      </div>
    </div>
  `;
}

function renderDocumentPreview(record) {
  const title = record.title || `Document #${record.id || ""}`;
  const mime = (record.content_type || "").toLowerCase();
  const fileKey = record.storage_key || record.key || record.attachment_key || record.attachment;
  const hasFile = Boolean(fileKey);
  const sizeLabel = record.size || record.size === 0 ? formatSize(record.size) : "Unknown size";
  const updatedLabel = record.updated_at ? new Date(record.updated_at).toLocaleString() : "Not available";
  const linked = resolveDocumentLink(record);
  const docTypeName = record.doc_type_id ? getDocTypeName(record.doc_type_id) : "";
  const storageKey = record.storage_key || record.key || "Not provided";

  const metaRows = [
    ...(linked ? [["Linked To", linked]] : []),
    ...(docTypeName ? [["Document Type", docTypeName]] : []),
    ["Content Type", mime || "File"],
    ["Size", sizeLabel],
    ["Updated", updatedLabel],
    ["Storage Key", storageKey]
  ];

  const metaGrid = metaRows
    .map(
      ([label, value]) => `
          <div class="preview-row">
            <div class="preview-label">${label}</div>
            <div class="preview-value">${value}</div>
          </div>
        `
    )
    .join("");

  return `
    <div class="preview-card document-preview">
      <div class="preview-header">
        <div class="preview-title-section">
          <div class="preview-title">${title}</div>
          ${linked ? `<div class="preview-related">${linked}</div>` : ""}
          <div class="preview-meta">
            ${docTypeName ? `<span class="badge info">${docTypeName}</span>` : ""}
            <span class="stat-label">${mime || "File"}</span>
            <span class="stat-label">${sizeLabel}</span>
          </div>
        </div>
        ${hasFile ? `<a class="btn ghost" href="#" data-doc-open>Open in new tab</a>` : ""}
      </div>
      ${
        hasFile
          ? `<div class="doc-preview-media" data-doc-preview>
              <div class="doc-preview-loader">
                <div class="spinner" aria-hidden="true"></div>
                <span>Loading document preview...</span>
              </div>
            </div>`
          : renderDocumentViewer(null, mime, title, record)
      }
      <div class="preview-grid">
        ${metaGrid}
      </div>
    </div>
  `;
}

function renderSampleShipmentPreview(record) {
  const title = record.waybill_number || `Sample #${record.id || ""}`;
  const subtitle = record.courier ? `Courier: ${record.courier}` : "";
  const statusBadge = record.status ? `<span class="badge ${statusToneFront(record.status)}">${record.status}</span>` : "";
  const updatedMeta = record.updated_at ? `<span class="stat-label">Updated ${formatPreviewValue(record.updated_at, "updated_at", record)}</span>` : "";

  const companyLabel = record.company_name || (record.company_id ? `Company #${record.company_id}` : "Company");
  const productLabel = record.product_name || (record.product_id ? `Product #${record.product_id}` : "Product");
  const documentLabel = record.document_title || (record.document_id ? `Document #${record.document_id}` : "");

  const fields = [
    ["Company", companyLabel || "—"],
    ["Product", productLabel || "—"],
    ["Document ID", record.document_id ?? "—"],
    ["Document Title", documentLabel || "—"],
    ["Quantity", record.quantity ?? "—"],
    ["Receiving Address", record.receiving_address || "—"],
    ["Phone", record.phone || "—"],
    ["Waybill Number", record.waybill_number || "—"],
    ["Courier", record.courier || "—"],
    ["Status", record.status || "—"],
    ["Notes", record.notes || "—"]
  ];

  const rows = fields
    .map(
      ([label, value]) => `
        <div class="preview-row">
          <div class="preview-label">${label}</div>
          <div class="preview-value">${value}</div>
        </div>
      `
    )
    .join("");

  const chips = [companyLabel, productLabel, documentLabel].filter(Boolean);
  const chipRow = chips.length
    ? `<div class="preview-chips">${chips.map((c) => `<span class="badge secondary">${c}</span>`).join("")}</div>`
    : "";

  const docAction =
    record.document_id && documentLabel
      ? `<div class="preview-actions"><button class="btn ghost" type="button" data-sample-doc="${record.document_id}">Open Document</button></div>`
      : "";

  return `
    <div class="preview-card">
      <div class="preview-header">
        <div class="preview-title-section">
          <div class="preview-title">${title}</div>
          ${subtitle ? `<div class="preview-subtitle">${subtitle}</div>` : ""}
          ${chipRow}
          ${docAction}
          <div class="preview-meta">
            ${statusBadge}
            ${updatedMeta}
          </div>
        </div>
      </div>
      <div class="preview-grid">
        ${rows}
      </div>
    </div>
  `;
}

function renderDocumentViewer(fileUrl, mime, title, record) {
  if (!fileUrl) {
    return `<div class="doc-preview-fallback">No stored file for this record.</div>`;
  }
  const forceIframe = Boolean(record?.forceIframe);
  const pdfClass = forceIframe ? "doc-preview-media pdf embed" : "doc-preview-media pdf";
  if (mime && mime.startsWith("image/")) {
    return `
      <div class="doc-preview-media image">
        <img src="${fileUrl}" alt="Document preview" loading="lazy" />
      </div>
    `;
  }
  if (isPdfType(mime, title, record?.storage_key || record?.key, fileUrl)) {
    if (forceIframe) {
      return `
        <div class="${pdfClass}">
          <iframe class="doc-preview-frame full" src="${fileUrl}#toolbar=1&view=FitH" title="PDF preview"></iframe>
        </div>
      `;
    }
    return `
      <div class="${pdfClass}" data-pdf-src="${fileUrl}">
        <div class="doc-preview-loader">
          <div class="spinner" aria-hidden="true"></div>
          <span>Loading PDF preview...</span>
        </div>
        <canvas class="pdf-canvas" aria-label="PDF preview"></canvas>
        <div class="doc-preview-fallback">
          <div class="doc-fallback-message">Unable to render preview.</div>
          <a class="btn ghost" href="${fileUrl}" target="_blank" rel="noopener">Open in new tab</a>
        </div>
      </div>
    `;
  }
  return `
    <div class="doc-preview-fallback">
      <div>Preview not available for this file type.</div>
      <a class="btn primary" href="${fileUrl}" target="_blank" rel="noopener">Download</a>
    </div>
  `;
}

function isPdfType(mime, title, storageKey, fileUrl) {
  const lowerMime = (mime || "").toLowerCase();
  const lowerTitle = (title || "").toLowerCase();
  const lowerKey = (storageKey || "").toLowerCase();
  const lowerUrl = (fileUrl || "").toLowerCase();
  return (
    lowerMime.includes("pdf") ||
    lowerTitle.endsWith(".pdf") ||
    lowerKey.endsWith(".pdf") ||
    lowerUrl.includes(".pdf")
  );
}

function isImageType(mime, name, url) {
  const lowerMime = (mime || "").toLowerCase();
  const lowerName = (name || "").toLowerCase();
  const lowerUrl = (url || "").toLowerCase();
  return (
    lowerMime.startsWith("image/") ||
    /\.(png|jpe?g|gif|bmp|webp)$/i.test(lowerName) ||
    /\.(png|jpe?g|gif|bmp|webp)$/i.test(lowerUrl)
  );
}

function computeQuoteLineTotal(item) {
  const qty = Number(item.qty) || 0;
  const unit = Number(item.unit_price) || 0;
  const drums = Number(item.drums_price) || 0;
  const bank = Number(item.bank_charge_price) || 0;
  const shipping = Number(item.shipping_price) || 0;
  const commission = Number(item.customer_commission) || 0;
  return qty * (unit + drums + bank + shipping + commission);
}

function resolveQuoteLineTotal(item) {
  const raw = item?.line_total;
  if (raw !== null && raw !== undefined && raw !== "" && !Number.isNaN(Number(raw))) {
    return Number(raw);
  }
  return computeQuoteLineTotal(item || {});
}

async function resolveOrderInvoiceInfo(orderId, record) {
  const labels = new Set();
  const invoiceIds = new Set();
  const dates = new Set();

  const addReference = (value) => {
    const trimmed = String(value || "").trim();
    if (trimmed) labels.add(trimmed);
  };
  const addInvoiceId = (value) => {
    const trimmed = String(value || "").trim();
    if (trimmed) invoiceIds.add(trimmed);
  };

  if (record?.invoice_reference) {
    String(record.invoice_reference)
      .split(",")
      .forEach((val) => addReference(val));
  }
  const rawInvoiceLinks = record?.invoice_ids ?? record?.invoice_links ?? record?.invoices;
  if (rawInvoiceLinks) {
    if (Array.isArray(rawInvoiceLinks)) {
      rawInvoiceLinks.forEach((val) => addInvoiceId(val));
    } else if (typeof rawInvoiceLinks === "string") {
      let parsed = null;
      try {
        parsed = JSON.parse(rawInvoiceLinks);
      } catch {
        parsed = null;
      }
      if (Array.isArray(parsed)) {
        parsed.forEach((val) => addInvoiceId(val));
      } else {
        rawInvoiceLinks
          .split(",")
          .map((val) => val.trim())
          .filter(Boolean)
          .forEach((val) => addInvoiceId(val));
      }
    } else {
      addInvoiceId(rawInvoiceLinks);
    }
  }
  if (record?.invoice_id) {
    addInvoiceId(record.invoice_id);
  }

  if (orderId) {
    let schedules = tableRecords.shipping_schedules;
    if (!Array.isArray(schedules) || !schedules.length) {
      const fetched = await fetchShippingSchedulesList();
      if (fetched.length) {
        tableRecords.shipping_schedules = fetched;
        schedules = fetched;
      }
    }
    if (Array.isArray(schedules)) {
      schedules
        .filter((row) => String(row.order_id) === String(orderId))
        .forEach((row) => {
          if (row.invoice_reference) {
            addReference(row.invoice_reference);
          }
          if (row.invoice_id) {
            addInvoiceId(row.invoice_id);
          }
        });
    }
  }

  if (invoiceIds.size) {
    const invoiceList = Array.isArray(tableRecords.invoices) && tableRecords.invoices.length
      ? tableRecords.invoices
      : await fetchInvoicesList();
    invoiceIds.forEach((id) => {
      const match = invoiceList.find((inv) => String(inv.id) === String(id));
      if (match?.reference) {
        labels.add(match.reference);
      } else {
        labels.add(`INV-${id}`);
      }
      const dateValue = match?.created_at || match?.invoice_date || match?.issue_date || match?.due_date;
      if (dateValue) dates.add(dateValue);
    });
  }

  return {
    labels: Array.from(labels).filter(Boolean),
    dates: Array.from(dates).filter(Boolean)
  };
}

async function renderOrderPreview(record) {
  const baseRecord = { ...(record || {}) };
  const invoiceInfo = await resolveOrderInvoiceInfo(baseRecord.id, baseRecord);
  if (invoiceInfo.labels.length) {
    baseRecord.invoice_reference = invoiceInfo.labels.join(", ");
  }
  if (invoiceInfo.dates.length) {
    baseRecord.invoice_date = invoiceInfo.dates[0];
  }
  const quoteKeyCandidates = [
    record.quotation_id,
    record.quote_id,
    record.quotationId,
    record.quotation,
    record.quote
  ]
    .map((val) => (val === null || val === undefined ? "" : String(val).trim()))
    .filter(Boolean);
  const orderRef = (record.reference || "").trim();
  const quotationList = await fetchQuotationsList();
  let matchedQuote = null;
  let quotationId = quoteKeyCandidates[0] || null;

  if (quotationId) {
    matchedQuote = quotationList.find((q) => String(q.id) === String(quotationId)) || null;
  }
  if (!quotationId && orderRef) {
    const normalizedRef = orderRef.toLowerCase();
    matchedQuote = quotationList.find((q) => (q.reference || "").toLowerCase() === normalizedRef) || null;
    quotationId = matchedQuote?.id ? String(matchedQuote.id) : null;
  }
  if (matchedQuote) {
    baseRecord.quotation_reference = matchedQuote.reference || matchedQuote.title || `Quotation #${quotationId}`;
  }

  if (!quotationId) {
    const base = renderRecordPreview("orders", baseRecord);
    return `
      <div class="preview-stack">
        ${base}
        <div class="preview-card">
          <div class="preview-header">
            <div class="preview-title-section">
              <div class="preview-title">Quotation line items</div>
              <div class="preview-subtitle">No linked quotation found for this order.</div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  const items = await getQuotationItems(quotationId);
  if (!items.length) {
    const base = renderRecordPreview("orders", baseRecord);
    return `
      <div class="preview-stack">
        ${base}
        <div class="preview-card">
          <div class="preview-header">
            <div class="preview-title-section">
              <div class="preview-title">Quotation line items</div>
              <div class="preview-subtitle">No line items found for the linked quotation.</div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  const currency = (record.currency || matchedQuote?.currency || "USD").toUpperCase();
  const taxRate = parsePercent(matchedQuote?.tax_rate);
  const lineTotals = [];
  const lineRows = items
    .map((item) => {
      const qty = Number(item.qty) || 0;
      const unit = Number(item.unit_price) || 0;
      const drum = Number(item.drums_price) || 0;
      const bank = Number(item.bank_charge_price) || 0;
      const ship = Number(item.shipping_price) || 0;
      const commission = Number(item.customer_commission) || 0;
      const lineTotal = resolveQuoteLineTotal(item);
      lineTotals.push({ line_total: lineTotal });
      const productName = item.product_name || (item.product_id ? `Product #${item.product_id}` : "Item");
      return `
        <tr>
          <td>${sanitizeText(productName)}</td>
          <td>${qty}</td>
          <td>${formatCurrency(unit, currency)}</td>
          <td>${formatCurrency(drum, currency)}</td>
          <td>${formatCurrency(bank, currency)}</td>
          <td>${formatCurrency(ship, currency)}</td>
          <td>${formatCurrency(commission, currency)}</td>
          <td>${formatCurrency(lineTotal, currency)}</td>
        </tr>
      `;
    })
    .join("");
  const totals = calculateQuoteTotals(lineTotals, taxRate);
  const computedTotal = Number(totals.total) || 0;
  if (!Number(baseRecord.total_amount)) {
    baseRecord.total_amount = computedTotal;
  }
  baseRecord.currency = currency;
  const quoteLabel = matchedQuote?.reference || matchedQuote?.title || `Quotation #${quotationId}`;
  const base = renderRecordPreview("orders", baseRecord);

  return `
    <div class="preview-stack">
      ${base}
      <div class="preview-card">
        <div class="preview-header">
          <div class="preview-title-section">
            <div class="preview-title">Quotation line items</div>
            <div class="preview-subtitle">${sanitizeText(quoteLabel)}</div>
          </div>
        </div>
        <div class="quote-line-table">
          <table>
            <thead>
              <tr>
                <th>Product</th>
                <th>Qty</th>
                <th>Unit price</th>
                <th>Drums price</th>
                <th>Bank charge</th>
                <th>Shipping</th>
                <th>Commission</th>
                <th>Line total</th>
              </tr>
            </thead>
            <tbody>${lineRows}</tbody>
          </table>
        </div>
        <div class="quote-summary order-quote-summary">
          <div>
            <span>Subtotal</span>
            <strong>${formatCurrency(totals.subtotal || 0, currency)}</strong>
          </div>
          <div>
            <span>Tax ${taxRate ? `(${taxRate}%)` : ""}</span>
            <strong>${formatCurrency(totals.tax || 0, currency)}</strong>
          </div>
          <div>
            <span>Total</span>
            <strong>${formatCurrency(totals.total || 0, currency)}</strong>
          </div>
        </div>
      </div>
    </div>
  `;
}

async function renderQuotationPreview(record) {
  const items = await getQuotationItems(record.id);
  const currency = record.currency || "USD";
  const statusTone = statusToneFront(record.status || "Draft");
  const subtotal = items.reduce((sum, item) => sum + resolveQuoteLineTotal(item), 0);
  const taxRate = parsePercent(record.tax_rate);
  const tax = subtotal * (taxRate / 100);
  const total = subtotal + tax;
  let bankMethod = record.bank_charge_method || "";
  if (!bankMethod && record.notes) {
    const match = String(record.notes).match(/bank charge method:\s*(.+)/i);
    if (match && match[1]) {
      bankMethod = match[1].trim();
    }
  }
  const bankMethodLabel = bankMethod || "Not specified";
  const attachmentKey = record.attachment_key || record.attachment || record.storage_key || null;
  const attachmentUrl = attachmentKey ? getFileUrl(attachmentKey) : null;
  const attachmentTitle = record.attachment_name || record.attachment || record.attachment_key || "Attachment";
  const attachmentMime =
    record.attachment_mime || record.attachment_content_type || record.content_type || guessMimeFromKey(attachmentKey);
  const attachmentBlock = attachmentUrl
    ? `
      <section class="quote-attachment">
        <div class="preview-header">
          <div class="preview-title-section">
            <div class="preview-title">Attachment</div>
            <div class="preview-meta"><span class="stat-label">${attachmentTitle}</span></div>
          </div>
          <a class="btn ghost" href="#" role="button" data-open-quote-attachment data-url="${attachmentUrl}" data-mime="${attachmentMime || ""}" data-title="${attachmentTitle}" data-key="${attachmentKey}">Open attachment</a>
        </div>
        <div class="quote-attachment-viewer" data-attachment-slot></div>
      </section>
    `
    : "";

  const lineRows = items.length
    ? items
        .map((item) => {
          const qty = Number(item.qty) || 0;
          const unit = Number(item.unit_price) || 0;
          const drum = Number(item.drums_price) || 0;
          const bank = Number(item.bank_charge_price) || 0;
          const ship = Number(item.shipping_price) || 0;
          const commission = Number(item.customer_commission) || 0;
          const lineTotal = resolveQuoteLineTotal(item);
          return `
            <tr>
              <td>${item.product_name || item.product_id || "Item"}</td>
              <td>${qty}</td>
              <td>${formatCurrency(unit, currency)}</td>
              <td>${formatCurrency(drum, currency)}</td>
              <td>${formatCurrency(bank, currency)}</td>
              <td>${formatCurrency(ship, currency)}</td>
              <td>${formatCurrency(commission, currency)}</td>
              <td>${formatCurrency(lineTotal, currency)}</td>
            </tr>
          `;
        })
        .join("")
    : `<tr><td colspan="8" class="empty-row">No line items on this quotation.</td></tr>`;

  let tagList = resolveTagList(record.tags);
  if (!tagList.length && Array.isArray(tableRecords.quotations)) {
    const cached = tableRecords.quotations.find((row) => row.id === record.id);
    tagList = resolveTagList(cached?.tags);
  }
  const tagText = tagList.length ? tagList.join(", ") : "None";
  const notesText = record.notes ? sanitizeText(record.notes) : "No additional notes provided.";
  const validUntil = record.valid_until ? record.valid_until : "—";

  return `
    <div class="quote-preview-card">
      <div class="quote-preview-header">
        <div>
          <h2>${record.reference || `Quotation #${record.id}`}</h2>
          <p class="muted">${record.title || "Untitled"} · ${record.status || "Draft"}</p>
        </div>
        <div class="quote-badges">
          <span class="badge ${statusTone}">${record.status || "Draft"}</span>
          <span class="stat-label">Valid until ${validUntil}</span>
          <span class="stat-label">${currency}</span>
        </div>
      </div>
      <div class="quote-meta-grid">
        <div><strong>Company</strong><span>${record.company_name || "—"}</span></div>
        <div><strong>Contact</strong><span>${record.contact_name || "—"}</span></div>
        <div><strong>Customer</strong><span>${record.customer_name || record.company_name || record.contact_name || "—"}</span></div>
        <div><strong>Bank charge</strong><span>${bankMethodLabel}</span></div>
        <div><strong>Tax rate</strong><span>${record.tax_rate ? `${record.tax_rate}%` : "—"}</span></div>
      </div>
      <section class="quote-line-table">
        <table>
          <thead>
            <tr>
              <th>Product</th>
              <th>Qty</th>
              <th>Unit</th>
              <th>Drums</th>
              <th>Bank</th>
              <th>Shipping</th>
              <th>Commission</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>${lineRows}</tbody>
        </table>
      </section>
      <div class="quote-summary-print">
        <div>
          <span>Subtotal</span>
          <strong>${formatCurrency(subtotal, currency)}</strong>
        </div>
        <div>
          <span>Tax ${taxRate ? `(${taxRate}%)` : ""}</span>
          <strong>${formatCurrency(tax, currency)}</strong>
        </div>
        <div>
          <span>Total</span>
          <strong>${formatCurrency(total || record.amount || 0, currency)}</strong>
        </div>
      </div>
      <section class="quote-notes-print">
        <p style="margin:0 0 6px;font-weight:600;color:#0f172a;">Notes & terms</p>
        <p style="margin:0 0 10px;">${notesText}</p>
        <p style="margin:0;font-weight:600;color:#0f172a;">Bank charge method</p>
        <p style="margin:0 0 10px;color:#475569;">${bankMethodLabel}</p>
        <p style="margin:0;font-weight:600;color:#0f172a;">Tags</p>
        <p style="margin:0;color:#475569;">${tagText}</p>
      </section>
      ${attachmentBlock}
    </div>
  `;
}

function buildQuotePayloadFromRecord(record, items) {
  const currency = record.currency || "USD";
  const taxRate = parsePercent(record.tax_rate);
  const totals = calculateQuoteTotals(
    items.map((item) => ({
      line_total: resolveQuoteLineTotal(item)
    })),
    taxRate
  );

  return {
    reference: record.reference || "",
    title: record.title || "",
    status: record.status || "",
    valid_until: record.valid_until || "",
    company: record.company_name || "",
    contact: record.contact_name || "",
    customer: record.customer_name || record.company_name || record.contact_name || "",
    currency,
    tax_rate: taxRate,
    bank_charge_method: record.bank_charge_method || "",
    notes: record.notes || "",
    items: items || [],
    totals,
    tags: resolveTagList(record.tags)
  };
}

let quotationItemsPromise = null;
async function loadQuotationItems() {
  try {
    const res = await apiFetch("/api/quotation_items");
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.rows)) {
        tableRecords.quotation_items = data.rows;
        return data.rows;
      }
    }
  } catch (err) {
    console.debug("Unable to load quotation items", err);
  }
  tableRecords.quotation_items = tableRecords.quotation_items || [];
  return tableRecords.quotation_items;
}

async function getQuotationItems(quotationId) {
  if (!quotationItemsPromise) {
    quotationItemsPromise = loadQuotationItems();
  }
  await quotationItemsPromise;
  return (tableRecords.quotation_items || []).filter((item) => item.quotation_id == quotationId);
}

function sanitizeText(text) {
  if (!text) return "";
  return String(text).replace(/[<>&]/g, (ch) => {
    if (ch === "<") return "&lt;";
    if (ch === ">") return "&gt;";
    if (ch === "&") return "&amp;";
    return ch;
  });
}

let pdfjsLoaderPromise = null;

async function ensurePdfJs() {
  if (!pdfjsLoaderPromise) {
    pdfjsLoaderPromise = import("/vendor/pdfjs/pdf.min.mjs")
      .then((mod) => {
        if (mod?.GlobalWorkerOptions) {
          const workerUrl = new URL("/vendor/pdfjs/pdf.worker.min.mjs", window.location.href).toString();
          mod.GlobalWorkerOptions.workerSrc = workerUrl;
          try {
            mod.GlobalWorkerOptions.workerPort = new Worker(workerUrl, { type: "module" });
          } catch (err) {
            console.warn("PDF worker setup failed, falling back to workerSrc only", err);
            mod.GlobalWorkerOptions.workerSrc = workerUrl;
            mod.GlobalWorkerOptions.disableWorker = true;
          }
        }
        return mod;
      })
      .catch((err) => {
        pdfjsLoaderPromise = null;
        throw err;
      });
  }
  return pdfjsLoaderPromise;
}

async function hydratePdfPreviews(root = document) {
  const targets = root.querySelectorAll("[data-pdf-src]");
  if (!targets.length) return;

  let pdfjs;
  try {
    pdfjs = await ensurePdfJs();
  } catch (err) {
    console.error("Failed to load pdfjs-dist", err);
    targets.forEach((el) => markPdfFailed(el, "Unable to load PDF renderer."));
    return;
  }

  targets.forEach((container) => {
    const alreadyRendered = container.dataset.rendered === "true" || container.dataset.rendered === "error";
    if (!alreadyRendered) {
      renderPdfPreview(container, pdfjs);
    }
  });
}

async function renderPdfPreview(container, pdfjs) {
  if (!container) return;
  const url = container.dataset.pdfSrc;
  if (!url) return;

  const canvas = container.querySelector("canvas");
  const fallback = container.querySelector(".doc-preview-fallback");
  container.classList.remove("failed", "rendered");

  try {
    const loadingTask = pdfjs.getDocument(url);
    const pdf = await loadingTask.promise;
    const page = await pdf.getPage(1);
    const baseViewport = page.getViewport({ scale: 1 });
    const containerWidth = container.clientWidth || baseViewport.width;
    const maxHeight = Math.max(320, Math.min(window.innerHeight * 0.8, baseViewport.height));
    const scaleForWidth = containerWidth / baseViewport.width;
    const scaleForHeight = maxHeight / baseViewport.height;
    const scale = Math.min(1.6, Math.max(0.6, Math.min(scaleForWidth, scaleForHeight)));
    const cssViewport = page.getViewport({ scale });
    const outputScale = window.devicePixelRatio || 1;
    const ctx = canvas?.getContext("2d");
    if (!ctx) throw new Error("PDF canvas context unavailable");
    canvas.width = cssViewport.width * outputScale;
    canvas.height = cssViewport.height * outputScale;
    canvas.style.width = `${cssViewport.width}px`;
    canvas.style.height = `${cssViewport.height}px`;
    const renderContext = {
      canvasContext: ctx,
      viewport: cssViewport,
      transform: outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : undefined
    };
    await page.render(renderContext).promise;
    container.classList.add("rendered");
    container.dataset.rendered = "true";
  } catch (err) {
    console.error("Failed to render PDF preview", err);
    markPdfFailed(container, "Unable to render PDF preview.");
    if (fallback && url) {
      const link = fallback.querySelector("a");
      if (link) {
        link.href = url;
      }
    }
  }
}

function markPdfFailed(container, message) {
  if (!container) return;
  container.classList.add("failed");
  container.dataset.rendered = "error";
  const msg = container.querySelector(".doc-fallback-message");
  if (msg && message) {
    msg.textContent = message;
  }
  const fallback = container.querySelector(".doc-preview-fallback");
  const url = container.dataset.pdfSrc;
  if (fallback && url && !fallback.querySelector(".doc-preview-frame")) {
    const iframe = document.createElement("iframe");
    iframe.className = "doc-preview-frame";
    iframe.src = `${url}#toolbar=1&navpanes=0`;
    iframe.title = "Document preview";
    iframe.loading = "lazy";
    fallback.prepend(iframe);
  }
}

function resolveDocumentLink(record) {
  const parts = [];
  if (record.company_name) {
    parts.push(record.company_name);
  }
  if (record.contact_name) {
    parts.push(record.contact_name);
  }
  if (record.invoice_id) {
    parts.push(`Invoice #${record.invoice_id}`);
  }
  return parts.join(" | ");
}

function getDocTypeName(docTypeId) {
  if (!docTypeId) return "";
  const list = tableRecords.doc_types || fallback.doc_types || [];
  const match = list.find((t) => t.id == docTypeId);
  if (match && match.name) return match.name;
  return `Type #${docTypeId}`;
}

function getDocumentUrl(record) {
  if (!record) return null;
  const key = record.storage_key || record.key || record.attachment_key || record.attachment;
  if (!key) return null;
  return getFileUrl(key);
}

function getFileUrl(key) {
  if (!key) return null;
  return `/api/files/${normalizeFileKey(key)}`;
}

function normalizeFileKey(key) {
  if (!key) return "";
  let decoded = String(key);
  // Decode repeatedly to undo double-encoding (max 3 rounds to avoid infinite loop)
  for (let i = 0; i < 3; i++) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    } catch {
      break;
    }
  }
  decoded = decoded.replace(/^\/+/, ""); // strip leading slashes
  // Encode each path segment but keep slashes so the backend route sees proper folders
  const segments = decoded.split("/").map((seg) => {
    try {
      return encodeURIComponent(seg);
    } catch {
      return seg;
    }
  });
  return segments.join("/");
}

function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function buildFileUrlCandidates(keyOrUrl) {
  if (!keyOrUrl) return [];
  const raw = String(keyOrUrl);
  const isFullUrl = /^https?:\/\//i.test(raw);
  const stripApi = raw.replace(/^https?:\/\/[^/]+/i, "");
  const baseKey = stripApi.replace(/^\/?api\/files\/?/i, "");

  const variants = [raw, baseKey, safeDecode(baseKey), safeDecode(safeDecode(baseKey))].filter(Boolean);
  const urls = new Set();

  variants.forEach((variant) => {
    const cleaned = variant.replace(/^\/+/, "");
    const withSlash = cleaned.replace(/%2F/gi, "/");
    const encodedSlash = cleaned.replace(/\//g, "%2F");
    const entries = [cleaned, withSlash, encodedSlash].filter(Boolean);
    entries.forEach((entry) => {
      const encAll = encodeURIComponent(entry);
      const encUri = encodeURI(entry);
      const encodedSlashAgain = entry.replace(/\//g, "%2F");
      const paths = [entry, encAll, encUri, encodedSlashAgain];
      paths.forEach((p) => {
        const finalPath = p.replace(/^\/+/, "");
        urls.add(isFullUrl ? finalPath : `/api/files/${finalPath}`);
      });
    });
  });

  return Array.from(urls);
}

async function resolveFileUrlForPreview(keyOrUrl) {
  const candidates = buildFileUrlCandidates(keyOrUrl);
  for (const candidate of candidates) {
    try {
      const res = await apiFetch(candidate, { method: "GET" });
      const ct = (res.headers.get("content-type") || "").toLowerCase();
      const isHtml = ct.includes("text/html");
      if (res.ok && !isHtml) {
        const blob = await res.blob();
        if (!blob || blob.size === 0) continue;
        const objectUrl = URL.createObjectURL(blob);
        const mime = ct.split(";")[0] || blob.type || "";
        return { url: objectUrl, mime };
      }
    } catch (err) {
      console.debug("File candidate failed", candidate, err);
    }
  }
  const fallback = candidates[0] || null;
  if (!fallback) return { url: null, mime: "" };
  try {
    const parsed = new URL(fallback, window.location.origin);
    if (parsed.origin === window.location.origin && parsed.pathname.startsWith("/api/")) {
      return { url: null, mime: "" };
    }
  } catch {}
  return { url: fallback, mime: "" };
}

async function checkFileExists(url) {
  if (!url) return false;
  try {
    const res = await apiFetch(url, { method: 'HEAD' });
    return res.ok;
  } catch {
    return false;
  }
}

function guessMimeFromKey(key) {
  if (!key) return "";
  const lower = key.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".webp")) return "image/webp";
  return "";
}

async function openAttachmentPreview(record) {
  const attachmentKey = record?.attachment_key || record?.attachment || record?.key;
  if (!attachmentKey) {
    showToast("No attachment on this record");
    return;
  }
  const resolved = await resolveFileUrlForPreview(attachmentKey);
  if (!resolved.url) {
    showToast("Attachment missing");
    return;
  }
  const mime = resolved.mime || record.attachment_mime || record.content_type || guessMimeFromKey(attachmentKey) || "";
  const title = record.title || record.reference || attachmentKey || "Attachment";
  const body = renderDocumentViewer(resolved.url, mime || "application/octet-stream", title, {
    storage_key: attachmentKey,
    content_type: mime || "application/octet-stream",
    forceIframe: true
  });
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal modal-large">
      <div class="modal-header">
        <h3>Attachment</h3>
        <button class="btn-close" aria-label="Close">&times;</button>
      </div>
      <div class="modal-body preview-body">${body}</div>
      <div class="form-actions">
        <a class="btn ghost" href="${resolved.url}" target="_blank" rel="noopener">Open in new tab</a>
        <button class="btn" data-close>Close</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  hydratePdfPreviews(overlay).catch((err) => console.error("PDF preview failed", err));
  overlay.querySelector(".btn-close")?.addEventListener("click", () => overlay.remove());
  overlay.querySelector("[data-close]")?.addEventListener("click", () => overlay.remove());
}

function formatPreviewValue(val, key, record) {
  if (val === null || val === undefined || val === "") return "<span class='stat-label'>—</span>";
  if (Array.isArray(val)) return val.map((v) => `<span class="badge secondary">${v}</span>`).join(" ");
  if (key === "tags" && typeof val === "string") {
    const parts = val
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
    if (parts.length) {
      return parts.map((v) => `<span class="badge secondary">${v}</span>`).join(" ");
    }
  }
  if (
    ["total_amount", "amount", "price", "unit_price", "drums_price", "bank_charge_price", "shipping_price", "customer_commission", "line_total"].includes(key) &&
    record?.currency
  ) {
    return formatCurrency(Number(val) || 0, record.currency);
  }
  if (typeof val === "number") return val.toLocaleString();
  
  // Enhanced date formatting
  if (typeof val === "string") {
    const isIsoDateTime = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(val);
    const isSimpleDate = /^\d{4}-\d{2}-\d{2}/.test(val);
    const hasIsoTime = /T\d{2}:\d{2}/.test(val);
    if (isIsoDateTime || isSimpleDate || hasIsoTime) {
      const parsed = new Date(val);
      if (!Number.isNaN(parsed.getTime())) {
        return isSimpleDate && !isIsoDateTime && !hasIsoTime
          ? parsed.toLocaleDateString()
          : parsed.toLocaleString();
      }
    }
  }
  
  // Handle related entity display
  if (key === "related_id" && record.related_type && val) {
    if (record.related_type === "company" && record.company_name) {
      return record.company_name;
    }
    return `${record.related_type.charAt(0).toUpperCase() + record.related_type.slice(1)} #${val}`;
  }
  if (key === "entity_id" && record.entity_type && val) {
    if (record.entity_type === "company" && record.company_name) {
      return record.company_name;
    }
    return `${record.entity_type.charAt(0).toUpperCase() + record.entity_type.slice(1)} #${val}`;
  }
  
  return String(val);
}

function formatPreviewLabel(key, record) {
  const labelMap = {
    // Company fields
    website: "Website",
    company_id: "Company",
    company_code: "Company Code",
    email: "Email Address",
    phone: "Phone Number",
    owner: "Account Owner",
    industry: "Industry",
    address: "Address",
    receiving_address: "Receiving Address",
    
    // Contact fields
    first_name: "First Name",
    last_name: "Last Name",
    role: "Job Role",
    
    // Product fields
    product_id: "Product",
    document_id: "Document",
    sku: "Product SKU",
    category: "Category",
    price: "Price",
    currency: "Currency",
    description: "Description",
    
    // Order/Invoice fields
    quotation_reference: "Quotation",
    invoice_reference: "Invoice #",
    invoice_id: "Invoice #",
    invoice_date: "Invoice Date",
    total_amount: "Total Amount",
    reference: "Reference Number",
    due_date: "Due Date",
    valid_until: "Valid Until",
    
    // Task fields
    assignee: "Assigned To",
    due_date: "Due Date",
    related_type: "Related Type",
    related_id: "Related ID",
    entity_type: "Related Type",
    entity_id: "Related ID",
    
    // Logistics
    waybill_number: "Waybill Number",
    courier: "Courier",
    
    // Common fields
    tags: "Tags",
    status: "Status",
    notes: "Notes",
    created_at: "Created",
    updated_at: "Last Updated"
  };

  if (key === "related_id" && record.related_type === "company") {
    return "Company";
  }
  if (key === "entity_id" && record.entity_type === "company") {
    return "Company";
  }
  
  return labelMap[key] || capitalize(key.replace(/_/g, " "));
}

function orderPreviewKeys(keys) {
  const priority = [
    "reference",
    "quotation_reference",
    "invoice_reference",
    "invoice_date",
    "invoice_id",
    "name",
    "title",
    "status",
    "company_name",
    "contact_name",
    "product_name",
    "tags",
    "price",
    "amount",
    "total_amount",
    "currency",
    "category",
    "role",
    "email",
    "phone",
    "notes",
    "description",
    "id"
  ];
  return [...keys].sort((a, b) => {
    const ai = priority.indexOf(a);
    const bi = priority.indexOf(b);
    if (ai !== -1 && bi !== -1) return ai - bi;
    if (ai !== -1) return -1;
    if (bi !== -1) return 1;
    return a.localeCompare(b);
  });
}

function statusToneFront(status) {
  const s = (status || "").toLowerCase();
  if (s.includes("paid") || s.includes("completed") || s.includes("active")) return "success";
  if (s.includes("overdue") || s.includes("pending") || s.includes("draft")) return "warning";
  return "info";
}

function attachFormHandlers() {
  document.querySelectorAll("[data-form]").forEach((btn) => {
    btn.onclick = () => openForm(btn.dataset.form);
  });
}

sectionContent.addEventListener("click", (e) => {
  const pageBtn = e.target.closest("[data-page]");
  if (!pageBtn) return;
  const wrapper = pageBtn.closest("[data-pagination-table]");
  const tableKey = wrapper?.dataset.paginationTable || "";
  const state = paginationState.get(tableKey);
  if (!state || !wrapper) return;
  const totalPages = Math.max(1, Math.ceil(state.rows.length / state.pageSize));
  if (pageBtn.dataset.page === "prev" && state.currentPage > 1) {
    state.currentPage -= 1;
  }
  if (pageBtn.dataset.page === "next" && state.currentPage < totalPages) {
    state.currentPage += 1;
  }
  wrapper.innerHTML = buildPaginatedTableInner(state);
});

sectionContent.addEventListener("click", (e) => {
  const actionBtn = e.target.closest("[data-action]");
  if (!actionBtn) return;
  const action = actionBtn.dataset.action;
  const recordActions = new Set(["preview", "edit", "delete"]);
  if (!recordActions.has(action)) return;
  const tableKey = actionBtn.dataset.entity || actionBtn.closest("table")?.dataset.table || "";
  const rowIndex = actionBtn.dataset.rowIndex ?? actionBtn.closest("tr")?.dataset.rowIndex;
  const idx = Number(rowIndex);
  const record = Number.isFinite(idx) && tableRecords[tableKey] ? tableRecords[tableKey][idx] : null;
  if (!tableKey || !record) return;
  if (action === "preview") {
    openPreviewModal(tableKey, record).catch((err) => {
      console.error(err);
      showToast("Unable to load preview");
    });
  } else if (action === "edit") {
    openEditModal(tableKey, record);
  } else if (action === "delete") {
    openDeleteConfirm(tableKey, record);
  }
});

function openForm(key, options = {}) {
  const { initialValues = null, mode = "create" } = options;
  const config = formConfigs[key];
  if (!config) {
    showToast("Form not configured yet");
    return;
  }

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal">
      <div class="modal-header">
        <h3>${mode === "edit" ? `Edit ${capitalize(key)}` : config.title}</h3>
        <button class="btn-close" aria-label="Close">&times;</button>
      </div>
      <form class="form-grid">
        ${config.fields
          .map((field) => {
            const base = `name="${field.name}" ${field.required ? "required" : ""} placeholder="${field.placeholder || ""}" ${field.disabled ? "disabled" : ""}`;
            const selectOptions =
              field.name === "bank_charge_method" ? getBankChargeOptions() : Array.isArray(field.options) ? field.options : [];
    if (field.type === "select") {
              return `
                <label>
                  <span>${field.label}</span>
                  <select ${base} ${field.multiple ? "multiple" : ""}>
                    ${selectOptions.map((opt) => `<option value="${opt === "-- Select option --" ? "" : opt}">${opt}</option>`).join("")}
                  </select>
                </label>
              `;
            }
            if (field.type === "textarea") {
              return `
                <label>
                  <span>${field.label}</span>
                  <textarea ${base}></textarea>
                </label>
              `;
            }
              return `
                <label>
                  <span>${field.label}</span>
                  <input ${base} ${field.multiple ? "multiple" : ""} type="${field.type || "text"}" ${field.step ? `step="${field.step}"` : ""} ${field.disabled ? "disabled" : ""}/>
                </label>
              `;
          })
          .join("")}
        <div class="form-actions">
          <button type="button" class="btn" data-close>Cancel</button>
          <button type="submit" class="btn primary">Save</button>
        </div>
      </form>
    </div>
  `;

  document.body.appendChild(overlay);
  overlay.querySelector(".btn-close")?.addEventListener("click", () => overlay.remove());
  overlay.querySelector("[data-close]")?.addEventListener("click", () => overlay.remove());

  const tagSelects = overlay.querySelectorAll('select[name="tags"]');
  if (tagSelects.length) {
    fetchRecords("tags", fallback.tags).then((tags) => {
      const options = tags.map((t) => `<option value="${t.id}">${t.name}</option>`).join("");
      tagSelects.forEach((sel) => {
        sel.setAttribute("multiple", "multiple");
        sel.innerHTML = options;
      });
    });
  }

  if (key === "notes") {
    overlay.querySelector(".modal")?.classList.add("modal-large");
    const companySelect = overlay.querySelector('select[name="company_id"]');
    if (companySelect) {
      companySelect.innerHTML = `<option value="">-- Select company --</option>`;
      fetchCompaniesList().then((companies) => {
        companySelect.innerHTML = `<option value="">-- Select company --</option>` + companies
          .map((c) => `<option value="${c.id}">${c.name}</option>`)
          .join("");
      }).catch(() => {
        companySelect.innerHTML = `<option value="">-- Select company --</option>`;
      });
    }
  }
  if (key === "contacts") {
    const companySelect = overlay.querySelector('select[name="company_id"]');
    if (companySelect) {
      companySelect.innerHTML = `<option value="">-- Select company --</option>`;
      fetchCompaniesList()
        .then((companies) => {
          companySelect.innerHTML =
            `<option value="">-- Select company --</option>` +
            companies.map((c) => `<option value="${c.id}">${c.name}</option>`).join("");
        })
        .catch(() => {
          companySelect.innerHTML = `<option value="">-- Select company --</option>`;
        });
    }
  }
  if (key === "shipping") {
    const modal = overlay.querySelector(".modal");
    modal?.classList.add("modal-large");

    const orderSelect = overlay.querySelector('select[name="order_id"]');
    const invoiceSelect = overlay.querySelector('select[name="invoice_id"]');
    const companySelect = overlay.querySelector('select[name="company_id"]');

    const updateCompany = (companyObj) => {
      if (!companySelect) return;
      if (companyObj && companyObj.id) {
        companySelect.innerHTML = `<option value="${companyObj.id}">${companyObj.name || companyObj.id}</option>`;
        companySelect.value = companyObj.id;
      } else {
        companySelect.innerHTML = `<option value="">Select an order or invoice</option>`;
      }
    };

    fetchOrdersList().then((orders) => {
      if (!orderSelect) return;
      orderSelect.innerHTML =
        `<option value="">-- Optional: select an order --</option>` +
        orders
          .map(
            (o) =>
              `<option data-company="${o.company_id || ""}" value="${o.id}">${o.reference || o.id} - ${
                o.company || "-"
              }</option>`
          )
          .join("");
    });

    fetchInvoicesList().then((invoices) => {
      if (!invoiceSelect) return;
      invoiceSelect.innerHTML =
        `<option value="">-- Optional: select an invoice --</option>` +
        invoices
          .map(
            (inv) =>
              `<option data-company="${inv.company_id || ""}" value="${inv.id}">${inv.reference || inv.id} - ${
                inv.company || "-"
              }</option>`
          )
          .join("");
    });

    orderSelect?.addEventListener("change", () => {
      const opt = orderSelect.selectedOptions[0];
      const companyId = opt?.getAttribute("data-company");
      updateCompany(companyId ? { id: companyId, name: opt.textContent?.split("-")[1]?.trim() } : null);
    });

    invoiceSelect?.addEventListener("change", () => {
      const opt = invoiceSelect.selectedOptions[0];
      const companyId = opt?.getAttribute("data-company");
      updateCompany(companyId ? { id: companyId, name: opt.textContent?.split("-")[1]?.trim() } : null);
    });
  }
  if (key === "sample_shipments") {
    overlay.querySelector(".modal")?.classList.add("modal-large");

    const isEdit = mode === "edit";
    const form = overlay.querySelector("form");
    const companySelect = overlay.querySelector('select[name="company_id"]');
    const productSelect = overlay.querySelector('select[name="product_id"]');
    const qtyInput = overlay.querySelector('input[name="quantity"]');
    const documentSelect = overlay.querySelector('select[name="document_id"]');
    const initialCompanyId = initialValues?.company_id ? String(initialValues.company_id) : "";
    const initialProductId = initialValues?.product_id ? String(initialValues.product_id) : "";
    const initialDocumentId = initialValues?.document_id ? String(initialValues.document_id) : "";
    const initialQuantity = initialValues?.quantity ?? 1;
    const setIfPresent = (selector, value) => {
      if (value === undefined || value === null) return;
      const field = overlay.querySelector(selector);
      if (!field) return;
      field.value = value;
    };

    if (companySelect) {
      const placeholder = `<option value="">-- Select company --</option>`;
      const current =
        initialCompanyId && (initialValues?.company_name || initialValues?.company)
          ? `<option value="${initialCompanyId}">${initialValues.company_name || initialValues.company}</option>`
          : "";
      companySelect.innerHTML = placeholder + current;
      fetchCompaniesList()
        .then((companies) => {
          companySelect.innerHTML =
            placeholder + companies.map((c) => `<option value="${c.id}">${c.name}</option>`).join("");
          if (initialCompanyId) {
            companySelect.value = initialCompanyId;
          }
        })
        .catch(() => {
          if (initialCompanyId) companySelect.value = initialCompanyId;
        });
    }

    // Build a multi-product selector section
    const productLabel = productSelect?.closest("label");
    const qtyLabel = qtyInput?.closest("label");
    productLabel?.remove();
    qtyLabel?.remove();

    const productSection = document.createElement("div");
    productSection.className = "sample-products-block";
    productSection.innerHTML = `
      <div class="section-heading">
        <h4>Products</h4>
        <p>Add one or multiple products to include in this sample shipment.</p>
      </div>
      <div class="sample-product-rows" data-sample-product-rows></div>
      <button type="button" class="btn ghost" data-add-sample-product ${isEdit ? 'style="display:none;"' : ""}>+ Add product</button>
    `;
    const rowsContainer = productSection.querySelector("[data-sample-product-rows]");
    const productsPromise = fetchProductsList();

    const addProductRow = (prefill) => {
      const row = document.createElement("div");
      row.className = "sample-product-row";
      row.dataset.sampleRow = "true";
      row.innerHTML = `
        <select class="sample-product-select" data-sample-product>
          <option value="">-- Select product --</option>
        </select>
        <input type="number" min="0" step="1" class="sample-product-qty" data-sample-qty value="${prefill?.quantity ?? initialQuantity ?? 1}" />
        ${isEdit ? "" : `<button type="button" class="btn danger ghost" data-remove-sample-product title="Remove product">Remove</button>`}
      `;
      rowsContainer?.appendChild(row);

      const select = row.querySelector("[data-sample-product]");
      productsPromise
        .then((products) => {
          select.innerHTML =
            `<option value="">-- Select product --</option>` +
            products.map((p) => `<option value="${p.id}">${p.name || p.sku || p.id}</option>`).join("");
          if (prefill?.product_id) {
            select.value = String(prefill.product_id);
          } else if (initialProductId && rowsContainer?.children.length === 1) {
            select.value = initialProductId;
          }
        })
        .catch(() => {});

      if (!isEdit) {
        row.querySelector("[data-remove-sample-product]")?.addEventListener("click", () => {
          if (rowsContainer && rowsContainer.children.length > 1) {
            row.remove();
          }
        });
      }
    };

    addProductRow(initialProductId ? { product_id: initialProductId, quantity: initialQuantity } : null);

    productSection.querySelector("[data-add-sample-product]")?.addEventListener("click", () => addProductRow());

    const addressLabel = overlay.querySelector('textarea[name="receiving_address"]')?.closest("label");
    if (addressLabel?.parentElement) {
      addressLabel.parentElement.insertBefore(productSection, addressLabel);
    } else if (form) {
      form.insertBefore(productSection, form.firstChild);
    }

    if (documentSelect) {
      documentSelect.innerHTML = `<option value="">-- Select document (optional) --</option>`;
      fetchDocumentsList()
        .then((docs) => {
          documentSelect.innerHTML =
            `<option value="">-- Select document (optional) --</option>` +
            docs.map((d) => `<option value="${d.id}">${d.title || d.storage_key || d.id}</option>`).join("");
          if (initialDocumentId) {
            documentSelect.value = initialDocumentId;
          }
        })
        .catch(() => {
          if (initialDocumentId) documentSelect.value = initialDocumentId;
        });
    }

    if (form) {
      form.getSampleLines = () => {
        const rows = Array.from(rowsContainer?.querySelectorAll("[data-sample-row]") || []);
        return rows
          .map((row) => {
            const productId = row.querySelector("[data-sample-product]")?.value;
            const qty = row.querySelector("[data-sample-qty]")?.value;
            const qtyNumber =
              qty === "" || qty === undefined || qty === null ? initialQuantity || 1 : Number(qty) || 0;
            return {
              product_id: productId ? Number(productId) : undefined,
              quantity: qtyNumber
            };
          })
          .filter((row) => row.product_id);
      };
    }

    setIfPresent('textarea[name="receiving_address"]', initialValues?.receiving_address);
    setIfPresent('input[name="phone"]', initialValues?.phone);
    setIfPresent('input[name="waybill_number"]', initialValues?.waybill_number);
    setIfPresent('select[name="courier"]', initialValues?.courier);
    setIfPresent('select[name="status"]', initialValues?.status);
    setIfPresent('textarea[name="notes"]', initialValues?.notes);
    setIfPresent('select[name="document_id"]', initialDocumentId);
  }
  if (key === "tasks") {
    const relatedTypeSelect = overlay.querySelector('select[name="related_type"]');
    const companySelect = overlay.querySelector('select[name="related_company_id"]');
    const relatedIdInput = overlay.querySelector('input[name="related_id"]');
    const companyLabel = companySelect?.closest("label");
    const relatedIdLabel = relatedIdInput?.closest("label");

    const updateVisibility = () => {
      const isCompany = relatedTypeSelect?.value === "company";
      if (companyLabel) companyLabel.style.display = isCompany ? "" : "none";
      if (relatedIdLabel) relatedIdLabel.style.display = isCompany ? "none" : "";
      if (relatedIdInput && isCompany) relatedIdInput.value = "";
    };

    relatedTypeSelect?.addEventListener("change", updateVisibility);
    updateVisibility();

    if (companySelect) {
      companySelect.innerHTML = `<option value="">-- Select company --</option>`;
      fetchCompaniesList()
        .then((companies) => {
          companySelect.innerHTML =
            `<option value="">-- Select company --</option>` +
            companies.map((c) => `<option value="${c.id}">${c.name}</option>`).join("");
        })
        .catch(() => {
          companySelect.innerHTML = `<option value="">-- Select company --</option>`;
        });
    }
  }
  if (key === "invoices") {
    const modal = overlay.querySelector(".modal");
    modal?.classList.add("modal-large");

    const currencyInput = overlay.querySelector('input[name="currency"]');
    if (currencyInput && !currencyInput.value) currencyInput.value = initialValues?.currency || "USD";

    const statusSelect = overlay.querySelector('select[name="status"]');
    if (statusSelect && statusSelect.options.length === 0) {
      statusSelect.innerHTML =
        `<option value="Unpaid">Unpaid</option><option value="Open">Open</option><option value="Paid">Paid</option>` +
        `<option value="Overdue">Overdue</option><option value="Factory exit">Factory exit</option>` +
        `<option value="Dispatched">Dispatched</option><option value="Cut Off">Cut Off</option>` +
        `<option value="Shipped">Shipped</option><option value="Delivered">Delivered</option>`;
    }
    if (statusSelect && initialValues?.status) {
      statusSelect.value = initialValues.status;
    }

    const companySelect = overlay.querySelector('select[name="company_id"]');
    const contactSelect = overlay.querySelector('select[name="contact_id"]');
    const customerInput = overlay.querySelector('input[name="customer_name"]');
    const attachmentSelect = overlay.querySelector('select[name="attachment_key"]');
    const referenceInput = overlay.querySelector('input[name="reference"]');
    const totalInput = overlay.querySelector('input[name="total_amount"]');

    if (initialValues) {
      if (referenceInput && initialValues.reference) referenceInput.value = initialValues.reference;
      if (totalInput && initialValues.total_amount !== undefined && totalInput.value === "") {
        totalInput.value = initialValues.total_amount;
      }
      if (customerInput && initialValues.customer_name) {
        customerInput.value = initialValues.customer_name;
      }
    }

    const setCustomer = () => {
      const contactName = contactSelect?.selectedOptions[0]?.textContent;
      const companyName = companySelect?.selectedOptions[0]?.textContent;
      if (customerInput) {
        customerInput.value = contactName || companyName || customerInput.value || "";
      }
    };

    fetchCompaniesList().then((companies) => {
      if (!companySelect) return;
      companySelect.innerHTML = `<option value="">-- Select company (optional) --</option>` + companies.map((c) => `<option value="${c.id}">${c.name}</option>`).join("");
      companySelect.addEventListener("change", setCustomer);
      if (initialValues?.company_id) {
        companySelect.value = String(initialValues.company_id);
        setCustomer();
      }
    });
    fetchContactsList().then((contacts) => {
      if (!contactSelect) return;
      contactSelect.innerHTML =
        `<option value="">-- Select contact (optional) --</option>` + contacts.map((c) => `<option value="${c.id}">${c.name}</option>`).join("");
      contactSelect.addEventListener("change", setCustomer);
      if (initialValues?.contact_id) {
        contactSelect.value = String(initialValues.contact_id);
        setCustomer();
      }
    });
    if (attachmentSelect) {
      const form = overlay.querySelector("form");
      const attachmentLabel = attachmentSelect.closest("label");
      const attachmentSelectId =
        attachmentSelect.id || `invoice-attachment-${Math.random().toString(36).slice(2, 8)}`;
      attachmentSelect.id = attachmentSelectId;
      attachmentSelect.setAttribute("aria-label", "Choose document (optional) for this invoice");

      const docSearchInput = document.createElement("input");
      docSearchInput.type = "search";
      docSearchInput.autocomplete = "off";
      docSearchInput.placeholder = "Search documents by title or storage key";
      docSearchInput.id = `${attachmentSelectId}-search`;
      docSearchInput.className = "document-search-input";
      docSearchInput.setAttribute("aria-controls", attachmentSelectId);
      docSearchInput.setAttribute("aria-label", "Search documents for the invoice");

      const docSearchLabel = document.createElement("label");
      docSearchLabel.className = "document-search-field";
      docSearchLabel.innerHTML = "<span>Search documents</span>";
      docSearchLabel.appendChild(docSearchInput);

      const insertParent = attachmentLabel?.parentElement || form;
      if (insertParent) {
        insertParent.insertBefore(docSearchLabel, attachmentLabel ?? null);
      } else {
        form?.appendChild(docSearchLabel);
      }

      const attachmentHint = document.createElement("small");
      attachmentHint.id = `${attachmentSelectId}-hint`;
      attachmentHint.className = "field-hint";
      attachmentHint.textContent = "Filter the document list before selecting an attachment.";
      attachmentSelect.setAttribute("aria-describedby", attachmentHint.id);
      if (insertParent) {
        insertParent.insertBefore(attachmentHint, attachmentLabel?.nextSibling || null);
      }

      let attachmentDocsCache = [];
      let selectedAttachmentKey = initialValues?.attachment_key || "";

      const formatDocumentLabel = (doc) => (doc.title || doc.storage_key || `Document #${doc.id || ""}`).trim();

      const renderDocumentOptions = (docs) => {
        const optionHtml = docs
          .map((doc) => `<option value="${doc.storage_key}">${formatDocumentLabel(doc)}</option>`)
          .join("");
        let supplemental = "";
        if (
          selectedAttachmentKey &&
          !docs.some((doc) => doc.storage_key === selectedAttachmentKey)
        ) {
          const selectedDoc = attachmentDocsCache.find((doc) => doc.storage_key === selectedAttachmentKey);
          if (selectedDoc) {
            supplemental = `<option value="${selectedDoc.storage_key}">${formatDocumentLabel(selectedDoc)} (selected)</option>`;
          }
        }
        if (!docs.length) {
          supplemental += `<option value="" disabled>— No matching documents —</option>`;
        }
        attachmentSelect.innerHTML = `<option value="">-- Select document --</option>${optionHtml}${supplemental}`;
        if (selectedAttachmentKey && attachmentSelect.querySelector(`option[value="${selectedAttachmentKey}"]`)) {
          attachmentSelect.value = selectedAttachmentKey;
        }
      };

      renderDocumentOptions([]);

      const applyDocumentFilter = () => {
        const query = docSearchInput.value.trim().toLowerCase();
        const matches = query
          ? attachmentDocsCache.filter((doc) => {
              const searchable = `${doc.title || ""} ${doc.storage_key || ""}`.toLowerCase();
              return searchable.includes(query);
            })
          : attachmentDocsCache;
        renderDocumentOptions(matches);
      };

      docSearchInput.addEventListener("input", applyDocumentFilter);

      attachmentSelect.addEventListener("change", () => {
        selectedAttachmentKey = attachmentSelect.value;
      });

      fetchDocumentsList()
        .then((docs) => {
          attachmentDocsCache = docs.filter((doc) => doc.storage_key);
          applyDocumentFilter();
        })
        .catch(() => {
          renderDocumentOptions([]);
        });
    }
  }
  if (key === "orders") {
    const modal = overlay.querySelector(".modal");
    modal?.classList.add("modal-large");

    const form = overlay.querySelector("form");
    if (!form) return;

    form.classList.add("order-form");

    const labels = {};
    form.querySelectorAll("label").forEach((label) => {
      const field = label.querySelector("input, select, textarea");
      if (field?.name) {
        labels[field.name] = label;
      }
    });

    const actions = form.querySelector(".form-actions");
    form.innerHTML = "";

    const metaRow = document.createElement("div");
    metaRow.className = "order-row order-row--three";
    ["order_title", "currency", "status"].forEach((name) => {
      if (labels[name]) metaRow.appendChild(labels[name]);
    });

    const partyRow = document.createElement("div");
    partyRow.className = "order-row order-row--two";
    ["company_id", "contact_id"].forEach((name) => {
      if (labels[name]) partyRow.appendChild(labels[name]);
    });

    const quoteSection = document.createElement("div");
    quoteSection.className = "order-section";
    if (labels.quotation_id) quoteSection.appendChild(labels.quotation_id);
    const quoteHint = document.createElement("small");
    quoteHint.className = "field-hint";
    quoteHint.textContent = "Link the order back to a quote.";
    quoteSection.appendChild(quoteHint);

    const quoteLinesSection = document.createElement("div");
    quoteLinesSection.className = "order-quote-lines";
    quoteLinesSection.innerHTML = `
      <div class="section-heading">
        <h4>Quotation line items</h4>
        <p>Review the line items pulled from the selected quotation.</p>
      </div>
      <div class="order-quote-lines-body" data-order-quote-lines>
        <div class="empty">Select a quotation to see line items.</div>
      </div>
    `;

    const invoiceSection = document.createElement("div");
    invoiceSection.className = "order-section";
    if (labels.invoice_links) invoiceSection.appendChild(labels.invoice_links);
    const invoiceHint = document.createElement("small");
    invoiceHint.className = "field-hint";
    invoiceHint.textContent = "Hold Ctrl (Cmd on Mac) to select multiple invoices.";
    invoiceSection.appendChild(invoiceHint);

    const tagSection = document.createElement("div");
    tagSection.className = "order-section";
    if (labels.tags) tagSection.appendChild(labels.tags);
    const tagHint = document.createElement("small");
    tagHint.className = "field-hint";
    tagHint.textContent = "Use Ctrl/Cmd + click to assign multiple tags.";
    tagSection.appendChild(tagHint);

    form.append(metaRow, partyRow, quoteSection, quoteLinesSection, invoiceSection, tagSection, actions);

    const orderTitleInput = overlay.querySelector('input[name="order_title"]');
    if (orderTitleInput && !orderTitleInput.value) {
      orderTitleInput.value = initialValues?.order_title || initialValues?.reference || "";
    }

    const currencyInput = overlay.querySelector('input[name="currency"]');
    if (currencyInput && !currencyInput.value) currencyInput.value = initialValues?.currency || "USD";

    const statusSelect = overlay.querySelector('select[name="status"]');
    if (statusSelect && initialValues?.status) {
      statusSelect.value = initialValues.status;
    }

    const companySelect = overlay.querySelector('select[name="company_id"]');
    const contactSelect = overlay.querySelector('select[name="contact_id"]');
    const quotationSelect = overlay.querySelector('select[name="quotation_id"]');
    const invoiceSelect = overlay.querySelector('select[name="invoice_links"]');
    const quoteLinesBody = quoteLinesSection.querySelector("[data-order-quote-lines]");
    let quotationLookup = new Map();

    const computeLineTotal = (item) => computeQuoteLineTotal(item);

    const renderQuoteLines = async (quotationId) => {
      if (!quoteLinesBody) return;
      const id = quotationId ? String(quotationId) : "";
      if (!id) {
        quoteLinesBody.innerHTML = `<div class="empty">Select a quotation to see line items.</div>`;
        return;
      }
      quoteLinesBody.innerHTML = `<div class="empty">Loading line items...</div>`;
      let items = [];
      try {
        items = await getQuotationItems(id);
      } catch (err) {
        console.debug("Unable to load quotation line items", err);
      }
      if (!items.length) {
        quoteLinesBody.innerHTML = `<div class="empty">No line items found for this quotation.</div>`;
        return;
      }
      const quote = quotationLookup.get(id);
      const currency = (currencyInput?.value || quote?.currency || "USD").toUpperCase();
      const lineTotals = [];
      const rows = items
        .map((item) => {
          const lineTotalRaw = item.line_total;
          const lineTotal =
            lineTotalRaw !== null && lineTotalRaw !== undefined && !Number.isNaN(Number(lineTotalRaw))
              ? Number(lineTotalRaw)
              : computeLineTotal(item);
          lineTotals.push({ line_total: lineTotal });
          const productName = item.product_name || (item.product_id ? `Product #${item.product_id}` : "-");
          return `
            <tr>
              <td>${sanitizeText(productName)}</td>
              <td>${Number(item.qty) || 0}</td>
              <td>${formatCurrency(Number(item.unit_price) || 0, currency)}</td>
              <td>${formatCurrency(Number(item.drums_price) || 0, currency)}</td>
              <td>${formatCurrency(Number(item.bank_charge_price) || 0, currency)}</td>
              <td>${formatCurrency(Number(item.shipping_price) || 0, currency)}</td>
              <td>${formatCurrency(Number(item.customer_commission) || 0, currency)}</td>
              <td>${formatCurrency(lineTotal || 0, currency)}</td>
            </tr>
          `;
        })
        .join("");

      const totals = calculateQuoteTotals(lineTotals, parsePercent(quote?.tax_rate));

      quoteLinesBody.innerHTML = `
        <div class="quote-line-table">
          <table>
            <thead>
              <tr>
                <th>Product</th>
                <th>Qty</th>
                <th>Unit price</th>
                <th>Drums price</th>
                <th>Bank charge</th>
                <th>Shipping</th>
                <th>Commission</th>
                <th>Line total</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
        <div class="quote-summary order-quote-summary">
          <div>
            <span>Subtotal</span>
            <strong>${formatCurrency(totals.subtotal || 0, currency)}</strong>
          </div>
          <div>
            <span>Tax estimate</span>
            <strong>${formatCurrency(totals.tax || 0, currency)}</strong>
          </div>
          <div>
            <span>Total</span>
            <strong>${formatCurrency(totals.total || 0, currency)}</strong>
          </div>
        </div>
      `;
    };

    if (companySelect && initialValues?.company_id && (initialValues?.company_name || initialValues?.company)) {
      companySelect.innerHTML =
        `<option value="">-- Select company (optional) --</option>` +
        `<option value="${initialValues.company_id}">${initialValues.company_name || initialValues.company}</option>`;
      companySelect.value = String(initialValues.company_id);
    }

    if (contactSelect && initialValues?.contact_id && (initialValues?.contact_name || initialValues?.contact)) {
      contactSelect.innerHTML =
        `<option value="">-- Select contact (optional) --</option>` +
        `<option value="${initialValues.contact_id}">${initialValues.contact_name || initialValues.contact}</option>`;
      contactSelect.value = String(initialValues.contact_id);
    }

    fetchCompaniesList().then((companies) => {
      if (!companySelect) return;
      companySelect.innerHTML = `<option value="">-- Select company (optional) --</option>` + companies.map((c) => `<option value="${c.id}">${c.name}</option>`).join("");
      if (initialValues?.company_id) {
        companySelect.value = String(initialValues.company_id);
      }
    });
    fetchContactsList().then((contacts) => {
      if (!contactSelect) return;
      contactSelect.innerHTML =
        `<option value="">-- Select contact (optional) --</option>` +
        contacts.map((c) => `<option value="${c.id}">${c.name}</option>`).join("");
      if (initialValues?.contact_id) {
        contactSelect.value = String(initialValues.contact_id);
      }
    });
    fetchQuotationsList().then((quotes) => {
      if (!quotationSelect) return;
      quotationLookup = new Map(quotes.map((quote) => [String(quote.id), quote]));
      quotationSelect.innerHTML =
        `<option value="">-- Select quotation --</option>` +
        quotes.map((q) => `<option value="${q.id}">${q.reference || q.title || q.id}</option>`).join("");
      if (initialValues?.quotation_id) {
        quotationSelect.value = String(initialValues.quotation_id);
        renderQuoteLines(quotationSelect.value);
      }
    });
    quotationSelect?.addEventListener("change", () => renderQuoteLines(quotationSelect.value));
    fetchInvoicesList().then((invoices) => {
      if (!invoiceSelect) return;
      const initialInvoiceLinks = (() => {
        const raw =
          initialValues?.invoice_links || initialValues?.invoice_ids || initialValues?.invoices;
        if (!raw) return [];
        if (Array.isArray(raw)) return raw.map((value) => String(value));
        if (typeof raw === "string") {
          return raw
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean);
        }
        return [];
      })();
      invoiceSelect.setAttribute("multiple", "multiple");
      invoiceSelect.innerHTML = invoices
        .map((inv) => `<option value="${inv.id}">${inv.reference || inv.id} - ${inv.company || "-"}</option>`)
        .join("");
      if (initialInvoiceLinks.length) {
        initialInvoiceLinks.forEach((id) => {
          const opt = invoiceSelect.querySelector(`option[value="${id}"]`);
          if (opt) opt.selected = true;
        });
      }
    });
  }
  if (key === "quotations") {
    const modal = overlay.querySelector(".modal");
    modal?.classList.add("modal-large");

    const form = overlay.querySelector("form");
    if (!form) return;

    form.classList.add("quote-form-enhanced");

    const labels = {};
    form.querySelectorAll("label").forEach((label) => {
      const field = label.querySelector("input, select, textarea");
      if (field?.name) {
        labels[field.name] = label;
      }
    });

    const actions = form.querySelector(".form-actions");
    form.innerHTML = "";

    const metaSection = document.createElement("div");
    metaSection.className = "quote-section quote-meta";
    ["reference", "title", "status", "valid_until"].forEach((name) => {
      if (labels[name]) metaSection.appendChild(labels[name]);
    });

    const customerSection = document.createElement("div");
    customerSection.className = "quote-section quote-customer";
    ["company_id", "company_id_manual", "contact_id", "contact_id_manual", "customer_name", "currency"].forEach((name) => {
      if (labels[name]) customerSection.appendChild(labels[name]);
    });

    const lineSection = document.createElement("div");
    lineSection.className = "quote-section quote-lines";
    lineSection.innerHTML = `
      <div class="section-heading">
        <h4>Line Items</h4>
        <p>Add products, drums, bank charge, shipping, and commission fees.</p>
      </div>
      <div class="line-items">
        <div class="line-hint">Each row contributes to the subtotal below.</div>
        <div class="line-table">
          <div class="line-row line-head">
            <span>Product</span>
            <span>Qty</span>
            <span>Unit price</span>
            <span>Drums price</span>
            <span>Bank charge</span>
            <span>Shipping</span>
            <span>Commission</span>
            <span>Line total</span>
            <span></span>
          </div>
          <div class="line-body"></div>
        </div>
        <button type="button" class="btn ghost" id="add-line">+ Add another line</button>
      </div>
    `;

    const summarySection = document.createElement("div");
    summarySection.className = "quote-summary";
    summarySection.innerHTML = `
      <div>
        <span>Subtotal</span>
        <strong data-quote-subtotal>${formatCurrency(0, "USD")}</strong>
      </div>
      <div>
        <span>Tax estimate</span>
        <strong data-quote-tax>${formatCurrency(0, "USD")}</strong>
      </div>
      <div>
        <span>Total</span>
        <strong data-quote-total>${formatCurrency(0, "USD")}</strong>
      </div>
    `;

    const notesSection = document.createElement("div");
    notesSection.className = "quote-section quote-notes";
    ["tax_rate", "bank_charge_method", "notes", "tags", "attachment_key"].forEach((name) => {
      if (labels[name]) notesSection.appendChild(labels[name]);
    });

    form.append(metaSection, customerSection, lineSection, summarySection, notesSection, actions);

    const referenceInput = form.querySelector('input[name="reference"]');
    if (referenceInput && !referenceInput.value && !initialValues?.reference) {
      referenceInput.value = `QT-${Date.now().toString().slice(-6)}`;
    }

    const companySelect = form.querySelector('select[name="company_id"]');
    const contactSelect = form.querySelector('select[name="contact_id"]');
    const currencyInput = form.querySelector('input[name="currency"]');
    const taxInput = form.querySelector('input[name="tax_rate"]');
    const bankSelect = form.querySelector('select[name="bank_charge_method"]');
    const attachmentSelect = form.querySelector('select[name="attachment_key"]');
    const customerInput = form.querySelector('input[name="customer_name"]');
    const statusSelect = form.querySelector('select[name="status"]');

    if (currencyInput && !currencyInput.value) currencyInput.value = initialValues?.currency || "USD";
    if (taxInput && initialValues?.tax_rate !== undefined) taxInput.value = initialValues.tax_rate;
    if (statusSelect && initialValues?.status) statusSelect.value = initialValues.status;
    if (bankSelect) populateBankChargeSelect(bankSelect, initialValues?.bank_charge_method);
    if (bankSelect) populateBankChargeSelect(bankSelect);
    if (attachmentSelect) {
      attachmentSelect.innerHTML = `<option value="">-- Select document --</option>`;
      fetchDocumentsList().then((docs) => {
        attachmentSelect.innerHTML =
          `<option value="">-- Select document --</option>` +
          docs
            .filter((d) => d.storage_key)
            .map((d) => `<option value="${d.storage_key}">${d.title || d.storage_key}</option>`)
            .join("");
        if (initialValues?.attachment_key) {
          attachmentSelect.value = initialValues.attachment_key;
        }
      });
    }

    const updateCustomerName = () => {
      const contactName = contactSelect?.selectedOptions[0]?.textContent;
      const companyName = companySelect?.selectedOptions[0]?.textContent;
      if (customerInput) {
        customerInput.value = contactName || companyName || customerInput.value || "";
      }
    };

    fetchCompaniesList().then((companies) => {
      if (!companySelect) return;
      companySelect.innerHTML =
        `<option value="">-- Select company --</option>` +
        companies.map((c) => `<option value="${c.id}">${c.name}</option>`).join("");
      companySelect.addEventListener("change", updateCustomerName);
      if (initialValues?.company_id) {
        companySelect.value = String(initialValues.company_id);
        updateCustomerName();
      }
    });

    fetchContactsList().then((contacts) => {
      if (!contactSelect) return;
      contactSelect.innerHTML =
        `<option value="">-- Select contact --</option>` +
        contacts.map((c) => `<option value="${c.id}">${c.name}</option>`).join("");
      contactSelect.addEventListener("change", updateCustomerName);
      if (initialValues?.contact_id) {
        contactSelect.value = String(initialValues.contact_id);
        updateCustomerName();
      }
    });

    const tagsSelect = form.querySelector('select[name="tags"]');
    if (tagsSelect) {
      tagsSelect.setAttribute("multiple", "multiple");
      fetchRecords("tags", fallback.tags).then((tags) => {
        tagsSelect.innerHTML = tags.map((t) => `<option value="${t.id}">${t.name}</option>`).join("");
        if (initialValues?.tags?.length) {
          const tagIds = Array.isArray(initialValues.tags) ? initialValues.tags.map(String) : [];
          tagIds.forEach((id) => {
            const opt = tagsSelect.querySelector(`option[value="${id}"]`);
            if (opt) opt.selected = true;
          });
        }
      });
    }

    const lineBody = lineSection.querySelector(".line-body");
    const addLineBtn = lineSection.querySelector("#add-line");
    const summaryFields = {
      subtotal: summarySection.querySelector("[data-quote-subtotal]"),
      tax: summarySection.querySelector("[data-quote-tax]"),
      total: summarySection.querySelector("[data-quote-total]")
    };

    const productsPromise = fetchProductsList();

    const readTaxRate = () => {
      if (!taxInput) return 0;
      if (Number.isFinite(taxInput.valueAsNumber)) return taxInput.valueAsNumber;
      return parsePercent(taxInput.value);
    };

    const updateSummary = () => {
      const items = gatherQuoteLineItems(form);
      const totals = calculateQuoteTotals(items, readTaxRate());
      const currency = (currencyInput?.value || "USD").toUpperCase();
      summaryFields.subtotal.textContent = formatCurrency(totals.subtotal, currency);
      summaryFields.tax.textContent = formatCurrency(totals.tax, currency);
      summaryFields.total.textContent = formatCurrency(totals.total, currency);
      return totals;
    };

    const addRow = async (prefill) => {
      const products = await productsPromise;
      const row = document.createElement("div");
      row.className = "line-row";
      row.innerHTML = `
        <select class="line-product">
          <option value="">-- Select product --</option>
          ${products.map((p) => `<option data-price="${p.price || 0}" value="${p.id}">${p.name}</option>`).join("")}
        </select>
        <input type="number" class="line-qty" min="0" step="0.01" value="1" />
        <input type="number" class="line-unit" min="0" step="0.01" value="0" />
        <input type="number" class="line-drums" min="0" step="0.01" value="0" />
        <input type="number" class="line-bank" min="0" step="0.01" value="0" />
        <input type="number" class="line-ship" min="0" step="0.01" value="0" />
        <input type="number" class="line-comm" min="0" step="0.01" value="0" />
        <input type="number" class="line-total" min="0" step="0.01" value="0" readonly />
        <button type="button" class="btn danger line-remove" title="Remove line">×</button>
      `;
      const productSelect = row.querySelector(".line-product");
      const qtyInput = row.querySelector(".line-qty");
      const unitInput = row.querySelector(".line-unit");
      const drumsInput = row.querySelector(".line-drums");
      const bankInput = row.querySelector(".line-bank");
      const shipInput = row.querySelector(".line-ship");
      const commInput = row.querySelector(".line-comm");
      const totalInput = row.querySelector(".line-total");

      const updateTotal = () => {
        const qty = Number(qtyInput.value) || 0;
        const unit = Number(unitInput.value) || 0;
        const drums = Number(drumsInput.value) || 0;
        const bank = Number(bankInput.value) || 0;
        const ship = Number(shipInput.value) || 0;
        const comm = Number(commInput.value) || 0;
        const lineTotal = computeQuoteLineTotal({
          qty,
          unit_price: unit,
          drums_price: drums,
          bank_charge_price: bank,
          shipping_price: ship,
          customer_commission: comm
        });
        totalInput.value = lineTotal.toFixed(2);
        updateSummary();
      };

      productSelect?.addEventListener("change", () => {
        const price = Number(productSelect.selectedOptions[0]?.getAttribute("data-price")) || 0;
        if (unitInput) unitInput.value = price.toFixed(2);
        updateTotal();
      });

      [qtyInput, unitInput, drumsInput, bankInput, shipInput, commInput].forEach((inp) =>
        inp?.addEventListener("input", updateTotal)
      );

      row.querySelector(".line-remove")?.addEventListener("click", () => {
        row.remove();
        updateSummary();
      });

      lineBody?.appendChild(row);
      if (prefill) {
        if (productSelect && prefill.product_id) productSelect.value = String(prefill.product_id);
        if (qtyInput) qtyInput.value = prefill.qty ?? qtyInput.value;
        if (unitInput) unitInput.value = prefill.unit_price ?? unitInput.value;
        if (drumsInput) drumsInput.value = prefill.drums_price ?? drumsInput.value;
        if (bankInput) bankInput.value = prefill.bank_charge_price ?? bankInput.value;
        if (shipInput) shipInput.value = prefill.shipping_price ?? shipInput.value;
        if (commInput) commInput.value = prefill.customer_commission ?? commInput.value;
        if (totalInput) totalInput.value = prefill.line_total ?? totalInput.value;
      }
      updateTotal();
    };

    addLineBtn?.addEventListener("click", addRow);
    if (mode === "edit" && initialValues?.id) {
      getQuotationItems(initialValues.id).then((items) => {
        lineBody.innerHTML = "";
        if (items.length) {
          items.forEach((itm) => addRow(itm));
        } else {
          addRow();
        }
      });
    } else {
      addRow();
    }

    taxInput?.addEventListener("input", updateSummary);
    taxInput?.addEventListener("change", updateSummary);
    taxInput?.addEventListener("blur", () => {
      if (!taxInput) return;
      const normalized = parsePercent(taxInput.value);
      taxInput.value = normalized ? String(normalized) : "";
      updateSummary();
    });
    currencyInput?.addEventListener("input", updateSummary);

    const submitBtn = actions?.querySelector('button[type="submit"]');
    const printBtn = document.createElement("button");
    printBtn.type = "button";
    printBtn.className = "btn ghost";
    printBtn.dataset.printQuote = "true";
    printBtn.textContent = "Preview & Print";
    if (submitBtn && actions) {
      actions.insertBefore(printBtn, submitBtn);
    }

    printBtn.addEventListener("click", () => {
      const payload = buildQuotePreviewPayload(form);
      openQuotationPrintView(payload);
    });

    form.addEventListener("submit", () => {
      const items = gatherQuoteLineItems(form);
      const totals = calculateQuoteTotals(items, Number(taxInput?.value) || 0);
      form["items"] = items;
      form["subtotal"] = totals.subtotal;
      form["grand_total"] = totals.total;
      form["total_amount"] = totals.total;
      form["amount"] = totals.total;

    });
  }
  if (key === "documents") {
    overlay.querySelector(".modal")?.classList.add("modal-large");

    const companySelect = overlay.querySelector('select[name="company_id"]');
    const invoiceSelect = overlay.querySelector('select[name="invoice_id"]');
    const docTypeSelect = overlay.querySelector('select[name="doc_type_id"]');
    const tagSelect = overlay.querySelector('select[name="tags"]');
    const fileInput = overlay.querySelector('input[name="file"]');

    // allow multiple file selection
    if (fileInput) fileInput.setAttribute("multiple", "multiple");

    fetchCompaniesList().then((companies) => {
      if (!companySelect) return;
      companySelect.innerHTML = `<option value="">-- Select company --</option>` + companies.map((c) => `<option value="${c.id}">${c.name}</option>`).join("");
    });

    fetchInvoicesList().then((invoices) => {
      if (!invoiceSelect) return;
      invoiceSelect.innerHTML =
        `<option value="">-- Select invoice --</option>` +
        invoices.map((inv) => `<option value="${inv.id}">${inv.reference || inv.id}</option>`).join("");
    });

    fetchRecords("doc_types", []).then((types) => {
      if (!docTypeSelect) return;
      docTypeSelect.innerHTML =
        `<option value="">-- Select document type --</option>` +
        types.map((t) => `<option value="${t.id}">${t.name}</option>`).join("");
    });

    const form = overlay.querySelector("form");
    if (form) {
      const originalSubmit = form.onsubmit;
      form.addEventListener("submit", () => {
        if (fileInput && fileInput.files) {
          form["fileList"] = fileInput.files;
        }
        if (tagSelect) {
          const selected = Array.from(tagSelect.selectedOptions).map((o) => o.value);
          form["tags"] = selected;
        }
      });
      form.onsubmit = originalSubmit || form.onsubmit;
    }
  }

  const form = overlay.querySelector("form");
  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    submitBtn.textContent = "Saving...";

    try {
      const formData = new FormData(form);
      const values = Object.fromEntries(formData.entries());

      if (key === "sample_shipments" && typeof form.getSampleLines === "function") {
        const lines = form.getSampleLines();
        values.sample_lines = lines;
        if (mode === "edit" && lines?.[0]) {
          values.product_id = lines[0].product_id;
          values.quantity = lines[0].quantity;
        }
      }

      if (key === "sample_shipments" && (!values.sample_lines || !values.sample_lines.length)) {
        showToast("Add at least one product");
        return;
      }

      form.querySelectorAll("select[multiple]").forEach((select) => {
        if (!select.name) return;
        values[select.name] = Array.from(select.selectedOptions).map((o) => o.value);
      });

      form.querySelectorAll('input[type="file"]').forEach((input) => {
        if (!input.name) return;
        const files = Array.from(input.files || []);
        if (input.multiple) {
          values[input.name] = files;
          if (input.name === "file") {
            values.fileList = files;
          }
        } else if (files[0]) {
          values[input.name] = files[0];
          values[`${input.name}File`] = files[0];
        }
      });

      if (form["fileList"]) {
        values.fileList = Array.from(form["fileList"]);
      }
      if (form["tags"] && values.tags === undefined) {
        values.tags = Array.isArray(form["tags"]) ? form["tags"] : [form["tags"]].filter(Boolean);
      }
      if (form["items"]) {
        values.items = form["items"];
      }
      const transformed = config.transform ? config.transform(values) : values;

      if (config.submit && mode === "create") {
        await config.submit({ ...values, ...transformed });
      } else if (mode === "edit" && initialValues?.id) {
        if (key === "quotations") {
          const items = gatherQuoteLineItems(form);
          const totals = calculateQuoteTotals(items, values.tax_rate);
          const payload = {
            reference: values.reference || initialValues.reference,
            title: values.title || "",
            status: values.status || "Draft",
            valid_until: values.valid_until || null,
            tax_rate: parsePercent(values.tax_rate),
            notes: values.notes || "",
            attachment_key: values.attachment_key || null,
            currency: values.currency || "USD",
            amount: totals.total || initialValues.amount || 0,
            company_id: num(values.company_id) || num(values.company_id_manual) || null,
            contact_id: num(values.contact_id) || num(values.contact_id_manual) || null
          };
          await updateRecord(key, initialValues.id, payload);
        } else {
          await updateRecord(key, initialValues.id, transformed);
        }
      } else {
        await submitJson(config.endpoint || `/api/${key}`, transformed);
      }

      showToast("Saved");
      overlay.remove();
      renderSection(currentSection);
    } catch (err) {
      console.error("Form submit failed", err);
      showToast("Save failed");
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "Save";
    }
  });
}

function gatherQuoteLineItems(form) {
  return Array.from(form.querySelectorAll(".line-row"))
    .map((row) => {
      const productSelect = row.querySelector(".line-product");
      if (!productSelect) return null;
      const qty = Number(row.querySelector(".line-qty")?.value) || 0;
      const unit_price = Number(row.querySelector(".line-unit")?.value) || 0;
      const drums_price = Number(row.querySelector(".line-drums")?.value) || 0;
      const bank_charge_price = Number(row.querySelector(".line-bank")?.value) || 0;
      const shipping_price = Number(row.querySelector(".line-ship")?.value) || 0;
      const customer_commission = Number(row.querySelector(".line-comm")?.value) || 0;
      const product_id = num(productSelect.value);
      let product_name = productSelect.selectedOptions[0]?.textContent?.trim() || "";
      if (product_name.toLowerCase().includes("select product")) {
        product_name = "";
      }
      const line_total = computeQuoteLineTotal({
        qty,
        unit_price,
        drums_price,
        bank_charge_price,
        shipping_price,
        customer_commission
      });
      const hasValues = Boolean(
        product_id ||
          product_name ||
          qty ||
          unit_price ||
          drums_price ||
          bank_charge_price ||
          shipping_price ||
          customer_commission
      );
      return {
        product_id,
        product_name,
        qty,
        unit_price,
        drums_price,
        bank_charge_price,
        shipping_price,
        customer_commission,
        line_total,
        hasValues
      };
    })
    .filter(Boolean)
    .filter((item) => item.hasValues)
    .map(({ hasValues, ...item }) => item);
}

function calculateQuoteTotals(items, taxRate = 0) {
  const rate = parsePercent(taxRate);
  const subtotal = items.reduce((sum, item) => sum + resolveQuoteLineTotal(item), 0);
  const tax = subtotal * (rate / 100);
  return { subtotal, tax, total: subtotal + tax };
}

function buildQuotePreviewPayload(form) {
  const formData = new FormData(form);
  const values = Object.fromEntries(formData.entries());
  form.querySelectorAll("select[multiple]").forEach((select) => {
    if (!select.name) return;
    values[select.name] = Array.from(select.selectedOptions).map((opt) => opt.value);
  });

  const items = gatherQuoteLineItems(form);
  const taxRate = parsePercent(values.tax_rate);
  const totals = calculateQuoteTotals(items, taxRate);
  const companySelect = form.querySelector('select[name="company_id"]');
  const contactSelect = form.querySelector('select[name="contact_id"]');
  const manualCompanyId = Number(values.company_id_manual) || undefined;
  const manualContactId = Number(values.contact_id_manual) || undefined;
  const currency = values.currency || "USD";
  const tagsSelect = form.querySelector('select[name="tags"]');
  const selectedTagNames = tagsSelect
    ? Array.from(tagsSelect.selectedOptions)
        .map((opt) => opt.textContent?.trim())
        .filter(Boolean)
    : [];

  return {
    reference: values.reference || "",
    title: values.title || "",
    status: values.status || "",
    valid_until: values.valid_until || "",
    company: manualCompanyId ? `Company #${manualCompanyId}` : companySelect?.selectedOptions[0]?.textContent || "",
    contact: manualContactId ? `Contact #${manualContactId}` : contactSelect?.selectedOptions[0]?.textContent || "",
    customer: values.customer_name || "",
    currency,
    tax_rate: taxRate,
    bank_charge_method: values.bank_charge_method || "",
    notes: values.notes || "",
    attachment_key: values.attachment_key || "",
    items,
    totals,
    tags: selectedTagNames.length ? selectedTagNames : resolveTagList(values.tags)
  };
}

function openQuotationPrintView(payload) {
  const currency = payload.currency || "USD";
  const format = (value) => formatCurrency(value, currency);
  const noteText = payload.notes ? payload.notes.replace(/\n/g, "<br>") : "No additional notes provided.";
  const tagText = resolveTagList(payload.tags).length ? resolveTagList(payload.tags).join(", ") : "None";
  const tableRows = payload.items.length
    ? payload.items
        .map((item) => {
          return `
            <tr>
              <td>${item.product_name || "-"}</td>
              <td>${item.qty}</td>
              <td>${format(item.unit_price)}</td>
              <td>${format(item.drums_price)}</td>
              <td>${format(item.bank_charge_price)}</td>
              <td>${format(item.shipping_price)}</td>
              <td>${format(item.customer_commission)}</td>
              <td>${format(item.line_total)}</td>
            </tr>
          `;
        })
        .join("")
    : `<tr><td colspan="8" class="empty-row">No line items added yet.</td></tr>`;

  const html = `
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>${payload.reference || "Quotation"} | Print Preview</title>
        <style>
          body {
            font-family: "Inter", system-ui, sans-serif;
            background: #f5f6fb;
            color: #0f172a;
            margin: 0;
            padding: 24px;
          }
          .quote-print-card {
            max-width: 900px;
            margin: 0 auto;
            background: #fff;
            border-radius: 16px;
            padding: 32px;
            border: 1px solid #e2e8f0;
          }
          .quote-print-header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            margin-bottom: 24px;
          }
          .quote-print-header h1 {
            margin: 0;
            font-size: 24px;
            letter-spacing: 0.02em;
          }
          .quote-meta {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
            gap: 12px;
            margin-bottom: 24px;
          }
          .quote-meta div {
            background: #f8fafc;
            padding: 12px 14px;
            border-radius: 10px;
            border: 1px solid #e2e8f0;
          }
          .quote-meta strong {
            display: block;
            font-size: 14px;
            color: #475569;
            margin-bottom: 6px;
          }
          table {
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 24px;
          }
          th, td {
            border-bottom: 1px solid #e2e8f0;
            padding: 10px 8px;
            text-align: left;
            font-size: 13px;
          }
          th {
            font-weight: 600;
            color: #0f172a;
          }
          .quote-summary-print {
            display: flex;
            justify-content: flex-end;
            gap: 20px;
            margin-bottom: 24px;
          }
          .quote-summary-print div {
            min-width: 180px;
            background: #f8fafc;
            border: 1px solid #e2e8f0;
            padding: 12px 14px;
            border-radius: 10px;
          }
          .quote-summary-print span {
            display: block;
            font-size: 13px;
            color: #475569;
          }
          .quote-summary-print strong {
            font-size: 16px;
            margin-top: 4px;
          }
          .quote-notes-print {
            background: #f8fafc;
            padding: 16px;
            border-radius: 12px;
            border: 1px solid #e2e8f0;
            font-size: 14px;
            line-height: 1.6;
          }
          .quote-footer {
            margin-top: 24px;
            font-size: 13px;
            color: #475569;
          }
          .empty-row {
            text-align: center;
            color: #94a3b8;
          }
          @media print {
            body {
              padding: 0;
              background: #fff;
            }
            .quote-print-card {
              box-shadow: none;
              border: none;
              padding: 20px 24px;
            }
          }
        </style>
      </head>
      <body>
        <div class="quote-print-card">
          <div class="quote-print-header">
            <div>
              <h1>${payload.reference || "Quotation"}</h1>
              <p style="margin:4px 0 0;font-size:14px;color:#475569;">${payload.title || "Untitled"} · ${payload.status || "Draft"}</p>
            </div>
            <div style="text-align:right;">
              <p style="margin:0;font-size:14px;color:#475569;">Valid until</p>
              <p style="margin:4px 0 0;font-size:16px;font-weight:600;">${payload.valid_until || "—"}</p>
            </div>
          </div>
          <div class="quote-meta">
            <div>
              <strong>Company</strong>
              <span>${payload.company || "—"}</span>
            </div>
            <div>
              <strong>Contact</strong>
              <span>${payload.contact || "—"}</span>
            </div>
            <div>
              <strong>Customer</strong>
              <span>${payload.customer || "—"}</span>
            </div>
            <div>
              <strong>Currency</strong>
              <span>${payload.currency}</span>
            </div>
          </div>
          <section class="quote-line-table">
            <table>
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Qty</th>
                  <th>Unit</th>
                  <th>Drums</th>
                  <th>Bank</th>
                  <th>Shipping</th>
                  <th>Commission</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                ${tableRows}
              </tbody>
            </table>
          </section>
          <div class="quote-summary-print">
            <div>
              <span>Subtotal</span>
              <strong>${format(payload.totals.subtotal)}</strong>
            </div>
            <div>
              <span>Tax (${payload.tax_rate}%)</span>
              <strong>${format(payload.totals.tax)}</strong>
            </div>
            <div>
              <span>Total</span>
              <strong>${format(payload.totals.total)}</strong>
            </div>
          </div>
          <section class="quote-notes-print">
            <p style="margin:0 0 6px;font-weight:600;color:#0f172a;">Notes & terms</p>
            <p style="margin:0 0 10px;">${noteText}</p>
            <p style="margin:0;font-weight:600;color:#0f172a;">Bank charge method</p>
            <p style="margin:0 0 10px;color:#475569;">${payload.bank_charge_method || "Not specified"}</p>
            <p style="margin:0;font-weight:600;color:#0f172a;">Tags</p>
            <p style="margin:0;color:#475569;">${tagText}</p>
          </section>
          <div class="quote-footer">
            Printed from CRM For All · ${new Date().toLocaleDateString()}
          </div>
        </div>
      </body>
    </html>
  `;

  const printWindow = window.open("", "_blank", "width=900,height=700");
  if (!printWindow) {
    showToast("Popup blocked. Enable popups to print quotes.");
    return;
  }
  printWindow.document.write(html);
  printWindow.document.close();
  printWindow.focus();
  printWindow.print();
}

async function submitJson(endpoint, payload) {
  const res = await apiFetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || res.statusText || "Request failed");
  }
  return res.json().catch(() => ({}));
}

function showToast(message) {
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.classList.add("show"), 10);
  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 200);
  }, 2200);
}

function badge(type, label) {
  const map = {
    success: "success",
    warning: "warning",
    info: "info"
  };
  const tone = map[type] || "info";
  return `<span class="pill ${tone}">${label}</span>`;
}

function formatCurrency(amount, currency = "USD") {
  if (amount == null) return "--";
  const numeric = Number(amount);
  if (!Number.isFinite(numeric)) return `$${amount}`;
  const hasFraction = Math.abs(numeric % 1) > 0.000001;
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      minimumFractionDigits: hasFraction ? 2 : 0,
      maximumFractionDigits: 2
    }).format(numeric);
  } catch {
    return `$${numeric}`;
  }
}

function formatSize(size) {
  if (!size && size !== 0) return "--";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function accentColor(label) {
  const hash = Array.from(label).reduce((acc, char) => acc + char.charCodeAt(0), 0);
  const colors = ["#2563eb", "#16a34a", "#f59e0b", "#8b5cf6", "#0ea5e9", "#ef4444"];
  return colors[hash % colors.length];
}

function soften(color) {
  return `${color}1a`;
}

function num(value) {
  if (value === undefined || value === null || value === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function parsePercent(value) {
  if (value === undefined || value === null || value === "") return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const cleaned = String(value).trim().replace("%", "").replace(",", ".");
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseCurrency(value) {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  const cleaned = String(value).trim().replace(/[^0-9.-]+/g, "");
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function resolveTagList(rawTags) {
  if (!rawTags) return [];
  const tagPool = Array.isArray(tableRecords.tags) ? tableRecords.tags : [];
  const idToName = new Map(tagPool.map((tag) => [String(tag.id), tag.name]));
  const list = Array.isArray(rawTags)
    ? rawTags
    : typeof rawTags === "string"
      ? rawTags.split(",").map((tag) => tag.trim()).filter(Boolean)
      : [];
  return list
    .map((tag) => {
      const key = String(tag);
      return idToName.get(key) || key;
    })
    .filter(Boolean);
}

function slugify(str) {
  return (str || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "document";
}

function detectDelimiter(line) {
  const commas = (line.match(/,/g) || []).length;
  const tabs = (line.match(/\t/g) || []).length;
  if (tabs > 0 && tabs >= commas) return "\t";
  if (commas > 0) return ",";
  if (/\s{2,}/.test(line)) return "whitespace";
  return ",";
}

function splitDelimitedLine(line, delimiter) {
  if (delimiter === "whitespace") {
    return line.split(/\s{2,}/);
  }
  if (delimiter !== ",") {
    const result = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
        continue;
      }
      if (ch === '"') {
        inQuotes = !inQuotes;
        continue;
      }
      if (ch === delimiter && !inQuotes) {
        result.push(current);
        current = "";
        continue;
      }
      current += ch;
    }
    result.push(current);
    return result;
  }
  return splitCsvLine(line);
}

function parseProductsCsv(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return [];
  const delimiter = detectDelimiter(lines[0]);
  const rawHeader = splitDelimitedLine(lines[0], delimiter);
  const header = rawHeader.map((h) =>
    h.replace(/^\uFEFF/, "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_")
  );
  const headerIndex = (names) => {
    for (const name of names) {
      const idx = header.indexOf(name);
      if (idx !== -1) return idx;
    }
    return -1;
  };
  const idx = {
    name: headerIndex(["name", "product", "product_name", "item", "item_name"]),
    sku: headerIndex(["sku", "product_sku", "item_sku"]),
    category: headerIndex(["category", "type"]),
    price: headerIndex(["price", "unit_price", "unit_cost", "cost", "amount"]),
    currency: headerIndex(["currency", "curr"]),
    status: headerIndex(["status", "state"]),
    description: headerIndex(["description", "details", "notes", "note"])
  };
  const hasHeader = Object.values(idx).some((value) => value >= 0);
  const fallbackIdx = {
    name: 0,
    sku: 1,
    category: 2,
    price: 3,
    currency: 4,
    status: 5,
    description: 6
  };
  const dataLines = hasHeader ? lines.slice(1) : lines;
  return dataLines.map((line) => {
    const cols = splitDelimitedLine(line, delimiter);
    const getCol = (key) => {
      const index = hasHeader ? idx[key] : fallbackIdx[key];
      return index >= 0 ? cols[index] || "" : "";
    };
    return {
      name: getCol("name"),
      sku: getCol("sku"),
      category: getCol("category"),
      price: parseCurrency(getCol("price")),
      currency: getCol("currency") || "USD",
      status: getCol("status") || "Active",
      description: getCol("description")
    };
  }).filter((p) => p.name);
}

function splitCsvLine(line) {
  const result = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"' && line[i + 1] === '"') {
      current += '"';
      i++;
      continue;
    }
    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (ch === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

function parseCompaniesCsv(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return [];
  const header = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const idx = {
    name: header.indexOf("name"),
    website: header.indexOf("website"),
    email: header.indexOf("email"),
    phone: header.indexOf("phone"),
    owner: header.indexOf("owner"),
    industry: header.indexOf("industry"),
    status: header.indexOf("status")
  };
  return lines.slice(1).map((line) => {
    const cols = splitCsvLine(line);
    return {
      name: cols[idx.name] || "",
      website: cols[idx.website] || "",
      email: cols[idx.email] || "",
      phone: cols[idx.phone] || "",
      owner: cols[idx.owner] || "",
      industry: cols[idx.industry] || "",
      status: cols[idx.status] || "Active"
    };
  }).filter((c) => c.name);
}

function parseContactsCsv(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return [];
  const header = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const idx = {
    company_name: header.indexOf("company_name"),
    company_id: header.indexOf("company_id"),
    first_name: header.indexOf("first_name"),
    last_name: header.indexOf("last_name"),
    email: header.indexOf("email"),
    phone: header.indexOf("phone"),
    role: header.indexOf("role"),
    status: header.indexOf("status")
  };
  return lines.slice(1).map((line) => {
    const cols = splitCsvLine(line);
    return {
      company_name: cols[idx.company_name] || "",
      company_id: num(cols[idx.company_id]),
      first_name: cols[idx.first_name] || "",
      last_name: cols[idx.last_name] || "",
      email: cols[idx.email] || "",
      phone: cols[idx.phone] || "",
      role: cols[idx.role] || "",
      status: cols[idx.status] || "Engaged"
    };
  }).filter((c) => c.first_name && c.last_name);
}

function attachBulkCsvHandlers({ uploadBtnId, uploadInputId, downloadBtnId, parseFn, uploadEndpoint, downloadEndpoint, section }) {
  const uploadBtn = document.getElementById(uploadBtnId);
  const uploadInput = document.getElementById(uploadInputId);
  const downloadBtn = document.getElementById(downloadBtnId);

  uploadBtn?.addEventListener("click", () => uploadInput?.click());
  uploadInput?.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const csvText = await file.text();
      const records = parseFn(csvText);
      if (!records.length) {
        showToast("No rows found in CSV");
        return;
      }
      await submitJson(uploadEndpoint, records);
      showToast(`Imported ${records.length} rows`);
      renderSection(section);
    } catch (err) {
      console.error(err);
      showToast("Import failed");
    } finally {
      if (uploadInput) uploadInput.value = "";
    }
  });

  downloadBtn?.addEventListener("click", async () => {
    try {
      const res = await apiFetch(downloadEndpoint);
      if (!res.ok) throw new Error("Download failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = downloadEndpoint.includes("contact") ? "contacts.csv" : downloadEndpoint.includes("company") ? "companies.csv" : "export.csv";
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error(err);
      showToast("Export failed");
    }
  });
}

lucide?.createIcons();
