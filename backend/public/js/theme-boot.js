// Runs synchronously at the top of <body> so the saved theme applies before first paint.
try { document.body.classList.toggle('light', localStorage.getItem('sw_theme') === 'light'); } catch (e) { /* storage blocked */ }
