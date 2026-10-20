
/* Daily availability is presentation-only. Current injury reports are not historical reports. */
(()=>{
  const esc=v=>String(v??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
  let latestArgs=null;
  let token=0,injuryCache=null;const summaries=new Map();
  const keyNow=()=>{const parts=new Intl.DateTimeFormat("en-CA",{timeZone:"Australia/Sydney",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date()).reduce((o,p)=>(o[p.type]=p.value,o),{});return parts.year+"-"+parts.month+"-"+parts.day};
  const dateText=date=>{const d=new Date(date);return Number.isFinite(+d)?new Intl.DateTimeFormat("en-AU",{timeZone:"Australia/Sydney",day:"numeric",month:"short",hour:"numeric",minute:"2-digit"}).format(d):"Date not supplied"};
  const owner=name=>state.assignments?.[name]?.player||"Unowned";
  const teamName=team=>TEAM_DATA.find(t=>t[0]===team?.displayName||t[1]===team?.abbreviation)?.[0];
  async function get(path){const r=await fetch(path,{signal:AbortSignal.timeout(9000)});if(!r.ok)throw Error("Unavailable");return r.json()}
  async function injuries(){
    if(injuryCache&&Date.now()-injuryCache.at<120000)return injuryCache.promise;
    const promise=get("/api/nba/team-detail?team=nba&kind=injuries");injuryCache={at:Date.now(),promise};
    try{return await promise}catch(e){injuryCache=null;throw e}
  }
  async function summary(id){
    if(!/^\d+$/.test(String(id)))throw Error("Invalid game");
    let item=summaries.get(id);if(item&&Date.now()-item.at<60000)return item.promise;
    item={at:Date.now(),promise:get("/api/nba/summary?event="+encodeURIComponent(id))};summaries.set(id,item);
    if(summaries.size>40)summaries.delete(summaries.keys().next().value);
    try{return await item.promise}catch(e){summaries.delete(id);throw e}
  }
  function projected(name){
    if(typeof projectedStarters!=="function")return "";
    const players=projectedStarters(name,state.liveRosters?.[name]||[]);
    if(!players.length)return '<p>Starting five not confirmed.</p>';
    const source=typeof starterSourceLabel==="function"?starterSourceLabel(players,name):"Cached projection";
    return '<p class="availability-note">Projected only · '+esc(source)+'. Not today’s confirmed lineup.</p><ul>'+players.map(p=>'<li>'+esc(p.name)+(p.slot?' <small>'+esc(p.slot)+'</small>':'')+'</li>').join("")+'</ul>';
  }
  function lineupTeam(data,name,status,historical){
    const entry=(data?.boxscore?.players||[]).find(x=>teamName(x.team)===name);
    const rows=entry?.statistics?.flatMap(group=>group.athletes||[])||[];
    const starters=[...new Map(rows.filter(p=>p.starter===true).map(p=>[p.athlete?.id||p.athlete?.displayName,p])).values()];
    const confirmed=["IN","FINAL"].includes(status)&&starters.length===5;
    return '<section><h4>'+esc(name)+' <small>· '+esc(owner(name))+'</small></h4>'+
      (confirmed?'<p class="availability-confirmed">'+(status==="FINAL"?'Starting five · final box score':'Confirmed starters · game box score')+'</p><ul>'+starters.map(p=>'<li>'+esc(p.athlete?.displayName||"Player")+'</li>').join("")+'</ul>':
        historical?'<p>Historical starting five unavailable.</p>':projected(name))+'</section>';
  }
  async function render(games,key,flags={}){
    latestArgs=[games,key,flags];
    const host=document.getElementById("competitionAvailability");if(!host)return;
    const current=++token,today=keyNow(),historical=key<today,teams=[...new Set(games.flatMap(g=>[g.away,g.home]))];
    if(!games.length){host.innerHTML=flags.loading?'<p class="availability-note">Availability follows the selected date’s games.</p>':flags.error?'<p class="availability-note">Load the schedule to see the relevant teams.</p>':"";return}
    host.innerHTML='<div class="availability-heading"><div><span class="team-section-label">WHO’S IN · WHO’S OUT</span><h3>Injuries & lineups</h3></div><small>'+esc(key)+' · Sydney slate</small></div><div class="availability-injuries" aria-live="polite">'+(historical?'<p class="availability-note">Historical injury reports are not available from this feed. Game starters may be available below.</p>':'<p class="availability-note">Loading latest injury reports…</p>')+'</div><div class="availability-matchups">'+games.map((g,i)=>'<details class="availability-game"><summary>'+esc(g.away)+' vs '+esc(g.home)+'<small>'+esc(owner(g.away))+' vs '+esc(owner(g.home))+' · Tap for lineups</small></summary><div class="availability-lineup" data-game="'+i+'"><p>Open to load starting fives.</p></div></details>').join("")+'</div>';
    const active=()=>token===current&&host.isConnected;
    host.querySelectorAll(".availability-game").forEach((details,i)=>details.addEventListener("toggle",async()=>{
      if(!details.open)return;
      const g=games[i],body=details.querySelector(".availability-lineup");
      if(["POSTPONED","CANCELLED"].includes(g.status)){body.innerHTML='<p>'+esc(g.status)+' · no confirmed lineup for this scheduled game.</p>';return}
      body.innerHTML='<p>Loading lineup…</p>';
      try{
        const data=await summary(g.id);if(active()&&body.isConnected)body.innerHTML=lineupTeam(data,g.away,g.status,historical)+lineupTeam(data,g.home,g.status,historical)+'<p class="availability-note">ESPN · checked '+esc(dateText(Date.now()))+'. Pregame projections can change before tip-off.</p>';
      }catch(_){if(active()&&body.isConnected)body.innerHTML='<p class="availability-note">Live lineup feed unavailable.</p>'+lineupTeam(null,g.away,g.status,historical)+lineupTeam(null,g.home,g.status,historical);}
    }));
    if(historical)return;
    try{
      const data=await injuries();if(!Array.isArray(data?.injuries))throw Error("Invalid injury report");if(!active())return;
      const report=host.querySelector(".availability-injuries");
      report.innerHTML='<p class="availability-note">Latest ESPN injury feed · checked '+esc(dateText(injuryCache.at))+'. '+(key!==today?'This is current availability, not a confirmed report for '+esc(key)+'. ':'')+'Only teams on this slate are listed. No listing does not confirm fitness.</p><div class="availability-team-grid">'+teams.map(name=>{
        const entry=(data.injuries||[]).find(t=>teamName(t)===name);
        const list=entry?.injuries||[];
        return '<section><h4>'+esc(name)+' <small>· '+esc(owner(name))+'</small></h4>'+(list.length?list.map(x=>'<article><strong>'+esc(x.athlete?.displayName||"Player")+'</strong><span class="availability-status">'+esc(x.status||"Status not supplied")+'</span><p>'+esc(x.shortComment||x.longComment||"No additional detail.")+'</p><small>Reported '+esc(dateText(x.date))+'</small></article>').join(""):'<p class="availability-note">No injuries listed in the feed.</p>')+'</section>';
      }).join("")+'</div>';
    }catch(_){if(active())host.querySelector(".availability-injuries").innerHTML='<p class="availability-note">Injury report temporarily unavailable. No availability assumptions have been made.</p>'}
  }
  window.cvAvailability={render,refresh:()=>latestArgs?render(...latestArgs):undefined};
})();
