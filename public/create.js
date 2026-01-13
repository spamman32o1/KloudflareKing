const form = document.querySelector("#tunnel-form");
const tunnelTypeSelect = document.querySelector("#tunnel-type");
const nameInput = document.querySelector("#tunnel-name");
const targetInput = document.querySelector("#target-url");
const tunnelCountInput = document.querySelector("#tunnel-count");
const proxyTypeInput = document.querySelector("#proxy-type");
const proxyFileInput = document.querySelector("#proxy-file");
const proxyListInput = document.querySelector("#proxy-list");
const namedSection = document.querySelector('[data-mode="named"]');
const freeSection = document.querySelector('[data-mode="free"]');
const accountSelect = document.querySelector("#account-select");
const domainSelect = document.querySelector("#domain-select");
const subdomainInput = document.querySelector("#subdomain");
const namedProxyTypeInput = document.querySelector("#named-proxy-type");
const namedProxyInput = document.querySelector("#named-proxy");
const namedProxyFileInput = document.querySelector("#named-proxy-file");
const namedProxyListInput = document.querySelector("#named-proxy-list");
const submitBtn = document.querySelector("#submit-btn");
const helperText = document.querySelector("#form-helper");
const accountForm = document.querySelector("#account-form");
const accountLabelInput = document.querySelector("#account-label");
const accountEmailInput = document.querySelector("#account-email");
const accountIdInput = document.querySelector("#account-id");
const accountList = document.querySelector("#account-list");
const refreshAccountsBtn = document.querySelector("#refresh-accounts");
const domainForm = document.querySelector("#domain-form");
const domainInput = document.querySelector("#domain-input");
const domainList = document.querySelector("#domain-list");

const handleUnauthorized = (response) => {
  if (response.status === 401) {
    window.location.href = "/login.html";
    return true;
  }
  return false;
};

const parseProxyList = (value) =>
  value
    .split(/\r?\n/)
    .map((proxy) => proxy.trim())
    .filter(Boolean);

const setFieldVisibility = (mode) => {
  const isNamed = mode === "named";
  namedSection.style.display = isNamed ? "flex" : "none";
  freeSection.style.display = isNamed ? "none" : "flex";
  accountSelect.required = isNamed;
  domainSelect.required = isNamed;
  tunnelCountInput.required = !isNamed;
  submitBtn.textContent = isNamed ? "Create named tunnel" : "Create free tunnels";
  helperText.textContent = isNamed
    ? "Named tunnels use a single active proxy. After 3 failures, we rotate to your fallback list."
    : "We will return free Cloudflare hostnames and spread tunnels evenly across your proxies.";
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
    status.className = `status-pill${account.status === "connected" ? " connected" : ""}`;
    status.textContent = account.status === "connected" ? "Connected" : "Pending";

    header.appendChild(title);
    header.appendChild(status);

    const login = document.createElement("div");
    login.className = "muted";
    login.innerHTML = `Login URL: <a href="${account.loginUrl}" target="_blank" rel="noreferrer">${account.loginUrl}</a>`;

    const meta = document.createElement("div");
    meta.className = "muted";
    meta.textContent = `Domains: ${account.domains.length}`;

    const actions = document.createElement("div");
    actions.className = "account-actions";

    const openBtn = document.createElement("a");
    openBtn.className = "secondary-btn";
    openBtn.href = account.loginUrl;
    openBtn.target = "_blank";
    openBtn.rel = "noreferrer";
    openBtn.textContent = "Open login";

    const markBtn = document.createElement("button");
    markBtn.type = "button";
    markBtn.textContent = "Mark connected";
    markBtn.disabled = account.status === "connected";
    markBtn.addEventListener("click", async () => {
      const response = await fetch(`/api/cloudflare/accounts/${account.id}/login`, {
        method: "POST"
      });
      if (handleUnauthorized(response)) {
        return;
      }
      await refreshAccountData();
    });

    actions.appendChild(openBtn);
    actions.appendChild(markBtn);

    card.appendChild(header);
    card.appendChild(login);
    card.appendChild(meta);
    card.appendChild(actions);
    accountList.appendChild(card);
  });
};

