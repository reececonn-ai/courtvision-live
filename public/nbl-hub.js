
(function(){
  "use strict";
  const SYDNEY="Australia/Sydney";
  const root=()=>document.getElementById("nblHubRoot");
  let loaded=false,busy=false,currentDate=dateKey(new Date());

  function dateKey(d){
    const p=new Intl.DateTimeFormat("en-CA",{timeZone:SYDNEY,year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(d).reduce((a,x)=>(a[x.type]=x.value,a),{});
    return p.year+p.month+p.day;
  }
  function esc(v){return String(v==null?"":v).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
  function logo(team){return team?.logo||team?.logos?.[0]?.href||""}
  function fetchJson(path){return fetch(path,{cache:"no-store"}).then(r=>{if(!r.ok)throw new Error("Feed unavailable");return r.json()})}
  function setStatus(text,type){
    const el=document.getElementById("nblHubStatus");if(!el)return;
    el.className="nbl-status "+(type||"");el.innerHTML="<i></i><span>"+esc(text)+"</span>";
  }
  function teamsForEvent(event){
    return (event?.competitions?.[0]?.competitors||[]).slice().sort((a,b)=>Number(b.homeAway==="away")-Number(a.homeAway==="away"));
  }
  function eventStatus(event){
    const s=event?.status?.type||{},detail=s.shortDetail||s.detail||event?.status?.type?.description||"";
    return {state:s.state||"pre",detail};
  }
  function gameCard(event){
    const teams=teamsForEvent(event),st=eventStatus(event),comp=event?.competitions?.[0]||{};
    const when=new Intl.DateTimeFormat("en-AU",{timeZone:SYDNEY,weekday:"short",hour:"numeric",minute:"2-digit"}).format(new Date(event.date));
    const rows=teams.map(c=>'<div class="nbl-team"><img src="'+esc(logo(c.team))+'" alt=""><strong>'+esc(c.team?.shortDisplayName||c.team?.displayName)+'</strong><b>'+(st.state==="pre"?"–":esc(c.score||"0"))+'</b></div>').join("");
    const live=st.state==="in";
    return '<button class="nbl-game" type="button" data-nbl-event="'+esc(event.id)+'"><span class="nbl-game-top"><span class="'+(live?"nbl-game-live":"")+'">'+esc(live?"LIVE · "+st.detail:st.state==="post"?"FINAL":when)+'</span><span>'+esc(comp.venue?.fullName||"")+'</span></span>'+rows+'<small class="nbl-game-note">'+esc(st.state==="pre"?"Tap for likely players and game details":"Tap for game leaders and details")+'</small></button>';
  }
  function standingsEntries(data){
    const out=[];
    (function walk(v){if(!v||typeof v!=="object")return;if(Array.isArray(v))return v.forEach(walk);if(v.team&&Array.isArray(v.stats))out.push(v);Object.values(v).forEach(walk)})(data);
    return out.filter((x,i,a)=>a.findIndex(y=>y.team?.id===x.team?.id)===i);
  }
  function stat(entry,names){
    for(const n of names){const s=(entry.stats||[]).find(x=>String(x.name||x.abbreviation||x.displayName||"").toLowerCase().replace(/\s/g,"").includes(n));if(s)return s.displayValue??s.value??"–"}return "–";
  }
  function ladder(data){
    const entries=standingsEntries(data).sort((a,b)=>Number(stat(a,["playoffseed","rank"]))-Number(stat(b,["playoffseed","rank"])));
    if(!entries.length)return '<div class="nbl-empty">The live ladder is temporarily unavailable.</div>';
    return '<div class="nbl-ladder-row head"><span>#</span><span>Team</span><span class="num">P</span><span class="num">W</span><span class="num">L</span><span class="num">%</span><span class="num">Form</span></div>'+
      entries.map((e,i)=>{const form=String(stat(e,["streak"])||"").toUpperCase();return '<div class="nbl-ladder-row"><span class="rank">'+(i+1)+'</span><span class="nbl-ladder-team"><img src="'+esc(logo(e.team))+'" alt=""><span>'+esc(e.team.displayName||e.team.name)+'</span></span><span class="num">'+esc(stat(e,["gamesplayed","games"]))+'</span><span class="num">'+esc(stat(e,["wins"]))+'</span><span class="num">'+esc(stat(e,["losses"]))+'</span><span class="num">'+esc(stat(e,["winpercent","winpct"]))+'</span><span class="num">'+esc(form)+'</span></div>'}).join("");
  }
  function collectLeaders(data,events){
    const result=[];
    const seen=new Set();
    function add(label,item){
      const athlete=item?.athlete||item?.leaders?.[0]?.athlete||item;
      const name=athlete?.displayName||athlete?.fullName||item?.displayName;
      const value=item?.displayValue||item?.value||item?.statistics?.[0]?.displayValue;
      if(!name||value==null)return;
      const key=label+"|"+name;if(seen.has(key))return;seen.add(key);
      result.push({label,name,value,team:athlete?.team?.abbreviation||item?.team?.abbreviation||"",image:athlete?.headshot?.href||athlete?.headshot||""});
    }
    (function walk(v,label){
      if(!v||typeof v!=="object")return;
      if(Array.isArray(v))return v.forEach(x=>walk(x,label));
      const next=String(v.displayName||v.name||v.abbreviation||label||"Leader");
      if(v.athlete&&(v.value!=null||v.displayValue!=null))add(next,v);
      if(Array.isArray(v.leaders))v.leaders.slice(0,1).forEach(x=>add(next,x));
      Object.entries(v).forEach(([k,x])=>walk(x,next||k));
    })(data,"Season leader");
    if(result.length<4)(events||[]).forEach(e=>(e.competitions?.[0]?.leaders||[]).forEach(cat=>(cat.leaders||[]).slice(0,1).forEach(x=>add(cat.displayName||cat.name,x))));
    return result.slice(0,8);
  }
  function leadersHtml(items){
    if(!items.length)return '<div class="nbl-empty">Season leaders will appear when the NBL feed publishes them.</div>';
    return items.map(x=>'<div class="nbl-leader">'+(x.image?'<img src="'+esc(x.image)+'" alt="">':'<span></span>')+'<span><small>'+esc(x.label)+'</small><strong>'+esc(x.name)+'</strong></span><span><b>'+esc(x.value)+'</b><em>'+esc(x.team)+'</em></span></div>').join("");
  }
  function injuryItems(data,playingIds){
    const out=[];
    (function walk(v,team){
      if(!v||typeof v!=="object")return;
      if(Array.isArray(v))return v.forEach(x=>walk(x,team));
      const nextTeam=v.team?.displayName||v.displayName&&v.athletes? v.displayName:team;
      if(v.athlete&&(v.status||v.type||v.details)){out.push({name:v.athlete.displayName||v.athlete.fullName,team:nextTeam||v.athlete.team?.displayName||"",status:v.status||v.type||"Listed",detail:v.details||v.longComment||v.shortComment||""})}
      Object.values(v).forEach(x=>walk(x,nextTeam));
    })(data,"");
    const filtered=out.filter(x=>!playingIds.size||playingIds.has(String(x.team).toLowerCase()));
    return (filtered.length?filtered:out).slice(0,18);
  }
  function injuriesHtml(items){
    if(!items.length)return '<div class="nbl-empty">No injuries were returned for tonight’s teams. Check the official NBL report before tip-off.</div>';
    return items.map(x=>'<div class="nbl-injury"><strong>'+esc(x.name)+'</strong><span>'+esc(x.team)+(x.detail?" · "+esc(x.detail):"")+'</span><b>'+esc(x.status)+'</b></div>').join("");
  }
  function likelyPlayers(events){
    const groups=[];
    events.forEach(e=>teamsForEvent(e).forEach(c=>{
      const names=[];
      (c.leaders||[]).forEach(cat=>(cat.leaders||[]).forEach(x=>{const n=x.athlete?.displayName;if(n&&!names.includes(n))names.push(n)}));
      groups.push({team:c.team,names:names.slice(0,8)});
    }));
    return groups;
  }
  function playersHtml(groups){
    if(!groups.length)return '<div class="nbl-empty">Tonight’s players will appear once game rosters are supplied.</div>';
    return groups.map(g=>'<div class="nbl-player-group"><div class="nbl-player-group-head"><img src="'+esc(logo(g.team))+'" alt=""><strong>'+esc(g.team?.displayName)+'</strong></div><div class="nbl-player-chips">'+(g.names.length?g.names.map(n=>'<span>'+esc(n)+'</span>').join(""):'<span>Roster confirmation pending</span>')+'</div></div>').join("");
  }
  function shell(){
    return '<div class="nbl-hub"><nav class="competition-hub-tabs nbl-nav" aria-label="Main navigation"><button type="button" onclick="openCompetitionBoard()">COMPETITION</button><label class="owner-profile-nav"><span class="nav-select-label">OWNER PROFILE</span><select class="owner-profile-nav-select" aria-label="Choose owner profile" onchange="chooseOwnerProfile(this)"><option value="">OWNER PROFILE</option></select></label><button type="button" onclick="openStatsForNerds()">STATS FOR NERDS</button><button type="button" onclick="openTeamsHub()">TEAM STATS</button><button type="button" class="active" aria-current="page" onclick="openNblHub()">NBL HUB</button><button type="button" onclick="openTradeDesk()">TRADE</button><button type="button" onclick="openDraftBoard()">DRAFT BOARD</button></nav>'+
    '<header class="nbl-hero"><div><span class="nbl-kicker">AUSTRALIAN BASKETBALL · ONE PAGE</span><h2>NBL TONIGHT</h2><p>Games, ladder, leaders, availability and the players you’ll see.</p></div><button class="nbl-refresh" type="button" onclick="refreshNblHub()">↻ REFRESH</button></header>'+
    '<div id="nblHubStatus" class="nbl-status loading"><i></i><span>Loading the league…</span></div>'+
    '<section class="nbl-section"><div class="nbl-section-head"><div><small>SYDNEY TIME</small><h3>Games tonight</h3></div><span id="nblDateLabel"></span></div><div class="nbl-games" id="nblGames"></div></section>'+
    '<div class="nbl-main-grid"><section class="nbl-section"><div class="nbl-section-head"><div><small>LIVE TABLE</small><h3>NBL ladder</h3></div><span>W · L · WIN%</span></div><div class="nbl-ladder" id="nblLadder"></div></section>'+
    '<section class="nbl-section"><div class="nbl-section-head"><div><small>WHO IS COOKING</small><h3>Stat leaders</h3></div><span>SEASON</span></div><div class="nbl-leaders" id="nblLeaders"></div></section></div>'+
    '<div class="nbl-night-grid"><section class="nbl-section"><div class="nbl-section-head"><div><small>AVAILABILITY</small><h3>Injury report</h3></div><span>TONIGHT’S TEAMS FIRST</span></div><div class="nbl-injuries" id="nblInjuries"></div></section>'+
    '<section class="nbl-section"><div class="nbl-section-head"><div><small>ON THE FLOOR</small><h3>Players tonight</h3></div><span>UPDATES NEAR TIP-OFF</span></div><div class="nbl-players" id="nblPlayers"></div></section></div>'+
    '<p class="nbl-source">Live data: ESPN NBL feeds · Injury availability should be checked against the official NBL report before tip-off.</p></div>';
  }
  async function load(force){
    if(busy)return;busy=true;
    setStatus("Updating games, ladder and players…","loading");
    const q=force?"&fresh=1":"";
    const requests=await Promise.allSettled([
      fetchJson("/api/nbl/scoreboard?dates="+currentDate+q),
      fetchJson("/api/nbl/standings?season=2027"+q),
      fetchJson("/api/nbl/statistics?season=2027"+q),
      fetchJson("/api/nbl/injuries?season=2027"+q)
    ]);
    const get=i=>requests[i].status==="fulfilled"?requests[i].value:{};
    const score=get(0),stand=get(1),stats=get(2),inj=get(3),events=Array.isArray(score.events)?score.events:[];
    document.getElementById("nblDateLabel").textContent=new Intl.DateTimeFormat("en-AU",{timeZone:SYDNEY,weekday:"long",day:"numeric",month:"short"}).format(new Date());
    document.getElementById("nblGames").innerHTML=events.length?events.map(gameCard).join(""):'<div class="nbl-empty">No NBL games tonight. The rest of the hub is still live.</div>';
    document.getElementById("nblLadder").innerHTML=ladder(stand);
    document.getElementById("nblLeaders").innerHTML=leadersHtml(collectLeaders(stats,events));
    const playingNames=new Set(events.flatMap(e=>teamsForEvent(e).map(c=>String(c.team?.displayName||"").toLowerCase())));
    document.getElementById("nblInjuries").innerHTML=injuriesHtml(injuryItems(inj,playingNames));
    document.getElementById("nblPlayers").innerHTML=playersHtml(likelyPlayers(events));
    document.querySelectorAll("[data-nbl-event]").forEach(b=>b.addEventListener("click",()=>openGame(b.dataset.nblEvent)));
    const ok=requests.filter(x=>x.status==="fulfilled").length;
    setStatus(ok===4?"Live NBL feeds updated · "+new Intl.DateTimeFormat("en-AU",{timeZone:SYDNEY,hour:"numeric",minute:"2-digit"}).format(new Date()):ok+" of 4 live feeds available",ok?"":"error");
    busy=false;loaded=true;
  }
  async function openGame(id){
    const box=document.getElementById("nblPlayers");if(!box)return;
    box.innerHTML='<div class="nbl-empty">Loading game roster and leaders…</div>';
    try{
      const data=await fetchJson("/api/nbl/summary?event="+encodeURIComponent(id));
      const groups=[];
      const rosters=data.rosters||data.boxscore?.players||[];
      rosters.forEach(r=>{const team=r.team||{};const names=(r.roster||r.statistics?.[0]?.athletes||r.athletes||[]).map(x=>x.athlete?.displayName||x.displayName||x.fullName).filter(Boolean);groups.push({team,names:names.slice(0,14)})});
      box.innerHTML=playersHtml(groups);
      box.closest(".nbl-section")?.scrollIntoView({behavior:"smooth",block:"start"});
    }catch(_){box.innerHTML='<div class="nbl-empty">Game roster is not available yet. It normally fills close to tip-off.</div>'}
  }
  window.openNblHub=function(){
    showScreenLocal("nblHubScreen");
    if(!root().innerHTML)root().innerHTML=shell();
    if(window.syncOwnerProfileSelects)window.syncOwnerProfileSelects();
    if(!loaded)load(false);
  };
  window.refreshNblHub=function(){load(true)};
})();
