function nativeShareMessage(msg){
  const text=encodeURIComponent(String(msg||""));
  try{
    window.location.href=`trackpodshare://send?text=${text}`;
    return true;
  }catch(e){
    console.log("No se pudo invocar trackpodshare",e);
  }
  return false;
}


/* ===== FIRESTORE READ v1.4.77 ===== */
function firebaseReady(){
  try{
    if(typeof firebase==="undefined") return false;
    if(!firebase.apps.length){
      firebase.initializeApp(FIREBASE_CONFIG);
    }
    if(!db) db=firebase.firestore();
    cloudReady=true;
    return true;
  }catch(e){
    console.log("Firebase no disponible",e);
    return false;
  }
}

function normalizeCloudTransit(id,x){
  x=x||{};
  const route=x.route||x;
  const userObj=x.user||{fleet:x.flota||"",driver:x.chofer||""};
  return {
    id:x.id||id||"",
    user:userObj,
    route:route,
    lote:x.lote||x.carga||"",
    embarque:x.embarque||"",
    start:x.start||x.inicio||null,
    updates:x.updates||[],
    alerts:x.alerts||[],
    closed:x.closed||x.cierre||null,
    participantes:x.participantes||[],
    estado:x.estado||(x.closed||x.cierre?"cerrado":"abierto"),
    ultimaPosicion:x.ultimaPosicion||null,
    ultimaAlerta:x.ultimaAlerta||null
  };
}

function cloudDocToTransit(d){
  if(d && typeof d.data==="function") return normalizeCloudTransit(d.id,d.data());
  return normalizeCloudTransit(d && d.id,d||{});
}

function cloudCanSeeTransit(t){
  const u=currentCloudUser&&currentCloudUser();
  if(!u) return false;
  if(u.role==="manager") return true;

  const flota=String(u.flota||"");
  if(!flota) return false;

  const tFlota=String((t.user&&t.user.fleet)||t.flota||"");
  if(tFlota===flota) return true;

  const parts=(t.participantes||[]).map(String);
  if(parts.includes(flota)) return true;

  const emb=String(t.embarque||"");
  return cloudTransitosCache.some(x=>{
    const xf=String((x.user&&x.user.fleet)||x.flota||"");
    return xf===flota && String(x.embarque||"")===emb;
  });
}

function startCloudListener(){
  if(!firebaseReady()) return;
  if(cloudListening) return;
  cloudListening=true;

  try{
    if(cloudUnsub){
      try{cloudUnsub();}catch(e){}
      cloudUnsub=null;
    }

    cloudUnsub=db.collection("transitos").onSnapshot(snap=>{
      cloudTransitosCache=snap.docs.map(cloudDocToTransit);
      const visible=cloudTransitosCache.filter(cloudCanSeeTransit);
      const cur=transit();
      if(cur){
        const remote=visible.find(x=>x.id===cur.id);
        if(remote){
          // Mantener transit local sincronizado pero sin pisar si el local tiene más updates recién agregados
          const localUpdates=(cur.updates||[]).length;
          const remoteUpdates=(remote.updates||[]).length;
          if(remoteUpdates>=localUpdates) save(LS.transit,remote);
        }
      }
      if($("embarque") && !$("embarque").classList.contains("hidden")) renderEmbarque();
      if($("tracking") && !$("tracking").classList.contains("hidden")) renderTracking();
      cloudStatus && cloudStatus(`Cloud: ${currentCloudUser().user} (${currentCloudUser().role})`,true);
    },err=>{
      console.log("Firestore listener error",err);
      cloudStatus && cloudStatus("Cloud: sin permisos / error lectura",false);
    });
  }catch(e){
    console.log("startCloudListener error",e);
    cloudStatus && cloudStatus("Cloud: error listener",false);
  }
}

async function refreshEmbarquesCloud(){
  if(!firebaseReady()){
    window.alert("Firebase no está disponible.");
    return;
  }
  const u=currentCloudUser&&currentCloudUser();
  if(!u){
    window.alert("Debe ingresar en Acceso.");
    show("login");
    return;
  }
  try{
    const snap=await db.collection("transitos").get();
    cloudTransitosCache=snap.docs.map(cloudDocToTransit);
    renderEmbarque();
  }catch(e){
    window.alert("No se pudieron leer embarques: "+(e.message||e));
  }
}

function getTransitPool(){
  const local=[];
  try{
    if(typeof historyTransits==="function") local.push(...historyTransits());
    const cur=transit();
    if(cur) local.push(cur);
  }catch(e){}

  const all=local.concat(cloudTransitosCache||[]);
  const byId={};
  all.forEach(t=>{
    if(t && t.id) byId[t.id]=t;
  });
  return Object.values(byId);
}

const $ = id => document.getElementById(id);
let climaAutoLoading=false;
let climaLastUpdate=0;

const LS = {user:"trackpod_user", transit:"trackpod_transit", last:"trackpod_last", history:"trackpod_history", cloudUser:"trackpod_cloud_user"};

function load(k,f){try{return JSON.parse(localStorage.getItem(k)) ?? f}catch(e){return f}}
function save(k,v){localStorage.setItem(k,JSON.stringify(v))}
function fmtDate(v){return new Date(v).toLocaleString("es-AR")}

function fmtDateShort(v){
  const d=new Date(v);
  const dd=String(d.getDate()).padStart(2,"0");
  const mm=String(d.getMonth()+1).padStart(2,"0");
  const hh=String(d.getHours()).padStart(2,"0");
  const mi=String(d.getMinutes()).padStart(2,"0");
  return `${dd}/${mm} ${hh}:${mi}`;
}

function timeoutPromise(ms){
  return new Promise((_,reject)=>setTimeout(()=>reject(new Error("timeout")),ms));
}

async function localidadDesdeGpsRapida(gps){
  try{
    return await Promise.race([localidadDesdeGps(gps), timeoutPromise(1800)]);
  }catch(e){
    return "Localidad no disponible";
  }
}

async function localidadDesdeGps(gps){
  if(!gps || gps.lat==null || gps.lng==null) return "Ubicación no disponible";
  try{
    const url=`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${gps.lat}&lon=${gps.lng}&zoom=10&addressdetails=1`;
    const res=await fetch(url,{headers:{"Accept":"application/json"}});
    const data=await res.json();
    const a=data.address||{};
    const ciudad=a.city||a.town||a.village||a.municipality||a.county||a.state||"Localidad no identificada";
    const pais=a.country||"";
    return pais ? `${ciudad}, ${pais}` : ciudad;
  }catch(e){
    return "Localidad no disponible";
  }
}

function now(){return new Date().toISOString()}
function cleanPhone(p){return String(p||"").replace(/[^\d]/g,"")}
function user(){return load(LS.user,{fleet:"",driver:"",phones:""})}

function historyTransits(){return load(LS.history,[])}
function saveTransitHistory(t){
  if(!t || !t.id) return;
  const arr=historyTransits().filter(x=>x && x.id!==t.id);
  arr.push(t);
  // conservar últimos 150 registros locales
  save(LS.history,arr.slice(-150));
}

function sameLocalDay(a,b){
  if(!a||!b)return false;
  const da=new Date(a), db=new Date(b);
  return da.getFullYear()===db.getFullYear() && da.getMonth()===db.getMonth() && da.getDate()===db.getDate();
}

function todayTransitItemsByEmbarque(emb){
  const target=String(emb||"").trim();
  if(!target)return [];
  const today=now();
  const items=[];
  const current=transit();
  if(current && String(current.embarque||"").trim()===target && current.start && sameLocalDay(current.start.time,today)){
    items.push(current);
  }
  historyTransits().forEach(t=>{
    if(!t || !t.id)return;
    if(current && current.id===t.id)return;
    if(String(t.embarque||"").trim()!==target)return;
    if(t.start && sameLocalDay(t.start.time,today))items.push(t);
  });
  return items.sort((a,b)=>new Date(a.start&&a.start.time||0)-new Date(b.start&&b.start.time||0));
}

function lastGpsText(t){
  const g=(t && t.updates && t.updates.length) ? t.updates[t.updates.length-1].gps : (t ? (t.closed||t.start) : null);
  if(!g || g.lat==null || g.lng==null)return "-";
  return `${Number(g.lat).toFixed(5)}, ${Number(g.lng).toFixed(5)}`;
}

function lastAlertText(t){
  if(!t || !t.alerts || !t.alerts.length)return "-";
  const a=t.alerts[t.alerts.length-1];
  const km=typeof alertKmText==="function" ? alertKmText(t,a) : "";
  return `${a.type||"Alerta"}${km ? " - "+km : ""}`;
}

function currentEmbarqueValue(){
  const t=transit();
  if(t && t.embarque)return t.embarque;
  const el=$("embarque");
  return el ? el.value.trim() : "";
}

function renderEmbarque(){
  const title=$("embarqueFiltro");
  const box=$("embarqueList");
  if(!box)return;

  const u=currentCloudUser&&currentCloudUser();
  const selectedEmb=currentEmbarqueValue ? currentEmbarqueValue() : "";
  const all=getTransitPool ? getTransitPool() : [];
  let items=all.filter(t=>t && t.id);

  if(u){
    items=items.filter(cloudCanSeeTransit);
  }

  // Manager ve todos. Si hay embarque escrito en Inicio/Fin, se usa como filtro opcional.
  if(selectedEmb){
    items=items.filter(t=>String(t.embarque||"").trim()===String(selectedEmb).trim());
  }

  items.sort((a,b)=>{
    const ea=String(a.embarque||"");
    const eb=String(b.embarque||"");
    if(ea!==eb) return ea.localeCompare(eb);
    const fa=String((a.user&&a.user.fleet)||"");
    const fb=String((b.user&&b.user.fleet)||"");
    return fa.localeCompare(fb);
  });

  if(title){
    title.innerText=selectedEmb
      ? `Filtro: ${selectedEmb} (${items.length})`
      : `Todos visibles (${items.length})`;
  }

  if(!u){
    box.innerHTML='<div class="emptyBox">Ingrese en 🔐 Acceso para ver embarques Cloud.</div>';
    return;
  }

  if(!items.length){
    box.innerHTML='<div class="emptyBox">No hay tránsitos visibles en Firebase. Use Actualizar embarques o inicie un tránsito.</div>';
    return;
  }

  box.innerHTML=items.map(t=>{
    const cerrado=!!t.closed || t.estado==="cerrado";
    const flota=escapeHtml((t.user&&t.user.fleet)||t.flota||"-");
    const chofer=escapeHtml((t.user&&t.user.driver)||t.chofer||"");
    const emb=escapeHtml(t.embarque||"-");
    const lote=escapeHtml(t.lote||"-");
    const cliente=escapeHtml((t.route&&t.route.cliente)||t.cliente||"-");
    const destino=escapeHtml((t.route&&t.route.destino)||t.destino||"-");
    const inicio=escapeHtml(fmtDateShort(t.start&&t.start.time||t.start));
    const cierre=cerrado ? escapeHtml(fmtDateShort(t.closed&&t.closed.time||t.closed)) : "-";
    const pos=escapeHtml(lastGpsText(t));
    const alerta=escapeHtml(lastAlertText(t));

    return `<div class="embarqueItem ${cerrado?'closed':'open'}" onclick="abrirTransitoCloud('${escapeHtml(t.id)}')">
      <div class="embTop"><b>Emb. ${emb} / Flota ${flota}</b><span>${cerrado?'Cerrado':'Abierto'}</span></div>
      <div>Chofer: ${chofer || "-"}</div>
      <div>Lote/Carga: ${lote}</div>
      <div>Cliente: ${cliente}</div>
      <div>Destino: ${destino}</div>
      <div>Inicio: ${inicio}</div>
      <div>Cierre: ${cierre}</div>
      <div>Últ. posición: ${pos}</div>
      <div>Últ. alerta: ${alerta}</div>
    </div>`;
  }).join("");
}

function abrirTransitoCloud(id){
  const t=(getTransitPool?getTransitPool():[]).find(x=>x.id===id);
  if(!t) return;
  save(LS.transit,t);
  window.alert("Tránsito cargado en Tracking.");
  show("tracking");
}


function transit(){return load(LS.transit,null)}
function escapeHtml(s){return String(s||"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[m]))}

function show(id){
  const views=["usuario","inicio","tracking","embarque","alertas","clima","ultimo"];
  const buttons=["btn-usuario","btn-inicio","btn-tracking","btn-embarque","btn-alertas","btn-clima","btn-ultimo"];

  views.forEach(v=>{
    const e=$(v);
    if(e){
      if(v===id) e.classList.remove("hidden");
      else e.classList.add("hidden");
    }
  });

  buttons.forEach(b=>{
    const e=$(b);
    if(e) e.classList.remove("active");
  });

  const active=$("btn-"+id);
  if(active) active.classList.add("active");

  if(id==="inicio") renderInicio();
  if(id==="tracking") renderTracking();
  if(id==="alertas") renderAlertas();
  if(id==="clima") renderClima();
  if(id==="usuario") loadUserForm();
  if(id==="embarque"){ renderEmbarque(); refreshEmbarquesCloud(); }
  if(id==="ultimo") renderUltimo();
}

function initSelectors(){
  const cliente=$("clienteSelect");
  const origen=$("origenSelect");
  const destino=$("destinoSelect");

  if(cliente) cliente.innerHTML=CLIENTES_DATA.map((c,i)=>`<option value="${i}">${escapeHtml(c.cliente)}</option>`).join("\n");
  if(origen) origen.innerHTML=ORIGENES_DATA.map((o,i)=>`<option value="${i}">${escapeHtml(o.nombre)}</option>`).join("\n");
  if(destino) destino.innerHTML=DESTINOS_DATA.map((d,i)=>`<option value="${i}">${escapeHtml(d.nombre)}</option>`).join("\n");

  onClienteChange();
}

function onClienteChange(){
  const cliente=$("clienteSelect");
  const destino=$("destinoSelect");
  if(!cliente || !destino){return;}

  const c=CLIENTES_DATA[cliente.value];
  if(c && c.destino_sugerido){
    const idx=DESTINOS_DATA.findIndex(d=>d.nombre.trim().toLowerCase()===c.destino_sugerido.trim().toLowerCase());
    if(idx>=0) destino.value=String(idx);
  }
  onOrigenDestinoChange();
}

function selectedRoute(){
  const c=CLIENTES_DATA[$("clienteSelect")?.value]||{};
  const o=ORIGENES_DATA[$("origenSelect")?.value]||{};
  const d=DESTINOS_DATA[$("destinoSelect")?.value]||{};
  return {
    cliente:c.cliente||"",
    origen:o.nombre||"",
    origen_lat:o.lat,
    origen_lng:o.lng,
    origen_pais:o.pais,
    destino:d.nombre||"",
    destino_lat:d.lat,
    destino_lng:d.lng,
    destino_pais:d.pais
  };
}

function destinoCompacto(route){
  const pais=route.destino_pais || "";
  const localidad=route.destino || "";
  return (pais && localidad) ? `${pais} - ${localidad}` : (pais || localidad || "");
}

function aplicarColorResumenInicio(){
  const box=$("rutaInfo");
  if(!box) return;
  const t=transit();
  const activo=!!(t && !t.closed);
  box.classList.remove("rutaActiva","rutaInactiva");
  box.classList.add(activo ? "rutaActiva" : "rutaInactiva");
}

function onOrigenDestinoChange(){
  const r=selectedRoute();
  const km=distanciaRuta(r);
  const box=$("rutaInfo");
  if(box){
    box.innerHTML=
      `<b>Distancia:</b> ${km.toFixed(1)} km<br>`+
      `<b>Destino:</b> ${escapeHtml(destinoCompacto(r))}`;
  }
  aplicarColorResumenInicio();
}

function renderTransitStatus(){
  // Estado visual removido de Inicio/Fin por pedido.
  aplicarColorResumenInicio();
}

function bloquearFormularioTransito(){
  const t=transit();
  const bloqueado=!!(t && !t.closed);
  ["clienteSelect","origenSelect","destinoSelect","lote","embarque"].forEach(id=>{
    const e=$(id);
    if(e) e.disabled=bloqueado;
  });
}

function limpiarCamposInicio(){
  const lote=$("lote");
  if(lote) lote.value="";

  const cliente=$("clienteSelect");
  const origen=$("origenSelect");
  const destino=$("destinoSelect");

  if(cliente) cliente.selectedIndex=0;
  if(origen) origen.selectedIndex=0;
  if(destino) destino.selectedIndex=0;

  onClienteChange();
}

function renderInicio(){
  const u=user();
  const inp=$("inicioUser");
  if(inp) inp.value=(u.fleet||"Sin flota")+" - "+(u.driver||"Sin chofer");

  const t=transit();
  if(t && $("lote")) $("lote").value=t.lote||"";
  if(t && $("embarqueInput")) $("embarqueInput").value=t.embarque||"";

  renderTransitStatus();
  aplicarColorResumenInicio();
  bloquearFormularioTransito();
}

function getGps(){
  return new Promise((resolve,reject)=>{
    if(!navigator.geolocation){reject(new Error("GPS no disponible"));return;}
    navigator.geolocation.getCurrentPosition(
      p=>resolve({lat:p.coords.latitude,lng:p.coords.longitude,acc:p.coords.accuracy||0,time:now()}),
      e=>reject(e),
      {enableHighAccuracy:true,timeout:20000,maximumAge:0}
    );
  });
}

async function iniciarTransito(){
  const abierto=transit();

  if(abierto && !abierto.closed){
    window.alert("Ya hay un tránsito iniciado sin cerrar. Primero debe cerrar el tránsito actual.");
    show("tracking");
    return;
  }

  const u=user();
  if(!u.fleet){
    window.alert("Cargá la flota en Usuario.");
    show("usuario");
    return;
  }

  const loteEl=$("lote");
  const lote=loteEl ? loteEl.value.trim() : "";
  if(!lote){
    window.alert("Ingresá número de lote/carga.");
    return;
  }

  const embEl=$("embarqueInput");
  const embarque=embEl ? embEl.value.trim() : "";
  if(!embarque){
    window.alert("Ingresá número de embarque.");
    return;
  }

  try{
    const gps=await getGps();
    const t={
      id:regId(),
      user:u,
      route:selectedRoute(),
      lote:lote,
      embarque:embarque,
      start:gps,
      updates:[],
      alerts:[],
      closed:null
    };

    save(LS.transit,t);
    saveTransitHistory(t);
    bloquearFormularioTransito();
    renderTransitStatus();
    aplicarColorResumenInicio();
    window.alert("Tránsito iniciado correctamente.");
    show("tracking");
    startAutoGps();

  }catch(e){
    window.alert("No se pudo tomar GPS de inicio: "+(e.message||e));
  }
}

async function cerrarTransito(){
  const t=transit();
  if(!t){
    window.alert("No hay tránsito iniciado.");
    return;
  }

  try{
    const gps=await getGps();

    if(!confirm("¿Desea confirmar la entrega y cerrar tránsito?")) return;

    t.closed=gps;
    const msg=await buildCierreMsgAsync(t);
    save(LS.last,{msg,date:now()});
    saveTransitHistory(t);

    localStorage.removeItem(LS.transit);
    stopAutoGps();
    limpiarCamposInicio();
    bloquearFormularioTransito();
    renderTransitStatus();
    aplicarColorResumenInicio();

    sendToPhones(msg);
    window.alert("Tránsito cerrado.");
    show("inicio");

  }catch(e){
    window.alert("No se pudo cerrar tránsito: "+(e.message||e));
  }
}

/* ===== MAPA REAL ===== */
let gpsWatchId=null;
let gpsAutoTimer=null;
let lastAutoGpsAt=0;

let leafletMap=null;
let leafletLayers=[];
let routeLayer=null;
let routeCacheKey="";
let routeLoadingKey="";



function gpsDistanceMeters(a,b){
  if(!a||!b||a.lat==null||b.lat==null)return Infinity;
  return distKm(a.lat,a.lng,b.lat,b.lng)*1000;
}

function stopAutoGps(){
  if(gpsWatchId!==null){
    try{navigator.geolocation.clearWatch(gpsWatchId);}catch(e){}
    gpsWatchId=null;
  }
  if(gpsAutoTimer){
    clearInterval(gpsAutoTimer);
    gpsAutoTimer=null;
  }
}

function guardarGpsAutomatico(gps){
  const t=transit();
  if(!t)return;

  if(!t.updates)t.updates=[];
  const last=t.updates.length?t.updates[t.updates.length-1].gps:t.start;
  const moved=gpsDistanceMeters(last,gps);
  const nowMs=Date.now();

  if(moved>=50 || (nowMs-lastAutoGpsAt)>=15000 || !t.updates.length){
    t.updates.push({gps,time:now()});
    lastAutoGpsAt=nowMs;
    save(LS.transit,t);
    renderTracking();
  }
}

function startAutoGps(){
  const t=transit();
  if(!t){
    stopAutoGps();
    return;
  }

  if(!navigator.geolocation){
    window.alert("GPS no disponible.");
    return;
  }

  if(gpsWatchId!==null)return;

  gpsWatchId=navigator.geolocation.watchPosition(
    p=>{
      const gps={
        lat:p.coords.latitude,
        lng:p.coords.longitude,
        acc:p.coords.accuracy||0,
        time:now()
      };
      guardarGpsAutomatico(gps);
    },
    e=>{
      console.log("GPS watch error",e);
    },
    {enableHighAccuracy:true,timeout:20000,maximumAge:5000}
  );

  gpsAutoTimer=setInterval(async ()=>{
    const t=transit();
    if(!t){
      stopAutoGps();
      return;
    }
    try{
      const gps=await getGps();
      guardarGpsAutomatico(gps);
    }catch(e){
      console.log("GPS timer error",e);
    }
  },15000);
}

function clearLeafletLayers(){
  if(!leafletMap) return;
  leafletLayers.forEach(layer=>{try{leafletMap.removeLayer(layer);}catch(e){}});
  leafletLayers=[];
}


function addLeafletLayer(layer){
  if(!leafletMap) return layer;
  layer.addTo(leafletMap);
  leafletLayers.push(layer);
  return layer;
}

function initLeafletMap(){
  const mapDiv=$("realMap");
  if(!mapDiv || typeof L==="undefined") return null;

  if(!leafletMap){
    leafletMap=L.map("realMap",{zoomControl:true,attributionControl:true}).setView([-34.6037,-58.3816],6);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png",{
      maxZoom:19,
      attribution:"© OpenStreetMap"
    }).addTo(leafletMap);
  }

  setTimeout(()=>{try{leafletMap.invalidateSize();}catch(e){}},250);
  return leafletMap;
}

function renderTracking(){
  const t=transit();

  if(!t){
    stopAutoGps();
    const box=$("trackingBox");
    if(box) box.innerHTML='<div class="statItem"><b>Sin tránsito</b><span>No hay tránsito iniciado</span></div>';
    renderTrackingMap(null);
    return;
  }

  const total=distanciaRuta(t.route);
  const current=t.updates&&t.updates.length?t.updates[t.updates.length-1].gps:t.start;
  const done=Math.min(total,distKm(t.start.lat,t.start.lng,current.lat,current.lng));
  const pct=total?Math.min(100,Math.round(done/total*100)):0;
  const faltan=Math.max(0,total-done);

  const box=$("trackingBox");
  if(box){
    box.innerHTML=
`<div class="statItem"><b>${shortKm(total)}</b><span>Total</span></div>
 <div class="statItem"><b>${pct}%</b><span>Av.</span></div>
 <div class="statItem"><b>${shortKm(faltan)}</b><span>Restan</span></div>
 <div class="statItem"><b>${shortEta(faltan)}</b><span>ETA</span></div>`;
  }

  renderTrackingMap(t);
  startAutoGps();
}

async function getRoadRoute(origin,dest){
  try{
    if(!origin || !dest) return null;
    if(!isFinite(origin.lat)||!isFinite(origin.lng)||!isFinite(dest.lat)||!isFinite(dest.lng)) return null;

    const url=`https://router.project-osrm.org/route/v1/driving/${origin.lng},${origin.lat};${dest.lng},${dest.lat}?overview=full&geometries=geojson`;
    const res=await fetch(url);
    const data=await res.json();

    if(data && data.routes && data.routes[0] && data.routes[0].geometry && data.routes[0].geometry.coordinates){
      return data.routes[0].geometry.coordinates.map(c=>[c[1],c[0]]);
    }
  }catch(e){
    console.log("OSRM route error",e);
  }
  return null;
}

function drawFallbackLine(origin,cur,dest){
  const line=[];
  if(origin&&isFinite(origin.lat)&&isFinite(origin.lng)) line.push([origin.lat,origin.lng]);
  if(cur&&isFinite(cur.lat)&&isFinite(cur.lng)) line.push([cur.lat,cur.lng]);
  if(dest&&isFinite(dest.lat)&&isFinite(dest.lng)) line.push([dest.lat,dest.lng]);

  if(line.length>=2){
    addLeafletLayer(L.polyline(line,{color:"#64748b",weight:4,opacity:.55,dashArray:"8,8"}));
  }
}



function routeKey(origin,dest){
  if(!origin||!dest) return "";
  return `${Number(origin.lat).toFixed(6)},${Number(origin.lng).toFixed(6)}-${Number(dest.lat).toFixed(6)},${Number(dest.lng).toFixed(6)}`;
}

function removeRouteLayer(){
  if(routeLayer && leafletMap){
    try{leafletMap.removeLayer(routeLayer);}catch(e){}
  }
  routeLayer=null;
  routeCacheKey="";
  routeLoadingKey="";
}

function setRouteLayer(layer,key){
  if(!leafletMap || !layer) return;
  if(routeLayer){try{leafletMap.removeLayer(routeLayer);}catch(e){}}
  routeLayer=layer;
  routeCacheKey=key;
  routeLoadingKey="";
  routeLayer.addTo(leafletMap);
}

function ensureRoadRouteLayer(origin,dest){
  if(!leafletMap || !origin || !dest || !isFinite(origin.lat) || !isFinite(origin.lng) || !isFinite(dest.lat) || !isFinite(dest.lng)) return;
  const key=routeKey(origin,dest);
  if(!key) return;
  if(routeLayer && routeCacheKey===key) return;
  if(routeLoadingKey===key) return;

  if(routeLayer && routeCacheKey!==key) removeRouteLayer();
  routeLoadingKey=key;

  getRoadRoute(origin,dest).then(routePoints=>{
    if(routeKey(origin,dest)!==key) return;
    if(routePoints && routePoints.length>=2){
      setRouteLayer(L.polyline(routePoints,{color:"#1d4ed8",weight:5,opacity:.9,interactive:false}),key);
    }else{
      const line=[[origin.lat,origin.lng],[dest.lat,dest.lng]];
      setRouteLayer(L.polyline(line,{color:"#94a3b8",weight:4,opacity:.45,dashArray:"8,8",interactive:false}),key);
    }
  }).catch(e=>{
    console.log("Route layer error",e);
    routeLoadingKey="";
  });
}

function renderTrackingMap(t){
  const map=initLeafletMap();
  if(!map) return;

  clearLeafletLayers();

  if(!t || !t.route || !t.start){
    removeRouteLayer();
    window.lastTrackingMapKey="";
    window.lastTrackingMapCenter=null;
    map.setView([-34.6037,-58.3816],6,{animate:false});
    return;
  }

  const origin={lat:Number(t.route.origen_lat||t.start.lat),lng:Number(t.route.origen_lng||t.start.lng)};
  const dest={lat:Number(t.route.destino_lat),lng:Number(t.route.destino_lng)};
  const current=t.updates&&t.updates.length?t.updates[t.updates.length-1].gps:t.start;
  const cur={lat:Number(current.lat),lng:Number(current.lng)};
  const alerts=(t.alerts||[]).map(a=>a.gps).filter(Boolean).map(g=>({lat:Number(g.lat),lng:Number(g.lng)})).filter(p=>isFinite(p.lat)&&isFinite(p.lng));

  ensureRoadRouteLayer(origin,dest);

  const bounds=[];

  if(isFinite(origin.lat)&&isFinite(origin.lng)){
    bounds.push([origin.lat,origin.lng]);
    addLeafletLayer(L.circleMarker([origin.lat,origin.lng],{radius:9,color:"#fff",weight:2,fillColor:"#22c55e",fillOpacity:1}).bindPopup("Origen"));
  }

  if(isFinite(cur.lat)&&isFinite(cur.lng)){
    bounds.push([cur.lat,cur.lng]);
    addLeafletLayer(L.circleMarker([cur.lat,cur.lng],{radius:11,color:"#fff",weight:2,fillColor:"#2f8cff",fillOpacity:1}).bindPopup("Última ubicación GPS"));
  }

  if(isFinite(dest.lat)&&isFinite(dest.lng)){
    bounds.push([dest.lat,dest.lng]);
    addLeafletLayer(L.circleMarker([dest.lat,dest.lng],{radius:9,color:"#fff",weight:2,fillColor:"#ef4444",fillOpacity:1}).bindPopup("Destino"));
  }

  alerts.forEach((a,i)=>{
    bounds.push([a.lat,a.lng]);
    addLeafletLayer(L.circleMarker([a.lat,a.lng],{radius:8,color:"#fff",weight:2,fillColor:"#f59e0b",fillOpacity:1}).bindPopup("Alerta "+(i+1)));
  });

  const key=routeKey(origin,dest);
  const firstRoute=window.lastTrackingMapKey!==key;
  window.lastTrackingMapKey=key;

  // Evita el efecto de parpadeo/salto: la ruta no se reencuadra en cada GPS.
  // Solo se encuadra al cambiar el tránsito/ruta; luego se acompaña suavemente al camión.
  if(firstRoute && bounds.length>=2){
    map.fitBounds(bounds,{padding:[28,28],maxZoom:12,animate:false});
    window.lastTrackingMapCenter=isFinite(cur.lat)&&isFinite(cur.lng)?{lat:cur.lat,lng:cur.lng}:null;
    return;
  }

  if(isFinite(cur.lat)&&isFinite(cur.lng)){
    const last=window.lastTrackingMapCenter;
    const moved=!last || distKm(last.lat,last.lng,cur.lat,cur.lng)>0.35;
    if(moved){
      const z=Math.max(map.getZoom()||12,12);
      map.setView([cur.lat,cur.lng],Math.min(z,14),{animate:false});
      window.lastTrackingMapCenter={lat:cur.lat,lng:cur.lng};
    }
  }else if(bounds.length===1){
    map.setView(bounds[0],12,{animate:false});
  }
}


