const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'public/app.js');
let content = fs.readFileSync(filePath, 'utf8');

// Find the start and end of renderSettings function
const startMarker = 'function renderSettings() {';
const endMarker = '}';

let startIndex = content.indexOf(startMarker);
if (startIndex === -1) {
    console.error('Could not find renderSettings function');
    process.exit(1);
}

// Find the matching closing brace for the function
let braceCount = 0;
let endIndex = startIndex;
for (let i = startIndex; i < content.length; i++) {
    if (content[i] === '{') braceCount++;
    if (content[i] === '}') {
        braceCount--;
        if (braceCount === 0) {
            endIndex = i;
            break;
        }
    }
}
if (endIndex <= startIndex) {
    console.error('Could not find matching closing brace');
    process.exit(1);
}

const newFunction = `function renderSettings() {
  sectionTitle.textContent = "Settings";
  sectionContent.innerHTML = \`
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
          <button class="tab" data-tab="add-user">Add user</button>
          <button class="tab" data-tab="change-password">Change password</button>
          <button class="tab" data-tab="users-privilege">Users with privilege</button>
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
                <div class="active-theme-pill">\${siteConfigState.activeTheme}</div>
              </div>
              <label>
                <span>Site name</span>
                <input name="siteName" type="text" value="\${siteConfigState.siteName}" required />
              </label>
              <label>
                <span>Base company</span>
                <input name="baseCompany" type="text" value="\${siteConfigState.baseCompany}" placeholder="Base company name" required />
              </label>
              <label>
                <span>Region</span>
                <input name="region" type="text" value="\${siteConfigState.region}" />
              </label>
              <label>
                <span>Timezone</span>
                <input name="timezone" type="text" value="\${siteConfigState.timezone}" />
              </label>
              <label>
                <span>Theme</span>
                <input name="theme" type="text" value="\${siteConfigState.theme}" />
              </label>
              <label>
                <span>Invoice company name</span>
                <input name="invoiceName" type="text" placeholder="Company name to display on invoices" value="\${siteConfigState.invoiceName}" />
              </label>
              <label>
                <span>Invoice company address</span>
                <textarea name="invoiceAddress">\${siteConfigState.invoiceAddress}</textarea>
              </label>
              <label>
                <span>Invoice company phone</span>
                <input name="invoicePhone" type="text" placeholder="Primary invoice contact" value="\${siteConfigState.invoicePhone}" />
              </label>
              <label class="toggle-row">
                <span>Display footer on all pages</span>
                <input name="showFooter" type="checkbox" \${siteConfigState.showFooter ? "checked" : ""} />
              </label>
              <div class="form-actions">
                <button type="submit" class="btn primary gradient">Save settings</button>
              </div>
            </form>
          </div>
        </div>
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
              <label>
                <span>Role</span>
                <input name="role" type="text" placeholder="Role or team" required />
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
                <span>New Password</span>
                <input type="password" name="new" placeholder="Enter new password" autocomplete="new-password" required />
              </label>
              <p class="hint">Minimum 8 characters. Use a mix of letters, numbers, and symbols.</p>
              <label>
                <span>Confirm New Password</span>
                <input type="password" name="confirm" placeholder="Re-enter new password" autocomplete="new-password" required />
              </label>
              <div class="password-actions">
                <button type="submit" class="btn primary gradient">Update Password</button>
                <button type="button" class="btn cancel" data-action="cancel">Cancel</button>
              </div>
            </form>
          </div>
        </div>
        <div class="tab-content" id="users-privilege">
          <div class="panel privilege-panel">
            <div class="panel-header">
              <h3 class="panel-title">Users with privilege</h3>
              <div class="stat-label">Review who currently has elevated access.</div>
            </div>
            <div class="privilege-list">
              \${privilegedUsers.map((user) => renderPrivilegeItem(user)).join("")}
            </div>
          </div>
        </div>
      </div>
    </div>
  \`;

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

  passwordForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(passwordForm);
    const current = data.get("current")?.toString() || "";
    const next = data.get("new")?.toString() || "";
    const confirm = data.get("confirm")?.toString() || "";

    if (next.length < 8) {
      showToast("New password must be at least 8 characters");
      return;
    }

    if (next !== confirm) {
      showToast("New passwords do not match");
      return;
    }

    showToast("Password updated");
    passwordForm.reset();
  });

  cancelButton?.addEventListener("click", () => passwordForm?.reset());

  const addUserForm = document.getElementById("add-user-form");
  const privilegeList = document.querySelector(".privilege-panel .privilege-list");

  privilegeList?.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const action = target.dataset.action;
    if (!action) return;
    const item = target.closest(".privilege-item");
    if (!item) return;
    const nameElement = item.querySelector(".privilege-name");
    const userName = nameElement?.textContent?.trim() || "User";

    if (action === "remove-user") {
      item.remove();
      showToast(\`\${userName} removed from privileged list\`);
      return;
    }

    if (action === "reset-user") {
      const tempPassword = generateTempPassword();
      showToast(\`\${userName} password reset: \${tempPassword}\`);
      return;
    }
  });

  addUserForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(addUserForm);
    const name = data.get("name")?.toString().trim();
    const email = data.get("email")?.toString().trim();
    const role = data.get("role")?.toString().trim();
    const access = data.get("access")?.toString().trim() || "Custom access";
    const password = data.get("initialPassword")?.toString().trim();

    if (!name || !email || !role || !password) {
      showToast("Provide name, email, and role");
      return;
    }

    privilegeList?.insertAdjacentHTML("beforeend", renderPrivilegeItem({ name, role, access }));

    showToast(\`\${name} added with elevated access · initial password set\`);

    addUserForm.reset();
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

  const siteConfigForm = document.getElementById("site-config-form");
  siteConfigForm?.addEventListener("submit", (event) => {
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
    applySiteConfig();
    showToast("Site configuration saved");
  });
}`;

// Replace the old function with the new one
const before = content.substring(0, startIndex);
const after = content.substring(endIndex + 1);
const newContent = before + newFunction + after;

fs.writeFileSync(filePath, newContent, 'utf8');
console.log('Successfully replaced renderSettings function.');