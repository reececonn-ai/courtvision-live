/* CourtVision trade desk: one-for-one proposals, majority voting and historical-record handovers. */
(()=>{
  const esc=value=>typeof escapeHtml==="function"?escapeHtml(String(value??"")):String(value??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
  const team=name=>typeof teamByName==="function"?teamByName(name):null;
  const logo=name=>{const t=team(name);return t?logoUrl(t[1]):""};
  const player=name=>(state.players||[]).find(p=>p.name===name);
  const proposals=()=>state.tradeProposals||(state.tradeProposals=[]);
  const eligible=()=>[...new Set((state.players||[]).map(p=>p.name).filter(Boolean))];
  const majority=()=>Math.floor(eligible().length/2)+1;
  const activeTeam=teamName=>proposals().some(p=>p.status==="voting"&&(p.offeredTeam===teamName||p.requestedTeam===teamName));
  const record=name=>window.cvCompetition?.records?.()[name]||{w:0,l:0};

  function normalise(){
    state.tradeProposals=Array.isArray(state.tradeProposals)?state.tradeProposals:[];
    state.tradeLedger=state.tradeLedger&&typeof state.tradeLedger==="object"?state.tradeLedger:{banked:{},teams:{},events:[]};
    for(const p of state.tradeProposals){p.votes=p.votes&&typeof p.votes==="object"?p.votes:{};p.status=p.status||"voting";}
  }

  function ownerOptions(selected,exclude=""){
    return eligible().filter(n=>n!==exclude).map(n=>'<option value="'+esc(n)+'"'+(n===selected?' selected':'')+'>'+esc(n)+'</option>').join("");
  }
  function teamOptions(owner,selected){
    const names=(player(owner)?.teams||[]).filter(n=>!activeTeam(n)||n===selected);
    return names.map(n=>'<option value="'+esc(n)+'"'+(n===selected?' selected':'')+'>'+esc(n)+'</option>').join("");
  }
  function compactTeam(name,label){
    const r=record(name),t=team(name);
    return '<div class="trade-team" style="--trade-primary:'+(t?.[2]||"#63c8ff")+'"><img src="'+logo(name)+'" alt=""><div><small>'+label+'</small><strong>'+esc(name||"Choose a team")+'</strong><span>'+r.w+'–'+r.l+' current NBA record</span></div></div>';
  }

  function renderBuilder(root){
    const requester=root.dataset.requester&&player(root.dataset.requester)?root.dataset.requester:eligible()[0]||"";
    const offeredNames=player(requester)?.teams||[],offered=offeredNames.includes(root.dataset.offered)?root.dataset.offered:offeredNames[0]||"";
    const partner=root.dataset.partner&&root.dataset.partner!==requester&&player(root.dataset.partner)?root.dataset.partner:eligible().find(n=>n!==requester)||"";
    const requestedNames=player(partner)?.teams||[],requested=requestedNames.includes(root.dataset.requested)?root.dataset.requested:requestedNames[0]||"";
    Object.assign(root.dataset,{requester,offered,partner,requested});
    const blocked=!requester||!partner||!offered||!requested||offered===requested||activeTeam(offered)||activeTeam(requested);
    root.querySelector("#tradeBuilder").innerHTML=
      '<div class="trade-steps">'+
      '<label><b>1</b><span>Who is asking?</span><select id="tradeRequester">'+ownerOptions(requester)+'</select></label>'+
      '<label><b>2</b><span>Team being offered</span><select id="tradeOffered">'+teamOptions(requester,offered)+'</select></label>'+
      '<label><b>3</b><span>Trading with</span><select id="tradePartner">'+ownerOptions(partner,requester)+'</select></label>'+
      '<label><b>4</b><span>Team they want</span><select id="tradeRequested">'+teamOptions(partner,requested)+'</select></label></div>'+
      '<div class="trade-preview">'+compactTeam(offered,requester+" offers")+'<div class="trade-swap-mark" aria-hidden="true">⇄</div>'+compactTeam(requested,partner+" offers")+'</div>'+
      '<div class="trade-rule"><strong>Historical wins stay put.</strong><span>If this passes, '+esc(requester)+' keeps every win earned before the swap and only future '+esc(requested)+' results count for them. The same rule applies to '+esc(partner)+'.</span></div>'+
      '<button type="button" class="trade-submit"'+(blocked?' disabled':'')+'>'+((activeTeam(offered)||activeTeam(requested))?'A selected team already has a pending trade':'5 · Put this trade to a vote')+'</button>';
    for(const [id,key] of [["tradeRequester","requester"],["tradeOffered","offered"],["tradePartner","partner"],["tradeRequested","requested"]]){
      root.querySelector("#"+id)?.addEventListener("change",e=>{root.dataset[key]=e.target.value;if(key==="requester"){root.dataset.offered="";if(root.dataset.partner===e.target.value)root.dataset.partner="";}if(key==="partner")root.dataset.requested="";renderBuilder(root);});
    }
    root.querySelector(".trade-submit")?.addEventListener("click",()=>create(root));
  }

  function create(root){
    const requester=root.dataset.requester,partner=root.dataset.partner,offeredTeam=root.dataset.offered,requestedTeam=root.dataset.requested;
    if(!requester||!partner||requester===partner)return;
    if(state.assignments?.[offeredTeam]?.player!==requester||state.assignments?.[requestedTeam]?.player!==partner)return render();
    if(activeTeam(offeredTeam)||activeTeam(requestedTeam))return render();
    const id="trade-"+Date.now().toString(36)+"-"+Math.random().toString(36).slice(2,7);
    const now=new Date().toISOString();
    proposals().unshift({id,requester,partner,offeredTeam,requestedTeam,status:"voting",createdAt:now,votes:{[requester]:"yes"},electorate:eligible(),needed:majority(),recordsAtProposal:{[offeredTeam]:record(offeredTeam),[requestedTeam]:record(requestedTeam)}});
    state.lastAction=requester+" proposed a trade with "+partner;
    saveState();render();
  }

  function voteRows(p){
    const voters=(p.electorate||eligible()).filter(n=>eligible().includes(n));
    return '<div class="trade-voters">'+voters.map(name=>{const v=p.votes?.[name]||"",locked=p.status!=="voting";return '<div class="trade-voter"><strong>'+esc(name)+'</strong><div><button type="button" data-trade-vote="'+esc(p.id)+'" data-voter="'+esc(name)+'" data-choice="yes" aria-pressed="'+(v==="yes")+'"'+(locked?' disabled':'')+'>Approve</button><button type="button" data-trade-vote="'+esc(p.id)+'" data-voter="'+esc(name)+'" data-choice="no" aria-pressed="'+(v==="no")+'"'+(locked?' disabled':'')+'>Reject</button></div></div>'}).join("")+'</div>';
  }
  function statusText(p){
    const yes=Object.values(p.votes||{}).filter(v=>v==="yes").length,no=Object.values(p.votes||{}).filter(v=>v==="no").length,need=p.needed||majority();
    if(p.status==="completed")return '<strong>TRADE COMPLETE</strong><span>'+esc(p.requester)+' banked '+(p.result?.requesterKept?.w??0)+' wins; '+esc(p.partner)+' banked '+(p.result?.partnerKept?.w??0)+' wins from these outgoing teams.</span>';
    if(p.status==="rejected")return '<strong>VOTE REJECTED</strong><span>'+no+' rejected · '+yes+' approved.</span>';
    if(p.status==="withdrawn")return '<strong>WITHDRAWN</strong><span>The teams stayed with their owners.</span>';
    if(p.status==="invalid")return '<strong>TRADE EXPIRED</strong><span>'+esc(p.error||"Team ownership changed before completion.")+'</span>';
    if(p.status==="processing")return '<strong>APPLYING TRADE…</strong><span>Refreshing the official records and locking the handover.</span>';
    return '<strong>'+yes+' / '+need+' approvals</strong><span>'+no+' rejection'+(no===1?"":"s")+' · majority of '+((p.electorate||eligible()).length)+' required</span>';
  }
  function proposalCard(p){
    const live=p.status==="voting";
    return '<article class="trade-proposal '+esc(p.status)+'" data-trade-id="'+esc(p.id)+'"><div class="trade-proposal-head"><div><small>'+new Intl.DateTimeFormat("en-AU",{timeZone:"Australia/Sydney",day:"numeric",month:"short",hour:"numeric",minute:"2-digit"}).format(new Date(p.createdAt))+'</small><h3>'+esc(p.requester)+' ↔ '+esc(p.partner)+'</h3></div><div class="trade-vote-status">'+statusText(p)+'</div></div>'+
      '<div class="trade-preview">'+compactTeam(p.offeredTeam,p.requester+" sends")+'<div class="trade-swap-mark" aria-hidden="true">⇄</div>'+compactTeam(p.requestedTeam,p.partner+" sends")+'</div>'+
      (live?voteRows(p):'')+(live?'<button type="button" class="trade-withdraw" data-trade-withdraw="'+esc(p.id)+'">Withdraw proposal</button>':'')+'</article>';
  }

  async function cast(id,voter,choice){
    const p=proposals().find(x=>x.id===id);if(!p||p.status!=="voting"||!(p.electorate||eligible()).includes(voter))return;
    p.votes[voter]=choice;
    const yes=Object.values(p.votes).filter(v=>v==="yes").length,no=Object.values(p.votes).filter(v=>v==="no").length,need=p.needed||majority();
    if(no>=need){p.status="rejected";p.resolvedAt=new Date().toISOString();state.lastAction="Trade vote rejected";saveState();render();return}
    if(yes<need){saveState();render();return}
    p.status="processing";render();
    try{
      await window.refreshCompetitionBoard?.(true);
      const result=window.cvCompetition?.executeTrade(p);if(!result)throw new Error("Competition data is not ready");
      p.status="completed";p.resolvedAt=result.at;
      p.result={requesterKept:result.offeredRecord,partnerKept:result.requestedRecord};
      state.lastAction=p.requester+" traded "+p.offeredTeam+" for "+p.requestedTeam;
      saveState();render();
    }catch(error){p.status="invalid";p.error=error?.message||"Trade could not be applied";p.resolvedAt=new Date().toISOString();saveState();render();}
  }

  function render(){
    normalise();const root=document.getElementById("tradeScreen");if(!root)return;
    const board=root.querySelector("#tradeBoard");if(!board)return;
    renderBuilder(root);
    const all=proposals();
    board.innerHTML=all.length?all.map(proposalCard).join(""):'<div class="trade-empty"><strong>No trades on the table.</strong><span>Build a one-for-one swap above and send it to the league for a majority vote.</span></div>';
    root.querySelectorAll("[data-trade-vote]").forEach(b=>b.addEventListener("click",()=>void cast(b.dataset.tradeVote,b.dataset.voter,b.dataset.choice)));
    root.querySelectorAll("[data-trade-withdraw]").forEach(b=>b.addEventListener("click",()=>{const p=proposals().find(x=>x.id===b.dataset.tradeWithdraw);if(p&&p.status==="voting"){p.status="withdrawn";p.resolvedAt=new Date().toISOString();saveState();render();}}));
  }

  function open(){document.body.classList.remove("teams-profile-view");showScreenLocal("tradeScreen");render();void window.refreshCompetitionBoard?.(false);window.scrollTo(0,0);}
  function renameOwner(from,to){
    normalise();
    const ledger=state.tradeLedger;
    if(ledger.banked?.[from]){ledger.banked[to]=ledger.banked[from];delete ledger.banked[from];}
    for(const epoch of Object.values(ledger.teams||{}))if(epoch.owner===from)epoch.owner=to;
    for(const event of ledger.events||[]){if(event.requester===from)event.requester=to;if(event.partner===from)event.partner=to;}
    for(const p of proposals()){if(p.requester===from)p.requester=to;if(p.partner===from)p.partner=to;p.electorate=(p.electorate||[]).map(n=>n===from?to:n);if(p.votes?.[from]){p.votes[to]=p.votes[from];delete p.votes[from];}}
  }
  window.openTradeDesk=open;
  window.cvTrades={render,renameOwner,cast};
})();
