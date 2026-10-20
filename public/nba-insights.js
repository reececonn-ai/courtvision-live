
/* CourtVision extra statistics. Read-only, optional feeds; no draft state writes. */
(()=>{
  const esc=v=>String(v??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
  const memory=new Map();
  async function feed(kind,params={}){
    const url="/api/nba/extra?"+new URLSearchParams({kind,...params});
    const old=memory.get(url);if(old&&Date.now()-old.at<120000)return old.promise;
    const promise=(async()=>{const response=await fetch(url,{signal:AbortSignal.timeout(10000)});if(!response.ok)throw Error("Feed unavailable");return response.json()})();
    memory.set(url,{at:Date.now(),promise});
    try{return await promise}catch(e){memory.delete(url);throw e}
  }
  const table=(head,rows)=>'<table class="cv-extra-table"><thead><tr>'+head.map(x=>'<th scope="col">'+esc(x)+'</th>').join("")+'</tr></thead><tbody>'+rows.map(row=>'<tr>'+row.map((x,i)=>i?'<td>'+esc(x)+'</td>':'<th scope="row">'+esc(x)+'</th>').join("")+'</tr>').join("")+'</tbody></table>';
  function flattenStats(data){
    const result=new Map();
    function walk(value){
      if(!value||typeof value!=="object")return;
      if(value.name&&("value" in value||"displayValue" in value))result.set(value.name,value);
      for(const [key,child]of Object.entries(value))if(key!=="team"&&child&&typeof child==="object"){if(Array.isArray(child))child.forEach(walk);else walk(child)}
    }
    walk(data);return result;
  }
  function teamStatsMarkup(data){
    if(data?.season?.year&&Number(data.season.year)!==2027)return '<p class="cv-extra-empty">Current-season statistics are not available yet.</p>';
    const stats=flattenStats(data);
    const value=keys=>{for(const key of keys){const s=stats.get(key);if(s)return s.displayValue??s.value}return null};
    const rows=[["Points / game",["avgPoints"]],["Rebounds / game",["avgRebounds"]],["Assists / game",["avgAssists"]],["Steals / game",["avgSteals"]],["Blocks / game",["avgBlocks"]],["Turnovers / game",["avgTurnovers"]]]
      .map(([label,keys])=>[label,value(keys)]).filter(r=>r[1]!=null);
    const shooting=[["Field goals",["fieldGoalPct"]],["Three-pointers",["threePointFieldGoalPct"]],["Free throws",["freeThrowPct"]]]
      .map(([label,keys])=>({label,value:parseFloat(value(keys))})).filter(x=>Number.isFinite(x.value)&&x.value>=0&&x.value<=100);
    if(!rows.length&&!shooting.length)return '<p class="cv-extra-empty">Season statistics are not available yet. They will appear as the regular season gets underway.</p>';
    return '<p class="cv-extra-caption">ESPN · 2026–27 regular season</p>'+(rows.length?table(["Season averages","Per game"],rows):"")+
      (shooting.length?'<h5>Shooting touch</h5>'+shooting.map(x=>'<div class="cv-shot-bar"><span>'+esc(x.label)+'</span><div><i style="width:'+x.value+'%"></i></div><b>'+x.value.toFixed(1)+'%</b></div>').join(""):"");
  }
  function lineChart(points,away,home){
    const valid=points.filter(p=>Number.isFinite(p.home)&&Number.isFinite(p.away));
    if(valid.length<2)return "";
    const max=Math.max(5,...valid.map(p=>Math.abs(p.home-p.away))),x=i=>45+i/(valid.length-1)*430,y=n=>110-n/max*75;
    const path=valid.map((p,i)=>x(i)+","+y(p.home-p.away)).join(" ");
    return '<h5>How the game swung</h5><p class="cv-extra-caption">Score margin · above the line favours '+esc(home)+', below favours '+esc(away)+'.</p><svg class="cv-momentum" viewBox="0 0 520 225" role="img" aria-label="Game score margin. Final plotted margin '+(valid.at(-1).home-valid.at(-1).away)+' points for '+esc(home)+'"><line x1="45" y1="110" x2="475" y2="110" class="cv-zero"/><text x="37" y="39" text-anchor="end">+'+max+'</text><text x="37" y="114" text-anchor="end">0</text><text x="37" y="189" text-anchor="end">−'+max+'</text><text x="45" y="215">Start</text><text x="475" y="215" text-anchor="end">Latest</text><polyline class="cv-margin" points="'+path+'"/></svg>';
  }
  function espnGameExtras(data,g){
    if(g.sample||String(g.id).startsWith("demo-"))return "";
    const competitors=data.header?.competitions?.[0]?.competitors||[];
    const home=competitors.find(x=>x.homeAway==="home"),away=competitors.find(x=>x.homeAway==="away");
    const count=Math.max(home?.linescores?.length||0,away?.linescores?.length||0);
    let html='';
    if(count)html+='<h5>Quarter by quarter</h5>'+table(["Period",g.away,g.home],Array.from({length:count},(_,i)=>[i<4?"Q"+(i+1):"OT"+(i-3),away?.linescores?.[i]?.displayValue??away?.linescores?.[i]?.value??"—",home?.linescores?.[i]?.displayValue??home?.linescores?.[i]?.value??"—"]));
    const plays=(data.plays||[]).filter(p=>Number.isFinite(p.homeScore)&&Number.isFinite(p.awayScore));
    if(plays.length)html+=lineChart([{home:0,away:0},...plays.map(p=>({home:p.homeScore,away:p.awayScore}))],g.away,g.home);
    return html+'<details class="cv-nba-game"><summary>More from NBA.com</summary><div class="cv-nba-game-body"><button type="button" class="cv-extra-button">Load NBA game details</button><p class="cv-extra-caption">Optional NBA feed · availability varies.</p></div></details>';
  }
  async function nbaGame(g){
    const data=await feed("nbaschedule");
    const games=(data.leagueSchedule?.gameDates||[]).flatMap(d=>d.games||[]);
    const team=code=>{const aliases={NYK:"NY",GSW:"GS",SAS:"SA",NOP:"NO",UTA:"UTAH",WAS:"WSH"};return TEAM_DATA.find(t=>t[1]===code||t[1]===aliases[code])?.[0]};
    const match=games.find(x=>team(x.homeTeam?.teamTricode)===g.home&&team(x.awayTeam?.teamTricode)===g.away&&Math.abs(Date.parse(x.gameDateTimeUTC)-new Date(g.date).getTime())<12*3600000);
    if(!match)throw Error("No matching NBA game");
    const box=await feed("nbabox",{game:match.gameId}),game=box.game;
    if(!game?.homeTeam||!game?.awayTeam)throw Error("Box score unavailable");
    const h=game.homeTeam.statistics||{},a=game.awayTeam.statistics||{};
    const metrics=[["Bench points","benchPoints"],["Points in paint","pointsInThePaint"],["Fast-break points","pointsFastBreak"],["Points off turnovers","pointsFromTurnovers"],["Biggest lead","biggestLead"],["Largest scoring run","biggestScoringRun"]];
    let html='<p class="cv-extra-caption">NBA.com · '+esc(game.gameStatusText||"Latest box score")+'</p>'+table(["Inside the game",g.away,g.home],metrics.filter(([,k])=>a[k]!=null||h[k]!=null).map(([label,k])=>[label,a[k]??"—",h[k]??"—"]));
    try{
      const pbp=await feed("nbaplays",{game:match.gameId});
      const actions=pbp.game?.actions||[];
      const points=actions.filter(p=>p.scoreHome!==""&&p.scoreAway!==""&&p.scoreHome!=null&&p.scoreAway!=null).map(p=>({home:Number(p.scoreHome),away:Number(p.scoreAway)}));
      html+=lineChart([{home:0,away:0},...points],g.away,g.home);
      html+='<h5>Latest action</h5><ol class="cv-play-list">'+actions.slice(-8).reverse().map(p=>'<li><small>Q'+esc(p.period)+' · '+esc(String(p.clock||"").replace("PT","").replace("M",":").replace("S",""))+'</small> '+esc(p.description||"Play")+'</li>').join("")+'</ol>';
    }catch(_){html+='<p class="cv-extra-caption">Play-by-play unavailable. Box-score details remain above.</p>'}
    return html;
  }
  function bindGames(panel,g){
    panel.querySelectorAll(".cv-nba-game-body>button").forEach(button=>button.addEventListener("click",async()=>{
      const body=button.parentElement;button.disabled=true;button.textContent="Loading NBA data…";
      try{const html=await nbaGame(g);if(body.isConnected)body.innerHTML=html}catch(_){if(body.isConnected){button.disabled=false;button.textContent="Retry NBA details";const p=body.querySelector("p");if(p)p.textContent="NBA feed unavailable here. ESPN stats above are still available."}}
    }));
  }
  function nbaRows(data){
    const sets=data.resultSets||[];return sets.flatMap(s=>(s.rowSet||[]).map(row=>Object.fromEntries((s.headers||[]).map((key,i)=>[key,row[i]]))));
  }
  function leagueMarkup(data,name){
    const rows=nbaRows(data),row=rows.find(r=>r.TEAM_NAME===name||r.TEAM_NAME===name.replace("Los Angeles Clippers","LA Clippers"));
    if(!row||!Number(row.GP))return '<p class="cv-extra-empty">No current regular-season NBA comparison is available for this team.</p>';
    const keys=[["Offensive rating","OFF_RATING"],["Defensive rating","DEF_RATING"],["Net rating","NET_RATING"],["Pace","PACE"],["True shooting %","TS_PCT"]];
    return '<p class="cv-extra-caption">NBA.com · 2026–27 regular season · advanced team stats</p>'+table(["Metric","Team","League average"],keys.filter(([,k])=>Number.isFinite(row[k])).map(([label,k])=>{
      const valid=rows.filter(r=>Number(r.GP)>0&&Number.isFinite(r[k]));const avg=valid.reduce((n,r)=>n+r[k],0)/valid.length,scale=k==="TS_PCT"?100:1;return [label,(row[k]*scale).toFixed(1),(avg*scale).toFixed(1)];
    }))+'<p class="cv-extra-caption">League average is the unweighted mean of teams with games played.</p>';
  }
  async function enrichTeam(name,detail){
    const target=detail.querySelector(".team-detail-content");if(!target)return;
    const section=document.createElement("section");section.className="cv-team-extras";section.innerHTML='<span class="team-section-label">MORE OF THE PICTURE</span><h3>Season snapshot</h3><div class="cv-season-stats">Loading season statistics…</div><details><summary>Compare with the league</summary><button type="button" class="cv-extra-button cv-league-load">Load NBA league comparison</button><div class="cv-league-result"></div></details><h4>From the team’s news desk</h4><div class="cv-team-news">Loading headlines…</div>';target.appendChild(section);
    const active=()=>section.isConnected&&detail.dataset.team===name&&!detail.hidden;
    const t=TEAM_DATA.find(t=>t[0]===name);if(!t)return;const key=typeof espnTeamKey==="function"?espnTeamKey(t[1]):t[1].toLowerCase();
    void feed("teamstats",{team:key}).then(data=>{if(active())section.querySelector(".cv-season-stats").innerHTML=teamStatsMarkup(data)}).catch(()=>{if(active())section.querySelector(".cv-season-stats").innerHTML='<p class="cv-extra-empty">Season feed unavailable. The roster and recent-game charts still work.</p>'});
    void feed("teamnews",{team:key}).then(data=>{if(!active())return;const articles=(data.articles||[]).filter(a=>/^https:\/\/(www\.)?espn\.com\//i.test(a.links?.web?.href||"")).slice(0,4);section.querySelector(".cv-team-news").innerHTML=articles.length?articles.map(a=>{const img=a.images?.find(x=>/^https:\/\//.test(x.url||""));return '<a class="cv-team-news-item" target="_blank" rel="noopener noreferrer" href="'+esc(a.links.web.href)+'">'+(img?'<img src="'+esc(img.url)+'" alt="" loading="lazy" onerror="this.remove()">':'')+'<span><strong>'+esc(a.headline)+'</strong><small>ESPN · Read original ↗</small></span></a>';}).join(""):'<p class="cv-extra-empty">No team headlines available right now.</p>'}).catch(()=>{if(active())section.querySelector(".cv-team-news").innerHTML='<p class="cv-extra-empty">Team news temporarily unavailable.</p>'});
    const button=section.querySelector(".cv-league-load");button.addEventListener("click",async()=>{button.disabled=true;button.textContent="Loading NBA comparison…";try{const data=await feed("leagueteams");if(active()){section.querySelector(".cv-league-result").innerHTML=leagueMarkup(data,name);button.hidden=true}}catch(_){if(active()){button.disabled=false;button.textContent="Retry league comparison";section.querySelector(".cv-league-result").innerHTML='<p class="cv-extra-empty">NBA Stats is unavailable from this host. Existing ESPN statistics remain available.</p>'}}});
  }
  const api=window.cvCompetition;
  if(api?.renderTeamDetail){const original=api.renderTeamDetail;api.renderTeamDetail=async(name,detail)=>{await original(name,detail);if(detail.isConnected&&detail.dataset.team===name&&!detail.hidden)void enrichTeam(name,detail)}}
  window.cvInsights={espnGameExtras,bindGames,teamStatsMarkup,leagueMarkup};
})();
