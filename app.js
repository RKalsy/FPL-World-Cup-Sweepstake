
function parseCSV(t){const l=t.trim().split(/\r?\n/);const h=l[0].split(',');return l.slice(1).map(r=>{const c=r.split(',');let o={};h.forEach((x,i)=>o[x]=c[i]||'');return o;});}
async function load(){
let teams=parseCSV(await fetch(window.TEAMS_CSV + '&ts=' + Date.now()).then(r=>r.text()));
teams = teams.filter(t => t.Team && t.Team.trim() && t.Owner && t.Owner.trim());
const awards=parseCSV(await fetch(window.AWARDS_CSV + '&ts=' + Date.now()).then(r=>r.text()));
const metadata=parseCSV(await fetch(window.METADATA_CSV + '&ts=' + Date.now()).then(r=>r.text()));
const previous=parseCSV(await fetch(window.PREVIOUS_POSITIONS_CSV + '&ts=' + Date.now()).then(r=>r.text()));
const meta={}; metadata.forEach(r=>meta[r.Setting]=r.Value);
const players={};
teams.forEach(t=>{const p=t.Owner;if(!players[p])players[p]={mp:0,pts:0,gd:0,gf:0,ga:0,w:0,d:0,l:0,teams:[]};
const pts=(+t.Pts||0); players[p].mp += (+t.MP||0); players[p].pts+=pts; players[p].gf+=(+t.GF||0); players[p].ga+=(+t.GA||0); players[p].gd+=(+t.GF||0)-(+t.GA||0); players[p].w+=(+t.W||0); players[p].d+=(+t.D||0); players[p].l+=(+t.L||0); players[p].teams.push(t);});
const rows=Object.entries(players).sort((a,b)=>b[1].pts-a[1].pts||b[1].gd-a[1].gd||b[1].gf-a[1].gf);
const prevRanks={}; previous.forEach(r=>prevRanks[r.Player]=parseInt(r.Rank||0));
document.getElementById('hero').innerHTML=`<h1>FPL WORLD CUP 2026</h1><p>🥇 ${rows[0]?.[0]||''} £35 &nbsp; 🥈 ${rows[1]?.[0]||''} £20 &nbsp; 🥉 ${rows[2]?.[0]||''} £15</p><p>${meta['Tournament Phase']||''} • ${meta['Last Updated']||''}</p>`;


let tbl='<table><tr><th>Pos</th><th>Player</th><th>MP</th><th>Pts</th><th>GD</th><th>W</th><th>D</th><th>L</th></tr>';
rows.forEach((r,i)=>{
let move='<span style="color:#9ca3af">➖</span>';
const prev=prevRanks[r[0]];
if(prev){
 if((i+1)<prev) move='<span style="color:#22c55e">▲'+(prev-(i+1))+'</span>';
 else if((i+1)>prev) move='<span style="color:#ef4444">▼'+((i+1)-prev)+'</span>';
}
const pos=(i+1)+' '+move;
const gd=r[1].gd>0?`+${r[1].gd}`:`${r[1].gd}`;
const bg=i===0?' style="background:linear-gradient(90deg,rgba(212,175,55,.28),transparent)"':i===1?' style="background:linear-gradient(90deg,rgba(192,192,192,.20),transparent)"':i===2?' style="background:linear-gradient(90deg,rgba(205,127,50,.20),transparent)"':'';
tbl+=`<tr${bg}><td>${pos}</td><td>${r[0]}</td><td>${r[1].mp}</td><td>${r[1].pts}</td><td>${gd}</td><td>${r[1].w}</td><td>${r[1].d}</td><td>${r[1].l}</td></tr>`;
});
tbl+='</table>'; document.getElementById('leaderboard').innerHTML=tbl;


document.getElementById('players').innerHTML=rows.map(r=>`<details><summary><span style='font-weight:800;letter-spacing:.05em'>${r[0].toUpperCase()}</span> <span style='background:#D4AF37;color:#081120;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:800'>${r[1].pts} PTS</span></summary><div class="teamgrid">${r[1].teams.map(t=>{let gd=(+t.GF||0)-(+t.GA||0);let c=(+t.Pts>1)?'good':((+t.Pts==1)?'neutral':'bad');return `<div class="teamtile ${c}">${t.Flag?.trim() || '🏳️'} ${t.Team}<br>${t.Pts||0} PTS • ${gd>0?`+${gd}`:gd} GD</div>`}).join('')}</div></details>`).join('');
const ownerMap={};teams.forEach(t=>ownerMap[t.Team]=t.Owner);
document.getElementById('ownership').innerHTML=teams.sort((a,b)=>a.Team.localeCompare(b.Team)).map(t=>`${t.Flag?.trim() || '🏳️'} ${t.Team} → ${t.Owner}`).join('<br>');
}
load();