async function actualizarGps(){
  const t=transit();
  if(!t){
    window.alert("No hay tránsito iniciado.");
    renderTracking();
    return;
  }
  try{
    const gps=await getGps();
    guardarGpsAutomatico(gps);
  }catch(e){
    window.alert("No se pudo actualizar GPS: "+(e.message||e));
  }
}

async function enviarActualizacion(){
  const t=transit();
  if(!t){
    window.alert("No hay tránsito iniciado.");
    return;
  }

  const btn=document.querySelector('button[onclick="enviarActualizacion()"]');
  if(btn){
    btn.disabled=true;
    btn.innerText="Enviando...";
  }

  try{
    const updated=transit();
    let msg="";

    try{
      msg=typeof buildUpdateMsgAsync==="function"
        ? await buildUpdateMsgAsync(updated)
        : buildUpdateMsg(updated);
    }catch(eMsg){
      console.log("Fallo mensaje completo, usando fallback",eMsg);
      msg=typeof buildBasicUpdateMsg==="function" ? buildBasicUpdateMsg(updated) : "🚚 Actualización de tránsito";
    }

    if(!msg || !String(msg).trim()){
      msg=typeof buildBasicUpdateMsg==="function" ? buildBasicUpdateMsg(updated) : "🚚 Actualización de tránsito";
    }

    save(LS.last,{msg,date:now()});
    sendToPhones(msg);

  }catch(e){
    console.log("Error enviando actualización",e);
    const fallbackMsg="🚚 Actualización de tránsito";
    save(LS.last,{msg:fallbackMsg,date:now()});
    sendToPhones(fallbackMsg);
  }finally{
    if(btn){
      btn.disabled=false;
      btn.innerText="📤 Enviar actualización";
    }
  }
}

/* ===== ALERTAS ===== */
function alertKm(t,a){
  try{
    if(!t || !t.start || !a || !a.gps) return null;
    const km=distKm(Number(t.start.lat),Number(t.start.lng),Number(a.gps.lat),Number(a.gps.lng));
    return isFinite(km) ? Math.max(0,km) : null;
  }catch(e){return null;}
}

function alertKmText(t,a){
  const km=alertKm(t,a);
  return km===null ? "" : `Km ${Math.round(km)}`;
}

async function registrarAlerta(){
  const t=transit();
  if(!t){
    window.alert("No hay tránsito iniciado.");
    return;
  }

  try{
    const gps=await getGps();
    const alerta={type:$("alertType").value,detail:"",gps,time:now()};
    t.alerts.push(alerta);
    save(LS.transit,t);
    saveTransitHistory(t);
    renderAlertas();
    window.alert("Alerta registrada.");
  }catch(e){
    window.alert("No se pudo registrar alerta: "+(e.message||e));
  }
}

function renderAlertas(){
  const t=transit();
  const box=$("alertList");
  if(!box) return;
  if(!t||!t.alerts.length){
    box.innerText="Sin alertas registradas.";
    return;
  }
  box.innerHTML=t.alerts.map(a=>{
    const km=alertKmText(t,a);
    const kmHtml=km ? ` <span>${escapeHtml(km)}</span>` : "";
    return `<div class="alertItem">⚠ <b>${escapeHtml(a.type)}</b>${kmHtml}<br>${fmtDate(a.time)}</div>`;
  }).join("\n");
}


/* ===== USUARIO / ÚLTIMO ===== */
function loadUserForm(){
  const u=user();
  if($("userFleet")) $("userFleet").value=u.fleet||"";
  if($("userDriver")) $("userDriver").value=u.driver||"";
  if($("userPhones")) $("userPhones").value=u.phones||"";
}

function saveUser(){
  save(LS.user,{fleet:$("userFleet").value.trim(),driver:$("userDriver").value.trim(),phones:$("userPhones").value.trim()});
  const msg=$("userMsg");
  if(msg) msg.innerHTML='<p class="ok">Usuario guardado correctamente.</p>';
  renderInicio();
  setTimeout(()=>show("inicio"),300);
}

function renderUltimo(){
  const last=load(LS.last,null);
  const box=$("lastBox");
  if(!box) return;
  box.innerText=last ? (last.msg||"No hay envíos registrados.") : "No hay envíos registrados.";
}
function limpiarResumenUltimo(msg){
  const texto=String(msg||"");
  const lineas=texto.split("\n").map(x=>x.trim()).filter(Boolean);

  const get = key => {
    const line=lineas.find(x=>x.startsWith(key));
    return line ? line.replace(key,"").trim() : "";
  };

  const alertas=get("Alertas ocurridas:") || "Sin alertas";

  return `Registro: ${get("Registro:")}

Flota: ${get("Flota:")}
Chofer: ${get("Chofer:")}

Cliente: ${get("Cliente:")}
Destino: ${get("Destino:")}

Salida:
${get("Fecha y hora de salida:")}

Llegada:
${get("Fecha y hora de llegada:")}

Tiempo tránsito:
${get("Tiempo de tránsito:")}

Alertas:
${alertas}`;
}

function reenviarUltimo(){
  const last=load(LS.last,null);
  if(!last){
    window.alert("No hay último envío.");
    return;
  }
  sendToPhones(last.msg);
}

/* ===== MENSAJES ===== */
async function buildUpdateMsgAsync(t){
  const total=distanciaRuta(t.route);
  const current=t.updates.length?t.updates[t.updates.length-1].gps:t.start;
  const done=distKm(t.start.lat,t.start.lng,current.lat,current.lng);
  const faltan=Math.max(0,total-done);
  const ubicacion=await localidadDesdeGpsRapida(current);

  return `🚚 Actualización de tránsito

🚛 Flota: ${t.user.fleet}
👤 Chofer: ${t.user.driver}

🏢 Cliente: ${t.route.cliente}

📦 Número de carga: ${t.lote}

📍 Ub.: ${ubicacion}

🎯 Destino: ${t.route.destino}

🛣️ Km. Faltantes: ${faltan.toFixed(1)} km
⏱️ ETA: ${calcEta(faltan)}

⚠️ Alertas ocurridas:
${formatAlertsMultiline(t)}`;
}

function buildUpdateMsg(t){
  const current=t.updates.length?t.updates[t.updates.length-1].gps:t.start;
  const total=distanciaRuta(t.route);
  const done=distKm(t.start.lat,t.start.lng,current.lat,current.lng);
  const faltan=Math.max(0,total-done);

  return `🚚 Actualización de tránsito

🚛 Flota: ${t.user.fleet}
👤 Chofer: ${t.user.driver}

🏢 Cliente: ${t.route.cliente}

📦 Número de carga: ${t.lote}

📍 Ub.: consultando localidad GPS

🎯 Destino: ${t.route.destino}

🛣️ Km. Faltantes: ${faltan.toFixed(1)} km
⏱️ ETA: ${calcEta(faltan)}

⚠️ Alertas ocurridas:
${formatAlertsMultiline(t)}`;
}

async function buildCierreMsgAsync(t){
  const total=distanciaRuta(t.route);
  const llegada=await localidadDesdeGpsRapida(t.closed);

  return `🏁 Cierre de tránsito

🚛 Flota: ${t.user.fleet}
👤 Chofer: ${t.user.driver}

🏢 Cliente: ${t.route.cliente}

📦 Número de carga: ${t.lote}

📍 Origen: ${t.route.origen}
🎯 Destino: ${t.route.destino}

🏁 Llegada: ${llegada}

🕒 Salida: ${fmtDateShort(t.start.time)}
🏁 Llegada hora: ${fmtDateShort(t.closed.time)}

🛣️ Distancia: ${total.toFixed(1)} km
⏱️ T.Time: ${duration(t.start.time,t.closed.time)}

⚠️ Alertas ocurridas:
${formatAlertsMultiline(t)}`;
}

function buildCierreMsg(t){
  const total=distanciaRuta(t.route);

  return `🏁 Cierre de tránsito

🚛 Flota: ${t.user.fleet}
👤 Chofer: ${t.user.driver}

🏢 Cliente: ${t.route.cliente}

📦 Número de carga: ${t.lote}

📍 Origen: ${t.route.origen}
🎯 Destino: ${t.route.destino}

🕒 Salida: ${fmtDateShort(t.start.time)}
🏁 Llegada hora: ${fmtDateShort(t.closed.time)}

🛣️ Distancia: ${total.toFixed(1)} km
⏱️ T.Time: ${duration(t.start.time,t.closed.time)}

⚠️ Alertas ocurridas:
${formatAlertsMultiline(t)}`;
}

function formatAlerts(t){
  if(!t.alerts||!t.alerts.length)return "Sin alertas";
  return t.alerts.map(a=>`${a.type} ${alertKmText(t,a)} ${fmtDateShort(a.time)}`.replace(/\s+/g," ").trim()).join(" | ");
}

function formatAlertsMultiline(t){
  if(!t.alerts||!t.alerts.length)return "Sin alertas";
  return t.alerts.map(a=>`• ${a.type} ${alertKmText(t,a)} ${fmtDateShort(a.time)}`.replace(/\s+/g," ").trim()).join("\n");
}

function openWhatsappSelector(msg){
  // Sin teléfono guardado: abrir selector nativo Android.
  if(nativeShareMessage(msg)) return;

  const text=encodeURIComponent(String(msg||""));
  try{
    window.location.href=`https://api.whatsapp.com/send?text=${text}`;
  }catch(e){
    console.log("No se pudo abrir WhatsApp",e);
  }
}

function sendToPhones(msg){
  const u=user();
  const phones=String(u.phones||"").split(/[,;\n\r]+/).map(cleanPhone).filter(Boolean);

  save(LS.last,{msg,date:now()});

  const text=encodeURIComponent(String(msg||""));

  if(phones.length>0){
    const phone=phones[0];
    window.location.href=`https://wa.me/${phone}?text=${text}`;
    return;
  }

  // Si NO hay teléfono guardado, NO cancelar:
  // abrir selector de Android para elegir contacto o grupo.
  openWhatsappSelector(msg);
}





/* ===== CLIMA ===== */
function renderClima(){
  const n=$("weatherNow"), f=$("weatherForecast"), p=$("passStatus"), a=$("passAlerts");

  if(n && !n.dataset.loaded){
    n.innerHTML='<div class="weatherIconBig">🌤️</div><div class="weatherMainNew"><div class="weatherTempNew">--°</div><div class="weatherDescNew">Consultando clima...</div><div class="weatherLocNew">Según posición GPS</div></div>';
  }
  if(f && !f.innerHTML.trim()) f.innerHTML='<div class="forecastEmpty">Consultando pronóstico...</div>';
  if(p && !p.dataset.loaded) p.innerHTML='Consultando situación del paso...';
  if(a && !a.dataset.loaded) a.innerHTML='Consultando alertas...';

  const ahora=Date.now();
  const debeActualizar=!climaLastUpdate || (ahora-climaLastUpdate)>300000;

  if(debeActualizar && !climaAutoLoading){
    actualizarClima();
  }
}

function weatherCodeText(code){
  code=Number(code);
  if(code===0)return"Despejado";
  if([1,2,3].includes(code))return"Parcialmente nublado";
  if([45,48].includes(code))return"Niebla";
  if([51,53,55,56,57].includes(code))return"Llovizna";
  if([61,63,65,66,67].includes(code))return"Lluvia";
  if([71,73,75,77].includes(code))return"Nieve";
  if([80,81,82].includes(code))return"Chaparrones";
  if([85,86].includes(code))return"Nevadas";
  if([95,96,99].includes(code))return"Tormenta";
  return"Condición "+code;
}

function weatherIcon(code){
  code=Number(code);
  if(code===0)return"☀️";
  if([1,2].includes(code))return"🌤️";
  if(code===3)return"☁️";
  if([45,48].includes(code))return"🌫️";
  if([51,53,55,56,57].includes(code))return"🌦️";
  if([61,63,65,66,67,80,81,82].includes(code))return"🌧️";
  if([71,73,75,77,85,86].includes(code))return"❄️";
  if([95,96,99].includes(code))return"⛈️";
  return"🌤️";
}

async function obtenerLocalidadGps(lat,lng){
  try{
    const url=`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=10&addressdetails=1`;
    const r=await fetch(url,{headers:{"Accept":"application/json"}});
    const data=await r.json();
    const a=data.address||{};
    const ciudad=a.city||a.town||a.village||a.municipality||a.county||a.state||"Ubicación actual";
    const pais=a.country||"";
    return pais ? `${ciudad}, ${pais}` : ciudad;
  }catch(e){
    return "Ubicación actual";
  }
}

async function actualizarClima(){
  if(climaAutoLoading) return;
  climaAutoLoading=true;

  const n=$("weatherNow"), f=$("weatherForecast"), p=$("passStatus"), a=$("passAlerts");

  if(n)n.innerHTML='<div class="weatherIconBig">⏳</div><div class="weatherMainNew"><div class="weatherTempNew">--°</div><div class="weatherDescNew">Consultando clima...</div><div class="weatherLocNew">Tomando GPS</div></div>';
  if(f)f.innerHTML='<div class="forecastEmpty">Consultando pronóstico...</div>';
  if(p)p.innerHTML='Consultando situación del paso...';
  if(a)a.innerHTML='Consultando alertas...';

  try{
    const gps=await getGps();
    await cargarClimaGps(gps.lat,gps.lng);
  }catch(e){
    if(n)n.innerHTML='<div class="weatherIconBig">⚠️</div><div class="weatherMainNew"><div class="weatherTempNew">--°</div><div class="weatherDescNew">No se pudo obtener GPS</div><div class="weatherLocNew">'+escapeHtml(e.message||e)+'</div></div>';
  }

  try{
    await consultarPasoCristoRedentor();
  }catch(e){
    console.log("Error consultando paso",e);
  }

  climaLastUpdate=Date.now();
  climaAutoLoading=false;
}

async function cargarClimaGps(lat,lng){
  const n=$("weatherNow"), f=$("weatherForecast");
  const localidad=await obtenerLocalidadGps(lat,lng);

  const url=`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,wind_gusts_10m&hourly=temperature_2m,precipitation_probability,weather_code,wind_speed_10m&forecast_hours=72&timezone=auto`;
  const r=await fetch(url);
  const data=await r.json();

  if(data.current&&n){
    const c=data.current;
    n.dataset.loaded="1";
    n.innerHTML=`<div class="weatherIconBig">${weatherIcon(c.weather_code)}</div><div class="weatherMainNew"><div class="weatherTopLine"><div><div class="weatherDescNew">${weatherCodeText(c.weather_code)}</div><div class="weatherLocNew">📍 ${escapeHtml(localidad)}</div></div><div class="weatherTempNew">${Math.round(c.temperature_2m)}°</div></div><div class="weatherMetaNew">Sens. ${Math.round(c.apparent_temperature)}° · Viento ${Math.round(c.wind_speed_10m)} km/h</div></div>`;
  }

  if(data.hourly&&f){
    const h=data.hourly;
    const rows=[];
    for(let i=0;i<Math.min(72,h.time.length);i+=24){
      const end=Math.min(i+24,h.time.length);
      const temps=h.temperature_2m.slice(i,end).map(Number);
      const codes=h.weather_code.slice(i,end).map(Number);
      const winds=h.wind_speed_10m.slice(i,end).map(Number);
      const max=Math.round(Math.max(...temps));
      const min=Math.round(Math.min(...temps));
      const wind=Math.round(Math.max(...winds.filter(x=>isFinite(x)),0));
      const code=codes[Math.floor(codes.length/2)]||codes[0];
      const dt=new Date(h.time[i]);
      const day=dt.toLocaleString("es-AR",{weekday:"short",day:"2-digit"});
      rows.push(`<div class="forecastRowNew oneLineForecast"><span class="forecastDayNew">${day}</span><span class="forecastIconNew">${weatherIcon(code)}</span><span class="forecastCondNew">${weatherCodeText(code)}</span><span class="forecastTempNew">${max}°/${min}°</span><span class="forecastRainNew">💨${wind}</span></div>`);
    }
    f.innerHTML=rows.join("\n");
  }
}

function detectarEstadoPaso(texto){
  const t=String(texto||"").toLowerCase();

  if(
    t.includes("cerrado") ||
    t.includes("cierre preventivo") ||
    t.includes("no habilitado") ||
    t.includes("suspendido") ||
    t.includes("interrumpido")
  ){
    return {label:"CERRADO",cls:"passClosedOrange",icon:"🟠"};
  }

  if(
    t.includes("habilitado") ||
    t.includes("abierto") ||
    t.includes("transitable") ||
    t.includes("restablece el tránsito")
  ){
    return {label:"ABIERTO",cls:"passOpenGreen",icon:"🟢"};
  }

  return {label:"VERIFICAR",cls:"passClosedOrange",icon:"🟠"};
}

function extraerAlertasPaso(texto){
  const t=String(texto||"").toLowerCase();
  const checks=[
    ["nieve","Posible nieve o acumulación en alta montaña"],
    ["nevadas","Posibles nevadas"],
    ["viento","Viento fuerte en alta montaña"],
    ["cadenas","Uso obligatorio o recomendado de cadenas"],
    ["hielo","Presencia de hielo en calzada"],
    ["precauc","Transitar con precaución"],
    ["restric","Restricciones de circulación"],
    ["demora","Posibles demoras"],
    ["cerrado","Paso cerrado o con cierre informado"],
    ["camiones","Restricción o control para camiones"]
  ];
  const out=[];
  checks.forEach(([k,m])=>{if(t.includes(k)&&!out.includes(m))out.push(m)});
  return out;
}

function limpiarTextoPaso(txt){
  return String(txt||"")
    .replace(/<script[\s\S]*?<\/script>/gi," ")
    .replace(/<style[\s\S]*?<\/style>/gi," ")
    .replace(/<[^>]+>/g," ")
    .replace(/\s+/g," ")
    .trim();
}

function recortarPaso(texto){
  const low=texto.toLowerCase();
  let idx=low.indexOf("comunicamos");
  if(idx<0)idx=low.indexOf("sistema integrado cristo redentor");
  if(idx<0)idx=low.indexOf("sistema cristo redentor");
  if(idx<0)idx=low.indexOf("los libertadores");
  if(idx<0)idx=low.indexOf("estado");
  return (idx>=0?texto.substring(idx,idx+520):texto.substring(0,520));
}

async function consultarPasoCristoRedentor(){
  const box=$("passStatus"), alertsBox=$("passAlerts");
  if(!box)return;

  const fuentes=[
    {url:"https://www.gobernacionlosandes.gov.cl/libertadoreshtml/", nombre:"Gobernación Los Andes"},
    {url:"https://ncfloslibertadores.cl/", nombre:"Complejo Los Libertadores"},
    {url:"https://www.argentina.gob.ar/seguridad/pasosinternacionales/detalle/ruta/29/Sistema-Cristo-Redentor", nombre:"Argentina.gob.ar"}
  ];

  let texto="";
  let fuenteUsada="Fuente oficial";
  for(const fuente of fuentes){
    try{
      const proxy="https://api.allorigins.win/raw?url="+encodeURIComponent(fuente.url);
      const res=await fetch(proxy);
      const raw=await res.text();
      const plain=limpiarTextoPaso(raw);
      if(plain && plain.length>100){
        texto=plain;
        fuenteUsada=fuente.nombre;
        break;
      }
    }catch(e){}
  }

  if(!texto){
    box.innerHTML='<div class="passStateNew passClosedOrange"><b>🟠 PASO VERIFICAR</b><span>No se pudo consultar automáticamente.</span></div>';
    if(alertsBox)alertsBox.innerHTML='<div class="passAlertItem">• No se pudo consultar alertas automáticamente.</div>';
    return;
  }

  const ext=recortarPaso(texto);
  const estado=detectarEstadoPaso(ext);
  const alertas=extraerAlertasPaso(ext);
  const actualizado=new Date().toLocaleString("es-AR");

  box.dataset.loaded="1";
  box.innerHTML=`<div class="passStateNew ${estado.cls}">
      <b>${estado.icon} PASO ${estado.label}</b>
      <span>${fuenteUsada} · Actualizado ${actualizado}</span>
    </div>`;

  if(alertsBox){
    alertsBox.dataset.loaded="1";
    alertsBox.innerHTML=alertas.length
      ? alertas.map(x=>`<div class="passAlertItem">• ${escapeHtml(x)}</div>`).join("")
      : `<div class="passOkItem">✓ Sin alertas informadas por la consulta automática.</div>`;
  }
}

function abrirPasoArgentina(){window.location.href="https://www.argentina.gob.ar/seguridad/pasosinternacionales/detalle/ruta/29/Sistema-Cristo-Redentor";}
function abrirPasoChile(){window.location.href="https://www.gobernacionlosandes.gov.cl/libertadoreshtml/";}

/* ===== CÁLCULOS ===== */
function regId(){
  const d=new Date();
  return "TPOD-"+d.getFullYear()+String(d.getMonth()+1).padStart(2,"0")+String(d.getDate()).padStart(2,"0")+"-"+String(d.getHours()).padStart(2,"0")+String(d.getMinutes()).padStart(2,"0")+String(d.getSeconds()).padStart(2,"0");
}

function distKm(a,b,c,d){
  if(a==null||b==null||c==null||d==null)return 0;
  const R=6371,toRad=x=>x*Math.PI/180;
  const dLat=toRad(c-a),dLng=toRad(d-b);
  const s=Math.sin(dLat/2)**2+Math.cos(toRad(a))*Math.cos(toRad(c))*Math.sin(dLng/2)**2;
  return R*2*Math.atan2(Math.sqrt(s),Math.sqrt(1-s));
}

function distanciaRuta(r){
  return distKm(r.origen_lat,r.origen_lng,r.destino_lat,r.destino_lng);
}

function shortKm(km){
  if(km == null || !isFinite(km)) return "0";
  if(km >= 1000) return (km/1000).toFixed(1)+"k";
  return Math.round(km)+"";
}

function shortEta(km){
  const speed=70;
  const mins=Math.round((km/speed)*60);
  const h=Math.floor(mins/60);
  const m=mins%60;
  if(h<=0) return `${m}m`;
  return `${h}h${m>0 ? " "+m+"m" : ""}`;
}

function calcEta(km){
  const speed=70,mins=Math.round((km/speed)*60);
  return `${Math.floor(mins/60)} h ${mins%60} min`;
}

function duration(a,b){
  const ms=new Date(b)-new Date(a),mins=Math.max(0,Math.round(ms/60000));
  const d=Math.floor(mins/1440),h=Math.floor((mins%1440)/60),m=mins%60;
  return `${d} días, ${h} horas, ${m} minutos`;
}

document.addEventListener("DOMContentLoaded",()=>{
  initSelectors();
  show("inicio");
});


/* ===== FIREBASE CLOUD / PERMISOS v1.4.75 ===== */
const FIREBASE_CONFIG = {"apiKey": "AIzaSyDFk_mPN0r_LLHhS3HeQ2yfbfvHZJ2h2mU", "authDomain": "elta-track-pod.firebaseapp.com", "projectId": "elta-track-pod", "storageBucket": "elta-track-pod.firebasestorage.app", "messagingSenderId": "993768926683", "appId": "1:993768926683:web:8a14e6af8706154a96cbfe", "measurementId": "G-9FSMKJ8KL0"};
let db=null;
let cloudReady=false;
let cloudUser=null;
let cloudUnsub=null;
let cloudCache=[];

function cloudUserKey(v){return String(v||"").trim().toLowerCase().replace(/[^a-z0-9_@.-]/g,"_")}
function cloudStatus(txt,ok){const e=$("cloudStatus"); if(e){e.innerText=txt; e.className="cloudStatus "+(ok?"ok":"bad");}}
function currentCloudUser(){return cloudUser || load("trackpod_cloud_user",null)}

