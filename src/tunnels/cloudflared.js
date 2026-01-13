const { spawn } = require("child_process");

const tunnelProcesses = new Map();
const hostnamePattern = /(?:https?:\/\/)?([a-z0-9.-]+\.trycloudflare\.com)/i;

const extractHostname = (chunk) => {
  const match = chunk.match(hostnamePattern);
  return match ? match[1] : null;
};

const buildArgs = (targetUrl, { noAutoupdate } = {}) => {
  const args = ["tunnel", "--url", targetUrl];
  if (noAutoupdate) {
    args.push("--no-autoupdate");
  }
  return args;
};

const startQuickTunnel = ({ id, targetUrl, noAutoupdate = true } = {}) =>
  new Promise((resolve, reject) => {
    if (!id) {
      reject(new Error("Tunnel id is required."));
      return;
    }
    if (!targetUrl) {
      reject(new Error("Target URL is required."));
      return;
    }

    const child = spawn("cloudflared", buildArgs(targetUrl, { noAutoupdate }), {
      stdio: ["ignore", "pipe", "pipe"]
    });

    const record = {
      id,
      targetUrl,
      pid: child.pid,
      process: child,
      hostname: null,
      startedAt: new Date().toISOString(),
      stoppedAt: null,
      exitedAt: null,
      exitCode: null,
      signal: null
    };
    tunnelProcesses.set(id, record);

    let resolved = false;

    const handleOutput = (data) => {
      const text = data.toString();
      const hostname = extractHostname(text);
      if (hostname && !resolved) {
        resolved = true;
        record.hostname = hostname;
        resolve({ hostname, pid: child.pid });
      }
    };

    child.stdout.on("data", handleOutput);
    child.stderr.on("data", handleOutput);

    child.on("exit", (code, signal) => {
      record.exitedAt = new Date().toISOString();
      record.exitCode = code;
      record.signal = signal;
      if (!resolved) {
        tunnelProcesses.delete(id);
        reject(
          new Error(
            `cloudflared exited before hostname was assigned (code ${
              code ?? "unknown"
            }, signal ${signal ?? "unknown"}).`
          )
        );
      }
    });

    child.on("error", (error) => {
      if (!resolved) {
        tunnelProcesses.delete(id);
        reject(error);
      }
    });
  });

const stopTunnel = (id) => {
  const record = tunnelProcesses.get(id);
  if (!record) {
    return false;
  }
  if (record.process.killed) {
    return true;
  }
  record.stoppedAt = new Date().toISOString();
  record.process.kill();
  return true;
};

const getTunnelProcess = (id) => tunnelProcesses.get(id) ?? null;

module.exports = {
  startQuickTunnel,
  stopTunnel,
  getTunnelProcess
};
