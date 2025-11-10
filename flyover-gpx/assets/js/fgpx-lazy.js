(function(){
  'use strict';
  
  // Immediate debug log to confirm lazy loader is running (always shown for critical bootstrap info)
  if (window.FGPX && window.FGPX.debugLogging) {
    console.debug('[FGPX] Lazy loader script started');
  }
  
  function once(fn){ var done=false; return function(){ if(!done){ done=true; try{ fn(); }catch(e){ if(window.FGPX && window.FGPX.debugLogging) console.warn('[FGPX]', e);} } }; }

  function loadStyles(urls){
    return Promise.all((urls||[]).map(function(u){
      return new Promise(function(res){
        if (!u) return res();
        if ([].slice.call(document.styleSheets).some(function(ss){ return (ss.href||'')===u; })) return res();
        var l=document.createElement('link'); l.rel='stylesheet'; l.href=u;
        l.onload=function(){res();}; l.onerror=function(){res();};
        document.head.appendChild(l);
      });
    }));
  }
  function loadScriptsSequential(urls){
    return urls.reduce(function(p,u){
      return p.then(function(){
        return new Promise(function(res){
          if (!u){ return res(); }
            // already loaded?
          if (document.querySelector('script[data-fgpx-src="'+u+'"]') ||
              [].some && [].slice.call(document.scripts).some(function(s){ return (s.src||'')===u; })) return res();
          var s=document.createElement('script');
          s.src=u; s.async=false; s.defer=false;
          s.dataset.fgpxSrc=u;
          s.onload=function(){ res(); };
          s.onerror=function(){ res(); };
            document.head.appendChild(s);
        });
      });
    }, Promise.resolve());
  }

  function bootstrap(){
    if (!window.FGPX) { return; }
    if (window.FGPX._bootStarted) return;
    window.FGPX._bootStarted = true;
    
    // Debug log for lazy loading
    if (window.FGPX && window.FGPX.debugLogging) {
      console.debug('[FGPX] === LAZY LOADING BOOTSTRAP ===');
      console.debug('[FGPX] Starting lazy script loading...');
    }
    
    var styles = window.FGPX.lazyStyles || [];
    var scripts = window.FGPX.lazyScripts || [];
    loadStyles(styles)
      .then(function(){ return loadScriptsSequential(scripts); })
      .then(function(){
        if (window.FGPX && window.FGPX.debugLogging) {
          console.debug('[FGPX] Scripts loaded, calling boot function...');
        }
        if (window.FGPX && typeof window.FGPX.boot === 'function'){
          window.FGPX.boot();
        } else {
          // Retry briefly (front.js might still parse)
          var tries=0;
          var id=setInterval(function(){
            tries++;
            if (window.FGPX && typeof window.FGPX.boot === 'function'){
              clearInterval(id);
              window.FGPX.boot();
            } else if (tries>20){
              clearInterval(id);
              if (window.FGPX && window.FGPX.debugLogging) {
                console.warn('[FGPX] front.js boot function not found');
              }
            }
          },50);
        }
      });
  }

  function immediate(){ 
    if (window.FGPX && window.FGPX.debugLogging) {
      console.debug('[FGPX] Running immediate bootstrap (no lazy loading)');
    }
    bootstrap(); 
  }

  if (!(window.FGPX && window.FGPX.deferViewport)) { 
    if (window.FGPX && window.FGPX.debugLogging) {
      console.debug('[FGPX] deferViewport disabled, loading immediately');
    }
    immediate(); 
    return; 
  }

  var target = document.querySelector('.fgpx');
  if (!target) { 
    if (window.FGPX && window.FGPX.debugLogging) {
      console.debug('[FGPX] No .fgpx element found, loading immediately');
    }
    immediate(); 
    return; 
  }
  
  if (window.FGPX && window.FGPX.debugLogging) {
    console.debug('[FGPX] Setting up IntersectionObserver for lazy loading');
  }

  if (!('IntersectionObserver' in window)){
    immediate(); return;
  }

  var triggered = false;
  var obs = new IntersectionObserver(function(entries){
    entries.forEach(function(ent){
      if (!triggered && ent.isIntersecting){
        if (window.FGPX && window.FGPX.debugLogging) {
          console.debug('[FGPX] GPX element came into view, triggering bootstrap');
        }
        triggered = true;
        obs.disconnect();
        bootstrap();
      }
    });
  }, { rootMargin: '200px 0px 200px 0px', threshold: 0.01 });

  obs.observe(target);
})();