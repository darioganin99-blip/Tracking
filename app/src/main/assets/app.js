
const $ = id => document.getElementById(id);
function safeEl(id){ return document.getElementById(id); }
function safeSetWidth(id,value){ const e=safeEl(id); if(e && e.style){ e.style.width=value; } }
function safeSetText(id,value){ const e=safeEl(id); if(e){ e.innerText=value; } }
function safeShow(id){ const e=safeEl(id); if(e && e.classList){ e.classList.remove("hidden"); } }
function safeHide(id){ const e=safeEl(id); if(e && e.classList){ e.classList && $&; } }
function el(id){ return document.getElementById(id); }
function setText(id, value){ const e=el(id); if(e) e.innerText=value; }
function setHtml(id, value){ const e=el(id); if(e) e.innerHTML=value; }
function setWidth(id, value){ const e=el(id); if(e && e.style) e.style.width=value; }
function showHide(id, hidden){ const e=el(id); if(e) e.classList.toggle("hidden", hidden); }
const LS = {user:"trackpod_user", transit:"trackpod_transit", last:"trackpod_last"};
function load(k,f){try{return JSON.parse(localStorage.getItem(k)) ?? f}catch(e){return f}}
function save(k,v){localStorage.setItem(k,JSON.stringify(v))}
function fmtDate(v){return new Date(v).toLocaleString("es-AR")}
function now(){return new Date().toISOString()}
function cleanPhone(p){return String(p||"").replace(/[^\d]/g,"")}
function user(){return load(LS.user,{fleet:"",driver:"",phones:""})}
function transit(){return load(LS.transit,null)}
function show(id){
  ["inicio","tracking","alertas","usuario","ultimo"].forEach(v=>{
    const e=safeEl(v);
    if(e && e.classList) e.classList.toggle("hidden",v!==id);
  });
  ["btn-inicio","btn-tracking","btn-alertas","btn-usuario","btn-ultimo"].forEach(b=>{
    const e=safeEl(b);
    if(e && e.classList) e.classList.remove("active");
  });
  const active=safeEl("btn-"+id);
  if(active && active.classList) active.classList.add("active");

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
  return {cliente:c.cliente||"",origen:o.nombre||"",origen_lat:o.lat,origen_lng:o.lng,origen_pais:o.pais,destino:d.nombre||"",destino_lat:d.lat,destino_lng:d.lng,destino_pais:d.pais};
}
function onOrigenDestinoChange(){
  const r=selectedRoute(), km=distanciaRuta(r);
  $("rutaInfo").innerHTML=`<b>Cliente:</b> ${escapeHtml(r.cliente)}<br><b>Origen:</b> ${escapeHtml(r.origen)}<br><b>Destino:</b> ${escapeHtml(r.destino)}<br><b>Distancia estimada:</b> ${km.toFixed(1)} km`;
}
function renderInicio(){const u=user();$("inicioUser").value=(u.fleet||"Sin flota")+" - "+(u.driver||"Sin chofer");const t=transit();if(t){$("lote").value=t.lote||"";}}
function getGps(){return new Promise((resolve,reject)=>{if(!navigator.geolocation){reject(new Error("GPS no disponible"));return;}navigator.geolocation.getCurrentPosition(p=>resolve({lat:p.coords.latitude,lng:p.coords.longitude,acc:p.coords.accuracy||0,time:now()}),e=>reject(e),{enableHighAccuracy:true,timeout:20000,maximumAge:0});});}
async function iniciarTransito(){const u=user();if(!u.fleet){alert("Cargá la flota en Usuario.");show("usuario");return;}const route=selectedRoute();const lote=$("lote").value.trim();if(!lote){alert("Ingresá número de lote/carga.");return;}try{const gps=await getGps();const t={id:regId(),user:u,route,lote,start:gps,updates:[],alerts:[],closed:null};save(LS.transit,t);alert("Tránsito iniciado correctamente."); show("tracking");}catch(e){alert("No se pudo tomar GPS de inicio: "+(e.message||e));}}
async function cerrarTransito(){const t=transit();if(!t){alert("No hay tránsito iniciado.");return;}try{const gps=await getGps();const moved=distKm(t.start.lat,t.start.lng,gps.lat,gps.lng);if(moved<0.05){alert("La posición GPS de cierre debe ser distinta a la de inicio.");return;}if(!confirm("¿Desea confirmar la entrega y cerrar tránsito?"))return;t.closed=gps;const msg=buildCierreMsg(t);save(LS.last,{msg,date:now()});localStorage.removeItem(LS.transit);sendToPhones(msg);alert("Tránsito cerrado.");show("inicio");}catch(e){alert("No se pudo cerrar tránsito: "+(e.message||e));}}
function renderTracking(){
  const t=transit();
  if(!t){
    safeSetText("trackingBox","No hay tránsito iniciado.");
    safeSetWidth("routeProgress","0");
    renderTrackingMap(null);
    safeHide("chileBox");
    return;
  }

  const total=distanciaRuta(t.route);
  const current=t.updates && t.updates.length ? t.updates[t.updates.length-1].gps : t.start;
  const done=Math.min(total,distKm(t.start.lat,t.start.lng,current.lat,current.lng));
  const pct=total ? Math.min(100,Math.round(done/total*100)) : 0;
  const faltan=Math.max(0,total-done);

  safeSetWidth("routeProgress",pct+"%");

  safeSetText("trackingBox",
`Distancia total: ${total.toFixed(1)} km
Avance: ${pct}%
KM por recorrer: ${faltan.toFixed(1)} km
ETA: ${calcEta(faltan)}`);

  renderTrackingMap(t);

  const chile=safeEl("chileBox");
  if(chile && chile.classList){
    if(String(t.route.destino_pais||"").toLowerCase().includes("chile")){
      chile.classList.remove("hidden");
      chile.innerHTML="<b>Paso fronterizo Uspallata</b><br>Verificar estado de paso, clima, alertas y demoras antes de continuar.";
    }else{
      chile.classList && $&;
    }
  }
}

