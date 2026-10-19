/* CourtVision editorial preview: lightweight, read-only, optional NBA headlines.
   No polling, no draft writes, one shared three-hour edge cache. */
(function(){
  "use strict";
  const TTL=3*60*60*1000;
  let articles=[],last=0,loading=null;
  const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const clean=a=>a&&typeof a.headline==="string"&&/^https:\/\/(www\.)?espn\.com\//.test(a.url||"");
  function getNews(){
    if(Date.now()-last<TTL)return Promise.resolve(articles);
    if(loading)return loading;
    loading=fetch("/api/nba/news",{credentials:"same-origin"}).then(r=>r.ok?r.json():null).then(data=>{
      articles=Array.isArray(data?.articles)?data.articles.filter(clean).slice(0,20):[];
      last=Date.now();
      return articles;
    }).catch(()=>{last=Date.now();return articles}).finally(()=>{loading=null});
    return loading;
  }
  function card(a){
    const type=/INJURY|ROSTER/.test(a.category||"")?a.category:"NBA NEWS";
    const date=a.published?new Date(a.published):null;
    const stamp=date&&!isNaN(+date)?date.toLocaleDateString("en-AU",{day:"numeric",month:"short"}):"";
    return '<a class="cv-news-item" target="_blank" rel="noopener noreferrer" href="'+esc(a.url)+'"><span class="cv-news-tag">'+esc(type)+'</span><strong>'+esc(a.headline)+'</strong><small>ESPN'+(stamp?" · "+esc(stamp):"")+' · READ ORIGINAL ↗</small></a>';
  }
  async function morning(){
    const el=document.getElementById("cvMorningNews");if(!el)return;
    const list=await getNews();
    el.innerHTML=list.length?list.slice(0,6).map(card).join(""):'<p class="cv-news-status">NBA headlines are temporarily unavailable. Competition stories below still work.</p>';
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
  window.addEventListener("load",morning,{once:true});
  document.addEventListener("visibilitychange",()=>{if(!document.hidden&&Date.now()-last>TTL){morning();team()}});
})();