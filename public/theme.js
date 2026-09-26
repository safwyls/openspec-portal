const themeKey = 'openspec-portal-theme';
let savedTheme = 'dark';
try { savedTheme = localStorage.getItem(themeKey) === 'light' ? 'light' : 'dark'; } catch { /* Storage may be unavailable. */ }

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'light' ? '#f4f7fc' : '#111827');
  const button = document.getElementById('theme-toggle');
  if (button) {
    const next = theme === 'light' ? 'dark' : 'light';
    button.title = `Switch to ${next} theme`;
    button.setAttribute('aria-label', button.title);
    button.setAttribute('aria-pressed', String(theme === 'light'));
    button.querySelector('.theme-icon').textContent = theme === 'light' ? '☾' : '☀';
    button.querySelector('.theme-label').textContent = theme === 'light' ? 'Dark' : 'Light';
  }
}

applyTheme(savedTheme);
document.addEventListener('DOMContentLoaded', () => {
  applyTheme(document.documentElement.dataset.theme);
  document.getElementById('theme-toggle')?.addEventListener('click', () => {
    const theme = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    applyTheme(theme);
    try { localStorage.setItem(themeKey, theme); } catch { /* The toggle still works for this tab. */ }
  });
});
