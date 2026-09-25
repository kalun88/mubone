import { attach } from '/Users/kalun/Documents/GitHub/muboneapp/scripts/lib/rig.js';
const rig=await attach();
console.log(await rig.evaluate(async ()=>{
  const { S } = await import('./js/state.js');
  const z=ms=>new Promise(r=>setTimeout(r,ms));
  if(!document.querySelector('#settingsModal.open')){document.getElementById('tcSettings')?.click();await z(700);}
  [...document.querySelectorAll('.set-nav-item')].find(n=>n.dataset.sec==='pins')?.click(); await z(700);
  const out=[];
  const svg=document.querySelector('.pinfig-svg'), fig=document.getElementById('pinFigure');
  const r=svg.getBoundingClientRect();
  out.push(`svg ${r.width.toFixed(0)}x${r.height.toFixed(0)}  viewBox="${svg.getAttribute('viewBox')}"  preserveAspectRatio=${svg.getAttribute('preserveAspectRatio')||'(default)'}`);
  const sx=r.width/parseFloat(svg.getAttribute('viewBox').split(' ')[2]);
  const sy=r.height/parseFloat(svg.getAttribute('viewBox').split(' ')[3]);
  out.push(`scale x=${sx.toFixed(3)} y=${sy.toFixed(3)}  -> UNIFORM: ${Math.abs(sx-sy)<0.01}   (was 2.7 vs 1.0)`);
  const c=svg.querySelector('.pinfig-pin').getBoundingClientRect();
  out.push(`pin dot ${c.width.toFixed(1)}x${c.height.toFixed(1)} -> round: ${Math.abs(c.width-c.height)<0.6}`);
  const lbls=[...svg.querySelectorAll('.pinfig-lbl')].map(t=>t.getBoundingClientRect());
  out.push(`labels bottom ${Math.max(...lbls.map(b=>b.bottom)).toFixed(1)} vs svg bottom ${r.bottom.toFixed(1)} -> clipped: ${Math.max(...lbls.map(b=>b.bottom))>r.bottom+0.5}`);
  const bars=[...svg.querySelectorAll('.pinfig-bar')].map(b=>b.getBoundingClientRect());
  out.push(`bars: ${bars.map(b=>`${b.width.toFixed(0)}x${b.height.toFixed(0)}`).join('  ')||'(none)'}`);
  const pct=[...svg.querySelectorAll('.pinfig-pct')].map(t=>t.textContent);
  out.push(`numbers on the bars: ${pct.join('  ')}`);
  out.push(`caption: "${document.getElementById('pinFigCap').textContent}"`);
  // and in Focus, where the picture actually matters
  const was=S.commitPlayback; S.commitPlayback='focus'; S._drawPinFigure(); await z(200);
  out.push(`\nFocus: bars ${[...svg.querySelectorAll('.pinfig-bar')].map(b=>b.getBoundingClientRect().height.toFixed(0)).join(', ')}` +
           `  numbers ${[...svg.querySelectorAll('.pinfig-pct')].map(t=>t.textContent).join(' ')}  reach ${svg.querySelectorAll('.pinfig-reach').length}`);
  S.commitPlayback=was; S._drawPinFigure();
  document.getElementById('settingsClose')?.click();
  return out.join('\n');
}));
