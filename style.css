
/* ===== V1.5.52 - CORRECCION REAL: embarque como unica fuente de verdad ===== */
(function(){
  const ROUTE_KEY='elta_v1552_route_by_embarque';
  const OLD_KEYS=['eltaRouteFinalByTransitV1551','eltaRouteLockByEmbarqueV1550','routeLockV1549','eltaTrackingMetricsV1550'];
  let routeCache=null;
  let validating=false;
  let debounce=null;
  let busyStart=false;

  function $(id){ return document.getElementById(id); }
  function esc(s){
    try { return String(s ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }
    catch(e){ return ''; }
  }
  function getTransit(){ try { return typeof transit==='function' ? transit() : JSON.parse(localStorage.getItem((LS&&LS.transit)||'elta_transit')||'null'); } catch(e){ return null; } }
  function saveTransit(t){ try { if(typeof save==='function') save(LS.transit,t); else localStorage.setItem((LS&&LS.transit)||'elta_transit',JSON.stringify(t)); } catch(e){} }
  function nowIso(){ try { return typeof now==='function' ? now() : new Date().toISOString(); } catch(e){ return new Date().toISOString(); } }
  function isOpen(t){ return !!(t && !t.closed && String(t.estado||'abierto').toLowerCase()!=='cerrado' && t.start); }
  function setStore(k,v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} }
  function getStore(k){ try{ return JSON.parse(localStorage.getItem(k)||'null'); }catch(e){ return null; } }
  function clearOld(){ OLD_KEYS.forEach(k=>{try{localStorage.removeItem(k);}catch(e){}}); }

  function coord(v){
    if(!v) return null;
    if(typeof v==='object'){
      const lat=Number(v.lat ?? v.latitude), lng=Number(v.lng ?? v.lon ?? v.longitude);
      if(Number.isFinite(lat)&&Number.isFinite(lng)) return {lat,lng};
    }
    const nums=String(v).match(/-?\d+(?:\.\d+)?/g);
    if(nums && nums.length>=2){
      const lat=Number(nums[0]), lng=Number(nums[1]);
      if(Number.isFinite(lat)&&Number.isFinite(lng)) return {lat,lng};
    }
    return null;
  }
  function hav(a,b){
    if(!a||!b) return 0;
    const R=6371, dLat=(b.lat-a.lat)*Math.PI/180, dLng=(b.lng-a.lng)*Math.PI/180;
    const s1=Math.sin(dLat/2), s2=Math.sin(dLng/2);
    const q=s1*s1+Math.cos(a.lat*Math.PI/180)*Math.cos(b.lat*Math.PI/180)*s2*s2;
    return 2*R*Math.atan2(Math.sqrt(q),Math.sqrt(1-q));
  }
  function fmtKm(km){
    km=Number(km)||0;
    if(km>=100) return String(Math.round(km));
    if(km>=10) return String(Math.round(km));
    return km.toFixed(1).replace('.0','');
  }
  function eta(min){
    min=Math.max(0,Math.round(Number(min)||0));
    const h=Math.floor(min/60), m=min%60;
    return h ? `${h}h${m?` ${m}m`:''}` : `${m}m`;
  }
  async function osrm(a,b){
    const url=`https://router.project-osrm.org/route/v1/driving/${a.lng},${a.lat};${b.lng},${b.lat}?overview=full&geometries=geojson&steps=false&alternatives=false`;
    const res=await fetch(url);
    if(!res.ok) throw new Error('OSRM no disponible');
    const data=await res.json();
    if(!data.routes || !data.routes[0]) throw new Error('OSRM sin ruta');
    const r=data.routes[0];
    return {
      distanceKm:Number(r.distance||0)/1000,
      durationMin:Number(r.duration||0)/60,
      geometry:(r.geometry && r.geometry.coordinates ? r.geometry.coordinates : []).map(c=>({lat:Number(c[1]),lng:Number(c[0])})).filter(p=>Number.isFinite(p.lat)&&Number.isFinite(p.lng))
    };
  }
  async function docByIdOrName(col,name){
    if(!name || typeof firebaseReady!=='function' || !firebaseReady()) return null;
    const target=String(name).trim();
    try{
      const d=await db.collection(col).doc(target).get();
      if(d.exists) return {id:d.id, ...d.data()};
    }catch(e){}
    try{
      const s=await db.collection(col).get();
      for(const d of s.docs){
        const x=d.data()||{};
        const names=[d.id,x.nombre,x.name,x.origen,x.destino].map(v=>String(v||'').trim().toLowerCase());
        if(names.includes(target.toLowerCase())) return {id:d.id, ...x};
      }
    }catch(e){}
    return null;
  }
  async function embarqueDoc(num){
    if(!num || typeof firebaseReady!=='function' || !firebaseReady()) return null;
    const n=String(num).trim();
    try{
      const d=await db.collection('embarque').doc(n).get();
      if(d.exists) return {id:d.id, ...d.data()};
    }catch(e){}
    for(const f of ['embarque','numero']){
      try{
        const s=await db.collection('embarque').where(f,'==',n).limit(1).get();
        if(!s.empty){ const d=s.docs[0]; return {id:d.id, ...d.data()}; }
      }catch(e){}
    }
    return null;
  }
  async function buildRoute(num){
    const emb=await embarqueDoc(num);
    if(!emb) return null;
    const route={
      embarque:String(emb.embarque||emb.numero||num||'').trim(),
      embarqueId:emb.id||String(num),
      cliente:String(emb.cliente||'').trim(),
      origen:String(emb.origen||'').trim(),
      destino:String(emb.destino||'').trim()
    };
    if(!route.cliente || !route.origen || !route.destino) return null;
    const od=await docByIdOrName('origenes',route.origen);
    const dd=await docByIdOrName('destinos',route.destino);
    const o=coord(od && (od.ubicacion||od.coords||od.coordenadas||od.location));
    const d=coord(dd && (dd.ubicacion||dd.coords||dd.coordenadas||dd.location));
    if(o){ route.origen_lat=o.lat; route.origen_lng=o.lng; route.origenLat=o.lat; route.origenLng=o.lng; }
    if(d){ route.destino_lat=d.lat; route.destino_lng=d.lng; route.destinoLat=d.lat; route.destinoLng=d.lng; }
    if(o && d){
      try{
        const rr=await osrm(o,d);
        route.routeDistanceKm=rr.distanceKm;
        route.routeDurationMin=rr.durationMin;
        route.routeGeometry=rr.geometry;
      }catch(e){
        const km=hav(o,d);
        route.routeDistanceKm=km;
        route.routeDurationMin=Math.round(km/70*60);
        route.routeGeometry=[];
      }
    }
    return {embarque:emb,route};
  }
  function setSelectText(id,text){
    const el=$(id); if(!el || !text) return;
    const val=String(text).trim(), low=val.toLowerCase();
    el.disabled=false;
    let found=false;
    for(let i=0;i<el.options.length;i++){
      const t=String(el.options[i].textContent||el.options[i].innerText||el.options[i].value||'').trim().toLowerCase();
      if(t===low){ el.selectedIndex=i; el.value=el.options[i].value; found=true; break; }
    }
    if(!found){ const opt=document.createElement('option'); opt.value='firebase:'+val; opt.textContent=val; opt.dataset.lockedRoute='1'; el.appendChild(opt); el.value=opt.value; }
  }
  function disableRouteFields(disabled){
    ['clienteSelect','origenSelect','destinoSelect'].forEach(id=>{const el=$(id); if(el) el.disabled=!!disabled;});
  }
  function disableTransitInputs(open){
    ['lote','embarqueInput'].forEach(id=>{const el=$(id); if(el) el.disabled=!!open;});
  }
  function paintRoute(route){
    if(!route) return;
    setSelectText('clienteSelect',route.cliente);
    setSelectText('origenSelect',route.origen);
    setSelectText('destinoSelect',route.destino);
    disableRouteFields(true);
    const box=$('rutaInfo');
    if(box){
      const km=Number(route.routeDistanceKm||0);
      box.innerHTML=`<b>Distancia:</b> ${km?km.toFixed(1)+' km':'-'}<br><b>Destino:</b> ${esc(route.destino||'-')}`;
    }
  }
  function clearRoute(msg){
    routeCache=null; setStore(ROUTE_KEY,null); clearOld();
    ['clienteSelect','origenSelect','destinoSelect'].forEach(id=>{const el=$(id); if(el){el.disabled=false; el.selectedIndex=-1; el.value='';}});
    const box=$('rutaInfo'); if(box) box.innerHTML=`<b>Distancia:</b> -<br><b>Destino:</b> ${esc(msg||'-')}`;
  }
  async function validateNow(){
    const t=getTransit();
    const emb=(isOpen(t) && t.embarque) ? String(t.embarque).trim() : ($('embarqueInput') ? $('embarqueInput').value.trim() : '');
    if(!emb){ if(!isOpen(t)) clearRoute('-'); return null; }
    const requested=emb;
    const built=await buildRoute(requested);
    const actual=(isOpen(getTransit()) && getTransit().embarque) ? String(getTransit().embarque).trim() : ($('embarqueInput') ? $('embarqueInput').value.trim() : '');
    if(actual!==requested) return null;
    if(!built || !built.route){ if(!isOpen(getTransit())) clearRoute('Embarque no encontrado'); return null; }
    routeCache={...built.route};
    setStore(ROUTE_KEY,routeCache); clearOld();
    const current=getTransit();
    if(isOpen(current)){
      current.route={...routeCache}; current.routeDistanceKm=routeCache.routeDistanceKm||0; current.routeDurationMin=routeCache.routeDurationMin||0; current.routeGeometry=routeCache.routeGeometry||[]; saveTransit(current);
    }
    paintRoute(routeCache); return built;
  }
  function validateDebounced(){ clearTimeout(debounce); debounce=setTimeout(()=>validateNow().catch(e=>console.log('validate 1552',e)),250); }
  function activeRoute(){
    const t=getTransit();
    if(isOpen(t) && t.route && t.route.destino) return t.route;
    if(routeCache && routeCache.destino) return routeCache;
    const stored=getStore(ROUTE_KEY); if(stored && stored.destino){ routeCache=stored; return routeCache; }
    return null;
  }
  function currentGps(t){ return coord(t && t.updates && t.updates.length ? t.updates[t.updates.length-1].gps : t && t.start); }
  function renderInicioFinal(){
    const u=typeof user==='function' ? user() : {};
    const inp=$('inicioUser'); if(inp) inp.value=(u.fleet||'Sin flota')+' - '+(u.driver||'Sin chofer');
    const t=getTransit();
    if(isOpen(t)){
      if($('lote')) $('lote').value=t.lote||'';
      if($('embarqueInput')) $('embarqueInput').value=t.embarque||'';
      disableTransitInputs(true);
      validateNow().catch(e=>console.log(e));
    }else{
      disableTransitInputs(false);
      const emb=$('embarqueInput') ? $('embarqueInput').value.trim() : '';
      if(emb) validateNow().catch(e=>console.log(e));
    }
    try{ if(typeof aplicarColorResumenInicio==='function') aplicarColorResumenInicio(); }catch(e){}
  }
  function metrics(t){
    const r=activeRoute() || (t&&t.route) || null; if(!r) return null;
    const total=Number(t.routeDistanceKm||r.routeDistanceKm||0);
    const totalMin=Number(t.routeDurationMin||r.routeDurationMin||0);
    let done=0;
    const gps=currentGps(t), start=coord(t&&t.start);
    if((t.updates||[]).length>0 && gps && start){
      done=hav(start,gps);
      if(done < 0.3) done=0;
      if(total>0) done=Math.min(done,total);
    }
    const restan=Math.max(0,total-done);
    const avance=total>0?Math.max(0,Math.min(100,Math.round(done/total*100))):0;
    const etaMin=total>0 ? totalMin*(restan/total) : 0;
    return {total,restan,avance,etaMin,route:r,gps};
  }
  function renderCards(m){
    const box=$('trackingBox'); if(!box) return;
    if(!m){ box.innerHTML='<div class="statItem"><b>Sin tránsito</b><span>No hay tránsito iniciado</span></div>'; return; }
    box.innerHTML=`<div class="statItem"><b>${fmtKm(m.total)}</b><span>Total</span></div>`+
      `<div class="statItem"><b>${m.avance}%</b><span>Av.</span></div>`+
      `<div class="statItem"><b>${fmtKm(m.restan)}</b><span>Restan</span></div>`+
      `<div class="statItem"><b>${eta(m.etaMin)}</b><span>ETA</span></div>`;
  }
  function renderMap(t){
    if(typeof initLeafletMap!=='function') return;
    const map=initLeafletMap(); if(!map || typeof L==='undefined') return;
    try{ if(typeof clearLeafletLayers==='function') clearLeafletLayers(); }catch(e){}
    try{ if(typeof removeRouteLayer==='function') removeRouteLayer(); }catch(e){}
    try{ map.eachLayer(layer=>{ if(layer instanceof L.Polyline || layer instanceof L.CircleMarker || layer instanceof L.Marker){ try{map.removeLayer(layer);}catch(e){} } }); }catch(e){}
    if(!t){ map.setView([-34.6037,-58.3816],6,{animate:false}); return; }
    const r=activeRoute() || t.route || {};
    const o=coord({lat:r.origen_lat??r.origenLat,lng:r.origen_lng??r.origenLng});
    const d=coord({lat:r.destino_lat??r.destinoLat,lng:r.destino_lng??r.destinoLng});
    const g=currentGps(t);
    const geom=(t.routeGeometry||r.routeGeometry||[]).map(coord).filter(Boolean);
    if(geom.length>1) L.polyline(geom.map(p=>[p.lat,p.lng]),{color:'#2563eb',weight:6,opacity:.95,interactive:false}).addTo(map);
    if(o) L.circleMarker([o.lat,o.lng],{radius:9,color:'#fff',weight:2,fillColor:'#22c55e',fillOpacity:1}).addTo(map);
    if(g) L.circleMarker([g.lat,g.lng],{radius:11,color:'#fff',weight:2,fillColor:'#2f8cff',fillOpacity:1}).addTo(map);
    if(d) L.circleMarker([d.lat,d.lng],{radius:9,color:'#fff',weight:2,fillColor:'#ef4444',fillOpacity:1}).addTo(map);
    if(g) map.setView([g.lat,g.lng], Math.min(Math.max(map.getZoom?map.getZoom():13,13),15), {animate:false});
  }

  // Overrides after all previous code.
  window.renderInicio=renderInicioFinal;
  window.validarEmbarqueInicioV1544=validateDebounced; window.validarEmbarqueInicioV1545=validateDebounced; window.validarEmbarqueInicioV1546=validateDebounced; window.validarEmbarqueInicioV1547=validateDebounced; window.validarEmbarqueInicioV1548=validateDebounced; window.validarEmbarqueInicioV1549=validateDebounced; window.validarEmbarqueInicioV1550=validateDebounced; window.validarEmbarqueInicioV1551=validateDebounced; window.validarEmbarqueInicioV1552=validateDebounced;
  window.onClienteChange=validateDebounced; window.onOrigenDestinoChange=validateDebounced;
  window.selectedRoute=function(){ return activeRoute() || {}; };
  window.bloquearFormularioTransito=function(){ const open=isOpen(getTransit()); disableTransitInputs(open); disableRouteFields(open || !!activeRoute()); };
  window.renderTracking=function(){ const t=getTransit(); if(!t){ try{stopAutoGps();}catch(e){} renderCards(null); renderMap(null); return; } const m=metrics(t); renderCards(m); renderMap(t); try{startAutoGps();}catch(e){} };
  window.renderTrackingMap=renderMap;
  window.iniciarTransito=async function(){
    if(busy) return; busy=true;
    try{
      const existing=getTransit(); if(isOpen(existing)){ alert('Ya hay un tránsito iniciado sin cerrar. Primero debe cerrar el tránsito actual.'); if(typeof show==='function') show('tracking'); return; }
      const u=typeof user==='function'?user():{}; if(!u.fleet){ alert('Cargá la flota en Usuario.'); if(typeof show==='function') show('usuario'); return; }
      const lote=$('lote')?$('lote').value.trim():''; const emb=$('embarqueInput')?$('embarqueInput').value.trim():'';
      if(!lote){ alert('Ingresá número de lote/carga.'); return; } if(!emb){ alert('Ingresá número de embarque.'); return; }
      const built=await validateNow(); if(!built||!built.route){ clearRoute('Embarque no encontrado'); alert('El embarque no existe o no se pudo validar en Firebase.'); return; }
      const gps=await getGps(); const route={...built.route};
      const t={id:typeof regId==='function'?regId():('TPOD-'+Date.now()), user:u, route, lote, embarque:emb, start:gps, updates:[], alerts:[], closed:null, routeGeometry:route.routeGeometry||[], routeDistanceKm:route.routeDistanceKm||0, routeDurationMin:route.routeDurationMin||0};
      saveTransit(t); setStore(ROUTE_KEY,route); disableTransitInputs(true); paintRoute(route);
      try{ if(typeof firebaseReady==='function'&&firebaseReady()) await db.collection('transitos').doc(String(t.id)).set({ ...t, cliente:route.cliente, origen:route.origen, destino:route.destino, estado:'abierto', actualizadoEn:nowIso() },{merge:true}); }catch(e){}
      try{ if(typeof saveTransitHistory==='function') saveTransitHistory(t); }catch(e){}
      alert('Tránsito iniciado correctamente.'); if(typeof show==='function') show('tracking'); try{startAutoGps();}catch(e){}
    }catch(e){ alert('No se pudo iniciar tránsito: '+(e.message||e)); }
    finally{ setTimeout(()=>busy=false,800); }
  };
  const oldCerrar=window.cerrarTransito;
  window.cerrarTransito=async function(){
    const r=oldCerrar?await oldCerrar.apply(this,arguments):null;
    setTimeout(()=>{ const t=getTransit(); if(!isOpen(t)){ disableTransitInputs(false); disableRouteFields(false); routeCache=null; setStore(ROUTE_KEY,null); } },500);
    return r;
  };
  const oldShow=window.show;
  window.show=function(id){ if(oldShow) oldShow(id); if(id==='inicio') setTimeout(renderInicioFinal,150); if(id==='tracking') setTimeout(window.renderTracking,150); };
  document.addEventListener('DOMContentLoaded',()=>{
    const emb=$('embarqueInput'); if(emb){ emb.oninput=validateDebounced; emb.onchange=validateDebounced; emb.addEventListener('input',validateDebounced); emb.addEventListener('change',validateDebounced); }
    ['clienteSelect','origenSelect','destinoSelect'].forEach(id=>{ const el=$(id); if(el) el.onchange=validateDebounced; });
    setTimeout(renderInicioFinal,500);
  });
  setInterval(()=>{ const t=getTransit(); if(isOpen(t)||($('embarqueInput')&&$('embarqueInput').value.trim())) renderInicioFinal(); },500);
})();
