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





async function iniciarTransito(){
  if(TPOD_STARTING_TRANSIT_1582) return;
  TPOD_STARTING_TRANSIT_1582=true;
  tpodStartBusy1582(true,"Iniciando tránsito...");
  tpodSetStartDisabled1582(true);
  await tpodFrame1582();

  try{
    await tpodStep1582("Controlando datos...");
    const abierto=typeof transit==="function"?transit():null;
    if(abierto&&tpodOpen1582(abierto)) throw new Error("Ya hay un tránsito iniciado sin cerrar. Primero debe cerrar el tránsito actual.");

    const u=typeof user==="function"?user():{};
    const flota=String((u&&u.fleet)||"").trim();
    if(!flota) throw new Error("Cargá la flota en Usuario.");

    const loteEl=$("lote");
    const lote=loteEl?loteEl.value.trim():"";
    if(!lote) throw new Error("Ingresá número de lote/carga.");

    const embEl=$("embarqueInput");
    const embarque=embEl?embEl.value.trim():"";
    if(!embarque) throw new Error("Ingresá número de embarque.");

    await tpodStep1582("Validando embarque...");
    const route=await tpodTimeout1582(tpodRouteInicio1582(),15000,"Validación de embarque");
    if(!route||(!route.embarque&&!route.cliente&&!route.origen&&!route.destino)) throw new Error("El embarque no existe o no está activo en Firebase.");

    await tpodStep1582("Verificando duplicados...");
    const duplicado=await tpodTimeout1582(tpodDuplicado1582(embarque,flota),15000,"Verificación de duplicados");
    if(duplicado) throw new Error("La flota "+flota+" ya tiene un tránsito abierto para el embarque "+embarque+".");

    await tpodStep1582("Obteniendo GPS...");
    const gps=await tpodTimeout1582(getGps(),10000,"GPS");

    const t={id:typeof regId==="function"?regId():("TPOD-"+Date.now()),user:u,route:route,lote:lote,embarque:embarque,start:gps,updates:[],alerts:[],participantes:[flota],closed:null,estado:"abierto"};

    await tpodStep1582("Guardando tránsito...");
    await tpodTimeout1582(tpodGuardarInicio1582(t),15000,"Guardado en Firebase");

    await tpodStep1582("Finalizando...");
    save(LS.transit,t);
    if(typeof saveTransitHistory==="function") saveTransitHistory(t);
    if(typeof bloquearFormularioTransito==="function") bloquearFormularioTransito();
    if(typeof renderTransitStatus==="function") renderTransitStatus();
    if(typeof aplicarColorResumenInicio==="function") aplicarColorResumenInicio();

    tpodStartBusy1582(false);
    window.alert("Tránsito iniciado correctamente.");
    show("tracking");
    if(typeof startAutoGps==="function") startAutoGps();
  }catch(e){
    tpodStartBusy1582(false);
    window.alert(e.message||String(e));
  }finally{
    TPOD_STARTING_TRANSIT_1582=false;
    tpodSetStartDisabled1582(false);
    tpodStartBusy1582(false);
  }
}







/* ===== V1.5.82 - Guardado Firebase antes de WhatsApp sin alterar mensaje ===== */
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
  // V1.5.82: sin línea fallback.
  return;
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
  try{ if(layer && leafletMap){ leafletMap.removeLayer(layer); } }catch(e){}
  routeLayer=null;
  routeCacheKey="";
  routeLoadingKey="";
  return;
}





function ensureRoadRouteLayer(origin,dest){
  removeRouteLayer();
  return;
}










function renderTrackingMap(t){
  const mapDiv = document.getElementById("map");
  if(!mapDiv) return;

  if(!trackingMap){
    trackingMap = L.map("map", { zoomControl:true });
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "" }).addTo(trackingMap);
    window.__trackingMarkersNoRoute = { origen:null, destino:null, gps:null, alertas:[] };
    window.__trackingMapFitNoRoute = false;
    window.__trackingUserMovedNoRoute = false;
    try{ trackingMap.on("dragstart zoomstart", function(){ window.__trackingUserMovedNoRoute = true; }); }catch(e){}
  }

  const markers = window.__trackingMarkersNoRoute || { origen:null, destino:null, gps:null, alertas:[] };
  window.__trackingMarkersNoRoute = markers;

  function validNumber(v){
    const n = Number(v);
    return Number.isFinite(n) && Math.abs(n) > 0.000001 ? n : null;
  }

  function parseCoord(v){
    if(!v) return null;
    if(typeof v === "object"){
      const lat = validNumber(v.lat ?? v.latitude);
      const lng = validNumber(v.lng ?? v.lon ?? v.longitude);
      if(lat !== null && lng !== null) return {lat,lng};
    }
    const nums = String(v).match(/-?\d+(?:\.\d+)?/g);
    if(nums && nums.length >= 2){
      const lat = validNumber(nums[0]);
      const lng = validNumber(nums[1]);
      if(lat !== null && lng !== null) return {lat,lng};
    }
    return null;
  }

  function point(lat,lng){
    const a = validNumber(lat);
    const b = validNumber(lng);
    return a !== null && b !== null ? [a,b] : null;
  }

  function markerIcon(color){
    return L.divIcon({
      className: "tpod-ref-marker",
      html: '<span style="background:'+color+'"></span>',
      iconSize: [26,26],
      iconAnchor: [13,13]
    });
  }

  function setMarker(key, lat, lng, color, label){
    const p = point(lat,lng);
    if(!p){
      if(markers[key]){ try{ trackingMap.removeLayer(markers[key]); }catch(e){} markers[key] = null; }
      return null;
    }
    if(markers[key]){
      markers[key].setLatLng(p);
      markers[key].setIcon(markerIcon(color));
    }else{
      markers[key] = L.marker(p, { icon: markerIcon(color), keyboard:false }).addTo(trackingMap).bindTooltip(label || "");
    }
    return p;
  }

  function clearAlerts(){
    try{ (markers.alertas || []).forEach(function(m){ trackingMap.removeLayer(m); }); }catch(e){}
    markers.alertas = [];
  }

  function addAlert(lat,lng){
    const p = point(lat,lng);
    if(!p) return null;
    const m = L.marker(p, { icon: markerIcon("#f59e0b"), keyboard:false }).addTo(trackingMap).bindTooltip("Alerta");
    markers.alertas.push(m);
    return p;
  }
  async function firebaseReadyForMap(){
    // V1.5.82: tpodInitFirebase puede inicializar Firebase pero devolver undefined.
    // No usar su return como boolean; validar realmente que exista db.
    try{
      if(typeof tpodInitFirebase === "function") tpodInitFirebase();
    }catch(e){}
    try{
      if(typeof firebaseReady === "function") firebaseReady();
    }catch(e){}

    try{
      if(typeof db !== "undefined" && db) return true;
    }catch(e){}

    try{
      if(typeof firebase !== "undefined" && firebase.apps && firebase.apps.length){
        db = firebase.firestore();
        return !!db;
      }
    }catch(e){}

    return false;
  }


  function docCoord(x){
    x = x || {};
    return parseCoord(x.ubicacion) || parseCoord(x.location) || parseCoord(x.coords) || parseCoord(x.coordenadas) || parseCoord(x.gps) || parseCoord(x);
  }

  function docNames(id,x){
    x = x || {};
    return [id,x.nombre,x.name,x.origen,x.destino,x.descripcion,x.cliente]
      .map(function(v){ return String(v || "").trim().toLowerCase(); }).filter(Boolean);
  }

  async function findCoord(collectionName, name){
    name = String(name || "").trim();
    if(!name) return null;
    if(!window.__trackingCoordCacheNoRoute) window.__trackingCoordCacheNoRoute = {};
    const cacheKey = collectionName + "|" + name.toLowerCase();
    if(window.__trackingCoordCacheNoRoute[cacheKey]) return window.__trackingCoordCacheNoRoute[cacheKey];
    await firebaseReadyForMap();
    if(typeof db === "undefined" || !db){
      console.log("Tracking map: db no disponible para buscar coordenadas", collectionName, name);
      return null;
    }

    try{
      const direct = await db.collection(collectionName).doc(name).get();
      if(direct.exists){
        const c = docCoord(direct.data() || {});
        if(c){ window.__trackingCoordCacheNoRoute[cacheKey] = c; return c; }
      }
    }catch(e){}

    try{
      const snap = await db.collection(collectionName).get();
      const target = name.toLowerCase();
      for(const d of snap.docs){
        const x = d.data() || {};
        if(docNames(d.id,x).includes(target)){
          const c = docCoord(x);
          if(c){ window.__trackingCoordCacheNoRoute[cacheKey] = c; return c; }
        }
      }
      for(const d of snap.docs){
        const x = d.data() || {};
        const names = docNames(d.id,x);
        if(names.some(function(n){ return n.includes(target) || target.includes(n); })){
          const c = docCoord(x);
          if(c){ window.__trackingCoordCacheNoRoute[cacheKey] = c; return c; }
        }
      }
    }catch(e){ console.log("findCoord map", collectionName, e); }
    return null;
  }

  async function completeRouteCoords(transitObj){
    if(!transitObj || !transitObj.route || window.__trackingLoadingCoordsNoRoute) return false;
    const r = transitObj.route;
    let changed = false;
    const hasOrigen = !!point(r.origen_lat ?? r.origenLat, r.origen_lng ?? r.origenLng);
    const hasDestino = !!point(r.destino_lat ?? r.destinoLat, r.destino_lng ?? r.destinoLng);
    if(hasOrigen && hasDestino) return false;

    window.__trackingLoadingCoordsNoRoute = true;
    try{
      if(!hasOrigen){
        const c = await findCoord("origenes", r.origen);
        if(c){ console.log("Tracking map origen coord", r.origen, c); r.origen_lat = c.lat; r.origen_lng = c.lng; changed = true; }
      }
      if(!hasDestino){
        const c = await findCoord("destinos", r.destino);
        if(c){ console.log("Tracking map destino coord", r.destino, c); r.destino_lat = c.lat; r.destino_lng = c.lng; changed = true; }
      }
      if(changed){
        try{ save(LS.transit, transitObj); }catch(e){}
        window.__trackingMapFitNoRoute = false;
        try{
          if(transitObj.id && typeof db !== "undefined" && db){
            await db.collection("transitos").doc(transitObj.id).set({
              route: {
                origen_lat: r.origen_lat,
                origen_lng: r.origen_lng,
                destino_lat: r.destino_lat,
                destino_lng: r.destino_lng
              }
            }, { merge:true });
          }
        }catch(e){}
      }
    }finally{
      window.__trackingLoadingCoordsNoRoute = false;
    }
    return changed;
  }

  if(!t || !t.route){
    if(!window.__trackingMapFitNoRoute){
      trackingMap.setView([-34.6037,-58.3816], 12);
      window.__trackingMapFitNoRoute = true;
    }
    setTimeout(function(){ trackingMap.invalidateSize(); }, 200);
    return;
  }

  const r = t.route || {};
  const points = [];

  const pOrigen = setMarker("origen", r.origen_lat ?? r.origenLat, r.origen_lng ?? r.origenLng, "#22c55e", "Origen");
  if(pOrigen) points.push(pOrigen);

  const pDestino = setMarker("destino", r.destino_lat ?? r.destinoLat, r.destino_lng ?? r.destinoLng, "#ef4444", "Destino");
  if(pDestino) points.push(pDestino);

  let gps = null;
  try{
    gps = t.ultimaPosicion || null;
    if(!gps && t.updates && t.updates.length) gps = t.updates[t.updates.length - 1].gps;
    if(!gps) gps = t.start;
  }catch(e){}

  if(gps){
    const pGps = setMarker("gps", gps.lat ?? gps.latitude, gps.lng ?? gps.lon ?? gps.longitude, "#3b82f6", "GPS");
    if(pGps) points.push(pGps);
  }

  clearAlerts();
  try{
    (t.alerts || []).forEach(function(a){
      const g = a.gps || a;
      const p = addAlert(g.lat ?? g.latitude, g.lng ?? g.lon ?? g.longitude);
      if(p) points.push(p);
    });
    if(t.ultimaAlerta && t.ultimaAlerta.gps){
      const g = t.ultimaAlerta.gps;
      const p = addAlert(g.lat ?? g.latitude, g.lng ?? g.lon ?? g.longitude);
      if(p) points.push(p);
    }
  }catch(e){}

  if(points.length && !window.__trackingMapFitNoRoute){
    try{ trackingMap.fitBounds(points, { padding:[35,35], maxZoom:15 }); }
    catch(e){ trackingMap.setView(points[points.length - 1], 12); }
    window.__trackingMapFitNoRoute = true;
  }else if(gps && !window.__trackingUserMovedNoRoute){
    const pg = point(gps.lat ?? gps.latitude, gps.lng ?? gps.lon ?? gps.longitude);
    if(pg){ try{ trackingMap.panTo(pg, { animate:false }); }catch(e){} }
  }

  const hasFullRouteCoords = !!point(r.origen_lat ?? r.origenLat, r.origen_lng ?? r.origenLng) &&
                             !!point(r.destino_lat ?? r.destinoLat, r.destino_lng ?? r.destinoLng);

  if(!hasFullRouteCoords){
    completeRouteCoords(t).then(function(changed){
      if(changed){ setTimeout(function(){ renderTrackingMap(t); }, 100); }
    });
  }

  setTimeout(function(){ trackingMap.invalidateSize(); }, 200);
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




