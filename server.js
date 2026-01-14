const express = require("express");
const fs = require("fs");
const path = require("path");
const net = require("net");
const crypto = require("crypto");
const { execFile, spawn } = require("child_process");
const multer = require("multer");
const { startQuickTunnel, stopTunnel } = require("./src/tunnels/cloudflared");
const {
  startCloudflaredLogin,
  getLoginStatus
} = require("./src/tunnels/cloudflared-auth");
const { logError } = require("./src/utils/logger");
const {
  ensureUserStore,
  listUsers,
  saveUsers,
  sanitizeUser,
  findUserByUsername
} = require("./src/users/store");
const {
  listProjects,
  saveProjects,
  findProjectById
} = require("./src/projects/store");
  const {
  listAccounts,
  saveAccounts,
  sanitizeAccount,
  verifyToken,
  listZones,
  createTunnel: createCloudflareTunnel,
  createDnsRecord,
  findZoneForHostname
} = require("./src/cloudflare/api");
const { listTunnels, saveTunnels } = require("./src/tunnels/store");

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());

const uploadRoot = path.join(__dirname, "uploads");
const deploymentRoot = path.join(__dirname, "deployments");
const projectRoot = path.join(__dirname, "projects");
fs.mkdirSync(uploadRoot, { recursive: true });
fs.mkdirSync(deploymentRoot, { recursive: true });
fs.mkdirSync(projectRoot, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: uploadRoot,
    filename: (req, file, cb) => {
      const safeName = path
        .basename(file.originalname)
        .replace(/[^\w.-]/g, "_");
      cb(null, `${Date.now()}-${crypto.randomBytes(4).toString("hex")}-${safeName}`);
    }
  }),
  limits: { fileSize: 200 * 1024 * 1024 }
});

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

const generateCampaignName = () => {
  const timestamp = new Date()
    .toISOString()
    .replace("T", " ")
    .replace("Z", "")
    .replace(/:/g, "-");
  return `Campaign ${timestamp}-${crypto.randomBytes(2).toString("hex")}`;
};

const generateProjectName = () => {
  const timestamp = new Date()
    .toISOString()
    .replace("T", " ")
    .replace("Z", "")
    .replace(/:/g, "-");
  return `Project ${timestamp}-${crypto.randomBytes(2).toString("hex")}`;
};

const cloudflaredCertRoot = path.join(__dirname, "data", "cloudflared");

const buildCloudflaredCertPath = (accountId) =>
  path.join(cloudflaredCertRoot, `${accountId}.pem`);

const runCloudflaredCommand = (args, envOverrides = {}) =>
  new Promise((resolve, reject) => {
    execFile(
      "cloudflared",
      args,
      { env: { ...process.env, ...envOverrides } },
      (error, stdout, stderr) => {
        if (error) {
          error.stdout = stdout;
          error.stderr = stderr;
          reject(error);
          return;
        }
        resolve({ stdout, stderr });
      }
    );
  });

const parseTunnelId = (text) => {
  const match = text.match(
    /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i
  );
  return match ? match[1] : null;
};

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
    processId,
    deploymentId
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
    deploymentId: deploymentId ?? null,
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
const deployments = new Map();

const runCommand = (command, args, options = {}) =>
  new Promise((resolve, reject) => {
    execFile(command, args, options, (error, stdout, stderr) => {
      if (error) {
        const commandError = new Error(stderr || error.message);
        commandError.stdout = stdout;
        commandError.stderr = stderr;
        return reject(commandError);
      }
      return resolve({ stdout, stderr });
    });
  });

const sanitizeUploadName = (name) =>
  path.basename(name).replace(/[^\w.-]/g, "_");

const isUnsafeZipEntry = (entryName) => {
  const normalized = path.posix.normalize(
    entryName.replace(/\\/g, "/")
  );
  if (path.posix.isAbsolute(normalized)) {
    return true;
  }
  if (normalized.startsWith("..")) {
    return true;
  }
  return normalized.split("/").includes("..");
};

