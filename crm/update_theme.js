const fs = require('fs');
let content = fs.readFileSync('/Users/dynamo/Documents/safitrack/crm/app.js', 'utf8');

// 1. Replace the Appearance HTML
const targetHtml = `          <div class="sv-pref-group">
            <div class="sv-pref-label"><div class="sv-pref-label-title">Theme</div><div class="sv-pref-label-desc">Switch between light and dark mode.</div></div>
            <div class="sv-segmented sv-theme-segmented">
              <button class="sv-seg-btn \${currentTheme==='light'?'sv-seg-active':''}" data-theme-val="light">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:18px;height:18px;margin-bottom:4px;"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
                Light
              </button>
              <button class="sv-seg-btn \${currentTheme==='dark'?'sv-seg-active':''}" data-theme-val="dark">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:18px;height:18px;margin-bottom:4px;"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
                Dark
              </button>
            </div>
          </div>`;

const newHtml = `          <div style="margin-bottom:24px; border-bottom:1px solid var(--border-color); padding-bottom: 24px;">
            <div style="margin-bottom:16px;">
              <div style="font-size:0.875rem;font-weight:700;color:var(--text-primary);margin-bottom:3px;">Theme</div>
              <div style="font-size:0.8rem;color:var(--text-muted);line-height:1.45;">Select a theme to personalize your platform's appearance</div>
            </div>
            <div class="sv-theme-cards sv-theme-segmented">
              <button class="sv-theme-card \${currentTheme==='light'?'active':''}" data-theme-val="light">
                <div class="sv-theme-preview sv-preview-light">
                   <div class="sv-mock-sidebar">
                     <div class="sv-mock-line" style="width:40%"></div>
                     <div class="sv-mock-line" style="width:60%;margin-top:6px;"></div>
                     <div class="sv-mock-line" style="width:50%;margin-top:4px;"></div>
                     <div class="sv-mock-line" style="width:70%;margin-top:4px;"></div>
                   </div>
                   <div class="sv-mock-content">
                     <div class="sv-mock-table">
                       <div class="sv-mock-row"></div><div class="sv-mock-row"></div><div class="sv-mock-row"></div>
                     </div>
                   </div>
                </div>
                <div class="sv-theme-label">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
                  Light
                </div>
              </button>
              <button class="sv-theme-card \${currentTheme==='dark'?'active':''}" data-theme-val="dark">
                <div class="sv-theme-preview sv-preview-dark">
                   <div class="sv-mock-sidebar">
                     <div class="sv-mock-line" style="width:40%"></div>
                     <div class="sv-mock-line" style="width:60%;margin-top:6px;"></div>
                     <div class="sv-mock-line" style="width:50%;margin-top:4px;"></div>
                     <div class="sv-mock-line" style="width:70%;margin-top:4px;"></div>
                   </div>
                   <div class="sv-mock-content">
                     <div class="sv-mock-table">
                       <div class="sv-mock-row"></div><div class="sv-mock-row"></div><div class="sv-mock-row"></div>
                     </div>
                   </div>
                </div>
                <div class="sv-theme-label">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
                  Dark
                </div>
              </button>
              <button class="sv-theme-card \${currentTheme==='system'?'active':''}" data-theme-val="system">
                <div class="sv-theme-preview sv-preview-system">
                   <div class="sv-mock-half light-half">
                     <div class="sv-mock-sidebar">
                       <div class="sv-mock-line" style="width:40%"></div>
                       <div class="sv-mock-line" style="width:60%;margin-top:6px;"></div>
                       <div class="sv-mock-line" style="width:50%;margin-top:4px;"></div>
                       <div class="sv-mock-line" style="width:70%;margin-top:4px;"></div>
                     </div>
                     <div class="sv-mock-content" style="border-right:none;border-radius:4px 0 0 4px;">
                       <div class="sv-mock-table">
                         <div class="sv-mock-row"></div><div class="sv-mock-row"></div><div class="sv-mock-row"></div>
                       </div>
                     </div>
                   </div>
                   <div class="sv-mock-half dark-half">
                     <div class="sv-mock-sidebar" style="border-left:none; opacity: 0; padding:0; width:0; margin:0;"></div>
                     <div class="sv-mock-content" style="margin-left:0;border-left:none;border-radius:0 4px 4px 0;">
                       <div class="sv-mock-table">
                         <div class="sv-mock-row"></div><div class="sv-mock-row"></div><div class="sv-mock-row"></div>
                       </div>
                     </div>
                   </div>
                </div>
                <div class="sv-theme-label">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
                  System
                </div>
              </button>
            </div>
          </div>`;

if (content.includes(targetHtml)) {
  content = content.replace(targetHtml, newHtml);
  console.log('Replaced HTML');
} else {
  console.log('Target HTML not found');
}

