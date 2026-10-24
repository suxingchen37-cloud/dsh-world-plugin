// Install the plugin into the dsh desktop profile the same way dsh-ui-tidy is installed:
// a folder in ~/.dsh/local-plugins plus a resolvable entry in the profile's node_modules.
// Both are junctions pointing at the dev directory, so there is one source of truth and
// uninstalling is deleting two links (no profile config is touched).
//
// Step 3 writes the MCP stdio block into the PROFILE's own cordis.patch.yml, because the
// package bundle patch cannot know where the package will be installed.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const HOME = os.homedir();
const PROFILE = path.join(HOME, '.dsh', 'profiles', 'desktop');
const LINKS = [
  path.join(HOME, '.dsh', 'local-plugins', 'dsh-local-computer'),
  path.join(PROFILE, 'node_modules', 'dsh-local-computer'),
];

for (const t of LINKS) {
  fs.mkdirSync(path.dirname(t), { recursive: true });
  try {
    const st = fs.lstatSync(t);
    if (st.isSymbolicLink()) { fs.unlinkSync(t); console.log('removed old link', t); }
    else { console.log('REFUSING to overwrite a real directory:', t); continue; }
  } catch { }
  fs.symlinkSync(ROOT, t, 'junction');
  console.log('linked', t, '->', ROOT);
}

for (const t of LINKS) {
  const pkg = JSON.parse(fs.readFileSync(path.join(t, 'package.json'), 'utf8'));
  const files = ['host/index.js', 'host/runtime.js', 'host/capabilities/org/index.js',
    'host/capabilities/brain/index.js', 'host/capabilities/computer/engine.mjs',
    'mcp/server.mjs', 'core/daemon.mjs', 'cordis.patch.yml']
    .map(f => `${f}=${fs.existsSync(path.join(t, f))}`).join(' ');
  console.log(`\n${t}\n  name=${pkg.name} v${pkg.version}  dsh=${JSON.stringify(pkg.dsh)}\n  exports=${JSON.stringify(Object.keys(pkg.exports ?? {}))}\n  ${files}`);
}

// 3) MCP stdio block in the profile layer, with this machine's real paths.
const PATCH = path.join(PROFILE, 'cordis.patch.yml');
const INSTALLED = path.join(PROFILE, 'node_modules', 'dsh-local-computer');
const MCP = path.join(INSTALLED, 'mcp', 'server.mjs');
if (!fs.existsSync(MCP)) {
  console.log('MCP server missing at', MCP, '- skipping the MCP block');
} else {
  const marker = '# dsh-local-computer:本机执行 MCP';
  const block = [
    '',
    marker + '（由 install.mjs 生成，路径按本机解析）',
    '- insert:',
    '    - id: mcp-local-computer',
    "      name: '@deepseek-ai/dsh-mcp-client'",
    '      config:',
    '        serverName: local-computer',
    '        transport: stdio',
    `        command: '${process.execPath}'`,
    '        args:',
    `          - '${MCP}'`,
    `        cwd: '${INSTALLED}'`,
    '        failOnStartupError: false',
    '',
  ].join('\n');
  let cur = '';
  try { cur = fs.readFileSync(PATCH, 'utf8'); } catch { }
  const at = cur.indexOf(marker);
  if (at >= 0) cur = cur.slice(0, at).trimEnd() + '\n';
  fs.writeFileSync(PATCH, cur + block);
  console.log('\nMCP block written to', PATCH);
}