const assertSafeZip = async (zipPath) => {
  const { stdout } = await runCommand("unzip", ["-Z", "-1", zipPath]);
  const entries = stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (!entries.length) {
    throw new Error("The zip archive contains no files.");
  }
  const unsafeEntry = entries.find((entry) => isUnsafeZipEntry(entry));
  if (unsafeEntry) {
    throw new Error("Zip archive contains unsafe paths.");
  }
};

const getAvailablePort = () =>
  new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, () => {
      const { port: assigned } = server.address();
      server.close(() => resolve(assigned));
    });
    server.on("error", reject);
  });

const resolveAppRoot = (rootDir) => {
  const entries = fs.readdirSync(rootDir, { withFileTypes: true });
  const folders = entries.filter((entry) => entry.isDirectory());
  const files = entries.filter((entry) => entry.isFile());
  if (files.length === 0 && folders.length === 1) {
    return path.join(rootDir, folders[0].name);
  }
  return rootDir;
};

const findStartupFile = (rootDir) => {
  const candidates = ["server.js", "app.js", "index.js", path.join("src", "index.js")];
  const match = candidates.find((candidate) =>
    fs.existsSync(path.join(rootDir, candidate))
  );
  return match || null;
};

const startDeployment = async ({ rootDir, startupScript, fixedPort }) => {
  const appRoot = resolveAppRoot(rootDir);
  const hasPackageLock = fs.existsSync(path.join(appRoot, "package-lock.json"));
  const port = fixedPort || (await getAvailablePort());
  const env = {
    ...process.env,
    PORT: String(port),
    HOST: "0.0.0.0"
  };

  let child;
  let commandLabel;
  let type;

  if (hasPackageLock) {
    if (startupScript) {
      child = spawn(startupScript, {
        cwd: appRoot,
        env,
        shell: true,
        stdio: "ignore"
      });
      commandLabel = startupScript;
      type = "script";
    } else {
      const startupFile = findStartupFile(appRoot);
      if (!startupFile) {
        throw new Error(
          "Unable to detect a startup file. Provide a startup script."
        );
      }
      child = spawn("node", [startupFile], {
        cwd: appRoot,
        env,
        stdio: "ignore"
      });
      commandLabel = `node ${startupFile}`;
      type = "node";
    }
  } else {
    child = spawn("php", ["-S", `0.0.0.0:${port}`, "-t", appRoot], {
      cwd: appRoot,
      env,
      stdio: "ignore"
    });
    commandLabel = "php -S";
    type = "php";
  }

  child.unref();

  return {
    rootDir: appRoot,
    port,
    process: child,
    targetUrl: `http://localhost:${port}`,
    command: commandLabel,
    type
  };
};

const stopDeploymentProcess = (deployment) => {
  if (deployment?.process && !deployment.process.killed) {
    deployment.process.kill();
  }
};

const stopDeployment = (deploymentId) => {
  const resolved = resolveDeploymentDirs(deploymentId);
  if (!resolved) {
    return;
  }
  stopDeploymentProcess(resolved.deployment);
  deployments.delete(deploymentId);
  try {
    fs.rmSync(resolved.baseDir, { recursive: true, force: true });
  } catch (error) {
    logError(error, `remove deployment ${deploymentId}`);
  }
};

const resolveDeploymentDirs = (deploymentId) => {
  const deployment = deployments.get(deploymentId);
  if (!deployment) {
    return null;
  }
  const baseDir = path.resolve(
    deployment.baseDir || path.join(deploymentRoot, deploymentId)
  );
  const rootDir = path.resolve(deployment.rootDir || baseDir);
  const rootScope = path.resolve(deploymentRoot);
  if (!baseDir.startsWith(rootScope) || !rootDir.startsWith(rootScope)) {
    return null;
  }
  return { deployment, baseDir, rootDir };
};

const resolveDeploymentFilePath = (rootDir, filePath) => {
  if (!filePath || typeof filePath !== "string") {
    return null;
  }
  const normalized = filePath.replace(/\\/g, "/");
  const resolved = path.resolve(rootDir, normalized);
  const relative = path.relative(rootDir, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return null;
  }
  return { resolved, relative: relative.split(path.sep).join("/") };
};

