const title = document.querySelector("#campaign-title");
const subtitle = document.querySelector("#campaign-subtitle");
const list = document.querySelector("#tunnel-list");
const emptyState = document.querySelector("#empty-state");
const refreshBtn = document.querySelector("#refresh-btn");
const template = document.querySelector("#tunnel-card");
const copyAllBtn = document.querySelector("#copy-all");
const deleteCampaignBtn = document.querySelector("#delete-campaign");
const confirmCampaignDelete = document.querySelector("#confirm-campaign-delete");
const confirmDeleteCampaignBtn = document.querySelector("#confirm-delete-campaign");
const cancelDeleteCampaignBtn = document.querySelector("#cancel-delete-campaign");
const deploymentPanel = document.querySelector("#deployment-panel");
const deploymentSubtitle = document.querySelector("#deployment-subtitle");
const deploymentFileSelect = document.querySelector("#deployment-file-select");
const deploymentEditor = document.querySelector("#deployment-editor");
const deploymentSaveBtn = document.querySelector("#deployment-save");
const deploymentConfirm = document.querySelector("#deployment-confirm");
const deploymentConfirmSaveBtn = document.querySelector("#deployment-confirm-save");
const deploymentCancelSaveBtn = document.querySelector("#deployment-cancel-save");
const deploymentStatus = document.querySelector("#deployment-status");
const deploymentReplaceFilesInput = document.querySelector("#deployment-replace-files");
const deploymentReplaceBtn = document.querySelector("#deployment-replace");
const deploymentConfirmReplace = document.querySelector("#deployment-confirm-replace");
const deploymentConfirmReplaceBtn = document.querySelector(
  "#deployment-confirm-replace-btn"
);
const deploymentCancelReplaceBtn = document.querySelector(
  "#deployment-cancel-replace"
);

const params = new URLSearchParams(window.location.search);
const campaignName = params.get("name");
let activeDeploymentId = null;
let activeDeploymentFile = null;

const handleUnauthorized = (response) => {
  if (response.status === 401) {
    window.location.href = "/login.html";
    return true;
  }
  return false;
};

const renderTunnels = (tunnels) => {
  list.innerHTML = "";

  if (!tunnels.length) {
    emptyState.style.display = "block";
    subtitle.textContent = "No tunnels are currently assigned to this campaign.";
    return;
  }

  emptyState.style.display = "none";
  subtitle.textContent = `${tunnels.length} active tunnel${
    tunnels.length === 1 ? "" : "s"
  } ready to copy or share.`;

  tunnels.forEach((tunnel) => {
    const node = template.content.cloneNode(true);
    const hostname = node.querySelector("[data-hostname]");
    const type = node.querySelector("[data-type]");
    const domain = node.querySelector("[data-domain]");
    const account = node.querySelector("[data-account]");
    const target = node.querySelector("[data-target]");
    const proxy = node.querySelector("[data-proxy]");
    const proxyRotation = node.querySelector("[data-proxy-rotation]");
    const created = node.querySelector("[data-created]");
    const copyBtn = node.querySelector(".copy-btn");
    const deleteBtn = node.querySelector("[data-delete]");
    const confirmRow = node.querySelector("[data-confirm]");
    const confirmDeleteBtn = node.querySelector("[data-confirm-delete]");
    const cancelDeleteBtn = node.querySelector("[data-cancel-delete]");

    hostname.textContent = `https://${tunnel.hostname}`;
    type.textContent = `Type: ${tunnel.tunnelType === "named" ? "named" : "free"}`;
    if (tunnel.tunnelType === "named" && tunnel.fullDomain) {
      domain.textContent = `Domain: ${tunnel.fullDomain}`;
      account.textContent = `Account: ${tunnel.accountLabel || "Unknown"}`;
    } else {
      domain.textContent = "Domain: trycloudflare.com";
      account.textContent = "Account: none";
    }
    target.textContent = `Target: ${tunnel.targetUrl}`;
    if (tunnel.proxy) {
      const proxyTypeLabel = tunnel.proxyType ? `${tunnel.proxyType.toUpperCase()} ` : "";
      proxy.textContent = `Proxy: ${proxyTypeLabel}${tunnel.proxy}`;
    } else {
      proxy.textContent = "Proxy: none";
    }
    if (tunnel.proxyRotation) {
      proxyRotation.textContent = `Proxy rotation: ${tunnel.proxyRotation.strategy} after ${tunnel.proxyRotation.failureThreshold} failures`;
    } else {
      proxyRotation.textContent = "Proxy rotation: standard";
    }
    created.textContent = `Created: ${new Date(tunnel.createdAt).toLocaleString()}`;

    copyBtn.addEventListener("click", async () => {
      await navigator.clipboard.writeText(`https://${tunnel.hostname}`);
      copyBtn.textContent = "Copied!";
      copyBtn.classList.add("copied");
      setTimeout(() => {
        copyBtn.textContent = "Copy URL";
        copyBtn.classList.remove("copied");
      }, 1500);
    });

    deleteBtn.addEventListener("click", () => {
      deleteBtn.style.display = "none";
      confirmRow.style.display = "flex";
    });

    cancelDeleteBtn.addEventListener("click", () => {
      confirmRow.style.display = "none";
      deleteBtn.style.display = "inline-flex";
    });

    confirmDeleteBtn.addEventListener("click", async () => {
      const response = await fetch(`/api/tunnels/${tunnel.id}`, {
        method: "DELETE"
      });
      if (handleUnauthorized(response)) {
        return;
      }
      if (response.ok) {
        fetchTunnels();
      } else {
        confirmDeleteBtn.textContent = "Delete failed";
        setTimeout(() => {
          confirmDeleteBtn.textContent = "Confirm";
        }, 1500);
      }
    });

    list.appendChild(node);
  });
};

