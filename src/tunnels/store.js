const fs = require("fs");
const path = require("path");

const storeDir = path.join(__dirname, "..", "..", "data");
const storePath = path.join(storeDir, "tunnels.json");

const ensureStore = () => {
  if (!fs.existsSync(storeDir)) {
    fs.mkdirSync(storeDir, { recursive: true, mode: 0o700 });
  }
  if (!fs.existsSync(storePath)) {
    fs.writeFileSync(storePath, JSON.stringify({ tunnels: [] }, null, 2), {
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
    return { tunnels: [] };
  }
};

const writeStore = (data) => {
  ensureStore();
  const next = JSON.stringify(data, null, 2);
  const tempPath = `${storePath}.tmp`;
  fs.writeFileSync(tempPath, next, { mode: 0o600 });
  fs.renameSync(tempPath, storePath);
};

const listTunnels = () => {
  const data = readStore();
  return Array.isArray(data.tunnels) ? data.tunnels : [];
};

const saveTunnels = (tunnels) => {
  writeStore({ tunnels });
};

module.exports = {
  listTunnels,
  saveTunnels
};
