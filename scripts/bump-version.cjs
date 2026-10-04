// Stamp every local script and stylesheet in index.html with one new ?v= so browsers fetch fresh code after a deploy.
// Run before committing any change to .js or .css: node scripts/bump-version.cjs
const fs=require('node:fs'),path=require('node:path');
const file=path.join(__dirname,'..','index.html'),html=fs.readFileSync(file,'utf8');
const version=process.argv[2]||new Date().toISOString().replace(/\D/g,'').slice(0,12);
const next=html.replace(/(<(?:script[^>]*\ssrc|link[^>]*\shref)=")(?!https?:|\/\/)([^"?]+\.(?:js|css))(?:\?v=[^"]*)?"/g,`$1$2?v=${version}"`);
fs.writeFileSync(file,next);
console.log(`index.html assets now at ?v=${version}`);
