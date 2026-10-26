/* Lightweight, read-only NBA headlines shared with Daily TL:DR. */
(function(){
  "use strict";
  const TTL=5*60*1000;
  let articles=[],last=0,loading=null;
  const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const clean=a=>a&&typeof a.headline==="string"&&/^https:\/\/(www\.)?espn\.com\//.test(a.url||"");
  function getNews(){
    if(Date.now()-last<TTL)return Promise.resolve(articles);
    if(loading)return loading;
    loading=fetch("/api/nba/news",{credentials:"same-origin"}).then(r=>r.ok?r.json():null).then(data=>{
      if(data?.ok===false)throw new Error("News unavailable");
      articles=Array.isArray(data?.articles)?data.articles.filter(clean).slice(0,50):[];
      last=Date.now();
      return articles;
    }).catch(()=>{last=0;return articles}).finally(()=>{loading=null});
    return loading;
  }
  function card(a){
    const type=/INJURY|ROSTER/.test(a.category||"")?a.category:"NBA NEWS";
    const date=a.published?new Date(a.published):null;
    const stamp=date&&!isNaN(+date)?date.toLocaleDateString("en-AU",{day:"numeric",month:"short"}):"";
    return '<a class="cv-news-item" target="_blank" rel="noopener noreferrer" href="'+esc(a.url)+'"><span class="cv-news-tag">'+esc(type)+'</span><strong>'+esc(a.headline)+'</strong><small>ESPN'+(stamp?" · "+esc(stamp):"")+' · READ ORIGINAL ↗</small></a>';
  }

  function relatedTeams(a){
    if(typeof TEAM_DATA==="undefined")return [];
    const matches=TEAM_DATA.filter(t=>{
      const tags=a.teams||[];
      if(tags.some(tag=>tag.name?.toLowerCase()===t[0].toLowerCase()||(tag.id&&typeof espnTeamId==="function"&&String(espnTeamId(t[0]))===tag.id)))return true;
      const headline=String(a.headline||"");
      if(headline.toLowerCase().includes(t[0].toLowerCase()))return true;
      const nickname=t[0].split(" ").at(-1);
      return new RegExp("\\b"+nickname+"\\b","i").test(headline);
    });
    const order=t=>{const index=(a.teams||[]).findIndex(tag=>tag.name?.toLowerCase()===t[0].toLowerCase()||(tag.id&&typeof espnTeamId==='function'&&String(espnTeamId(t[0]))===tag.id));return index<0?99:index};
    return matches.sort((a,b)=>order(a)-order(b));
  }
  function ownerLabels(a){
    return relatedTeams(a).map(t=>{const owner=typeof state!=="undefined"?state.assignments?.[t[0]]?.player:null;return owner?'<span style="--news-team:'+esc(t[2]||"#55b7ff")+'">'+esc(t[1])+' · '+esc(owner)+'</span>':""}).filter(Boolean).join("");
  }
  function editorialCard(a,lead=false){
    const date=new Date(a.published||"");
    const stamp=Number.isFinite(date.getTime())?new Intl.DateTimeFormat("en-AU",{timeZone:"Australia/Sydney",day:"numeric",month:"short",hour:"numeric",minute:"2-digit"}).format(date):"";
    const image=/^https:\/\/(?:[a-z0-9-]+\.)*espncdn\.com\//i.test(a.image||"")?a.image:"";
    const labels=ownerLabels(a);
    const teams=relatedTeams(a).slice(0,2);
    const fallback=teams.length?'<div class="cv-news-logo-fallback">'+teams.map(t=>'<img src="'+esc(logoUrl(t[1]))+'" alt="'+esc(t[0])+'" loading="lazy" onerror="this.remove()">').join("")+'</div>':'<div class="cv-news-logo-fallback"><img src="https://a.espncdn.com/i/teamlogos/leagues/500/nba.png" alt="NBA" loading="lazy"></div>';
    return '<a class="cv-editorial-story '+(lead?'is-lead':'')+'" href="'+esc(a.url)+'" target="_blank" rel="noopener noreferrer"><div class="cv-editorial-media">'+fallback+(image?'<img src="'+esc(image)+'" alt="" loading="'+(lead?'eager':'lazy')+'" onerror="this.remove()">':'')+'</div><div class="cv-editorial-copy"><span class="cv-editorial-category">'+esc(a.category||"NBA NEWS")+'</span><h3>'+esc(a.headline)+'</h3>'+(false&&a.summary?'<p>'+esc(a.summary)+'</p>':'')+(labels?'<div class="cv-owner-labels">'+labels+'</div>':'')+'<small>ESPN'+(stamp?' · '+esc(stamp)+' Sydney':'')+' · Read original ↗</small></div></a>';
  }

  function competitionUpdate(a){
    const h=String(a.headline||"");
    const action=/\b(?:trad(?:e|es|ed)|waiv(?:e|es|ed)|sign(?:s|ed|ing)?|re-sign(?:s|ed)?|acquir(?:e|es|ed)|releas(?:e|es|ed)|contract|extension|ruled out|questionable|doubtful|suspended|suspension|surgery|out for|out indefinitely|return(?:s|ing)? to (?:play|lineup))\b/i.test(h);
    const commentary=/\b(?:rumou?r|mock|rankings?|grades?|predictions?|power rankings|could|should|might|trade ideas|trade targets|best|worst|signs of)\b/i.test(h);
    const assigned=typeof state!=="undefined"?Object.keys(state.assignments||{}).length:0;
    const owned=!assigned||relatedTeams(a).some(t=>state.assignments?.[t[0]]);
    return action&&!commentary&&owned;
  }
  async function morning(){
    const el=document.getElementById("cvMorningNews");if(!el)return;
    const list=await getNews();
    const ranked=list.filter(competitionUpdate).sort((a,b)=>Number(!!ownerLabels(b))-Number(!!ownerLabels(a))||(Date.parse(b.published)||0)-(Date.parse(a.published)||0));
    el.innerHTML=ranked.length?'<div class="cv-editorial-grid">'+editorialCard(ranked[0],true)+'<div class="cv-editorial-support">'+ranked.slice(1,4).map(a=>editorialCard(a)).join("")+'</div></div>'+(ranked.length>4?'<details class="cv-more-news"><summary>More roster updates ('+(ranked.length-4)+')</summary><div class="cv-extra-headlines">'+ranked.slice(4).map(a=>editorialCard(a)).join("")+'</div></details>':''):'<p class="cv-news-status">No new roster or availability updates for your competition in the current feed.</p>';

  }
  async function team(){
    const el=document.getElementById("cvTeamNews");if(!el)return;
    const name=document.getElementById("mastheadName")?.textContent?.trim()||"";
    if(!document.body.classList.contains("teams-profile-view")||!name){el.innerHTML="";return}
    const list=await getNews();
    if(!document.body.classList.contains("teams-profile-view"))return;
    const teamWords=name.replace(/^(Los Angeles|New York|Golden State|New Orleans|Oklahoma City|Portland|San Antonio|Salt Lake City)\s+/i,"").split(/\s+/);
    const nickname=teamWords[teamWords.length-1]||"";
    const matches=list.filter(a=>(a.headline+" "+(a.summary||"")).toLowerCase().includes(name.toLowerCase())||(nickname.length>3&&(a.headline+" "+(a.summary||"")).toLowerCase().includes(nickname.toLowerCase()))).slice(0,3);
    el.innerHTML='<div class="comp-section-head"><div><span class="comp-section-kicker">NBA WIRE</span><strong>TEAM NEWS & AVAILABILITY</strong></div></div>'+(matches.length?matches.map(card).join(""):'<p class="cv-news-status">No current team-specific headlines in the feed. Injuries are not confirmed unless linked to a dated report.</p>');
  }
  const original=window.openTeamFromHub;
  if(typeof original==="function")window.openTeamFromHub=function(name){original(name);queueMicrotask(team)};
  const originalRefresh=window.refreshCompetitionBoard;
  if(typeof originalRefresh==="function")window.refreshCompetitionBoard=function(force){const result=originalRefresh(force);if(force){last=0;void morning()}return result};
  const originalCompetition=window.openCompetitionBoard;
  if(typeof originalCompetition==="function")window.openCompetitionBoard=function(){originalCompetition();void morning()};
  window.addEventListener("load",morning,{once:true});
  document.addEventListener("visibilitychange",()=>{if(!document.hidden&&Date.now()-last>TTL){morning();team()}});
  window.cvNews={getNews,relatedTeams};
  window.dispatchEvent(new Event('cv-news-ready'));
})();
