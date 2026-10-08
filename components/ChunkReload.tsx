// Web app sul telefono: dopo un aggiornamento del sito una pagina rimasta aperta
// puo' chiedere file della versione vecchia, che non esistono piu', e restare
// bianca. Questo script (eseguito prima di React) ricarica la pagina una volta.
const SCRIPT = `(function(){var K='fv_reload_at';function bad(m){return /ChunkLoadError|Loading chunk|Loading CSS chunk|dynamically imported module|Importing a module script failed/i.test(m||'')}function reload(){try{var t=+sessionStorage.getItem(K)||0;if(Date.now()-t<30000)return;sessionStorage.setItem(K,String(Date.now()))}catch(e){}location.reload()}window.addEventListener('error',function(e){var t=e.target;if(t&&(t.tagName==='SCRIPT'||t.tagName==='LINK')&&/\\/_next\\//.test(t.src||t.href||'')){reload()}else if(bad(e.message)){reload()}},true);window.addEventListener('load',function(){var l=document.querySelectorAll('link[rel="stylesheet"][href*="/_next/"]');for(var i=0;i<l.length;i++){var sh=l[i].sheet,n=-1;try{n=sh?sh.cssRules.length:0}catch(e){}if(n===0){reload();return}}});window.addEventListener('unhandledrejection',function(e){var r=e.reason;if(bad(r&&(r.message||r.name||String(r))))reload()})})();`

// Web app tenuta aperta in background: tornando in primo piano, se nel
// frattempo e' uscita una versione nuova del sito, la pagina si ricarica.
const versionScript = (version: string) =>
  `(function(){var V=${JSON.stringify(version)},K='fv_version_reload_at',last=0;if(!V)return;function check(){if(document.visibilityState!=='visible'||Date.now()-last<60000)return;last=Date.now();fetch('/api/version',{cache:'no-store'}).then(function(r){return r.json()}).then(function(d){if(!d||!d.v||d.v===V)return;try{var t=+sessionStorage.getItem(K)||0;if(Date.now()-t<60000)return;sessionStorage.setItem(K,String(Date.now()))}catch(e){}location.reload()}).catch(function(){})}document.addEventListener('visibilitychange',check);window.addEventListener('focus',check);setInterval(check,600000)})();`

export default function ChunkReload() {
  const version = process.env.VERCEL_GIT_COMMIT_SHA || ''
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: SCRIPT }} />
      <script dangerouslySetInnerHTML={{ __html: versionScript(version) }} />
    </>
  )
}
