// Applies the saved (or system) colour theme before the page paints.
(function () {
  var t = null;
  try { t = localStorage.getItem('baltic-theme'); } catch (e) {}
  if (t !== 'dark' && t !== 'light') t = window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', t);
})();
