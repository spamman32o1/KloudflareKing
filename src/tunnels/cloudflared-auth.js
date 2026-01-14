const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const loginSessions = new Map();
const ensureCertDir = (certPath) => {
  const dir = path.dirname(certPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
};

const startCloudflaredLogin = ({ sessionId, certPath } = {}) =>
  new Promise((resolve, reject) => {
    if (!sessionId) {
      reject(new Error("Login session id is required."));
      return;
    }
    if (!certPath) {
      reject(new Error("Certificate path is required."));
      return;
    }

    ensureCertDir(certPath);

    const record = {
      id: sessionId,
      certPath,
      pid: null,
      status: "starting",
      loginUrl: null,
      startedAt: new Date().toISOString(),
      connectedAt: null,
      exitedAt: null,
      exitCode: null,
      signal: null,
      error: null,
      output: []
    };

    loginSessions.set(sessionId, record);

    const loginUrlPattern = /https?:\/\/\S+/i;
    const noAutoupdateFlagError = /flag provided but not defined: -?no-autoupdate/i;
    const usageErrorPattern = /unknown flag|flag provided but not defined|usage of|usage:/i;

    let resolved = false;

    const shouldRetryWithoutNoAutoupdate = (code, output) => {
      if (!output) {
        return false;
      }
      if (noAutoupdateFlagError.test(output)) {
        return true;
      }
      if (code !== null && code !== 0) {
        return usageErrorPattern.test(output);
      }
      return false;
    };

    const spawnLogin = (args, allowRetry) => {
      const child = spawn("cloudflared", args, {
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          TUNNEL_ORIGIN_CERT: certPath
        }
      });

      record.pid = child.pid;
      record.status = "starting";

      let attemptOutput = "";

      const handleOutput = (data) => {
        const text = data.toString();
        record.output.push(text);
        attemptOutput += text;
        const match = record.loginUrl ? null : attemptOutput.match(loginUrlPattern);
        if (match && !record.loginUrl) {
          record.loginUrl = match[0];
          record.status = "awaiting_auth";
          if (!resolved) {
            resolved = true;
            resolve({
              sessionId: record.id,
              loginUrl: record.loginUrl,
              status: record.status
            });
          }
        }
      };

      child.stdout.on("data", handleOutput);
      child.stderr.on("data", handleOutput);

      child.on("exit", (code, signal) => {
        record.exitedAt = new Date().toISOString();
        record.exitCode = code;
        record.signal = signal;

        if (allowRetry && shouldRetryWithoutNoAutoupdate(code, attemptOutput)) {
          record.error = null;
          record.loginUrl = null;
          spawnLogin(["tunnel", "login"], false);
          return;
        }

        const hasCert = fs.existsSync(certPath);
        const hasLoginUrl = Boolean(record.loginUrl);

        if (code === 0 && hasCert) {
          record.status = "connected";
          record.connectedAt = new Date().toISOString();
        } else if (code === 0 && hasLoginUrl) {
          record.status = "awaiting_auth";
        } else {
          record.status = "error";
          record.error =
            record.error ||
            (hasLoginUrl
              ? `cloudflared login exited with code ${code ?? "unknown"}.`
              : "cloudflared login exited before a login URL was detected.");
        }
        if (!resolved) {
          resolved = true;
          if (record.loginUrl) {
            resolve({
              sessionId: record.id,
              loginUrl: record.loginUrl,
              status: record.status
            });
          } else if (code !== 0) {
            reject(
              new Error(
                record.error ||
                  "cloudflared login exited before a tokenized login URL was detected."
              )
            );
          } else {
            resolve({
              sessionId: record.id,
              loginUrl: record.loginUrl,
              status: record.status
            });
          }
        }
      });

      child.on("error", (error) => {
        record.status = "error";
        record.error = error.message;
        if (!resolved) {
          resolved = true;
          reject(error);
        }
      });
    };

    spawnLogin(["tunnel", "login", "--no-autoupdate"], true);
  });

const getLoginSession = (sessionId) => loginSessions.get(sessionId) || null;

const getLoginStatus = (sessionId) => {
  const record = loginSessions.get(sessionId);
  if (!record) {
    return null;
  }
  return {
    sessionId: record.id,
    status: record.status,
    loginUrl: record.loginUrl,
    startedAt: record.startedAt,
    connectedAt: record.connectedAt,
    exitedAt: record.exitedAt,
    exitCode: record.exitCode,
    signal: record.signal,
    error: record.error
  };
};

module.exports = {
  startCloudflaredLogin,
  getLoginStatus,
  getLoginSession
};
