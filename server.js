const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { startQuickTunnel } = require("./src/tunnels/cloudflared");
const {
  listAccounts,
  saveAccounts,
  sanitizeAccount,
  verifyToken,
  fetchAccountDetails,
  listZones,
  createTunnel: createCloudflareTunnel,
  createDnsRecord,
  findZoneForHostname
} = require("./src/cloudflare/api");

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());

const configPath = path.join(__dirname, "config.json");
const loginConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));

const sessions = new Map();

const createTunnelId = () =>
  `tnl_${Math.random().toString(36).slice(2, 10)}`;

const createTunnel = (
  targetUrl,
  {
    id,
    proxy,
    proxyType,
    tunnelName,
    tunnelType = "free",
    accountId,
    accountLabel,
    domainName,
    fullDomain,
    proxyRotation,
    hostname,
    processId
  } = {}
) => {
  const tunnelId = id || createTunnelId();
  const assignedHostname =
    hostname ||
    (tunnelType === "named" && fullDomain
      ? fullDomain
      : `free-${tunnelId}.trycloudflare.com`);

  return {
    id: tunnelId,
    targetUrl,
    tunnelName: tunnelName || "Untitled campaign",
    tunnelType,
    accountId: accountId || null,
    accountLabel: accountLabel || null,
    domainName: domainName || null,
    fullDomain: fullDomain || null,
    proxy: proxy || null,
    proxyType: proxyType || null,
    proxyRotation: proxyRotation || null,
    hostname: assignedHostname,
    processId: processId ?? null,
    status: "active",
    createdAt: new Date().toISOString()
  };
};

const parseCookies = (cookieHeader = "") =>
  cookieHeader.split(";").reduce((acc, part) => {
    const [key, ...rest] = part.trim().split("=");
    if (!key) {
      return acc;
    }
    acc[key] = decodeURIComponent(rest.join("="));
    return acc;
  }, {});

const isAuthenticated = (req) => {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies.auth_token;
  return token && sessions.has(token);
};

const authMiddleware = (req, res, next) => {
  const openPaths = new Set([
    "/login.html",
    "/login.js",
    "/login.css",
    "/api/login"
  ]);

  if (openPaths.has(req.path)) {
    return next();
  }

  if (isAuthenticated(req)) {
    return next();
  }

  if (req.path.startsWith("/api/")) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  return res.redirect("/login.html");
};

app.post("/api/login", (req, res) => {
  const { username, password } = req.body;

  if (
    username === loginConfig.username &&
    password === loginConfig.password
  ) {
    const token = crypto.randomBytes(24).toString("hex");
    sessions.set(token, { createdAt: Date.now() });
    res.setHeader(
      "Set-Cookie",
      `auth_token=${token}; HttpOnly; SameSite=Strict; Path=/`
    );
    return res.json({ ok: true });
  }

  return res.status(401).json({ error: "Invalid credentials." });
});

app.use(authMiddleware);
app.use(express.static("public"));

const tunnels = [];

const normalizeDomain = (value) =>
  value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/\.+$/, "")
    .replace(/^\.+/, "");

const isValidDomain = (value) =>
  /^([a-z0-9-]+\.)+[a-z0-9-]+$/i.test(value);

const getAccountById = (id) =>
  listAccounts().find((account) => account.id === id);

const updateAccount = (id, updater) => {
  const accounts = listAccounts();
  const index = accounts.findIndex((account) => account.id === id);
  if (index === -1) {
    return null;
  }
  const updated = updater(accounts[index]);
  accounts[index] = updated;
  saveAccounts(accounts);
  return updated;
};

app.get("/api/cloudflare/accounts", (req, res) => {
  const accounts = listAccounts().map(sanitizeAccount);
  res.json({ accounts });
});

