// Builds EXPLAIN ANALYZE scripts from a SQL function body by substituting its parameters.
const fs = require("fs");
const [, , src, out, json] = process.argv;
let s = fs.readFileSync(src, "utf8");
const sub = JSON.parse(json);
for (const [k, v] of Object.entries(sub)) s = s.split(k).join(v);
fs.writeFileSync(out, "explain (analyze, buffers, costs off) " + s.trim().replace(/;\s*$/, "") + ";\n");