const setDeploymentStatus = (message, tone = "muted") => {
  if (!deploymentStatus) {
    return;
  }
  deploymentStatus.textContent = message;
  deploymentStatus.style.color =
    tone === "error" ? "var(--danger)" : "var(--muted)";
};

const setDeploymentConfirmVisibility = (visible) => {
  deploymentConfirm.style.display = visible ? "flex" : "none";
};

const setReplaceConfirmVisibility = (visible) => {
  deploymentConfirmReplace.style.display = visible ? "flex" : "none";
};

const populateDeploymentFiles = (files) => {
  deploymentFileSelect.innerHTML = "";
  if (!files.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No editable files found";
    deploymentFileSelect.appendChild(option);
    deploymentFileSelect.disabled = true;
    deploymentEditor.value = "";
    deploymentEditor.disabled = true;
    return;
  }
  files.forEach((file) => {
    const option = document.createElement("option");
    option.value = file;
    option.textContent = file;
    deploymentFileSelect.appendChild(option);
  });
  deploymentFileSelect.disabled = false;
  deploymentEditor.disabled = false;
  deploymentFileSelect.value = files[0];
};

const loadDeploymentFile = async (deploymentId, filePath) => {
  if (!deploymentId || !filePath) {
    return;
  }
  const response = await fetch(
    `/api/deployments/${deploymentId}/file?path=${encodeURIComponent(filePath)}`
  );
  if (handleUnauthorized(response)) {
    return;
  }
  if (!response.ok) {
    setDeploymentStatus("Unable to load the selected file.", "error");
    return;
  }
  const data = await response.json();
  deploymentEditor.value = data.contents ?? "";
  activeDeploymentFile = filePath;
  setDeploymentStatus(`Loaded ${filePath}.`);
};

const loadDeploymentFiles = async (deploymentId) => {
  const response = await fetch(`/api/deployments/${deploymentId}/files`);
  if (handleUnauthorized(response)) {
    return;
  }
  if (!response.ok) {
    setDeploymentStatus("Unable to fetch deployment files.", "error");
    return;
  }
  const data = await response.json();
  const files = Array.isArray(data.files) ? data.files : [];
  populateDeploymentFiles(files);
  if (files.length) {
    await loadDeploymentFile(deploymentId, files[0]);
  }
};

const updateDeploymentSection = async (tunnels) => {
  const deploymentIds = Array.from(
    new Set(tunnels.map((tunnel) => tunnel.deploymentId).filter(Boolean))
  );
  if (!deploymentIds.length) {
    deploymentPanel.classList.add("is-hidden");
    return;
  }

  deploymentPanel.classList.remove("is-hidden");
  activeDeploymentId = deploymentIds[0];
  deploymentSubtitle.textContent =
    deploymentIds.length > 1
      ? "Editing the first deployment linked to this campaign."
      : "Edit deployed files or replace the deployment bundle.";
  await loadDeploymentFiles(activeDeploymentId);
};

