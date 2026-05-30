const $ = id => document.getElementById(id);
const LS = {user:"trackpod_user", transit:"trackpod_transit", last:"trackpod_last"};

function load(k,f){try{return JSON.parse(localStorage.getItem(k)) ?? f}catch(e){return f}}
function save(k,v){localStorage.setItem(k,JSON.stringify(v))}
function fmtDate(v){return new Date(v).toLocaleString("es-AR")}
function now(){return new Date().toISOString()}
function cleanPhone(p){return String(p||"").replace(/[^\d]/g,"")}
function user(){return load(LS.user,{fleet:"",driver:"",phones:""})}
function transit(){return load(LS.transit,null)}
function escapeHtml(s){return String(s||"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[m]))}

function show(id){
  ["inicio","tracking","alertas","usuario","ultimo"].forEach(v=>{
    const e=$(v);
    if(e) e.classList.toggle("hidden",v!==id);
  });

  ["btn-inicio","btn-tracking","btn-alertas","btn-usuario","btn-ultimo"].forEach(b=>{
    const e=$(b);
    if(e) e.classList.remove("active");
  });

  const active=$("btn-"+id);
  if(active) active.classList.add("active");

  if(id==="inicio") renderInicio();
  if(id==="tracking") renderTracking();
  if(id==="alertas") renderAlertas();
  if(id==="usuario") loadUserForm();
  if(id==="ultimo") renderUltimo();
}

function initSelectors(){
  $("clienteSelect").innerHTML=CLIENTES_DATA.map((c,i)=>`<option value="${i}">${escapeHtml(c.cliente)}</option>`).join("");
  $("origenSelect").innerHTML=ORIGENES_DATA.map((o,i)=>`<option value="${i}">${escapeHtml(o.nombre)}</option>`).join("");
  $("destinoSelect").innerHTML=DESTINOS_DATA.map((d,i)=>`<option value="${i}">${escapeHtml(d.nombre)}</option>`).join("");
  onClienteChange();
}

function onClienteChange(){
  const c=CLIENTES_DATA[$("clienteSelect").value];
  if(c && c.destino_sugerido){
    const idx=DESTINOS_DATA.findIndex(d=>d.nombre.trim().toLowerCase()===c.destino_sugerido.trim().toLowerCase());
    if(idx>=0)$("destinoSelect").value=String(idx);
  }
  onOrigenDestinoChange();
}

function selectedRoute(){
  const c=CLIENTES_DATA[$("clienteSelect").value]||{};
  const o=ORIGENES_DATA[$("origenSelect").value]||{};
  const d=DESTINOS_DATA[$("destinoSelect").value]||{};
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

function onOrigenDestinoChange(){
  const r=selectedRoute();
  const km=distanciaRuta(r);
  const box=$("rutaInfo");
  if(box){
    box.innerHTML=
      `<b>Distancia estimada:</b> ${km.toFixed(1)} km<br>`+
      `<b>País destino:</b> ${escapeHtml(r.destino_pais||"")}<br>`+
      `<b>Localidad destino:</b> ${escapeHtml(r.destino||"")}`;
  }
}

function renderInicio(){
  const u=user();
  const inp=$("inicioUser");
  if(inp) inp.value=(u.fleet||"Sin flota")+" - "+(u.driver||"Sin chofer");
  const t=transit();
  if(t && $("lote")) $("lote").value=t.lote||"";
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
  const u=user();
  if(!u.fleet){alert("Cargá la flota en Usuario.");show("usuario");return;}

  const route=selectedRoute();
  const lote=$("lote").value.trim();
  if(!lote){alert("Ingresá número de lote/carga.");return;}

  try{
    const gps=await getGps();
    const t={id:regId(),user:u,route,lote,start:gps,updates:[],alerts:[],closed:null};
    save(LS.transit,t);
    alert("Tránsito iniciado correctamente.");
    show("tracking");
  }catch(e){
    alert("No se pudo tomar GPS de inicio: "+(e.message||e));
  }
}

async function cerrarTransito(){
  const t=transit();
  if(!t){alert("No hay tránsito iniciado.");return;}

  try{
    const gps=await getGps();
    const moved=distKm(t.start.lat,t.start.lng,gps.lat,gps.lng);
    if(moved<0.05){alert("La posición GPS de cierre debe ser distinta a la de inicio.");return;}
    if(!confirm("¿Desea confirmar la entrega y cerrar tránsito?"))return;

    t.closed=gps;
    const msg=buildCierreMsg(t);
    save(LS.last,{msg,date:now()});
    localStorage.removeItem(LS.transit);
    sendToPhones(msg);
    alert("Tránsito cerrado.");
    show("inicio");
  }catch(e){
    alert("No se pudo cerrar tránsito: "+(e.message||e));
  }
}

/* ===== MAPA REAL ===== */
let leafletMap=null;
let leafletLayers=[];

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
`<div class="statItem"><b>${total.toFixed(1)} km</b><span>Total</span></div>
 <div class="statItem"><b>${pct}%</b><span>Avance</span></div>
 <div class="statItem"><b>${faltan.toFixed(1)} km</b><span>Restan</span></div>
 <div class="statItem"><b>${calcEta(faltan)}</b><span>ETA</span></div>`;
  }

  renderTrackingMap(t);
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
  if(!t){alert("No hay tránsito iniciado.");renderTracking();return;}

  try{
    const gps=await getGps();
    if(!t.updates)t.updates=[];
    t.updates.push({gps,time:now()});
    save(LS.transit,t);
    renderTracking();
  }catch(e){
    alert("No se pudo actualizar GPS: "+(e.message||e));
  }
}

async function enviarActualizacion(){
  const t=transit();
  if(!t){alert("No hay tránsito iniciado.");return;}
  await actualizarGps();
  const updated=transit();
  if(!updated) return;
  const msg=buildUpdateMsg(updated);
  save(LS.last,{msg,date:now()});
  sendToPhones(msg);
}

/* ===== ALERTAS ===== */
async function registrarAlerta(){
  const t=transit();
  if(!t){alert("No hay tránsito iniciado.");return;}

  try{
    const gps=await getGps();
    const alert={type:$("alertType").value,detail:"",gps,time:now()};
    t.alerts.push(alert);
    save(LS.transit,t);
    renderAlertas();
    alert("Alerta registrada.");
  }catch(e){
    alert("No se pudo registrar alerta: "+(e.message||e));
  }
}

function renderAlertas(){
  const t=transit();
  const box=$("alertList");
  if(!box) return;
  if(!t||!t.alerts.length){box.innerText="Sin alertas registradas.";return;}
  box.innerHTML=t.alerts.map(a=>`<div class="alertItem"><b>${escapeHtml(a.type)}</b><br>${fmtDate(a.time)}<br>GPS: ${a.gps.lat.toFixed(6)}, ${a.gps.lng.toFixed(6)}</div>`).join("");
}

/* ===== USUARIO / ÚLTIMO ===== */
function loadUserForm(){
  const u=user();
  $("userFleet").value=u.fleet||"";
  $("userDriver").value=u.driver||"";
  $("userPhones").value=u.phones||"";
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
  $("lastBox").innerText=last?last.msg:"No hay envíos registrados.";
}

function reenviarUltimo(){
  const last=load(LS.last,null);
  if(!last){alert("No hay último envío.");return;}
  sendToPhones(last.msg);
}

/* ===== MENSAJES ===== */
function buildUpdateMsg(t){
  const total=distanciaRuta(t.route);
  const current=t.updates.length?t.updates[t.updates.length-1].gps:t.start;
  const done=distKm(t.start.lat,t.start.lng,current.lat,current.lng);
  const faltan=Math.max(0,total-done);
  return `Actualización de tránsito
Registro: ${t.id}
Flota: ${t.user.fleet}
Chofer: ${t.user.driver}
Cliente: ${t.route.cliente}
Número de carga: ${t.lote}
Ubicación actual: ${current.lat.toFixed(6)}, ${current.lng.toFixed(6)}
Destino: ${t.route.destino}
Kilómetros faltantes: ${faltan.toFixed(1)} km
ETA estimada: ${calcEta(faltan)}
Alertas ocurridas: ${formatAlerts(t)}`;
}

function buildCierreMsg(t){
  const total=distanciaRuta(t.route);
  const real=distKm(t.start.lat,t.start.lng,t.closed.lat,t.closed.lng);
  return `Carga entregada, Cierre de tránsito
Registro: ${t.id}
Flota: ${t.user.fleet}
Chofer: ${t.user.driver}
Cliente: ${t.route.cliente}
Número de carga: ${t.lote}
Origen: ${t.route.origen}
Destino: ${t.route.destino}
Fecha y hora de salida: ${fmtDate(t.start.time)}
Fecha y hora de llegada: ${fmtDate(t.closed.time)}
Tiempo de tránsito: ${duration(t.start.time,t.closed.time)}
KM origen/destino: ${total.toFixed(1)} km
KM recorridos GPS: ${real.toFixed(1)} km
GPS llegada: ${t.closed.lat.toFixed(6)}, ${t.closed.lng.toFixed(6)}
Alertas ocurridas: ${formatAlerts(t)}`;
}

function formatAlerts(t){
  if(!t.alerts||!t.alerts.length)return "Sin alertas";
  return t.alerts.map(a=>`${a.type} (${fmtDate(a.time)})`).join(" | ");
}

function sendToPhones(msg){
  const u=user();
  const phones=String(u.phones||"").split(/[,;\n]+/).map(cleanPhone).filter(Boolean);
  if(!phones.length){alert("No hay teléfonos registrados en Usuario.");show("usuario");return;}
  save(LS.last,{msg,date:now()});
  window.location.href=`https://wa.me/${phones[0]}?text=${encodeURIComponent(msg)}`;
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

function calcEta(km){
  const speed=70,mins=Math.round((km/speed)*60);
  return `${Math.floor(mins/60)} h ${mins%60} min`;
}

function duration(a,b){
  const ms=new Date(b)-new Date(a),mins=Math.max(0,Math.round(ms/60000));
  const d=Math.floor(mins/1440),h=Math.floor((mins%1440)/60),m=mins%60;
  return `${d} días, ${h} horas, ${m} minutos`;
}

initSelectors();
show("inicio");