const resolveProjectDir = (projectId) => {
  if (!projectId || typeof projectId !== "string") {
    return null;
  }
  const resolved = path.resolve(path.join(projectRoot, projectId));
  const rootScope = path.resolve(projectRoot);
  if (!resolved.startsWith(rootScope)) {
    return null;
  }
  return resolved;
};

const stageUploadFiles = async (uploaded, destinationDir) => {
  if (
    uploaded.length === 1 &&
    path.extname(uploaded[0].originalname).toLowerCase() === ".zip"
  ) {
    await assertSafeZip(uploaded[0].path);
    await runCommand("unzip", ["-o", uploaded[0].path, "-d", destinationDir]);
    fs.unlinkSync(uploaded[0].path);
    return;
  }

  uploaded.forEach((file) => {
    const target = path.join(destinationDir, sanitizeUploadName(file.originalname));
    fs.renameSync(file.path, target);
  });
};

const copyProjectFiles = (projectId, destinationDir) => {
  const projectDir = resolveProjectDir(projectId);
  if (!projectDir || !fs.existsSync(projectDir)) {
    return false;
  }
  fs.cpSync(projectDir, destinationDir, { recursive: true });
  return true;
};

const listDeploymentFiles = (rootDir) => {
  const results = [];
  const stack = [rootDir];
  while (stack.length) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    entries.forEach((entry) => {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile()) {
        results.push(path.relative(rootDir, fullPath).split(path.sep).join("/"));
      }
    });
  }
  return results.sort();
};

app.get("/api/projects", (req, res) => {
  res.json({ projects: listProjects() });
});

app.post("/api/projects", upload.array("files"), async (req, res) => {
  const uploaded = req.files || [];
  if (!uploaded.length) {
    return res.status(400).json({ error: "Upload a zip or project files to save." });
  }
  const projectName =
    typeof req.body.projectName === "string" ? req.body.projectName.trim() : "";
  const resolvedProjectName = projectName || generateProjectName();
  const startupScript =
    typeof req.body.startupScript === "string" ? req.body.startupScript.trim() : "";

  const projectId = `prj_${crypto.randomBytes(6).toString("hex")}`;
  const projectDir = path.join(projectRoot, projectId);
  fs.mkdirSync(projectDir, { recursive: true });

  try {
    await stageUploadFiles(uploaded, projectDir);
    const projects = listProjects();
    const project = {
      id: projectId,
      name: resolvedProjectName,
      startupScript: startupScript || null,
      createdAt: new Date().toISOString()
    };
    projects.unshift(project);
    saveProjects(projects);
    return res.status(201).json({ project });
  } catch (error) {
    logError(error, "POST /api/projects");
    try {
      fs.rmSync(projectDir, { recursive: true, force: true });
    } catch (cleanupError) {
      logError(cleanupError, `remove project ${projectId}`);
    }
    return res.status(500).json({
      error: "Failed to save the project.",
      details: error.message
    });
  }
});

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
  const { label, email, accountId, apiToken, authType } = req.body;
  const normalizedAuthType =
    authType === "cloudflared" ? "cloudflared" : "token";

  if (!label || typeof label !== "string" || !label.trim()) {
    return res.status(400).json({ error: "Account label is required." });
  }
  if (
    normalizedAuthType === "token" &&
    (!email || typeof email !== "string" || !email.trim())
  ) {
    return res.status(400).json({ error: "Account email is required." });
  }
  if (
    normalizedAuthType === "token" &&
    (!accountId || typeof accountId !== "string" || !accountId.trim())
  ) {
    return res.status(400).json({ error: "Cloudflare account ID is required." });
  }
  if (
    normalizedAuthType === "token" &&
    (!apiToken || typeof apiToken !== "string" || !apiToken.trim())
  ) {
    return res.status(400).json({ error: "Cloudflare API token is required." });
  }

  const trimmedLabel = label.trim();
  const trimmedEmail =
    typeof email === "string" && email.trim() ? email.trim() : null;
  const trimmedAccountId =
    typeof accountId === "string" && accountId.trim() ? accountId.trim() : null;
  const trimmedToken =
    typeof apiToken === "string" && apiToken.trim() ? apiToken.trim() : null;
  const accounts = listAccounts();
  if (trimmedAccountId) {
    const existing = accounts.find(
      (account) => account.accountId === trimmedAccountId
    );
    if (existing) {
      return res
        .status(409)
        .json({ error: "That Cloudflare account already exists." });
    }
  }

  let zones = [];
  if (normalizedAuthType === "token") {
    try {
      await verifyToken(trimmedToken);
    } catch (error) {
      logError(error, "POST /api/cloudflare/accounts");
      return res.status(error.status || 400).json({ error: error.message });
    }

    try {
      zones = await listZones(trimmedAccountId, trimmedToken);
    } catch (error) {
      logError(error, "POST /api/cloudflare/accounts");
      return res.status(error.status || 403).json({ error: error.message });
    }
  }

  const id = `acct_${Math.random().toString(36).slice(2, 10)}`;
  const account = {
    id,
    label: trimmedLabel,
    email: trimmedEmail,
    accountId: trimmedAccountId,
    apiToken: trimmedToken,
    authType: normalizedAuthType,
    certPath:
      normalizedAuthType === "cloudflared" ? buildCloudflaredCertPath(id) : null,
    status: normalizedAuthType === "token" ? "connected" : "pending",
    zoneCount: zones.length,
    createdAt: new Date().toISOString(),
    connectedAt: normalizedAuthType === "token" ? new Date().toISOString() : null
  };
  accounts.unshift(account);
  saveAccounts(accounts);

  return res.status(201).json({ account: sanitizeAccount(account) });
});