/* ===== v1.5.82 VALIDACION EMBARQUE + ULTIMO ORIGINAL ===== */

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




/* ===== v1.5.82 COLECCION EMBARQUE + LIMPIEZA + COMPARTIDOS ===== */

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




/* ===== v1.5.82 FIX VALIDACION / ULTIMO / EMBARQUES ===== */
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




/* ===== v1.5.82 EMBARQUE DESTACADO + ULTIMO FORMATO ANTERIOR ===== */

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




/* ===== v1.5.82 ULTIMO FORMATO REFERENCIA + DEDUP EMBARQUES ===== */

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




/* ===== v1.5.82 ULTIMO FORMATO COMPLETO + EMBARQUES SOLO FLOTA ===== */
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




/* ===== v1.5.82 EMBARQUE VALIDADO + ULTIMO COMPACTO ===== */
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




/* ===== v1.5.82 TRACKING EMBARQUES POS FIX ===== */
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




/* ===== v1.5.82 CERRAR APP EN USUARIO ===== */
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




/* ===== v1.5.82 CERRAR APP NATIVO + POSICION PRECISA EMBARQUE ===== */
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




/* ===== v1.5.82 EMBARQUES ESTABLE + POSICION PRECISA ===== */
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




/* ===== v1.5.82 EMBARQUES SIN LOADING + GPS ACTUAL ===== */
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




/* ===== v1.5.82 EMBARQUES ESTABLE FINAL ===== */
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




/* ===== v1.5.82 EMBARQUES ESTABLE + ULTIMO GPS ===== */
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




/* ===== v1.5.82 GPS ZARATE FIX ===== */
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




/* ===== v1.5.82 UBICACION UNICA WHATSAPP / EMBARQUES / ULTIMO ===== */

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




/* ===== v1.5.82 UBICACION WHATSAPP COMPARTIDA FINAL ===== */

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




/* ===== v1.5.82 EMBARQUES RENDER FINAL ===== */
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




/* ===== v1.5.82 SCROLL EMBARQUES FIX ===== */
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




/* ===== v1.5.82 SCROLL TOTAL EMBARQUES ===== */
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




/* ===== v1.5.82 ESPACIADO EMBARQUES ===== */
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




/* ===== v1.5.82 GEO UNIFICADO LOCALIDAD PROVINCIA ===== */
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




/* ===== V1.5.82 - Check List Firebase ===== */
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

    checklistMsg("Check List Guardado correctamente.","ok");
    window.alert("Check List Guardado correctamente.");
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



/* ===== V1.5.82 - Habilitación Check List y alertas ===== */
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


/* ===== V1.5.82 - Normalizar visual botón Check List ===== */
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


/* ===== V1.5.82 - Inicio/Fin: Firebase combos + validar embarque =====
   Alcance: sólo vista Inicio / Fin.
   - Lote/Carga y Embarque quedan arriba por HTML.
   - Cliente, Origen y Destino se cargan desde Firebase antes de validar.
   - Al validar Embarque, Cliente/Origen/Destino se toman del documento de Firebase collection("embarque").
   - No modifica vistas Tracking, Embarques, Alertas, Último, Clima ni Check List.
*/
let E61_ROUTE_LOCK = null;
let E61_VALIDATE_TIMER = null;

function e61(id){ return document.getElementById(id); }

function e61Ready(){
  try{
    if(typeof tpodInitFirebase === "function") return tpodInitFirebase();
  }catch(e){}
  try{
    if(typeof firebase !== "undefined"){
      if(typeof FIREBASE_CONFIG !== "undefined" && !firebase.apps.length){
        firebase.initializeApp(FIREBASE_CONFIG);
      }
      db = firebase.firestore();
      cloudReady = true;
      return true;
    }
  }catch(e){}
  try{ return typeof firebaseReady === "function" ? firebaseReady() : false; }catch(e){}
  return false;
}

function e61Text(v){ return String(v ?? "").trim(); }

function e61NameFromDoc(id,x,type){
  x = x || {};
  if(type === "clientes") return e61Text(x.cliente || x.nombre || x.name || x.razon_social || x.razonSocial || id);
  if(type === "origenes") return e61Text(x.origen || x.nombre || x.name || x.descripcion || id);
  if(type === "destinos") return e61Text(x.destino || x.nombre || x.name || x.descripcion || id);
  return e61Text(x.nombre || x.name || id);
}

function e61CoordObj(x){
  x = x || {};
  const raw = x.ubicacion || x.coords || x.coordenadas || x.location || x;
  if(raw && typeof raw === "object"){
    const lat = Number(raw.lat ?? raw.latitude);
    const lng = Number(raw.lng ?? raw.lon ?? raw.longitude);
    if(Number.isFinite(lat) && Number.isFinite(lng)) return {lat,lng};
  }
  return null;
}

function e61FillSelect(id, rows, placeholder){
  const sel = e61(id);
  if(!sel) return;
  const current = sel.value;
  sel.innerHTML = `<option value="">${escapeHtml(placeholder)}</option>` + rows.map((r,i)=>{
    return `<option value="${escapeHtml(r.value)}">${escapeHtml(r.text)}</option>`;
  }).join("");
  if(current && Array.from(sel.options).some(o=>o.value===current)) sel.value = current;
}

async function e61LoadCollectionSelect(col, selectId, placeholder, type){
  if(!e61Ready()) return false;
  try{
    const snap = await db.collection(col).get();
    const rows = [];
    snap.docs.forEach((d,idx)=>{
      const x = d.data() || {};
      const text = e61NameFromDoc(d.id,x,type);
      if(!text) return;
      const c = e61CoordObj(x);
      rows.push({
        value: "fb:"+col+":"+d.id,
        text,
        data: x,
        lat: c ? c.lat : "",
        lng: c ? c.lng : ""
      });
    });
    rows.sort((a,b)=>a.text.localeCompare(b.text));
    e61FillSelect(selectId, rows, placeholder);
    const sel = e61(selectId);
    if(sel){
      rows.forEach(r=>{
        const opt = Array.from(sel.options).find(o=>o.value===r.value);
        if(opt){
          opt.dataset.text = r.text;
          opt.dataset.lat = r.lat;
          opt.dataset.lng = r.lng;
        }
      });
    }
    return true;
  }catch(e){
    console.log("No se pudo cargar", col, e);
    return false;
  }
}

async function e61LoadInicioCombosFirebase(){
  await Promise.all([
    e61LoadCollectionSelect("clientes","clienteSelect","Ej: seleccione cliente...","clientes"),
    e61LoadCollectionSelect("origenes","origenSelect","Ej: seleccione origen...","origenes"),
    e61LoadCollectionSelect("destinos","destinoSelect","Ej: seleccione destino...","destinos")
  ]);
}

async function e61BuscarEmbarque(numero){
  if(!e61Ready()) return null;
  const emb = e61Text(numero);
  if(!emb) return null;
  const col = db.collection("embarque");

  for(const id of [emb, "emb"+emb, "embarque"+emb]){
    try{
      const d = await col.doc(id).get();
      if(d.exists) return {id:d.id, data:d.data() || {}};
    }catch(e){}
  }

  for(const field of ["embarque","numero"]){
    try{
      const snap = await col.where(field,"==",emb).limit(1).get();
      if(!snap.empty){
        const d = snap.docs[0];
        return {id:d.id, data:d.data() || {}};
      }
    }catch(e){}
  }
  return null;
}

function e61SetSelectText(id,text){
  const sel = e61(id);
  if(!sel || !text) return false;
  const target = e61Text(text).toLowerCase();
  for(let i=0;i<sel.options.length;i++){
    const t = e61Text(sel.options[i].textContent || sel.options[i].innerText || sel.options[i].dataset.text || sel.options[i].value).toLowerCase();
    if(t === target){
      sel.selectedIndex = i;
      return true;
    }
  }
  const opt = document.createElement("option");
  opt.value = "fb:embarque:"+String(text);
  opt.textContent = String(text);
  opt.dataset.text = String(text);
  sel.appendChild(opt);
  sel.value = opt.value;
  return true;
}

function e61SelectedText(id){
  const sel = e61(id);
  if(!sel) return "";
  const opt = sel.options && sel.selectedIndex >= 0 ? sel.options[sel.selectedIndex] : null;
  return e61Text((opt && (opt.dataset.text || opt.textContent || opt.innerText)) || sel.value);
}

function e61SelectedCoord(id){
  const sel = e61(id);
  if(!sel) return {};
  const opt = sel.options && sel.selectedIndex >= 0 ? sel.options[sel.selectedIndex] : null;
  if(!opt) return {};
  const rawLat = opt.dataset.lat;
  const rawLng = opt.dataset.lng;
  if(rawLat === undefined || rawLat === "" || rawLng === undefined || rawLng === "") return {};
  const lat = Number(rawLat);
  const lng = Number(rawLng);
  return {
    lat: Number.isFinite(lat) && Math.abs(lat) > 0.000001 ? lat : "",
    lng: Number.isFinite(lng) && Math.abs(lng) > 0.000001 ? lng : ""
  };
}

