import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { generate } = require("youtube-po-token-generator");

try {
    const token = await generate();
    process.stdout.write(JSON.stringify(token));
} catch (error) {
    const message = error instanceof Error ? error.stack || error.message : String(error);
    process.stderr.write(message);
    process.exitCode = 1;
}
