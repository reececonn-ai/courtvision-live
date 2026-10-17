/* CourtVision Competition Board
   Post-draft standings, Sydney-time slate, projections and daily rivalry notes.
   Kept separate from the draft engine so draft-night behavior remains stable. */
(() => {
  const TZ="Australia/Sydney";
  const SEASON_YEAR=2027;
  const CACHE_MS=15*60*1000;
  let cache={at:0,records:null,games:null,recent:null,demo:false};
  let refreshToken=0;

  const $=id=>document.getElementById(id);
  const esc=s=>typeof escapeHtml==="function"?escapeHtml(String(s??"")):String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
  const moneyText=n=>typeof money==="function"?money(n):Number(n||0).toFixed(0);
  const teamMeta=name=>typeof teamByName==="function"?teamByName(name):TEAM_DATA.find(t=>t[0]===name);
  const teamOwner=name=>state.assignments?.[name]?.player||null;
  const isTestDraft=()=>Array.isArray(state.history)&&state.history.some(x=>String(x).startsWith("TEST DRAFT"));

  function sydneyParts(date=new Date()){
    const p=new Intl.DateTimeFormat("en-AU",{timeZone:TZ,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hour12:false})
      .formatToParts(date).reduce((o,x)=>(o[x.type]=x.value,o),{});
    return p;
  }
  function sydneyKey(date=new Date()){
    const p=sydneyParts(date);return p.year+"-"+p.month+"-"+p.day;
  }
  function compactDate(date){
    const p=sydneyParts(date);return p.year+p.month+p.day;
  }
  function addDays(date,n){const d=new Date(date);d.setUTCDate(d.getUTCDate()+n);return d}
  function timeSydney(date){
    return new Intl.DateTimeFormat("en-AU",{timeZone:TZ,hour:"numeric",minute:"2-digit",hour12:true}).format(date);
  }
  function daySydney(date){
    return new Intl.DateTimeFormat("en-AU",{timeZone:TZ,weekday:"short",day:"numeric",month:"short"}).format(date);
  }
  function teamNameFromEspn(team){
    if(!team)return null;
    const ab=String(team.abbreviation||team.shortDisplayName||"").toUpperCase();
    const display=String(team.displayName||team.name||"");
    return TEAM_DATA.find(t=>t[0]===display)?.[0]
      ||TEAM_DATA.find(t=>String(t[1]).toUpperCase()===ab)?.[0]
      ||TEAM_DATA.find(t=>display&&display.toLowerCase().includes(t[0].toLowerCase()))?.[0]
      ||null;
  }
  function winLineFor(name){
    const n=parseFloat(state.teamContent?.[name]?.wins);
    return Number.isFinite(n)?n:null;
  }
  function normalSample(){
    let u=0,v=0;while(!u)u=Math.random();while(!v)v=Math.random();
    return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v);
  }
  function seededNoise(seed){
    const x=Math.sin(seed*12.9898+78.233)*43758.5453;return x-Math.floor(x);
  }

  function demoCompetitionData(){
    const records={};
    TEAM_DATA.forEach((t,i)=>{
      const line=winLineFor(t[0])??41;
      const played=18+(i%6);
      const pct=Math.max(.15,Math.min(.8,line/82));
      let w=Math.round(played*pct+(seededNoise(i+31)-.5)*3);
      w=Math.max(2,Math.min(played-2,w));
      records[t[0]]={w,l:played-w,source:"demo"};
    });

    const now=new Date(),games=[];
    const pairs=[[13,12],[1,8],[20,6],[9,21],[27,19],[14,10],[26,17]];
    pairs.forEach((pair,i)=>{
      const a=TEAM_DATA[pair[0]][0],b=TEAM_DATA[pair[1]][0];
      const d=new Date(now.getTime()+((i-2)*85+20)*60000);
      const status=i<2?"FINAL":i===2?"IN":"SCHEDULED";
      const aw=records[a].w,bw=records[b].w;
      const aScore=status==="FINAL"?101+((aw+i*3)%19):status==="IN"?54+i:0;
      const bScore=status==="FINAL"?99+((bw+i*5)%21):status==="IN"?51+i:0;
      games.push({id:"demo-today-"+i,date:d,home:a,away:b,status,homeScore:aScore,awayScore:bScore,
        homeWinner:status==="FINAL"&&aScore>bScore,awayWinner:status==="FINAL"&&bScore>aScore,detail:status==="IN"?"Q3 06:42":status});
    });

    const recent=[];
    for(let day=1;day<=7;day++){
      for(let i=0;i<15;i++){
        const a=TEAM_DATA[(i*2+day)%30][0],b=TEAM_DATA[(i*2+day+1)%30][0];
        const d=addDays(now,-day);d.setUTCHours(4+(i%8),0,0,0);
        const bias=(winLineFor(a)||41)-(winLineFor(b)||41);
        const aWin=seededNoise(day*100+i)+bias/100>.48;
        recent.push({id:"demo-"+day+"-"+i,date:d,home:a,away:b,status:"FINAL",homeScore:aWin?112:103,awayScore:aWin?104:111,homeWinner:aWin,awayWinner:!aWin,detail:"FINAL"});
      }
    }
    return {records,games,recent,demo:true};
  }

  function parseStandings(data){
    const records={};
    const entries=[];
    const walk=x=>{
      if(!x||typeof x!=="object")return;
      if(Array.isArray(x))return x.forEach(walk);
      if(x.team&&Array.isArray(x.stats))entries.push(x);
      if(Array.isArray(x.children))x.children.forEach(walk);
      if(x.standings)walk(x.standings);
      if(Array.isArray(x.entries))x.entries.forEach(walk);
    };
    walk(data);
    for(const e of entries){
      const name=teamNameFromEspn(e.team);if(!name)continue;
      const stat=(key)=>{
        const s=e.stats.find(x=>String(x.name||x.abbreviation||x.displayName||"").toLowerCase()===key)
          ||e.stats.find(x=>String(x.name||"").toLowerCase().includes(key));
        const n=Number(s?.value??s?.displayValue);return Number.isFinite(n)?n:null;
      };
      let w=stat("wins"),l=stat("losses");
      if(w==null||l==null){
        const summary=String(e.note?.description||e.summary||e.records?.[0]?.summary||"");
        const m=summary.match(/(\d+)\s*[-–]\s*(\d+)/);if(m){w=+m[1];l=+m[2]}
      }
      if(Number.isFinite(w)&&Number.isFinite(l))records[name]={w,l,source:"ESPN"};
    }
    return records;
  }

  function parseTeamRecord(data,name){
    const team=data?.team||data;
    const items=team?.record?.items||team?.records||[];
    for(const it of items){
      const s=String(it.summary||it.displayValue||it.name||"");
      const m=s.match(/(\d+)\s*[-–]\s*(\d+)/);if(m)return {w:+m[1],l:+m[2],source:"ESPN"};
      const stats=it.stats||[];
      const get=k=>Number(stats.find(x=>String(x.name||x.abbreviation||"").toLowerCase()===k)?.value);
      const w=get("wins"),l=get("losses");if(Number.isFinite(w)&&Number.isFinite(l))return {w,l,source:"ESPN"};
    }
    return null;
  }

  async function fetchRecords(){
    try{
      const data=await fetchJSON("https://site.api.espn.com/apis/v2/sports/basketball/nba/standings?season="+SEASON_YEAR,9000,"no-store");
      const out=parseStandings(data);
      if(Object.keys(out).length>=24)return out;
    }catch(e){}
    const out={};
    await runPool(TEAM_DATA,async t=>{
      try{
        const data=await fetchJSON("https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/"+espnTeamKey(t[1])+"?season="+SEASON_YEAR,7000,"no-store");
        const r=parseTeamRecord(data,t[0]);if(r)out[t[0]]=r;
      }catch(e){}
    },6);
    return out;
  }

  function parseScoreboard(data){
    const out=[];
    for(const ev of data?.events||[]){
      const comp=ev.competitions?.[0];if(!comp)continue;
      const cs=comp.competitors||[];
      const home=cs.find(x=>x.homeAway==="home")||cs[0],away=cs.find(x=>x.homeAway==="away")||cs[1];
      const hn=teamNameFromEspn(home?.team),an=teamNameFromEspn(away?.team);if(!hn||!an)continue;
      const statusType=comp.status?.type||ev.status?.type||{};
      const completed=!!statusType.completed;
      const detail=statusType.shortDetail||statusType.detail||comp.status?.displayClock||"";
      const status=completed?"FINAL":statusType.state==="in"?"IN":"SCHEDULED";
      out.push({
        id:String(ev.id||comp.id||Math.random()),
        date:new Date(ev.date||comp.date||Date.now()),
        home:hn,away:an,status,detail,
        homeScore:Number(home?.score)||0,awayScore:Number(away?.score)||0,
        homeWinner:completed?(home?.winner===true||Number(home?.score)>Number(away?.score)):false,
        awayWinner:completed?(away?.winner===true||Number(away?.score)>Number(home?.score)):false
      });
    }
    return out;
  }

  async function fetchScoreboards(){
    const now=new Date(),keys=[];
    for(let d=-8;d<=1;d++)keys.push(compactDate(addDays(now,d)));
    const all=[];
    await runPool([...new Set(keys)],async key=>{
      try{
        const data=await fetchJSON("https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates="+key,8000,"no-store");
        all.push(...parseScoreboard(data));
      }catch(e){}
    },4);
    const dedupe=[...new Map(all.map(g=>[g.id,g])).values()];
    const todayKey=sydneyKey(now);
    return {
      games:dedupe.filter(g=>sydneyKey(g.date)===todayKey).sort((a,b)=>a.date-b.date),
      recent:dedupe.filter(g=>g.status==="FINAL"&&sydneyKey(g.date)<=todayKey).sort((a,b)=>b.date-a.date)
    };
  }

  function ownerSummaries(records){
    return state.players.map(p=>{
      const teams=p.teams||[];
      let w=0,l=0,projected=0,variance=0;
      const teamRows=teams.map(name=>{
        const r=records[name]||{w:0,l:0},played=r.w+r.l,remaining=Math.max(0,82-played);
        const line=winLineFor(name);
        let pr=remaining?((Number.isFinite(line)?line:r.w+(remaining*.5))-r.w)/remaining:.5;
        pr=Math.max(.08,Math.min(.92,Number.isFinite(pr)?pr:.5));
        const exp=r.w+pr*remaining;
        w+=r.w;l+=r.l;projected+=exp;variance+=remaining*pr*(1-pr);
        return {name,w:r.w,l:r.l,line,expected:exp};
      });
      return {name:p.name,w,l,teams:teamRows,projected,variance,probability:0};
    });
  }

  function calculateProbabilities(rows,sims=5000){
    if(!rows.length)return rows;
    const wins=Array(rows.length).fill(0);
    for(let s=0;s<sims;s++){
      const totals=rows.map(r=>r.projected+normalSample()*Math.sqrt(Math.max(.01,r.variance)));
      const top=Math.max(...totals),idx=[];totals.forEach((x,i)=>{if(Math.abs(x-top)<.0001)idx.push(i)});
      idx.forEach(i=>wins[i]+=1/idx.length);
    }
    rows.forEach((r,i)=>r.probability=wins[i]/sims*100);
    return rows.sort((a,b)=>b.w-a.w||b.projected-a.projected);
  }

  function todaysOwnerResults(games){
    const out={};state.players.forEach(p=>out[p.name]={w:0,l:0,games:0});
    for(const g of games.filter(x=>x.status==="FINAL")){
      [[g.home,g.homeWinner],[g.away,g.awayWinner]].forEach(([team,won])=>{
        const o=teamOwner(team);if(!o||!out[o])return;out[o].games++;if(won)out[o].w++;else out[o].l++;
      });
    }
    return out;
  }

  function ownerStreaks(recent){
    const out={};
    for(const p of state.players){
      const owned=new Set(p.teams||[]),seq=[];
      for(const g of recent){
        let result=null;
        if(owned.has(g.home))result=g.homeWinner?"W":"L";
        else if(owned.has(g.away))result=g.awayWinner?"W":"L";
        if(result)seq.push(result);
      }
      if(!seq.length){out[p.name]=null;continue}
      const first=seq[0];let n=0;for(const x of seq){if(x!==first)break;n++}
      out[p.name]={type:first,n};
    }
    return out;
  }

  function competitionTidbits(rows,games,recent){
    const bits=[],today=todaysOwnerResults(games),streaks=ownerStreaks(recent);
    for(const r of rows){
      const d=today[r.name];
      if(d?.games)bits.push({score:d.w-d.l,tag:"TODAY",text:r.name+" went "+d.w+"-"+d.l+" today and now owns a combined "+r.w+"-"+r.l+" record."});
      const st=streaks[r.name];
      if(st&&st.n>=3)bits.push({score:st.type==="W"?st.n:-st.n,tag:st.type==="W"?"HOT":"COLD",text:r.name+"'s teams have "+(st.type==="W"?"won ":"lost ")+"their last "+st.n+" completed games."});
      const action=games.filter(g=>teamOwner(g.home)===r.name||teamOwner(g.away)===r.name).length;
      if(action>=3)bits.push({score:1,tag:"BUSY NIGHT",text:r.name+" has "+action+" teams in action on today's Sydney slate."});
    }
    for(const g of games){
      const a=teamOwner(g.away),h=teamOwner(g.home);
      if(a&&h&&a!==h)bits.push({score:4,tag:"HEAD-TO-HEAD",text:a+" vs "+h+": "+shortTeam(g.away)+" plays "+shortTeam(g.home)+" today."});
    }
    if(rows.length){
      const leader=[...rows].sort((a,b)=>b.w-a.w)[0];
      bits.push({score:5,tag:"LEADER",text:leader.name+" leads the competition with "+leader.w+" combined team wins and a "+leader.probability.toFixed(1)+"% projected title chance."});
    }
    return bits.sort((a,b)=>Math.abs(b.score)-Math.abs(a.score)).slice(0,8);
  }

  function shortTeam(name){return teamMeta(name)?.[1]||name}
  function teamLogo(name){const t=teamMeta(name);return t?logoUrl(t[1]):""}

  function ownerTodayLine(name,games){
    const d=todaysOwnerResults(games||[])[name];
    if(!d||!d.games)return "NO FINALS YET TODAY";
    if(d.w===d.games)return "TODAY · "+d.w+"-"+d.l+" · CLEAN SWEEP";
    if(d.l===d.games)return "TODAY · "+d.w+"-"+d.l+" · ROUGH ONE";
    return "TODAY · "+d.w+"-"+d.l;
  }

  function renderSpotlight(rows){
    const el=$("competitionSpotlight");if(!el)return;
    if(!rows.length){el.innerHTML='<div class="comp-loading">NO COMPETITION DATA YET</div>';return}
    const leader=rows[0],second=rows[1];
    const gap=second?leader.w-second.w:leader.w;
    const teamIcons=leader.teams.map(t=>'<button class="comp-spot-team" onclick="previewTeamFromCompetition(\''+esc(t.name).replace(/'/g,"&#39;")+'\')" title="'+esc(t.name)+'"><img src="'+teamLogo(t.name)+'" alt=""><span>'+t.w+"-"+t.l+'</span></button>').join("");
    const raceCopy=gap>0
      ?leader.name+" is "+gap+" win"+(gap===1?"":"s")+" clear on actual results."
      :leader.name+" has the tiebreaking edge on projected finish.";
    el.innerHTML='<div class="comp-spotlight-inner">'+
      '<div>'+
        '<div class="comp-spotlight-label">CURRENT COMPETITION LEADER</div>'+
        '<div class="comp-spotlight-name">'+esc(leader.name)+'</div>'+
        '<div class="comp-spotlight-recordline"><div class="comp-spotlight-record">'+leader.w+"-"+leader.l+'</div><span>COMBINED RECORD ACROSS '+leader.teams.length+' TEAMS</span></div>'+
        '<div class="comp-spotlight-teams">'+teamIcons+'</div>'+
        '<div class="comp-spotlight-copy">'+esc(raceCopy+" Their five teams are currently projected for "+leader.projected.toFixed(1)+" total wins. The chase is live.")+'</div>'+
      '</div>'+
      '<div class="comp-spotlight-numbers">'+
        '<div><div class="comp-big-prob-label">CHANCE TO WIN IT ALL</div><div class="comp-big-prob">'+leader.probability.toFixed(1)+'<em>%</em></div></div>'+
        '<div class="comp-big-proj"><small>PROJECTED FINISH</small>'+leader.projected.toFixed(1)+' WINS</div>'+
      '</div>'+
    '</div>';
  }

  function renderRace(rows){
    const el=$("competitionRace");if(!el)return;
    const race=[...rows].sort((a,b)=>b.probability-a.probability||b.projected-a.projected);
    el.innerHTML=race.map((r,i)=>
      '<div class="comp-race-row '+(i===0?'leader':'')+'" style="--prob:'+Math.max(1,r.probability)+'%">'+
        '<div class="comp-race-rank">'+(i+1)+'</div>'+
        '<div class="comp-race-name">'+esc(r.name)+'<small>'+r.w+'-'+r.l+' actual · '+r.projected.toFixed(1)+' projected</small></div>'+
        '<div class="comp-race-pct">'+r.probability.toFixed(1)+'<span>%</span></div>'+
      '</div>'
    ).join("");
  }

  function renderLeaderboard(rows,demo,games=[]){
    const el=$("competitionLeaderboard");if(!el)return;
    const today=todaysOwnerResults(games||[]);
    renderSpotlight(rows);
    renderRace(rows);
    el.innerHTML=rows.map((r,i)=>{
      const teams=r.teams.map(t=>'<button class="comp-team-chip" onclick="previewTeamFromCompetition(\''+esc(t.name).replace(/'/g,"&#39;")+'\')"><img src="'+teamLogo(t.name)+'" alt=""><span>'+esc(shortTeam(t.name))+'</span><b>'+t.w+"-"+t.l+'</b></button>').join("");
      const d=today[r.name]||{w:0,l:0,games:0};
      const daily=d.games?(d.w+"-"+d.l+" TODAY"):"NO FINALS TODAY";
      return '<article class="comp-player-card '+(i===0?'leader':'')+'">'+
        '<div class="comp-player-main">'+
          '<div class="comp-player-head"><div class="comp-card-rank">'+(i+1)+'</div><strong>'+esc(r.name)+'</strong><span class="comp-card-record">'+r.w+"-"+r.l+'</span></div>'+
          '<div class="comp-card-meta"><span>'+daily+'</span><span>PROJECTED <b>'+r.projected.toFixed(1)+'</b> · TITLE <b>'+r.probability.toFixed(1)+'%</b></span></div>'+
          '<div class="comp-prob"><i style="width:'+Math.max(1,r.probability)+'%"></i></div>'+
          '<div class="comp-team-list">'+teams+'</div>'+
        '</div>'+
      '</article>';
    }).join("");
    const badge=$("competitionModeBadge");if(badge){badge.textContent=demo?"DEMO DATA":"LIVE NBA DATA";badge.classList.toggle("demo",demo)}
  }

  function gameStatusText(g){
    if(g.status==="FINAL")return "FINAL";
    if(g.status==="IN")return g.detail||"LIVE";
    return timeSydney(g.date);
  }

  function renderGames(games){
    const el=$("competitionGames");if(!el)return;
    const dateEl=$("competitionSlateDate");
    if(dateEl)dateEl.textContent=daySydney(new Date()).toUpperCase()+" · SYDNEY";
    if(!games.length){el.innerHTML='<div class="comp-empty">No NBA games on today\'s Sydney slate. Check back tomorrow — the table still updates from completed games.</div>';return}
    el.innerHTML=games.map(g=>{
      const ao=teamOwner(g.away),ho=teamOwner(g.home),rivalry=ao&&ho&&ao!==ho;
      const scores=g.status!=="SCHEDULED";
      const meta=rivalry?"OWNER VS OWNER":"OWNED TEAM ACTION";
      return '<article class="comp-game '+g.status.toLowerCase()+(rivalry?' rivalry':'')+'">'+
        '<div class="comp-game-side away"><img src="'+teamLogo(g.away)+'" alt=""><strong>'+esc(shortTeam(g.away))+'</strong><span class="comp-game-owner">'+esc(ao||"UNOWNED")+'</span>'+(scores?'<b>'+g.awayScore+'</b>':'')+'</div>'+
        '<div class="comp-game-meta">'+meta+'</div>'+
        '<div class="comp-game-status">'+esc(gameStatusText(g))+'</div>'+
        '<div class="comp-game-side home"><img src="'+teamLogo(g.home)+'" alt=""><strong>'+esc(shortTeam(g.home))+'</strong><span class="comp-game-owner">'+esc(ho||"UNOWNED")+'</span>'+(scores?'<b>'+g.homeScore+'</b>':'')+'</div>'+
      '</article>';
    }).join("");
  }

  function storyHeadline(x){
    const map={
      "LEADER":"THEY WAKE UP ON TOP",
      "HEAD-TO-HEAD":"FRIENDSHIP PAUSED",
      "HOT":"THE HEATER CONTINUES",
      "COLD":"SOMEONE CHECK ON THEM",
      "BUSY NIGHT":"REMOTE CONTROL NIGHT",
      "TODAY":"TODAY'S DAMAGE"
    };
    return map[x.tag]||"ONE TO TALK ABOUT";
  }

  function renderTidbits(bits){
    const el=$("competitionTidbits");if(!el)return;
    el.innerHTML=bits.length?bits.map(x=>
      '<article class="comp-tidbit"><label>'+esc(x.tag)+'</label><div class="comp-story-copy"><strong class="comp-story-headline">'+esc(storyHeadline(x))+'</strong><p>'+esc(x.text)+'</p></div></article>'
    ).join("")
      :'<div class="comp-empty">Nothing dramatic yet. That will not last.</div>';
    window.cvCompetitionTicker=bits.map(x=>({tag:x.tag,text:x.text,kind:x.tag==="COLD"?"alert":"draft"}));
  }

  function previewTeamFromCompetition(name){
    teamPreviewReturnScreen="competitionScreen";
    showReveal(name,{preview:true});
  }
  window.previewTeamFromCompetition=previewTeamFromCompetition;

  const originalClose=window.closeTeamPreview||closeTeamPreview;
  window.closeTeamPreview=function(){
    if(teamPreviewActive&&teamPreviewReturnScreen==="competitionScreen"){
      teamPreviewActive=false;
      document.getElementById("revealScreen")?.classList.remove("team-preview-mode");
      currentTeam=state.onTheBoard&&state.available.includes(state.onTheBoard)?state.onTheBoard:null;
      teamPreviewPreviousCurrent=null;
      teamPreviewReturnScreen="draftBoardScreen";
      showScreenLocal("competitionScreen");
      return;
    }
    return originalClose();
  };

  async function getCompetitionData(force=false){
    const demo=isTestDraft();
    if(demo)return demoCompetitionData();
    if(!force&&cache.records&&Date.now()-cache.at<CACHE_MS)return cache;
    const [records,score]=await Promise.all([fetchRecords(),fetchScoreboards()]);
    cache={at:Date.now(),records,games:score.games,recent:score.recent,demo:false};
    return cache;
  }

  async function refreshCompetitionBoard(force=false){
    const token=++refreshToken;
    const status=$("competitionDataStatus");
    if(status)status.textContent="Refreshing NBA records and Sydney slate…";
    try{
      const data=await getCompetitionData(force);if(token!==refreshToken)return;
      let rows=calculateProbabilities(ownerSummaries(data.records||{}));
      renderLeaderboard(rows,data.demo,data.games||[]);
      renderGames(data.games||[]);
      const bits=competitionTidbits(rows,data.games||[],data.recent||[]);
      renderTidbits(bits);
      const stamp=$("competitionUpdated");
      if(stamp)stamp.textContent=(data.demo?"DEMO · ":"UPDATED ")+new Intl.DateTimeFormat("en-AU",{timeZone:TZ,day:"numeric",month:"short",hour:"numeric",minute:"2-digit"}).format(new Date());
      if(status)status.textContent=data.demo?"Test draft · seeded competition results for troubleshooting":"Live NBA records/results · times shown in Sydney";
      if(document.querySelector(".screen.active")?.id==="competitionScreen"){
        setTicker(window.cvCompetitionTicker?.length?window.cvCompetitionTicker:[{tag:"COMPETITION",text:"Daily rivalry board",kind:"draft"}],"COMP BOARD");
      }
    }catch(e){
      console.warn("Competition refresh failed",e);
      if(status)status.textContent="Live competition data unavailable · try Refresh";
    }
  }

  function openCompetitionBoard(){
    showScreenLocal("competitionScreen");
    refreshCompetitionBoard(false);
  }
  window.openCompetitionBoard=openCompetitionBoard;
  window.refreshCompetitionBoard=refreshCompetitionBoard;

  function loadTestDraft(skipConfirm=false){
    if(!skipConfirm&&!confirm("Load a complete TEST draft? This replaces current picks/spending so you can test the Competition Board. Player names are kept."))return;
    if(!state.players?.length)return toast("Add players first");
    const sorted=[...TEAM_DATA].sort((a,b)=>(winLineFor(b[0])||0)-(winLineFor(a[0])||0));
    const order=[];let round=0;
    while(order.length<sorted.length){
      const inds=[...state.players.keys()];
      if(round%2)inds.reverse();
      for(const i of inds){if(order.length<sorted.length)order.push(i)}
      round++;
    }
    state.teamCap=Math.ceil(30/state.players.length);
    state.assignments={};state.available=[];state.passed=[];state.barrelQueue=[];state.barrelCurrent=null;state.onTheBoard=null;state.liveSpin=null;state.undoStack=[];
    state.players.forEach(p=>{p.teams=[];p.remaining=p.budget});
    sorted.forEach((t,idx)=>{
      const p=state.players[order[idx]],amount=idx%6===0?0:Math.max(.5,Math.min(p.remaining,1+(idx%5)));
      state.assignments[t[0]]={player:p.name,amount,barrel:amount===0};
      p.teams.push(t[0]);if(amount)p.remaining=Math.max(0,p.remaining-amount);
    });
    state.history=["TEST DRAFT · DEMO COMPETITION DATA",...Object.entries(state.assignments).map(([n,a])=>`TEST: ${n} → ${a.player}`)];
    state.lastAction="Test draft loaded";
    state.lastScreen="competitionScreen";
    reconcileState();saveState();renderAll();toast("Test draft loaded · Competition Board ready");openCompetitionBoard();
  }
  window.loadTestDraft=loadTestDraft;

  function clearTestMode(){
    state.history=(state.history||[]).filter(x=>!String(x).startsWith("TEST DRAFT"));
    saveState();cache={at:0,records:null,games:null,recent:null,demo:false};
    toast("Demo data off · using live NBA results");refreshCompetitionBoard(true);
  }
  window.clearTestMode=clearTestMode;

  // Extend the existing ticker router without changing the draft ticker behavior.
  const baseTicker=window.updateTickerForScreen||updateTickerForScreen;
  window.updateTickerForScreen=function(id){
    if(id==="competitionScreen"){
      setTicker(window.cvCompetitionTicker?.length?window.cvCompetitionTicker:[{tag:"COMPETITION",text:"Daily rivalry board",kind:"draft"}],"COMP BOARD");
      return;
    }
    return baseTicker(id);
  };

  // Expose a lightweight helper for QA.
  window.cvCompetition={demoCompetitionData,ownerSummaries,calculateProbabilities,competitionTidbits};
})();