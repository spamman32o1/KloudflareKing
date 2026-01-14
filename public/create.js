const form = document.querySelector("#tunnel-form");
const tunnelTypeSelect = document.querySelector("#tunnel-type");
const nameInput = document.querySelector("#tunnel-name");
const targetInput = document.querySelector("#target-url");
const targetSourceInputs = document.querySelectorAll('input[name="target-source"]');
const targetUrlSection = document.querySelector('[data-target="url"]');
const targetDeploySection = document.querySelector('[data-target="deploy"]');
const deployFilesInput = document.querySelector("#deploy-files");
const startupScriptInput = document.querySelector("#startup-script");
const projectSelect = document.querySelector("#project-select");
const projectNameInput = document.querySelector("#project-name");
const saveProjectBtn = document.querySelector("#save-project-btn");
const projectStatus = document.querySelector("#project-status");
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

let cachedProjects = [];

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

const setProjectStatus = (message, tone = "info") => {
  if (!projectStatus) {
    return;
  }
  projectStatus.textContent = message;
  if (!message) {
    projectStatus.style.color = "";
    return;
  }
  if (tone === "error") {
    projectStatus.style.color = "var(--danger)";
  } else if (tone === "success") {
    projectStatus.style.color = "var(--success)";
  } else {
    projectStatus.style.color = "";
  }
};

const setFieldVisibility = (mode) => {
  const isNamed = mode === "named";
  namedSection.style.display = isNamed ? "flex" : "none";
  freeSection.style.display = isNamed ? "none" : "flex";
  accountSelect.required = isNamed;
  domainSelect.required = isNamed;
  tunnelCountInput.required = !isNamed;
  submitBtn.textContent = isNamed ? "Create named tunnel" : "Create free tunnels";
  helperText.textContent = isNamed
    ? "Named tunnels use your Cloudflare API token to create the tunnel and DNS record."
    : "We will return free Cloudflare hostnames and spread tunnels evenly across your proxies.";
};

const syncDeployInputs = () => {
  if (!deployFilesInput) {
    return;
  }
  const isDeploy = getTargetMode() === "deploy";
  const hasProject = projectSelect?.value;
  deployFilesInput.disabled = Boolean(hasProject);
  deployFilesInput.required = isDeploy && !hasProject;
};

const setTargetVisibility = (mode) => {
  const isDeploy = mode === "deploy";
  targetDeploySection.style.display = isDeploy ? "flex" : "none";
  targetUrlSection.style.display = isDeploy ? "none" : "flex";
  targetInput.required = !isDeploy;
  syncDeployInputs();
};

const getTargetMode = () =>
  document.querySelector('input[name="target-source"]:checked')?.value || "url";

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

const fetchProjects = async () => {
  const response = await fetch("/api/projects");
  if (handleUnauthorized(response)) {
    return [];
  }
  const data = await response.json();
  return Array.isArray(data.projects) ? data.projects : [];
};

const populateProjectSelect = (projects) => {
  if (!projectSelect) {
    return;
  }
  const currentValue = projectSelect.value;
  projectSelect.innerHTML = '<option value="">Upload new files</option>';
  projects.forEach((project) => {
    const option = document.createElement("option");
    option.value = project.id;
    option.textContent = project.name;
    projectSelect.appendChild(option);
  });
  projectSelect.value = currentValue;
};

const applyProjectSelection = () => {
  if (!projectSelect) {
    return;
  }
  const selected = cachedProjects.find((project) => project.id === projectSelect.value);
  if (selected) {
    startupScriptInput.value = selected.startupScript || "";
  }
  syncDeployInputs();
};

const refreshProjectData = async () => {
  cachedProjects = await fetchProjects();
  populateProjectSelect(cachedProjects);
  applyProjectSelection();
};

const refreshAccountData = async () => {
  const accounts = await fetchAccounts();
  populateAccountSelect(accounts);

  if (accountSelect.value) {
    const domains = await fetchDomains(accountSelect.value);
    populateDomainSelect(domains);
  } else {
    populateDomainSelect([]);
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

targetSourceInputs.forEach((input) => {
  input.addEventListener("change", () => {
    setTargetVisibility(getTargetMode());
  });
});

if (projectSelect) {
  projectSelect.addEventListener("change", () => {
    setProjectStatus("");
    applyProjectSelection();
  });
}

if (saveProjectBtn) {
  saveProjectBtn.addEventListener("click", async () => {
    setProjectStatus("");
    const projectName = projectNameInput.value.trim();
    const files = Array.from(deployFilesInput.files || []);
    if (!files.length) {
      setProjectStatus("Choose project files or a zip before saving.", "error");
      return;
    }
    const formData = new FormData();
    files.forEach((file) => formData.append("files", file));
    const startupScript = startupScriptInput.value.trim();
    if (startupScript) {
      formData.append("startupScript", startupScript);
    }
    if (projectName) {
      formData.append("projectName", projectName);
    }

    const response = await fetch("/api/projects", {
      method: "POST",
      body: formData
    });

    if (handleUnauthorized(response)) {
      return;
    }

    if (!response.ok) {
      setProjectStatus("Unable to save the project bundle.", "error");
      return;
    }

    const data = await response.json();
    await refreshProjectData();
    if (data.project?.id) {
      projectSelect.value = data.project.id;
      applyProjectSelection();
    }
    setProjectStatus("Project saved and ready to reuse.", "success");
  });
}

accountSelect.addEventListener("change", async () => {
  const domains = await fetchDomains(accountSelect.value);
  populateDomainSelect(domains);
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const tunnelName = nameInput.value.trim();
  const targetMode = getTargetMode();
  let targetUrl = targetInput.value.trim();
  let deploymentId = null;

  if (targetMode === "deploy") {
    const selectedProjectId = projectSelect?.value?.trim();
    const files = Array.from(deployFilesInput.files || []);
    if (!selectedProjectId && !files.length) {
      return;
    }
    const formData = new FormData();
    if (selectedProjectId) {
      formData.append("projectId", selectedProjectId);
    } else {
      files.forEach((file) => formData.append("files", file));
    }
    const startupScript = startupScriptInput.value.trim();
    if (startupScript) {
      formData.append("startupScript", startupScript);
    }

    const deployResponse = await fetch("/api/deployments", {
      method: "POST",
      body: formData
    });

    if (handleUnauthorized(deployResponse)) {
      return;
    }

    if (!deployResponse.ok) {
      return;
    }

    const deployData = await deployResponse.json();
    targetUrl = deployData.targetUrl || "";
    deploymentId = deployData.deploymentId || null;
  }

  if (!targetUrl) {
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
      deploymentId,
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
    const data = await response.json();
    const campaignName =
      data?.tunnels?.[0]?.tunnelName?.trim() ||
      tunnelName ||
      "Untitled campaign";
    window.location.href = `/tunnel.html?name=${encodeURIComponent(campaignName)}`;
  }
});

setFieldVisibility(tunnelTypeSelect.value);
setTargetVisibility(getTargetMode());
refreshAccountData();
refreshProjectData();
