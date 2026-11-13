'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const dest = path.join(root, 'dist');
fs.rmSync(dest, { recursive:true, force:true });
fs.mkdirSync(dest, { recursive:true });
for (const name of ['index.html','styles.css','favicon.svg','js','assets','THIRD_PARTY_NOTICES.md']) fs.cpSync(path.join(root,name),path.join(dest,name),{recursive:true});
console.log('Aplicação estática e recursos locais preparados em dist/.');
