const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());

const configPath = path.join(__dirname, "config.json");
const loginConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));

const sessions = new Map();

const createTunnel = (
  targetUrl,
  {
    proxy,
    proxyType,
    tunnelName,
    tunnelType = "free",
    accountId,
    accountLabel,
    domainName,
    fullDomain,
    proxyRotation
  } = {}
) => {
  const id = `tnl_${Math.random().toString(36).slice(2, 10)}`;
  const hostname =
    tunnelType === "named" && fullDomain
      ? fullDomain
      : `free-${id}.trycloudflare.com`;

  return {
    id,
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
    hostname,
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
const cloudflareAccounts = [];

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
  cloudflareAccounts.find((account) => account.id === id);

app.get("/api/cloudflare/accounts", (req, res) => {
  res.json({ accounts: cloudflareAccounts });
});

app.post("/api/cloudflare/accounts", (req, res) => {
  const { label, email, accountId } = req.body;

  if (!label || typeof label !== "string" || !label.trim()) {
    return res.status(400).json({ error: "Account label is required." });
  }
  if (!email || typeof email !== "string" || !email.trim()) {
    return res.status(400).json({ error: "Account email is required." });
  }
  if (!accountId || typeof accountId !== "string" || !accountId.trim()) {
    return res.status(400).json({ error: "Cloudflare account ID is required." });
  }

  const trimmedLabel = label.trim();
  const trimmedEmail = email.trim();
  const trimmedAccountId = accountId.trim();
  const existing = cloudflareAccounts.find(
    (account) => account.accountId === trimmedAccountId
  );
  if (existing) {
    return res.status(409).json({ error: "That Cloudflare account already exists." });
  }

  const id = `acct_${Math.random().toString(36).slice(2, 10)}`;
  const loginUrl = `https://dash.cloudflare.com/login?account=${encodeURIComponent(
    trimmedAccountId
  )}`;
  const account = {
    id,
    label: trimmedLabel,
    email: trimmedEmail,
    accountId: trimmedAccountId,
    loginUrl,
    status: "pending",
    domains: [],
    createdAt: new Date().toISOString(),
    connectedAt: null
  };
  cloudflareAccounts.unshift(account);

  return res.status(201).json({ account });
});

app.post("/api/cloudflare/accounts/:id/login", (req, res) => {
  const account = getAccountById(req.params.id);
  if (!account) {
    return res.status(404).json({ error: "Cloudflare account not found." });
  }
  account.status = "connected";
  account.connectedAt = new Date().toISOString();
  return res.json({ account });
});

app.get("/api/cloudflare/accounts/:id/domains", (req, res) => {
  const account = getAccountById(req.params.id);
  if (!account) {
    return res.status(404).json({ error: "Cloudflare account not found." });
  }
  return res.json({ domains: account.domains });
});

app.post("/api/cloudflare/accounts/:id/domains", (req, res) => {
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
  if (account.domains.includes(normalized)) {
    return res.status(409).json({ error: "That domain is already added." });
  }
  account.domains.push(normalized);
  return res.status(201).json({ domains: account.domains });
});

app.get("/api/tunnels", (req, res) => {
  res.json({ tunnels });
});

app.post("/api/tunnels", (req, res) => {
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
    if (!account.domains.includes(normalizedDomain)) {
      return res.status(400).json({
        error: "Select a domain that exists on the connected account."
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
  for (let i = 0; i < total; i += 1) {
    const assignedProxy =
      selectedType === "free" && proxyList.length
        ? proxyList[i % proxyList.length]
        : null;
    const tunnel = createTunnel(trimmedTarget, {
      proxy: selectedType === "named" ? normalizedPrimaryProxy || null : assignedProxy,
      proxyType: normalizedProxyType,
      tunnelName: trimmedName,
      tunnelType: selectedType,
      accountId: account?.id ?? null,
      accountLabel: account?.label ?? null,
      domainName: normalizedDomain,
      fullDomain,
      proxyRotation: namedProxyRotation
    });
    tunnels.unshift(tunnel);
    created.push(tunnel);
  }

  res.status(201).json({ tunnels: created });
});

app.listen(port, () => {
  console.log(`Tunnel manager running on http://localhost:${port}`);
});
