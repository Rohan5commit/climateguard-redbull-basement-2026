import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

function isLocalhost(hostname) {
  return hostname === "localhost" || hostname === "127.0.0.1";
}

function isManagedBaseUrl(baseUrl) {
  try {
    const url = new URL(baseUrl);
    return (url.protocol === "http:" || url.protocol === "https:") && isLocalhost(url.hostname);
  } catch {
    return false;
  }
}

async function isServerReachable(baseUrl) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1200);
    const response = await fetch(baseUrl, {
      method: "GET",
      signal: controller.signal,
    });
    clearTimeout(timeout);
    return response.ok || response.status === 404;
  } catch {
    return false;
  }
}

async function waitForReachable(baseUrl, timeoutMs) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (await isServerReachable(baseUrl)) {
      return true;
    }
    await delay(500);
  }

  return false;
}

export async function ensureLocalAppServer(baseUrl) {
  if (!isManagedBaseUrl(baseUrl)) {
    return null;
  }

  if (await isServerReachable(baseUrl)) {
    return null;
  }

  const url = new URL(baseUrl);
  const port = url.port || "3000";
  const hostname = url.hostname;
  const command = process.platform === "win32" ? "npm.cmd" : "npm";
  const child = spawn(command, ["run", "dev", "--", "--hostname", hostname, "--port", port], {
    cwd: process.cwd(),
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let recentLogs = "";
  const appendLogs = (chunk) => {
    recentLogs = `${recentLogs}${chunk.toString()}`.slice(-4000);
  };

  child.stdout?.on("data", appendLogs);
  child.stderr?.on("data", appendLogs);

  const ready = await waitForReachable(baseUrl, 30000);

  if (!ready) {
    child.kill("SIGTERM");
    throw new Error(`Timed out starting local app server for ${baseUrl}.\n${recentLogs}`);
  }

  return {
    started: true,
    async stop() {
      if (child.exitCode !== null || child.killed) {
        return;
      }

      child.kill("SIGTERM");
      await Promise.race([
        new Promise((resolve) => {
          child.once("exit", resolve);
        }),
        delay(3000).then(() => {
          if (child.exitCode === null && !child.killed) {
            child.kill("SIGKILL");
          }
        }),
      ]);
    },
  };
}
