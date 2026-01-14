const accountForm = document.querySelector("#account-form");
const accountLabelInput = document.querySelector("#account-label");
const accountEmailInput = document.querySelector("#account-email");
const accountIdInput = document.querySelector("#account-id");
const accountTokenInput = document.querySelector("#account-token");
const authTypeInputs = document.querySelectorAll('input[name="auth-type"]');
const tokenFields = document.querySelector('[data-auth="token"]');
const browserLoginPanel = document.querySelector('[data-auth="cloudflared"]');
const loginStatusText = document.querySelector("#login-status-text");
const loginUrlLink = document.querySelector("#login-url");
const startBrowserLoginBtn = document.querySelector("#start-browser-login");
const accountFormStatus = document.querySelector("#account-form-status");
const accountListStatus = document.querySelector("#account-list-status");
const accountList = document.querySelector("#account-list");
const refreshAccountsBtn = document.querySelector("#refresh-accounts");
const accountSelect = document.querySelector("#account-select");
const domainList = document.querySelector("#domain-list");

let loginPollTimer = null;
let activeLoginAccountId = null;
let cachedAccounts = [];

const handleUnauthorized = (response) => {
  if (response.status === 401) {
    window.location.href = "/login.html";
    return true;
  }
  return false;
};

const fetchAccounts = async () => {
  try {
    const response = await fetch("/api/cloudflare/accounts");
    if (handleUnauthorized(response)) {
      return [];
    }
    const data = await response.json();
    return data.accounts || [];
  } catch (error) {
    setAccountListStatus("Failed to load accounts.", "error");
    return [];
  }
};

const refreshCloudflaredAccounts = async (accounts) => {
  const updates = await Promise.all(
    accounts.map(async (account) => {
      if (account.authType !== "cloudflared") {
        return account;
      }
      const response = await fetch(
        `/api/cloudflare/login/status?accountId=${encodeURIComponent(account.id)}`
      );
      if (handleUnauthorized(response)) {
        return account;
      }
      if (!response.ok) {
        return account;
      }
      const data = await response.json();
      return data.account || account;
    })
  );
  return updates;
};

const fetchDomains = async (accountId) => {
  if (!accountId) {
    return [];
  }
  const response = await fetch(`/api/cloudflare/accounts/${accountId}/domains`);
  if (handleUnauthorized(response)) {
    return [];
  }
  if (!response.ok) {
    return [];
  }
  const data = await response.json();
  return data.domains || [];
};

const shouldFetchDomains = (account) =>
  account?.authType === "token" && account?.status === "connected";

const getSelectedAuthType = () =>
  Array.from(authTypeInputs).find((input) => input.checked)?.value || "token";

const setAccountFormStatus = (message, tone = "info") => {
  if (!accountFormStatus) {
    return;
  }
  accountFormStatus.textContent = message;
  if (!message) {
    accountFormStatus.style.color = "";
    return;
  }
  if (tone === "error") {
    accountFormStatus.style.color = "var(--danger)";
  } else if (tone === "success") {
    accountFormStatus.style.color = "var(--success)";
  } else {
    accountFormStatus.style.color = "";
  }
};

const setAccountListStatus = (message, tone = "info") => {
  if (!accountListStatus) {
    return;
  }
  accountListStatus.textContent = message;
  if (!message) {
    accountListStatus.style.color = "";
    return;
  }
  if (tone === "error") {
    accountListStatus.style.color = "var(--danger)";
  } else if (tone === "success") {
    accountListStatus.style.color = "var(--success)";
  } else {
    accountListStatus.style.color = "";
  }
};

const setLoginStatus = (message, url = "", tone = "info") => {
  if (loginStatusText) {
    loginStatusText.textContent = message;
    if (tone === "error") {
      loginStatusText.style.color = "var(--danger)";
    } else if (tone === "success") {
      loginStatusText.style.color = "var(--success)";
    } else {
      loginStatusText.style.color = "";
    }
  }
  if (loginUrlLink) {
    loginUrlLink.textContent = url || "";
    loginUrlLink.href = url || "#";
    loginUrlLink.style.display = url ? "inline" : "none";
  }
};

