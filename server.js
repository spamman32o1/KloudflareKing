const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { startQuickTunnel, stopTunnel } = require("./src/tunnels/cloudflared");
const { logError } = require("./src/utils/logger");
const {
  ensureUserStore,
  listUsers,
  saveUsers,
  sanitizeUser,
  findUserByUsername
} = require("./src/users/store");
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
const defaultAdmin = {
  id: `user_${crypto.randomBytes(6).toString("hex")}`,
  username: loginConfig.username,
  password: loginConfig.password,
  role: "admin",
  createdAt: new Date().toISOString()
};
ensureUserStore(defaultAdmin);

const sessions = new Map();

process.on("unhandledRejection", (error) => {
  logError(error, "unhandledRejection");
});

process.on("uncaughtException", (error) => {
  logError(error, "uncaughtException");
  process.exit(1);
});

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

const getSession = (req) => {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies.auth_token;
  if (!token || !sessions.has(token)) {
    return null;
  }
  return sessions.get(token);
};

const resolveSessionUser = (req) => {
  const session = getSession(req);
  if (!session) {
    return null;
  }
  const user = findUserByUsername(session.username);
  if (!user) {
    return null;
  }
  session.role = user.role;
  return { ...session, role: user.role, id: user.id };
};

const isAuthenticated = (req) => !!resolveSessionUser(req);

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

  const sessionUser = resolveSessionUser(req);
  if (sessionUser) {
    if (req.path === "/users.html" && sessionUser.role !== "admin") {
      return res.redirect("/index.html");
    }
    return next();
  }

  if (req.path.startsWith("/api/")) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  return res.redirect("/login.html");
};

app.post("/api/login", (req, res) => {
  const { username, password } = req.body;

  const user = findUserByUsername(username);
  if (user && user.password === password) {
    const token = crypto.randomBytes(24).toString("hex");
    sessions.set(token, {
      createdAt: Date.now(),
      username: user.username,
      role: user.role
    });
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

app.get("/api/session", (req, res) => {
  const sessionUser = resolveSessionUser(req);
  if (!sessionUser) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  return res.json({
    user: sanitizeUser({
      id: sessionUser.id,
      username: sessionUser.username,
      role: sessionUser.role
    })
  });
});

const requireAdmin = (req, res, next) => {
  const sessionUser = resolveSessionUser(req);
  if (!sessionUser) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  if (sessionUser.role !== "admin") {
    return res.status(403).json({ error: "Admin access required." });
  }
  return next();
};

const allowedRoles = new Set(["admin", "user"]);

app.get("/api/users", requireAdmin, (req, res) => {
  const users = listUsers().map(sanitizeUser);
  res.json({ users });
});

app.post("/api/users", requireAdmin, (req, res) => {
  const { username, password, role } = req.body;
  if (!username || typeof username !== "string" || !username.trim()) {
    return res.status(400).json({ error: "Username is required." });
  }
  if (!password || typeof password !== "string" || !password.trim()) {
    return res.status(400).json({ error: "Password is required." });
  }
  if (!role || !allowedRoles.has(role)) {
    return res.status(400).json({ error: "Role must be admin or user." });
  }
  const trimmedUsername = username.trim();
  const users = listUsers();
  if (users.some((user) => user.username === trimmedUsername)) {
    return res.status(409).json({ error: "Username already exists." });
  }
  const user = {
    id: `user_${crypto.randomBytes(6).toString("hex")}`,
    username: trimmedUsername,
    password: password.trim(),
    role,
    createdAt: new Date().toISOString()
  };
  users.unshift(user);
  saveUsers(users);
  return res.status(201).json({ user: sanitizeUser(user) });
});

app.put("/api/users/:id", requireAdmin, (req, res) => {
  const { role, password } = req.body;
  if (!role && !password) {
    return res.status(400).json({ error: "Provide a role or password update." });
  }
  if (role && !allowedRoles.has(role)) {
    return res.status(400).json({ error: "Role must be admin or user." });
  }
  if (password && (typeof password !== "string" || !password.trim())) {
    return res.status(400).json({ error: "Password cannot be empty." });
  }
  const users = listUsers();
  const index = users.findIndex((user) => user.id === req.params.id);
  if (index === -1) {
    return res.status(404).json({ error: "User not found." });
  }
  const updated = {
    ...users[index],
    role: role || users[index].role,
    password: password ? password.trim() : users[index].password,
    updatedAt: new Date().toISOString()
  };
  users[index] = updated;
  saveUsers(users);
  return res.json({ user: sanitizeUser(updated) });
});

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
    logError(error, "POST /api/cloudflare/accounts");
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
    logError(error, `POST /api/cloudflare/accounts/${account.id}/login`);
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
    logError(error, `GET /api/cloudflare/accounts/${account.id}/domains`);
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
    logError(error, `POST /api/cloudflare/accounts/${account.id}/domains`);
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
      logError(error, "POST /api/tunnels (list zones)");
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
    logError(error, "POST /api/tunnels (create)");
    return res.status(500).json({
      error: "Failed to start cloudflared tunnel.",
      details: error.message
    });
  }

  res.status(201).json({ tunnels: created });
});

app.delete("/api/tunnels/:id", (req, res) => {
  const index = tunnels.findIndex((tunnel) => tunnel.id === req.params.id);
  if (index === -1) {
    return res.status(404).json({ error: "Tunnel not found." });
  }
  const [removed] = tunnels.splice(index, 1);
  if (removed.tunnelType === "free") {
    stopTunnel(removed.id);
  }
  return res.json({ deleted: 1 });
});

app.delete("/api/campaigns/:name", (req, res) => {
  const decodedName = decodeURIComponent(req.params.name || "");
  const matching = tunnels.filter(
    (tunnel) =>
      (tunnel.tunnelName?.trim() || "Untitled campaign") === decodedName
  );
  if (!matching.length) {
    return res.status(404).json({ error: "Campaign not found." });
  }
  matching.forEach((tunnel) => {
    if (tunnel.tunnelType === "free") {
      stopTunnel(tunnel.id);
    }
  });
  const remaining = tunnels.filter(
    (tunnel) =>
      (tunnel.tunnelName?.trim() || "Untitled campaign") !== decodedName
  );
  tunnels.length = 0;
  tunnels.push(...remaining);
  return res.json({ deleted: matching.length });
});

app.use((err, req, res, next) => {
  logError(err, `${req.method} ${req.path}`);
  res.status(500).json({ error: "Internal server error." });
});

app.listen(port, () => {
  console.log(`Tunnel manager running on http://localhost:${port}`);
});