app.post("/api/cloudflare/accounts", async (req, res) => {
  const { label, email, accountId, apiToken } = req.body;

  if (!label || typeof label !== "string" || !label.trim()) {
    return res.status(400).json({ error: "Account label is required." });
  }
  if (!email || typeof email !== "string" || !email.trim()) {
    return res.status(400).json({ error: "Account email is required." });
  }
  if (!accountId || typeof accountId !== "string" || !accountId.trim()) {
    return res.status(400).json({ error: "Cloudflare account ID is required." });
  }
  if (!apiToken || typeof apiToken !== "string" || !apiToken.trim()) {
    return res.status(400).json({ error: "Cloudflare API token is required." });
  }

  const trimmedLabel = label.trim();
  const trimmedEmail = email.trim();
  const trimmedAccountId = accountId.trim();
  const trimmedToken = apiToken.trim();
  const accounts = listAccounts();
  const existing = accounts.find(
    (account) => account.accountId === trimmedAccountId
  );
  if (existing) {
    return res.status(409).json({ error: "That Cloudflare account already exists." });
  }

  let zones = [];
  try {
    await verifyToken(trimmedToken);
    await fetchAccountDetails(trimmedAccountId, trimmedToken);
    zones = await listZones(trimmedAccountId, trimmedToken);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }

  const id = `acct_${Math.random().toString(36).slice(2, 10)}`;
  const account = {
    id,
    label: trimmedLabel,
    email: trimmedEmail,
    accountId: trimmedAccountId,
    apiToken: trimmedToken,
    status: "connected",
    zoneCount: zones.length,
    createdAt: new Date().toISOString(),
    connectedAt: new Date().toISOString()
  };
  accounts.unshift(account);
  saveAccounts(accounts);

  return res.status(201).json({ account: sanitizeAccount(account) });
});

app.post("/api/cloudflare/accounts/:id/login", async (req, res) => {
  const account = getAccountById(req.params.id);
  if (!account) {
    return res.status(404).json({ error: "Cloudflare account not found." });
  }

  try {
    const zones = await listZones(account.accountId, account.apiToken);
    const updated = updateAccount(account.id, (current) => ({
      ...current,
      status: "connected",
      zoneCount: zones.length,
      connectedAt: new Date().toISOString()
    }));
    return res.json({ account: sanitizeAccount(updated) });
  } catch (error) {
    const updated = updateAccount(account.id, (current) => ({
      ...current,
      status: "error"
    }));
    return res.status(400).json({
      error: error.message,
      account: updated ? sanitizeAccount(updated) : null
    });
  }
});

