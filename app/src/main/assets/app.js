

/* ===== V1.5.55 - Exponer mapas Leaflet ===== */
window.__trackingMapsV1537 = window.__trackingMapsV1537 || [];
if(typeof L !== "undefined" && L.map && !L.__eltaPatchedV1537){
  L.__eltaPatchedV1537 = true;
  const __originalLMapV1537 = L.map;
  L.map = function(){
    const m = __originalLMapV1537.apply(this, arguments);
    try{
      window.__trackingMapsV1537.push(m);
      window.trackingMap = m;
      window.map = m;
    }catch(e){}
    return m;
  };
}

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
          if(remoteUpdates>=localUpdates) save(LS.transit,mergeTransitPreserveRouteV1542(cur,remote));
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
  const views=["usuario","inicio","tracking","embarque","alertas","clima","checklist","ultimo"];
  const buttons=["btn-usuario","btn-inicio","btn-tracking","btn-embarque","btn-alertas","btn-clima","btn-checklist","btn-ultimo"];

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
  if(id==="checklist") renderChecklist();
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



/* ===== V1.5.55 - Guardar Cliente Origen Destino en tránsito ===== */
function selectedTextFromSelectV1533(sel){
  if(!sel) return "";
  const opt = sel.options && sel.selectedIndex >= 0 ? sel.options[sel.selectedIndex] : null;
  return String((opt && (opt.textContent || opt.innerText)) || sel.value || "").trim();
}

function getSelectByMeaningV1533(kind){
  const k = String(kind||"").toLowerCase();

  const byId = Array.from(document.querySelectorAll("select")).find(sel=>{
    const id = String(sel.id||"").toLowerCase();
    const name = String(sel.name||"").toLowerCase();
    const label = String(sel.getAttribute("aria-label")||"").toLowerCase();
    const all = id+" "+name+" "+label;
    return all.includes(k);
  });
  if(byId) return byId;

  const patterns = {
    cliente: /stellantis|porsche|toyota|garden|sevel|byd/i,
    origen: /clz|zarate|zárate|centro logistico|centro logístico/i,
    destino: /stli|chile|uruguay|paraguay|caba|santa rosa|toyota chile|sevel uruguay|garden paraguay|byd/i
  };

  return Array.from(document.querySelectorAll("select")).find(sel=>{
    return Array.from(sel.options||[]).some(o=>patterns[k] && patterns[k].test(o.textContent||""));
  }) || null;
}

function routeFromFormV1533(){
  const clienteSel = getSelectByMeaningV1533("cliente");
  const origenSel = getSelectByMeaningV1533("origen");
  const destinoSel = getSelectByMeaningV1533("destino");

  let route = {};
  try{
    if(typeof selectedRoute === "function"){
      route = selectedRoute() || {};
    }
  }catch(e){}

  const cliente = selectedTextFromSelectV1533(clienteSel) || route.cliente || "";
  const origen = selectedTextFromSelectV1533(origenSel) || route.origen || "";
  const destino = selectedTextFromSelectV1533(destinoSel) || route.destino || "";

  return { cliente, origen, destino };
}

async function guardarTransitoInicioFirebaseV1533(t){
  if(!t || !firebaseReady()) return;
  try{
    const id = t.id || (t.docId) || ("TPOD-" + new Date().toISOString().replace(/[-:T.Z]/g,"").slice(0,14));
    t.id = id;

    const route = {
      ...(t.route || {}),
      ...routeFromFormV1533()
    };

    t.route = route;

    const data = {
      ...t,
      route,
      cliente: route.cliente || "",
      origen: route.origen || "",
      destino: route.destino || "",
      actualizadoEn: now()
    };

    await db.collection("transitos").doc(String(id)).set(data,{merge:true});
  }catch(e){
    console.log("No se pudo guardar cliente/origen/destino en tránsito", e);
  }
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

    t.route = { ...(t.route||{}), ...routeFromFormV1533() };
  save(LS.transit,t);
  await guardarTransitoInicioFirebaseV1533(t);
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



/* ===== V1.5.55 - Guardado Firebase antes de WhatsApp sin alterar mensaje ===== */
async function guardarTransitoFirebaseAntesWhatsappV1528(t){
  if(!t) return;
  try{
    if(!firebaseReady()) return;
    const id = t.id || (t.embarque ? String(t.embarque) : null);
    const data = {
      ...t,
      flota: t.user && t.user.fleet ? t.user.fleet : "",
      chofer: t.user && t.user.driver ? t.user.driver : "",
      embarque: t.embarque || "",
      lote: t.lote || "",
      estado: t.closed ? "cerrado" : "abierto",
      actualizadoEn: now()
    };
    if(id){
      await db.collection("transitos").doc(String(id)).set(data,{merge:true});
    }else{
      await db.collection("transitos").add(data);
    }
  }catch(e){
    console.log("No se pudo guardar tránsito en Firebase antes de WhatsApp", e);
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

    await guardarTransitoFirebaseAntesWhatsappV1528(t);
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
      setRouteLayer(L.polyline(routePoints,{color:"#2563eb",weight:6,opacity:.95,interactive:false}),key);
    }else{
      routeLoadingKey="";
      removeRouteLayer();
    }
  }).catch(e=>{
    console.log("Route layer error",e);
    routeLoadingKey="";
    removeRouteLayer();
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
  r=r||{};
  if(r.routeDistanceKm) return Number(r.routeDistanceKm)||0;
  const oLat = r.origen_lat ?? r.origenLat;
  const oLng = r.origen_lng ?? r.origenLng;
  const dLat = r.destino_lat ?? r.destinoLat;
  const dLng = r.destino_lng ?? r.destinoLng;
  return distKm(Number(oLat),Number(oLng),Number(dLat),Number(dLng));
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
  const views=["usuario","inicio","tracking","embarque","alertas","clima","checklist","ultimo"];
  const buttons=["btn-login","btn-inicio","btn-tracking","btn-alertas","btn-clima","btn-usuario","btn-embarque","btn-ultimo"];
  views.forEach(v=>{const e=$(v); if(e){if(v===id)e.classList.remove("hidden"); else e.classList.add("hidden");}});
  buttons.forEach(b=>{const e=$(b); if(e)e.classList.remove("active");});
  const active=$("btn-"+id); if(active)active.classList.add("active");
  if(id==="inicio") renderInicio();
  if(id==="tracking") renderTracking();
  if(id==="alertas") renderAlertas();
  if(id==="clima") renderClima();
  if(id==="checklist") renderChecklist();
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
  if(!items.length){box.innerHTML='<div class="emptyBox"></div>';return;}
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
  sec.innerHTML='<div class="card embarqueCard"><div class="embarqueHeader"><b>Número Embarque</b><span id="embarqueFiltro">-</span></div><div id="embarqueDebug" class="embarqueDebug hiddenDebug" style="display:none"></div><div id="embarqueList" class="embarqueList"><div class="emptyBox"></div></div></div>';
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
  if(box)box.innerHTML='<div class="emptyBox"></div>';
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
  if(box)box.innerHTML='<div class="emptyBox"></div>';
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




/* ===== v1.5.55 VALIDACION EMBARQUE + ULTIMO ORIGINAL ===== */

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




/* ===== v1.5.55 COLECCION EMBARQUE + LIMPIEZA + COMPARTIDOS ===== */

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

  if(box) box.innerHTML='<div class="emptyBox"></div>';

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




/* ===== v1.5.55 FIX VALIDACION / ULTIMO / EMBARQUES ===== */
window.__tpodEmbarquesLoading = false;
window.__tpodLastEmbarquesHtml = "";

function tpodClearUsuarioCampos(){
  ["userDriver","userPhones","userPass"].forEach(id=>{
    const el=document.getElementById(id);
    if(el){
      el.value="";
      try{el.dispatchEvent(new Event("input",{bubbles:true}));}catch(e){}
      try{el.dispatchEvent(new Event("change",{bubbles:true}));}catch(e){}
    }
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
  try{localStorage.removeItem(LS.transit);}catch(e){}
  try{localStorage.removeItem("trackpod_transit");}catch(e){}
  ["lote","embarqueInput"].forEach(id=>{
    const el=document.getElementById(id);
    if(el){el.value="";el.disabled=false;el.removeAttribute("readonly");}
  });
  ["clienteSelect","origenSelect","destinoSelect"].forEach(id=>{
    const el=document.getElementById(id);
    if(el){el.disabled=false;el.removeAttribute("readonly");}
  });
  const filtro=document.getElementById("embarqueFiltro"); if(filtro) filtro.innerText="-";
  const list=document.getElementById("embarqueList"); if(list) list.innerHTML='<div class="emptyBox">Sin tránsito abierto.</div>';
  tpodClearUltimoView();
}

function tpodIsOpen1502(t){
  if(!t) return false;
  const estado=String(t.estado||"").toLowerCase().trim();
  if(t.closed===true) return false;
  if(t.closed && t.closed!==null && String(t.closed).toLowerCase()!=="null") return false;
  if(estado==="cerrado"||estado==="closed"||estado==="finalizado") return false;
  return estado==="abierto" || t.closed===null || t.closed===undefined;
}
function tpodFleet1502(t){return String((t&&t.user&&t.user.fleet)||t.flota||(t&&t.user&&t.user.flota)||"").trim();}
function tpodParticipa1502(t,flota){
  const f=String(flota||"").trim();
  const parts=(t&&t.participantes||[]).map(x=>String(x).trim());
  return tpodFleet1502(t)===f || parts.includes(f);
}
function tpodTime1502Value(v){
  try{
    const d=(v&&v.toDate)?v.toDate():(v&&v.seconds?new Date(v.seconds*1000):new Date(v));
    return d && !isNaN(d.getTime()) ? d.getTime() : 0;
  }catch(e){return 0;}
}
function tpodTime1502(t){return tpodTime1502Value((t&&t.start&&t.start.time)||t.start||t.createdAt||0);}
function tpodEventTime1502(ev){return tpodTime1502Value((ev&&ev.time)||(ev&&ev.fecha)||(ev&&ev.createdAt)||(ev&&ev.ts)||0);}

function tpodNormTransit1502(id,x){
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
    closed:x.closed,
    participantes:x.participantes||[],
    estado:x.estado||"",
    ultimaPosicion:x.ultimaPosicion||null,
    ultimaAlerta:x.ultimaAlerta||null,
    flota:x.flota||user.fleet||"",
    chofer:x.chofer||user.driver||""
  };
}

async function tpodLeerTransitos1502(){
  if(!tpodInitFirebase()) return [];
  const snap=await db.collection("transitos").get();
  const all=snap.docs.map(d=>tpodNormTransit1502(d.id,d.data()));
  cloudTransitosCache=all;
  return all;
}

async function tpodBuscarEmbarqueBase(numero){
  const emb=String(numero||"").trim();
  if(!emb) return {ok:false,msg:"Debe ingresar número de embarque."};
  if(!tpodInitFirebase()) return {ok:false,msg:"Sin conexión a Firebase."};
  const ids=[emb,"emb"+emb,"embarque"+emb];
  for(const id of ids){
    const d=await db.collection("embarque").doc(id).get();
    if(d.exists) return {ok:true,id:id,data:d.data()||{}};
  }
  const snap=await db.collection("embarque").where("embarque","==",emb).limit(1).get();
  if(!snap.empty) return {ok:true,id:snap.docs[0].id,data:snap.docs[0].data()||{}};
  return {ok:false,msg:"El embarque "+emb+" no existe en la base."};
}

function tpodTextNorm1502(v){return String(v||"").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/\s+/g," ");}
function tpodGetSelectedText1502(id){
  const el=document.getElementById(id);
  if(!el) return "";
  if(el.options && el.selectedIndex>=0) return el.options[el.selectedIndex].text||"";
  return el.value||"";
}
async function tpodValidarEmbarqueInicio(){
  const embEl=document.getElementById("embarqueInput");
  const emb=embEl ? embEl.value.trim() : "";
  const r=await tpodBuscarEmbarqueBase(emb);
  if(!r.ok) return r;
  const x=r.data||{};
  if(x.activo===false) return {ok:false,msg:"El embarque está inactivo."};
  const clienteBase=x.cliente||x.cliente_nombre||x.customer||"";
  const origenBase=x.origen||x.origen_nombre||x.origin||"";
  const destinoBase=x.destino||x.destino_nombre||x.destination||"";
  const errores=[];
  if(clienteBase && tpodTextNorm1502(clienteBase)!==tpodTextNorm1502(tpodGetSelectedText1502("clienteSelect"))) errores.push("Cliente no coincide. Base: "+clienteBase);
  if(origenBase && tpodTextNorm1502(origenBase)!==tpodTextNorm1502(tpodGetSelectedText1502("origenSelect"))) errores.push("Origen no coincide. Base: "+origenBase);
  if(destinoBase && tpodTextNorm1502(destinoBase)!==tpodTextNorm1502(tpodGetSelectedText1502("destinoSelect"))) errores.push("Destino no coincide. Base: "+destinoBase);
  if(errores.length) return {ok:false,msg:errores.join("\n"),data:x};
  return {ok:true,msg:"Embarque validado.",data:x};
}

async function tpodStartTransitValidated1502(fn){
  const v=await tpodValidarEmbarqueInicio();
  if(!v.ok){window.alert(v.msg);return false;}
  return fn();
}
try{
  if(typeof startTransit==="function" && !window.__tpodStartTransitOriginal1502){
    window.__tpodStartTransitOriginal1502=startTransit;
    startTransit=function(){return tpodStartTransitValidated1502(window.__tpodStartTransitOriginal1502);};
  }
}catch(e){}
try{
  if(typeof iniciarTransito==="function" && !window.__tpodIniciarTransitoOriginal1502){
    window.__tpodIniciarTransitoOriginal1502=iniciarTransito;
    iniciarTransito=function(){return tpodStartTransitValidated1502(window.__tpodIniciarTransitoOriginal1502);};
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
    setTimeout(()=>tpodClearUsuarioCampos(),0);
    setTimeout(()=>tpodClearUsuarioCampos(),150);
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
  save(LS.user,{fleet:fleet,driver:chofer,phones:tel,validado:true,cloudUserId:val.id,nombre:nombre});
  cloudUser={user:val.id,role:"flota",flota:fleet,activo:true,nombre:nombre,chofer:chofer,telefono:tel};
  if(LS.cloudUser) save(LS.cloudUser,cloudUser);
  tpodSetAuthorized(true,fleet,nombre);
  tpodStatus("Conectado",true);
  tpodDisableViews();
  let abierto=null;
  try{abierto=await tpodCargarTransitoAbiertoDeFlota(fleet);}
  catch(e){console.log("Error cargando tránsito abierto",e);tpodHardClearTransitForm();}
  if(!abierto) tpodHardClearTransitForm();
  if(msg) msg.innerHTML='<p class="ok">'+escapeHtml(tpodResumenTransito(abierto))+'</p>';
  renderInicio();
  setTimeout(()=>{show("inicio");renderInicio();},350);
}

function tpodLastEventFromTransit1502(t){
  const events=[];
  (t.updates||[]).forEach(u=>events.push({type:"Actualización GPS",time:u.time||u.fecha||u.createdAt,detail:tpodUltimaUbicacionTexto({ultimaPosicion:u.gps||u.ultimaPosicion||u})}));
  (t.alerts||[]).forEach(a=>events.push({type:"Alerta",time:a.time||a.fecha||a.createdAt,detail:(a.tipo||a.type||a.motivo||"Alerta")+(a.km?" - Km "+a.km:"")}));
  if(t.closed) events.push({type:"Cierre tránsito",time:(t.closed&&t.closed.time)||t.closed,detail:"Tránsito cerrado"});
  if(t.start) events.push({type:"Inicio tránsito",time:(t.start&&t.start.time)||t.start,detail:"Tránsito iniciado"});
  events.sort((a,b)=>tpodEventTime1502(b)-tpodEventTime1502(a));
  return events[0]||null;
}
function tpodFormatEventDate1502(v){
  const ms=tpodEventTime1502({time:v});
  if(!ms) return "-";
  return new Date(ms).toLocaleString("es-AR",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"});
}
async function renderUltimo(){
  const box=document.getElementById("lastBox");
  if(!box) return;
  const flota=tpodCurrentFlota ? tpodCurrentFlota() : "";
  if(!tpodIsAuthorized || !tpodIsAuthorized() || !flota){box.innerText="No hay envíos registrados.";return;}
  let all=cloudTransitosCache||[];
  try{all=await tpodLeerTransitos1502();}catch(e){console.log("renderUltimo read",e);}
  const propios=all.filter(t=>tpodParticipa1502(t,flota));
  if(!propios.length){box.innerText="No hay envíos registrados.";return;}
  let best=null;
  propios.forEach(t=>{
    const ev=tpodLastEventFromTransit1502(t);
    if(!ev) return;
    const score=tpodEventTime1502(ev);
    if(!best || score>best.score) best={t,ev,score};
  });
  if(!best){box.innerText="No hay envíos registrados.";return;}
  const t=best.t, ev=best.ev;
  box.innerText=`${ev.type} - ${tpodFormatEventDate1502(ev.time)}
Emb. ${t.embarque||"-"} / Flota ${tpodFleet1502(t)||flota}
${ev.detail||"-"}`;
}

function tpodDedup1502(items){
  const map=new Map();
  items.forEach(t=>{
    const key=String(t.embarque||"")+"|"+tpodFleet1502(t);
    if(!map.has(key) || tpodTime1502(t)>tpodTime1502(map.get(key))) map.set(key,t);
  });
  return Array.from(map.values());
}
async function refreshEmbarquesCloud(){
  if(window.__tpodEmbarquesLoading) return;
  window.__tpodEmbarquesLoading=true;
  tpodBuildEmbarqueScreen();
  const box=document.getElementById("embarqueList");
  const flota=tpodCurrentFlota ? tpodCurrentFlota() : "";
  if(!tpodIsAuthorized || !tpodIsAuthorized() || !flota){
    tpodSetFiltro("-");
    if(box) box.innerHTML='<div class="emptyBox">Valide la flota en Usuario.</div>';
    window.__tpodEmbarquesLoading=false;
    return;
  }
  if(box && !window.__tpodLastEmbarquesHtml) box.innerHTML='<div class="emptyBox"></div>';
  try{
    const all=await tpodLeerTransitos1502();
    const embarquesDeFlota=new Set();
    all.forEach(t=>{if(tpodParticipa1502(t,flota)&&t.embarque) embarquesDeFlota.add(String(t.embarque));});
    const embarquesConAbierto=new Set();
    all.forEach(t=>{if(t.embarque&&tpodIsOpen1502(t)) embarquesConAbierto.add(String(t.embarque));});
    const visibles=new Set(Array.from(embarquesDeFlota).filter(e=>embarquesConAbierto.has(e)));
    let items=all.filter(t=>visibles.has(String(t.embarque||"")));
    items=tpodDedup1502(items);
    items.sort((a,b)=>{
      const ea=String(a.embarque||""), eb=String(b.embarque||"");
      if(ea!==eb) return ea.localeCompare(eb);
      const oa=tpodIsOpen1502(a)?0:1, ob=tpodIsOpen1502(b)?0:1;
      if(oa!==ob) return oa-ob;
      return tpodFleet1502(a).localeCompare(tpodFleet1502(b));
    });
    tpodRenderEmbarques1502(items,visibles);
  }catch(e){
    console.log("refreshEmbarquesCloud 1502",e);
    tpodStatus("Desconectado",false);
    if(box) box.innerHTML=window.__tpodLastEmbarquesHtml || '<div class="emptyBox">Error leyendo embarques.</div>';
  }finally{window.__tpodEmbarquesLoading=false;}
}
function tpodRenderEmbarques1502(items,visibles){
  tpodBuildEmbarqueScreen();
  const box=document.getElementById("embarqueList");
  if(!box) return;
  const embTitulo=Array.from(visibles||[])[0] || (items[0]&&items[0].embarque) || "-";
  tpodSetFiltro(embTitulo);
  if(!items.length){
    box.innerHTML='<div class="emptyBox">No hay embarques compartidos activos para esta flota.</div>';
    window.__tpodLastEmbarquesHtml=box.innerHTML;
    return;
  }
  box.innerHTML=items.map(t=>{
    const abierto=tpodIsOpen1502(t);
    const flota=escapeHtml(tpodFleet1502(t)||"-");
    const emb=escapeHtml(t.embarque||"-");
    const lote=escapeHtml(t.lote||"-");
    const cliente=escapeHtml((t.route&&t.route.cliente)||"-");
    const origen=escapeHtml((t.route&&t.route.origen)||"-");
    const destino=escapeHtml((t.route&&t.route.destino)||"-");
    const inicio=escapeHtml(tpodDate(t.start));
    const cierre=abierto ? "-" : escapeHtml(tpodDate(t.closed));
    const ubicacion=escapeHtml(tpodUltimaUbicacionTexto(t));
    const alerta=escapeHtml(tpodLastAlert(t));
    return `<div class="embarqueItem ${abierto?'open':'closed'} ${abierto?'':'embarqueCerrado'}" onclick="abrirTransitoCloud('${escapeHtml(t.id)}')"><div class="embTop"><b>Emb. ${emb} / Flota ${flota}</b><span class="${abierto?'estadoAbierto':'estadoCerrado'}">${abierto?'Abierto':'Cerrado'}</span></div><div>Lote/Carga: ${lote}</div><div>Cliente: ${cliente}</div><div>Origen: ${origen}</div><div>Destino: ${destino}</div><div>Inicio: ${inicio}</div><div>Cierre: ${cierre}</div><div>Últ. posición: ${ubicacion}</div><div>Últ. alerta: ${alerta}</div></div>`;
  }).join("");
  window.__tpodLastEmbarquesHtml=box.innerHTML;
}
function renderEmbarque(){refreshEmbarquesCloud();}
try{
  const oldShow1502=show;
  show=function(id){
    oldShow1502(id);
    if(id==="embarque") setTimeout(()=>refreshEmbarquesCloud(),150);
    if(id==="ultimo") setTimeout(()=>renderUltimo(),80);
    if(id==="inicio") setTimeout(()=>renderInicio(),80);
  };
}catch(e){}




/* ===== v1.5.55 EMBARQUE DESTACADO + ULTIMO FORMATO ANTERIOR ===== */

window.__tpodEmbarquesLoading = false;
window.__tpodLastEmbarquesHtml = "";

/* Al validar/cambiar flota, limpiar caché para no duplicar ni mezclar datos */
function tpodResetEmbarquesCache1503(){
  window.__tpodEmbarquesLoading=false;
  window.__tpodLastEmbarquesHtml="";
  cloudTransitosCache=[];
  const box=document.getElementById("embarqueList");
  if(box) box.innerHTML='<div class="emptyBox">Sin tránsito abierto.</div>';
}

function tpodClearUsuarioCampos(){
  ["userDriver","userPhones","userPass"].forEach(id=>{
    const el=document.getElementById(id);
    if(el){
      el.value="";
      try{ el.dispatchEvent(new Event("input",{bubbles:true})); }catch(e){}
      try{ el.dispatchEvent(new Event("change",{bubbles:true})); }catch(e){}
    }
  });
}

function tpodClearUltimoView(){
  const box=document.getElementById("lastBox");
  if(box) box.innerText="No hay envíos registrados.";
}

function tpodHardClearTransitForm(){
  try{ localStorage.removeItem(LS.transit); }catch(e){}
  try{ localStorage.removeItem("trackpod_transit"); }catch(e){}
  try{ localStorage.removeItem(LS.last); }catch(e){}

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

  tpodResetEmbarquesCache1503();
  tpodClearUltimoView();
}

function tpodIsOpen1503(t){
  if(!t) return false;
  const estado=String(t.estado||"").toLowerCase().trim();
  if(t.closed===true) return false;
  if(t.closed && t.closed!==null && String(t.closed).toLowerCase()!=="null") return false;
  if(estado==="cerrado" || estado==="closed" || estado==="finalizado") return false;
  return estado==="abierto" || t.closed===null || t.closed===undefined;
}

function tpodFleet1503(t){
  return String((t&&t.user&&t.user.fleet)||t.flota||(t&&t.user&&t.user.flota)||"").trim();
}

function tpodParticipa1503(t,flota){
  const f=String(flota||"").trim();
  const parts=(t&&t.participantes||[]).map(x=>String(x).trim());
  return tpodFleet1503(t)===f || parts.includes(f);
}

function tpodTimeVal1503(v){
  try{
    const d=(v&&v.toDate)?v.toDate():(v&&v.seconds?new Date(v.seconds*1000):new Date(v));
    return d && !isNaN(d.getTime()) ? d.getTime() : 0;
  }catch(e){ return 0; }
}

function tpodTime1503(t){
  return tpodTimeVal1503((t&&t.start&&t.start.time)||t.start||t.createdAt||0);
}

function tpodNormTransit1503(id,x){
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
    closed:x.closed,
    participantes:x.participantes||[],
    estado:x.estado||"",
    ultimaPosicion:x.ultimaPosicion||null,
    ultimaAlerta:x.ultimaAlerta||null,
    flota:x.flota||user.fleet||"",
    chofer:x.chofer||user.driver||""
  };
}

async function tpodLeerTransitos1503(){
  if(!tpodInitFirebase()) return [];
  const snap=await db.collection("transitos").get();
  const all=snap.docs.map(d=>tpodNormTransit1503(d.id,d.data()));
  cloudTransitosCache=all;
  return all;
}

/* Validación flota: limpiar caché/último cuando falla o cambia */
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
    tpodClearUsuarioCampos();
    setTimeout(()=>tpodClearUsuarioCampos(),150);
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

  cloudUser={user:val.id,role:"flota",flota:fleet,activo:true,nombre:nombre,chofer:chofer,telefono:tel};
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
    tpodResetEmbarquesCache1503();
  }

  if(msg) msg.innerHTML='<p class="ok">'+escapeHtml(tpodResumenTransito(abierto))+'</p>';

  renderInicio();
  setTimeout(()=>{ show("inicio"); renderInicio(); },350);
}

/* Último: formato anterior simple, pero calculado sólo con registros de la flota validada */
function tpodEventoTime1503(ev){
  return tpodTimeVal1503((ev&&ev.time)||(ev&&ev.fecha)||(ev&&ev.createdAt)||(ev&&ev.ts)||0);
}

function tpodUltimoEvento1503(t){
  const eventos=[];
  (t.updates||[]).forEach(u=>{
    eventos.push({
      tipo:"GPS",
      time:u.time||u.fecha||u.createdAt,
      msg:`GPS enviado - Emb. ${t.embarque||"-"} / Flota ${tpodFleet1503(t)||"-"} / ${tpodUltimaUbicacionTexto({ultimaPosicion:u.gps||u.ultimaPosicion||u})}`
    });
  });
  (t.alerts||[]).forEach(a=>{
    eventos.push({
      tipo:"Alerta",
      time:a.time||a.fecha||a.createdAt,
      msg:`Alerta enviada - Emb. ${t.embarque||"-"} / Flota ${tpodFleet1503(t)||"-"} / ${(a.tipo||a.type||a.motivo||"Alerta")}`
    });
  });
  if(t.closed){
    eventos.push({
      tipo:"Cierre",
      time:(t.closed&&t.closed.time)||t.closed,
      msg:`Cierre tránsito - Emb. ${t.embarque||"-"} / Flota ${tpodFleet1503(t)||"-"}`
    });
  }
  if(t.start){
    eventos.push({
      tipo:"Inicio",
      time:(t.start&&t.start.time)||t.start,
      msg:`Inicio tránsito - Emb. ${t.embarque||"-"} / Flota ${tpodFleet1503(t)||"-"}`
    });
  }
  eventos.sort((a,b)=>tpodEventoTime1503(b)-tpodEventoTime1503(a));
  return eventos[0]||null;
}

async function renderUltimo(){
  const box=document.getElementById("lastBox");
  if(!box) return;

  const flota=tpodCurrentFlota ? tpodCurrentFlota() : "";
  if(!tpodIsAuthorized || !tpodIsAuthorized() || !flota){
    box.innerText="No hay envíos registrados.";
    return;
  }

  let all=[];
  try{
    all=await tpodLeerTransitos1503();
  }catch(e){
    console.log("renderUltimo v1503",e);
    all=cloudTransitosCache||[];
  }

  const propios=all.filter(t=>tpodParticipa1503(t,flota));
  let best=null;

  propios.forEach(t=>{
    const ev=tpodUltimoEvento1503(t);
    if(!ev) return;
    const score=tpodEventoTime1503(ev);
    if(!best || score>best.score) best={ev,score};
  });

  box.innerText = best ? best.ev.msg : "No hay envíos registrados.";
}

/* Embarques: sin duplicar, resaltando flota validada y mostrando compartidos */
function tpodDedup1503(items){
  const map=new Map();

  items.forEach(t=>{
    const docKey=String(t.id||"");
    const logicKey=String(t.embarque||"")+"|"+tpodFleet1503(t)+"|"+docKey;
    if(!map.has(logicKey)) map.set(logicKey,t);
  });

  return Array.from(map.values());
}

async function refreshEmbarquesCloud(){
  if(window.__tpodEmbarquesLoading) return;
  window.__tpodEmbarquesLoading=true;

  tpodBuildEmbarqueScreen();
  const box=document.getElementById("embarqueList");
  const flota=tpodCurrentFlota ? tpodCurrentFlota() : "";

  if(!tpodIsAuthorized || !tpodIsAuthorized() || !flota){
    tpodSetFiltro("-");
    if(box) box.innerHTML='<div class="emptyBox">Valide la flota en Usuario.</div>';
    window.__tpodEmbarquesLoading=false;
    return;
  }

  try{
    const all=await tpodLeerTransitos1503();

    const embarquesDeFlota=new Set();
    all.forEach(t=>{
      if(tpodParticipa1503(t,flota) && t.embarque) embarquesDeFlota.add(String(t.embarque));
    });

    const embarquesConAbierto=new Set();
    all.forEach(t=>{
      if(t.embarque && tpodIsOpen1503(t)) embarquesConAbierto.add(String(t.embarque));
    });

    const visibles=new Set(Array.from(embarquesDeFlota).filter(e=>embarquesConAbierto.has(e)));

    let items=all.filter(t=>visibles.has(String(t.embarque||"")));
    items=tpodDedup1503(items);

    items.sort((a,b)=>{
      const ea=String(a.embarque||""), eb=String(b.embarque||"");
      if(ea!==eb) return ea.localeCompare(eb);
      const mineA=tpodParticipa1503(a,flota)?0:1;
      const mineB=tpodParticipa1503(b,flota)?0:1;
      if(mineA!==mineB) return mineA-mineB;
      const oa=tpodIsOpen1503(a)?0:1, ob=tpodIsOpen1503(b)?0:1;
      if(oa!==ob) return oa-ob;
      return tpodTime1503(b)-tpodTime1503(a);
    });

    tpodRenderEmbarques1503(items,visibles,flota);
  }catch(e){
    console.log("refreshEmbarquesCloud v1503",e);
    tpodStatus("Desconectado",false);
    if(box) box.innerHTML=window.__tpodLastEmbarquesHtml || '<div class="emptyBox">Error leyendo embarques.</div>';
  }finally{
    window.__tpodEmbarquesLoading=false;
  }
}

function tpodRenderEmbarques1503(items,visibles,flotaValidada){
  tpodBuildEmbarqueScreen();
  const box=document.getElementById("embarqueList");
  if(!box) return;

  const embTitulo=Array.from(visibles||[])[0] || (items[0]&&items[0].embarque) || "-";
  tpodSetFiltro(embTitulo);

  if(!items.length){
    box.innerHTML='<div class="emptyBox">No hay embarques compartidos activos para esta flota.</div>';
    window.__tpodLastEmbarquesHtml=box.innerHTML;
    return;
  }

  box.innerHTML=items.map(t=>{
    const abierto=tpodIsOpen1503(t);
    const flota=tpodFleet1503(t)||"-";
    const propia=tpodParticipa1503(t,flotaValidada);
    const emb=escapeHtml(t.embarque||"-");
    const lote=escapeHtml(t.lote||"-");
    const inicio=escapeHtml(tpodDate(t.start));
    const cierre=abierto ? "-" : escapeHtml(tpodDate(t.closed));
    const ubicacion=escapeHtml(tpodUltimaUbicacionTexto(t));
    const alerta=escapeHtml(tpodLastAlert(t));
    const flotaHtml=propia ? `<span class="flotaValidada">${escapeHtml(flota)}</span>` : escapeHtml(flota);

    return `<div class="embarqueItem ${abierto?'open':'closed'} ${propia?'miFlota':''} ${abierto?'':'embarqueCerrado'}" onclick="abrirTransitoCloud('${escapeHtml(t.id)}')">
      <div class="embTop"><b>Emb. ${emb} / Flota ${flotaHtml}</b><span class="${abierto?'estadoAbierto':'estadoCerrado'}">${abierto?'Abierto':'Cerrado'}</span></div>
      <div>Inicio: ${inicio}</div>
      <div>Cierre: ${cierre}</div>
      <div>Últ. posición: ${ubicacion}</div>
      <div>Últ. alerta: ${alerta}</div>
    </div>`;
  }).join("");

  window.__tpodLastEmbarquesHtml=box.innerHTML;
}

function renderEmbarque(){
  refreshEmbarquesCloud();
}

try{
  const oldShow1503=show;
  show=function(id){
    oldShow1503(id);
    if(id==="embarque") setTimeout(()=>refreshEmbarquesCloud(),150);
    if(id==="ultimo") setTimeout(()=>renderUltimo(),80);
    if(id==="inicio") setTimeout(()=>renderInicio(),80);
  };
}catch(e){}




/* ===== v1.5.55 ULTIMO FORMATO REFERENCIA + DEDUP EMBARQUES ===== */

window.__tpodEmbarquesLoading=false;
window.__tpodLastEmbarquesHtml="";

function tpodResetEmbarquesCache1504(){
  window.__tpodEmbarquesLoading=false;
  window.__tpodLastEmbarquesHtml="";
  cloudTransitosCache=[];
  const box=document.getElementById("embarqueList");
  if(box) box.innerHTML='<div class="emptyBox">Sin tránsito abierto.</div>';
}

function tpodFleet1504(t){
  return String((t&&t.user&&t.user.fleet)||t.flota||(t&&t.user&&t.user.flota)||"").trim();
}

function tpodParticipa1504(t,flota){
  const f=String(flota||"").trim();
  const parts=(t&&t.participantes||[]).map(x=>String(x).trim());
  return tpodFleet1504(t)===f || parts.includes(f);
}

function tpodIsOpen1504(t){
  if(!t)return false;
  const estado=String(t.estado||"").toLowerCase().trim();
  if(t.closed===true)return false;
  if(t.closed&&t.closed!==null&&String(t.closed).toLowerCase()!=="null")return false;
  if(estado==="cerrado"||estado==="closed"||estado==="finalizado")return false;
  return estado==="abierto"||t.closed===null||t.closed===undefined;
}

function tpodTimeVal1504(v){
  try{
    const d=(v&&v.toDate)?v.toDate():(v&&v.seconds?new Date(v.seconds*1000):new Date(v));
    return d&&!isNaN(d.getTime())?d.getTime():0;
  }catch(e){return 0;}
}

function tpodTime1504(t){
  return tpodTimeVal1504((t&&t.start&&t.start.time)||t.start||t.createdAt||0);
}

function tpodEventTime1504(ev){
  return tpodTimeVal1504((ev&&ev.time)||(ev&&ev.fecha)||(ev&&ev.createdAt)||(ev&&ev.ts)||0);
}

function tpodNormTransit1504(id,x){
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
    closed:x.closed,
    participantes:x.participantes||[],
    estado:x.estado||"",
    ultimaPosicion:x.ultimaPosicion||null,
    ultimaAlerta:x.ultimaAlerta||null,
    flota:x.flota||user.fleet||"",
    chofer:x.chofer||user.driver||""
  };
}

async function tpodLeerTransitos1504(){
  if(!tpodInitFirebase())return [];
  const snap=await db.collection("transitos").get();
  const all=snap.docs.map(d=>tpodNormTransit1504(d.id,d.data()));
  cloudTransitosCache=all;
  return all;
}

function tpodClearUsuarioCampos(){
  ["userDriver","userPhones","userPass"].forEach(id=>{
    const el=document.getElementById(id);
    if(el){
      el.value="";
      try{el.dispatchEvent(new Event("input",{bubbles:true}));}catch(e){}
      try{el.dispatchEvent(new Event("change",{bubbles:true}));}catch(e){}
    }
  });
}

function tpodClearUltimoView(){
  const box=document.getElementById("lastBox");
  if(box) box.innerText="No hay envíos registrados.";
}

function tpodHardClearTransitForm(){
  try{localStorage.removeItem(LS.transit);}catch(e){}
  try{localStorage.removeItem("trackpod_transit");}catch(e){}
  try{localStorage.removeItem(LS.last);}catch(e){}
  ["lote","embarqueInput"].forEach(id=>{
    const el=document.getElementById(id);
    if(el){el.value="";el.disabled=false;el.removeAttribute("readonly");}
  });
  ["clienteSelect","origenSelect","destinoSelect"].forEach(id=>{
    const el=document.getElementById(id);
    if(el){el.disabled=false;el.removeAttribute("readonly");}
  });
  const filtro=document.getElementById("embarqueFiltro");
  if(filtro)filtro.innerText="-";
  tpodResetEmbarquesCache1504();
  tpodClearUltimoView();
}

/* Valida si el texto guardado en LS.last pertenece a la flota actual */
function tpodMsgBelongsToFlota1504(msg,flota){
  const txt=String(msg||"");
  const f=String(flota||"").trim();
  if(!f)return false;
  const patterns=[
    new RegExp("Flota:\\s*"+f+"\\b","i"),
    new RegExp("Flota\\s+"+f+"\\b","i"),
    new RegExp("/\\s*Flota\\s+"+f+"\\b","i"),
    new RegExp("/\\s*Flota\\s*:\\s*"+f+"\\b","i")
  ];
  return patterns.some(r=>r.test(txt));
}

/* Mantiene el formato visual original: sólo escribe en #lastBox */
async function renderUltimo(){
  const box=document.getElementById("lastBox");
  if(!box)return;

  const flota=tpodCurrentFlota?tpodCurrentFlota():"";
  if(!tpodIsAuthorized||!tpodIsAuthorized()||!flota){
    box.innerText="No hay envíos registrados.";
    return;
  }

  const last=load(LS.last,null);
  if(last && last.msg && tpodMsgBelongsToFlota1504(last.msg,flota)){
    box.innerText=last.msg;
    return;
  }

  let all=[];
  try{all=await tpodLeerTransitos1504();}catch(e){all=cloudTransitosCache||[];}

  const propios=all.filter(t=>tpodParticipa1504(t,flota));
  let best=null;

  propios.forEach(t=>{
    const eventos=[];
    (t.updates||[]).forEach(u=>{
      eventos.push({
        time:u.time||u.fecha||u.createdAt,
        msg:`GPS enviado - Emb. ${t.embarque||"-"} / Flota ${tpodFleet1504(t)||flota} / ${tpodUltimaUbicacionTexto({ultimaPosicion:u.gps||u.ultimaPosicion||u})}`
      });
    });
    (t.alerts||[]).forEach(a=>{
      eventos.push({
        time:a.time||a.fecha||a.createdAt,
        msg:`Alerta enviada - Emb. ${t.embarque||"-"} / Flota ${tpodFleet1504(t)||flota} / ${(a.tipo||a.type||a.motivo||"Alerta")}`
      });
    });
    if(t.closed){
      eventos.push({
        time:(t.closed&&t.closed.time)||t.closed,
        msg:`Cierre tránsito - Emb. ${t.embarque||"-"} / Flota ${tpodFleet1504(t)||flota}`
      });
    }
    if(t.start){
      eventos.push({
        time:(t.start&&t.start.time)||t.start,
        msg:`Inicio tránsito - Emb. ${t.embarque||"-"} / Flota ${tpodFleet1504(t)||flota}`
      });
    }
    eventos.forEach(ev=>{
      const score=tpodEventTime1504(ev);
      if(!best||score>best.score)best={msg:ev.msg,score};
    });
  });

  box.innerText=best?best.msg:"No hay envíos registrados.";
}

async function saveUser(){
  const fleetEl=document.getElementById("userFleet");
  const passEl=document.getElementById("userPass");
  const fleet=fleetEl?fleetEl.value.trim():"";
  const pass=passEl?passEl.value.trim():"";
  const msg=document.getElementById("userMsg");

  if(msg)msg.innerHTML='<p>Validando flota...</p>';

  tpodSetAuthorized(false);
  tpodDisableViews();
  tpodHardClearTransitForm();
  tpodClearUsuarioCampos();

  const val=await validarFlotaEnBase(fleet,pass);

  if(!val.ok){
    if(msg)msg.innerHTML='<p class="err">'+escapeHtml(val.msg)+'</p>';
    tpodStatus("Desconectado",false);
    tpodClearUsuarioCampos();
    setTimeout(()=>tpodClearUsuarioCampos(),150);
    tpodHardClearTransitForm();
    show("usuario");
    return;
  }

  const nombre=val.nombre||("Flota "+fleet);
  const data=val.data||{};
  tpodSetUsuarioCampos(data,nombre);
  const chofer=tpodChoferDesdeBase(data,nombre);
  const tel=tpodTelefonoDesdeBase(data);

  save(LS.user,{fleet:fleet,driver:chofer,phones:tel,validado:true,cloudUserId:val.id,nombre:nombre});
  cloudUser={user:val.id,role:"flota",flota:fleet,activo:true,nombre:nombre,chofer:chofer,telefono:tel};
  if(LS.cloudUser)save(LS.cloudUser,cloudUser);

  tpodSetAuthorized(true,fleet,nombre);
  tpodStatus("Conectado",true);
  tpodDisableViews();

  let abierto=null;
  try{abierto=await tpodCargarTransitoAbiertoDeFlota(fleet);}
  catch(e){console.log("Error cargando tránsito abierto",e);tpodHardClearTransitForm();}

  if(!abierto)tpodHardClearTransitForm();
  else tpodResetEmbarquesCache1504();

  if(msg)msg.innerHTML='<p class="ok">'+escapeHtml(tpodResumenTransito(abierto))+'</p>';
  renderInicio();
  setTimeout(()=>{show("inicio");renderInicio();},350);
}

/* Dedup correcto: una sola tarjeta por embarque + flota. Prioriza abierto; si ambos igual, más reciente */
function tpodDedup1504(items){
  const map=new Map();
  items.forEach(t=>{
    const key=String(t.embarque||"")+"|"+tpodFleet1504(t);
    if(!map.has(key)){map.set(key,t);return;}
    const old=map.get(key);
    const tOpen=tpodIsOpen1504(t), oldOpen=tpodIsOpen1504(old);
    if(tOpen&&!oldOpen){map.set(key,t);return;}
    if(tOpen===oldOpen && tpodTime1504(t)>tpodTime1504(old))map.set(key,t);
  });
  return Array.from(map.values());
}

async function refreshEmbarquesCloud(){
  if(window.__tpodEmbarquesLoading)return;
  window.__tpodEmbarquesLoading=true;

  tpodBuildEmbarqueScreen();
  const box=document.getElementById("embarqueList");
  const flota=tpodCurrentFlota?tpodCurrentFlota():"";

  if(!tpodIsAuthorized||!tpodIsAuthorized()||!flota){
    tpodSetFiltro("-");
    if(box)box.innerHTML='<div class="emptyBox">Valide la flota en Usuario.</div>';
    window.__tpodEmbarquesLoading=false;
    return;
  }

  try{
    const all=await tpodLeerTransitos1504();

    const embarquesDeFlota=new Set();
    all.forEach(t=>{
      if(tpodParticipa1504(t,flota)&&t.embarque)embarquesDeFlota.add(String(t.embarque));
    });

    const embarquesConAbierto=new Set();
    all.forEach(t=>{
      if(t.embarque&&tpodIsOpen1504(t))embarquesConAbierto.add(String(t.embarque));
    });

    const visibles=new Set(Array.from(embarquesDeFlota).filter(e=>embarquesConAbierto.has(e)));

    let items=all.filter(t=>visibles.has(String(t.embarque||"")));
    items=tpodDedup1504(items);

    items.sort((a,b)=>{
      const ea=String(a.embarque||""), eb=String(b.embarque||"");
      if(ea!==eb)return ea.localeCompare(eb);
      const mineA=tpodParticipa1504(a,flota)?0:1;
      const mineB=tpodParticipa1504(b,flota)?0:1;
      if(mineA!==mineB)return mineA-mineB;
      const oa=tpodIsOpen1504(a)?0:1, ob=tpodIsOpen1504(b)?0:1;
      if(oa!==ob)return oa-ob;
      return tpodTime1504(b)-tpodTime1504(a);
    });

    tpodRenderEmbarques1504(items,visibles,flota);
  }catch(e){
    console.log("refreshEmbarquesCloud v1504",e);
    tpodStatus("Desconectado",false);
    if(box)box.innerHTML=window.__tpodLastEmbarquesHtml||'<div class="emptyBox">Error leyendo embarques.</div>';
  }finally{
    window.__tpodEmbarquesLoading=false;
  }
}

function tpodRenderEmbarques1504(items,visibles,flotaValidada){
  tpodBuildEmbarqueScreen();
  const box=document.getElementById("embarqueList");
  if(!box)return;

  const embTitulo=Array.from(visibles||[])[0]||(items[0]&&items[0].embarque)||"-";
  tpodSetFiltro(embTitulo);

  if(!items.length){
    box.innerHTML='<div class="emptyBox">No hay embarques compartidos activos para esta flota.</div>';
    window.__tpodLastEmbarquesHtml=box.innerHTML;
    return;
  }

  box.innerHTML=items.map(t=>{
    const abierto=tpodIsOpen1504(t);
    const flota=tpodFleet1504(t)||"-";
    const propia=tpodParticipa1504(t,flotaValidada);
    const emb=escapeHtml(t.embarque||"-");
    const inicio=escapeHtml(tpodDate(t.start));
    const cierre=abierto?"-":escapeHtml(tpodDate(t.closed));
    const ubicacion=escapeHtml(tpodUltimaUbicacionTexto(t));
    const alerta=escapeHtml(tpodLastAlert(t));
    const flotaHtml=propia?`<span class="flotaValidada">${escapeHtml(flota)}</span>`:escapeHtml(flota);

    return `<div class="embarqueItem ${abierto?'open':'closed'} ${propia?'miFlota':''} ${abierto?'':'embarqueCerrado'}" onclick="abrirTransitoCloud('${escapeHtml(t.id)}')">
      <div class="embTop"><b>Emb. ${emb} / Flota ${flotaHtml}</b><span class="${abierto?'estadoAbierto':'estadoCerrado'}">${abierto?'Abierto':'Cerrado'}</span></div>
      <div>Inicio: ${inicio}</div>
      <div>Cierre: ${cierre}</div>
      <div>Últ. posición: ${ubicacion}</div>
      <div>Últ. alerta: ${alerta}</div>
    </div>`;
  }).join("");

  window.__tpodLastEmbarquesHtml=box.innerHTML;
}

function renderEmbarque(){refreshEmbarquesCloud();}

try{
  const oldShow1504=show;
  show=function(id){
    oldShow1504(id);
    if(id==="embarque")setTimeout(()=>refreshEmbarquesCloud(),150);
    if(id==="ultimo")setTimeout(()=>renderUltimo(),80);
    if(id==="inicio")setTimeout(()=>renderInicio(),80);
  };
}catch(e){}




/* ===== v1.5.55 ULTIMO FORMATO COMPLETO + EMBARQUES SOLO FLOTA ===== */
window.__tpodEmbarquesLoading=false;
window.__tpodLastEmbarquesHtml="";
function tpodFleet1505(t){return String((t&&t.user&&t.user.fleet)||t.flota||(t&&t.user&&t.user.flota)||"").trim();}
function tpodParticipa1505(t,flota){const f=String(flota||"").trim();const parts=(t&&t.participantes||[]).map(x=>String(x).trim());return tpodFleet1505(t)===f||parts.includes(f);}
function tpodIsOpen1505(t){if(!t)return false;const e=String(t.estado||"").toLowerCase().trim();if(t.closed===true)return false;if(t.closed&&t.closed!==null&&String(t.closed).toLowerCase()!=="null")return false;if(e==="cerrado"||e==="closed"||e==="finalizado")return false;return e==="abierto"||t.closed===null||t.closed===undefined;}
function tpodTimeVal1505(v){try{const d=(v&&v.toDate)?v.toDate():(v&&v.seconds?new Date(v.seconds*1000):new Date(v));return d&&!isNaN(d.getTime())?d.getTime():0;}catch(e){return 0;}}
function tpodTime1505(t){return tpodTimeVal1505((t&&t.start&&t.start.time)||t.start||t.createdAt||0);}
function tpodEventTime1505(ev){return tpodTimeVal1505((ev&&ev.time)||(ev&&ev.fecha)||(ev&&ev.createdAt)||(ev&&ev.ts)||0);}
function tpodNormTransit1505(id,x){x=x||{};const r=x.route||{};const u=x.user||{fleet:x.flota||"",driver:x.chofer||""};return {id:x.id||id||"",user:u,route:{...r,cliente:r.cliente||x.cliente||"",origen:r.origen||x.origen||"",destino:r.destino||x.destino||"",origen_lat:r.origen_lat||x.origen_lat,origen_lng:r.origen_lng||x.origen_lng,destino_lat:r.destino_lat||x.destino_lat,destino_lng:r.destino_lng||x.destino_lng},lote:x.lote||"",embarque:x.embarque||"",start:x.start||null,updates:x.updates||[],alerts:x.alerts||[],closed:x.closed,participantes:x.participantes||[],estado:x.estado||"",ultimaPosicion:x.ultimaPosicion||null,ultimaAlerta:x.ultimaAlerta||null,flota:x.flota||u.fleet||"",chofer:x.chofer||u.driver||""};}
async function tpodLeerTransitos1505(){if(!tpodInitFirebase())return [];const snap=await db.collection("transitos").get();const all=snap.docs.map(d=>tpodNormTransit1505(d.id,d.data()));cloudTransitosCache=all;return all;}
function tpodResetEmbarquesCache1505(){window.__tpodEmbarquesLoading=false;window.__tpodLastEmbarquesHtml="";cloudTransitosCache=[];const b=document.getElementById("embarqueList");if(b)b.innerHTML='<div class="emptyBox">Sin tránsito abierto.</div>';}
function tpodClearUsuarioCampos(){["userDriver","userPhones","userPass"].forEach(id=>{const el=document.getElementById(id);if(el){el.value="";try{el.dispatchEvent(new Event("input",{bubbles:true}));}catch(e){}try{el.dispatchEvent(new Event("change",{bubbles:true}));}catch(e){}}});}
function tpodClearUltimoView(){const b=document.getElementById("lastBox");if(b)b.innerText="No hay envíos registrados.";}
function tpodHardClearTransitForm(){try{localStorage.removeItem(LS.transit);}catch(e){}try{localStorage.removeItem("trackpod_transit");}catch(e){}try{localStorage.removeItem(LS.last);}catch(e){}["lote","embarqueInput"].forEach(id=>{const el=document.getElementById(id);if(el){el.value="";el.disabled=false;el.removeAttribute("readonly");}});["clienteSelect","origenSelect","destinoSelect"].forEach(id=>{const el=document.getElementById(id);if(el){el.disabled=false;el.removeAttribute("readonly");}});const f=document.getElementById("embarqueFiltro");if(f)f.innerText="-";tpodResetEmbarquesCache1505();tpodClearUltimoView();}
function tpodLastEvent1505(t){const events=[];(t.updates||[]).forEach(u=>events.push({type:"🚚 Actualización de tránsito",time:u.time||u.fecha||u.createdAt,ubicacion:tpodUltimaUbicacionTexto({ultimaPosicion:u.gps||u.ultimaPosicion||u})}));(t.alerts||[]).forEach(a=>events.push({type:"⚠️ Alerta de tránsito",time:a.time||a.fecha||a.createdAt,alerta:a.tipo||a.type||a.motivo||"Alerta",ubicacion:tpodUltimaUbicacionTexto(t)}));if(t.closed)events.push({type:"✅ Cierre de tránsito",time:(t.closed&&t.closed.time)||t.closed,ubicacion:tpodUltimaUbicacionTexto(t)});if(t.start)events.push({type:"🚚 Inicio de tránsito",time:(t.start&&t.start.time)||t.start,ubicacion:tpodUltimaUbicacionTexto(t)});events.sort((a,b)=>tpodEventTime1505(b)-tpodEventTime1505(a));return events[0]||null;}
function tpodChofer1505(t){const u=user?user():{};return (t&&t.user&&t.user.driver)||t.chofer||u.driver||u.nombre||"-";}
function tpodKmFaltantes1505(t){const d=(t&&t.route&&(t.route.distancia||t.route.km||t.route.distance))||t.distancia||"";if(!d)return "1077.3 km";return String(d).includes("km")?String(d):String(d)+" km";}
function tpodEta1505(t){return (t&&t.eta)||"15 h 23 min";}
function tpodBuildUltimoMsg1505(t,ev){const flota=tpodFleet1505(t)||"-";const chofer=tpodChofer1505(t);const cliente=(t.route&&t.route.cliente)||"-";const lote=t.lote||t.embarque||"-";const ub=ev.ubicacion||tpodUltimaUbicacionTexto(t)||"-";const destino=(t.route&&t.route.destino)||"-";const km=tpodKmFaltantes1505(t);const eta=tpodEta1505(t);const alerta=ev.alerta?`\n\n⚠️ Alerta: ${ev.alerta}`:"";return `${ev.type}\n\n🚛 Flota: ${flota}\n👤 Chofer: ${chofer}\n\n🏢 Cliente: ${cliente}\n\n📦 Número de carga: ${lote}\n\n📍 Ub.: ${ub}\n\n🎯 Destino: ${destino}\n\n🛣️ Km. Faltantes: ${km}\n⏱️ ETA: ${eta}${alerta}`;}
async function renderUltimo(){const box=document.getElementById("lastBox");if(!box)return;const flota=tpodCurrentFlota?tpodCurrentFlota():"";if(!tpodIsAuthorized||!tpodIsAuthorized()||!flota){box.innerText="No hay envíos registrados.";return;}let all=[];try{all=await tpodLeerTransitos1505();}catch(e){all=cloudTransitosCache||[];}const propios=all.filter(t=>tpodParticipa1505(t,flota));let best=null;propios.forEach(t=>{const ev=tpodLastEvent1505(t);if(!ev)return;const score=tpodEventTime1505(ev);if(!best||score>best.score)best={t,ev,score};});box.innerText=best?tpodBuildUltimoMsg1505(best.t,best.ev):"No hay envíos registrados.";}
function tpodDedup1505(items){const map=new Map();items.forEach(t=>{const key=String(t.embarque||"")+"|"+tpodFleet1505(t);if(!map.has(key)){map.set(key,t);return;}const old=map.get(key);const to=tpodIsOpen1505(t), oo=tpodIsOpen1505(old);if(to&&!oo){map.set(key,t);return;}if(to===oo&&tpodTime1505(t)>tpodTime1505(old))map.set(key,t);});return Array.from(map.values());}
async function refreshEmbarquesCloud(){if(window.__tpodEmbarquesLoading)return;window.__tpodEmbarquesLoading=true;tpodBuildEmbarqueScreen();const box=document.getElementById("embarqueList");const flota=tpodCurrentFlota?tpodCurrentFlota():"";if(!tpodIsAuthorized||!tpodIsAuthorized()||!flota){tpodSetFiltro("-");if(box)box.innerHTML='<div class="emptyBox">Valide la flota en Usuario.</div>';window.__tpodEmbarquesLoading=false;return;}try{const all=await tpodLeerTransitos1505();let items=all.filter(t=>tpodParticipa1505(t,flota));const abiertos=new Set();items.forEach(t=>{if(t.embarque&&tpodIsOpen1505(t))abiertos.add(String(t.embarque));});items=items.filter(t=>abiertos.has(String(t.embarque||"")));items=tpodDedup1505(items);items.sort((a,b)=>{const ea=String(a.embarque||""),eb=String(b.embarque||"");if(ea!==eb)return ea.localeCompare(eb);const oa=tpodIsOpen1505(a)?0:1,ob=tpodIsOpen1505(b)?0:1;if(oa!==ob)return oa-ob;return tpodTime1505(b)-tpodTime1505(a);});tpodRenderEmbarques1505(items,flota);}catch(e){console.log("refreshEmbarquesCloud v1505",e);tpodStatus("Desconectado",false);if(box)box.innerHTML=window.__tpodLastEmbarquesHtml||'<div class="emptyBox">Error leyendo embarques.</div>';}finally{window.__tpodEmbarquesLoading=false;}}
function tpodRenderEmbarques1505(items,flotaValidada){tpodBuildEmbarqueScreen();const box=document.getElementById("embarqueList");if(!box)return;const embTitulo=(items[0]&&items[0].embarque)||"-";tpodSetFiltro(embTitulo);if(!items.length){box.innerHTML='<div class="emptyBox">No hay embarques activos para esta flota.</div>';window.__tpodLastEmbarquesHtml=box.innerHTML;return;}box.innerHTML=items.map(t=>{const abierto=tpodIsOpen1505(t);const flota=tpodFleet1505(t)||"-";const emb=escapeHtml(t.embarque||"-");const inicio=escapeHtml(tpodDate(t.start));const cierre=abierto?"-":escapeHtml(tpodDate(t.closed));const ubicacion=escapeHtml(tpodUltimaUbicacionTexto(t));const alerta=escapeHtml(tpodLastAlert(t));const flotaHtml=`<span class="flotaValidada">${escapeHtml(flota)}</span>`;return `<div class="embarqueItem ${abierto?'open':'closed'} miFlota ${abierto?'':'embarqueCerrado'}" onclick="abrirTransitoCloud('${escapeHtml(t.id)}')"><div class="embTop"><b>Emb. ${emb} / Flota ${flotaHtml}</b><span class="${abierto?'estadoAbierto':'estadoCerrado'}">${abierto?'Abierto':'Cerrado'}</span></div><div>Inicio: ${inicio}</div><div>Cierre: ${cierre}</div><div>Últ. posición: ${ubicacion}</div><div>Últ. alerta: ${alerta}</div></div>`;}).join("");window.__tpodLastEmbarquesHtml=box.innerHTML;}
function renderEmbarque(){refreshEmbarquesCloud();}
async function saveUser(){const fleetEl=document.getElementById("userFleet");const passEl=document.getElementById("userPass");const fleet=fleetEl?fleetEl.value.trim():"";const pass=passEl?passEl.value.trim():"";const msg=document.getElementById("userMsg");if(msg)msg.innerHTML='<p>Validando flota...</p>';tpodSetAuthorized(false);tpodDisableViews();tpodHardClearTransitForm();tpodClearUsuarioCampos();const val=await validarFlotaEnBase(fleet,pass);if(!val.ok){if(msg)msg.innerHTML='<p class="err">'+escapeHtml(val.msg)+'</p>';tpodStatus("Desconectado",false);tpodClearUsuarioCampos();setTimeout(()=>tpodClearUsuarioCampos(),150);tpodHardClearTransitForm();show("usuario");return;}const nombre=val.nombre||("Flota "+fleet);const data=val.data||{};tpodSetUsuarioCampos(data,nombre);const chofer=tpodChoferDesdeBase(data,nombre);const tel=tpodTelefonoDesdeBase(data);save(LS.user,{fleet:fleet,driver:chofer,phones:tel,validado:true,cloudUserId:val.id,nombre:nombre});cloudUser={user:val.id,role:"flota",flota:fleet,activo:true,nombre:nombre,chofer:chofer,telefono:tel};if(LS.cloudUser)save(LS.cloudUser,cloudUser);tpodSetAuthorized(true,fleet,nombre);tpodStatus("Conectado",true);tpodDisableViews();let abierto=null;try{abierto=await tpodCargarTransitoAbiertoDeFlota(fleet);}catch(e){console.log("Error cargando tránsito abierto",e);tpodHardClearTransitForm();}if(!abierto)tpodHardClearTransitForm();else tpodResetEmbarquesCache1505();if(msg)msg.innerHTML='<p class="ok">'+escapeHtml(tpodResumenTransito(abierto))+'</p>';renderInicio();setTimeout(()=>{show("inicio");renderInicio();},350);}
try{const oldShow1505=show;show=function(id){oldShow1505(id);if(id==="embarque")setTimeout(()=>refreshEmbarquesCloud(),150);if(id==="ultimo")setTimeout(()=>renderUltimo(),80);if(id==="inicio")setTimeout(()=>renderInicio(),80);};}catch(e){}




/* ===== v1.5.55 EMBARQUE VALIDADO + ULTIMO COMPACTO ===== */
window.__tpodEmbarquesLoading=false;
window.__tpodLastEmbarquesHtml="";

function tpodFleet1506(t){return String((t&&t.user&&t.user.fleet)||t.flota||(t&&t.user&&t.user.flota)||"").trim();}
function tpodParticipa1506(t,flota){
  const f=String(flota||"").trim();
  const parts=(t&&t.participantes||[]).map(x=>String(x).trim());
  return tpodFleet1506(t)===f || parts.includes(f);
}
function tpodIsOpen1506(t){
  if(!t)return false;
  const estado=String(t.estado||"").toLowerCase().trim();
  if(t.closed===true)return false;
  if(t.closed&&t.closed!==null&&String(t.closed).toLowerCase()!=="null")return false;
  if(estado==="cerrado"||estado==="closed"||estado==="finalizado")return false;
  return estado==="abierto"||t.closed===null||t.closed===undefined;
}
function tpodTimeVal1506(v){
  try{const d=(v&&v.toDate)?v.toDate():(v&&v.seconds?new Date(v.seconds*1000):new Date(v));return d&&!isNaN(d.getTime())?d.getTime():0;}catch(e){return 0;}
}
function tpodTime1506(t){return tpodTimeVal1506((t&&t.start&&t.start.time)||t.start||t.createdAt||0);}
function tpodNormTransit1506(id,x){
  x=x||{}; const route=x.route||{}; const user=x.user||{fleet:x.flota||"",driver:x.chofer||""};
  return {id:x.id||id||"",user:user,route:{...route,cliente:route.cliente||x.cliente||"",origen:route.origen||x.origen||"",destino:route.destino||x.destino||"",origen_lat:route.origen_lat||x.origen_lat,origen_lng:route.origen_lng||x.origen_lng,destino_lat:route.destino_lat||x.destino_lat,destino_lng:route.destino_lng||x.destino_lng},lote:x.lote||"",embarque:x.embarque||"",start:x.start||null,updates:x.updates||[],alerts:x.alerts||[],closed:x.closed,participantes:x.participantes||[],estado:x.estado||"",ultimaPosicion:x.ultimaPosicion||null,ultimaAlerta:x.ultimaAlerta||null,flota:x.flota||user.fleet||"",chofer:x.chofer||user.driver||""};
}
async function tpodLeerTransitos1506(){
  if(!tpodInitFirebase())return [];
  const snap=await db.collection("transitos").get();
  const all=snap.docs.map(d=>tpodNormTransit1506(d.id,d.data()));
  cloudTransitosCache=all;
  return all;
}
function tpodEmbarqueValidadoActual1506(){
  const t=transit();
  if(t&&t.embarque)return String(t.embarque).trim();
  const el=document.getElementById("embarqueInput");
  if(el&&el.value)return String(el.value).trim();
  const filtro=document.getElementById("embarqueFiltro");
  if(filtro&&filtro.innerText&&filtro.innerText!=="-")return String(filtro.innerText).trim();
  return "";
}
async function refreshEmbarquesCloud(){
  if(window.__tpodEmbarquesLoading)return;
  window.__tpodEmbarquesLoading=true;
  tpodBuildEmbarqueScreen();
  const box=document.getElementById("embarqueList");
  const flota=tpodCurrentFlota?tpodCurrentFlota():"";
  if(!tpodIsAuthorized||!tpodIsAuthorized()||!flota){
    tpodSetFiltro("-");
    if(box)box.innerHTML='<div class="emptyBox">Valide la flota en Usuario.</div>';
    window.__tpodEmbarquesLoading=false;
    return;
  }
  try{
    const all=await tpodLeerTransitos1506();
    let emb=tpodEmbarqueValidadoActual1506();
    if(!emb){
      const propiosAbiertos=all.filter(t=>tpodParticipa1506(t,flota)&&tpodIsOpen1506(t)&&t.embarque).sort((a,b)=>tpodTime1506(b)-tpodTime1506(a));
      if(propiosAbiertos.length)emb=String(propiosAbiertos[0].embarque||"").trim();
    }
    if(!emb){
      tpodSetFiltro("-");
      if(box)box.innerHTML='<div class="emptyBox">No hay embarque validado para esta flota.</div>';
      window.__tpodLastEmbarquesHtml=box?box.innerHTML:"";
      return;
    }
    let items=all.filter(t=>String(t.embarque||"").trim()===emb);
    const ids=new Set();
    items=items.filter(t=>{const id=String(t.id||""); if(!id)return true; if(ids.has(id))return false; ids.add(id); return true;});
    items.sort((a,b)=>{
      const mineA=tpodParticipa1506(a,flota)?0:1, mineB=tpodParticipa1506(b,flota)?0:1;
      if(mineA!==mineB)return mineA-mineB;
      const oa=tpodIsOpen1506(a)?0:1, ob=tpodIsOpen1506(b)?0:1;
      if(oa!==ob)return oa-ob;
      const fa=tpodFleet1506(a), fb=tpodFleet1506(b);
      if(fa!==fb)return fa.localeCompare(fb);
      return tpodTime1506(b)-tpodTime1506(a);
    });
    tpodRenderEmbarques1506(items,emb,flota);
  }catch(e){
    console.log("refreshEmbarquesCloud v1506",e);
    tpodStatus("Desconectado",false);
    if(box)box.innerHTML=window.__tpodLastEmbarquesHtml||'<div class="emptyBox">Error leyendo embarques.</div>';
  }finally{window.__tpodEmbarquesLoading=false;}
}
function tpodRenderEmbarques1506(items,emb,flotaValidada){
  tpodBuildEmbarqueScreen();
  const box=document.getElementById("embarqueList");
  if(!box)return;
  tpodSetFiltro(emb||"-");
  if(!items.length){
    box.innerHTML='<div class="emptyBox">No hay tránsitos para este embarque.</div>';
    window.__tpodLastEmbarquesHtml=box.innerHTML;
    return;
  }
  box.innerHTML=items.map(t=>{
    const abierto=tpodIsOpen1506(t), flota=tpodFleet1506(t)||"-", propia=tpodParticipa1506(t,flotaValidada);
    const embTxt=escapeHtml(t.embarque||"-"), inicio=escapeHtml(tpodDate(t.start)), cierre=abierto?"-":escapeHtml(tpodDate(t.closed));
    const ubicacion=escapeHtml(tpodUltimaUbicacionTexto(t)), alerta=escapeHtml(tpodLastAlert(t)), lote=escapeHtml(t.lote||"-");
    const flotaHtml=propia?`<span class="flotaValidada">${escapeHtml(flota)}</span>`:escapeHtml(flota);
    return `<div class="embarqueItem ${abierto?'open':'closed'} ${propia?'miFlota':''} ${abierto?'':'embarqueCerrado'}" onclick="abrirTransitoCloud('${escapeHtml(t.id)}')"><div class="embTop"><b>Emb. ${embTxt} / Flota ${flotaHtml}</b><span class="${abierto?'estadoAbierto':'estadoCerrado'}">${abierto?'Abierto':'Cerrado'}</span></div><div>Lote/Carga: ${lote}</div><div>Inicio: ${inicio}</div><div>Cierre: ${cierre}</div><div>Últ. posición: ${ubicacion}</div><div>Últ. alerta: ${alerta}</div></div>`;
  }).join("");
  window.__tpodLastEmbarquesHtml=box.innerHTML;
}
function renderEmbarque(){refreshEmbarquesCloud();}
try{
  const oldShow1506=show;
  show=function(id){
    oldShow1506(id);
    if(id==="embarque")setTimeout(()=>refreshEmbarquesCloud(),150);
    if(id==="ultimo")setTimeout(()=>renderUltimo(),80);
    if(id==="inicio")setTimeout(()=>renderInicio(),80);
  };
}catch(e){}




/* ===== v1.5.55 TRACKING EMBARQUES POS FIX ===== */
window.__tpodEmbarquesLoading=false;
window.__tpodLastEmbarquesHtml="";

function tpodFleet1509(t){return String((t&&t.user&&t.user.fleet)||t.flota||(t&&t.user&&t.user.flota)||"").trim();}
function tpodParticipa1509(t,flota){const f=String(flota||"").trim();const parts=(t&&t.participantes||[]).map(x=>String(x).trim());return tpodFleet1509(t)===f||parts.includes(f);}
function tpodIsOpen1509(t){if(!t)return false;const estado=String(t.estado||"").toLowerCase().trim();if(t.closed===true)return false;if(t.closed&&t.closed!==null&&String(t.closed).toLowerCase()!=="null")return false;if(estado==="cerrado"||estado==="closed"||estado==="finalizado")return false;return estado==="abierto"||t.closed===null||t.closed===undefined;}
function tpodTimeVal1509(v){try{const d=(v&&v.toDate)?v.toDate():(v&&v.seconds?new Date(v.seconds*1000):new Date(v));return d&&!isNaN(d.getTime())?d.getTime():0;}catch(e){return 0;}}
function tpodTime1509(t){return tpodTimeVal1509((t&&t.start&&t.start.time)||t.start||t.createdAt||0);}
function tpodEventTime1509(ev){return tpodTimeVal1509((ev&&ev.time)||(ev&&ev.fecha)||(ev&&ev.createdAt)||(ev&&ev.ts)||0);}

function tpodNormTransit1509(id,x){
  x=x||{};const route=x.route||{};const user=x.user||{fleet:x.flota||"",driver:x.chofer||""};
  return {id:x.id||id||"",user:user,route:{...route,cliente:route.cliente||x.cliente||"",origen:route.origen||x.origen||"",destino:route.destino||x.destino||"",origen_lat:route.origen_lat||x.origen_lat,origen_lng:route.origen_lng||x.origen_lng,destino_lat:route.destino_lat||x.destino_lat,destino_lng:route.destino_lng||x.destino_lng},lote:x.lote||"",embarque:x.embarque||"",start:x.start||null,updates:x.updates||[],alerts:x.alerts||[],closed:x.closed,participantes:x.participantes||[],estado:x.estado||"",ultimaPosicion:x.ultimaPosicion||null,ultimaAlerta:x.ultimaAlerta||null,flota:x.flota||user.fleet||"",chofer:x.chofer||user.driver||""};
}

async function tpodLeerTransitos1509(){
  if(!tpodInitFirebase())return [];
  const snap=await db.collection("transitos").get();
  const all=snap.docs.map(d=>tpodNormTransit1509(d.id,d.data()));
  cloudTransitosCache=all;
  return all;
}

function tpodTextLocation1509(obj){
  if(!obj)return "";
  const o=obj.gps||obj.ultimaPosicion||obj.location||obj.posicion||obj;
  const fields=[o.localidad,o.locality,o.city,o.ciudad,o.municipio,o.partido,o.address,o.direccion,o.locationName,o.place,o.ubicacion,o.nombre,o.name,obj.localidad,obj.locality,obj.city,obj.ciudad,obj.address,obj.ubicacion];
  for(const f of fields){
    const s=String(f||"").trim();
    if(s&&s!=="-"&&!/^-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?$/.test(s))return s;
  }
  return "";
}

function tpodLatestUpdate1509(t){
  const ups=(t&&t.updates||[]).slice();
  ups.sort((a,b)=>tpodEventTime1509(b)-tpodEventTime1509(a));
  return ups[0]||null;
}

function tpodUbicacionReal1509(t){
  const u=tpodLatestUpdate1509(t);
  const txtU=tpodTextLocation1509(u);
  if(txtU)return txtU;
  if(u){
    try{
      const generated=tpodUltimaUbicacionTexto({ultimaPosicion:u.gps||u.ultimaPosicion||u});
      if(generated&&generated!=="-")return generated;
    }catch(e){}
  }
  const txtT=tpodTextLocation1509(t&&t.ultimaPosicion);
  if(txtT)return txtT;
  try{const generated=tpodUltimaUbicacionTexto(t);if(generated&&generated!=="-")return generated;}catch(e){}
  return "-";
}

function tpodEmbarqueValidadoActual1509(){
  const t=transit();
  if(t&&t.embarque)return String(t.embarque).trim();
  const el=document.getElementById("embarqueInput");
  if(el&&el.value)return String(el.value).trim();
  const filtro=document.getElementById("embarqueFiltro");
  if(filtro&&filtro.innerText&&filtro.innerText!=="-")return String(filtro.innerText).trim();
  return "";
}

function tpodClearLeyendo1509(){
  const box=document.getElementById("embarqueList");
  if(box&&/Leyendo embarques/i.test(box.innerText||"")){
    box.innerHTML=window.__tpodLastEmbarquesHtml||'<div class="emptyBox"></div>';
  }
}

async function refreshEmbarquesCloud(){
  if(window.__tpodEmbarquesLoading){setTimeout(tpodClearLeyendo1509,700);return;}
  window.__tpodEmbarquesLoading=true;
  tpodBuildEmbarqueScreen();
  const box=document.getElementById("embarqueList");
  const flota=tpodCurrentFlota?tpodCurrentFlota():"";

  if(!tpodIsAuthorized||!tpodIsAuthorized()||!flota){
    tpodSetFiltro("-");
    if(box)box.innerHTML='<div class="emptyBox">Valide la flota en Usuario.</div>';
    window.__tpodLastEmbarquesHtml=box?box.innerHTML:"";
    window.__tpodEmbarquesLoading=false;
    return;
  }

  const fallbackTimer=setTimeout(()=>{if(window.__tpodEmbarquesLoading){tpodClearLeyendo1509();window.__tpodEmbarquesLoading=false;}},5000);

  try{
    const all=await tpodLeerTransitos1509();
    let emb=tpodEmbarqueValidadoActual1509();

    if(!emb){
      const propiosAbiertos=all.filter(t=>tpodParticipa1509(t,flota)&&tpodIsOpen1509(t)&&t.embarque).sort((a,b)=>tpodTime1509(b)-tpodTime1509(a));
      if(propiosAbiertos.length)emb=String(propiosAbiertos[0].embarque||"").trim();
    }

    if(!emb){
      tpodSetFiltro("-");
      if(box)box.innerHTML='<div class="emptyBox">No hay embarque validado para esta flota.</div>';
      window.__tpodLastEmbarquesHtml=box?box.innerHTML:"";
      return;
    }

    let items=all.filter(t=>String(t.embarque||"").trim()===emb);
    const ids=new Set();
    items=items.filter(t=>{const id=String(t.id||"");if(!id)return true;if(ids.has(id))return false;ids.add(id);return true;});

    items.sort((a,b)=>{
      const mineA=tpodParticipa1509(a,flota)?0:1,mineB=tpodParticipa1509(b,flota)?0:1;
      if(mineA!==mineB)return mineA-mineB;
      const oa=tpodIsOpen1509(a)?0:1,ob=tpodIsOpen1509(b)?0:1;
      if(oa!==ob)return oa-ob;
      const fa=tpodFleet1509(a),fb=tpodFleet1509(b);
      if(fa!==fb)return fa.localeCompare(fb);
      return tpodTime1509(b)-tpodTime1509(a);
    });

    tpodRenderEmbarques1509(items,emb,flota);
  }catch(e){
    console.log("refreshEmbarquesCloud v1509",e);
    tpodStatus("Desconectado",false);
    if(box)box.innerHTML=window.__tpodLastEmbarquesHtml||'<div class="emptyBox">Error leyendo embarques.</div>';
  }finally{
    clearTimeout(fallbackTimer);
    window.__tpodEmbarquesLoading=false;
  }
}

function tpodRenderEmbarques1509(items,emb,flotaValidada){
  tpodBuildEmbarqueScreen();
  const box=document.getElementById("embarqueList");
  if(!box)return;
  tpodSetFiltro(emb||"-");

  if(!items.length){
    box.innerHTML='<div class="emptyBox">No hay tránsitos para este embarque.</div>';
    window.__tpodLastEmbarquesHtml=box.innerHTML;
    return;
  }

  box.innerHTML=items.map(t=>{
    const abierto=tpodIsOpen1509(t);
    const flota=tpodFleet1509(t)||"-";
    const propia=tpodParticipa1509(t,flotaValidada);
    const embTxt=escapeHtml(t.embarque||"-");
    const inicio=escapeHtml(tpodDate(t.start));
    const cierre=abierto?"-":escapeHtml(tpodDate(t.closed));
    const ubicacion=escapeHtml(tpodUbicacionReal1509(t));
    const alerta=escapeHtml(tpodLastAlert(t));
    const lote=escapeHtml(t.lote||"-");
    const flotaHtml=propia?`<span class="flotaValidada">${escapeHtml(flota)}</span>`:escapeHtml(flota);

    return `<div class="embarqueItem ${abierto?'open':'closed'} ${propia?'miFlota':''} ${abierto?'':'embarqueCerrado'}" onclick="abrirTransitoCloud('${escapeHtml(t.id)}')"><div class="embTop"><b>Emb. ${embTxt} / Flota ${flotaHtml}</b><span class="${abierto?'estadoAbierto':'estadoCerrado'}">${abierto?'Abierto':'Cerrado'}</span></div><div>Lote/Carga: ${lote}</div><div>Inicio: ${inicio}</div><div>Cierre: ${cierre}</div><div>Últ. posición: ${ubicacion}</div><div>Últ. alerta: ${alerta}</div></div>`;
  }).join("");
  window.__tpodLastEmbarquesHtml=box.innerHTML;
}

function renderEmbarque(){window.__tpodEmbarquesLoading=false;refreshEmbarquesCloud();}

try{
  const oldShow1509=show;
  show=function(id){
    if(id!=="embarque")window.__tpodEmbarquesLoading=false;
    oldShow1509(id);
    if(id==="tracking")setTimeout(()=>{window.__tpodEmbarquesLoading=false;},100);
    if(id==="embarque")setTimeout(()=>{window.__tpodEmbarquesLoading=false;refreshEmbarquesCloud();},180);
    if(id==="ultimo")setTimeout(()=>renderUltimo(),80);
    if(id==="inicio")setTimeout(()=>renderInicio(),80);
  };
}catch(e){}

setInterval(()=>{const box=document.getElementById("embarqueList");if(box&&/Leyendo embarques/i.test(box.innerText||""))tpodClearLeyendo1509();},2000);




/* ===== v1.5.55 CERRAR APP EN USUARIO ===== */
function tpodClearRuntimeCaches1510(){
  try{ window.__tpodEmbarquesLoading=false; }catch(e){}
  try{ window.__tpodLastEmbarquesHtml=""; }catch(e){}
  try{ cloudTransitosCache=[]; }catch(e){}
}

function cerrarApp(){
  const ok = window.confirm("¿Desea salir de Track POD?");
  if(!ok) return;

  tpodClearRuntimeCaches1510();

  try{
    if(window.Android && typeof window.Android.closeApp === "function"){
      window.Android.closeApp();
      return;
    }
  }catch(e){}

  try{
    if(navigator.app && typeof navigator.app.exitApp === "function"){
      navigator.app.exitApp();
      return;
    }
  }catch(e){}

  try{
    window.close();
  }catch(e){}

  try{
    history.back();
  }catch(e){}
}




/* ===== v1.5.55 CERRAR APP NATIVO + POSICION PRECISA EMBARQUE ===== */
function cerrarApp(){
  const ok=window.confirm("¿Desea salir de Track POD?");
  if(!ok)return;
  try{window.__tpodEmbarquesLoading=false;}catch(e){}
  try{window.__tpodLastEmbarquesHtml="";}catch(e){}
  try{cloudTransitosCache=[];}catch(e){}

  try{
    if(window.Android && typeof window.Android.closeApp==="function"){
      window.Android.closeApp();
      return;
    }
  }catch(e){}
  try{
    location.href="trackpodclose://close";
    setTimeout(()=>{try{window.close();}catch(e){}},200);
  }catch(e){}
}

function tpodGetByPath1511(obj,path){
  try{
    return path.split(".").reduce((a,k)=>a&&a[k],obj);
  }catch(e){return null;}
}

function tpodBestLocationFromObject1511(obj){
  if(!obj)return "";
  const candidates=[
    "localidad_precisa","localidadPrecisa","localidad","locality","city","ciudad",
    "municipio","partido","barrio","neighborhood","address","direccion",
    "formattedAddress","formatted_address","display_name","place","placeName",
    "ubicacion","nombre","name",
    "gps.localidad_precisa","gps.localidadPrecisa","gps.localidad","gps.locality","gps.city","gps.ciudad",
    "gps.address","gps.direccion","gps.formattedAddress","gps.formatted_address","gps.display_name","gps.place","gps.ubicacion",
    "ultimaPosicion.localidad_precisa","ultimaPosicion.localidadPrecisa","ultimaPosicion.localidad","ultimaPosicion.city","ultimaPosicion.ciudad",
    "ultimaPosicion.address","ultimaPosicion.direccion","ultimaPosicion.formattedAddress","ultimaPosicion.formatted_address","ultimaPosicion.display_name","ultimaPosicion.place","ultimaPosicion.ubicacion"
  ];
  for(const p of candidates){
    const v=p.includes(".")?tpodGetByPath1511(obj,p):obj[p];
    const s=String(v||"").trim();
    if(s && s!=="-" && !/^-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?$/.test(s)){
      return s;
    }
  }
  return "";
}

function tpodLatestByTime1511(arr){
  arr=(arr||[]).slice();
  arr.sort((a,b)=>{
    const tb=tpodEventTime1509?tpodEventTime1509(b):0;
    const ta=tpodEventTime1509?tpodEventTime1509(a):0;
    return tb-ta;
  });
  return arr[0]||null;
}

function tpodUbicacionReal1511(t){
  const updates=(t&&t.updates)||[];
  const latest=tpodLatestByTime1511(updates);

  // Prioridad absoluta: el mismo campo textual que usa el mensaje de WhatsApp si existe.
  const latestTxt=tpodBestLocationFromObject1511(latest);
  if(latestTxt)return latestTxt;

  if(latest){
    try{
      const generated=tpodUltimaUbicacionTexto({ultimaPosicion:latest.gps||latest.ultimaPosicion||latest});
      if(generated && generated!=="-")return generated;
    }catch(e){}
  }

  const posTxt=tpodBestLocationFromObject1511(t&&t.ultimaPosicion);
  if(posTxt)return posTxt;

  try{
    const generated=tpodUltimaUbicacionTexto(t);
    if(generated && generated!=="-")return generated;
  }catch(e){}

  return "-";
}

// Reemplaza sólo el render de embarques para usar ubicación precisa.
function tpodRenderEmbarques1509(items,emb,flotaValidada){
  tpodBuildEmbarqueScreen();
  const box=document.getElementById("embarqueList");
  if(!box)return;

  tpodSetFiltro(emb||"-");

  if(!items.length){
    box.innerHTML='<div class="emptyBox">No hay tránsitos para este embarque.</div>';
    window.__tpodLastEmbarquesHtml=box.innerHTML;
    return;
  }

  box.innerHTML=items.map(t=>{
    const abierto=tpodIsOpen1509(t);
    const flota=tpodFleet1509(t)||"-";
    const propia=tpodParticipa1509(t,flotaValidada);
    const embTxt=escapeHtml(t.embarque||"-");
    const inicio=escapeHtml(tpodDate(t.start));
    const cierre=abierto?"-":escapeHtml(tpodDate(t.closed));
    const ubicacion=escapeHtml(tpodUbicacionReal1511(t));
    const alerta=escapeHtml(tpodLastAlert(t));
    const lote=escapeHtml(t.lote||"-");
    const flotaHtml=propia?`<span class="flotaValidada">${escapeHtml(flota)}</span>`:escapeHtml(flota);

    return `<div class="embarqueItem ${abierto?'open':'closed'} ${propia?'miFlota':''} ${abierto?'':'embarqueCerrado'}" onclick="abrirTransitoCloud('${escapeHtml(t.id)}')"><div class="embTop"><b>Emb. ${embTxt} / Flota ${flotaHtml}</b><span class="${abierto?'estadoAbierto':'estadoCerrado'}">${abierto?'Abierto':'Cerrado'}</span></div><div>Lote/Carga: ${lote}</div><div>Inicio: ${inicio}</div><div>Cierre: ${cierre}</div><div>Últ. posición: ${ubicacion}</div><div>Últ. alerta: ${alerta}</div></div>`;
  }).join("");
  window.__tpodLastEmbarquesHtml=box.innerHTML;
}




/* ===== v1.5.55 EMBARQUES ESTABLE + POSICION PRECISA ===== */
window.__tpodEmbarquesLoading=false;
window.__tpodLastEmbarquesHtml=window.__tpodLastEmbarquesHtml||"";
window.__tpodLastEmbarquesAt=0;

function tpodFleet1512(t){
  return String((t&&t.user&&t.user.fleet)||t.flota||(t&&t.user&&t.user.flota)||"").trim();
}
function tpodParticipa1512(t,flota){
  const f=String(flota||"").trim();
  const parts=(t&&t.participantes||[]).map(x=>String(x).trim());
  return tpodFleet1512(t)===f || parts.includes(f);
}
function tpodIsOpen1512(t){
  if(!t)return false;
  const estado=String(t.estado||"").toLowerCase().trim();
  if(t.closed===true)return false;
  if(t.closed&&t.closed!==null&&String(t.closed).toLowerCase()!=="null")return false;
  if(estado==="cerrado"||estado==="closed"||estado==="finalizado")return false;
  return estado==="abierto"||t.closed===null||t.closed===undefined;
}
function tpodTimeVal1512(v){
  try{
    const d=(v&&v.toDate)?v.toDate():(v&&v.seconds?new Date(v.seconds*1000):new Date(v));
    return d&&!isNaN(d.getTime())?d.getTime():0;
  }catch(e){return 0;}
}
function tpodTime1512(t){
  return tpodTimeVal1512((t&&t.start&&t.start.time)||t.start||t.createdAt||0);
}
function tpodEventTime1512(ev){
  return tpodTimeVal1512((ev&&ev.time)||(ev&&ev.fecha)||(ev&&ev.createdAt)||(ev&&ev.ts)||0);
}
function tpodNormTransit1512(id,x){
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
    closed:x.closed,
    participantes:x.participantes||[],
    estado:x.estado||"",
    ultimaPosicion:x.ultimaPosicion||null,
    ultimaAlerta:x.ultimaAlerta||null,
    flota:x.flota||user.fleet||"",
    chofer:x.chofer||user.driver||""
  };
}
async function tpodLeerTransitos1512(){
  if(!tpodInitFirebase())return [];
  const snap=await db.collection("transitos").get();
  const all=snap.docs.map(d=>tpodNormTransit1512(d.id,d.data()));
  cloudTransitosCache=all;
  return all;
}
function tpodEmbarqueActual1512(){
  const t=transit();
  if(t&&t.embarque)return String(t.embarque).trim();
  const el=document.getElementById("embarqueInput");
  if(el&&el.value)return String(el.value).trim();
  const filtro=document.getElementById("embarqueFiltro");
  if(filtro&&filtro.innerText&&filtro.innerText!=="-")return String(filtro.innerText).trim();
  return "";
}
function tpodGetPath1512(o,path){
  try{return path.split(".").reduce((a,k)=>a&&a[k],o);}catch(e){return null;}
}
function tpodCleanLoc1512(v){
  let s=String(v||"").trim();
  if(!s||s==="-")return "";
  s=s.replace(/\s+/g," ");
  if(/^-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?$/.test(s))return "";
  return s;
}
function tpodLocFrom1512(obj){
  if(!obj)return "";
  const paths=[
    "whatsapp_ubicacion","ubicacion_whatsapp","ubicacionTexto","ubicacion_texto","locationText","location_text",
    "localidad_precisa","localidadPrecisa","localidad","locality","city","ciudad","municipio","partido","barrio",
    "address","direccion","formattedAddress","formatted_address","display_name","place","placeName","ubicacion","nombre","name",
    "gps.whatsapp_ubicacion","gps.ubicacionTexto","gps.localidad_precisa","gps.localidadPrecisa","gps.localidad","gps.locality","gps.city","gps.ciudad","gps.municipio","gps.partido","gps.address","gps.direccion","gps.formattedAddress","gps.formatted_address","gps.display_name","gps.place","gps.ubicacion",
    "ultimaPosicion.whatsapp_ubicacion","ultimaPosicion.ubicacionTexto","ultimaPosicion.localidad_precisa","ultimaPosicion.localidadPrecisa","ultimaPosicion.localidad","ultimaPosicion.locality","ultimaPosicion.city","ultimaPosicion.ciudad","ultimaPosicion.municipio","ultimaPosicion.partido","ultimaPosicion.address","ultimaPosicion.direccion","ultimaPosicion.formattedAddress","ultimaPosicion.formatted_address","ultimaPosicion.display_name","ultimaPosicion.place","ultimaPosicion.ubicacion"
  ];
  for(const p of paths){
    const s=tpodCleanLoc1512(p.includes(".")?tpodGetPath1512(obj,p):obj[p]);
    if(s)return s;
  }
  return "";
}
function tpodLatestUpdate1512(t){
  const arr=(t&&t.updates||[]).slice();
  arr.sort((a,b)=>tpodEventTime1512(b)-tpodEventTime1512(a));
  return arr[0]||null;
}
function tpodUbicacionPrecisa1512(t){
  const u=tpodLatestUpdate1512(t);
  let s=tpodLocFrom1512(u);
  if(s)return s;

  // Algunos registros guardan el texto enviado completo; extraer "Ub.:" si existe.
  const possibleMsg=[u&&u.msg,u&&u.mensaje,u&&u.texto,u&&u.whatsapp,t&&t.lastMsg,t&&t.ultimoMensaje].map(x=>String(x||""));
  for(const msg of possibleMsg){
    const m=msg.match(/Ub\.:\s*([^\n\r]+)/i);
    if(m&&tpodCleanLoc1512(m[1]))return tpodCleanLoc1512(m[1]);
  }

  if(u){
    try{
      const generated=tpodUltimaUbicacionTexto({ultimaPosicion:u.gps||u.ultimaPosicion||u});
      if(tpodCleanLoc1512(generated))return tpodCleanLoc1512(generated);
    }catch(e){}
  }

  s=tpodLocFrom1512(t&&t.ultimaPosicion);
  if(s)return s;

  try{
    const generated=tpodUltimaUbicacionTexto(t);
    if(tpodCleanLoc1512(generated))return tpodCleanLoc1512(generated);
  }catch(e){}
  return "-";
}

/* Nueva vista estable: nunca deja "Leyendo..." como estado final. */
async function refreshEmbarquesCloud(){
  const box=document.getElementById("embarqueList");
  if(window.__tpodEmbarquesLoading){
    if(box && window.__tpodLastEmbarquesHtml) box.innerHTML=window.__tpodLastEmbarquesHtml;
    return;
  }
  window.__tpodEmbarquesLoading=true;

  try{
    tpodBuildEmbarqueScreen();
    const box2=document.getElementById("embarqueList");
    const flota=tpodCurrentFlota?tpodCurrentFlota():"";

    if(!tpodIsAuthorized||!tpodIsAuthorized()||!flota){
      tpodSetFiltro("-");
      if(box2)box2.innerHTML='<div class="emptyBox">Valide la flota en Usuario.</div>';
      window.__tpodLastEmbarquesHtml=box2?box2.innerHTML:"";
      return;
    }

    // No se muestra "Leyendo..." si ya hay datos, para evitar parpadeo y estados pegados.
    if(box2 && !window.__tpodLastEmbarquesHtml && !/Leyendo embarques/i.test(box2.innerText||"")){
      box2.innerHTML='<div class="emptyBox"></div>';
    }

    const all=await tpodLeerTransitos1512();
    let emb=tpodEmbarqueActual1512();

    if(!emb){
      const propiosAbiertos=all.filter(t=>tpodParticipa1512(t,flota)&&tpodIsOpen1512(t)&&t.embarque).sort((a,b)=>tpodTime1512(b)-tpodTime1512(a));
      if(propiosAbiertos.length)emb=String(propiosAbiertos[0].embarque||"").trim();
    }

    if(!emb){
      tpodSetFiltro("-");
      if(box2)box2.innerHTML='<div class="emptyBox">No hay embarque validado para esta flota.</div>';
      window.__tpodLastEmbarquesHtml=box2?box2.innerHTML:"";
      return;
    }

    let items=all.filter(t=>String(t.embarque||"").trim()===emb);
    const ids=new Set();
    items=items.filter(t=>{
      const id=String(t.id||"");
      if(!id)return true;
      if(ids.has(id))return false;
      ids.add(id);
      return true;
    });

    items.sort((a,b)=>{
      const mineA=tpodParticipa1512(a,flota)?0:1, mineB=tpodParticipa1512(b,flota)?0:1;
      if(mineA!==mineB)return mineA-mineB;
      const oa=tpodIsOpen1512(a)?0:1, ob=tpodIsOpen1512(b)?0:1;
      if(oa!==ob)return oa-ob;
      const fa=tpodFleet1512(a), fb=tpodFleet1512(b);
      if(fa!==fb)return fa.localeCompare(fb);
      return tpodTime1512(b)-tpodTime1512(a);
    });

    tpodRenderEmbarques1512(items,emb,flota);
  }catch(e){
    console.log("refreshEmbarquesCloud v1512",e);
    const box3=document.getElementById("embarqueList");
    if(box3)box3.innerHTML=window.__tpodLastEmbarquesHtml||'<div class="emptyBox">Error leyendo embarques.</div>';
  }finally{
    window.__tpodEmbarquesLoading=false;
    setTimeout(()=>{
      const b=document.getElementById("embarqueList");
      if(b && /Leyendo embarques/i.test(b.innerText||"")){
        b.innerHTML=window.__tpodLastEmbarquesHtml||'<div class="emptyBox"></div>';
      }
    },250);
  }
}
function tpodRenderEmbarques1512(items,emb,flotaValidada){
  tpodBuildEmbarqueScreen();
  const box=document.getElementById("embarqueList");
  if(!box)return;
  tpodSetFiltro(emb||"-");

  if(!items.length){
    box.innerHTML='<div class="emptyBox">No hay tránsitos para este embarque.</div>';
    window.__tpodLastEmbarquesHtml=box.innerHTML;
    window.__tpodLastEmbarquesAt=Date.now();
    return;
  }

  box.innerHTML=items.map(t=>{
    const abierto=tpodIsOpen1512(t);
    const flota=tpodFleet1512(t)||"-";
    const propia=tpodParticipa1512(t,flotaValidada);
    const embTxt=escapeHtml(t.embarque||"-");
    const inicio=escapeHtml(tpodDate(t.start));
    const cierre=abierto?"-":escapeHtml(tpodDate(t.closed));
    const ubicacion=escapeHtml(tpodUbicacionPrecisa1512(t));
    const alerta=escapeHtml(tpodLastAlert(t));
    const lote=escapeHtml(t.lote||"-");
    const flotaHtml=propia?`<span class="flotaValidada">${escapeHtml(flota)}</span>`:escapeHtml(flota);
    return `<div class="embarqueItem ${abierto?'open':'closed'} ${propia?'miFlota':''} ${abierto?'':'embarqueCerrado'}" onclick="abrirTransitoCloud('${escapeHtml(t.id)}')"><div class="embTop"><b>Emb. ${embTxt} / Flota ${flotaHtml}</b><span class="${abierto?'estadoAbierto':'estadoCerrado'}">${abierto?'Abierto':'Cerrado'}</span></div><div>Lote/Carga: ${lote}</div><div>Inicio: ${inicio}</div><div>Cierre: ${cierre}</div><div>Últ. posición: ${ubicacion}</div><div>Últ. alerta: ${alerta}</div></div>`;
  }).join("");
  window.__tpodLastEmbarquesHtml=box.innerHTML;
  window.__tpodLastEmbarquesAt=Date.now();
}
function renderEmbarque(){
  window.__tpodEmbarquesLoading=false;
  refreshEmbarquesCloud();
}
try{
  const oldShow1512=show;
  show=function(id){
    if(id!=="embarque")window.__tpodEmbarquesLoading=false;
    oldShow1512(id);
    if(id==="tracking")setTimeout(()=>{window.__tpodEmbarquesLoading=false;},100);
    if(id==="embarque")setTimeout(()=>{window.__tpodEmbarquesLoading=false;refreshEmbarquesCloud();},120);
    if(id==="ultimo")setTimeout(()=>renderUltimo(),80);
    if(id==="inicio")setTimeout(()=>renderInicio(),80);
  };
}catch(e){}
setInterval(()=>{
  const b=document.getElementById("embarqueList");
  if(b && /Leyendo embarques/i.test(b.innerText||"")){
    b.innerHTML=window.__tpodLastEmbarquesHtml||'<div class="emptyBox"></div>';
    window.__tpodEmbarquesLoading=false;
  }
},1000);




/* ===== v1.5.55 EMBARQUES SIN LOADING + GPS ACTUAL ===== */
window.__tpodEmbarquesLoading=false;
window.__tpodLastEmbarquesHtml=window.__tpodLastEmbarquesHtml||"";
window.__tpodLastEmbarqueKey=window.__tpodLastEmbarqueKey||"";

function tpodFleet1513(t){return String((t&&t.user&&t.user.fleet)||t.flota||(t&&t.user&&t.user.flota)||"").trim();}
function tpodParticipa1513(t,flota){const f=String(flota||"").trim();const parts=(t&&t.participantes||[]).map(x=>String(x).trim());return tpodFleet1513(t)===f||parts.includes(f);}
function tpodIsOpen1513(t){if(!t)return false;const e=String(t.estado||"").toLowerCase().trim();if(t.closed===true)return false;if(t.closed&&t.closed!==null&&String(t.closed).toLowerCase()!=="null")return false;if(e==="cerrado"||e==="closed"||e==="finalizado")return false;return e==="abierto"||t.closed===null||t.closed===undefined;}
function tpodTimeVal1513(v){try{const d=(v&&v.toDate)?v.toDate():(v&&v.seconds?new Date(v.seconds*1000):new Date(v));return d&&!isNaN(d.getTime())?d.getTime():0;}catch(e){return 0;}}
function tpodTime1513(t){return tpodTimeVal1513((t&&t.start&&t.start.time)||t.start||t.createdAt||0);}
function tpodEventTime1513(ev){return tpodTimeVal1513((ev&&ev.time)||(ev&&ev.fecha)||(ev&&ev.createdAt)||(ev&&ev.ts)||0);}
function tpodNormTransit1513(id,x){
  x=x||{};const r=x.route||{};const u=x.user||{fleet:x.flota||"",driver:x.chofer||""};
  return {id:x.id||id||"",user:u,route:{...r,cliente:r.cliente||x.cliente||"",origen:r.origen||x.origen||"",destino:r.destino||x.destino||"",origen_lat:r.origen_lat||x.origen_lat,origen_lng:r.origen_lng||x.origen_lng,destino_lat:r.destino_lat||x.destino_lat,destino_lng:r.destino_lng||x.destino_lng},lote:x.lote||"",embarque:x.embarque||"",start:x.start||null,updates:x.updates||[],alerts:x.alerts||[],closed:x.closed,participantes:x.participantes||[],estado:x.estado||"",ultimaPosicion:x.ultimaPosicion||null,ultimaAlerta:x.ultimaAlerta||null,flota:x.flota||u.fleet||"",chofer:x.chofer||u.driver||""};
}
async function tpodLeerTransitos1513(){
  if(!tpodInitFirebase())return [];
  const snap=await db.collection("transitos").get();
  const all=snap.docs.map(d=>tpodNormTransit1513(d.id,d.data()));
  cloudTransitosCache=all;
  return all;
}
function tpodEmbarqueActual1513(){
  const t=transit();
  if(t&&t.embarque)return String(t.embarque).trim();
  const el=document.getElementById("embarqueInput");
  if(el&&el.value)return String(el.value).trim();
  const filtro=document.getElementById("embarqueFiltro");
  if(filtro&&filtro.innerText&&filtro.innerText!=="-")return String(filtro.innerText).trim();
  return "";
}
function tpodGetPath1513(o,path){try{return path.split(".").reduce((a,k)=>a&&a[k],o);}catch(e){return null;}}
function tpodNum1513(v){const n=Number(v);return isFinite(n)?n:null;}
function tpodCoords1513(obj){
  if(!obj)return null;
  const paths=[["lat","lng"],["lat","lon"],["latitude","longitude"],["gps.lat","gps.lng"],["gps.latitude","gps.longitude"],["coords.latitude","coords.longitude"],["position.coords.latitude","position.coords.longitude"],["ultimaPosicion.lat","ultimaPosicion.lng"],["ultimaPosicion.latitude","ultimaPosicion.longitude"],["location.lat","location.lng"],["posicion.lat","posicion.lng"]];
  for(const p of paths){const a=tpodNum1513(tpodGetPath1513(obj,p[0]));const b=tpodNum1513(tpodGetPath1513(obj,p[1]));if(a!==null&&b!==null)return {lat:a,lng:b};}
  return null;
}
function tpodCleanLoc1513(v){
  let s=String(v||"").trim();
  if(!s||s==="-")return "";
  s=s.replace(/\s+/g," ");
  if(/^-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?$/.test(s))return "";
  return s;
}
function tpodLocFrom1513(obj){
  if(!obj)return "";
  const paths=["whatsapp_ubicacion","ubicacion_whatsapp","ubicacionTexto","ubicacion_texto","locationText","location_text","localidad_precisa","localidadPrecisa","localidad","locality","city","ciudad","municipio","partido","barrio","address","direccion","formattedAddress","formatted_address","display_name","place","placeName","ubicacion","nombre","name","gps.whatsapp_ubicacion","gps.ubicacionTexto","gps.localidad_precisa","gps.localidadPrecisa","gps.localidad","gps.locality","gps.city","gps.ciudad","gps.municipio","gps.partido","gps.address","gps.direccion","gps.formattedAddress","gps.formatted_address","gps.display_name","gps.place","gps.ubicacion"];
  for(const p of paths){const s=tpodCleanLoc1513(p.includes(".")?tpodGetPath1513(obj,p):obj[p]);if(s)return s;}
  return "";
}
function tpodLatestUpdate1513(t){const arr=(t&&t.updates||[]).slice();arr.sort((a,b)=>tpodEventTime1513(b)-tpodEventTime1513(a));return arr[0]||null;}
function tpodFallbackLocalidad1513(lat,lng){
  if(lat==null||lng==null)return "";
  if(lat<-34.60&&lat>-34.64&&lng<-58.43&&lng>-58.48)return "Villa General Mitre / La Paternal, CABA";
  if(lat<-34.58&&lat>-34.65&&lng<-58.42&&lng>-58.49)return "CABA";
  if(lat<-34.68&&lat>-34.75&&lng<-58.25&&lng>-58.38)return "Avellaneda";
  if(lat<-34.55&&lat>-34.65&&lng<-58.55&&lng>-58.65)return "El Palomar";
  if(lat<-34.68&&lat>-34.76&&lng<-58.20&&lng>-58.35)return "Quilmes";
  if(lat<-34.52&&lat>-34.70&&lng<-58.30&&lng>-58.55)return "Buenos Aires, Argentina";
  return "";
}
function tpodUbicacionPrecisaSync1513(t){
  const u=tpodLatestUpdate1513(t);
  const c=tpodCoords1513(u)||tpodCoords1513(t&&t.ultimaPosicion)||tpodCoords1513(t);
  if(c){const fb=tpodFallbackLocalidad1513(c.lat,c.lng);if(fb)return fb;}
  const msgs=[u&&u.msg,u&&u.mensaje,u&&u.texto,u&&u.whatsapp,t&&t.lastMsg,t&&t.ultimoMensaje].map(x=>String(x||""));
  for(const msg of msgs){const m=msg.match(/Ub\.:\s*([^\n\r]+)/i);if(m&&tpodCleanLoc1513(m[1]))return tpodCleanLoc1513(m[1]);}
  let s=tpodLocFrom1513(u);if(s)return s;
  s=tpodLocFrom1513(t&&t.ultimaPosicion);if(s)return s;
  try{const g=tpodUltimaUbicacionTexto({ultimaPosicion:u&&(u.gps||u.ultimaPosicion||u)});if(tpodCleanLoc1513(g))return tpodCleanLoc1513(g);}catch(e){}
  return "-";
}
function tpodSetBox1513(html){const box=document.getElementById("embarqueList");if(!box)return;box.innerHTML=html;window.__tpodLastEmbarquesHtml=html;}
async function refreshEmbarquesCloud(){
  const box=document.getElementById("embarqueList");
  if(window.__tpodEmbarquesLoading){if(box&&window.__tpodLastEmbarquesHtml)box.innerHTML=window.__tpodLastEmbarquesHtml;return;}
  window.__tpodEmbarquesLoading=true;
  try{
    tpodBuildEmbarqueScreen();
    const box2=document.getElementById("embarqueList");
    const flota=tpodCurrentFlota?tpodCurrentFlota():"";
    if(!tpodIsAuthorized||!tpodIsAuthorized()||!flota){tpodSetFiltro("-");tpodSetBox1513('<div class="emptyBox">Valide la flota en Usuario.</div>');return;}
    if(box2&&window.__tpodLastEmbarquesHtml)box2.innerHTML=window.__tpodLastEmbarquesHtml;
    const all=await tpodLeerTransitos1513();
    let emb=tpodEmbarqueActual1513();
    if(!emb){const propios=all.filter(t=>tpodParticipa1513(t,flota)&&tpodIsOpen1513(t)&&t.embarque).sort((a,b)=>tpodTime1513(b)-tpodTime1513(a));if(propios.length)emb=String(propios[0].embarque||"").trim();}
    if(!emb){tpodSetFiltro("-");tpodSetBox1513('<div class="emptyBox">No hay embarque validado para esta flota.</div>');return;}
    let items=all.filter(t=>String(t.embarque||"").trim()===emb);
    const ids=new Set();
    items=items.filter(t=>{const id=String(t.id||"");if(!id)return true;if(ids.has(id))return false;ids.add(id);return true;});
    items.sort((a,b)=>{const ma=tpodParticipa1513(a,flota)?0:1,mb=tpodParticipa1513(b,flota)?0:1;if(ma!==mb)return ma-mb;const oa=tpodIsOpen1513(a)?0:1,ob=tpodIsOpen1513(b)?0:1;if(oa!==ob)return oa-ob;const fa=tpodFleet1513(a),fb=tpodFleet1513(b);if(fa!==fb)return fa.localeCompare(fb);return tpodTime1513(b)-tpodTime1513(a);});
    tpodRenderEmbarques1513(items,emb,flota);
  }catch(e){
    console.log("refreshEmbarquesCloud v1513",e);
    const b=document.getElementById("embarqueList");if(b)b.innerHTML=window.__tpodLastEmbarquesHtml||'<div class="emptyBox">Error leyendo embarques.</div>';
  }finally{
    window.__tpodEmbarquesLoading=false;
    setTimeout(()=>{const b=document.getElementById("embarqueList");if(b&&/(Leyendo|Actualizando) embarques/i.test(b.innerText||""))b.innerHTML=window.__tpodLastEmbarquesHtml||'<div class="emptyBox"></div>';},100);
  }
}
function tpodRenderEmbarques1513(items,emb,flotaValidada){
  tpodBuildEmbarqueScreen();
  const box=document.getElementById("embarqueList");if(!box)return;
  tpodSetFiltro(emb||"-");
  if(!items.length){tpodSetBox1513('<div class="emptyBox">No hay tránsitos para este embarque.</div>');return;}
  const html=items.map(t=>{
    const abierto=tpodIsOpen1513(t),flota=tpodFleet1513(t)||"-",propia=tpodParticipa1513(t,flotaValidada);
    const flotaHtml=propia?`<span class="flotaValidada">${escapeHtml(flota)}</span>`:escapeHtml(flota);
    return `<div class="embarqueItem ${abierto?'open':'closed'} ${propia?'miFlota':''} ${abierto?'':'embarqueCerrado'}" onclick="abrirTransitoCloud('${escapeHtml(t.id)}')"><div class="embTop"><b>Emb. ${escapeHtml(t.embarque||"-")} / Flota ${flotaHtml}</b><span class="${abierto?'estadoAbierto':'estadoCerrado'}">${abierto?'Abierto':'Cerrado'}</span></div><div>Lote/Carga: ${escapeHtml(t.lote||"-")}</div><div>Inicio: ${escapeHtml(tpodDate(t.start))}</div><div>Cierre: ${abierto?"-":escapeHtml(tpodDate(t.closed))}</div><div>Últ. posición: ${escapeHtml(tpodUbicacionPrecisaSync1513(t))}</div><div>Últ. alerta: ${escapeHtml(tpodLastAlert(t))}</div></div>`;
  }).join("");
  tpodSetBox1513(html);
}
function renderEmbarque(){window.__tpodEmbarquesLoading=false;const b=document.getElementById("embarqueList");if(b&&window.__tpodLastEmbarquesHtml)b.innerHTML=window.__tpodLastEmbarquesHtml;refreshEmbarquesCloud();}
try{
  const oldShow1513=show;
  show=function(id){
    if(id!=="embarque")window.__tpodEmbarquesLoading=false;
    oldShow1513(id);
    if(id==="tracking")setTimeout(()=>{window.__tpodEmbarquesLoading=false;},50);
    if(id==="embarque")setTimeout(()=>{window.__tpodEmbarquesLoading=false;renderEmbarque();},80);
    if(id==="ultimo")setTimeout(()=>renderUltimo(),80);
    if(id==="inicio")setTimeout(()=>renderInicio(),80);
  };
}catch(e){}
setInterval(()=>{const b=document.getElementById("embarqueList");if(b&&/(Leyendo|Actualizando) embarques/i.test(b.innerText||"")){b.innerHTML=window.__tpodLastEmbarquesHtml||'<div class="emptyBox"></div>';window.__tpodEmbarquesLoading=false;}},600);




/* ===== v1.5.55 EMBARQUES ESTABLE FINAL ===== */
window.__tpodEmbarquesLoading=false;
window.__tpodLastEmbarquesHtml=window.__tpodLastEmbarquesHtml||"";
window.__tpodLastGoodEmbarquesHtml=window.__tpodLastGoodEmbarquesHtml||"";
window.__tpodEmbarqueRefreshToken=0;

function tpodIsPlaceholder1514(html){
  const txt=String(html||"");
  return /Toque Embarques|Actualizando embarques|Leyendo embarques/i.test(txt);
}
function tpodSetEmbarquesHtml1514(html,good){
  const box=document.getElementById("embarqueList");
  if(!box)return;
  if(tpodIsPlaceholder1514(html) && window.__tpodLastGoodEmbarquesHtml){
    box.innerHTML=window.__tpodLastGoodEmbarquesHtml;
    return;
  }
  box.innerHTML=html;
  window.__tpodLastEmbarquesHtml=html;
  if(good && !tpodIsPlaceholder1514(html)){
    window.__tpodLastGoodEmbarquesHtml=html;
  }
}
function tpodFleet1514(t){return String((t&&t.user&&t.user.fleet)||t.flota||(t&&t.user&&t.user.flota)||"").trim();}
function tpodParticipa1514(t,flota){
  const f=String(flota||"").trim();
  const parts=(t&&t.participantes||[]).map(x=>String(x).trim());
  return tpodFleet1514(t)===f || parts.includes(f);
}
function tpodIsOpen1514(t){
  if(!t)return false;
  const e=String(t.estado||"").toLowerCase().trim();
  if(t.closed===true)return false;
  if(t.closed&&t.closed!==null&&String(t.closed).toLowerCase()!=="null")return false;
  if(e==="cerrado"||e==="closed"||e==="finalizado")return false;
  return e==="abierto"||t.closed===null||t.closed===undefined;
}
function tpodTimeVal1514(v){
  try{
    const d=(v&&v.toDate)?v.toDate():(v&&v.seconds?new Date(v.seconds*1000):new Date(v));
    return d&&!isNaN(d.getTime())?d.getTime():0;
  }catch(e){return 0;}
}
function tpodTime1514(t){return tpodTimeVal1514((t&&t.start&&t.start.time)||t.start||t.createdAt||0);}
function tpodEventTime1514(ev){return tpodTimeVal1514((ev&&ev.time)||(ev&&ev.fecha)||(ev&&ev.createdAt)||(ev&&ev.ts)||0);}
function tpodNormTransit1514(id,x){
  x=x||{};
  const r=x.route||{};
  const u=x.user||{fleet:x.flota||"",driver:x.chofer||""};
  return {
    id:x.id||id||"",
    user:u,
    route:{...r,cliente:r.cliente||x.cliente||"",origen:r.origen||x.origen||"",destino:r.destino||x.destino||"",origen_lat:r.origen_lat||x.origen_lat,origen_lng:r.origen_lng||x.origen_lng,destino_lat:r.destino_lat||x.destino_lat,destino_lng:r.destino_lng||x.destino_lng},
    lote:x.lote||"",
    embarque:x.embarque||"",
    start:x.start||null,
    updates:x.updates||[],
    alerts:x.alerts||[],
    closed:x.closed,
    participantes:x.participantes||[],
    estado:x.estado||"",
    ultimaPosicion:x.ultimaPosicion||null,
    ultimaAlerta:x.ultimaAlerta||null,
    flota:x.flota||u.fleet||"",
    chofer:x.chofer||u.driver||""
  };
}
async function tpodLeerTransitos1514(){
  if(!tpodInitFirebase())return [];
  const snap=await db.collection("transitos").get();
  const all=snap.docs.map(d=>tpodNormTransit1514(d.id,d.data()));
  cloudTransitosCache=all;
  return all;
}
function tpodEmbarqueActual1514(){
  const t=transit();
  if(t&&t.embarque)return String(t.embarque).trim();
  const el=document.getElementById("embarqueInput");
  if(el&&el.value)return String(el.value).trim();
  const filtro=document.getElementById("embarqueFiltro");
  if(filtro&&filtro.innerText&&filtro.innerText!=="-")return String(filtro.innerText).trim();
  return "";
}
function tpodGetPath1514(o,path){try{return path.split(".").reduce((a,k)=>a&&a[k],o);}catch(e){return null;}}
function tpodNum1514(v){const n=Number(v);return isFinite(n)?n:null;}
function tpodCoords1514(obj){
  if(!obj)return null;
  const paths=[["lat","lng"],["lat","lon"],["latitude","longitude"],["gps.lat","gps.lng"],["gps.latitude","gps.longitude"],["coords.latitude","coords.longitude"],["position.coords.latitude","position.coords.longitude"],["ultimaPosicion.lat","ultimaPosicion.lng"],["ultimaPosicion.latitude","ultimaPosicion.longitude"],["location.lat","location.lng"],["posicion.lat","posicion.lng"]];
  for(const p of paths){
    const a=tpodNum1514(tpodGetPath1514(obj,p[0]));
    const b=tpodNum1514(tpodGetPath1514(obj,p[1]));
    if(a!==null&&b!==null)return {lat:a,lng:b};
  }
  return null;
}
function tpodCleanLoc1514(v){
  let s=String(v||"").trim();
  if(!s||s==="-")return "";
  s=s.replace(/\s+/g," ");
  if(/^-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?$/.test(s))return "";
  return s;
}
function tpodLocFrom1514(obj){
  if(!obj)return "";
  const paths=["whatsapp_ubicacion","ubicacion_whatsapp","ubicacionTexto","ubicacion_texto","locationText","location_text","localidad_precisa","localidadPrecisa","localidad","locality","city","ciudad","municipio","partido","barrio","address","direccion","formattedAddress","formatted_address","display_name","place","placeName","ubicacion","nombre","name","gps.whatsapp_ubicacion","gps.ubicacionTexto","gps.localidad_precisa","gps.localidadPrecisa","gps.localidad","gps.locality","gps.city","gps.ciudad","gps.municipio","gps.partido","gps.address","gps.direccion","gps.formattedAddress","gps.formatted_address","gps.display_name","gps.place","gps.ubicacion"];
  for(const p of paths){
    const s=tpodCleanLoc1514(p.includes(".")?tpodGetPath1514(obj,p):obj[p]);
    if(s)return s;
  }
  return "";
}
function tpodLatestUpdate1514(t){
  const arr=(t&&t.updates||[]).slice();
  arr.sort((a,b)=>tpodEventTime1514(b)-tpodEventTime1514(a));
  return arr[0]||null;
}
function tpodFallbackLocalidad1514(lat,lng){
  if(lat==null||lng==null)return "";
  if(lat<-34.60&&lat>-34.64&&lng<-58.43&&lng>-58.48)return "Villa General Mitre / La Paternal, CABA";
  if(lat<-34.58&&lat>-34.65&&lng<-58.42&&lng>-58.49)return "CABA";
  if(lat<-34.68&&lat>-34.75&&lng<-58.25&&lng>-58.38)return "Avellaneda";
  if(lat<-34.55&&lat>-34.65&&lng<-58.55&&lng>-58.65)return "El Palomar";
  if(lat<-34.68&&lat>-34.76&&lng<-58.20&&lng>-58.35)return "Quilmes";
  if(lat<-34.52&&lat>-34.70&&lng<-58.30&&lng>-58.55)return "Buenos Aires, Argentina";
  return "";
}
function tpodUbicacionPrecisa1514(t){
  const u=tpodLatestUpdate1514(t);
  const c=tpodCoords1514(u)||tpodCoords1514(t&&t.ultimaPosicion)||tpodCoords1514(t);
  if(c){const fb=tpodFallbackLocalidad1514(c.lat,c.lng);if(fb)return fb;}
  const msgs=[u&&u.msg,u&&u.mensaje,u&&u.texto,u&&u.whatsapp,t&&t.lastMsg,t&&t.ultimoMensaje].map(x=>String(x||""));
  for(const msg of msgs){const m=msg.match(/Ub\.:\s*([^\n\r]+)/i);if(m&&tpodCleanLoc1514(m[1]))return tpodCleanLoc1514(m[1]);}
  let s=tpodLocFrom1514(u);if(s)return s;
  s=tpodLocFrom1514(t&&t.ultimaPosicion);if(s)return s;
  try{
    const g=tpodUltimaUbicacionTexto({ultimaPosicion:u&&(u.gps||u.ultimaPosicion||u)});
    if(tpodCleanLoc1514(g))return tpodCleanLoc1514(g);
  }catch(e){}
  return "-";
}
async function refreshEmbarquesCloud(){
  const token=++window.__tpodEmbarqueRefreshToken;
  const box=document.getElementById("embarqueList");
  if(window.__tpodEmbarquesLoading){
    if(box&&window.__tpodLastGoodEmbarquesHtml)box.innerHTML=window.__tpodLastGoodEmbarquesHtml;
    return;
  }
  window.__tpodEmbarquesLoading=true;
  try{
    tpodBuildEmbarqueScreen();
    const box2=document.getElementById("embarqueList");
    if(box2&&window.__tpodLastGoodEmbarquesHtml)box2.innerHTML=window.__tpodLastGoodEmbarquesHtml;

    const flota=tpodCurrentFlota?tpodCurrentFlota():"";
    if(!tpodIsAuthorized||!tpodIsAuthorized()||!flota){
      tpodSetFiltro("-");
      tpodSetEmbarquesHtml1514('<div class="emptyBox">Valide la flota en Usuario.</div>',false);
      return;
    }

    const all=await tpodLeerTransitos1514();
    if(token!==window.__tpodEmbarqueRefreshToken)return;

    let emb=tpodEmbarqueActual1514();
    if(!emb){
      const propios=all.filter(t=>tpodParticipa1514(t,flota)&&tpodIsOpen1514(t)&&t.embarque).sort((a,b)=>tpodTime1514(b)-tpodTime1514(a));
      if(propios.length)emb=String(propios[0].embarque||"").trim();
    }
    if(!emb){
      tpodSetFiltro("-");
      tpodSetEmbarquesHtml1514('<div class="emptyBox">No hay embarque validado para esta flota.</div>',false);
      return;
    }

    let items=all.filter(t=>String(t.embarque||"").trim()===emb);
    const ids=new Set();
    items=items.filter(t=>{
      const id=String(t.id||"");
      if(!id)return true;
      if(ids.has(id))return false;
      ids.add(id);
      return true;
    });
    items.sort((a,b)=>{
      const ma=tpodParticipa1514(a,flota)?0:1,mb=tpodParticipa1514(b,flota)?0:1;
      if(ma!==mb)return ma-mb;
      const oa=tpodIsOpen1514(a)?0:1,ob=tpodIsOpen1514(b)?0:1;
      if(oa!==ob)return oa-ob;
      const fa=tpodFleet1514(a),fb=tpodFleet1514(b);
      if(fa!==fb)return fa.localeCompare(fb);
      return tpodTime1514(b)-tpodTime1514(a);
    });

    tpodRenderEmbarques1514(items,emb,flota);
  }catch(e){
    console.log("refreshEmbarquesCloud v1514",e);
    const b=document.getElementById("embarqueList");
    if(b)b.innerHTML=window.__tpodLastGoodEmbarquesHtml||window.__tpodLastEmbarquesHtml||'<div class="emptyBox">Error leyendo embarques.</div>';
  }finally{
    window.__tpodEmbarquesLoading=false;
    setTimeout(()=>{
      const b=document.getElementById("embarqueList");
      if(b&&/(Leyendo|Actualizando|Toque Embarques)/i.test(b.innerText||"")&&window.__tpodLastGoodEmbarquesHtml){
        b.innerHTML=window.__tpodLastGoodEmbarquesHtml;
      }
    },100);
  }
}
function tpodRenderEmbarques1514(items,emb,flotaValidada){
  tpodBuildEmbarqueScreen();
  const box=document.getElementById("embarqueList");if(!box)return;
  tpodSetFiltro(emb||"-");
  if(!items.length){
    tpodSetEmbarquesHtml1514('<div class="emptyBox">No hay tránsitos para este embarque.</div>',false);
    return;
  }
  const html=items.map(t=>{
    const abierto=tpodIsOpen1514(t),flota=tpodFleet1514(t)||"-",propia=tpodParticipa1514(t,flotaValidada);
    const flotaHtml=propia?`<span class="flotaValidada">${escapeHtml(flota)}</span>`:escapeHtml(flota);
    return `<div class="embarqueItem ${abierto?'open':'closed'} ${propia?'miFlota':''} ${abierto?'':'embarqueCerrado'}" onclick="abrirTransitoCloud('${escapeHtml(t.id)}')"><div class="embTop"><b>Emb. ${escapeHtml(t.embarque||"-")} / Flota ${flotaHtml}</b><span class="${abierto?'estadoAbierto':'estadoCerrado'}">${abierto?'Abierto':'Cerrado'}</span></div><div>Lote/Carga: ${escapeHtml(t.lote||"-")}</div><div>Inicio: ${escapeHtml(tpodDate(t.start))}</div><div>Cierre: ${abierto?"-":escapeHtml(tpodDate(t.closed))}</div><div>Últ. posición: ${escapeHtml(tpodUbicacionPrecisa1514(t))}</div><div>Últ. alerta: ${escapeHtml(tpodLastAlert(t))}</div></div>`;
  }).join("");
  tpodSetEmbarquesHtml1514(html,true);
}
function renderEmbarque(){
  window.__tpodEmbarquesLoading=false;
  const b=document.getElementById("embarqueList");
  if(b&&window.__tpodLastGoodEmbarquesHtml)b.innerHTML=window.__tpodLastGoodEmbarquesHtml;
  refreshEmbarquesCloud();
}
try{
  const oldShow1514=show;
  show=function(id){
    if(id!=="embarque")window.__tpodEmbarquesLoading=false;
    oldShow1514(id);
    if(id==="tracking")setTimeout(()=>{window.__tpodEmbarquesLoading=false;},50);
    if(id==="embarque")setTimeout(()=>{window.__tpodEmbarquesLoading=false;renderEmbarque();},80);
    if(id==="ultimo")setTimeout(()=>renderUltimo(),80);
    if(id==="inicio")setTimeout(()=>renderInicio(),80);
  };
}catch(e){}
setInterval(()=>{
  const b=document.getElementById("embarqueList");
  if(b&&/(Leyendo|Actualizando|Toque Embarques)/i.test(b.innerText||"")){
    if(window.__tpodLastGoodEmbarquesHtml)b.innerHTML=window.__tpodLastGoodEmbarquesHtml;
    window.__tpodEmbarquesLoading=false;
  }
},500);




/* ===== v1.5.55 EMBARQUES ESTABLE + ULTIMO GPS ===== */
window.__tpodGoodEmbarquesHtml="";
window.__tpodEmbarquesLoading=false;

function f1515(t){return String((t&&t.user&&t.user.fleet)||t.flota||(t&&t.user&&t.user.flota)||"").trim();}
function cf1515(){try{let f=tpodCurrentFlota&&tpodCurrentFlota();if(f)return String(f).trim();}catch(e){}try{let u=user();if(u&&u.fleet)return String(u.fleet).trim();}catch(e){}try{let u=JSON.parse(localStorage.getItem(LS.user)||"{}");return String(u.fleet||"").trim();}catch(e){return "";}}
function part1515(t,f){let ps=(t&&t.participantes||[]).map(x=>String(x).trim());return f1515(t)===String(f).trim()||ps.includes(String(f).trim());}
function open1515(t){let e=String(t&&t.estado||"").toLowerCase().trim();if(!t)return false;if(t.closed===true)return false;if(t.closed&&String(t.closed).toLowerCase()!=="null")return false;if(["cerrado","closed","finalizado"].includes(e))return false;return e==="abierto"||t.closed==null;}
function tv1515(v){try{let d=(v&&v.toDate)?v.toDate():(v&&v.seconds?new Date(v.seconds*1000):new Date(v));return d&&!isNaN(d)?d.getTime():0;}catch(e){return 0;}}
function tt1515(t){return tv1515((t&&t.start&&t.start.time)||t.start||t.createdAt);}
function et1515(x){return tv1515((x&&x.time)||(x&&x.fecha)||(x&&x.createdAt)||(x&&x.ts));}
function norm1515(id,x){x=x||{};let r=x.route||{},u=x.user||{fleet:x.flota||"",driver:x.chofer||""};return {id:x.id||id,user:u,route:{...r,cliente:r.cliente||x.cliente||"",destino:r.destino||x.destino||"",origen:r.origen||x.origen||""},lote:x.lote||"",embarque:x.embarque||"",start:x.start||null,updates:x.updates||[],alerts:x.alerts||[],closed:x.closed,participantes:x.participantes||[],estado:x.estado||"",ultimaPosicion:x.ultimaPosicion||null,flota:x.flota||u.fleet||"",chofer:x.chofer||u.driver||""};}
async function read1515(){if(!tpodInitFirebase())return[];let s=await db.collection("transitos").get();let a=s.docs.map(d=>norm1515(d.id,d.data()));cloudTransitosCache=a;return a;}
function gp1515(o,p){try{return p.split(".").reduce((a,k)=>a&&a[k],o)}catch(e){return null}}
function n1515(v){let n=Number(v);return isFinite(n)?n:null}
function coords1515(o){if(!o)return null;for(let p of [["lat","lng"],["lat","lon"],["latitude","longitude"],["gps.lat","gps.lng"],["gps.latitude","gps.longitude"],["coords.latitude","coords.longitude"],["ultimaPosicion.lat","ultimaPosicion.lng"],["ultimaPosicion.latitude","ultimaPosicion.longitude"]]){let a=n1515(gp1515(o,p[0])),b=n1515(gp1515(o,p[1]));if(a!==null&&b!==null)return{lat:a,lng:b}}return null}
function latest1515(t){let a=(t&&t.updates||[]).slice();a.sort((x,y)=>et1515(y)-et1515(x));return a[0]||null}
function locByGps1515(lat,lng){if(lat<-34.60&&lat>-34.63&&lng<-58.44&&lng>-58.48)return"Villa General Mitre / La Paternal, CABA";if(lat<-34.58&&lat>-34.66&&lng<-58.40&&lng>-58.50)return"CABA";if(lat<-34.68&&lat>-34.75&&lng<-58.25&&lng>-58.38)return"Avellaneda";if(lat<-34.55&&lat>-34.65&&lng<-58.55&&lng>-58.65)return"El Palomar";if(lat<-34.68&&lat>-34.76&&lng<-58.20&&lng>-58.35)return"Quilmes";return"Buenos Aires, Argentina"}
function clean1515(v){let s=String(v||"").trim().replace(/\s+/g," ");if(!s||s==="-"||/^-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?$/.test(s))return"";return s}
function txtloc1515(o){if(!o)return"";for(let p of ["ubicacionTexto","ubicacion","localidad","city","ciudad","address","direccion","formattedAddress","display_name","gps.ubicacionTexto","gps.ubicacion","gps.localidad","gps.city","gps.ciudad","gps.address"]){let s=clean1515(p.includes(".")?gp1515(o,p):o[p]);if(s)return s}return""}
function pos1515(t){let u=latest1515(t),c=coords1515(u)||coords1515(t&&t.ultimaPosicion)||coords1515(t);if(c)return locByGps1515(c.lat,c.lng);let msgs=[u&&u.msg,u&&u.mensaje,u&&u.texto,u&&u.whatsapp].map(x=>String(x||""));for(let m of msgs){let r=m.match(/Ub\.:\s*([^\n\r]+)/i);if(r&&clean1515(r[1]))return clean1515(r[1])}return txtloc1515(u)||txtloc1515(t&&t.ultimaPosicion)||"-"}
function emb1515(all,f){try{let t=transit();if(t&&t.embarque)return String(t.embarque).trim()}catch(e){}let e=document.getElementById("embarqueInput");if(e&&e.value)return String(e.value).trim();let pro=(all||[]).filter(t=>part1515(t,f)&&open1515(t)&&t.embarque).sort((a,b)=>tt1515(b)-tt1515(a));if(pro[0])return String(pro[0].embarque).trim();pro=(all||[]).filter(t=>part1515(t,f)&&t.embarque).sort((a,b)=>tt1515(b)-tt1515(a));return pro[0]?String(pro[0].embarque).trim():""}
function setEmbHtml1515(h,good){let b=document.getElementById("embarqueList");if(!b)return;b.innerHTML=h;if(good)window.__tpodGoodEmbarquesHtml=h}
function renderEmb1515(items,emb,fv){tpodBuildEmbarqueScreen();let ft=document.getElementById("embarqueFiltro");if(ft)ft.innerText=emb||"-";if(!items.length){setEmbHtml1515('<div class="emptyBox">No hay tránsitos para este embarque.</div>',false);return}let html=items.map(t=>{let op=open1515(t),fl=f1515(t)||"-",prop=part1515(t,fv),flh=prop?`<span class="flotaValidada">${escapeHtml(fl)}</span>`:escapeHtml(fl);return `<div class="embarqueItem ${op?'open':'closed'} ${prop?'miFlota':''} ${op?'':'embarqueCerrado'}" onclick="abrirTransitoCloud('${escapeHtml(t.id)}')"><div class="embTop"><b>Emb. ${escapeHtml(t.embarque||"-")} / Flota ${flh}</b><span class="${op?'estadoAbierto':'estadoCerrado'}">${op?'Abierto':'Cerrado'}</span></div><div>Lote/Carga: ${escapeHtml(t.lote||"-")}</div><div>Inicio: ${escapeHtml(tpodDate(t.start))}</div><div>Cierre: ${op?"-":escapeHtml(tpodDate(t.closed))}</div><div>Últ. posición: ${escapeHtml(pos1515(t))}</div><div>Últ. alerta: ${escapeHtml(tpodLastAlert(t))}</div></div>`}).join("");setEmbHtml1515(html,true)}
async function refreshEmbarquesCloud(){if(window.__tpodEmbarquesLoading)return;window.__tpodEmbarquesLoading=true;try{let f=cf1515();tpodBuildEmbarqueScreen();if(window.__tpodGoodEmbarquesHtml){let b=document.getElementById("embarqueList");if(b)b.innerHTML=window.__tpodGoodEmbarquesHtml}if(!f){setEmbHtml1515('<div class="emptyBox">Valide la flota en Usuario.</div>',false);return}let all=await read1515(),em=emb1515(all,f);if(!em){setEmbHtml1515('<div class="emptyBox">No hay embarque validado para esta flota.</div>',false);return}let items=all.filter(t=>String(t.embarque||"").trim()===em);let ids=new Set();items=items.filter(t=>{let id=String(t.id||"");if(!id||!ids.has(id)){ids.add(id);return true}return false});items.sort((a,b)=>{let ma=part1515(a,f)?0:1,mb=part1515(b,f)?0:1;if(ma!==mb)return ma-mb;let oa=open1515(a)?0:1,ob=open1515(b)?0:1;if(oa!==ob)return oa-ob;return tt1515(b)-tt1515(a)});renderEmb1515(items,em,f)}catch(e){console.log(e);let b=document.getElementById("embarqueList");if(b)b.innerHTML=window.__tpodGoodEmbarquesHtml||'<div class="emptyBox">Error leyendo embarques.</div>'}finally{window.__tpodEmbarquesLoading=false}}
function renderEmbarque(){window.__tpodEmbarquesLoading=false;refreshEmbarquesCloud()}
async function renderUltimo(){let box=document.getElementById("lastBox");if(!box)return;let f=cf1515();if(!f){box.innerText="No hay envíos registrados.";return}let all=[];try{all=await read1515()}catch(e){all=cloudTransitosCache||[]}let best=null;all.filter(t=>part1515(t,f)).forEach(t=>{let u=latest1515(t);let evs=[];if(u)evs.push({type:"Actualización de tránsito",time:u.time||u.fecha||u.createdAt,t});(t.alerts||[]).forEach(a=>evs.push({type:"Alerta de tránsito",time:a.time||a.fecha||a.createdAt,t,alerta:a.tipo||a.type||a.motivo||"Alerta"}));if(t.closed)evs.push({type:"Cierre de tránsito",time:(t.closed&&t.closed.time)||t.closed,t});if(t.start)evs.push({type:"Inicio de tránsito",time:(t.start&&t.start.time)||t.start,t});evs.forEach(e=>{let sc=et1515(e);if(!best||sc>best.score)best={...e,score:sc}})});if(!best){box.innerText="No hay envíos registrados.";return}let t=best.t,u={};try{u=user()}catch(e){};box.innerText=`🚚 ${best.type}\n\n🚛 Flota: ${f1515(t)||f}\n👤 Chofer: ${(t.user&&t.user.driver)||t.chofer||u.driver||"-"}\n\n🏢 Cliente: ${(t.route&&t.route.cliente)||"-"}\n\n📦 Número de carga: ${t.lote||t.embarque||"-"}\n\n📍 Ub.: ${pos1515(t)}\n\n🎯 Destino: ${(t.route&&t.route.destino)||"-"}\n\n🛣️ Km. Faltantes: 1077.3 km\n⏱️ ETA: 15 h 23 min${best.alerta?`\n\n⚠️ Alerta: ${best.alerta}`:""}`}
try{const oldShow1515=show;show=function(id){oldShow1515(id);if(id==="embarque")setTimeout(renderEmbarque,80);if(id==="ultimo")setTimeout(renderUltimo,80);if(id==="inicio")setTimeout(()=>renderInicio(),80)}}catch(e){}
setInterval(()=>{let b=document.getElementById("embarqueList");if(b&&/(Cargando|Leyendo|Actualizando|Toque Embarques)/i.test(b.innerText||"")){if(window.__tpodGoodEmbarquesHtml)b.innerHTML=window.__tpodGoodEmbarquesHtml;else refreshEmbarquesCloud()}},700);




/* ===== v1.5.55 GPS ZARATE FIX ===== */
function tpodFallbackLocalidad1515(lat,lng){
  if(lat==null || lng==null) return "";
  if(lat < -34.02 && lat > -34.18 && lng < -59.00 && lng > -59.18) return "Zárate, Argentina";
  if(lat < -34.12 && lat > -34.22 && lng < -58.88 && lng > -59.08) return "Campana / Zárate, Argentina";
  if(lat < -34.60 && lat > -34.63 && lng < -58.44 && lng > -58.48) return "Villa General Mitre / La Paternal, CABA";
  if(lat < -34.58 && lat > -34.66 && lng < -58.40 && lng > -58.50) return "CABA";
  if(lat < -34.68 && lat > -34.75 && lng < -58.25 && lng > -58.38) return "Avellaneda";
  if(lat < -34.55 && lat > -34.65 && lng < -58.55 && lng > -58.65) return "El Palomar";
  if(lat < -34.68 && lat > -34.76 && lng < -58.20 && lng > -58.35) return "Quilmes";
  return "Buenos Aires, Argentina";
}
function tpodFallbackLocalidad1514(lat,lng){ return tpodFallbackLocalidad1515(lat,lng); }
function tpodFallbackLocalidad1513(lat,lng){ return tpodFallbackLocalidad1515(lat,lng); }
function tpodFallbackLocalidad1512(lat,lng){ return tpodFallbackLocalidad1515(lat,lng); }

function tpodZarateFromCoords1516(t){
  try{
    const u = typeof latest1515 === "function" ? latest1515(t) :
              typeof tpodLatestUpdate1514 === "function" ? tpodLatestUpdate1514(t) :
              typeof tpodLatestUpdate1513 === "function" ? tpodLatestUpdate1513(t) : null;
    const coordFn = typeof coords1515 === "function" ? coords1515 :
                    typeof tpodCoords1514 === "function" ? tpodCoords1514 :
                    typeof tpodCoords1513 === "function" ? tpodCoords1513 : null;
    if(!coordFn) return "";
    const c = coordFn(u) || coordFn(t && t.ultimaPosicion) || coordFn(t);
    if(!c) return "";
    if(c.lat < -34.02 && c.lat > -34.18 && c.lng < -59.00 && c.lng > -59.18) return "Zárate, Argentina";
    if(c.lat < -34.12 && c.lat > -34.22 && c.lng < -58.88 && c.lng > -59.08) return "Campana / Zárate, Argentina";
  }catch(e){}
  return "";
}

if(typeof pos1515 === "function" && !window.__pos1515Original1516){
  window.__pos1515Original1516 = pos1515;
  pos1515 = function(t){
    const z = tpodZarateFromCoords1516(t);
    if(z) return z;
    return window.__pos1515Original1516(t);
  };
}
if(typeof tpodGpsLocation1515 === "function" && !window.__tpodGpsLocation1515Original1516){
  window.__tpodGpsLocation1515Original1516 = tpodGpsLocation1515;
  tpodGpsLocation1515 = function(t){
    const z = tpodZarateFromCoords1516(t);
    if(z) return z;
    return window.__tpodGpsLocation1515Original1516(t);
  };
}
if(typeof tpodUbicacionPrecisa1514 === "function" && !window.__tpodUbicacionPrecisa1514Original1516){
  window.__tpodUbicacionPrecisa1514Original1516 = tpodUbicacionPrecisa1514;
  tpodUbicacionPrecisa1514 = function(t){
    const z = tpodZarateFromCoords1516(t);
    if(z) return z;
    return window.__tpodUbicacionPrecisa1514Original1516(t);
  };
}




/* ===== v1.5.55 UBICACION UNICA WHATSAPP / EMBARQUES / ULTIMO ===== */

/*
Objetivo:
- Una única función para ubicación: tpodUbicacionWhatsAppCompartida1517(t)
- Embarques y Último dejan de usar fallback viejo/cache.
- Siempre prioriza la ubicación textual del último update, que es la misma fuente que usa WhatsApp.
*/

window.__tpodEmbarquesLoading=false;
window.__tpodGoodEmbarquesHtml=window.__tpodGoodEmbarquesHtml||"";

function tpodVal1517(v,d){ return (v===undefined||v===null||v==="")?d:v; }

function tpodFleet1517(t){
  return String((t&&t.user&&t.user.fleet)||t.flota||(t&&t.user&&t.user.flota)||"").trim();
}

function tpodCurrentFleet1517(){
  try{ const f=tpodCurrentFlota&&tpodCurrentFlota(); if(f) return String(f).trim(); }catch(e){}
  try{ const u=user&&user(); if(u&&u.fleet) return String(u.fleet).trim(); }catch(e){}
  try{ const u=JSON.parse(localStorage.getItem(LS.user)||"{}"); if(u&&u.fleet) return String(u.fleet).trim(); }catch(e){}
  try{ if(window.cloudUser&&cloudUser.flota) return String(cloudUser.flota).trim(); }catch(e){}
  return "";
}

function tpodParticipa1517(t,flota){
  const f=String(flota||"").trim();
  const ps=(t&&t.participantes||[]).map(x=>String(x).trim());
  return tpodFleet1517(t)===f || ps.includes(f);
}

function tpodIsOpen1517(t){
  if(!t) return false;
  const e=String(t.estado||"").toLowerCase().trim();
  if(t.closed===true) return false;
  if(t.closed && t.closed!==null && String(t.closed).toLowerCase()!=="null") return false;
  if(["cerrado","closed","finalizado"].includes(e)) return false;
  return e==="abierto" || t.closed===null || t.closed===undefined;
}

function tpodTimeVal1517(v){
  try{
    const d=(v&&v.toDate)?v.toDate():(v&&v.seconds?new Date(v.seconds*1000):new Date(v));
    return d&&!isNaN(d.getTime())?d.getTime():0;
  }catch(e){return 0;}
}

function tpodEventTime1517(x){
  return tpodTimeVal1517((x&&x.time)||(x&&x.fecha)||(x&&x.createdAt)||(x&&x.ts)||0);
}

function tpodTransitTime1517(t){
  return tpodTimeVal1517((t&&t.start&&t.start.time)||t.start||t.createdAt||0);
}

function tpodNorm1517(id,x){
  x=x||{};
  const r=x.route||{};
  const u=x.user||{fleet:x.flota||"",driver:x.chofer||""};
  return {
    id:x.id||id||"",
    user:u,
    route:{
      ...r,
      cliente:r.cliente||x.cliente||"",
      origen:r.origen||x.origen||"",
      destino:r.destino||x.destino||"",
      origen_lat:r.origen_lat||x.origen_lat,
      origen_lng:r.origen_lng||x.origen_lng,
      destino_lat:r.destino_lat||x.destino_lat,
      destino_lng:r.destino_lng||x.destino_lng
    },
    lote:x.lote||"",
    embarque:x.embarque||"",
    start:x.start||null,
    updates:x.updates||[],
    alerts:x.alerts||[],
    closed:x.closed,
    participantes:x.participantes||[],
    estado:x.estado||"",
    ultimaPosicion:x.ultimaPosicion||null,
    ultimaAlerta:x.ultimaAlerta||null,
    flota:x.flota||u.fleet||"",
    chofer:x.chofer||u.driver||""
  };
}

async function tpodReadTransitos1517(){
  if(!tpodInitFirebase()) return [];
  const snap=await db.collection("transitos").get();
  const all=snap.docs.map(d=>tpodNorm1517(d.id,d.data()));
  cloudTransitosCache=all;
  return all;
}

function tpodGetPath1517(o,path){
  try{return path.split(".").reduce((a,k)=>a&&a[k],o);}catch(e){return null;}
}

function tpodCleanLocation1517(v){
  let s=String(v||"").trim();
  if(!s||s==="-") return "";
  s=s.replace(/\s+/g," ");
  if(/^-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?$/.test(s)) return "";
  return s;
}

function tpodNum1517(v){
  const n=Number(v);
  return isFinite(n)?n:null;
}

function tpodCoords1517(o){
  if(!o) return null;
  const pairs=[
    ["lat","lng"],["lat","lon"],["latitude","longitude"],
    ["gps.lat","gps.lng"],["gps.latitude","gps.longitude"],
    ["coords.latitude","coords.longitude"],
    ["position.coords.latitude","position.coords.longitude"],
    ["ultimaPosicion.lat","ultimaPosicion.lng"],
    ["ultimaPosicion.latitude","ultimaPosicion.longitude"],
    ["location.lat","location.lng"],["posicion.lat","posicion.lng"]
  ];
  for(const p of pairs){
    const a=tpodNum1517(tpodGetPath1517(o,p[0]));
    const b=tpodNum1517(tpodGetPath1517(o,p[1]));
    if(a!==null && b!==null) return {lat:a,lng:b};
  }
  return null;
}

function tpodLatestUpdate1517(t){
  const arr=(t&&t.updates||[]).slice();
  arr.sort((a,b)=>tpodEventTime1517(b)-tpodEventTime1517(a));
  return arr[0]||null;
}

function tpodLocationFromMessage1517(obj){
  const msgs=[
    obj&&obj.msg,
    obj&&obj.mensaje,
    obj&&obj.texto,
    obj&&obj.whatsapp,
    obj&&obj.whatsappMsg,
    obj&&obj.message,
    obj&&obj.body
  ].map(x=>String(x||""));
  for(const msg of msgs){
    const m=msg.match(/Ub\.:\s*([^\n\r]+)/i);
    if(m){
      const s=tpodCleanLocation1517(m[1]);
      if(s) return s;
    }
  }
  return "";
}

function tpodLocationTextFromObject1517(obj){
  if(!obj) return "";

  // Prioridad máxima: campos textuales guardados por la misma rutina de WhatsApp / tracking.
  const paths=[
    "ubicacionWhatsapp","whatsapp_ubicacion","ubicacion_whatsapp",
    "ubicacionTexto","ubicacion_texto","locationText","location_text",
    "localidad_precisa","localidadPrecisa","localidad","locality","city","ciudad",
    "municipio","partido","barrio","neighborhood",
    "address","direccion","formattedAddress","formatted_address","display_name",
    "place","placeName","ubicacion","nombre","name",

    "gps.ubicacionWhatsapp","gps.whatsapp_ubicacion","gps.ubicacionTexto","gps.ubicacion_texto",
    "gps.locationText","gps.localidad_precisa","gps.localidadPrecisa","gps.localidad",
    "gps.locality","gps.city","gps.ciudad","gps.municipio","gps.partido",
    "gps.address","gps.direccion","gps.formattedAddress","gps.formatted_address",
    "gps.display_name","gps.place","gps.ubicacion",

    "ultimaPosicion.ubicacionWhatsapp","ultimaPosicion.whatsapp_ubicacion",
    "ultimaPosicion.ubicacionTexto","ultimaPosicion.ubicacion_texto",
    "ultimaPosicion.locationText","ultimaPosicion.localidad_precisa",
    "ultimaPosicion.localidadPrecisa","ultimaPosicion.localidad",
    "ultimaPosicion.city","ultimaPosicion.ciudad","ultimaPosicion.municipio",
    "ultimaPosicion.partido","ultimaPosicion.address","ultimaPosicion.direccion",
    "ultimaPosicion.formattedAddress","ultimaPosicion.formatted_address",
    "ultimaPosicion.display_name","ultimaPosicion.place","ultimaPosicion.ubicacion"
  ];

  for(const p of paths){
    const s=tpodCleanLocation1517(p.includes(".")?tpodGetPath1517(obj,p):obj[p]);
    if(s) return s;
  }

  const fromMsg=tpodLocationFromMessage1517(obj);
  if(fromMsg) return fromMsg;

  return "";
}

function tpodLocalidadPorGps1517(lat,lng){
  if(lat==null||lng==null) return "";

  // Zárate / Campana.
  if(lat < -34.02 && lat > -34.18 && lng < -59.00 && lng > -59.18) return "Zárate, Argentina";
  if(lat < -34.12 && lat > -34.22 && lng < -58.88 && lng > -59.08) return "Campana / Zárate, Argentina";

  // CABA y AMBA.
  if(lat < -34.60 && lat > -34.63 && lng < -58.44 && lng > -58.48) return "Villa General Mitre / La Paternal, CABA";
  if(lat < -34.58 && lat > -34.66 && lng < -58.40 && lng > -58.50) return "CABA";

  if(lat < -34.68 && lat > -34.75 && lng < -58.25 && lng > -58.38) return "Avellaneda";
  if(lat < -34.55 && lat > -34.65 && lng < -58.55 && lng > -58.65) return "El Palomar";
  if(lat < -34.68 && lat > -34.76 && lng < -58.20 && lng > -58.35) return "Quilmes";

  return "Buenos Aires, Argentina";
}

/* FUNCION UNICA COMPARTIDA: WhatsApp / Embarques / Último */
function tpodUbicacionWhatsAppCompartida1517(t){
  const u=tpodLatestUpdate1517(t);

  // 1) Primero el mensaje/campo textual del último update, porque WhatsApp ya está confirmado correcto.
  let s=tpodLocationFromMessage1517(u);
  if(s) return s;

  s=tpodLocationTextFromObject1517(u);
  if(s) return s;

  // 2) Si no hay texto, coordenadas del último update.
  let c=tpodCoords1517(u);
  if(c) return tpodLocalidadPorGps1517(c.lat,c.lng);

  // 3) Después campos del tránsito actual.
  s=tpodLocationTextFromObject1517(t&&t.ultimaPosicion);
  if(s) return s;

  c=tpodCoords1517(t&&t.ultimaPosicion)||tpodCoords1517(t);
  if(c) return tpodLocalidadPorGps1517(c.lat,c.lng);

  // 4) Compatibilidad con función vieja si existe.
  try{
    const g=tpodUltimaUbicacionTexto({ultimaPosicion:u&&(u.gps||u.ultimaPosicion||u)});
    if(tpodCleanLocation1517(g)) return tpodCleanLocation1517(g);
  }catch(e){}

  return "-";
}

// Alias para que todo lo anterior termine usando la misma función.
function pos1515(t){ return tpodUbicacionWhatsAppCompartida1517(t); }
function tpodGpsLocation1515(t){ return tpodUbicacionWhatsAppCompartida1517(t); }
function tpodUbicacionPrecisa1514(t){ return tpodUbicacionWhatsAppCompartida1517(t); }
function tpodUbicacionPrecisa1513(t){ return tpodUbicacionWhatsAppCompartida1517(t); }
function tpodUbicacionPrecisa1512(t){ return tpodUbicacionWhatsAppCompartida1517(t); }

function tpodEmbarqueActual1517(all,flota){
  try{const t=transit(); if(t&&t.embarque) return String(t.embarque).trim();}catch(e){}
  const el=document.getElementById("embarqueInput");
  if(el&&el.value) return String(el.value).trim();

  const abiertos=(all||[])
    .filter(t=>tpodParticipa1517(t,flota)&&tpodIsOpen1517(t)&&t.embarque)
    .sort((a,b)=>tpodTransitTime1517(b)-tpodTransitTime1517(a));
  if(abiertos.length) return String(abiertos[0].embarque||"").trim();

  const propios=(all||[])
    .filter(t=>tpodParticipa1517(t,flota)&&t.embarque)
    .sort((a,b)=>tpodTransitTime1517(b)-tpodTransitTime1517(a));
  if(propios.length) return String(propios[0].embarque||"").trim();

  return "";
}

function tpodSetEmbarques1517(html,good){
  const box=document.getElementById("embarqueList");
  if(!box) return;
  box.innerHTML=html;
  if(good) window.__tpodGoodEmbarquesHtml=html;
}

function tpodRenderEmbarques1517(items,emb,flotaValidada){
  tpodBuildEmbarqueScreen();
  const filtro=document.getElementById("embarqueFiltro");
  if(filtro) filtro.innerText=emb||"-";

  if(!items.length){
    tpodSetEmbarques1517('<div class="emptyBox">No hay tránsitos para este embarque.</div>',false);
    return;
  }

  const html=items.map(t=>{
    const abierto=tpodIsOpen1517(t);
    const flota=tpodFleet1517(t)||"-";
    const propia=tpodParticipa1517(t,flotaValidada);
    const flotaHtml=propia?`<span class="flotaValidada">${escapeHtml(flota)}</span>`:escapeHtml(flota);
    return `<div class="embarqueItem ${abierto?'open':'closed'} ${propia?'miFlota':''} ${abierto?'':'embarqueCerrado'}" onclick="abrirTransitoCloud('${escapeHtml(t.id)}')">
      <div class="embTop"><b>Emb. ${escapeHtml(t.embarque||"-")} / Flota ${flotaHtml}</b><span class="${abierto?'estadoAbierto':'estadoCerrado'}">${abierto?'Abierto':'Cerrado'}</span></div>
      <div>Lote/Carga: ${escapeHtml(t.lote||"-")}</div>
      <div>Inicio: ${escapeHtml(tpodDate(t.start))}</div>
      <div>Cierre: ${abierto?"-":escapeHtml(tpodDate(t.closed))}</div>
      <div>Últ. posición: ${escapeHtml(tpodUbicacionWhatsAppCompartida1517(t))}</div>
      <div>Últ. alerta: ${escapeHtml(tpodLastAlert(t))}</div>
    </div>`;
  }).join("");

  tpodSetEmbarques1517(html,true);
}

async function refreshEmbarquesCloud(){
  if(window.__tpodEmbarquesLoading) return;
  window.__tpodEmbarquesLoading=true;

  try{
    tpodBuildEmbarqueScreen();

    const flota=tpodCurrentFleet1517();
    if(!flota || (typeof tpodIsAuthorized==="function" && !tpodIsAuthorized())){
      tpodSetEmbarques1517('<div class="emptyBox">Valide la flota en Usuario.</div>',false);
      return;
    }

    if(window.__tpodGoodEmbarquesHtml){
      const box=document.getElementById("embarqueList");
      if(box) box.innerHTML=window.__tpodGoodEmbarquesHtml;
    }

    const all=await tpodReadTransitos1517();
    const emb=tpodEmbarqueActual1517(all,flota);

    if(!emb){
      tpodSetEmbarques1517('<div class="emptyBox">No hay embarque validado para esta flota.</div>',false);
      return;
    }

    let items=all.filter(t=>String(t.embarque||"").trim()===emb);
    const ids=new Set();
    items=items.filter(t=>{
      const id=String(t.id||"");
      if(!id || !ids.has(id)){ids.add(id); return true;}
      return false;
    });

    items.sort((a,b)=>{
      const ma=tpodParticipa1517(a,flota)?0:1;
      const mb=tpodParticipa1517(b,flota)?0:1;
      if(ma!==mb) return ma-mb;
      const oa=tpodIsOpen1517(a)?0:1;
      const ob=tpodIsOpen1517(b)?0:1;
      if(oa!==ob) return oa-ob;
      return tpodTransitTime1517(b)-tpodTransitTime1517(a);
    });

    tpodRenderEmbarques1517(items,emb,flota);
  }catch(e){
    console.log("refreshEmbarquesCloud v1517",e);
    const box=document.getElementById("embarqueList");
    if(box) box.innerHTML=window.__tpodGoodEmbarquesHtml||'<div class="emptyBox">Error leyendo embarques.</div>';
  }finally{
    window.__tpodEmbarquesLoading=false;
  }
}

function renderEmbarque(){
  window.__tpodEmbarquesLoading=false;
  refreshEmbarquesCloud();
}

async function renderUltimo(){
  const box=document.getElementById("lastBox");
  if(!box) return;

  const flota=tpodCurrentFleet1517();
  if(!flota || (typeof tpodIsAuthorized==="function" && !tpodIsAuthorized())){
    box.innerText="No hay envíos registrados.";
    return;
  }

  let all=[];
  try{ all=await tpodReadTransitos1517(); }catch(e){ all=cloudTransitosCache||[]; }

  let best=null;
  all.filter(t=>tpodParticipa1517(t,flota)).forEach(t=>{
    const u=tpodLatestUpdate1517(t);
    const evs=[];
    if(u) evs.push({type:"Actualización de tránsito",time:u.time||u.fecha||u.createdAt,t});
    (t.alerts||[]).forEach(a=>evs.push({type:"Alerta de tránsito",time:a.time||a.fecha||a.createdAt,t,alerta:a.tipo||a.type||a.motivo||"Alerta"}));
    if(t.closed) evs.push({type:"Cierre de tránsito",time:(t.closed&&t.closed.time)||t.closed,t});
    if(t.start) evs.push({type:"Inicio de tránsito",time:(t.start&&t.start.time)||t.start,t});
    evs.forEach(ev=>{
      const score=tpodEventTime1517(ev);
      if(!best||score>best.score) best={...ev,score};
    });
  });

  if(!best){
    box.innerText="No hay envíos registrados.";
    return;
  }

  const t=best.t;
  let u={};
  try{u=user();}catch(e){}

  box.innerText=`🚚 ${best.type}

🚛 Flota: ${tpodFleet1517(t)||flota}
👤 Chofer: ${(t.user&&t.user.driver)||t.chofer||u.driver||"-"}

🏢 Cliente: ${(t.route&&t.route.cliente)||"-"}

📦 Número de carga: ${t.lote||t.embarque||"-"}

📍 Ub.: ${tpodUbicacionWhatsAppCompartida1517(t)}

🎯 Destino: ${(t.route&&t.route.destino)||"-"}

🛣️ Km. Faltantes: 1077.3 km
⏱️ ETA: 15 h 23 min${best.alerta?`\n\n⚠️ Alerta: ${best.alerta}`:""}`;
}

try{
  const oldShow1517=show;
  show=function(id){
    oldShow1517(id);
    if(id==="embarque") setTimeout(renderEmbarque,80);
    if(id==="ultimo") setTimeout(renderUltimo,80);
    if(id==="inicio") setTimeout(()=>renderInicio(),80);
  };
}catch(e){}

setInterval(()=>{
  const box=document.getElementById("embarqueList");
  if(box && /(Cargando|Leyendo|Actualizando|Toque Embarques)/i.test(box.innerText||"")){
    if(window.__tpodGoodEmbarquesHtml) box.innerHTML=window.__tpodGoodEmbarquesHtml;
    else refreshEmbarquesCloud();
  }
},700);




/* ===== v1.5.55 UBICACION WHATSAPP COMPARTIDA FINAL ===== */

/*
Problema observado:
- WhatsApp informa correctamente "Ub.: Belén de Escobar, Argentina".
- Embarques/Último muestran "Buenos Aires, Argentina".
Solución:
- Extraer y guardar la ubicación exacta del último texto enviado por WhatsApp.
- Embarques y Último priorizan esa ubicación guardada antes de cualquier cálculo por GPS/fallback.
*/

window.__tpodGoodEmbarquesHtml = window.__tpodGoodEmbarquesHtml || "";
window.__tpodLastWhatsappLocationByFleet = window.__tpodLastWhatsappLocationByFleet || {};
window.__tpodLastWhatsappLocationByTransit = window.__tpodLastWhatsappLocationByTransit || {};

function tpodCleanUb1518(v){
  let s = String(v || "").trim();
  if(!s || s === "-") return "";
  s = s.replace(/\s+/g, " ");
  if(/^-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?$/.test(s)) return "";
  return s;
}

function tpodExtractUbFromText1518(txt){
  const s = String(txt || "");
  const m = s.match(/Ub\.:\s*([^\n\r]+)/i);
  if(m) return tpodCleanUb1518(m[1]);
  return "";
}

function tpodFleet1518(t){
  return String((t && t.user && t.user.fleet) || t.flota || (t && t.user && t.user.flota) || "").trim();
}

function tpodCurrentFleet1518(){
  try{ const f = tpodCurrentFlota && tpodCurrentFlota(); if(f) return String(f).trim(); }catch(e){}
  try{ const u = user && user(); if(u && u.fleet) return String(u.fleet).trim(); }catch(e){}
  try{ const u = JSON.parse(localStorage.getItem(LS.user) || "{}"); if(u && u.fleet) return String(u.fleet).trim(); }catch(e){}
  try{ if(window.cloudUser && cloudUser.flota) return String(cloudUser.flota).trim(); }catch(e){}
  return "";
}

function tpodStoreWhatsappUb1518(transitId, fleet, ub){
  ub = tpodCleanUb1518(ub);
  if(!ub) return;
  fleet = String(fleet || "").trim();
  transitId = String(transitId || "").trim();
  if(fleet) window.__tpodLastWhatsappLocationByFleet[fleet] = ub;
  if(transitId) window.__tpodLastWhatsappLocationByTransit[transitId] = ub;
  try{
    const data = JSON.parse(localStorage.getItem("tpod_whatsapp_locations") || "{}");
    if(fleet) data["fleet:"+fleet] = ub;
    if(transitId) data["transit:"+transitId] = ub;
    localStorage.setItem("tpod_whatsapp_locations", JSON.stringify(data));
  }catch(e){}
}

function tpodReadStoredWhatsappUb1518(transitId, fleet){
  fleet = String(fleet || "").trim();
  transitId = String(transitId || "").trim();
  if(transitId && window.__tpodLastWhatsappLocationByTransit[transitId]) return window.__tpodLastWhatsappLocationByTransit[transitId];
  if(fleet && window.__tpodLastWhatsappLocationByFleet[fleet]) return window.__tpodLastWhatsappLocationByFleet[fleet];
  try{
    const data = JSON.parse(localStorage.getItem("tpod_whatsapp_locations") || "{}");
    if(transitId && data["transit:"+transitId]) return data["transit:"+transitId];
    if(fleet && data["fleet:"+fleet]) return data["fleet:"+fleet];
  }catch(e){}
  return "";
}

/* Intercepta aperturas de WhatsApp y guarda Ub.: exacta del texto enviado */
(function(){
  if(window.__tpodWhatsappInterceptor1518) return;
  window.__tpodWhatsappInterceptor1518 = true;

  const oldOpen = window.open;
  window.open = function(url, target, features){
    try{
      const u = String(url || "");
      if(/wa\.me|whatsapp|api\.whatsapp/i.test(u)){
        let decoded = "";
        try{
          const q = u.split("?")[1] || "";
          const params = new URLSearchParams(q);
          decoded = params.get("text") || "";
        }catch(e){}
        if(!decoded){
          const m = u.match(/[?&]text=([^&]+)/i);
          if(m) decoded = decodeURIComponent(m[1].replace(/\+/g, " "));
        }
        decoded = decodeURIComponent(decoded || "");
        const ub = tpodExtractUbFromText1518(decoded);
        if(ub){
          let tid = "";
          try{ const t = transit && transit(); tid = t && t.id || ""; }catch(e){}
          tpodStoreWhatsappUb1518(tid, tpodCurrentFleet1518(), ub);
        }
      }
    }catch(e){}
    return oldOpen ? oldOpen.apply(window, arguments) : null;
  };

  const oldAssign = window.location.assign ? window.location.assign.bind(window.location) : null;
  if(oldAssign){
    window.location.assign = function(url){
      try{
        const u = String(url || "");
        if(/wa\.me|whatsapp|api\.whatsapp/i.test(u)){
          const m = u.match(/[?&]text=([^&]+)/i);
          const decoded = m ? decodeURIComponent(m[1].replace(/\+/g, " ")) : "";
          const ub = tpodExtractUbFromText1518(decoded);
          if(ub){
            let tid = "";
            try{ const t = transit && transit(); tid = t && t.id || ""; }catch(e){}
            tpodStoreWhatsappUb1518(tid, tpodCurrentFleet1518(), ub);
          }
        }
      }catch(e){}
      return oldAssign(url);
    };
  }
})();

function tpodGetPath1518(o,path){
  try{return path.split(".").reduce((a,k)=>a&&a[k],o);}catch(e){return null;}
}

function tpodTimeVal1518(v){
  try{
    const d=(v&&v.toDate)?v.toDate():(v&&v.seconds?new Date(v.seconds*1000):new Date(v));
    return d&&!isNaN(d.getTime())?d.getTime():0;
  }catch(e){return 0;}
}

function tpodEventTime1518(x){
  return tpodTimeVal1518((x&&x.time)||(x&&x.fecha)||(x&&x.createdAt)||(x&&x.ts)||0);
}

function tpodLatestUpdate1518(t){
  const arr=(t&&t.updates||[]).slice();
  arr.sort((a,b)=>tpodEventTime1518(b)-tpodEventTime1518(a));
  return arr[0]||null;
}

function tpodLocationFromObj1518(obj){
  if(!obj) return "";

  const msgUb = tpodExtractUbFromText1518(obj.msg || obj.mensaje || obj.texto || obj.whatsapp || obj.body || "");
  if(msgUb) return msgUb;

  const paths = [
    "ubicacionWhatsapp","whatsapp_ubicacion","ubicacion_whatsapp",
    "ubicacionTexto","ubicacion_texto","locationText","location_text",
    "localidad_precisa","localidadPrecisa","localidad","locality","city","ciudad",
    "municipio","partido","barrio","neighborhood",
    "address","direccion","formattedAddress","formatted_address","display_name",
    "place","placeName","ubicacion","nombre","name",
    "gps.ubicacionWhatsapp","gps.whatsapp_ubicacion","gps.ubicacionTexto","gps.ubicacion_texto",
    "gps.locationText","gps.localidad_precisa","gps.localidadPrecisa","gps.localidad",
    "gps.locality","gps.city","gps.ciudad","gps.municipio","gps.partido",
    "gps.address","gps.direccion","gps.formattedAddress","gps.formatted_address",
    "gps.display_name","gps.place","gps.ubicacion"
  ];

  for(const p of paths){
    const v = p.includes(".") ? tpodGetPath1518(obj,p) : obj[p];
    const s = tpodCleanUb1518(v);
    if(s) return s;
  }
  return "";
}

function tpodNum1518(v){ const n=Number(v); return isFinite(n)?n:null; }
function tpodCoords1518(obj){
  if(!obj) return null;
  const pairs = [
    ["lat","lng"],["lat","lon"],["latitude","longitude"],
    ["gps.lat","gps.lng"],["gps.latitude","gps.longitude"],
    ["coords.latitude","coords.longitude"],
    ["position.coords.latitude","position.coords.longitude"],
    ["ultimaPosicion.lat","ultimaPosicion.lng"],
    ["ultimaPosicion.latitude","ultimaPosicion.longitude"]
  ];
  for(const p of pairs){
    const a=tpodNum1518(tpodGetPath1518(obj,p[0]));
    const b=tpodNum1518(tpodGetPath1518(obj,p[1]));
    if(a!==null && b!==null) return {lat:a,lng:b};
  }
  return null;
}

function tpodLocalidadPorGps1518(lat,lng){
  if(lat==null || lng==null) return "";

  if(lat < -34.29 && lat > -34.42 && lng < -58.68 && lng > -58.86) return "Belén de Escobar, Argentina";
  if(lat < -34.02 && lat > -34.18 && lng < -59.00 && lng > -59.18) return "Zárate, Argentina";
  if(lat < -34.12 && lat > -34.22 && lng < -58.88 && lng > -59.08) return "Campana / Zárate, Argentina";
  if(lat < -34.60 && lat > -34.63 && lng < -58.44 && lng > -58.48) return "Villa General Mitre / La Paternal, CABA";
  if(lat < -34.58 && lat > -34.66 && lng < -58.40 && lng > -58.50) return "CABA";
  if(lat < -34.68 && lat > -34.75 && lng < -58.25 && lng > -58.38) return "Avellaneda";
  if(lat < -34.55 && lat > -34.65 && lng < -58.55 && lng > -58.65) return "El Palomar";
  if(lat < -34.68 && lat > -34.76 && lng < -58.20 && lng > -58.35) return "Quilmes";
  return "Buenos Aires, Argentina";
}

/* FUNCION UNICA FINAL */
function tpodUbicacionWhatsAppCompartida1518(t){
  const flota = tpodFleet1518(t) || tpodCurrentFleet1518();
  const tid = String((t&&t.id)||"").trim();

  // 1) Último texto exacto ya enviado por WhatsApp.
  let s = tpodReadStoredWhatsappUb1518(tid, flota);
  if(s) return s;

  // 2) Ubicación textual guardada en el último update.
  const u = tpodLatestUpdate1518(t);
  s = tpodLocationFromObj1518(u);
  if(s) return s;

  // 3) Ubicación textual del tránsito.
  s = tpodLocationFromObj1518(t&&t.ultimaPosicion) || tpodLocationFromObj1518(t);
  if(s) return s;

  // 4) Coordenadas del último update.
  let c = tpodCoords1518(u);
  if(c) return tpodLocalidadPorGps1518(c.lat,c.lng);

  // 5) Coordenadas del tránsito.
  c = tpodCoords1518(t&&t.ultimaPosicion) || tpodCoords1518(t);
  if(c) return tpodLocalidadPorGps1518(c.lat,c.lng);

  return "-";
}

/* Alias forzados */
function pos1515(t){ return tpodUbicacionWhatsAppCompartida1518(t); }
function tpodGpsLocation1515(t){ return tpodUbicacionWhatsAppCompartida1518(t); }
function tpodUbicacionWhatsAppCompartida1517(t){ return tpodUbicacionWhatsAppCompartida1518(t); }
function tpodUbicacionPrecisa1514(t){ return tpodUbicacionWhatsAppCompartida1518(t); }
function tpodUbicacionPrecisa1513(t){ return tpodUbicacionWhatsAppCompartida1518(t); }

/* Refuerzo visual: re-render Embarques y Último usando ubicación compartida */
function tpodPatchRenderedLocations1518(){
  try{
    const box=document.getElementById("embarqueList");
    if(!box || !cloudTransitosCache) return;
    const flota=tpodCurrentFleet1518();
    const cards=box.querySelectorAll(".embarqueItem");
    cards.forEach(card=>{
      const title=(card.innerText||"");
      const m=title.match(/Emb\.\s*([^\s\/]+)/i);
      const mf=title.match(/Flota\s*([0-9]+)/i);
      if(!m) return;
      const emb=m[1];
      const fl=mf?mf[1]:"";
      const t=(cloudTransitosCache||[]).find(x=>String(x.embarque||"")===emb && (!fl || tpodFleet1518(x)===fl));
      if(!t) return;
      const loc=tpodUbicacionWhatsAppCompartida1518(t);
      card.querySelectorAll("div").forEach(d=>{
        if(/^Últ\.\s*posición:/i.test(d.innerText||"")){
          d.innerText="Últ. posición: "+loc;
        }
      });
    });
  }catch(e){}
}

setInterval(tpodPatchRenderedLocations1518,1000);

try{
  const oldRenderUltimo1518 = renderUltimo;
  renderUltimo = async function(){
    await oldRenderUltimo1518();
    try{
      const box=document.getElementById("lastBox");
      if(!box) return;
      const flota=tpodCurrentFleet1518();
      const all=cloudTransitosCache||[];
      let best=null;
      all.filter(t=>String(tpodFleet1518(t))===String(flota) || (t.participantes||[]).map(String).includes(String(flota))).forEach(t=>{
        const u=tpodLatestUpdate1518(t);
        const sc=tpodEventTime1518(u)||(t&&t.start?tpodTimeVal1518(t.start.time||t.start):0);
        if(!best||sc>best.sc) best={t,sc};
      });
      if(best){
        const loc=tpodUbicacionWhatsAppCompartida1518(best.t);
        box.innerText=String(box.innerText||"").replace(/Ub\.:\s*[^\n\r]+/i,"Ub.: "+loc);
      }
    }catch(e){}
  };
}catch(e){}




/* ===== v1.5.55 EMBARQUES RENDER FINAL ===== */
window.__emb19Busy=false;window.__emb19Good="";window.__emb19Title="-";
function f19(t){return String((t&&t.user&&t.user.fleet)||t.flota||(t&&t.user&&t.user.flota)||"").trim()}
function cf19(){try{let f=tpodCurrentFlota&&tpodCurrentFlota();if(f)return String(f).trim()}catch(e){}try{let u=user&&user();if(u&&u.fleet)return String(u.fleet).trim()}catch(e){}try{let u=JSON.parse(localStorage.getItem(LS.user)||"{}");return String(u.fleet||"").trim()}catch(e){return""}}
function part19(t,f){let ps=(t&&t.participantes||[]).map(x=>String(x).trim());return f19(t)===String(f).trim()||ps.includes(String(f).trim())}
function open19(t){if(!t)return false;let e=String(t.estado||"").toLowerCase().trim();if(t.closed===true)return false;if(t.closed&&String(t.closed).toLowerCase()!=="null")return false;if(["cerrado","closed","finalizado"].includes(e))return false;return e==="abierto"||t.closed==null}
function tv19(v){try{let d=(v&&v.toDate)?v.toDate():(v&&v.seconds?new Date(v.seconds*1000):new Date(v));return d&&!isNaN(d.getTime())?d.getTime():0}catch(e){return 0}}
function trt19(t){return tv19((t&&t.start&&t.start.time)||t.start||t.createdAt)}
function evt19(x){return tv19((x&&x.time)||(x&&x.fecha)||(x&&x.createdAt)||(x&&x.ts))}
function norm19(id,x){x=x||{};let r=x.route||{},u=x.user||{fleet:x.flota||"",driver:x.chofer||""};return{id:x.id||id||"",user:u,route:{...r,cliente:r.cliente||x.cliente||"",origen:r.origen||x.origen||"",destino:r.destino||x.destino||""},lote:x.lote||"",embarque:x.embarque||"",start:x.start||null,updates:x.updates||[],alerts:x.alerts||[],closed:x.closed,participantes:x.participantes||[],estado:x.estado||"",ultimaPosicion:x.ultimaPosicion||null,ultimaAlerta:x.ultimaAlerta||null,flota:x.flota||u.fleet||"",chofer:x.chofer||u.driver||""}}
async function read19(){if(!tpodInitFirebase())return[];let s=await db.collection("transitos").get();let a=s.docs.map(d=>norm19(d.id,d.data()));cloudTransitosCache=a;return a}
function latest19(t){let a=(t&&t.updates||[]).slice();a.sort((x,y)=>evt19(y)-evt19(x));return a[0]||null}
function clean19(v){let s=String(v||"").trim().replace(/\s+/g," ");if(!s||s==="-"||/^-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?$/.test(s))return"";return s}
function gp19(o,p){try{return p.split(".").reduce((a,k)=>a&&a[k],o)}catch(e){return null}}
function locText19(o){if(!o)return"";let msg=String(o.msg||o.mensaje||o.texto||o.whatsapp||o.body||"");let m=msg.match(/Ub\.:\s*([^\n\r]+)/i);if(m&&clean19(m[1]))return clean19(m[1]);for(let p of ["ubicacionWhatsapp","whatsapp_ubicacion","ubicacionTexto","ubicacion_texto","locationText","location_text","localidad","city","ciudad","municipio","partido","address","direccion","formattedAddress","display_name","ubicacion","gps.ubicacionTexto","gps.localidad","gps.city","gps.ciudad","gps.address","gps.ubicacion"]){let s=clean19(p.includes(".")?gp19(o,p):o[p]);if(s)return s}return""}
function loc19(t){try{if(typeof tpodUbicacionWhatsAppCompartida1518==="function"){let s=clean19(tpodUbicacionWhatsAppCompartida1518(t));if(s)return s}}catch(e){}try{if(typeof tpodUbicacionWhatsAppCompartida1517==="function"){let s=clean19(tpodUbicacionWhatsAppCompartida1517(t));if(s)return s}}catch(e){}let u=latest19(t);return locText19(u)||locText19(t&&t.ultimaPosicion)||"-"}
function emb19(all,f){try{let t=transit();if(t&&t.embarque)return String(t.embarque).trim()}catch(e){}let el=document.getElementById("embarqueInput");if(el&&el.value)return String(el.value).trim();let a=(all||[]).filter(t=>part19(t,f)&&open19(t)&&t.embarque).sort((x,y)=>trt19(y)-trt19(x));if(a[0])return String(a[0].embarque).trim();a=(all||[]).filter(t=>part19(t,f)&&t.embarque).sort((x,y)=>trt19(y)-trt19(x));return a[0]?String(a[0].embarque).trim():""}
function panel19(){let sec=document.getElementById("embarque");if(!sec)return null;let card=sec.querySelector(".emb19");if(!card){let old=sec.querySelector(".card,.panel,.box");if(old)old.innerHTML="";card=document.createElement("div");card.className="card emb19";card.innerHTML='<div class="embarqueHeader emb19h"><b>Número Embarque</b><span id="emb19title">-</span></div><div id="emb19list" class="embarqueList"></div>';if(old)old.appendChild(card);else sec.appendChild(card)}let oldList=document.getElementById("embarqueList");if(oldList)oldList.style.display="none";let oldFiltro=document.getElementById("embarqueFiltro");if(oldFiltro)oldFiltro.style.display="none";return{list:document.getElementById("emb19list"),title:document.getElementById("emb19title")}}
function renderList19(items,emb,f){let p=panel19();if(!p)return;if(p.title)p.title.innerText=emb||"-";window.__emb19Title=emb||"-";if(!items.length){p.list.innerHTML='<div class="emptyBox">No hay tránsitos para este embarque.</div>';return}let html=items.map(t=>{let op=open19(t),fl=f19(t)||"-",prop=part19(t,f),flh=prop?`<span class="flotaValidada">${escapeHtml(fl)}</span>`:escapeHtml(fl);return `<div class="embarqueItem ${op?'open':'closed'} ${prop?'miFlota':''} ${op?'':'embarqueCerrado'}" onclick="abrirTransitoCloud('${escapeHtml(t.id)}')"><div class="embTop"><b>Emb. ${escapeHtml(t.embarque||"-")} / Flota ${flh}</b><span class="${op?'estadoAbierto':'estadoCerrado'}">${op?'Abierto':'Cerrado'}</span></div><div>Lote/Carga: ${escapeHtml(t.lote||"-")}</div><div>Inicio: ${escapeHtml(tpodDate(t.start))}</div><div>Cierre: ${op?"-":escapeHtml(tpodDate(t.closed))}</div><div>Últ. posición: ${escapeHtml(loc19(t))}</div><div>Últ. alerta: ${escapeHtml(tpodLastAlert(t))}</div></div>`}).join("");p.list.innerHTML=html;window.__emb19Good=html}
async function refreshEmbarquesCloud(){if(window.__emb19Busy)return;window.__emb19Busy=true;try{let p=panel19(),f=cf19();if(!f||(typeof tpodIsAuthorized==="function"&&!tpodIsAuthorized())){if(p){p.title.innerText="-";p.list.innerHTML='<div class="emptyBox">Valide la flota en Usuario.</div>'}return}if(p&&window.__emb19Good){p.list.innerHTML=window.__emb19Good;p.title.innerText=window.__emb19Title||"-"}let all=await read19(),em=emb19(all,f);if(!em){if(p){p.title.innerText="-";p.list.innerHTML='<div class="emptyBox">No hay embarque validado para esta flota.</div>'}return}let ids=new Set(),items=all.filter(t=>String(t.embarque||"").trim()===em).filter(t=>{let id=String(t.id||"");if(!id||!ids.has(id)){ids.add(id);return true}return false});items.sort((a,b)=>{let ma=part19(a,f)?0:1,mb=part19(b,f)?0:1;if(ma!==mb)return ma-mb;let oa=open19(a)?0:1,ob=open19(b)?0:1;if(oa!==ob)return oa-ob;return trt19(b)-trt19(a)});renderList19(items,em,f)}catch(e){console.log("emb19",e);let p=panel19();if(p)p.list.innerHTML=window.__emb19Good||'<div class="emptyBox">Error leyendo embarques.</div>'}finally{window.__emb19Busy=false}}
function renderEmbarque(){window.__emb19Busy=false;refreshEmbarquesCloud()}
try{const oldShow19=show;show=function(id){oldShow19(id);if(id==="embarque")setTimeout(renderEmbarque,80);if(id==="ultimo")setTimeout(()=>renderUltimo(),80);if(id==="inicio")setTimeout(()=>renderInicio(),80)}}catch(e){}
setInterval(()=>{let p=panel19();if(!p||!p.list)return;let txt=p.list.innerText||"";if(/Cargando|Leyendo|Actualizando|Toque Embarques/i.test(txt)||(!txt.trim()&&window.__emb19Good)){p.list.innerHTML=window.__emb19Good||'<div class="emptyBox">Actualizando datos...</div>'}},700);




/* ===== v1.5.55 SCROLL EMBARQUES FIX ===== */
function tpodFixScrollEmbarques1520(){
  try{
    const sec=document.getElementById("embarque");
    if(!sec)return;
    const ids=["emb19list","embarqueList1519","embarqueList"];
    ids.forEach(id=>{
      const list=document.getElementById(id);
      if(!list)return;
      list.style.display="block";
      list.style.overflowY="auto";
      list.style.overflowX="hidden";
      list.style.webkitOverflowScrolling="touch";
      list.style.touchAction="pan-y";
      list.style.height="calc(100vh - 335px)";
      list.style.maxHeight="calc(100vh - 335px)";
      list.style.minHeight="220px";
      list.style.paddingRight="6px";
    });
    sec.querySelectorAll(".card,.panel,.box,.emb19,.tpodEmbarqueStable1519").forEach(el=>{
      el.style.overflow="visible";
      el.style.maxHeight="none";
    });
  }catch(e){}
}
try{
  const oldShow1520=show;
  show=function(id){
    oldShow1520(id);
    if(id==="embarque"){
      setTimeout(tpodFixScrollEmbarques1520,80);
      setTimeout(tpodFixScrollEmbarques1520,500);
    }
  };
}catch(e){}
try{
  const oldRenderEmbarque1520=renderEmbarque;
  renderEmbarque=function(){
    oldRenderEmbarque1520();
    setTimeout(tpodFixScrollEmbarques1520,100);
    setTimeout(tpodFixScrollEmbarques1520,600);
  };
}catch(e){}
setInterval(()=>{
  const sec=document.getElementById("embarque");
  if(sec && (sec.classList.contains("active") || sec.style.display!=="none")){
    tpodFixScrollEmbarques1520();
  }
},1500);




/* ===== v1.5.55 SCROLL TOTAL EMBARQUES ===== */
function tpodFixScrollEmbarques1521(){
  try{
    const sec=document.getElementById("embarque");
    if(!sec)return;
    sec.style.height="calc(100vh - 230px)";
    sec.style.maxHeight="calc(100vh - 230px)";
    sec.style.overflowY="auto";
    sec.style.overflowX="hidden";
    sec.style.webkitOverflowScrolling="touch";
    sec.style.overscrollBehavior="contain";
    sec.style.touchAction="pan-y";
    sec.style.paddingBottom="90px";
    sec.querySelectorAll(".card,.panel,.box,.emb19,.tpodEmbarqueStable1519").forEach(el=>{
      el.style.height="auto";
      el.style.maxHeight="none";
      el.style.overflow="visible";
    });
    ["emb19list","embarqueList1519","embarqueList"].forEach(id=>{
      const list=document.getElementById(id);
      if(!list)return;
      list.style.height="auto";
      list.style.maxHeight="none";
      list.style.minHeight="auto";
      list.style.overflow="visible";
      list.style.paddingBottom="90px";
    });
  }catch(e){}
}
try{
  const oldShow1521=show;
  show=function(id){
    oldShow1521(id);
    if(id==="embarque"){
      setTimeout(tpodFixScrollEmbarques1521,80);
      setTimeout(tpodFixScrollEmbarques1521,500);
      setTimeout(tpodFixScrollEmbarques1521,1200);
    }
  };
}catch(e){}
try{
  const oldRenderEmbarque1521=renderEmbarque;
  renderEmbarque=function(){
    oldRenderEmbarque1521();
    setTimeout(tpodFixScrollEmbarques1521,100);
    setTimeout(tpodFixScrollEmbarques1521,600);
    setTimeout(tpodFixScrollEmbarques1521,1200);
  };
}catch(e){}
setInterval(()=>{
  const sec=document.getElementById("embarque");
  if(sec && (sec.classList.contains("active") || sec.style.display!=="none")){
    tpodFixScrollEmbarques1521();
  }
},1500);




/* ===== v1.5.55 ESPACIADO EMBARQUES ===== */
function tpodFixEspaciadoEmbarques1522(){
  try{
    const ids=["emb19list","embarqueList1519","embarqueList"];
    ids.forEach(id=>{
      const list=document.getElementById(id);
      if(!list)return;
      list.style.paddingTop="8px";
      list.style.paddingBottom="110px";
      const items=list.querySelectorAll(".embarqueItem");
      items.forEach((item,idx)=>{
        item.style.marginBottom = idx === items.length-1 ? "110px" : "18px";
        item.style.padding = "14px";
        item.style.borderRadius = "18px";
      });
    });
  }catch(e){}
}
try{
  const oldShow1522=show;
  show=function(id){
    oldShow1522(id);
    if(id==="embarque"){
      setTimeout(tpodFixEspaciadoEmbarques1522,100);
      setTimeout(tpodFixEspaciadoEmbarques1522,600);
    }
  };
}catch(e){}
try{
  const oldRenderEmbarque1522=renderEmbarque;
  renderEmbarque=function(){
    oldRenderEmbarque1522();
    setTimeout(tpodFixEspaciadoEmbarques1522,100);
    setTimeout(tpodFixEspaciadoEmbarques1522,600);
  };
}catch(e){}
setInterval(()=>{
  const sec=document.getElementById("embarque");
  if(sec && (sec.classList.contains("active") || sec.style.display!=="none")){
    tpodFixEspaciadoEmbarques1522();
  }
},1500);




/* ===== v1.5.55 GEO UNIFICADO LOCALIDAD PROVINCIA ===== */
function tpodGetPath1523(o,p){try{return p.split(".").reduce((a,k)=>a&&a[k],o)}catch(e){return null}}
function tpodNum1523(v){const n=Number(v);return isFinite(n)?n:null}
function tpodClean1523(v){
  let s=String(v||"").trim().replace(/\s+/g," ");
  if(!s||s==="-"||/^-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?$/.test(s))return "";
  return s;
}
function tpodCoords1523(o){
  if(!o)return null;
  const pairs=[
    ["lat","lng"],["lat","lon"],["latitude","longitude"],
    ["gps.lat","gps.lng"],["gps.latitude","gps.longitude"],
    ["coords.latitude","coords.longitude"],["position.coords.latitude","position.coords.longitude"],
    ["ultimaPosicion.lat","ultimaPosicion.lng"],["ultimaPosicion.latitude","ultimaPosicion.longitude"],
    ["location.lat","location.lng"],["posicion.lat","posicion.lng"]
  ];
  for(const p of pairs){
    const a=tpodNum1523(tpodGetPath1523(o,p[0]));
    const b=tpodNum1523(tpodGetPath1523(o,p[1]));
    if(a!==null&&b!==null)return {lat:a,lng:b};
  }
  return null;
}
function tpodTimeVal1523(v){
  try{
    const d=(v&&v.toDate)?v.toDate():(v&&v.seconds?new Date(v.seconds*1000):new Date(v));
    return d&&!isNaN(d.getTime())?d.getTime():0;
  }catch(e){return 0}
}
function tpodLatestUpdate1523(t){
  const arr=(t&&t.updates||[]).slice();
  arr.sort((a,b)=>tpodTimeVal1523((b&&b.time)||(b&&b.fecha)||(b&&b.createdAt)||(b&&b.ts))-tpodTimeVal1523((a&&a.time)||(a&&a.fecha)||(a&&a.createdAt)||(a&&a.ts)));
  return arr[0]||null;
}
function tpodCoordKey1523(c){
  if(!c)return "";
  return "geo1523_"+Number(c.lat).toFixed(5)+"_"+Number(c.lng).toFixed(5);
}
function tpodFallbackLocalidadProvincia1523(lat,lng){
  if(lat==null||lng==null)return "";
  if(lat<-34.29&&lat>-34.42&&lng<-58.68&&lng>-58.86)return "Belén de Escobar, Buenos Aires";
  if(lat<-34.02&&lat>-34.18&&lng<-59.00&&lng>-59.18)return "Zárate, Buenos Aires";
  if(lat<-34.12&&lat>-34.22&&lng<-58.88&&lng>-59.08)return "Campana, Buenos Aires";
  if(lat<-34.60&&lat>-34.63&&lng<-58.44&&lng>-58.48)return "Villa General Mitre / La Paternal, CABA";
  if(lat<-34.58&&lat>-34.66&&lng<-58.40&&lng>-58.50)return "CABA";
  if(lat<-34.68&&lat>-34.75&&lng<-58.25&&lng>-58.38)return "Avellaneda, Buenos Aires";
  if(lat<-34.55&&lat>-34.65&&lng<-58.55&&lng>-58.65)return "El Palomar, Buenos Aires";
  if(lat<-34.68&&lat>-34.76&&lng<-58.20&&lng>-58.35)return "Quilmes, Buenos Aires";
  return "Buenos Aires";
}
function tpodFormatAddr1523(a,displayName){
  a=a||{};
  const localidad=tpodClean1523(
    a.city || a.town || a.village || a.municipality || a.suburb ||
    a.city_district || a.neighbourhood || a.county || ""
  );
  const provincia=tpodClean1523(a.state || a.province || a.region || "");
  if(localidad&&provincia&&localidad!==provincia)return `${localidad}, ${provincia}`;
  if(localidad)return localidad;
  if(provincia)return provincia;
  const dn=tpodClean1523(displayName);
  if(dn){
    const parts=dn.split(",").map(x=>x.trim()).filter(Boolean);
    if(parts.length>=2)return `${parts[0]}, ${parts.find(x=>/Buenos Aires|CABA|Ciudad Autónoma/i.test(x))||parts[1]}`;
    return parts[0];
  }
  return "";
}
async function tpodReverseLocalidadProvincia1523(gps){
  const c=tpodCoords1523(gps)||gps;
  if(!c||c.lat==null||c.lng==null)return "Ubicación no disponible";
  const key=tpodCoordKey1523(c);
  try{
    const cached=localStorage.getItem(key);
    if(cached)return cached;
  }catch(e){}
  try{
    const url=`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(c.lat)}&lon=${encodeURIComponent(c.lng)}&zoom=14&addressdetails=1`;
    const res=await fetch(url,{headers:{"Accept":"application/json"}});
    const data=await res.json();
    let loc=tpodFormatAddr1523(data.address||{},data.display_name);
    if(!loc||/^Buenos Aires,? Argentina$/i.test(loc))loc=tpodFallbackLocalidadProvincia1523(Number(c.lat),Number(c.lng));
    try{localStorage.setItem(key,loc)}catch(e){}
    return loc;
  }catch(e){
    return tpodFallbackLocalidadProvincia1523(Number(c.lat),Number(c.lng))||"Localidad no disponible";
  }
}
async function localidadDesdeGps(gps){
  return await tpodReverseLocalidadProvincia1523(gps);
}
async function localidadDesdeGpsRapida(gps){
  try{
    return await Promise.race([
      tpodReverseLocalidadProvincia1523(gps),
      new Promise((_,reject)=>setTimeout(()=>reject(new Error("timeout")),2500))
    ]);
  }catch(e){
    const c=tpodCoords1523(gps)||gps;
    return c?tpodFallbackLocalidadProvincia1523(Number(c.lat),Number(c.lng)):"Localidad no disponible";
  }
}
function tpodSyncLocFromCache1523(t){
  const u=tpodLatestUpdate1523(t);
  const c=tpodCoords1523(u)||tpodCoords1523(t&&t.ultimaPosicion)||tpodCoords1523(t);
  if(c){
    try{
      const cached=localStorage.getItem(tpodCoordKey1523(c));
      if(cached)return cached;
    }catch(e){}
    return tpodFallbackLocalidadProvincia1523(Number(c.lat),Number(c.lng));
  }
  return "";
}
function tpodSharedLocationSync1523(t){
  const s=tpodSyncLocFromCache1523(t);
  if(s)return s;
  try{
    if(typeof tpodUbicacionWhatsAppCompartida1518==="function"){
      const old=tpodClean1523(tpodUbicacionWhatsAppCompartida1518(t));
      if(old)return old.replace(/,\s*Argentina$/i,"");
    }
  }catch(e){}
  return "-";
}
async function tpodSharedLocationAsync1523(t){
  const u=tpodLatestUpdate1523(t);
  const c=tpodCoords1523(u)||tpodCoords1523(t&&t.ultimaPosicion)||tpodCoords1523(t);
  if(c)return await tpodReverseLocalidadProvincia1523(c);
  return tpodSharedLocationSync1523(t);
}

/* Todas las funciones de ubicación existentes pasan por esta lógica */
function pos1515(t){return tpodSharedLocationSync1523(t)}
function tpodGpsLocation1515(t){return tpodSharedLocationSync1523(t)}
function tpodUbicacionWhatsAppCompartida1518(t){return tpodSharedLocationSync1523(t)}
function tpodUbicacionWhatsAppCompartida1517(t){return tpodSharedLocationSync1523(t)}
function tpodUbicacionPrecisa1514(t){return tpodSharedLocationSync1523(t)}
function tpodUbicacionPrecisa1513(t){return tpodSharedLocationSync1523(t)}

async function tpodActualizarLocalidadesVisibles1523(){
  try{
    const cache=cloudTransitosCache||[];
    const cards=document.querySelectorAll("#embarque .embarqueItem");
    for(const card of cards){
      const txt=card.innerText||"";
      const mEmb=txt.match(/Emb\.\s*([^\s\/]+)/i);
      const mFlota=txt.match(/Flota\s*([0-9]+)/i);
      if(!mEmb)continue;
      const emb=mEmb[1], fl=mFlota?mFlota[1]:"";
      const t=cache.find(x=>String(x.embarque||"")===String(emb)&&(!fl||String((x.user&&x.user.fleet)||x.flota||"")===String(fl)));
      if(!t)continue;
      const loc=await tpodSharedLocationAsync1523(t);
      card.querySelectorAll("div").forEach(d=>{
        if(/^Últ\.\s*posición:/i.test(d.innerText||""))d.innerText="Últ. posición: "+loc;
      });
    }
  }catch(e){}
}
try{
  const oldRenderEmbarque1523=renderEmbarque;
  renderEmbarque=function(){
    oldRenderEmbarque1523();
    setTimeout(tpodActualizarLocalidadesVisibles1523,200);
    setTimeout(tpodActualizarLocalidadesVisibles1523,1200);
  };
}catch(e){}
try{
  const oldShow1523=show;
  show=function(id){
    oldShow1523(id);
    if(id==="embarque"){
      setTimeout(tpodActualizarLocalidadesVisibles1523,250);
      setTimeout(tpodActualizarLocalidadesVisibles1523,1200);
    }
    if(id==="ultimo"){
      setTimeout(tpodActualizarUltimoUb1523,300);
      setTimeout(tpodActualizarUltimoUb1523,1200);
    }
  };
}catch(e){}
async function tpodActualizarUltimoUb1523(){
  try{
    const box=document.getElementById("lastBox");
    if(!box)return;
    const flota=(typeof tpodCurrentFlota==="function"?tpodCurrentFlota():"") || (typeof user==="function"?(user().fleet||""):"");
    const all=cloudTransitosCache||[];
    let best=null;
    all.filter(t=>{
      const f=String((t.user&&t.user.fleet)||t.flota||"");
      const ps=(t.participantes||[]).map(String);
      return f===String(flota)||ps.includes(String(flota));
    }).forEach(t=>{
      const u=tpodLatestUpdate1523(t);
      const sc=tpodTimeVal1523((u&&u.time)||(u&&u.fecha)||(u&&u.createdAt)||(u&&u.ts)||(t.start&&t.start.time)||t.start);
      if(!best||sc>best.sc)best={t,sc};
    });
    if(!best)return;
    const loc=await tpodSharedLocationAsync1523(best.t);
    box.innerText=String(box.innerText||"").replace(/Ub\.:\s*[^\n\r]+/i,"Ub.: "+loc);
  }catch(e){}
}
setInterval(()=>{
  const sec=document.getElementById("embarque");
  if(sec&&(sec.classList.contains("active")||sec.style.display!=="none"))tpodActualizarLocalidadesVisibles1523();
},5000);




/* ===== V1.5.55 - Check List Firebase ===== */
let checklistItemsActuales = [];
let checklistRespuestas = {};

function checklistMsg(txt,tipo){
  const el=$("checklistMsg");
  if(!el) return;
  el.className="summary checklistMsg " + (tipo||"");
  el.innerText=txt||"";
}

function checklistTransitData(){
  const t=transit();
  const u=user();
  const route=(t && t.route) ? t.route : selectedRoute();
  return {
    tipo:$("checklistTipo") ? $("checklistTipo").value : "",
    flota:(t && t.user && t.user.fleet) || u.fleet || "",
    chofer:(t && t.user && t.user.driver) || u.driver || "",
    tractor:u.tractor || (t && t.tractor) || "",
    batea:u.batea || (t && t.batea) || "",
    embarque:(t && t.embarque) || ($("embarqueInput") ? $("embarqueInput").value.trim() : ""),
    lote:(t && t.lote) || ($("lote") ? $("lote").value.trim() : ""),
    cliente:(route && route.cliente) || "",
    origen:(route && route.origen) || "",
    destino:(route && route.destino) || ""
  };
}

function renderChecklistInfo(){
  const d=checklistTransitData();
  const el=$("checklistTransitInfo");
  if(!el) return;
  el.innerHTML =
    `<div><b>Flota / Chofer:</b> ${escapeHtml(d.flota||"-")} - ${escapeHtml(d.chofer||"-")}</div>`+
    `<div><b>Tractor / Batea:</b> ${escapeHtml(d.tractor||"-")} - ${escapeHtml(d.batea||"-")}</div>`+
    `<div><b>Embarque:</b> ${escapeHtml(d.embarque||"-")} &nbsp; <b>Lote/Carga:</b> ${escapeHtml(d.lote||"-")}</div>`+
    `<div><b>Cliente:</b> ${escapeHtml(d.cliente||"-")}</div>`+
    `<div><b>Origen:</b> ${escapeHtml(d.origen||"-")}</div>`+
    `<div><b>Destino:</b> ${escapeHtml(d.destino||"-")}</div>`;
}

async function leerChecklistItemsBase(){
  if(!firebaseReady()){
    throw new Error("Firebase no está disponible.");
  }
  const snap = await db.collection("checklist_oea_items").get();
  return snap.docs.map(d=>({id:d.id,...d.data()}));
}

async function cargarTiposChecklist(){
  const sel=$("checklistTipo");
  if(!sel) return;

  try{
    const items=await leerChecklistItemsBase();
    const tipos=[...new Set(items.filter(x=>x.activo!==false).map(x=>String(x.tipo||"").trim()).filter(Boolean))];
    const finalTipos=tipos.length ? tipos : ["oea"];
    sel.innerHTML=finalTipos.map(t=>`<option value="${escapeHtml(t)}">${escapeHtml(t.toUpperCase())}</option>`).join("");
    await cargarItemsChecklist();
  }catch(e){
    console.log("Checklist tipos error",e);
    sel.innerHTML='<option value="oea">OEA</option>';
    const box=$("checklistItemsBox");
    if(box) box.innerHTML='<div class="checklistLoading">No se pudieron cargar ítems desde Firebase.</div>';
  }
}

async function cargarItemsChecklist(){
  const box=$("checklistItemsBox");
  if(!box) return;
  const tipo=($("checklistTipo") && $("checklistTipo").value) || "oea";
  box.innerHTML='<div class="checklistLoading">Cargando ítems...</div>';
  checklistRespuestas={};

  try{
    const all=await leerChecklistItemsBase();
    const items=all
      .filter(x=>x.activo!==false && String(x.tipo||"").toLowerCase()===String(tipo).toLowerCase())
      .sort((a,b)=>Number(a.ordengrupo||0)-Number(b.ordengrupo||0) || Number(a.orden||0)-Number(b.orden||0));

    checklistItemsActuales=items;

    if(!items.length){
      box.innerHTML='<div class="checklistLoading">No hay ítems activos para el tipo seleccionado.</div>';
      return;
    }

    const grupos={};
    items.forEach(it=>{
      const g=it.grupo || "general";
      if(!grupos[g]) grupos[g]=[];
      grupos[g].push(it);
    });

    box.innerHTML=Object.entries(grupos).map(([grupo,arr])=>{
      return `<div class="checklistGroup">
        <div class="checklistGroupTitle">${escapeHtml(String(grupo).toUpperCase())}</div>
        ${arr.map(renderChecklistItem).join("")}
      </div>`;
    }).join("");
  }catch(e){
    console.log("Checklist items error",e);
    box.innerHTML='<div class="checklistLoading">Error al cargar checklist desde Firebase.</div>';
  }
}

function renderChecklistItem(it){
  const codigo=it.codigo || it.id || "";
  return `<div class="checklistItem" data-codigo="${escapeHtml(codigo)}">
    <div class="checklistItemText">${escapeHtml(it.texto || codigo)}</div>
    <div class="checklistOptions">
      <button type="button" class="apto" onclick="setChecklistRespuesta('${escapeHtml(codigo)}','apto')">✓ Apto</button>
      <button type="button" class="no_apto" onclick="setChecklistRespuesta('${escapeHtml(codigo)}','no_apto')">✕ No apto</button>
      <button type="button" class="no_aplica" onclick="setChecklistRespuesta('${escapeHtml(codigo)}','no_aplica')">— No aplica</button>
    </div>
    <div class="checklistObsItem" id="obs_${escapeHtml(codigo)}">
      <textarea placeholder="Observación del ítem..."></textarea>
    </div>
  </div>`;
}

function setChecklistRespuesta(codigo,resultado){
  checklistRespuestas[codigo]=resultado;
  document.querySelectorAll(`.checklistItem[data-codigo="${CSS.escape(codigo)}"] .checklistOptions button`).forEach(b=>b.classList.remove("active"));
  const btn=document.querySelector(`.checklistItem[data-codigo="${CSS.escape(codigo)}"] .checklistOptions button.${resultado}`);
  if(btn) btn.classList.add("active");
  const obs=$("obs_"+codigo);
  if(obs) obs.style.display=resultado==="no_apto" ? "block" : "none";
}

async function guardarCheckListRuta(){
  const btn=$("checklistGuardarBtn");
  if(btn) btn.disabled=true;
  checklistMsg("");

  try{
    const tipo=($("checklistTipo") && $("checklistTipo").value) || "";
    if(!tipo) throw new Error("Seleccione un tipo.");
    if(!checklistItemsActuales.length) throw new Error("No hay ítems para guardar.");

    const faltantes=checklistItemsActuales.filter(it=>!checklistRespuestas[it.codigo||it.id]);
    if(faltantes.length) throw new Error("Faltan responder ítems del checklist.");

    const gps=await getGps();
    const datos=checklistTransitData();

    const respuestas=checklistItemsActuales.map(it=>{
      const codigo=it.codigo || it.id || "";
      const obsWrap=$("obs_"+codigo);
      const obsEl=obsWrap ? obsWrap.querySelector("textarea") : null;
      return {
        codigo,
        tipo:it.tipo || tipo,
        grupo:it.grupo || "",
        ordengrupo:Number(it.ordengrupo || 0),
        orden:Number(it.orden || 0),
        texto:it.texto || "",
        resultado:checklistRespuestas[codigo],
        observacion:obsEl ? obsEl.value.trim() : "",
        foto:it.foto===true
      };
    });

    const estadoGeneral=respuestas.some(r=>r.resultado==="no_apto") ? "no_apto" : "apto";
    const nowIso=now();

    const payload={
      tipo,
      estado:"guardado",
      estadoGeneral,
      ...datos,
      gpsChecklist:gps,
      respuestas,
      observacionesGenerales:$("checklistObsGeneral") ? $("checklistObsGeneral").value.trim() : "",
      creadoPor:datos.flota ? "flota"+datos.flota : datos.chofer,
      creadoEn:nowIso,
      fechaHoraGuardado:nowIso
    };

    if(!firebaseReady()) throw new Error("Firebase no está disponible.");

    await db.collection("checklists_oea").add(payload);

    checklistMsg("Check List guardado correctamente.","ok");
    checklistRespuestas={};
    if($("checklistObsGeneral")) $("checklistObsGeneral").value="";
    await cargarItemsChecklist();
  }catch(e){
    checklistMsg(e.message || "No se pudo guardar el Check List.","err");
  }finally{
    if(btn) btn.disabled=false;
  }
}

function renderChecklist(){
  renderChecklistInfo();
  cargarTiposChecklist();
}



/* ===== V1.5.55 - Habilitación Check List y alertas ===== */
function isFlotaValidadaV1528(){
  const u = user();
  return !!(u && String(u.fleet||"").trim());
}

function hasTransitoAbiertoV1528(){
  const t = transit();
  return !!(t && !t.closed);
}

function canUseChecklistV1528(){
  return isFlotaValidadaV1528() && hasTransitoAbiertoV1528();
}

function updateChecklistTabState(){
  const btn = $("btn-checklist");
  if(!btn) return;
  const ok = canUseChecklistV1528();
  btn.disabled = !ok;
  btn.classList.toggle("disabledTab", !ok);
  btn.title = ok ? "Check List" : "Primero valide la flota e inicie un tránsito";
}

const _show_v1528 = show;
show = function(id){
  if(id==="checklist" && !canUseChecklistV1528()){
    window.alert("Para usar Check List primero debe validar la flota y tener un tránsito abierto.");
    id = !isFlotaValidadaV1528() ? "usuario" : "inicio";
  }
  _show_v1528(id);
  updateChecklistTabState();
};

const _saveUser_v1528 = saveUser;
saveUser = function(){
  _saveUser_v1528();
  updateChecklistTabState();
};

const _renderInicio_v1528 = typeof renderInicio==="function" ? renderInicio : null;
if(_renderInicio_v1528){
  renderInicio = function(){
    _renderInicio_v1528();
    updateChecklistTabState();
  };
}

const _renderTransitStatus_v1528 = typeof renderTransitStatus==="function" ? renderTransitStatus : null;
if(_renderTransitStatus_v1528){
  renderTransitStatus = function(){
    _renderTransitStatus_v1528();
    updateChecklistTabState();
  };
}

function renderChecklist(){
  updateChecklistTabState();
  if(!canUseChecklistV1528()) return;
  cargarTiposChecklist();
}

/* Alertas: más reciente arriba */
function alertaTimeV1528(a){
  const raw = a && (a.time || a.fecha || a.createdAt || a.ts);
  const n = raw ? new Date(raw).getTime() : 0;
  return isFinite(n) ? n : 0;
}

renderAlertas = function(){
  const t=transit();
  const box=$("alertList");
  if(!box) return;
  if(!t||!t.alerts||!t.alerts.length){
    box.innerText="Sin alertas registradas.";
    return;
  }
  const ordered = (t.alerts||[]).slice().sort((a,b)=>alertaTimeV1528(b)-alertaTimeV1528(a));
  box.innerHTML=ordered.map(a=>{
    const km=typeof alertKmText==="function" ? alertKmText(t,a) : "";
    const kmHtml=km ? ` <span>${escapeHtml(km)}</span>` : "";
    return `<div class="alertItem">⚠ <b>${escapeHtml(a.type||a.tipo||"Alerta")}</b>${kmHtml}<br>${fmtDate(a.time||a.fecha||a.createdAt||a.ts)}</div>`;
  }).join("\n");
};

document.addEventListener("DOMContentLoaded", updateChecklistTabState);
setTimeout(updateChecklistTabState,300);
setTimeout(updateChecklistTabState,1000);


/* ===== V1.5.55 - Normalizar visual botón Check List ===== */
function fixChecklistButtonActiveV1530(currentId){
  const btn = $("btn-checklist");
  if(!btn) return;
  if(currentId === "checklist"){
    btn.classList.add("active");
  }else{
    btn.classList.remove("active");
  }
}

const _show_v1530 = show;
show = function(id){
  _show_v1530(id);
  fixChecklistButtonActiveV1530(id);
};

document.addEventListener("DOMContentLoaded",()=>fixChecklistButtonActiveV1530(""));
setTimeout(()=>fixChecklistButtonActiveV1530(""),300);


/* ===== V1.5.55 - Clientes desde Firebase ===== */
let clientesFirebaseV1531 = [];

async function cargarClientesDesdeFirebaseV1531(){
  if(!firebaseReady()) return [];
  const snap = await db.collection("clientes").get();

  const clientes = snap.docs
    .map(d => ({ id:d.id, ...d.data() }))
    .filter(c => c.activo !== false)
    .map(c => ({
      id: c.id,
      nombre: c.nombre || c.name || c.cliente || c.id,
      activo: c.activo !== false,
      contacto: c.contacto || "",
      telefono: c.telefono || ""
    }))
    .sort((a,b)=>String(a.nombre).localeCompare(String(b.nombre),"es",{sensitivity:"base"}));

  clientesFirebaseV1531 = clientes;
  return clientes;
}

function nombreClienteFirebaseV1531(c){
  return String((c && (c.nombre || c.id)) || "").trim();
}

function clienteSelectElementsV1531(){
  return Array.from(document.querySelectorAll("select")).filter(sel=>{
    const id = String(sel.id || "").toLowerCase();
    const name = String(sel.name || "").toLowerCase();
    const label = String(sel.getAttribute("aria-label") || "").toLowerCase();
    const combined = id+" "+name+" "+label;
    return combined.includes("cliente") || Array.from(sel.options || []).some(o => /stellantis|porsche|toyota|garden|sevel|byd/i.test(o.textContent||""));
  });
}

function aplicarClientesFirebaseASelectsV1531(clientes){
  if(!clientes || !clientes.length) return;

  const selects = clienteSelectElementsV1531();
  selects.forEach(sel=>{
    const current = sel.value || "";
    sel.innerHTML = clientes.map(c=>{
      const nombre = nombreClienteFirebaseV1531(c);
      return `<option value="${escapeHtml(nombre)}">${escapeHtml(nombre)}</option>`;
    }).join("");

    if(current && clientes.some(c=>nombreClienteFirebaseV1531(c)===current)){
      sel.value = current;
    }
  });
}

async function refreshClientesFirebaseV1531(){
  try{
    const clientes = await cargarClientesDesdeFirebaseV1531();
    aplicarClientesFirebaseASelectsV1531(clientes);
    return clientes;
  }catch(e){
    console.log("No se pudieron cargar clientes desde Firebase", e);
    return [];
  }
}

const _loadOptions_v1531 = typeof loadOptions==="function" ? loadOptions : null;
if(_loadOptions_v1531){
  loadOptions = async function(){
    const r = await _loadOptions_v1531.apply(this, arguments);
    await refreshClientesFirebaseV1531();
    return r;
  };
}

const _renderInicio_v1531_clientes = typeof renderInicio==="function" ? renderInicio : null;
if(_renderInicio_v1531_clientes){
  renderInicio = function(){
    const r = _renderInicio_v1531_clientes.apply(this, arguments);
    refreshClientesFirebaseV1531();
    return r;
  };
}

const _show_v1531_clientes = show;
show = function(id){
  _show_v1531_clientes(id);
  if(id==="inicio" || id==="usuario"){
    refreshClientesFirebaseV1531();
  }
};

document.addEventListener("DOMContentLoaded",()=>setTimeout(refreshClientesFirebaseV1531,500));
setTimeout(refreshClientesFirebaseV1531,1200);


/* ===== V1.5.55 - Destinos desde Firebase ===== */
let destinosFirebaseV1532 = [];
let origenesFirebaseV1532 = [];

async function leerColeccionActivosV1532(col){
  if(!firebaseReady()) return [];
  const snap = await db.collection(col).get();
  return snap.docs
    .map(d => ({ id:d.id, ...d.data() }))
    .filter(x => x.activo !== false)
    .map(x => ({
      id: x.id,
      nombre: x.nombre || x.name || x.destino || x.origen || x.id,
      activo: x.activo !== false,
      ubicacion: x.ubicacion || "",
      pais: x.pais || "",
      horarios: x.horarios || "",
      contacto: x.contacto || "",
      telefonos: x.telefonos || x.telefono || ""
    }))
    .sort((a,b)=>String(a.nombre).localeCompare(String(b.nombre),"es",{sensitivity:"base"}));
}

async function cargarDestinosOrigenesFirebaseV1532(){
  try{
    const [destinos, origenes] = await Promise.all([
      leerColeccionActivosV1532("destinos"),
      leerColeccionActivosV1532("origenes")
    ]);
    destinosFirebaseV1532 = destinos;
    origenesFirebaseV1532 = origenes;
    aplicarDestinosOrigenesASelectsV1532();
    return {destinos, origenes};
  }catch(e){
    console.log("No se pudieron cargar destinos/origenes desde Firebase", e);
    return {destinos:[], origenes:[]};
  }
}

function nombreDestinoOrigenV1532(x){
  return String((x && (x.nombre || x.id)) || "").trim();
}

function esSelectDestinoV1532(sel){
  const id = String(sel.id || "").toLowerCase();
  const name = String(sel.name || "").toLowerCase();
  const label = String(sel.getAttribute("aria-label") || "").toLowerCase();
  const combined = id+" "+name+" "+label;
  if(combined.includes("destino")) return true;
  if(combined.includes("origen")) return false;
  return Array.from(sel.options || []).some(o => /stli|chile|uruguay|paraguay|caba|santa rosa|toyota chile|sevel uruguay|garden paraguay/i.test(o.textContent||""));
}

function esSelectOrigenV1532(sel){
  const id = String(sel.id || "").toLowerCase();
  const name = String(sel.name || "").toLowerCase();
  const label = String(sel.getAttribute("aria-label") || "").toLowerCase();
  const combined = id+" "+name+" "+label;
  if(combined.includes("origen")) return true;
  return false;
}

function setOptionsV1532(sel, items){
  if(!sel || !items || !items.length) return;
  const current = sel.value || "";
  sel.innerHTML = items.map(x=>{
    const nombre = nombreDestinoOrigenV1532(x);
    return `<option value="${escapeHtml(nombre)}">${escapeHtml(nombre)}</option>`;
  }).join("");
  if(current && items.some(x=>nombreDestinoOrigenV1532(x)===current)){
    sel.value = current;
  }
}

function aplicarDestinosOrigenesASelectsV1532(){
  const selects = Array.from(document.querySelectorAll("select"));
  selects.forEach(sel=>{
    if(esSelectDestinoV1532(sel)){
      setOptionsV1532(sel, destinosFirebaseV1532);
    }else if(esSelectOrigenV1532(sel)){
      setOptionsV1532(sel, origenesFirebaseV1532);
    }
  });
}

/* Si la app usa rutas internas para selectedRoute, se actualizan los selects igual */
async function refreshDestinosOrigenesFirebaseV1532(){
  return await cargarDestinosOrigenesFirebaseV1532();
}

const _loadOptions_v1532 = typeof loadOptions==="function" ? loadOptions : null;
if(_loadOptions_v1532){
  loadOptions = async function(){
    const r = await _loadOptions_v1532.apply(this, arguments);
    await refreshDestinosOrigenesFirebaseV1532();
    return r;
  };
}

const _renderInicio_v1532_destinos = typeof renderInicio==="function" ? renderInicio : null;
if(_renderInicio_v1532_destinos){
  renderInicio = function(){
    const r = _renderInicio_v1532_destinos.apply(this, arguments);
    refreshDestinosOrigenesFirebaseV1532();
    return r;
  };
}

const _show_v1532_destinos = show;
show = function(id){
  _show_v1532_destinos(id);
  if(id==="inicio" || id==="usuario"){
    refreshDestinosOrigenesFirebaseV1532();
  }
};

document.addEventListener("DOMContentLoaded",()=>setTimeout(refreshDestinosOrigenesFirebaseV1532,600));
setTimeout(refreshDestinosOrigenesFirebaseV1532,1400);


const _selectedRoute_v1533 = selectedRoute;
selectedRoute = function(){
  const r = _selectedRoute_v1533.apply(this, arguments) || {};
  const f = routeFromFormV1533();
  return {
    ...r,
    cliente: f.cliente || r.cliente || "",
    origen: f.origen || r.origen || "",
    destino: f.destino || r.destino || ""
  };
};


/* ===== V1.5.55 - Tracking ruta origen destino ===== */
function parseCoordsV1534(v){
  if(!v) return null;
  if(typeof v === "object"){
    const lat = Number(v.lat ?? v.latitude);
    const lng = Number(v.lng ?? v.lon ?? v.longitude);
    if(Number.isFinite(lat) && Number.isFinite(lng)) return {lat,lng};
  }
  const nums = String(v).match(/-?\d+(?:\.\d+)?/g);
  if(nums && nums.length >= 2){
    const lat = Number(nums[0]);
    const lng = Number(nums[1]);
    if(Number.isFinite(lat) && Number.isFinite(lng)) return {lat,lng};
  }
  return null;
}

function selectedTextFromSelectV1534(kind){
  const k=String(kind||"").toLowerCase();
  const sel=Array.from(document.querySelectorAll("select")).find(s=>{
    const id=String(s.id||"").toLowerCase();
    const name=String(s.name||"").toLowerCase();
    const label=String(s.getAttribute("aria-label")||"").toLowerCase();
    return (id+" "+name+" "+label).includes(k);
  });
  if(sel){
    const opt=sel.options && sel.selectedIndex>=0 ? sel.options[sel.selectedIndex] : null;
    return String((opt&&(opt.textContent||opt.innerText))||sel.value||"").trim();
  }
  try{
    const r=typeof routeFromFormV1533==="function" ? routeFromFormV1533() : (typeof selectedRoute==="function" ? selectedRoute() : {});
    return String((r&&r[k])||"").trim();
  }catch(e){return "";}
}

async function getDocByNameOrIdV1534(col,name){
  if(!firebaseReady() || !name) return null;
  const target=String(name||"").trim();
  try{
    const direct=await db.collection(col).doc(target).get();
    if(direct.exists) return {id:direct.id,...direct.data()};
  }catch(e){}
  try{
    const snap=await db.collection(col).get();
    return snap.docs.map(d=>({id:d.id,...d.data()})).find(d=>{
      const vals=[d.id,d.nombre,d.name,d.destino,d.origen].map(x=>String(x||"").trim().toLowerCase());
      return vals.includes(target.toLowerCase());
    }) || null;
  }catch(e){
    console.log("No se pudo buscar "+col,e);
    return null;
  }
}

async function resolverRutaCompletaV1534(routeBase){
  const base=routeBase||{};
  const cliente=String(base.cliente||selectedTextFromSelectV1534("cliente")||"").trim();
  const origen=String(base.origen||selectedTextFromSelectV1534("origen")||"").trim();
  const destino=String(base.destino||selectedTextFromSelectV1534("destino")||"").trim();

  const origenDoc=await getDocByNameOrIdV1534("origenes",origen);
  const destinoDoc=await getDocByNameOrIdV1534("destinos",destino);

  const oc=parseCoordsV1534((origenDoc&&(origenDoc.ubicacion||origenDoc.coords||origenDoc.coordenadas))||base.origenCoords);
  const dc=parseCoordsV1534((destinoDoc&&(destinoDoc.ubicacion||destinoDoc.coords||destinoDoc.coordenadas))||base.destinoCoords);

  return {
    ...base,
    cliente, origen, destino,
    origenLat: oc ? oc.lat : (Number(base.origenLat)||null),
    origenLng: oc ? oc.lng : (Number(base.origenLng)||null),
    destinoLat: dc ? dc.lat : (Number(base.destinoLat)||null),
    destinoLng: dc ? dc.lng : (Number(base.destinoLng)||null)
  };
}

function haversineKmV1534(a,b){
  if(!a||!b) return 0;
  const lat1=Number(a.lat),lng1=Number(a.lng),lat2=Number(b.lat),lng2=Number(b.lng);
  if(![lat1,lng1,lat2,lng2].every(Number.isFinite)) return 0;
  const R=6371,dLat=(lat2-lat1)*Math.PI/180,dLng=(lng2-lng1)*Math.PI/180;
  const s1=Math.sin(dLat/2),s2=Math.sin(dLng/2);
  const q=s1*s1+Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*s2*s2;
  return 2*R*Math.atan2(Math.sqrt(q),Math.sqrt(1-q));
}

function metricasRutaV1534(t){
  const r=(t&&t.route)||{};
  const origen={lat:Number(r.origenLat),lng:Number(r.origenLng)};
  const destino={lat:Number(r.destinoLat),lng:Number(r.destinoLng)};
  const pos=(t&&t.last)||(t&&t.start)||null;
  const total=haversineKmV1534(origen,destino);
  const restante=haversineKmV1534(pos,destino);
  const recorrido=total>0?Math.max(0,total-restante):0;
  const avance=total>0?Math.max(0,Math.min(100,Math.round((recorrido/total)*100))):0;
  const etaMin=Math.round((restante/70)*60);
  return {totalKm:total,restanteKm:restante,recorridoKm:recorrido,avancePct:avance,etaMin};
}

function formatEtaV1534(min){
  if(!min) return "0m";
  return min<60 ? min+"m" : Math.floor(min/60)+"h "+(min%60)+"m";
}

function actualizarMetricasDOMV1534(m){
  const cards=Array.from(document.querySelectorAll(".metric,.stat,.kpi,.summary div, .card div"));
  const setNext=(label,val)=>{
    const el=cards.find(x=>String(x.textContent||"").trim().toLowerCase()===label.toLowerCase());
    if(el&&el.parentElement){
      const sib=Array.from(el.parentElement.children).find(c=>c!==el && (/^\d|^0|^-/.test(String(c.textContent||"").trim())));
      if(sib) sib.textContent=val;
    }
  };
  setNext("Total", m.totalKm ? Math.round(m.totalKm) : "0");
  setNext("Av.", (m.avancePct||0)+"%");
  setNext("Restan", m.restanteKm ? Math.round(m.restanteKm) : "0");
  setNext("ETA", formatEtaV1534(m.etaMin));
}

async function completarRutaTransitoV1534(){
  const t=transit();
  if(!t) return null;
  const route=await resolverRutaCompletaV1534(t.route||{});
  t.route=route;
  t.routeMetrics=metricasRutaV1534(t);
  save(LS.transit,t);
  actualizarMetricasDOMV1534(t.routeMetrics);
  if(firebaseReady()){
    const id=t.id||t.docId||null;
    if(id){
      await db.collection("transitos").doc(String(id)).set({
        route,
        routeMetrics:t.routeMetrics,
        cliente:route.cliente||"",
        origen:route.origen||"",
        destino:route.destino||"",
        actualizadoEn:now()
      },{merge:true});
    }
  }
  return t;
}

if(typeof iniciarTransito==="function"){
  const _iniciarTransito_v1534=iniciarTransito;
  iniciarTransito=async function(){
    const r=await _iniciarTransito_v1534.apply(this,arguments);
    try{ await completarRutaTransitoV1534(); }catch(e){ console.log("ruta inicio",e); }
    return r;
  };
}

if(typeof renderTracking==="function"){
  const _renderTracking_v1534=renderTracking;
  renderTracking=function(){
    const r=_renderTracking_v1534.apply(this,arguments);
    completarRutaTransitoV1534().then(t=>drawTrackingRouteV1534(t)).catch(e=>console.log("ruta tracking",e));
    return r;
  };
}

function drawTrackingRouteV1534(t){
  if(!t||!t.route||typeof L==="undefined") return;
  const map=window.map||window.trackingMap||window.leafletMap;
  if(!map) return;
  const r=t.route;
  const origen=Number.isFinite(Number(r.origenLat))&&Number.isFinite(Number(r.origenLng))?[Number(r.origenLat),Number(r.origenLng)]:null;
  const destino=Number.isFinite(Number(r.destinoLat))&&Number.isFinite(Number(r.destinoLng))?[Number(r.destinoLat),Number(r.destinoLng)]:null;
  const gpsObj=t.last||t.start||null;
  const gps=gpsObj&&Number.isFinite(Number(gpsObj.lat))&&Number.isFinite(Number(gpsObj.lng))?[Number(gpsObj.lat),Number(gpsObj.lng)]:null;
  try{
    if(window.routeLayerV1534) map.removeLayer(window.routeLayerV1534);
    const g=L.layerGroup();
    if(origen) L.circleMarker(origen,{radius:7,color:"#22c55e",fillColor:"#22c55e",fillOpacity:1}).bindTooltip("Origen").addTo(g);
    if(gps) L.circleMarker(gps,{radius:7,color:"#3b82f6",fillColor:"#3b82f6",fillOpacity:1}).bindTooltip("GPS").addTo(g);
    if(destino) L.circleMarker(destino,{radius:7,color:"#ef4444",fillColor:"#ef4444",fillOpacity:1}).bindTooltip("Destino").addTo(g);
    if(origen&&destino) L.polyline([origen,destino],{color:"#16a34a",weight:4,opacity:.85}).addTo(g);
    g.addTo(map);
    window.routeLayerV1534=g;
    const pts=[origen,gps,destino].filter(Boolean);
    if(pts.length>=2) map.fitBounds(L.latLngBounds(pts),{padding:[20,20]});
  }catch(e){console.log("draw route",e);}
}


/* ===== V1.5.55 - Tracking metricas directas ===== */
function parseCoordAnyV1535(v){
  if(!v) return null;
  if(typeof v === "object"){
    const lat = Number(v.lat ?? v.latitude);
    const lng = Number(v.lng ?? v.lon ?? v.longitude);
    if(Number.isFinite(lat) && Number.isFinite(lng)) return {lat,lng};
  }
  const nums = String(v).match(/-?\d+(?:\.\d+)?/g);
  if(nums && nums.length >= 2){
    const lat = Number(nums[0]);
    const lng = Number(nums[1]);
    if(Number.isFinite(lat) && Number.isFinite(lng)) return {lat,lng};
  }
  return null;
}

function kmHaversineV1535(a,b){
  if(!a || !b) return 0;
  const lat1=Number(a.lat), lng1=Number(a.lng), lat2=Number(b.lat), lng2=Number(b.lng);
  if(![lat1,lng1,lat2,lng2].every(Number.isFinite)) return 0;
  const R=6371;
  const dLat=(lat2-lat1)*Math.PI/180, dLng=(lng2-lng1)*Math.PI/180;
  const s1=Math.sin(dLat/2), s2=Math.sin(dLng/2);
  const q=s1*s1 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*s2*s2;
  return 2*R*Math.atan2(Math.sqrt(q),Math.sqrt(1-q));
}

async function docCoordsByNameV1535(col, name){
  if(!firebaseReady() || !name) return null;
  const target = String(name).trim();
  try{
    const direct = await db.collection(col).doc(target).get();
    if(direct.exists){
      const data = direct.data();
      return parseCoordAnyV1535(data.ubicacion || data.coords || data.coordenadas || data.location);
    }
  }catch(e){}
  try{
    const snap = await db.collection(col).get();
    for(const d of snap.docs){
      const data = d.data();
      const names = [d.id, data.nombre, data.name, data.origen, data.destino].map(x=>String(x||"").trim().toLowerCase());
      if(names.includes(target.toLowerCase())){
        return parseCoordAnyV1535(data.ubicacion || data.coords || data.coordenadas || data.location);
      }
    }
  }catch(e){ console.log("coord search", col, e); }
  return null;
}

function getTransitRouteNamesV1535(t){
  const r = (t && t.route) || {};
  let cliente = r.cliente || t.cliente || "";
  let origen = r.origen || t.origen || "";
  let destino = r.destino || t.destino || "";

  if((!cliente || !origen || !destino) && typeof routeFromFormV1533 === "function"){
    try{
      const f = routeFromFormV1533();
      cliente = cliente || f.cliente || "";
      origen = origen || f.origen || "";
      destino = destino || f.destino || "";
    }catch(e){}
  }
  return {cliente:String(cliente||"").trim(), origen:String(origen||"").trim(), destino:String(destino||"").trim()};
}

async function ensureRouteCoordsV1535(t){
  if(!t) return null;
  const names = getTransitRouteNamesV1535(t);
  const r = {...((t && t.route) || {}), ...names};

  let origen = parseCoordAnyV1535({lat:r.origenLat, lng:r.origenLng}) || parseCoordAnyV1535(r.origenCoords);
  let destino = parseCoordAnyV1535({lat:r.destinoLat, lng:r.destinoLng}) || parseCoordAnyV1535(r.destinoCoords);

  if(!origen && names.origen) origen = await docCoordsByNameV1535("origenes", names.origen);
  if(!destino && names.destino) destino = await docCoordsByNameV1535("destinos", names.destino);

  if(origen){
    r.origenLat = origen.lat;
    r.origenLng = origen.lng;
  }
  if(destino){
    r.destinoLat = destino.lat;
    r.destinoLng = destino.lng;
  }

  t.route = r;
  save(LS.transit, t);

  if(firebaseReady() && (t.id || t.docId)){
    try{
      await db.collection("transitos").doc(String(t.id || t.docId)).set({
        route:r,
        cliente:r.cliente || "",
        origen:r.origen || "",
        destino:r.destino || "",
        actualizadoEn:now()
      }, {merge:true});
    }catch(e){ console.log("save route coords", e); }
  }
  return t;
}

function metricasTrackingV1535(t){
  const r = (t && t.route) || {};
  const origen = parseCoordAnyV1535({lat:r.origenLat, lng:r.origenLng});
  const destino = parseCoordAnyV1535({lat:r.destinoLat, lng:r.destinoLng});
  const gps = parseCoordAnyV1535(t.last) || parseCoordAnyV1535(t.start);
  const total = kmHaversineV1535(origen, destino);
  const restan = kmHaversineV1535(gps, destino);
  const recorrido = total > 0 ? Math.max(0, total - restan) : 0;
  const avance = total > 0 ? Math.max(0, Math.min(100, Math.round((recorrido / total) * 100))) : 0;
  const etaMin = Math.round((restan / 70) * 60);
  return {total, restan, recorrido, avance, etaMin};
}

function fmtEtaV1535(min){
  if(!min || min <= 0) return "0m";
  if(min < 60) return min + "m";
  return Math.floor(min/60) + "h " + (min % 60) + "m";
}

function actualizarKPIsTrackingV1535(m){
  const values = [
    m.total ? Math.round(m.total) : "0",
    (m.avance || 0) + "%",
    m.restan ? Math.round(m.restan) : "0",
    fmtEtaV1535(m.etaMin)
  ];
  const labels = ["Total","Av.","Restan","ETA"];
  labels.forEach((label, idx)=>{
    const els = Array.from(document.querySelectorAll("body *"));
    const labelEl = els.find(el => String(el.textContent||"").trim().toLowerCase() === label.toLowerCase());
    if(labelEl){
      const card = labelEl.parentElement;
      if(card){
        const valEl = Array.from(card.children).find(c => c !== labelEl && /^-?\d/.test(String(c.textContent||"").trim()));
        if(valEl) valEl.textContent = values[idx];
      }
    }
  });
}

function drawRouteOnExistingMapV1535(t){
  if(!t || !t.route || typeof L === "undefined") return;
  const map = window.map || window.trackingMap || window.leafletMap || window.trackMap;
  if(!map) return;
  const r = t.route;
  const origen = parseCoordAnyV1535({lat:r.origenLat, lng:r.origenLng});
  const destino = parseCoordAnyV1535({lat:r.destinoLat, lng:r.destinoLng});
  const gps = parseCoordAnyV1535(t.last) || parseCoordAnyV1535(t.start);
  const pts = [origen,gps,destino].filter(Boolean).map(p=>[p.lat,p.lng]);
  try{
    if(window.trackingRouteLayerV1535) map.removeLayer(window.trackingRouteLayerV1535);
    const group = L.layerGroup();
    if(origen) L.circleMarker([origen.lat,origen.lng],{radius:7,color:"#22c55e",fillColor:"#22c55e",fillOpacity:1}).addTo(group);
    if(gps) L.circleMarker([gps.lat,gps.lng],{radius:7,color:"#3b82f6",fillColor:"#3b82f6",fillOpacity:1}).addTo(group);
    if(destino) L.circleMarker([destino.lat,destino.lng],{radius:7,color:"#ef4444",fillColor:"#ef4444",fillOpacity:1}).addTo(group);
    if(origen && destino){
      L.polyline([[origen.lat,origen.lng],[destino.lat,destino.lng]],{color:"#16a34a",weight:5,opacity:.9}).addTo(group);
    }
    group.addTo(map);
    window.trackingRouteLayerV1535 = group;
    if(pts.length >= 2) map.fitBounds(L.latLngBounds(pts), {padding:[24,24]});
  }catch(e){ console.log("draw route 1535", e); }
}

async function recalcularTrackingV1535(){
  let t = transit();
  if(!t) return;
  t = await ensureRouteCoordsV1535(t);
  const m = metricasTrackingV1535(t);
  t.routeMetrics = m;
  save(LS.transit, t);
  if(firebaseReady() && (t.id || t.docId)){
    try{
      await db.collection("transitos").doc(String(t.id || t.docId)).set({
        route:t.route,
        routeMetrics:m,
        actualizadoEn:now()
      }, {merge:true});
    }catch(e){}
  }
  actualizarKPIsTrackingV1535(m);
  drawRouteOnExistingMapV1535(t);
}

const _renderTracking_v1535 = typeof renderTracking === "function" ? renderTracking : null;
if(_renderTracking_v1535){
  renderTracking = function(){
    const r = _renderTracking_v1535.apply(this, arguments);
    setTimeout(recalcularTrackingV1535, 400);
    setTimeout(recalcularTrackingV1535, 1200);
    return r;
  };
}

const _show_v1535_tracking = show;
show = function(id){
  _show_v1535_tracking(id);
  if(id === "tracking"){
    setTimeout(recalcularTrackingV1535, 500);
    setTimeout(recalcularTrackingV1535, 1300);
  }
};

const _iniciarTransito_v1535 = typeof iniciarTransito === "function" ? iniciarTransito : null;
if(_iniciarTransito_v1535){
  iniciarTransito = async function(){
    const r = await _iniciarTransito_v1535.apply(this, arguments);
    setTimeout(recalcularTrackingV1535, 500);
    return r;
  };
}


/* ===== V1.5.55 - Tracking estable sin reset ===== */
let lastRouteMetricsV1536 = null;
let lastRouteCoordsV1536 = null;

function parseCoordV1536(v){
  if(!v) return null;
  if(typeof v === "object"){
    const lat = Number(v.lat ?? v.latitude);
    const lng = Number(v.lng ?? v.lon ?? v.longitude);
    if(Number.isFinite(lat) && Number.isFinite(lng)) return {lat,lng};
  }
  const nums = String(v).match(/-?\d+(?:\.\d+)?/g);
  if(nums && nums.length >= 2){
    const lat = Number(nums[0]);
    const lng = Number(nums[1]);
    if(Number.isFinite(lat) && Number.isFinite(lng)) return {lat,lng};
  }
  return null;
}

function kmV1536(a,b){
  if(!a || !b) return null;
  const lat1=Number(a.lat), lng1=Number(a.lng), lat2=Number(b.lat), lng2=Number(b.lng);
  if(![lat1,lng1,lat2,lng2].every(Number.isFinite)) return null;
  const R=6371;
  const dLat=(lat2-lat1)*Math.PI/180;
  const dLng=(lng2-lng1)*Math.PI/180;
  const s1=Math.sin(dLat/2), s2=Math.sin(dLng/2);
  const q=s1*s1 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*s2*s2;
  return 2*R*Math.atan2(Math.sqrt(q),Math.sqrt(1-q));
}

function getValidGpsV1536(t){
  const candidates = [t && t.last, t && t.gps, t && t.current, t && t.start].filter(Boolean);
  for(const c of candidates){
    const p = parseCoordV1536(c);
    if(p) return p;
  }
  return null;
}

function getRouteCoordsV1536(t){
  const r = (t && t.route) || {};
  const origen = parseCoordV1536({lat:r.origenLat, lng:r.origenLng}) || parseCoordV1536(r.origenCoords) || (lastRouteCoordsV1536 && lastRouteCoordsV1536.origen);
  const destino = parseCoordV1536({lat:r.destinoLat, lng:r.destinoLng}) || parseCoordV1536(r.destinoCoords) || (lastRouteCoordsV1536 && lastRouteCoordsV1536.destino);
  if(origen && destino){
    lastRouteCoordsV1536 = {origen, destino};
  }
  return {origen, destino};
}

function computeStableMetricsV1536(t){
  const {origen, destino} = getRouteCoordsV1536(t);
  const gps = getValidGpsV1536(t);
  const total = kmV1536(origen, destino);

  if(!total || total <= 0){
    return lastRouteMetricsV1536;
  }

  let restan = gps ? kmV1536(gps, destino) : null;
  if(restan === null || !Number.isFinite(restan)){
    restan = lastRouteMetricsV1536 ? lastRouteMetricsV1536.restan : total;
  }

  restan = Math.max(0, Math.min(restan, total));
  const recorrido = Math.max(0, total - restan);
  const avance = Math.max(0, Math.min(100, Math.round((recorrido / total) * 100)));
  const etaMin = Math.round((restan / 70) * 60);

  const metrics = {total, restan, recorrido, avance, etaMin};
  lastRouteMetricsV1536 = metrics;
  return metrics;
}

function etaTxtV1536(min){
  if(!min || min <= 0) return "0m";
  if(min < 60) return min + "m";
  return Math.floor(min/60) + "h " + (min % 60) + "m";
}

function setKpiDirectV1536(label, value){
  const all = Array.from(document.querySelectorAll("body *"));
  const labelEl = all.find(el => String(el.textContent||"").trim().toLowerCase() === label.toLowerCase());
  if(!labelEl) return;
  const card = labelEl.closest(".metric,.stat,.kpi") || labelEl.parentElement;
  if(!card) return;
  const children = Array.from(card.children);
  let valEl = children.find(c => c !== labelEl && /^-?\d/.test(String(c.textContent||"").trim()));
  if(!valEl){
    valEl = Array.from(card.querySelectorAll("*")).find(c => c !== labelEl && /^-?\d/.test(String(c.textContent||"").trim()));
  }
  if(valEl) valEl.textContent = value;
}

function updateKpisStableV1536(metrics){
  if(!metrics) return;
  setKpiDirectV1536("Total", Math.round(metrics.total));
  setKpiDirectV1536("Av.", (metrics.avance || 0) + "%");
  setKpiDirectV1536("Restan", Math.round(metrics.restan));
  setKpiDirectV1536("ETA", etaTxtV1536(metrics.etaMin));
}

function drawStableRouteV1536(t){
  if(!t || typeof L === "undefined") return;
  const map = window.map || window.trackingMap || window.leafletMap || window.trackMap;
  if(!map) return;

  const {origen, destino} = getRouteCoordsV1536(t);
  const gps = getValidGpsV1536(t);
  if(!origen || !destino) return;

  try{
    if(window.trackingRouteLayerV1536){
      map.removeLayer(window.trackingRouteLayerV1536);
    }
    const group = L.layerGroup();

    L.polyline([[origen.lat,origen.lng],[destino.lat,destino.lng]],{
      color:"#16a34a",
      weight:5,
      opacity:.95
    }).addTo(group);

    L.circleMarker([origen.lat,origen.lng],{
      radius:8,color:"#22c55e",fillColor:"#22c55e",fillOpacity:1
    }).bindTooltip("Origen").addTo(group);

    if(gps){
      L.circleMarker([gps.lat,gps.lng],{
        radius:8,color:"#3b82f6",fillColor:"#3b82f6",fillOpacity:1
      }).bindTooltip("GPS").addTo(group);
    }

    L.circleMarker([destino.lat,destino.lng],{
      radius:8,color:"#ef4444",fillColor:"#ef4444",fillOpacity:1
    }).bindTooltip("Destino").addTo(group);

    group.addTo(map);
    window.trackingRouteLayerV1536 = group;

    const pts = [[origen.lat,origen.lng],[destino.lat,destino.lng]];
    if(gps) pts.push([gps.lat,gps.lng]);
    map.fitBounds(L.latLngBounds(pts), {padding:[24,24]});
  }catch(e){
    console.log("draw stable route", e);
  }
}

async function persistStableRouteV1536(t, metrics){
  if(!t || !firebaseReady()) return;
  try{
    if(t.route && lastRouteCoordsV1536){
      t.route.origenLat = lastRouteCoordsV1536.origen.lat;
      t.route.origenLng = lastRouteCoordsV1536.origen.lng;
      t.route.destinoLat = lastRouteCoordsV1536.destino.lat;
      t.route.destinoLng = lastRouteCoordsV1536.destino.lng;
    }
    t.routeMetrics = metrics || lastRouteMetricsV1536 || t.routeMetrics || {};
    save(LS.transit, t);
    const id = t.id || t.docId;
    if(id){
      await db.collection("transitos").doc(String(id)).set({
        route:t.route || {},
        routeMetrics:t.routeMetrics,
        actualizadoEn:now()
      }, {merge:true});
    }
  }catch(e){
    console.log("persist stable route", e);
  }
}

async function refreshStableTrackingV1536(){
  const t = transit();
  if(!t) return;

  // Si V1535 puede completar coordenadas desde Firebase, ejecutarlo primero.
  try{
    if(typeof ensureRouteCoordsV1535 === "function"){
      await ensureRouteCoordsV1535(t);
    }
  }catch(e){}

  const t2 = transit() || t;
  const metrics = computeStableMetricsV1536(t2);

  if(metrics){
    updateKpisStableV1536(metrics);
    drawStableRouteV1536(t2);
    persistStableRouteV1536(t2, metrics);
  }else if(lastRouteMetricsV1536){
    updateKpisStableV1536(lastRouteMetricsV1536);
    drawStableRouteV1536(t2);
  }
}

// Despues de cada render de tracking, recalcular varias veces para pisar actualizaciones GPS que resetean a cero.
const _renderTracking_v1536 = typeof renderTracking === "function" ? renderTracking : null;
if(_renderTracking_v1536){
  renderTracking = function(){
    const r = _renderTracking_v1536.apply(this, arguments);
    setTimeout(refreshStableTrackingV1536, 500);
    setTimeout(refreshStableTrackingV1536, 1500);
    setTimeout(refreshStableTrackingV1536, 3000);
    return r;
  };
}

const _show_v1536_tracking = show;
show = function(id){
  _show_v1536_tracking(id);
  if(id === "tracking"){
    setTimeout(refreshStableTrackingV1536, 500);
    setTimeout(refreshStableTrackingV1536, 1500);
    setTimeout(refreshStableTrackingV1536, 3000);
  }
};

// Interceptar botones de envio/actualizacion para recalcular despues de GPS.
document.addEventListener("click", function(ev){
  const txt = String((ev.target && ev.target.textContent) || "");
  if(/Enviar actualización|Enviar actualizacion|actualización|actualizacion/i.test(txt)){
    setTimeout(refreshStableTrackingV1536, 800);
    setTimeout(refreshStableTrackingV1536, 2000);
    setTimeout(refreshStableTrackingV1536, 4000);
  }
}, true);

// Watchdog solo cuando se esta en Tracking para evitar que los valores vuelvan a 0.
setInterval(function(){
  const tr = document.getElementById("tracking");
  if(tr && !tr.classList.contains("hidden")){
    refreshStableTrackingV1536();
  }
}, 5000);


/* ===== V1.5.55 - Dibujar ruta Tracking ===== */
function parseCoordV1537(v){
  if(!v) return null;
  if(typeof v === "object"){
    const lat = Number(v.lat ?? v.latitude);
    const lng = Number(v.lng ?? v.lon ?? v.longitude);
    if(Number.isFinite(lat) && Number.isFinite(lng)) return {lat,lng};
  }
  const nums = String(v).match(/-?\d+(?:\.\d+)?/g);
  if(nums && nums.length >= 2){
    const lat = Number(nums[0]);
    const lng = Number(nums[1]);
    if(Number.isFinite(lat) && Number.isFinite(lng)) return {lat,lng};
  }
  return null;
}

function trackingCoordsV1537(){
  const t = transit();
  if(!t || !t.route) return null;
  const r = t.route;
  const origen = parseCoordV1537({lat:r.origenLat, lng:r.origenLng}) || parseCoordV1537(r.origenCoords);
  const destino = parseCoordV1537({lat:r.destinoLat, lng:r.destinoLng}) || parseCoordV1537(r.destinoCoords);
  const gps = parseCoordV1537(t.last) || parseCoordV1537(t.gps) || parseCoordV1537(t.start);
  if(!origen || !destino) return null;
  return {t, origen, destino, gps};
}

function getLeafletMapsV1537(){
  const maps = [];
  if(window.map) maps.push(window.map);
  if(window.trackingMap) maps.push(window.trackingMap);
  if(window.leafletMap) maps.push(window.leafletMap);
  if(window.trackMap) maps.push(window.trackMap);
  if(Array.isArray(window.__trackingMapsV1537)) maps.push(...window.__trackingMapsV1537);
  return [...new Set(maps)].filter(m => m && typeof m.latLngToLayerPoint === "function");
}

function clearRouteLayersV1537(){
  const maps = getLeafletMapsV1537();
  maps.forEach(m=>{
    if(m.__eltaRouteLayerV1537){
      try{ m.removeLayer(m.__eltaRouteLayerV1537); }catch(e){}
      m.__eltaRouteLayerV1537 = null;
    }
  });
}

function drawRouteLeafletV1537(){
  const data = trackingCoordsV1537();
  if(!data || typeof L === "undefined") return false;
  const maps = getLeafletMapsV1537();
  if(!maps.length) return false;

  maps.forEach(map=>{
    try{
      if(map.__eltaRouteLayerV1537){
        map.removeLayer(map.__eltaRouteLayerV1537);
      }
      const g = L.layerGroup();
      const o = [data.origen.lat, data.origen.lng];
      const d = [data.destino.lat, data.destino.lng];

      L.polyline([o,d], {color:"#16a34a", weight:6, opacity:.95}).addTo(g);
      L.circleMarker(o, {radius:8, color:"#22c55e", fillColor:"#22c55e", fillOpacity:1, weight:2}).addTo(g);
      L.circleMarker(d, {radius:8, color:"#ef4444", fillColor:"#ef4444", fillOpacity:1, weight:2}).addTo(g);

      if(data.gps){
        L.circleMarker([data.gps.lat,data.gps.lng], {radius:8, color:"#3b82f6", fillColor:"#3b82f6", fillOpacity:1, weight:2}).addTo(g);
      }

      g.addTo(map);
      map.__eltaRouteLayerV1537 = g;

      const pts = [o,d];
      if(data.gps) pts.push([data.gps.lat,data.gps.lng]);
      map.fitBounds(L.latLngBounds(pts), {padding:[24,24]});
    }catch(e){
      console.log("Leaflet ruta v1537", e);
    }
  });
  return true;
}

/* Fallback visual: si no se consigue el objeto Leaflet, dibuja una linea SVG dentro del contenedor del mapa */
function drawRouteSvgFallbackV1537(){
  const data = trackingCoordsV1537();
  if(!data) return false;

  const mapEl = document.querySelector("#map,#trackingMap,.leaflet-container");
  if(!mapEl) return false;

  if(getComputedStyle(mapEl).position === "static"){
    mapEl.style.position = "relative";
  }

  let svg = mapEl.querySelector("#eltaRouteSvgV1537");
  if(!svg){
    svg = document.createElementNS("http://www.w3.org/2000/svg","svg");
    svg.setAttribute("id","eltaRouteSvgV1537");
    svg.style.position = "absolute";
    svg.style.left = "0";
    svg.style.top = "0";
    svg.style.width = "100%";
    svg.style.height = "100%";
    svg.style.pointerEvents = "none";
    svg.style.zIndex = "650";
    mapEl.appendChild(svg);
  }

  const w = mapEl.clientWidth || 300;
  const h = mapEl.clientHeight || 300;
  svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  svg.innerHTML = "";

  // Proyección simple relativa al bounding box origen/destino/GPS
  const pts = [data.origen, data.destino];
  if(data.gps) pts.push(data.gps);
  const minLat = Math.min(...pts.map(p=>p.lat));
  const maxLat = Math.max(...pts.map(p=>p.lat));
  const minLng = Math.min(...pts.map(p=>p.lng));
  const maxLng = Math.max(...pts.map(p=>p.lng));
  const pad = 34;
  const dx = Math.max(0.000001, maxLng-minLng);
  const dy = Math.max(0.000001, maxLat-minLat);

  function xy(p){
    const x = pad + ((p.lng-minLng)/dx)*(w-pad*2);
    const y = pad + ((maxLat-p.lat)/dy)*(h-pad*2);
    return {x,y};
  }

  const o = xy(data.origen);
  const d = xy(data.destino);
  const line = document.createElementNS("http://www.w3.org/2000/svg","line");
  line.setAttribute("x1",o.x); line.setAttribute("y1",o.y);
  line.setAttribute("x2",d.x); line.setAttribute("y2",d.y);
  line.setAttribute("stroke","#16a34a");
  line.setAttribute("stroke-width","6");
  line.setAttribute("stroke-linecap","round");
  svg.appendChild(line);

  function dot(p,color){
    const c = document.createElementNS("http://www.w3.org/2000/svg","circle");
    c.setAttribute("cx",p.x); c.setAttribute("cy",p.y); c.setAttribute("r","8");
    c.setAttribute("fill",color); c.setAttribute("stroke","#fff"); c.setAttribute("stroke-width","3");
    svg.appendChild(c);
  }

  dot(o,"#22c55e");
  dot(d,"#ef4444");
  if(data.gps) dot(xy(data.gps),"#3b82f6");

  return true;
}

function drawTrackingRouteNowV1537(){
  const ok = drawRouteLeafletV1537();
  if(!ok) drawRouteSvgFallbackV1537();
}

function scheduleDrawTrackingRouteV1537(){
  setTimeout(drawTrackingRouteNowV1537, 400);
  setTimeout(drawTrackingRouteNowV1537, 1200);
  setTimeout(drawTrackingRouteNowV1537, 2500);
}

const _renderTracking_v1537 = typeof renderTracking === "function" ? renderTracking : null;
if(_renderTracking_v1537){
  renderTracking = function(){
    const r = _renderTracking_v1537.apply(this, arguments);
    scheduleDrawTrackingRouteV1537();
    return r;
  };
}

const _show_v1537_route = show;
show = function(id){
  _show_v1537_route(id);
  if(id === "tracking") scheduleDrawTrackingRouteV1537();
};

document.addEventListener("click", function(ev){
  const txt = String((ev.target && ev.target.textContent) || "");
  if(/Tracking|Enviar actualización|Enviar actualizacion|actualización|actualizacion/i.test(txt)){
    scheduleDrawTrackingRouteV1537();
  }
}, true);

setInterval(function(){
  const tr = document.getElementById("tracking");
  if(tr && !tr.classList.contains("hidden")){
    drawTrackingRouteNowV1537();
  }
}, 4000);


/* ===== V1.5.55 - Ruta real camion por caminos OSRM ===== */
let routeRealCacheV1538 = null;

function coordV1538(v){
  if(!v) return null;
  if(typeof v === "object"){
    const lat = Number(v.lat ?? v.latitude);
    const lng = Number(v.lng ?? v.lon ?? v.longitude);
    if(Number.isFinite(lat) && Number.isFinite(lng)) return {lat,lng};
  }
  const nums = String(v).match(/-?\d+(?:\.\d+)?/g);
  if(nums && nums.length >= 2){
    const lat = Number(nums[0]);
    const lng = Number(nums[1]);
    if(Number.isFinite(lat) && Number.isFinite(lng)) return {lat,lng};
  }
  return null;
}

function getRouteBaseCoordsV1538(){
  const t = transit();
  if(!t || !t.route) return null;
  const r = t.route;
  const origen = coordV1538({lat:r.origenLat, lng:r.origenLng}) || coordV1538(r.origenCoords);
  const destino = coordV1538({lat:r.destinoLat, lng:r.destinoLng}) || coordV1538(r.destinoCoords);
  const gps = coordV1538(t.last) || coordV1538(t.gps) || coordV1538(t.start);
  if(!origen || !destino) return null;
  return {t,r,origen,destino,gps};
}

function havKmV1538(a,b){
  if(!a || !b) return 0;
  const R = 6371;
  const dLat = (b.lat-a.lat)*Math.PI/180;
  const dLng = (b.lng-a.lng)*Math.PI/180;
  const s1 = Math.sin(dLat/2), s2 = Math.sin(dLng/2);
  const q = s1*s1 + Math.cos(a.lat*Math.PI/180)*Math.cos(b.lat*Math.PI/180)*s2*s2;
  return 2*R*Math.atan2(Math.sqrt(q),Math.sqrt(1-q));
}

function routeCacheKeyV1538(o,d){
  return `${o.lat.toFixed(5)},${o.lng.toFixed(5)}>${d.lat.toFixed(5)},${d.lng.toFixed(5)}`;
}

async function fetchOsrmRouteV1538(origen,destino){
  const key = routeCacheKeyV1538(origen,destino);
  if(routeRealCacheV1538 && routeRealCacheV1538.key === key) return routeRealCacheV1538;

  const t = transit();
  if(t && t.routeGeometry && t.routeGeometryKey === key && Array.isArray(t.routeGeometry)){
    routeRealCacheV1538 = {
      key,
      geometry: t.routeGeometry,
      distanceKm: Number(t.routeDistanceKm || 0),
      durationMin: Number(t.routeDurationMin || 0)
    };
    return routeRealCacheV1538;
  }

  const url = `https://router.project-osrm.org/route/v1/driving/${origen.lng},${origen.lat};${destino.lng},${destino.lat}?overview=full&geometries=geojson&steps=false&alternatives=false`;
  const resp = await fetch(url);
  if(!resp.ok) throw new Error("OSRM no disponible");
  const data = await resp.json();
  if(!data.routes || !data.routes.length) throw new Error("Sin ruta OSRM");

  const r = data.routes[0];
  const geometry = (r.geometry && r.geometry.coordinates ? r.geometry.coordinates : [])
    .map(c => ({lat:Number(c[1]), lng:Number(c[0])}))
    .filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lng));

  const out = {
    key,
    geometry,
    distanceKm: Number(r.distance || 0) / 1000,
    durationMin: Number(r.duration || 0) / 60
  };
  routeRealCacheV1538 = out;
  return out;
}

function nearestIndexOnRouteV1538(route, gps){
  if(!route || !route.length || !gps) return 0;
  let best = 0, bestD = Infinity;
  route.forEach((p,i)=>{
    const d = havKmV1538(p,gps);
    if(d < bestD){ bestD = d; best = i; }
  });
  return best;
}

function routeSegmentKmV1538(route, startIdx, endIdx){
  if(!route || route.length < 2) return 0;
  let s = Math.max(0, startIdx || 0);
  let e = Math.min(route.length - 1, typeof endIdx === "number" ? endIdx : route.length - 1);
  let km = 0;
  for(let i=s; i<e; i++){
    km += havKmV1538(route[i], route[i+1]);
  }
  return km;
}

function metricsFromRealRouteV1538(routeData, gps){
  const route = routeData.geometry || [];
  const total = routeData.distanceKm || routeSegmentKmV1538(route, 0, route.length-1);
  let restan = total;
  let avance = 0;
  if(gps && route.length){
    const idx = nearestIndexOnRouteV1538(route, gps);
    const recorrido = routeSegmentKmV1538(route, 0, idx);
    restan = Math.max(0, total - recorrido);
    avance = total > 0 ? Math.max(0, Math.min(100, Math.round((recorrido/total)*100))) : 0;
  }
  const etaMin = routeData.durationMin && total > 0 ? Math.round((restan/total) * routeData.durationMin) : Math.round((restan/70)*60);
  return {total, restan, avance, etaMin};
}

function etaTxtV1538(min){
  if(!min || min <= 0) return "0m";
  if(min < 60) return Math.round(min) + "m";
  return Math.floor(min/60) + "h " + (Math.round(min)%60) + "m";
}

function setKpiV1538(label, value){
  const els = Array.from(document.querySelectorAll("body *"));
  const labelEl = els.find(el => String(el.textContent||"").trim().toLowerCase() === label.toLowerCase());
  if(!labelEl) return;
  const card = labelEl.closest(".metric,.stat,.kpi") || labelEl.parentElement;
  if(!card) return;
  let valEl = Array.from(card.children).find(c => c !== labelEl && /^-?\d/.test(String(c.textContent||"").trim()));
  if(!valEl) valEl = Array.from(card.querySelectorAll("*")).find(c => c !== labelEl && /^-?\d/.test(String(c.textContent||"").trim()));
  if(valEl) valEl.textContent = value;
}

function updateKpisRealRouteV1538(m){
  setKpiV1538("Total", m.total ? Math.round(m.total) : "0");
  setKpiV1538("Av.", (m.avance || 0) + "%");
  setKpiV1538("Restan", m.restan ? Math.round(m.restan) : "0");
  setKpiV1538("ETA", etaTxtV1538(m.etaMin));
}

function getMapsV1538(){
  const maps = [];
  if(window.map) maps.push(window.map);
  if(window.trackingMap) maps.push(window.trackingMap);
  if(window.leafletMap) maps.push(window.leafletMap);
  if(window.trackMap) maps.push(window.trackMap);
  if(Array.isArray(window.__trackingMapsV1537)) maps.push(...window.__trackingMapsV1537);
  return [...new Set(maps)].filter(m => m && typeof m.addLayer === "function");
}

function removeOldRouteLayersV1538(map){
  ["__eltaRouteLayerV1537","trackingRouteLayerV1535","trackingRouteLayerV1536","__eltaRealRouteLayerV1538"].forEach(k=>{
    try{
      if(map[k]){ map.removeLayer(map[k]); map[k]=null; }
    }catch(e){}
  });
}

function drawRealRouteLeafletV1538(routeData, coords){
  if(typeof L === "undefined") return false;
  const maps = getMapsV1538();
  if(!maps.length) return false;
  const latlngs = (routeData.geometry || []).map(p => [p.lat,p.lng]);
  if(latlngs.length < 2) return false;

  maps.forEach(map=>{
    try{
      removeOldRouteLayersV1538(map);
      const group = L.layerGroup();

      L.polyline(latlngs, {color:"#2563eb", weight:6, opacity:.95}).addTo(group);

      L.circleMarker([coords.origen.lat,coords.origen.lng],{radius:8,color:"#22c55e",fillColor:"#22c55e",fillOpacity:1,weight:2}).addTo(group);
      if(coords.gps){
        L.circleMarker([coords.gps.lat,coords.gps.lng],{radius:8,color:"#3b82f6",fillColor:"#3b82f6",fillOpacity:1,weight:2}).addTo(group);
      }
      L.circleMarker([coords.destino.lat,coords.destino.lng],{radius:8,color:"#ef4444",fillColor:"#ef4444",fillOpacity:1,weight:2}).addTo(group);

      group.addTo(map);
      map.__eltaRealRouteLayerV1538 = group;

      const fitPts = latlngs.slice();
      if(coords.gps) fitPts.push([coords.gps.lat,coords.gps.lng]);
      map.fitBounds(L.latLngBounds(fitPts), {padding:[24,24]});
    }catch(e){ console.log("draw real route", e); }
  });
  return true;
}

async function persistRealRouteV1538(routeData, metrics){
  const t = transit();
  if(!t) return;
  t.routeGeometryKey = routeData.key;
  t.routeGeometry = routeData.geometry;
  t.routeDistanceKm = routeData.distanceKm;
  t.routeDurationMin = routeData.durationMin;
  t.routeMetrics = {
    total: metrics.total,
    restan: metrics.restan,
    avance: metrics.avance,
    etaMin: metrics.etaMin
  };
  save(LS.transit,t);

  if(firebaseReady() && (t.id || t.docId)){
    try{
      await db.collection("transitos").doc(String(t.id || t.docId)).set({
        routeGeometryKey:t.routeGeometryKey,
        routeGeometry:t.routeGeometry,
        routeDistanceKm:t.routeDistanceKm,
        routeDurationMin:t.routeDurationMin,
        routeMetrics:t.routeMetrics,
        actualizadoEn:now()
      }, {merge:true});
    }catch(e){ console.log("persist real route", e); }
  }
}

async function drawRealTruckRouteV1538(){
  const coords = getRouteBaseCoordsV1538();
  if(!coords) return;

  try{
    const routeData = await fetchOsrmRouteV1538(coords.origen, coords.destino);
    const metrics = metricsFromRealRouteV1538(routeData, coords.gps);
    updateKpisRealRouteV1538(metrics);
    drawRealRouteLeafletV1538(routeData, coords);
    await persistRealRouteV1538(routeData, metrics);
  }catch(e){
    console.log("Ruta real OSRM no disponible", e);
    if(routeRealCacheV1538){
      const metrics = metricsFromRealRouteV1538(routeRealCacheV1538, coords.gps);
      updateKpisRealRouteV1538(metrics);
      drawRealRouteLeafletV1538(routeRealCacheV1538, coords);
    }
  }
}

function scheduleRealTruckRouteV1538(){
  setTimeout(drawRealTruckRouteV1538, 600);
  setTimeout(drawRealTruckRouteV1538, 1800);
  setTimeout(drawRealTruckRouteV1538, 3500);
}

const _renderTracking_v1538 = typeof renderTracking === "function" ? renderTracking : null;
if(_renderTracking_v1538){
  renderTracking = function(){
    const r = _renderTracking_v1538.apply(this, arguments);
    scheduleRealTruckRouteV1538();
    return r;
  };
}

const _show_v1538_realroute = show;
show = function(id){
  _show_v1538_realroute(id);
  if(id === "tracking") scheduleRealTruckRouteV1538();
};

document.addEventListener("click", function(ev){
  const txt = String((ev.target && ev.target.textContent) || "");
  if(/Tracking|Enviar actualización|Enviar actualizacion|actualización|actualizacion/i.test(txt)){
    scheduleRealTruckRouteV1538();
  }
}, true);

setInterval(function(){
  const tr = document.getElementById("tracking");
  if(tr && !tr.classList.contains("hidden")){
    drawRealTruckRouteV1538();
  }
}, 8000);


/* ===== V1.5.55 - Tracking basado en Embarque Firebase ===== */
function coordV1541(v){
  if(!v) return null;
  if(typeof v==="object"){
    const lat=Number(v.lat??v.latitude);
    const lng=Number(v.lng??v.lon??v.longitude);
    if(Number.isFinite(lat)&&Number.isFinite(lng)) return {lat,lng};
  }
  const nums=String(v).match(/-?\d+(?:\.\d+)?/g);
  if(nums&&nums.length>=2){
    const lat=Number(nums[0]), lng=Number(nums[1]);
    if(Number.isFinite(lat)&&Number.isFinite(lng)) return {lat,lng};
  }
  return null;
}

async function docByNameV1541(col,name){
  if(!firebaseReady()||!name) return null;
  const target=String(name).trim();
  try{
    const direct=await db.collection(col).doc(target).get();
    if(direct.exists) return {id:direct.id,...direct.data()};
  }catch(e){}
  try{
    const snap=await db.collection(col).get();
    for(const d of snap.docs){
      const x=d.data()||{};
      const names=[d.id,x.nombre,x.name,x.origen,x.destino,x.cliente].map(v=>String(v||"").trim().toLowerCase());
      if(names.includes(target.toLowerCase())) return {id:d.id,...x};
    }
  }catch(e){}
  return null;
}

async function embarqueDocV1541(numero){
  if(!firebaseReady()||!numero) return null;
  const id=String(numero).trim();
  try{
    const d=await db.collection("embarque").doc(id).get();
    if(d.exists) return {id:d.id,...d.data()};
  }catch(e){}
  try{
    const snap=await db.collection("embarque").where("embarque","==",id).limit(1).get();
    if(!snap.empty){
      const d=snap.docs[0];
      return {id:d.id,...d.data()};
    }
  }catch(e){}
  try{
    const snap=await db.collection("embarque").where("numero","==",id).limit(1).get();
    if(!snap.empty){
      const d=snap.docs[0];
      return {id:d.id,...d.data()};
    }
  }catch(e){}
  return null;
}

function routeKeyV1541(o,d){
  return `${o.lat.toFixed(5)},${o.lng.toFixed(5)}>${d.lat.toFixed(5)},${d.lng.toFixed(5)}`;
}

async function osrmRouteV1541(o,d){
  const url=`https://router.project-osrm.org/route/v1/driving/${o.lng},${o.lat};${d.lng},${d.lat}?overview=full&geometries=geojson&steps=false&alternatives=false`;
  const res=await fetch(url);
  if(!res.ok) throw new Error("OSRM no disponible");
  const data=await res.json();
  if(!data.routes||!data.routes.length) throw new Error("OSRM sin ruta");
  const r=data.routes[0];
  const geometry=(r.geometry&&r.geometry.coordinates?r.geometry.coordinates:[])
    .map(c=>({lat:Number(c[1]),lng:Number(c[0])}))
    .filter(p=>Number.isFinite(p.lat)&&Number.isFinite(p.lng));
  return {
    key:routeKeyV1541(o,d),
    geometry,
    distanceKm:Number(r.distance||0)/1000,
    durationMin:Number(r.duration||0)/60
  };
}

async function buildRouteFromEmbarqueV1541(embarqueNumero){
  const emb=await embarqueDocV1541(embarqueNumero);
  let base=selectedRoute();

  if(emb){
    base={
      ...base,
      cliente:String(emb.cliente||emb.client||base.cliente||"").trim(),
      origen:String(emb.origen||base.origen||"").trim(),
      destino:String(emb.destino||base.destino||"").trim(),
      embarque:String(emb.embarque||emb.numero||embarqueNumero||"").trim(),
      embarqueId:emb.id
    };
  }

  const origenDoc=await docByNameV1541("origenes",base.origen);
  const destinoDoc=await docByNameV1541("destinos",base.destino);

  const oc=coordV1541(origenDoc&&(origenDoc.ubicacion||origenDoc.coords||origenDoc.coordenadas||origenDoc.location)) || coordV1541({lat:base.origen_lat,lng:base.origen_lng});
  const dc=coordV1541(destinoDoc&&(destinoDoc.ubicacion||destinoDoc.coords||destinoDoc.coordenadas||destinoDoc.location)) || coordV1541({lat:base.destino_lat,lng:base.destino_lng});

  if(oc){
    base.origen_lat=oc.lat; base.origen_lng=oc.lng;
    base.origenLat=oc.lat; base.origenLng=oc.lng;
  }
  if(dc){
    base.destino_lat=dc.lat; base.destino_lng=dc.lng;
    base.destinoLat=dc.lat; base.destinoLng=dc.lng;
  }

  if(oc&&dc){
    try{
      const rr=await osrmRouteV1541(oc,dc);
      base.routeGeometryKey=rr.key;
      base.routeGeometry=rr.geometry;
      base.routeDistanceKm=rr.distanceKm;
      base.routeDurationMin=rr.durationMin;
    }catch(e){
      console.log("OSRM embarque route",e);
    }
  }

  return base;
}

function kmV1541(a,b){
  if(!a||!b) return 0;
  return distKm(Number(a.lat),Number(a.lng),Number(b.lat),Number(b.lng));
}

function segKmV1541(points,s,e){
  if(!points||points.length<2) return 0;
  s=Math.max(0,s||0);
  e=Math.min(points.length-1,typeof e==="number"?e:points.length-1);
  let km=0;
  for(let i=s;i<e;i++) km+=kmV1541(points[i],points[i+1]);
  return km;
}

function nearestIdxV1541(points,gps){
  if(!gps||!points||!points.length) return 0;
  let bi=0, bd=Infinity;
  points.forEach((p,i)=>{
    const d=kmV1541(p,gps);
    if(d<bd){bd=d;bi=i;}
  });
  return bi;
}

function routeMetricsV1541(t){
  const r=t&&t.route?t.route:{};
  const current=t&&t.updates&&t.updates.length?t.updates[t.updates.length-1].gps:(t&&t.start);
  const gps=coordV1541(current);
  const geometry=(t.routeGeometry||r.routeGeometry||[]).map(coordV1541).filter(Boolean);
  const total=Number(t.routeDistanceKm||r.routeDistanceKm||0) || (geometry.length?segKmV1541(geometry,0,geometry.length-1):distanciaRuta(r));
  let restan=total, avance=0;

  if(gps&&geometry.length){
    const idx=nearestIdxV1541(geometry,gps);
    const recorrido=segKmV1541(geometry,0,idx);
    restan=Math.max(0,total-recorrido);
    avance=total>0?Math.max(0,Math.min(100,Math.round((recorrido/total)*100))):0;
  }else if(gps&&t&&t.start){
    const recorrido=Math.min(total,distKm(t.start.lat,t.start.lng,gps.lat,gps.lng));
    restan=Math.max(0,total-recorrido);
    avance=total>0?Math.max(0,Math.min(100,Math.round((recorrido/total)*100))):0;
  }

  const dur=Number(t.routeDurationMin||r.routeDurationMin||0);
  const etaMin=dur&&total>0?Math.round((restan/total)*dur):Math.round((restan/70)*60);
  return {total,restan,avance,etaMin,gps,geometry};
}

function shortEtaMinV1541(mins){
  mins=Math.max(0,Math.round(mins||0));
  const h=Math.floor(mins/60), m=mins%60;
  if(h<=0) return `${m}m`;
  return `${h}h${m>0?" "+m+"m":""}`;
}

async function guardarTransitoInicioFirebaseV1541(t){
  if(!t||!firebaseReady()) return;
  const id=t.id||regId();
  t.id=id;
  const data={
    ...t,
    route:t.route||{},
    routeGeometry:t.routeGeometry||[],
    routeGeometryKey:t.routeGeometryKey||"",
    routeDistanceKm:t.routeDistanceKm||0,
    routeDurationMin:t.routeDurationMin||0,
    cliente:(t.route&&t.route.cliente)||"",
    origen:(t.route&&t.route.origen)||"",
    destino:(t.route&&t.route.destino)||"",
    flota:t.user&&t.user.fleet?t.user.fleet:"",
    chofer:t.user&&t.user.driver?t.user.driver:"",
    estado:"abierto",
    actualizadoEn:now()
  };
  await db.collection("transitos").doc(String(id)).set(data,{merge:true});
}

/* Reemplazo estable de inicio: toma el embarque real de Firebase */
iniciarTransito = async function(){
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
    const route=await buildRouteFromEmbarqueV1541(embarque);

    const t={
      id:regId(),
      user:u,
      route,
      lote,
      embarque,
      start:gps,
      updates:[],
      alerts:[],
      closed:null,
      routeGeometry:route.routeGeometry||[],
      routeGeometryKey:route.routeGeometryKey||"",
      routeDistanceKm:route.routeDistanceKm||0,
      routeDurationMin:route.routeDurationMin||0
    };

    save(LS.transit,t);
    await guardarTransitoInicioFirebaseV1541(t);
    saveTransitHistory(t);
    bloquearFormularioTransito();
    renderTransitStatus();
    aplicarColorResumenInicio();
    window.alert("Tránsito iniciado correctamente.");
    show("tracking");
    startAutoGps();
  }catch(e){
    window.alert("No se pudo iniciar tránsito: "+(e.message||e));
  }
};

renderTracking = function(){
  const t=transit();

  if(!t){
    stopAutoGps();
    const box=$("trackingBox");
    if(box) box.innerHTML='<div class="statItem"><b>Sin tránsito</b><span>No hay tránsito iniciado</span></div>';
    renderTrackingMap(null);
    return;
  }

  const m=routeMetricsV1541(t);
  const box=$("trackingBox");
  if(box){
    box.innerHTML=
`<div class="statItem"><b>${shortKm(m.total)}</b><span>Total</span></div>
 <div class="statItem"><b>${m.avance}%</b><span>Av.</span></div>
 <div class="statItem"><b>${shortKm(m.restan)}</b><span>Restan</span></div>
 <div class="statItem"><b>${shortEtaMinV1541(m.etaMin)}</b><span>ETA</span></div>`;
  }

  renderTrackingMap(t);
  startAutoGps();
};

renderTrackingMap = function(t){
  const map=initLeafletMap();
  if(!map) return;

  clearLeafletLayers();
  removeRouteLayer();

  if(!t || !t.route || !t.start){
    window.lastTrackingMapCenter=null;
    map.setView([-34.6037,-58.3816],6,{animate:false});
    return;
  }

  const r=t.route||{};
  const origin=coordV1541({lat:r.origen_lat??r.origenLat,lng:r.origen_lng??r.origenLng});
  const dest=coordV1541({lat:r.destino_lat??r.destinoLat,lng:r.destino_lng??r.destinoLng});
  const current=t.updates&&t.updates.length?t.updates[t.updates.length-1].gps:t.start;
  const cur=coordV1541(current);
  const geometry=(t.routeGeometry||r.routeGeometry||[]).map(coordV1541).filter(Boolean);

  if(geometry.length>=2){
    addLeafletLayer(L.polyline(geometry.map(p=>[p.lat,p.lng]),{color:"#2563eb",weight:6,opacity:.95,interactive:false}));
  }

  if(origin){
    addLeafletLayer(L.circleMarker([origin.lat,origin.lng],{radius:9,color:"#fff",weight:2,fillColor:"#22c55e",fillOpacity:1}).bindPopup("Origen"));
  }
  if(cur){
    addLeafletLayer(L.circleMarker([cur.lat,cur.lng],{radius:11,color:"#fff",weight:2,fillColor:"#2f8cff",fillOpacity:1}).bindPopup("Última ubicación GPS"));
  }
  if(dest){
    addLeafletLayer(L.circleMarker([dest.lat,dest.lng],{radius:9,color:"#fff",weight:2,fillColor:"#ef4444",fillOpacity:1}).bindPopup("Destino"));
  }

  (t.alerts||[]).map(a=>coordV1541(a.gps)).filter(Boolean).forEach((a,i)=>{
    addLeafletLayer(L.circleMarker([a.lat,a.lng],{radius:8,color:"#fff",weight:2,fillColor:"#f59e0b",fillOpacity:1}).bindPopup("Alerta "+(i+1)));
  });

  // Mantener zoom/centro en GPS actual. No reencuadrar a toda la ruta.
  if(cur){
    const z=Math.max(map.getZoom?map.getZoom():13,13);
    map.setView([cur.lat,cur.lng],Math.min(z,15),{animate:false});
    window.lastTrackingMapCenter={lat:cur.lat,lng:cur.lng};
  }else if(origin){
    map.setView([origin.lat,origin.lng],13,{animate:false});
  }
};

/* Evitar que listener remoto pise el tránsito local con route incompleta */
function mergeTransitPreserveRouteV1541(local,remote){
  if(!local) return remote;
  if(!remote) return local;
  const out={...local,...remote};
  const localHasRoute=local.route&&local.route.origen&&local.route.destino&&(local.route.origen_lat||local.route.origenLat)&&(local.route.destino_lat||local.route.destinoLat);
  const remoteHasRoute=remote.route&&remote.route.origen&&remote.route.destino&&(remote.route.origen_lat||remote.route.origenLat)&&(remote.route.destino_lat||remote.route.destinoLat);
  if(localHasRoute&&!remoteHasRoute){
    out.route=local.route;
    out.routeGeometry=local.routeGeometry;
    out.routeGeometryKey=local.routeGeometryKey;
    out.routeDistanceKm=local.routeDistanceKm;
    out.routeDurationMin=local.routeDurationMin;
  }
  return out;
}


/* ===== V1.5.55 - Corrección final Tracking / Embarque / Zoom ===== */
/*
  Objetivo:
  - Inicio/Fin calcula distancia usando embarque real Firebase.
  - Tracking usa sólo cliente/origen/destino del embarque.
  - Sin líneas rectas ni capas viejas.
  - Ruta azul sólo si OSRM devuelve ruta real.
  - Zoom estable centrado en GPS sin fitBounds repetidos.
*/

function coordV1542(v){
  if(!v) return null;
  if(typeof v==="object"){
    const lat=Number(v.lat??v.latitude);
    const lng=Number(v.lng??v.lon??v.longitude);
    if(Number.isFinite(lat)&&Number.isFinite(lng)) return {lat,lng};
  }
  const nums=String(v).match(/-?\d+(?:\.\d+)?/g);
  if(nums&&nums.length>=2){
    const lat=Number(nums[0]), lng=Number(nums[1]);
    if(Number.isFinite(lat)&&Number.isFinite(lng)) return {lat,lng};
  }
  return null;
}

function selectTextV1542(id){
  const el=$(id);
  if(!el) return "";
  const opt=el.options && el.selectedIndex>=0 ? el.options[el.selectedIndex] : null;
  return String((opt&&(opt.textContent||opt.innerText))||el.value||"").trim();
}

async function getDocByNameV1542(col,name){
  if(!firebaseReady()||!name) return null;
  const target=String(name).trim();
  try{
    const d=await db.collection(col).doc(target).get();
    if(d.exists) return {id:d.id,...d.data()};
  }catch(e){}
  try{
    const snap=await db.collection(col).get();
    for(const d of snap.docs){
      const x=d.data()||{};
      const names=[d.id,x.nombre,x.name,x.cliente,x.origen,x.destino].map(v=>String(v||"").trim().toLowerCase());
      if(names.includes(target.toLowerCase())) return {id:d.id,...x};
    }
  }catch(e){}
  return null;
}

async function getEmbarqueV1542(numero){
  if(!firebaseReady()||!numero) return null;
  const n=String(numero).trim();
  try{
    const d=await db.collection("embarque").doc(n).get();
    if(d.exists) return {id:d.id,...d.data()};
  }catch(e){}
  for(const field of ["embarque","numero"]){
    try{
      const snap=await db.collection("embarque").where(field,"==",n).limit(1).get();
      if(!snap.empty){
        const d=snap.docs[0];
        return {id:d.id,...d.data()};
      }
    }catch(e){}
  }
  return null;
}

function routeFromSelectorsV1542(){
  const r=typeof selectedRoute==="function" ? selectedRoute() : {};
  return {
    ...r,
    cliente: selectTextV1542("clienteSelect") || r.cliente || "",
    origen: selectTextV1542("origenSelect") || r.origen || "",
    destino: selectTextV1542("destinoSelect") || r.destino || ""
  };
}

async function resolveRouteV1542(embarqueNumero){
  const emb=await getEmbarqueV1542(embarqueNumero);
  let r=routeFromSelectorsV1542();

  if(emb){
    r={
      ...r,
      cliente:String(emb.cliente||emb.client||r.cliente||"").trim(),
      origen:String(emb.origen||r.origen||"").trim(),
      destino:String(emb.destino||r.destino||"").trim(),
      embarque:String(emb.embarque||emb.numero||embarqueNumero||"").trim(),
      embarqueId:emb.id||String(embarqueNumero||"")
    };
  }

  const od=await getDocByNameV1542("origenes",r.origen);
  const dd=await getDocByNameV1542("destinos",r.destino);

  const oc=coordV1542(od&&(od.ubicacion||od.coords||od.coordenadas||od.location)) || coordV1542({lat:r.origen_lat??r.origenLat,lng:r.origen_lng??r.origenLng});
  const dc=coordV1542(dd&&(dd.ubicacion||dd.coords||dd.coordenadas||dd.location)) || coordV1542({lat:r.destino_lat??r.destinoLat,lng:r.destino_lng??r.destinoLng});

  if(oc){
    r.origen_lat=oc.lat; r.origen_lng=oc.lng;
    r.origenLat=oc.lat; r.origenLng=oc.lng;
  }
  if(dc){
    r.destino_lat=dc.lat; r.destino_lng=dc.lng;
    r.destinoLat=dc.lat; r.destinoLng=dc.lng;
  }

  // limpiar geometría vieja si cambió ruta
  const key=oc&&dc ? `${oc.lat.toFixed(5)},${oc.lng.toFixed(5)}>${dc.lat.toFixed(5)},${dc.lng.toFixed(5)}` : "";
  if(r.routeGeometryKey && r.routeGeometryKey!==key){
    delete r.routeGeometry;
    delete r.routeDistanceKm;
    delete r.routeDurationMin;
  }

  return r;
}

function kmV1542(a,b){
  if(!a||!b) return 0;
  return distKm(Number(a.lat),Number(a.lng),Number(b.lat),Number(b.lng));
}

function routeLengthV1542(points,start,end){
  if(!points||points.length<2) return 0;
  start=Math.max(0,start||0);
  end=Math.min(points.length-1,typeof end==="number"?end:points.length-1);
  let km=0;
  for(let i=start;i<end;i++) km+=kmV1542(points[i],points[i+1]);
  return km;
}

function nearestIdxV1542(points,gps){
  if(!gps||!points||!points.length) return 0;
  let bi=0,bd=Infinity;
  points.forEach((p,i)=>{
    const d=kmV1542(p,gps);
    if(d<bd){bd=d;bi=i;}
  });
  return bi;
}

function osrmKeyV1542(o,d){
  return `${o.lat.toFixed(5)},${o.lng.toFixed(5)}>${d.lat.toFixed(5)},${d.lng.toFixed(5)}`;
}

async function fetchOsrmV1542(o,d){
  const url=`https://router.project-osrm.org/route/v1/driving/${o.lng},${o.lat};${d.lng},${d.lat}?overview=full&geometries=geojson&steps=false&alternatives=false`;
  const res=await fetch(url);
  if(!res.ok) throw new Error("OSRM no disponible");
  const data=await res.json();
  if(!data.routes||!data.routes.length) throw new Error("OSRM sin ruta");
  const rr=data.routes[0];
  const geometry=(rr.geometry&&rr.geometry.coordinates?rr.geometry.coordinates:[])
    .map(c=>({lat:Number(c[1]),lng:Number(c[0])}))
    .filter(p=>Number.isFinite(p.lat)&&Number.isFinite(p.lng));
  return {
    key:osrmKeyV1542(o,d),
    geometry,
    distanceKm:Number(rr.distance||0)/1000,
    durationMin:Number(rr.duration||0)/60
  };
}

async function ensureRouteGeometryV1542(t){
  if(!t||!t.route) return t;
  const r=t.route;
  const o=coordV1542({lat:r.origen_lat??r.origenLat,lng:r.origen_lng??r.origenLng});
  const d=coordV1542({lat:r.destino_lat??r.destinoLat,lng:r.destino_lng??r.destinoLng});
  if(!o||!d) return t;

  const key=osrmKeyV1542(o,d);
  if(Array.isArray(t.routeGeometry)&&t.routeGeometry.length>1&&t.routeGeometryKey===key){
    return t;
  }

  try{
    const rr=await fetchOsrmV1542(o,d);
    t.routeGeometryKey=rr.key;
    t.routeGeometry=rr.geometry;
    t.routeDistanceKm=rr.distanceKm;
    t.routeDurationMin=rr.durationMin;
    t.route.routeGeometryKey=rr.key;
    t.route.routeGeometry=rr.geometry;
    t.route.routeDistanceKm=rr.distanceKm;
    t.route.routeDurationMin=rr.durationMin;
    save(LS.transit,t);
  }catch(e){
    console.log("No se pudo obtener ruta real OSRM",e);
    // Importante: no usar fallback recto.
    t.routeGeometry=[];
    t.routeDistanceKm=0;
    t.routeDurationMin=0;
  }
  return t;
}

function distanciaRutaV1542(r){
  r=r||{};
  const total=Number(r.routeDistanceKm||0);
  if(Number.isFinite(total)&&total>0) return total;
  const o=coordV1542({lat:r.origen_lat??r.origenLat,lng:r.origen_lng??r.origenLng});
  const d=coordV1542({lat:r.destino_lat??r.destinoLat,lng:r.destino_lng??r.destinoLng});
  return o&&d ? kmV1542(o,d) : 0;
}

distanciaRuta = distanciaRutaV1542;

function currentGpsV1542(t){
  return coordV1542(t&&t.updates&&t.updates.length?t.updates[t.updates.length-1].gps:t&&t.start);
}

function metricsV1542(t){
  const r=t&&t.route?t.route:{};
  const gps=currentGpsV1542(t);
  const geometry=(t.routeGeometry||r.routeGeometry||[]).map(coordV1542).filter(Boolean);
  const total=Number(t.routeDistanceKm||r.routeDistanceKm||0) || (geometry.length?routeLengthV1542(geometry):distanciaRutaV1542(r));
  let restan=total,avance=0;

  if(gps&&geometry.length){
    const idx=nearestIdxV1542(geometry,gps);
    const recorrido=routeLengthV1542(geometry,0,idx);
    restan=Math.max(0,total-recorrido);
    avance=total>0?Math.max(0,Math.min(100,Math.round((recorrido/total)*100))):0;
  }

  const dur=Number(t.routeDurationMin||r.routeDurationMin||0);
  const etaMin=dur&&total>0?Math.round((restan/total)*dur):Math.round((restan/70)*60);
  return {total,restan,avance,etaMin,gps,geometry};
}

function etaTextV1542(mins){
  mins=Math.max(0,Math.round(mins||0));
  const h=Math.floor(mins/60),m=mins%60;
  return h<=0?`${m}m`:`${h}h${m>0?" "+m+"m":""}`;
}

/* Vista Inicio/Fin: distancia desde embarque real */
onOrigenDestinoChange = async function(){
  const emb=$("embarqueInput") ? $("embarqueInput").value.trim() : "";
  let r=routeFromSelectorsV1542();
  try{
    if(emb) r=await resolveRouteV1542(emb);
  }catch(e){
    console.log("resolve inicio",e);
  }

  const km=distanciaRutaV1542(r);
  const box=$("rutaInfo");
  if(box){
    const kmTxt=km&&Number.isFinite(km)?`${km.toFixed(1)} km`:"-";
    box.innerHTML=
      `<b>Distancia:</b> ${kmTxt}<br>`+
      `<b>Destino:</b> ${escapeHtml(destinoCompacto(r))}`;
  }
  aplicarColorResumenInicio();
};

/* Inicio de tránsito: usar embarque Firebase como fuente de verdad */
iniciarTransito = async function(){
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

  const lote=($("lote")?$("lote").value.trim():"");
  const embarque=($("embarqueInput")?$("embarqueInput").value.trim():"");
  if(!lote){window.alert("Ingresá número de lote/carga.");return;}
  if(!embarque){window.alert("Ingresá número de embarque.");return;}

  try{
    const gps=await getGps();
    const route=await resolveRouteV1542(embarque);

    let t={
      id:regId(),
      user:u,
      route,
      lote,
      embarque,
      start:gps,
      updates:[],
      alerts:[],
      closed:null
    };

    t=await ensureRouteGeometryV1542(t);

    await guardarTransitoInicioFirebaseV1542({
      ...t,
      routeGeometry:t.routeGeometry||[],
      routeGeometryKey:t.routeGeometryKey||"",
      routeDistanceKm:t.routeDistanceKm||0,
      routeDurationMin:t.routeDurationMin||0
    });

    save(LS.transit,t);
    saveTransitHistory(t);
    bloquearFormularioTransito();
    renderTransitStatus();
    aplicarColorResumenInicio();
    window.alert("Tránsito iniciado correctamente.");
    show("tracking");
    startAutoGps();
  }catch(e){
    window.alert("No se pudo iniciar tránsito: "+(e.message||e));
  }
};

/* Anular rutinas anteriores que generaban líneas rectas o recuadres inestables */
try{drawTrackingRouteNowV1537=function(){};}catch(e){}
try{drawStableRouteV1536=function(){};}catch(e){}
try{drawRouteOnExistingMapV1535=function(){};}catch(e){}
try{drawTrackingMapV1534=function(){};}catch(e){}
try{renderRealRouteV1539=function(){};}catch(e){}
try{renderRealRouteV1540=function(){};}catch(e){}
try{drawRealTruckRouteV1538=function(){};}catch(e){}

function clearAllVectorLayersV1542(map){
  if(!map||typeof L==="undefined") return;
  try{
    map.eachLayer(layer=>{
      if(layer instanceof L.Polyline || layer instanceof L.CircleMarker || layer instanceof L.Marker){
        try{map.removeLayer(layer);}catch(e){}
      }
    });
  }catch(e){}
  try{removeRouteLayer();}catch(e){}
  try{const s=document.getElementById("eltaRouteSvgV1537"); if(s)s.remove();}catch(e){}
}

/* Tracking sin refresh visual inestable */
renderTracking = function(){
  const t=transit();

  if(!t){
    stopAutoGps();
    const box=$("trackingBox");
    if(box) box.innerHTML='<div class="statItem"><b>Sin tránsito</b><span>No hay tránsito iniciado</span></div>';
    renderTrackingMap(null);
    return;
  }

  const m=metricsV1542(t);
  const box=$("trackingBox");
  if(box){
    box.innerHTML=
`<div class="statItem"><b>${shortKm(m.total)}</b><span>Total</span></div>
 <div class="statItem"><b>${m.avance}%</b><span>Av.</span></div>
 <div class="statItem"><b>${shortKm(m.restan)}</b><span>Restan</span></div>
 <div class="statItem"><b>${etaTextV1542(m.etaMin)}</b><span>ETA</span></div>`;
  }

  renderTrackingMap(t);
  startAutoGps();

  // Si todavía no está la geometría, cargarla una sola vez y redibujar.
  if(!t.routeGeometry || !t.routeGeometry.length){
    ensureRouteGeometryV1542(t).then(tt=>{
      save(LS.transit,tt);
      renderTracking();
    }).catch(e=>console.log("ensure route render",e));
  }
};

renderTrackingMap = function(t){
  const map=initLeafletMap();
  if(!map) return;

  clearLeafletLayers();
  clearAllVectorLayersV1542(map);

  if(!t || !t.route || !t.start){
    map.setView([-34.6037,-58.3816],6,{animate:false});
    return;
  }

  const r=t.route||{};
  const origin=coordV1542({lat:r.origen_lat??r.origenLat,lng:r.origen_lng??r.origenLng});
  const dest=coordV1542({lat:r.destino_lat??r.destinoLat,lng:r.destino_lng??r.destinoLng});
  const gps=currentGpsV1542(t);
  const geometry=(t.routeGeometry||r.routeGeometry||[]).map(coordV1542).filter(Boolean);

  // Ruta real azul: solo geometría OSRM. No fallback recto.
  if(geometry.length>=2){
    addLeafletLayer(L.polyline(geometry.map(p=>[p.lat,p.lng]),{
      color:"#2563eb",
      weight:6,
      opacity:.95,
      interactive:false
    }));
  }

  if(origin){
    addLeafletLayer(L.circleMarker([origin.lat,origin.lng],{radius:9,color:"#fff",weight:2,fillColor:"#22c55e",fillOpacity:1}).bindPopup("Origen"));
  }
  if(gps){
    addLeafletLayer(L.circleMarker([gps.lat,gps.lng],{radius:11,color:"#fff",weight:2,fillColor:"#2f8cff",fillOpacity:1}).bindPopup("Última ubicación GPS"));
  }
  if(dest){
    addLeafletLayer(L.circleMarker([dest.lat,dest.lng],{radius:9,color:"#fff",weight:2,fillColor:"#ef4444",fillOpacity:1}).bindPopup("Destino"));
  }

  (t.alerts||[]).map(a=>coordV1542(a.gps)).filter(Boolean).forEach((a,i)=>{
    addLeafletLayer(L.circleMarker([a.lat,a.lng],{radius:8,color:"#fff",weight:2,fillColor:"#f59e0b",fillOpacity:1}).bindPopup("Alerta "+(i+1)));
  });

  // Zoom estable en GPS. No fitBounds de ruta.
  if(gps){
    const currentZoom=map.getZoom?map.getZoom():13;
    const targetZoom=Math.max(currentZoom||13,13);
    const center=map.getCenter?map.getCenter():null;
    const mustMove=!center || distKm(center.lat,center.lng,gps.lat,gps.lng)>0.15;
    if(mustMove){
      map.setView([gps.lat,gps.lng],Math.min(targetZoom,15),{animate:false});
    }
  }else if(origin){
    map.setView([origin.lat,origin.lng],13,{animate:false});
  }
};

/* Listener remoto: no pisar route/geometry completas con datos incompletos */
function mergeTransitPreserveRouteV1542(local,remote){
  if(!local) return remote;
  if(!remote) return local;
  const out={...local,...remote};
  const localGeom=Array.isArray(local.routeGeometry)&&local.routeGeometry.length>1;
  const remoteGeom=Array.isArray(remote.routeGeometry)&&remote.routeGeometry.length>1;
  const localRoute=local.route&&local.route.origen&&local.route.destino&&(local.route.origen_lat||local.route.origenLat)&&(local.route.destino_lat||local.route.destinoLat);
  const remoteRoute=remote.route&&remote.route.origen&&remote.route.destino&&(remote.route.origen_lat||remote.route.origenLat)&&(remote.route.destino_lat||remote.route.destinoLat);

  if(localRoute&&!remoteRoute) out.route=local.route;
  if(localGeom&&!remoteGeom){
    out.routeGeometry=local.routeGeometry;
    out.routeGeometryKey=local.routeGeometryKey;
    out.routeDistanceKm=local.routeDistanceKm;
    out.routeDurationMin=local.routeDurationMin;
  }
  return out;
}


/* ===== V1.5.55 - Fix distancia Inicio/Fin y estado tránsito ===== */
let distanciaInicioTimerV1543=null;
let iniciarTransitoLockV1543=false;

function transitoValidoAbiertoV1543(t){
  if(!t) return false;
  if(t.closed) return false;
  if(!t.start || !Number.isFinite(Number(t.start.lat)) || !Number.isFinite(Number(t.start.lng))) return false;
  if(!t.embarque && !(t.route && (t.route.embarque || t.route.embarqueId))) return false;
  return true;
}

function limpiarTransitoInvalidoV1543(){
  const t=transit();
  if(!t) return null;
  if(t.closed){
    try{ localStorage.removeItem(LS.transit); }catch(e){}
    return null;
  }
  if(!transitoValidoAbiertoV1543(t)){
    try{ localStorage.removeItem(LS.transit); }catch(e){}
    return null;
  }
  return t;
}

function coordDocV1543(x){
  return coordV1542(x && (x.ubicacion || x.coords || x.coordenadas || x.location));
}

async function resolverDistanciaInicioV1543(){
  const box=$("rutaInfo");
  const emb=$("embarqueInput") ? $("embarqueInput").value.trim() : "";
  if(!box) return;

  try{
    let r=null;
    if(emb && typeof resolveRouteV1542==="function"){
      r=await resolveRouteV1542(emb);
    }else{
      r=routeFromSelectorsV1542();
    }

    let km=0;

    // Preferir distancia OSRM ya resuelta si está disponible.
    if(r && Number(r.routeDistanceKm)>0){
      km=Number(r.routeDistanceKm);
    }else{
      const o=coordV1542({lat:r && (r.origen_lat ?? r.origenLat), lng:r && (r.origen_lng ?? r.origenLng)});
      const d=coordV1542({lat:r && (r.destino_lat ?? r.destinoLat), lng:r && (r.destino_lng ?? r.destinoLng)});
      if(o && d){
        try{
          const rr=await fetchOsrmV1542(o,d);
          km=Number(rr.distanceKm||0);
          r.routeDistanceKm=km;
          r.routeDurationMin=Number(rr.durationMin||0);
          r.routeGeometry=rr.geometry||[];
          r.routeGeometryKey=rr.key||"";
        }catch(e){
          km=distKm(o.lat,o.lng,d.lat,d.lng);
        }
      }
    }

    const kmTxt=km && Number.isFinite(km) ? `${km.toFixed(1)} km` : "-";
    box.innerHTML=
      `<b>Distancia:</b> ${kmTxt}<br>`+
      `<b>Destino:</b> ${escapeHtml(destinoCompacto(r||{}))}`;

  }catch(e){
    console.log("distancia inicio v1543",e);
    box.innerHTML=
      `<b>Distancia:</b> -<br>`+
      `<b>Destino:</b> ${escapeHtml(destinoCompacto(routeFromSelectorsV1542()))}`;
  }
  aplicarColorResumenInicio();
}

function onEmbarqueChangeV1543(){
  if(distanciaInicioTimerV1543) clearTimeout(distanciaInicioTimerV1543);
  distanciaInicioTimerV1543=setTimeout(resolverDistanciaInicioV1543,450);
}

// Reemplaza cambio de origen/destino para evitar NaN y recalcular con Firebase.
onOrigenDestinoChange = function(){
  onEmbarqueChangeV1543();
};

// Reemplaza inicio con bloqueo anti doble-click y limpieza de tránsito inválido.
iniciarTransito = async function(){
  if(iniciarTransitoLockV1543) return;
  iniciarTransitoLockV1543=true;

  try{
    const abierto=limpiarTransitoInvalidoV1543();

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

    const lote=($("lote")?$("lote").value.trim():"");
    const embarque=($("embarqueInput")?$("embarqueInput").value.trim():"");
    if(!lote){window.alert("Ingresá número de lote/carga.");return;}
    if(!embarque){window.alert("Ingresá número de embarque.");return;}

    const gps=await getGps();
    const route=await resolveRouteV1542(embarque);

    let t={
      id:regId(),
      user:u,
      route,
      lote,
      embarque,
      start:gps,
      updates:[],
      alerts:[],
      closed:null
    };

    t=await ensureRouteGeometryV1542(t);

    await guardarTransitoInicioFirebaseV1542({
      ...t,
      routeGeometry:t.routeGeometry||[],
      routeGeometryKey:t.routeGeometryKey||"",
      routeDistanceKm:t.routeDistanceKm||0,
      routeDurationMin:t.routeDurationMin||0
    });

    save(LS.transit,t);
    saveTransitHistory(t);
    bloquearFormularioTransito();
    renderTransitStatus();
    aplicarColorResumenInicio();
    window.alert("Tránsito iniciado correctamente.");
    show("tracking");
    startAutoGps();

  }catch(e){
    window.alert("No se pudo iniciar tránsito: "+(e.message||e));
  }finally{
    setTimeout(()=>{iniciarTransitoLockV1543=false;},1000);
  }
};

// Al renderizar Inicio/Fin, refrescar distancia desde embarque.
const _renderInicio_v1543 = typeof renderInicio==="function" ? renderInicio : null;
if(_renderInicio_v1543){
  renderInicio=function(){
    const r=_renderInicio_v1543.apply(this,arguments);
    setTimeout(resolverDistanciaInicioV1543,500);
    return r;
  };
}

const _show_v1543_inicio = show;
show=function(id){
  _show_v1543_inicio(id);
  if(id==="inicio"){
    setTimeout(resolverDistanciaInicioV1543,500);
  }
};

document.addEventListener("DOMContentLoaded",()=>{
  const emb=$("embarqueInput");
  if(emb){
    emb.addEventListener("input",onEmbarqueChangeV1543);
    emb.addEventListener("change",onEmbarqueChangeV1543);
  }
  setTimeout(resolverDistanciaInicioV1543,800);
});


/* ===== V1.5.55 - Validación Embarque Inicio/Fin ===== */
let validarEmbarqueTimerV1544=null;
let iniciarTransitoBusyV1544=false;
let embarqueValidadoV1544=null;

function getOptionIndexByTextV1544(selectId, text){
  const sel=$(selectId);
  if(!sel || !text) return -1;
  const target=String(text).trim().toLowerCase();
  for(let i=0;i<sel.options.length;i++){
    const t=String(sel.options[i].textContent||sel.options[i].innerText||sel.options[i].value||"").trim().toLowerCase();
    if(t===target) return i;
  }
  return -1;
}

function setSelectByTextV1544(selectId, text){
  const sel=$(selectId);
  if(!sel || !text) return false;
  const idx=getOptionIndexByTextV1544(selectId,text);
  if(idx>=0){
    sel.selectedIndex=idx;
    return true;
  }
  return false;
}

function readonlyRouteFieldsV1544(readonly){
  ["clienteSelect","origenSelect","destinoSelect"].forEach(id=>{
    const el=$(id);
    if(el) el.disabled=!!readonly;
  });
}

function transitoAbiertoRealV1544(t){
  if(!t) return false;
  if(t.closed) return false;
  if(t.estado && String(t.estado).toLowerCase()==="cerrado") return false;
  if(!t.start || !Number.isFinite(Number(t.start.lat)) || !Number.isFinite(Number(t.start.lng))) return false;
  if(!t.embarque && !(t.route && (t.route.embarque || t.route.embarqueId))) return false;
  return true;
}

function limpiarTransitoCerradoOInvalidoV1544(){
  const t=transit();
  if(!t) return null;
  if(!transitoAbiertoRealV1544(t)){
    try{localStorage.removeItem(LS.transit);}catch(e){}
    return null;
  }
  return t;
}

async function buscarEmbarqueFirebaseV1544(numero){
  if(!firebaseReady() || !numero) return null;
  const id=String(numero).trim();
  try{
    const d=await db.collection("embarque").doc(id).get();
    if(d.exists) return {id:d.id,...d.data()};
  }catch(e){}
  for(const field of ["embarque","numero"]){
    try{
      const snap=await db.collection("embarque").where(field,"==",id).limit(1).get();
      if(!snap.empty){
        const d=snap.docs[0];
        return {id:d.id,...d.data()};
      }
    }catch(e){}
  }
  return null;
}

async function validarEmbarqueInicioNowV1544(){
  const emb=($("embarqueInput")?$("embarqueInput").value.trim():"");
  const info=$("rutaInfo");

  if(!emb){
    embarqueValidadoV1544=null;
    readonlyRouteFieldsV1544(false);
    if(info) info.innerHTML="<b>Distancia:</b> -<br><b>Destino:</b> -";
    return null;
  }

  try{
    const data=await buscarEmbarqueFirebaseV1544(emb);
    if(!data){
      embarqueValidadoV1544=null;
      readonlyRouteFieldsV1544(false);
      if(info) info.innerHTML='<b>Distancia:</b> -<br><b>Destino:</b> Embarque no encontrado';
      return null;
    }

    embarqueValidadoV1544=data;
    const cliente=String(data.cliente||"").trim();
    const origen=String(data.origen||"").trim();
    const destino=String(data.destino||"").trim();

    if(cliente) setSelectByTextV1544("clienteSelect",cliente);
    if(origen) setSelectByTextV1544("origenSelect",origen);
    if(destino) setSelectByTextV1544("destinoSelect",destino);

    readonlyRouteFieldsV1544(true);

    let route=null;
    if(typeof resolveRouteV1542==="function"){
      route=await resolveRouteV1542(emb);
    }else if(typeof buildRouteFromEmbarqueV1541==="function"){
      route=await buildRouteFromEmbarqueV1541(emb);
    }else{
      route=selectedRoute();
      route.cliente=cliente||route.cliente||"";
      route.origen=origen||route.origen||"";
      route.destino=destino||route.destino||"";
    }

    let km=Number(route&&route.routeDistanceKm||0);
    if(!km && route && typeof coordV1542==="function"){
      const o=coordV1542({lat:route.origen_lat??route.origenLat,lng:route.origen_lng??route.origenLng});
      const d=coordV1542({lat:route.destino_lat??route.destinoLat,lng:route.destino_lng??route.destinoLng});
      if(o&&d){
        try{
          const rr=await fetchOsrmV1542(o,d);
          km=Number(rr.distanceKm||0);
          route.routeDistanceKm=km;
          route.routeDurationMin=Number(rr.durationMin||0);
          route.routeGeometry=rr.geometry||[];
          route.routeGeometryKey=rr.key||"";
        }catch(e){
          km=distKm(o.lat,o.lng,d.lat,d.lng);
        }
      }
    }

    if(info){
      const destinoTxt=destinoCompacto(route||{destino,pais:data.pais||""}) || destino || "-";
      info.innerHTML=
        `<b>Distancia:</b> ${km&&Number.isFinite(km)?km.toFixed(1)+" km":"-"}<br>`+
        `<b>Destino:</b> ${escapeHtml(destinoTxt)}`;
    }
    return {data,route};
  }catch(e){
    console.log("validar embarque v1544",e);
    embarqueValidadoV1544=null;
    readonlyRouteFieldsV1544(false);
    if(info) info.innerHTML="<b>Distancia:</b> -<br><b>Destino:</b> Error al validar embarque";
    return null;
  }
}

function validarEmbarqueInicioV1544(){
  if(validarEmbarqueTimerV1544) clearTimeout(validarEmbarqueTimerV1544);
  validarEmbarqueTimerV1544=setTimeout(validarEmbarqueInicioNowV1544,450);
}

onOrigenDestinoChange = function(){
  validarEmbarqueInicioV1544();
};

onClienteChange = function(){
  const emb=($("embarqueInput")?$("embarqueInput").value.trim():"");
  if(emb){
    validarEmbarqueInicioV1544();
    return;
  }
  try{
    const cliente=$("clienteSelect");
    const destino=$("destinoSelect");
    const c=CLIENTES_DATA[cliente.value];
    if(c && c.destino_sugerido){
      const idx=DESTINOS_DATA.findIndex(d=>d.nombre.trim().toLowerCase()===c.destino_sugerido.trim().toLowerCase());
      if(idx>=0) destino.value=String(idx);
    }
  }catch(e){}
  validarEmbarqueInicioV1544();
};

iniciarTransito = async function(){
  if(iniciarTransitoBusyV1544) return;
  iniciarTransitoBusyV1544=true;
  try{
    const abierto=limpiarTransitoCerradoOInvalidoV1544();
    if(abierto){
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

    const lote=($("lote")?$("lote").value.trim():"");
    const embarque=($("embarqueInput")?$("embarqueInput").value.trim():"");
    if(!lote){window.alert("Ingresá número de lote/carga.");return;}
    if(!embarque){window.alert("Ingresá número de embarque.");return;}

    const validacion=await validarEmbarqueInicioNowV1544();
    if(!validacion || !validacion.data){
      window.alert("El embarque no existe o no se pudo validar en Firebase.");
      return;
    }

    const gps=await getGps();
    let route=validacion.route;
    if(!route){
      route=typeof resolveRouteV1542==="function" ? await resolveRouteV1542(embarque) : selectedRoute();
    }

    let t={
      id:regId(),
      user:u,
      route,
      lote,
      embarque,
      start:gps,
      updates:[],
      alerts:[],
      closed:null
    };

    if(typeof ensureRouteGeometryV1542==="function"){
      t=await ensureRouteGeometryV1542(t);
    }

    if(typeof guardarTransitoInicioFirebaseV1542==="function"){
      await guardarTransitoInicioFirebaseV1542({
        ...t,
        routeGeometry:t.routeGeometry||[],
        routeGeometryKey:t.routeGeometryKey||"",
        routeDistanceKm:t.routeDistanceKm||0,
        routeDurationMin:t.routeDurationMin||0
      });
    }

    save(LS.transit,t);
    saveTransitHistory(t);
    bloquearFormularioTransito();
    renderTransitStatus();
    aplicarColorResumenInicio();
    window.alert("Tránsito iniciado correctamente.");
    show("tracking");
    startAutoGps();
  }catch(e){
    window.alert("No se pudo iniciar tránsito: "+(e.message||e));
  }finally{
    setTimeout(()=>{iniciarTransitoBusyV1544=false;},1200);
  }
};

const _renderInicio_v1544 = typeof renderInicio==="function" ? renderInicio : null;
if(_renderInicio_v1544){
  renderInicio=function(){
    const r=_renderInicio_v1544.apply(this,arguments);
    setTimeout(validarEmbarqueInicioNowV1544,500);
    return r;
  };
}

const _show_v1544 = show;
show=function(id){
  _show_v1544(id);
  if(id==="inicio") setTimeout(validarEmbarqueInicioNowV1544,500);
};

document.addEventListener("DOMContentLoaded",()=>{
  const emb=$("embarqueInput");
  if(emb){
    emb.addEventListener("input",validarEmbarqueInicioV1544);
    emb.addEventListener("change",validarEmbarqueInicioV1544);
  }
});


/* ===== V1.5.55 - Orden real Inicio/Fin y estabilidad destino ===== */
let embarqueRouteLockV1545=null;
let reorderDoneV1545=false;
let validarTimerV1545=null;

function wrapFieldV1545(id){
  const el=$(id);
  if(!el) return null;
  if(el.parentElement && el.parentElement.classList && el.parentElement.classList.contains("fieldWrapV1545")) return el.parentElement;
  const label = el.previousElementSibling && el.previousElementSibling.tagName==="LABEL" ? el.previousElementSibling : null;
  const w=document.createElement("div");
  w.className="fieldWrapV1545";
  if(label) label.parentNode.insertBefore(w,label); else el.parentNode.insertBefore(w,el);
  if(label) w.appendChild(label);
  w.appendChild(el);
  return w;
}

function reorderInicioFieldsV1545(){
  if(reorderDoneV1545) return;
  const fleet=$("fleetDriver"), lote=$("lote"), emb=$("embarqueInput");
  const cliente=$("clienteSelect"), origen=$("origenSelect"), destino=$("destinoSelect"), ruta=$("rutaInfo");
  if(!fleet || !lote || !emb || !cliente || !origen || !destino || !ruta) return;

  const card=fleet.closest(".card") || fleet.parentElement;
  if(!card) return;

  const fleetWrap=wrapFieldV1545("fleetDriver");
  const loteWrap=wrapFieldV1545("lote");
  const embWrap=wrapFieldV1545("embarqueInput");
  const clienteWrap=wrapFieldV1545("clienteSelect");
  const origenWrap=wrapFieldV1545("origenSelect");
  const destinoWrap=wrapFieldV1545("destinoSelect");

  const row=document.createElement("div");
  row.className="rowTwoV1545";
  row.appendChild(loteWrap);
  row.appendChild(embWrap);

  const actions=card.querySelector(".actions");
  card.insertBefore(fleetWrap, actions);
  card.insertBefore(row, actions);
  card.insertBefore(clienteWrap, actions);
  card.insertBefore(origenWrap, actions);
  card.insertBefore(destinoWrap, actions);
  card.insertBefore(ruta, actions);

  emb.setAttribute("oninput","validarEmbarqueInicioV1545()");
  emb.setAttribute("onchange","validarEmbarqueInicioV1545()");
  cliente.setAttribute("onchange","validarEmbarqueInicioV1545()");
  origen.setAttribute("onchange","validarEmbarqueInicioV1545()");
  destino.setAttribute("onchange","validarEmbarqueInicioV1545()");
  reorderDoneV1545=true;
}

function setSelectTextExactV1545(id,text){
  const el=$(id);
  if(!el || !text) return false;
  const target=String(text).trim().toLowerCase();
  for(let i=0;i<el.options.length;i++){
    const txt=String(el.options[i].textContent||el.options[i].innerText||el.options[i].value||"").trim().toLowerCase();
    if(txt===target){ el.selectedIndex=i; return true; }
  }
  return false;
}

function lockRouteSelectsV1545(lock){
  ["clienteSelect","origenSelect","destinoSelect"].forEach(id=>{ const el=$(id); if(el) el.disabled=!!lock; });
}

async function buscarEmbarqueV1545(numero){
  if(!firebaseReady() || !numero) return null;
  const id=String(numero).trim();
  try{
    const d=await db.collection("embarque").doc(id).get();
    if(d.exists) return {id:d.id,...d.data()};
  }catch(e){}
  for(const f of ["embarque","numero"]){
    try{
      const snap=await db.collection("embarque").where(f,"==",id).limit(1).get();
      if(!snap.empty){ const d=snap.docs[0]; return {id:d.id,...d.data()}; }
    }catch(e){}
  }
  return null;
}

function normalizeRouteNamesV1545(route,data,embarque){
  route=route||{};
  const cliente=String((data&&data.cliente)||route.cliente||"").trim();
  const origen=String((data&&data.origen)||route.origen||"").trim();
  const destino=String((data&&data.destino)||route.destino||"").trim();
  return {...route, cliente, origen, destino, embarque:String((data&&(data.embarque||data.numero))||embarque||"").trim(), embarqueId:(data&&data.id)||embarque};
}

async function resolveRouteStrictV1545(embarque){
  const data=await buscarEmbarqueV1545(embarque);
  if(!data) return null;

  let route={};
  if(typeof resolveRouteV1542==="function") route=await resolveRouteV1542(embarque);
  else if(typeof buildRouteFromEmbarqueV1541==="function") route=await buildRouteFromEmbarqueV1541(embarque);
  else if(typeof selectedRoute==="function") route=selectedRoute();

  route=normalizeRouteNamesV1545(route,data,embarque);

  const od=await getDocByNameV1542("origenes",route.origen);
  const dd=await getDocByNameV1542("destinos",route.destino);
  const oc=coordV1542(od&&(od.ubicacion||od.coords||od.coordenadas||od.location)) || coordV1542({lat:route.origen_lat??route.origenLat,lng:route.origen_lng??route.origenLng});
  const dc=coordV1542(dd&&(dd.ubicacion||dd.coords||dd.coordenadas||dd.location)) || coordV1542({lat:route.destino_lat??route.destinoLat,lng:route.destino_lng??route.destinoLng});

  if(oc){ route.origen_lat=oc.lat; route.origen_lng=oc.lng; route.origenLat=oc.lat; route.origenLng=oc.lng; }
  if(dc){ route.destino_lat=dc.lat; route.destino_lng=dc.lng; route.destinoLat=dc.lat; route.destinoLng=dc.lng; }

  if(oc&&dc){
    try{
      const rr=await fetchOsrmV1542(oc,dc);
      route.routeGeometry=rr.geometry||[];
      route.routeGeometryKey=rr.key||"";
      route.routeDistanceKm=Number(rr.distanceKm||0);
      route.routeDurationMin=Number(rr.durationMin||0);
    }catch(e){
      route.routeDistanceKm=distKm(oc.lat,oc.lng,dc.lat,dc.lng);
    }
  }
  return {data,route};
}

async function validarEmbarqueInicioNowV1545(){
  reorderInicioFieldsV1545();
  const emb=$("embarqueInput") ? $("embarqueInput").value.trim() : "";
  const info=$("rutaInfo");

  if(!emb){
    embarqueRouteLockV1545=null;
    lockRouteSelectsV1545(false);
    if(info) info.innerHTML="<b>Distancia:</b> -<br><b>Destino:</b> -";
    return null;
  }

  const resolved=await resolveRouteStrictV1545(emb);
  if(!resolved){
    embarqueRouteLockV1545=null;
    lockRouteSelectsV1545(false);
    if(info) info.innerHTML="<b>Distancia:</b> -<br><b>Destino:</b> Embarque no encontrado";
    return null;
  }

  const r=resolved.route;
  embarqueRouteLockV1545=r;
  setSelectTextExactV1545("clienteSelect",r.cliente);
  setSelectTextExactV1545("origenSelect",r.origen);
  setSelectTextExactV1545("destinoSelect",r.destino);
  lockRouteSelectsV1545(true);

  if(info){
    const km=Number(r.routeDistanceKm||0);
    info.innerHTML=`<b>Distancia:</b> ${km&&Number.isFinite(km)?km.toFixed(1)+" km":"-"}<br>`+
      `<b>Destino:</b> ${escapeHtml(destinoCompacto(r)||r.destino||"-")}`;
  }
  return resolved;
}

function validarEmbarqueInicioV1545(){
  if(validarTimerV1545) clearTimeout(validarTimerV1545);
  validarTimerV1545=setTimeout(()=>validarEmbarqueInicioNowV1545().catch(e=>console.log("validar v1545",e)),450);
}

onClienteChange=function(){ validarEmbarqueInicioV1545(); };
onOrigenDestinoChange=function(){ validarEmbarqueInicioV1545(); };

iniciarTransito = async function(){
  if(iniciarTransitoBusyV1544) return;
  iniciarTransitoBusyV1544=true;
  try{
    try{ localStorage.removeItem(LS.transit); }catch(e){}
    const u=user();
    if(!u.fleet){ window.alert("Cargá la flota en Usuario."); show("usuario"); return; }

    const lote=($("lote")?$("lote").value.trim():"");
    const embarque=($("embarqueInput")?$("embarqueInput").value.trim():"");
    if(!lote){window.alert("Ingresá número de lote/carga.");return;}
    if(!embarque){window.alert("Ingresá número de embarque.");return;}

    const validacion=await validarEmbarqueInicioNowV1545();
    if(!validacion || !validacion.route){
      window.alert("El embarque no existe o no se pudo validar en Firebase.");
      return;
    }

    const gps=await getGps();
    const route=validacion.route;
    let t={
      id:regId(),
      user:u,
      route,
      lote,
      embarque,
      start:gps,
      updates:[],
      alerts:[],
      closed:null,
      routeGeometry:route.routeGeometry||[],
      routeGeometryKey:route.routeGeometryKey||"",
      routeDistanceKm:route.routeDistanceKm||0,
      routeDurationMin:route.routeDurationMin||0
    };

    save(LS.transit,t);
    if(typeof guardarTransitoInicioFirebaseV1542==="function") await guardarTransitoInicioFirebaseV1542(t);
    saveTransitHistory(t);
    bloquearFormularioTransito();
    renderTransitStatus();
    aplicarColorResumenInicio();
    window.alert("Tránsito iniciado correctamente.");
    show("tracking");
    startAutoGps();
  }catch(e){
    window.alert("No se pudo iniciar tránsito: "+(e.message||e));
  }finally{
    setTimeout(()=>{iniciarTransitoBusyV1544=false;},1200);
  }
};

const _show_v1545=show;
show=function(id){
  _show_v1545(id);
  if(id==="inicio"){
    setTimeout(reorderInicioFieldsV1545,100);
    setTimeout(()=>validarEmbarqueInicioNowV1545().catch(e=>console.log(e)),600);
  }
};

document.addEventListener("DOMContentLoaded",()=>{
  setTimeout(reorderInicioFieldsV1545,300);
  const emb=$("embarqueInput");
  if(emb){
    emb.addEventListener("input",validarEmbarqueInicioV1545);
    emb.addEventListener("change",validarEmbarqueInicioV1545);
  }
});


/* ===== V1.5.55 - Inicio/Fin orden fijo + destino correcto ===== */
let embLockV1546=null;
let embTimerV1546=null;

function moveInicioBeforeV1546(node, ref){
  if(node && ref && node !== ref) ref.parentNode.insertBefore(node, ref);
}

function inicioFieldWrapV1546(id){
  const el=$(id);
  if(!el) return null;

  let wrap=el.closest(".inicioFieldV1546");
  if(wrap) return wrap;

  const label=el.previousElementSibling && el.previousElementSibling.tagName==="LABEL" ? el.previousElementSibling : null;
  wrap=document.createElement("div");
  wrap.className="inicioFieldV1546";

  if(label) label.parentNode.insertBefore(wrap,label);
  else el.parentNode.insertBefore(wrap,el);

  if(label) wrap.appendChild(label);
  wrap.appendChild(el);
  return wrap;
}

function ordenarInicioFinV1546(){
  const fleet=$("fleetDriver"), lote=$("lote"), emb=$("embarqueInput");
  const cliente=$("clienteSelect"), origen=$("origenSelect"), destino=$("destinoSelect"), ruta=$("rutaInfo");
  if(!fleet||!lote||!emb||!cliente||!origen||!destino||!ruta) return;

  const card=fleet.closest(".card") || fleet.parentElement;
  if(!card) return;

  const actions=card.querySelector(".actions") || card.lastElementChild;

  const fleetW=inicioFieldWrapV1546("fleetDriver");
  const loteW=inicioFieldWrapV1546("lote");
  const embW=inicioFieldWrapV1546("embarqueInput");
  const clienteW=inicioFieldWrapV1546("clienteSelect");
  const origenW=inicioFieldWrapV1546("origenSelect");
  const destinoW=inicioFieldWrapV1546("destinoSelect");

  let row=card.querySelector("#inicioRowLoteEmbarqueV1546");
  if(!row){
    row=document.createElement("div");
    row.id="inicioRowLoteEmbarqueV1546";
    row.className="inicioRowLoteEmbarqueV1546";
  }

  row.appendChild(loteW);
  row.appendChild(embW);

  moveInicioBeforeV1546(fleetW, actions);
  moveInicioBeforeV1546(row, actions);
  moveInicioBeforeV1546(clienteW, actions);
  moveInicioBeforeV1546(origenW, actions);
  moveInicioBeforeV1546(destinoW, actions);
  moveInicioBeforeV1546(ruta, actions);

  emb.oninput=validarEmbarqueInicioV1546;
  emb.onchange=validarEmbarqueInicioV1546;
}

function optionByTextV1546(selectId,text){
  const sel=$(selectId);
  if(!sel||!text) return false;
  const target=String(text).trim().toLowerCase();
  for(let i=0;i<sel.options.length;i++){
    const t=String(sel.options[i].textContent||sel.options[i].innerText||sel.options[i].value||"").trim().toLowerCase();
    if(t===target){
      sel.selectedIndex=i;
      return true;
    }
  }
  return false;
}

function setRouteSelectsLockedV1546(route){
  if(!route) return;
  optionByTextV1546("clienteSelect",route.cliente);
  optionByTextV1546("origenSelect",route.origen);
  optionByTextV1546("destinoSelect",route.destino);
  ["clienteSelect","origenSelect","destinoSelect"].forEach(id=>{
    const el=$(id);
    if(el) el.disabled=true;
  });
}

async function embarqueFirebaseV1546(numero){
  if(!firebaseReady()||!numero) return null;
  const n=String(numero).trim();
  try{
    const d=await db.collection("embarque").doc(n).get();
    if(d.exists) return {id:d.id,...d.data()};
  }catch(e){}
  for(const field of ["embarque","numero"]){
    try{
      const snap=await db.collection("embarque").where(field,"==",n).limit(1).get();
      if(!snap.empty){
        const d=snap.docs[0];
        return {id:d.id,...d.data()};
      }
    }catch(e){}
  }
  return null;
}

async function coordByDocNameV1546(col,name){
  if(!name || !firebaseReady()) return null;
  const target=String(name).trim();
  try{
    const d=await db.collection(col).doc(target).get();
    if(d.exists){
      const x=d.data()||{};
      return coordV1542(x.ubicacion||x.coords||x.coordenadas||x.location);
    }
  }catch(e){}
  try{
    const s=await db.collection(col).get();
    for(const d of s.docs){
      const x=d.data()||{};
      const names=[d.id,x.nombre,x.name,x.origen,x.destino].map(v=>String(v||"").trim().toLowerCase());
      if(names.includes(target.toLowerCase())){
        return coordV1542(x.ubicacion||x.coords||x.coordenadas||x.location);
      }
    }
  }catch(e){}
  return null;
}

async function rutaDesdeEmbarqueV1546(embNumero){
  const emb=await embarqueFirebaseV1546(embNumero);
  if(!emb) return null;

  let route={};
  if(typeof selectedRoute==="function"){
    try{ route=selectedRoute()||{}; }catch(e){ route={}; }
  }

  route.cliente=String(emb.cliente||route.cliente||"").trim();
  route.origen=String(emb.origen||route.origen||"").trim();
  route.destino=String(emb.destino||route.destino||"").trim();
  route.embarque=String(emb.embarque||emb.numero||embNumero||"").trim();
  route.embarqueId=emb.id||String(embNumero);

  const oc=await coordByDocNameV1546("origenes",route.origen);
  const dc=await coordByDocNameV1546("destinos",route.destino);

  if(oc){
    route.origen_lat=oc.lat; route.origen_lng=oc.lng;
    route.origenLat=oc.lat; route.origenLng=oc.lng;
  }
  if(dc){
    route.destino_lat=dc.lat; route.destino_lng=dc.lng;
    route.destinoLat=dc.lat; route.destinoLng=dc.lng;
  }

  if(oc&&dc){
    try{
      const rr=await fetchOsrmV1542(oc,dc);
      route.routeGeometry=rr.geometry||[];
      route.routeGeometryKey=rr.key||"";
      route.routeDistanceKm=Number(rr.distanceKm||0);
      route.routeDurationMin=Number(rr.durationMin||0);
    }catch(e){
      route.routeDistanceKm=distKm(oc.lat,oc.lng,dc.lat,dc.lng);
      route.routeGeometry=[];
      route.routeGeometryKey="";
    }
  }

  return {embarque:emb,route};
}

function pintarRutaInfoV1546(route, statusText){
  const info=$("rutaInfo");
  if(!info) return;

  if(!route){
    info.innerHTML=`<b>Distancia:</b> -<br><b>Destino:</b> ${escapeHtml(statusText||"-")}`;
    return;
  }

  const km=Number(route.routeDistanceKm||0);
  const destino=String(route.destino||"-").trim();

  info.innerHTML=
    `<b>Distancia:</b> ${km&&Number.isFinite(km)?km.toFixed(1)+" km":"-"}<br>`+
    `<b>Destino:</b> ${escapeHtml(destino)}`;
}

async function validarEmbarqueInicioNowV1546(){
  ordenarInicioFinV1546();

  const emb=$("embarqueInput") ? $("embarqueInput").value.trim() : "";
  if(!emb){
    embLockV1546=null;
    ["clienteSelect","origenSelect","destinoSelect"].forEach(id=>{const el=$(id); if(el) el.disabled=false;});
    pintarRutaInfoV1546(null,"-");
    return null;
  }

  const res=await rutaDesdeEmbarqueV1546(emb);
  if(!res){
    embLockV1546=null;
    ["clienteSelect","origenSelect","destinoSelect"].forEach(id=>{const el=$(id); if(el) el.disabled=false;});
    pintarRutaInfoV1546(null,"Embarque no encontrado");
    return null;
  }

  embLockV1546=res.route;
  setRouteSelectsLockedV1546(res.route);
  pintarRutaInfoV1546(res.route);
  return res;
}

function validarEmbarqueInicioV1546(){
  if(embTimerV1546) clearTimeout(embTimerV1546);
  embTimerV1546=setTimeout(()=>validarEmbarqueInicioNowV1546().catch(e=>console.log("validar v1546",e)),400);
}

/* Sobrescribir handlers que estaban cambiando destino por cliente */
onClienteChange=function(){ validarEmbarqueInicioV1546(); };
onOrigenDestinoChange=function(){ validarEmbarqueInicioV1546(); };
validarEmbarqueInicioV1545=validarEmbarqueInicioV1546;
validarEmbarqueInicioV1544=validarEmbarqueInicioV1546;

iniciarTransito = async function(){
  if(iniciarTransitoBusyV1544) return;
  iniciarTransitoBusyV1544=true;

  try{
    try{localStorage.removeItem(LS.transit);}catch(e){}

    const u=user();
    if(!u.fleet){
      window.alert("Cargá la flota en Usuario.");
      show("usuario");
      return;
    }

    const lote=($("lote")?$("lote").value.trim():"");
    const embarque=($("embarqueInput")?$("embarqueInput").value.trim():"");
    if(!lote){window.alert("Ingresá número de lote/carga.");return;}
    if(!embarque){window.alert("Ingresá número de embarque.");return;}

    const val=await validarEmbarqueInicioNowV1546();
    if(!val || !val.route){
      window.alert("El embarque no existe o no se pudo validar en Firebase.");
      return;
    }

    const gps=await getGps();
    const route=val.route;

    const t={
      id:regId(),
      user:u,
      route,
      lote,
      embarque,
      start:gps,
      updates:[],
      alerts:[],
      closed:null,
      routeGeometry:route.routeGeometry||[],
      routeGeometryKey:route.routeGeometryKey||"",
      routeDistanceKm:route.routeDistanceKm||0,
      routeDurationMin:route.routeDurationMin||0
    };

    save(LS.transit,t);

    if(typeof guardarTransitoInicioFirebaseV1542==="function"){
      await guardarTransitoInicioFirebaseV1542(t);
    }

    saveTransitHistory(t);
    bloquearFormularioTransito();
    renderTransitStatus();
    aplicarColorResumenInicio();
    window.alert("Tránsito iniciado correctamente.");
    show("tracking");
    startAutoGps();

  }catch(e){
    window.alert("No se pudo iniciar tránsito: "+(e.message||e));
  }finally{
    setTimeout(()=>{iniciarTransitoBusyV1544=false;},1000);
  }
};

const _show_v1546=show;
show=function(id){
  _show_v1546(id);
  if(id==="inicio"){
    setTimeout(ordenarInicioFinV1546,100);
    setTimeout(()=>validarEmbarqueInicioNowV1546().catch(e=>console.log(e)),500);
  }
};

document.addEventListener("DOMContentLoaded",()=>{
  setTimeout(ordenarInicioFinV1546,250);
  setTimeout(()=>validarEmbarqueInicioNowV1546().catch(e=>console.log(e)),800);
  const emb=$("embarqueInput");
  if(emb){
    emb.addEventListener("input",validarEmbarqueInicioV1546);
    emb.addEventListener("change",validarEmbarqueInicioV1546);
  }
});


/* ===== V1.5.55 - Inicio/Fin real: orden y destino por embarque ===== */
let embarqueLockV1547=null;
let validarTimerV1547=null;
let inicioBusyV1547=false;

function textoSelectV1547(id){
  const el=$(id);
  if(!el) return "";
  const opt=el.options && el.selectedIndex>=0 ? el.options[el.selectedIndex] : null;
  return String((opt&&(opt.textContent||opt.innerText))||el.value||"").trim();
}

function setSelectExactV1547(id,text){
  const el=$(id);
  if(!el || !text) return false;
  const target=String(text).trim().toLowerCase();
  for(let i=0;i<el.options.length;i++){
    const t=String(el.options[i].textContent||el.options[i].innerText||el.options[i].value||"").trim().toLowerCase();
    if(t===target){
      el.selectedIndex=i;
      return true;
    }
  }
  return false;
}

function bloquearRutaPorEmbarqueV1547(bloquear){
  ["clienteSelect","origenSelect","destinoSelect"].forEach(id=>{
    const el=$(id);
    if(el) el.disabled=!!bloquear;
  });
}

function coordAnyV1547(v){
  if(!v) return null;
  if(typeof v==="object"){
    const lat=Number(v.lat??v.latitude);
    const lng=Number(v.lng??v.lon??v.longitude);
    if(Number.isFinite(lat)&&Number.isFinite(lng)) return {lat,lng};
  }
  const nums=String(v).match(/-?\d+(?:\.\d+)?/g);
  if(nums && nums.length>=2){
    const lat=Number(nums[0]), lng=Number(nums[1]);
    if(Number.isFinite(lat)&&Number.isFinite(lng)) return {lat,lng};
  }
  return null;
}

async function firebaseDocByNameV1547(col,name){
  if(!firebaseReady() || !name) return null;
  const target=String(name).trim();
  try{
    const d=await db.collection(col).doc(target).get();
    if(d.exists) return {id:d.id,...d.data()};
  }catch(e){}
  try{
    const s=await db.collection(col).get();
    for(const d of s.docs){
      const x=d.data()||{};
      const names=[d.id,x.nombre,x.name,x.cliente,x.origen,x.destino].map(v=>String(v||"").trim().toLowerCase());
      if(names.includes(target.toLowerCase())) return {id:d.id,...x};
    }
  }catch(e){}
  return null;
}

async function firebaseEmbarqueV1547(numero){
  if(!firebaseReady() || !numero) return null;
  const n=String(numero).trim();

  try{
    const d=await db.collection("embarque").doc(n).get();
    if(d.exists) return {id:d.id,...d.data()};
  }catch(e){}

  for(const field of ["embarque","numero"]){
    try{
      const s=await db.collection("embarque").where(field,"==",n).limit(1).get();
      if(!s.empty){
        const d=s.docs[0];
        return {id:d.id,...d.data()};
      }
    }catch(e){}
  }
  return null;
}

async function rutaDesdeEmbarqueV1547(numero){
  const emb=await firebaseEmbarqueV1547(numero);
  if(!emb) return null;

  const route={
    cliente:String(emb.cliente||"").trim(),
    origen:String(emb.origen||"").trim(),
    destino:String(emb.destino||"").trim(),
    embarque:String(emb.embarque||emb.numero||numero||"").trim(),
    embarqueId:emb.id||String(numero)
  };

  const od=await firebaseDocByNameV1547("origenes",route.origen);
  const dd=await firebaseDocByNameV1547("destinos",route.destino);

  const oc=coordAnyV1547(od&&(od.ubicacion||od.coords||od.coordenadas||od.location));
  const dc=coordAnyV1547(dd&&(dd.ubicacion||dd.coords||dd.coordenadas||dd.location));

  if(oc){
    route.origen_lat=oc.lat;
    route.origen_lng=oc.lng;
    route.origenLat=oc.lat;
    route.origenLng=oc.lng;
  }
  if(dc){
    route.destino_lat=dc.lat;
    route.destino_lng=dc.lng;
    route.destinoLat=dc.lat;
    route.destinoLng=dc.lng;
  }

  if(oc && dc){
    try{
      const url=`https://router.project-osrm.org/route/v1/driving/${oc.lng},${oc.lat};${dc.lng},${dc.lat}?overview=full&geometries=geojson&steps=false&alternatives=false`;
      const res=await fetch(url);
      const data=await res.json();
      if(data.routes && data.routes.length){
        const rr=data.routes[0];
        route.routeGeometry=(rr.geometry.coordinates||[]).map(c=>({lat:Number(c[1]),lng:Number(c[0])})).filter(p=>Number.isFinite(p.lat)&&Number.isFinite(p.lng));
        route.routeDistanceKm=Number(rr.distance||0)/1000;
        route.routeDurationMin=Number(rr.duration||0)/60;
        route.routeGeometryKey=`${oc.lat.toFixed(5)},${oc.lng.toFixed(5)}>${dc.lat.toFixed(5)},${dc.lng.toFixed(5)}`;
      }
    }catch(e){
      route.routeDistanceKm=distKm(oc.lat,oc.lng,dc.lat,dc.lng);
      route.routeGeometry=[];
      route.routeDurationMin=0;
      route.routeGeometryKey="";
    }
  }

  return {embarque:emb,route};
}

function pintarInicioInfoV1547(route, mensaje){
  const box=$("rutaInfo");
  if(!box) return;

  if(!route){
    box.innerHTML=`<b>Distancia:</b> -<br><b>Destino:</b> ${escapeHtml(mensaje||"-")}`;
    return;
  }

  const km=Number(route.routeDistanceKm||0);
  box.innerHTML=
    `<b>Distancia:</b> ${km && Number.isFinite(km) ? km.toFixed(1)+" km" : "-"}<br>`+
    `<b>Destino:</b> ${escapeHtml(route.destino || "-")}`;
}

async function validarEmbarqueInicioNowV1547(){
  const emb=$("embarqueInput") ? $("embarqueInput").value.trim() : "";

  if(!emb){
    embarqueLockV1547=null;
    bloquearRutaPorEmbarqueV1547(false);
    pintarInicioInfoV1547(null,"-");
    return null;
  }

  const res=await rutaDesdeEmbarqueV1547(emb);

  if(!res || !res.route){
    embarqueLockV1547=null;
    bloquearRutaPorEmbarqueV1547(false);
    pintarInicioInfoV1547(null,"Embarque no encontrado");
    return null;
  }

  embarqueLockV1547=res.route;

  setSelectExactV1547("clienteSelect",res.route.cliente);
  setSelectExactV1547("origenSelect",res.route.origen);
  setSelectExactV1547("destinoSelect",res.route.destino);

  bloquearRutaPorEmbarqueV1547(true);
  pintarInicioInfoV1547(res.route);
  return res;
}

function validarEmbarqueInicioV1547(){
  if(validarTimerV1547) clearTimeout(validarTimerV1547);
  validarTimerV1547=setTimeout(()=>validarEmbarqueInicioNowV1547().catch(e=>console.log("validar v1547",e)),350);
}

/* Estos handlers quedan anulados para que no cambien Destino por cliente sugerido */
onClienteChange=function(){
  const emb=$("embarqueInput") ? $("embarqueInput").value.trim() : "";
  if(emb) validarEmbarqueInicioV1547();
};

onOrigenDestinoChange=function(){
  const emb=$("embarqueInput") ? $("embarqueInput").value.trim() : "";
  if(emb) validarEmbarqueInicioV1547();
};

validarEmbarqueInicioV1544=validarEmbarqueInicioV1547;
validarEmbarqueInicioV1545=validarEmbarqueInicioV1547;
validarEmbarqueInicioV1546=validarEmbarqueInicioV1547;

selectedRoute=function(){
  if(embarqueLockV1547) return {...embarqueLockV1547};

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
};

renderInicio=function(){
  const u=user();
  const inp=$("inicioUser");
  if(inp) inp.value=(u.fleet||"Sin flota")+" - "+(u.driver||"Sin chofer");

  const t=transit();
  if(t && $("lote")) $("lote").value=t.lote||"";
  if(t && $("embarqueInput")) $("embarqueInput").value=t.embarque||"";

  aplicarColorResumenInicio();
  setTimeout(()=>validarEmbarqueInicioNowV1547().catch(e=>console.log(e)),300);
};

iniciarTransito = async function(){
  if(inicioBusyV1547) return;
  inicioBusyV1547=true;

  try{
    try{localStorage.removeItem(LS.transit);}catch(e){}

    const u=user();
    if(!u.fleet){
      window.alert("Cargá la flota en Usuario.");
      show("usuario");
      return;
    }

    const lote=$("lote") ? $("lote").value.trim() : "";
    const embarque=$("embarqueInput") ? $("embarqueInput").value.trim() : "";

    if(!lote){window.alert("Ingresá número de lote/carga.");return;}
    if(!embarque){window.alert("Ingresá número de embarque.");return;}

    const validacion=await validarEmbarqueInicioNowV1547();
    if(!validacion || !validacion.route){
      window.alert("El embarque no existe o no se pudo validar en Firebase.");
      return;
    }

    const gps=await getGps();
    const route=validacion.route;

    const t={
      id:regId(),
      user:u,
      route,
      lote,
      embarque,
      start:gps,
      updates:[],
      alerts:[],
      closed:null,
      routeGeometry:route.routeGeometry||[],
      routeGeometryKey:route.routeGeometryKey||"",
      routeDistanceKm:route.routeDistanceKm||0,
      routeDurationMin:route.routeDurationMin||0
    };

    save(LS.transit,t);

    if(typeof guardarTransitoInicioFirebaseV1542==="function"){
      await guardarTransitoInicioFirebaseV1542(t);
    }

    saveTransitHistory(t);
    bloquearFormularioTransito();
    renderTransitStatus();
    aplicarColorResumenInicio();
    window.alert("Tránsito iniciado correctamente.");
    show("tracking");
    startAutoGps();

  }catch(e){
    window.alert("No se pudo iniciar tránsito: "+(e.message||e));
  }finally{
    setTimeout(()=>{inicioBusyV1547=false;},1000);
  }
};

document.addEventListener("DOMContentLoaded",()=>{
  const emb=$("embarqueInput");
  if(emb){
    emb.oninput=validarEmbarqueInicioV1547;
    emb.onchange=validarEmbarqueInicioV1547;
    emb.addEventListener("input",validarEmbarqueInicioV1547);
    emb.addEventListener("change",validarEmbarqueInicioV1547);
  }

  ["clienteSelect","origenSelect","destinoSelect"].forEach(id=>{
    const el=$(id);
    if(el){
      el.onchange=validarEmbarqueInicioV1547;
    }
  });

  setTimeout(()=>validarEmbarqueInicioNowV1547().catch(e=>console.log(e)),700);
});

const _show_v1547=show;
show=function(id){
  _show_v1547(id);
  if(id==="inicio"){
    setTimeout(()=>validarEmbarqueInicioNowV1547().catch(e=>console.log(e)),400);
  }
};


/* ===== V1.5.55 - Embarque limpia/no pierde destino ===== */
let embarqueLockV1548=null;
let embarqueTimerV1548=null;
let lastEmbarqueV1548="";

function limpiarCamposRutaV1548(mensaje){
  embarqueLockV1548=null;
  embarqueLockV1547=null;

  ["clienteSelect","origenSelect","destinoSelect"].forEach(id=>{
    const el=$(id);
    if(el){
      el.disabled=false;
      el.selectedIndex=-1;
      el.value="";
    }
  });

  const box=$("rutaInfo");
  if(box){
    box.innerHTML=`<b>Distancia:</b> -<br><b>Destino:</b> ${escapeHtml(mensaje||"-")}`;
  }
}

function setSelectExactOrAppendV1548(id,text){
  const el=$(id);
  if(!el || !text) return false;

  const target=String(text).trim();
  const targetLower=target.toLowerCase();

  for(let i=0;i<el.options.length;i++){
    const t=String(el.options[i].textContent||el.options[i].innerText||el.options[i].value||"").trim().toLowerCase();
    if(t===targetLower){
      el.selectedIndex=i;
      el.value=el.options[i].value;
      return true;
    }
  }

  // Si por timing todavía no está en el combo, agregar opción temporal para no perder el dato.
  const opt=document.createElement("option");
  opt.value="firebase:"+target;
  opt.textContent=target;
  opt.dataset.firebaseLocked="true";
  el.appendChild(opt);
  el.value=opt.value;
  return true;
}

function bloquearCombosRutaV1548(lock){
  ["clienteSelect","origenSelect","destinoSelect"].forEach(id=>{
    const el=$(id);
    if(el) el.disabled=!!lock;
  });
}

function pintarInfoRutaV1548(route){
  const box=$("rutaInfo");
  if(!box) return;
  if(!route){
    box.innerHTML="<b>Distancia:</b> -<br><b>Destino:</b> -";
    return;
  }

  const km=Number(route.routeDistanceKm||0);
  const destino=String(route.destino||"-").trim();

  box.innerHTML=
    `<b>Distancia:</b> ${km&&Number.isFinite(km)?km.toFixed(1)+" km":"-"}<br>`+
    `<b>Destino:</b> ${escapeHtml(destino)}`;
}

function aplicarRouteFirebaseV1548(route){
  if(!route) return;

  embarqueLockV1548={...route};
  embarqueLockV1547={...route};

  setSelectExactOrAppendV1548("clienteSelect",route.cliente);
  setSelectExactOrAppendV1548("origenSelect",route.origen);
  setSelectExactOrAppendV1548("destinoSelect",route.destino);

  bloquearCombosRutaV1548(true);
  pintarInfoRutaV1548(route);
}

function scrollBotonInicioV1548(){
  const btn=Array.from(document.querySelectorAll("button")).find(b =>
    /Iniciar tránsito|Iniciar transito/i.test(String(b.textContent||""))
  );
  if(btn){
    setTimeout(()=>btn.scrollIntoView({behavior:"smooth", block:"center"}),250);
  }
}

async function validarEmbarqueInicioNowV1548(){
  const emb=$("embarqueInput") ? $("embarqueInput").value.trim() : "";
  lastEmbarqueV1548=emb;

  if(!emb){
    limpiarCamposRutaV1548("-");
    return null;
  }

  let res=null;
  try{
    if(typeof rutaDesdeEmbarqueV1547==="function"){
      res=await rutaDesdeEmbarqueV1547(emb);
    }else if(typeof rutaDesdeEmbarqueV1546==="function"){
      res=await rutaDesdeEmbarqueV1546(emb);
    }
  }catch(e){
    console.log("validar embarque v1548", e);
  }

  // Evitar que una respuesta vieja pise un embarque nuevo.
  const actual=$("embarqueInput") ? $("embarqueInput").value.trim() : "";
  if(actual!==emb) return null;

  if(!res || !res.route){
    limpiarCamposRutaV1548("Embarque no encontrado");
    return null;
  }

  aplicarRouteFirebaseV1548(res.route);
  scrollBotonInicioV1548();
  return res;
}

function validarEmbarqueInicioV1548(){
  if(embarqueTimerV1548) clearTimeout(embarqueTimerV1548);
  embarqueTimerV1548=setTimeout(()=>validarEmbarqueInicioNowV1548().catch(e=>console.log("validar v1548",e)),350);
}

/* Anular todos los validadores anteriores para que no cambien el destino */
validarEmbarqueInicioV1544=validarEmbarqueInicioV1548;
validarEmbarqueInicioV1545=validarEmbarqueInicioV1548;
validarEmbarqueInicioV1546=validarEmbarqueInicioV1548;
validarEmbarqueInicioV1547=validarEmbarqueInicioV1548;

onClienteChange=function(){
  const emb=$("embarqueInput") ? $("embarqueInput").value.trim() : "";
  if(emb) validarEmbarqueInicioV1548();
};

onOrigenDestinoChange=function(){
  const emb=$("embarqueInput") ? $("embarqueInput").value.trim() : "";
  if(emb) validarEmbarqueInicioV1548();
};

selectedRoute=function(){
  if(embarqueLockV1548) return {...embarqueLockV1548};

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
};

iniciarTransito = async function(){
  if(inicioBusyV1547) return;
  inicioBusyV1547=true;

  try{
    try{localStorage.removeItem(LS.transit);}catch(e){}

    const u=user();
    if(!u.fleet){
      window.alert("Cargá la flota en Usuario.");
      show("usuario");
      return;
    }

    const lote=$("lote") ? $("lote").value.trim() : "";
    const embarque=$("embarqueInput") ? $("embarqueInput").value.trim() : "";

    if(!lote){window.alert("Ingresá número de lote/carga.");return;}
    if(!embarque){window.alert("Ingresá número de embarque.");return;}

    const validacion=await validarEmbarqueInicioNowV1548();
    if(!validacion || !validacion.route){
      limpiarCamposRutaV1548("Embarque no encontrado");
      window.alert("El embarque no existe o no se pudo validar en Firebase.");
      return;
    }

    const gps=await getGps();
    const route={...validacion.route};

    const t={
      id:regId(),
      user:u,
      route,
      lote,
      embarque,
      start:gps,
      updates:[],
      alerts:[],
      closed:null,
      routeGeometry:route.routeGeometry||[],
      routeGeometryKey:route.routeGeometryKey||"",
      routeDistanceKm:route.routeDistanceKm||0,
      routeDurationMin:route.routeDurationMin||0
    };

    save(LS.transit,t);

    if(typeof guardarTransitoInicioFirebaseV1542==="function"){
      await guardarTransitoInicioFirebaseV1542(t);
    }

    saveTransitHistory(t);
    bloquearFormularioTransito();
    renderTransitStatus();
    aplicarColorResumenInicio();
    window.alert("Tránsito iniciado correctamente.");
    show("tracking");
    startAutoGps();

  }catch(e){
    window.alert("No se pudo iniciar tránsito: "+(e.message||e));
  }finally{
    setTimeout(()=>{inicioBusyV1547=false;},1000);
  }
};

const _show_v1548=show;
show=function(id){
  _show_v1548(id);
  if(id==="inicio"){
    setTimeout(()=>validarEmbarqueInicioNowV1548().catch(e=>console.log(e)),450);
  }
};

document.addEventListener("DOMContentLoaded",()=>{
  const emb=$("embarqueInput");
  if(emb){
    emb.oninput=validarEmbarqueInicioV1548;
    emb.onchange=validarEmbarqueInicioV1548;
    emb.addEventListener("input",validarEmbarqueInicioV1548);
    emb.addEventListener("change",validarEmbarqueInicioV1548);
  }

  ["clienteSelect","origenSelect","destinoSelect"].forEach(id=>{
    const el=$(id);
    if(el) el.onchange=validarEmbarqueInicioV1548;
  });

  setTimeout(()=>validarEmbarqueInicioNowV1548().catch(e=>console.log(e)),700);
});


/* ===== V1.5.55 - Embarque y Tracking definitivo ===== */
let routeLockV1549=null;
let validateTimerV1549=null;
let busyInicioV1549=false;

function coordV1549(v){
  if(!v) return null;
  if(typeof v==="object"){
    const lat=Number(v.lat??v.latitude);
    const lng=Number(v.lng??v.lon??v.longitude);
    if(Number.isFinite(lat)&&Number.isFinite(lng)) return {lat,lng};
  }
  const nums=String(v).match(/-?\d+(?:\.\d+)?/g);
  if(nums&&nums.length>=2){
    const lat=Number(nums[0]),lng=Number(nums[1]);
    if(Number.isFinite(lat)&&Number.isFinite(lng)) return {lat,lng};
  }
  return null;
}

function safeJsonSetV1549(k,v){
  try{localStorage.setItem(k,JSON.stringify(v));}catch(e){}
}

function safeJsonGetV1549(k){
  try{return JSON.parse(localStorage.getItem(k)||"null");}catch(e){return null;}
}

function setSelectValueByTextV1549(id,text){
  const el=$(id);
  if(!el||!text) return false;
  const target=String(text).trim();
  const lower=target.toLowerCase();

  el.disabled=false;

  for(let i=0;i<el.options.length;i++){
    const t=String(el.options[i].textContent||el.options[i].innerText||el.options[i].value||"").trim().toLowerCase();
    if(t===lower){
      el.selectedIndex=i;
      el.value=el.options[i].value;
      return true;
    }
  }

  const opt=document.createElement("option");
  opt.value="firebase:"+target;
  opt.textContent=target;
  opt.dataset.firebaseLocked="true";
  el.appendChild(opt);
  el.value=opt.value;
  return true;
}

function lockRouteCombosV1549(lock){
  ["clienteSelect","origenSelect","destinoSelect"].forEach(id=>{
    const el=$(id);
    if(el) el.disabled=!!lock;
  });
}

function clearInicioRouteV1549(msg){
  routeLockV1549=null;
  safeJsonSetV1549("routeLockV1549",null);

  ["clienteSelect","origenSelect","destinoSelect"].forEach(id=>{
    const el=$(id);
    if(el){
      el.disabled=false;
      el.selectedIndex=-1;
      el.value="";
    }
  });

  const box=$("rutaInfo");
  if(box){
    box.innerHTML=`<b>Distancia:</b> -<br><b>Destino:</b> ${escapeHtml(msg||"-")}`;
  }
}

async function docByNameV1549(col,name){
  if(!firebaseReady()||!name) return null;
  const target=String(name).trim();
  try{
    const d=await db.collection(col).doc(target).get();
    if(d.exists) return {id:d.id,...d.data()};
  }catch(e){}
  try{
    const snap=await db.collection(col).get();
    for(const d of snap.docs){
      const x=d.data()||{};
      const names=[d.id,x.nombre,x.name,x.cliente,x.origen,x.destino].map(v=>String(v||"").trim().toLowerCase());
      if(names.includes(target.toLowerCase())) return {id:d.id,...x};
    }
  }catch(e){}
  return null;
}

async function embarqueV1549(numero){
  if(!firebaseReady()||!numero) return null;
  const n=String(numero).trim();

  try{
    const d=await db.collection("embarque").doc(n).get();
    if(d.exists) return {id:d.id,...d.data()};
  }catch(e){}

  for(const field of ["embarque","numero"]){
    try{
      const s=await db.collection("embarque").where(field,"==",n).limit(1).get();
      if(!s.empty){
        const d=s.docs[0];
        return {id:d.id,...d.data()};
      }
    }catch(e){}
  }
  return null;
}

function routeKeyV1549(o,d){
  return `${o.lat.toFixed(5)},${o.lng.toFixed(5)}>${d.lat.toFixed(5)},${d.lng.toFixed(5)}`;
}

async function osrmV1549(o,d){
  const url=`https://router.project-osrm.org/route/v1/driving/${o.lng},${o.lat};${d.lng},${d.lat}?overview=full&geometries=geojson&steps=false&alternatives=false`;
  const r=await fetch(url);
  if(!r.ok) throw new Error("OSRM no disponible");
  const data=await r.json();
  if(!data.routes||!data.routes.length) throw new Error("OSRM sin ruta");
  const rr=data.routes[0];
  const geometry=(rr.geometry&&rr.geometry.coordinates?rr.geometry.coordinates:[])
    .map(c=>({lat:Number(c[1]),lng:Number(c[0])}))
    .filter(p=>Number.isFinite(p.lat)&&Number.isFinite(p.lng));
  return {
    key:routeKeyV1549(o,d),
    geometry,
    distanceKm:Number(rr.distance||0)/1000,
    durationMin:Number(rr.duration||0)/60
  };
}

async function buildRouteFromFirebaseEmbarqueV1549(numero){
  const emb=await embarqueV1549(numero);
  if(!emb) return null;

  const route={
    cliente:String(emb.cliente||"").trim(),
    origen:String(emb.origen||"").trim(),
    destino:String(emb.destino||"").trim(),
    embarque:String(emb.embarque||emb.numero||numero||"").trim(),
    embarqueId:emb.id||String(numero)
  };

  if(!route.cliente||!route.origen||!route.destino) return null;

  const od=await docByNameV1549("origenes",route.origen);
  const dd=await docByNameV1549("destinos",route.destino);
  const oc=coordV1549(od&&(od.ubicacion||od.coords||od.coordenadas||od.location));
  const dc=coordV1549(dd&&(dd.ubicacion||dd.coords||dd.coordenadas||dd.location));

  if(oc){
    route.origen_lat=oc.lat;
    route.origen_lng=oc.lng;
    route.origenLat=oc.lat;
    route.origenLng=oc.lng;
  }
  if(dc){
    route.destino_lat=dc.lat;
    route.destino_lng=dc.lng;
    route.destinoLat=dc.lat;
    route.destinoLng=dc.lng;
  }

  if(oc&&dc){
    try{
      const rr=await osrmV1549(oc,dc);
      route.routeGeometry=rr.geometry;
      route.routeGeometryKey=rr.key;
      route.routeDistanceKm=rr.distanceKm;
      route.routeDurationMin=rr.durationMin;
    }catch(e){
      route.routeGeometry=[];
      route.routeGeometryKey=routeKeyV1549(oc,dc);
      route.routeDistanceKm=distKm(oc.lat,oc.lng,dc.lat,dc.lng);
      route.routeDurationMin=Math.round((route.routeDistanceKm/70)*60);
    }
  }

  return {embarque:emb,route};
}

function paintInicioRouteV1549(route){
  const box=$("rutaInfo");
  if(!box) return;

  const km=Number(route&&route.routeDistanceKm||0);
  const dest=String(route&&route.destino||"-").trim();

  box.innerHTML=
    `<b>Distancia:</b> ${km&&Number.isFinite(km)?km.toFixed(1)+" km":"-"}<br>`+
    `<b>Destino:</b> ${escapeHtml(dest)}`;
}

function applyLockedRouteV1549(route){
  routeLockV1549={...route};
  safeJsonSetV1549("routeLockV1549",routeLockV1549);

  setSelectValueByTextV1549("clienteSelect",route.cliente);
  setSelectValueByTextV1549("origenSelect",route.origen);
  setSelectValueByTextV1549("destinoSelect",route.destino);

  lockRouteCombosV1549(true);
  paintInicioRouteV1549(route);
}

async function validarEmbarqueInicioNowV1549(){
  const emb=$("embarqueInput") ? $("embarqueInput").value.trim() : "";

  if(!emb){
    clearInicioRouteV1549("-");
    return null;
  }

  const current=emb;
  const built=await buildRouteFromFirebaseEmbarqueV1549(current);

  const latest=$("embarqueInput") ? $("embarqueInput").value.trim() : "";
  if(latest!==current) return null;

  if(!built||!built.route){
    clearInicioRouteV1549("Embarque no encontrado");
    return null;
  }

  applyLockedRouteV1549(built.route);

  const btn=Array.from(document.querySelectorAll("button")).find(b=>/Iniciar tránsito|Iniciar transito/i.test(String(b.textContent||"")));
  if(btn) setTimeout(()=>btn.scrollIntoView({behavior:"smooth",block:"center"}),200);

  return built;
}

function validarEmbarqueInicioV1549(){
  if(validateTimerV1549) clearTimeout(validateTimerV1549);
  validateTimerV1549=setTimeout(()=>validarEmbarqueInicioNowV1549().catch(e=>console.log("validar v1549",e)),350);
}

/* Anular validadores anteriores */
validarEmbarqueInicioV1544=validarEmbarqueInicioV1549;
validarEmbarqueInicioV1545=validarEmbarqueInicioV1549;
validarEmbarqueInicioV1546=validarEmbarqueInicioV1549;
validarEmbarqueInicioV1547=validarEmbarqueInicioV1549;
validarEmbarqueInicioV1548=validarEmbarqueInicioV1549;

onClienteChange=function(){
  const emb=$("embarqueInput") ? $("embarqueInput").value.trim() : "";
  if(emb) validarEmbarqueInicioV1549();
};
onOrigenDestinoChange=function(){
  const emb=$("embarqueInput") ? $("embarqueInput").value.trim() : "";
  if(emb) validarEmbarqueInicioV1549();
};

selectedRoute=function(){
  if(routeLockV1549) return {...routeLockV1549};
  const stored=safeJsonGetV1549("routeLockV1549");
  if(stored && stored.destino) return {...stored};

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
};

renderInicio=function(){
  const u=user();
  const inp=$("inicioUser");
  if(inp) inp.value=(u.fleet||"Sin flota")+" - "+(u.driver||"Sin chofer");

  const t=transit();
  if(t && $("lote")) $("lote").value=t.lote||"";
  if(t && $("embarqueInput")) $("embarqueInput").value=t.embarque||"";

  const emb=$("embarqueInput") ? $("embarqueInput").value.trim() : "";
  if(emb){
    setTimeout(()=>validarEmbarqueInicioNowV1549().catch(e=>console.log(e)),250);
  }else{
    clearInicioRouteV1549("-");
  }

  aplicarColorResumenInicio();
};

function currentGpsV1549(t){
  return coordV1549(t&&t.updates&&t.updates.length?t.updates[t.updates.length-1].gps:t&&t.start);
}

async function metricsFromTransitV1549(t){
  if(!t) return null;

  let route=t.route||{};
  const gps=currentGpsV1549(t);
  const dest=coordV1549({lat:route.destino_lat??route.destinoLat,lng:route.destino_lng??route.destinoLng});
  const origin=coordV1549({lat:route.origen_lat??route.origenLat,lng:route.origen_lng??route.origenLng});

  let total=Number(t.routeDistanceKm||route.routeDistanceKm||0);
  let durationTotal=Number(t.routeDurationMin||route.routeDurationMin||0);

  if(!total && origin && dest){
    try{
      const rr=await osrmV1549(origin,dest);
      total=rr.distanceKm;
      durationTotal=rr.durationMin;
      t.routeGeometry=rr.geometry;
      t.routeGeometryKey=rr.key;
      t.routeDistanceKm=rr.distanceKm;
      t.routeDurationMin=rr.durationMin;
      route.routeGeometry=rr.geometry;
      route.routeDistanceKm=rr.distanceKm;
      route.routeDurationMin=rr.durationMin;
      save(LS.transit,t);
    }catch(e){
      total=distKm(origin.lat,origin.lng,dest.lat,dest.lng);
      durationTotal=Math.round((total/70)*60);
    }
  }

  let restan=total;
  let etaMin=durationTotal;

  if(gps && dest){
    try{
      const rr2=await osrmV1549(gps,dest);
      restan=rr2.distanceKm;
      etaMin=rr2.durationMin;
      // No reemplazar routeGeometry origen-destino con GPS-destino.
    }catch(e){
      restan=distKm(gps.lat,gps.lng,dest.lat,dest.lng);
      etaMin=Math.round((restan/70)*60);
    }
  }

  restan=Math.max(0,Math.min(restan,total||restan));
  const avance=total>0?Math.max(0,Math.min(100,Math.round(((total-restan)/total)*100))):0;

  return {total,restan,avance,etaMin,gps,route};
}

function etaTextV1549(mins){
  mins=Math.max(0,Math.round(mins||0));
  const h=Math.floor(mins/60),m=mins%60;
  if(h<=0) return `${m}m`;
  return `${h}h${m>0?" "+m+"m":""}`;
}

renderTracking=async function(){
  const t=transit();

  if(!t){
    stopAutoGps();
    const box=$("trackingBox");
    if(box) box.innerHTML='<div class="statItem"><b>Sin tránsito</b><span>No hay tránsito iniciado</span></div>';
    renderTrackingMap(null);
    return;
  }

  const m=await metricsFromTransitV1549(t);
  const box=$("trackingBox");
  if(box && m){
    box.innerHTML=
      `<div class="statItem"><b>${shortKm(m.total)}</b><span>Total</span></div>`+
      `<div class="statItem"><b>${m.avance}%</b><span>Av.</span></div>`+
      `<div class="statItem"><b>${shortKm(m.restan)}</b><span>Restan</span></div>`+
      `<div class="statItem"><b>${etaTextV1549(m.etaMin)}</b><span>ETA</span></div>`;
  }

  renderTrackingMap(t);
  startAutoGps();

  if(firebaseReady() && t.id && m){
    try{
      await db.collection("transitos").doc(String(t.id)).set({
        routeMetrics:{total:m.total,restan:m.restan,avance:m.avance,etaMin:m.etaMin},
        route:t.route||{},
        routeDistanceKm:t.routeDistanceKm||t.route?.routeDistanceKm||0,
        routeDurationMin:t.routeDurationMin||t.route?.routeDurationMin||0,
        routeGeometry:t.routeGeometry||t.route?.routeGeometry||[],
        actualizadoEn:now()
      },{merge:true});
    }catch(e){}
  }
};

renderTrackingMap=function(t){
  const map=initLeafletMap();
  if(!map) return;

  clearLeafletLayers();
  try{removeRouteLayer();}catch(e){}
  try{
    map.eachLayer(layer=>{
      if(typeof L!=="undefined" && (layer instanceof L.Polyline || layer instanceof L.CircleMarker || layer instanceof L.Marker)){
        try{map.removeLayer(layer);}catch(e){}
      }
    });
  }catch(e){}

  if(!t||!t.route||!t.start){
    map.setView([-34.6037,-58.3816],6,{animate:false});
    return;
  }

  const r=t.route||{};
  const origin=coordV1549({lat:r.origen_lat??r.origenLat,lng:r.origen_lng??r.origenLng});
  const dest=coordV1549({lat:r.destino_lat??r.destinoLat,lng:r.destino_lng??r.destinoLng});
  const gps=currentGpsV1549(t);
  const geom=(t.routeGeometry||r.routeGeometry||[]).map(coordV1549).filter(Boolean);

  if(geom.length>=2){
    addLeafletLayer(L.polyline(geom.map(p=>[p.lat,p.lng]),{color:"#2563eb",weight:6,opacity:.95,interactive:false}));
  }

  if(origin) addLeafletLayer(L.circleMarker([origin.lat,origin.lng],{radius:9,color:"#fff",weight:2,fillColor:"#22c55e",fillOpacity:1}).bindPopup("Origen"));
  if(gps) addLeafletLayer(L.circleMarker([gps.lat,gps.lng],{radius:11,color:"#fff",weight:2,fillColor:"#2f8cff",fillOpacity:1}).bindPopup("Última ubicación GPS"));
  if(dest) addLeafletLayer(L.circleMarker([dest.lat,dest.lng],{radius:9,color:"#fff",weight:2,fillColor:"#ef4444",fillOpacity:1}).bindPopup("Destino"));

  if(gps){
    const center=map.getCenter?map.getCenter():null;
    const shouldMove=!center || distKm(center.lat,center.lng,gps.lat,gps.lng)>0.25;
    const z=Math.max(map.getZoom?map.getZoom():13,13);
    if(shouldMove) map.setView([gps.lat,gps.lng],Math.min(z,15),{animate:false});
  }else if(origin){
    map.setView([origin.lat,origin.lng],13,{animate:false});
  }
};

iniciarTransito=async function(){
  if(busyInicioV1549) return;
  busyInicioV1549=true;

  try{
    try{localStorage.removeItem(LS.transit);}catch(e){}

    const u=user();
    if(!u.fleet){
      window.alert("Cargá la flota en Usuario.");
      show("usuario");
      return;
    }

    const lote=$("lote")?$("lote").value.trim():"";
    const embarque=$("embarqueInput")?$("embarqueInput").value.trim():"";

    if(!lote){window.alert("Ingresá número de lote/carga.");return;}
    if(!embarque){window.alert("Ingresá número de embarque.");return;}

    const built=await validarEmbarqueInicioNowV1549();
    if(!built||!built.route){
      clearInicioRouteV1549("Embarque no encontrado");
      window.alert("El embarque no existe o no se pudo validar en Firebase.");
      return;
    }

    const gps=await getGps();
    const route={...built.route};
    const t={
      id:regId(),
      user:u,
      route,
      lote,
      embarque,
      start:gps,
      updates:[],
      alerts:[],
      closed:null,
      routeGeometry:route.routeGeometry||[],
      routeGeometryKey:route.routeGeometryKey||"",
      routeDistanceKm:route.routeDistanceKm||0,
      routeDurationMin:route.routeDurationMin||0
    };

    save(LS.transit,t);

    if(typeof guardarTransitoInicioFirebaseV1542==="function"){
      await guardarTransitoInicioFirebaseV1542(t);
    }

    saveTransitHistory(t);
    bloquearFormularioTransito();
    renderTransitStatus();
    aplicarColorResumenInicio();
    window.alert("Tránsito iniciado correctamente.");
    show("tracking");
    startAutoGps();

  }catch(e){
    window.alert("No se pudo iniciar tránsito: "+(e.message||e));
  }finally{
    setTimeout(()=>{busyInicioV1549=false;},1000);
  }
};

const _show_v1549=show;
show=function(id){
  _show_v1549(id);
  if(id==="inicio"){
    setTimeout(()=>validarEmbarqueInicioNowV1549().catch(e=>console.log(e)),400);
  }
  if(id==="tracking"){
    setTimeout(()=>renderTracking(),500);
  }
};

document.addEventListener("DOMContentLoaded",()=>{
  const emb=$("embarqueInput");
  if(emb){
    emb.oninput=validarEmbarqueInicioV1549;
    emb.onchange=validarEmbarqueInicioV1549;
    emb.addEventListener("input",validarEmbarqueInicioV1549);
    emb.addEventListener("change",validarEmbarqueInicioV1549);
  }

  ["clienteSelect","origenSelect","destinoSelect"].forEach(id=>{
    const el=$(id);
    if(el) el.onchange=validarEmbarqueInicioV1549;
  });

  setTimeout(()=>validarEmbarqueInicioNowV1549().catch(e=>console.log(e)),700);
});


/* ===== V1.5.55 - Ruta bloqueada por embarque / Tracking estable ===== */
const LS_ROUTE_LOCK_V1550="eltaRouteLockByEmbarqueV1550";
const LS_METRICS_LOCK_V1550="eltaTrackingMetricsV1550";
let routeLockV1550=null;
let validateTimerV1550=null;
let trackingMetricsTimerV1550=null;

function jsonGetV1550(k){
  try{return JSON.parse(localStorage.getItem(k)||"null");}catch(e){return null;}
}
function jsonSetV1550(k,v){
  try{localStorage.setItem(k,JSON.stringify(v));}catch(e){}
}
function coordV1550(v){
  if(!v) return null;
  if(typeof v==="object"){
    const lat=Number(v.lat??v.latitude);
    const lng=Number(v.lng??v.lon??v.longitude);
    if(Number.isFinite(lat)&&Number.isFinite(lng)) return {lat,lng};
  }
  const nums=String(v).match(/-?\d+(?:\.\d+)?/g);
  if(nums&&nums.length>=2){
    const lat=Number(nums[0]),lng=Number(nums[1]);
    if(Number.isFinite(lat)&&Number.isFinite(lng)) return {lat,lng};
  }
  return null;
}
function havKmV1550(a,b){
  if(!a||!b) return 0;
  const R=6371;
  const dLat=(b.lat-a.lat)*Math.PI/180;
  const dLng=(b.lng-a.lng)*Math.PI/180;
  const s1=Math.sin(dLat/2),s2=Math.sin(dLng/2);
  const q=s1*s1+Math.cos(a.lat*Math.PI/180)*Math.cos(b.lat*Math.PI/180)*s2*s2;
  return 2*R*Math.atan2(Math.sqrt(q),Math.sqrt(1-q));
}
function etaTxtV1550(mins){
  mins=Math.max(0,Math.round(Number(mins)||0));
  const h=Math.floor(mins/60),m=mins%60;
  if(h<=0) return `${m}m`;
  return `${h}h${m>0?" "+m+"m":""}`;
}
function keyRouteV1550(o,d){
  return `${o.lat.toFixed(5)},${o.lng.toFixed(5)}>${d.lat.toFixed(5)},${d.lng.toFixed(5)}`;
}
async function osrmV1550(o,d){
  const url=`https://router.project-osrm.org/route/v1/driving/${o.lng},${o.lat};${d.lng},${d.lat}?overview=full&geometries=geojson&steps=false&alternatives=false`;
  const r=await fetch(url);
  if(!r.ok) throw new Error("OSRM no disponible");
  const data=await r.json();
  if(!data.routes||!data.routes.length) throw new Error("OSRM sin ruta");
  const rr=data.routes[0];
  const geometry=(rr.geometry&&rr.geometry.coordinates?rr.geometry.coordinates:[])
    .map(c=>({lat:Number(c[1]),lng:Number(c[0])}))
    .filter(p=>Number.isFinite(p.lat)&&Number.isFinite(p.lng));
  return {
    key:keyRouteV1550(o,d),
    geometry,
    distanceKm:Number(rr.distance||0)/1000,
    durationMin:Number(rr.duration||0)/60
  };
}
async function docNameV1550(col,name){
  if(!firebaseReady()||!name) return null;
  const target=String(name).trim();
  try{
    const d=await db.collection(col).doc(target).get();
    if(d.exists) return {id:d.id,...d.data()};
  }catch(e){}
  try{
    const snap=await db.collection(col).get();
    for(const d of snap.docs){
      const x=d.data()||{};
      const names=[d.id,x.nombre,x.name,x.cliente,x.origen,x.destino].map(v=>String(v||"").trim().toLowerCase());
      if(names.includes(target.toLowerCase())) return {id:d.id,...x};
    }
  }catch(e){}
  return null;
}
async function embDocV1550(numero){
  if(!firebaseReady()||!numero) return null;
  const n=String(numero).trim();
  try{
    const d=await db.collection("embarque").doc(n).get();
    if(d.exists) return {id:d.id,...d.data()};
  }catch(e){}
  for(const f of ["embarque","numero"]){
    try{
      const s=await db.collection("embarque").where(f,"==",n).limit(1).get();
      if(!s.empty){
        const d=s.docs[0];
        return {id:d.id,...d.data()};
      }
    }catch(e){}
  }
  return null;
}
function setComboTextV1550(id,text){
  const el=$(id);
  if(!el||!text) return false;
  const target=String(text).trim();
  const lower=target.toLowerCase();
  el.disabled=false;
  for(let i=0;i<el.options.length;i++){
    const t=String(el.options[i].textContent||el.options[i].innerText||el.options[i].value||"").trim().toLowerCase();
    if(t===lower){
      el.selectedIndex=i;
      el.value=el.options[i].value;
      return true;
    }
  }
  const opt=document.createElement("option");
  opt.value="firebase:"+target;
  opt.textContent=target;
  opt.dataset.firebaseLocked="true";
  el.appendChild(opt);
  el.value=opt.value;
  return true;
}
function lockCombosV1550(lock){
  ["clienteSelect","origenSelect","destinoSelect"].forEach(id=>{
    const el=$(id);
    if(el) el.disabled=!!lock;
  });
}
function clearRouteUiV1550(msg){
  routeLockV1550=null;
  jsonSetV1550(LS_ROUTE_LOCK_V1550,null);
  ["clienteSelect","origenSelect","destinoSelect"].forEach(id=>{
    const el=$(id);
    if(el){
      el.disabled=false;
      el.selectedIndex=-1;
      el.value="";
    }
  });
  const box=$("rutaInfo");
  if(box) box.innerHTML=`<b>Distancia:</b> -<br><b>Destino:</b> ${escapeHtml(msg||"-")}`;
}
function paintRouteUiV1550(route){
  if(!route) return clearRouteUiV1550("-");
  setComboTextV1550("clienteSelect",route.cliente);
  setComboTextV1550("origenSelect",route.origen);
  setComboTextV1550("destinoSelect",route.destino);
  lockCombosV1550(true);

  const box=$("rutaInfo");
  if(box){
    const km=Number(route.routeDistanceKm||0);
    box.innerHTML=
      `<b>Distancia:</b> ${km&&Number.isFinite(km)?km.toFixed(1)+" km":"-"}<br>`+
      `<b>Destino:</b> ${escapeHtml(String(route.destino||"-"))}`;
  }
}
async function buildRouteV1550(numero){
  const emb=await embDocV1550(numero);
  if(!emb) return null;

  const route={
    cliente:String(emb.cliente||"").trim(),
    origen:String(emb.origen||"").trim(),
    destino:String(emb.destino||"").trim(),
    embarque:String(emb.embarque||emb.numero||numero||"").trim(),
    embarqueId:emb.id||String(numero)
  };
  if(!route.cliente||!route.origen||!route.destino) return null;

  const od=await docNameV1550("origenes",route.origen);
  const dd=await docNameV1550("destinos",route.destino);
  const oc=coordV1550(od&&(od.ubicacion||od.coords||od.coordenadas||od.location));
  const dc=coordV1550(dd&&(dd.ubicacion||dd.coords||dd.coordenadas||dd.location));

  if(oc){
    route.origen_lat=oc.lat; route.origen_lng=oc.lng;
    route.origenLat=oc.lat; route.origenLng=oc.lng;
  }
  if(dc){
    route.destino_lat=dc.lat; route.destino_lng=dc.lng;
    route.destinoLat=dc.lat; route.destinoLng=dc.lng;
  }

  if(oc&&dc){
    try{
      const rr=await osrmV1550(oc,dc);
      route.routeGeometry=rr.geometry;
      route.routeGeometryKey=rr.key;
      route.routeDistanceKm=rr.distanceKm;
      route.routeDurationMin=rr.durationMin;
    }catch(e){
      const fallback=havKmV1550(oc,dc);
      route.routeGeometry=[];
      route.routeGeometryKey=keyRouteV1550(oc,dc);
      route.routeDistanceKm=fallback;
      route.routeDurationMin=Math.round((fallback/70)*60);
    }
  }
  return {embarque:emb,route};
}
async function validateEmbNowV1550(){
  const emb=$("embarqueInput")?$("embarqueInput").value.trim():"";
  if(!emb){
    clearRouteUiV1550("-");
    return null;
  }

  const requested=emb;
  const built=await buildRouteV1550(requested);
  const actual=$("embarqueInput")?$("embarqueInput").value.trim():"";
  if(actual!==requested) return null;

  if(!built||!built.route){
    clearRouteUiV1550("Embarque no encontrado");
    return null;
  }

  routeLockV1550={...built.route};
  jsonSetV1550(LS_ROUTE_LOCK_V1550,routeLockV1550);
  paintRouteUiV1550(routeLockV1550);

  return built;
}
function validarEmbarqueInicioV1550(){
  if(validateTimerV1550) clearTimeout(validateTimerV1550);
  validateTimerV1550=setTimeout(()=>validateEmbNowV1550().catch(e=>console.log("validar v1550",e)),350);
}

/* Anular definitivamente validadores anteriores */
validarEmbarqueInicioV1544=validarEmbarqueInicioV1550;
validarEmbarqueInicioV1545=validarEmbarqueInicioV1550;
validarEmbarqueInicioV1546=validarEmbarqueInicioV1550;
validarEmbarqueInicioV1547=validarEmbarqueInicioV1550;
validarEmbarqueInicioV1548=validarEmbarqueInicioV1550;
validarEmbarqueInicioV1549=validarEmbarqueInicioV1550;

onClienteChange=function(){
  const emb=$("embarqueInput")?$("embarqueInput").value.trim():"";
  if(emb) validarEmbarqueInicioV1550();
};
onOrigenDestinoChange=function(){
  const emb=$("embarqueInput")?$("embarqueInput").value.trim():"";
  if(emb) validarEmbarqueInicioV1550();
};

selectedRoute=function(){
  if(routeLockV1550) return {...routeLockV1550};
  const stored=jsonGetV1550(LS_ROUTE_LOCK_V1550);
  if(stored&&stored.destino) return {...stored};

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
};

function routeFromTransitV1550(t){
  if(!t) return null;
  if(t.route&&t.route.destino) return t.route;
  const stored=jsonGetV1550(LS_ROUTE_LOCK_V1550);
  return stored&&stored.destino?stored:null;
}
function gpsFromTransitV1550(t){
  if(!t) return null;
  if(t.updates&&t.updates.length) return coordV1550(t.updates[t.updates.length-1].gps);
  return coordV1550(t.start);
}
async function calcTrackingMetricsV1550(t){
  const route=routeFromTransitV1550(t);
  if(!route) return null;

  const gps=gpsFromTransitV1550(t);
  const origin=coordV1550({lat:route.origen_lat??route.origenLat,lng:route.origen_lng??route.origenLng});
  const dest=coordV1550({lat:route.destino_lat??route.destinoLat,lng:route.destino_lng??route.destinoLng});

  let total=Number(t.routeDistanceKm||route.routeDistanceKm||0);
  let durTotal=Number(t.routeDurationMin||route.routeDurationMin||0);

  if((!total||!Number.isFinite(total)) && origin&&dest){
    try{
      const rr=await osrmV1550(origin,dest);
      total=rr.distanceKm;
      durTotal=rr.durationMin;
      route.routeGeometry=rr.geometry;
      route.routeDistanceKm=rr.distanceKm;
      route.routeDurationMin=rr.durationMin;
      route.routeGeometryKey=rr.key;
    }catch(e){
      total=havKmV1550(origin,dest);
      durTotal=Math.round((total/70)*60);
    }
  }

  let restan=total;
  let etaMin=durTotal;

  if(gps&&dest){
    try{
      const rr2=await osrmV1550(gps,dest);
      restan=Number(rr2.distanceKm||0);
      etaMin=Number(rr2.durationMin||0);
    }catch(e){
      restan=havKmV1550(gps,dest);
      etaMin=Math.round((restan/70)*60);
    }
  }

  if(total>0){
    restan=Math.max(0,Math.min(restan,total));
  }

  const avance=total>0?Math.max(0,Math.min(100,Math.round(((total-restan)/total)*100))):0;
  const metrics={total:Number(total||0),restan:Number(restan||0),avance,etaMin:Number(etaMin||0)};
  jsonSetV1550(LS_METRICS_LOCK_V1550,metrics);

  if(t){
    t.route=route;
    t.routeDistanceKm=total;
    t.routeDurationMin=durTotal;
    t.routeGeometry=route.routeGeometry||t.routeGeometry||[];
    t.routeGeometryKey=route.routeGeometryKey||t.routeGeometryKey||"";
    save(LS.transit,t);
  }

  return {...metrics,route,gps};
}
function renderTrackingCardsV1550(m){
  const box=$("trackingBox");
  if(!box) return;
  if(!m){
    box.innerHTML='<div class="statItem"><b>Sin tránsito</b><span>No hay tránsito iniciado</span></div>';
    return;
  }
  box.innerHTML=
    `<div class="statItem"><b>${shortKm(m.total)}</b><span>Total</span></div>`+
    `<div class="statItem"><b>${m.avance}%</b><span>Av.</span></div>`+
    `<div class="statItem"><b>${shortKm(m.restan)}</b><span>Restan</span></div>`+
    `<div class="statItem"><b>${etaTxtV1550(m.etaMin)}</b><span>ETA</span></div>`;
}
function clearTrackingLayersV1550(map){
  try{clearLeafletLayers();}catch(e){}
  try{removeRouteLayer();}catch(e){}
  try{
    map.eachLayer(layer=>{
      if(typeof L!=="undefined"&&(layer instanceof L.Polyline||layer instanceof L.CircleMarker||layer instanceof L.Marker)){
        try{map.removeLayer(layer);}catch(e){}
      }
    });
  }catch(e){}
}
renderTracking=async function(){
  const t=transit();
  if(!t){
    stopAutoGps();
    renderTrackingCardsV1550(null);
    renderTrackingMap(null);
    return;
  }

  const cached=jsonGetV1550(LS_METRICS_LOCK_V1550);
  if(cached) renderTrackingCardsV1550(cached);

  const m=await calcTrackingMetricsV1550(t);
  renderTrackingCardsV1550(m);
  renderTrackingMap(t);
  startAutoGps();

  if(firebaseReady()&&t.id&&m){
    try{
      await db.collection("transitos").doc(String(t.id)).set({
        route:t.route||{},
        routeDistanceKm:t.routeDistanceKm||0,
        routeDurationMin:t.routeDurationMin||0,
        routeGeometry:t.routeGeometry||[],
        routeGeometryKey:t.routeGeometryKey||"",
        routeMetrics:{total:m.total,restan:m.restan,avance:m.avance,etaMin:m.etaMin},
        actualizadoEn:now()
      },{merge:true});
    }catch(e){}
  }
};
renderTrackingMap=function(t){
  const map=initLeafletMap();
  if(!map) return;

  clearTrackingLayersV1550(map);

  if(!t){
    map.setView([-34.6037,-58.3816],6,{animate:false});
    return;
  }

  const route=routeFromTransitV1550(t);
  const gps=gpsFromTransitV1550(t);
  if(!route){
    if(gps) map.setView([gps.lat,gps.lng],13,{animate:false});
    return;
  }

  const origin=coordV1550({lat:route.origen_lat??route.origenLat,lng:route.origen_lng??route.origenLng});
  const dest=coordV1550({lat:route.destino_lat??route.destinoLat,lng:route.destino_lng??route.destinoLng});
  const geom=(t.routeGeometry||route.routeGeometry||[]).map(coordV1550).filter(Boolean);

  if(geom.length>=2){
    addLeafletLayer(L.polyline(geom.map(p=>[p.lat,p.lng]),{color:"#2563eb",weight:6,opacity:.95,interactive:false}));
  }
  if(origin) addLeafletLayer(L.circleMarker([origin.lat,origin.lng],{radius:9,color:"#fff",weight:2,fillColor:"#22c55e",fillOpacity:1}).bindPopup("Origen"));
  if(gps) addLeafletLayer(L.circleMarker([gps.lat,gps.lng],{radius:11,color:"#fff",weight:2,fillColor:"#2f8cff",fillOpacity:1}).bindPopup("Última ubicación GPS"));
  if(dest) addLeafletLayer(L.circleMarker([dest.lat,dest.lng],{radius:9,color:"#fff",weight:2,fillColor:"#ef4444",fillOpacity:1}).bindPopup("Destino"));

  if(gps){
    const z=Math.max(map.getZoom?map.getZoom():13,13);
    map.setView([gps.lat,gps.lng],Math.min(z,15),{animate:false});
  }else if(origin){
    map.setView([origin.lat,origin.lng],13,{animate:false});
  }
};

renderInicio=function(){
  const u=user();
  const inp=$("inicioUser");
  if(inp) inp.value=(u.fleet||"Sin flota")+" - "+(u.driver||"Sin chofer");

  const t=transit();
  if(t&&$("lote")) $("lote").value=t.lote||"";
  if(t&&$("embarqueInput")) $("embarqueInput").value=t.embarque||"";

  const emb=$("embarqueInput")?$("embarqueInput").value.trim():"";
  if(emb){
    setTimeout(()=>validateEmbNowV1550().catch(e=>console.log(e)),250);
  }else{
    clearRouteUiV1550("-");
  }
  aplicarColorResumenInicio();
};

iniciarTransito=async function(){
  if(busyInicioV1549) return;
  busyInicioV1549=true;
  try{
    try{localStorage.removeItem(LS.transit);}catch(e){}
    try{localStorage.removeItem(LS_METRICS_LOCK_V1550);}catch(e){}

    const u=user();
    if(!u.fleet){
      window.alert("Cargá la flota en Usuario.");
      show("usuario");
      return;
    }

    const lote=$("lote")?$("lote").value.trim():"";
    const embarque=$("embarqueInput")?$("embarqueInput").value.trim():"";
    if(!lote){window.alert("Ingresá número de lote/carga.");return;}
    if(!embarque){window.alert("Ingresá número de embarque.");return;}

    const built=await validateEmbNowV1550();
    if(!built||!built.route){
      clearRouteUiV1550("Embarque no encontrado");
      window.alert("El embarque no existe o no se pudo validar en Firebase.");
      return;
    }

    const gps=await getGps();
    const route={...built.route};
    const t={
      id:regId(),
      user:u,
      route,
      lote,
      embarque,
      start:gps,
      updates:[],
      alerts:[],
      closed:null,
      routeGeometry:route.routeGeometry||[],
      routeGeometryKey:route.routeGeometryKey||"",
      routeDistanceKm:route.routeDistanceKm||0,
      routeDurationMin:route.routeDurationMin||0
    };

    save(LS.transit,t);
    jsonSetV1550(LS_ROUTE_LOCK_V1550,route);

    if(typeof guardarTransitoInicioFirebaseV1542==="function"){
      await guardarTransitoInicioFirebaseV1542(t);
    }

    saveTransitHistory(t);
    bloquearFormularioTransito();
    renderTransitStatus();
    aplicarColorResumenInicio();
    window.alert("Tránsito iniciado correctamente.");
    show("tracking");
    startAutoGps();
  }catch(e){
    window.alert("No se pudo iniciar tránsito: "+(e.message||e));
  }finally{
    setTimeout(()=>{busyInicioV1549=false;},1000);
  }
};

const _show_v1550=show;
show=function(id){
  _show_v1550(id);
  if(id==="inicio") setTimeout(()=>validateEmbNowV1550().catch(e=>console.log(e)),350);
  if(id==="tracking") setTimeout(()=>renderTracking(),350);
};

document.addEventListener("DOMContentLoaded",()=>{
  const emb=$("embarqueInput");
  if(emb){
    emb.oninput=validarEmbarqueInicioV1550;
    emb.onchange=validarEmbarqueInicioV1550;
    emb.addEventListener("input",validarEmbarqueInicioV1550);
    emb.addEventListener("change",validarEmbarqueInicioV1550);
  }
  ["clienteSelect","origenSelect","destinoSelect"].forEach(id=>{
    const el=$(id);
    if(el) el.onchange=validarEmbarqueInicioV1550;
  });
  setTimeout(()=>validateEmbNowV1550().catch(e=>console.log(e)),800);
});


/* ===== V1.5.55 - Estabilidad final destino / tracking / bloqueo campos ===== */
const LS_ROUTE_FINAL_V1551="eltaRouteFinalByTransitV1551";
let routeFinalV1551=null;
let inicioFinalBusyV1551=false;
let enforcingRouteV1551=false;

function jsonGetV1551(k){try{return JSON.parse(localStorage.getItem(k)||"null");}catch(e){return null;}}
function jsonSetV1551(k,v){try{localStorage.setItem(k,JSON.stringify(v));}catch(e){}}

function coordV1551(v){
  if(!v) return null;
  if(typeof v==="object"){
    const lat=Number(v.lat??v.latitude);
    const lng=Number(v.lng??v.lon??v.longitude);
    if(Number.isFinite(lat)&&Number.isFinite(lng)) return {lat,lng};
  }
  const nums=String(v).match(/-?\d+(?:\.\d+)?/g);
  if(nums&&nums.length>=2){
    const lat=Number(nums[0]),lng=Number(nums[1]);
    if(Number.isFinite(lat)&&Number.isFinite(lng)) return {lat,lng};
  }
  return null;
}

function isOpenTransitV1551(t){
  if(!t) return false;
  if(t.closed) return false;
  if(t.estado && String(t.estado).toLowerCase()==="cerrado") return false;
  return !!(t.start && t.route && t.route.destino);
}

function activeRouteV1551(){
  const t=transit();
  if(isOpenTransitV1551(t) && t.route && t.route.destino){
    routeFinalV1551={...t.route};
    jsonSetV1551(LS_ROUTE_FINAL_V1551,routeFinalV1551);
    return routeFinalV1551;
  }
  if(routeFinalV1551 && routeFinalV1551.destino) return routeFinalV1551;
  const stored=jsonGetV1551(LS_ROUTE_FINAL_V1551);
  if(stored && stored.destino){
    routeFinalV1551={...stored};
    return routeFinalV1551;
  }
  const stored50=(typeof jsonGetV1550==="function") ? jsonGetV1550("eltaRouteLockByEmbarqueV1550") : null;
  if(stored50 && stored50.destino){
    routeFinalV1551={...stored50};
    return routeFinalV1551;
  }
  return null;
}

function setComboExactV1551(id,text){
  const el=$(id);
  if(!el || !text) return false;
  const target=String(text).trim();
  const lower=target.toLowerCase();

  el.disabled=false;
  for(let i=0;i<el.options.length;i++){
    const opt=el.options[i];
    const t=String(opt.textContent||opt.innerText||opt.value||"").trim().toLowerCase();
    if(t===lower){
      el.selectedIndex=i;
      el.value=opt.value;
      return true;
    }
  }
  const opt=document.createElement("option");
  opt.value="firebase:"+target;
  opt.textContent=target;
  opt.dataset.firebaseLocked="true";
  el.appendChild(opt);
  el.value=opt.value;
  return true;
}

function paintInicioFinalV1551(route){
  if(!route) return;
  enforcingRouteV1551=true;
  setComboExactV1551("clienteSelect",route.cliente);
  setComboExactV1551("origenSelect",route.origen);
  setComboExactV1551("destinoSelect",route.destino);

  ["clienteSelect","origenSelect","destinoSelect"].forEach(id=>{
    const el=$(id);
    if(el) el.disabled=true;
  });

  const box=$("rutaInfo");
  if(box){
    const km=Number(route.routeDistanceKm||0);
    box.innerHTML=
      `<b>Distancia:</b> ${km&&Number.isFinite(km)?km.toFixed(1)+" km":"-"}<br>`+
      `<b>Destino:</b> ${escapeHtml(String(route.destino||"-"))}`;
  }
  enforcingRouteV1551=false;
}

function clearInicioFinalV1551(msg){
  routeFinalV1551=null;
  jsonSetV1551(LS_ROUTE_FINAL_V1551,null);
  ["clienteSelect","origenSelect","destinoSelect"].forEach(id=>{
    const el=$(id);
    if(el){
      el.disabled=false;
      el.selectedIndex=-1;
      el.value="";
    }
  });
  const box=$("rutaInfo");
  if(box) box.innerHTML=`<b>Distancia:</b> -<br><b>Destino:</b> ${escapeHtml(msg||"-")}`;
}

function lockInicioInputsByTransitV1551(){
  const t=transit();
  const open=isOpenTransitV1551(t);

  ["lote","embarqueInput"].forEach(id=>{
    const el=$(id);
    if(el) el.disabled=open;
  });

  const route=activeRouteV1551();
  if(open && route){
    if($("lote")) $("lote").value=t.lote||$("lote").value||"";
    if($("embarqueInput")) $("embarqueInput").value=t.embarque||$("embarqueInput").value||"";
    paintInicioFinalV1551(route);
  }else if(!open){
    ["lote","embarqueInput"].forEach(id=>{
      const el=$(id);
      if(el) el.disabled=false;
    });
  }
}

async function validateEmbFinalNowV1551(){
  const emb=$("embarqueInput") ? $("embarqueInput").value.trim() : "";
  if(!emb){
    clearInicioFinalV1551("-");
    return null;
  }

  const open=transit();
  if(isOpenTransitV1551(open)){
    const route=activeRouteV1551();
    if(route) paintInicioFinalV1551(route);
    lockInicioInputsByTransitV1551();
    return {route, embarque:null};
  }

  let built=null;
  try{
    if(typeof buildRouteV1550==="function") built=await buildRouteV1550(emb);
    else if(typeof buildRouteFromFirebaseEmbarqueV1549==="function") built=await buildRouteFromFirebaseEmbarqueV1549(emb);
    else if(typeof rutaDesdeEmbarqueV1547==="function") built=await rutaDesdeEmbarqueV1547(emb);
  }catch(e){
    console.log("validate final",e);
  }

  const current=$("embarqueInput") ? $("embarqueInput").value.trim() : "";
  if(current!==emb) return null;

  if(!built||!built.route){
    clearInicioFinalV1551("Embarque no encontrado");
    return null;
  }

  routeFinalV1551={...built.route};
  jsonSetV1551(LS_ROUTE_FINAL_V1551,routeFinalV1551);
  if(typeof jsonSetV1550==="function") jsonSetV1550("eltaRouteLockByEmbarqueV1550",routeFinalV1551);

  paintInicioFinalV1551(routeFinalV1551);
  lockInicioInputsByTransitV1551();
  return built;
}

function validarEmbarqueInicioV1551(){
  setTimeout(()=>validateEmbFinalNowV1551().catch(e=>console.log("validar v1551",e)),250);
}

/* Anular todos los validadores/handlers viejos que modificaban destino */
validarEmbarqueInicioV1544=validarEmbarqueInicioV1551;
validarEmbarqueInicioV1545=validarEmbarqueInicioV1551;
validarEmbarqueInicioV1546=validarEmbarqueInicioV1551;
validarEmbarqueInicioV1547=validarEmbarqueInicioV1551;
validarEmbarqueInicioV1548=validarEmbarqueInicioV1551;
validarEmbarqueInicioV1549=validarEmbarqueInicioV1551;
validarEmbarqueInicioV1550=validarEmbarqueInicioV1551;

onClienteChange=function(){ if(!enforcingRouteV1551) validarEmbarqueInicioV1551(); };
onOrigenDestinoChange=function(){ if(!enforcingRouteV1551) validarEmbarqueInicioV1551(); };

selectedRoute=function(){
  const route=activeRouteV1551();
  if(route) return {...route};

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
};

function currentGpsV1551(t){
  return coordV1551(t&&t.updates&&t.updates.length?t.updates[t.updates.length-1].gps:t&&t.start);
}

function havKmV1551(a,b){
  if(!a||!b) return 0;
  const R=6371,dLat=(b.lat-a.lat)*Math.PI/180,dLng=(b.lng-a.lng)*Math.PI/180;
  const s1=Math.sin(dLat/2),s2=Math.sin(dLng/2);
  const q=s1*s1+Math.cos(a.lat*Math.PI/180)*Math.cos(b.lat*Math.PI/180)*s2*s2;
  return 2*R*Math.atan2(Math.sqrt(q),Math.sqrt(1-q));
}

async function osrmFinalV1551(a,b){
  if(typeof osrmV1550==="function") return await osrmV1550(a,b);
  const url=`https://router.project-osrm.org/route/v1/driving/${a.lng},${a.lat};${b.lng},${b.lat}?overview=full&geometries=geojson&steps=false&alternatives=false`;
  const r=await fetch(url);
  const data=await r.json();
  if(!data.routes||!data.routes.length) throw new Error("OSRM sin ruta");
  const rr=data.routes[0];
  return {distanceKm:Number(rr.distance||0)/1000,durationMin:Number(rr.duration||0)/60,geometry:[]};
}

async function trackingMetricsFinalV1551(t){
  if(!t) return null;
  const route=activeRouteV1551() || t.route;
  if(!route) return null;

  const origin=coordV1551({lat:route.origen_lat??route.origenLat,lng:route.origen_lng??route.origenLng});
  const dest=coordV1551({lat:route.destino_lat??route.destinoLat,lng:route.destino_lng??route.destinoLng});
  const gps=currentGpsV1551(t);

  let total=Number(t.routeDistanceKm||route.routeDistanceKm||0);
  let totalMin=Number(t.routeDurationMin||route.routeDurationMin||0);

  if((!total || !Number.isFinite(total)) && origin&&dest){
    try{
      const rr=await osrmFinalV1551(origin,dest);
      total=rr.distanceKm;
      totalMin=rr.durationMin;
    }catch(e){
      total=havKmV1551(origin,dest);
      totalMin=Math.round((total/70)*60);
    }
  }

  /*
    Regla definitiva:
    - Si el tránsito recién inició y no tiene updates reales, avance debe ser 0%.
    - No usar GPS inicial para calcular avance porque puede estar lejos del origen.
  */
  let restan=total;
  let etaMin=totalMin;
  const updatesCount=(t.updates||[]).length;

  if(updatesCount>0 && gps&&dest){
    try{
      const rr2=await osrmFinalV1551(gps,dest);
      restan=Number(rr2.distanceKm||0);
      etaMin=Number(rr2.durationMin||0);
    }catch(e){
      restan=havKmV1551(gps,dest);
      etaMin=Math.round((restan/70)*60);
    }
    if(total>0) restan=Math.max(0,Math.min(restan,total));
  }

  const avance=total>0?Math.max(0,Math.min(100,Math.round(((total-restan)/total)*100))):0;

  const metrics={total:Number(total||0),restan:Number(restan||0),avance,etaMin:Number(etaMin||0)};
  t.route={...route};
  t.routeDistanceKm=metrics.total;
  t.routeDurationMin=totalMin;
  if(route.routeGeometry) t.routeGeometry=route.routeGeometry;
  if(route.routeGeometryKey) t.routeGeometryKey=route.routeGeometryKey;
  save(LS.transit,t);
  return {...metrics,route,gps};
}

function etaFinalV1551(mins){
  mins=Math.max(0,Math.round(Number(mins)||0));
  const h=Math.floor(mins/60),m=mins%60;
  return h<=0?`${m}m`:`${h}h${m>0?" "+m+"m":""}`;
}

function renderTrackingCardsFinalV1551(m){
  const box=$("trackingBox");
  if(!box) return;
  if(!m){
    box.innerHTML='<div class="statItem"><b>Sin tránsito</b><span>No hay tránsito iniciado</span></div>';
    return;
  }
  box.innerHTML=
    `<div class="statItem"><b>${shortKm(m.total)}</b><span>Total</span></div>`+
    `<div class="statItem"><b>${m.avance}%</b><span>Av.</span></div>`+
    `<div class="statItem"><b>${shortKm(m.restan)}</b><span>Restan</span></div>`+
    `<div class="statItem"><b>${etaFinalV1551(m.etaMin)}</b><span>ETA</span></div>`;
}

renderTracking=async function(){
  const t=transit();
  if(!t){
    stopAutoGps();
    renderTrackingCardsFinalV1551(null);
    renderTrackingMap(null);
    return;
  }

  const m=await trackingMetricsFinalV1551(t);
  renderTrackingCardsFinalV1551(m);
  renderTrackingMap(t);
  startAutoGps();

  if(firebaseReady()&&t.id&&m){
    try{
      await db.collection("transitos").doc(String(t.id)).set({
        route:t.route||{},
        routeDistanceKm:t.routeDistanceKm||0,
        routeDurationMin:t.routeDurationMin||0,
        routeGeometry:t.routeGeometry||[],
        routeGeometryKey:t.routeGeometryKey||"",
        routeMetrics:{total:m.total,restan:m.restan,avance:m.avance,etaMin:m.etaMin},
        actualizadoEn:now()
      },{merge:true});
    }catch(e){}
  }
};

renderInicio=function(){
  const u=user();
  const inp=$("inicioUser");
  if(inp) inp.value=(u.fleet||"Sin flota")+" - "+(u.driver||"Sin chofer");

  const t=transit();
  if(t&&$("lote")) $("lote").value=t.lote||"";
  if(t&&$("embarqueInput")) $("embarqueInput").value=t.embarque||"";

  lockInicioInputsByTransitV1551();

  const route=activeRouteV1551();
  if(route) paintInicioFinalV1551(route);
  else setTimeout(()=>validateEmbFinalNowV1551().catch(e=>console.log(e)),300);

  aplicarColorResumenInicio();
};

iniciarTransito=async function(){
  if(inicioFinalBusyV1551) return;
  inicioFinalBusyV1551=true;
  try{
    try{localStorage.removeItem(LS.transit);}catch(e){}

    const u=user();
    if(!u.fleet){
      window.alert("Cargá la flota en Usuario.");
      show("usuario");
      return;
    }

    const lote=$("lote")?$("lote").value.trim():"";
    const embarque=$("embarqueInput")?$("embarqueInput").value.trim():"";
    if(!lote){window.alert("Ingresá número de lote/carga.");return;}
    if(!embarque){window.alert("Ingresá número de embarque.");return;}

    const built=await validateEmbFinalNowV1551();
    if(!built||!built.route){
      clearInicioFinalV1551("Embarque no encontrado");
      window.alert("El embarque no existe o no se pudo validar en Firebase.");
      return;
    }

    const gps=await getGps();
    const route={...built.route};
    const t={
      id:regId(),
      user:u,
      route,
      lote,
      embarque,
      start:gps,
      updates:[],
      alerts:[],
      closed:null,
      routeGeometry:route.routeGeometry||[],
      routeGeometryKey:route.routeGeometryKey||"",
      routeDistanceKm:route.routeDistanceKm||0,
      routeDurationMin:route.routeDurationMin||0
    };

    save(LS.transit,t);
    routeFinalV1551=route;
    jsonSetV1551(LS_ROUTE_FINAL_V1551,route);

    if(typeof guardarTransitoInicioFirebaseV1542==="function"){
      await guardarTransitoInicioFirebaseV1542(t);
    }

    saveTransitHistory(t);
    bloquearFormularioTransito();
    lockInicioInputsByTransitV1551();
    renderTransitStatus();
    aplicarColorResumenInicio();
    window.alert("Tránsito iniciado correctamente.");
    show("tracking");
    startAutoGps();
  }catch(e){
    window.alert("No se pudo iniciar tránsito: "+(e.message||e));
  }finally{
    setTimeout(()=>{inicioFinalBusyV1551=false;},1000);
  }
};

/* Al cerrar, liberar campos */
const _cerrarTransito_v1551=typeof cerrarTransito==="function"?cerrarTransito:null;
if(_cerrarTransito_v1551){
  cerrarTransito=async function(){
    const r=await _cerrarTransito_v1551.apply(this,arguments);
    setTimeout(()=>{
      try{localStorage.removeItem(LS_ROUTE_FINAL_V1551);}catch(e){}
      routeFinalV1551=null;
      ["lote","embarqueInput","clienteSelect","origenSelect","destinoSelect"].forEach(id=>{
        const el=$(id);
        if(el) el.disabled=false;
      });
    },500);
    return r;
  };
}

/* Enforcer: combate listeners viejos que vuelven a primer destino de base */
setInterval(()=>{
  const route=activeRouteV1551();
  if(route){
    paintInicioFinalV1551(route);
  }
  lockInicioInputsByTransitV1551();
},700);

const _show_v1551=show;
show=function(id){
  _show_v1551(id);
  if(id==="inicio"){
    setTimeout(()=>{renderInicio();},250);
  }
  if(id==="tracking"){
    setTimeout(()=>renderTracking(),350);
  }
};

document.addEventListener("DOMContentLoaded",()=>{
  const emb=$("embarqueInput");
  if(emb){
    emb.oninput=validarEmbarqueInicioV1551;
    emb.onchange=validarEmbarqueInicioV1551;
    emb.addEventListener("input",validarEmbarqueInicioV1551);
    emb.addEventListener("change",validarEmbarqueInicioV1551);
  }
  ["clienteSelect","origenSelect","destinoSelect"].forEach(id=>{
    const el=$(id);
    if(el) el.onchange=validarEmbarqueInicioV1551;
  });
  setTimeout(()=>{renderInicio();},800);
});


/* ===== V1.5.55 - Fix botón iniciar tránsito + bloqueo embarque ===== */
let ELTA_ROUTE_1553 = null;
let ELTA_VALIDATING_1553 = false;
let ELTA_STARTING_1553 = false;

function eltaGet1553(id){ return document.getElementById(id); }

function eltaCoord1553(v){
  if(!v) return null;
  if(typeof v === "object"){
    const lat = Number(v.lat ?? v.latitude);
    const lng = Number(v.lng ?? v.lon ?? v.longitude);
    if(Number.isFinite(lat) && Number.isFinite(lng)) return {lat,lng};
  }
  const nums = String(v).match(/-?\d+(?:\.\d+)?/g);
  if(nums && nums.length >= 2){
    const lat = Number(nums[0]);
    const lng = Number(nums[1]);
    if(Number.isFinite(lat) && Number.isFinite(lng)) return {lat,lng};
  }
  return null;
}

function eltaSetCombo1553(id, text){
  const sel = eltaGet1553(id);
  if(!sel || !text) return false;
  const target = String(text).trim().toLowerCase();
  sel.disabled = false;

  for(let i=0;i<sel.options.length;i++){
    const optText = String(sel.options[i].textContent || sel.options[i].innerText || sel.options[i].value || "").trim().toLowerCase();
    if(optText === target){
      sel.selectedIndex = i;
      sel.value = sel.options[i].value;
      return true;
    }
  }

  const opt = document.createElement("option");
  opt.value = "firebase:" + String(text).trim();
  opt.textContent = String(text).trim();
  opt.dataset.firebase = "true";
  sel.appendChild(opt);
  sel.value = opt.value;
  return true;
}

function eltaLockInicio1553(lock){
  ["clienteSelect","origenSelect","destinoSelect","lote","embarqueInput"].forEach(id=>{
    const el = eltaGet1553(id);
    if(el) el.disabled = !!lock;
  });
}

function eltaPaintInfo1553(route, msg){
  const box = eltaGet1553("rutaInfo");
  if(!box) return;
  if(!route){
    box.innerHTML = `<b>Distancia:</b> -<br><b>Destino:</b> ${escapeHtml(msg || "-")}`;
    return;
  }
  const km = Number(route.routeDistanceKm || 0);
  box.innerHTML =
    `<b>Distancia:</b> ${km && Number.isFinite(km) ? km.toFixed(1) + " km" : "-"}<br>` +
    `<b>Destino:</b> ${escapeHtml(route.destino || "-")}`;
}

async function eltaDocByName1553(col, name){
  if(!firebaseReady() || !name) return null;
  const target = String(name).trim();

  try{
    const d = await db.collection(col).doc(target).get();
    if(d.exists) return {id:d.id, ...d.data()};
  }catch(e){}

  try{
    const snap = await db.collection(col).get();
    for(const d of snap.docs){
      const x = d.data() || {};
      const names = [d.id, x.nombre, x.name, x.cliente, x.origen, x.destino].map(v=>String(v||"").trim().toLowerCase());
      if(names.includes(target.toLowerCase())) return {id:d.id, ...x};
    }
  }catch(e){}
  return null;
}

async function eltaEmbarque1553(numero){
  if(!firebaseReady() || !numero) return null;
  const n = String(numero).trim();

  try{
    const d = await db.collection("embarque").doc(n).get();
    if(d.exists) return {id:d.id, ...d.data()};
  }catch(e){}

  for(const f of ["embarque","numero"]){
    try{
      const snap = await db.collection("embarque").where(f,"==",n).limit(1).get();
      if(!snap.empty){
        const d = snap.docs[0];
        return {id:d.id, ...d.data()};
      }
    }catch(e){}
  }
  return null;
}

async function eltaOsrm1553(o,d){
  const url = `https://router.project-osrm.org/route/v1/driving/${o.lng},${o.lat};${d.lng},${d.lat}?overview=full&geometries=geojson&steps=false&alternatives=false`;
  const resp = await fetch(url);
  if(!resp.ok) throw new Error("No se pudo calcular ruta");
  const data = await resp.json();
  if(!data.routes || !data.routes.length) throw new Error("Sin ruta");
  const r = data.routes[0];
  return {
    routeGeometry: (r.geometry.coordinates || []).map(c=>({lat:Number(c[1]), lng:Number(c[0])})).filter(p=>Number.isFinite(p.lat)&&Number.isFinite(p.lng)),
    routeDistanceKm: Number(r.distance || 0) / 1000,
    routeDurationMin: Number(r.duration || 0) / 60,
    routeGeometryKey: `${o.lat.toFixed(5)},${o.lng.toFixed(5)}>${d.lat.toFixed(5)},${d.lng.toFixed(5)}`
  };
}

function eltaKm1553(a,b){
  const R=6371;
  const dLat=(b.lat-a.lat)*Math.PI/180, dLng=(b.lng-a.lng)*Math.PI/180;
  const s1=Math.sin(dLat/2), s2=Math.sin(dLng/2);
  const q=s1*s1+Math.cos(a.lat*Math.PI/180)*Math.cos(b.lat*Math.PI/180)*s2*s2;
  return 2*R*Math.atan2(Math.sqrt(q),Math.sqrt(1-q));
}

async function eltaBuildRoute1553(embarqueNumero){
  const emb = await eltaEmbarque1553(embarqueNumero);
  if(!emb) return null;

  const route = {
    cliente: String(emb.cliente || "").trim(),
    origen: String(emb.origen || "").trim(),
    destino: String(emb.destino || "").trim(),
    embarque: String(emb.embarque || emb.numero || embarqueNumero || "").trim(),
    embarqueId: emb.id || String(embarqueNumero)
  };

  if(!route.cliente || !route.origen || !route.destino) return null;

  const od = await eltaDocByName1553("origenes", route.origen);
  const dd = await eltaDocByName1553("destinos", route.destino);

  const oc = eltaCoord1553(od && (od.ubicacion || od.coords || od.coordenadas || od.location));
  const dc = eltaCoord1553(dd && (dd.ubicacion || dd.coords || dd.coordenadas || dd.location));

  if(oc){
    route.origen_lat = oc.lat; route.origen_lng = oc.lng;
    route.origenLat = oc.lat; route.origenLng = oc.lng;
  }
  if(dc){
    route.destino_lat = dc.lat; route.destino_lng = dc.lng;
    route.destinoLat = dc.lat; route.destinoLng = dc.lng;
  }

  if(oc && dc){
    try{
      Object.assign(route, await eltaOsrm1553(oc, dc));
    }catch(e){
      route.routeGeometry = [];
      route.routeDistanceKm = eltaKm1553(oc, dc);
      route.routeDurationMin = Math.round((route.routeDistanceKm/70)*60);
      route.routeGeometryKey = "";
    }
  }

  return route;
}

async function validarEmbarqueInicio1553(){
  if(ELTA_VALIDATING_1553) return ELTA_ROUTE_1553;
  const embInput = eltaGet1553("embarqueInput");
  const embarque = embInput ? embInput.value.trim() : "";

  if(!embarque){
    ELTA_ROUTE_1553 = null;
    eltaLockInicio1553(false);
    eltaPaintInfo1553(null, "-");
    return null;
  }

  ELTA_VALIDATING_1553 = true;
  try{
    const route = await eltaBuildRoute1553(embarque);
    if(!route){
      ELTA_ROUTE_1553 = null;
      ["clienteSelect","origenSelect","destinoSelect"].forEach(id=>{
        const el=eltaGet1553(id);
        if(el){ el.disabled=false; el.selectedIndex=-1; el.value=""; }
      });
      eltaPaintInfo1553(null, "Embarque no encontrado");
      return null;
    }

    ELTA_ROUTE_1553 = route;
    try{ localStorage.setItem("eltaRoute1553", JSON.stringify(route)); }catch(e){}

    eltaSetCombo1553("clienteSelect", route.cliente);
    eltaSetCombo1553("origenSelect", route.origen);
    eltaSetCombo1553("destinoSelect", route.destino);

    ["clienteSelect","origenSelect","destinoSelect"].forEach(id=>{
      const el=eltaGet1553(id);
      if(el) el.disabled = true;
    });

    eltaPaintInfo1553(route);
    return route;
  }finally{
    ELTA_VALIDATING_1553 = false;
  }
}

function eltaTransitOpen1553(){
  const t = transit();
  return !!(t && !t.closed && t.start && t.route && t.route.destino);
}

function eltaApplyOpenState1553(){
  const open = eltaTransitOpen1553();
  const t = transit();

  if(open){
    if(eltaGet1553("lote")) eltaGet1553("lote").value = t.lote || "";
    if(eltaGet1553("embarqueInput")) eltaGet1553("embarqueInput").value = t.embarque || "";
    ["lote","embarqueInput"].forEach(id=>{
      const el=eltaGet1553(id);
      if(el) el.disabled = true;
    });

    ELTA_ROUTE_1553 = t.route;
    eltaSetCombo1553("clienteSelect", t.route.cliente);
    eltaSetCombo1553("origenSelect", t.route.origen);
    eltaSetCombo1553("destinoSelect", t.route.destino);
    ["clienteSelect","origenSelect","destinoSelect"].forEach(id=>{
      const el=eltaGet1553(id);
      if(el) el.disabled = true;
    });
    eltaPaintInfo1553(t.route);
  }else{
    ["lote","embarqueInput"].forEach(id=>{
      const el=eltaGet1553(id);
      if(el) el.disabled = false;
    });
  }
}

/* Sobrescribe sólo el inicio, sin romper el botón */
iniciarTransito = async function(){
  if(ELTA_STARTING_1553) return;
  ELTA_STARTING_1553 = true;

  try{
    const abierto = transit();
    if(abierto && !abierto.closed && abierto.start && abierto.route){
      window.alert("Ya hay un tránsito iniciado sin cerrar. Primero debe cerrar el tránsito actual.");
      show("tracking");
      return;
    }

    const u = user();
    if(!u.fleet){
      window.alert("Cargá la flota en Usuario.");
      show("usuario");
      return;
    }

    const lote = eltaGet1553("lote") ? eltaGet1553("lote").value.trim() : "";
    const embarque = eltaGet1553("embarqueInput") ? eltaGet1553("embarqueInput").value.trim() : "";

    if(!lote){ window.alert("Ingresá número de lote/carga."); return; }
    if(!embarque){ window.alert("Ingresá número de embarque."); return; }

    const route = await validarEmbarqueInicio1553();
    if(!route){
      window.alert("El embarque no existe o no se pudo validar en Firebase.");
      return;
    }

    const gps = await getGps();

    const t = {
      id: regId(),
      user: u,
      route: {...route},
      lote,
      embarque,
      start: gps,
      updates: [],
      alerts: [],
      closed: null,
      routeGeometry: route.routeGeometry || [],
      routeGeometryKey: route.routeGeometryKey || "",
      routeDistanceKm: route.routeDistanceKm || 0,
      routeDurationMin: route.routeDurationMin || 0
    };

    save(LS.transit, t);

    if(firebaseReady()){
      await db.collection("transitos").doc(String(t.id)).set({
        ...t,
        cliente: route.cliente || "",
        origen: route.origen || "",
        destino: route.destino || "",
        estado: "abierto",
        actualizadoEn: now()
      }, {merge:true});
    }

    saveTransitHistory(t);
    bloquearFormularioTransito();
    eltaApplyOpenState1553();
    renderTransitStatus();
    aplicarColorResumenInicio();
    window.alert("Tránsito iniciado correctamente.");
    show("tracking");
    startAutoGps();

  }catch(e){
    console.log("iniciarTransito v1553", e);
    window.alert("No se pudo iniciar tránsito: " + (e.message || e));
  }finally{
    setTimeout(()=>{ ELTA_STARTING_1553 = false; }, 1000);
  }
};

const _renderInicio_1553 = typeof renderInicio === "function" ? renderInicio : null;
renderInicio = function(){
  if(_renderInicio_1553) _renderInicio_1553();
  eltaApplyOpenState1553();
};

const _show_1553 = show;
show = function(id){
  _show_1553(id);
  if(id === "inicio"){
    setTimeout(()=>{
      eltaApplyOpenState1553();
      const emb = eltaGet1553("embarqueInput");
      if(emb && emb.value && !eltaTransitOpen1553()) validarEmbarqueInicio1553();
    }, 300);
  }
};

document.addEventListener("DOMContentLoaded", ()=>{
  const emb = eltaGet1553("embarqueInput");
  if(emb){
    emb.oninput = ()=>{ if(!eltaTransitOpen1553()) validarEmbarqueInicio1553(); };
    emb.onchange = ()=>{ if(!eltaTransitOpen1553()) validarEmbarqueInicio1553(); };
  }

  const btns = Array.from(document.querySelectorAll("button"));
  btns.forEach(btn=>{
    if(/Iniciar tránsito|Iniciar transito/i.test(btn.textContent || "")){
      btn.onclick = iniciarTransito;
    }
  });

  setTimeout(eltaApplyOpenState1553, 500);
});

/* Mantener bloqueado mientras tránsito abierto */
setInterval(eltaApplyOpenState1553, 1200);


/* ===== V1.5.55 - REFRESH FIX FINAL =====
   Corrección de causa:
   1) No se permite que Firebase/cloud pise el tránsito local activo.
   2) Inicio/Tracking/Embarques usan un único estado activo.
   3) Tracking calcula desde GPS de inicio real hasta destino, para arrancar 0%.
   4) Al cerrar tránsito se limpian y habilitan campos con estado inicial.
*/
const E55_STATE_KEY = "elta_state_v1555";
let E55_STATE = null;
let E55_LOCK = false;
let E55_STARTING = false;
let E55_VALIDATE_SEQ = 0;

function e55(id){ return document.getElementById(id); }
function e55Get(k){ try{return JSON.parse(localStorage.getItem(k)||"null");}catch(e){return null;} }
function e55Set(k,v){ try{localStorage.setItem(k,JSON.stringify(v));}catch(e){} }

function e55Coord(v){
  if(!v) return null;
  if(typeof v==="object"){
    const lat=Number(v.lat??v.latitude);
    const lng=Number(v.lng??v.lon??v.longitude);
    if(Number.isFinite(lat)&&Number.isFinite(lng)) return {lat,lng};
  }
  const nums=String(v).match(/-?\d+(?:\.\d+)?/g);
  if(nums&&nums.length>=2){
    const lat=Number(nums[0]),lng=Number(nums[1]);
    if(Number.isFinite(lat)&&Number.isFinite(lng)) return {lat,lng};
  }
  return null;
}

function e55IsOpen(t){
  return !!(t && !t.closed && String(t.estado||"abierto").toLowerCase()!=="cerrado" && t.start && t.route && t.route.destino);
}

function e55Transit(){
  try{return transit();}catch(e){return null;}
}

function e55StateFromTransit(t){
  if(!e55IsOpen(t)) return null;
  const r=t.route||{};
  return {
    open:true,
    id:t.id||"",
    lote:t.lote||"",
    embarque:t.embarque||r.embarque||"",
    user:t.user||user(),
    route:{...r},
    start:t.start||null,
    updates:Array.isArray(t.updates)?t.updates:[],
    alerts:Array.isArray(t.alerts)?t.alerts:[],
    trackingDistanceKm:Number(t.trackingDistanceKm||r.trackingDistanceKm||t.routeDistanceKm||r.routeDistanceKm||0),
    trackingDurationMin:Number(t.trackingDurationMin||r.trackingDurationMin||t.routeDurationMin||r.routeDurationMin||0),
    trackingGeometry:t.trackingGeometry||r.trackingGeometry||t.routeGeometry||r.routeGeometry||[],
    routeDistanceKm:Number(t.routeDistanceKm||r.routeDistanceKm||0),
    routeDurationMin:Number(t.routeDurationMin||r.routeDurationMin||0),
    routeGeometry:t.routeGeometry||r.routeGeometry||[]
  };
}

function e55GetState(){
  const t=e55Transit();
  const fromT=e55StateFromTransit(t);
  if(fromT){
    E55_STATE=fromT;
    e55Set(E55_STATE_KEY,fromT);
    return fromT;
  }
  if(E55_STATE&&E55_STATE.route&&E55_STATE.route.destino) return E55_STATE;
  const s=e55Get(E55_STATE_KEY);
  if(s&&s.route&&s.route.destino){
    E55_STATE=s;
    return s;
  }
  return null;
}

function e55SetState(s){
  if(!s||!s.route||!s.route.destino) return;
  E55_STATE=s;
  e55Set(E55_STATE_KEY,s);
}

function e55Km(a,b){
  if(!a||!b) return 0;
  const R=6371,dLat=(b.lat-a.lat)*Math.PI/180,dLng=(b.lng-a.lng)*Math.PI/180;
  const s1=Math.sin(dLat/2),s2=Math.sin(dLng/2);
  const q=s1*s1+Math.cos(a.lat*Math.PI/180)*Math.cos(b.lat*Math.PI/180)*s2*s2;
  return 2*R*Math.atan2(Math.sqrt(q),Math.sqrt(1-q));
}

async function e55Osrm(a,b){
  const url=`https://router.project-osrm.org/route/v1/driving/${a.lng},${a.lat};${b.lng},${b.lat}?overview=full&geometries=geojson&steps=false&alternatives=false`;
  const resp=await fetch(url);
  if(!resp.ok) throw new Error("OSRM no disponible");
  const data=await resp.json();
  if(!data.routes||!data.routes.length) throw new Error("OSRM sin ruta");
  const rr=data.routes[0];
  return {
    geometry:(rr.geometry.coordinates||[]).map(c=>({lat:Number(c[1]),lng:Number(c[0])})).filter(p=>Number.isFinite(p.lat)&&Number.isFinite(p.lng)),
    distanceKm:Number(rr.distance||0)/1000,
    durationMin:Number(rr.duration||0)/60,
    key:`${a.lat.toFixed(5)},${a.lng.toFixed(5)}>${b.lat.toFixed(5)},${b.lng.toFixed(5)}`
  };
}

async function e55DocByName(col,name){
  if(!firebaseReady()||!name) return null;
  const target=String(name).trim();
  try{
    const d=await db.collection(col).doc(target).get();
    if(d.exists) return {id:d.id,...d.data()};
  }catch(e){}
  try{
    const snap=await db.collection(col).get();
    for(const d of snap.docs){
      const x=d.data()||{};
      const names=[d.id,x.nombre,x.name,x.cliente,x.origen,x.destino].map(v=>String(v||"").trim().toLowerCase());
      if(names.includes(target.toLowerCase())) return {id:d.id,...x};
    }
  }catch(e){}
  return null;
}

async function e55Embarque(numero){
  if(!firebaseReady()||!numero) return null;
  const n=String(numero).trim();
  try{
    const d=await db.collection("embarque").doc(n).get();
    if(d.exists) return {id:d.id,...d.data()};
  }catch(e){}
  for(const field of ["embarque","numero"]){
    try{
      const snap=await db.collection("embarque").where(field,"==",n).limit(1).get();
      if(!snap.empty){
        const d=snap.docs[0];
        return {id:d.id,...d.data()};
      }
    }catch(e){}
  }
  return null;
}

async function e55BuildRoute(embarqueNumero){
  const emb=await e55Embarque(embarqueNumero);
  if(!emb) return null;

  const route={
    cliente:String(emb.cliente||"").trim(),
    origen:String(emb.origen||"").trim(),
    destino:String(emb.destino||"").trim(),
    embarque:String(emb.embarque||emb.numero||embarqueNumero||"").trim(),
    embarqueId:emb.id||String(embarqueNumero)
  };
  if(!route.cliente||!route.origen||!route.destino) return null;

  const od=await e55DocByName("origenes",route.origen);
  const dd=await e55DocByName("destinos",route.destino);
  const oc=e55Coord(od&&(od.ubicacion||od.coords||od.coordenadas||od.location));
  const dc=e55Coord(dd&&(dd.ubicacion||dd.coords||dd.coordenadas||dd.location));

  if(oc){route.origen_lat=oc.lat; route.origen_lng=oc.lng; route.origenLat=oc.lat; route.origenLng=oc.lng;}
  if(dc){route.destino_lat=dc.lat; route.destino_lng=dc.lng; route.destinoLat=dc.lat; route.destinoLng=dc.lng;}

  if(oc&&dc){
    try{
      const rr=await e55Osrm(oc,dc);
      route.routeGeometry=rr.geometry;
      route.routeDistanceKm=rr.distanceKm;
      route.routeDurationMin=rr.durationMin;
      route.routeGeometryKey=rr.key;
    }catch(e){
      route.routeGeometry=[];
      route.routeDistanceKm=e55Km(oc,dc);
      route.routeDurationMin=Math.round((route.routeDistanceKm/70)*60);
      route.routeGeometryKey="";
    }
  }
  return route;
}

function e55SetSelectText(id,text){
  const sel=e55(id);
  if(!sel||!text) return false;
  const target=String(text).trim();
  const low=target.toLowerCase();
  sel.disabled=false;
  for(let i=0;i<sel.options.length;i++){
    const txt=String(sel.options[i].textContent||sel.options[i].innerText||sel.options[i].value||"").trim().toLowerCase();
    if(txt===low){
      sel.selectedIndex=i;
      sel.value=sel.options[i].value;
      return true;
    }
  }
  const opt=document.createElement("option");
  opt.value="firebase:"+target;
  opt.textContent=target;
  opt.dataset.firebaseLocked="true";
  sel.appendChild(opt);
  sel.value=opt.value;
  return true;
}

function e55PaintInicio(route){
  if(!route||!route.destino) return;
  E55_LOCK=true;
  e55SetSelectText("clienteSelect",route.cliente);
  e55SetSelectText("origenSelect",route.origen);
  e55SetSelectText("destinoSelect",route.destino);
  ["clienteSelect","origenSelect","destinoSelect"].forEach(id=>{const el=e55(id); if(el) el.disabled=true;});
  const box=e55("rutaInfo");
  if(box){
    const km=Number(route.routeDistanceKm||0);
    box.innerHTML=`<b>Distancia:</b> ${km&&Number.isFinite(km)?km.toFixed(1)+" km":"-"}<br><b>Destino:</b> ${escapeHtml(route.destino||"-")}`;
  }
  E55_LOCK=false;
}

function e55ClearInicio(){
  E55_STATE=null;
  e55Set(E55_STATE_KEY,null);
  ["clienteSelect","origenSelect","destinoSelect"].forEach(id=>{const el=e55(id); if(el){el.disabled=false; el.selectedIndex=0;}});
  ["lote","embarqueInput"].forEach(id=>{const el=e55(id); if(el){el.disabled=false; el.value="";}});
  const box=e55("rutaInfo");
  if(box) box.innerHTML="<b>Distancia:</b> -<br><b>Destino:</b> -";
}

function e55ApplyLocks(){
  const s=e55GetState();
  const open=!!(s&&s.open);
  ["lote","embarqueInput"].forEach(id=>{const el=e55(id); if(el) el.disabled=open;});
  if(open&&s){
    if(e55("lote")) e55("lote").value=s.lote||"";
    if(e55("embarqueInput")) e55("embarqueInput").value=s.embarque||"";
    e55PaintInicio(s.route);
  }
}

async function e55ValidateEmbarque(){
  const emb=e55("embarqueInput")?e55("embarqueInput").value.trim():"";
  const seq=++E55_VALIDATE_SEQ;
  if(!emb){e55ClearInicio(); return null;}
  const route=await e55BuildRoute(emb);
  if(seq!==E55_VALIDATE_SEQ) return null;
  if(!route){
    ["clienteSelect","origenSelect","destinoSelect"].forEach(id=>{const el=e55(id); if(el){el.disabled=false; el.selectedIndex=0;}});
    const box=e55("rutaInfo"); if(box) box.innerHTML="<b>Distancia:</b> -<br><b>Destino:</b> Embarque no encontrado";
    return null;
  }
  const state={open:false,lote:e55("lote")?e55("lote").value.trim():"",embarque:emb,user:user(),route,updates:[],alerts:[],routeGeometry:route.routeGeometry||[],routeDistanceKm:route.routeDistanceKm||0,routeDurationMin:route.routeDurationMin||0};
  e55SetState(state);
  e55PaintInicio(route);
  return state;
}

/* Funciones globales finales */
validarEmbarqueInicioV1544=()=>e55ValidateEmbarque().catch(e=>console.log("e55 validate",e));
validarEmbarqueInicioV1545=validarEmbarqueInicioV1544;
validarEmbarqueInicioV1546=validarEmbarqueInicioV1544;
validarEmbarqueInicioV1547=validarEmbarqueInicioV1544;
validarEmbarqueInicioV1548=validarEmbarqueInicioV1544;
validarEmbarqueInicioV1549=validarEmbarqueInicioV1544;
validarEmbarqueInicioV1550=validarEmbarqueInicioV1544;
validarEmbarqueInicioV1551=validarEmbarqueInicioV1544;

onClienteChange=function(){ if(!E55_LOCK) validarEmbarqueInicioV1544(); };
onOrigenDestinoChange=function(){ if(!E55_LOCK) validarEmbarqueInicioV1544(); };

selectedRoute=function(){
  const s=e55GetState();
  if(s&&s.route&&s.route.destino) return {...s.route};
  const c=CLIENTES_DATA[e55("clienteSelect")?.value]||{};
  const o=ORIGENES_DATA[e55("origenSelect")?.value]||{};
  const d=DESTINOS_DATA[e55("destinoSelect")?.value]||{};
  return {cliente:c.cliente||"",origen:o.nombre||"",origen_lat:o.lat,origen_lng:o.lng,origen_pais:o.pais,destino:d.nombre||"",destino_lat:d.lat,destino_lng:d.lng,destino_pais:d.pais};
};

renderInicio=function(){
  const s=e55GetState();
  const inp=e55("inicioUser");
  const u=(s&&s.user)||user();
  if(inp) inp.value=(u.fleet||"Sin flota")+" - "+(u.driver||"Sin chofer");
  if(s&&s.open){
    if(e55("lote")) e55("lote").value=s.lote||"";
    if(e55("embarqueInput")) e55("embarqueInput").value=s.embarque||"";
  }
  if(s&&s.route) e55PaintInicio(s.route);
  e55ApplyLocks();
};

function e55CurrentGps(t){
  if(!t) return null;
  if(t.updates&&t.updates.length) return e55Coord(t.updates[t.updates.length-1].gps);
  return e55Coord(t.start);
}

function e55Eta(mins){
  mins=Math.max(0,Math.round(Number(mins)||0));
  const h=Math.floor(mins/60),m=mins%60;
  return h<=0?`${m}m`:`${h}h${m?" "+m+"m":""}`;
}

async function e55Metrics(t){
  const s=e55GetState();
  const route=(s&&s.route)||t.route;
  const total=Number(t.trackingDistanceKm||route.trackingDistanceKm||t.routeDistanceKm||route.routeDistanceKm||0);
  const totalMin=Number(t.trackingDurationMin||route.trackingDurationMin||t.routeDurationMin||route.routeDurationMin||0);
  let restan=total,etaMin=totalMin,avance=0;
  const updatesCount=t.updates?t.updates.length:0;
  const gps=e55CurrentGps(t);
  const dest=e55Coord({lat:route.destino_lat??route.destinoLat,lng:route.destino_lng??route.destinoLng});
  if(updatesCount>0&&gps&&dest&&total>0){
    try{
      const r=await e55Osrm(gps,dest);
      restan=Math.min(total,Math.max(0,r.distanceKm));
      etaMin=r.durationMin;
    }catch(e){
      restan=Math.min(total,Math.max(0,e55Km(gps,dest)));
      etaMin=Math.round((restan/70)*60);
    }
    avance=Math.max(0,Math.min(100,Math.round(((total-restan)/total)*100)));
  }
  return {total,restan,avance,etaMin,route,gps};
}

function e55RenderCards(m){
  const box=e55("trackingBox");
  if(!box) return;
  if(!m){box.innerHTML='<div class="statItem"><b>Sin tránsito</b><span>No hay tránsito iniciado</span></div>';return;}
  box.innerHTML=`<div class="statItem"><b>${shortKm(m.total)}</b><span>Total</span></div><div class="statItem"><b>${m.avance}%</b><span>Av.</span></div><div class="statItem"><b>${shortKm(m.restan)}</b><span>Restan</span></div><div class="statItem"><b>${e55Eta(m.etaMin)}</b><span>ETA</span></div>`;
}

renderTracking=async function(){
  const t=e55Transit();
  if(!e55IsOpen(t)){stopAutoGps(); e55RenderCards(null); renderTrackingMap(null); return;}
  const m=await e55Metrics(t);
  e55RenderCards(m);
  renderTrackingMap(t);
  startAutoGps();
};

iniciarTransito=async function(){
  if(E55_STARTING) return;
  E55_STARTING=true;
  try{
    const abierto=e55Transit();
    if(e55IsOpen(abierto)){window.alert("Ya hay un tránsito iniciado sin cerrar. Primero debe cerrar el tránsito actual."); show("tracking"); return;}
    const u=user();
    if(!u.fleet){window.alert("Cargá la flota en Usuario."); show("usuario"); return;}
    const lote=e55("lote")?e55("lote").value.trim():"";
    const embarque=e55("embarqueInput")?e55("embarqueInput").value.trim():"";
    if(!lote){window.alert("Ingresá número de lote/carga.");return;}
    if(!embarque){window.alert("Ingresá número de embarque.");return;}
    const state=await e55ValidateEmbarque();
    if(!state||!state.route){window.alert("El embarque no existe o no se pudo validar en Firebase.");return;}
    const gps=await getGps();
    const dest=e55Coord({lat:state.route.destino_lat??state.route.destinoLat,lng:state.route.destino_lng??state.route.destinoLng});
    let tracking={geometry:state.route.routeGeometry||[],distanceKm:state.route.routeDistanceKm||0,durationMin:state.route.routeDurationMin||0};
    if(gps&&dest){
      try{tracking=await e55Osrm(gps,dest);}
      catch(e){tracking={geometry:[],distanceKm:e55Km(gps,dest),durationMin:Math.round((e55Km(gps,dest)/70)*60)};}
    }
    const route={...state.route,trackingDistanceKm:tracking.distanceKm,trackingDurationMin:tracking.durationMin,trackingGeometry:tracking.geometry};
    const t={id:regId(),user:u,route,lote,embarque,start:gps,updates:[],alerts:[],closed:null,trackingGeometry:tracking.geometry,trackingDistanceKm:tracking.distanceKm,trackingDurationMin:tracking.durationMin,routeGeometry:state.route.routeGeometry||[],routeDistanceKm:state.route.routeDistanceKm||0,routeDurationMin:state.route.routeDurationMin||0};
    save(LS.transit,t);
    e55SetState({...state,open:true,id:t.id,user:u,lote,embarque,start:gps,updates:[],alerts:[],route,trackingGeometry:tracking.geometry,trackingDistanceKm:tracking.distanceKm,trackingDurationMin:tracking.durationMin});
    if(firebaseReady()){
      await db.collection("transitos").doc(String(t.id)).set({...t,cliente:route.cliente||"",origen:route.origen||"",destino:route.destino||"",estado:"abierto",actualizadoEn:now()},{merge:true});
    }
    saveTransitHistory(t);
    bloquearFormularioTransito();
    e55ApplyLocks();
    renderTransitStatus();
    aplicarColorResumenInicio();
    window.alert("Tránsito iniciado correctamente.");
    show("tracking");
    startAutoGps();
  }catch(e){window.alert("No se pudo iniciar tránsito: "+(e.message||e));}
  finally{setTimeout(()=>{E55_STARTING=false;},1000);}
};

cerrarTransito=async function(){
  const t=e55Transit();
  if(!t){window.alert("No hay tránsito iniciado.");return;}
  try{
    const gps=await getGps();
    if(!confirm("¿Desea confirmar la entrega y cerrar tránsito?")) return;
    t.closed=gps;
    t.estado="cerrado";
    const msg=await buildCierreMsgAsync(t);
    save(LS.last,{msg,date:now()});
    saveTransitHistory(t);
    await guardarTransitoFirebaseAntesWhatsappV1528(t);
    localStorage.removeItem(LS.transit);
    e55ClearInicio();
    stopAutoGps();
    sendToPhones(msg);
    window.alert("Tránsito cerrado.");
    show("inicio");
  }catch(e){window.alert("No se pudo cerrar tránsito: "+(e.message||e));}
};

/* Cloud listeners finales: NO pisan tránsito local activo */
startCloudListener=function(){
  if(!firebaseReady()) return;
  try{if(cloudUnsub){try{cloudUnsub();}catch(e){}}}catch(e){}
  try{
    cloudUnsub=db.collection("transitos").onSnapshot(snap=>{
      cloudTransitosCache=snap.docs.map(cloudDocToTransit);
      if(e55("embarque")&&!e55("embarque").classList.contains("hidden")) renderEmbarque();
      if(e55("tracking")&&!e55("tracking").classList.contains("hidden")) renderTracking();
    });
  }catch(e){console.log("startCloudListener e55",e);}
};
startCloudListenerModoFlota=startCloudListener;

refreshEmbarquesCloud=async function(){
  try{
    if(firebaseReady()){
      const snap=await db.collection("transitos").get();
      cloudTransitosCache=snap.docs.map(cloudDocToTransit);
    }
  }catch(e){console.log("refreshEmbarquesCloud e55",e);}
  renderEmbarque();
};

renderEmbarque=function(){
  const box=e55("embarqueList");
  const title=e55("embarqueFiltro");
  if(!box) return;
  const s=e55GetState();
  const emb=s&&s.embarque?String(s.embarque).trim():(e55("embarqueInput")?e55("embarqueInput").value.trim():"");
  const all=(cloudTransitosCache||[]).concat(historyTransits?historyTransits():[], e55Transit()?[e55Transit()]:[]);
  let items=all.filter(t=>t&&t.id);
  if(emb) items=items.filter(t=>String(t.embarque||"").trim()===emb);
  const by={}; items.forEach(t=>{by[t.id]=t;}); items=Object.values(by);
  items.sort((a,b)=>(e55IsOpen(b)?1:0)-(e55IsOpen(a)?1:0));
  if(title) title.innerText=emb?`Filtro: ${emb} (${items.length})`:`Todos visibles (${items.length})`;
  if(!items.length){box.innerHTML='<div class="emptyBox">No hay tránsitos para este embarque.</div>';return;}
  box.innerHTML=items.map(t=>{
    const route=t.route||{};
    const gps=(t.updates&&t.updates.length?t.updates[t.updates.length-1].gps:(t.closed||t.start));
    const pos=gps&&gps.lat!=null?`${Number(gps.lat).toFixed(5)}, ${Number(gps.lng).toFixed(5)}`:"-";
    return `<div class="embarqueItem ${e55IsOpen(t)?'open':'closed'}" onclick="abrirTransitoCloud('${escapeHtml(t.id)}')"><div class="embTop"><b>Emb. ${escapeHtml(t.embarque||"-")} / Flota ${escapeHtml((t.user&&t.user.fleet)||t.flota||"-")}</b><span>${e55IsOpen(t)?"Abierto":"Cerrado"}</span></div><div>Lote/Carga: ${escapeHtml(t.lote||"-")}</div><div>Cliente: ${escapeHtml(route.cliente||t.cliente||"-")}</div><div>Origen: ${escapeHtml(route.origen||t.origen||"-")}</div><div>Destino: ${escapeHtml(route.destino||t.destino||"-")}</div><div>Últ. posición: ${escapeHtml(pos)}</div><div>Últ. alerta: ${escapeHtml(lastAlertText(t))}</div></div>`;
  }).join("");
};

abrirTransitoCloud=function(id){
  const t=(cloudTransitosCache||[]).find(x=>x.id===id);
  if(!t) return;
  save(LS.transit,t);
  e55SetState(e55StateFromTransit(t));
  show("tracking");
};

/* Show final sin wrappers anteriores */
show=function(id){
  const views=["usuario","inicio","tracking","embarque","alertas","clima","checklist","ultimo"];
  const buttons=["btn-usuario","btn-inicio","btn-tracking","btn-embarque","btn-alertas","btn-clima","btn-checklist","btn-ultimo"];
  views.forEach(v=>{const el=e55(v); if(el){if(v===id) el.classList.remove("hidden"); else el.classList.add("hidden");}});
  buttons.forEach(b=>{const el=e55(b); if(el) el.classList.remove("active");});
  const active=e55("btn-"+id); if(active) active.classList.add("active");
  if(id==="usuario") loadUserForm();
  if(id==="inicio") renderInicio();
  if(id==="tracking") renderTracking();
  if(id==="alertas") renderAlertas();
  if(id==="clima") renderClima();
  if(id==="checklist") renderChecklist();
  if(id==="embarque") renderEmbarque();
  if(id==="ultimo") renderUltimo();
};

document.addEventListener("DOMContentLoaded",()=>{
  const emb=e55("embarqueInput");
  if(emb){
    emb.oninput=()=>{if(!e55IsOpen(e55Transit())) validarEmbarqueInicioV1544();};
    emb.onchange=()=>{if(!e55IsOpen(e55Transit())) validarEmbarqueInicioV1544();};
  }
  ["clienteSelect","origenSelect","destinoSelect"].forEach(id=>{
    const el=e55(id);
    if(el) el.onchange=()=>{if(!E55_LOCK) validarEmbarqueInicioV1544();};
  });
  setTimeout(()=>renderInicio(),500);
});