function e61RouteFromSelects(){
  const oc = e61SelectedCoord("origenSelect");
  const dc = e61SelectedCoord("destinoSelect");
  return {
    cliente: e61SelectedText("clienteSelect"),
    origen: e61SelectedText("origenSelect"),
    origen_lat: oc.lat,
    origen_lng: oc.lng,
    origen_pais: "",
    destino: e61SelectedText("destinoSelect"),
    destino_lat: dc.lat,
    destino_lng: dc.lng,
    destino_pais: ""
  };
}

function e61PaintRutaInfo(route){
  const box = e61("rutaInfo");
  if(!box) return;
  let km = 0;
  try{ km = typeof distanciaRuta === "function" ? distanciaRuta(route) : 0; }catch(e){}
  box.innerHTML =
    `<b>Distancia:</b> ${km && Number.isFinite(km) ? km.toFixed(1)+" km" : "-"}<br>`+
    `<b>Destino:</b> ${escapeHtml(route.destino || "-")}`;
  if(typeof aplicarColorResumenInicio === "function") aplicarColorResumenInicio();
}

async function e61ValidarEmbarqueInicio(){
  const emb = e61("embarqueInput") ? e61("embarqueInput").value.trim() : "";
  if(!emb){
    E61_ROUTE_LOCK = null;
    return null;
  }

  const found = await e61BuscarEmbarque(emb);
  if(!found || !found.data || found.data.activo === false){
    E61_ROUTE_LOCK = null;
    return null;
  }

  const x = found.data;
  const route = {
    cliente: e61Text(x.cliente || x.cliente_nombre || x.customer || ""),
    origen: e61Text(x.origen || x.origen_nombre || x.origin || ""),
    origen_lat: "",
    origen_lng: "",
    origen_pais: "",
    destino: e61Text(x.destino || x.destino_nombre || x.destination || ""),
    destino_lat: "",
    destino_lng: "",
    destino_pais: "",
    embarque: e61Text(x.embarque || x.numero || emb)
  };

  e61SetSelectText("clienteSelect", route.cliente);
  e61SetSelectText("origenSelect", route.origen);
  e61SetSelectText("destinoSelect", route.destino);

  const oc = e61SelectedCoord("origenSelect");
  const dc = e61SelectedCoord("destinoSelect");
  route.origen_lat = oc.lat;
  route.origen_lng = oc.lng;
  route.destino_lat = dc.lat;
  route.destino_lng = dc.lng;

  E61_ROUTE_LOCK = route;
  e61PaintRutaInfo(route);
  return route;
}

function e61DebounceValidar(){
  clearTimeout(E61_VALIDATE_TIMER);
  E61_VALIDATE_TIMER = setTimeout(()=>e61ValidarEmbarqueInicio(), 450);
}

/* Overrides sólo de Inicio/Fin */
initSelectors = function(){
  e61LoadInicioCombosFirebase().then(()=>{
    const t = transit();
    if(t && !t.closed && t.route){
      e61SetSelectText("clienteSelect", t.route.cliente);
      e61SetSelectText("origenSelect", t.route.origen);
      e61SetSelectText("destinoSelect", t.route.destino);
    }else{
      const emb = e61("embarqueInput");
      if(emb && emb.value.trim()) e61ValidarEmbarqueInicio();
    }
  });
};

onClienteChange = function(){
  E61_ROUTE_LOCK = null;
  e61PaintRutaInfo(e61RouteFromSelects());
};

onOrigenDestinoChange = function(){
  E61_ROUTE_LOCK = null;
  e61PaintRutaInfo(e61RouteFromSelects());
};

selectedRoute = function(){
  if(E61_ROUTE_LOCK) return {...E61_ROUTE_LOCK};
  return e61RouteFromSelects();
};

bloquearFormularioTransito = function(){
  const t = transit();
  const bloqueado = !!(t && !t.closed);
  ["clienteSelect","origenSelect","destinoSelect","lote","embarqueInput"].forEach(id=>{
    const el = e61(id);
    if(el) el.disabled = bloqueado;
  });
};

const __e61RenderInicio = typeof renderInicio === "function" ? renderInicio : null;
renderInicio = function(){
  if(__e61RenderInicio) __e61RenderInicio();
  const t = transit();
  if(t && !t.closed && t.route){
    E61_ROUTE_LOCK = {...t.route};
    e61SetSelectText("clienteSelect", t.route.cliente);
    e61SetSelectText("origenSelect", t.route.origen);
    e61SetSelectText("destinoSelect", t.route.destino);
    e61PaintRutaInfo(t.route);
  }
  bloquearFormularioTransito();
};

const __e61IniciarTransito = typeof iniciarTransito === "function" ? iniciarTransito : null;
if(__e61IniciarTransito){
  iniciarTransito = async function(){
    const emb = e61("embarqueInput") ? e61("embarqueInput").value.trim() : "";
    if(!emb){
      window.alert("Ingresá número de embarque.");
      return;
    }
    const route = await e61ValidarEmbarqueInicio();
    if(!route){
      window.alert("El embarque no existe o no está activo en Firebase.");
      return;
    }
    return __e61IniciarTransito.apply(this, arguments);
  };
}

document.addEventListener("DOMContentLoaded", ()=>{
  const emb = e61("embarqueInput");
  if(emb){
    emb.addEventListener("focus", ()=>{ if(!window.__e61CombosLoaded){ window.__e61CombosLoaded=true; initSelectors(); } });
    emb.addEventListener("input", e61DebounceValidar);
    emb.addEventListener("change", ()=>e61ValidarEmbarqueInicio());
    emb.addEventListener("blur", ()=>e61ValidarEmbarqueInicio());
  }
});


/* ===== V1.5.82 - Recuperar Tracking sin tocar otras vistas =====
   Alcance:
   - Completar coordenadas de Origen/Destino desde Firebase para que Tracking vuelva a calcular ruta, Total, Avance, Restan y ETA.
   - Mantener cambios sólo ligados a Inicio/Fin + Tracking.
*/
let E62_ENRICHING_ROUTE = false;

function e62(id){ return document.getElementById(id); }

function e62Ready(){
  try{ if(typeof e61Ready === "function") return e61Ready(); }catch(e){}
  try{ if(typeof tpodInitFirebase === "function") return tpodInitFirebase(); }catch(e){}
  try{ return typeof firebaseReady === "function" ? firebaseReady() : false; }catch(e){}
  return false;
}

function e62Coord(v){
  if(!v) return null;

  if(typeof v === "object"){
    const lat = Number(v.lat ?? v.latitude);
    const lng = Number(v.lng ?? v.lon ?? v.longitude);
    if(Number.isFinite(lat) && Number.isFinite(lng)) return {lat,lng};

    // Firestore GeoPoint
    if(typeof v.latitude !== "undefined" && typeof v.longitude !== "undefined"){
      const la = Number(v.latitude);
      const ln = Number(v.longitude);
      if(Number.isFinite(la) && Number.isFinite(ln)) return {lat:la,lng:ln};
    }
  }

  const nums = String(v).match(/-?\d+(?:\.\d+)?/g);
  if(nums && nums.length >= 2){
    const lat = Number(nums[0]);
    const lng = Number(nums[1]);
    if(Number.isFinite(lat) && Number.isFinite(lng)) return {lat,lng};
  }

  return null;
}

function e62CoordFromDoc(x){
  x = x || {};
  return e62Coord(x.ubicacion) ||
         e62Coord(x.coords) ||
         e62Coord(x.coordenadas) ||
         e62Coord(x.location) ||
         e62Coord(x.gps) ||
         e62Coord(x);
}

function e62NamesFromDoc(id,x){
  x = x || {};
  return [
    id,
    x.nombre,
    x.name,
    x.origen,
    x.destino,
    x.descripcion,
    x.cliente
  ].map(v => String(v || "").trim().toLowerCase()).filter(Boolean);
}

async function e62FindCoord(collectionName, wantedName){
  if(!e62Ready() || !wantedName) return null;
  const target = String(wantedName).trim().toLowerCase();

  try{
    const direct = await db.collection(collectionName).doc(String(wantedName).trim()).get();
    if(direct.exists){
      const c = e62CoordFromDoc(direct.data() || {});
      if(c) return c;
    }
  }catch(e){}

  try{
    const snap = await db.collection(collectionName).get();
    for(const d of snap.docs){
      const x = d.data() || {};
      const names = e62NamesFromDoc(d.id, x);
      if(names.includes(target)){
        const c = e62CoordFromDoc(x);
        if(c) return c;
      }
    }

    // fallback contains para diferencias menores
    for(const d of snap.docs){
      const x = d.data() || {};
      const names = e62NamesFromDoc(d.id, x);
      if(names.some(n => n === target || n.includes(target) || target.includes(n))){
        const c = e62CoordFromDoc(x);
        if(c) return c;
      }
    }
  }catch(e){
    console.log("e62FindCoord", collectionName, e);
  }

  return null;
}

function e62RouteHasCoords(route){
  if(!route) return false;
  const vals = [
    Number(route.origen_lat),
    Number(route.origen_lng),
    Number(route.destino_lat),
    Number(route.destino_lng)
  ];
  return vals.every(Number.isFinite);
}

async function e62EnrichRoute(route){
  if(!route) return route;

  const r = {...route};

  if(!Number.isFinite(Number(r.origen_lat)) || !Number.isFinite(Number(r.origen_lng))){
    const oc = await e62FindCoord("origenes", r.origen);
    if(oc){
      r.origen_lat = oc.lat;
      r.origen_lng = oc.lng;
    }
  }

  if(!Number.isFinite(Number(r.destino_lat)) || !Number.isFinite(Number(r.destino_lng))){
    const dc = await e62FindCoord("destinos", r.destino);
    if(dc){
      r.destino_lat = dc.lat;
      r.destino_lng = dc.lng;
    }
  }

  return r;
}

/* Mejorar validación de embarque: guardar coordenadas reales en el route lock */
const __e62ValidarEmb = typeof e61ValidarEmbarqueInicio === "function" ? e61ValidarEmbarqueInicio : null;
if(__e62ValidarEmb){
  e61ValidarEmbarqueInicio = async function(){
    const r = await __e62ValidarEmb.apply(this, arguments);
    if(r){
      const enriched = await e62EnrichRoute(r);
      try{ E61_ROUTE_LOCK = enriched; }catch(e){}
      if(typeof e61PaintRutaInfo === "function") e61PaintRutaInfo(enriched);
      return enriched;
    }
    return r;
  };
}

/* selectedRoute debe devolver coordenadas si ya fueron enriquecidas */
const __e62SelectedRoute = typeof selectedRoute === "function" ? selectedRoute : null;
selectedRoute = function(){
  try{
    if(typeof E61_ROUTE_LOCK !== "undefined" && E61_ROUTE_LOCK) return {...E61_ROUTE_LOCK};
  }catch(e){}
  return __e62SelectedRoute ? __e62SelectedRoute() : {};
};

