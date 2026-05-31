const $ = id => document.getElementById(id);
let climaAutoLoading=false;
let climaLastUpdate=0;

const LS = {user:"trackpod_user", transit:"trackpod_transit", last:"trackpod_last", pending:"trackpod_pending_whatsapp"};

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
function user(){
  const u=load(LS.user,{fleet:"",driver:"",phones:"",groupLink:"",waMode:"contacts"});
  if(!u.waMode)u.waMode="contacts";
  if(!u.groupLink && String(u.phones||"").includes("chat.whatsapp.com/")){
    u.groupLink=u.phones;
    u.phones="";
    u.waMode="group";
  }
  return u;
}
function transit(){return load(LS.transit,null)}
function escapeHtml(s){return String(s||"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[m]))}

function show(id){
  const views=["inicio","tracking","alertas","clima","usuario","ultimo"];
  const buttons=["btn-inicio","btn-tracking","btn-alertas","btn-clima","btn-usuario","btn-ultimo"];

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
  ["clienteSelect","origenSelect","destinoSelect","lote"].forEach(id=>{
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

  try{
    const gps=await getGps();
    const t={
      id:regId(),
      user:u,
      route:selectedRoute(),
      lote:lote,
      start:gps,
      updates:[],
      alerts:[],
      closed:null
    };

    save(LS.transit,t);
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
    addLeafletLayer(L.polyline(line,{color:"#2563eb",weight:5,opacity:.9,dashArray:"8,8"}));
  }
}

function renderTrackingMap(t){
  const map=initLeafletMap();
  if(!map) return;

  clearLeafletLayers();

  if(!t || !t.route || !t.start){
    map.setView([-34.6037,-58.3816],6);
    return;
  }

  const origin={lat:Number(t.route.origen_lat||t.start.lat),lng:Number(t.route.origen_lng||t.start.lng)};
  const dest={lat:Number(t.route.destino_lat),lng:Number(t.route.destino_lng)};
  const current=t.updates&&t.updates.length?t.updates[t.updates.length-1].gps:t.start;
  const cur={lat:Number(current.lat),lng:Number(current.lng)};
  const alerts=(t.alerts||[]).map(a=>a.gps).filter(Boolean).map(g=>({lat:Number(g.lat),lng:Number(g.lng)})).filter(p=>isFinite(p.lat)&&isFinite(p.lng));

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

  if(bounds.length>=2) map.fitBounds(bounds,{padding:[28,28]});
  else if(bounds.length===1) map.setView(bounds[0],12);

  getRoadRoute(origin,dest).then(routePoints=>{
    if(routePoints && routePoints.length>=2){
      addLeafletLayer(L.polyline(routePoints,{color:"#1d4ed8",weight:5,opacity:.92}));
      try{ map.fitBounds(routePoints,{padding:[28,28]}); }catch(e){}
    }else{
      drawFallbackLine(origin,cur,dest);
    }
  });
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
    // No bloquear el envío esperando GPS nuevo.
    // El Tracking automático ya mantiene la última posición actualizada.
    const updated=transit();
    if(!updated){
      window.alert("No hay tránsito iniciado.");
      return;
    }

    const msg=typeof buildUpdateMsgAsync==="function"
      ? await buildUpdateMsgAsync(updated)
      : buildUpdateMsg(updated);

    save(LS.last,{msg,date:now()});
    sendToPhones(msg);

  }catch(e){
    window.alert("No se pudo enviar la actualización: "+(e.message||e));
  }finally{
    if(btn){
      btn.disabled=false;
      btn.innerText="📤 Enviar actualización";
    }
  }
}

/* ===== ALERTAS ===== */
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
  box.innerHTML=t.alerts.map(a=>`<div class="alertItem">⚠ <b>${escapeHtml(a.type)}</b><br>${fmtDate(a.time)}</div>`).join("\n");
}

/* ===== USUARIO / ÚLTIMO ===== */


function selectedWaMode(){
  const checked=document.querySelector('input[name="waMode"]:checked');
  return checked ? checked.value : "contacts";
}

function onWaModeChange(){
  const mode=selectedWaMode();
  const groupBox=$("waGroupBox");
  const contactsBox=$("waContactsBox");

  if(groupBox) groupBox.style.display=mode==="group" ? "block" : "none";
  if(contactsBox) contactsBox.style.display=mode==="contacts" ? "block" : "none";
}

function normalizeGroupLink(value){
  return String(value||"").trim();
}

function openWhatsappGroup(link,msg){
  save(LS.last,{msg,date:now()});

  const text=encodeURIComponent(msg);

  // Grupo: WhatsApp no permite envío directo por link.
  // Se abre WhatsApp con el texto preparado para seleccionar el grupo manualmente.
  const waShare=`intent://send?text=${text}#Intent;scheme=whatsapp;package=com.whatsapp;end`;

  try{
    window.location.href=waShare;
    setTimeout(()=>{ window.location.href=`https://wa.me/?text=${text}`; },900);
  }catch(e){
    window.location.href=`https://wa.me/?text=${text}`;
  }
}

function testWhatsappTarget(){
  const mode=selectedWaMode();
  const fleet=$("userFleet") ? $("userFleet").value.trim() : "";
  const driver=$("userDriver") ? $("userDriver").value.trim() : "";
  const groupLink=$("waGroupLink") ? $("waGroupLink").value.trim() : "";
  const phonesValue=$("userPhones") ? $("userPhones").value.trim() : "";

  if(mode==="group"){
    save(LS.user,{fleet,driver,phones:phonesValue,groupLink,waMode:"group"});
    window.alert("Modo Grupo configurado. Se abrirá WhatsApp para seleccionar el grupo.");
    openWhatsappGroup(groupLink || "", "Prueba destino WhatsApp - Track POD");
    return;
  }

  const phones=splitPhones(phonesValue);
  if(!phones.length){
    window.alert("Ingresá al menos un teléfono válido.");
    return;
  }

  save(LS.user,{fleet,driver,phones:phonesValue,groupLink,waMode:"contacts"});
  window.alert(`${phones.length} contacto(s) configurado(s). Se abrirá el primero para probar.`);
  sendWhatsappToPhone(phones[0],"Prueba destino WhatsApp - Track POD",1,1);
}


function loadUserForm(){
  const u=user();
  if($("userFleet")) $("userFleet").value=u.fleet||"";
  if($("userDriver")) $("userDriver").value=u.driver||"";
  if($("userPhones")) $("userPhones").value=u.phones||"";
  if($("waGroupLink")) $("waGroupLink").value=u.groupLink||"";

  const mode=u.waMode||"contacts";
  const radio=document.querySelector(`input[name="waMode"][value="${mode}"]`);
  if(radio) radio.checked=true;
  else{
    const contacts=document.querySelector('input[name="waMode"][value="contacts"]');
    if(contacts) contacts.checked=true;
  }
  onWaModeChange();
}

function saveUser(){
  const mode=selectedWaMode();
  save(LS.user,{
    fleet:$("userFleet").value.trim(),
    driver:$("userDriver").value.trim(),
    phones:$("userPhones") ? $("userPhones").value.trim() : "",
    groupLink:$("waGroupLink") ? $("waGroupLink").value.trim() : "",
    waMode:mode
  });

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
  return t.alerts.map(a=>`${a.type} ${fmtDateShort(a.time)}`).join(" | ");
}

function formatAlertsMultiline(t){
  if(!t.alerts||!t.alerts.length)return "Sin alertas";
  return t.alerts.map(a=>`• ${a.type} ${fmtDateShort(a.time)}`).join("\n");
}

function sendToPhones(msg){
  const u=user();
  const mode=u.waMode||"contacts";

  save(LS.last,{msg,date:now()});

  if(mode==="group"){
    openWhatsappGroup(u.groupLink,msg);
    return;
  }

  const phones=splitPhones(u.phones);

  if(!phones.length){
    window.alert("No hay teléfonos registrados en Usuario.");
    show("usuario");
    return;
  }

  if(phones.length===1){
    sendWhatsappToPhone(phones[0],msg,1,1);
    return;
  }

  save(LS.pending,{phones:phones,msg:msg,index:0});
  window.alert(`Se enviará el mensaje a ${phones.length} contactos. Al volver a la APP, continuará con el siguiente contacto.`);
  sendNextPendingWhatsapp();
}

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
  setTimeout(()=>continuarEnviosPendientes(),700);
});

document.addEventListener("visibilitychange",()=>{
  if(!document.hidden){
    setTimeout(()=>continuarEnviosPendientes(),500);
  }
});
