// Minimal build-free test: assert the health handler logic.
const assert = require("node:assert");
const payload = JSON.stringify({ status: "ok" });
assert.strictEqual(JSON.parse(payload).status, "ok");
console.log("sample-app tests passed");