function initFirebaseCloud(){
  try{
    if(typeof firebase==="undefined"){cloudStatus("Cloud: Firebase no cargado",false);return false;}
    if(!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
    db=firebase.firestore(); cloudReady=true;
    const saved=load("trackpod_cloud_user",null);
    if(saved){cloudUser=saved; cloudStatus(`Cloud: ${saved.user} (${saved.role})`,true); startCloudListener();}
    else cloudStatus("Cloud: listo - ingresar",true);
    return true;
  }catch(e){console.log("Firebase init",e); cloudStatus("Cloud: error",false); return false;}
}

async function crearUsuarioInicial(){
  if(!db && !initFirebaseCloud())return;
  try{
    await db.collection("usuarios").doc("manager").set({user:"manager",pass:"elta2026",role:"manager",flota:"",activo:true,createdAt:new Date().toISOString()},{merge:true});
    const msg=$("loginMsg"); if(msg) msg.innerHTML='<p class="ok">Manager inicial creado: manager / elta2026</p>';
  }catch(e){window.alert("No se pudo crear manager inicial: "+(e.message||e));}
}

async function loginCloud(){
  if(!db && !initFirebaseCloud())return;
  const u=cloudUserKey($("loginUser")&&$("loginUser").value);
  const p=($("loginPass")&&$("loginPass").value)||"";
  if(!u||!p){window.alert("Ingresá usuario y clave.");return;}
  try{
    const doc=await db.collection("usuarios").doc(u).get();
    if(!doc.exists){window.alert("Usuario no existe.");return;}
    const d=doc.data()||{};
    if(!d.activo){window.alert("Usuario inactivo.");return;}
    if(String(d.pass||"")!==p){window.alert("Clave incorrecta.");return;}
    cloudUser={user:u,role:d.role||"flota",flota:String(d.flota||""),activo:true};
    save("trackpod_cloud_user",cloudUser);
    cloudStatus(`Cloud: ${cloudUser.user} (${cloudUser.role})`,true);
    startCloudListener(); show("inicio");
  }catch(e){window.alert("Error de acceso: "+(e.message||e));}
}

function logoutCloud(){localStorage.removeItem("trackpod_cloud_user"); cloudUser=null; if(cloudUnsub){try{cloudUnsub();}catch(e){} cloudUnsub=null;} cloudCache=[]; cloudStatus("Cloud: desconectado",false); show("login");}

function canSeeTransit(t){
  const u=currentCloudUser(); if(!u)return false;
  if(u.role==="manager")return true;
  const f=String(u.flota||""); if(!f)return false;
  if(String(t.user&&t.user.fleet||t.flota||"")===f)return true;
  return (t.participantes||[]).map(String).includes(f);
}

function toCloudDoc(t){
  const u=t.user||{}; const r=t.route||{};
  const current=(t.updates&&t.updates.length)?t.updates[t.updates.length-1].gps:(t.closed||t.start||null);
  const parts=Array.from(new Set([String(u.fleet||""),...((t.participantes||[]).map(String))].filter(Boolean)));
  return {id:t.id,user:u,route:r,flota:u.fleet||"",chofer:u.driver||"",lote:t.lote||"",embarque:t.embarque||"",estado:t.closed?"cerrado":"abierto",start:t.start||null,closed:t.closed||null,updates:t.updates||[],alerts:t.alerts||[],ultimaPosicion:current,ultimaAlerta:(t.alerts&&t.alerts.length)?t.alerts[t.alerts.length-1]:null,participantes:parts,updatedAt:new Date().toISOString()};
}
function fromCloudDoc(doc){const x=doc.data?doc.data():doc; return {id:x.id||doc.id,user:x.user||{fleet:x.flota||"",driver:x.chofer||""},route:x.route||{},lote:x.lote||"",embarque:x.embarque||"",start:x.start||null,closed:x.closed||null,updates:x.updates||[],alerts:x.alerts||[],participantes:x.participantes||[]};}
async function cloudSaveTransit(t){if(!db||!t||!t.id)return; try{await db.collection("transitos").doc(t.id).set(toCloudDoc(t),{merge:true});}catch(e){console.log("cloudSaveTransit",e); cloudStatus("Cloud: error guardando",false);}}
function transitPool(){const arr=[]; const cur=transit(); if(cur)arr.push(cur); try{arr.push(...historyTransits());}catch(e){} arr.push(...cloudCache); const by={}; arr.forEach(t=>{if(t&&t.id&&(!currentCloudUser()||canSeeTransit(t)))by[t.id]=t;}); return Object.values(by);}
function startCloudListener(){
  if(!db||cloudUnsub)return;
  cloudUnsub=db.collection("transitos").onSnapshot(snap=>{
    cloudCache=snap.docs.map(fromCloudDoc).filter(canSeeTransit);
    if($("embarque") && !$('embarque').classList.contains('hidden')) renderEmbarque();
    if($("tracking") && !$('tracking').classList.contains('hidden')) renderTracking();
  },e=>{console.log("listener",e); cloudStatus("Cloud: sin permisos/error",false);});
}

const showLocalBase=show;
show=function(id){
  const views=["usuario","inicio","tracking","embarque","alertas","clima","ultimo"];
  const buttons=["btn-login","btn-inicio","btn-tracking","btn-alertas","btn-clima","btn-usuario","btn-embarque","btn-ultimo"];
  views.forEach(v=>{const e=$(v); if(e){if(v===id)e.classList.remove("hidden"); else e.classList.add("hidden");}});
  buttons.forEach(b=>{const e=$(b); if(e)e.classList.remove("active");});
  const active=$("btn-"+id); if(active)active.classList.add("active");
  if(id==="inicio") renderInicio();
  if(id==="tracking") renderTracking();
  if(id==="alertas") renderAlertas();
  if(id==="clima") renderClima();
  if(id==="usuario") loadUserForm();
  if(id==="embarque"){ renderEmbarque(); refreshEmbarquesCloud(); }
  if(id==="ultimo") renderUltimo();
  if(id==="login"){const u=currentCloudUser(); const m=$("loginMsg"); if(u&&m)m.innerHTML=`<p class="ok">Conectado: ${u.user} (${u.role}) <button onclick="logoutCloud()">Salir</button></p>`;}
}

const iniciarTransitoLocal=iniciarTransito;
iniciarTransito=async function(){
  await iniciarTransitoLocal();
  const t=transit(); if(t){if(!t.participantes)t.participantes=[String(t.user&&t.user.fleet||"")].filter(Boolean); saveTransitHistory(t); cloudSaveTransit(t);}
}
const cerrarTransitoLocal=cerrarTransito;
cerrarTransito=async function(){const t=transit(); await cerrarTransitoLocal(); if(t){t.closed=t.closed||{time:now()}; saveTransitHistory(t); cloudSaveTransit(t);}}
const registrarAlertaLocal=registrarAlerta;
registrarAlerta=async function(){await registrarAlertaLocal(); const t=transit(); if(t){saveTransitHistory(t); cloudSaveTransit(t);}}
const guardarGpsAutomaticoLocal=guardarGpsAutomatico;
guardarGpsAutomatico=function(gps){guardarGpsAutomaticoLocal(gps); const t=transit(); if(t)cloudSaveTransit(t);}

const renderEmbarqueLocal=renderEmbarque;
renderEmbarque=function(){
  const emb=currentEmbarqueValue(); const title=$("embarqueFiltro"); const box=$("embarqueList"); if(!box){return;}
  if(title) title.innerText=emb?emb:"Todos los visibles";
  let items=transitPool().filter(t=>t.start&&sameLocalDay(t.start.time,now()));
  if(emb)items=items.filter(t=>String(t.embarque||"").trim()===String(emb).trim());
  if(!items.length){box.innerHTML='<div class="emptyBox">Leyendo embarques abiertos...</div>';return;}
  items.sort((a,b)=>String(a.embarque||"").localeCompare(String(b.embarque||""))||new Date(a.start&&a.start.time||0)-new Date(b.start&&b.start.time||0));
  box.innerHTML=items.map(t=>{const cerrado=!!t.closed;return `<div class="embarqueItem ${cerrado?'closed':'open'}"><div class="embTop"><b>Emb. ${escapeHtml(t.embarque||'-')} / Flota ${escapeHtml(t.user&&t.user.fleet||'-')}</b><span>${cerrado?'Cerrado':'Abierto'}</span></div><div>Inicio: ${escapeHtml(fmtDateShort(t.start&&t.start.time))}</div><div>Cierre: ${cerrado?escapeHtml(fmtDateShort(t.closed.time)):'-'}</div><div>Últ. posición: ${escapeHtml(lastGpsText(t))}</div><div>Últ. alerta: ${escapeHtml(lastAlertText(t))}</div></div>`;}).join('');
}
setTimeout(()=>initFirebaseCloud(),800);



/* ===== FIX FINAL EMBARQUE FIRESTORE v1.4.78 ===== */
function tpodFirebaseReady(){
  try{
    if(typeof firebase==="undefined"){
      const d=$("embarqueDebug");
      if(d)d.innerText="Firebase SDK no cargó. Revisar conexión a Internet.";
      return false;
    }
    if(typeof FIREBASE_CONFIG!=="undefined" && !firebase.apps.length){
      firebase.initializeApp(FIREBASE_CONFIG);
    }
    db=firebase.firestore();
    cloudReady=true;
    return true;
  }catch(e){
    console.log("tpodFirebaseReady error",e);
    const d=$("embarqueDebug");
    if(d)d.innerText="Error Firebase: "+(e.message||e);
    return false;
  }
}

function tpodNormDate(v){
  if(!v)return null;
  try{
    if(v.toDate)return v.toDate();
    if(v.seconds)return new Date(v.seconds*1000);
    if(typeof v==="string" || typeof v==="number")return new Date(v);
    if(v.time)return tpodNormDate(v.time);
  }catch(e){}
  return null;
}

function tpodDateText(v){
  const d=tpodNormDate(v);
  if(!d || isNaN(d.getTime()))return "-";
  const dd=String(d.getDate()).padStart(2,"0");
  const mm=String(d.getMonth()+1).padStart(2,"0");
  const hh=String(d.getHours()).padStart(2,"0");
  const mi=String(d.getMinutes()).padStart(2,"0");
  return `${dd}/${mm} ${hh}:${mi}`;
}

function normalizeCloudTransit(id,x){
  x=x||{};
  const route=x.route||{};
  const userObj=x.user||{fleet:x.flota||"",driver:x.chofer||""};

  return {
    id:x.id||id||"",
    user:userObj,
    route:{
      ...route,
      cliente:route.cliente||x.cliente||"",
      origen:route.origen||x.origen||"",
      destino:route.destino||x.destino||"",
      origen_lat:route.origen_lat||x.origen_lat,
      origen_lng:route.origen_lng||x.origen_lng,
      destino_lat:route.destino_lat||x.destino_lat,
      destino_lng:route.destino_lng||x.destino_lng
    },
    lote:x.lote||x.carga||"",
    embarque:x.embarque||"",
    start:x.start||x.inicio||null,
    updates:x.updates||[],
    alerts:x.alerts||[],
    closed:x.closed||x.cierre||null,
    participantes:x.participantes||[],
    estado:x.estado||(x.closed||x.cierre?"cerrado":"abierto"),
    ultimaPosicion:x.ultimaPosicion||null,
    ultimaAlerta:x.ultimaAlerta||null,
    flota:x.flota||userObj.fleet||"",
    chofer:x.chofer||userObj.driver||""
  };
}

function cloudDocToTransit(d){
  if(d && typeof d.data==="function")return normalizeCloudTransit(d.id,d.data());
  return normalizeCloudTransit(d&&d.id,d||{});
}

function currentCloudUser(){
  return cloudUser || load(LS.cloudUser,null);
}

function cloudCanSeeTransit(t){
  const u=currentCloudUser();
  if(!u)return false;
  if(u.role==="manager")return true;

  const flota=String(u.flota||"");
  if(!flota)return false;

  const tFlota=String((t.user&&t.user.fleet)||t.flota||"");
  if(tFlota===flota)return true;

  const parts=(t.participantes||[]).map(String);
  if(parts.includes(flota))return true;

  const emb=String(t.embarque||"");
  return (cloudTransitosCache||[]).some(x=>{
    const xf=String((x.user&&x.user.fleet)||x.flota||"");
    return xf===flota && String(x.embarque||"")===emb;
  });
}

function lastGpsText(t){
  const g=(t&&t.ultimaPosicion) || ((t&&t.updates&&t.updates.length)?t.updates[t.updates.length-1].gps:(t?(t.closed||t.start):null));
  if(!g || g.lat==null || g.lng==null)return "-";
  return `${Number(g.lat).toFixed(5)}, ${Number(g.lng).toFixed(5)}`;
}

function lastAlertText(t){
  const a=(t&&t.ultimaAlerta) || ((t&&t.alerts&&t.alerts.length)?t.alerts[t.alerts.length-1]:null);
  if(!a)return "-";
  const km=typeof alertKmText==="function" ? alertKmText(t,a) : "";
  return `${a.type||"Alerta"}${km ? " - "+km : ""}`;
}

function getTransitPool(){
  const byId={};

  try{
    (cloudTransitosCache||[]).forEach(t=>{if(t&&t.id)byId[t.id]=t;});
  }catch(e){}

  try{
    const cur=transit();
    if(cur&&cur.id)byId[cur.id]=cur;
  }catch(e){}

  try{
    if(typeof historyTransits==="function"){
      historyTransits().forEach(t=>{if(t&&t.id && !byId[t.id])byId[t.id]=t;});
    }
  }catch(e){}

  return Object.values(byId);
}

async function refreshEmbarquesCloud(){
  const dbg=$("embarqueDebug");
  if(dbg)dbg.innerText="Leyendo Firestore...";

  if(!tpodFirebaseReady()){
    if(dbg)dbg.innerText="No se pudo iniciar Firebase.";
    return;
  }

  const u=currentCloudUser();
  if(!u){
    if(dbg)dbg.innerText="Debe ingresar en Acceso.";
    show("login");
    return;
  }

  try{
    const snap=await db.collection("transitos").get();
    cloudTransitosCache=snap.docs.map(cloudDocToTransit);
    if(dbg)dbg.innerText=`Leídos ${cloudTransitosCache.length} tránsitos de Firebase.`;
    renderEmbarque();
  }catch(e){
    console.log("refreshEmbarquesCloud error",e);
    if(dbg)dbg.innerText="Error leyendo Firestore: "+(e.message||e);
  }
}

function startCloudListener(){
  if(!tpodFirebaseReady())return;
  const u=currentCloudUser();
  if(!u)return;

  try{
    if(cloudUnsub){try{cloudUnsub();}catch(e){}}
    cloudUnsub=db.collection("transitos").onSnapshot(snap=>{
      cloudTransitosCache=snap.docs.map(cloudDocToTransit);
      const dbg=$("embarqueDebug");
      if(dbg)dbg.innerText=`Firebase conectado. Tránsitos: ${cloudTransitosCache.length}`;
      if($("embarque") && !$("embarque").classList.contains("hidden"))renderEmbarque();
    },e=>{
      const dbg=$("embarqueDebug");
      if(dbg)dbg.innerText="Error listener Firestore: "+(e.message||e);
    });
    cloudListening=true;
  }catch(e){
    const dbg=$("embarqueDebug");
    if(dbg)dbg.innerText="Error listener: "+(e.message||e);
  }
}

function renderEmbarque(){
  const title=$("embarqueFiltro");
  const box=$("embarqueList");
  const dbg=$("embarqueDebug");
  if(!box)return;

  const u=currentCloudUser();
  if(!u){
    if(title)title.innerText="Sin usuario Cloud";
    if(dbg)dbg.innerText="Ingrese en Acceso.";
    box.innerHTML='<div class="emptyBox">Ingrese en 🔐 Acceso para ver embarques.</div>';
    return;
  }

  if(tpodFirebaseReady() && (!cloudTransitosCache || !cloudTransitosCache.length)){
    // Ejecuta lectura automática al entrar a la vista
    db.collection("transitos").get().then(snap=>{
      cloudTransitosCache=snap.docs.map(cloudDocToTransit);
      const d=$("embarqueDebug");
      if(d)d.innerText=`Leídos ${cloudTransitosCache.length} tránsitos de Firebase.`;
      renderEmbarque();
    }).catch(e=>{
      const d=$("embarqueDebug");
      if(d)d.innerText="Error leyendo Firebase: "+(e.message||e);
    });
  }

  const selectedEmb="";
  let items=getTransitPool().filter(t=>t&&t.id);

  // Manager ve todo. Flota ve sólo permitidos.
  items=items.filter(cloudCanSeeTransit);

  if(selectedEmb){
    items=items.filter(t=>String(t.embarque||"").trim()===String(selectedEmb).trim());
  }

  items.sort((a,b)=>{
    const ea=String(a.embarque||"");
    const eb=String(b.embarque||"");
    if(ea!==eb)return ea.localeCompare(eb);
    const fa=String((a.user&&a.user.fleet)||a.flota||"");
    const fb=String((b.user&&b.user.fleet)||b.flota||"");
    return fa.localeCompare(fb);
  });

  if(title)title.innerText=`Todos visibles (${items.length})`;

  if(!items.length){
    box.innerHTML='<div class="emptyBox">No hay tránsitos visibles. Tocá Actualizar embarques.</div>';
    return;
  }

  box.innerHTML=items.map(t=>{
    const cerrado=!!t.closed || t.estado==="cerrado";
    const flota=escapeHtml((t.user&&t.user.fleet)||t.flota||"-");
    const chofer=escapeHtml((t.user&&t.user.driver)||t.chofer||"");
    const emb=escapeHtml(t.embarque||"-");
    const lote=escapeHtml(t.lote||"-");
    const cliente=escapeHtml((t.route&&t.route.cliente)||t.cliente||"-");
    const destino=escapeHtml((t.route&&t.route.destino)||t.destino||"-");
    const inicio=escapeHtml(tpodDateText(t.start&&t.start.time||t.start));
    const cierre=cerrado ? escapeHtml(tpodDateText(t.closed&&t.closed.time||t.closed)) : "-";
    const pos=escapeHtml(lastGpsText(t));
    const alerta=escapeHtml(lastAlertText(t));

    return `<div class="embarqueItem ${cerrado?'closed':'open'}" onclick="abrirTransitoCloud('${escapeHtml(t.id)}')">
      <div class="embTop"><b>Emb. ${emb} / Flota ${flota}</b><span>${cerrado?'Cerrado':'Abierto'}</span></div>
      <div>Chofer: ${chofer || "-"}</div>
      <div>Lote/Carga: ${lote}</div>
      <div>Cliente: ${cliente}</div>
      <div>Destino: ${destino}</div>
      <div>Inicio: ${inicio}</div>
      <div>Cierre: ${cierre}</div>
      <div>Últ. posición: ${pos}</div>
      <div>Últ. alerta: ${alerta}</div>
    </div>`;
  }).join("");
}

function abrirTransitoCloud(id){
  const t=getTransitPool().find(x=>x.id===id);
  if(!t)return;
  save(LS.transit,t);
  window.alert("Tránsito cargado en Tracking.");
  show("tracking");
}




/* ===== EMBARQUE SCREEN FIX v1.4.79 ===== */
function tpodSetDebug(txt){
  const d=document.getElementById("embarqueDebug");
  if(d)d.innerText=txt;
}

function tpodSetFiltro(txt){
  const f=document.getElementById("embarqueFiltro");
  if(f)f.innerText=txt;
}

function tpodInitFirebase(){
  try{
    if(typeof firebase==="undefined"){
      tpodSetDebug("Firebase SDK no cargó. Revisar Internet.");
      return false;
    }
    if(typeof FIREBASE_CONFIG!=="undefined" && !firebase.apps.length){
      firebase.initializeApp(FIREBASE_CONFIG);
    }
    if(!db) db=firebase.firestore();
    cloudReady=true;
    return true;
  }catch(e){
    tpodSetDebug("Error Firebase: "+(e.message||e));
    console.log("tpodInitFirebase",e);
    return false;
  }
}

function tpodCurrentUser(){
  try{
    return cloudUser || load(LS.cloudUser,null);
  }catch(e){
    return null;
  }
}

function tpodCanSee(t){
  const u=tpodCurrentUser();
  if(!u)return false;
  if(u.role==="manager")return true;
  const flota=String(u.flota||"");
  if(!flota)return false;
  const tf=String((t.user&&t.user.fleet)||t.flota||"");
  if(tf===flota)return true;
  return (t.participantes||[]).map(String).includes(flota);
}

function tpodNormTransit(id,x){
  x=x||{};
  const route=x.route||{};
  const user=x.user||{fleet:x.flota||"",driver:x.chofer||""};
  return {
    id:x.id||id||"",
    user:user,
    route:{
      ...route,
      cliente:route.cliente||x.cliente||"",
      origen:route.origen||x.origen||"",
      destino:route.destino||x.destino||"",
      origen_lat:route.origen_lat||x.origen_lat,
      origen_lng:route.origen_lng||x.origen_lng,
      destino_lat:route.destino_lat||x.destino_lat,
      destino_lng:route.destino_lng||x.destino_lng
    },
    lote:x.lote||"",
    embarque:x.embarque||"",
    start:x.start||null,
    updates:x.updates||[],
    alerts:x.alerts||[],
    closed:x.closed||null,
    participantes:x.participantes||[],
    estado:x.estado||(x.closed?"cerrado":"abierto"),
    ultimaPosicion:x.ultimaPosicion||null,
    ultimaAlerta:x.ultimaAlerta||null,
    flota:x.flota||user.fleet||"",
    chofer:x.chofer||user.driver||""
  };
}

function tpodDate(v){
  try{
    if(!v)return "-";
    let d=null;
    if(v.toDate)d=v.toDate();
    else if(v.seconds)d=new Date(v.seconds*1000);
    else if(v.time)d=new Date(v.time);
    else d=new Date(v);
    if(!d || isNaN(d.getTime()))return "-";
    const dd=String(d.getDate()).padStart(2,"0");
    const mm=String(d.getMonth()+1).padStart(2,"0");
    const hh=String(d.getHours()).padStart(2,"0");
    const mi=String(d.getMinutes()).padStart(2,"0");
    return `${dd}/${mm} ${hh}:${mi}`;
  }catch(e){return "-";}
}

function tpodLastGps(t){
  const g=t.ultimaPosicion || ((t.updates&&t.updates.length)?t.updates[t.updates.length-1].gps:(t.closed||t.start));
  if(!g || g.lat==null || g.lng==null)return "-";
  return `${Number(g.lat).toFixed(5)}, ${Number(g.lng).toFixed(5)}`;
}

function tpodLastAlert(t){
  const a=t.ultimaAlerta || ((t.alerts&&t.alerts.length)?t.alerts[t.alerts.length-1]:null);
  if(!a)return "-";
  return a.type || "Alerta";
}

async function refreshEmbarquesCloud(){
  const box=document.getElementById("embarqueList");
  if(box)box.innerHTML='<div class="emptyBox">Leyendo Firebase...</div>';
  tpodSetDebug("Leyendo colección transitos...");

  const u=tpodCurrentUser();
  if(!u){
    tpodSetFiltro("Sin usuario");
    tpodSetDebug("Debe ingresar desde Acceso.");
    if(box)box.innerHTML='<div class="emptyBox">Ingrese en 🔐 Acceso como manager o flota.</div>';
    return;
  }

  if(!tpodInitFirebase()){
    if(box)box.innerHTML='<div class="emptyBox">No se pudo conectar con Firebase.</div>';
    return;
  }

  try{
    const snap=await db.collection("transitos").get();
    cloudTransitosCache=snap.docs.map(d=>tpodNormTransit(d.id,d.data()));
    tpodSetDebug(`Firebase conectado. Leídos: ${cloudTransitosCache.length}`);
    renderEmbarque();
  }catch(e){
    tpodSetDebug("Error leyendo Firestore: "+(e.message||e));
    if(box)box.innerHTML='<div class="emptyBox">Error leyendo Firestore. Revisar reglas/permisos.</div>';
  }
}

function renderEmbarque(){
  const box=document.getElementById("embarqueList");
  if(!box)return;

  const u=tpodCurrentUser();
  if(!u){
    tpodSetFiltro("Sin usuario Cloud");
    tpodSetDebug("Debe ingresar desde Acceso.");
    box.innerHTML='<div class="emptyBox">Ingrese en 🔐 Acceso para ver embarques.</div>';
    return;
  }

  let items=(cloudTransitosCache||[]).map(t=>t&&t.id?t:tpodNormTransit(t&&t.id,t)).filter(Boolean);
  items=items.filter(tpodCanSee);

  // Manager no filtra por campo Inicio/Fin: debe ver todos.
  items.sort((a,b)=>{
    const ea=String(a.embarque||"");
    const eb=String(b.embarque||"");
    if(ea!==eb)return ea.localeCompare(eb);
    const fa=String((a.user&&a.user.fleet)||a.flota||"");
    const fb=String((b.user&&b.user.fleet)||b.flota||"");
    return fa.localeCompare(fb);
  });

  tpodSetFiltro(`Visibles: ${items.length}`);
  if(!items.length){
    box.innerHTML='<div class="emptyBox">No hay tránsitos visibles. Tocá Actualizar embarques.</div>';
    return;
  }

  box.innerHTML=items.map(t=>{
    const cerrado=!!t.closed || t.estado==="cerrado";
    const flota=escapeHtml((t.user&&t.user.fleet)||t.flota||"-");
    const chofer=escapeHtml((t.user&&t.user.driver)||t.chofer||"-");
    const emb=escapeHtml(t.embarque||"-");
    const lote=escapeHtml(t.lote||"-");
    const cliente=escapeHtml((t.route&&t.route.cliente)||"-");
    const destino=escapeHtml((t.route&&t.route.destino)||"-");
    const estado=cerrado?"Cerrado":"Abierto";

    return `<div class="embarqueItem ${cerrado?'closed':'open'}" onclick="abrirTransitoCloud('${escapeHtml(t.id)}')">
      <div class="embTop"><b>Emb. ${emb} / Flota ${flota}</b><span>${estado}</span></div>
      <div>Chofer: ${chofer}</div>
      <div>Lote/Carga: ${lote}</div>
      <div>Cliente: ${cliente}</div>
      <div>Destino: ${destino}</div>
      <div>Inicio: ${escapeHtml(tpodDate(t.start))}</div>
      <div>Cierre: ${cerrado ? escapeHtml(tpodDate(t.closed)) : "-"}</div>
      <div>Últ. posición: ${escapeHtml(tpodLastGps(t))}</div>
      <div>Últ. alerta: ${escapeHtml(tpodLastAlert(t))}</div>
    </div>`;
  }).join("");
}

function abrirTransitoCloud(id){
  const t=(cloudTransitosCache||[]).find(x=>x.id===id);
  if(!t)return;
  save(LS.transit,t);
  window.alert("Tránsito cargado en Tracking.");
  show("tracking");
}

// Forzar carga al entrar a la pantalla, aunque show() anterior no la llame bien.
try{
  const oldShow=show;
  show=function(id){
    oldShow(id);
    if(id==="embarque"){
      setTimeout(()=>refreshEmbarquesCloud(),200);
    }
  };
}catch(e){
  console.log("No se pudo envolver show",e);
}













/* ===== v1.4.83 MODO FLOTA ===== */
function tpodStatus(txt, ok){const el=document.getElementById("cloudStatus");if(el){el.innerText=txt;el.className="cloudStatus "+(ok?"ok":"bad");}}
function tpodInitFirebase(){try{if(typeof firebase==="undefined"){tpodStatus("Desconectado",false);return false;}if(typeof FIREBASE_CONFIG!=="undefined"&&!firebase.apps.length)firebase.initializeApp(FIREBASE_CONFIG);if(!db)db=firebase.firestore();cloudReady=true;tpodStatus("Conectado",true);return true;}catch(e){console.log(e);tpodStatus("Desconectado",false);return false;}}
function tpodCurrentFlota(){try{return String((user().fleet)||"").trim();}catch(e){return "";}}
function tpodEnsureInicioEmbarqueInput(){try{let old=document.getElementById("embarque");if(old&&old.tagName&&old.tagName.toLowerCase()==="input")old.id="embarqueInput";const lote=document.getElementById("lote");if(!lote)return;let emb=document.getElementById("embarqueInput");if(emb)return;const wrap=document.createElement("div");wrap.className="embarqueRealBox";wrap.innerHTML='<label>Embarque</label><input id="embarqueInput" placeholder="Ej: 001" autocomplete="off">';const lp=lote.parentElement||lote;if(lp.parentElement&&lp.parentElement.classList.contains("loteEmbarqueStack"))lp.parentElement.appendChild(wrap);else{const row=document.createElement("div");row.className="loteEmbarqueStack";lp.parentElement.insertBefore(row,lp);row.appendChild(lp);row.appendChild(wrap);}}catch(e){}}
async function validarFlotaEnBase(fleet){if(!fleet)return {ok:false,msg:"Debe ingresar flota."};if(!tpodInitFirebase())return {ok:false,msg:"Sin conexión a Firebase."};const f=String(fleet).trim();const ids=["flota"+f,"flota_"+f,f];try{for(const id of ids){const d=await db.collection("usuarios").doc(id).get();if(d.exists){const x=d.data()||{};const rol=String(x.role||x.rol||"").toLowerCase();const fd=String(x.flota||x.fleet||f);if(x.activo!==false&&(rol==="flota"||fd===f))return {ok:true,data:x,id};}}const snap=await db.collection("usuarios").where("flota","==",f).limit(1).get();if(!snap.empty){const x=snap.docs[0].data()||{};if(x.activo!==false)return {ok:true,data:x,id:snap.docs[0].id};}return {ok:false,msg:"La flota no existe o no está activa en la base."};}catch(e){return {ok:false,msg:"Error validando flota: "+(e.message||e)};}}
async function saveUser(){const fleet=(document.getElementById("userFleet")||{}).value||"";const driver=(document.getElementById("userDriver")||{}).value||"";const phones=(document.getElementById("userPhones")||{}).value||"";const msg=document.getElementById("userMsg");if(msg)msg.innerHTML="<p>Validando flota...</p>";const val=await validarFlotaEnBase(fleet.trim());if(!val.ok){if(msg)msg.innerHTML='<p class="err">'+escapeHtml(val.msg)+'</p>';window.alert(val.msg);tpodStatus("Desconectado",false);return;}save(LS.user,{fleet:fleet.trim(),driver:driver.trim(),phones:phones.trim(),validado:true,cloudUserId:val.id});cloudUser={user:val.id,role:"flota",flota:fleet.trim(),activo:true};if(LS.cloudUser)save(LS.cloudUser,cloudUser);tpodStatus("Conectado",true);if(msg)msg.innerHTML='<p class="ok">Flota validada y guardada.</p>';renderInicio();startCloudListenerModoFlota();setTimeout(()=>show("inicio"),300);}
function bloquearFormularioTransito(){const t=transit();const active=!!(t&&!t.closed);["clienteSelect","origenSelect","destinoSelect","lote","embarqueInput"].forEach(id=>{const el=document.getElementById(id);if(el)el.disabled=active;});}
function renderInicio(){tpodEnsureInicioEmbarqueInput();const u=user();const inp=document.getElementById("inicioUser");if(inp)inp.value=(u.fleet||"Sin flota")+" - "+(u.driver||"Sin chofer");const t=transit();if(t&&document.getElementById("lote"))document.getElementById("lote").value=t.lote||"";if(t&&document.getElementById("embarqueInput"))document.getElementById("embarqueInput").value=t.embarque||"";renderTransitStatus();aplicarColorResumenInicio();bloquearFormularioTransito();}
function currentEmbarqueValue(){const t=transit();if(t&&t.embarque)return t.embarque;const el=document.getElementById("embarqueInput");return el?String(el.value||"").trim():"";}
function tpodNormTransit(id,x){x=x||{};const r=x.route||{};const u=x.user||{fleet:x.flota||"",driver:x.chofer||""};return {id:x.id||id||"",user:u,route:{...r,cliente:r.cliente||x.cliente||"",origen:r.origen||x.origen||"",destino:r.destino||x.destino||""},lote:x.lote||"",embarque:x.embarque||"",start:x.start||null,updates:x.updates||[],alerts:x.alerts||[],closed:x.closed||null,participantes:x.participantes||[],estado:x.estado||(x.closed?"cerrado":"abierto"),ultimaPosicion:x.ultimaPosicion||null,ultimaAlerta:x.ultimaAlerta||null,flota:x.flota||u.fleet||"",chofer:x.chofer||u.driver||""};}
function tpodDate(v){try{if(!v)return "-";let d=null;if(v.toDate)d=v.toDate();else if(v.seconds)d=new Date(v.seconds*1000);else if(v.time)d=new Date(v.time);else d=new Date(v);if(!d||isNaN(d.getTime()))return "-";return `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")} ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;}catch(e){return "-";}}
function tpodLastGps(t){const g=t.ultimaPosicion||((t.updates&&t.updates.length)?t.updates[t.updates.length-1].gps:(t.closed||t.start));if(!g||g.lat==null||g.lng==null)return "-";return `${Number(g.lat).toFixed(5)}, ${Number(g.lng).toFixed(5)}`;}
function tpodLastAlert(t){const a=t.ultimaAlerta||((t.alerts&&t.alerts.length)?t.alerts[t.alerts.length-1]:null);return a?(a.type||"Alerta"):"-";}
async function refreshEmbarquesCloud(){const box=document.getElementById("embarqueList");if(box)box.innerHTML='<div class="emptyBox">Leyendo Firebase...</div>';const flota=tpodCurrentFlota();if(!flota){if(document.getElementById("embarqueFiltro"))document.getElementById("embarqueFiltro").innerText="Sin flota";if(document.getElementById("embarqueDebug"))document.getElementById("embarqueDebug").innerText="Valide la flota en Usuario.";if(box)box.innerHTML='<div class="emptyBox">Valide la flota en Usuario.</div>';return;}if(!tpodInitFirebase()){if(box)box.innerHTML='<div class="emptyBox">Desconectado.</div>';return;}try{const snap=await db.collection("transitos").get();cloudTransitosCache=snap.docs.map(d=>tpodNormTransit(d.id,d.data()));tpodStatus("Conectado",true);renderEmbarque();}catch(e){tpodStatus("Desconectado",false);if(document.getElementById("embarqueDebug"))document.getElementById("embarqueDebug").innerText="Error leyendo embarques.";if(box)box.innerHTML='<div class="emptyBox">Error leyendo embarques.</div>';}}
function renderEmbarque(){const box=document.getElementById("embarqueList");if(!box)return;const flota=tpodCurrentFlota();if(!flota){if(document.getElementById("embarqueFiltro"))document.getElementById("embarqueFiltro").innerText="Sin flota";if(document.getElementById("embarqueDebug"))document.getElementById("embarqueDebug").innerText="Valide la flota en Usuario.";box.innerHTML='<div class="emptyBox">Valide la flota en Usuario.</div>';return;}let items=(cloudTransitosCache||[]).map(t=>t&&t.id?t:tpodNormTransit(t&&t.id,t)).filter(Boolean);const embPermitidos=new Set();items.forEach(t=>{const tf=String((t.user&&t.user.fleet)||t.flota||"");const parts=(t.participantes||[]).map(String);if(tf===flota||parts.includes(flota)){if(t.embarque)embPermitidos.add(String(t.embarque));}});const currentEmb=currentEmbarqueValue();if(currentEmb)embPermitidos.add(String(currentEmb));items=items.filter(t=>embPermitidos.has(String(t.embarque||"")));items.sort((a,b)=>String(a.embarque||"").localeCompare(String(b.embarque||""))||String((a.user&&a.user.fleet)||a.flota||"").localeCompare(String((b.user&&b.user.fleet)||b.flota||"")));if(document.getElementById("embarqueFiltro"))document.getElementById("embarqueFiltro").innerText=`Visibles: ${items.length}`;if(document.getElementById("embarqueDebug"))document.getElementById("embarqueDebug").innerText=`Conectado. Flota ${flota}. Embarques compartidos: ${embPermitidos.size}`;if(!items.length){box.innerHTML='<div class="emptyBox">No hay embarques compartidos para esta flota.</div>';return;}box.innerHTML=items.map(t=>{const cerrado=!!t.closed||t.estado==="cerrado";const flotaT=escapeHtml((t.user&&t.user.fleet)||t.flota||"-");const chofer=escapeHtml((t.user&&t.user.driver)||t.chofer||"-");const emb=escapeHtml(t.embarque||"-");const lote=escapeHtml(t.lote||"-");const cliente=escapeHtml((t.route&&t.route.cliente)||"-");const destino=escapeHtml((t.route&&t.route.destino)||"-");return `<div class="embarqueItem ${cerrado?'closed':'open'}" onclick="abrirTransitoCloud('${escapeHtml(t.id)}')"><div class="embTop"><b>Emb. ${emb} / Flota ${flotaT}</b><span>${cerrado?'Cerrado':'Abierto'}</span></div><div>Chofer: ${chofer}</div><div>Lote/Carga: ${lote}</div><div>Cliente: ${cliente}</div><div>Destino: ${destino}</div><div>Inicio: ${escapeHtml(tpodDate(t.start))}</div><div>Cierre: ${cerrado?escapeHtml(tpodDate(t.closed)):"-"}</div><div>Últ. posición: ${escapeHtml(tpodLastGps(t))}</div><div>Últ. alerta: ${escapeHtml(tpodLastAlert(t))}</div></div>`;}).join("");}
function abrirTransitoCloud(id){const t=(cloudTransitosCache||[]).find(x=>x.id===id);if(!t)return;save(LS.transit,t);window.alert("Tránsito cargado en Tracking.");show("tracking");}
function startCloudListenerModoFlota(){if(!tpodInitFirebase())return;try{if(cloudUnsub){try{cloudUnsub();}catch(e){}}cloudUnsub=db.collection("transitos").onSnapshot(snap=>{cloudTransitosCache=snap.docs.map(d=>tpodNormTransit(d.id,d.data()));if(document.getElementById("embarque")&&!document.getElementById("embarque").classList.contains("hidden"))renderEmbarque();tpodStatus("Conectado",true);},e=>{console.log(e);tpodStatus("Desconectado",false);});}catch(e){}}
function limpiarCamposInicio(){if(document.getElementById("lote"))document.getElementById("lote").value="";if(document.getElementById("embarqueInput"))document.getElementById("embarqueInput").value="";renderInicio();}
try{const oldShowModoFlota=show;show=function(id){oldShowModoFlota(id);if(id==="inicio")tpodEnsureInicioEmbarqueInput();if(id==="embarque")setTimeout(()=>refreshEmbarquesCloud(),150);};}catch(e){}
document.addEventListener("DOMContentLoaded",function(){setTimeout(()=>{tpodEnsureInicioEmbarqueInput();tpodInitFirebase();if(tpodCurrentFlota())startCloudListenerModoFlota();},600);});




/* ===== v1.4.84 MEJORAS VISUALES ===== */
function tpodSetDebug(txt){
  const d=document.getElementById("embarqueDebug");
  if(d){d.innerText="";d.style.display="none";}
}
function tpodSetFiltro(txt){
  const f=document.getElementById("embarqueFiltro");
  if(f)f.innerText=txt;
}
function tpodBuildEmbarqueScreen(){
  let sec=document.getElementById("embarque");
  if(!sec || (sec.tagName && sec.tagName.toLowerCase()==="input")){
    if(sec && sec.tagName && sec.tagName.toLowerCase()==="input") sec.id="embarqueInput";
    sec=document.createElement("section");
    sec.id="embarque";
    sec.className="view hidden";
    document.body.appendChild(sec);
  }
  sec.innerHTML='<div class="card embarqueCard"><div class="embarqueHeader"><b>Número Embarque</b><span id="embarqueFiltro">-</span></div><div id="embarqueDebug" class="embarqueDebug hiddenDebug" style="display:none"></div><div id="embarqueList" class="embarqueList"><div class="emptyBox">Cargando embarques...</div></div></div>';
}
function refreshEmbarquesCloud(){
  tpodBuildEmbarqueScreen();
  const box=document.getElementById("embarqueList");
  const flota=(typeof tpodCurrentFlota==="function") ? tpodCurrentFlota() : "";
  if(!flota){
    tpodSetFiltro("-");
    if(box) box.innerHTML='<div class="emptyBox">Valide la flota en Usuario.</div>';
    return Promise.resolve();
  }
  if(typeof tpodInitFirebase!=="function" || !tpodInitFirebase()){
    if(box) box.innerHTML='<div class="emptyBox">Desconectado.</div>';
    return Promise.resolve();
  }
  if(box) box.innerHTML='<div class="emptyBox">Actualizando...</div>';
  return db.collection("transitos").get().then(snap=>{
    cloudTransitosCache=snap.docs.map(d=>tpodNormTransit(d.id,d.data()));
    if(typeof tpodStatus==="function") tpodStatus("Conectado",true);
    renderEmbarque();
  }).catch(e=>{
    if(typeof tpodStatus==="function") tpodStatus("Desconectado",false);
    if(box) box.innerHTML='<div class="emptyBox">Error leyendo embarques.</div>';
  });
}
function renderEmbarque(){
  tpodBuildEmbarqueScreen();
  const box=document.getElementById("embarqueList");
  if(!box)return;
  const flota=(typeof tpodCurrentFlota==="function") ? tpodCurrentFlota() : "";
  if(!flota){
    tpodSetFiltro("-");
    box.innerHTML='<div class="emptyBox">Valide la flota en Usuario.</div>';
    return;
  }
  let items=(cloudTransitosCache||[]).map(t=>t&&t.id?t:tpodNormTransit(t&&t.id,t)).filter(Boolean);
  const embarquesPermitidos=new Set();
  items.forEach(t=>{
    const tf=String((t.user&&t.user.fleet)||t.flota||"");
    const parts=(t.participantes||[]).map(String);
    if(tf===flota || parts.includes(flota)){
      if(t.embarque) embarquesPermitidos.add(String(t.embarque));
    }
  });
  const currentEmb=(typeof currentEmbarqueValue==="function") ? currentEmbarqueValue() : "";
  if(currentEmb) embarquesPermitidos.add(String(currentEmb));
  items=items.filter(t=>embarquesPermitidos.has(String(t.embarque||"")));
  const seen=new Set();
  items=items.filter(t=>{
    const key=String(t.id||"")+"|"+String(t.embarque||"")+"|"+String((t.user&&t.user.fleet)||t.flota||"")+"|"+String(t.lote||"");
    if(seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  items.sort((a,b)=>{
    const ea=String(a.embarque||"");
    const eb=String(b.embarque||"");
    if(ea!==eb) return ea.localeCompare(eb);
    const fa=String((a.user&&a.user.fleet)||a.flota||"");
    const fb=String((b.user&&b.user.fleet)||b.flota||"");
    return fa.localeCompare(fb);
  });
  const embTitulo=currentEmb || (items[0]&&items[0].embarque) || "-";
  tpodSetFiltro(embTitulo);
  if(!items.length){
    box.innerHTML='<div class="emptyBox">No hay embarques compartidos para esta flota.</div>';
    return;
  }
  box.innerHTML=items.map(t=>{
    const cerrado=!!t.closed || t.estado==="cerrado";
    const flotaT=escapeHtml((t.user&&t.user.fleet)||t.flota||"-");
    const emb=escapeHtml(t.embarque||"-");
    const inicio=escapeHtml(tpodDate(t.start));
    const pos=escapeHtml(tpodLastGps(t));
    const alerta=escapeHtml(tpodLastAlert(t));
    return `<div class="embarqueItem ${cerrado?'closed':'open'}" onclick="abrirTransitoCloud('${escapeHtml(t.id)}')"><div class="embTop"><b>Emb. ${emb} / Flota ${flotaT}</b><span>${cerrado?'Cerrado':'Abierto'}</span></div><div>Inicio: ${inicio}</div><div>Cierre: ${cerrado?escapeHtml(tpodDate(t.closed)):"-"}</div><div>Últ. posición: ${pos}</div><div>Últ. alerta: ${alerta}</div></div>`;
  }).join("");
}
function renderTrackingMap(t){
  const map=initLeafletMap();
  if(!map) return;
  clearLeafletLayers();
  if(!t || !t.route || !t.start){
    if(typeof removeRouteLayer==="function") removeRouteLayer();
    window.lastTrackingMapKey="";
    window.lastTrackingMapCenter=null;
    map.setView([-34.6037,-58.3816],6,{animate:false});
    return;
  }
  const origin={lat:Number(t.route.origen_lat||t.start.lat),lng:Number(t.route.origen_lng||t.start.lng)};
  const dest={lat:Number(t.route.destino_lat),lng:Number(t.route.destino_lng)};
  const current=t.updates&&t.updates.length?t.updates[t.updates.length-1].gps:t.start;
  const cur={lat:Number(current.lat),lng:Number(current.lng)};
  const alerts=(t.alerts||[]).map(a=>a.gps).filter(Boolean).map(g=>({lat:Number(g.lat),lng:Number(g.lng)})).filter(p=>isFinite(p.lat)&&isFinite(p.lng));
  if(typeof ensureRoadRouteLayer==="function") ensureRoadRouteLayer(origin,dest);
  if(isFinite(origin.lat)&&isFinite(origin.lng)) addLeafletLayer(L.circleMarker([origin.lat,origin.lng],{radius:8,color:"#fff",weight:2,fillColor:"#22c55e",fillOpacity:1}).bindPopup("Origen"));
  if(isFinite(dest.lat)&&isFinite(dest.lng)) addLeafletLayer(L.circleMarker([dest.lat,dest.lng],{radius:8,color:"#fff",weight:2,fillColor:"#ef4444",fillOpacity:1}).bindPopup("Destino"));
  alerts.forEach((a,i)=>addLeafletLayer(L.circleMarker([a.lat,a.lng],{radius:7,color:"#fff",weight:2,fillColor:"#f59e0b",fillOpacity:1}).bindPopup("Alerta "+(i+1))));
  if(isFinite(cur.lat)&&isFinite(cur.lng)){
    addLeafletLayer(L.circleMarker([cur.lat,cur.lng],{radius:11,color:"#fff",weight:2,fillColor:"#2f8cff",fillOpacity:1}).bindPopup("GPS actual"));
    map.setView([cur.lat,cur.lng],14,{animate:false});
    window.lastTrackingMapCenter={lat:cur.lat,lng:cur.lng};
  }
}
try{
  const oldShowVisual=show;
  show=function(id){
    oldShowVisual(id);
    if(id==="embarque") setTimeout(()=>refreshEmbarquesCloud(),120);
    if(id==="inicio") setTimeout(()=>{ if(typeof tpodEnsureInicioEmbarqueInput==="function") tpodEnsureInicioEmbarqueInput(); },50);
  };
}catch(e){}




/* ===== v1.4.85 EMBARQUE LOCALIDAD ===== */
function tpodGpsObj(t){
  return t.ultimaPosicion || ((t.updates&&t.updates.length)?t.updates[t.updates.length-1].gps:(t.closed||t.start));
}

function tpodLocalidadDesdeCoords(lat,lng){
  lat=Number(lat); lng=Number(lng);
  if(!isFinite(lat) || !isFinite(lng)) return "-";

  const lugares=[
    ["Zárate",-34.095,-59.026],["Campana",-34.163,-58.959],["Buenos Aires",-34.604,-58.382],
    ["Avellaneda",-34.664,-58.365],["Luján",-34.570,-59.105],["Mercedes",-34.651,-59.430],
    ["San Nicolás",-33.335,-60.225],["Rosario",-32.947,-60.639],["Villa María",-32.410,-63.243],
    ["Córdoba",-31.420,-64.188],["San Luis",-33.302,-66.337],["Mendoza",-32.890,-68.845],
    ["Uspallata",-32.593,-69.345],["Las Cuevas",-32.816,-70.071],["Los Andes",-32.833,-70.598],
    ["Santiago de Chile",-33.448,-70.669],["Valparaíso",-33.047,-71.612],["Montevideo",-34.901,-56.164],
    ["Colonia",-34.462,-57.840],["Paysandú",-32.321,-58.076],["Fray Bentos",-33.132,-58.304],
    ["Concepción del Uruguay",-32.484,-58.233],["Gualeguaychú",-33.009,-58.517],
    ["Paraná",-31.741,-60.511],["Santa Fe",-31.633,-60.700],["Paso de los Libres",-29.713,-57.087],
    ["Uruguaiana",-29.754,-57.088],["Foz do Iguaçu",-25.516,-54.585],["São Paulo",-23.555,-46.639]
  ];

  function distKm(a,b,c,d){
    const R=6371, toRad=x=>x*Math.PI/180;
    const dLat=toRad(c-a), dLng=toRad(d-b);
    const A=Math.sin(dLat/2)**2 + Math.cos(toRad(a))*Math.cos(toRad(c))*Math.sin(dLng/2)**2;
    return 2*R*Math.atan2(Math.sqrt(A),Math.sqrt(1-A));
  }

  let best=null;
  lugares.forEach(l=>{
    const d=distKm(lat,lng,l[1],l[2]);
    if(!best || d<best.d) best={name:l[0],d};
  });

  if(best && best.d<=35) return best.name;
  if(best && best.d<=80) return best.name+" (zona)";
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

function tpodUltimaUbicacionTexto(t){
  const g=tpodGpsObj(t);
  if(!g || g.lat==null || g.lng==null) return "-";
  return tpodLocalidadDesdeCoords(g.lat,g.lng);
}

function tpodLastGps(t){
  return tpodUltimaUbicacionTexto(t);
}

function renderEmbarque(){
  tpodBuildEmbarqueScreen();
  const box=document.getElementById("embarqueList");
  if(!box)return;

  const flota=(typeof tpodCurrentFlota==="function") ? tpodCurrentFlota() : "";
  if(!flota){
    tpodSetFiltro("-");
    box.innerHTML='<div class="emptyBox">Valide la flota en Usuario.</div>';
    return;
  }

  let items=(cloudTransitosCache||[]).map(t=>t&&t.id?t:tpodNormTransit(t&&t.id,t)).filter(Boolean);

  const embarquesPermitidos=new Set();
  items.forEach(t=>{
    const tf=String((t.user&&t.user.fleet)||t.flota||"");
    const parts=(t.participantes||[]).map(String);
    if(tf===flota || parts.includes(flota)){
      if(t.embarque) embarquesPermitidos.add(String(t.embarque));
    }
  });

  const currentEmb=(typeof currentEmbarqueValue==="function") ? currentEmbarqueValue() : "";
  if(currentEmb) embarquesPermitidos.add(String(currentEmb));

  items=items.filter(t=>embarquesPermitidos.has(String(t.embarque||"")));

  const seen=new Set();
  items=items.filter(t=>{
    const key=String(t.id||"")+"|"+String(t.embarque||"")+"|"+String((t.user&&t.user.fleet)||t.flota||"")+"|"+String(t.lote||"");
    if(seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  items.sort((a,b)=>{
    const ea=String(a.embarque||"");
    const eb=String(b.embarque||"");
    if(ea!==eb) return ea.localeCompare(eb);
    const fa=String((a.user&&a.user.fleet)||a.flota||"");
    const fb=String((b.user&&b.user.fleet)||b.flota||"");
    return fa.localeCompare(fb);
  });

  const embTitulo=currentEmb || (items[0]&&items[0].embarque) || "-";
  tpodSetFiltro(embTitulo);

  if(!items.length){
    box.innerHTML='<div class="emptyBox">No hay embarques compartidos para esta flota.</div>';
    return;
  }

  box.innerHTML=items.map(t=>{
    const cerrado=!!t.closed || t.estado==="cerrado";
    const flotaT=escapeHtml((t.user&&t.user.fleet)||t.flota||"-");
    const emb=escapeHtml(t.embarque||"-");
    const inicio=escapeHtml(tpodDate(t.start));
    const ubicacion=escapeHtml(tpodUltimaUbicacionTexto(t));
    const alerta=escapeHtml(tpodLastAlert(t));
    return `<div class="embarqueItem ${cerrado?'closed':'open'}" onclick="abrirTransitoCloud('${escapeHtml(t.id)}')"><div class="embTop"><b>Emb. ${emb} / Flota ${flotaT}</b><span>${cerrado?'Cerrado':'Abierto'}</span></div><div>Inicio: ${inicio}</div><div>Cierre: ${cerrado?escapeHtml(tpodDate(t.closed)):"-"}</div><div>Últ. ubicación: ${ubicacion}</div><div>Últ. alerta: ${alerta}</div></div>`;
  }).join("");
}




/* ===== v1.4.86 AJUSTES VISUALES ===== */
function tpodGpsObj(t){
  return t.ultimaPosicion || ((t.updates&&t.updates.length)?t.updates[t.updates.length-1].gps:(t.closed||t.start));
}

function tpodLocalidadDesdeCoords(lat,lng){
  lat=Number(lat); lng=Number(lng);
  if(!isFinite(lat) || !isFinite(lng)) return "-";

  const lugares=[
    ["Zárate",-34.095,-59.026],["Campana",-34.163,-58.959],["Buenos Aires",-34.604,-58.382],
    ["Avellaneda",-34.664,-58.365],["Luján",-34.570,-59.105],["Mercedes",-34.651,-59.430],
    ["San Nicolás",-33.335,-60.225],["Rosario",-32.947,-60.639],["Villa María",-32.410,-63.243],
    ["Córdoba",-31.420,-64.188],["San Luis",-33.302,-66.337],["Mendoza",-32.890,-68.845],
    ["Uspallata",-32.593,-69.345],["Las Cuevas",-32.816,-70.071],["Los Andes",-32.833,-70.598],
    ["Santiago de Chile",-33.448,-70.669],["Valparaíso",-33.047,-71.612],["Montevideo",-34.901,-56.164],
    ["Colonia",-34.462,-57.840],["Paysandú",-32.321,-58.076],["Fray Bentos",-33.132,-58.304],
    ["Concepción del Uruguay",-32.484,-58.233],["Gualeguaychú",-33.009,-58.517],
    ["Paraná",-31.741,-60.511],["Santa Fe",-31.633,-60.700],["Paso de los Libres",-29.713,-57.087],
    ["Uruguaiana",-29.754,-57.088],["Foz do Iguaçu",-25.516,-54.585],["São Paulo",-23.555,-46.639]
  ];
  function distKm(a,b,c,d){
    const R=6371, toRad=x=>x*Math.PI/180;
    const dLat=toRad(c-a), dLng=toRad(d-b);
    const A=Math.sin(dLat/2)**2+Math.cos(toRad(a))*Math.cos(toRad(c))*Math.sin(dLng/2)**2;
    return 2*R*Math.atan2(Math.sqrt(A),Math.sqrt(1-A));
  }
  let best=null;
  lugares.forEach(l=>{
    const d=distKm(lat,lng,l[1],l[2]);
    if(!best || d<best.d) best={name:l[0],d};
  });
  if(best && best.d<=35) return best.name;
  if(best && best.d<=80) return best.name+" (zona)";
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

function tpodUltimaUbicacionTexto(t){
  const g=tpodGpsObj(t);
  if(!g || g.lat==null || g.lng==null) return "-";
  return tpodLocalidadDesdeCoords(g.lat,g.lng);
}

function tpodLastGps(t){
  return tpodUltimaUbicacionTexto(t);
}

function renderEmbarque(){
  tpodBuildEmbarqueScreen();
  const box=document.getElementById("embarqueList");
  if(!box)return;

  const flota=(typeof tpodCurrentFlota==="function") ? tpodCurrentFlota() : "";
  if(!flota){
    tpodSetFiltro("-");
    box.innerHTML='<div class="emptyBox">Valide la flota en Usuario.</div>';
    return;
  }

  let items=(cloudTransitosCache||[]).map(t=>t&&t.id?t:tpodNormTransit(t&&t.id,t)).filter(Boolean);
  const embarquesPermitidos=new Set();
  items.forEach(t=>{
    const tf=String((t.user&&t.user.fleet)||t.flota||"");
    const parts=(t.participantes||[]).map(String);
    if(tf===flota || parts.includes(flota)){
      if(t.embarque) embarquesPermitidos.add(String(t.embarque));
    }
  });

  const currentEmb=(typeof currentEmbarqueValue==="function") ? currentEmbarqueValue() : "";
  if(currentEmb) embarquesPermitidos.add(String(currentEmb));

  items=items.filter(t=>embarquesPermitidos.has(String(t.embarque||"")));
  const seen=new Set();
  items=items.filter(t=>{
    const key=String(t.id||"")+"|"+String(t.embarque||"")+"|"+String((t.user&&t.user.fleet)||t.flota||"")+"|"+String(t.lote||"");
    if(seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  items.sort((a,b)=>{
    const ea=String(a.embarque||"");
    const eb=String(b.embarque||"");
    if(ea!==eb) return ea.localeCompare(eb);
    const fa=String((a.user&&a.user.fleet)||a.flota||"");
    const fb=String((b.user&&b.user.fleet)||b.flota||"");
    return fa.localeCompare(fb);
  });

  const embTitulo=currentEmb || (items[0]&&items[0].embarque) || "-";
  tpodSetFiltro(embTitulo);

  if(!items.length){
    box.innerHTML='<div class="emptyBox">No hay embarques compartidos para esta flota.</div>';
    return;
  }

  box.innerHTML=items.map(t=>{
    const cerrado=!!t.closed || t.estado==="cerrado";
    const flotaT=escapeHtml((t.user&&t.user.fleet)||t.flota||"-");
    const emb=escapeHtml(t.embarque||"-");
    const inicio=escapeHtml(tpodDate(t.start));
    const ubicacion=escapeHtml(tpodUltimaUbicacionTexto(t));
    const alerta=escapeHtml(tpodLastAlert(t));
    return `<div class="embarqueItem ${cerrado?'closed':'open'}" onclick="abrirTransitoCloud('${escapeHtml(t.id)}')"><div class="embTop"><b>Emb. ${emb} / Flota ${flotaT}</b><span>${cerrado?'Cerrado':'Abierto'}</span></div><div>Inicio: ${inicio}</div><div>Cierre: ${cerrado?escapeHtml(tpodDate(t.closed)):"-"}</div><div>Últ. posición: ${ubicacion}</div><div>Últ. alerta: ${alerta}</div></div>`;
  }).join("");
}




/* ===== v1.4.87 LOCALIDAD Y UI ===== */
async function tpodReverseLocalidad(lat,lng){
  lat=Number(lat); lng=Number(lng);
  if(!isFinite(lat)||!isFinite(lng)) return "-";

  const key=`tpod_loc_${lat.toFixed(4)}_${lng.toFixed(4)}`;
  try{
    const cached=localStorage.getItem(key);
    if(cached) return cached;
  }catch(e){}

  // Primero aproximación local para que no dependa de Internet.
  const local=tpodLocalidadDesdeCoords(lat,lng);
  if(local && !/^[-0-9.]+,\s*[-0-9.]+$/.test(local)){
    try{localStorage.setItem(key,local);}catch(e){}
    return local;
  }

  // Fallback online usando Nominatim si hay conexión.
  try{
    const url=`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lng)}&zoom=10&addressdetails=1`;
    const r=await fetch(url,{headers:{"Accept":"application/json"}});
    if(r.ok){
      const data=await r.json();
      const a=data.address||{};
      const name=a.city||a.town||a.village||a.municipality||a.county||a.state_district||a.state||data.name;
      if(name){
        try{localStorage.setItem(key,name);}catch(e){}
        return name;
      }
    }
  }catch(e){}
  return local;
}

function tpodGpsObj(t){
  return t.ultimaPosicion || ((t.updates&&t.updates.length)?t.updates[t.updates.length-1].gps:(t.closed||t.start));
}

function tpodUltimaUbicacionTexto(t){
  const g=tpodGpsObj(t);
  if(!g || g.lat==null || g.lng==null) return "-";
  const local=tpodLocalidadDesdeCoords(g.lat,g.lng);
  return local;
}

function renderEmbarque(){
  tpodBuildEmbarqueScreen();
  const box=document.getElementById("embarqueList");
  if(!box)return;

  const flota=(typeof tpodCurrentFlota==="function") ? tpodCurrentFlota() : "";
  if(!flota){
    tpodSetFiltro("-");
    box.innerHTML='<div class="emptyBox">Valide la flota en Usuario.</div>';
    return;
  }

  let items=(cloudTransitosCache||[]).map(t=>t&&t.id?t:tpodNormTransit(t&&t.id,t)).filter(Boolean);

  const embarquesPermitidos=new Set();
  items.forEach(t=>{
    const tf=String((t.user&&t.user.fleet)||t.flota||"");
    const parts=(t.participantes||[]).map(String);
    if(tf===flota || parts.includes(flota)){
      if(t.embarque) embarquesPermitidos.add(String(t.embarque));
    }
  });

  const currentEmb=(typeof currentEmbarqueValue==="function") ? currentEmbarqueValue() : "";
  if(currentEmb) embarquesPermitidos.add(String(currentEmb));

  items=items.filter(t=>embarquesPermitidos.has(String(t.embarque||"")));

  const seen=new Set();
  items=items.filter(t=>{
    const key=String(t.id||"")+"|"+String(t.embarque||"")+"|"+String((t.user&&t.user.fleet)||t.flota||"")+"|"+String(t.lote||"");
    if(seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  items.sort((a,b)=>{
    const ea=String(a.embarque||"");
    const eb=String(b.embarque||"");
    if(ea!==eb) return ea.localeCompare(eb);
    const fa=String((a.user&&a.user.fleet)||a.flota||"");
    const fb=String((b.user&&b.user.fleet)||b.flota||"");
    return fa.localeCompare(fb);
  });

  const embTitulo=currentEmb || (items[0]&&items[0].embarque) || "-";
  tpodSetFiltro(embTitulo);

  if(!items.length){
    box.innerHTML='<div class="emptyBox">No hay embarques compartidos para esta flota.</div>';
    return;
  }

  box.innerHTML=items.map(t=>{
    const cerrado=!!t.closed || t.estado==="cerrado";
    const flotaT=escapeHtml((t.user&&t.user.fleet)||t.flota||"-");
    const emb=escapeHtml(t.embarque||"-");
    const inicio=escapeHtml(tpodDate(t.start));
    const ubicacion=escapeHtml(tpodUltimaUbicacionTexto(t));
    const alerta=escapeHtml(tpodLastAlert(t));
    const id=escapeHtml(t.id||"");
    return `<div class="embarqueItem ${cerrado?'closed':'open'}" onclick="abrirTransitoCloud('${id}')">
      <div class="embTop"><b>Emb. ${emb} / Flota ${flotaT}</b><span>${cerrado?'Cerrado':'Abierto'}</span></div>
      <div>Inicio: ${inicio}</div>
      <div>Cierre: ${cerrado?escapeHtml(tpodDate(t.closed)):"-"}</div>
      <div>Últ. posición: <span class="ubicacionTxt" data-id="${id}">${ubicacion}</span></div>
      <div>Últ. alerta: ${alerta}</div>
    </div>`;
  }).join("");

  // Actualiza en segundo plano con geocodificación online si está disponible.
  items.forEach(t=>{
    const g=tpodGpsObj(t);
    if(!g || g.lat==null || g.lng==null || !t.id) return;
    tpodReverseLocalidad(g.lat,g.lng).then(name=>{
      const el=document.querySelector(`.ubicacionTxt[data-id="${CSS.escape(String(t.id))}"]`);
      if(el && name) el.innerText=name;
    }).catch(()=>{});
  });
}




/* ===== v1.4.88 UI Y LOCALIDAD SIN COORDENADAS ===== */
function tpodGpsObj(t){
  return t.ultimaPosicion || ((t.updates&&t.updates.length)?t.updates[t.updates.length-1].gps:(t.closed||t.start));
}

function tpodDistKm(a,b,c,d){
  const R=6371, toRad=x=>x*Math.PI/180;
  const dLat=toRad(c-a), dLng=toRad(d-b);
  const A=Math.sin(dLat/2)**2+Math.cos(toRad(a))*Math.cos(toRad(c))*Math.sin(dLng/2)**2;
  return 2*R*Math.atan2(Math.sqrt(A),Math.sqrt(1-A));
}

function tpodLocalidadDesdeCoords(lat,lng){
  lat=Number(lat); lng=Number(lng);
  if(!isFinite(lat) || !isFinite(lng)) return "-";

  // Puntos ampliados sobre corredores frecuentes ARG/Chile/Uruguay/Brasil.
  const lugares=[
    ["CABA",-34.604,-58.382],["Avellaneda",-34.664,-58.365],["La Plata",-34.921,-57.954],
    ["El Palomar",-34.616,-58.459],["Morón",-34.653,-58.619],["Hurlingham",-34.588,-58.640],
    ["General Rodríguez",-34.608,-58.952],["Luján",-34.570,-59.105],["Mercedes",-34.651,-59.430],
    ["Zárate",-34.095,-59.026],["Campana",-34.163,-58.959],["San Pedro",-33.679,-59.666],
    ["San Nicolás",-33.335,-60.225],["Rosario",-32.947,-60.639],["Arroyo Seco",-33.154,-60.508],
    ["Villa Constitución",-33.228,-60.329],["Santa Fe",-31.633,-60.700],["Paraná",-31.741,-60.511],
    ["Villa María",-32.410,-63.243],["Córdoba",-31.420,-64.188],["Río Cuarto",-33.123,-64.349],
    ["Villa Mercedes",-33.675,-65.462],["San Luis",-33.302,-66.337],["Mendoza",-32.890,-68.845],
    ["Luján de Cuyo",-33.039,-68.879],["Potrerillos",-32.956,-69.208],["Uspallata",-32.593,-69.345],
    ["Las Cuevas",-32.816,-70.071],["Paso Cristo Redentor",-32.825,-70.060],["Los Andes",-32.833,-70.598],
    ["Santiago de Chile",-33.448,-70.669],["Valparaíso",-33.047,-71.612],["San Antonio",-33.594,-71.607],
    ["Montevideo",-34.901,-56.164],["Colonia",-34.462,-57.840],["Paysandú",-32.321,-58.076],
    ["Fray Bentos",-33.132,-58.304],["Concepción del Uruguay",-32.484,-58.233],["Gualeguaychú",-33.009,-58.517],
    ["Paso de los Libres",-29.713,-57.087],["Uruguaiana",-29.754,-57.088],["Foz do Iguaçu",-25.516,-54.585],
    ["Curitiba",-25.428,-49.273],["São Paulo",-23.555,-46.639],["Santos",-23.960,-46.333]
  ];

  let best=null;
  lugares.forEach(l=>{
    const d=tpodDistKm(lat,lng,l[1],l[2]);
    if(!best || d<best.d) best={name:l[0],d};
  });

  if(best){
    if(best.d<=50) return best.name;
    if(best.d<=140) return best.name+" (zona)";
    return "Zona GPS";
  }
  return "Zona GPS";
}

function tpodUltimaUbicacionTexto(t){
  const g=tpodGpsObj(t);
  if(!g || g.lat==null || g.lng==null) return "-";

  // Si en el futuro Firebase ya trae localidad, usarla primero.
  if(g.localidad) return String(g.localidad);
  if(t.localidad) return String(t.localidad);
  if(t.ultimaLocalidad) return String(t.ultimaLocalidad);

  return tpodLocalidadDesdeCoords(g.lat,g.lng);
}

function tpodLastGps(t){
  return tpodUltimaUbicacionTexto(t);
}

function renderEmbarque(){
  tpodBuildEmbarqueScreen();
  const box=document.getElementById("embarqueList");
  if(!box)return;

  const flota=(typeof tpodCurrentFlota==="function") ? tpodCurrentFlota() : "";
  if(!flota){
    tpodSetFiltro("-");
    box.innerHTML='<div class="emptyBox">Valide la flota en Usuario.</div>';
    return;
  }

  let items=(cloudTransitosCache||[]).map(t=>t&&t.id?t:tpodNormTransit(t&&t.id,t)).filter(Boolean);

  const embarquesPermitidos=new Set();
  items.forEach(t=>{
    const tf=String((t.user&&t.user.fleet)||t.flota||"");
    const parts=(t.participantes||[]).map(String);
    if(tf===flota || parts.includes(flota)){
      if(t.embarque) embarquesPermitidos.add(String(t.embarque));
    }
  });

  const currentEmb=(typeof currentEmbarqueValue==="function") ? currentEmbarqueValue() : "";
  if(currentEmb) embarquesPermitidos.add(String(currentEmb));

  items=items.filter(t=>embarquesPermitidos.has(String(t.embarque||"")));

  const seen=new Set();
  items=items.filter(t=>{
    const key=String(t.id||"")+"|"+String(t.embarque||"")+"|"+String((t.user&&t.user.fleet)||t.flota||"")+"|"+String(t.lote||"");
    if(seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  items.sort((a,b)=>{
    const ea=String(a.embarque||"");
    const eb=String(b.embarque||"");
    if(ea!==eb) return ea.localeCompare(eb);
    const fa=String((a.user&&a.user.fleet)||a.flota||"");
    const fb=String((b.user&&b.user.fleet)||b.flota||"");
    return fa.localeCompare(fb);
  });

  const embTitulo=currentEmb || (items[0]&&items[0].embarque) || "-";
  tpodSetFiltro(embTitulo);

  if(!items.length){
    box.innerHTML='<div class="emptyBox">No hay embarques compartidos para esta flota.</div>';
    return;
  }

  box.innerHTML=items.map(t=>{
    const cerrado=!!t.closed || t.estado==="cerrado";
    const flotaT=escapeHtml((t.user&&t.user.fleet)||t.flota||"-");
    const emb=escapeHtml(t.embarque||"-");
    const inicio=escapeHtml(tpodDate(t.start));
    const ubicacion=escapeHtml(tpodUltimaUbicacionTexto(t));
    const alerta=escapeHtml(tpodLastAlert(t));
    return `<div class="embarqueItem ${cerrado?'closed':'open'}" onclick="abrirTransitoCloud('${escapeHtml(t.id)}')">
      <div class="embTop"><b>Emb. ${emb} / Flota ${flotaT}</b><span>${cerrado?'Cerrado':'Abierto'}</span></div>
      <div>Inicio: ${inicio}</div>
      <div>Cierre: ${cerrado?escapeHtml(tpodDate(t.closed)):"-"}</div>
      <div>Últ. posición: ${ubicacion}</div>
      <div>Últ. alerta: ${alerta}</div>
    </div>`;
  }).join("");
}




/* ===== v1.4.89 FLOTA TRANSITO + EMBARQUE COMPARTIDO + LOCALIDAD ===== */

function tpodStatus(txt, ok){
  const el=document.getElementById("cloudStatus");
  if(el){
    const clean=String(txt||"").replace(/^Cloud:\s*/i,"").replace(/^Cloud\s*/i,"").trim();
    el.innerText=clean || (ok?"Conectado":"Desconectado");
    el.className="cloudStatus "+(ok?"ok":"bad");
  }
}

function cloudStatus(txt, ok){
  tpodStatus(txt, ok);
}

function tpodInitFirebase(){
  try{
    if(typeof firebase==="undefined"){
      tpodStatus("Desconectado",false);
      return false;
    }
    if(typeof FIREBASE_CONFIG!=="undefined" && !firebase.apps.length){
      firebase.initializeApp(FIREBASE_CONFIG);
    }
    if(!db) db=firebase.firestore();
    cloudReady=true;
    tpodStatus("Conectado",true);
    return true;
  }catch(e){
    console.log("tpodInitFirebase",e);
    tpodStatus("Desconectado",false);
    return false;
  }
}

function tpodCurrentFlota(){
  try{
    const u=user();
    return String(u.fleet||"").trim();
  }catch(e){
    return "";
  }
}

function tpodNormTransit(id,x){
  x=x||{};
  const route=x.route||{};
  const user=x.user||{fleet:x.flota||"",driver:x.chofer||""};
  return {
    id:x.id||id||"",
    user:user,
    route:{
      ...route,
      cliente:route.cliente||x.cliente||"",
      origen:route.origen||x.origen||"",
      destino:route.destino||x.destino||"",
      origen_lat:route.origen_lat||x.origen_lat,
      origen_lng:route.origen_lng||x.origen_lng,
      destino_lat:route.destino_lat||x.destino_lat,
      destino_lng:route.destino_lng||x.destino_lng
    },
    lote:x.lote||"",
    embarque:x.embarque||"",
    start:x.start||null,
    updates:x.updates||[],
    alerts:x.alerts||[],
    closed:x.closed||null,
    participantes:x.participantes||[],
    estado:x.estado||(x.closed?"cerrado":"abierto"),
    ultimaPosicion:x.ultimaPosicion||null,
    ultimaAlerta:x.ultimaAlerta||null,
    flota:x.flota||user.fleet||"",
    chofer:x.chofer||user.driver||""
  };
}

function tpodTransitTime(t){
  try{
    const v=(t&&t.start&&t.start.time)||t.start||0;
    const d=(v&&v.toDate)?v.toDate():(v&&v.seconds?new Date(v.seconds*1000):new Date(v));
    return d && !isNaN(d.getTime()) ? d.getTime() : 0;
  }catch(e){return 0;}
}

function tpodIsOpen(t){
  return !!(t && !t.closed && String(t.estado||"abierto").toLowerCase()!=="cerrado");
}

async function tpodCargarTransitoAbiertoDeFlota(flota){
  if(!flota || !tpodInitFirebase()) return null;
  try{
    const snap=await db.collection("transitos").get();
    const all=snap.docs.map(d=>tpodNormTransit(d.id,d.data()));
    cloudTransitosCache=all;

    const own=all.filter(t=>{
      const tf=String((t.user&&t.user.fleet)||t.flota||"");
      const parts=(t.participantes||[]).map(String);
      return (tf===String(flota) || parts.includes(String(flota)));
    });

    const abiertos=own.filter(tpodIsOpen).sort((a,b)=>tpodTransitTime(b)-tpodTransitTime(a));

    if(abiertos.length){
      const t=abiertos[0];
      save(LS.transit,t);
      if(typeof saveTransitHistory==="function") saveTransitHistory(t);
      return t;
    }

    // Si sólo hay cerrados, limpiar para iniciar un tránsito nuevo.
    localStorage.removeItem(LS.transit);
    return null;
  }catch(e){
    console.log("tpodCargarTransitoAbiertoDeFlota",e);
    return null;
  }
}

function tpodResumenTransito(t){
  if(!t) return "Sin tránsito abierto. Listo para iniciar nuevo tránsito.";
  const emb=t.embarque||"-";
  const lote=t.lote||"-";
  const alertas=(t.alerts||[]).length;
  const pos=tpodUltimaUbicacionTexto(t);
  return `Tránsito abierto: Emb. ${emb} / Lote ${lote} / Alertas ${alertas} / Posición ${pos}`;
}

async function saveUser(){
  const fleetEl=document.getElementById("userFleet");
  const driverEl=document.getElementById("userDriver");
  const phonesEl=document.getElementById("userPhones");
  const fleet=fleetEl ? fleetEl.value.trim() : "";
  const driver=driverEl ? driverEl.value.trim() : "";
  const phones=phonesEl ? phonesEl.value.trim() : "";
  const msg=document.getElementById("userMsg");

  if(msg) msg.innerHTML='<p>Validando flota...</p>';

  const val=await validarFlotaEnBase(fleet);
  if(!val.ok){
    if(msg) msg.innerHTML='<p class="err">'+escapeHtml(val.msg)+'</p>';
    window.alert(val.msg);
    tpodStatus("Desconectado",false);
    return;
  }

  save(LS.user,{fleet:fleet,driver:driver,phones:phones,validado:true,cloudUserId:val.id});
  cloudUser={user:val.id, role:"flota", flota:fleet, activo:true};
  if(LS.cloudUser) save(LS.cloudUser,cloudUser);
  tpodStatus("Conectado",true);

  const abierto=await tpodCargarTransitoAbiertoDeFlota(fleet);

  if(msg){
    msg.innerHTML='<p class="ok">Flota validada. '+escapeHtml(tpodResumenTransito(abierto))+'</p>';
  }

  renderInicio();
  if(typeof startCloudListenerModoFlota==="function") startCloudListenerModoFlota();
  setTimeout(()=>show(abierto ? "tracking" : "inicio"),350);
}

function tpodGpsObj(t){
  return t.ultimaPosicion || ((t.updates&&t.updates.length)?t.updates[t.updates.length-1].gps:(t.closed||t.start));
}

function tpodDistKm(a,b,c,d){
  const R=6371, toRad=x=>x*Math.PI/180;
  const dLat=toRad(c-a), dLng=toRad(d-b);
  const A=Math.sin(dLat/2)**2+Math.cos(toRad(a))*Math.cos(toRad(c))*Math.sin(dLng/2)**2;
  return 2*R*Math.atan2(Math.sqrt(A),Math.sqrt(1-A));
}

function tpodLocalidadDesdeCoords(lat,lng){
  lat=Number(lat); lng=Number(lng);
  if(!isFinite(lat) || !isFinite(lng)) return "-";

  const lugares=[
    ["CABA",-34.604,-58.382],["El Palomar",-34.616,-58.459],["Morón",-34.653,-58.619],
    ["Hurlingham",-34.588,-58.640],["Avellaneda",-34.664,-58.365],["La Plata",-34.921,-57.954],
    ["General Rodríguez",-34.608,-58.952],["Luján",-34.570,-59.105],["Mercedes",-34.651,-59.430],
    ["Zárate",-34.095,-59.026],["Campana",-34.163,-58.959],["San Pedro",-33.679,-59.666],
    ["San Nicolás",-33.335,-60.225],["Rosario",-32.947,-60.639],["Arroyo Seco",-33.154,-60.508],
    ["Villa Constitución",-33.228,-60.329],["Santa Fe",-31.633,-60.700],["Paraná",-31.741,-60.511],
    ["Villa María",-32.410,-63.243],["Córdoba",-31.420,-64.188],["Río Cuarto",-33.123,-64.349],
    ["Villa Mercedes",-33.675,-65.462],["San Luis",-33.302,-66.337],["Mendoza",-32.890,-68.845],
    ["Luján de Cuyo",-33.039,-68.879],["Potrerillos",-32.956,-69.208],["Uspallata",-32.593,-69.345],
    ["Las Cuevas",-32.816,-70.071],["Paso Cristo Redentor",-32.825,-70.060],["Los Andes",-32.833,-70.598],
    ["Santiago de Chile",-33.448,-70.669],["Valparaíso",-33.047,-71.612],["San Antonio",-33.594,-71.607],
    ["Montevideo",-34.901,-56.164],["Colonia",-34.462,-57.840],["Paysandú",-32.321,-58.076],
    ["Fray Bentos",-33.132,-58.304],["Concepción del Uruguay",-32.484,-58.233],["Gualeguaychú",-33.009,-58.517],
    ["Paso de los Libres",-29.713,-57.087],["Uruguaiana",-29.754,-57.088],["Foz do Iguaçu",-25.516,-54.585],
    ["Curitiba",-25.428,-49.273],["São Paulo",-23.555,-46.639],["Santos",-23.960,-46.333]
  ];

  let best=null;
  lugares.forEach(l=>{
    const d=tpodDistKm(lat,lng,l[1],l[2]);
    if(!best || d<best.d) best={name:l[0],d};
  });

  if(best){
    if(best.d<=50) return best.name;
    if(best.d<=140) return best.name+" (zona)";
  }
  return "Zona GPS";
}

function tpodUltimaUbicacionTexto(t){
  const g=tpodGpsObj(t);
  if(!g || g.lat==null || g.lng==null) return "-";

  if(g.localidad) return String(g.localidad);
  if(t.localidad) return String(t.localidad);
  if(t.ultimaLocalidad) return String(t.ultimaLocalidad);

  return tpodLocalidadDesdeCoords(g.lat,g.lng);
}

function tpodLastGps(t){
  return tpodUltimaUbicacionTexto(t);
}

function lastGpsText(t){
  return tpodUltimaUbicacionTexto(t);
}

function tpodEmbarquesCompartidos(items, flota){
  const permitidos=new Set();
  items.forEach(t=>{
    const tf=String((t.user&&t.user.fleet)||t.flota||"");
    const parts=(t.participantes||[]).map(String);
    if(tf===String(flota) || parts.includes(String(flota))){
      if(t.embarque) permitidos.add(String(t.embarque));
    }
  });

  const actual=currentEmbarqueValue && currentEmbarqueValue();
  if(actual) permitidos.add(String(actual));
  return permitidos;
}

function tpodDedupEmbarques(items){
  const map=new Map();

  items.forEach(t=>{
    const emb=String(t.embarque||"");
    const flota=String((t.user&&t.user.fleet)||t.flota||"");
    const key=emb+"|"+flota;

    if(!map.has(key)){
      map.set(key,t);
      return;
    }

    const old=map.get(key);
    // Para mismo embarque + misma flota: priorizar abierto y luego el más nuevo.
    if(tpodIsOpen(t) && !tpodIsOpen(old)){
      map.set(key,t);
    }else if(tpodIsOpen(t)===tpodIsOpen(old) && tpodTransitTime(t)>tpodTransitTime(old)){
      map.set(key,t);
    }
  });

  return Array.from(map.values());
}

function renderEmbarque(){
  tpodBuildEmbarqueScreen();
  const box=document.getElementById("embarqueList");
  if(!box)return;

  const flota=tpodCurrentFlota();
  if(!flota){
    tpodSetFiltro("-");
    box.innerHTML='<div class="emptyBox">Valide la flota en Usuario.</div>';
    return;
  }

  let items=(cloudTransitosCache||[]).map(t=>t&&t.id?t:tpodNormTransit(t&&t.id,t)).filter(Boolean);

  const permitidos=tpodEmbarquesCompartidos(items, flota);

  // Mostrar todos los tránsitos que compartan el mismo número de embarque, sin importar la flota.
  items=items.filter(t=>permitidos.has(String(t.embarque||"")));

  // No repetir misma información: mismo embarque + misma flota queda sólo una tarjeta.
  items=tpodDedupEmbarques(items);

  items.sort((a,b)=>{
    const ea=String(a.embarque||"");
    const eb=String(b.embarque||"");
    if(ea!==eb) return ea.localeCompare(eb);
    const fa=String((a.user&&a.user.fleet)||a.flota||"");
    const fb=String((b.user&&b.user.fleet)||b.flota||"");
    return fa.localeCompare(fb);
  });

  const actual=currentEmbarqueValue && currentEmbarqueValue();
  const embTitulo=actual || (items[0]&&items[0].embarque) || "-";
  tpodSetFiltro(embTitulo);

  if(!items.length){
    box.innerHTML='<div class="emptyBox">No hay embarques compartidos para esta flota.</div>';
    return;
  }

  box.innerHTML=items.map(t=>{
    const cerrado=!!t.closed || t.estado==="cerrado";
    const flotaT=escapeHtml((t.user&&t.user.fleet)||t.flota||"-");
    const emb=escapeHtml(t.embarque||"-");
    const inicio=escapeHtml(tpodDate(t.start));
    const ubicacion=escapeHtml(tpodUltimaUbicacionTexto(t));
    const alerta=escapeHtml(tpodLastAlert(t));
    return `<div class="embarqueItem ${cerrado?'closed':'open'}" onclick="abrirTransitoCloud('${escapeHtml(t.id)}')">
      <div class="embTop"><b>Emb. ${emb} / Flota ${flotaT}</b><span>${cerrado?'Cerrado':'Abierto'}</span></div>
      <div>Inicio: ${inicio}</div>
      <div>Cierre: ${cerrado?escapeHtml(tpodDate(t.closed)):"-"}</div>
      <div>Últ. posición: ${ubicacion}</div>
      <div>Últ. alerta: ${alerta}</div>
    </div>`;
  }).join("");
}

async function refreshEmbarquesCloud(){
  const box=document.getElementById("embarqueList");
  const flota=tpodCurrentFlota();

  if(!flota){
    tpodSetFiltro("-");
    if(box) box.innerHTML='<div class="emptyBox">Valide la flota en Usuario.</div>';
    return;
  }

  if(!tpodInitFirebase()){
    if(box) box.innerHTML='<div class="emptyBox">Desconectado.</div>';
    return;
  }

  try{
    const snap=await db.collection("transitos").get();
    cloudTransitosCache=snap.docs.map(d=>tpodNormTransit(d.id,d.data()));
    tpodStatus("Conectado",true);
    renderEmbarque();
  }catch(e){
    tpodStatus("Desconectado",false);
    if(box) box.innerHTML='<div class="emptyBox">Error leyendo embarques.</div>';
  }
}




/* ===== v1.4.90 VALIDACION Y LIMPIEZA FLOTA ===== */
function tpodLimpiarTransitoLocal(){
  try{localStorage.removeItem(LS.transit);}catch(e){}
  try{
    const lote=document.getElementById("lote"); if(lote) lote.value="";
    const emb=document.getElementById("embarqueInput"); if(emb) emb.value="";
    const filtro=document.getElementById("embarqueFiltro"); if(filtro) filtro.innerText="-";
    const list=document.getElementById("embarqueList"); if(list) list.innerHTML='<div class="emptyBox">Sin tránsito abierto.</div>';
  }catch(e){}
}
function bloquearFormularioTransito(){
  const t=transit();
  const active=!!(t&&!t.closed&&String(t.estado||"abierto").toLowerCase()!=="cerrado");
  ["clienteSelect","origenSelect","destinoSelect","lote","embarqueInput"].forEach(id=>{const el=document.getElementById(id); if(el) el.disabled=active;});
}
function limpiarCamposInicio(){tpodLimpiarTransitoLocal();bloquearFormularioTransito();}
function renderInicio(){
  if(typeof tpodEnsureInicioEmbarqueInput==="function") tpodEnsureInicioEmbarqueInput();
  const u=user(); const inp=document.getElementById("inicioUser");
  if(inp) inp.value=(u.fleet||"Sin flota")+" - "+(u.driver||"Sin chofer");
  const t=transit();
  if(t&&!t.closed&&String(t.estado||"abierto").toLowerCase()!=="cerrado"){
    if(document.getElementById("lote")) document.getElementById("lote").value=t.lote||"";
    if(document.getElementById("embarqueInput")) document.getElementById("embarqueInput").value=t.embarque||"";
  }else{
    if(document.getElementById("lote")) document.getElementById("lote").value="";
    if(document.getElementById("embarqueInput")) document.getElementById("embarqueInput").value="";
  }
  renderTransitStatus(); aplicarColorResumenInicio(); bloquearFormularioTransito();
}
async function tpodCargarTransitoAbiertoDeFlota(flota){
  if(!flota||!tpodInitFirebase()) return null;
  try{
    const snap=await db.collection("transitos").get();
    const all=snap.docs.map(d=>tpodNormTransit(d.id,d.data()));
    cloudTransitosCache=all;
    const own=all.filter(t=>{
      const tf=String((t.user&&t.user.fleet)||t.flota||"");
      const parts=(t.participantes||[]).map(String);
      return tf===String(flota)||parts.includes(String(flota));
    });
    const abiertos=own.filter(t=>t&&!t.closed&&String(t.estado||"abierto").toLowerCase()!=="cerrado").sort((a,b)=>tpodTransitTime(b)-tpodTransitTime(a));
    if(abiertos.length){const t=abiertos[0];save(LS.transit,t);if(typeof saveTransitHistory==="function") saveTransitHistory(t);return t;}
    tpodLimpiarTransitoLocal(); return null;
  }catch(e){console.log(e);tpodLimpiarTransitoLocal();return null;}
}
function tpodResumenTransito(t){
  if(!t)return "Sin tránsito abierto. Listo para iniciar nuevo tránsito.";
  return `Tránsito abierto: Emb. ${t.embarque||"-"} / Lote ${t.lote||"-"} / Alertas ${(t.alerts||[]).length} / Posición ${tpodUltimaUbicacionTexto(t)}`;
}
async function saveUser(){
  const fleet=(document.getElementById("userFleet")||{}).value||"";
  const driver=(document.getElementById("userDriver")||{}).value||"";
  const phones=(document.getElementById("userPhones")||{}).value||"";
  const msg=document.getElementById("userMsg");
  if(msg) msg.innerHTML='<p>Validando flota...</p>';
  const val=await validarFlotaEnBase(fleet.trim());
  if(!val.ok){if(msg)msg.innerHTML='<p class="err">'+escapeHtml(val.msg)+'</p>';window.alert(val.msg);tpodStatus("Desconectado",false);return;}
  save(LS.user,{fleet:fleet.trim(),driver:driver.trim(),phones:phones.trim(),validado:true,cloudUserId:val.id});
  cloudUser={user:val.id,role:"flota",flota:fleet.trim(),activo:true};
  if(LS.cloudUser) save(LS.cloudUser,cloudUser);
  tpodStatus("Conectado",true);
  const abierto=await tpodCargarTransitoAbiertoDeFlota(fleet.trim());
  if(msg) msg.innerHTML='<p class="ok">Flota validada. '+escapeHtml(tpodResumenTransito(abierto))+'</p>';
  renderInicio();
  if(typeof startCloudListenerModoFlota==="function") startCloudListenerModoFlota();
  setTimeout(()=>show("inicio"),350);
}
function currentEmbarqueValue(){
  const t=transit();
  if(t&&!t.closed&&String(t.estado||"abierto").toLowerCase()!=="cerrado"&&t.embarque)return t.embarque;
  const el=document.getElementById("embarqueInput");
  return el?String(el.value||"").trim():"";
}
function renderEmbarque(){
  tpodBuildEmbarqueScreen();
  const box=document.getElementById("embarqueList"); if(!box)return;
  const flota=tpodCurrentFlota();
  if(!flota){tpodSetFiltro("-");box.innerHTML='<div class="emptyBox">Valide la flota en Usuario.</div>';return;}
  let items=(cloudTransitosCache||[]).map(t=>t&&t.id?t:tpodNormTransit(t&&t.id,t)).filter(Boolean);
  const permitidos=tpodEmbarquesCompartidos(items,flota);
  const actual=currentEmbarqueValue();
  if(!actual&&permitidos.size===0){tpodSetFiltro("-");box.innerHTML='<div class="emptyBox">Sin tránsito abierto.</div>';return;}
  items=tpodDedupEmbarques(items.filter(t=>permitidos.has(String(t.embarque||""))));
  items.sort((a,b)=>String(a.embarque||"").localeCompare(String(b.embarque||""))||String((a.user&&a.user.fleet)||a.flota||"").localeCompare(String((b.user&&b.user.fleet)||b.flota||"")));
  tpodSetFiltro(actual||(items[0]&&items[0].embarque)||"-");
  if(!items.length){box.innerHTML='<div class="emptyBox">No hay embarques compartidos para esta flota.</div>';return;}
  box.innerHTML=items.map(t=>`<div class="embarqueItem ${t.closed||t.estado==="cerrado"?'closed':'open'}" onclick="abrirTransitoCloud('${escapeHtml(t.id)}')"><div class="embTop"><b>Emb. ${escapeHtml(t.embarque||"-")} / Flota ${escapeHtml((t.user&&t.user.fleet)||t.flota||"-")}</b><span>${t.closed||t.estado==="cerrado"?'Cerrado':'Abierto'}</span></div><div>Inicio: ${escapeHtml(tpodDate(t.start))}</div><div>Cierre: ${t.closed||t.estado==="cerrado"?escapeHtml(tpodDate(t.closed)):"-"}</div><div>Últ. posición: ${escapeHtml(tpodUltimaUbicacionTexto(t))}</div><div>Últ. alerta: ${escapeHtml(tpodLastAlert(t))}</div></div>`).join("");
}
async function refreshEmbarquesCloud(){
  const box=document.getElementById("embarqueList"); const flota=tpodCurrentFlota();
  if(!flota){tpodSetFiltro("-");if(box)box.innerHTML='<div class="emptyBox">Valide la flota en Usuario.</div>';return;}
  if(!tpodInitFirebase()){if(box)box.innerHTML='<div class="emptyBox">Desconectado.</div>';return;}
  try{const snap=await db.collection("transitos").get();cloudTransitosCache=snap.docs.map(d=>tpodNormTransit(d.id,d.data()));tpodStatus("Conectado",true);renderEmbarque();}
  catch(e){tpodStatus("Desconectado",false);if(box)box.innerHTML='<div class="emptyBox">Error leyendo embarques.</div>';}
}




/* ===== v1.4.91 FIX VALIDACION FLOTA Y EMBARQUES ===== */
function tpodStatus(txt, ok){
  const el=document.getElementById("cloudStatus");
  if(el){
    const clean=String(txt||"").replace(/^Cloud:\s*/i,"").replace(/^Cloud\s*/i,"").trim();
    el.innerText=clean || (ok ? "Conectado" : "Desconectado");
    el.className="cloudStatus "+(ok ? "ok" : "bad");
  }
}
function cloudStatus(txt, ok){tpodStatus(txt,ok);}
function tpodInitFirebase(){
  try{
    if(typeof firebase==="undefined"){tpodStatus("Desconectado",false);return false;}
    if(typeof FIREBASE_CONFIG!=="undefined"&&!firebase.apps.length)firebase.initializeApp(FIREBASE_CONFIG);
    if(!db)db=firebase.firestore();
    cloudReady=true;tpodStatus("Conectado",true);return true;
  }catch(e){console.log(e);tpodStatus("Desconectado",false);return false;}
}
function tpodCurrentFlota(){try{return String((user().fleet)||"").trim();}catch(e){return "";}}
function tpodIsOpen(t){return !!(t&&!t.closed&&String(t.estado||"abierto").toLowerCase()!=="cerrado");}
function tpodTransitTime(t){
  try{
    const v=(t&&t.start&&t.start.time)||t.start||0;
    const d=(v&&v.toDate)?v.toDate():(v&&v.seconds?new Date(v.seconds*1000):new Date(v));
    return d&&!isNaN(d.getTime())?d.getTime():0;
  }catch(e){return 0;}
}
function tpodNormTransit(id,x){
  x=x||{};const route=x.route||{};const user=x.user||{fleet:x.flota||"",driver:x.chofer||""};
  return {id:x.id||id||"",user:user,route:{...route,cliente:route.cliente||x.cliente||"",origen:route.origen||x.origen||"",destino:route.destino||x.destino||"",origen_lat:route.origen_lat||x.origen_lat,origen_lng:route.origen_lng||x.origen_lng,destino_lat:route.destino_lat||x.destino_lat,destino_lng:route.destino_lng||x.destino_lng},lote:x.lote||"",embarque:x.embarque||"",start:x.start||null,updates:x.updates||[],alerts:x.alerts||[],closed:x.closed||null,participantes:x.participantes||[],estado:x.estado||(x.closed?"cerrado":"abierto"),ultimaPosicion:x.ultimaPosicion||null,ultimaAlerta:x.ultimaAlerta||null,flota:x.flota||user.fleet||"",chofer:x.chofer||user.driver||""};
}
function tpodLimpiarCamposTransito(){
  try{localStorage.removeItem(LS.transit);}catch(e){}
  ["lote","embarqueInput"].forEach(id=>{const el=document.getElementById(id);if(el){el.value="";el.disabled=false;}});
  const f=document.getElementById("embarqueFiltro");if(f)f.innerText="-";
  const list=document.getElementById("embarqueList");if(list)list.innerHTML='<div class="emptyBox">Sin tránsito abierto.</div>';
}
function bloquearFormularioTransito(){
  const active=tpodIsOpen(transit());
  ["clienteSelect","origenSelect","destinoSelect","lote","embarqueInput"].forEach(id=>{const el=document.getElementById(id);if(el)el.disabled=active;});
}
function limpiarCamposInicio(){tpodLimpiarCamposTransito();bloquearFormularioTransito();}
function renderInicio(){
  if(typeof tpodEnsureInicioEmbarqueInput==="function")tpodEnsureInicioEmbarqueInput();
  const u=user();const inp=document.getElementById("inicioUser");
  if(inp)inp.value=(u.fleet||"Sin flota")+" - "+(u.driver||"Sin chofer");
  const t=transit();
  if(tpodIsOpen(t)){
    const lote=document.getElementById("lote");if(lote)lote.value=t.lote||"";
    const emb=document.getElementById("embarqueInput");if(emb)emb.value=t.embarque||"";
  }else{
    const lote=document.getElementById("lote");if(lote)lote.value="";
    const emb=document.getElementById("embarqueInput");if(emb)emb.value="";
  }
  renderTransitStatus();aplicarColorResumenInicio();bloquearFormularioTransito();
}
function tpodFlotaParticipa(t, flota){
  const tf=String((t.user&&t.user.fleet)||t.flota||"");
  const parts=(t.participantes||[]).map(String);
  return tf===String(flota)||parts.includes(String(flota));
}
async function tpodLeerTransitos(){
  if(!tpodInitFirebase())return [];
  const snap=await db.collection("transitos").get();
  const all=snap.docs.map(d=>tpodNormTransit(d.id,d.data()));
  cloudTransitosCache=all;return all;
}
async function tpodCargarTransitoAbiertoDeFlota(flota){
  if(!flota)return null;
  try{
    const all=await tpodLeerTransitos();
    const abiertos=all.filter(t=>tpodIsOpen(t)&&tpodFlotaParticipa(t,flota)).sort((a,b)=>tpodTransitTime(b)-tpodTransitTime(a));
    if(abiertos.length){
      const t=abiertos[0];save(LS.transit,t);if(typeof saveTransitHistory==="function")saveTransitHistory(t);return t;
    }
    tpodLimpiarCamposTransito();return null;
  }catch(e){console.log("tpodCargarTransitoAbiertoDeFlota",e);tpodLimpiarCamposTransito();return null;}
}
function tpodGpsObj(t){return t.ultimaPosicion||((t.updates&&t.updates.length)?t.updates[t.updates.length-1].gps:(t.closed||t.start));}
function tpodDistKm(a,b,c,d){
  const R=6371,toRad=x=>x*Math.PI/180,dLat=toRad(c-a),dLng=toRad(d-b);
  const A=Math.sin(dLat/2)**2+Math.cos(toRad(a))*Math.cos(toRad(c))*Math.sin(dLng/2)**2;
  return 2*R*Math.atan2(Math.sqrt(A),Math.sqrt(1-A));
}
function tpodLocalidadDesdeCoords(lat,lng){
  lat=Number(lat);lng=Number(lng);if(!isFinite(lat)||!isFinite(lng))return "-";
  const lugares=[["CABA",-34.604,-58.382],["El Palomar",-34.616,-58.459],["Morón",-34.653,-58.619],["Hurlingham",-34.588,-58.640],["Avellaneda",-34.664,-58.365],["La Plata",-34.921,-57.954],["General Rodríguez",-34.608,-58.952],["Luján",-34.570,-59.105],["Mercedes",-34.651,-59.430],["Zárate",-34.095,-59.026],["Campana",-34.163,-58.959],["San Pedro",-33.679,-59.666],["San Nicolás",-33.335,-60.225],["Rosario",-32.947,-60.639],["Villa Constitución",-33.228,-60.329],["Santa Fe",-31.633,-60.700],["Paraná",-31.741,-60.511],["Villa María",-32.410,-63.243],["Córdoba",-31.420,-64.188],["Río Cuarto",-33.123,-64.349],["Villa Mercedes",-33.675,-65.462],["San Luis",-33.302,-66.337],["Mendoza",-32.890,-68.845],["Uspallata",-32.593,-69.345],["Los Andes",-32.833,-70.598],["Santiago de Chile",-33.448,-70.669],["Valparaíso",-33.047,-71.612],["Montevideo",-34.901,-56.164],["Colonia",-34.462,-57.840],["Paysandú",-32.321,-58.076],["Fray Bentos",-33.132,-58.304],["Gualeguaychú",-33.009,-58.517],["Paso de los Libres",-29.713,-57.087],["Uruguaiana",-29.754,-57.088],["São Paulo",-23.555,-46.639]];
  let best=null;lugares.forEach(l=>{const d=tpodDistKm(lat,lng,l[1],l[2]);if(!best||d<best.d)best={name:l[0],d};});
  if(best&&best.d<=50)return best.name;if(best&&best.d<=140)return best.name+" (zona)";return "Zona GPS";
}
function tpodUltimaUbicacionTexto(t){
  const g=tpodGpsObj(t);if(!g||g.lat==null||g.lng==null)return "-";
  if(g.localidad)return String(g.localidad);if(t.localidad)return String(t.localidad);if(t.ultimaLocalidad)return String(t.ultimaLocalidad);
  return tpodLocalidadDesdeCoords(g.lat,g.lng);
}
function tpodLastGps(t){return tpodUltimaUbicacionTexto(t);}
function lastGpsText(t){return tpodUltimaUbicacionTexto(t);}
function tpodResumenTransito(t){
  if(!t)return "Sin tránsito abierto.";
  return `Tránsito abierto: Emb. ${t.embarque||"-"} / Lote ${t.lote||"-"} / Alertas ${(t.alerts||[]).length} / Posición ${tpodUltimaUbicacionTexto(t)}`;
}
async function saveUser(){
  const fleet=(document.getElementById("userFleet")||{}).value||"";
  const driver=(document.getElementById("userDriver")||{}).value||"";
  const phones=(document.getElementById("userPhones")||{}).value||"";
  const msg=document.getElementById("userMsg");
  if(msg)msg.innerHTML='<p>Validando flota...</p>';
  tpodLimpiarCamposTransito();
  const val=await validarFlotaEnBase(fleet.trim());
  if(!val.ok){if(msg)msg.innerHTML='<p class="err">'+escapeHtml(val.msg)+'</p>';window.alert(val.msg);tpodStatus("Desconectado",false);return;}
  save(LS.user,{fleet:fleet.trim(),driver:driver.trim(),phones:phones.trim(),validado:true,cloudUserId:val.id});
  cloudUser={user:val.id,role:"flota",flota:fleet.trim(),activo:true};
  if(LS.cloudUser)save(LS.cloudUser,cloudUser);
  tpodStatus("Conectado",true);
  const abierto=await tpodCargarTransitoAbiertoDeFlota(fleet.trim());
  if(msg)msg.innerHTML='<p class="ok">'+escapeHtml(tpodResumenTransito(abierto))+'</p>';
  renderInicio();
  if(typeof startCloudListenerModoFlota==="function")startCloudListenerModoFlota();
  setTimeout(()=>show("inicio"),350);
}
function currentEmbarqueValue(){
  const t=transit();if(tpodIsOpen(t)&&t.embarque)return t.embarque;
  const el=document.getElementById("embarqueInput");return el?String(el.value||"").trim():"";
}
function tpodEmbarquesPermitidosGlobal(items,flota){
  const permitidos=new Set();
  items.forEach(t=>{if(tpodFlotaParticipa(t,flota)&&t.embarque)permitidos.add(String(t.embarque));});
  const actual=currentEmbarqueValue();if(actual)permitidos.add(String(actual));
  return permitidos;
}
function tpodDedupEmbarques(items){
  const map=new Map();
  items.forEach(t=>{
    const key=String(t.embarque||"")+"|"+String((t.user&&t.user.fleet)||t.flota||"");
    if(!map.has(key)){map.set(key,t);return;}
    const old=map.get(key);
    if(tpodIsOpen(t)&&!tpodIsOpen(old))map.set(key,t);
    else if(tpodIsOpen(t)===tpodIsOpen(old)&&tpodTransitTime(t)>tpodTransitTime(old))map.set(key,t);
  });
  return Array.from(map.values());
}
function renderEmbarque(){
  tpodBuildEmbarqueScreen();
  const box=document.getElementById("embarqueList");if(!box)return;
  const flota=tpodCurrentFlota();
  if(!flota){tpodSetFiltro("-");box.innerHTML='<div class="emptyBox">Valide la flota en Usuario.</div>';return;}
  let items=(cloudTransitosCache||[]).map(t=>t&&t.id?t:tpodNormTransit(t&&t.id,t)).filter(Boolean);
  const permitidos=tpodEmbarquesPermitidosGlobal(items,flota);
  items=tpodDedupEmbarques(items.filter(t=>permitidos.has(String(t.embarque||""))));
  items.sort((a,b)=>String(a.embarque||"").localeCompare(String(b.embarque||""))||String((a.user&&a.user.fleet)||a.flota||"").localeCompare(String((b.user&&b.user.fleet)||b.flota||"")));
  const actual=currentEmbarqueValue();tpodSetFiltro(actual||(items[0]&&items[0].embarque)||"-");
  if(!items.length){box.innerHTML='<div class="emptyBox">No hay embarques compartidos para esta flota.</div>';return;}
  box.innerHTML=items.map(t=>{
    const cerrado=!tpodIsOpen(t), flotaT=escapeHtml((t.user&&t.user.fleet)||t.flota||"-"), emb=escapeHtml(t.embarque||"-"), inicio=escapeHtml(tpodDate(t.start)), ubicacion=escapeHtml(tpodUltimaUbicacionTexto(t)), alerta=escapeHtml(tpodLastAlert(t));
    return `<div class="embarqueItem ${cerrado?'closed':'open'}" onclick="abrirTransitoCloud('${escapeHtml(t.id)}')"><div class="embTop"><b>Emb. ${emb} / Flota ${flotaT}</b><span>${cerrado?'Cerrado':'Abierto'}</span></div><div>Inicio: ${inicio}</div><div>Cierre: ${cerrado?escapeHtml(tpodDate(t.closed)):"-"}</div><div>Últ. posición: ${ubicacion}</div><div>Últ. alerta: ${alerta}</div></div>`;
  }).join("");
}
async function refreshEmbarquesCloud(){
  const box=document.getElementById("embarqueList"), flota=tpodCurrentFlota();
  if(!flota){tpodSetFiltro("-");if(box)box.innerHTML='<div class="emptyBox">Valide la flota en Usuario.</div>';return;}
  try{const all=await tpodLeerTransitos();cloudTransitosCache=all;tpodStatus("Conectado",true);renderEmbarque();}
  catch(e){tpodStatus("Desconectado",false);if(box)box.innerHTML='<div class="emptyBox">Error leyendo embarques.</div>';}
}
try{
  const oldShowOrden=show;
  show=function(id){oldShowOrden(id);if(id==="embarque")setTimeout(()=>refreshEmbarquesCloud(),120);if(id==="inicio")setTimeout(()=>renderInicio(),80);};
}catch(e){}




/* ===== v1.4.92 FIX VALIDACION TRANSITO ABIERTO ===== */
function tpodHardClearTransitForm(){
  try{localStorage.removeItem(LS.transit);}catch(e){}
  try{localStorage.removeItem("trackpod_transit");}catch(e){}
  ["lote","embarqueInput"].forEach(id=>{const el=document.getElementById(id);if(el){el.value="";el.disabled=false;el.removeAttribute("readonly");}});
  ["clienteSelect","origenSelect","destinoSelect"].forEach(id=>{const el=document.getElementById(id);if(el){el.disabled=false;el.removeAttribute("readonly");}});
  const filtro=document.getElementById("embarqueFiltro");if(filtro)filtro.innerText="-";
  const list=document.getElementById("embarqueList");if(list)list.innerHTML='<div class="emptyBox">Sin tránsito abierto.</div>';
}
function tpodOpenState(t){
  if(!t)return false;
  const estado=String(t.estado||"").toLowerCase().trim();
  if(t.closed)return false;
  if(estado==="cerrado"||estado==="closed"||estado==="finalizado")return false;
  return true;
}
function tpodFlotaDeTransito(t){return String((t&&t.user&&t.user.fleet)||t.flota||(t&&t.user&&t.user.flota)||"").trim();}
function tpodFlotaParticipa(t,flota){
  const f=String(flota||"").trim(); if(!f)return false;
  const tf=tpodFlotaDeTransito(t);
  const parts=(t&&t.participantes||[]).map(x=>String(x).trim());
  return tf===f||parts.includes(f);
}
function bloquearFormularioTransito(){
  const active=tpodOpenState(transit());
  ["clienteSelect","origenSelect","destinoSelect","lote","embarqueInput"].forEach(id=>{const el=document.getElementById(id);if(el)el.disabled=active;});
}
function renderInicio(){
  if(typeof tpodEnsureInicioEmbarqueInput==="function")tpodEnsureInicioEmbarqueInput();
  const u=user();const inp=document.getElementById("inicioUser");
  if(inp)inp.value=(u.fleet||"Sin flota")+" - "+(u.driver||"Sin chofer");
  const t=transit();
  if(tpodOpenState(t)){
    const lote=document.getElementById("lote");const emb=document.getElementById("embarqueInput");
    if(lote)lote.value=t.lote||"";if(emb)emb.value=t.embarque||"";
  }else{
    const lote=document.getElementById("lote");const emb=document.getElementById("embarqueInput");
    if(lote)lote.value="";if(emb)emb.value="";
  }
  renderTransitStatus();aplicarColorResumenInicio();bloquearFormularioTransito();
}
function limpiarCamposInicio(){tpodHardClearTransitForm();renderInicio();}
function tpodTransitTime(t){
  try{const v=(t&&t.start&&t.start.time)||t.start||t.createdAt||0;const d=(v&&v.toDate)?v.toDate():(v&&v.seconds?new Date(v.seconds*1000):new Date(v));return d&&!isNaN(d.getTime())?d.getTime():0;}catch(e){return 0;}
}
function tpodNormTransit(id,x){
  x=x||{};const route=x.route||{};const user=x.user||{fleet:x.flota||"",driver:x.chofer||""};
  return {id:x.id||id||"",user:user,route:{...route,cliente:route.cliente||x.cliente||"",origen:route.origen||x.origen||"",destino:route.destino||x.destino||"",origen_lat:route.origen_lat||x.origen_lat,origen_lng:route.origen_lng||x.origen_lng,destino_lat:route.destino_lat||x.destino_lat,destino_lng:route.destino_lng||x.destino_lng},lote:x.lote||"",embarque:x.embarque||"",start:x.start||null,updates:x.updates||[],alerts:x.alerts||[],closed:x.closed||null,participantes:x.participantes||[],estado:x.estado||"",ultimaPosicion:x.ultimaPosicion||null,ultimaAlerta:x.ultimaAlerta||null,flota:x.flota||user.fleet||"",chofer:x.chofer||user.driver||""};
}
async function tpodLeerTransitos(){
  if(!tpodInitFirebase())return [];
  const snap=await db.collection("transitos").get();
  const all=snap.docs.map(d=>tpodNormTransit(d.id,d.data()));
  cloudTransitosCache=all;return all;
}
async function tpodCargarTransitoAbiertoDeFlota(flota){
  const f=String(flota||"").trim(); if(!f)return null;
  const all=await tpodLeerTransitos();
  const abiertos=all.filter(t=>tpodOpenState(t)).filter(t=>tpodFlotaParticipa(t,f)).sort((a,b)=>tpodTransitTime(b)-tpodTransitTime(a));
  if(abiertos.length){const t=abiertos[0];save(LS.transit,t);if(typeof saveTransitHistory==="function")saveTransitHistory(t);return t;}
  tpodHardClearTransitForm();return null;
}
function tpodResumenTransito(t){if(!t)return "Sin tránsito abierto.";return `Tránsito abierto: Emb. ${t.embarque||"-"} / Lote ${t.lote||"-"} / Alertas ${(t.alerts||[]).length} / Posición ${tpodUltimaUbicacionTexto(t)}`;}
async function saveUser(){
  const fleetEl=document.getElementById("userFleet"),driverEl=document.getElementById("userDriver"),phonesEl=document.getElementById("userPhones");
  const fleet=fleetEl?fleetEl.value.trim():"",driver=driverEl?driverEl.value.trim():"",phones=phonesEl?phonesEl.value.trim():"";
  const msg=document.getElementById("userMsg");if(msg)msg.innerHTML='<p>Validando flota...</p>';
  tpodHardClearTransitForm();
  const val=await validarFlotaEnBase(fleet);
  if(!val.ok){if(msg)msg.innerHTML='<p class="err">'+escapeHtml(val.msg)+'</p>';window.alert(val.msg);tpodStatus("Desconectado",false);renderInicio();setTimeout(()=>show("inicio"),250);return;}
  save(LS.user,{fleet:fleet,driver:driver,phones:phones,validado:true,cloudUserId:val.id});
  cloudUser={user:val.id,role:"flota",flota:fleet,activo:true};if(LS.cloudUser)save(LS.cloudUser,cloudUser);tpodStatus("Conectado",true);
  let abierto=null;try{abierto=await tpodCargarTransitoAbiertoDeFlota(fleet);}catch(e){console.log(e);tpodHardClearTransitForm();}
  if(msg)msg.innerHTML='<p class="ok">'+escapeHtml(tpodResumenTransito(abierto))+'</p>';
  renderInicio();if(typeof startCloudListenerModoFlota==="function")startCloudListenerModoFlota();
  setTimeout(()=>{show("inicio");renderInicio();},350);
}
function currentEmbarqueValue(){
  const t=transit();if(tpodOpenState(t)&&t.embarque)return t.embarque;
  const el=document.getElementById("embarqueInput");return el?String(el.value||"").trim():"";
}
function tpodDedupEmbarques(items){
  const map=new Map();
  items.forEach(t=>{const key=String(t.embarque||"")+"|"+tpodFlotaDeTransito(t);if(!map.has(key)){map.set(key,t);return;}const old=map.get(key);if(tpodOpenState(t)&&!tpodOpenState(old))map.set(key,t);else if(tpodOpenState(t)===tpodOpenState(old)&&tpodTransitTime(t)>tpodTransitTime(old))map.set(key,t);});
  return Array.from(map.values());
}
function renderEmbarque(){
  tpodBuildEmbarqueScreen();const box=document.getElementById("embarqueList");if(!box)return;
  const flota=tpodCurrentFlota();if(!flota){tpodSetFiltro("-");box.innerHTML='<div class="emptyBox">Valide la flota en Usuario.</div>';return;}
  let items=(cloudTransitosCache||[]).map(t=>t&&t.id?t:tpodNormTransit(t&&t.id,t)).filter(Boolean);
  const embarquesPermitidos=new Set();
  items.forEach(t=>{if(tpodFlotaParticipa(t,flota)&&t.embarque)embarquesPermitidos.add(String(t.embarque));});
  const actual=currentEmbarqueValue();if(actual)embarquesPermitidos.add(String(actual));
  items=tpodDedupEmbarques(items.filter(t=>embarquesPermitidos.has(String(t.embarque||""))));
  items.sort((a,b)=>{const ea=String(a.embarque||""),eb=String(b.embarque||"");if(ea!==eb)return ea.localeCompare(eb);return tpodFlotaDeTransito(a).localeCompare(tpodFlotaDeTransito(b));});
  tpodSetFiltro(actual||(items[0]&&items[0].embarque)||"-");
  if(!items.length){box.innerHTML='<div class="emptyBox">No hay embarques compartidos para esta flota.</div>';return;}
  box.innerHTML=items.map(t=>{const cerrado=!tpodOpenState(t),flotaT=escapeHtml(tpodFlotaDeTransito(t)||"-"),emb=escapeHtml(t.embarque||"-"),inicio=escapeHtml(tpodDate(t.start)),ubicacion=escapeHtml(tpodUltimaUbicacionTexto(t)),alerta=escapeHtml(tpodLastAlert(t));return `<div class="embarqueItem ${cerrado?'closed':'open'}" onclick="abrirTransitoCloud('${escapeHtml(t.id)}')"><div class="embTop"><b>Emb. ${emb} / Flota ${flotaT}</b><span>${cerrado?'Cerrado':'Abierto'}</span></div><div>Inicio: ${inicio}</div><div>Cierre: ${cerrado?escapeHtml(tpodDate(t.closed)):"-"}</div><div>Últ. posición: ${ubicacion}</div><div>Últ. alerta: ${alerta}</div></div>`;}).join("");
}
async function refreshEmbarquesCloud(){
  const box=document.getElementById("embarqueList"),flota=tpodCurrentFlota();
  if(!flota){tpodSetFiltro("-");if(box)box.innerHTML='<div class="emptyBox">Valide la flota en Usuario.</div>';return;}
  try{await tpodLeerTransitos();tpodStatus("Conectado",true);renderEmbarque();}catch(e){console.log(e);tpodStatus("Desconectado",false);if(box)box.innerHTML='<div class="emptyBox">Error leyendo embarques.</div>';}
}




/* ===== v1.4.93 EMBARQUES ABIERTOS ===== */
function tpodOpenState(t){
  if(!t) return false;
  const estado=String(t.estado||"").toLowerCase().trim();
  if(t.closed) return false;
  if(estado==="cerrado" || estado==="closed" || estado==="finalizado") return false;
  return true;
}
function tpodFlotaDeTransito(t){
  return String((t&&t.user&&t.user.fleet)||t.flota||(t&&t.user&&t.user.flota)||"").trim();
}
function tpodFlotaParticipa(t, flota){
  const f=String(flota||"").trim();
  if(!f) return false;
  const tf=tpodFlotaDeTransito(t);
  const parts=(t&&t.participantes||[]).map(x=>String(x).trim());
  return tf===f || parts.includes(f);
}
function tpodTransitTime(t){
  try{
    const v=(t&&t.start&&t.start.time)||t.start||t.createdAt||0;
    const d=(v&&v.toDate)?v.toDate():(v&&v.seconds?new Date(v.seconds*1000):new Date(v));
    return d && !isNaN(d.getTime()) ? d.getTime() : 0;
  }catch(e){return 0;}
}
function tpodDedupEmbarquesAbiertos(items){
  const map=new Map();
  items.forEach(t=>{
    const key=String(t.embarque||"")+"|"+tpodFlotaDeTransito(t);
    if(!map.has(key)){map.set(key,t);return;}
    if(tpodTransitTime(t)>tpodTransitTime(map.get(key))) map.set(key,t);
  });
  return Array.from(map.values());
}
async function refreshEmbarquesCloud(){
  const box=document.getElementById("embarqueList");
  const flota=tpodCurrentFlota();
  if(!flota){
    tpodSetFiltro("-");
    if(box) box.innerHTML='<div class="emptyBox">Valide la flota en Usuario.</div>';
    return;
  }
  try{
    await tpodLeerTransitos();
    tpodStatus("Conectado",true);
    renderEmbarque();
  }catch(e){
    console.log("refreshEmbarquesCloud", e);
    tpodStatus("Desconectado",false);
    if(box) box.innerHTML='<div class="emptyBox">Error leyendo embarques.</div>';
  }
}
function renderEmbarque(){
  tpodBuildEmbarqueScreen();
  const box=document.getElementById("embarqueList");
  if(!box) return;

  const flota=tpodCurrentFlota();
  if(!flota){
    tpodSetFiltro("-");
    box.innerHTML='<div class="emptyBox">Valide la flota en Usuario.</div>';
    return;
  }

  let all=(cloudTransitosCache||[]).map(t=>t&&t.id?t:tpodNormTransit(t&&t.id,t)).filter(Boolean);
  let abiertos=all.filter(tpodOpenState);

  const embarquesPermitidos=new Set();
  abiertos.forEach(t=>{
    if(tpodFlotaParticipa(t,flota) && t.embarque){
      embarquesPermitidos.add(String(t.embarque));
    }
  });

  const actual=currentEmbarqueValue && currentEmbarqueValue();
  if(actual) embarquesPermitidos.add(String(actual));

  let items=[];
  if(embarquesPermitidos.size){
    items=abiertos.filter(t=>embarquesPermitidos.has(String(t.embarque||"")));
  }else{
    items=abiertos;
  }

  items=tpodDedupEmbarquesAbiertos(items);
  items.sort((a,b)=>{
    const ea=String(a.embarque||"");
    const eb=String(b.embarque||"");
    if(ea!==eb) return ea.localeCompare(eb);
    return tpodFlotaDeTransito(a).localeCompare(tpodFlotaDeTransito(b));
  });

  tpodSetFiltro(actual || (items[0]&&items[0].embarque) || "-");

  if(!items.length){
    box.innerHTML='<div class="emptyBox">No hay tránsitos abiertos.</div>';
    return;
  }

  box.innerHTML=items.map(t=>{
    const flotaT=escapeHtml(tpodFlotaDeTransito(t)||"-");
    const emb=escapeHtml(t.embarque||"-");
    const inicio=escapeHtml(tpodDate(t.start));
    const ubicacion=escapeHtml(tpodUltimaUbicacionTexto(t));
    const alerta=escapeHtml(tpodLastAlert(t));
    return `<div class="embarqueItem open" onclick="abrirTransitoCloud('${escapeHtml(t.id)}')">
      <div class="embTop"><b>Emb. ${emb} / Flota ${flotaT}</b><span>Abierto</span></div>
      <div>Inicio: ${inicio}</div>
      <div>Cierre: -</div>
      <div>Últ. posición: ${ubicacion}</div>
      <div>Últ. alerta: ${alerta}</div>
    </div>`;
  }).join("");
}
try{
  const oldShowEmbarquesAbiertos=show;
  show=function(id){
    oldShowEmbarquesAbiertos(id);
    if(id==="embarque") setTimeout(()=>refreshEmbarquesCloud(),120);
  };
}catch(e){}




/* ===== v1.4.94 AUTH FLOTA FINAL ===== */
function tpodAuthKey(){return "trackpod_flota_auth_ok";}
function tpodIsAuthorized(){
  try{const a=JSON.parse(localStorage.getItem(tpodAuthKey())||"null");const u=user();return !!(a&&a.ok&&a.flota&&String(a.flota)===String(u.fleet||""));}catch(e){return false;}
}
function tpodSetAuthorized(ok,flota,nombre){
  if(ok)localStorage.setItem(tpodAuthKey(),JSON.stringify({ok:true,flota:String(flota||""),nombre:nombre||"",ts:Date.now()}));
  else localStorage.removeItem(tpodAuthKey());
}
function tpodNombreFlota(){try{const a=JSON.parse(localStorage.getItem(tpodAuthKey())||"null");return(a&&a.nombre)||"";}catch(e){return"";}}
function tpodStatus(txt,ok){const el=document.getElementById("cloudStatus");if(el){const clean=String(txt||"").replace(/^Cloud:\s*/i,"").replace(/^Cloud\s*/i,"").trim();el.innerText=clean||(ok?"Conectado":"Desconectado");el.className="cloudStatus "+(ok?"ok":"bad");}}
function cloudStatus(txt,ok){tpodStatus(txt,ok);}
function tpodInitFirebase(){try{if(typeof firebase==="undefined"){tpodStatus("Desconectado",false);return false;}if(typeof FIREBASE_CONFIG!=="undefined"&&!firebase.apps.length)firebase.initializeApp(FIREBASE_CONFIG);if(!db)db=firebase.firestore();cloudReady=true;tpodStatus("Conectado",true);return true;}catch(e){console.log(e);tpodStatus("Desconectado",false);return false;}}
function tpodCurrentFlota(){try{return String((user().fleet)||"").trim();}catch(e){return"";}}
function tpodDisableViews(){const auth=tpodIsAuthorized();["btn-inicio","btn-tracking","btn-embarque","btn-alertas","btn-clima","btn-ultimo"].forEach(id=>{const b=document.getElementById(id);if(b){b.disabled=!auth;b.classList.toggle("disabledView",!auth);}});}
function tpodPatchShowAuth(){if(window.__tpodShowAuthPatched)return;window.__tpodShowAuthPatched=true;const oldShow=show;show=function(id){if(id!=="usuario"&&!tpodIsAuthorized()){oldShow("usuario");tpodDisableViews();return;}oldShow(id);tpodDisableViews();if(id==="inicio")setTimeout(()=>renderInicio(),80);if(id==="embarque")setTimeout(()=>refreshEmbarquesCloud(),120);};}
function tpodHardClearTransitForm(){try{localStorage.removeItem(LS.transit);}catch(e){}try{localStorage.removeItem("trackpod_transit");}catch(e){}["lote","embarqueInput"].forEach(id=>{const el=document.getElementById(id);if(el){el.value="";el.disabled=false;el.removeAttribute("readonly");}});["clienteSelect","origenSelect","destinoSelect"].forEach(id=>{const el=document.getElementById(id);if(el){el.disabled=false;el.removeAttribute("readonly");}});const filtro=document.getElementById("embarqueFiltro");if(filtro)filtro.innerText="-";const list=document.getElementById("embarqueList");if(list)list.innerHTML='<div class="emptyBox">Sin tránsito abierto.</div>';}
function tpodOpenState(t){if(!t)return false;const estado=String(t.estado||"").toLowerCase().trim();if(t.closed)return false;if(estado==="cerrado"||estado==="closed"||estado==="finalizado")return false;return true;}
function tpodFlotaDeTransito(t){return String((t&&t.user&&t.user.fleet)||t.flota||(t&&t.user&&t.user.flota)||"").trim();}
function tpodFlotaParticipa(t,flota){const f=String(flota||"").trim();if(!f)return false;const tf=tpodFlotaDeTransito(t);const parts=(t&&t.participantes||[]).map(x=>String(x).trim());return tf===f||parts.includes(f);}
function tpodTransitTime(t){try{const v=(t&&t.start&&t.start.time)||t.start||t.createdAt||0;const d=(v&&v.toDate)?v.toDate():(v&&v.seconds?new Date(v.seconds*1000):new Date(v));return d&&!isNaN(d.getTime())?d.getTime():0;}catch(e){return 0;}}
function tpodNormTransit(id,x){x=x||{};const route=x.route||{};const user=x.user||{fleet:x.flota||"",driver:x.chofer||""};return{id:x.id||id||"",user:user,route:{...route,cliente:route.cliente||x.cliente||"",origen:route.origen||x.origen||"",destino:route.destino||x.destino||"",origen_lat:route.origen_lat||x.origen_lat,origen_lng:route.origen_lng||x.origen_lng,destino_lat:route.destino_lat||x.destino_lat,destino_lng:route.destino_lng||x.destino_lng},lote:x.lote||"",embarque:x.embarque||"",start:x.start||null,updates:x.updates||[],alerts:x.alerts||[],closed:x.closed||null,participantes:x.participantes||[],estado:x.estado||"",ultimaPosicion:x.ultimaPosicion||null,ultimaAlerta:x.ultimaAlerta||null,flota:x.flota||user.fleet||"",chofer:x.chofer||user.driver||""};}
async function validarFlotaEnBase(fleet,pass){if(!fleet)return{ok:false,msg:"Debe ingresar flota."};if(!tpodInitFirebase())return{ok:false,msg:"Sin conexión a Firebase."};const f=String(fleet).trim();const p=String(pass||"").trim();const ids=["flota"+f,"flota_"+f,f];try{for(const id of ids){const d=await db.collection("usuarios").doc(id).get();if(d.exists){const x=d.data()||{};const rol=String(x.role||x.rol||"").toLowerCase();const flotaDoc=String(x.flota||x.fleet||f);const activo=x.activo!==false;const passDoc=String(x.pass||x.password||"").trim();const nombre=x.nombre||x.name||x.razonSocial||x.descripcion||("Flota "+f);if(!activo)return{ok:false,msg:"La flota está inactiva."};if(!(rol==="flota"||flotaDoc===f))return{ok:false,msg:"El usuario no corresponde a una flota."};if(!p)return{ok:false,msg:"Debe ingresar PASS."};if(!passDoc)return{ok:false,msg:"La flota no tiene PASS configurado en la base."};if(passDoc!==p)return{ok:false,msg:"PASS incorrecto."};return{ok:true,data:x,id,nombre};}}const snap=await db.collection("usuarios").where("flota","==",f).limit(1).get();if(!snap.empty){const x=snap.docs[0].data()||{};const passDoc=String(x.pass||x.password||"").trim();const nombre=x.nombre||x.name||x.razonSocial||x.descripcion||("Flota "+f);if(x.activo===false)return{ok:false,msg:"La flota está inactiva."};if(!p)return{ok:false,msg:"Debe ingresar PASS."};if(!passDoc)return{ok:false,msg:"La flota no tiene PASS configurado en la base."};if(passDoc!==p)return{ok:false,msg:"PASS incorrecto."};return{ok:true,data:x,id:snap.docs[0].id,nombre};}return{ok:false,msg:"La flota no existe en la base."};}catch(e){return{ok:false,msg:"Error validando flota: "+(e.message||e)};}}
async function tpodLeerTransitos(){if(!tpodInitFirebase())return[];const snap=await db.collection("transitos").get();const all=snap.docs.map(d=>tpodNormTransit(d.id,d.data()));cloudTransitosCache=all;return all;}
async function tpodCargarTransitoAbiertoDeFlota(flota){const f=String(flota||"").trim();if(!f)return null;const all=await tpodLeerTransitos();const abiertos=all.filter(t=>tpodOpenState(t)).filter(t=>tpodFlotaParticipa(t,f)).sort((a,b)=>tpodTransitTime(b)-tpodTransitTime(a));if(abiertos.length){const t=abiertos[0];save(LS.transit,t);if(typeof saveTransitHistory==="function")saveTransitHistory(t);return t;}tpodHardClearTransitForm();return null;}
function bloquearFormularioTransito(){const active=tpodOpenState(transit());["clienteSelect","origenSelect","destinoSelect","lote","embarqueInput"].forEach(id=>{const el=document.getElementById(id);if(el)el.disabled=active;});}
function renderInicio(){if(typeof tpodEnsureInicioEmbarqueInput==="function")tpodEnsureInicioEmbarqueInput();const u=user();const nombre=tpodNombreFlota();const inp=document.getElementById("inicioUser");if(inp)inp.value=(u.fleet||"Sin flota")+" - "+(nombre||u.driver||"Sin nombre");const t=transit();if(tpodOpenState(t)){const lote=document.getElementById("lote");const emb=document.getElementById("embarqueInput");if(lote)lote.value=t.lote||"";if(emb)emb.value=t.embarque||"";}else{const lote=document.getElementById("lote");const emb=document.getElementById("embarqueInput");if(lote)lote.value="";if(emb)emb.value="";}renderTransitStatus();aplicarColorResumenInicio();bloquearFormularioTransito();}
function limpiarCamposInicio(){tpodHardClearTransitForm();renderInicio();}
function tpodResumenTransito(t){if(!t)return"Sin tránsito abierto.";return`Tránsito abierto: Emb. ${t.embarque||"-"} / Lote ${t.lote||"-"} / Alertas ${(t.alerts||[]).length} / Posición ${tpodUltimaUbicacionTexto(t)}`;}
async function saveUser(){const fleetEl=document.getElementById("userFleet");const passEl=document.getElementById("userPass");const driverEl=document.getElementById("userDriver");const phonesEl=document.getElementById("userPhones");const fleet=fleetEl?fleetEl.value.trim():"";const pass=passEl?passEl.value.trim():"";const phones=phonesEl?phonesEl.value.trim():"";const msg=document.getElementById("userMsg");if(msg)msg.innerHTML='<p>Validando flota...</p>';tpodSetAuthorized(false);tpodDisableViews();tpodHardClearTransitForm();const val=await validarFlotaEnBase(fleet,pass);if(!val.ok){if(msg)msg.innerHTML='<p class="err">'+escapeHtml(val.msg)+'</p>';tpodStatus("Desconectado",false);renderInicio();show("usuario");return;}const nombre=val.nombre||("Flota "+fleet);save(LS.user,{fleet:fleet,driver:nombre,phones:phones,validado:true,cloudUserId:val.id,nombre:nombre});cloudUser={user:val.id,role:"flota",flota:fleet,activo:true,nombre:nombre};if(LS.cloudUser)save(LS.cloudUser,cloudUser);tpodSetAuthorized(true,fleet,nombre);tpodStatus("Conectado",true);tpodDisableViews();let abierto=null;try{abierto=await tpodCargarTransitoAbiertoDeFlota(fleet);}catch(e){console.log(e);tpodHardClearTransitForm();}if(msg)msg.innerHTML='<p class="ok">'+escapeHtml(tpodResumenTransito(abierto))+'</p>';renderInicio();if(typeof startCloudListenerModoFlota==="function")startCloudListenerModoFlota();setTimeout(()=>{show("inicio");renderInicio();},350);}
function currentEmbarqueValue(){const t=transit();if(tpodOpenState(t)&&t.embarque)return t.embarque;const el=document.getElementById("embarqueInput");return el?String(el.value||"").trim():"";}
function tpodDedupEmbarquesAbiertos(items){const map=new Map();items.forEach(t=>{const key=String(t.embarque||"")+"|"+tpodFlotaDeTransito(t);if(!map.has(key)){map.set(key,t);return;}if(tpodTransitTime(t)>tpodTransitTime(map.get(key)))map.set(key,t);});return Array.from(map.values());}
async function refreshEmbarquesCloud(){const box=document.getElementById("embarqueList");if(!tpodIsAuthorized()){tpodSetFiltro("-");if(box)box.innerHTML='<div class="emptyBox">Valide la flota en Usuario.</div>';return;}try{await tpodLeerTransitos();tpodStatus("Conectado",true);renderEmbarque();}catch(e){console.log(e);tpodStatus("Desconectado",false);if(box)box.innerHTML='<div class="emptyBox">Error leyendo embarques.</div>';}}
function renderEmbarque(){tpodBuildEmbarqueScreen();const box=document.getElementById("embarqueList");if(!box)return;const flota=tpodCurrentFlota();if(!tpodIsAuthorized()||!flota){tpodSetFiltro("-");box.innerHTML='<div class="emptyBox">Valide la flota en Usuario.</div>';return;}let all=(cloudTransitosCache||[]).map(t=>t&&t.id?t:tpodNormTransit(t&&t.id,t)).filter(Boolean);let abiertos=all.filter(tpodOpenState);const embarquesPermitidos=new Set();abiertos.forEach(t=>{if(tpodFlotaParticipa(t,flota)&&t.embarque)embarquesPermitidos.add(String(t.embarque));});const actual=currentEmbarqueValue&&currentEmbarqueValue();if(actual)embarquesPermitidos.add(String(actual));let items=embarquesPermitidos.size?abiertos.filter(t=>embarquesPermitidos.has(String(t.embarque||""))):abiertos;items=tpodDedupEmbarquesAbiertos(items);items.sort((a,b)=>{const ea=String(a.embarque||""),eb=String(b.embarque||"");if(ea!==eb)return ea.localeCompare(eb);return tpodFlotaDeTransito(a).localeCompare(tpodFlotaDeTransito(b));});tpodSetFiltro(actual||(items[0]&&items[0].embarque)||"-");if(!items.length){box.innerHTML='<div class="emptyBox">No hay tránsitos abiertos.</div>';return;}box.innerHTML=items.map(t=>{const flotaT=escapeHtml(tpodFlotaDeTransito(t)||"-"),emb=escapeHtml(t.embarque||"-"),inicio=escapeHtml(tpodDate(t.start)),ubicacion=escapeHtml(tpodUltimaUbicacionTexto(t)),alerta=escapeHtml(tpodLastAlert(t));return`<div class="embarqueItem open" onclick="abrirTransitoCloud('${escapeHtml(t.id)}')"><div class="embTop"><b>Emb. ${emb} / Flota ${flotaT}</b><span>Abierto</span></div><div>Inicio: ${inicio}</div><div>Cierre: -</div><div>Últ. posición: ${ubicacion}</div><div>Últ. alerta: ${alerta}</div></div>`;}).join("");}
document.addEventListener("DOMContentLoaded",function(){setTimeout(()=>{tpodPatchShowAuth();tpodDisableViews();if(!tpodIsAuthorized())show("usuario");},500);});
setTimeout(()=>{tpodPatchShowAuth();tpodDisableViews();if(!tpodIsAuthorized())show("usuario");},1200);




/* ===== v1.4.95 AUTH + EMBARQUES FIRESTORE FIX ===== */
function togglePass(){const el=document.getElementById("userPass");if(el)el.type=el.type==="password"?"text":"password";}
function tpodClearUsuarioCampos(){["userDriver","userPhones"].forEach(id=>{const el=document.getElementById(id);if(el)el.value="";});}
function tpodSetUsuarioCampos(data,nombre){const d=document.getElementById("userDriver"),p=document.getElementById("userPhones");const chofer=data.chofer||data.driver||data.nombreChofer||data.contacto||nombre||"";const tel=data.telefono||data.phone||data.celular||data.whatsapp||data.phones||"";if(d)d.value=chofer;if(p)p.value=tel;}
function tpodStatus(txt,ok){const el=document.getElementById("cloudStatus");if(el){const clean=String(txt||"").replace(/^Cloud:\s*/i,"").replace(/^Cloud\s*/i,"").trim();el.innerText=clean||(ok?"Conectado":"Desconectado");el.className="cloudStatus "+(ok?"ok":"bad");}}
function cloudStatus(txt,ok){tpodStatus(txt,ok);}
function tpodCurrentFlota(){try{return String((user().fleet)||"").trim();}catch(e){return"";}}
function tpodOpenState(t){if(!t)return false;const estado=String(t.estado||"").toLowerCase().trim();if(t.closed===true)return false;if(t.closed&&t.closed!=="null")return false;if(estado==="cerrado"||estado==="closed"||estado==="finalizado")return false;return estado==="abierto"||!t.closed;}
function tpodFlotaDeTransito(t){return String((t&&t.user&&t.user.fleet)||t.flota||(t&&t.user&&t.user.flota)||"").trim();}
function tpodFlotaParticipa(t,flota){const f=String(flota||"").trim();if(!f)return false;const tf=tpodFlotaDeTransito(t);const parts=(t&&t.participantes||[]).map(x=>String(x).trim());return tf===f||parts.includes(f);}
function tpodTransitTime(t){try{const v=(t&&t.start&&t.start.time)||t.start||t.createdAt||0;const d=(v&&v.toDate)?v.toDate():(v&&v.seconds?new Date(v.seconds*1000):new Date(v));return d&&!isNaN(d.getTime())?d.getTime():0;}catch(e){return 0;}}
function tpodNormTransit(id,x){x=x||{};const route=x.route||{};const user=x.user||{fleet:x.flota||"",driver:x.chofer||""};return{id:x.id||id||"",user:user,route:{...route,cliente:route.cliente||x.cliente||"",origen:route.origen||x.origen||"",destino:route.destino||x.destino||"",origen_lat:route.origen_lat||x.origen_lat,origen_lng:route.origen_lng||x.origen_lng,destino_lat:route.destino_lat||x.destino_lat,destino_lng:route.destino_lng||x.destino_lng},lote:x.lote||"",embarque:x.embarque||"",start:x.start||null,updates:x.updates||[],alerts:x.alerts||[],closed:x.closed,participantes:x.participantes||[],estado:x.estado||"",ultimaPosicion:x.ultimaPosicion||null,ultimaAlerta:x.ultimaAlerta||null,flota:x.flota||user.fleet||"",chofer:x.chofer||user.driver||""};}
async function validarFlotaEnBase(fleet,pass){if(!fleet)return{ok:false,msg:"Debe ingresar flota."};if(!tpodInitFirebase())return{ok:false,msg:"Sin conexión a Firebase."};const f=String(fleet).trim(),pw=String(pass||"").trim(),ids=["flota"+f,"flota_"+f,f];try{for(const id of ids){const d=await db.collection("usuarios").doc(id).get();if(d.exists){const x=d.data()||{};const activo=x.activo!==false,flotaDoc=String(x.flota||x.fleet||f),passDoc=String(x.pass||x.password||"").trim(),nombre=x.nombre||x.name||x.razonSocial||x.descripcion||("Flota "+f);if(!activo)return{ok:false,msg:"La flota está inactiva."};if(flotaDoc!==f)return{ok:false,msg:"La flota no coincide."};if(!pw)return{ok:false,msg:"Debe ingresar PASS."};if(!passDoc)return{ok:false,msg:"Falta campo pass en Firebase."};if(passDoc!==pw)return{ok:false,msg:"PASS incorrecto."};return{ok:true,data:x,id,nombre};}}const snap=await db.collection("usuarios").where("flota","==",f).limit(1).get();if(!snap.empty){const x=snap.docs[0].data()||{};const passDoc=String(x.pass||x.password||"").trim(),nombre=x.nombre||x.name||x.razonSocial||x.descripcion||("Flota "+f);if(x.activo===false)return{ok:false,msg:"La flota está inactiva."};if(!pw)return{ok:false,msg:"Debe ingresar PASS."};if(!passDoc)return{ok:false,msg:"Falta campo pass en Firebase."};if(passDoc!==pw)return{ok:false,msg:"PASS incorrecto."};return{ok:true,data:x,id:snap.docs[0].id,nombre};}return{ok:false,msg:"La flota no existe en la base."};}catch(e){return{ok:false,msg:"Error validando flota: "+(e.message||e)};}}
async function saveUser(){const fleet=(document.getElementById("userFleet")||{}).value||"",pass=(document.getElementById("userPass")||{}).value||"",msg=document.getElementById("userMsg");if(msg)msg.innerHTML='<p>Validando flota...</p>';tpodSetAuthorized(false);tpodDisableViews();tpodHardClearTransitForm();tpodClearUsuarioCampos();const val=await validarFlotaEnBase(fleet.trim(),pass.trim());if(!val.ok){if(msg)msg.innerHTML='<p class="err">'+escapeHtml(val.msg)+'</p>';tpodStatus("Desconectado",false);show("usuario");return;}const nombre=val.nombre||("Flota "+fleet.trim());tpodSetUsuarioCampos(val.data||{},nombre);const tel=(document.getElementById("userPhones")||{}).value||"",chofer=(document.getElementById("userDriver")||{}).value||nombre;save(LS.user,{fleet:fleet.trim(),driver:chofer,phones:tel,validado:true,cloudUserId:val.id,nombre:nombre});cloudUser={user:val.id,role:"flota",flota:fleet.trim(),activo:true,nombre:nombre};if(LS.cloudUser)save(LS.cloudUser,cloudUser);tpodSetAuthorized(true,fleet.trim(),nombre);tpodStatus("Conectado",true);tpodDisableViews();let abierto=null;try{abierto=await tpodCargarTransitoAbiertoDeFlota(fleet.trim());}catch(e){console.log(e);tpodHardClearTransitForm();}if(msg)msg.innerHTML='<p class="ok">'+escapeHtml(tpodResumenTransito(abierto))+'</p>';renderInicio();setTimeout(()=>{show("inicio");renderInicio();},350);}
function renderInicio(){if(typeof tpodEnsureInicioEmbarqueInput==="function")tpodEnsureInicioEmbarqueInput();const u=user(),inp=document.getElementById("inicioUser");if(inp)inp.value=(u.fleet||"Sin flota")+" - "+(u.driver||tpodNombreFlota()||"Sin nombre");const t=transit();if(tpodOpenState(t)){const l=document.getElementById("lote"),e=document.getElementById("embarqueInput");if(l)l.value=t.lote||"";if(e)e.value=t.embarque||"";}else{const l=document.getElementById("lote"),e=document.getElementById("embarqueInput");if(l)l.value="";if(e)e.value="";}renderTransitStatus();aplicarColorResumenInicio();bloquearFormularioTransito();}
async function tpodLeerTransitos(){if(!tpodInitFirebase())return[];const snap=await db.collection("transitos").get();const all=snap.docs.map(d=>tpodNormTransit(d.id,d.data()));cloudTransitosCache=all;return all;}
async function refreshEmbarquesCloud(){const box=document.getElementById("embarqueList");if(!tpodIsAuthorized()){tpodSetFiltro("-");if(box)box.innerHTML='<div class="emptyBox">Valide la flota en Usuario.</div>';return;}try{await tpodLeerTransitos();tpodStatus("Conectado",true);renderEmbarque();}catch(e){console.log(e);tpodStatus("Desconectado",false);if(box)box.innerHTML='<div class="emptyBox">Error leyendo embarques.</div>';}}
function renderEmbarque(){tpodBuildEmbarqueScreen();const box=document.getElementById("embarqueList");if(!box)return;const flota=tpodCurrentFlota();if(!tpodIsAuthorized()||!flota){tpodSetFiltro("-");box.innerHTML='<div class="emptyBox">Valide la flota en Usuario.</div>';return;}let all=(cloudTransitosCache||[]).map(t=>t&&t.id?t:tpodNormTransit(t&&t.id,t)).filter(Boolean);let abiertos=all.filter(tpodOpenState);const permitidos=new Set();abiertos.forEach(t=>{if(tpodFlotaParticipa(t,flota)&&t.embarque)permitidos.add(String(t.embarque));});let items=permitidos.size?abiertos.filter(t=>permitidos.has(String(t.embarque||""))):abiertos;const map=new Map();items.forEach(t=>{const key=String(t.embarque||"")+"|"+tpodFlotaDeTransito(t);if(!map.has(key)||tpodTransitTime(t)>tpodTransitTime(map.get(key)))map.set(key,t);});items=Array.from(map.values()).sort((a,b)=>{const ea=String(a.embarque||""),eb=String(b.embarque||"");if(ea!==eb)return ea.localeCompare(eb);return tpodFlotaDeTransito(a).localeCompare(tpodFlotaDeTransito(b));});tpodSetFiltro((items[0]&&items[0].embarque)||"-");if(!items.length){box.innerHTML='<div class="emptyBox">No hay tránsitos abiertos.</div>';return;}box.innerHTML=items.map(t=>{const flotaT=escapeHtml(tpodFlotaDeTransito(t)||"-"),emb=escapeHtml(t.embarque||"-"),inicio=escapeHtml(tpodDate(t.start)),ubicacion=escapeHtml(tpodUltimaUbicacionTexto(t)),alerta=escapeHtml(tpodLastAlert(t));return`<div class="embarqueItem open" onclick="abrirTransitoCloud('${escapeHtml(t.id)}')"><div class="embTop"><b>Emb. ${emb} / Flota ${flotaT}</b><span>Abierto</span></div><div>Inicio: ${inicio}</div><div>Cierre: -</div><div>Últ. posición: ${ubicacion}</div><div>Últ. alerta: ${alerta}</div></div>`;}).join("");}




/* ===== v1.4.96 EMBARQUES DIRECTO FIRESTORE ===== */
function tpodIsTransitOpen96(t){
  if(!t)return false;
  const estado=String(t.estado||"").toLowerCase().trim();
  if(t.closed===true)return false;
  if(t.closed&&t.closed!==null&&String(t.closed).toLowerCase()!=="null")return false;
  if(estado==="cerrado"||estado==="closed"||estado==="finalizado")return false;
  return estado==="abierto"||t.closed===null||t.closed===undefined;
}
function tpodFleet96(t){return String((t.user&&t.user.fleet)||t.flota||(t.user&&t.user.flota)||"").trim();}
function tpodParticipa96(t,flota){
  const f=String(flota||"").trim();
  const parts=(t.participantes||[]).map(x=>String(x).trim());
  return tpodFleet96(t)===f||parts.includes(f);
}
function tpodTime96(t){
  try{const v=(t.start&&t.start.time)||t.start||t.createdAt||0;const d=(v&&v.toDate)?v.toDate():(v&&v.seconds?new Date(v.seconds*1000):new Date(v));return d&&!isNaN(d.getTime())?d.getTime():0;}catch(e){return 0;}
}
function tpodNorm96(id,x){
  x=x||{};const route=x.route||{};const user=x.user||{fleet:x.flota||"",driver:x.chofer||""};
  return {id:x.id||id||"",user:user,route:{...route,cliente:route.cliente||x.cliente||"",origen:route.origen||x.origen||"",destino:route.destino||x.destino||""},lote:x.lote||"",embarque:x.embarque||"",start:x.start||null,updates:x.updates||[],alerts:x.alerts||[],closed:x.closed,participantes:x.participantes||[],estado:x.estado||"",ultimaPosicion:x.ultimaPosicion||null,ultimaAlerta:x.ultimaAlerta||null,flota:x.flota||user.fleet||"",chofer:x.chofer||user.driver||""};
}
async function tpodLoadOpenDirect96(){
  if(!tpodInitFirebase())return [];
  const snap=await db.collection("transitos").get();
  return snap.docs.map(d=>tpodNorm96(d.id,d.data())).filter(tpodIsTransitOpen96);
}
function tpodDedup96(items){
  const m=new Map();
  items.forEach(t=>{const k=String(t.embarque||"")+"|"+tpodFleet96(t);if(!m.has(k)||tpodTime96(t)>tpodTime96(m.get(k)))m.set(k,t);});
  return Array.from(m.values());
}
function tpodRenderEmbarqueItems96(items){
  tpodBuildEmbarqueScreen();
  const box=document.getElementById("embarqueList");
  if(!box)return;
  items=tpodDedup96(items);
  items.sort((a,b)=>String(a.embarque||"").localeCompare(String(b.embarque||""))||tpodFleet96(a).localeCompare(tpodFleet96(b)));
  tpodSetFiltro((items[0]&&items[0].embarque)||"-");
  if(!items.length){box.innerHTML='<div class="emptyBox">No hay tránsitos abiertos.</div>';return;}
  box.innerHTML=items.map(t=>{
    const flota=escapeHtml(tpodFleet96(t)||"-"), emb=escapeHtml(t.embarque||"-"), lote=escapeHtml(t.lote||"-");
    const cliente=escapeHtml((t.route&&t.route.cliente)||"-"), origen=escapeHtml((t.route&&t.route.origen)||"-"), destino=escapeHtml((t.route&&t.route.destino)||"-");
    const inicio=escapeHtml(tpodDate(t.start)), ubicacion=escapeHtml(tpodUltimaUbicacionTexto(t)), alerta=escapeHtml(tpodLastAlert(t));
    return `<div class="embarqueItem open" onclick="abrirTransitoCloud('${escapeHtml(t.id)}')"><div class="embTop"><b>Emb. ${emb} / Flota ${flota}</b><span>Abierto</span></div><div>Lote/Carga: ${lote}</div><div>Cliente: ${cliente}</div><div>Origen: ${origen}</div><div>Destino: ${destino}</div><div>Inicio: ${inicio}</div><div>Últ. posición: ${ubicacion}</div><div>Últ. alerta: ${alerta}</div></div>`;
  }).join("");
}
async function refreshEmbarquesCloud(){
  tpodBuildEmbarqueScreen();
  const box=document.getElementById("embarqueList");
  const flota=tpodCurrentFlota();
  if(!tpodIsAuthorized||!tpodIsAuthorized()||!flota){
    tpodSetFiltro("-");
    if(box)box.innerHTML='<div class="emptyBox">Valide la flota en Usuario.</div>';
    return;
  }
  if(box)box.innerHTML='<div class="emptyBox">Leyendo embarques abiertos...</div>';
  try{
    const abiertos=await tpodLoadOpenDirect96();
    cloudTransitosCache=abiertos;
    tpodStatus("Conectado",true);
    const misEmb=new Set();
    abiertos.forEach(t=>{if(tpodParticipa96(t,flota)&&t.embarque)misEmb.add(String(t.embarque));});
    const items=misEmb.size?abiertos.filter(t=>misEmb.has(String(t.embarque||""))):abiertos;
    tpodRenderEmbarqueItems96(items);
  }catch(e){
    console.log("embarques v96",e);
    tpodStatus("Desconectado",false);
    if(box)box.innerHTML='<div class="emptyBox">Error leyendo embarques abiertos.</div>';
  }
}
function renderEmbarque(){refreshEmbarquesCloud();}
function renderEmbarqueHoy(){refreshEmbarquesCloud();}
try{const oldShow96=show;show=function(id){oldShow96(id);if(id==="embarque")setTimeout(()=>refreshEmbarquesCloud(),150);};}catch(e){}




/* ===== v1.4.97 USUARIO + ULTIMO FIX ===== */
function tpodClearUltimoView(){
  try{
    localStorage.removeItem("trackpod_last");
    localStorage.removeItem("trackpod_lastTransit");
    localStorage.removeItem("trackpod_ultimo");
    localStorage.removeItem("trackpod_history");
  }catch(e){}
  ["ultimoList","ultimoContent","lastContent","lastTransit","ultimoBody"].forEach(id=>{
    const el=document.getElementById(id);
    if(el)el.innerHTML='<div class="emptyBox">Sin información para la flota validada.</div>';
  });
}
function tpodHardClearTransitForm(){
  try{localStorage.removeItem(LS.transit);}catch(e){}
  try{localStorage.removeItem("trackpod_transit");}catch(e){}
  ["lote","embarqueInput"].forEach(id=>{const el=document.getElementById(id);if(el){el.value="";el.disabled=false;el.removeAttribute("readonly");}});
  ["clienteSelect","origenSelect","destinoSelect"].forEach(id=>{const el=document.getElementById(id);if(el){el.disabled=false;el.removeAttribute("readonly");}});
  const filtro=document.getElementById("embarqueFiltro");if(filtro)filtro.innerText="-";
  const list=document.getElementById("embarqueList");if(list)list.innerHTML='<div class="emptyBox">Sin tránsito abierto.</div>';
  tpodClearUltimoView();
}
function tpodClearUsuarioCampos(){["userDriver","userPhones"].forEach(id=>{const el=document.getElementById(id);if(el)el.value="";});}
function tpodChoferDesdeBase(data,nombreFallback){return String(data.user||data.chofer||data.driver||data.nombreChofer||data.contacto||nombreFallback||"");}
function tpodTelefonoDesdeBase(data){return String(data.telefono||data.phone||data.celular||data.whatsapp||data.phones||"");}
function tpodSetUsuarioCampos(data,nombre){
  const d=document.getElementById("userDriver"),p=document.getElementById("userPhones");
  if(d)d.value=tpodChoferDesdeBase(data,nombre);
  if(p)p.value=tpodTelefonoDesdeBase(data);
}
async function saveUser(){
  const fleet=(document.getElementById("userFleet")||{}).value||"";
  const pass=(document.getElementById("userPass")||{}).value||"";
  const msg=document.getElementById("userMsg");
  if(msg)msg.innerHTML='<p>Validando flota...</p>';
  tpodSetAuthorized(false);
  tpodDisableViews();
  tpodHardClearTransitForm();
  tpodClearUsuarioCampos();
  const val=await validarFlotaEnBase(fleet.trim(),pass.trim());
  if(!val.ok){
    if(msg)msg.innerHTML='<p class="err">'+escapeHtml(val.msg)+'</p>';
    tpodStatus("Desconectado",false);
    tpodClearUsuarioCampos();
    tpodHardClearTransitForm();
    show("usuario");
    return;
  }
  const nombre=val.nombre||("Flota "+fleet.trim());
  const data=val.data||{};
  tpodSetUsuarioCampos(data,nombre);
  const chofer=tpodChoferDesdeBase(data,nombre);
  const tel=tpodTelefonoDesdeBase(data);
  save(LS.user,{fleet:fleet.trim(),driver:chofer,phones:tel,validado:true,cloudUserId:val.id,nombre:nombre});
  cloudUser={user:val.id,role:"flota",flota:fleet.trim(),activo:true,nombre:nombre,chofer:chofer,telefono:tel};
  if(LS.cloudUser)save(LS.cloudUser,cloudUser);
  tpodSetAuthorized(true,fleet.trim(),nombre);
  tpodStatus("Conectado",true);
  tpodDisableViews();
  let abierto=null;
  try{abierto=await tpodCargarTransitoAbiertoDeFlota(fleet.trim());}catch(e){console.log(e);tpodHardClearTransitForm();}
  if(!abierto)tpodHardClearTransitForm();
  if(msg)msg.innerHTML='<p class="ok">'+escapeHtml(tpodResumenTransito(abierto))+'</p>';
  renderInicio();
  setTimeout(()=>{show("inicio");renderInicio();},350);
}
function renderInicio(){
  if(typeof tpodEnsureInicioEmbarqueInput==="function")tpodEnsureInicioEmbarqueInput();
  const u=user(),inp=document.getElementById("inicioUser");
  if(inp)inp.value=(u.fleet||"Sin flota")+" - "+(u.driver||tpodNombreFlota()||"Sin nombre");
  const t=transit();
  if(tpodOpenState(t)){
    const l=document.getElementById("lote"),e=document.getElementById("embarqueInput");
    if(l)l.value=t.lote||"";if(e)e.value=t.embarque||"";
  }else{
    const l=document.getElementById("lote"),e=document.getElementById("embarqueInput");
    if(l)l.value="";if(e)e.value="";
  }
  renderTransitStatus();
  aplicarColorResumenInicio();
  bloquearFormularioTransito();
}
function renderUltimo(){
  const sec=document.getElementById("ultimo");
  if(!sec)return;
  const flota=tpodCurrentFlota();
  const t=transit();
  if(!tpodIsAuthorized||!tpodIsAuthorized()||!flota){
    sec.innerHTML='<div class="card"><b>Último</b><div class="emptyBox">Valide la flota en Usuario.</div></div>';
    return;
  }
  if(!t||!tpodFlotaParticipa(t,flota)){
    sec.innerHTML='<div class="card"><b>Último</b><div class="emptyBox">Sin información para la flota validada.</div></div>';
    return;
  }
  const cerrado=!tpodOpenState(t);
  const emb=escapeHtml(t.embarque||"-"),lote=escapeHtml(t.lote||"-");
  const cliente=escapeHtml((t.route&&t.route.cliente)||"-"),origen=escapeHtml((t.route&&t.route.origen)||"-"),destino=escapeHtml((t.route&&t.route.destino)||"-");
  const ubicacion=escapeHtml(tpodUltimaUbicacionTexto(t)),alerta=escapeHtml(tpodLastAlert(t));
  sec.innerHTML=`<div class="card"><b>Último tránsito</b><div class="embarqueItem ${cerrado?'closed':'open'}"><div class="embTop"><b>Emb. ${emb}</b><span>${cerrado?'Cerrado':'Abierto'}</span></div><div>Lote/Carga: ${lote}</div><div>Cliente: ${cliente}</div><div>Origen: ${origen}</div><div>Destino: ${destino}</div><div>Últ. posición: ${ubicacion}</div><div>Últ. alerta: ${alerta}</div></div></div>`;
}
try{
  const oldShow97=show;
  show=function(id){
    oldShow97(id);
    if(id==="ultimo")setTimeout(()=>renderUltimo(),80);
    if(id==="inicio")setTimeout(()=>renderInicio(),80);
    if(id==="embarque")setTimeout(()=>refreshEmbarquesCloud(),150);
  };
}catch(e){}




/* ===== v1.4.98 ULTIMO ORIGINAL + EMBARQUE RELACIONADO ===== */
function tpodClearUltimoView(){
  try{
    localStorage.removeItem("trackpod_last");
    localStorage.removeItem("trackpod_lastTransit");
    localStorage.removeItem("trackpod_ultimo");
  }catch(e){}
  ["ultimoList","ultimoContent","lastContent","lastTransit","ultimoBody"].forEach(id=>{
    const el=document.getElementById(id);
    if(el)el.innerHTML='<div class="emptyBox">Sin registros enviados para la flota validada.</div>';
  });
}
try{
  if(!window.__tpodOriginalRenderUltimo && typeof renderUltimo==="function"){
    window.__tpodOriginalRenderUltimo=renderUltimo;
  }
}catch(e){}
function tpodRefreshUltimoForFlota(){
  const flota=tpodCurrentFlota?tpodCurrentFlota():"";
  if(!tpodIsAuthorized||!tpodIsAuthorized()||!flota){
    tpodClearUltimoView();
    return;
  }
  try{
    if(typeof window.__tpodOriginalRenderUltimo==="function"){
      window.__tpodOriginalRenderUltimo();
      return;
    }
  }catch(e){}
  const sec=document.getElementById("ultimo");
  if(sec&&!sec.innerText.trim()){
    sec.innerHTML='<div class="card"><b>Último</b><div class="emptyBox">Sin registros enviados para la flota validada.</div></div>';
  }
}
function renderUltimo(){tpodRefreshUltimoForFlota();}
function tpodHardClearTransitForm(){
  try{localStorage.removeItem(LS.transit);}catch(e){}
  try{localStorage.removeItem("trackpod_transit");}catch(e){}
  ["lote","embarqueInput"].forEach(id=>{const el=document.getElementById(id);if(el){el.value="";el.disabled=false;el.removeAttribute("readonly");}});
  ["clienteSelect","origenSelect","destinoSelect"].forEach(id=>{const el=document.getElementById(id);if(el){el.disabled=false;el.removeAttribute("readonly");}});
  const filtro=document.getElementById("embarqueFiltro");if(filtro)filtro.innerText="-";
  const list=document.getElementById("embarqueList");if(list)list.innerHTML='<div class="emptyBox">Sin tránsito abierto.</div>';
  tpodClearUltimoView();
}
function tpodIsOpen98(t){
  if(!t)return false;
  const estado=String(t.estado||"").toLowerCase().trim();
  if(t.closed===true)return false;
  if(t.closed&&t.closed!==null&&String(t.closed).toLowerCase()!=="null")return false;
  if(estado==="cerrado"||estado==="closed"||estado==="finalizado")return false;
  return estado==="abierto"||t.closed===null||t.closed===undefined;
}
function tpodFleet98(t){return String((t&&t.user&&t.user.fleet)||t.flota||(t&&t.user&&t.user.flota)||"").trim();}
function tpodParticipa98(t,flota){
  const f=String(flota||"").trim();
  const parts=(t&&t.participantes||[]).map(x=>String(x).trim());
  return tpodFleet98(t)===f||parts.includes(f);
}
function tpodTime98(t){
  try{const v=(t&&t.start&&t.start.time)||t.start||t.createdAt||0;const d=(v&&v.toDate)?v.toDate():(v&&v.seconds?new Date(v.seconds*1000):new Date(v));return d&&!isNaN(d.getTime())?d.getTime():0;}catch(e){return 0;}
}
function tpodDedup98(items){
  const map=new Map();
  items.forEach(t=>{const k=String(t.embarque||"")+"|"+tpodFleet98(t);if(!map.has(k)||tpodTime98(t)>tpodTime98(map.get(k)))map.set(k,t);});
  return Array.from(map.values());
}
async function tpodLeerTransitos98(){
  if(!tpodInitFirebase())return[];
  const snap=await db.collection("transitos").get();
  const all=snap.docs.map(d=>{
    if(typeof tpodNorm96==="function")return tpodNorm96(d.id,d.data());
    if(typeof tpodNormTransit==="function")return tpodNormTransit(d.id,d.data());
    return {id:d.id,...d.data()};
  });
  cloudTransitosCache=all;
  return all;
}
async function refreshEmbarquesCloud(){
  tpodBuildEmbarqueScreen();
  const box=document.getElementById("embarqueList");
  const flota=tpodCurrentFlota?tpodCurrentFlota():"";
  if(!tpodIsAuthorized||!tpodIsAuthorized()||!flota){
    tpodSetFiltro("-");
    if(box)box.innerHTML='<div class="emptyBox">Valide la flota en Usuario.</div>';
    return;
  }
  if(box)box.innerHTML='<div class="emptyBox">Leyendo embarques abiertos...</div>';
  try{
    const all=await tpodLeerTransitos98();
    const abiertos=all.filter(tpodIsOpen98);
    const embarquesFlota=new Set();
    abiertos.forEach(t=>{if(tpodParticipa98(t,flota)&&t.embarque)embarquesFlota.add(String(t.embarque));});
    let items=[];
    if(embarquesFlota.size){
      items=abiertos.filter(t=>embarquesFlota.has(String(t.embarque||"")));
    }else{
      items=[];
    }
    items=tpodDedup98(items);
    items.sort((a,b)=>{
      const ea=String(a.embarque||""),eb=String(b.embarque||"");
      if(ea!==eb)return ea.localeCompare(eb);
      return tpodFleet98(a).localeCompare(tpodFleet98(b));
    });
    tpodRenderEmbarqueRelacionado98(items,embarquesFlota);
  }catch(e){
    console.log("refreshEmbarquesCloud v98",e);
    tpodStatus("Desconectado",false);
    if(box)box.innerHTML='<div class="emptyBox">Error leyendo embarques abiertos.</div>';
  }
}
function tpodRenderEmbarqueRelacionado98(items,embarquesFlota){
  tpodBuildEmbarqueScreen();
  const box=document.getElementById("embarqueList");
  if(!box)return;
  const embTitulo=Array.from(embarquesFlota||[])[0]||(items[0]&&items[0].embarque)||"-";
  tpodSetFiltro(embTitulo);
  if(!items.length){
    box.innerHTML='<div class="emptyBox">No hay tránsitos abiertos relacionados con el embarque de esta flota.</div>';
    return;
  }
  box.innerHTML=items.map(t=>{
    const flota=escapeHtml(tpodFleet98(t)||"-");
    const emb=escapeHtml(t.embarque||"-");
    const lote=escapeHtml(t.lote||"-");
    const cliente=escapeHtml((t.route&&t.route.cliente)||"-");
    const origen=escapeHtml((t.route&&t.route.origen)||"-");
    const destino=escapeHtml((t.route&&t.route.destino)||"-");
    const inicio=escapeHtml(tpodDate(t.start));
    const ubicacion=escapeHtml(tpodUltimaUbicacionTexto(t));
    const alerta=escapeHtml(tpodLastAlert(t));
    return `<div class="embarqueItem open" onclick="abrirTransitoCloud('${escapeHtml(t.id)}')"><div class="embTop"><b>Emb. ${emb} / Flota ${flota}</b><span>Abierto</span></div><div>Lote/Carga: ${lote}</div><div>Cliente: ${cliente}</div><div>Origen: ${origen}</div><div>Destino: ${destino}</div><div>Inicio: ${inicio}</div><div>Últ. posición: ${ubicacion}</div><div>Últ. alerta: ${alerta}</div></div>`;
  }).join("");
}
function renderEmbarque(){refreshEmbarquesCloud();}
try{
  const oldShow98=show;
  show=function(id){
    oldShow98(id);
    if(id==="embarque")setTimeout(()=>refreshEmbarquesCloud(),150);
    if(id==="ultimo")setTimeout(()=>tpodRefreshUltimoForFlota(),100);
    if(id==="inicio")setTimeout(()=>renderInicio(),80);
  };
}catch(e){}




/* ===== v1.5.00 VALIDACION EMBARQUE + ULTIMO ORIGINAL ===== */

/*
Nueva colección Firestore requerida:

colección: embarques
documento: número de embarque. Ej: 2001
campos:
  embarque: "2001"          opcional si el ID ya es el número
  cliente: "Stellantis ARG"
  origen: "CLZ - Centro Logistico Zarate"
  destino: "STLI - Chile"
  activo: true              opcional

También acepta:
  cliente_nombre / cliente
  origen_nombre / origen
  destino_nombre / destino
*/

function tpodClearUsuarioCampos(){
  ["userDriver","userPhones","userPass"].forEach(id=>{
    const el=document.getElementById(id);
    if(el) el.value="";
  });
}

function tpodClearUltimoView(){
  const box=document.getElementById("lastBox");
  if(box) box.innerText="No hay envíos registrados.";
}

function renderUltimo(){
  const last=load(LS.last,null);
  const box=document.getElementById("lastBox");
  if(!box) return;
  box.innerText=last ? (last.msg||"No hay envíos registrados.") : "No hay envíos registrados.";
}

function tpodHardClearTransitForm(){
  try{ localStorage.removeItem(LS.transit); }catch(e){}
  try{ localStorage.removeItem("trackpod_transit"); }catch(e){}

  ["lote","embarqueInput"].forEach(id=>{
    const el=document.getElementById(id);
    if(el){
      el.value="";
      el.disabled=false;
      el.removeAttribute("readonly");
    }
  });

  ["clienteSelect","origenSelect","destinoSelect"].forEach(id=>{
    const el=document.getElementById(id);
    if(el){
      el.disabled=false;
      el.removeAttribute("readonly");
    }
  });

  const filtro=document.getElementById("embarqueFiltro");
  if(filtro) filtro.innerText="-";

  const list=document.getElementById("embarqueList");
  if(list) list.innerHTML='<div class="emptyBox">Sin tránsito abierto.</div>';

  tpodClearUltimoView();
}

function tpodTextNorm(v){
  return String(v||"").trim().toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g,"")
    .replace(/\s+/g," ");
}

function tpodGetSelectedText(id){
  const el=document.getElementById(id);
  if(!el) return "";
  if(el.options && el.selectedIndex>=0) return el.options[el.selectedIndex].text || "";
  return el.value || "";
}

function tpodSetSelectByText(id, expected){
  const el=document.getElementById(id);
  if(!el || !el.options || !expected) return false;
  const exp=tpodTextNorm(expected);
  for(let i=0;i<el.options.length;i++){
    const txt=tpodTextNorm(el.options[i].text);
    if(txt===exp || txt.includes(exp) || exp.includes(txt)){
      el.value=el.options[i].value;
      try{ el.dispatchEvent(new Event("change")); }catch(e){}
      return true;
    }
  }
  return false;
}

async function tpodBuscarEmbarqueBase(numero){
  const emb=String(numero||"").trim();
  if(!emb) return {ok:false,msg:"Debe ingresar número de embarque."};
  if(!tpodInitFirebase()) return {ok:false,msg:"Sin conexión a Firebase."};

  const ids=[emb, "emb"+emb, "embarque"+emb];
  for(const id of ids){
    const d=await db.collection("embarques").doc(id).get();
    if(d.exists) return {ok:true,id:id,data:d.data()||{}};
  }

  const snap=await db.collection("embarques").where("embarque","==",emb).limit(1).get();
  if(!snap.empty) return {ok:true,id:snap.docs[0].id,data:snap.docs[0].data()||{}};

  return {ok:false,msg:"El embarque no existe en la base."};
}

async function tpodValidarEmbarqueInicio(){
  const embEl=document.getElementById("embarqueInput");
  const emb=embEl ? embEl.value.trim() : "";
  if(!emb) return {ok:false,msg:"Debe ingresar número de embarque."};

  const r=await tpodBuscarEmbarqueBase(emb);
  if(!r.ok) return r;

  const x=r.data||{};
  if(x.activo===false) return {ok:false,msg:"El embarque está inactivo."};

  const clienteBase=x.cliente||x.cliente_nombre||x.customer||"";
  const origenBase=x.origen||x.origen_nombre||x.origin||"";
  const destinoBase=x.destino||x.destino_nombre||x.destination||"";

  const clienteSel=tpodGetSelectedText("clienteSelect");
  const origenSel=tpodGetSelectedText("origenSelect");
  const destinoSel=tpodGetSelectedText("destinoSelect");

  const errores=[];

  if(clienteBase && tpodTextNorm(clienteBase)!==tpodTextNorm(clienteSel)){
    const fixed=tpodSetSelectByText("clienteSelect",clienteBase);
    if(!fixed) errores.push("Cliente no coincide. Base: "+clienteBase);
  }
  if(origenBase && tpodTextNorm(origenBase)!==tpodTextNorm(origenSel)){
    const fixed=tpodSetSelectByText("origenSelect",origenBase);
    if(!fixed) errores.push("Origen no coincide. Base: "+origenBase);
  }
  if(destinoBase && tpodTextNorm(destinoBase)!==tpodTextNorm(destinoSel)){
    const fixed=tpodSetSelectByText("destinoSelect",destinoBase);
    if(!fixed) errores.push("Destino no coincide. Base: "+destinoBase);
  }

  if(errores.length) return {ok:false,msg:errores.join("\n"),data:x};

  return {ok:true,msg:"Embarque validado.",data:x};
}

// En Inicio/Fin: validar embarque antes de iniciar tránsito.
try{
  if(!window.__tpodOriginalStartTransit1500 && typeof startTransit==="function"){
    window.__tpodOriginalStartTransit1500=startTransit;
    startTransit=async function(){
      const v=await tpodValidarEmbarqueInicio();
      if(!v.ok){
        window.alert(v.msg);
        return;
      }
      return window.__tpodOriginalStartTransit1500();
    };
  }
}catch(e){
  console.log("patch startTransit embarque",e);
}

// Compatibilidad por si el botón llama iniciarTransito().
try{
  if(typeof iniciarTransito==="function" && !window.__tpodOriginalIniciarTransito1500){
    window.__tpodOriginalIniciarTransito1500=iniciarTransito;
    iniciarTransito=async function(){
      const v=await tpodValidarEmbarqueInicio();
      if(!v.ok){
        window.alert(v.msg);
        return;
      }
      return window.__tpodOriginalIniciarTransito1500();
    };
  }
}catch(e){}

async function saveUser(){
  const fleetEl=document.getElementById("userFleet");
  const passEl=document.getElementById("userPass");
  const fleet=fleetEl ? fleetEl.value.trim() : "";
  const pass=passEl ? passEl.value.trim() : "";
  const msg=document.getElementById("userMsg");

  if(msg) msg.innerHTML='<p>Validando flota...</p>';

  tpodSetAuthorized(false);
  tpodDisableViews();
  tpodHardClearTransitForm();
  tpodClearUsuarioCampos();

  const val=await validarFlotaEnBase(fleet,pass);

  if(!val.ok){
    if(msg) msg.innerHTML='<p class="err">'+escapeHtml(val.msg)+'</p>';
    tpodStatus("Desconectado",false);
    // Limpieza pedida: chofer, teléfono y PASS si hay error de pass o flota.
    tpodClearUsuarioCampos();
    tpodHardClearTransitForm();
    show("usuario");
    return;
  }

  const nombre=val.nombre||("Flota "+fleet);
  const data=val.data||{};

  tpodSetUsuarioCampos(data,nombre);

  const chofer=tpodChoferDesdeBase(data,nombre);
  const tel=tpodTelefonoDesdeBase(data);

  save(LS.user,{
    fleet:fleet,
    driver:chofer,
    phones:tel,
    validado:true,
    cloudUserId:val.id,
    nombre:nombre
  });

  cloudUser={
    user:val.id,
    role:"flota",
    flota:fleet,
    activo:true,
    nombre:nombre,
    chofer:chofer,
    telefono:tel
  };
  if(LS.cloudUser) save(LS.cloudUser,cloudUser);

  tpodSetAuthorized(true,fleet,nombre);
  tpodStatus("Conectado",true);
  tpodDisableViews();

  let abierto=null;
  try{
    abierto=await tpodCargarTransitoAbiertoDeFlota(fleet);
  }catch(e){
    console.log("Error cargando tránsito abierto",e);
    tpodHardClearTransitForm();
  }

  if(!abierto){
    tpodHardClearTransitForm();
  }

  if(msg) msg.innerHTML='<p class="ok">'+escapeHtml(tpodResumenTransito(abierto))+'</p>';

  renderInicio();

  setTimeout(()=>{
    show("inicio");
    renderInicio();
  },350);
}

try{
  const oldShow1500=show;
  show=function(id){
    oldShow1500(id);
    if(id==="ultimo") setTimeout(()=>renderUltimo(),80);
    if(id==="inicio") setTimeout(()=>renderInicio(),80);
    if(id==="embarque") setTimeout(()=>refreshEmbarquesCloud(),150);
  };
}catch(e){}




/* ===== v1.5.01 COLECCION EMBARQUE + LIMPIEZA + COMPARTIDOS ===== */

/*
Firestore:
colección: embarque
documento: número de embarque. Ej: 1001
campos:
  activo: true
  cliente: "Stellantis ARG"
  origen: "CLZ - Centro Logistico Zarate"
  destino: "STLI - Chile"
*/

function tpodClearUsuarioCampos(){
  ["userDriver","userPhones","userPass"].forEach(id=>{
    const el=document.getElementById(id);
    if(el) el.value="";
  });
}

function tpodClearUltimoView(){
  const box=document.getElementById("lastBox");
  if(box) box.innerText="No hay envíos registrados.";
  ["ultimoList","ultimoContent","lastContent","lastTransit","ultimoBody"].forEach(id=>{
    const el=document.getElementById(id);
    if(el) el.innerHTML='<div class="emptyBox">Sin registros enviados para la flota validada.</div>';
  });
}

function tpodHardClearTransitForm(){
  try{ localStorage.removeItem(LS.transit); }catch(e){}
  try{ localStorage.removeItem("trackpod_transit"); }catch(e){}

  ["lote","embarqueInput"].forEach(id=>{
    const el=document.getElementById(id);
    if(el){
      el.value="";
      el.disabled=false;
      el.removeAttribute("readonly");
    }
  });

  ["clienteSelect","origenSelect","destinoSelect"].forEach(id=>{
    const el=document.getElementById(id);
    if(el){
      el.disabled=false;
      el.removeAttribute("readonly");
    }
  });

  const filtro=document.getElementById("embarqueFiltro");
  if(filtro) filtro.innerText="-";

  const list=document.getElementById("embarqueList");
  if(list) list.innerHTML='<div class="emptyBox">Sin tránsito abierto.</div>';

  tpodClearUltimoView();
}

async function tpodBuscarEmbarqueBase(numero){
  const emb=String(numero||"").trim();
  if(!emb) return {ok:false,msg:"Debe ingresar número de embarque."};
  if(!tpodInitFirebase()) return {ok:false,msg:"Sin conexión a Firebase."};

  const ids=[emb, "emb"+emb, "embarque"+emb];

  // Colección real creada en Firebase: embarque
  for(const id of ids){
    const d=await db.collection("embarque").doc(id).get();
    if(d.exists) return {ok:true,id:id,data:d.data()||{}};
  }

  const snap=await db.collection("embarque").where("embarque","==",emb).limit(1).get();
  if(!snap.empty) return {ok:true,id:snap.docs[0].id,data:snap.docs[0].data()||{}};

  return {ok:false,msg:"El embarque no existe en la base."};
}

async function saveUser(){
  const fleetEl=document.getElementById("userFleet");
  const passEl=document.getElementById("userPass");
  const fleet=fleetEl ? fleetEl.value.trim() : "";
  const pass=passEl ? passEl.value.trim() : "";
  const msg=document.getElementById("userMsg");

  if(msg) msg.innerHTML='<p>Validando flota...</p>';

  tpodSetAuthorized(false);
  tpodDisableViews();
  tpodHardClearTransitForm();
  tpodClearUsuarioCampos();

  const val=await validarFlotaEnBase(fleet,pass);

  if(!val.ok){
    if(msg) msg.innerHTML='<p class="err">'+escapeHtml(val.msg)+'</p>';
    tpodStatus("Desconectado",false);

    // Limpieza explícita pedida cuando falla flota/pass.
    tpodClearUsuarioCampos();
    tpodHardClearTransitForm();
    tpodClearUltimoView();

    show("usuario");
    return;
  }

  const nombre=val.nombre||("Flota "+fleet);
  const data=val.data||{};

  tpodSetUsuarioCampos(data,nombre);

  const chofer=tpodChoferDesdeBase(data,nombre);
  const tel=tpodTelefonoDesdeBase(data);

  save(LS.user,{
    fleet:fleet,
    driver:chofer,
    phones:tel,
    validado:true,
    cloudUserId:val.id,
    nombre:nombre
  });

  cloudUser={
    user:val.id,
    role:"flota",
    flota:fleet,
    activo:true,
    nombre:nombre,
    chofer:chofer,
    telefono:tel
  };
  if(LS.cloudUser) save(LS.cloudUser,cloudUser);

  tpodSetAuthorized(true,fleet,nombre);
  tpodStatus("Conectado",true);
  tpodDisableViews();

  let abierto=null;
  try{
    abierto=await tpodCargarTransitoAbiertoDeFlota(fleet);
  }catch(e){
    console.log("Error cargando tránsito abierto",e);
    tpodHardClearTransitForm();
  }

  if(!abierto){
    tpodHardClearTransitForm();
  }else{
    // Al cambiar flota, Último debe quedar sólo con datos de la flota validada.
    renderUltimo();
  }

  if(msg) msg.innerHTML='<p class="ok">'+escapeHtml(tpodResumenTransito(abierto))+'</p>';

  renderInicio();

  setTimeout(()=>{
    show("inicio");
    renderInicio();
  },350);
}

// Último vuelve a la lógica original, pero actualiza/limpia por flota validada.
function renderUltimo(){
  const flota=tpodCurrentFlota ? tpodCurrentFlota() : "";
  const box=document.getElementById("lastBox");
  if(!box) return;

  if(!tpodIsAuthorized || !tpodIsAuthorized() || !flota){
    box.innerText="No hay envíos registrados.";
    return;
  }

  const t=transit();
  if(!t || !tpodFlotaParticipa(t,flota)){
    box.innerText="No hay envíos registrados.";
    return;
  }

  const last=load(LS.last,null);
  if(last && last.msg){
    box.innerText=last.msg;
    return;
  }

  // Fallback: si no hay LS.last, armar texto con el tránsito de la flota validada.
  const emb=t.embarque||"-";
  const lote=t.lote||"-";
  const pos=tpodUltimaUbicacionTexto(t);
  const alerta=tpodLastAlert(t);
  box.innerText=`Emb. ${emb} / Lote ${lote} / Últ. posición: ${pos} / Últ. alerta: ${alerta}`;
}

function tpodIsOpen1501(t){
  if(!t) return false;
  const estado=String(t.estado||"").toLowerCase().trim();
  if(t.closed===true) return false;
  if(t.closed && t.closed!==null && String(t.closed).toLowerCase()!=="null") return false;
  if(estado==="cerrado" || estado==="closed" || estado==="finalizado") return false;
  return estado==="abierto" || t.closed===null || t.closed===undefined;
}

function tpodFleet1501(t){
  return String((t&&t.user&&t.user.fleet)||t.flota||(t&&t.user&&t.user.flota)||"").trim();
}

function tpodParticipa1501(t,flota){
  const f=String(flota||"").trim();
  const parts=(t&&t.participantes||[]).map(x=>String(x).trim());
  return tpodFleet1501(t)===f || parts.includes(f);
}

function tpodTime1501(t){
  try{
    const v=(t&&t.start&&t.start.time)||t.start||t.createdAt||0;
    const d=(v&&v.toDate)?v.toDate():(v&&v.seconds?new Date(v.seconds*1000):new Date(v));
    return d && !isNaN(d.getTime()) ? d.getTime() : 0;
  }catch(e){ return 0; }
}

async function tpodLeerTransitos1501(){
  if(!tpodInitFirebase()) return [];
  const snap=await db.collection("transitos").get();
  const all=snap.docs.map(d=>{
    if(typeof tpodNorm96==="function") return tpodNorm96(d.id,d.data());
    if(typeof tpodNormTransit==="function") return tpodNormTransit(d.id,d.data());
    return {id:d.id,...d.data()};
  });
  cloudTransitosCache=all;
  return all;
}

function tpodDedup1501(items){
  const map=new Map();
  items.forEach(t=>{
    const key=String(t.embarque||"")+"|"+tpodFleet1501(t);
    if(!map.has(key) || tpodTime1501(t)>tpodTime1501(map.get(key))) map.set(key,t);
  });
  return Array.from(map.values());
}

async function refreshEmbarquesCloud(){
  tpodBuildEmbarqueScreen();
  const box=document.getElementById("embarqueList");
  const flota=tpodCurrentFlota ? tpodCurrentFlota() : "";

  if(!tpodIsAuthorized || !tpodIsAuthorized() || !flota){
    tpodSetFiltro("-");
    if(box) box.innerHTML='<div class="emptyBox">Valide la flota en Usuario.</div>';
    return;
  }

  if(box) box.innerHTML='<div class="emptyBox">Leyendo embarques...</div>';

  try{
    const all=await tpodLeerTransitos1501();

    // Nuevo criterio:
    // 1) Si la flota validada participa en un embarque que tiene al menos un abierto,
    //    ese embarque se muestra completo.
    // 2) Se muestran abiertos y cerrados de ese mismo embarque.
    // 3) Se dejan de mostrar sólo cuando TODAS las flotas de ese embarque están cerradas.
    const embarquesDeFlota=new Set();

    all.forEach(t=>{
      if(tpodParticipa1501(t,flota) && t.embarque){
        embarquesDeFlota.add(String(t.embarque));
      }
    });

    const embarquesConAlgunAbierto=new Set();
    all.forEach(t=>{
      if(t.embarque && tpodIsOpen1501(t)){
        embarquesConAlgunAbierto.add(String(t.embarque));
      }
    });

    const embarquesVisibles=new Set(
      Array.from(embarquesDeFlota).filter(e=>embarquesConAlgunAbierto.has(e))
    );

    let items=all.filter(t=>embarquesVisibles.has(String(t.embarque||"")));

    items=tpodDedup1501(items);

    items.sort((a,b)=>{
      const ea=String(a.embarque||"");
      const eb=String(b.embarque||"");
      if(ea!==eb) return ea.localeCompare(eb);
      const oa=tpodIsOpen1501(a)?0:1;
      const ob=tpodIsOpen1501(b)?0:1;
      if(oa!==ob) return oa-ob;
      return tpodFleet1501(a).localeCompare(tpodFleet1501(b));
    });

    tpodRenderEmbarques1501(items, embarquesVisibles);
  }catch(e){
    console.log("refreshEmbarquesCloud v1501",e);
    tpodStatus("Desconectado",false);
    if(box) box.innerHTML='<div class="emptyBox">Error leyendo embarques.</div>';
  }
}

function tpodRenderEmbarques1501(items, embarquesVisibles){
  tpodBuildEmbarqueScreen();
  const box=document.getElementById("embarqueList");
  if(!box) return;

  const embTitulo=Array.from(embarquesVisibles||[])[0] || (items[0]&&items[0].embarque) || "-";
  tpodSetFiltro(embTitulo);

  if(!items.length){
    box.innerHTML='<div class="emptyBox">No hay embarques compartidos activos para esta flota.</div>';
    return;
  }

  box.innerHTML=items.map(t=>{
    const abierto=tpodIsOpen1501(t);
    const flota=escapeHtml(tpodFleet1501(t)||"-");
    const emb=escapeHtml(t.embarque||"-");
    const lote=escapeHtml(t.lote||"-");
    const cliente=escapeHtml((t.route&&t.route.cliente)||"-");
    const origen=escapeHtml((t.route&&t.route.origen)||"-");
    const destino=escapeHtml((t.route&&t.route.destino)||"-");
    const inicio=escapeHtml(tpodDate(t.start));
    const cierre=abierto ? "-" : escapeHtml(tpodDate(t.closed));
    const ubicacion=escapeHtml(tpodUltimaUbicacionTexto(t));
    const alerta=escapeHtml(tpodLastAlert(t));

    return `<div class="embarqueItem ${abierto?'open':'closed'}" onclick="abrirTransitoCloud('${escapeHtml(t.id)}')">
      <div class="embTop"><b>Emb. ${emb} / Flota ${flota}</b><span>${abierto?'Abierto':'Cerrado'}</span></div>
      <div>Lote/Carga: ${lote}</div>
      <div>Cliente: ${cliente}</div>
      <div>Origen: ${origen}</div>
      <div>Destino: ${destino}</div>
      <div>Inicio: ${inicio}</div>
      <div>Cierre: ${cierre}</div>
      <div>Últ. posición: ${ubicacion}</div>
      <div>Últ. alerta: ${alerta}</div>
    </div>`;
  }).join("");
}

function renderEmbarque(){
  refreshEmbarquesCloud();
}

try{
  const oldShow1501=show;
  show=function(id){
    oldShow1501(id);
    if(id==="embarque") setTimeout(()=>refreshEmbarquesCloud(),150);
    if(id==="ultimo") setTimeout(()=>renderUltimo(),80);
    if(id==="inicio") setTimeout(()=>renderInicio(),80);
  };
}catch(e){}

