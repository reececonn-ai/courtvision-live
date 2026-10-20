
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

  function injuryTeam(data,name){
    const entry=(data?.injuries||[]).find(x=>teamName(x.team||x)===name);
    return entry?entry.injuries||[]:null;
  }
  function injuryList(name,list){
    return '<section><h4>'+esc(name)+'</h4>'+(list?.length?list.map(x=>'<article class="game-availability-player"><strong>'+esc(x.athlete?.displayName||x.player||"Player")+'</strong> <span class="availability-status">'+esc(x.status||"Status not supplied")+'</span><p>'+esc(x.shortComment||x.longComment||x.details?.detail||"")+'</p>'+(x.date?'<small>Reported '+esc(dateText(x.date))+'</small>':'')+'</article>').join(""):'<p class="availability-note">No injuries listed. This does not confirm everyone is available.</p>')+'</section>';
  }
  async function renderGame(panel,g,summaryProvider){
    if(g.sample||String(g.id).startsWith("demo-")){panel.innerHTML="";return}
    const today=keyNow(),key=(()=>{const p=new Intl.DateTimeFormat("en-CA",{timeZone:"Australia/Sydney",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date(g.date)).reduce((o,p)=>(o[p.type]=p.value,o),{});return p.year+"-"+p.month+"-"+p.day})();
    const historical=key<today,days=Math.round((Date.parse(key+"T12:00:00Z")-Date.parse(today+"T12:00:00Z"))/86400000);
    if(["POSTPONED","CANCELLED"].includes(g.status)){panel.innerHTML='<p class="availability-note">'+esc(g.status)+' · no confirmed lineup for this scheduled game.</p>';return}
    panel.innerHTML='<p class="availability-note">Loading starting fives and availability…</p>';
    const results=await Promise.allSettled([summaryProvider?summaryProvider(g):summary(g.id),days>=0&&days<=1?injuries():Promise.resolve(null)]);
    if(!panel.isConnected)return;
    const data=results[0].status==="fulfilled"?results[0].value:null,current=results[1].status==="fulfilled"?results[1].value:null;
    let html='<h4 class="game-lineup-heading">Starting lineups</h4><div class="availability-lineup">'+lineupTeam(data,g.away,g.status,historical||g.status==="FINAL")+lineupTeam(data,g.home,g.status,historical||g.status==="FINAL")+'</div><h4 class="game-lineup-heading">Who’s out / availability</h4>';
    const gameSpecific=[g.away,g.home].some(name=>injuryTeam(data,name)!==null);
    const source=gameSpecific?data:current;
    if(source&&Array.isArray(source.injuries)){
      html+='<p class="availability-note">'+(gameSpecific?'ESPN game injury report':'Latest ESPN injury report · '+(days===0?'today’s slate':'current statuses, not confirmed for tomorrow'))+' · checked '+esc(dateText(Date.now()))+'</p><div class="game-availability-columns">'+[g.away,g.home].map(name=>injuryList(name,injuryTeam(source,name))).join("")+'</div>';
    }else html+='<p class="availability-note">'+(historical?'Historical injury reports unavailable.':days>1?'Game-day injury reports are not published this far ahead.':'Injury report temporarily unavailable. No availability assumptions made.')+'</p>';
    panel.innerHTML=html;
  }
  window.cvAvailability={renderGame};
})();
