const title = document.querySelector("#campaign-title");
const subtitle = document.querySelector("#campaign-subtitle");
const list = document.querySelector("#tunnel-list");
const emptyState = document.querySelector("#empty-state");
const refreshBtn = document.querySelector("#refresh-btn");
const template = document.querySelector("#tunnel-card");
const copyAllBtn = document.querySelector("#copy-all");

const params = new URLSearchParams(window.location.search);
const campaignName = params.get("name");

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

    list.appendChild(node);
  });
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
