// Install the plugin into the dsh desktop profile the same way dsh-ui-tidy is installed:
// a folder in ~/.dsh/local-plugins plus a resolvable entry in the profile's node_modules.
// Both are junctions pointing at the dev directory, so there is one source of truth and
// uninstalling is deleting two links (no profile config is touched).
import fs from 'node:fs';
import path from 'node:path';

const SRC = 'D:/111/dsh-local-computer';
const HOME = 'C:/Users/EDY';
const LINKS = [
  `${HOME}/.dsh/local-plugins/dsh-local-computer`,
  `${HOME}/.dsh/profiles/desktop/node_modules/dsh-local-computer`,
];

for (const t of LINKS) {
  fs.mkdirSync(path.dirname(t), { recursive: true });
  try {
    const st = fs.lstatSync(t);
    if (st.isSymbolicLink()) { fs.unlinkSync(t); console.log('removed old link', t); }
    else { console.log('REFUSING to overwrite a real directory:', t); continue; }
  } catch { }
  fs.symlinkSync(SRC, t, 'junction');
  console.log('linked', t, '->', SRC);
}

for (const t of LINKS) {
  const pkg = JSON.parse(fs.readFileSync(`${t}/package.json`, 'utf8'));
  const files = ['lib/index.js', 'lib/client.js', 'mcp/server.mjs', 'core/daemon.mjs', 'core/permission_gate.mjs', 'cordis.patch.yml']
    .map(f => `${f}=${fs.existsSync(path.join(t, f))}`).join(' ');
  console.log(`\n${t}\n  name=${pkg.name}  dsh=${JSON.stringify(pkg.dsh)}\n  exports=${JSON.stringify(Object.keys(pkg.exports ?? {}))}\n  ${files}`);
}