const clearLoginPoll = () => {
  if (loginPollTimer) {
    clearTimeout(loginPollTimer);
    loginPollTimer = null;
  }
};

const pollLoginStatus = async (accountId) => {
  clearLoginPoll();
  activeLoginAccountId = accountId;
  const response = await fetch(
    `/api/cloudflare/login/status?accountId=${encodeURIComponent(accountId)}`
  );
  if (handleUnauthorized(response)) {
    return;
  }
  if (!response.ok) {
    setLoginStatus("Unable to check login status.", "", "error");
    return;
  }
  const data = await response.json();
  const status = data?.login?.status || "pending";
  const loginUrl = data?.login?.loginUrl || "";
  if (status === "connected") {
    setLoginStatus("Connected", loginUrl, "success");
    await refreshAccountData();
    return;
  }
  if (status === "error") {
    setLoginStatus("Login failed. Try again.", loginUrl, "error");
    await refreshAccountData();
    return;
  }
  setLoginStatus("Waiting for browser login...", loginUrl);
  loginPollTimer = setTimeout(() => pollLoginStatus(accountId), 2500);
};

const startBrowserLogin = async (accountId) => {
  if (!accountId) {
    setAccountFormStatus("Create the account before starting login.", "error");
    return;
  }
  setAccountFormStatus("");
  setLoginStatus("Requesting login URL...");
  const response = await fetch("/api/cloudflare/login/start", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ accountId })
  });
  if (handleUnauthorized(response)) {
    return;
  }
  if (!response.ok) {
    const data = await response.json();
    setLoginStatus("Login failed to start.", "", "error");
    setAccountFormStatus(data.error || "Unable to start login.", "error");
    return;
  }
  const data = await response.json();
  const loginUrl = data?.login?.loginUrl || "";
  setLoginStatus("Waiting for browser login...", loginUrl);
  await refreshAccountData();
  await pollLoginStatus(accountId);
};

const syncAuthFields = () => {
  const authType = getSelectedAuthType();
  if (tokenFields) {
    tokenFields.style.display = authType === "token" ? "block" : "none";
  }
  if (browserLoginPanel) {
    browserLoginPanel.style.display = authType === "cloudflared" ? "block" : "none";
  }
  if (accountTokenInput) {
    accountTokenInput.required = authType === "token";
  }
};

const renderDomainList = (domains) => {
  if (!domains.length) {
    domainList.textContent = "No domains added yet.";
    return;
  }
  domainList.innerHTML = "";
  domains.forEach((domain) => {
    const item = document.createElement("div");
    item.textContent = domain;
    domainList.appendChild(item);
  });
};

const renderAccountList = (accounts) => {
  accountList.innerHTML = "";
  setAccountListStatus("");

  if (!accounts.length) {
    accountList.textContent = "No Cloudflare accounts added yet.";
    return;
  }

  accounts.forEach((account) => {
    const card = document.createElement("div");
    card.className = "account-card";

    const header = document.createElement("div");
    header.className = "account-header";

    const title = document.createElement("div");
    title.innerHTML = `<strong>${account.label}</strong><br /><span class="muted">${account.email}</span>`;

    const status = document.createElement("span");
    const isConnected = account.status === "connected";
    status.className = `status-pill${isConnected ? " connected" : ""}`;
    status.textContent = isConnected
      ? "Connected"
      : account.status === "error"
        ? "Error"
        : "Pending";

    header.appendChild(title);
    header.appendChild(status);

    const meta = document.createElement("div");
    meta.className = "muted";
    const authLabel =
      account.authType === "cloudflared" ? "Browser login" : "API token";
    meta.textContent = `Auth: ${authLabel} · Zones accessible: ${account.zoneCount ?? 0}`;

    const actions = document.createElement("div");
    actions.className = "account-actions";

    const markBtn = document.createElement("button");
    markBtn.type = "button";
    markBtn.textContent =
      account.authType === "cloudflared" ? "Check login" : "Validate token";
    markBtn.addEventListener("click", async () => {
      const response = await fetch(
        `/api/cloudflare/accounts/${account.id}/login`,
        {
          method: "POST"
        }
      );
      if (handleUnauthorized(response)) {
        return;
      }
      if (!response.ok) {
        const data = await response.json();
        setAccountListStatus(data.error || "Unable to validate account.", "error");
      } else {
        setAccountListStatus("Account refreshed.", "success");
      }
      await refreshAccountData();
    });

    actions.appendChild(markBtn);

    if (account.authType === "cloudflared") {
      const loginBtn = document.createElement("button");
      loginBtn.type = "button";
      loginBtn.textContent = "Start browser login";
      loginBtn.addEventListener("click", async () => {
        await startBrowserLogin(account.id);
      });
      actions.appendChild(loginBtn);
    }

    card.appendChild(header);
    card.appendChild(meta);
    card.appendChild(actions);
    accountList.appendChild(card);
  });
};

