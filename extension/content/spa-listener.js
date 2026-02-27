/**
 * 注入到页面上下文，在页面脚本之前拦截 history.pushState/replaceState
 * 派发 cjdb-spa-navigate 供 content script 监听
 */
(function () {
  const script = document.createElement('script');
  script.textContent = `
(function() {
  const ev = new CustomEvent('cjdb-spa-navigate');
  const origPush = history.pushState;
  const origReplace = history.replaceState;
  history.pushState = function() { origPush.apply(this, arguments); window.dispatchEvent(ev); };
  history.replaceState = function() { origReplace.apply(this, arguments); window.dispatchEvent(ev); };
  window.addEventListener('popstate', function() { window.dispatchEvent(ev); });
  window.addEventListener('hashchange', function() { window.dispatchEvent(ev); });
})();
`;
  (document.head || document.documentElement).appendChild(script);
  script.remove();
})();
