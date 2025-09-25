const fs = require('fs');
const path = require('path');
const archiver = require('archiver');

const root = path.resolve(__dirname, '..');
const pkg = require(path.join(root, 'package.json'));
const outDir = path.join(root, 'dist');
const tmpDir = path.join(outDir, 'package');
const zipName = `openwhen-${pkg.version.replace(/[^0-9a-zA-Z.-]/g, '')}.zip`;

function ensureDir(p){ if(!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true }); }

ensureDir(tmpDir);

const runtimeFiles = [
  'manifest.json','background.js','content_script.js',
  'banner.css','styles.css','options.html','options.js','options.css',
  'popup.html','popup.js','popup_prefill.js',
  'sidebar.html','sidebar_prefill.js','panel.html','panel_prefill.js'
];

for(const f of runtimeFiles){ const src = path.join(root, f); if(fs.existsSync(src)){ const dest = path.join(tmpDir, f); ensureDir(path.dirname(dest)); fs.copyFileSync(src, dest); } }

const iconsSrc = path.join(root, 'icons');
if(fs.existsSync(iconsSrc)){
  const destIcons = path.join(tmpDir, 'icons');
  ensureDir(destIcons);
  for(const entry of fs.readdirSync(iconsSrc)){
    fs.copyFileSync(path.join(iconsSrc, entry), path.join(destIcons, entry));
  }
}

ensureDir(outDir);
const outPath = path.join(outDir, zipName);
const output = fs.createWriteStream(outPath);
const archive = archiver('zip', { zlib: { level: 9 } });
output.on('close', () => { console.log('Created', outPath, archive.pointer(), 'bytes'); process.exit(0); });
archive.on('error', err => { throw err; });
archive.pipe(output);
archive.directory(tmpDir + '/', false);
archive.finalize();