app.post("/api/cloudflare/login/start", async (req, res) => {
  const { accountId } = req.body;
  if (!accountId || typeof accountId !== "string") {
    return res.status(400).json({ error: "Account id is required." });
  }
  const account = getAccountById(accountId);
  if (!account) {
    return res.status(404).json({ error: "Cloudflare account not found." });
  }
  if (account.authType !== "cloudflared") {
    return res.status(400).json({ error: "This account does not use browser login." });
  }

  const certPath = account.certPath || buildCloudflaredCertPath(account.id);
  const sessionId = `login_${account.id}_${Date.now()}`;

  const updated = updateAccount(account.id, (current) => ({
    ...current,
    certPath,
    status: "pending",
    lastLoginSessionId: sessionId
  }));

  try {
    const login = await startCloudflaredLogin({ sessionId, certPath });
    return res.json({
      account: sanitizeAccount(updated),
      login
    });
  } catch (error) {
    logError(error, "POST /api/cloudflare/login/start");
    updateAccount(account.id, (current) => ({
      ...current,
      status: "error"
    }));
    return res.status(500).json({
      error: "Failed to start the Cloudflare browser login.",
      details: error.message
    });
  }
});

app.get("/api/cloudflare/login/status", (req, res) => {
  const accountId = typeof req.query.accountId === "string" ? req.query.accountId : "";
  if (!accountId) {
    return res.status(400).json({ error: "Account id is required." });
  }
  const account = getAccountById(accountId);
  if (!account) {
    return res.status(404).json({ error: "Cloudflare account not found." });
  }
  if (account.authType !== "cloudflared") {
    return res.status(400).json({ error: "This account does not use browser login." });
  }

  const login = account.lastLoginSessionId
    ? getLoginStatus(account.lastLoginSessionId)
    : null;

  let nextAccount = account;
  if (login?.status === "connected") {
    nextAccount = updateAccount(account.id, (current) => ({
      ...current,
      status: "connected",
      connectedAt: current.connectedAt || new Date().toISOString()
    }));
  } else if (login?.status === "error") {
    nextAccount = updateAccount(account.id, (current) => ({
      ...current,
      status: "error"
    }));
  } else if (
    !login &&
    account.certPath &&
    fs.existsSync(account.certPath)
  ) {
    nextAccount = updateAccount(account.id, (current) => ({
      ...current,
      status: "connected",
      connectedAt: current.connectedAt || new Date().toISOString()
    }));
  }

  return res.json({
    account: sanitizeAccount(nextAccount),
    login: login || {
      sessionId: account.lastLoginSessionId || null,
      status: nextAccount.status || "pending"
    }
  });
});

