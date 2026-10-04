// Stamp every local script and stylesheet in index.html with ?v=<hash of their contents>, so browsers fetch fresh code
// exactly when it changes. Run before committing any change to .js or .css: node scripts/bump-version.cjs
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.join(__dirname,'..'),ASSET=/(<(?:script[^>]*\ssrc|link[^>]*\shref)=")(?!https?:|\/\/)([^"?]+\.(?:js|css))(?:\?v=[^"]*)?"/g;
const assets=html=>[...html.matchAll(ASSET)].map(m=>m[2]);
function assetVersion(html){
 const hash=crypto.createHash('sha256');
 for(const file of assets(html))hash.update(file+'\0').update(fs.readFileSync(path.join(root,file))).update('\0');
 return hash.digest('hex').slice(0,12);
}
module.exports={assets,assetVersion};
if(require.main===module){
 const file=path.join(root,'index.html'),html=fs.readFileSync(file,'utf8'),version=assetVersion(html);
 fs.writeFileSync(file,html.replace(ASSET,`$1$2?v=${version}"`));
 console.log(`index.html assets now at ?v=${version}`);
}
