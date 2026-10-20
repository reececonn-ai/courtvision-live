
/* Stats for Nerds editorial view. Presentation-only; Classic view remains available. */
(()=>{
  const esc=v=>String(v??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
  const palette=["#63c8ff","#f2bb63","#b49bff","#77d8b6","#f18ba3","#c9d878"];
  let latest=null,ownerFilter="",sort="probability",classic=false;
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
    if(snapshots.length<2)return '<p class="ns-note">One day of data so far. Here’s the current title-chance comparison; the history chart appears after a second saved day.</p>'+currentRace(rows);
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
  function valueChart(rows){
    const teams=rows.flatMap(r=>r.teams.map(t=>({...t,owner:r.name,played:t.w+t.l}))).filter(t=>t.played>0&&Number.isFinite(t.line)).map(t=>({...t,pace:t.w/(t.w+t.l)*82,delta:t.w/(t.w+t.l)*82-t.line}));
    if(!teams.length){
      const projected=rows.flatMap(r=>r.teams.filter(t=>Number.isFinite(t.line)).map(t=>({...t,owner:r.name}))).sort((a,b)=>b.line-a.line).slice(0,6),max=Math.max(1,...projected.map(t=>t.line));
      return '<p class="ns-note">No regular-season results yet. These are the six highest preseason team projections—not steals or busts.</p>'+projected.map(t=>'<div class="ns-value-row"><img src="'+logoUrl(teamByName(t.name)?.[1]||"")+'" alt=""><div><strong>'+esc(t.name)+'</strong><small>'+esc(t.owner)+'</small></div><div class="ns-value-track"><i style="width:'+t.line/max*100+'%;background:'+(teamByName(t.name)?.[2]||colour(t.owner,rows))+'"></i></div><b>'+t.line.toFixed(1)+'</b></div>').join("");
    }
    const ordered=[...teams].sort((a,b)=>b.delta-a.delta),picked=[...ordered.slice(0,3),...ordered.slice(-3)].filter((t,i,all)=>all.findIndex(x=>x.name===t.name)===i),max=Math.max(1,...picked.map(t=>Math.abs(t.delta)));
    return '<p class="ns-note">Largest gaps between current 82-game win pace and preseason expectation. Early-season pace is volatile; this is not a final-season forecast.</p>'+picked.map(t=>'<div class="ns-value-row"><img src="'+logoUrl(teamByName(t.name)?.[1]||"")+'" alt=""><div><strong>'+esc(t.name)+'</strong><small>'+esc(t.owner)+' · '+t.w+'–'+t.l+' · '+t.played+' games</small></div><div class="ns-diverge"><i style="left:'+(t.delta<0?50-Math.abs(t.delta)/max*50:50)+'%;width:'+Math.abs(t.delta)/max*50+'%;background:'+colour(t.owner,rows)+'"></i></div><b>'+(t.delta>=0?'+':'')+t.delta.toFixed(1)+'</b></div>').join("");
  }
  function rivalry(rows,recent){
    const names=rows.map(r=>r.name),owner=team=>state.assignments?.[team]?.player,pairs=new Map();
    for(const g of recent.filter(g=>g.status==="FINAL")){
      const a=owner(g.away),h=owner(g.home);if(!a||!h||a===h)continue;
      if(g.awayWinner)pairs.set(a+"|"+h,(pairs.get(a+"|"+h)||0)+1);
      else if(g.homeWinner)pairs.set(h+"|"+a,(pairs.get(h+"|"+a)||0)+1);
    }
    return '<p class="ns-note">Direct games in the loaded recent-results window. Each cell is the row owner’s wins–losses against the column owner.</p><div class="ns-table-scroll"><table class="ns-table"><thead><tr><th scope="col">Owner</th>'+names.map(n=>'<th scope="col">'+esc(n)+'</th>').join("")+'</tr></thead><tbody>'+names.map(a=>'<tr><th scope="row">'+esc(a)+'</th>'+names.map(b=>'<td>'+ (a===b?'—':(pairs.get(a+"|"+b)||0)+'–'+(pairs.get(b+"|"+a)||0))+'</td>').join("")+'</tr>').join("")+'</tbody></table></div>';
  }
  function detailTable(rows,recent){
    const filtered=rows.filter(r=>!ownerFilter||r.name===ownerFilter).map(r=>({...r,form:formFor(r.name,recent)})).sort((a,b)=>sort==="name"?a.name.localeCompare(b.name):Number(b[sort])-Number(a[sort]));
    return filtered.map(r=>'<details class="ns-owner-detail"><summary><span><i style="background:'+colour(r.name,rows)+'"></i><strong>'+esc(r.name)+'</strong></span><span>'+r.w+'–'+r.l+' <small>actual</small></span><span>'+r.projected.toFixed(1)+' <small>projected</small></span><span>'+r.probability.toFixed(1)+'% <small>title</small></span></summary><div class="ns-owner-inside"><p>Recent team results: '+(r.form.n?r.form.w+'–'+r.form.l+' over '+r.form.n+' games · scoring margin '+(r.form.margin>=0?'+':'')+r.form.margin:'No completed games loaded yet.')+'</p><div class="ns-table-scroll"><table class="ns-table"><thead><tr><th>Team</th><th>W–L</th><th>Preseason</th><th>Projected finish</th></tr></thead><tbody>'+r.teams.map(t=>'<tr><th>'+esc(t.name)+'</th><td>'+t.w+'–'+t.l+'</td><td>'+(Number.isFinite(t.line)?t.line.toFixed(1):'—')+'</td><td>'+(Number.isFinite(t.expected)?t.expected.toFixed(1):'—')+'</td></tr>').join("")+'</tbody></table></div></div></details>').join("");
  }
  function render(rows,games,recent,demo){
    latest={rows,games,recent,demo};
    const root=document.getElementById("nerdStudio");if(!root)return;
    if(ownerFilter&&!rows.some(r=>r.name===ownerFilter))ownerFilter="";
    const leader=[...rows].sort((a,b)=>b.probability-a.probability)[0],played=rows.some(r=>r.w+r.l>0);
    const today=new Map(rows.map(r=>[r.name,{w:0,l:0}]));
    for(const g of games.filter(g=>g.status==="FINAL"))for(const side of ["home","away"]){const o=state.assignments?.[g[side]]?.player;if(today.has(o))today.get(o)[g[side+"Winner"]?"w":"l"]++}
    const hot=[...today].filter(([,r])=>r.w+r.l>0).sort((a,b)=>(b[1].w-b[1].l)-(a[1].w-a[1].l))[0];
    let headline=hot?hot[0]+"’s day, in the numbers":leader?leader.name+" sets the benchmark":"The season’s story starts here";
    let story=hot?hot[0]+" has "+hot[1].w+" wins and "+hot[1].l+" losses from today’s completed team games.":leader?(played?'The model gives ':'Before the first results, the model gives ')+leader.name+" a "+leader.probability.toFixed(1)+"% title chance. Explore the assumptions and the teams behind that number.":"Owner comparisons will appear once draft and competition data are available.";
    root.innerHTML='<section class="ns-story"><div><span class="ns-kicker">'+(demo?'SAMPLE DATA · ':'')+'THE BIG STORY</span><h3>'+esc(headline)+'</h3><p>'+esc(story)+'</p><a href="#nsExplore">Explore the numbers ↓</a></div><div class="ns-story-race">'+currentRace(rows)+'</div></section>'+
      '<section class="ns-section"><div class="ns-section-title"><span class="ns-kicker">FOLLOW THE RACE</span><h3>Every twist. Every contender.</h3></div>'+historyChart(rows,demo,root.clientWidth||960)+'</section>'+
      '<section class="ns-section"><div class="ns-section-title"><span class="ns-kicker">DRAFT VALUE</span><h3>Who’s beating the expectation?</h3></div>'+valueChart(rows)+'</section>'+
      '<section class="ns-section"><div class="ns-section-title"><span class="ns-kicker">BRAGGING RIGHTS</span><h3>Head to head</h3></div>'+rivalry(rows,recent)+'</section>'+
      '<section class="ns-section" id="nsExplore"><div class="ns-section-title"><span class="ns-kicker">GO DEEPER</span><h3>Explore the numbers</h3></div><div class="ns-controls"><label>Owner <select id="nsOwner"><option value="">All owners</option>'+rows.map(r=>'<option value="'+esc(r.name)+'"'+(r.name===ownerFilter?' selected':'')+'>'+esc(r.name)+'</option>').join("")+'</select></label><label>Order by <select id="nsSort">'+[["probability","Title chance"],["w","Actual wins"],["projected","Projected wins"],["name","Owner name"]].map(([v,label])=>'<option value="'+v+'"'+(v===sort?' selected':'')+'>'+label+'</option>').join("")+'</select></label></div><p class="ns-note">Click or tap an owner to reveal their team breakdown.</p><div id="nsDetailRows">'+detailTable(rows,recent)+'</div></section>';
    root.querySelector("#nsOwner").addEventListener("change",e=>{ownerFilter=e.target.value;root.querySelector("#nsDetailRows").innerHTML=detailTable(rows,recent)});
    root.querySelector("#nsSort").addEventListener("change",e=>{sort=e.target.value;root.querySelector("#nsDetailRows").innerHTML=detailTable(rows,recent)});
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