app.post("/api/cloudflare/accounts/:id/login", async (req, res) => {
  const account = getAccountById(req.params.id);
  if (!account) {
    return res.status(404).json({ error: "Cloudflare account not found." });
  }

  if (account.authType === "cloudflared") {
    const hasCert = account.certPath && fs.existsSync(account.certPath);
    if (!hasCert) {
      const updated = updateAccount(account.id, (current) => ({
        ...current,
        status: "error"
      }));
      return res.status(400).json({
        error: "Cloudflared certificate missing. Start browser login first.",
        account: sanitizeAccount(updated)
      });
    }

    const updated = updateAccount(account.id, (current) => ({
      ...current,
      status: "connected",
      connectedAt: current.connectedAt || new Date().toISOString()
    }));
    return res.json({ account: sanitizeAccount(updated) });
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
  if (account.authType === "cloudflared" && !account.apiToken) {
    return res.status(400).json({
      error: "Domains require an API token. Add a token-auth account for zones."
    });
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
  if (account.authType === "cloudflared" && !account.apiToken) {
    return res.status(400).json({
      error: "Domains require an API token. Add a token-auth account for zones."
    });
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

app.post("/api/deployments", upload.array("files"), async (req, res) => {
  const uploaded = req.files || [];
  const projectId =
    typeof req.body.projectId === "string" ? req.body.projectId.trim() : "";
  if (!uploaded.length && !projectId) {
    return res
      .status(400)
      .json({ error: "Upload a zip, project files, or select a saved project." });
  }
  const selectedProject = projectId ? findProjectById(projectId) : null;
  if (projectId && !selectedProject) {
    return res.status(404).json({ error: "Saved project not found." });
  }
  const startupScript =
    typeof req.body.startupScript === "string" ? req.body.startupScript.trim() : "";
  const deploymentId = `app_${crypto.randomBytes(6).toString("hex")}`;
  const deploymentDir = path.join(deploymentRoot, deploymentId);
  fs.mkdirSync(deploymentDir, { recursive: true });

  try {
    if (selectedProject) {
      const copied = copyProjectFiles(selectedProject.id, deploymentDir);
      if (!copied) {
        fs.rmSync(deploymentDir, { recursive: true, force: true });
        return res.status(404).json({ error: "Saved project files are missing." });
      }
    } else {
      await stageUploadFiles(uploaded, deploymentDir);
    }

    const resolvedStartupScript =
      startupScript || selectedProject?.startupScript || null;
    const deployment = await startDeployment({
      rootDir: deploymentDir,
      startupScript: resolvedStartupScript
    });
    deployments.set(deploymentId, {
      ...deployment,
      id: deploymentId,
      baseDir: deploymentDir,
      startupScript: resolvedStartupScript
    });

    return res.status(201).json({
      deploymentId,
      targetUrl: deployment.targetUrl,
      port: deployment.port,
      type: deployment.type
    });
  } catch (error) {
    logError(error, "POST /api/deployments");
    return res.status(500).json({
      error: "Failed to start the deployment.",
      details: error.message
    });
  }
});

app.get("/api/deployments/:id/files", (req, res) => {
  const resolved = resolveDeploymentDirs(req.params.id);
  if (!resolved) {
    return res.status(404).json({ error: "Deployment not found." });
  }
  try {
    const files = listDeploymentFiles(resolved.rootDir);
    return res.json({ files });
  } catch (error) {
    logError(error, "GET /api/deployments/:id/files");
    return res.status(500).json({ error: "Failed to read deployment files." });
  }
});

app.get("/api/deployments/:id/file", (req, res) => {
  const resolved = resolveDeploymentDirs(req.params.id);
  if (!resolved) {
    return res.status(404).json({ error: "Deployment not found." });
  }
  const filePath = resolveDeploymentFilePath(resolved.rootDir, req.query.path);
  if (!filePath) {
    return res.status(400).json({ error: "Provide a valid file path." });
  }
  try {
    const stats = fs.statSync(filePath.resolved);
    if (!stats.isFile()) {
      return res.status(400).json({ error: "Path must point to a file." });
    }
    if (stats.size > 200 * 1024) {
      return res.status(413).json({ error: "File is too large to edit." });
    }
    const contents = fs.readFileSync(filePath.resolved, "utf-8");
    return res.json({ path: filePath.relative, contents });
  } catch (error) {
    logError(error, "GET /api/deployments/:id/file");
    return res.status(500).json({ error: "Failed to read the file." });
  }
});

app.put("/api/deployments/:id/file", (req, res) => {
  const resolved = resolveDeploymentDirs(req.params.id);
  if (!resolved) {
    return res.status(404).json({ error: "Deployment not found." });
  }
  const { path: filePath, contents } = req.body || {};
  if (typeof contents !== "string") {
    return res.status(400).json({ error: "File contents must be text." });
  }
  const resolvedPath = resolveDeploymentFilePath(resolved.rootDir, filePath);
  if (!resolvedPath) {
    return res.status(400).json({ error: "Provide a valid file path." });
  }
  try {
    if (!fs.existsSync(resolvedPath.resolved)) {
      return res.status(404).json({ error: "File not found." });
    }
    fs.writeFileSync(resolvedPath.resolved, contents, "utf-8");
    return res.json({ ok: true });
  } catch (error) {
    logError(error, "PUT /api/deployments/:id/file");
    return res.status(500).json({ error: "Failed to save the file." });
  }
});

app.post("/api/deployments/:id/replace", upload.array("files"), async (req, res) => {
  const resolved = resolveDeploymentDirs(req.params.id);
  if (!resolved) {
    return res.status(404).json({ error: "Deployment not found." });
  }
  const uploaded = req.files || [];
  if (!uploaded.length) {
    return res.status(400).json({ error: "Upload a zip or project files to replace." });
  }

  try {
    stopDeploymentProcess(resolved.deployment);
    fs.rmSync(resolved.baseDir, { recursive: true, force: true });
    fs.mkdirSync(resolved.baseDir, { recursive: true });

    if (
      uploaded.length === 1 &&
      path.extname(uploaded[0].originalname).toLowerCase() === ".zip"
    ) {
      await assertSafeZip(uploaded[0].path);
      await runCommand("unzip", ["-o", uploaded[0].path, "-d", resolved.baseDir]);
      fs.unlinkSync(uploaded[0].path);
    } else {
      uploaded.forEach((file) => {
        const target = path.join(resolved.baseDir, sanitizeUploadName(file.originalname));
        fs.renameSync(file.path, target);
      });
    }

    const deployment = await startDeployment({
      rootDir: resolved.baseDir,
      startupScript: resolved.deployment.startupScript || null,
      fixedPort: resolved.deployment.port
    });

    deployments.set(req.params.id, {
      ...deployment,
      id: req.params.id,
      baseDir: resolved.baseDir,
      startupScript: resolved.deployment.startupScript || null
    });

    return res.json({
      deploymentId: req.params.id,
      targetUrl: deployment.targetUrl,
      port: deployment.port,
      type: deployment.type
    });
  } catch (error) {
    logError(error, "POST /api/deployments/:id/replace");
    return res.status(500).json({
      error: "Failed to replace the deployment.",
      details: error.message
    });
  }
});

app.get("/api/tunnels", (req, res) => {
  res.json({ tunnels: listTunnels() });
});

app.post("/api/tunnels", async (req, res) => {
  const {
    targetUrl,
    deploymentId,
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

  const trimmedTarget =
    typeof targetUrl === "string" ? targetUrl.trim() : "";
  const resolvedTargetUrl =
    trimmedTarget ||
    (deploymentId && deployments.get(deploymentId)?.targetUrl) ||
    "";
  if (!resolvedTargetUrl) {
    return res.status(400).json({
      error: "Provide a target URL or deploy an app before creating tunnels."
    });
  }

  const requestedName = typeof tunnelName === "string" ? tunnelName.trim() : "";
  const trimmedName = requestedName || generateCampaignName();

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
  const created = [];
  const storedTunnels = listTunnels();
  let account = null;
  let normalizedDomain = null;
  let fullDomain = null;

  let zoneId = null;
  let cloudflareTunnel = null;
  let usesCloudflaredAuth = false;

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
    usesCloudflaredAuth = account.authType === "cloudflared";

    if (!usesCloudflaredAuth) {
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
          targetUrl: resolvedTargetUrl,
          noAutoupdate: true
        });
        hostname = cloudflared.hostname;
        processId = cloudflared.pid;
      }
      if (selectedType === "named") {
        const tunnelNameLabel = `${trimmedName}-${Date.now()}`;
        if (usesCloudflaredAuth) {
          if (!account.certPath || !fs.existsSync(account.certPath)) {
            throw new Error(
              "Cloudflared certificate missing. Connect the account first."
            );
          }
          const createResult = await runCloudflaredCommand(
            ["tunnel", "create", tunnelNameLabel],
            { TUNNEL_ORIGIN_CERT: account.certPath }
          );
          const createdId = parseTunnelId(
            `${createResult.stdout}\n${createResult.stderr}`
          );
          if (!createdId) {
            throw new Error("Failed to parse tunnel id from cloudflared output.");
          }
          tunnelId = createdId;
          cloudflareTunnel = { id: createdId };
          await runCloudflaredCommand(
            ["tunnel", "route", "dns", createdId, fullDomain],
            { TUNNEL_ORIGIN_CERT: account.certPath }
          );
          hostname = fullDomain;
        } else {
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
      }

      const tunnel = createTunnel(resolvedTargetUrl, {
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
        processId,
        deploymentId: deploymentId || null
      });
      storedTunnels.unshift(tunnel);
      created.push(tunnel);
    }
  } catch (error) {
    logError(error, "POST /api/tunnels (create)");
    return res.status(500).json({
      error: "Failed to start cloudflared tunnel.",
      details: error.message
    });
  }

  saveTunnels(storedTunnels);
  res.status(201).json({ tunnels: created });
});

app.delete("/api/tunnels/:id", (req, res) => {
  const tunnels = listTunnels();
  const index = tunnels.findIndex((tunnel) => tunnel.id === req.params.id);
  if (index === -1) {
    return res.status(404).json({ error: "Tunnel not found." });
  }
  const [removed] = tunnels.splice(index, 1);
  saveTunnels(tunnels);
  if (removed.tunnelType === "free") {
    stopTunnel(removed.id);
  }
  if (removed.deploymentId) {
    stopDeployment(removed.deploymentId);
  }
  return res.json({ deleted: 1 });
});

app.delete("/api/campaigns/:name", (req, res) => {
  const decodedName = decodeURIComponent(req.params.name || "");
  const tunnels = listTunnels();
  const matching = tunnels.filter(
    (tunnel) =>
      (tunnel.tunnelName?.trim() || "Untitled campaign") === decodedName
  );
  if (!matching.length) {
    return res.status(404).json({ error: "Campaign not found." });
  }
  const deploymentIds = new Set(
    matching.map((tunnel) => tunnel.deploymentId).filter(Boolean)
  );
  matching.forEach((tunnel) => {
    if (tunnel.tunnelType === "free") {
      stopTunnel(tunnel.id);
    }
  });
  deploymentIds.forEach((deploymentId) => stopDeployment(deploymentId));
  const remaining = tunnels.filter(
    (tunnel) =>
      (tunnel.tunnelName?.trim() || "Untitled campaign") !== decodedName
  );
  saveTunnels(remaining);
  return res.json({ deleted: matching.length });
});

app.use((err, req, res, next) => {
  logError(err, `${req.method} ${req.path}`);
  res.status(500).json({ error: "Internal server error." });
});

app.listen(port, () => {
  console.log(`Tunnel manager running on http://localhost:${port}`);
});