function renderTrackingMap(t){
  const box=safeEl("mapMarkers");
  const routeLine=safeEl("mapRouteLine");
  const progressLine=safeEl("mapProgressLine");

  if(!box || !routeLine || !progressLine) return;

  box.innerHTML="";
  routeLine.setAttribute("points","");
  progressLine.setAttribute("points","");

  if(!t || !t.route || !t.start) return;

  const origin = {
    lat: Number(t.route.origen_lat || t.start.lat),
    lng: Number(t.route.origen_lng || t.start.lng)
  };

  const dest = {
    lat: Number(t.route.destino_lat),
    lng: Number(t.route.destino_lng)
  };

  const current = t.updates && t.updates.length ? t.updates[t.updates.length-1].gps : t.start;
  const cur = {lat:Number(current.lat), lng:Number(current.lng)};
  const alerts = (t.alerts || []).map(a=>a.gps).filter(Boolean).map(g=>({lat:Number(g.lat),lng:Number(g.lng)}));

  const pts=[origin,cur,dest,...alerts].filter(p=>p && isFinite(p.lat) && isFinite(p.lng));
  if(pts.length<2) return;

  const lats=pts.map(p=>p.lat);
  const lngs=pts.map(p=>p.lng);

  let minLat=Math.min(...lats), maxLat=Math.max(...lats);
  let minLng=Math.min(...lngs), maxLng=Math.max(...lngs);

  if(Math.abs(maxLat-minLat)<0.01){maxLat+=0.01;minLat-=0.01;}
  if(Math.abs(maxLng-minLng)<0.01){maxLng+=0.01;minLng-=0.01;}

  const pad=10;
  function project(p){
    return {
      x:pad+((p.lng-minLng)/(maxLng-minLng))*(100-pad*2),
      y:pad+((maxLat-p.lat)/(maxLat-minLat))*(100-pad*2)
    };
  }

  const po=project(origin);
  const pc=project(cur);

  let pd=null;
  if(isFinite(dest.lat) && isFinite(dest.lng)) pd=project(dest);

  if(pd){
    routeLine.setAttribute("points",`${po.x},${po.y} ${pd.x},${pd.y}`);
  }
  progressLine.setAttribute("points",`${po.x},${po.y} ${pc.x},${pc.y}`);

  addMapMarker("origin",po.x,po.y,"Origen");
  if(pd) addMapMarker("dest",pd.x,pd.y,"Destino");
  addMapMarker("current",pc.x,pc.y,"Última ubicación");

  alerts.forEach((a,i)=>{
    const pa=project(a);
    addMapMarker("alert",pa.x,pa.y,"Alerta "+(i+1));
  });
}

