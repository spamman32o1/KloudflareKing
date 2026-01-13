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

const createTunnel = (targetUrl, { proxy, proxyType, tunnelName } = {}) => {
  const id = `tnl_${Math.random().toString(36).slice(2, 10)}`;
  const subdomain = `free-${id}`;
  const hostname = `${subdomain}.trycloudflare.com`;

  return {
    id,
    targetUrl,
    tunnelName: tunnelName || "Untitled campaign",
    proxy: proxy || null,
    proxyType: proxyType || null,
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

app.get("/api/tunnels", (req, res) => {
  res.json({ tunnels });
});

app.post("/api/tunnels", (req, res) => {
  const { targetUrl, proxies, proxyType, tunnelCount, tunnelName } = req.body;

  if (!targetUrl || typeof targetUrl !== "string") {
    return res.status(400).json({ error: "A valid target URL is required." });
  }

  if (!tunnelName || typeof tunnelName !== "string" || !tunnelName.trim()) {
    return res.status(400).json({ error: "A tunnel campaign name is required." });
  }

  const parsedCount = Number.parseInt(tunnelCount ?? 1, 10);
  if (!Number.isInteger(parsedCount) || parsedCount < 1 || parsedCount > 100) {
    return res
      .status(400)
      .json({ error: "Tunnel count must be an integer between 1 and 100." });
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

  for (let i = 0; i < parsedCount; i += 1) {
    const assignedProxy = proxyList.length
      ? proxyList[i % proxyList.length]
      : null;
    const tunnel = createTunnel(trimmedTarget, {
      proxy: assignedProxy,
      proxyType: normalizedProxyType,
      tunnelName: trimmedName
    });
    tunnels.unshift(tunnel);
    created.push(tunnel);
  }

  res.status(201).json({ tunnels: created });
});

app.listen(port, () => {
  console.log(`Tunnel manager running on http://localhost:${port}`);
});
