const fs = require("fs");
const path = require("path");

const storeDir = path.join(__dirname, "..", "..", "data");
const storePath = path.join(storeDir, "projects.json");

const ensureStoreDir = () => {
  if (!fs.existsSync(storeDir)) {
    fs.mkdirSync(storeDir, { recursive: true, mode: 0o700 });
  }
};

const readStore = () => {
  ensureStoreDir();
  if (!fs.existsSync(storePath)) {
    return { projects: [] };
  }
  const raw = fs.readFileSync(storePath, "utf-8");
  try {
    return JSON.parse(raw);
  } catch (error) {
    return { projects: [] };
  }
};

const writeStore = (data) => {
  ensureStoreDir();
  const next = JSON.stringify(data, null, 2);
  const tempPath = `${storePath}.tmp`;
  fs.writeFileSync(tempPath, next, { mode: 0o600 });
  fs.renameSync(tempPath, storePath);
};

const listProjects = () => {
  const data = readStore();
  return Array.isArray(data.projects) ? data.projects : [];
};

const saveProjects = (projects) => {
  writeStore({ projects });
};

const findProjectById = (id) =>
  listProjects().find((project) => project.id === id);

module.exports = {
  listProjects,
  saveProjects,
  findProjectById
};