function addMapMarker(type,x,y,title){
  const box=safeEl("mapMarkers");
  if(!box) return;
  const marker=document.createElement("div");
  marker.className="mapMarker "+type;
  marker.style.left=x+"%";
  marker.style.top=y+"%";
  marker.title=title||"";
  box.appendChild(marker);
}
async function actualizarGps(){
  const t=transit();

  if(!t){
    alert("No hay tránsito iniciado.");
    safeSetText("trackingBox","No hay tránsito iniciado.");
    safeSetWidth("routeProgress","0");
    renderTrackingMap(null);
    return;
  }

  try{
    const gps=await getGps();
    if(!t.updates) t.updates=[];
    t.updates.push({gps,time:now()});
    save(LS.transit,t);
    renderTracking();
  }catch(e){
    alert("No se pudo actualizar GPS: "+(e.message||e));
  }
}
async function enviarActualizacion(){const t=transit();if(!t){alert("No hay tránsito iniciado.");return;}await actualizarGps();const msg=buildUpdateMsg(transit());save(LS.last,{msg,date:now()});sendToPhones(msg);}
async function registrarAlerta(){const t=transit();if(!t){alert("No hay tránsito iniciado.");return;}try{const gps=await getGps();const alert={type:$("alertType").value,detail:$("alertDetail").value.trim(),gps,time:now()};t.alerts.push(alert);save(LS.transit,t);$("alertDetail").value="";renderAlertas();alert("Alerta registrada.");}catch(e){alert("No se pudo registrar alerta: "+(e.message||e));}}
function renderAlertas(){const t=transit(),box=$("alertList");if(!t||!t.alerts.length){box.innerText="Sin alertas registradas.";return;}box.innerHTML=t.alerts.map(a=>`<div class="alertItem"><b>${escapeHtml(a.type)}</b><br>${escapeHtml(a.detail||"Sin detalle")}<br>${fmtDate(a.time)}<br>GPS: ${a.gps.lat.toFixed(6)}, ${a.gps.lng.toFixed(6)}</div>`).join("");}
function loadUserForm(){const u=user();$("userFleet").value=u.fleet||"";$("userDriver").value=u.driver||"";$("userPhones").value=u.phones||"";}
function saveUser(){save(LS.user,{fleet:$("userFleet").value.trim(),driver:$("userDriver").value.trim(),phones:$("userPhones").value.trim()});$("userMsg").innerHTML='<p class="ok">Usuario guardado correctamente.</p>';renderInicio();}
function renderUltimo(){const last=load(LS.last,null);$("lastBox").innerText=last?last.msg:"No hay envíos registrados.";}
function reenviarUltimo(){const last=load(LS.last,null);if(!last){alert("No hay último envío.");return;}sendToPhones(last.msg);}
function buildUpdateMsg(t){const total=distanciaRuta(t.route);const current=t.updates.length?t.updates[t.updates.length-1].gps:t.start;const done=distKm(t.start.lat,t.start.lng,current.lat,current.lng);const faltan=Math.max(0,total-done);return `Actualización de tránsito\nRegistro: ${t.id}\nFlota: ${t.user.fleet}\nChofer: ${t.user.driver}\nCliente: ${t.route.cliente}\nNúmero de carga: ${t.lote}\nUbicación actual: ${current.lat.toFixed(6)}, ${current.lng.toFixed(6)}\nDestino: ${t.route.destino}\nKilómetros faltantes: ${faltan.toFixed(1)} km\nETA estimada: ${calcEta(faltan)}\nAlertas ocurridas: ${formatAlerts(t)}`;}
function buildCierreMsg(t){const total=distanciaRuta(t.route);const real=distKm(t.start.lat,t.start.lng,t.closed.lat,t.closed.lng);return `Carga entregada, Cierre de tránsito\nRegistro: ${t.id}\nFlota: ${t.user.fleet}\nChofer: ${t.user.driver}\nCliente: ${t.route.cliente}\nNúmero de carga: ${t.lote}\nOrigen: ${t.route.origen}\nDestino: ${t.route.destino}\nFecha y hora de salida: ${fmtDate(t.start.time)}\nFecha y hora de llegada: ${fmtDate(t.closed.time)}\nTiempo de tránsito: ${duration(t.start.time,t.closed.time)}\nKM origen/destino: ${total.toFixed(1)} km\nKM recorridos GPS: ${real.toFixed(1)} km\nGPS llegada: ${t.closed.lat.toFixed(6)}, ${t.closed.lng.toFixed(6)}\nAlertas ocurridas: ${formatAlerts(t)}`;}
function formatAlerts(t){if(!t.alerts||!t.alerts.length)return "Sin alertas";return t.alerts.map(a=>`${a.type} (${fmtDate(a.time)}) ${a.detail||""}`).join(" | ");}
function sendToPhones(msg){const u=user();const phones=String(u.phones||"").split(/[,;\n]+/).map(cleanPhone).filter(Boolean);if(!phones.length){alert("No hay teléfonos registrados en Usuario.");show("usuario");return;}save(LS.last,{msg,date:now()});window.location.href=`https://wa.me/${phones[0]}?text=${encodeURIComponent(msg)}`;}
function regId(){const d=new Date();return "TPOD-"+d.getFullYear()+String(d.getMonth()+1).padStart(2,"0")+String(d.getDate()).padStart(2,"0")+"-"+String(d.getHours()).padStart(2,"0")+String(d.getMinutes()).padStart(2,"0")+String(d.getSeconds()).padStart(2,"0")}
function distKm(a,b,c,d){if(a==null||b==null||c==null||d==null)return 0;const R=6371,toRad=x=>x*Math.PI/180;const dLat=toRad(c-a),dLng=toRad(d-b);const s=Math.sin(dLat/2)**2+Math.cos(toRad(a))*Math.cos(toRad(c))*Math.sin(dLng/2)**2;return R*2*Math.atan2(Math.sqrt(s),Math.sqrt(1-s))}
function distanciaRuta(r){return distKm(r.origen_lat,r.origen_lng,r.destino_lat,r.destino_lng)}
function calcEta(km){const speed=70,mins=Math.round((km/speed)*60);return `${Math.floor(mins/60)} h ${mins%60} min`}
function duration(a,b){const ms=new Date(b)-new Date(a),mins=Math.max(0,Math.round(ms/60000));const d=Math.floor(mins/1440),h=Math.floor((mins%1440)/60),m=mins%60;return `${d} días, ${h} horas, ${m} minutos`}
function escapeHtml(s){return String(s||"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[m]))}
initSelectors();show("inicio");
