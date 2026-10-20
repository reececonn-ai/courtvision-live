
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

  let teamMetric="delta",teamScope="all";
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
  function dailyBrief(rows,recent,demo){
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
    const stamp=new Date().toLocaleDateString("en-AU",{weekday:"short",day:"numeric",month:"short",timeZone:"Australia/Sydney"});
    return '<section class="ns-section ns-daily"><div class="ns-section-title"><span class="ns-kicker">THE DAILY TL;DR · '+esc(stamp)+(demo?' · SAMPLE DATA':'')+'</span><h3>Your numbers, in a minute.</h3></div>'+
      (items.length?'<div class="ns-daily-grid">'+items.slice(0,4).map(([tag,name,copy])=>'<article><small>'+tag+'</small><strong>'+esc(name)+'</strong><p>'+esc(copy)+'</p></article>').join("")+'</div>':'<p>No meaningful performance signals yet. The daily brief fills in as results arrive—no games means no hot takes.</p>')+
      '<p class="ns-note">Refreshes with the competition data. Early-season signals can swing sharply; recent form uses the available results window.</p><a href="#nsTeamLab">Explore team performance ↓</a></section>';
  }
  function performanceLab(rows,recent){
    const selected=teamScope==="mine"&&squadOwner?rows.filter(r=>r.name===squadOwner):rows;
    const teams=teamNumbers(selected,recent),valid=teams.filter(t=>(teamMetric==="delta"||teamMetric==="cold")?t.delta!==null:teamMetric==="margin"?t.margin!==null:t.formN>0).sort((a,b)=>teamMetric==="cold"?a.delta-b.delta:teamMetric==="form"?b.form/b.formN-a.form/a.formN:teamMetric==="margin"?b.margin-a.margin:b.delta-a.delta);
    const metric=t=>teamMetric==="form"?t.form+'–'+(t.formN-t.form):teamMetric==="margin"?plus(t.margin):plus(t.delta);
    const label=teamMetric==="form"?'Recent W–L':teamMetric==="margin"?'Avg margin':'Wins vs expectation';
    return '<div class="ns-controls"><label>Show <select id="nsTeamScope"><option value="all">All teams</option><option value="mine"'+(teamScope==="mine"?' selected':'')+(!squadOwner?' disabled':'')+'>My squad</option></select></label><label>Find <select id="nsTeamMetric">'+[['delta','Overachievers'],['cold','Underperformers'],['form','Hot hands'],['margin','Scoring power']].map(([v,n])=>'<option value="'+v+'"'+(v===teamMetric?' selected':'')+'>'+n+'</option>').join("")+'</select></label></div>'+
      '<p class="ns-note">'+(teamMetric==="form"?'Last five available games per team; sample counts can differ.':teamMetric==="margin"?'Average points scored minus allowed in the loaded results window. This is not opponent-adjusted net rating.':'Actual wins minus preseason expected wins for games played. Positive means ahead; negative means behind. This is a pace check, not a new season forecast.')+'</p>'+
      (valid.length?'<div class="ns-team-leaders">'+valid.map(t=>'<details class="ns-team-number"><summary><img src="'+logoUrl(teamByName(t.name)?.[1]||"")+'" alt=""><span><strong>'+esc(t.name)+'</strong><small>'+esc(t.owner)+' · '+t.w+'–'+t.l+' season · '+(teamMetric==="form"?t.formN+' recent games':teamMetric==="margin"?t.scoredN+' scored games':t.played+' games')+'</small></span><b>'+metric(t)+'<small>'+label+'</small></b></summary><div class="ns-team-deeper"><dl>'+
        [['Season win rate',t.played?(100*t.w/t.played).toFixed(1)+'%':'—'],['Projected season wins',Number.isFinite(t.expected)?t.expected.toFixed(1):'—'],['Preseason win line',Number.isFinite(t.line)?t.line.toFixed(1):'—'],['Recent points per game',t.pf===null?'—':t.pf.toFixed(1)],['Recent points allowed',t.pa===null?'—':t.pa.toFixed(1)],['Recent scoring margin',t.margin===null?'—':plus(t.margin)],['Close games (≤5 pts)',t.close.length?t.close.filter(g=>g.won).length+'–'+t.close.filter(g=>!g.won).length:'—'],['Wins by 15+ points',t.scoredN?String(t.blowouts):'—']].map(([k,v])=>'<div><dt>'+k+'</dt><dd>'+v+'</dd></div>').join("")+'</dl><p class="ns-note">Scoring, close games and big wins cover '+t.scoredN+' available scored games, not necessarily the whole season. Tap again to close.</p></div></details>').join("")+'</div>':'<p class="ns-note">No completed data for this view yet. Try another metric after games finish.</p>');
  }
  function bindLab(root,rows,recent){
    for(const id of ["nsTeamMetric","nsTeamScope"])root.querySelector("#"+id)?.addEventListener("change",e=>{
      if(id==="nsTeamMetric")teamMetric=e.target.value;else teamScope=e.target.value;
      root.querySelector("#nsValueContent").innerHTML=performanceLab(rows,recent);bindLab(root,rows,recent);
    });
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
      const value=root.querySelector("#nsValueContent");if(value)value.innerHTML=performanceLab(rows,latest?.recent||[]);bindLab(root,rows,latest?.recent||[]);
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

  function render(rows,games,recent,demo){
    latest={rows,games,recent,demo};
    const root=document.getElementById("nerdStudio");if(!root)return;
    root.innerHTML=dailyBrief(rows,recent,demo)+'<section class="ns-section ns-squad"><div class="ns-section-title"><span class="ns-kicker">PICK YOUR NAME</span><h3>Compared with you</h3></div><div id="nsSquadContent">'+squadComparison(rows,recent)+'</div></section>'+
      '<section class="ns-section"><div class="ns-section-title"><span class="ns-kicker">FOLLOW THE RACE</span><h3>Every twist. Every contender.</h3></div>'+historyChart(rows,demo,root.clientWidth||960)+'</section>'+
      '<section class="ns-section" id="nsTeamLab"><div class="ns-section-title"><span class="ns-kicker">TEAM PERFORMANCE</span><h3>Who’s beating expectations?</h3></div><div id="nsValueContent">'+performanceLab(rows,recent)+'</div></section>';
    bindSquad(root,rows,recent);
    bindLab(root,rows,recent);
  }
  function toggle(){
    classic=!classic;
    const modern=document.getElementById("nerdStudio"),old=document.getElementById("nerdClassic"),button=document.getElementById("nerdLayoutToggle");
    if(modern)modern.hidden=classic;if(old)old.hidden=!classic;
    if(button){button.textContent=classic?"New view":"Classic view";button.setAttribute("aria-pressed",String(classic))}
    if(!classic&&latest)render(latest.rows,latest.games,latest.recent,latest.demo);
  }
  window.cvNerdStudio={render,toggle};
})();
