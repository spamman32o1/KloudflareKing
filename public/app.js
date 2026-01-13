const form = document.querySelector("#tunnel-form");
const input = document.querySelector("#target-url");
const list = document.querySelector("#tunnel-list");
const emptyState = document.querySelector("#empty-state");
const refreshBtn = document.querySelector("#refresh-btn");
const template = document.querySelector("#tunnel-card");

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
    return;
  }

  emptyState.style.display = "none";

  tunnels.forEach((tunnel) => {
    const node = template.content.cloneNode(true);
    const hostname = node.querySelector("[data-hostname]");
    const target = node.querySelector("[data-target]");
    const created = node.querySelector("[data-created]");
    const copyBtn = node.querySelector(".copy-btn");

    hostname.textContent = `https://${tunnel.hostname}`;
    target.textContent = `Target: ${tunnel.targetUrl}`;
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
  renderTunnels(data.tunnels);
};

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const targetUrl = input.value.trim();
  if (!targetUrl) {
    return;
  }

  const response = await fetch("/api/tunnels", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ targetUrl })
  });

  if (handleUnauthorized(response)) {
    return;
  }

  if (response.ok) {
    input.value = "";
    await fetchTunnels();
  }
});

refreshBtn.addEventListener("click", fetchTunnels);

fetchTunnels();