const populateAccountSelect = (accounts) => {
  const currentValue = accountSelect.value;
  accountSelect.innerHTML = '<option value="">Select an account</option>';
  accounts.forEach((account) => {
    const option = document.createElement("option");
    option.value = account.id;
    option.textContent = `${account.label} (${account.email})`;
    accountSelect.appendChild(option);
  });
  accountSelect.value = currentValue;
};

const refreshAccountData = async () => {
  let accounts = await fetchAccounts();
  accounts = await refreshCloudflaredAccounts(accounts);
  cachedAccounts = accounts;
  renderAccountList(accounts);
  populateAccountSelect(accounts);

  if (accountSelect.value) {
    const selectedAccount = accounts.find(
      (account) => account.id === accountSelect.value
    );
    if (shouldFetchDomains(selectedAccount)) {
      const domains = await fetchDomains(accountSelect.value);
      renderDomainList(domains);
    } else {
      renderDomainList([]);
    }
  } else {
    renderDomainList([]);
  }
};

refreshAccountsBtn.addEventListener("click", refreshAccountData);

accountSelect.addEventListener("change", async () => {
  const selectedAccount = cachedAccounts.find(
    (account) => account.id === accountSelect.value
  );
  if (shouldFetchDomains(selectedAccount)) {
    const domains = await fetchDomains(accountSelect.value);
    renderDomainList(domains);
  } else {
    renderDomainList([]);
  }
});

authTypeInputs.forEach((input) => {
  input.addEventListener("change", () => {
    syncAuthFields();
    setLoginStatus("Idle", "");
  });
});

startBrowserLoginBtn?.addEventListener("click", async () => {
  if (!activeLoginAccountId) {
    setAccountFormStatus("Save the account first, then start login.", "error");
    return;
  }
  await startBrowserLogin(activeLoginAccountId);
});

accountForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const label = accountLabelInput.value.trim();
  const email = accountEmailInput.value.trim();
  const accountId = accountIdInput.value.trim();
  const apiToken = accountTokenInput.value.trim();
  const authType = getSelectedAuthType();

  if (!label || !email || !accountId || (authType === "token" && !apiToken)) {
    return;
  }

  const response = await fetch("/api/cloudflare/accounts", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ label, email, accountId, apiToken, authType })
  });

  if (handleUnauthorized(response)) {
    return;
  }

  if (response.ok) {
    const data = await response.json();
    const account = data.account;
    accountLabelInput.value = "";
    accountEmailInput.value = "";
    accountIdInput.value = "";
    accountTokenInput.value = "";
    activeLoginAccountId = account?.id || null;
    setAccountFormStatus("Account saved.", "success");
    if (authType === "cloudflared" && account?.id) {
      await startBrowserLogin(account.id);
    }
    await refreshAccountData();
  } else {
    const data = await response.json();
    setAccountFormStatus(data.error || "Failed to save account.", "error");
  }
});

syncAuthFields();
setLoginStatus("Idle", "");
refreshAccountData();
