const form = document.querySelector("#tunnel-form");
const nameInput = document.querySelector("#tunnel-name");
const targetInput = document.querySelector("#target-url");
const tunnelCountInput = document.querySelector("#tunnel-count");
const proxyTypeInput = document.querySelector("#proxy-type");
const proxyFileInput = document.querySelector("#proxy-file");
const proxyListInput = document.querySelector("#proxy-list");

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

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const tunnelName = nameInput.value.trim();
  const targetUrl = targetInput.value.trim();

  if (!tunnelName || !targetUrl) {
    return;
  }

  const tunnelCount = Number.parseInt(tunnelCountInput.value, 10);
  const proxies = parseProxyList(proxyListInput.value);
  const proxyType = proxyTypeInput.value;

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
      proxyType
    })
  });

  if (handleUnauthorized(response)) {
    return;
  }

  if (response.ok) {
    window.location.href = `/tunnel.html?name=${encodeURIComponent(tunnelName)}`;
  }
});
