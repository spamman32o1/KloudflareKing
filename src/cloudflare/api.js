const fs = require("fs");
const path = require("path");

const API_BASE_URL = "https://api.cloudflare.com/client/v4";
const storeDir = path.join(__dirname, "..", "..", "data");
const storePath = path.join(storeDir, "cloudflare-accounts.json");

const ensureStore = () => {
  if (!fs.existsSync(storeDir)) {
    fs.mkdirSync(storeDir, { recursive: true, mode: 0o700 });
  }
  if (!fs.existsSync(storePath)) {
    fs.writeFileSync(storePath, JSON.stringify({ accounts: [] }, null, 2), {
      mode: 0o600
    });
  }
};

const readStore = () => {
  ensureStore();
  const raw = fs.readFileSync(storePath, "utf-8");
  try {
    return JSON.parse(raw);
  } catch (error) {
    return { accounts: [] };
  }
};

const writeStore = (data) => {
  ensureStore();
  const next = JSON.stringify(data, null, 2);
  const tempPath = `${storePath}.tmp`;
  fs.writeFileSync(tempPath, next, { mode: 0o600 });
  fs.renameSync(tempPath, storePath);
};

const listAccounts = () => {
  const data = readStore();
  return data.accounts || [];
};

const saveAccounts = (accounts) => {
  writeStore({ accounts });
};

const sanitizeAccount = (account) => {
  const { apiToken, ...safe } = account;
  return safe;
};

const cloudflareRequest = async (token, endpoint, options = {}) => {
  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });

  const payload = await response.json();
  if (!response.ok || !payload.success) {
    const errors = payload?.errors || [];
    const messageFromPayload = errors[0]?.message;
    const endpointMismatch = errors.some((error) =>
      /could not route|endpoint not found|not found/i.test(error?.message || "")
    );
    let message = messageFromPayload || `Cloudflare API error (${response.status}).`;

    if (response.status === 401) {
      message = "Invalid Cloudflare API token.";
    } else if (response.status === 403) {
      message =
        "Token valid but missing Account/Zone permissions for this endpoint.";
    } else if (response.status === 404 || endpointMismatch) {
      message =
        "Cloudflare API endpoint mismatch. Verify the account/zone ID and endpoint.";
    }

    const error = new Error(message);
    error.details = errors;
    error.status = response.status;
    throw error;
  }

  return payload.result;
};

const verifyToken = async (token) =>
  cloudflareRequest(token, "/user/tokens/verify");

const fetchAccountDetails = async (accountId, token) =>
  cloudflareRequest(token, `/accounts/${accountId}`);

const listZones = async (accountId, token) =>
  cloudflareRequest(
    token,
    `/accounts/${accountId}/zones?per_page=100&status=active`
  );

const createTunnel = async (accountId, token, name) =>
  cloudflareRequest(token, `/accounts/${accountId}/cfd_tunnel`, {
    method: "POST",
    body: JSON.stringify({ name })
  });

const createDnsRecord = async (zoneId, token, record) =>
  cloudflareRequest(token, `/zones/${zoneId}/dns_records`, {
    method: "POST",
    body: JSON.stringify(record)
  });

const findZoneForHostname = (hostname, zones) => {
  const normalized = hostname.toLowerCase();
  const matches = zones
    .filter((zone) => normalized === zone.name || normalized.endsWith(`.${zone.name}`))
    .sort((a, b) => b.name.length - a.name.length);
  return matches[0] || null;
};

module.exports = {
  listAccounts,
  saveAccounts,
  sanitizeAccount,
  verifyToken,
  fetchAccountDetails,
  listZones,
  createTunnel,
  createDnsRecord,
  findZoneForHostname
};