app.get("/api/cloudflare/accounts/:id/domains", async (req, res) => {
  const account = getAccountById(req.params.id);
  if (!account) {
    return res.status(404).json({ error: "Cloudflare account not found." });
  }
  try {
    const zones = await listZones(account.accountId, account.apiToken);
    const domains = zones.map((zone) => zone.name).sort();
    return res.json({ domains });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

app.post("/api/cloudflare/accounts/:id/domains", async (req, res) => {
  const account = getAccountById(req.params.id);
  if (!account) {
    return res.status(404).json({ error: "Cloudflare account not found." });
  }
  const { hostname } = req.body;
  if (!hostname || typeof hostname !== "string") {
    return res.status(400).json({ error: "Domain hostname is required." });
  }
  const normalized = normalizeDomain(hostname);
  if (!isValidDomain(normalized)) {
    return res.status(400).json({
      error: "Enter a valid domain like example.com or app.example.com."
    });
  }
  try {
    const zones = await listZones(account.accountId, account.apiToken);
    const matched = findZoneForHostname(normalized, zones);
    if (!matched) {
      return res.status(404).json({
        error: "That domain is not available on the connected Cloudflare account."
      });
    }
    return res.status(200).json({ domain: normalized, zoneId: matched.id });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

app.get("/api/tunnels", (req, res) => {
  res.json({ tunnels });
});

app.post("/api/tunnels", async (req, res) => {
  const {
    targetUrl,
    proxies,
    proxyType,
    tunnelCount,
    tunnelName,
    tunnelType,
    accountId,
    domainName,
    subdomain,
    primaryProxy,
    fallbackProxies
  } = req.body;

  if (!targetUrl || typeof targetUrl !== "string") {
    return res.status(400).json({ error: "A valid target URL is required." });
  }

  if (!tunnelName || typeof tunnelName !== "string" || !tunnelName.trim()) {
    return res.status(400).json({ error: "A tunnel campaign name is required." });
  }

  const selectedType = tunnelType === "named" ? "named" : "free";
  const parsedCount = Number.parseInt(tunnelCount ?? 1, 10);
  if (selectedType === "free") {
    if (!Number.isInteger(parsedCount) || parsedCount < 1 || parsedCount > 100) {
      return res
        .status(400)
        .json({ error: "Tunnel count must be an integer between 1 and 100." });
    }
  }

  const proxyList = Array.isArray(proxies)
    ? proxies
        .map((proxy) => (typeof proxy === "string" ? proxy.trim() : ""))
        .filter(Boolean)
    : [];
  const normalizedProxyType =
    typeof proxyType === "string" && proxyType.trim().length
      ? proxyType.trim()
      : null;
  const trimmedTarget = targetUrl.trim();
  const trimmedName = tunnelName.trim();
  const created = [];
  let account = null;
  let normalizedDomain = null;
  let fullDomain = null;

  let zoneId = null;
  let cloudflareTunnel = null;

  if (selectedType === "named") {
    if (!accountId || typeof accountId !== "string") {
      return res.status(400).json({ error: "A Cloudflare account is required." });
    }
    account = getAccountById(accountId);
    if (!account) {
      return res.status(404).json({ error: "Cloudflare account not found." });
    }
    if (account.status !== "connected") {
      return res.status(400).json({
        error: "Connect the Cloudflare account before creating named tunnels."
      });
    }
    if (!domainName || typeof domainName !== "string") {
      return res.status(400).json({ error: "A domain is required." });
    }
    normalizedDomain = normalizeDomain(domainName);
    if (!isValidDomain(normalizedDomain)) {
      return res.status(400).json({
        error: "Select a valid domain from the connected account."
      });
    }
    const normalizedSubdomain =
      typeof subdomain === "string"
        ? subdomain.trim().replace(/^\.+/, "").replace(/\.+$/, "")
        : "";
    if (normalizedSubdomain) {
      fullDomain = `${normalizedSubdomain}.${normalizedDomain}`.replace(
        /^\.+/,
        ""
      );
    } else {
      fullDomain = normalizedDomain;
    }

    try {
      const zones = await listZones(account.accountId, account.apiToken);
      const zone = findZoneForHostname(fullDomain || normalizedDomain, zones);
      if (!zone) {
        return res.status(400).json({
          error: "Select a domain that exists on the connected account."
        });
      }
      zoneId = zone.id;
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
  }

  const normalizedPrimaryProxy =
    typeof primaryProxy === "string" ? primaryProxy.trim() : "";
  const fallbackList = Array.isArray(fallbackProxies)
    ? fallbackProxies
        .map((proxy) => (typeof proxy === "string" ? proxy.trim() : ""))
        .filter(Boolean)
    : [];
  const namedProxyRotation =
    selectedType === "named" &&
    (normalizedPrimaryProxy || fallbackList.length)
      ? {
          strategy: "failover",
          failureThreshold: 3,
          activeProxy: normalizedPrimaryProxy || fallbackList[0] || null,
          fallbackProxies: fallbackList
        }
      : null;

  const total = selectedType === "named" ? 1 : parsedCount;
  try {
    for (let i = 0; i < total; i += 1) {
      const assignedProxy =
        selectedType === "free" && proxyList.length
          ? proxyList[i % proxyList.length]
          : null;
      let tunnelId = createTunnelId();
      let hostname = null;
      let processId = null;

      if (selectedType === "free") {
        const cloudflared = await startQuickTunnel({
          id: tunnelId,
          targetUrl: trimmedTarget,
          noAutoupdate: true
        });
        hostname = cloudflared.hostname;
        processId = cloudflared.pid;
      }
      if (selectedType === "named") {
        const tunnelNameLabel = `${trimmedName}-${Date.now()}`;
        cloudflareTunnel =
          cloudflareTunnel ||
          (await createCloudflareTunnel(
            account.accountId,
            account.apiToken,
            tunnelNameLabel
          ));
        tunnelId = cloudflareTunnel.id;
        const record = {
          type: "CNAME",
          name: fullDomain,
          content: `${tunnelId}.cfargotunnel.com`,
          ttl: 1,
          proxied: true
        };
        await createDnsRecord(zoneId, account.apiToken, record);
        hostname = fullDomain;
      }

      const tunnel = createTunnel(trimmedTarget, {
        id: tunnelId,
        proxy: selectedType === "named" ? normalizedPrimaryProxy || null : assignedProxy,
        proxyType: normalizedProxyType,
        tunnelName: trimmedName,
        tunnelType: selectedType,
        accountId: account?.id ?? null,
        accountLabel: account?.label ?? null,
        domainName: normalizedDomain,
        fullDomain,
        proxyRotation: namedProxyRotation,
        hostname,
        processId
      });
      tunnels.unshift(tunnel);
      created.push(tunnel);
    }
  } catch (error) {
    return res.status(500).json({
      error: "Failed to start cloudflared tunnel.",
      details: error.message
    });
  }

  res.status(201).json({ tunnels: created });
});

app.listen(port, () => {
  console.log(`Tunnel manager running on http://localhost:${port}`);
});