// 2. Add the CSS for cards
const cssInsert = `
      .sv-theme-cards { display:grid; grid-template-columns: repeat(3, 1fr); gap:16px; margin-top: 12px; }
      .sv-theme-card { border: 1.5px solid var(--border-color); border-radius: 12px; background: transparent; padding: 0; cursor: pointer; overflow: hidden; transition: border-color 0.15s, box-shadow 0.15s; text-align: left; }
      .sv-theme-card.active { border-color: var(--color-primary); box-shadow: 0 0 0 1px var(--color-primary); }
      .sv-theme-preview { height: 110px; background: var(--bg-primary); border-bottom: 1px solid var(--border-color); display:flex; padding: 12px 12px 0 12px; }
      .sv-preview-dark { background: #111827; }
      .sv-preview-system { background: linear-gradient(90deg, #ffffff 50%, #111827 50%); padding: 0; }
      .sv-preview-light { background: #ffffff; }
      .sv-preview-light .sv-mock-content { background: #f7f9fc; border-color: #e9ecf1; }
      .sv-preview-light .sv-mock-sidebar { border-color: #e9ecf1; }
      .sv-preview-light .sv-mock-table { background: #ffffff; border-color: rgba(0,0,0,0.05); }
      .sv-preview-light .sv-mock-line { background: rgba(0,0,0,0.1); }
      .sv-preview-light .sv-mock-row { background: rgba(0,0,0,0.03); }
      .sv-mock-half { flex: 1; display:flex; padding: 12px 12px 0 12px; overflow:hidden;}
      .sv-theme-label { padding: 12px; font-size: 0.85rem; font-weight: 600; color: var(--text-secondary); display:flex; align-items:center; justify-content:center; gap: 8px; background: var(--bg-primary); }
      .sv-theme-label svg { width:16px; height:16px; }
      .sv-theme-card:hover .sv-theme-label { color: var(--text-primary); }
      .sv-mock-sidebar { width: 30px; border-right: 1px solid rgba(0,0,0,0.05); margin-right: 10px; padding-top: 4px; display:flex; flex-direction:column; }
      .sv-mock-content { flex: 1; border: 1px solid rgba(0,0,0,0.05); border-bottom:none; border-radius: 4px 4px 0 0; background: var(--bg-secondary); padding: 8px; }
      .sv-preview-dark .sv-mock-sidebar { border-color: rgba(255,255,255,0.05); }
      .sv-preview-dark .sv-mock-content { border-color: rgba(255,255,255,0.05); background: #1f2937; }
      .sv-mock-line { height: 2px; border-radius: 1px; background: rgba(0,0,0,0.1); }
      .sv-preview-dark .sv-mock-line { background: rgba(255,255,255,0.1); }
      .sv-mock-table { width: 100%; height: 100%; border: 1px solid rgba(0,0,0,0.05); border-radius: 2px; background: var(--bg-primary); padding: 4px; display:flex; flex-direction:column; gap: 4px; }
      .sv-preview-dark .sv-mock-table { background: #111827; border-color: rgba(255,255,255,0.05); }
      .sv-mock-row { height: 6px; border-radius: 1px; background: rgba(0,0,0,0.03); }
      .sv-preview-dark .sv-mock-row { background: rgba(255,255,255,0.03); }
      @media(max-width:768px){ .sv-theme-cards { grid-template-columns: 1fr; } }
`;

if (content.includes('.sv-theme-segmented .sv-seg-btn { flex-direction:row; padding:9px 18px; font-size: 0.85rem;}')) {
  content = content.replace('.sv-theme-segmented .sv-seg-btn { flex-direction:row; padding:9px 18px; font-size: 0.85rem;}', cssInsert);
  console.log('Replaced CSS');
} else {
  console.log('Target CSS not found');
}

// 3. Update the JS handler
const oldHandler = `  // Theme segmented interaction
  document.querySelectorAll('.sv-theme-segmented .sv-seg-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.sv-theme-segmented .sv-seg-btn').forEach(x => x.classList.remove('sv-seg-active'));
      btn.classList.add('sv-seg-active');
      const newTheme = btn.dataset.themeVal;
      document.documentElement.setAttribute('data-theme', newTheme);
      localStorage.setItem('safitrack_theme', newTheme);
      
      // Fire generic global re-render function if exists to update charts etc.
      if (typeof updateChartColors === 'function') setTimeout(updateChartColors, 50);
    });
  });`;

const newHandler = `  // Theme card interaction
  document.querySelectorAll('.sv-theme-card').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.sv-theme-card').forEach(x => x.classList.remove('active'));
      btn.classList.add('active');
      const newTheme = btn.dataset.themeVal;
      
      localStorage.setItem('safitrack_theme', newTheme);
      
      let actualTheme = newTheme;
      if (newTheme === 'system') {
        actualTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      }
      document.documentElement.setAttribute('data-theme', actualTheme);
      
      // Fire generic global re-render function if exists to update charts etc.
      if (typeof updateChartColors === 'function') setTimeout(updateChartColors, 50);
    });
  });`;

if (content.includes(oldHandler)) {
  content = content.replace(oldHandler, newHandler);
  console.log('Replaced Handler');
} else {
  console.log('Target handler not found');
}

fs.writeFileSync('/Users/dynamo/Documents/safitrack/crm/app.js', content, 'utf8');
console.log('App.js theme cards updated.');
