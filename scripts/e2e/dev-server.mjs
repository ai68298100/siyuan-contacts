import { createServer } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const server = await createServer({
    configFile: false, root, publicDir: false,
    resolve: { alias: { siyuan: resolve(root, "scripts/e2e/ui/siyuan-mock.js") } },
    plugins: [svelte()],
    server: { host: "127.0.0.1", port: 5199, open: false },
});
await server.listen();
console.log("VITE_READY 5199");