const fetchTunnels = async () => {
  const response = await fetch("/api/tunnels");
  if (handleUnauthorized(response)) {
    return;
  }
  const data = await response.json();
  const tunnels = data.tunnels.filter(
    (tunnel) => (tunnel.tunnelName?.trim() || "Untitled campaign") === campaignName
  );
  renderTunnels(tunnels);
  await updateDeploymentSection(tunnels);

  copyAllBtn.onclick = async () => {
    const links = tunnels.map((tunnel) => `https://${tunnel.hostname}`);
    if (!links.length) {
      return;
    }
    await navigator.clipboard.writeText(links.join("\n"));
    copyAllBtn.textContent = "Copied!";
    copyAllBtn.classList.add("copied");
    setTimeout(() => {
      copyAllBtn.textContent = "Copy all links";
      copyAllBtn.classList.remove("copied");
    }, 1500);
  };
};

if (!campaignName) {
  window.location.href = "/index.html";
} else {
  title.textContent = campaignName;
  fetchTunnels();
}

refreshBtn.addEventListener("click", fetchTunnels);

deploymentFileSelect.addEventListener("change", async () => {
  const selected = deploymentFileSelect.value;
  if (!selected) {
    return;
  }
  await loadDeploymentFile(activeDeploymentId, selected);
});

deploymentSaveBtn.addEventListener("click", () => {
  setDeploymentConfirmVisibility(true);
});

deploymentCancelSaveBtn.addEventListener("click", () => {
  setDeploymentConfirmVisibility(false);
});

deploymentConfirmSaveBtn.addEventListener("click", async () => {
  if (!activeDeploymentId || !deploymentFileSelect.value) {
    setDeploymentStatus("Select a file to save.", "error");
    return;
  }
  const response = await fetch(`/api/deployments/${activeDeploymentId}/file`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      path: deploymentFileSelect.value,
      contents: deploymentEditor.value
    })
  });
  if (handleUnauthorized(response)) {
    return;
  }
  if (!response.ok) {
    setDeploymentStatus("Save failed. Try again.", "error");
    return;
  }
  setDeploymentConfirmVisibility(false);
  activeDeploymentFile = deploymentFileSelect.value;
  setDeploymentStatus(`Saved ${deploymentFileSelect.value}.`);
});

deploymentReplaceBtn.addEventListener("click", () => {
  setReplaceConfirmVisibility(true);
});

deploymentCancelReplaceBtn.addEventListener("click", () => {
  setReplaceConfirmVisibility(false);
});

deploymentConfirmReplaceBtn.addEventListener("click", async () => {
  if (!activeDeploymentId) {
    setDeploymentStatus("No deployment available to replace.", "error");
    return;
  }
  const files = Array.from(deploymentReplaceFilesInput.files || []);
  if (!files.length) {
    setDeploymentStatus("Select files or a zip to replace.", "error");
    return;
  }
  const formData = new FormData();
  files.forEach((file) => formData.append("files", file));

  const response = await fetch(
    `/api/deployments/${activeDeploymentId}/replace`,
    {
      method: "POST",
      body: formData
    }
  );
  if (handleUnauthorized(response)) {
    return;
  }
  if (!response.ok) {
    setDeploymentStatus("Replace failed. Try again.", "error");
    return;
  }
  setReplaceConfirmVisibility(false);
  deploymentReplaceFilesInput.value = "";
  setDeploymentStatus("Deployment replaced. Reloading files...");
  await loadDeploymentFiles(activeDeploymentId);
});

deleteCampaignBtn.addEventListener("click", () => {
  deleteCampaignBtn.style.display = "none";
  confirmCampaignDelete.style.display = "flex";
});

cancelDeleteCampaignBtn.addEventListener("click", () => {
  confirmCampaignDelete.style.display = "none";
  deleteCampaignBtn.style.display = "inline-flex";
});

confirmDeleteCampaignBtn.addEventListener("click", async () => {
  const response = await fetch(
    `/api/campaigns/${encodeURIComponent(campaignName)}`,
    { method: "DELETE" }
  );
  if (handleUnauthorized(response)) {
    return;
  }
  if (response.ok) {
    window.location.href = "/index.html";
  } else {
    confirmDeleteCampaignBtn.textContent = "Delete failed";
    setTimeout(() => {
      confirmDeleteCampaignBtn.textContent = "Confirm delete";
    }, 1500);
  }
});
