/* CourtVision Competition Board
   Post-draft standings, Sydney-time slate, projections and daily rivalry notes.
   Kept separate from the draft engine so draft-night behavior remains stable. */
(() => {
  const TZ="Australia/Sydney";
  const SEASON_YEAR=2027;
  // NBA 2026-27 opening tip: 20 Oct 2026, 3pm ET (21 Oct, 6am Sydney).
  const REGULAR_SEASON_START=Date.parse("2026-10-20T19:00:00Z");
  const REGULAR_SEASON_KEY="2026-10-21";
  const regularSeasonStarted=()=>Date.now()>=REGULAR_SEASON_START;
  const CACHE_MS=15*60*1000;
  let cache={at:0,records:null,games:null,recent:null,demo:false};
  let refreshToken=0;
  let autoUpdateTimer=null;
  let autoUpdateRunning=false;
  let seasonMemoryLoadedAt=0;
  let seasonMemoryRaw=[];
  const AUTO_UPDATE_MS=2*60*1000;
  const SEASON_MEMORY_MS=60*1000;

  const $=id=>document.getElementById(id);
  const esc=s=>typeof escapeHtml==="function"?escapeHtml(String(s??"")):String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
  const moneyText=n=>typeof money==="function"?money(n):Number(n||0).toFixed(0);
  const teamMeta=name=>typeof teamByName==="function"?teamByName(name):TEAM_DATA.find(t=>t[0]===name);
  const teamOwner=name=>state.assignments?.[name]?.player||null;
  const isTestDraft=()=>false; // Production uses live data regardless of legacy test markers.

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
  function hashSeed(text){
    let h=2166136261;
    for(const ch of String(text)){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)}
    return h>>>0;
  }
  function seededRng(seed){
    let a=(seed>>>0)||0x9e3779b9;
    return ()=>{
      a|=0;a=a+0x6D2B79F5|0;
      let t=Math.imul(a^a>>>15,1|a);
      t=t+Math.imul(t^t>>>7,61|t)^t;
      return ((t^t>>>14)>>>0)/4294967296;
    };
  }
  function normalSample(rng=Math.random){
    let u=0,v=0;while(!u)u=rng();while(!v)v=rng();
    return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v);
  }
  function seededNoise(seed){
    const x=Math.sin(seed*12.9898+78.233)*43758.5453;return x-Math.floor(x);
  }

  async function fetchNbaJson(localPath,directUrl,timeout=8000){
    try{return await fetchJSON(localPath,timeout,"no-store")}
    catch(localError){
      try{return await fetchJSON(directUrl,timeout,"no-store")}
      catch(directError){throw directError||localError}
    }
  }


  function seasonMemoryPath(){
    try{
      if(typeof CV_SYNC_ROOM!=="undefined"&&CV_SYNC_ROOM)return "/api/rooms/"+encodeURIComponent(CV_SYNC_ROOM)+"/competition-history";
    }catch(_){}
    return null;
  }

  function mergeSeasonSnapshot(snapshot){
    if(!snapshot?.key||!Array.isArray(snapshot.rows))return;
    // Season projections are a separate phase, never regular-season competition history.
    if(regularSeasonStarted() && snapshot.key<REGULAR_SEASON_KEY)return;
    if(!regularSeasonStarted() && snapshot.key>=REGULAR_SEASON_KEY)return;
    if(!Array.isArray(state.competitionSnapshots))state.competitionSnapshots=[];
    const idx=state.competitionSnapshots.findIndex(x=>x.key===snapshot.key&&!!x.demo===!!snapshot.demo);
    if(idx>=0){
      const oldAt=Date.parse(state.competitionSnapshots[idx]?.at||0)||0;
      const newAt=Date.parse(snapshot.at||0)||0;
      if(newAt>=oldAt)state.competitionSnapshots[idx]=snapshot;
    }else{
      state.competitionSnapshots.push(snapshot);
    }
    state.competitionSnapshots=state.competitionSnapshots
      .filter(x=>x && (regularSeasonStarted()?x.key>=REGULAR_SEASON_KEY:x.key<REGULAR_SEASON_KEY))
      .sort((a,b)=>String(a.key||"").localeCompare(String(b.key||"")))
      .slice(-220);
  }

  function snapshotFromRecords(raw){
    if(!raw?.key||!raw.records||typeof raw.records!=="object")return null;
    if(raw.key<REGULAR_SEASON_KEY)return null;
    const rows=calculateProbabilities(ownerSummaries(raw.records),3000);
    return {
      key:raw.key,
      at:raw.at||new Date().toISOString(),
      demo:false,
      source:"server-standings",
      rows:rows.map((r,i)=>({
        name:r.name,rank:i+1,w:r.w,l:r.l,
        projected:+r.projected.toFixed(2),
        probability:+r.probability.toFixed(2)
      }))
    };
  }

  async function loadSeasonMemory(force=false){
    if(isTestDraft()||!regularSeasonStarted())return;
    if(!force&&seasonMemoryLoadedAt&&Date.now()-seasonMemoryLoadedAt<SEASON_MEMORY_MS)return;
    const path=seasonMemoryPath();if(!path)return;
    try{
      const r=await fetch(path,{cache:"no-store"});
      if(!r.ok)throw new Error("history HTTP "+r.status);
      const data=await r.json();
      for(const s of data.rich||[])mergeSeasonSnapshot(s);
      seasonMemoryRaw=Array.isArray(data.raw)?data.raw:[];
      for(const raw of seasonMemoryRaw){
        const snapshot=snapshotFromRecords(raw);
        if(snapshot)mergeSeasonSnapshot(snapshot);
      }
      seasonMemoryLoadedAt=Date.now();
      try{localStorage.setItem(STORAGE_KEY,JSON.stringify(state))}catch(_){}
    }catch(e){
      console.warn("Season memory load failed",e);
    }
  }

  async function pushSeasonSnapshot(snapshot){
    if(!snapshot||snapshot.demo||!regularSeasonStarted())return;
    const path=seasonMemoryPath();if(!path)return;
    try{
      await fetch(path,{
        method:"POST",
        headers:{"content-type":"application/json"},
        body:JSON.stringify({snapshot}),
        cache:"no-store"
      });
    }catch(e){
      console.warn("Season memory save failed",e);
    }
  }

  function priorCompetitionSnapshot(demo=false){
    const today=sydneyKey(new Date());
    return (state.competitionSnapshots||[])
      .filter(s=>!!s.demo===!!demo&&s.key<today&&Array.isArray(s.rows)&&(!regularSeasonStarted()||s.key>=REGULAR_SEASON_KEY))
      .sort((a,b)=>String(b.key).localeCompare(String(a.key)))[0]||null;
  }

  function competitionMovement(rows,demo=false){
    const prior=priorCompetitionSnapshot(demo);
    if(!prior)return {prior:null,items:[]};
    const prev=new Map((prior.rows||[]).map(r=>[r.name,r]));
    const items=rows.map((r,i)=>{
      const p=prev.get(r.name);if(!p)return null;
      const currentRank=i+1;
      const rankMove=(Number(p.rank)||currentRank)-currentRank;
      const winMove=r.w-Number(p.w||0);
      const lossMove=r.l-Number(p.l||0);
      const probMove=r.probability-Number(p.probability||0);
      const score=Math.abs(probMove)*2+Math.abs(rankMove)*4+Math.abs(winMove-lossMove);
      return {name:r.name,rankMove,winMove,lossMove,probMove,score,priorKey:prior.key,currentRank,priorRank:Number(p.rank)||currentRank};
    }).filter(Boolean).sort((a,b)=>b.score-a.score||Math.abs(b.probMove)-Math.abs(a.probMove));
    return {prior,items};
  }

  function renderMovement(rows,demo=false){
    const movement=competitionMovement(rows,demo);
    const el=$("competitionMovement"),nerd=$("nerdSinceYesterday");
    if(!movement.prior){
      const empty='<div class="comp-empty">Season memory needs a second Sydney day. From tomorrow, this will show exactly who moved.</div>';
      if(el)el.innerHTML=empty;if(nerd)nerd.innerHTML=empty;
      return movement;
    }
    const card=x=>{
      const direction=x.rankMove>0?"up":x.rankMove<0?"down":"flat";
      const rankText=x.rankMove>0?"▲ "+x.rankMove:x.rankMove<0?"▼ "+Math.abs(x.rankMove):"—";
      const record=(x.winMove||x.lossMove)?("+"+x.winMove+"W · +"+x.lossMove+"L"):"NO NEW FINALS";
      return '<article class="comp-move-card '+direction+'">'+
        '<div><small>'+esc(movement.prior.key)+'</small><strong>'+esc(x.name)+'</strong><span>'+record+'</span></div>'+
        '<div class="comp-move-numbers"><b>'+rankText+'</b><em>'+(x.probMove>=0?"+":"")+x.probMove.toFixed(1)+' pts</em></div>'+
      '</article>';
    };
    if(el)el.innerHTML=movement.items.slice(0,4).map(card).join("");
    if(nerd)nerd.innerHTML=movement.items.slice(0,6).map(card).join("");
    return movement;
  }

  function scenarioRecords(records,g,homeWins){
    const next={};
    for(const [name,r] of Object.entries(records||{}))next[name]={...r};
    if(!next[g.home])next[g.home]={w:0,l:0,rank:null};
    if(!next[g.away])next[g.away]={w:0,l:0,rank:null};
    if(homeWins){next[g.home].w++;next[g.away].l++}
    else{next[g.away].w++;next[g.home].l++}
    return next;
  }

  function flippedFinalRecords(records,g){
    const next={};
    for(const [name,r] of Object.entries(records||{}))next[name]={...r};
    if(!next[g.home]||!next[g.away])return next;
    if(g.homeWinner){
      next[g.home].w=Math.max(0,next[g.home].w-1);next[g.away].l=Math.max(0,next[g.away].l-1);
      next[g.home].l++;next[g.away].w++;
    }else if(g.awayWinner){
      next[g.away].w=Math.max(0,next[g.away].w-1);next[g.home].l=Math.max(0,next[g.home].l-1);
      next[g.away].l++;next[g.home].w++;
    }
    return next;
  }

  function probabilityMap(rows){return new Map((rows||[]).map(r=>[r.name,r.probability]))}

  function gameImpact(games,records,currentRows){
    if(!games?.length)return [];
    const current=probabilityMap(currentRows);
    return games.map(g=>{
      const ao=teamOwner(g.away),ho=teamOwner(g.home);
      if(!ao&&!ho)return null;
      let aRows,bRows,label;
      if(g.status==="FINAL"){
        aRows=currentRows;
        bRows=calculateProbabilities(ownerSummaries(flippedFinalRecords(records,g)),1600);
        label="RESULT SWING";
      }else{
        aRows=calculateProbabilities(ownerSummaries(scenarioRecords(records,g,true)),1600);
        bRows=calculateProbabilities(ownerSummaries(scenarioRecords(records,g,false)),1600);
        label=g.status==="IN"?"LIVE SWING":"POSSIBLE SWING";
      }
      const a=probabilityMap(aRows),b=probabilityMap(bRows);
      const owners=[...new Set([ao,ho].filter(Boolean))];
      let swing=0,owner=null;
      for(const o of owners){
        const diff=Math.abs((a.get(o)||0)-(b.get(o)||0));
        if(diff>swing){swing=diff;owner=o}
      }
      const actualDelta=g.status==="FINAL"&&owner?((current.get(owner)||0)-(b.get(owner)||0)):null;
      return {...g,awayOwner:ao,homeOwner:ho,swing,owner,label,actualDelta};
    }).filter(Boolean).sort((a,b)=>b.swing-a.swing||a.date-b.date);
  }

  function renderGameImpact(games,records,rows){
    const el=$("competitionImpact");if(!el)return [];
    const impacts=gameImpact(games,records,rows).slice(0,4);
    if(!impacts.length){
      el.innerHTML='<div class="comp-empty">No owned-team games on today\'s Sydney slate.</div>';
      return impacts;
    }
    el.innerHTML=impacts.map(x=>{
      const status=x.status==="SCHEDULED"?timeSydney(x.date):(x.status==="IN"?(x.detail||"LIVE"):"FINAL");
      const owners=[x.awayOwner,x.homeOwner].filter(Boolean).join(" vs ");
      const value=x.swing.toFixed(1)+" pts";
      return '<article class="comp-impact-card '+x.status.toLowerCase()+'">'+
        '<div class="comp-impact-match"><span>'+esc(shortTeam(x.away))+'</span><b>vs</b><span>'+esc(shortTeam(x.home))+'</span></div>'+
        '<div class="comp-impact-copy"><strong>'+esc(owners||"OWNED TEAMS")+'</strong><small>'+esc(status)+' · '+esc(x.label)+'</small></div>'+
        '<div class="comp-impact-value"><b>'+value+'</b><small>TITLE % RANGE</small></div>'+
      '</article>';
    }).join("");
    return impacts;
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
    [...Object.entries(records)]
      .sort((a,b)=>((b[1].w/(b[1].w+b[1].l||1))-(a[1].w/(a[1].w+a[1].l||1)))||b[1].w-a[1].w)
      .forEach(([name],i)=>{records[name].rank=i+1});

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
      const rank=stat("playoffseed")??stat("rank")??stat("seed");
      if(w==null||l==null){
        const summary=String(e.note?.description||e.summary||e.records?.[0]?.summary||"");
        const m=summary.match(/(\d+)\s*[-–]\s*(\d+)/);if(m){w=+m[1];l=+m[2]}
      }
      if(Number.isFinite(w)&&Number.isFinite(l))records[name]={w,l,rank:Number.isFinite(rank)?rank:null,source:"ESPN"};
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

  async function fetchRecords(force=false){
    // Pre-opening ESPN standings can include preseason wins. Projections start at 0-0.
    if(!regularSeasonStarted())return {};
    try{
      const direct="https://site.api.espn.com/apis/v2/sports/basketball/nba/standings?season="+SEASON_YEAR;
      const local="/api/nba/standings?season="+SEASON_YEAR+(force?"&fresh=1":"");
      const data=await fetchNbaJson(local,direct,9000);
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

  function quarterValues(team){
    const lines=team?.linescores;if(!Array.isArray(lines)||lines.length<4)return null;
    const values=lines.map(x=>x.value===null||x.value===undefined||x.value===""?NaN:Number(x.value));
    return values.every(Number.isFinite)&&values.reduce((a,b)=>a+b,0)===Number(team.score)?values:null;
  }
  function parseScoreboard(data,includePlayoffs=false){
    const out=[];
    for(const ev of data?.events||[]){
      const comp=ev.competitions?.[0];if(!comp)continue;
      // ESPN scoreboard includes preseason fixtures. Never count those toward competition.
      if(Date.parse(ev.date||comp.date||"")<REGULAR_SEASON_START)continue;
      const seasonType=Number(ev.season?.type??data?.season?.type??0);
      if(seasonType&&seasonType!==2&&!(includePlayoffs&&seasonType===3))continue;
      const cs=comp.competitors||[];
      const home=cs.find(x=>x.homeAway==="home")||cs[0],away=cs.find(x=>x.homeAway==="away")||cs[1];
      const hn=teamNameFromEspn(home?.team),an=teamNameFromEspn(away?.team);if(!hn||!an)continue;
      const statusType=comp.status?.type||ev.status?.type||{};
      const completed=!!statusType.completed;
      const detail=statusType.shortDetail||statusType.detail||comp.status?.displayClock||"";
      const rawStatus=String(statusType.name||"")+" "+detail;
      const status=/postpon/i.test(rawStatus)?"POSTPONED":/cancel/i.test(rawStatus)?"CANCELLED":/suspend|delay/i.test(rawStatus)?"DELAYED":completed?"FINAL":statusType.state==="in"?"IN":"SCHEDULED";
      out.push({
        id:String(ev.id||comp.id||Math.random()),
        date:new Date(ev.date||comp.date||Date.now()),
        home:hn,away:an,status,detail,timeTbd:comp.timeValid===false||/\bTBD\b/i.test(detail),
        homeScore:Number(home?.score)||0,awayScore:Number(away?.score)||0,
        homeQuarters:quarterValues(home),awayQuarters:quarterValues(away),
        homeWinner:completed?(home?.winner===true||Number(home?.score)>Number(away?.score)):false,
        awayWinner:completed?(away?.winner===true||Number(away?.score)>Number(home?.score)):false
      });
    }
    return out;
  }

  async function fetchScoreboards(){
    const now=new Date(),keys=[];
    for(let d=-8;d<=2;d++)keys.push(compactDate(addDays(now,d)));
    const all=[];
    await runPool([...new Set(keys)],async key=>{
      try{
        const direct="https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates="+key;
        const data=await fetchNbaJson("/api/nba/scoreboard?dates="+encodeURIComponent(key),direct,8000);
        all.push(...parseScoreboard(data));
      }catch(e){}
    },4);
    const dedupe=[...new Map(all.map(g=>[g.id,g])).values()];
    const todayKey=sydneyKey(now);
    return {
      games:dedupe.filter(g=>sydneyKey(g.date)===todayKey).sort((a,b)=>a.date-b.date),
      tomorrow:dedupe.filter(g=>sydneyKey(g.date)===nextSydneyKey(now)).sort((a,b)=>a.date-b.date),
      recent:dedupe.filter(g=>g.status==="FINAL"&&sydneyKey(g.date)<=todayKey).sort((a,b)=>b.date-a.date)
    };
  }


  async function fetchTodayScoreboardLite(){
    const now=new Date();
    const keys=[compactDate(addDays(now,-1)),compactDate(now),compactDate(addDays(now,1))];
    const all=[];
    await Promise.all([...new Set(keys)].map(async key=>{
      try{
        const direct="https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates="+key;
        const data=await fetchNbaJson("/api/nba/scoreboard?dates="+encodeURIComponent(key),direct,8000);
        all.push(...parseScoreboard(data));
      }catch(e){}
    }));
    const today=sydneyKey(now);
    return [...new Map(all.map(g=>[g.id,g])).values()]
      .filter(g=>sydneyKey(g.date)===today)
      .sort((a,b)=>a.date-b.date);
  }

  function gameStateSignature(games){
    return (games||[]).map(g=>[g.id,g.status,g.homeScore,g.awayScore,g.detail||""].join(":")).join("|");
  }

  async function autoUpdateTick(){
    if(autoUpdateRunning||document.hidden)return;
    const active=document.querySelector(".screen.active")?.id;
    if(active!=="competitionScreen"&&active!=="statsForNerdsScreen"&&active!=="ownerPortfolioScreen")return;
    if(cache.dayKey!==sydneyKey()||Date.now()-cache.at>=CACHE_MS){await refreshCompetitionBoard(true);return;}
    if(isTestDraft())return;
    autoUpdateRunning=true;
    try{
      if(active==="competitionScreen"&&selectedSlateKey()!==sydneyKey())await loadDateSlate(selectedSlateKey(),true);
      const before=cache.games||[];
      const beforeById=new Map(before.map(g=>[g.id,g]));
      const latest=await fetchTodayScoreboardLite();
      const changed=gameStateSignature(latest)!==gameStateSignature(before);
      if(!changed)return;

      const finalTransition=latest.some(g=>{
        const old=beforeById.get(g.id);
        return g.status==="FINAL"&&old?.status!=="FINAL";
      });

      cache.games=latest;
      if(active==="competitionScreen"){
        renderGames(latest,cache.records||{});
        updateCompetitionTicker(competitionTickerRows,latest,cache.recent||[],false);
        const status=$("competitionDataStatus");
        if(status&&!finalTransition)status.textContent="Auto-updated live scores · full refresh runs when a game goes final";
      }

      if(finalTransition){
        cache.at=0;
        if(active==="competitionScreen")await refreshCompetitionBoard(true);
        else await refreshStatsForNerds(true);
      }
    }catch(e){
      console.warn("Competition auto-update check failed",e);
    }finally{
      autoUpdateRunning=false;
    }
  }

  function ensureAutoUpdate(){
    if(autoUpdateTimer)return;
    autoUpdateTimer=setInterval(autoUpdateTick,AUTO_UPDATE_MS);
    document.addEventListener("visibilitychange",()=>{
      if(!document.hidden)autoUpdateTick();
    });
  }

  function ensureTradeLedger(records={}){
    const ledger=state.tradeLedger&&typeof state.tradeLedger==="object"?state.tradeLedger:{banked:{},teams:{},events:[]};
    ledger.banked=ledger.banked&&typeof ledger.banked==="object"?ledger.banked:{};
    ledger.teams=ledger.teams&&typeof ledger.teams==="object"?ledger.teams:{};
    ledger.events=Array.isArray(ledger.events)?ledger.events:[];
    for(const p of state.players||[])if(!ledger.banked[p.name])ledger.banked[p.name]={w:0,l:0};
    for(const [team,a] of Object.entries(state.assignments||{})){
      if(!ledger.teams[team])ledger.teams[team]={owner:a.player,w:0,l:0,at:"season-start"};
    }
    state.tradeLedger=ledger;return ledger;
  }
  function ownerSummaries(records){
    const ledger=ensureTradeLedger(records);
    return state.players.map(p=>{
      const teams=p.teams||[],bank=ledger.banked[p.name]||{w:0,l:0};
      let w=Number(bank.w)||0,l=Number(bank.l)||0,projected=w,variance=0;
      const teamRows=teams.map(name=>{
        const r=records[name]||{w:0,l:0},played=r.w+r.l,remaining=Math.max(0,82-played);
        const epoch=ledger.teams[name]?.owner===p.name?ledger.teams[name]:{owner:p.name,w:0,l:0};
        const ownedW=Math.max(0,r.w-(Number(epoch.w)||0)),ownedL=Math.max(0,r.l-(Number(epoch.l)||0));
        const line=winLineFor(name);
        let pr=remaining?((Number.isFinite(line)?line:r.w+(remaining*.5))-r.w)/remaining:.5;
        pr=Math.max(.08,Math.min(.92,Number.isFinite(pr)?pr:.5));
        const exp=r.w+pr*remaining,ownerExpected=ownedW+pr*remaining;
        w+=ownedW;l+=ownedL;projected+=ownerExpected;variance+=remaining*pr*(1-pr);
        return {name,w:r.w,l:r.l,rank:r.rank||null,line,expected:exp,ownerW:ownedW,ownerL:ownedL,ownerExpected,acquiredAtW:Number(epoch.w)||0,acquiredAtL:Number(epoch.l)||0};
      });
      const winPct=w+l?w/(w+l)*100:0;
      return {name:p.name,w,l,winPct,teams:teamRows,projected,variance,probability:0,bankedW:Number(bank.w)||0,bankedL:Number(bank.l)||0};
    });
  }

  function executeTrade(proposal){
    const existing=state.tradeLedger?.events?.find(event=>event.id===proposal?.id);
    if(existing)return {offeredRecord:existing.offeredRecord||{w:0,l:0},requestedRecord:existing.requestedRecord||{w:0,l:0},at:existing.at};
    const offered=proposal?.offeredTeam,requested=proposal?.requestedTeam,requester=proposal?.requester,partner=proposal?.partner;
    if(!offered||!requested||offered===requested)throw new Error("Invalid trade teams");
    if(state.assignments?.[offered]?.player!==requester||state.assignments?.[requested]?.player!==partner)throw new Error("Team ownership changed before the vote finished");
    const records=cache.records||{},ledger=ensureTradeLedger(records),settle=(team,owner)=>{
      const r=records[team]||{w:0,l:0},epoch=ledger.teams[team]||{owner,w:0,l:0},bank=ledger.banked[owner]||(ledger.banked[owner]={w:0,l:0});
      bank.w+=(Math.max(0,r.w-(Number(epoch.w)||0)));bank.l+=(Math.max(0,r.l-(Number(epoch.l)||0)));
      return {w:r.w||0,l:r.l||0};
    };
    const offeredRecord=settle(offered,requester),requestedRecord=settle(requested,partner);
    const offeredAssignment={...state.assignments[offered]},requestedAssignment={...state.assignments[requested]};
    state.assignments[offered]={...requestedAssignment,player:partner,tradeId:proposal.id,tradedAt:new Date().toISOString()};
    state.assignments[requested]={...offeredAssignment,player:requester,tradeId:proposal.id,tradedAt:new Date().toISOString()};
    const at=new Date().toISOString();
    ledger.teams[offered]={owner:partner,w:offeredRecord.w,l:offeredRecord.l,at,tradeId:proposal.id};
    ledger.teams[requested]={owner:requester,w:requestedRecord.w,l:requestedRecord.l,at,tradeId:proposal.id};
    ledger.events.push({id:proposal.id,at,requester,partner,offeredTeam:offered,requestedTeam:requested,offeredRecord,requestedRecord});
    if(ledger.events.length>100)ledger.events=ledger.events.slice(-100);
    reconcileState();
    state.history.push("TRADE · "+requester+" sent "+offered+" to "+partner+" for "+requested+" · previous wins retained");
    state.lastAction=requester+" and "+partner+" completed a trade";
    saveState();
    cache.at=0;
    void refreshCompetitionBoard(true);
    return {offeredRecord,requestedRecord,at};
  }

  function calculateProbabilities(rows,sims=5000){
    if(!rows.length)return rows;
    const seedText=rows.map(r=>r.name+":"+r.w+"-"+r.l+":"+r.projected.toFixed(4)+":"+r.variance.toFixed(4)).join("|");
    const rng=seededRng(hashSeed(seedText));
    const wins=Array(rows.length).fill(0);
    for(let s=0;s<sims;s++){
      const totals=rows.map(r=>r.projected+normalSample(rng)*Math.sqrt(Math.max(.01,r.variance)));
      const top=Math.max(...totals),idx=[];totals.forEach((x,i)=>{if(Math.abs(x-top)<.0001)idx.push(i)});
      idx.forEach(i=>wins[i]+=1/idx.length);
    }
    rows.forEach((r,i)=>r.probability=wins[i]/sims*100);
    return rows.sort((a,b)=>b.winPct-a.winPct||b.w-a.w||b.projected-a.projected);
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

  function ownerRecentStats(recent,limit=10){
    const out={};
    state.players.forEach(p=>out[p.name]={w:0,l:0,games:0,closeW:0,closeL:0,blowoutW:0,blowoutL:0,pf:0,pa:0});
    for(const p of state.players){
      const owned=new Set(p.teams||[]);
      let seen=0;
      for(const g of recent){
        if(seen>=limit)break;
        let mine=null,opp=null,won=null;
        if(owned.has(g.home)){mine=g.homeScore;opp=g.awayScore;won=g.homeWinner}
        else if(owned.has(g.away)){mine=g.awayScore;opp=g.homeScore;won=g.awayWinner}
        if(mine==null)continue;
        seen++;
        const s=out[p.name];s.games++;s.pf+=mine;s.pa+=opp;
        if(won)s.w++;else s.l++;
        const margin=Math.abs(mine-opp);
        if(margin<=5){if(won)s.closeW++;else s.closeL++}
        if(margin>=15){if(won)s.blowoutW++;else s.blowoutL++}
      }
    }
    return out;
  }

  function ownerHeadToHead(recent,limit=80){
    const map={};
    let seen=0;
    for(const g of recent){
      if(seen++>=limit)break;
      const a=teamOwner(g.away),h=teamOwner(g.home);
      if(!a||!h||a===h)continue;
      const key=[a,h].sort().join("||");
      if(!map[key])map[key]={a:[a,h].sort()[0],b:[a,h].sort()[1],aw:0,bw:0,games:0};
      const row=map[key];row.games++;
      const winner=g.awayWinner?a:g.homeWinner?h:null;
      if(winner===row.a)row.aw++;
      else if(winner===row.b)row.bw++;
    }
    return Object.values(map);
  }

  function competitionTidbits(rows,games,recent){
    const bits=[],today=todaysOwnerResults(games),streaks=ownerStreaks(recent),form=ownerRecentStats(recent,10);
    const add=(score,tag,text)=>bits.push({score,tag,text});

    for(const r of rows){
      const d=today[r.name];
      if(d?.games){
        const diff=d.w-d.l;
        add(5+Math.abs(diff),"TODAY",r.name+" went "+d.w+"-"+d.l+" today and now owns a combined "+r.w+"-"+r.l+" record.");
        if(d.games>=3&&d.w===d.games)add(10,"PERFECT DAY",r.name+" swept the slate "+d.w+"-0 today. Every one of their completed games was a win.");
        if(d.games>=3&&d.l===d.games)add(10,"ROUGH DAY",r.name+" went 0-"+d.l+" today. Every one of their completed games was a loss.");
      }

      const st=streaks[r.name];
      if(st&&st.n>=3)add(6+st.n,st.type==="W"?"HOT":"COLD",r.name+"'s teams have "+(st.type==="W"?"won ":"lost ")+"their last "+st.n+" completed games.");

      const f=form[r.name];
      if(f?.games>=6){
        if(f.w>=8)add(8,"FORM",r.name+" is "+f.w+"-"+f.l+" across their last "+f.games+" completed team games.");
        if(f.l>=8)add(8,"FORM",r.name+" is "+f.w+"-"+f.l+" across their last "+f.games+" completed team games.");
        if(f.closeW+f.closeL>=3&&f.closeW>=3)add(7,"CLUTCH",r.name+" is "+f.closeW+"-"+f.closeL+" in games decided by 5 points or fewer across their recent sample.");
        if(f.blowoutL>=3)add(7,"PAIN",r.name+"'s teams have suffered "+f.blowoutL+" losses by 15+ points in their recent sample.");
        if(f.games>=5){
          const margin=f.pf-f.pa;
          if(Math.abs(margin)>=45)add(6,"MARGIN",r.name+"'s teams are "+(margin>0?"+":"")+margin+" in scoring margin across their last "+f.games+" completed games.");
        }
      }

      const action=games.filter(g=>teamOwner(g.home)===r.name||teamOwner(g.away)===r.name).length;
      if(action>=3)add(4,"BUSY NIGHT",r.name+" has "+action+" teams in action on today's Sydney slate.");

      if(r.teams?.length){
        const best=[...r.teams].sort((a,b)=>b.w-a.w||a.l-b.l)[0];
        const worst=[...r.teams].sort((a,b)=>(a.w/(a.w+a.l||1))-(b.w/(b.w+b.l||1)))[0];
        if(best&&r.w>0&&best.w/r.w>=.30)add(5,"TEAM CARRY",shortTeam(best.name)+" accounts for "+Math.round(best.w/r.w*100)+"% of "+r.name+"'s total wins.");
        if(worst&&(worst.w+worst.l)>=4&&worst.w<worst.l)add(4,"WEAK LINK",shortTeam(worst.name)+" is "+worst.w+"-"+worst.l+" and currently has the lowest win rate among "+r.name+"'s five teams.");
      }
    }

    for(const g of games){
      const a=teamOwner(g.away),h=teamOwner(g.home);
      if(a&&h&&a!==h)add(7,"RIVALRY",a+" vs "+h+": "+shortTeam(g.away)+" plays "+shortTeam(g.home)+" today.");
    }

    for(const h2h of ownerHeadToHead(recent)){
      if(h2h.games>=4&&h2h.aw!==h2h.bw){
        const leader=h2h.aw>h2h.bw?h2h.a:h2h.b;
        const trail=h2h.aw>h2h.bw?h2h.b:h2h.a;
        const lw=Math.max(h2h.aw,h2h.bw),tw=Math.min(h2h.aw,h2h.bw);
        add(6,"RIVALRY",leader+" leads "+trail+" "+lw+"-"+tw+" in recent direct owner-v-owner games.");
      }
    }

    if(rows.length){
      const sorted=[...rows].sort((a,b)=>b.winPct-a.winPct||b.w-a.w||b.projected-a.projected);
      const leader=sorted[0],last=sorted[sorted.length-1];
      add(9,"LEADER",leader.name+" leads the competition at "+leader.winPct.toFixed(1)+"% across a "+leader.w+"-"+leader.l+" combined record.");
      if(sorted.length>=4){
        const gap=leader.winPct-sorted[3].winPct;
        if(gap<=8)add(8,"TIGHT RACE","Only "+gap.toFixed(1)+" percentage points separate 1st and 4th in the live table.");
      }
      if(last&&leader.w-last.w>=8)add(5,"GAP",leader.name+" currently has a "+(leader.w-last.w)+"-win cushion over "+last.name+" in the actual standings.");
      const probs=[...rows].sort((a,b)=>b.winPct-a.winPct);
      if(probs.length>=2&&probs[0].winPct-probs[1].winPct<5)add(7,"PHOTO FINISH",probs[0].name+" and "+probs[1].name+" are separated by only "+(probs[0].winPct-probs[1].winPct).toFixed(1)+" percentage points in live winning percentage.");
    }

    const dedup=[];
    const seen=new Set();
    for(const x of bits.sort((a,b)=>b.score-a.score)){
      const key=x.tag+"|"+x.text;
      if(seen.has(key))continue;
      seen.add(key);dedup.push(x);
    }
    return dedup.slice(0,10);
  }

  function storyHeadline(x){
    const map={
      "LEADER":"THEY WAKE UP ON TOP",
      "RIVALRY":"BRAGGING RIGHTS",
      "HOT":"THE HEATER CONTINUES",
      "COLD":"SOMEONE CHECK ON THEM",
      "BUSY NIGHT":"REMOTE CONTROL NIGHT",
      "TODAY":"TODAY'S DAMAGE",
      "PERFECT DAY":"CLEAN SWEEP",
      "ROUGH DAY":"NO GOOD NEWS",
      "FORM":"FORM GUIDE",
      "CLUTCH":"ICE IN THE VEINS",
      "PAIN":"THAT LEFT A MARK",
      "MARGIN":"SCOREBOARD PRESSURE",
      "TEAM CARRY":"PUTTING THE TEAM ON HIS BACK",
      "WEAK LINK":"THE WEAK LINK",
      "TIGHT RACE":"NOBODY CAN BREATHE",
      "GAP":"DAYLIGHT",
      "PHOTO FINISH":"TOO CLOSE TO CALL"
    };
    return map[x.tag]||"STAT OF THE DAY";
  }

  function renderTidbits(bits){
    const el=$("competitionTidbits");if(!el)return;
    el.innerHTML=bits.length?bits.map(x=>
      '<article class="comp-tidbit"><label>'+esc(x.tag)+'</label><div class="comp-story-copy"><strong class="comp-story-headline">'+esc(storyHeadline(x))+'</strong><p>'+esc(x.text)+'</p></div></article>'
    ).join("")
      :'<div class="comp-empty">Nothing dramatic yet. That will not last.</div>';
    window.cvCompetitionTicker=bits.map(x=>({tag:x.tag,text:x.text,kind:["COLD","ROUGH DAY","PAIN"].includes(x.tag)?"alert":"draft"}));
  }

  function shortTeam(name){return teamMeta(name)?.[1]||name}
  function teamLogo(name){const t=teamMeta(name);return t?logoUrl(t[1]):""}
  function teamColors(name){
    const t=teamMeta(name);
    return {primary:t?.[2]||"#2d78c7",secondary:t?.[3]||"#ffffff"};
  }
  function teamStyle(name){
    const c=teamColors(name);
    return "--team1:"+c.primary+";--team2:"+c.secondary+";";
  }

  function ownerTodayLine(name,games){
    const d=todaysOwnerResults(games||[])[name];
    if(!d||!d.games)return "NO FINALS YET TODAY";
    if(d.w===d.games)return "TODAY · "+d.w+"-"+d.l+" · CLEAN SWEEP";
    if(d.l===d.games)return "TODAY · "+d.w+"-"+d.l+" · ROUGH ONE";
    return "TODAY · "+d.w+"-"+d.l;
  }

  let ownerPortfolioName="",ownerPortfolioLoadToken=0;
  const ownerPortfolioSchedules=new Map();

  function ownerButton(name,label=name,extra=""){
    const safe=esc(name).replace(/'/g,"&#39;");
    return '<button type="button" class="owner-portfolio-open '+extra+'" onclick="openOwnerPortfolio(\''+safe+'\')" aria-label="Open '+esc(name)+' portfolio">'+esc(label)+'</button>';
  }
  function portfolioGameLine(g){
    const ownAway=teamOwner(g.away)===ownerPortfolioName,ownTeam=ownAway?g.away:g.home,opponent=ownAway?g.home:g.away;
    const when=g.status==="IN"?(g.detail||"LIVE"):g.status==="FINAL"?"FINAL":daySydney(g.date)+" · "+timeSydney(g.date);
    const score=(g.status==="IN"||g.status==="FINAL")?(g.awayScore+"–"+g.homeScore):"vs";
    return '<article class="owner-game '+g.status.toLowerCase()+'" style="'+teamStyle(ownTeam)+'"><img src="'+teamLogo(ownTeam)+'" alt=""><div><small>'+esc(when)+'</small><strong>'+esc(shortTeam(ownTeam))+' <b>'+score+'</b> '+esc(shortTeam(opponent))+'</strong><span>'+esc(ownAway?"AWAY":"HOME")+'</span></div><img src="'+teamLogo(opponent)+'" alt=""></article>';
  }
  function renderOwnerPortfolio(){
    const row=(competitionTickerRows||[]).find(r=>r.name===ownerPortfolioName);
    if(!row)return;
    const hero=$("ownerPortfolioHero"),name=$("ownerPortfolioName"),status=$("ownerPortfolioStatus"),mark=$("ownerPortfolioMark");
    if(name)name.textContent=row.name;if(status)status.textContent=row.teams.length+" teams · live competition portfolio";if(mark)mark.textContent=row.winPct.toFixed(1)+"%";
    if(hero&&row.teams[0])hero.setAttribute("style",teamStyle(row.teams[0].name));
    const form=ownerRecentStats(cache.recent||[],10)[row.name]||{w:0,l:0,games:0,pf:0,pa:0};
    const streak=ownerStreaks(cache.recent||[])[row.name]||{n:0,type:""};
    const pointDiff=form.games?form.pf-form.pa:0;
    const metrics=[
      ["LIVE WINNING %",row.winPct.toFixed(1)+"%","Updates after every final"],
      ["COMBINED RECORD",row.w+"–"+row.l,(row.w+row.l)+" owned results"],
      ["PROJECTED FINISH",row.projected.toFixed(1),"Combined wins"],
      ["TITLE MODEL",row.probability.toFixed(1)+"%","Advanced season forecast"],
      ["LAST 10",form.games?form.w+"–"+form.l:"—","Across owned teams"],
      ["POINT DIFFERENTIAL",form.games?(pointDiff>=0?"+":"")+pointDiff:"—","Recent scored games"],
      ["CURRENT STREAK",streak.n?streak.n+(streak.type==="W"?"W":"L"):"—","Across the portfolio"],
      ["BANKED RECORD",(row.bankedW||0)+"–"+(row.bankedL||0),"Kept through trades"]
    ];
    const metricsEl=$("ownerPortfolioMetrics");if(metricsEl)metricsEl.innerHTML=metrics.map(x=>'<article><small>'+x[0]+'</small><strong>'+x[1]+'</strong><span>'+x[2]+'</span></article>').join("");
    const teamsEl=$("ownerPortfolioTeams");if(teamsEl)teamsEl.innerHTML=row.teams.map(t=>{
      const games=t.w+t.l,pct=games?t.w/games*100:0,owned=t.ownerW+t.ownerL;
      return '<button type="button" class="owner-team-card" style="'+teamStyle(t.name)+'" onclick="previewTeamFromCompetition(\''+esc(t.name).replace(/'/g,"&#39;")+'\')"><img src="'+teamLogo(t.name)+'" alt=""><div><small>'+esc(shortTeam(t.name))+'</small><strong>'+t.w+"–"+t.l+'</strong><span>'+pct.toFixed(1)+'% NBA win rate</span></div><div class="owner-team-owned"><b>'+t.ownerW+"–"+t.ownerL+'</b><small>'+ (owned?"SINCE OWNED":"NO RESULTS YET")+'</small></div></button>';
    }).join("");
    const teamNames=new Set(row.teams.map(t=>t.name));
    const recent=(cache.recent||[]).filter(g=>g.status==="FINAL"&&(teamNames.has(g.home)||teamNames.has(g.away))).sort((a,b)=>b.date-a.date).slice(0,8);
    const results=$("ownerPortfolioResults");if(results)results.innerHTML=recent.length?recent.map(portfolioGameLine).join(""):'<div class="portfolio-empty">No completed games yet.</div>';
    const schedule=$("ownerPortfolioSchedule"),saved=ownerPortfolioSchedules.get(row.name);
    if(schedule)schedule.innerHTML=saved?saved.length?saved.map(portfolioGameLine).join(""):'<div class="portfolio-empty">No games found in the next seven Sydney days.</div>':'<div class="portfolio-empty">Loading the next seven days…</div>';
  }
  async function loadOwnerPortfolioSchedule(name,teams,token){
    try{
      const keys=Array.from({length:8},(_,i)=>shiftDateKey(sydneyKey(),i));
      const results=await Promise.allSettled(keys.map(async key=>{
        const compact=key.replace(/-/g,"");
        return parseScoreboard(await fetchNbaJson("/api/nba/scoreboard?dates="+compact,"https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates="+compact,8000),true);
      }));
      if(token!==ownerPortfolioLoadToken)return;
      const teamSet=new Set(teams),games=[...new Map(results.flatMap(r=>r.status==="fulfilled"?r.value:[]).map(g=>[g.id,g])).values()]
        .filter(g=>g.status!=="FINAL"&&(teamSet.has(g.home)||teamSet.has(g.away))).sort((a,b)=>a.date-b.date).slice(0,12);
      ownerPortfolioSchedules.set(name,games);if(ownerPortfolioName===name)renderOwnerPortfolio();
    }catch(_){if(token===ownerPortfolioLoadToken){ownerPortfolioSchedules.set(name,[]);renderOwnerPortfolio()}}
  }
  function openOwnerPortfolio(name){
    const row=(competitionTickerRows||[]).find(r=>r.name===name);if(!row)return;
    ownerPortfolioName=name;showScreenLocal("ownerPortfolioScreen");renderOwnerPortfolio();window.scrollTo(0,0);
    const token=++ownerPortfolioLoadToken;if(!ownerPortfolioSchedules.has(name))void loadOwnerPortfolioSchedule(name,row.teams.map(t=>t.name),token);
    setTicker([{tag:"PORTFOLIO",text:name+"'s live records, form and upcoming games.",kind:"draft"}],name.toUpperCase());
  }
  window.openOwnerPortfolio=openOwnerPortfolio;

  function renderSpotlight(rows){
    const el=$("competitionSpotlight");if(!el)return;
    if(!rows.length){el.innerHTML='<div class="comp-loading">NO COMPETITION DATA YET</div>';return}
    const leader=rows[0],second=rows[1];
    const pctGap=second?leader.winPct-second.winPct:leader.winPct;
    const teamIcons=leader.teams.map(t=>'<button class="comp-spot-team" onclick="previewTeamFromCompetition(\''+esc(t.name).replace(/'/g,"&#39;")+'\')" title="'+esc(t.name)+'"><img src="'+teamLogo(t.name)+'" alt=""><span>#'+(t.rank||"—")+' · '+t.w+"-"+t.l+'</span></button>').join("");
    const raceCopy=pctGap>0
      ?leader.name+" leads the live table by "+pctGap.toFixed(1)+" percentage point"+(Math.abs(pctGap-1)<.05?"":"s")+"."
      :leader.name+" has the tiebreaking edge on actual wins.";
    const leadColor=leader.teams?.[0]?.name?teamStyle(leader.teams[0].name):"";
    el.setAttribute("style",leadColor);
    el.innerHTML='<div class="comp-spotlight-inner">'+
      '<div>'+
        '<div class="comp-spotlight-label">CURRENT COMPETITION LEADER</div>'+
        '<div class="comp-spotlight-name">'+ownerButton(leader.name,leader.name,"spotlight")+'</div>'+
        '<div class="comp-spotlight-recordline"><div class="comp-spotlight-record">'+leader.w+"-"+leader.l+'</div><span>COMBINED RECORD ACROSS '+leader.teams.length+' TEAMS</span></div>'+
        '<div class="comp-spotlight-teams">'+teamIcons+'</div>'+
        '<div class="comp-spotlight-copy">'+esc(raceCopy+" Their five teams are currently projected for "+leader.projected.toFixed(1)+" total wins. The chase is live.")+'</div>'+
      '</div>'+
      '<div class="comp-spotlight-numbers">'+
        '<div><div class="comp-big-prob-label">WINNING %</div><div class="comp-big-prob">'+leader.winPct.toFixed(1)+'<em>%</em></div></div>'+
        '<div class="comp-big-proj"><small>PROJECTED FINISH</small>'+leader.projected.toFixed(1)+' WINS</div>'+
      '</div>'+
    '</div>';
  }

  function renderRace(rows){
    const el=$("competitionRace");if(!el)return;
    const race=[...rows].sort((a,b)=>b.winPct-a.winPct||b.w-a.w||b.projected-a.projected);
    el.innerHTML=race.map((r,i)=>
      '<div class="comp-race-row '+(i===0?'leader':'')+'" style="--prob:'+Math.max(1,r.winPct)+'%">'+
        '<div class="comp-race-rank">'+(i+1)+'</div>'+
        '<div class="comp-race-name"><div class="comp-race-name-line">'+ownerButton(r.name,r.name,"race")+'<b class="comp-race-record" aria-label="'+r.w+' wins, '+r.l+' losses">'+r.w+'–'+r.l+'</b></div><small>'+r.projected.toFixed(1)+' projected wins</small></div>'+
        '<div class="comp-race-pct">'+r.winPct.toFixed(1)+'<span>%</span></div>'+
      '</div>'
    ).join("");
  }

  function renderLeaderboard(rows,demo,games=[]){
    const el=$("competitionLeaderboard");if(!el)return;
    const today=todaysOwnerResults(games||[]);
    renderSpotlight(rows);
    renderRace(rows);
    el.innerHTML=rows.map((r,i)=>{
      const teams=r.teams.map(t=>'<button class="comp-team-chip" style="'+teamStyle(t.name)+'" onclick="previewTeamFromCompetition(\''+esc(t.name).replace(/'/g,"&#39;")+'\')"><img src="'+teamLogo(t.name)+'" alt=""><span>'+esc(shortTeam(t.name))+'</span><b>#'+(t.rank||"—")+' · '+t.w+"-"+t.l+'</b></button>').join("");
      const d=today[r.name]||{w:0,l:0,games:0};
      const daily=d.games?(d.w+"-"+d.l+" TODAY"):"NO FINALS TODAY";
      return '<article class="comp-player-card '+(i===0?'leader':'')+'">'+
        '<div class="comp-player-main">'+
          '<div class="comp-player-head"><div class="comp-card-rank">'+(i+1)+'</div>'+ownerButton(r.name,r.name,"table")+'<span class="comp-card-record">'+r.w+"-"+r.l+'</span></div>'+
          '<div class="comp-card-meta"><span>'+daily+'</span><span>PROJECTED <b>'+r.projected.toFixed(1)+'</b> · WINNING <b>'+r.winPct.toFixed(1)+'%</b></span></div>'+
          '<div class="comp-prob"><i style="width:'+Math.max(1,r.winPct)+'%"></i></div>'+
          '<div class="comp-team-list">'+teams+'</div>'+
        '</div>'+
      '</article>';
    }).join("");
    const badge=$("competitionModeBadge");if(badge){badge.textContent=demo?"DEMO DATA":regularSeasonStarted()?"LIVE NBA DATA":"SEASON PROJECTIONS";badge.classList.toggle("demo",demo)}
    if(ownerPortfolioName&&document.querySelector(".screen.active")?.id==="ownerPortfolioScreen")renderOwnerPortfolio();
  }

  function gameStatusText(g){
    if(g.status==="FINAL")return "FINAL";
    if(g.status==="IN")return g.detail||"LIVE";
    return timeSydney(g.date);
  }




  let slateOffset=null,slateDayKey="",slateToday=[],slateRecords={};
  const dateSlates=new Map();
  const firstSlate=(SEASON_YEAR-1)+"-10-01",lastSlate=SEASON_YEAR+"-07-31";
  function shiftDateKey(key,days){return new Date(Date.parse(key+"T12:00:00Z")+days*86400000).toISOString().slice(0,10)}
  function nextSydneyKey(now=new Date()){return shiftDateKey(sydneyKey(now),1)}
  function chooseSlate(today,tomorrow){
    if(slateOffset===null)slateOffset=today.length?0:tomorrow.length?1:0;
    return slateOffset===1?tomorrow:today;
  }
  function selectedSlateKey(){return shiftDateKey(sydneyKey(),slateOffset??0)}
  window.changeCompetitionDay=function(offset){
    const n=Math.trunc(Number(offset));if(!Number.isFinite(n))return;
    const key=shiftDateKey(sydneyKey(),n);if(key<firstSlate||key>lastSlate)return;
    slateDayKey=sydneyKey();slateOffset=n;
    renderGames(slateToday,slateRecords);
  };
  window.stepCompetitionDay=function(step){window.changeCompetitionDay((slateOffset??0)+step)};
  window.pickCompetitionDate=function(key){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(key)||key<firstSlate||key>lastSlate)return;
    const day=Date.parse(key+"T12:00:00Z");if(!Number.isFinite(day)||new Date(day).toISOString().slice(0,10)!==key)return;
    window.changeCompetitionDay(Math.round((day-Date.parse(sydneyKey()+"T12:00:00Z"))/86400000));
  };
  async function loadDateSlate(key,force=false){
    const previous=dateSlates.get(key),ttl=key<sydneyKey()?6*3600000:120000;
    if(previous?.pending)return previous.pending;
    if(!force&&previous&&Date.now()-previous.at<ttl)return previous;
    const item={...previous,loading:true,error:null};
    const pending=(async()=>{
      const keys=[shiftDateKey(key,-1),key,shiftDateKey(key,1)];
      const results=await Promise.allSettled(keys.map(async date=>{
        const compact=date.replace(/-/g,"");
        return parseScoreboard(await fetchNbaJson("/api/nba/scoreboard?dates="+compact,"https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates="+compact,8000),true);
      }));
      const failures=results.filter(r=>r.status==="rejected").length;
      if(failures){item.error="Could not refresh the complete schedule. "+(previous?.games?"Showing the last saved result.":"Please try Refresh.");item.games=previous?.games;item.at=0;}
      else{item.games=[...new Map(results.flatMap(r=>r.value).map(g=>[g.id,g])).values()].filter(g=>sydneyKey(g.date)===key).sort((a,b)=>a.date-b.date);item.at=Date.now();}
      item.loading=false;item.pending=null;dateSlates.set(key,item);
      while(dateSlates.size>60)dateSlates.delete(dateSlates.keys().next().value);
      if(selectedSlateKey()===key)renderGames(slateToday,slateRecords);
      return item;
    })();
    item.pending=pending;dateSlates.set(key,item);return pending;
  }
  window.refreshCompetitionSlate=function(){
    const key=selectedSlateKey();if(key===sydneyKey())return refreshCompetitionBoard(true);
    return loadDateSlate(key,true);
  };
  function bindSlateSwipe(el){
    if(el.dataset.swipeBound)return;el.dataset.swipeBound="true";
    let start=null,suppressClickUntil=0;
    el.addEventListener("click",e=>{if(Date.now()<suppressClickUntil){e.preventDefault();e.stopPropagation();}},true);
    el.addEventListener("touchstart",e=>{const t=e.touches[0];start={x:t.clientX,y:t.clientY}},{passive:true});
    el.addEventListener("touchend",e=>{if(!start)return;const t=e.changedTouches[0],dx=t.clientX-start.x,dy=t.clientY-start.y;start=null;if(Math.abs(dx)>=60&&Math.abs(dx)>Math.abs(dy)*1.5){suppressClickUntil=Date.now()+500;window.stepCompetitionDay(dx<0?1:-1)}},{passive:true});
  }
  function gameWinChance(g){
    if(!["SCHEDULED","IN"].includes(g.status))return null;
    const homeLine=winLineFor(g.home),awayLine=winLineFor(g.away);
    if(homeLine===null||awayLine===null)return null;
    // Log5 matchup estimate from season win projections; +0.12 log-odds at home.
    const clamp=p=>Math.max(.05,Math.min(.95,p));
    const hp=clamp(homeLine/82),ap=clamp(awayLine/82);
    const odds=Math.log(hp/(1-hp))-Math.log(ap/(1-ap))+.12;
    const home=Math.round(100/(1+Math.exp(-odds)));
    return {home,away:100-home};
  }


  function gameHighlightsLink(g){
    if(g.status!=="FINAL"||g.sample||String(g.id).startsWith("demo-"))return "";
    const date=new Date(g.date);if(!Number.isFinite(date.getTime()))return "";
    const gameDay=new Intl.DateTimeFormat("en-US",{timeZone:"America/New_York",year:"numeric",month:"long",day:"numeric"}).format(date);
    const query="NBA "+g.away+" vs "+g.home+" full game highlights "+gameDay;
    return '<a class="game-youtube-highlights" href="https://www.youtube.com/results?search_query='+encodeURIComponent(query)+'" target="_blank" rel="noopener noreferrer" aria-label="Search YouTube highlights for '+esc(g.away)+' vs '+esc(g.home)+' on '+esc(gameDay)+'"><span>YouTube highlights ↗</span><small>Search this game · videos may appear after final</small></a>';
  }

  function gameWinChanceMarkup(g){
    if(g.status==="FINAL")return '<div class="comp-game-probability"><span>FINAL RESULT</span><strong>'+esc(shortTeam(g.homeWinner?g.home:g.awayWinner?g.away:g.home))+(g.homeWinner||g.awayWinner?' WON':' · FINAL')+'</strong></div>';
    const p=gameWinChance(g);
    if(!p)return '<div class="comp-game-probability"><span>'+(g.status==="SCHEDULED"||g.status==="IN"?"WIN CHANCE":"GAME STATUS")+'</span><strong>'+esc(g.status==="SCHEDULED"||g.status==="IN"?"Projection unavailable":g.status)+'</strong></div>';
    return '<div class="comp-game-probability"><div><span>'+esc(shortTeam(g.away))+' <b>'+p.away+'%</b></span><span>'+esc(shortTeam(g.home))+' <b>'+p.home+'%</b></span></div>'+
      '<div class="comp-game-prob-track" aria-hidden="true"><i style="width:'+p.away+'%"></i></div>'+
      '<small>'+(g.sample?'SAMPLE · ':'')+'PREGAME ESTIMATE'+(g.status==="IN"?' · NOT LIVE ODDS':'')+'</small></div>';
  }

  let gameStatsOpen=null;
  const gameStatsCache=new Map();

  function statsTable(headers,rows){
    return '<table class="comp-game-stats-table"><thead><tr>'+headers.map(h=>'<th scope="col">'+esc(h)+'</th>').join('')+'</tr></thead><tbody>'+
      rows.map(r=>'<tr>'+r.map((v,i)=>i===0?'<th scope="row">'+esc(v)+'</th>':'<td>'+esc(v)+'</td>').join('')+'</tr>').join('')+'</tbody></table>';
  }

  function gameStatsMarkup(data,g){
    const teams=data?.boxscore?.teams||[];
    const home=teams.find(t=>teamNameFromEspn(t.team)===g.home);
    const away=teams.find(t=>teamNameFromEspn(t.team)===g.away);
    const metrics=[["Field goals","fieldGoalsMade-fieldGoalsAttempted"],["3-pointers","threePointFieldGoalsMade-threePointFieldGoalsAttempted"],["Free throws","freeThrowsMade-freeThrowsAttempted"],["Rebounds","totalRebounds"],["Assists","assists"],["Turnovers","turnovers"],["Steals","steals"],["Blocks","blocks"]];
    const value=(team,key)=>team?.statistics?.find(x=>x.name===key)?.displayValue??"—";
    const rows=metrics.filter(([,key])=>value(away,key)!=="—"||value(home,key)!=="—").map(([label,key])=>[label,value(away,key),value(home,key)]);
    let html=rows.length?statsTable(["Team stats",shortTeam(g.away),shortTeam(g.home)],rows):'<p>Team stats are not available yet.</p>';
    for(const name of [g.away,g.home]){
      const team=(data?.boxscore?.players||[]).find(t=>teamNameFromEspn(t.team)===name);
      const group=team?.statistics?.find(x=>x.labels?.includes("PTS"));
      if(!group)continue;
      const cell=(a,label)=>a.stats?.[group.labels.indexOf(label)]??"—";
      const players=(group.athletes||[]).filter(a=>!a.didNotPlay&&Array.isArray(a.stats))
        .sort((a,b)=>(parseFloat(cell(b,"PTS"))||0)-(parseFloat(cell(a,"PTS"))||0)).slice(0,3);
      if(players.length)html+='<h4>'+esc(shortTeam(name))+' · scoring leaders</h4>'+statsTable(["Player","PTS","REB","AST"],players.map(a=>[a.athlete?.displayName||"Player",cell(a,"PTS"),cell(a,"REB"),cell(a,"AST")]));
    }
    if(window.cvInsights)html+=window.cvInsights.espnGameExtras(data,g);
    return html;
  }

  function sampleGameStats(g){
    const make=(name,home)=>{const score=home?g.homeScore:g.awayScore;const made=Math.max(0,Math.floor((score-20)/2));const ft=Math.max(0,score-made*2-9);return {team:{displayName:name},statistics:[
      ["fieldGoalsMade-fieldGoalsAttempted",made+"-"+(made+32)],
      ["threePointFieldGoalsMade-threePointFieldGoalsAttempted","9-24"],
      ["freeThrowsMade-freeThrowsAttempted",ft+"-"+(ft+2)],
      ["totalRebounds",home?"31":"29"],["assists",home?"19":"21"],
      ["turnovers",home?"8":"10"],["steals",home?"6":"4"],["blocks",home?"3":"5"]
    ].map(([name,displayValue])=>({name,displayValue}))};};
    // Sample totals are illustrative; never mix them with live API responses.
    return {boxscore:{teams:[make(g.away,false),make(g.home,true)]}};
  }

  function loadGameSummary(g,force=false){
    const key=[g.id,g.status,g.homeScore,g.awayScore].join(":");
    let item=gameStatsCache.get(key);
    if(force||!item||Date.now()-item.at>60000){
      if(!/^\d+$/.test(String(g.id)))return Promise.reject(new Error("Invalid game ID"));
      const direct="https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event="+encodeURIComponent(g.id);
      item={at:Date.now(),promise:fetchNbaJson("/api/nba/summary?event="+encodeURIComponent(g.id)+(force?"&fresh=1":""),direct,8000)};
      gameStatsCache.set(key,item);
      item.promise.catch(()=>{if(gameStatsCache.get(key)===item)gameStatsCache.delete(key)});
    }
    return item.promise;
  }
  async function populateGameStats(panel,g,records){
    // The open panel is rebuilt by the slate refresh, including the tip-off transition.
    const started=["IN","FINAL"].includes(g.status);
    panel.innerHTML=(started?'':'<div class="game-lineup-slot" aria-live="polite"></div>')+'<div class="game-box-slot" aria-live="polite"></div>';
    const box=panel.querySelector(".game-box-slot");
    if(started){
      await populateGameBoxStats(box,g,records);
      return;
    }
    const lineup=panel.querySelector(".game-lineup-slot");
    await Promise.allSettled([window.cvAvailability?.renderGame(lineup,g,loadGameSummary),populateGameBoxStats(box,g,records)]);
  }
  async function populateGameBoxStats(panel,g,records){
    if(!["FINAL","IN"].includes(g.status)){
      const record=name=>{const r=records[name];return r?r.w+"–"+r.l:"—"};
      panel.innerHTML='<p>'+esc(g.status==='SCHEDULED'?'Pregame matchup · game stats appear after tip-off.':g.status+' · check the schedule for a confirmed new time.')+'</p>'+statsTable(["Team",shortTeam(g.away),shortTeam(g.home)],[["Season record",record(g.away),record(g.home)],["Projected season wins",winLineFor(g.away)??"—",winLineFor(g.home)??"—"]]);
      return;
    }
    if(g.sample||String(g.id).startsWith("demo-")){
      panel.innerHTML='<p class="comp-game-stats-note">SAMPLE STATS · Fictional preview</p>'+gameStatsMarkup(sampleGameStats(g),g);
      return;
    }
    panel.innerHTML='<p>Loading game stats…</p>';
    const key=[g.id,g.status,g.homeScore,g.awayScore].join(":");
    try{
      const data=await loadGameSummary(g);
      if(panel.isConnected){
        panel.innerHTML='<p class="comp-game-stats-note">ESPN · '+(g.status==="FINAL"?"FINAL BOX SCORE":"LIVE SNAPSHOT · "+esc(g.detail||"IN PROGRESS"))+'</p>'+gameStatsMarkup(data,g);
        window.cvInsights?.bindGames(panel,g);
      }
    }catch(e){
      gameStatsCache.delete(key);
      if(panel.isConnected)panel.innerHTML='<p>Stats temporarily unavailable. Close and reopen to try again.</p>';
    }
  }


  async function refreshOpenGame(g){
    const data=await loadGameSummary(g,true);
    const updated=parseScoreboard({events:[data.header]},true).find(x=>x.id===String(g.id));
    if(!updated)throw new Error("Updated score unavailable");
    Object.assign(g,updated);
    const lists=[cache.games,cache.tomorrow,cache.recent,slateToday,...[...dateSlates.values()].map(x=>x.games)];
    for(const list of lists)for(const item of list||[])if(String(item.id)===String(g.id))Object.assign(item,updated);
    gameStatsCache.set([g.id,g.status,g.homeScore,g.awayScore].join(":"),{at:Date.now(),promise:Promise.resolve(data)});
    renderGames(slateToday,slateRecords);
  }

  function bindGameStats(el,games,records){
    if(!games.some(g=>g.id===gameStatsOpen))gameStatsOpen=null;
    el.querySelectorAll(".comp-game").forEach((card,index)=>{
      const g=games[index],button=card.querySelector(".comp-game-stats-toggle"),panel=card.querySelector(".comp-game-stats"),body=card.querySelector(".comp-game-stats-body");
      const open=()=>{
        el.querySelectorAll(".comp-game-stats-toggle").forEach(b=>b.setAttribute("aria-expanded","false"));
        el.querySelectorAll(".comp-game-stats").forEach(p=>p.hidden=true);
        gameStatsOpen=g.id;panel.hidden=false;button.setAttribute("aria-expanded","true");
        void populateGameStats(body,g,records);
      };
      const close=()=>{panel.hidden=true;button.setAttribute("aria-expanded","false");if(gameStatsOpen===g.id)gameStatsOpen=null};
      button.addEventListener("click",()=>{if(gameStatsOpen===g.id){close();return}open()});
      card.querySelector(".comp-game-stats-refresh").addEventListener("click",async e=>{
        const refresh=e.currentTarget;if(refresh.disabled)return;
        refresh.disabled=true;refresh.setAttribute("aria-busy","true");
        const note=card.querySelector(".comp-game-refresh-status");note.textContent="Refreshing…";
        try{await refreshOpenGame(g);}
        catch(_){if(note.isConnected)note.textContent="Couldn’t update. Tap refresh to retry.";}
        finally{refresh.disabled=false;refresh.removeAttribute("aria-busy");}
      });
      card.querySelector(".comp-game-stats-close").addEventListener("click",()=>{close();button.focus()});
      card.addEventListener("keydown",e=>{if(e.key==="Escape"){close();button.focus()}});
      if(gameStatsOpen===g.id)open();
    });
  }

  function gamesDisplayOrder(games){
    const priority={IN:0,SCHEDULED:1,DELAYED:1,POSTPONED:1,CANCELLED:1,FINAL:2};
    return [...(games||[])].sort((a,b)=>{
      const ap=priority[a.status]??1,bp=priority[b.status]??1;
      if(ap!==bp)return ap-bp;
      const ad=+new Date(a.date||0),bd=+new Date(b.date||0);
      if(a.status==="SCHEDULED"&&b.status==="SCHEDULED")return ad-bd;
      return bd-ad;
    });
  }

  function renderGames(games,records={}){
    const el=$("competitionGames");if(!el)return;
    const todayKey=sydneyKey();
    if(slateDayKey!==todayKey){slateDayKey=todayKey;slateOffset=null;}
    slateToday=games;slateRecords=records;
    chooseSlate(games,cache.tomorrow||[]);
    const selectedKey=selectedSlateKey();
    let item=selectedKey===todayKey?{games,at:cache.at||Date.now()}:dateSlates.get(selectedKey);
    if(selectedKey!==todayKey&&!item){void loadDateSlate(selectedKey);item=dateSlates.get(selectedKey);}
    games=gamesDisplayOrder(item?.games||[]);
    const title=$("competitionSlateTitle");if(title)title.textContent=slateOffset===0?"TODAY’S GAMES":slateOffset===1?"TOMORROW’S GAMES":"NBA GAMES";
    const dateEl=$("competitionSlateDate");if(dateEl)dateEl.textContent=daySydney(new Date(selectedKey+"T01:00:00Z")).toUpperCase()+" · SYDNEY";
    const picker=$("competitionGameDate");if(picker){picker.value=selectedKey;picker.min=firstSlate;picker.max=lastSlate;}
    const previous=$("competitionDayPrevious"),next=$("competitionDayNext");if(previous)previous.disabled=selectedKey<=firstSlate;if(next)next.disabled=selectedKey>=lastSlate;
    for(const offset of [0,1]){const tab=$("competitionDay"+offset);if(tab)tab.setAttribute("aria-pressed",String(slateOffset===offset));}
    const hint=$("competitionDayHint");if(hint)hint.textContent=item?.error?item.error:item?.loading?"Refreshing selected date…":(item?.at?"Updated "+timeSydney(new Date(item.at))+" · ":"")+"Sydney time"+(selectedKey!==todayKey?" · records shown are current":"");
    bindSlateSwipe(el);
    if(!games.length){el.innerHTML='<div class="comp-empty">'+(item?.loading?'Loading this date’s games…':item?.error?'Schedule unavailable. Use Refresh to try again.':'No regular-season or playoff games listed for this Sydney date. Pick another date or use the arrows.')+'</div>';return}
    const teamLine=name=>{
      const r=records[name]||{w:0,l:0,rank:null};
      return "#"+(r.rank||"—")+"\u00a0·\u00a0"+r.w+"-"+r.l;
    };
    const side=(name,owner,score,sideClass,scores)=>
      '<div class="comp-game-side '+sideClass+'" style="'+teamStyle(name)+'">'+
        '<img src="'+teamLogo(name)+'" alt="">'+
        '<div class="comp-game-copy">'+
          '<strong>'+esc(shortTeam(name))+'</strong>'+
          '<span class="comp-game-owner">'+esc(owner||"UNOWNED")+'</span>'+
          '<span class="comp-game-teamline">'+esc(teamLine(name))+'</span>'+
        '</div>'+
        (scores?'<b>'+score+'</b>':'')+
      '</div>';

    el.innerHTML=games.map((g,index)=>{
      const ao=teamOwner(g.away),ho=teamOwner(g.home);
      const scores=g.status==="FINAL"||g.status==="IN";
      const status=g.status==="SCHEDULED"?(g.timeTbd?"TIME TBD":timeSydney(g.date)):g.status==="IN"?(g.detail||"LIVE"):g.status==="FINAL"?"FINAL":g.status;
      return '<article class="comp-game '+g.status.toLowerCase()+'"><div class="comp-game-main">'+
        side(g.away,ao,g.awayScore,"away",scores)+
        side(g.home,ho,g.homeScore,"home",scores)+
        (status?'<div class="comp-game-state">'+esc(status)+'</div>':'')+
        gameWinChanceMarkup(g)+
        '<button type="button" class="comp-game-stats-toggle" aria-expanded="false" aria-controls="compGameStats'+index+'" aria-label="Game stats: '+esc(shortTeam(g.away))+' vs '+esc(shortTeam(g.home))+'"><span>Click or tap for stats</span></button>'+gameHighlightsLink(g)+'</div>'+
        '<section class="comp-game-stats" id="compGameStats'+index+'" aria-label="Game stats" hidden><div class="comp-game-stats-head"><strong>'+esc(shortTeam(g.away))+' vs '+esc(shortTeam(g.home))+'</strong><div class="comp-game-stats-actions"><span class="comp-game-refresh-status" role="status"></span><button type="button" class="comp-game-stats-refresh" aria-label="Refresh scores and game stats" title="Refresh scores and game stats"><span aria-hidden="true">↻</span></button><button type="button" class="comp-game-stats-close">Close stats</button></div></div><div class="comp-game-stats-body" aria-live="polite"></div></section>'+
      '</article>';
    }).join("");
    bindGameStats(el,games,records);
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


  function saveCompetitionSnapshot(rows,demo=false){
    const snapshot={
      key:sydneyKey(new Date()),
      source:regularSeasonStarted()?"regular-season":"season-projection",
      at:new Date().toISOString(),
      demo:!!demo,
      rows:rows.map((r,i)=>({name:r.name,rank:i+1,w:r.w,l:r.l,projected:+r.projected.toFixed(2),probability:+r.probability.toFixed(2)}))
    };
    mergeSeasonSnapshot(snapshot);
    if(typeof persist==="function")persist();
    if(!demo)void pushSeasonSnapshot(snapshot);
    return snapshot;
  }

  function pct(w,l){
    const g=w+l;return g?w/g:0;
  }

  function nerdRecordBook(rows,recent,demo=false){
    const form=ownerRecentStats(recent,10),streaks=ownerStreaks(recent);
    const allTeams=rows.flatMap(r=>r.teams.map(t=>({...t,owner:r.name,pct:pct(t.w,t.l)})));
    const bestTeam=[...allTeams].sort((a,b)=>b.pct-a.pct||b.w-a.w)[0];
    const worstTeam=[...allTeams].filter(t=>t.w+t.l>0).sort((a,b)=>a.pct-b.pct||a.w-b.w)[0];
    const bestForm=[...rows].map(r=>({name:r.name,...(form[r.name]||{})})).sort((a,b)=>(b.w-b.l)-(a.w-a.l)||b.w-a.w)[0];
    const hottest=[...rows].map(r=>({name:r.name,...(streaks[r.name]||{n:0,type:""})})).sort((a,b)=>b.n-a.n)[0];
    const hist=(state.competitionSnapshots||[]).filter(s=>!!s.demo===!!demo);
    let highProb=null,biggestLead=null;
    for(const s of hist){
      const sr=[...(s.rows||[])].sort((a,b)=>a.rank-b.rank);
      for(const r of sr){if(!highProb||r.probability>highProb.probability)highProb={...r,key:s.key}}
      if(sr.length>1){
        const lead=sr[0].w-sr[1].w;
        if(!biggestLead||lead>biggestLead.lead)biggestLead={lead,name:sr[0].name,key:s.key};
      }
    }
    return [
      {label:"BEST TEAM RECORD",value:bestTeam?shortTeam(bestTeam.name)+" "+bestTeam.w+"-"+bestTeam.l:"—",sub:bestTeam?bestTeam.owner:"No data"},
      {label:"WORST TEAM RECORD",value:worstTeam?shortTeam(worstTeam.name)+" "+worstTeam.w+"-"+worstTeam.l:"—",sub:worstTeam?worstTeam.owner:"No data"},
      {label:"BEST LAST 10",value:bestForm&&bestForm.games?bestForm.name+" "+bestForm.w+"-"+bestForm.l:"—",sub:"Recent completed team games"},
      {label:"LONGEST CURRENT STREAK",value:hottest&&hottest.n?hottest.name+" "+hottest.n+(hottest.type==="W"?"W":"L"):"—",sub:"Current streak"},
      {label:"HIGHEST TITLE %",value:highProb?highProb.name+" "+highProb.probability.toFixed(1)+"%":"—",sub:highProb?highProb.key:"History builds daily"},
      {label:"BIGGEST LEAD",value:biggestLead&&biggestLead.lead>0?biggestLead.name+" +"+biggestLead.lead:"NO CLEAR LEAD",sub:biggestLead&&biggestLead.lead>0?biggestLead.key:"History builds daily"}
    ];
  }

  function renderStatsForNerds(rows,games,recent,demo){
    window.cvNerdStudio?.render(rows,games,recent,demo);
    const status=$("nerdStatus");if(status)status.textContent=(demo?"DEMO DATA · ":"")+"Deep stats from current records, recent results and saved daily snapshots · auto-checking every 2 minutes.";

    const form=ownerRecentStats(recent,10);
    const heroBits=competitionTidbits(rows,games,recent);
    const hero=heroBits[0]||null;
    const heroHeadline=$("nerdHeroHeadline"),heroText=$("nerdHeroText"),heroLabel=$("nerdHeroLabel"),heroValue=$("nerdHeroValue");
    if(heroHeadline)heroHeadline.textContent=hero?storyHeadline(hero):"NO CHAOS YET";
    if(heroText)heroText.textContent=hero?hero.text:"The numbers are behaving themselves. Suspicious.";
    const titleLeader=[...rows].sort((a,b)=>b.probability-a.probability)[0];
    const heroOwner=hero?rows.find(r=>String(hero.text||"").toLowerCase().includes(String(r.name||"").toLowerCase())):null;
    const heroPerson=heroOwner||titleLeader;
    if(heroLabel)heroLabel.textContent=heroPerson?(heroPerson.name+" TITLE CHANCE"):"LIVE";
    if(heroValue){
      heroValue.textContent=heroPerson?heroPerson.probability.toFixed(1)+"%":"—";
      const heroEl=$("nerdHero");
      const leadTeam=heroPerson?.teams?.[0]?.name;
      if(heroEl&&leadTeam)heroEl.setAttribute("style",teamStyle(leadTeam));
    }

    const recordBook=$("nerdRecordBook");
    if(recordBook){
      recordBook.innerHTML=nerdRecordBook(rows,recent,demo).map(x=>
        '<article class="nerd-record"><label>'+esc(x.label)+'</label><strong>'+esc(x.value)+'</strong><span>'+esc(x.sub)+'</span></article>'
      ).join("");
    }

    const owners=$("nerdOwners");
    if(owners){
      owners.innerHTML=rows.map(r=>{
        const f=form[r.name]||{w:0,l:0,games:0,closeW:0,closeL:0,blowoutW:0,blowoutL:0,pf:0,pa:0};
        const best=[...r.teams].sort((a,b)=>pct(b.w,b.l)-pct(a.w,a.l)||b.w-a.w)[0];
        const worst=[...r.teams].sort((a,b)=>pct(a.w,a.l)-pct(b.w,b.l)||a.w-b.w)[0];
        const margin=f.pf-f.pa;
        return '<article class="nerd-owner-card">'+
          '<header><strong>'+esc(r.name)+'</strong><b>'+r.w+'-'+r.l+'</b></header>'+
          '<div class="nerd-metrics">'+
            '<span><small>LAST 10</small><b>'+f.w+'-'+f.l+'</b></span>'+
            '<span><small>CLUTCH ≤5</small><b>'+f.closeW+'-'+f.closeL+'</b></span>'+
            '<span><small>BLOWOUTS 15+</small><b>'+f.blowoutW+'-'+f.blowoutL+'</b></span>'+
            '<span><small>SCORING MARGIN</small><b>'+(margin>0?'+':'')+margin+'</b></span>'+
          '</div>'+
          '<footer><span>Carry: <b>'+esc(best?shortTeam(best.name):"—")+'</b></span><span>Weakest: <b>'+esc(worst?shortTeam(worst.name):"—")+'</b></span></footer>'+
        '</article>';
      }).join("");
    }

    const expectation=$("nerdExpectation");
    const pickValue=$("nerdPickValue");
    const portfolios=$("nerdPortfolios");
    const matrix=$("nerdRivalryMatrix");

    const teamValueRows=rows.flatMap(r=>r.teams.map(t=>{
      const played=t.w+t.l;
      const pace=played?82*(t.w/played):null;
      const line=Number.isFinite(t.line)?t.line:41;
      const delta=Number.isFinite(pace)?pace-line:null;
      return {...t,owner:r.name,played,pace,line,delta};
    }));
    const valuedTeams=teamValueRows.filter(t=>Number.isFinite(t.delta));

    if(expectation){
      if(!valuedTeams.length){
        expectation.innerHTML='<div class="comp-empty">Starts once regular-season results exist. No 0–0 team gets labelled a bust.</div>';
      }else{
        const overs=[...valuedTeams].sort((a,b)=>b.delta-a.delta).slice(0,3);
        const unders=[...valuedTeams].sort((a,b)=>a.delta-b.delta).slice(0,3);
        expectation.innerHTML=[
          ...overs.map((t,i)=>'<div class="nerd-list-row team-accent compact" style="'+teamStyle(t.name)+'"><div><strong>OVER #'+(i+1)+' · '+esc(shortTeam(t.name))+'</strong><small>'+esc(t.owner)+' · '+t.pace.toFixed(1)+' pace vs '+t.line.toFixed(1)+'</small></div><b>'+(t.delta>=0?'+':'')+t.delta.toFixed(1)+'</b></div>'),
          ...unders.map((t,i)=>'<div class="nerd-list-row team-accent compact negative" style="'+teamStyle(t.name)+'"><div><strong>UNDER #'+(i+1)+' · '+esc(shortTeam(t.name))+'</strong><small>'+esc(t.owner)+' · '+t.pace.toFixed(1)+' pace vs '+t.line.toFixed(1)+'</small></div><b>'+(t.delta>=0?'+':'')+t.delta.toFixed(1)+'</b></div>')
        ].join("");
      }
    }

    if(pickValue){
      if(!valuedTeams.length){
        pickValue.innerHTML='<div class="comp-empty">Draft value starts once regular-season results exist.</div>';
      }else{
        const best=[...valuedTeams].sort((a,b)=>b.delta-a.delta).slice(0,5);
        const worst=[...valuedTeams].sort((a,b)=>a.delta-b.delta).slice(0,5);
        pickValue.innerHTML=[
          ...best.map((t,i)=>'<div class="nerd-list-row team-accent" style="'+teamStyle(t.name)+'"><div><strong>STEAL #'+(i+1)+' · '+esc(shortTeam(t.name))+'</strong><small>'+esc(t.owner)+' · outperforming expectation</small></div><b>'+(t.delta>=0?'+':'')+t.delta.toFixed(1)+'</b></div>'),
          ...worst.map((t,i)=>'<div class="nerd-list-row team-accent negative" style="'+teamStyle(t.name)+'"><div><strong>BUST #'+(i+1)+' · '+esc(shortTeam(t.name))+'</strong><small>'+esc(t.owner)+' · below expectation</small></div><b>'+(t.delta>=0?'+':'')+t.delta.toFixed(1)+'</b></div>')
        ].join("");
      }
    }

    if(portfolios){
      portfolios.innerHTML=rows.map(r=>{
        const teams=teamValueRows.filter(t=>t.owner===r.name);
        const avgPct=teams.length?teams.reduce((s,t)=>s+pct(t.w,t.l),0)/teams.length:0;
        const over=teams.filter(t=>Number.isFinite(t.delta)&&t.delta>0).length;
        const above500=teams.filter(t=>t.played>0&&t.w>t.l).length;
        const best=[...teams].filter(t=>Number.isFinite(t.delta)).sort((a,b)=>b.delta-a.delta)[0];
        const dependency=r.w&&best?Math.round(best.w/r.w*100):0;
        const strips=teams.map(t=>'<i title="'+esc(t.name)+'" style="background:'+teamColors(t.name).primary+'"></i>').join("");
        return '<article class="nerd-portfolio">'+
          '<header><strong>'+esc(r.name)+'</strong><b>'+r.probability.toFixed(1)+'%</b></header>'+
          '<div class="nerd-team-strip">'+strips+'</div>'+
          '<div class="nerd-portfolio-metrics">'+
            '<span><small>AVG WIN %</small><b>'+Math.round(avgPct*100)+'%</b></span>'+
            '<span><small>ABOVE .500</small><b>'+above500+'/5</b></span>'+
            '<span><small>OVER LINE</small><b>'+over+'/'+teams.filter(t=>t.played>0).length+'</b></span>'+
            '<span><small>TOP-TEAM DEPENDENCY</small><b>'+dependency+'%</b></span>'+
          '</div>'+
          '<footer>Best value: <b>'+esc(best?shortTeam(best.name):"—")+'</b> '+(best?(best.delta>=0?'+':'')+best.delta.toFixed(1):'')+'</footer>'+
        '</article>';
      }).join("");
    }

    if(matrix){
      const names=rows.map(r=>r.name);
      const h2h=ownerHeadToHead(recent,180);
      const map={};
      h2h.forEach(x=>{map[x.a+"||"+x.b]=x});
      const cell=(a,b)=>{
        if(a===b)return '<td class="self">—</td>';
        const key=[a,b].sort().join("||"),x=map[key];
        if(!x)return '<td>0-0</td>';
        const aw=a===x.a?x.aw:x.bw,bw=a===x.a?x.bw:x.aw;
        const cls=aw>bw?"win":aw<bw?"loss":"tie";
        return '<td class="'+cls+'">'+aw+'-'+bw+'</td>';
      };
      matrix.innerHTML='<table class="nerd-matrix"><thead><tr><th>OWNER</th>'+names.map(n=>'<th>'+esc(n)+'</th>').join("")+'</tr></thead><tbody>'+
        names.map(a=>'<tr><th>'+esc(a)+'</th>'+names.map(b=>cell(a,b)).join("")+'</tr>').join("")+
      '</tbody></table>';
    }

    const rival=$("nerdRivalries");
    if(rival){
      const h2h=ownerHeadToHead(recent,120).sort((a,b)=>b.games-a.games||Math.abs(b.aw-b.bw)-Math.abs(a.aw-a.bw));
      rival.innerHTML=h2h.length?h2h.map(x=>
        '<div class="nerd-list-row"><div><strong>'+esc(x.a)+' vs '+esc(x.b)+'</strong><small>'+x.games+' recent direct games</small></div><b>'+x.aw+'-'+x.bw+'</b></div>'
      ).join(""):'<div class="comp-empty">No direct owner-v-owner results yet.</div>';
    }

    const impacts=$("nerdTeamImpact");
    if(impacts){
      const teams=rows.flatMap(r=>r.teams.map(t=>({...t,owner:r.name,pct:pct(t.w,t.l)})));
      const top=[...teams].sort((a,b)=>b.pct-a.pct||b.w-a.w).slice(0,5);
      const low=[...teams].filter(t=>t.w+t.l>0).sort((a,b)=>a.pct-b.pct||a.w-b.w).slice(0,3);
      impacts.innerHTML=[
        ...top.map((t,i)=>'<div class="nerd-list-row team-accent" style="'+teamStyle(t.name)+'"><div><strong>#'+(i+1)+' '+esc(shortTeam(t.name))+'</strong><small>'+esc(t.owner)+' · team impact leader</small></div><b>'+t.w+'-'+t.l+'</b></div>'),
        ...low.map(t=>'<div class="nerd-list-row team-accent negative" style="'+teamStyle(t.name)+'"><div><strong>'+esc(shortTeam(t.name))+'</strong><small>'+esc(t.owner)+' · lowest win rate</small></div><b>'+t.w+'-'+t.l+'</b></div>')
      ].join("");
    }

    const odd=$("nerdOddities");
    if(odd){
      const bits=competitionTidbits(rows,games,recent).filter(x=>!["LEADER","TODAY"].includes(x.tag)).slice(0,8);
      odd.innerHTML=bits.length?bits.map(x=>'<div class="nerd-oddity"><label>'+esc(x.tag)+'</label><p>'+esc(x.text)+'</p></div>').join(""):'<div class="comp-empty">Not enough chaos yet.</div>';
    }

    const nerdTicker=[];
    const bestValue=[...valuedTeams].sort((a,b)=>b.delta-a.delta)[0];
    const worstValue=[...valuedTeams].sort((a,b)=>a.delta-b.delta)[0];
    const rivalryTop=ownerHeadToHead(recent,180).sort((a,b)=>b.games-a.games)[0];
    if(bestValue)nerdTicker.push({tag:"BIGGEST OVER",text:shortTeam(bestValue.name)+" ("+bestValue.owner+") is "+(bestValue.delta>=0?"+":"")+bestValue.delta.toFixed(1)+" wins vs preseason pace.",kind:"draft"});
    if(worstValue)nerdTicker.push({tag:"BIGGEST UNDER",text:shortTeam(worstValue.name)+" ("+worstValue.owner+") is "+worstValue.delta.toFixed(1)+" wins vs preseason pace.",kind:"alert"});
    if(rivalryTop)nerdTicker.push({tag:"RIVALRY",text:rivalryTop.a+" vs "+rivalryTop.b+" is "+rivalryTop.aw+"-"+rivalryTop.bw+" across "+rivalryTop.games+" recent direct games.",kind:"team"});
    rows.slice(0,3).forEach((r,i)=>nerdTicker.push({tag:"TITLE #"+(i+1),text:r.name+" "+r.probability.toFixed(1)+"% title chance · "+r.w+"-"+r.l+" actual.",kind:"draft"}));
    window.cvNerdTicker=nerdTicker;
    if(document.querySelector(".screen.active")?.id==="statsForNerdsScreen"){
      setTicker(nerdTicker.length?nerdTicker:[{tag:"NERD ALERT",text:"Deep cuts, rivalry records and unnecessary specificity.",kind:"draft"}],"STATS FOR NERDS");
    }

    const history=$("nerdHistory");
    if(history){
      const snaps=(state.competitionSnapshots||[]).filter(s=>!!s.demo===!!demo).sort((a,b)=>String(a.key).localeCompare(String(b.key)));
      if(snaps.length<2){
        history.innerHTML='<div class="comp-empty">History starts now. CourtVision will save one snapshot per Sydney day so movement, highs and collapses become available automatically.</div>';
      }else{
        const first=snaps[0],last=snaps[snaps.length-1],items=[];
        for(const r of last.rows||[]){
          const old=(first.rows||[]).find(x=>x.name===r.name);if(!old)continue;
          const rankMove=old.rank-r.rank,probMove=r.probability-old.probability;
          items.push({score:Math.abs(rankMove)*3+Math.abs(probMove),text:r.name+" moved "+(rankMove===0?"0 places":(rankMove>0?"up ":"down ")+Math.abs(rankMove)+" place"+(Math.abs(rankMove)===1?"":"s"))+" since "+first.key+"; title probability "+(probMove>=0?"+":"")+probMove.toFixed(1)+" pts."});
        }
        history.innerHTML=items.sort((a,b)=>b.score-a.score).slice(0,8).map(x=>'<div class="nerd-history-row">'+esc(x.text)+'</div>').join("");
      }
    }
  }

  async function refreshStatsForNerds(force=false){
    const status=$("nerdStatus");if(status)status.textContent="Crunching the nerd stuff…";
    try{
      const data=await getCompetitionData(force);
      await loadSeasonMemory(force);
      const rows=calculateProbabilities(ownerSummaries(data.records||{}));
      saveCompetitionSnapshot(rows,data.demo);
      renderStatsForNerds(rows,data.games||[],data.recent||[],data.demo);
      renderMovement(rows,data.demo);
    }catch(e){
      console.warn("Stats for Nerds failed",e);
      if(status)status.textContent="Stats unavailable · try Refresh";
    }
  }
  window.refreshStatsForNerds=refreshStatsForNerds;

  function openStatsForNerds(){
    showScreenLocal("statsForNerdsScreen");
    ensureAutoUpdate();
    refreshStatsForNerds(false);
  }
  window.openStatsForNerds=openStatsForNerds;

  function previewTeamFromCompetition(name){
    openTeamFromHub(name);
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


  const teamDetailCache=new Map();
  async function teamDetailFeed(key,kind){
    const cacheKey=key+":"+kind,old=teamDetailCache.get(cacheKey);
    if(old&&Date.now()-old.at<120000)return old.promise;
    const direct=kind==="injuries"?"https://site.api.espn.com/apis/site/v2/sports/basketball/nba/injuries":
      "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/"+encodeURIComponent(key)+"/"+kind+"?season="+SEASON_YEAR;
    const promise=fetchNbaJson("/api/nba/team-detail?team="+encodeURIComponent(key)+"&kind="+kind,direct,8000);
    teamDetailCache.set(cacheKey,{at:Date.now(),promise});
    try{return await promise}catch(e){teamDetailCache.delete(cacheKey);throw e}
  }


  function seasonJourney(name,games){
    const finals=games.filter(g=>g.status==="FINAL").sort((a,b)=>a.date-b.date);
    if(!finals.length)return '<p class="team-chart-empty">The story starts at opening tip. Wins and projected pace will appear here after the first regular-season result.</p>';
    const line=winLineFor(name),hasLine=line!==null;
    let wins=0;const points=[{n:0,w:0}];finals.forEach((g,i)=>{if(g.home===name?g.homeWinner:g.awayWinner)wins++;points.push({n:i+1,w:wins})});
    const maxX=Math.max(10,finals.length),maxY=Math.max(5,Math.ceil(Math.max(wins,hasLine?line/82*maxX:0)/5)*5);
    const x=n=>48+n/maxX*440,y=w=>210-w/maxY*175;
    const actual=points.map(p=>x(p.n)+","+y(p.w)).join(" ");
    let svg='<svg viewBox="0 0 520 260" role="img" aria-label="'+esc(finals.length+' games, '+wins+' wins. '+(hasLine?'Compared with preseason projected pace.':''))+'">';
    for(let i=0;i<=2;i++){const v=maxY*i/2;svg+='<line x1="48" y1="'+y(v)+'" x2="488" y2="'+y(v)+'" class="chart-grid"/><text x="38" y="'+(y(v)+4)+'" text-anchor="end">'+v+'</text>';}
    svg+='<text x="48" y="240">0</text><text x="488" y="240" text-anchor="end">'+maxX+' games</text><text x="48" y="22">Cumulative wins</text>';
    if(hasLine)svg+='<line x1="48" y1="210" x2="488" y2="'+y(line/82*maxX)+'" class="chart-pace"/>';
    svg+='<polyline points="'+actual+'" class="chart-actual"/><circle cx="'+x(finals.length)+'" cy="'+y(wins)+'" r="4" class="chart-dot"/></svg>';
    return '<p class="team-chart-summary">'+wins+' wins from '+finals.length+' games'+(hasLine?' · '+(wins-line/82*finals.length>=0?'+':'')+(wins-line/82*finals.length).toFixed(1)+' vs projected pace':'')+'</p><div class="team-chart-legend"><span>● Actual wins</span>'+(hasLine?'<span>┄ Preseason pace ('+line+' / 82)</span>':'')+'</div>'+svg;
  }

  function ownerContribution(name,records,sample=false){
    const owner=teamOwner(name),player=state.players.find(p=>p.name===owner);
    if(!player)return '<p class="team-chart-empty">This team is unassigned. Its contribution will appear once it has an owner.</p>';
    const rows=(player.teams||[]).map(team=>({team,w:records[team]?.w}));
    if(rows.some(r=>!Number.isFinite(r.w)))return '<p class="team-chart-empty">Complete owner standings are not available yet. No contribution is estimated from missing records.</p>';
    const total=rows.reduce((n,r)=>n+r.w,0),mine=rows.find(r=>r.team===name)?.w||0,max=Math.max(1,...rows.map(r=>r.w));
    return '<p class="team-chart-summary">'+esc(owner)+' · '+(total?mine+' of '+total+' wins ('+Math.round(mine/total*100)+'%)':'No regular-season wins yet')+'</p><div class="team-owner-bars">'+rows.sort((a,b)=>b.w-a.w).map(r=>'<div class="team-owner-bar '+(r.team===name?'selected':'')+'" style="'+teamStyle(r.team)+'"><img src="'+teamLogo(r.team)+'" alt=""><span>'+esc(shortTeam(r.team))+'</span><div><i style="width:'+(r.w/max*100)+'%"></i></div><b>'+r.w+' W</b></div>').join("")+'</div>';
  }

  function playerChartRows(data,name){
    const totals=new Map();
    for(const summary of data){
      const team=(summary?.boxscore?.players||[]).find(x=>teamNameFromEspn(x.team)===name);
      const group=team?.statistics?.find(x=>x.labels?.includes("PTS"));
      if(!group)continue;
      for(const row of group.athletes||[]){
        if(row.didNotPlay||!Array.isArray(row.stats))continue;
        const number=k=>{const index=group.labels.indexOf(k);return index>=0?parseFloat(row.stats[index]):NaN};
        if(!["PTS","REB","AST"].every(k=>Number.isFinite(number(k))))continue;
        const id=String(row.athlete?.id||row.athlete?.displayName||"");
        if(!id)continue;
        const p=totals.get(id)||{name:row.athlete?.displayName||"Player",photo:row.athlete?.headshot?.href||"",pts:0,reb:0,ast:0,gp:0};
        p.pts+=number("PTS");p.reb+=number("REB");p.ast+=number("AST");p.gp++;totals.set(id,p);
      }
    }
    return [...totals.values()].map(p=>({...p,pts:p.pts/p.gp,reb:p.reb/p.gp,ast:p.ast/p.gp}));
  }

  function playerLeaderBars(rows,metric){
    const leaders=[...rows].sort((a,b)=>b[metric]-a[metric]).slice(0,5),max=Math.max(1,...leaders.map(p=>p[metric]));
    if(!leaders.length)return '<p class="team-chart-empty">Player leaders will appear when complete regular-season box scores are available.</p>';
    return leaders.map(p=>'<div class="team-player-bar">'+(/^https:\/\//i.test(p.photo)?'<img src="'+esc(p.photo)+'" alt="" onerror="this.remove()">':'<span class="team-player-initial">'+esc(p.name.charAt(0))+'</span>')+'<div><strong>'+esc(p.name)+'</strong><small>'+p.gp+' appearance'+(p.gp===1?'':'s')+' in this window</small><div class="team-player-track"><i style="width:'+(p[metric]/max*100)+'%"></i></div></div><b>'+p[metric].toFixed(1)+'</b></div>').join("");
  }

  async function mountTeamCharts(name,detail,games,roster,scheduleOk){
    const host=detail.querySelector(".team-charts");if(!host)return;
    let sample=false,metric="pts",livePlayers=[],liveRecords=null,playerNote="Loading recent box scores…";
    const finals=games.filter(g=>g.status==="FINAL").sort((a,b)=>b.date-a.date).slice(0,5);
    const active=()=>detail.isConnected&&!detail.hidden&&detail.dataset.team===name&&detail.querySelector(".team-charts")===host;
    function render(){
      if(!active())return;
      let chartGames=games,players=livePlayers,records=liveRecords;
      if(sample){
        chartGames=Array.from({length:24},(_,i)=>({status:"FINAL",date:new Date(2026,10,i+1),home:name,homeWinner:i%3!==0,awayWinner:i%3===0}));
        players=(roster.length?roster.slice(0,5):[{name:"Sample player A"},{name:"Sample player B"},{name:"Sample player C"}]).map((p,i)=>({name:p.name,photo:p.headshot||"",gp:5,pts:27-i*3.6,reb:9-i*.9,ast:7-i*.8}));
        records=Object.fromEntries(TEAM_DATA.map((t,i)=>[t[0],{w:10+i%9}]));
      }
      host.innerHTML='<div class="team-charts-top"><div><span class="team-section-label">THE NUMBERS BEHIND THE TEAM</span><h3>A closer look</h3><p>'+(sample?'SAMPLE CHARTS · Fictional results and statistics.':'2026–27 regular season · ESPN results and box scores.')+'</p></div></div>'+
        '<div class="team-charts-grid"><section class="team-journey"><h4>Season journey</h4>'+(sample||scheduleOk?seasonJourney(name,chartGames):'<p class="team-chart-empty">Schedule unavailable. Try reopening this team later.</p>')+'</section>'+
        '<section class="team-player-leaders"><h4>Who’s delivering?</h4><p class="team-chart-caption">'+(sample?'Sample per-game averages':esc(playerNote))+'</p><div class="team-metric-tabs" role="group" aria-label="Player statistic">'+[["pts","Points"],["reb","Rebounds"],["ast","Assists"]].map(([key,label])=>'<button type="button" data-metric="'+key+'" aria-pressed="'+(metric===key)+'">'+label+'</button>').join("")+'</div><div class="team-player-bars">'+playerLeaderBars(players,metric)+'</div></section>'+
        '<section class="team-contribution"><h4>Your owner’s wins</h4>'+(records?ownerContribution(name,records,sample):'<p class="team-chart-empty">Loading owner standings…</p>')+'</section></div>';
      host.querySelectorAll("[data-metric]").forEach(b=>b.addEventListener("click",()=>{metric=b.dataset.metric;render()}));
    }
    render();
    const standings=async()=>{if(!regularSeasonStarted())return Object.fromEntries(TEAM_DATA.map(t=>[t[0],{w:0,l:0}]));if(cache.records)return cache.records;const data=await fetchNbaJson("/api/nba/standings?season="+SEASON_YEAR,"https://site.api.espn.com/apis/v2/sports/basketball/nba/standings?season="+SEASON_YEAR,8000);return parseStandings(data)};
    void standings().then(records=>{liveRecords=records;render()}).catch(()=>{liveRecords={};render()});
    if(!finals.length){playerNote="Per-game averages · last five team games · no results yet";render();return}
    const results=await Promise.allSettled(finals.map(g=>fetchNbaJson("/api/nba/summary?event="+encodeURIComponent(g.id),"https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event="+encodeURIComponent(g.id),8000)));
    const data=results.filter(r=>r.status==="fulfilled").map(r=>r.value).filter(summary=>(summary?.boxscore?.players||[]).some(t=>teamNameFromEspn(t.team)===name&&t.statistics?.some(group=>group.labels?.includes("PTS")&&group.athletes?.length)));
    livePlayers=playerChartRows(data,name);
    playerNote="Per-game averages · last "+finals.length+" team games"+(data.length<finals.length?" · partial coverage ("+data.length+" box scores)":"")+" · ESPN";
    render();
  }

  async function renderTeamDetail(name,detail){
    const team=teamMeta(name);if(!team)return;
    const key=typeof espnTeamKey==="function"?espnTeamKey(team[1]):String(team[1]).toLowerCase();
    const results=await Promise.allSettled(["roster","injuries","schedule"].map(kind=>teamDetailFeed(key,kind)));
    if(!detail.isConnected||detail.dataset.team!==name||detail.hidden)return;
    const target=detail.querySelector(".team-detail-content");if(!target)return;
    const [rosterResult,injuryResult,scheduleResult]=results;
    const rosterData=rosterResult.status==="fulfilled"?rosterResult.value:null;
    const athletes=[];
    const walk=items=>{for(const p of items||[]){if(p.items)walk(p.items);else if(p.displayName)athletes.push(p)}};
    walk(rosterData?.athletes);
    const roster=athletes.map(p=>({id:p.id,name:p.displayName,position:p.position?.abbreviation||"—",jersey:p.jersey||"—",headshot:p.headshot?.href||""}));
    const cached=state.liveRosters?.[name]||[];
    const shown=roster.length?roster:cached;
    const photo=p=>{const raw=p.headshot||(p.id?'https://a.espncdn.com/i/headshots/nba/players/full/'+encodeURIComponent(p.id)+'.png':'');return /^https:\/\//i.test(raw)?raw:"";};
    const initials=p=>String(p.name||"?").split(/\s+/).map(x=>x[0]).slice(0,2).join("");
    const portraits=shown.slice(0,5).map(p=>'<div class="team-hero-player"><span>'+esc(initials(p))+'</span>'+(photo(p)?'<img src="'+esc(photo(p))+'" alt="'+esc(p.name)+'" onerror="this.remove()">':'')+'<small>'+esc(p.name)+'</small></div>').join("");
    const hero=detail.querySelector(".team-hero-lineup");if(hero)hero.innerHTML=portraits;
    let html='<section class="team-roster-section" id="team-squad"><span class="team-section-label">THE PEOPLE IN THE JERSEY</span><h3>Meet the squad</h3><p class="team-detail-source">'+(roster.length?'ESPN · current roster':cached.length?'Cached roster · '+esc(state.liveSyncAt?daySydney(new Date(state.liveSyncAt)):'last sync unknown'):'Roster unavailable · try again later')+'</p>';
    if(shown.length)html+='<div class="team-roster-grid">'+shown.map(p=>'<article class="team-player-card"><div class="team-player-photo"><span>'+esc(initials(p))+'</span>'+(photo(p)?'<img src="'+esc(photo(p))+'" alt="'+esc(p.name)+'" loading="lazy" onerror="this.remove()">':'')+'</div><div><strong>'+esc(p.name)+'</strong><small>'+esc(p.position||"—")+' · #'+esc(p.jersey||"—")+'</small></div></article>').join("")+'</div>';
    html+='</section><section class="team-health-section" id="team-availability"><span class="team-section-label">WHO’S AVAILABLE?</span><h3>The injury room</h3>';
    if(injuryResult.status==="fulfilled"){
      const entry=(injuryResult.value.injuries||[]).find(t=>teamNameFromEspn(t)===name);
      const injuries=entry?.injuries||[];
      html+='<p class="team-detail-source">ESPN · latest available report</p>';
      html+=injuries.length?injuries.map(x=>'<article class="team-injury"><strong>'+esc(x.athlete?.displayName||"Player")+' · '+esc(x.status||"Status pending")+'</strong><p>'+esc(x.shortComment||x.longComment||"No additional detail.")+'</p>'+(x.date?'<small>Reported '+esc(daySydney(new Date(x.date)))+'</small>':'')+'</article>').join(''):'<p>No injuries listed by ESPN. Availability can change before tip-off.</p>';
    }else html+='<p>Injury report unavailable · try again later.</p>';
    html+='</section>';
    if(scheduleResult.status==="fulfilled"){
      const games=parseScoreboard(scheduleResult.value).filter(g=>g.home===name||g.away===name);
      const recent=games.filter(g=>g.status==="FINAL").sort((a,b)=>b.date-a.date).slice(0,5);
      const upcoming=games.filter(g=>g.status!=="FINAL"&&g.date>=new Date(Date.now()-6*3600000)).sort((a,b)=>a.date-b.date).slice(0,5);
      const won=g=>g.home===name?g.homeWinner:g.awayWinner;
      const wins=recent.filter(won).length;
      html+='<section class="team-form-section" id="team-form"><span class="team-section-label">THE LAST FIVE</span><h3>How they’re travelling</h3><p class="team-detail-source">'+(recent.length?'Last '+recent.length+' regular-season games · '+wins+'W–'+(recent.length-wins)+'L':'No completed regular-season games yet.')+'</p>';
      html+=recent.length?'<div class="team-form-strip">'+recent.map(g=>'<span class="'+(won(g)?'is-win':'is-loss')+'">'+(won(g)?'W':'L')+'</span>').join("")+'</div><div class="team-fixtures">'+recent.map(g=>{const opponent=g.home===name?g.away:g.home;return '<article style="'+teamStyle(opponent)+'"><img src="'+teamLogo(opponent)+'" alt=""><div><strong>'+esc(shortTeam(opponent))+'</strong><small>'+esc(daySydney(g.date))+'</small></div><b>'+(won(g)?'W ':'L ')+(g.home===name?g.homeScore+'–'+g.awayScore:g.awayScore+'–'+g.homeScore)+'</b>'+gameHighlightsLink(g)+'</article>';}).join("")+'</div>':'';
      html+='</section><section class="team-next-section" id="team-fixtures"><span class="team-section-label">MARK YOUR CALENDAR</span><h3>Up next</h3>';
      html+=upcoming.length?'<div class="team-fixtures">'+upcoming.map(g=>{const opponent=g.home===name?g.away:g.home;return '<article><img src="'+teamLogo(opponent)+'" alt=""><div><strong>'+(g.home===name?'vs ':'@ ')+esc(shortTeam(opponent))+'</strong><small>'+esc(daySydney(g.date))+' · Sydney</small></div><b>'+esc(g.status==="IN"?'LIVE':timeSydney(g.date))+'</b></article>';}).join("")+'</div>':'<p>No upcoming regular-season games listed.</p>';
      html+='</section>';
    }else html+='<section class="team-form-section" id="team-form"><h3>Recent form</h3><p>Results unavailable · try again later.</p></section><section class="team-next-section" id="team-fixtures"><h3>Up next</h3><p>Schedule unavailable · try again later.</p></section>';
    target.innerHTML='<section class="team-charts" id="team-statistics" aria-label="Team statistics"></section>'+html;
    const chartGames=scheduleResult.status==="fulfilled"?parseScoreboard(scheduleResult.value).filter(g=>g.home===name||g.away===name):[];
    void mountTeamCharts(name,detail,chartGames,shown,scheduleResult.status==="fulfilled");
  }

  async function getCompetitionData(force=false){
    const demo=isTestDraft();
    if(demo)return demoCompetitionData();
    if(!force&&cache.records&&cache.dayKey===sydneyKey()&&Date.now()-cache.at<CACHE_MS)return cache;
    const [records,score]=await Promise.all([fetchRecords(force),fetchScoreboards()]);
    cache={at:Date.now(),dayKey:sydneyKey(),records,games:score.games,tomorrow:score.tomorrow,recent:score.recent,demo:false};
    return cache;
  }


  let competitionTickerRows=[];
  function competitionTickerItems(rows,games=[],recent=[],demo=false){
    const items=[],add=(tag,text,kind="team")=>items.push({tag,text,kind});
    const cleanRecent=recent.filter(g=>!teamOwner(g.home)||teamOwner(g.home)!==teamOwner(g.away));
    const bits=competitionTidbits(rows,games,cleanRecent).filter(x=>!["LEADER","TIGHT RACE","BUSY NIGHT","RIVALRY"].includes(x.tag));
    const priority={IN:0,FINAL:1,SCHEDULED:2};
    for(const g of [...games].filter(g=>teamOwner(g.home)||teamOwner(g.away)).sort((a,b)=>(priority[a.status]??3)-(priority[b.status]??3)).slice(0,6)){
      const away=teamOwner(g.away),home=teamOwner(g.home);if(!away&&!home)continue;
      const match=shortTeam(g.away)+" vs "+shortTeam(g.home);
      if(away&&home&&away===home){
        add("ALL IN-HOUSE",away+" owns both sides of "+match+". One win and one loss stay in the same portfolio.");
      }else if(g.status==="IN"){
        add("LIVE",match+": "+g.awayScore+"–"+g.homeScore+" · "+(g.detail||"in progress")+". "+(away||"Unowned")+" vs "+(home||"Unowned")+".");
      }else if(g.status==="FINAL"){
        const winner=g.homeWinner?g.home:g.awayWinner?g.away:null;
        if(winner){const owner=teamOwner(winner);add("FINAL",shortTeam(winner)+" won "+g.awayScore+"–"+g.homeScore+" ("+shortTeam(g.away)+"–"+shortTeam(g.home)+"). "+(owner?owner+" banks a win.":"The winner is unowned."));}
      }else add("OWNER MATCHUP",(away||"Unowned")+" vs "+(home||"Unowned")+": "+match+" tips off at "+timeSydney(g.date)+" Sydney time.");
    }
    const played=rows.some(r=>r.w+r.l>0);
    if(played){
      const ranked=[...rows].sort((a,b)=>b.winPct-a.winPct||b.w-a.w||b.projected-a.projected),lead=ranked[0],second=ranked[1];
      if(lead&&second){const gap=lead.winPct-second.winPct;add("THE CHASE",gap?lead.name+" leads "+second.name+" by "+gap.toFixed(1)+" percentage points in live winning percentage.":lead.name+" and "+second.name+" are level at "+lead.winPct.toFixed(1)+"%.","draft");}
    }else{
      const projected=[...rows].sort((a,b)=>b.probability-a.probability);
      if(projected[0])add("PRESEASON PICK",projected[0].name+" has the highest projected title chance at "+projected[0].probability.toFixed(1)+"%. No regular-season wins are on the board yet.","draft");
      for(const row of rows.slice(0,3)){
        const best=[...(row.teams||[])].filter(t=>Number.isFinite(t.line)).sort((a,b)=>b.line-a.line)[0];
        if(best)add("ONE TO WATCH",shortTeam(best.name)+" is "+row.name+"'s highest preseason win projection at "+best.line+" wins.","draft");
      }
    }
    for(const x of bits)add(x.tag,x.text,["COLD","ROUGH DAY","PAIN","WEAK LINK"].includes(x.tag)?"alert":"draft");
    if(!items.length)add("COMPETITION","Owner matchups, team form and results will appear here as competition data arrives.","draft");
    const unique=[...new Map(items.map(x=>[x.tag+"|"+x.text,x])).values()].slice(0,12);
    return demo?unique.map(x=>({...x,tag:"SAMPLE · "+x.tag})):unique;
  }
  function updateCompetitionTicker(rows,games,recent,demo=false){
    competitionTickerRows=rows;
    window.cvNerdStudio?.renderCompetitionBrief(rows,recent,demo);
    window.cvCompetitionTicker=competitionTickerItems(rows,games,recent,demo);
    if(document.querySelector(".screen.active")?.id==="competitionScreen")setTicker(window.cvCompetitionTicker,"COMP BOARD");
  }

  async function refreshCompetitionBoard(force=false){
    const token=++refreshToken;
    const status=$("competitionDataStatus");
    if(status)status.textContent="Refreshing NBA records and Sydney slate…";
    try{
      const data=await getCompetitionData(force);if(token!==refreshToken)return;
      await loadSeasonMemory(force);if(token!==refreshToken)return;
      // Clear projection-only competition snapshot history at the opening tip.
      state.competitionSnapshots=(state.competitionSnapshots||[]).filter(x=>x && (!regularSeasonStarted()||x.key>=REGULAR_SEASON_KEY));
      let rows=calculateProbabilities(ownerSummaries(data.records||{}));
      saveCompetitionSnapshot(rows,data.demo);
      renderLeaderboard(rows,data.demo,data.games||[]);
      renderGames(data.games||[],data.records||{});
      if(force&&selectedSlateKey()!==sydneyKey())void loadDateSlate(selectedSlateKey(),true);
      updateCompetitionTicker(rows,data.games||[],data.recent||[],data.demo);
      const stamp=$("competitionUpdated");
      if(stamp)stamp.textContent=(data.demo?"DEMO · ":regularSeasonStarted()?"UPDATED ":"PRESEASON PROJECTION · ")+new Intl.DateTimeFormat("en-AU",{timeZone:TZ,day:"numeric",month:"short",hour:"numeric",minute:"2-digit"}).format(new Date());
      if(status)status.textContent=data.demo?"Test draft · seeded competition results for troubleshooting":regularSeasonStarted()?"Regular-season NBA results · auto-checking every 2 minutes":"2026–27 SEASON PROJECTIONS · reset at opening tip, then live records take over";
    }catch(e){
      console.warn("Competition refresh failed",e);
      if(status)status.textContent="Live competition data unavailable · try Refresh";
    }
  }

  function openCompetitionBoard(){
    showScreenLocal("competitionScreen");
    ensureAutoUpdate();
    refreshCompetitionBoard(false);
  }
  window.openCompetitionBoard=openCompetitionBoard;
  window.refreshCompetitionBoard=refreshCompetitionBoard;

  // Extend the existing ticker router without changing the draft ticker behavior.
  const baseTicker=window.updateTickerForScreen||updateTickerForScreen;
  window.updateTickerForScreen=function(id){
    if(id==="competitionScreen"){
      setTicker(window.cvCompetitionTicker?.length?window.cvCompetitionTicker:[{tag:"COMPETITION",text:"Daily rivalry board",kind:"draft"}],"COMP BOARD");
      return;
    }
    if(id==="ownerPortfolioScreen"){
      setTicker([{tag:"PORTFOLIO",text:(ownerPortfolioName||"Owner")+" · live records, form and schedule.",kind:"draft"}],"PORTFOLIO");
      return;
    }
    if(id==="tradeScreen"){
      setTicker([{tag:"TRADE DESK",text:"Propose a one-for-one team swap. Historical wins stay with the owner who earned them.",kind:"draft"}],"TRADE DESK");
      return;
    }
    if(id==="statsForNerdsScreen"){
      setTicker(window.cvNerdTicker?.length?window.cvNerdTicker:[{tag:"NERD ALERT",text:"Deep cuts, rivalry records and unnecessary specificity.",kind:"draft"}],"STATS FOR NERDS");
      return;
    }
    return baseTicker(id);
  };

  async function competitionHealth(){
    let server=null;
    try{
      const r=await fetch("/api/health",{cache:"no-store"});
      if(r.ok)server=await r.json();
    }catch(_){}
    return {
      server,
      activeScreen:document.querySelector(".screen.active")?.id||null,
      dataCacheAgeMs:cache.at?Math.max(0,Date.now()-cache.at):null,
      recordsLoaded:Object.keys(cache.records||{}).length,
      todayGames:(cache.games||[]).length,
      recentFinals:(cache.recent||[]).length,
      snapshots:(state.competitionSnapshots||[]).length,
      rawSeasonSnapshots:seasonMemoryRaw.length,
      seasonMemoryLoadedAt:seasonMemoryLoadedAt||null,
      autoUpdateEveryMs:AUTO_UPDATE_MS,
      autoUpdateRunning
    };
  }

  // Expose lightweight diagnostics for QA/support without adding UI clutter.
  // Activate the post-draft landing dashboard on first load.
  if(document.querySelector(".screen.active")?.id==="competitionScreen"){
    ensureAutoUpdate();
    void refreshCompetitionBoard(false);
  }

  window.cvCompetition={
    demoCompetitionData,
    renderTeamDetail,
    gameWinChance,
    loadGameSummary,
    chooseSlate,
    nextSydneyKey,
    shiftDateKey,
    ownerSummaries,
    calculateProbabilities,
    competitionTidbits,
    records:()=>JSON.parse(JSON.stringify(cache.records||{})),
    executeTrade,
    ensureTradeLedger,
    competitionTickerItems,
    health:competitionHealth,
    refresh:refreshCompetitionBoard
  };
})();