const populateAccountSelect = (accounts) => {
  const currentValue = accountSelect.value;
  accountSelect.innerHTML = '<option value="">Select a connected account</option>';
  accounts
    .filter((account) => account.status === "connected")
    .forEach((account) => {
      const option = document.createElement("option");
      option.value = account.id;
      option.textContent = `${account.label} (${account.email})`;
      accountSelect.appendChild(option);
    });
  accountSelect.value = currentValue;
};

const populateDomainSelect = (domains) => {
  const currentValue = domainSelect.value;
  domainSelect.innerHTML = '<option value="">Select a domain</option>';
  domains.forEach((domain) => {
    const option = document.createElement("option");
    option.value = domain;
    option.textContent = domain;
    domainSelect.appendChild(option);
  });
  domainSelect.value = currentValue;
};

const refreshAccountData = async () => {
  const accounts = await fetchAccounts();
  renderAccountList(accounts);
  populateAccountSelect(accounts);

  if (accountSelect.value) {
    const domains = await fetchDomains(accountSelect.value);
    populateDomainSelect(domains);
    renderDomainList(domains);
  } else {
    populateDomainSelect([]);
    renderDomainList([]);
  }
};

proxyFileInput.addEventListener("change", () => {
  const file = proxyFileInput.files?.[0];
  if (!file) {
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    const text = typeof reader.result === "string" ? reader.result : "";
    proxyListInput.value = text.trim();
  };
  reader.readAsText(file);
});

namedProxyFileInput.addEventListener("change", () => {
  const file = namedProxyFileInput.files?.[0];
  if (!file) {
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    const text = typeof reader.result === "string" ? reader.result : "";
    namedProxyListInput.value = text.trim();
  };
  reader.readAsText(file);
});

tunnelTypeSelect.addEventListener("change", () => {
  setFieldVisibility(tunnelTypeSelect.value);
});

accountSelect.addEventListener("change", async () => {
  const domains = await fetchDomains(accountSelect.value);
  populateDomainSelect(domains);
  renderDomainList(domains);
});

refreshAccountsBtn.addEventListener("click", refreshAccountData);

accountForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const label = accountLabelInput.value.trim();
  const email = accountEmailInput.value.trim();
  const accountId = accountIdInput.value.trim();

  if (!label || !email || !accountId) {
    return;
  }

  const response = await fetch("/api/cloudflare/accounts", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ label, email, accountId })
  });

  if (handleUnauthorized(response)) {
    return;
  }

  if (response.ok) {
    accountLabelInput.value = "";
    accountEmailInput.value = "";
    accountIdInput.value = "";
    await refreshAccountData();
  }
});

domainForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const hostname = domainInput.value.trim();
  if (!hostname || !accountSelect.value) {
    return;
  }
  const response = await fetch(
    `/api/cloudflare/accounts/${accountSelect.value}/domains`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ hostname })
    }
  );
  if (handleUnauthorized(response)) {
    return;
  }
  if (response.ok) {
    domainInput.value = "";
    const domains = await fetchDomains(accountSelect.value);
    populateDomainSelect(domains);
    renderDomainList(domains);
  }
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const tunnelName = nameInput.value.trim();
  const targetUrl = targetInput.value.trim();

  if (!tunnelName || !targetUrl) {
    return;
  }

  const tunnelType = tunnelTypeSelect.value === "named" ? "named" : "free";
  const tunnelCount = Number.parseInt(tunnelCountInput.value, 10);
  const proxies = parseProxyList(proxyListInput.value);
  const proxyType =
    tunnelType === "named" ? namedProxyTypeInput.value : proxyTypeInput.value;
  const primaryProxy = namedProxyInput.value.trim();
  const fallbackProxies = parseProxyList(namedProxyListInput.value);

  const response = await fetch("/api/tunnels", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      tunnelName,
      targetUrl,
      tunnelCount,
      proxies,
      proxyType,
      tunnelType,
      accountId: accountSelect.value,
      domainName: domainSelect.value,
      subdomain: subdomainInput.value.trim(),
      primaryProxy,
      fallbackProxies
    })
  });

  if (handleUnauthorized(response)) {
    return;
  }

  if (response.ok) {
    window.location.href = `/tunnel.html?name=${encodeURIComponent(tunnelName)}`;
  }
});

setFieldVisibility(tunnelTypeSelect.value);
refreshAccountData();
