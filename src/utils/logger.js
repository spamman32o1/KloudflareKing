const fs = require("fs");
const path = require("path");

const logDir = path.join(__dirname, "..", "..", "data");
const logPath = path.join(logDir, "error.log");

const ensureLogDir = () => {
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true, mode: 0o700 });
  }
};

const formatMessage = (error) => {
  if (error instanceof Error) {
    return error.stack || error.message;
  }
  return typeof error === "string" ? error : JSON.stringify(error, null, 2);
};

const logError = (error, context) => {
  try {
    ensureLogDir();
    const timestamp = new Date().toISOString();
    const contextLabel = context ? ` | ${context}` : "";
    const entry = `[${timestamp}]${contextLabel}\n${formatMessage(error)}\n\n`;
    fs.appendFileSync(logPath, entry, { mode: 0o600 });
  } catch (logError) {
    console.error("Failed to write error log.", logError);
  }
};

module.exports = {
  logError
};
