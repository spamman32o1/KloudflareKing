const list = document.querySelector("#campaign-list");
const emptyState = document.querySelector("#empty-state");
const refreshBtn = document.querySelector("#refresh-btn");
const template = document.querySelector("#campaign-card");

const handleUnauthorized = (response) => {
  if (response.status === 401) {
    window.location.href = "/login.html";
    return true;
  }
  return false;
};

const formatRelativeTime = (date) =>
  new Date(date).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  });

const groupByCampaign = (tunnels) => {
  const groups = new Map();

  tunnels.forEach((tunnel) => {
    const name = tunnel.tunnelName?.trim() || "Untitled campaign";
    if (!groups.has(name)) {
      groups.set(name, []);
    }
    groups.get(name).push(tunnel);
  });

  return Array.from(groups.entries()).map(([name, items]) => {
    const sorted = [...items].sort(
      (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
    );
    return {
      name,
      tunnels: sorted,
      count: items.length,
      latestCreatedAt: sorted[0]?.createdAt
    };
  });
};

const renderCampaigns = (tunnels) => {
  list.innerHTML = "";
  const campaigns = groupByCampaign(tunnels);

  if (!campaigns.length) {
    emptyState.style.display = "block";
    return;
  }

  emptyState.style.display = "none";

  campaigns.forEach((campaign) => {
    const node = template.content.cloneNode(true);
    const name = node.querySelector("[data-name]");
    const count = node.querySelector("[data-count]");
    const types = node.querySelector("[data-types]");
    const latest = node.querySelector("[data-latest]");
    const link = node.querySelector("[data-link]");
    const copyBtn = node.querySelector(".copy-btn");
    const deleteBtn = node.querySelector("[data-delete]");
    const confirmRow = node.querySelector("[data-confirm]");
    const confirmDeleteBtn = node.querySelector("[data-confirm-delete]");
    const cancelDeleteBtn = node.querySelector("[data-cancel-delete]");

    name.textContent = campaign.name;
    count.textContent = `${campaign.count} tunnel${campaign.count === 1 ? "" : "s"}`;
    const uniqueTypes = Array.from(
      new Set(campaign.tunnels.map((tunnel) => tunnel.tunnelType || "free"))
    );
    types.textContent = `Tunnel types: ${uniqueTypes.join(", ")}`;
    latest.textContent = campaign.latestCreatedAt
      ? `Latest tunnel created: ${formatRelativeTime(campaign.latestCreatedAt)}`
      : "No tunnels created yet.";
    link.href = `/tunnel.html?name=${encodeURIComponent(campaign.name)}`;

    copyBtn.addEventListener("click", async () => {
      const links = campaign.tunnels.map(
        (tunnel) => `https://${tunnel.hostname}`
      );
      await navigator.clipboard.writeText(links.join("\n"));
      copyBtn.textContent = "Copied!";
      copyBtn.classList.add("copied");
      setTimeout(() => {
        copyBtn.textContent = "Copy all links";
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
      const response = await fetch(
        `/api/campaigns/${encodeURIComponent(campaign.name)}`,
        { method: "DELETE" }
      );
      if (handleUnauthorized(response)) {
        return;
      }
      if (response.ok) {
        fetchTunnels();
      } else {
        confirmDeleteBtn.textContent = "Delete failed";
        setTimeout(() => {
          confirmDeleteBtn.textContent = "Confirm delete";
        }, 1500);
      }
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
  renderCampaigns(data.tunnels);
};

refreshBtn.addEventListener("click", fetchTunnels);

fetchTunnels();
