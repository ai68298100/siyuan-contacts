import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import net from "node:net";

export function assertIsolatedPath(workspace, target) {
    const root = fs.realpathSync(workspace);
    let existing = path.resolve(target);
    while (!fs.existsSync(existing)) existing = path.dirname(existing);
    const relative = path.relative(root, fs.realpathSync(existing));
    if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        throw new Error(`测试目标越出隔离工作区: ${target}`);
    }
}

export function prepareIsolatedWorkspace(workspace, marker, createdBy) {
    const resolved = path.resolve(workspace);
    const relativeRepo = path.relative(resolved, process.cwd());
    const repoOutside = relativeRepo === ".." || relativeRepo.startsWith(`..${path.sep}`) || path.isAbsolute(relativeRepo);
    if (resolved === path.parse(resolved).root || path.relative(os.homedir(), resolved) === "" || !repoOutside) {
        throw new Error(`拒绝使用宽泛或项目目录作为测试工作区: ${resolved}`);
    }
    if (fs.existsSync(resolved)) {
        if (fs.lstatSync(resolved).isSymbolicLink()) throw new Error("拒绝使用链接工作区");
        let metadata;
        try { metadata = JSON.parse(fs.readFileSync(path.join(resolved, marker), "utf8")); }
        catch { throw new Error(`拒绝使用非测试工作区，标记缺失或损坏: ${resolved}`); }
        if (metadata?.createdBy !== createdBy) throw new Error(`测试工作区标记不匹配: ${resolved}`);
        assertIsolatedPath(resolved, path.join(resolved, "data"));
        return;
    }
    fs.mkdirSync(path.join(resolved, "data"), { recursive: true });
    fs.writeFileSync(path.join(resolved, marker), JSON.stringify({ createdBy, createdIso: new Date().toISOString() }) + "\n");
}

/** 端口已占用时不发 HTTP 请求、不启动内核，也不退出其他服务。 */
export async function assertTestPortAvailable(host, port) {
    if (!["127.0.0.1", "::1"].includes(host)) throw new Error("测试内核只允许回环地址");
    await new Promise((resolve, reject) => {
        const server = net.createServer();
        server.once("error", (error) => reject(new Error(`测试端口 ${port} 不可用: ${error.code}`)));
        server.listen({ host, port, exclusive: true }, () => server.close((error) => error ? reject(error) : resolve()));
    });
}

export function observeTestKernel(child) {
    let spawnError;
    child.once("error", (error) => { spawnError = error; });
    return () => {
        if (spawnError) throw spawnError;
        if (child.exitCode !== null || child.signalCode !== null) throw new Error("测试内核已退出，停止请求");
    };
}