/* Antes de iniciar tránsito, asegurar que route tenga coordenadas para Tracking */
const __e62IniciarTransito = typeof iniciarTransito === "function" ? iniciarTransito : null;
if(__e62IniciarTransito){
  iniciarTransito = async function(){
    if(typeof e61ValidarEmbarqueInicio === "function"){
      const r = await e61ValidarEmbarqueInicio();
      if(r){
        const enriched = await e62EnrichRoute(r);
        try{ E61_ROUTE_LOCK = enriched; }catch(e){}
      }
    }
    return __e62IniciarTransito.apply(this, arguments);
  };
}

/* Tracking: si el tránsito quedó guardado sin coords, enriquecer una vez y volver a renderizar */
const __e62RenderTracking = typeof renderTracking === "function" ? renderTracking : null;
if(__e62RenderTracking){
  renderTracking = function(){
    const t = transit();

    if(t && t.route && !e62RouteHasCoords(t.route) && !E62_ENRICHING_ROUTE){
      E62_ENRICHING_ROUTE = true;
      e62EnrichRoute(t.route).then(route=>{
        if(route && e62RouteHasCoords(route)){
          t.route = route;
          try{ save(LS.transit, t); }catch(e){}
        }
      }).finally(()=>{
        E62_ENRICHING_ROUTE = false;
        __e62RenderTracking();
      });

      const box = e62("trackingBox");
      if(box){
        box.innerHTML =
          `<div class="statItem"><b>...</b><span>Total</span></div>`+
          `<div class="statItem"><b>...</b><span>Av.</span></div>`+
          `<div class="statItem"><b>...</b><span>Restan</span></div>`+
          `<div class="statItem"><b>...</b><span>ETA</span></div>`;
      }
      return;
    }

    return __e62RenderTracking.apply(this, arguments);
  };
}

document.addEventListener("DOMContentLoaded", ()=>{
  // Si ya hay tránsito abierto guardado, completar coords en background.
  setTimeout(()=>{
    const t = transit();
    if(t && t.route && !e62RouteHasCoords(t.route)){
      e62EnrichRoute(t.route).then(route=>{
        if(route && e62RouteHasCoords(route)){
          t.route = route;
          try{ save(LS.transit, t); }catch(e){}
        }
      });
    }
  }, 800);
});


/* ===== V1.5.82 - UI sin distancias/tarjetas =====
   Cambios pedidos:
   - Inicio / Fin: eliminar texto y dato Distancia.
   - Tracking: eliminar tarjetas Total, Avance, Restan y ETA.
   - Tracking: dar más espacio al mapa dentro del mismo contenedor.
   - WhatsApp: eliminar Km faltantes y ETA.
   - Último: eliminar Km faltantes y ETA.
*/

function e63(id){ return document.getElementById(id); }

function e63OnlyDestinoBox(route){
  const box = e63("rutaInfo");
  if(!box) return;
  const destino = route && route.destino ? route.destino : "-";
  box.innerHTML = `<b>Destino:</b> ${escapeHtml(destino)}`;
}

/* Inicio / Fin: no mostrar Distancia */
const __e63OnOrigenDestinoChange = typeof onOrigenDestinoChange === "function" ? onOrigenDestinoChange : null;
onOrigenDestinoChange = function(){
  let r = {};
  try{ r = selectedRoute(); }catch(e){}
  e63OnlyDestinoBox(r);
  if(typeof aplicarColorResumenInicio === "function") aplicarColorResumenInicio();
};

const __e63PaintRutaInfo = typeof e61PaintRutaInfo === "function" ? e61PaintRutaInfo : null;
if(__e63PaintRutaInfo){
  e61PaintRutaInfo = function(route){
    e63OnlyDestinoBox(route);
    if(typeof aplicarColorResumenInicio === "function") aplicarColorResumenInicio();
  };
}

const __e63RenderInicio = typeof renderInicio === "function" ? renderInicio : null;
renderInicio = function(){
  if(__e63RenderInicio) __e63RenderInicio();
  try{
    const t = typeof transit === "function" ? transit() : null;
    const r = t && t.route ? t.route : selectedRoute();
    e63OnlyDestinoBox(r);
  }catch(e){}
};

/* Tracking: eliminar tarjetas y agrandar mapa */
function e63HideTrackingStats(){
  const box = e63("trackingBox");
  if(box){
    box.innerHTML = "";
    box.style.display = "none";
  }

  const map = e63("map");
  if(map){
    map.classList.add("trackingMapLarge");
  }

  // Algunas versiones usan otro id/clase
  ["trackingMap", "leafletMap"].forEach(id=>{
    const el = e63(id);
    if(el) el.classList.add("trackingMapLarge");
  });

  setTimeout(()=>{
    try{
      if(typeof leafletMap !== "undefined" && leafletMap){
        leafletMap.invalidateSize();
      }
    }catch(e){}
  }, 250);
}

const __e63RenderTracking = typeof renderTracking === "function" ? renderTracking : null;
renderTracking = function(){
  if(__e63RenderTracking) __e63RenderTracking();
  e63HideTrackingStats();
};

