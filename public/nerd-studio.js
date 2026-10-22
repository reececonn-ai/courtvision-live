
/* Stats for Nerds: owner comparisons, title history and team performance. */
(()=>{
  const esc=v=>String(v??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
  const palette=["#63c8ff","#f2bb63","#b49bff","#77d8b6","#f18ba3","#c9d878"];
  let latest=null,classic=false;
  const colour=(name,rows)=>palette[Math.max(0,[...rows].map(r=>r.name).sort().indexOf(name))%palette.length];
  function formFor(name,recent){
    const teams=new Set(latest.rows.find(r=>r.name===name)?.teams.map(t=>t.name)||[]);
    const results=[];
    for(const g of [...recent].filter(g=>g.status==="FINAL").sort((a,b)=>b.date-a.date)){
      for(const side of ["home","away"]){if(teams.has(g[side]))results.push({won:g[side+"Winner"],margin:g[side+"Score"]-g[(side==="home"?"away":"home")+"Score"]});}
      if(results.length>=10)break;
    }
    const ten=results.slice(0,10);return {w:ten.filter(x=>x.won).length,l:ten.filter(x=>!x.won).length,n:ten.length,margin:ten.reduce((n,x)=>n+x.margin,0)};
  }
  function currentRace(rows){
    const max=Math.max(1,...rows.map(r=>r.probability));
    return '<div class="ns-current">'+[...rows].sort((a,b)=>b.probability-a.probability).map(r=>'<div class="ns-owner-bar"><strong>'+esc(r.name)+'</strong><div><i style="width:'+r.probability/max*100+'%;background:'+colour(r.name,rows)+'"></i></div><b>'+r.probability.toFixed(1)+'%</b></div>').join("")+'</div>';
  }
  function historyChart(rows,demo,width){
    const snapshots=(state.competitionSnapshots||[]).filter(s=>!!s.demo===!!demo&&Array.isArray(s.rows)&&s.rows.length&&s.key&&(!rows.some(r=>r.w+r.l>0)||s.key>="2026-10-21")).sort((a,b)=>String(a.key).localeCompare(String(b.key))).slice(-45);
    if(snapshots.length<2)return '<p class="ns-note">The title-chance trend will appear after two saved Sydney days. Your current chances are shown in the comparison above.</p>';
    const w=Math.max(320,width),left=44,right=w-18,top=28,bottom=235;
    const x=i=>left+i/(snapshots.length-1)*(right-left),y=p=>bottom-p/100*(bottom-top);
    let svg='<svg viewBox="0 0 '+w+' 280" role="img" aria-label="Projected title chances across '+snapshots.length+' saved Sydney days"><text x="'+left+'" y="16">Title chance (%)</text>';
    for(const p of [0,25,50,75,100])svg+='<line class="ns-gridline" x1="'+left+'" y1="'+y(p)+'" x2="'+right+'" y2="'+y(p)+'"/><text x="'+(left-9)+'" y="'+(y(p)+4)+'" text-anchor="end">'+p+'</text>';
    for(const r of rows){
      let segments=[],segment=[];
      snapshots.forEach((snap,i)=>{const point=snap.rows.find(p=>p.name===r.name);if(point&&Number.isFinite(point.probability))segment.push(x(i)+","+y(point.probability));else if(segment.length){segments.push(segment);segment=[]}});
      if(segment.length)segments.push(segment);
      for(const points of segments)svg+='<polyline fill="none" stroke="'+colour(r.name,rows)+'" stroke-width="2.5" points="'+points.join(" ")+'"><title>'+esc(r.name)+'</title></polyline>';
    }
    const ticks=[...new Set([0,Math.round((snapshots.length-1)/2),snapshots.length-1])];
    for(const i of ticks)svg+='<text x="'+x(i)+'" y="260" text-anchor="'+(i===0?'start':i===snapshots.length-1?'end':'middle')+'">'+esc(snapshots[i].key.slice(5))+'</text>';
    return '<div class="ns-legend">'+rows.map(r=>'<span><i style="background:'+colour(r.name,rows)+'"></i>'+esc(r.name)+'</span>').join("")+'</div>'+svg+'</svg><p class="ns-note">Sydney day (MM-DD) · simulated title chances, not betting odds. Missing owner observations are left as gaps.</p>';
  }

  const plus=n=>(n>0?"+":"")+n.toFixed(1);
  function teamNumbers(rows,recent){
    const finals=[...recent].filter(g=>g.status==="FINAL"&&(g.homeWinner||g.awayWinner)).sort((a,b)=>new Date(b.date)-new Date(a.date));
    return rows.flatMap(r=>r.teams.map(t=>{
      const seen=new Set(),games=finals.filter(g=>{
        if(g.home!==t.name&&g.away!==t.name)return false;
        const key=g.id||[g.date,g.home,g.away].join("|");if(seen.has(key))return false;seen.add(key);return true;
      }).map(g=>{const h=g.home===t.name;return {won:!!g[h?"homeWinner":"awayWinner"],pf:Number(g[h?"homeScore":"awayScore"]),pa:Number(g[h?"awayScore":"homeScore"])}});
      const scored=games.filter(g=>Number.isFinite(g.pf)&&Number.isFinite(g.pa)),last=games.slice(0,5),played=t.w+t.l;
      return {...t,owner:r.name,played,delta:played&&Number.isFinite(t.line)?t.w-played*t.line/82:null,form:last.filter(g=>g.won).length,formN:last.length,n:games.length,scoredN:scored.length,pf:scored.length?scored.reduce((n,g)=>n+g.pf,0)/scored.length:null,pa:scored.length?scored.reduce((n,g)=>n+g.pa,0)/scored.length:null,margin:scored.length?scored.reduce((n,g)=>n+g.pf-g.pa,0)/scored.length:null,close:scored.filter(g=>Math.abs(g.pf-g.pa)<=5),blowouts:scored.filter(g=>g.pf-g.pa>=15).length};
    }));
  }
  function dailyInsights(rows,recent,demo){
    const teams=teamNumbers(rows,recent),eligible=teams.filter(t=>t.delta!==null),items=[];
    const high=[...eligible].sort((a,b)=>b.delta-a.delta)[0],low=[...eligible].sort((a,b)=>a.delta-b.delta)[0];
    if(high&&high.delta>=.05)items.push(['BEATING THE LINE',high.name,plus(high.delta)+' wins above preseason pace through '+high.played+' games. '+high.owner+' gets the lift.']);
    if(low&&low.delta<=-.05)items.push(['BELOW EXPECTATIONS',low.name,Math.abs(low.delta).toFixed(1)+' wins below preseason pace through '+low.played+' games. Owned by '+low.owner+'.']);
    const hot=teams.filter(t=>t.formN>=3&&t.form/t.formN>=.6).sort((a,b)=>b.form/b.formN-a.form/a.formN||b.formN-a.formN)[0];
    if(hot)items.push(['FORM CHECK',hot.name,hot.form+'–'+(hot.formN-hot.form)+' in its last '+hot.formN+' available games.']);
    const key=new Date().toLocaleDateString("en-CA",{timeZone:"Australia/Sydney"});
    const previous=(state.competitionSnapshots||[]).filter(s=>!!s.demo===!!demo&&s.key<key&&Array.isArray(s.rows)).sort((a,b)=>String(b.key).localeCompare(String(a.key)))[0];
    const moves=rows.map(r=>({r,old:previous?.rows.find(p=>p.name===r.name)})).filter(x=>Number.isFinite(x.old?.probability)).map(x=>({...x,change:x.r.probability-x.old.probability})).sort((a,b)=>Math.abs(b.change)-Math.abs(a.change));
    if(moves[0]&&Math.abs(moves[0].change)>=.1)items.push(['RACE MOVER',moves[0].r.name,plus(moves[0].change)+' percentage points of title chance since '+previous.key+'.']);

    const scored=teams.filter(t=>t.scoredN>=2);
    const attack=[...scored].sort((a,b)=>b.pf-a.pf)[0];
    if(attack)items.push(['BUCKET GETTERS',attack.name,attack.pf.toFixed(1)+' points per game across '+attack.scoredN+' available scored games.']);
    const defense=[...scored].sort((a,b)=>a.pa-b.pa)[0];
    if(defense)items.push(['LOCKING IT DOWN',defense.name,defense.pa.toFixed(1)+' points allowed per game across '+defense.scoredN+' available scored games.']);
    const margin=[...scored].sort((a,b)=>b.margin-a.margin)[0];
    if(margin&&margin.margin>0)items.push(['WINNING WITH ROOM',margin.name,plus(margin.margin)+' average scoring margin across '+margin.scoredN+' available scored games.']);
    const close=teams.filter(t=>t.close.length>=2).map(t=>({...t,cw:t.close.filter(g=>g.won).length})).filter(t=>t.cw/t.close.length>=.6).sort((a,b)=>b.cw/b.close.length-a.cw/a.close.length||b.close.length-a.close.length)[0];
    if(close)items.push(['NAIL-BITERS',close.name,close.cw+'–'+(close.close.length-close.cw)+' in available games decided by five points or fewer. Final-score margin, not clutch-time stats.']);
    const cold=teams.filter(t=>t.formN>=3&&t.form/t.formN<=.4).sort((a,b)=>a.form/a.formN-b.form/b.formN||b.formN-a.formN)[0];
    if(cold)items.push(['NEEDS A RESPONSE',cold.name,cold.form+'–'+(cold.formN-cold.form)+' in its last '+cold.formN+' available games.']);
    const carries=rows.filter(r=>r.w>=3&&r.teams.length>1).map(r=>({r,t:[...r.teams].sort((a,b)=>b.w-a.w)[0]})).filter(x=>x.t.w>=2&&x.t.w/x.r.w>=.4).sort((a,b)=>b.t.w/b.r.w-a.t.w/a.r.w||b.t.w-a.t.w);
    if(carries[0]){const {r,t}=carries[0];items.push(['THE CARRY JOB',t.name,t.w+' of '+r.name+'’s '+r.w+' squad wins ('+(100*t.w/r.w).toFixed(0)+'%).']);}
    const ranked=[...rows].sort((a,b)=>b.projected-a.projected),pairs=ranked.slice(1).map((r,i)=>({a:ranked[i],b:r,gap:ranked[i].projected-r.projected})).sort((a,b)=>a.gap-b.gap);
    if(pairs[0]&&pairs[0].gap<10){const {a,b,gap}=pairs[0];items.push(['TOO CLOSE TO CALL',a.name+' / '+b.name,gap<.05?'Level on projected squad wins.':gap.toFixed(1)+' projected wins separate these neighbours in the forecast.']);}
    const finals=[...recent].filter(g=>g.status==="FINAL"&&(g.homeWinner||g.awayWinner)).sort((a,b)=>new Date(b.date)-new Date(a.date));
    const lastDay=finals[0]?new Date(finals[0].date).toLocaleDateString("en-CA",{timeZone:"Australia/Sydney"}):null;
    const latestDay=finals.filter(g=>new Date(g.date).toLocaleDateString("en-CA",{timeZone:"Australia/Sydney"})===lastDay);
    const biggest=[...latestDay].filter(g=>Number.isFinite(g.homeScore)&&Number.isFinite(g.awayScore)).sort((a,b)=>Math.abs(b.homeScore-b.awayScore)-Math.abs(a.homeScore-a.awayScore))[0];
    if(biggest&&Math.abs(biggest.homeScore-biggest.awayScore)>=10)items.push(['STATEMENT RESULT',biggest.homeWinner?biggest.home:biggest.away,'Won by '+Math.abs(biggest.homeScore-biggest.awayScore)+' against '+(biggest.homeWinner?biggest.away:biggest.home)+' on '+lastDay+' (Sydney).']);
    if(latestDay.length){
      const results=rows.map(r=>{const owned=new Set(r.teams.map(t=>t.name));let w=0,l=0;const seen=new Set();for(const g of latestDay){const id=g.id||[g.date,g.home,g.away].join("|");if(seen.has(id))continue;seen.add(id);for(const side of ["home","away"])if(owned.has(g[side])){if(g[side+"Winner"])w++;else l++;}}return {name:r.name,w,l};}).filter(r=>r.w+r.l>0).sort((a,b)=>(b.w-b.l)-(a.w-a.l)||b.w-a.w);
      if(results[0])items.push(['LATEST FINISHED DAY',results[0].name,results[0].w+'–'+results[0].l+' from owned teams on '+lastDay+' (Sydney).']);
    }
    return items;
  }
  function dailyBrief(rows,recent,demo){
    const items=dailyInsights(rows,recent,demo);
    const stamp=new Date().toLocaleDateString("en-AU",{weekday:"short",day:"numeric",month:"short",timeZone:"Australia/Sydney"});
    return '<section class="ns-section ns-daily"><div class="ns-section-title"><span class="ns-kicker">THE DAILY TL:DR · '+esc(stamp)+(demo?' · SAMPLE DATA':'')+'</span><h3>Your numbers, in a minute.</h3></div>'+
      (items.length?'<div class="ns-daily-grid">'+items.slice(0,6).map(([tag,name,copy])=>'<article><small>'+tag+'</small><strong>'+esc(name)+'</strong><p>'+esc(copy)+'</p></article>').join("")+'</div>'+(items.length>6?'<details class="ns-deep-defs"><summary>More daily TL:DR · '+(items.length-6)+'</summary><div class="ns-daily-grid">'+items.slice(6).map(([tag,name,copy])=>'<article><small>'+tag+'</small><strong>'+esc(name)+'</strong><p>'+esc(copy)+'</p></article>').join("")+'</div></details>':''):'<p>No meaningful performance signals yet. The daily brief fills in as results arrive—no games means no hot takes.</p>')+
      '<p class="ns-note">Refreshes with the competition data. Early-season signals can swing sharply; recent form uses the available results window.</p><a href="#nsTeamLab">Explore team performance ↓</a></section>';
  }

  function performanceLab(rows,recent){
    const teams=teamNumbers(rows,recent).filter(t=>t.delta!==null);
    const better=teams.filter(t=>t.delta>=.05).sort((a,b)=>b.delta-a.delta||a.name.localeCompare(b.name)).slice(0,3);
    const worse=teams.filter(t=>t.delta<=-.05).sort((a,b)=>a.delta-b.delta||a.name.localeCompare(b.name)).slice(0,3);
    const picked=[...better,...worse],max=Math.max(1,...picked.map(t=>Math.abs(t.delta)));
    if(!picked.length)return '<p class="ns-note">No teams meaningfully ahead or behind expectation yet. The graph appears as results arrive.</p>';
    return '<div class="ns-performance-graph"><div class="ns-performance-axis"><span>← Below expectation</span><span>Above expectation →</span></div><ul>'+picked.map(t=>'<li><div class="ns-performance-name"><img src="'+logoUrl(teamByName(t.name)?.[1]||"")+'" alt=""><span>'+esc(t.name)+'<small>'+t.played+' games · '+esc(t.owner)+'</small></span></div><div class="ns-performance-track" aria-hidden="true"><i style="left:'+(t.delta<0?50-Math.abs(t.delta)/max*50:50)+'%;width:'+Math.abs(t.delta)/max*50+'%;background:'+(t.delta>0?'#77d8b6':'#f18ba3')+'"></i></div><b>'+plus(t.delta)+'<small>wins</small></b></li>').join("")+'</ul></div><p class="ns-note">Top three above and below preseason win pace. Gap = actual wins − (preseason win line × games played ÷ 82). Full team numbers are below.</p>';
  }
  let squadOwner="",rivalOwner="";
  const projectedOrder=rows=>[...rows].sort((a,b)=>b.projected-a.projected||a.name.localeCompare(b.name));

  function faceToFace(mine,other,recent){
    const own=new Set(mine.teams.map(t=>t.name)),opp=new Set(other.teams.map(t=>t.name));
    const seen=new Set(),direct=[];
    for(const g of [...recent].sort((a,b)=>b.date-a.date)){
      if(g.status!=="FINAL"||!((own.has(g.home)&&opp.has(g.away))||(own.has(g.away)&&opp.has(g.home))))continue;
      if(!g.homeWinner&&!g.awayWinner)continue;
      const key=g.id||[g.date,g.home,g.away].join("|");if(seen.has(key))continue;seen.add(key);
      const home=own.has(g.home),won=home?g.homeWinner:g.awayWinner;
      direct.push({g,won,margin:(home?g.homeScore:g.awayScore)-(home?g.awayScore:g.homeScore)});
    }
    const wins=direct.filter(x=>x.won).length,margin=direct.reduce((n,x)=>n+(Number.isFinite(x.margin)?x.margin:0),0);
    const form=r=>{const f=formFor(r.name,recent);return f.n?f.w+"–"+f.l+" over "+f.n+" team results":"No recent results";};
    const teamTable=r=>'<div><h5>'+esc(r.name)+'</h5><table class="ns-table"><thead><tr><th>Team</th><th>W–L</th><th>Projected</th></tr></thead><tbody>'+[...r.teams].sort((a,b)=>b.expected-a.expected).map(t=>'<tr><th><img class="ns-face-logo" src="'+logoUrl(teamByName(t.name)?.[1]||"")+'" alt="">'+esc(t.name)+'</th><td>'+t.w+'–'+t.l+'</td><td>'+(Number.isFinite(t.expected)?t.expected.toFixed(1):'—')+'</td></tr>').join("")+'</tbody></table></div>';
    const top=r=>[...r.teams].map(t=>t.expected).filter(Number.isFinite).sort((a,b)=>b-a).slice(0,2).reduce((a,b)=>a+b,0);
    return '<div class="ns-face"><h4>'+esc(mine.name)+' vs '+esc(other.name)+'</h4><div class="ns-table-scroll"><table class="ns-table"><caption>Squad comparison</caption><thead><tr><th>Measure</th><th>'+esc(mine.name)+' (you)</th><th>'+esc(other.name)+'</th></tr></thead><tbody>'+
      [['Projected total wins',mine.projected.toFixed(1),other.projected.toFixed(1)],['Actual record',mine.w+'–'+mine.l,other.w+'–'+other.l],['Title chance',mine.probability.toFixed(1)+'%',other.probability.toFixed(1)+'%'],['Recent form',form(mine),form(other)],['Top two teams · projected wins',top(mine).toFixed(1),top(other).toFixed(1)],['Remaining teams · projected wins',(mine.projected-top(mine)).toFixed(1),(other.projected-top(other)).toFixed(1)]].map(c=>'<tr><th>'+c[0]+'</th><td>'+c[1]+'</td><td>'+c[2]+'</td></tr>').join("")+'</tbody></table></div>'+
      '<h5>When your teams meet</h5>'+
      '<p>'+(direct.length?'Your direct record: <strong>'+wins+'–'+(direct.length-wins)+'</strong> · combined scoring margin '+(margin>0?'+':'')+margin+' points across '+direct.length+' games.':'No completed meetings in the loaded results window.')+'</p>'+
      (direct.length?'<ul class="ns-face-results">'+direct.slice(0,5).map(({g,won})=>'<li><span>'+esc(new Date(g.date).toLocaleDateString("en-AU",{day:"numeric",month:"short",timeZone:"Australia/Sydney"}))+' · '+esc(g.away)+' '+g.awayScore+' – '+g.homeScore+' '+esc(g.home)+'</span><b>'+ (won?'Your win':'Your loss')+'</b></li>').join("")+'</ul>':'')+
      '<p class="ns-note">Direct meetings and recent form cover the loaded recent-results window, not necessarily the full season. Squad games against other owners also count towards the competition.</p><h5>Where the projected wins come from</h5><div class="ns-face-teams">'+teamTable(mine)+teamTable(other)+'</div></div>';
  }

  function squadComparison(rows){
    if(!rows.length)return '<p class="ns-note">Comparisons appear once owners have teams.</p>';
    if(!rows.some(r=>r.name===squadOwner))squadOwner="";
    const buttons='<div class="ns-compare-names" aria-label="Choose your owner">'+rows.map((r,i)=>'<button type="button" data-owner-index="'+i+'" aria-pressed="'+(r.name===squadOwner)+'" style="--owner:'+colour(r.name,rows)+'">'+esc(r.name)+'</button>').join("")+'</div>';
    const mine=rows.find(r=>r.name===squadOwner);
    if(!mine)return buttons+'<p class="ns-note">Tap your name to see everyone compared with you.</p>';
    const ranked=projectedOrder(rows),rank=1+rows.filter(r=>r.projected>mine.projected+.000001).length;
    return buttons+'<div class="ns-compare-result" aria-live="polite"><div class="ns-compare-baseline"><strong>'+esc(mine.name)+'</strong><span>Projected #'+rank+' · '+mine.projected.toFixed(1)+' wins · '+mine.w+'–'+mine.l+' actual · '+mine.probability.toFixed(1)+'% title chance</span></div>'+
      '<div class="ns-table-scroll"><table class="ns-table ns-compare-table"><caption>Everyone compared with '+esc(mine.name)+'</caption><thead><tr><th scope="col">Owner</th><th scope="col">Projected wins</th><th scope="col">Compared with you</th><th scope="col">Actual W–L</th><th scope="col">Title chance</th></tr></thead><tbody>'+
      ranked.filter(r=>r.name!==mine.name).map(r=>{const gap=r.projected-mine.projected,label=Math.abs(gap)<.05?'Level':Math.abs(gap).toFixed(1)+' '+(gap>0?'ahead':'behind');const idx=rows.indexOf(r),open=rivalOwner===r.name;return '<tr><th scope="row"><button class="ns-rival-button" type="button" data-rival-index="'+idx+'" aria-expanded="'+open+'" aria-controls="nsRival'+idx+'"><i style="background:'+colour(r.name,rows)+'"></i>'+esc(r.name)+' <span aria-hidden="true">'+(open?'−':'+')+'</span></button></th><td>'+r.projected.toFixed(1)+'</td><td class="'+(Math.abs(gap)<.05?'':gap>0?'ns-gap-ahead':'ns-gap-behind')+'">'+label+'</td><td>'+r.w+'–'+r.l+'</td><td>'+r.probability.toFixed(1)+'%</td></tr>'+(open?'<tr class="ns-face-row"><td colspan="5" id="nsRival'+idx+'">'+faceToFace(mine,r,latest?.recent||[])+'</td></tr>':'')}).join("")+
      '</tbody></table></div>'+(rows.length===1?'<p class="ns-note">Other owners will appear here when available.</p>':'')+'<p class="ns-note">Tap an owner above to open the face-to-face breakdown. Gaps are projected total wins across each squad. Forecasts include wins already earned and estimates for remaining games.</p></div>';
  }
  function bindSquad(root,rows){
    root.querySelectorAll("[data-owner-index]").forEach(button=>button.addEventListener("click",()=>{
      const index=Number(button.dataset.ownerIndex);
      if(!rows[index])return;
      squadOwner=rows[index].name;rivalOwner="";
      root.querySelector("#nsSquadContent").innerHTML=squadComparison(rows);
      bindSquad(root,rows);
      const value=root.querySelector("#nsValueContent");if(value)value.innerHTML=performanceLab(rows,latest?.recent||[]);
      root.querySelector('[data-owner-index="'+index+'"]')?.focus({preventScroll:true});
    }));

    root.querySelectorAll("[data-rival-index]").forEach(button=>button.addEventListener("click",()=>{
      const index=Number(button.dataset.rivalIndex),r=rows[index];if(!r||r.name===squadOwner)return;
      rivalOwner=rivalOwner===r.name?"":r.name;
      root.querySelector("#nsSquadContent").innerHTML=squadComparison(rows);
      bindSquad(root,rows);
      root.querySelector('[data-rival-index="'+index+'"]')?.focus({preventScroll:true});
    }));
  }


  const deepSort={};
  function deepData(rows,recent){
    return teamNumbers(rows,recent).map(t=>{
      const seen=new Set();
      const games=[...recent].filter(g=>g.status==="FINAL"&&(g.homeWinner||g.awayWinner)&&(g.home===t.name||g.away===t.name)).sort((a,b)=>new Date(b.date)-new Date(a.date)).filter(g=>{const k=g.id||[g.date,g.home,g.away].join("|");if(seen.has(k))return false;seen.add(k);return true}).map(g=>{const h=g.home===t.name,pf=Number(g[h?"homeScore":"awayScore"]),pa=Number(g[h?"awayScore":"homeScore"]);return {home:h,won:!!g[h?"homeWinner":"awayWinner"],margin:Number.isFinite(pf)&&Number.isFinite(pa)?pf-pa:null}});
      const record=gs=>gs.length?gs.filter(g=>g.won).length+"–"+gs.filter(g=>!g.won).length:"—",margins=games.map(g=>g.margin).filter(Number.isFinite),avg=t.margin;
      let streak=0;for(const g of games){if(g.won!==games[0].won)break;streak++}
      return {...t,winPct:t.played?t.w/t.played*100:null,pace:t.played?t.w/t.played*82:null,remaining:Math.max(0,82-t.played),expectedNow:Number.isFinite(t.line)?t.played*t.line/82:null,
        recentRecord:record(games),last5:record(games.slice(0,5)),last10:record(games.slice(0,10)),homeRecord:record(games.filter(g=>g.home)),awayRecord:record(games.filter(g=>!g.home)),streak:games.length?(games[0].won?"W":"L")+streak:"—",
        closeRecord:record(games.filter(g=>g.margin!==null&&Math.abs(g.margin)<=5)),bigRecord:record(games.filter(g=>g.margin!==null&&Math.abs(g.margin)>=15)),best:margins.length?Math.max(...margins):null,worst:margins.length?Math.min(...margins):null,spread:margins.length?Math.sqrt(margins.reduce((n,m)=>n+(m-avg)**2,0)/margins.length):null};
    });
  }
  function deepTable(id,title,note,columns,data){
    const sort=deepSort[id]||{key:columns[0][0],dir:1};
    const ordered=[...data].sort((a,b)=>{const av=a[sort.key],bv=b[sort.key];if(av===null||av===undefined)return bv==null?0:1;if(bv==null)return -1;return sort.dir*(typeof av==="number"?av-bv:String(av).localeCompare(String(bv)))});
    return '<article class="ns-deep-group" id="'+id+'"><h4>'+title+'</h4><p class="ns-note">'+note+'</p><div class="ns-table-scroll" tabindex="0" role="region" aria-label="'+title+'"><table class="ns-table"><thead><tr>'+columns.map(([key,label])=>'<th scope="col"'+(key===sort.key?' aria-sort="'+(sort.dir===1?'ascending':'descending')+'"':'')+'><button type="button" data-deep-table="'+id+'" data-deep-key="'+key+'">'+label+(key===sort.key?(sort.dir===1?' ↑':' ↓'):' ↕')+'</button></th>').join("")+'</tr></thead><tbody>'+ordered.map(t=>'<tr>'+columns.map(([key,label],i)=>{let v=t[key];if(v===null||v===undefined)v="—";else if(typeof v==="number")v=Number.isInteger(v)?String(v):v.toFixed(1);return '<'+(i===0?'th scope="row"':'td')+'>'+esc(v)+'</'+(i===0?'th':'td')+'>'}).join("")+'</tr>').join("")+'</tbody></table></div></article>';
  }
  function deepStats(rows,recent){
    const teams=deepData(rows,recent),id=[["name","Team"],["owner","Owner"]];
    return '<section class="ns-section ns-deep" id="nsDeep"><div class="ns-section-title"><span class="ns-kicker">THE FULL SPREADSHEET ENERGY</span><h3>For the number addicts.</h3></div><p class="ns-note">Every owned team. Click a column heading to sort. Tables scroll sideways on smaller screens. — means unavailable, never zero. Season records and projections use the competition model; every recent statistic uses only the loaded final-game window.</p><nav class="ns-deep-nav" aria-label="Advanced statistics"><a href="#nsDeepSeason">Season &amp; expectations</a><a href="#nsDeepScore">Scoring</a><a href="#nsDeepForm">Form &amp; splits</a><a href="#nerdArchive">Records &amp; owner analysis</a></nav>'+
      deepTable("nsDeepSeason","Season & expectations","Win pace = current win rate × 82. Expected wins so far = preseason line × games played ÷ 82. Gap = actual wins − expected wins so far. Pace is descriptive; projected finish is the existing competition forecast.",[...id,["played","GP"],["w","W"],["l","L"],["winPct","Win %"],["remaining","Left"],["line","Preseason"],["expectedNow","Expected so far"],["delta","Gap"],["pace","82-game pace"],["expected","Projected finish"]],teams)+
      deepTable("nsDeepScore","Scoring & consistency","PPG and allowed are per scored game. Margin is points per game, not per 100 possessions. Margin SD measures game-to-game variation (lower = more consistent). Best and worst are single-game margins.",[...id,["scoredN","Scored GP"],["pf","PPG"],["pa","Allowed"],["margin","Avg margin"],["spread","Margin SD"],["best","Best margin"],["worst","Worst margin"],["blowouts","Wins by 15+"]],teams)+
      deepTable("nsDeepForm","Form, venue & pressure games","All splits below cover available recent finals, not full-season splits. L5/L10 use up to five/ten available games. Close = decided by 5 or fewer; big = decided by at least 15. These are final-score categories, not NBA clutch-time statistics.",[...id,["n","Window GP"],["recentRecord","Window W–L"],["last5","L5"],["last10","L10"],["streak","Streak*"],["homeRecord","Home W–L"],["awayRecord","Away W–L"],["closeRecord","Close W–L"],["bigRecord","Big W–L"]],teams)+
      '<details class="ns-deep-defs"><summary>How to read the numbers</summary><p>Streak* is the current run within the available window and may extend beyond it. A missing scoring result is excluded from scoring calculations. Margin SD uses the population standard deviation of available margins. Owner aggregates below may count both teams from an internal matchup because both results count towards their squad.</p><p>Possession-based offensive/defensive ratings, true shooting, effective field-goal percentage, turnover rate and lineup on/off need box-score or possession feeds. They are not inferred from final scores. Existing team-specific detailed feeds remain available in Team Stats.</p></details></section>';
  }
  function bindDeep(root,rows,recent){
    root.querySelectorAll("[data-deep-table]").forEach(button=>button.addEventListener("click",()=>{
      const id=button.dataset.deepTable,key=button.dataset.deepKey,old=deepSort[id];
      deepSort[id]={key,dir:old?.key===key?-old.dir:1};
      root.querySelector("#nsDeepSlot").innerHTML=deepStats(rows,recent);bindDeep(root,rows,recent);
      root.querySelector('[data-deep-table="'+id+'"][data-deep-key="'+key+'"]')?.focus({preventScroll:true});
    }));
  }

  function render(rows,games,recent,demo){
    latest={rows,games,recent,demo};
    const root=document.getElementById("nerdStudio");if(!root)return;
    const archive=document.getElementById("nerdClassic");
    if(archive)archive.remove();
    root.innerHTML=dailyBrief(rows,recent,demo)+'<section class="ns-section ns-squad"><div class="ns-section-title"><span class="ns-kicker">PICK YOUR NAME</span><h3>Compared with you</h3></div><div id="nsSquadContent">'+squadComparison(rows,recent)+'</div></section>'+
      '<section class="ns-section"><div class="ns-section-title"><span class="ns-kicker">FOLLOW THE RACE</span><h3>Every twist. Every contender.</h3></div>'+historyChart(rows,demo,root.clientWidth||960)+'</section>'+
      '<section class="ns-section" id="nsTeamLab"><div class="ns-section-title"><span class="ns-kicker">TEAM PERFORMANCE</span><h3>Who’s beating expectations?</h3></div><div id="nsValueContent">'+performanceLab(rows,recent)+'</div></section><div id="nsArchiveSlot"></div><div id="nsDeepSlot">'+deepStats(rows,recent)+'</div>';
    if(archive)root.querySelector("#nsArchiveSlot").appendChild(archive);
    bindSquad(root,rows,recent);
    bindDeep(root,rows,recent);
  }

  function renderCompetitionBrief(rows,recent,demo){
    const root=document.getElementById("competitionDailyNumbers");if(!root)return;
    const expanded=root.querySelector("details")?.open||false,position=root.querySelector(".cv-daily-highlights")?.scrollLeft||0,items=dailyInsights(rows,recent,demo);
    const card=([tag,name,copy])=>'<article><small>'+esc(tag)+'</small><strong>'+esc(name)+'</strong><p>'+esc(copy)+'</p></article>';
    const date=new Date().toLocaleDateString("en-AU",{day:"numeric",month:"short",timeZone:"Australia/Sydney"});
    root.innerHTML='<div class="cv-daily-head"><h3>Daily TL:DR</h3><span>'+esc(date)+(demo?' · SAMPLE':'')+'</span><button type="button" class="cv-daily-deep-link">Stats for Nerds ↗</button></div>'+
      (items.length?'<div id="cvDailyCarousel" class="cv-daily-highlights" tabindex="0" aria-label="Daily highlights; swipe or scroll for more">'+items.map(card).join("")+'</div>'+
      (items.length>1?'<div class="cv-daily-navigation"><button type="button" class="cv-daily-prev" aria-label="Previous daily TL:DR" aria-controls="cvDailyCarousel">←</button><span>Swipe or use the arrows</span><button type="button" class="cv-daily-next" aria-label="Next daily TL:DR" aria-controls="cvDailyCarousel">→</button></div>':'')+
      (items.length>3?'<details'+(expanded?' open':'')+'><summary>Expand all daily TL:DR · '+items.length+'</summary><div class="cv-daily-more">'+items.map(card).join("")+'</div></details>':''):
      '<p class="cv-daily-empty">The daily TL:DR will fill in as results arrive.</p>');
    const track=root.querySelector(".cv-daily-highlights"),prev=root.querySelector(".cv-daily-prev"),next=root.querySelector(".cv-daily-next");
    if(track){
      track.scrollLeft=position;
      const update=()=>{if(prev)prev.disabled=track.scrollLeft<=2;if(next)next.disabled=track.scrollLeft+track.clientWidth>=track.scrollWidth-2;};
      const move=direction=>{const article=track.querySelector("article"),step=article?article.getBoundingClientRect().width+20:track.clientWidth;track.scrollBy({left:direction*step,behavior:window.matchMedia?.("(prefers-reduced-motion: reduce)").matches?"auto":"smooth"});};
      prev?.addEventListener("click",()=>move(-1));next?.addEventListener("click",()=>move(1));
      track.addEventListener("scroll",update,{passive:true});
      track.addEventListener("keydown",e=>{if(e.key==="ArrowRight"||e.key==="ArrowLeft"){e.preventDefault();move(e.key==="ArrowRight"?1:-1);}});
      if(typeof ResizeObserver!=="undefined"){root._dailyResize?.disconnect();root._dailyResize=new ResizeObserver(update);root._dailyResize.observe(track);}
      update();
    }
    root.querySelector(".cv-daily-deep-link")?.addEventListener("click",()=>window.openStatsForNerds());
  }

  function toggle(){
    classic=!classic;
    const modern=document.getElementById("nerdStudio"),old=document.getElementById("nerdClassic"),button=document.getElementById("nerdLayoutToggle");
    if(modern)modern.hidden=classic;if(old)old.hidden=!classic;
    if(button){button.textContent=classic?"New view":"Classic view";button.setAttribute("aria-pressed",String(classic))}
    if(!classic&&latest)render(latest.rows,latest.games,latest.recent,latest.demo);
  }
  window.cvNerdStudio={render,toggle,renderCompetitionBrief};
})();
