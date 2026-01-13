const accountForm = document.querySelector("#account-form");
const accountLabelInput = document.querySelector("#account-label");
const accountEmailInput = document.querySelector("#account-email");
const accountIdInput = document.querySelector("#account-id");
const accountTokenInput = document.querySelector("#account-token");
const accountList = document.querySelector("#account-list");
const refreshAccountsBtn = document.querySelector("#refresh-accounts");
const accountSelect = document.querySelector("#account-select");
const domainList = document.querySelector("#domain-list");

const handleUnauthorized = (response) => {
  if (response.status === 401) {
    window.location.href = "/login.html";
    return true;
  }
  return false;
};

const fetchAccounts = async () => {
  const response = await fetch("/api/cloudflare/accounts");
  if (handleUnauthorized(response)) {
    return [];
  }
  const data = await response.json();
  return data.accounts || [];
};

const fetchDomains = async (accountId) => {
  if (!accountId) {
    return [];
  }
  const response = await fetch(`/api/cloudflare/accounts/${accountId}/domains`);
  if (handleUnauthorized(response)) {
    return [];
  }
  const data = await response.json();
  return data.domains || [];
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
    meta.textContent = `Zones accessible: ${account.zoneCount ?? 0}`;

    const actions = document.createElement("div");
    actions.className = "account-actions";

    const markBtn = document.createElement("button");
    markBtn.type = "button";
    markBtn.textContent = "Validate token";
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
      await refreshAccountData();
    });

    actions.appendChild(markBtn);

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
  const accounts = await fetchAccounts();
  renderAccountList(accounts);
  populateAccountSelect(accounts);

  if (accountSelect.value) {
    const domains = await fetchDomains(accountSelect.value);
    renderDomainList(domains);
  } else {
    renderDomainList([]);
  }
};

refreshAccountsBtn.addEventListener("click", refreshAccountData);

accountSelect.addEventListener("change", async () => {
  const domains = await fetchDomains(accountSelect.value);
  renderDomainList(domains);
});

accountForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const label = accountLabelInput.value.trim();
  const email = accountEmailInput.value.trim();
  const accountId = accountIdInput.value.trim();
  const apiToken = accountTokenInput.value.trim();

  if (!label || !email || !accountId || !apiToken) {
    return;
  }

  const response = await fetch("/api/cloudflare/accounts", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ label, email, accountId, apiToken })
  });

  if (handleUnauthorized(response)) {
    return;
  }

  if (response.ok) {
    accountLabelInput.value = "";
    accountEmailInput.value = "";
    accountIdInput.value = "";
    accountTokenInput.value = "";
    await refreshAccountData();
  }
});

refreshAccountData();