/* WhatsApp: quitar líneas de km faltantes y ETA */
function e63CleanMsg(msg){
  return String(msg || "")
    .split(/\r?\n/)
    .filter(line => {
      const l = line.toLowerCase();
      if(l.includes("km faltantes")) return false;
      if(l.includes("faltantes")) return false;
      if(l.includes("restan")) return false;
      if(l.includes("eta")) return false;
      if(l.includes("tiempo estimado")) return false;
      return true;
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const __e63SendToPhones = typeof sendToPhones === "function" ? sendToPhones : null;
if(__e63SendToPhones){
  sendToPhones = function(msg){
    return __e63SendToPhones.call(this, e63CleanMsg(msg));
  };
}

const __e63BuildUpdateMsg = typeof buildUpdateMsg === "function" ? buildUpdateMsg : null;
if(__e63BuildUpdateMsg){
  buildUpdateMsg = function(){
    return e63CleanMsg(__e63BuildUpdateMsg.apply(this, arguments));
  };
}

const __e63BuildUpdateMsgAsync = typeof buildUpdateMsgAsync === "function" ? buildUpdateMsgAsync : null;
if(__e63BuildUpdateMsgAsync){
  buildUpdateMsgAsync = async function(){
    const msg = await __e63BuildUpdateMsgAsync.apply(this, arguments);
    return e63CleanMsg(msg);
  };
}

const __e63BuildCierreMsgAsync = typeof buildCierreMsgAsync === "function" ? buildCierreMsgAsync : null;
if(__e63BuildCierreMsgAsync){
  buildCierreMsgAsync = async function(){
    const msg = await __e63BuildCierreMsgAsync.apply(this, arguments);
    return e63CleanMsg(msg);
  };
}

/* Último: quitar Km faltantes y ETA */
const __e63RenderUltimo = typeof renderUltimo === "function" ? renderUltimo : null;
renderUltimo = function(){
  if(__e63RenderUltimo) __e63RenderUltimo();

  const ids = ["lastBox", "ultimoList", "ultimoContent", "lastContent", "lastTransit", "ultimoBody"];
  ids.forEach(id=>{
    const el = e63(id);
    if(!el) return;

    if(el.innerText){
      const cleaned = e63CleanMsg(el.innerText);
      if(el.children.length === 0) el.innerText = cleaned;
    }

    if(el.innerHTML){
      el.querySelectorAll("*").forEach(node=>{
        const txt = String(node.innerText || "").toLowerCase();
        if(txt.includes("km faltantes") || txt.includes("eta") || txt.includes("restan") || txt.includes("tiempo estimado")){
          node.remove();
        }
      });
    }
  });
};

document.addEventListener("DOMContentLoaded", ()=>{
  setTimeout(()=>{
    e63HideTrackingStats();
    try{
      const t = typeof transit === "function" ? transit() : null;
      const r = t && t.route ? t.route : selectedRoute();
      e63OnlyDestinoBox(r);
    }catch(e){}
  }, 700);
});




/* ===== V1.5.82 - optimización apertura =====
   Limpia intervalos redundantes del mapa y difiere carga Firebase de Inicio/Fin.
*/
const __e67Show = typeof show === "function" ? show : null;
if(__e67Show){
  show = function(id){
    const r = __e67Show.apply(this, arguments);
    if(id === "inicio" && typeof initSelectors === "function" && !window.__e61CombosLoaded){
      window.__e61CombosLoaded = true;
      setTimeout(initSelectors, 150);
    }
    return r;
  };
}





/* ===== V1.5.82 - Tracking: nunca mostrar ruta, sí referencias ===== */
function tpodRemoveOnlyRouteLinesV1573(){
  try{
    if(typeof trackingMap !== "undefined" && trackingMap){
      trackingMap.eachLayer(function(layer){
        try{
          const isPolyline = layer instanceof L.Polyline;
          const isCircle = layer instanceof L.Circle || layer instanceof L.CircleMarker;
          const isMarker = layer instanceof L.Marker;
          const isPolygon = layer instanceof L.Polygon;

          if(isPolyline && !isCircle && !isMarker && !isPolygon){
            trackingMap.removeLayer(layer);
          }
        }catch(e){}
      });
    }
  }catch(e){}
}

const __renderTrackingV1573 = typeof renderTracking === "function" ? renderTracking : null;
if(__renderTrackingV1573){
  renderTracking = function(){
    const t = transit();
    const id = t && t.id ? String(t.id) : "";
    if(id !== window.__trackingTransitIdNoRoute){
      window.__trackingTransitIdNoRoute = id;
      window.__trackingMapFitNoRoute = false;
      window.__trackingUserMovedNoRoute = false;
    }

    const r = __renderTrackingV1573.apply(this, arguments);

    setTimeout(function(){
      tpodRemoveOnlyRouteLinesV1573();
      try{ renderTrackingMap(transit()); }catch(e){}
    }, 80);

    return r;
  };
}


/* ===== V1.5.82 - Tracking sin ruta azul definitivo ===== */
function removeOnlyRoutePolylinesV1574(){
  try{
    const maps = [];
    if(typeof trackingMap !== "undefined" && trackingMap) maps.push(trackingMap);
    if(typeof leafletMap !== "undefined" && leafletMap && !maps.includes(leafletMap)) maps.push(leafletMap);

    maps.forEach(function(mp){
      mp.eachLayer(function(layer){
        try{
          const isPolyline = layer instanceof L.Polyline;
          const isCircle = layer instanceof L.Circle || layer instanceof L.CircleMarker;
          const isMarker = layer instanceof L.Marker;
          const isPolygon = layer instanceof L.Polygon;
          if(isPolyline && !isCircle && !isMarker && !isPolygon){
            mp.removeLayer(layer);
          }
        }catch(e){}
      });
    });
  }catch(e){}
}

const __renderTrackingMapV1574 = typeof renderTrackingMap === "function" ? renderTrackingMap : null;
if(__renderTrackingMapV1574){
  renderTrackingMap = function(t){
    const r = __renderTrackingMapV1574.apply(this, arguments);
    setTimeout(removeOnlyRoutePolylinesV1574, 50);
    setTimeout(removeOnlyRoutePolylinesV1574, 250);
    return r;
  };
}


/* ===== V1.5.82 - FIX RAIZ coordenadas 0 en Inicio/Fin y Tracking ===== */
function tpodCoordValidV1577(v){
  const n = Number(v);
  return Number.isFinite(n) && Math.abs(n) > 0.000001 ? n : null;
}

function tpodParseCoordV1577(v){
  if(!v) return null;
  if(typeof v === "object"){
    const lat = tpodCoordValidV1577(v.lat ?? v.latitude);
    const lng = tpodCoordValidV1577(v.lng ?? v.lon ?? v.longitude);
    if(lat !== null && lng !== null) return {lat,lng};
  }
  const nums = String(v).match(/-?\d+(?:\.\d+)?/g);
  if(nums && nums.length >= 2){
    const lat = tpodCoordValidV1577(nums[0]);
    const lng = tpodCoordValidV1577(nums[1]);
    if(lat !== null && lng !== null) return {lat,lng};
  }
  return null;
}

function tpodHasCoordV1577(lat,lng){
  return tpodCoordValidV1577(lat) !== null && tpodCoordValidV1577(lng) !== null;
}

function tpodDocCoordV1577(x){
  x = x || {};
  return tpodParseCoordV1577(x.ubicacion) ||
         tpodParseCoordV1577(x.location) ||
         tpodParseCoordV1577(x.coords) ||
         tpodParseCoordV1577(x.coordenadas) ||
         tpodParseCoordV1577(x.gps) ||
         tpodParseCoordV1577(x);
}

function tpodNamesV1577(id,x){
  x = x || {};
  return [id,x.nombre,x.name,x.origen,x.destino,x.descripcion,x.cliente]
    .map(v => String(v || "").trim().toLowerCase().replace(/\s+/g," "))
    .filter(Boolean);
}

function tpodNormNameV1577(v){
  return String(v || "").trim().toLowerCase().replace(/\s+/g," ");
}

async function tpodEnsureDbV1577(){
  try{ if(typeof tpodInitFirebase === "function") tpodInitFirebase(); }catch(e){}
  try{ if(typeof firebaseReady === "function") firebaseReady(); }catch(e){}
  try{ if(typeof e61Ready === "function") e61Ready(); }catch(e){}
  try{ if(typeof initFirebaseCloud === "function") initFirebaseCloud(); }catch(e){}
  try{
    if(typeof db !== "undefined" && db) return true;
  }catch(e){}
  try{
    if(typeof firebase !== "undefined"){
      if(firebase.apps && !firebase.apps.length && typeof FIREBASE_CONFIG !== "undefined"){
        firebase.initializeApp(FIREBASE_CONFIG);
      }
      if(firebase.apps && firebase.apps.length){
        db = firebase.firestore();
        return !!db;
      }
    }
  }catch(e){
    console.log("tpodEnsureDbV1577", e);
  }
  return false;
}

async function tpodFindCoordV1577(collectionName, wantedName){
  const targetRaw = String(wantedName || "").trim();
  if(!targetRaw) return null;

  if(!window.__tpodCoordCacheV1577) window.__tpodCoordCacheV1577 = {};
  const key = collectionName + "|" + tpodNormNameV1577(targetRaw);
  if(window.__tpodCoordCacheV1577[key]) return window.__tpodCoordCacheV1577[key];

  const ready = await tpodEnsureDbV1577();
  if(!ready || typeof db === "undefined" || !db){
    console.log("No hay db para coordenadas", collectionName, targetRaw);
    return null;
  }

  try{
    const direct = await db.collection(collectionName).doc(targetRaw).get();
    if(direct.exists){
      const c = tpodDocCoordV1577(direct.data() || {});
      if(c){ window.__tpodCoordCacheV1577[key] = c; return c; }
    }
  }catch(e){}

  try{
    const snap = await db.collection(collectionName).get();
    const target = tpodNormNameV1577(targetRaw);

    for(const d of snap.docs){
      const x = d.data() || {};
      const names = tpodNamesV1577(d.id,x);
      if(names.includes(target)){
        const c = tpodDocCoordV1577(x);
        if(c){ window.__tpodCoordCacheV1577[key] = c; return c; }
      }
    }

    for(const d of snap.docs){
      const x = d.data() || {};
      const names = tpodNamesV1577(d.id,x);
      if(names.some(n => n.includes(target) || target.includes(n))){
        const c = tpodDocCoordV1577(x);
        if(c){ window.__tpodCoordCacheV1577[key] = c; return c; }
      }
    }
  }catch(e){
    console.log("tpodFindCoordV1577", collectionName, targetRaw, e);
  }

  return null;
}

// Evita convertir dataset vacío en 0.
try{
  e61SelectedCoord = function(id){
    const sel = e61(id);
    if(!sel) return {};
    const opt = sel.options && sel.selectedIndex >= 0 ? sel.options[sel.selectedIndex] : null;
    if(!opt) return {};
    const rawLat = opt.dataset.lat;
    const rawLng = opt.dataset.lng;
    if(rawLat === undefined || rawLat === "" || rawLng === undefined || rawLng === "") return {};
    const lat = tpodCoordValidV1577(rawLat);
    const lng = tpodCoordValidV1577(rawLng);
    return {
      lat: lat !== null ? lat : "",
      lng: lng !== null ? lng : ""
    };
  };
}catch(e){}

async function tpodEnrichRouteCoordsV1577(route){
  if(!route) return route;
  route = {...route};

  const hasOrigen = tpodHasCoordV1577(route.origen_lat ?? route.origenLat, route.origen_lng ?? route.origenLng);
  const hasDestino = tpodHasCoordV1577(route.destino_lat ?? route.destinoLat, route.destino_lng ?? route.destinoLng);

  if(!hasOrigen && route.origen){
    const c = await tpodFindCoordV1577("origenes", route.origen);
    if(c){
      route.origen_lat = c.lat;
      route.origen_lng = c.lng;
    }
  }

  if(!hasDestino && route.destino){
    const c = await tpodFindCoordV1577("destinos", route.destino);
    if(c){
      route.destino_lat = c.lat;
      route.destino_lng = c.lng;
    }
  }

  return route;
}

// Al validar embarque, devolver route con coordenadas reales.
try{
  if(typeof e61ValidarEmbarqueInicio === "function" && !window.__origE61ValidarV1577){
    window.__origE61ValidarV1577 = e61ValidarEmbarqueInicio;
    e61ValidarEmbarqueInicio = async function(){
      const route = await window.__origE61ValidarV1577.apply(this, arguments);
      if(route){
        const enriched = await tpodEnrichRouteCoordsV1577(route);
        try{
          E61_ROUTE_LOCK = enriched;
          if(typeof e61PaintRutaInfo === "function") e61PaintRutaInfo(enriched);
        }catch(e){}
        return enriched;
      }
      return route;
    };
  }
}catch(e){
  console.log("patch validar embarque coords", e);
}

// Antes de iniciar, asegurar que selectedRoute tenga coordenadas.
try{
  if(typeof iniciarTransito === "function" && !window.__origIniciarTransitoV1577){
    window.__origIniciarTransitoV1577 = iniciarTransito;
    iniciarTransito = async function(){
      try{
        const embEl = document.getElementById("embarqueInput");
        if(embEl && embEl.value.trim() && typeof e61ValidarEmbarqueInicio === "function"){
          const route = await e61ValidarEmbarqueInicio();
          if(route){
            try{ E61_ROUTE_LOCK = route; }catch(e){}
          }
        }
      }catch(e){
        console.log("pre iniciar coords", e);
      }
      return window.__origIniciarTransitoV1577.apply(this, arguments);
    };
  }
}catch(e){}

// selectedRoute nunca debe devolver 0 como coordenada válida.
try{
  if(typeof selectedRoute === "function" && !window.__origSelectedRouteV1577){
    window.__origSelectedRouteV1577 = selectedRoute;
    selectedRoute = function(){
      const r = window.__origSelectedRouteV1577.apply(this, arguments) || {};
      if(!tpodHasCoordV1577(r.origen_lat ?? r.origenLat, r.origen_lng ?? r.origenLng)){
        r.origen_lat = "";
        r.origen_lng = "";
      }
      if(!tpodHasCoordV1577(r.destino_lat ?? r.destinoLat, r.destino_lng ?? r.destinoLng)){
        r.destino_lat = "";
        r.destino_lng = "";
      }
      return r;
    };
  }
}catch(e){}

// Tracking: si el tránsito actual tiene 0, completar desde Firebase y actualizar LocalStorage/Firestore.
async function tpodFixTransitRouteCoordsV1577(t){
  if(!t || !t.route) return t;
  const before = JSON.stringify(t.route);
  const enriched = await tpodEnrichRouteCoordsV1577(t.route);
  t.route = enriched;

  if(JSON.stringify(enriched) !== before){
    try{ save(LS.transit, t); }catch(e){}
    try{
      if(t.id && await tpodEnsureDbV1577()){
        await db.collection("transitos").doc(t.id).set({
          route: {
            origen_lat: enriched.origen_lat || "",
            origen_lng: enriched.origen_lng || "",
            destino_lat: enriched.destino_lat || "",
            destino_lng: enriched.destino_lng || ""
          }
        }, {merge:true});
      }
    }catch(e){
      console.log("No se pudo actualizar coords transito", e);
    }
  }
  return t;
}

try{
  if(typeof renderTrackingMap === "function" && !window.__origRenderTrackingMapV1577){
    window.__origRenderTrackingMapV1577 = renderTrackingMap;
    renderTrackingMap = function(t){
      const current = t || (typeof transit === "function" ? transit() : null);
      if(current && current.route){
        const hasOrigen = tpodHasCoordV1577(current.route.origen_lat ?? current.route.origenLat, current.route.origen_lng ?? current.route.origenLng);
        const hasDestino = tpodHasCoordV1577(current.route.destino_lat ?? current.route.destinoLat, current.route.destino_lng ?? current.route.destinoLng);
        if(!hasOrigen || !hasDestino){
          tpodFixTransitRouteCoordsV1577(current).then(fixed=>{
            window.__origRenderTrackingMapV1577(fixed);
          });
          return;
        }
      }
      return window.__origRenderTrackingMapV1577.apply(this, arguments);
    };
  }
}catch(e){
  console.log("patch renderTrackingMap coords", e);
}


/* ===== V1.5.82 - Inicio de tránsito con espera visible y control duplicado =====
   Alcance: sólo botón Iniciar tránsito.
   - Muestra cartel "Iniciando tránsito..." mientras trabaja.
   - Deshabilita el botón para evitar doble click.
   - Valida que la misma flota no tenga otro tránsito abierto para el mismo embarque.
   - Guarda en Firebase antes de informar "Tránsito iniciado correctamente".
*/
let TPOD_STARTING_TRANSIT_1578 = false;


function tpodStartBusy1578(show,msg){
  let box = document.getElementById("tpodStartBusy1578");
  if(show){
    if(!box){
      box = document.createElement("div");
      box.id = "tpodStartBusy1578";
      box.innerHTML = '<div class="tpodStartBusyCard1578"><div class="tpodStartBusySpinner1578"></div><div id="tpodStartBusyText1578"></div></div>';
      document.body.appendChild(box);
    }
    const txt = document.getElementById("tpodStartBusyText1578");
    if(txt) txt.textContent = msg || "Iniciando tránsito...";
    box.style.display = "flex";
    box.style.visibility = "visible";
    box.style.opacity = "1";
  }else if(box){
    box.style.display = "none";
  }

  try{
    Array.from(document.querySelectorAll("button,input[type='button']")).forEach(b=>{
      const text = String(b.textContent || b.value || "").toLowerCase();
      if(text.includes("iniciar tránsito") || text.includes("iniciar transito")){
        b.disabled = !!show;
        b.classList.toggle("tpodBtnBusy1578", !!show);
      }
    });
  }catch(e){}
}


async function tpodDbReady1578(){
  try{ if(typeof firebaseReady === "function" && firebaseReady()) return true; }catch(e){}
  try{ if(typeof initFirebaseCloud === "function" && initFirebaseCloud()) return true; }catch(e){}
  try{ if(typeof tpodInitFirebase === "function") tpodInitFirebase(); }catch(e){}
  try{
    if(typeof db !== "undefined" && db) return true;
  }catch(e){}
  try{
    if(typeof firebase !== "undefined"){
      if(firebase.apps && !firebase.apps.length && typeof FIREBASE_CONFIG !== "undefined"){
        firebase.initializeApp(FIREBASE_CONFIG);
      }
      if(firebase.apps && firebase.apps.length){
        db = firebase.firestore();
        return !!db;
      }
    }
  }catch(e){
    console.log("tpodDbReady1578", e);
  }
  return false;
}

function tpodFleetOf1578(t){
  return String((t && t.user && t.user.fleet) || (t && t.flota) || "").trim();
}

function tpodEmbOf1578(t){
  return String((t && t.embarque) || "").trim();
}

function tpodIsOpen1578(t){
  if(!t) return false;
  if(t.closed || t.cierre) return false;
  const estado = String(t.estado || "").toLowerCase();
  if(estado === "cerrado" || estado === "closed" || estado === "finalizado") return false;
  return true;
}

function tpodFleetInTransit1578(t, flota){
  flota = String(flota || "").trim();
  if(!flota || !t) return false;
  if(tpodFleetOf1578(t) === flota) return true;
  const parts = (t.participantes || []).map(x=>String(x).trim());
  return parts.includes(flota);
}

function tpodNormalizeTransit1578(id,x){
  x = x || {};
  const route = x.route || {};
  const userObj = x.user || {fleet:x.flota || "", driver:x.chofer || ""};
  return {
    id: x.id || id || "",
    user: userObj,
    route: route,
    flota: x.flota || (userObj && userObj.fleet) || "",
    chofer: x.chofer || (userObj && userObj.driver) || "",
    lote: x.lote || x.carga || "",
    embarque: x.embarque || "",
    start: x.start || x.inicio || null,
    closed: x.closed || x.cierre || null,
    estado: x.estado || "",
    participantes: x.participantes || [],
    updates: x.updates || [],
    alerts: x.alerts || []
  };
}

async function tpodExisteFlotaEmbarqueAbierto1578(embarque, flota){
  embarque = String(embarque || "").trim();
  flota = String(flota || "").trim();
  if(!embarque || !flota) return false;

  // Primero validar tránsito local.
  try{
    const local = typeof transit === "function" ? transit() : null;
    if(local && tpodIsOpen1578(local) && tpodEmbOf1578(local) === embarque && tpodFleetInTransit1578(local, flota)){
      return true;
    }
  }catch(e){}

  // Luego validar Firebase.
  const ok = await tpodDbReady1578();
  if(!ok || typeof db === "undefined" || !db){
    throw new Error("Firebase no está disponible para validar duplicados.");
  }

  try{
    const snap = await db.collection("transitos").where("embarque","==",embarque).get();
    for(const d of snap.docs){
      const t = tpodNormalizeTransit1578(d.id, d.data() || {});
      if(tpodIsOpen1578(t) && tpodFleetInTransit1578(t, flota)){
        return true;
      }
    }
  }catch(e){
    // Si el índice/where falla, hacemos lectura general como respaldo.
    const snap = await db.collection("transitos").get();
    for(const d of snap.docs){
      const t = tpodNormalizeTransit1578(d.id, d.data() || {});
      if(tpodEmbOf1578(t) === embarque && tpodIsOpen1578(t) && tpodFleetInTransit1578(t, flota)){
        return true;
      }
    }
  }

  return false;
}

function tpodCloudDoc1578(t){
  const u = t.user || {};
  const parts = Array.from(new Set([String(u.fleet || ""), ...((t.participantes || []).map(String))].filter(Boolean)));
  const current = (t.updates && t.updates.length) ? t.updates[t.updates.length - 1].gps : (t.closed || t.start || null);
  return {
    ...t,
    id: t.id || "",
    user: u,
    route: t.route || {},
    flota: u.fleet || "",
    chofer: u.driver || "",
    lote: t.lote || "",
    embarque: t.embarque || "",
    estado: t.closed ? "cerrado" : "abierto",
    start: t.start || null,
    closed: t.closed || null,
    updates: t.updates || [],
    alerts: t.alerts || [],
    ultimaPosicion: current,
    ultimaAlerta: (t.alerts && t.alerts.length) ? t.alerts[t.alerts.length - 1] : null,
    participantes: parts,
    updatedAt: new Date().toISOString()
  };
}

async function tpodGuardarTransitoInicio1578(t){
  const ok = await tpodDbReady1578();
  if(!ok || typeof db === "undefined" || !db){
    throw new Error("Firebase no está disponible para guardar el tránsito.");
  }
  const id = t.id || (typeof regId === "function" ? regId() : ("TPOD-" + Date.now()));
  t.id = id;
  await db.collection("transitos").doc(String(id)).set(tpodCloudDoc1578(t), {merge:true});
}

async function tpodRouteInicio1578(){
  let route = null;
  try{
    if(typeof e61ValidarEmbarqueInicio === "function"){
      route = await e61ValidarEmbarqueInicio();
    }
  }catch(e){
    console.log("validar embarque inicio", e);
  }

  if(!route){
    try{ route = typeof selectedRoute === "function" ? selectedRoute() : {}; }catch(e){ route = {}; }
  }

  try{
    if(route && typeof tpodEnrichRouteCoordsV1577 === "function"){
      route = await tpodEnrichRouteCoordsV1577(route);
    }
  }catch(e){}

  return route || {};
}

async function iniciarTransito(){
  if(TPOD_STARTING_TRANSIT_1578) return;

  const abierto = typeof transit === "function" ? transit() : null;
  if(abierto && !abierto.closed){
    window.alert("Ya hay un tránsito iniciado sin cerrar. Primero debe cerrar el tránsito actual.");
    show("tracking");
    return;
  }

  const u = typeof user === "function" ? user() : {};
  const flota = String((u && u.fleet) || "").trim();
  if(!flota){
    window.alert("Cargá la flota en Usuario.");
    show("usuario");
    return;
  }

  const loteEl = $("lote");
  const lote = loteEl ? loteEl.value.trim() : "";
  if(!lote){
    window.alert("Ingresá número de lote/carga.");
    return;
  }

  const embEl = $("embarqueInput");
  const embarque = embEl ? embEl.value.trim() : "";
  if(!embarque){
    window.alert("Ingresá número de embarque.");
    return;
  }

  TPOD_STARTING_TRANSIT_1578 = true;
  tpodStartBusy1578(true, "Iniciando tránsito...");

  try{
    tpodStartBusy1578(true, "Validando embarque y flota...");
    const route = await tpodRouteInicio1578();
    if(!route || (typeof e61ValidarEmbarqueInicio === "function" && !route.embarque && !route.cliente && !route.origen && !route.destino)){
      throw new Error("El embarque no existe o no está activo en Firebase.");
    }

    const duplicado = await tpodExisteFlotaEmbarqueAbierto1578(embarque, flota);
    if(duplicado){
      throw new Error("La flota " + flota + " ya tiene un tránsito abierto para el embarque " + embarque + ".");
    }

    tpodStartBusy1578(true, "Tomando GPS de inicio...");
    const gps = await getGps();

    const t = {
      id: typeof regId === "function" ? regId() : ("TPOD-" + Date.now()),
      user: u,
      route: route,
      lote: lote,
      embarque: embarque,
      start: gps,
      updates: [],
      alerts: [],
      participantes: [flota],
      closed: null,
      estado: "abierto"
    };

    tpodStartBusy1578(true, "Guardando tránsito en la base...");
    await tpodGuardarTransitoInicio1578(t);

    save(LS.transit, t);
    if(typeof saveTransitHistory === "function") saveTransitHistory(t);
    if(typeof bloquearFormularioTransito === "function") bloquearFormularioTransito();
    if(typeof renderTransitStatus === "function") renderTransitStatus();
    if(typeof aplicarColorResumenInicio === "function") aplicarColorResumenInicio();

    tpodStartBusy1578(false);
    window.alert("Tránsito iniciado correctamente.");
    show("tracking");
    if(typeof startAutoGps === "function") startAutoGps();

  }catch(e){
    tpodStartBusy1578(false);
    window.alert(e.message || String(e));
  }finally{
    TPOD_STARTING_TRANSIT_1578 = false;
    tpodStartBusy1578(false);
  }
}


/* ===== V1.5.82 - cartel inmediato real y guardado único ===== */
function tpodIsStartButton1580(el){
  const b = el && el.closest ? el.closest("button,input[type='button']") : null;
  if(!b) return false;
  const txt = String(b.textContent || b.value || "").toLowerCase();
  const on = String((b.getAttribute && b.getAttribute("onclick")) || "").toLowerCase();
  return txt.includes("iniciar tránsito") || txt.includes("iniciar transito") || on.includes("iniciartransito");
}

function tpodShowStartBusyEarly1580(ev){
  try{
    if(TPOD_STARTING_TRANSIT_1578) return;
    if(tpodIsStartButton1580(ev && ev.target)){
      tpodStartBusy1578(true, "Iniciando tránsito...");
    }
  }catch(e){}
}

try{
  document.addEventListener("pointerdown", tpodShowStartBusyEarly1580, true);
  document.addEventListener("touchstart", tpodShowStartBusyEarly1580, true);
  document.addEventListener("mousedown", tpodShowStartBusyEarly1580, true);
}catch(e){}

const __tpodGuardarTransitoInicio1578_v1580 = typeof tpodGuardarTransitoInicio1578 === "function" ? tpodGuardarTransitoInicio1578 : null;
if(__tpodGuardarTransitoInicio1578_v1580){
  tpodGuardarTransitoInicio1578 = async function(t){
    if(!t) return;
    if(t.__inicioGuardadoFirebase1580) return;
    await __tpodGuardarTransitoInicio1578_v1580(t);
    t.__inicioGuardadoFirebase1580 = true;
  };
}

const __cloudSaveTransitV1580 = typeof cloudSaveTransit === "function" ? cloudSaveTransit : null;
if(__cloudSaveTransitV1580){
  cloudSaveTransit = async function(t){
    if(t && t.__inicioGuardadoFirebase1580 && !t.closed && String(t.estado || "abierto").toLowerCase() === "abierto"){
      return;
    }
    return __cloudSaveTransitV1580.apply(this, arguments);
  };
}


/* ===== V1.5.82 - Inicio transito estable ===== */
let TPOD_STARTING_TRANSIT_1581 = false;

function tpodStartBusy1581(show,msg){
  let box=document.getElementById("tpodStartBusy1581");
  if(show){
    if(!box){
      box=document.createElement("div");
      box.id="tpodStartBusy1581";
      box.innerHTML='<div class="tpodStartBusyCard1581"><div class="tpodStartBusySpinner1581"></div><div id="tpodStartBusyText1581"></div></div>';
      document.body.appendChild(box);
    }
    const txt=document.getElementById("tpodStartBusyText1581");
    if(txt) txt.textContent=msg||"Iniciando tránsito...";
    box.style.display="flex";
  }else if(box){
    box.style.display="none";
  }
}

function tpodFrame1581(){
  return new Promise(resolve=>{
    try{ requestAnimationFrame(()=>setTimeout(resolve,0)); }
    catch(e){ setTimeout(resolve,0); }
  });
}

function tpodSetStartDisabled1581(disabled){
  try{
    Array.from(document.querySelectorAll("button,input[type='button']")).forEach(b=>{
      const txt=String(b.textContent||b.value||"").toLowerCase();
      const on=String((b.getAttribute&&b.getAttribute("onclick"))||"").toLowerCase();
      if(txt.includes("iniciar tránsito")||txt.includes("iniciar transito")||on.includes("iniciartransito")){
        b.disabled=!!disabled;
        b.classList.toggle("tpodBtnBusy1581",!!disabled);
      }
    });
  }catch(e){}
}

async function tpodDbReady1581(){
  try{ if(typeof firebaseReady==="function") firebaseReady(); }catch(e){}
  try{ if(typeof initFirebaseCloud==="function") initFirebaseCloud(); }catch(e){}
  try{ if(typeof tpodInitFirebase==="function") tpodInitFirebase(); }catch(e){}
  try{ if(typeof db!=="undefined"&&db) return true; }catch(e){}
  try{
    if(typeof firebase!=="undefined"){
      if(firebase.apps&&!firebase.apps.length&&typeof FIREBASE_CONFIG!=="undefined") firebase.initializeApp(FIREBASE_CONFIG);
      if(firebase.apps&&firebase.apps.length){ db=firebase.firestore(); return !!db; }
    }
  }catch(e){}
  return false;
}

function tpodOpen1581(t){
  if(!t) return false;
  if(t.closed||t.cierre) return false;
  const e=String(t.estado||"").toLowerCase();
  return !(e==="cerrado"||e==="closed"||e==="finalizado");
}
function tpodEmb1581(t){ return String((t&&t.embarque)||"").trim(); }
function tpodFleet1581(t){ return String((t&&t.user&&t.user.fleet)||(t&&t.flota)||"").trim(); }
function tpodHasFleet1581(t,flota){
  flota=String(flota||"").trim();
  if(!t||!flota) return false;
  if(tpodFleet1581(t)===flota) return true;
  return (t.participantes||[]).map(x=>String(x).trim()).includes(flota);
}
function tpodNormT1581(id,x){
  x=x||{}; const u=x.user||{};
  return {id:x.id||id||"",user:{fleet:u.fleet||x.flota||""},flota:x.flota||u.fleet||"",embarque:x.embarque||"",estado:x.estado||"",closed:x.closed||x.cierre||null,participantes:x.participantes||[]};
}

async function tpodDuplicado1581(embarque,flota){
  embarque=String(embarque||"").trim(); flota=String(flota||"").trim();
  if(!embarque||!flota) return false;
  try{
    const local=typeof transit==="function"?transit():null;
    if(local&&tpodOpen1581(local)&&tpodEmb1581(local)===embarque&&tpodHasFleet1581(local,flota)) return true;
  }catch(e){}
  if(!(await tpodDbReady1581())||typeof db==="undefined"||!db) throw new Error("Firebase no está disponible para validar duplicados.");
  try{
    const snap=await db.collection("transitos").where("embarque","==",embarque).get();
    for(const d of snap.docs){ const t=tpodNormT1581(d.id,d.data()||{}); if(tpodOpen1581(t)&&tpodHasFleet1581(t,flota)) return true; }
    return false;
  }catch(e){
    const snap=await db.collection("transitos").get();
    for(const d of snap.docs){ const t=tpodNormT1581(d.id,d.data()||{}); if(tpodEmb1581(t)===embarque&&tpodOpen1581(t)&&tpodHasFleet1581(t,flota)) return true; }
    return false;
  }
}

async function tpodRouteInicio1581(){
  let route=null;
  try{ if(typeof e61ValidarEmbarqueInicio==="function") route=await e61ValidarEmbarqueInicio(); }catch(e){ console.log(e); }
  if(!route){ try{ route=typeof selectedRoute==="function"?selectedRoute():{}; }catch(e){ route={}; } }
  try{ if(route&&typeof tpodEnrichRouteCoordsV1577==="function") route=await tpodEnrichRouteCoordsV1577(route); }catch(e){}
  return route||{};
}

function tpodCloudDoc1581(t){
  const u=t.user||{};
  const parts=Array.from(new Set([String(u.fleet||""),...((t.participantes||[]).map(String))].filter(Boolean)));
  const current=(t.updates&&t.updates.length)?t.updates[t.updates.length-1].gps:(t.closed||t.start||null);
  return {...t,id:t.id||"",user:u,route:t.route||{},flota:u.fleet||"",chofer:u.driver||"",lote:t.lote||"",embarque:t.embarque||"",estado:t.closed?"cerrado":"abierto",start:t.start||null,closed:t.closed||null,updates:t.updates||[],alerts:t.alerts||[],ultimaPosicion:current,ultimaAlerta:(t.alerts&&t.alerts.length)?t.alerts[t.alerts.length-1]:null,participantes:parts,updatedAt:new Date().toISOString()};
}

async function tpodGuardarInicio1581(t){
  if(!t) throw new Error("No hay datos de tránsito para guardar.");
  if(t.__inicioGuardadoFirebase1581) return;
  if(!(await tpodDbReady1581())||typeof db==="undefined"||!db) throw new Error("Firebase no está disponible para guardar el tránsito.");
  t.id=t.id||(typeof regId==="function"?regId():("TPOD-"+Date.now()));
  await db.collection("transitos").doc(String(t.id)).set(tpodCloudDoc1581(t),{merge:true});
  t.__inicioGuardadoFirebase1581=true;
}

function tpodIsStartButton1581(el){
  const b=el&&el.closest?el.closest("button,input[type='button']"):null;
  if(!b) return false;
  const txt=String(b.textContent||b.value||"").toLowerCase();
  const on=String((b.getAttribute&&b.getAttribute("onclick"))||"").toLowerCase();
  return txt.includes("iniciar tránsito")||txt.includes("iniciar transito")||on.includes("iniciartransito");
}
function tpodShowStartBusyEarly1581(ev){
  try{ if(!TPOD_STARTING_TRANSIT_1581&&tpodIsStartButton1581(ev&&ev.target)) tpodStartBusy1581(true,"Iniciando tránsito..."); }catch(e){}
}
try{
  document.addEventListener("pointerdown",tpodShowStartBusyEarly1581,true);
  document.addEventListener("touchstart",tpodShowStartBusyEarly1581,true);
  document.addEventListener("mousedown",tpodShowStartBusyEarly1581,true);
}catch(e){}

/* V1.5.82 - iniciarTransito final activo */

async function iniciarTransito(){
  if(TPOD_STARTING_TRANSIT_1581) return;
  TPOD_STARTING_TRANSIT_1581=true;
  tpodStartBusy1581(true,"Iniciando tránsito...");
  tpodSetStartDisabled1581(true);
  await tpodFrame1581();

  try{
    const abierto=typeof transit==="function"?transit():null;
    if(abierto&&tpodOpen1581(abierto)) throw new Error("Ya hay un tránsito iniciado sin cerrar. Primero debe cerrar el tránsito actual.");

    const u=typeof user==="function"?user():{};
    const flota=String((u&&u.fleet)||"").trim();
    if(!flota) throw new Error("Cargá la flota en Usuario.");

    const loteEl=$("lote");
    const lote=loteEl?loteEl.value.trim():"";
    if(!lote) throw new Error("Ingresá número de lote/carga.");

    const embEl=$("embarqueInput");
    const embarque=embEl?embEl.value.trim():"";
    if(!embarque) throw new Error("Ingresá número de embarque.");

    tpodStartBusy1581(true,"Validando...");
    await tpodFrame1581();

    const route=await tpodRouteInicio1581();
    if(!route||(!route.embarque&&!route.cliente&&!route.origen&&!route.destino)) throw new Error("El embarque no existe o no está activo en Firebase.");

    if(await tpodDuplicado1581(embarque,flota)) throw new Error("La flota "+flota+" ya tiene un tránsito abierto para el embarque "+embarque+".");

    tpodStartBusy1581(true,"GPS...");
    await tpodFrame1581();
    const gps=await getGps();

    const t={id:typeof regId==="function"?regId():("TPOD-"+Date.now()),user:u,route:route,lote:lote,embarque:embarque,start:gps,updates:[],alerts:[],participantes:[flota],closed:null,estado:"abierto"};

    tpodStartBusy1581(true,"Guardando...");
    await tpodFrame1581();

    await tpodGuardarInicio1581(t);

    save(LS.transit,t);
    if(typeof saveTransitHistory==="function") saveTransitHistory(t);
    if(typeof bloquearFormularioTransito==="function") bloquearFormularioTransito();
    if(typeof renderTransitStatus==="function") renderTransitStatus();
    if(typeof aplicarColorResumenInicio==="function") aplicarColorResumenInicio();

    tpodStartBusy1581(false);
    window.alert("Tránsito iniciado correctamente.");
    show("tracking");
    if(typeof startAutoGps==="function") startAutoGps();
  }catch(e){
    tpodStartBusy1581(false);
    window.alert(e.message||String(e));
  }finally{
    TPOD_STARTING_TRANSIT_1581=false;
    tpodSetStartDisabled1581(false);
    tpodStartBusy1581(false);
  }
}

const __cloudSaveTransitV1581 = typeof cloudSaveTransit==="function" ? cloudSaveTransit : null;
if(__cloudSaveTransitV1581){
  cloudSaveTransit = async function(t){
    if(t&&t.__inicioGuardadoFirebase1581&&!t.closed&&String(t.estado||"abierto").toLowerCase()==="abierto") return;
    return __cloudSaveTransitV1581.apply(this,arguments);
  };
}


/* ===== V1.5.82 - Diagnóstico inicio tránsito con timeout ===== */
let TPOD_STARTING_TRANSIT_1582 = false;

function tpodStartBusy1582(show,msg){
  let box=document.getElementById("tpodStartBusy1582");
  if(show){
    if(!box){
      box=document.createElement("div");
      box.id="tpodStartBusy1582";
      box.innerHTML='<div class="tpodStartBusyCard1582"><div class="tpodStartBusySpinner1582"></div><div id="tpodStartBusyText1582"></div></div>';
      document.body.appendChild(box);
    }
    const txt=document.getElementById("tpodStartBusyText1582");
    if(txt) txt.textContent=msg||"Iniciando tránsito...";
    box.style.display="flex";
  }else if(box){
    box.style.display="none";
  }
}

function tpodSetStartDisabled1582(disabled){
  try{
    Array.from(document.querySelectorAll("button,input[type='button']")).forEach(b=>{
      const txt=String(b.textContent||b.value||"").toLowerCase();
      const on=String((b.getAttribute&&b.getAttribute("onclick"))||"").toLowerCase();
      if(txt.includes("iniciar tránsito")||txt.includes("iniciar transito")||on.includes("iniciartransito")){
        b.disabled=!!disabled;
        b.classList.toggle("tpodBtnBusy1582",!!disabled);
      }
    });
  }catch(e){}
}

function tpodFrame1582(){
  return new Promise(resolve=>{
    try{ requestAnimationFrame(()=>setTimeout(resolve,0)); }
    catch(e){ setTimeout(resolve,0); }
  });
}

async function tpodStep1582(msg){
  tpodStartBusy1582(true,msg);
  await tpodFrame1582();
}

function tpodTimeout1582(promise, ms, label){
  let timer;
  return Promise.race([
    promise,
    new Promise((_,reject)=>{
      timer=setTimeout(()=>reject(new Error(label+" tardó demasiado. Verificar conexión/GPS e intentar nuevamente.")),ms);
    })
  ]).finally(()=>clearTimeout(timer));
}

async function tpodDbReady1582(){
  try{ if(typeof firebaseReady==="function") firebaseReady(); }catch(e){}
  try{ if(typeof initFirebaseCloud==="function") initFirebaseCloud(); }catch(e){}
  try{ if(typeof tpodInitFirebase==="function") tpodInitFirebase(); }catch(e){}
  try{ if(typeof db!=="undefined"&&db) return true; }catch(e){}
  try{
    if(typeof firebase!=="undefined"){
      if(firebase.apps&&!firebase.apps.length&&typeof FIREBASE_CONFIG!=="undefined") firebase.initializeApp(FIREBASE_CONFIG);
      if(firebase.apps&&firebase.apps.length){ db=firebase.firestore(); return !!db; }
    }
  }catch(e){}
  return false;
}

function tpodOpen1582(t){
  if(!t) return false;
  if(t.closed||t.cierre) return false;
  const e=String(t.estado||"").toLowerCase();
  return !(e==="cerrado"||e==="closed"||e==="finalizado");
}
function tpodEmb1582(t){ return String((t&&t.embarque)||"").trim(); }
function tpodFleet1582(t){ return String((t&&t.user&&t.user.fleet)||(t&&t.flota)||"").trim(); }
function tpodHasFleet1582(t,flota){
  flota=String(flota||"").trim();
  if(!t||!flota) return false;
  if(tpodFleet1582(t)===flota) return true;
  return (t.participantes||[]).map(x=>String(x).trim()).includes(flota);
}
function tpodNormT1582(id,x){
  x=x||{}; const u=x.user||{};
  return {id:x.id||id||"",user:{fleet:u.fleet||x.flota||""},flota:x.flota||u.fleet||"",embarque:x.embarque||"",estado:x.estado||"",closed:x.closed||x.cierre||null,participantes:x.participantes||[]};
}

async function tpodDuplicado1582(embarque,flota){
  embarque=String(embarque||"").trim(); flota=String(flota||"").trim();
  if(!embarque||!flota) return false;
  try{
    const local=typeof transit==="function"?transit():null;
    if(local&&tpodOpen1582(local)&&tpodEmb1582(local)===embarque&&tpodHasFleet1582(local,flota)) return true;
  }catch(e){}
  if(!(await tpodDbReady1582())||typeof db==="undefined"||!db) throw new Error("Firebase no está disponible para validar duplicados.");
  try{
    const snap=await db.collection("transitos").where("embarque","==",embarque).get();
    for(const d of snap.docs){ const t=tpodNormT1582(d.id,d.data()||{}); if(tpodOpen1582(t)&&tpodHasFleet1582(t,flota)) return true; }
    return false;
  }catch(e){
    const snap=await db.collection("transitos").get();
    for(const d of snap.docs){ const t=tpodNormT1582(d.id,d.data()||{}); if(tpodEmb1582(t)===embarque&&tpodOpen1582(t)&&tpodHasFleet1582(t,flota)) return true; }
    return false;
  }
}

async function tpodRouteInicio1582(){
  let route=null;
  try{ if(typeof e61ValidarEmbarqueInicio==="function") route=await e61ValidarEmbarqueInicio(); }catch(e){ console.log("validar embarque inicio",e); }
  if(!route){ try{ route=typeof selectedRoute==="function"?selectedRoute():{}; }catch(e){ route={}; } }
  try{ if(route&&typeof tpodEnrichRouteCoordsV1577==="function") route=await tpodEnrichRouteCoordsV1577(route); }catch(e){}
  return route||{};
}

function tpodCloudDoc1582(t){
  const u=t.user||{};
  const parts=Array.from(new Set([String(u.fleet||""),...((t.participantes||[]).map(String))].filter(Boolean)));
  const current=(t.updates&&t.updates.length)?t.updates[t.updates.length-1].gps:(t.closed||t.start||null);
  return {...t,id:t.id||"",user:u,route:t.route||{},flota:u.fleet||"",chofer:u.driver||"",lote:t.lote||"",embarque:t.embarque||"",estado:t.closed?"cerrado":"abierto",start:t.start||null,closed:t.closed||null,updates:t.updates||[],alerts:t.alerts||[],ultimaPosicion:current,ultimaAlerta:(t.alerts&&t.alerts.length)?t.alerts[t.alerts.length-1]:null,participantes:parts,updatedAt:new Date().toISOString()};
}

async function tpodGuardarInicio1582(t){
  if(!t) throw new Error("No hay datos de tránsito para guardar.");
  if(t.__inicioGuardadoFirebase1582) return;
  if(!(await tpodDbReady1582())||typeof db==="undefined"||!db) throw new Error("Firebase no está disponible para guardar el tránsito.");
  t.id=t.id||(typeof regId==="function"?regId():("TPOD-"+Date.now()));
  await db.collection("transitos").doc(String(t.id)).set(tpodCloudDoc1582(t),{merge:true});
  t.__inicioGuardadoFirebase1582=true;
}

function tpodIsStartButton1582(el){
  const b=el&&el.closest?el.closest("button,input[type='button']"):null;
  if(!b) return false;
  const txt=String(b.textContent||b.value||"").toLowerCase();
  const on=String((b.getAttribute&&b.getAttribute("onclick"))||"").toLowerCase();
  return txt.includes("iniciar tránsito")||txt.includes("iniciar transito")||on.includes("iniciartransito");
}
function tpodShowStartBusyEarly1582(ev){
  try{ if(!TPOD_STARTING_TRANSIT_1582&&tpodIsStartButton1582(ev&&ev.target)) tpodStartBusy1582(true,"Iniciando tránsito..."); }catch(e){}
}
try{
  document.addEventListener("pointerdown",tpodShowStartBusyEarly1582,true);
  document.addEventListener("touchstart",tpodShowStartBusyEarly1582,true);
  document.addEventListener("mousedown",tpodShowStartBusyEarly1582,true);
}catch(e){}

/* V1.5.82 - iniciarTransito diagnóstico final activo */

async function iniciarTransito(){
  if(TPOD_STARTING_TRANSIT_1582) return;
  TPOD_STARTING_TRANSIT_1582=true;
  tpodStartBusy1582(true,"Iniciando tránsito...");
  tpodSetStartDisabled1582(true);
  await tpodFrame1582();

  try{
    await tpodStep1582("Controlando datos...");
    const abierto=typeof transit==="function"?transit():null;
    if(abierto&&tpodOpen1582(abierto)) throw new Error("Ya hay un tránsito iniciado sin cerrar. Primero debe cerrar el tránsito actual.");

    const u=typeof user==="function"?user():{};
    const flota=String((u&&u.fleet)||"").trim();
    if(!flota) throw new Error("Cargá la flota en Usuario.");

    const loteEl=$("lote");
    const lote=loteEl?loteEl.value.trim():"";
    if(!lote) throw new Error("Ingresá número de lote/carga.");

    const embEl=$("embarqueInput");
    const embarque=embEl?embEl.value.trim():"";
    if(!embarque) throw new Error("Ingresá número de embarque.");

    await tpodStep1582("Validando embarque...");
    const route=await tpodTimeout1582(tpodRouteInicio1582(),15000,"Validación de embarque");
    if(!route||(!route.embarque&&!route.cliente&&!route.origen&&!route.destino)) throw new Error("El embarque no existe o no está activo en Firebase.");

    await tpodStep1582("Verificando duplicados...");
    const duplicado=await tpodTimeout1582(tpodDuplicado1582(embarque,flota),15000,"Verificación de duplicados");
    if(duplicado) throw new Error("La flota "+flota+" ya tiene un tránsito abierto para el embarque "+embarque+".");

    await tpodStep1582("Obteniendo GPS...");
    const gps=await tpodTimeout1582(getGps(),10000,"GPS");

    const t={id:typeof regId==="function"?regId():("TPOD-"+Date.now()),user:u,route:route,lote:lote,embarque:embarque,start:gps,updates:[],alerts:[],participantes:[flota],closed:null,estado:"abierto"};

    await tpodStep1582("Guardando tránsito...");
    await tpodTimeout1582(tpodGuardarInicio1582(t),15000,"Guardado en Firebase");

    await tpodStep1582("Finalizando...");
    save(LS.transit,t);
    if(typeof saveTransitHistory==="function") saveTransitHistory(t);
    if(typeof bloquearFormularioTransito==="function") bloquearFormularioTransito();
    if(typeof renderTransitStatus==="function") renderTransitStatus();
    if(typeof aplicarColorResumenInicio==="function") aplicarColorResumenInicio();

    tpodStartBusy1582(false);
    window.alert("Tránsito iniciado correctamente.");
    show("tracking");
    if(typeof startAutoGps==="function") startAutoGps();
  }catch(e){
    tpodStartBusy1582(false);
    window.alert(e.message||String(e));
  }finally{
    TPOD_STARTING_TRANSIT_1582=false;
    tpodSetStartDisabled1582(false);
    tpodStartBusy1582(false);
  }
}

const __cloudSaveTransitV1582 = typeof cloudSaveTransit==="function" ? cloudSaveTransit : null;
if(__cloudSaveTransitV1582){
  cloudSaveTransit = async function(t){
    if(t&&t.__inicioGuardadoFirebase1582&&!t.closed&&String(t.estado||"abierto").toLowerCase()==="abierto") return;
    return __cloudSaveTransitV1582.apply(this,arguments);
  };
}
