import { execFile as execFileCallback } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const execFile = promisify(execFileCallback);
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })));
});

async function executable(path: string, source: string): Promise<void> {
  await writeFile(path, source, "utf8");
  await chmod(path, 0o755);
}

describe("first deploy", () => {
  it("provisions one unprinted renderer signing secret for both Workers before deploying them", async () => {
    const directory = await mkdtemp(join(tmpdir(), "vibe-garden-first-deploy-"));
    temporaryDirectories.push(directory);
    const bin = join(directory, "bin");
    const log = join(directory, "commands.log");
    await mkdir(bin);

    await executable(join(bin, "openssl"), "#!/bin/sh\nprintf '%s' renderer-signing-secret\n");
    await executable(join(bin, "npx"), `#!/bin/sh
if [ "$1" = "wrangler" ] && [ "$2" = "secret" ] && [ "$3" = "put" ]; then
  value=$(cat)
  printf 'secret:%s:length=%s\n' "$4" "\${#value}" >> "$VG_FIRST_DEPLOY_LOG"
else
  printf 'npx:%s\n' "$*" >> "$VG_FIRST_DEPLOY_LOG"
fi
`);
    await executable(join(bin, "npm"), "#!/bin/sh\nprintf 'npm:%s\\n' \"$*\" >> \"$VG_FIRST_DEPLOY_LOG\"\n");

    const { stdout, stderr } = await execFile("bash", ["scripts/first-deploy.sh"], {
      cwd: process.cwd(),
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, VG_FIRST_DEPLOY_LOG: log },
    });

    const commands = await readFile(log, "utf8");
    expect(commands.match(/secret:RENDERER_SIGNING_SECRET:length=23/g)).toHaveLength(2);
    expect(commands).toMatch(/npm:run deploy:renderer[\s\S]*npm:run deploy\n/u);
    expect(`${stdout}${stderr}`).not.toContain("renderer-signing-secret");
  });
});
