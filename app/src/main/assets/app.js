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

  if(cliente) cliente.innerHTML=CLIENTES_DATA.map((c,i)=>`<option value="${i}">${escapeHtml(c.cliente)}</option>`).join("");
  if(origen) origen.innerHTML=ORIGENES_DATA.map((o,i)=>`<option value="${i}">${escapeHtml(o.nombre)}</option>`).join("");
  if(destino) destino.innerHTML=DESTINOS_DATA.map((d,i)=>`<option value="${i}">${escapeHtml(d.nombre)}</option>`).join("");

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
      `<b>Distancia estimada:</b> ${km.toFixed(1)} km<br>`+
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
    const msg=buildCierreMsg(t);
    save(LS.last,{msg,date:now()});

    localStorage.removeItem(LS.transit);
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
`<div class="statItem"><b>${shortKm(total)}</b><span>Total</span></div>
 <div class="statItem"><b>${pct}%</b><span>Av.</span></div>
 <div class="statItem"><b>${shortKm(faltan)}</b><span>Restan</span></div>
 <div class="statItem"><b>${shortEta(faltan)}</b><span>ETA</span></div>`;
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
  if(!t){
    window.alert("No hay tránsito iniciado.");
    renderTracking();
    return;
  }

  try{
    const gps=await getGps();
    if(!t.updates)t.updates=[];
    t.updates.push({gps,time:now()});
    save(LS.transit,t);
    renderTracking();
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
  box.innerHTML=t.alerts.map(a=>`<div class="alertItem">⚠ <b>${escapeHtml(a.type)}</b><br>${fmtDate(a.time)}</div>`).join("");
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

  if(!last){
    box.innerText="No hay envíos registrados.";
    return;
  }

  box.innerText=limpiarResumenUltimo(last.msg);
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
function buildUpdateMsg(t){
  const total=distanciaRuta(t.route);
  const current=t.updates.length?t.updates[t.updates.length-1].gps:t.start;
  const done=distKm(t.start.lat,t.start.lng,current.lat,current.lng);
  const faltan=Math.max(0,total-done);

  return `🚚 Actualización de tránsito

🚛 Flota: ${t.user.fleet}
👤 Chofer: ${t.user.driver}

🏢 Cliente: ${t.route.cliente}

📦 Número de carga: ${t.lote}

📍 Ubicación: ${current.lat.toFixed(6)}, ${current.lng.toFixed(6)}

🎯 Destino: ${t.route.destino}

🛣️ Kilómetros faltantes: ${faltan.toFixed(1)} km
⏱️ ETA estimada: ${calcEta(faltan)}

⚠️ Alertas ocurridas:
${formatAlertsMultiline(t)}`;
}

function buildCierreMsg(t){
  const total=distanciaRuta(t.route);
  return `Carga entregada, Cierre de tránsito
Registro: ${t.id}
Flota: ${t.user.fleet}
Chofer: ${t.user.driver}
Cliente: ${t.route.cliente}
Número de carga: ${t.lote}
Origen: ${t.route.origen}
Destino: ${destinoCompacto(t.route)}
Fecha y hora de salida: ${fmtDate(t.start.time)}
Fecha y hora de llegada: ${fmtDate(t.closed.time)}
Tiempo de tránsito: ${duration(t.start.time,t.closed.time)}
KM origen/destino: ${total.toFixed(1)} km
Alertas ocurridas: ${formatAlerts(t)}`;
}

function formatAlerts(t){
  if(!t.alerts||!t.alerts.length)return "Sin alertas";
  return t.alerts.map(a=>`${a.type} (${fmtDate(a.time)})`).join(" | ");
}

function formatAlertsMultiline(t){
  if(!t.alerts||!t.alerts.length)return "Sin alertas";
  return t.alerts.map(a=>`• ${a.type} (${fmtDate(a.time)})`).join("
");
}

function sendToPhones(msg){
  const u=user();
  const phones=String(u.phones||"").split(/[,;\n]+/).map(cleanPhone).filter(Boolean);
  if(!phones.length){
    window.alert("No hay teléfonos registrados en Usuario.");
    show("usuario");
    return;
  }
  save(LS.last,{msg,date:now()});
  window.location.href=`https://wa.me/${phones[0]}?text=${encodeURIComponent(msg)}`;
}





/* ===== CLIMA ===== */
function renderClima(){
  const n=$("weatherNow"), f=$("weatherForecast"), p=$("passStatus"), a=$("passAlerts");
  if(n && !n.dataset.loaded){
    n.innerHTML='<div class="weatherIconBig">🌤️</div><div class="weatherMainNew"><div class="weatherTempNew">--°</div><div class="weatherDescNew">Presioná actualizar</div><div class="weatherLocNew">Ubicación GPS</div></div>';
  }
  if(f && !f.innerHTML.trim()) f.innerHTML='<div class="forecastEmpty">Sin pronóstico actualizado.</div>';
  if(p && !p.dataset.loaded) p.innerHTML='Estado pendiente de actualizar.';
  if(a && !a.dataset.loaded) a.innerHTML='Sin datos actualizados.';
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
  const n=$("weatherNow"), f=$("weatherForecast"), p=$("passStatus"), a=$("passAlerts");
  if(n)n.innerHTML='<div class="weatherIconBig">⏳</div><div class="weatherMainNew"><div class="weatherTempNew">--°</div><div class="weatherDescNew">Consultando clima...</div><div class="weatherLocNew">Tomando GPS</div></div>';
  if(f)f.innerHTML='<div class="forecastEmpty">Consultando pronóstico...</div>';
  if(p)p.innerHTML='Consultando situación actual del paso...';
  if(a)a.innerHTML='Consultando alertas...';

  try{
    const gps=await getGps();
    await cargarClimaGps(gps.lat,gps.lng);
  }catch(e){
    if(n)n.innerHTML='<div class="weatherIconBig">⚠️</div><div class="weatherMainNew"><div class="weatherTempNew">--°</div><div class="weatherDescNew">No se pudo obtener GPS</div><div class="weatherLocNew">'+escapeHtml(e.message||e)+'</div></div>';
  }

  consultarPasoCristoRedentor();
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
    f.innerHTML=rows.join("");
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
