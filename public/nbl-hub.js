
(function(){
  "use strict";
  const SYDNEY="Australia/Sydney";
  const root=()=>document.getElementById("nblHubRoot");
  let loaded=false,busy=false,nightGames=[],nightPlayers=[];

  function keyFor(value){
    const d=value instanceof Date?value:new Date(value);
    const p=new Intl.DateTimeFormat("en-CA",{timeZone:SYDNEY,year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(d).reduce((a,x)=>(a[x.type]=x.value,a),{});
    return p.year+p.month+p.day;
  }
  function todayKey(){return keyFor(new Date())}
  function esc(v){return String(v==null?"":v).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
  function feedData(v){return Array.isArray(v?.data)?v.data:Array.isArray(v)?v:[]}
  function fetchJson(path){return fetch(path,{cache:"no-store"}).then(r=>{if(!r.ok)throw new Error("Feed unavailable");return r.json()})}
  function setStatus(text,type){
    const el=document.getElementById("nblHubStatus");if(!el)return;
    el.className="nbl-status "+(type||"");el.innerHTML="<i></i><span>"+esc(text)+"</span>";
  }
  function logo(team){return team?.team_logo||team?.logo||team?.logos?.[0]?.href||""}
  function teamName(team){return team?.name||team?.displayName||team?.shortDisplayName||"Team"}
  function matchState(game){
    const raw=String(game?.match_status||game?.status||"").toLowerCase();
    if(raw.includes("complete")||raw.includes("confirm")||raw.includes("final"))return "post";
    if(raw.includes("live")||raw.includes("progress")||raw.includes("active"))return "in";
    return "pre";
  }
  function gameCard(game){
    const state=matchState(game),home=game.home_team||{},away=game.away_team||{};
    const when=new Intl.DateTimeFormat("en-AU",{timeZone:SYDNEY,hour:"numeric",minute:"2-digit"}).format(new Date(game.start_time));
    const score=(team,side)=>state==="pre"?"–":esc(game[side+"_score"]??"0");
    const row=(team,side)=>'<div class="nbl-team"><img src="'+esc(logo(team))+'" alt=""><strong>'+esc(teamName(team))+'</strong><b>'+score(team,side)+'</b></div>';
    const venue=game.venue?.name||game.venue_name||"";
    const status=state==="in"?"LIVE":state==="post"?"FINAL":when;
    return '<button type="button" class="nbl-game" onclick="openNblGame(\''+esc(game.id).replace(/'/g,"&#39;")+'\')"><span class="nbl-game-top"><span class="'+(state==="in"?"nbl-game-live":"")+'">'+esc(status)+'</span><span>'+esc(venue)+'</span></span>'+row(away,"away")+row(home,"home")+'<small class="nbl-game-note">TAP FOR ROSTERS, STATS & GAME CENTRE →</small></button>';
  }
  function ladderHtml(data){
    const rows=feedData(data).slice().sort((a,b)=>Number(a.position)-Number(b.position));
    if(!rows.length)return '<div class="nbl-empty">The official NBL ladder is temporarily unavailable.</div>';
    return '<div class="nbl-ladder-row head"><span>#</span><span>Team</span><span class="num">P</span><span class="num">W</span><span class="num">L</span><span class="num">%</span><span class="num">Form</span></div>'+
      rows.map((r,i)=>{
        const form=Array.isArray(r.last_5)?r.last_5:String(r.last_5||"").split(/[\s,]+/).filter(Boolean);
        const pct=Number(r.win_percentage);
        const pctText=Number.isFinite(pct)?(pct<=1?(pct*100).toFixed(1):pct.toFixed(1))+"%":"–";
        return '<div class="nbl-ladder-row"><span class="rank">'+esc(r.position||i+1)+'</span><span class="nbl-ladder-team"><img src="'+esc(logo(r.team))+'" alt=""><span>'+esc(teamName(r.team))+'</span></span><span class="num">'+esc(r.played??"–")+'</span><span class="num">'+esc(r.won??"–")+'</span><span class="num">'+esc(r.lost??"–")+'</span><span class="num">'+esc(pctText)+'</span><span class="nbl-form">'+form.slice(-5).map(x=>'<i class="'+(String(x).toLowerCase().startsWith("w")?"w":"l")+'">'+esc(String(x).charAt(0).toUpperCase())+'</i>').join("")+'</span></div>';
      }).join("");
  }
  function teamId(team){return String(team?.id||team?.team_id||"")}
  function playerRows(allPlayers,games){
    const tonightTeams=[];
    games.forEach(g=>[g.away_team,g.home_team].forEach(t=>{if(t&&!tonightTeams.some(x=>teamId(x)===teamId(t)))tonightTeams.push(t)}));
    return tonightTeams.map(team=>{
      const id=teamId(team),name=teamName(team);
      const roster=allPlayers.filter(x=>{
        const pt=x.team||x.player?.team||{};
        return (id&&teamId(pt)===id)||String(teamName(pt)).toLowerCase()===String(name).toLowerCase();
      }).filter((x,i,a)=>{
        const p=x.player||x.athlete||x;
        const pid=String(p.id||p.first_name+"|"+p.last_name);
        return a.findIndex(y=>{const q=y.player||y.athlete||y;return String(q.id||q.first_name+"|"+q.last_name)===pid})===i;
      }).sort((a,b)=>(Number(a.jersey_number)||999)-(Number(b.jersey_number)||999));
      return {team,roster,live:games.some(g=>matchState(g)==="in"&&(teamId(g.home_team)===id||teamId(g.away_team)===id))};
    });
  }
  function playersHtml(groups){
    if(!groups.length)return '<div class="nbl-empty">There are no NBL games tonight, so there are no game-night rosters to display.</div>';
    return groups.map(g=>'<details class="nbl-player-group" '+(g.live?'open':'')+'><summary class="nbl-player-group-head"><img src="'+esc(logo(g.team))+'" alt=""><strong>'+esc(teamName(g.team))+'</strong><small>'+(g.live?'LIVE · ':'')+g.roster.length+' players</small><i>⌄</i></summary><div class="nbl-roster-list">'+(g.roster.length?g.roster.map(x=>{const p=x.player||x.athlete||x;const name=p.displayName||p.fullName||[p.first_name,p.last_name].filter(Boolean).join(" ");const jersey=x.jersey_number||p.jersey||"–";const pos=x.playing_position||p.position?.abbreviation||"";return '<div class="nbl-roster-player"><b>'+esc(jersey)+'</b><span><strong>'+esc(name)+'</strong><small>'+esc(pos)+'</small></span></div>'}).join(""):'<div class="nbl-empty">Official roster pending.</div>')+'</div></details>').join("");
  }

  function leagueLeadersHtml(feeds){
    const categories=[
      ["SCORING","PPG","points_average"],
      ["REBOUNDS","RPG","rebounds_average"],
      ["ASSISTS","APG","assists_average"],
      ["STEALS","SPG","steals_average"],
      ["BLOCKS","BPG","blocks_average"]
    ];
    return categories.map((cat,index)=>{
      const metric=cat[2];
      const valueOf=x=>{
        const n=Number(x?.[metric]??x?.average??x?.value??x?.displayValue);
        return Number.isFinite(n)?n:-Infinity;
      };
      const rows=feedData(feeds[index]).slice().sort((a,b)=>valueOf(b)-valueOf(a));
      return '<section class="nbl-leader-category"><header><strong>'+cat[0]+'</strong><span>'+cat[1]+'</span></header><div>'+
        (rows.length?rows.slice(0,8).map((x,i)=>{
          const p=x.player||x.athlete||x;
          const name=p.displayName||p.fullName||[p.first_name,p.last_name].filter(Boolean).join(" ")||"Player";
          const team=x.team||p.team||{};
          const raw=x[cat[2]]??x.average??x.value??x.displayValue??"–";
          const value=Number.isFinite(Number(raw))?Number(raw).toFixed(1):raw;
          return '<div class="nbl-leader-row"><b>'+(i+1)+'</b><span><strong>'+esc(name)+'</strong><small>'+esc(team.team_code||team.abbreviation||teamName(team))+'</small></span><em>'+esc(value)+'</em></div>';
        }).join(""):'<p class="nbl-empty">Unavailable</p>')+
      '</div></section>';
    }).join("");
  }

  function injuryItems(data,games){
    const names=new Set(games.flatMap(g=>[teamName(g.home_team),teamName(g.away_team)]).map(x=>x.toLowerCase()));
    const out=[];
    (function walk(v,team){
      if(!v||typeof v!=="object")return;
      if(Array.isArray(v))return v.forEach(x=>walk(x,team));
      const next=v.team?.displayName||v.team?.name||team;
      if(v.athlete&&(v.status||v.type||v.details||v.shortComment))out.push({name:v.athlete.displayName||v.athlete.fullName,team:next||v.athlete.team?.displayName||"",status:v.status||v.type||"Listed",detail:v.details||v.shortComment||v.longComment||""});
      Object.values(v).forEach(x=>walk(x,next));
    })(data,"");
    const tonight=out.filter(x=>names.has(String(x.team).toLowerCase()));
    return tonight.length?tonight:out.slice(0,20);
  }
  function injuriesHtml(items){
    if(!items.length)return '<div class="nbl-empty">No live injury entries were returned. Use the official NBL injury report before tip-off.</div>';
    return items.map(x=>'<div class="nbl-injury"><strong>'+esc(x.name)+'</strong><span>'+esc(x.team)+(x.detail?" · "+esc(x.detail):"")+'</span><b>'+esc(x.status)+'</b></div>').join("");
  }
  function shell(){
    return '<div class="nbl-hub"><nav class="competition-hub-tabs nbl-nav" aria-label="Main navigation"><button type="button" onclick="openCompetitionBoard()">COMPETITION</button><label class="owner-profile-nav"><span class="nav-select-label">OWNER PROFILE</span><select class="owner-profile-nav-select" aria-label="Choose owner profile" onchange="chooseOwnerProfile(this)"><option value="">OWNER PROFILE</option></select></label><button type="button" onclick="openStatsForNerds()">STATS FOR NERDS</button><button type="button" onclick="openTeamsHub()">TEAM STATS</button><button type="button" class="active" aria-current="page" onclick="openNblHub()">NBL HUB</button><button type="button" onclick="openTradeDesk()">TRADE</button><button type="button" onclick="openDraftBoard()">DRAFT BOARD</button></nav>'+
    '<header class="nbl-hero"><div><span class="nbl-kicker">OFFICIAL NBL DATA · ONE PAGE</span><h2>NBL TONIGHT</h2><p>Tonight’s games, every player, the ladder and availability.</p></div><button class="nbl-refresh" type="button" onclick="refreshNblHub()">↻ REFRESH</button></header>'+
    '<div id="nblHubStatus" class="nbl-status loading"><i></i><span>Loading the official NBL feed…</span></div>'+
    '<section class="nbl-section"><div class="nbl-section-head"><div><small>SYDNEY TIME</small><h3>Games tonight</h3></div><span id="nblDateLabel"></span></div><div class="nbl-games" id="nblGames"></div></section>'+
    '<div class="nbl-game-modal" id="nblGameModal" hidden><div class="nbl-game-dialog"><button type="button" class="nbl-game-close" onclick="closeNblGame()">CLOSE ×</button><div id="nblGameDetail"></div></div></div>'+
    '<section class="nbl-section nbl-leaders-feature"><div class="nbl-section-head"><div><small>OFFICIAL NBL NUMBERS</small><h3>League leaders</h3></div><span>TOP 8 IN EACH CATEGORY</span></div><div class="nbl-leaders nbl-leader-categories" id="nblLeaders"></div></section>'+
    '<section class="nbl-section"><div class="nbl-section-head"><div><small>FULL GAME-NIGHT ROSTERS</small><h3>Players tonight</h3></div><span>LIVE TEAMS OPEN · OTHERS COLLAPSED</span></div><div class="nbl-players nbl-players-full" id="nblPlayers"></div></section>'+
    '<div class="nbl-bottom-grid"><section class="nbl-section nbl-ladder-compact"><div class="nbl-section-head"><div><small>LIVE TABLE</small><h3>NBL ladder</h3></div><span>P · W · L · WIN%</span></div><div class="nbl-ladder" id="nblLadder"></div></section>'+
    '<section class="nbl-section"><div class="nbl-section-head"><div><small>AVAILABILITY</small><h3>Injury report</h3></div><span>TONIGHT’S TEAMS FIRST</span></div><div class="nbl-injuries" id="nblInjuries"></div></section></div>'+
    '<p class="nbl-source">Games, scores, ladder and player rosters: official NBL.com.au live data · Injury availability: live basketball feed.</p></div>';
  }
  async function load(force){
    if(busy)return;busy=true;
    setStatus("Updating the official NBL schedule, ladder and rosters…","loading");
    const q=force?"?fresh=1":"";
    const results=await Promise.allSettled([
      fetchJson("/api/nbl/scoreboard"+q),
      fetchJson("/api/nbl/standings"+q),
      fetchJson("/api/nbl/players"+q),
      fetchJson("/api/nbl/injuries"+q),
      fetchJson("/api/nbl/leaders?metric=points"+(force?"&fresh=1":"")),
      fetchJson("/api/nbl/leaders?metric=rebounds"+(force?"&fresh=1":"")),
      fetchJson("/api/nbl/leaders?metric=assists"+(force?"&fresh=1":"")),
      fetchJson("/api/nbl/leaders?metric=steals"+(force?"&fresh=1":"")),
      fetchJson("/api/nbl/leaders?metric=blocks"+(force?"&fresh=1":""))
    ]);
    const get=i=>results[i].status==="fulfilled"?results[i].value:{};
    const allGames=feedData(get(0)).sort((a,b)=>Date.parse(a.start_time)-Date.parse(b.start_time));
    const games=allGames.filter(g=>keyFor(g.start_time)===todayKey());
    const players=feedData(get(2));
    nightGames=games;nightPlayers=players;
    document.getElementById("nblDateLabel").textContent=new Intl.DateTimeFormat("en-AU",{timeZone:SYDNEY,weekday:"long",day:"numeric",month:"short"}).format(new Date());
    document.getElementById("nblGames").innerHTML=games.length?games.map(gameCard).join(""):'<div class="nbl-empty">No NBL games tonight. The ladder and injury report are still current.</div>';
    document.getElementById("nblPlayers").innerHTML=playersHtml(playerRows(players,games));
    document.getElementById("nblLadder").innerHTML=ladderHtml(get(1));
    document.getElementById("nblLeaders").innerHTML=leagueLeadersHtml([get(4),get(5),get(6),get(7),get(8)]);
    document.getElementById("nblInjuries").innerHTML=injuriesHtml(injuryItems(get(3),games));
    const officialOk=results.slice(0,3).filter(x=>x.status==="fulfilled").length;
    setStatus(officialOk===3?"Official NBL feed live · updated "+new Intl.DateTimeFormat("en-AU",{timeZone:SYDNEY,hour:"numeric",minute:"2-digit"}).format(new Date()):officialOk+" of 3 official NBL feeds available",officialOk?"":"error");
    busy=false;loaded=true;
  }

  function gameRoster(team){
    const id=teamId(team),name=teamName(team);
    return nightPlayers.filter(x=>{
      const t=x.team||x.player?.team||{};
      return (id&&teamId(t)===id)||teamName(t).toLowerCase()===name.toLowerCase();
    }).filter((x,i,a)=>{
      const p=x.player||x.athlete||x,key=String(p.id||p.first_name+"|"+p.last_name);
      return a.findIndex(y=>{const q=y.player||y.athlete||y;return String(q.id||q.first_name+"|"+q.last_name)===key})===i;
    }).sort((a,b)=>(Number(a.jersey_number)||999)-(Number(b.jersey_number)||999));
  }
  function rosterColumn(team){
    const roster=gameRoster(team);
    return '<section class="nbl-game-roster"><header><img src="'+esc(logo(team))+'" alt=""><div><small>FULL ROSTER</small><strong>'+esc(teamName(team))+'</strong></div></header><div>'+roster.map(x=>{const p=x.player||x.athlete||x;const name=p.displayName||p.fullName||[p.first_name,p.last_name].filter(Boolean).join(" ");return '<span><b>'+(x.jersey_number||"–")+'</b>'+esc(name)+'<small>'+esc(x.playing_position||p.position?.abbreviation||"")+'</small></span>'}).join("")+'</div></section>';
  }
  function statValue(x,key){const n=Number(x?.[key]);return Number.isFinite(n)?n:null}
  function boxScoreRows(data){
    const rows=[];
    (function walk(v){
      if(!v||typeof v!=="object")return;
      if(Array.isArray(v))return v.forEach(walk);
      const p=v.player||v.athlete;
      const pts=statValue(v,"points"),reb=statValue(v,"rebounds"),ast=statValue(v,"assists");
      if(p&&(pts!==null||reb!==null||ast!==null)){
        const name=p.displayName||p.fullName||[p.first_name,p.last_name].filter(Boolean).join(" ");
        const team=v.team?.team_code||v.team?.abbreviation||p.team?.team_code||"";
        const minutes=v.minutes??v.minutes_played??"–";
        rows.push({name,team,pts:pts??0,reb:reb??0,ast:ast??0,minutes});
      }
      Object.values(v).forEach(walk);
    })(data);
    return rows.filter((x,i,a)=>a.findIndex(y=>y.name===x.name&&y.team===x.team)===i).sort((a,b)=>b.pts-a.pts);
  }
  function boxScoreTable(rows){
    if(!rows.length)return '<div class="nbl-game-awaiting"><strong>BOX SCORE PENDING</strong><span>Live player statistics will appear here once the official NBL game feed begins.</span></div>';
    return '<div class="nbl-box-wrap"><table class="nbl-box"><thead><tr><th>Player</th><th>Team</th><th>MIN</th><th>PTS</th><th>REB</th><th>AST</th></tr></thead><tbody>'+rows.map(x=>'<tr><td>'+esc(x.name)+'</td><td>'+esc(x.team)+'</td><td>'+esc(x.minutes)+'</td><td><b>'+x.pts+'</b></td><td>'+x.reb+'</td><td>'+x.ast+'</td></tr>').join("")+'</tbody></table></div>';
  }
  window.openNblGame=async function(id){
    const game=nightGames.find(g=>String(g.id)===String(id));if(!game)return;
    const modal=document.getElementById("nblGameModal"),detail=document.getElementById("nblGameDetail");
    const state=matchState(game),away=game.away_team||{},home=game.home_team||{};
    const score=state==="pre"?"VS":String(game.away_score??"0")+" – "+String(game.home_score??"0");
    detail.innerHTML='<div class="nbl-game-detail-head"><small>'+(state==="in"?"LIVE":state==="post"?"FINAL":"UPCOMING")+' · '+esc(game.venue?.name||"")+'</small><div><span><img src="'+esc(logo(away))+'" alt=""><strong>'+esc(teamName(away))+'</strong></span><b>'+esc(score)+'</b><span><img src="'+esc(logo(home))+'" alt=""><strong>'+esc(teamName(home))+'</strong></span></div></div>'+
      '<div class="nbl-game-rosters">'+rosterColumn(away)+rosterColumn(home)+'</div>'+
      '<section class="nbl-game-box"><h3>'+(state==="pre"?"GAME STATS":"LIVE BOX SCORE")+'</h3><div id="nblGameBox"><div class="nbl-game-awaiting"><span>Checking the official game feed…</span></div></div></section>';
    modal.hidden=false;document.body.classList.add("nbl-modal-open");
    try{
      const data=await fetchJson("/api/nbl/summary?event="+encodeURIComponent(id));
      const box=document.getElementById("nblGameBox");if(box)box.innerHTML=boxScoreTable(boxScoreRows(data));
    }catch(_){
      const box=document.getElementById("nblGameBox");if(box)box.innerHTML=boxScoreTable([]);
    }
  };
  window.closeNblGame=function(){
    const modal=document.getElementById("nblGameModal");if(modal)modal.hidden=true;
    document.body.classList.remove("nbl-modal-open");
  };

  window.openNblHub=function(){
    showScreenLocal("nblHubScreen");
    if(!root().innerHTML)root().innerHTML=shell();
    const own=root().querySelector(".owner-profile-nav-select");
    const source=[...document.querySelectorAll(".owner-profile-nav-select")].find(x=>x!==own&&x.options.length>1);
    if(own&&source)own.innerHTML=source.innerHTML;
    if(!loaded)load(false);
  };
  window.refreshNblHub=function(){load(true)};
})();
