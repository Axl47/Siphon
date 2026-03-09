import http from "node:http";
import { spawn } from "node:child_process";
import process from "node:process";
import { fileURLToPath } from "node:url";

const bindAddress = process.env.YT_SESSION_BIND || "0.0.0.0";
const port = Number(process.env.YT_SESSION_PORT || "8080");
const updateIntervalSeconds = Math.max(60, Number(process.env.YT_SESSION_UPDATE_INTERVAL || "300"));
const workerPath = fileURLToPath(new URL("./worker.mjs", import.meta.url));

let tokenInfo = null;
let updatePromise = null;
let lastError = null;

const nowSeconds = () => Math.floor(Date.now() / 1000);

const createTokenPayload = ({ visitorData, poToken }) => ({
    updated: nowSeconds(),
    visitor_data: visitorData,
    potoken: poToken,
});

const logInfo = (message) => {
    console.log(`${new Date().toISOString()} [extractor] [INFO] ${message}`);
};

const logWarning = (message, error) => {
    console.warn(`${new Date().toISOString()} [extractor] [WARNING] ${message}`);
    if (error) {
        console.warn(error);
    }
};

const refreshToken = async (reason = "scheduled") => {
    if (updatePromise) {
        return updatePromise;
    }

    updatePromise = (async () => {
        logInfo(`update started (${reason})`);
        try {
            const token = await new Promise((resolve, reject) => {
                const child = spawn(process.execPath, [workerPath], {
                    env: process.env,
                    stdio: ["ignore", "pipe", "pipe"],
                });

                let stdout = "";
                let stderr = "";

                child.stdout.on("data", (chunk) => {
                    stdout += chunk.toString();
                });

                child.stderr.on("data", (chunk) => {
                    stderr += chunk.toString();
                });

                child.on("error", reject);

                child.on("close", (code) => {
                    if (code !== 0) {
                        const detail = stderr.trim() || stdout.trim() || `worker exited with code ${code}`;
                        reject(new Error(detail));
                        return;
                    }

                    try {
                        resolve(JSON.parse(stdout));
                    } catch {
                        reject(new Error(`worker returned invalid JSON: ${stdout.trim()}`));
                    }
                });
            });
            tokenInfo = createTokenPayload(token);
            lastError = null;
            logInfo("update was successful");
            return tokenInfo;
        } catch (error) {
            lastError = error;
            logWarning("update failed", error);
            return null;
        } finally {
            updatePromise = null;
        }
    })();

    return updatePromise;
};

const writeText = (res, statusCode, text) => {
    res.writeHead(statusCode, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(text);
};

const writeJSON = (res, statusCode, body) => {
    res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(body));
};

const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

    if (url.pathname === "/health") {
        return writeJSON(res, 200, {
            ok: true,
            hasToken: !!tokenInfo,
            updating: !!updatePromise,
        });
    }

    if (url.pathname === "/update") {
        void refreshToken("manual");
        return writeText(res, 200, "Update request accepted, new token will be generated soon.");
    }

    if (url.pathname === "/" || url.pathname === "/token") {
        if (tokenInfo) {
            return writeJSON(res, 200, tokenInfo);
        }

        const suffix = lastError instanceof Error
            ? ` Last error: ${lastError.message}`
            : "";
        return writeText(res, 503, `Token has not yet been generated, try again later.${suffix}`);
    }

    return writeText(res, 404, "Not Found");
});

server.listen(port, bindAddress, () => {
    logInfo(`Starting web-server at ${bindAddress}:${port}`);
    void refreshToken("startup");
    setInterval(() => {
        void refreshToken("scheduled");
    }, updateIntervalSeconds * 1000);
});
