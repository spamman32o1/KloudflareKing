const fs = require("fs");
const path = require("path");

const storeDir = path.join(__dirname, "..", "..", "data");
const storePath = path.join(storeDir, "users.json");

const ensureStoreDir = () => {
  if (!fs.existsSync(storeDir)) {
    fs.mkdirSync(storeDir, { recursive: true, mode: 0o700 });
  }
};

const readStore = () => {
  ensureStoreDir();
  if (!fs.existsSync(storePath)) {
    return { users: [] };
  }
  const raw = fs.readFileSync(storePath, "utf-8");
  try {
    return JSON.parse(raw);
  } catch (error) {
    return { users: [] };
  }
};

const writeStore = (data) => {
  ensureStoreDir();
  const next = JSON.stringify(data, null, 2);
  const tempPath = `${storePath}.tmp`;
  fs.writeFileSync(tempPath, next, { mode: 0o600 });
  fs.renameSync(tempPath, storePath);
};

const ensureUserStore = (seedUser) => {
  const data = readStore();
  if (!data.users || !data.users.length) {
    if (seedUser) {
      writeStore({ users: [seedUser] });
    } else {
      writeStore({ users: [] });
    }
    return;
  }
  if (!Array.isArray(data.users)) {
    writeStore({ users: seedUser ? [seedUser] : [] });
  }
};

const listUsers = () => {
  const data = readStore();
  return Array.isArray(data.users) ? data.users : [];
};

const saveUsers = (users) => {
  writeStore({ users });
};

const sanitizeUser = (user) => {
  const { password, ...safe } = user;
  return safe;
};

const findUserByUsername = (username) =>
  listUsers().find((user) => user.username === username);

const findUserById = (id) => listUsers().find((user) => user.id === id);

module.exports = {
  ensureUserStore,
  listUsers,
  saveUsers,
  sanitizeUser,
  findUserByUsername,
  findUserById
};
