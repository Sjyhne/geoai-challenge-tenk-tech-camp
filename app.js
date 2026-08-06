
"use strict";
document.addEventListener("DOMContentLoaded", () => {
  const $ = id => document.getElementById(id);
  const $$ = sel => [...document.querySelectorAll(sel)];

  // Fire faste objekttyper er starten. Deltakerne kan legge til noen egne
  // typer i tillegg, slik at WebSAM kan prøve å gjenskape akkurat det de tegnet.
  const CONFIG = {
    building:{label:"Bygg",kind:"polygon",icon:"🏠",defaultColor:"#e65b75",style:{color:"#b62e49",weight:2,fillColor:"#e65b75",fillOpacity:.5}},
    road:{label:"Vei",kind:"line",icon:"🛣️",defaultColor:"#f3b231",style:{color:"#f3b231",weight:7,opacity:.95}},
    forest:{label:"Skog",kind:"polygon",icon:"🌲",defaultColor:"#309252",style:{color:"#176734",weight:2,fillColor:"#309252",fillOpacity:.43}},
    water:{label:"Vann",kind:"polygon",icon:"💧",defaultColor:"#369bd3",style:{color:"#176f9d",weight:2,fillColor:"#369bd3",fillOpacity:.5}}
  };
  const MAX_CUSTOM_TYPES=3;
  const CUSTOM_TYPE_KEY="geoai-v20-custom-types";

  const selectedColors={};
  Object.entries(CONFIG).forEach(([type,cfg])=>selectedColors[type]=cfg.defaultColor);

  function shadeColor(hex,amount=-38){
    const value=hex.replace("#","");
    const number=parseInt(value,16);
    const clamp=n=>Math.max(0,Math.min(255,n));
    const r=clamp((number>>16)+amount);
    const g=clamp(((number>>8)&255)+amount);
    const b=clamp((number&255)+amount);
    return `#${[r,g,b].map(v=>v.toString(16).padStart(2,"0")).join("")}`;
  }

  function styleFor(type,properties={}){
    const cfg=CONFIG[type];
    if(!cfg)return {color:"#6f43d6",weight:3,fillOpacity:.35};
    const color=properties.kartfarge||selectedColors[type]||cfg.defaultColor;
    if(cfg.kind==="line")return {...cfg.style,color};
    return {...cfg.style,color:shadeColor(color),fillColor:color};
  }

  function updateButtonColor(type,color){
    document.querySelectorAll(`.object-btn[data-object-type="${type}"],.mask-type-btn[data-mask-type="${type}"]`)
      .forEach(button=>button.style.setProperty("--object-color",color));
  }

  function escapeHtml(value){
    return String(value).replace(/[&<>"']/g,ch=>({
      "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
    }[ch]));
  }

  function customTypeEntries(){
    return Object.entries(CONFIG).filter(([,cfg])=>cfg.custom);
  }

  function customTypeData(){
    return customTypeEntries().map(([id,cfg])=>({
      id,label:cfg.label,kind:cfg.kind,color:selectedColors[id]||cfg.defaultColor
    }));
  }

  function makeCustomStyle(kind,color){
    if(kind==="line")return {color,weight:7,opacity:.95};
    return {color:shadeColor(color),weight:2,fillColor:color,fillOpacity:.5};
  }

  function normalizeTypeId(label){
    const base=label.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"")
      .replace(/[^a-z0-9]+/g,"_").replace(/^_+|_+$/g,"").slice(0,22)||"egen_type";
    let id=`custom_${base}`,i=2;
    while(CONFIG[id])id=`custom_${base}_${i++}`;
    return id;
  }

  function addTypeConfig({id,label,kind="polygon",color="#8b5cf6",custom=true},persist=true,render=true){
    if(!id||!label||CONFIG[id])return false;
    CONFIG[id]={label,kind,icon:"+",custom,defaultColor:color,style:makeCustomStyle(kind,color)};
    selectedColors[id]=color;
    if(persist)saveCustomTypes();
    if(render){
      renderTypeButtons();
      renderMaskTypeButtons();
      renderMapLegend();
      renderOverlayLegend();
    }
    return true;
  }

  function saveCustomTypes(){
    try{localStorage.setItem(CUSTOM_TYPE_KEY,JSON.stringify(customTypeData()))}catch(_){}
  }

  function restoreCustomTypes(types){
    if(!Array.isArray(types))return;
    types.slice(0,MAX_CUSTOM_TYPES).forEach(item=>{
      const label=String(item?.label||"").trim().slice(0,20);
      const color=/^#[0-9a-f]{6}$/i.test(item?.color||"")?item.color:"#8b5cf6";
      const kind=item?.kind==="line"?"line":"polygon";
      if(!label||Object.values(CONFIG).some(cfg=>cfg.label.toLowerCase()===label.toLowerCase()))return;
      if(customTypeEntries().length>=MAX_CUSTOM_TYPES)return;
      const id=/^custom_[a-z0-9_]{1,40}$/.test(item?.id||"")&&!CONFIG[item.id]?item.id:normalizeTypeId(label);
      addTypeConfig({id,label,kind,color,custom:true},false,false);
    });
  }

  try{restoreCustomTypes(JSON.parse(localStorage.getItem(CUSTOM_TYPE_KEY)||"[]"))}catch(_){}

  const missionState={explore:false,analyse:false,digitize:false,result:false};
  try{Object.assign(missionState,JSON.parse(localStorage.getItem("geoai-v20-progress")||"{}"))}catch(_){}
  function hasSessionCutoutEvidence(){
    try{
      return !!sessionStorage.getItem("geoai-v20-map-image")||
        !!sessionStorage.getItem("geoai-v20-cutout-view");
    }catch(_){
      return false;
    }
  }
  function hasStoredDrawnObjects(){
    try{
      const data=JSON.parse(localStorage.getItem("geoai-v20-map")||"null");
      return Array.isArray(data?.features)&&data.features.some(feature=>{
        const type=feature?.properties?.objekttype;
        return !!type&&(!!CONFIG[type]||data.properties?.customTypes?.some(item=>item?.id===type));
      });
    }catch(_){
      return false;
    }
  }
  function reconcileMissionStateFromStorage(){
    missionState.explore=hasSessionCutoutEvidence();
    missionState.digitize=hasStoredDrawnObjects();
    // WebSAM masks are kept in memory only, so these steps cannot survive reload.
    missionState.analyse=false;
    missionState.result=false;
  }
  // Fremdriften vises bare i fanemenyen: tallet på et fullført steg blir et
  // hakekryss, og linjen under menyen fylles. Stegene fullføres automatisk av
  // det deltakeren faktisk gjør, så det finnes ingen «marker som fullført».
  function updateOverallProgress(){
    const order=["explore","digitize","analyse","result"];
    const done=order.filter(key=>missionState[key]).length;
    $("overallProgressBar").style.width=`${done*25}%`;
    $$("[data-progress-step]").forEach(tab=>{
      const complete=!!missionState[tab.dataset.progressStep];
      tab.classList.toggle("done",complete);
      const marker=tab.querySelector("b[data-step-number]");
      if(marker)marker.textContent=complete?"✓":marker.dataset.stepNumber;
    });
    try{localStorage.setItem("geoai-v20-progress",JSON.stringify(missionState))}catch(_){}
  }


  function download(name, text, type="application/json"){
    const a=document.createElement("a");
    a.href=URL.createObjectURL(new Blob([text],{type}));
    a.download=name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(()=>URL.revokeObjectURL(a.href),1000);
  }

  // Tabs
  $$(".tab-button").forEach(btn => btn.addEventListener("click", () => {
    const target=btn.dataset.tab;
    if(target&&target!=="intro"&&target!=="explore"&&!hasSavedCutout()){
      document.querySelector('.tab-button[data-tab="explore"]')?.click();
      setCutoutMessage("Start med å lagre kartutsnittet før du går videre.","bad");
      window.scrollTo({top:0,behavior:"smooth"});
      return;
    }
    if(target==="analyse"&&!hasDrawnObjects()){
      document.querySelector('.tab-button[data-tab="digitize"]')?.click();
      setStatus("Tegn minst ett objekt i kartet før du bruker KI-en.");
      window.scrollTo({top:0,behavior:"smooth"});
      return;
    }
    $$(".tab-button").forEach(b=>b.classList.toggle("active", b===btn));
    $$(".tab").forEach(t=>t.classList.toggle("active", t.id===target));
    if(target==="explore") setTimeout(()=>exploreMap.invalidateSize(),80);
    if(target==="digitize"){
      // Bruk samme kvadratiske utsnitt som ble sendt til WebSAM. Deltakeren kan
      // zoome inn for presisjon, men ikke panorere/tegne seg ut av maskens område.
      if(!applyDigitizeCutoutBounds(true)){
        let view=selectedMapView;
        if(!view){
          const c=exploreMap.getCenter();
          view={lat:c.lat,lng:c.lng,zoom:exploreMap.getZoom()};
        }
        digitizeMap.setView([view.lat,view.lng],view.zoom,{animate:false});
        setTimeout(()=>{
          digitizeMap.invalidateSize(true);
          digitizeMap.setView([view.lat,view.lng],view.zoom,{animate:false});
        },100);
      }
    }
    if(target==="result"){
      setTimeout(()=>resultMap.invalidateSize(true),100);
      hydrateCutoutFromSession();
      hydrateGeoJSONFromAutosave();
      if(maskLayers.length)processMasks();
    }
  }));
  $("startMission").addEventListener("click",()=>{
    document.querySelector('.tab-button[data-tab="explore"]').click();
  });
  // «Neste»-knappene navigerer videre. Fullføring settes av handlingene selv.
  // Steg 1 lagrer i tillegg kartutsnittet på veien ut, slik at deltakerne har
  // bildet klart når de senere skal inn i WebSAM. Vi lagrer bare på nytt hvis kartet faktisk er flyttet –
  // ellers ville deltakeren fått en ny nedlasting for hver runde fram og tilbake.
  $$(".next-step").forEach(button=>button.addEventListener("click",async()=>{
    if(button.dataset.capture==="cutout"&&needsNewCutout()){
      const label=button.textContent;
      button.disabled=true;
      button.textContent="Lagrer kartutsnittet …";
      let ok=false;
      try{ok=await captureMapCutout()}catch(error){console.error(error)}
      button.disabled=false;
      button.textContent=label;
      // Bli stående i steg 1 ved feil, slik at deltakeren ser meldingen.
      if(!ok)return;
    }
    // KI-steget kan ikke verifiseres automatisk her: WebSAM ligger på et annet
    // domene, og masken lagres i deltakerens nedlastingsmappe. Vi markerer det
    // som gjort når deltakeren går videre, og bekrefter det på ordentlig når
    // maskene faktisk slippes inn i steg 4.
    if(button.dataset.complete){
      missionState[button.dataset.complete]=true;
      updateOverallProgress();
    }
    document.querySelector(`.tab-button[data-tab="${button.dataset.next}"]`)?.click();
    window.scrollTo({top:0,behavior:"smooth"});
  }));
  reconcileMissionStateFromStorage();
  updateOverallProgress();

  // Nullstiller hele oppgaven, slik at neste deltaker starter helt tomt uten at
  // noen må slette nettleserprofilen. Ligger foran Leaflet-sjekken under, slik
  // at knappen også virker når kartbiblioteket ikke lastet.
  const STORAGE_KEYS=[
    "geoai-v20-progress","geoai-v20-map","geoai-v20-map-view","geoai-v20-map-bounds",
    "geoai-v20-map-image","geoai-v20-cutout-view","geoai-v20-log","geoai-selected-map-view",
    CUSTOM_TYPE_KEY
  ];
  function clearStoredState(){
    STORAGE_KEYS.forEach(key=>{
      try{localStorage.removeItem(key)}catch(_){}
      try{sessionStorage.removeItem(key)}catch(_){}
    });
  }
  // Tilbakestill feltene før omlastingen: nettleseren gjenoppretter ellers det
  // deltakeren skrev inn, selv om lagringen er tømt.
  function resetFormFields(){
    $$("input,textarea,select").forEach(field=>{
      if(field.type==="file"){field.value="";return}
      if(field.type==="checkbox"||field.type==="radio"){field.checked=field.defaultChecked;return}
      if(field instanceof HTMLSelectElement){
        const index=[...field.options].findIndex(option=>option.defaultSelected);
        field.selectedIndex=index>=0?index:0;
        return;
      }
      field.value=field.defaultValue;
    });
  }
  $("restartChallenge").addEventListener("click",()=>{
    const ok=confirm(
      "Vil du starte GeoAI Challenge på nytt?\n\n"+
      "Kartet du har tegnet, kartutsnittet, maskene og fremdriften blir slettet.\n"+
      "Filer du allerede har lastet ned beholdes."
    );
    if(!ok)return;
    clearStoredState();
    resetFormFields();
    location.reload();
  });

  if(typeof L==="undefined"){
    $("status").textContent="Leaflet ble ikke lastet. Kontroller internettforbindelsen og last siden på nytt.";
    return;
  }

  const imageryUrl="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
  const imageryOptions={maxZoom:20,crossOrigin:true,attribution:"Tiles © Esri — Esri, Maxar, Earthstar Geographics og bidragsytere"};

  // Bakgrunnskartet må sende CORS-hoder, ellers blir canvasen «tainted» og både
  // kartutsnittet i steg 1 og PDF-kartet i steg 4 feiler.
  function createBaseLayer(){
    return L.tileLayer(imageryUrl,imageryOptions);
  }

  const exploreMap=L.map("exploreMap",{zoomControl:true}).setView([58.1467,7.9956],16);
  $("goPlace").addEventListener("click",()=>{
    const [lat,lon,zoom]=$("placeSelect").value.split(",").map(Number);
    exploreMap.invalidateSize(true);
    exploreMap.flyTo([lat,lon],zoom,{duration:0.7});
  });
  let selectedMapView=null;
  function rememberSelectedMapView(){
    const center=exploreMap.getCenter();
    selectedMapView={lat:center.lat,lng:center.lng,zoom:exploreMap.getZoom()};
    try{sessionStorage.setItem("geoai-selected-map-view",JSON.stringify(selectedMapView))}catch(_){}
  }
  exploreMap.on("moveend zoomend",rememberSelectedMapView);
  try{
    const savedView=JSON.parse(sessionStorage.getItem("geoai-selected-map-view")||"null");
    if(savedView&&Number.isFinite(savedView.lat)&&Number.isFinite(savedView.lng)&&Number.isFinite(savedView.zoom)){
      selectedMapView=savedView;
      exploreMap.setView([savedView.lat,savedView.lng],savedView.zoom,{animate:false});
    }
  }catch(_){}

  function setPlaceSearchStatus(text,tone=""){
    const box=$("placeSearchStatus");
    box.textContent=text;
    box.classList.toggle("bad",tone==="bad");
    box.classList.toggle("ready",tone==="ready");
  }

  function formatAddressResult(item){
    const point=item?.representasjonspunkt;
    if(!point||!Number.isFinite(point.lat)||!Number.isFinite(point.lon))return null;
    const place=[item.postnummer,item.poststed].filter(Boolean).join(" ");
    const kommune=item.kommunenavn?item.kommunenavn[0]+item.kommunenavn.slice(1).toLowerCase():"";
    return {
      label:item.adressetekst||item.adressetekstutenadressetilleggsnavn||item.adressenavn||"Adresse",
      detail:[place,kommune].filter(Boolean).join(" · "),
      lat:point.lat,
      lon:point.lon,
      zoom:18,
      kind:"Adresse"
    };
  }

  function normalizeSearchText(value){
    return String(value||"").toLowerCase().normalize("NFD")
      .replace(/[\u0300-\u036f]/g,"").replace(/\s+/g," ").trim();
  }

  function formatPlaceNameResult(item,query=""){
    const point=item?.representasjonspunkt;
    const lat=point?.nord, lon=point?.øst;
    if(!Number.isFinite(lat)||!Number.isFinite(lon))return null;
    const normalizedQuery=normalizeSearchText(query);
    const names=item.stedsnavn||[];
    const matching=names.find(name=>{
      const text=normalizeSearchText(name.skrivemåte);
      return normalizedQuery&&(text.includes(normalizedQuery)||normalizedQuery.includes(text));
    });
    const preferred=matching||names.find(name=>name.skrivemåtestatus==="godkjent og prioritert");
    const name=preferred?.skrivemåte||item.stedsnavn?.[0]?.skrivemåte||item.skrivemåte||"Sted";
    const kommune=item.kommuner?.[0]?.kommunenavn;
    const fylke=item.fylker?.[0]?.fylkesnavn;
    return {
      label:name,
      detail:[item.navneobjekttype,kommune,fylke].filter(Boolean).join(" · "),
      lat,
      lon,
      zoom:17,
      kind:"Sted"
    };
  }

  async function fetchSearchJson(url){
    const response=await fetch(url,{headers:{Accept:"application/json"}});
    if(!response.ok)throw new Error(`Søk feilet (${response.status})`);
    return response.json();
  }

  async function searchKartverket(query){
    const encoded=encodeURIComponent(query);
    const [addressData,placeData]=await Promise.all([
      fetchSearchJson(`https://ws.geonorge.no/adresser/v1/sok?sok=${encoded}&treffPerSide=5`),
      fetchSearchJson(`https://ws.geonorge.no/stedsnavn/v1/sted?sok=${encoded}&treffPerSide=5`)
    ]);
    const results=[
      ...(addressData.adresser||[]).map(formatAddressResult),
      ...(placeData.navn||[]).map(item=>formatPlaceNameResult(item,query))
    ].filter(Boolean);
    const seen=new Set();
    return results.filter(result=>{
      const key=`${result.label.toLowerCase()}|${result.lat.toFixed(5)}|${result.lon.toFixed(5)}`;
      if(seen.has(key))return false;
      seen.add(key);
      return true;
    }).slice(0,8);
  }

  function moveExploreMapToResult(result){
    exploreMap.invalidateSize(true);
    selectedMapView={lat:result.lat,lng:result.lon,zoom:result.zoom};
    try{sessionStorage.setItem("geoai-selected-map-view",JSON.stringify(selectedMapView))}catch(_){}
    exploreMap.flyTo([result.lat,result.lon],result.zoom,{duration:.7});
    setPlaceSearchStatus(`Viser ${result.label}.`,"ready");
  }

  function renderPlaceSearchResults(results){
    const list=$("placeSearchResults");
    list.innerHTML="";
    list.hidden=!results.length;
    results.forEach(result=>{
      const item=document.createElement("li");
      const button=document.createElement("button");
      button.type="button";
      button.className="search-result-button";
      button.innerHTML=
        `<span><b>${escapeHtml(result.label)}</b><small>${escapeHtml(result.detail||result.kind)}</small></span>`+
        `<em>${escapeHtml(result.kind)}</em>`;
      button.addEventListener("click",()=>moveExploreMapToResult(result));
      item.appendChild(button);
      list.appendChild(item);
    });
  }

  $("placeSearchForm").addEventListener("submit",async event=>{
    event.preventDefault();
    const input=$("placeSearchInput");
    const query=input.value.trim();
    if(query.length<2){
      setPlaceSearchStatus("Skriv minst to tegn.","bad");
      renderPlaceSearchResults([]);
      return;
    }
    const submit=$("placeSearchForm").querySelector("button");
    submit.disabled=true;
    setPlaceSearchStatus("Søker i Kartverket ...");
    renderPlaceSearchResults([]);
    try{
      const results=await searchKartverket(query);
      if(!results.length){
        setPlaceSearchStatus("Fant ingen treff. Prøv et stedsnavn eller en norsk adresse.","bad");
        return;
      }
      renderPlaceSearchResults(results);
      moveExploreMapToResult(results[0]);
      setPlaceSearchStatus(`${results.length} treff. Viser ${results[0].label}.`,"ready");
    }catch(error){
      console.error(error);
      setPlaceSearchStatus("Søket feilet. Kontroller internettforbindelsen og prøv igjen.","bad");
    }finally{
      submit.disabled=false;
    }
  });
  // Viser kartutsnittet i KI-steget og melder fra om lagringen faktisk gikk bra.
  // Kvoten kan bli sprengt av et stort PNG, og da må deltakeren få vite det.
  function setAnalysisPreview(dataUrl,persist=true){
    const img=$("analysisPreviewImg");
    img.src=dataUrl;
    img.parentElement.classList.add("has-image");
    const status=$("cutoutReadyStatus");
    if(!persist){
      status.textContent="✓ Kartbildet er lagret.";
      status.classList.add("ready");
      return true;
    }
    try{
      sessionStorage.setItem("geoai-v20-map-image",dataUrl);
      status.textContent="✓ Kartbildet er lagret.";
      status.classList.add("ready");
      return true;
    }catch(_){
      status.textContent="Kartbildet vises her, men er for stort til å huskes hvis du lukker fanen.";
      status.classList.remove("ready");
      return false;
    }
  }

  // Signatur for kartutsnittet: brukes til å se om deltakeren har flyttet kartet
  // etter forrige lagring. Fire desimaler er ca. 10 meter – nok til å oppdage en
  // reell panorering, men robust nok til at Leaflets avrunding ikke slår ut.
  function viewSignature(){
    const center=exploreMap.getCenter();
    return `${center.lat.toFixed(4)},${center.lng.toFixed(4)},${exploreMap.getZoom()}`;
  }
  let lastCaptureView=null;
  try{lastCaptureView=sessionStorage.getItem("geoai-v20-cutout-view")||null}catch(_){}
  function needsNewCutout(){
    try{
      if(!lastCaptureView)return true;
      return viewSignature()!==lastCaptureView;
    }catch(_){return true}
  }
  function hasSavedCutout(){
    return hasSessionCutoutEvidence();
  }

  // Meldingsfeltet i steg 1 er skjult til det faktisk har noe å si. Ved vellykket
  // lagring går deltakeren rett videre, og kvitteringen vises i KI-steget senere.
  function setCutoutMessage(text,tone){
    const box=$("mapImageStatus");
    if(!text){box.hidden=true;box.textContent="";return}
    box.hidden=false;
    box.textContent=text;
    box.classList.toggle("bad",tone==="bad");
  }

  // Lager det kvadratiske kartutsnittet, viser det i KI-steget og laster det ned.
  // Nedlastingen må bli værende: deltakeren laster PNG-filen opp i WebSAM selv.
  async function captureMapCutout(){
    try{
      exploreMap.invalidateSize(true);
      rememberSelectedMapView();
      if(typeof html2canvas==="undefined")throw new Error("html2canvas mangler");
      const canvas=await html2canvas($("exploreMap"),{
        useCORS:true,
        allowTaint:false,
        backgroundColor:"#ffffff",
        logging:false,
        scale:1
      });
      // Beskjær til et kvadratisk utsnitt fra midten, slik at ortofotoet,
      // WebSAM-masken og resultatbildene alle får samme (kvadratiske) format.
      const size=Math.min(canvas.width,canvas.height);
      const square=document.createElement("canvas");
      square.width=size;square.height=size;
      square.getContext("2d").drawImage(
        canvas,(canvas.width-size)/2,(canvas.height-size)/2,size,size,0,0,size,size);
      const dataUrl=square.toDataURL("image/png");
      const remembered=setAnalysisPreview(dataUrl);
      // Lagre de geografiske grensene til det kvadratiske utsnittet, slik at
      // resultatkartet kan vise nøyaktig samme område som ortofotoet og masken.
      try{
        const el=$("exploreMap");
        const cw=el.clientWidth||el.offsetWidth, ch=el.clientHeight||el.offsetHeight;
        const cs=Math.min(cw,ch), cx0=(cw-cs)/2, cy0=(ch-cs)/2;
        const nw=exploreMap.containerPointToLatLng([cx0,cy0]);
        const se=exploreMap.containerPointToLatLng([cx0+cs,cy0+cs]);
        localStorage.setItem("geoai-v20-map-bounds",JSON.stringify([[nw.lat,nw.lng],[se.lat,se.lng]]));
        applyDigitizeCutoutBounds(false);
      }catch(_){}
      syncCapturedCutoutToResult(dataUrl);
      missionState.explore=true;updateOverallProgress();
      const a=document.createElement("a");
      a.href=dataUrl;
      a.download="kartutsnitt-tenk-tech-camp.png";
      document.body.appendChild(a);a.click();a.remove();
      lastCaptureView=viewSignature();
      try{sessionStorage.setItem("geoai-v20-cutout-view",lastCaptureView)}catch(_){}
      setCutoutMessage(remembered
        ? ""
        : "Kartutsnittet ble lastet ned, men var for stort til å huskes hvis du lukker fanen.");
      return true;
    }catch(error){
      console.error(error);
      setCutoutMessage(
        "Kartbildet kunne ikke lagres automatisk. Bruk Windows Utklippsverktøy som reserve.","bad");
      return false;
    }
  }


  // WebSAM kjører modellen i nettleseren og krever WebGPU. Testen lå tidligere på
  // en egen mellomside; nå kjøres den her, slik at deltakeren kommer til WebSAM med
  // ett klikk og likevel får beskjed før tiden går tapt. Ved feil peker vi rett på
  // reserveverktøyet i stedet for bare å sperre knappen – det gir en vei videre.
  (async()=>{
    const box=$("gpuStatus");
    const unavailable=detail=>{
      console.warn("WebGPU er ikke tilgjengelig:",detail);
      box.hidden=false;
      box.classList.add("bad");
      box.innerHTML="<b>Denne nettleseren finner ikke WebGPU.</b> SAM 2.1 Small trenger vanligvis WebGPU, "+
        "men prøv gjerne WebSAM likevel og velg SlimSAM-77 hvis den er tilgjengelig. "+
        "På Linux: lukk alle Chrome-vinduer og start GeoAI med <code>START-GEOAI-LINUX.sh</code>. "+
        "Virker det fortsatt ikke, bruk reserveverktøyet nederst til høyre.";
      $("fallbackTool").open=true;
    };
    try{
      if(!navigator.gpu)return unavailable("navigator.gpu finnes ikke");
      const adapter=await navigator.gpu.requestAdapter();
      if(!adapter)return unavailable("ingen WebGPU-adapter");
    }catch(error){
      unavailable(error?.message||error);
    }
  })();

  try{
    const savedImage=sessionStorage.getItem("geoai-v20-map-image");
    if(savedImage)setAnalysisPreview(savedImage,false);
  }catch(_){}

  // Digitizing map
  const digitizeMap=L.map("digitizeMap",{doubleClickZoom:false,maxBoundsViscosity:1}).setView([58.1467,7.9956],17);
  // zoomSnap:0 lar resultatkartet treffe ortofotoets kvadratiske utsnitt
  // helt kant-i-kant, i stedet for å runde av til et helt zoomnivå.
  const resultMap=L.map("resultMap",{zoomControl:true,attributionControl:true,zoomSnap:0}).setView([58.1467,7.9956],16);

  // Alle tre kartene deler bakgrunnskart, slik at ortofotoet i steg 1, kartet du
  // tegner i steg 2 og plakaten i steg 4 viser samme slags bilde.
  function applyBaseMap(){
    [exploreMap,digitizeMap,resultMap].forEach(map=>{
      createBaseLayer().addTo(map);
    });
  }
  applyBaseMap();

  const resultFeatureGroup=L.featureGroup().addTo(resultMap);
  let lastResultBounds=null;
  const featureGroup=L.featureGroup().addTo(digitizeMap);
  const sketchGroup=L.featureGroup().addTo(digitizeMap);
  const editGroup=L.featureGroup().addTo(digitizeMap);
  let digitizeCutoutLayer=null;

  function savedCutoutBounds(){
    try{
      const data=JSON.parse(localStorage.getItem("geoai-v20-map-bounds")||"null");
      if(!Array.isArray(data)||data.length!==2)return null;
      const bounds=L.latLngBounds(data[0],data[1]);
      return bounds.isValid()?bounds:null;
    }catch(_){
      return null;
    }
  }

  function applyDigitizeCutoutBounds(fit=false){
    const bounds=savedCutoutBounds();
    if(!bounds)return false;
    digitizeMap.setMaxBounds(bounds);
    if(digitizeCutoutLayer)digitizeMap.removeLayer(digitizeCutoutLayer);
    digitizeCutoutLayer=L.rectangle(bounds,{
      color:"#111827",
      weight:2,
      dashArray:"8 6",
      fill:false,
      interactive:false,
      className:"cutout-boundary"
    }).addTo(digitizeMap);
    if(fit){
      digitizeMap.setMinZoom(0);
      digitizeMap.invalidateSize(true);
      digitizeMap.fitBounds(bounds,{animate:false,padding:[0,0]});
      digitizeMap.setMinZoom(digitizeMap.getZoom());
      setTimeout(()=>{
        digitizeMap.setMinZoom(0);
        digitizeMap.invalidateSize(true);
        digitizeMap.fitBounds(bounds,{animate:false,padding:[0,0]});
        digitizeMap.setMinZoom(digitizeMap.getZoom());
      },100);
    }
    return true;
  }

  function isInsideCutout(latlng){
    const bounds=savedCutoutBounds();
    return !bounds||bounds.contains(latlng);
  }

  function clampToCutout(latlng){
    const bounds=savedCutoutBounds();
    if(!bounds||bounds.contains(latlng))return latlng;
    return L.latLng(
      Math.max(bounds.getSouth(),Math.min(bounds.getNorth(),latlng.lat)),
      Math.max(bounds.getWest(),Math.min(bounds.getEast(),latlng.lng))
    );
  }

  let selectedType=null;
  let sketchPoints=[];
  let selectedLayer=null;
  let editHandles=[];

  // Én tilbakemeldingskanal for hele steg 2: linjen i verktøylinjen over kartet.
  function setStatus(text){$("status").textContent=text}

  function clearSketch(){
    sketchPoints=[]; sketchGroup.clearLayers();
    $("undoPoint").disabled=true;
  }

  function leaveEditMode(){
    editGroup.clearLayers(); editHandles=[];
  }

  function renderTypeButtons(){
    const grid=$("typeButtons");
    if(!grid)return;
    grid.innerHTML="";
    Object.entries(CONFIG).forEach(([type,cfg])=>{
      const button=document.createElement("button");
      button.type="button";
      button.className="object-btn";
      button.dataset.objectType=type;
      button.style.setProperty("--object-color",selectedColors[type]||cfg.defaultColor);
      button.innerHTML=
        `<span class="object-icon"></span><span class="object-name"></span>`+
        `<input class="object-color" data-color-type="${type}" type="color" aria-label="Velg farge" title="Velg farge">`;
      button.querySelector(".object-icon").textContent=cfg.icon||"+";
      button.querySelector(".object-name").textContent=cfg.label;
      button.querySelector(".object-color").value=selectedColors[type]||cfg.defaultColor;
      grid.appendChild(button);
    });
  }

  function renderMaskTypeButtons(){
    const grid=$("maskTypeButtons");
    if(!grid)return;
    grid.innerHTML="";
    Object.entries(CONFIG).forEach(([type,cfg])=>{
      const button=document.createElement("button");
      button.type="button";
      button.className="mask-type-btn";
      button.dataset.maskType=type;
      button.style.setProperty("--object-color",selectedColors[type]||cfg.defaultColor);
      button.innerHTML=`<span class="object-icon"></span><span class="object-name"></span>`;
      button.querySelector(".object-icon").textContent=cfg.icon||"+";
      button.querySelector(".object-name").textContent=cfg.label;
      grid.appendChild(button);
    });
  }

  function updateCustomTypeUi(message="",tone=""){
    const count=customTypeEntries().length;
    $("customTypeCount").textContent=`${count}/${MAX_CUSTOM_TYPES}`;
    $("addCustomType").disabled=count>=MAX_CUSTOM_TYPES;
    const box=$("customTypeStatus");
    box.textContent=message;
    box.classList.toggle("bad",tone==="bad");
  }

  function addCustomTypeFromForm(){
    const name=$("customTypeName").value.trim().replace(/\s+/g," ");
    const color=$("customTypeColor").value;
    if(!name){
      updateCustomTypeUi("Skriv et navn først.","bad");
      return;
    }
    if(customTypeEntries().length>=MAX_CUSTOM_TYPES){
      updateCustomTypeUi("Du kan legge til maks tre egne typer.","bad");
      return;
    }
    if(Object.values(CONFIG).some(cfg=>cfg.label.toLowerCase()===name.toLowerCase())){
      updateCustomTypeUi("Den typen finnes allerede.","bad");
      return;
    }
    const id=normalizeTypeId(name);
    addTypeConfig({id,label:name,kind:"polygon",color,custom:true});
    $("customTypeName").value="";
    updateCustomTypeUi(`${name} er lagt til.`);
    chooseType(id);
    saveAutosave();
  }

  function chooseType(type){
    if(!CONFIG[type])return;
    selectedType=type;
    selectedLayer=null;
    leaveEditMode();
    clearSketch();
    $$(".object-btn").forEach(b=>b.classList.toggle("active",b.dataset.objectType===type));
    $("finishObject").disabled=false;
    $("cancelObject").disabled=false;
    const min=CONFIG[type].kind==="polygon"?3:2;
    setStatus(`${CONFIG[type].label} er valgt. Klikk minst ${min} punkter i kartet, og trykk «Fullfør objekt».`);
    digitizeMap.getContainer().style.cursor="crosshair";
    digitizeMap.getContainer().classList.add("leaflet-crosshair");
    digitizeMap.invalidateSize(true);
  }

  // Important: event delegation means buttons work even if DOM is later changed.
  $("typeButtons").addEventListener("click",event=>{
    if(event.target.matches("input[type=color]")){
      event.stopPropagation();
      return;
    }
    const button=event.target.closest("button[data-object-type]");
    if(!button)return;
    event.preventDefault();
    chooseType(button.dataset.objectType);
  });

  $("typeButtons").addEventListener("input",event=>{
    if(!event.target.matches(".object-color"))return;
    const type=event.target.dataset.colorType;
    if(!CONFIG[type])return;
    const color=event.target.value;
    selectedColors[type]=color;
    if(CONFIG[type].custom)CONFIG[type].defaultColor=color;
    updateButtonColor(type,color);
    featureGroup.eachLayer(layer=>{
      if(layer.feature?.properties?.objekttype!==type)return;
      layer.feature.properties.kartfarge=color;
      if(layer.setStyle)layer.setStyle(styleFor(type,layer.feature.properties));
    });
    if(CONFIG[type].custom)saveCustomTypes();
    if(selectedType===type)redrawSketch();
    renderMapLegend();renderOverlayLegend();saveAutosave();
    setStatus(`${CONFIG[type].label} bruker nå den valgte fargen.`);
  });
  $("addCustomType").addEventListener("click",addCustomTypeFromForm);
  $("customTypeName").addEventListener("keydown",event=>{
    if(event.key==="Enter"){event.preventDefault();addCustomTypeFromForm()}
  });
  renderTypeButtons();
  renderMaskTypeButtons();
  updateCustomTypeUi();

  function redrawSketch(){
    sketchGroup.clearLayers();
    sketchPoints.forEach((p,i)=>{
      L.circleMarker(p,{radius:5,color:"#111827",weight:2,fillColor:"#fff",fillOpacity:1})
        .bindTooltip(String(i+1)).addTo(sketchGroup);
    });
    if(sketchPoints.length>=2){
      const cfg=CONFIG[selectedType];
      if(cfg.kind==="polygon"){
        L.polygon(sketchPoints,{...styleFor(selectedType),fillOpacity:.18,dashArray:"5 5"}).addTo(sketchGroup);
      }else{
        L.polyline(sketchPoints,{...styleFor(selectedType),opacity:.65,dashArray:"5 5"}).addTo(sketchGroup);
      }
    }
  }

  digitizeMap.on("click",event=>{
    if(!selectedType){
      setStatus("Velg en objekttype før du klikker i kartet.");
      return;
    }
    if(!isInsideCutout(event.latlng)){
      setStatus("Punktet ligger utenfor kartutsnittet fra steg 1. Hold tegningen innenfor bildet som ble sendt til KI-en.");
      return;
    }
    sketchPoints.push(event.latlng);
    redrawSketch();
    $("undoPoint").disabled=sketchPoints.length===0;
    setStatus(`${sketchPoints.length} punkt registrert ved ${event.latlng.lat.toFixed(5)}, ${event.latlng.lng.toFixed(5)}.`);
  });

  function layerProperties(layer,type,extra={}){
    layer.feature={type:"Feature",properties:{
      ...extra, objekttype:type, objektnavn:CONFIG[type].label,
      kartfarge:extra.kartfarge||selectedColors[type]||CONFIG[type].defaultColor,
      opprettet:extra.opprettet||new Date().toISOString()
    }};
  }

  function selectLayer(layer){
    if(selectedLayer&&selectedLayer.setStyle){
      const oldType=selectedLayer.feature?.properties?.objekttype;
      if(CONFIG[oldType])selectedLayer.setStyle(styleFor(oldType,selectedLayer.feature?.properties||{}));
      selectedLayer.getElement()?.classList.remove("selected-feature");
    }
    selectedLayer=layer;
    leaveEditMode();
    const type=layer.feature?.properties?.objekttype;
    layer.getElement()?.classList.add("selected-feature");
    setStatus(`${CONFIG[type]?.label||"Objekt"} er valgt. Du kan redigere eller slette det.`);
  }

  function addFeatureLayer(layer,type,properties={}){
    layerProperties(layer,type,properties);
    const savedColor=layer.feature.properties.kartfarge;
    if(savedColor){
      selectedColors[type]=savedColor;
      updateButtonColor(type,savedColor);
      const picker=document.querySelector(`.object-color[data-color-type="${type}"]`);
      if(picker)picker.value=savedColor;
    }
    if(layer.setStyle)layer.setStyle(styleFor(type,layer.feature.properties));
    layer.on("click",event=>{
      L.DomEvent.stopPropagation(event);
      selectLayer(layer);
    });
    layer.bindTooltip(CONFIG[type].label);
    featureGroup.addLayer(layer);
  }

  $("finishObject").addEventListener("click",()=>{
    if(!selectedType)return;
    const cfg=CONFIG[selectedType], min=cfg.kind==="polygon"?3:2;
    if(sketchPoints.length<min){
      setStatus(`Du trenger minst ${min} punkter for ${cfg.label.toLowerCase()}.`);
      return;
    }
    const layer=cfg.kind==="polygon"
      ?L.polygon(sketchPoints,styleFor(selectedType))
      :L.polyline(sketchPoints,styleFor(selectedType));
    addFeatureLayer(layer,selectedType);
    clearSketch();
    setStatus(`${cfg.label} er lagt til. Du kan fortsette med samme type eller velge en ny.`);
    updateStats(); saveAutosave();
  });

  $("undoPoint").addEventListener("click",()=>{
    sketchPoints.pop(); redrawSketch();
    $("undoPoint").disabled=sketchPoints.length===0;
    setStatus(`${sketchPoints.length} punkt gjenstår.`);
  });

  $("cancelObject").addEventListener("click",()=>{
    selectedType=null; clearSketch();
    $$(".object-btn").forEach(b=>b.classList.remove("active"));
    $("finishObject").disabled=true;$("cancelObject").disabled=true;
    digitizeMap.getContainer().style.cursor="";
    digitizeMap.getContainer().classList.remove("leaflet-crosshair");
    setStatus("Tegningen ble avbrutt. Velg en objekttype for å tegne videre.");
  });

  $("deleteSelected").addEventListener("click",()=>{
    if(!selectedLayer){setStatus("Klikk først på et ferdig objekt i kartet.");return}
    featureGroup.removeLayer(selectedLayer);selectedLayer=null;leaveEditMode();
    updateStats();saveAutosave();setStatus("Objektet er slettet.");
  });

  $("editSelected").addEventListener("click",()=>{
    if(!selectedLayer){setStatus("Klikk først på et ferdig objekt i kartet.");return}
    leaveEditMode();
    const latlngs=selectedLayer instanceof L.Polygon
      ?selectedLayer.getLatLngs()[0]
      :selectedLayer.getLatLngs();
    latlngs.forEach((latlng,index)=>{
      const handle=L.marker(latlng,{
        draggable:true,
        icon:L.divIcon({className:"vertex-handle",html:"<div style='width:14px;height:14px;border-radius:50%;background:#fff;border:3px solid #111827'></div>",iconSize:[14,14],iconAnchor:[7,7]})
      }).addTo(editGroup);
      handle.on("drag",()=>{
        const clamped=clampToCutout(handle.getLatLng());
        handle.setLatLng(clamped);
        latlngs[index]=clamped;
        selectedLayer.setLatLngs(selectedLayer instanceof L.Polygon?[latlngs]:latlngs);
      });
      handle.on("dragend",()=>{saveAutosave();updateStats()});
      editHandles.push(handle);
    });
    setStatus("Dra de hvite punktene. Klikk et annet objekt når du er ferdig.");
  });

  $("clearAll").addEventListener("click",()=>{
    if(!featureGroup.getLayers().length)return;
    if(confirm("Vil du slette hele kartet?")){
      featureGroup.clearLayers();selectedLayer=null;leaveEditMode();clearSketch();
      updateStats();saveAutosave();setStatus("Kartet er tømt.");
    }
  });

  // Utledes fra CONFIG, slik at tellingen ikke kan komme i utakt med typelista.
  function counts(){
    const c={};
    Object.keys(CONFIG).forEach(type=>c[type]=0);
    featureGroup.eachLayer(l=>{const t=l.feature?.properties?.objekttype;if(c[t]!==undefined)c[t]++});
    return c;
  }
  function hasDrawnObjects(){
    try{return featureGroup.getLayers().length>0}catch(_){return false}
  }
  // Tegnforklaringen bygges av objektene som faktisk ligger i kartet, med de
  // fargene deltakeren har valgt. Da kan den ikke vise feil farge eller
  // objekttyper som ikke er tegnet.
  function renderMapLegend(){
    const c=counts();
    $("mapLegend").innerHTML=Object.keys(CONFIG).filter(type=>c[type]>0).map(type=>{
      const color=selectedColors[type]||CONFIG[type].defaultColor;
      const swatch=CONFIG[type].kind==="line"
        ?`<i class="line" style="border-color:${color}"></i>`
        :`<i class="box" style="background:${color}88;border-color:${shadeColor(color)}"></i>`;
      return `<span>${swatch}${escapeHtml(CONFIG[type].label)} (${c[type]})</span>`;
    }).join("");
  }

  function updateStats(){
    const c=counts();
    const total=Object.values(c).reduce((a,b)=>a+b,0);
    const typeCount=Object.values(c).filter(n=>n>0).length;
    const customCount=Object.entries(c).filter(([type,n])=>CONFIG[type]?.custom&&n>0).reduce((a,[,n])=>a+n,0);
    const tasks=[
      ["1 objekt",total>=1],
      ["2 objekter",total>=2],
      ["2 typer eller 1 egen type",typeCount>=2||customCount>=1]
    ];
    $("missionProgress").innerHTML=tasks.map(([name,done])=>
      `<div class="task"><span>${name}</span><span class="${done?"done":""}">${done?"✓ Ferdig":"Ikke ferdig"}</span></div>`
    ).join("");
    const completedTasks=tasks.filter(([,done])=>done).length;
    const challengePercent=Math.round(completedTasks/tasks.length*100);
    $("challengeMeterBar").style.width=`${challengePercent}%`;
    $("challengePercent").textContent=`${challengePercent} %`;
    if(total>0&&!missionState.digitize){missionState.digitize=true;updateOverallProgress()}
    if(!total&&missionState.digitize){missionState.digitize=false;updateOverallProgress()}
    renderMapLegend();
  }

  function exportData(){
    const fc=featureGroup.toGeoJSON();
    fc.properties={
      kartnavn:$("mapTitle").value||"Mitt digitale kart",
      eksportert:new Date().toISOString(),
      koordinatsystem:"EPSG:4326",
      customTypes:customTypeData()
    };
    return fc;
  }
  function saveAutosave(){
    try{localStorage.setItem("geoai-v20-map",JSON.stringify(exportData()))}catch(_){}
    invalidateResultGeoJSON();
  }
  // Husk zoomnivået og midtpunktet fra fane 2, slik at resultatkartet kan
  // åpne med nøyaktig samme utsnitt som da deltakeren tegnet kartet.
  function saveDigitizeView(){
    try{
      const c=digitizeMap.getCenter();
      localStorage.setItem("geoai-v20-map-view",JSON.stringify({lat:c.lat,lng:c.lng,zoom:digitizeMap.getZoom()}));
    }catch(_){}
  }
  digitizeMap.on("moveend",saveDigitizeView);
  // Returnerer antall gjenopprettede objekter i stedet for å skrive statusteksten
  // selv – oppstartsmeldingen under ville ellers overskrevet den etter 250 ms.
  function restoreAutosave(){
    try{
      const data=JSON.parse(localStorage.getItem("geoai-v20-map")||"null");
      if(!data?.features?.length)return 0;
      restoreCustomTypes(data.properties?.customTypes);
      renderTypeButtons();renderMaskTypeButtons();updateCustomTypeUi();
      data.features.forEach(feature=>{
        const type=feature.properties?.objekttype;if(!CONFIG[type])return;
        const layer=L.geoJSON(feature,{style:()=>styleFor(type,feature.properties||{})}).getLayers()[0];
        if(layer)addFeatureLayer(layer,type,feature.properties);
      });
      if(data.properties?.kartnavn)$("mapTitle").value=data.properties.kartnavn;
      updateStats();
      return featureGroup.getLayers().length;
    }catch(_){return 0}
  }

  // Oppsummering av det digitaliserte kartet som ren tekst, til nedlastet rapport.
  function objectSummaryText(){
    const c=counts(), total=Object.values(c).reduce((a,b)=>a+b,0);
    if(!total)return "Ingen objekter er digitalisert.";
    const parts=Object.entries(c)
      .filter(([,n])=>n>0)
      .map(([type,n])=>`${n} ${CONFIG[type].label.toLowerCase()}`);
    return `${total} objekter totalt: ${parts.join(", ")}.`;
  }

  function scoreLabel(percent){
    if(percent===null||percent===undefined)return "Ikke beregnet";
    if(percent>=75)return "Svært godt treff";
    if(percent>=50)return "Godt treff";
    if(percent>=25)return "Delvis treff";
    return "Lavt treff";
  }

  function scoreSummaryText(percent,objectCount,maskCount,classCount){
    const scope=resultFilterLabel();
    if(percent===null||percent===undefined){
      if(!objectCount&&!maskCount)return `Det mangler både digitale objekter og KI-masker for ${scope}.`;
      if(!objectCount)return `Det finnes KI-masker, men ingen digitale objekter for ${scope}.`;
      if(!maskCount)return `Det finnes digitale objekter, men ingen KI-masker for ${scope}.`;
      return "Sammenligningen er ikke klar ennå.";
    }
    return `For ${scope} overlapper KI-segmenteringen og kartet ditt med ${percent} %. `+
      `Dette er ${scoreLabel(percent).toLowerCase()} basert på ${objectCount} kartobjekt${objectCount===1?"":"er"}, `+
      `${maskCount} KI-maske${maskCount===1?"":"r"} og ${classCount} klasse${classCount===1?"":"r"}.`;
  }


  const resultParts={geojson:false,cutout:false,mask:false};
  function checkResultReady(){if(resultParts.geojson&&resultParts.cutout&&resultParts.mask){missionState.result=true;updateOverallProgress()}}
  let activeResultType="all";
  let lastResultFeatures=[];
  let lastResultData=null;
  let lastResultSourceLabel="";
  let lastResultUseDrawnView=false;
  function resultStyle(feature){
    const type=feature?.properties?.objekttype;
    return styleFor(type,feature?.properties||{});
  }

  function resultFilterTypes(){
    const types=new Set();
    lastResultFeatures.forEach(feature=>{
      const type=feature.properties?.objekttype;
      if(CONFIG[type])types.add(type);
    });
    maskLayers.forEach(layer=>{if(CONFIG[layer.type])types.add(layer.type)});
    return Object.keys(CONFIG).filter(type=>types.has(type));
  }

  function filteredResultFeatures(){
    if(activeResultType==="all")return lastResultFeatures;
    return lastResultFeatures.filter(feature=>feature.properties?.objekttype===activeResultType);
  }

  function renderResultTypeFilter(){
    const select=$("resultTypeFilter");
    const types=resultFilterTypes();
    const previous=activeResultType;
    if(previous!=="all"&&!types.includes(previous))activeResultType="all";
    select.innerHTML=`<option value="all">Alle typer</option>`+
      types.map(type=>`<option value="${type}">${escapeHtml(CONFIG[type].label)}</option>`).join("");
    select.value=activeResultType;
  }

  function resultFilterLabel(){
    return activeResultType==="all"?"alle typer":(CONFIG[activeResultType]?.label||"valgt type");
  }

  function visibleResultObjectCount(){
    return filteredResultFeatures().length;
  }

  function visibleResultMaskCount(){
    return maskLayers.filter(layer=>activeResultType==="all"||layer.type===activeResultType).length;
  }

  function visibleResultClassCount(){
    const types=new Set();
    filteredResultFeatures().forEach(feature=>{
      const type=feature.properties?.objekttype;
      if(CONFIG[type])types.add(type);
    });
    maskLayers.forEach(layer=>{
      if(CONFIG[layer.type]&&(activeResultType==="all"||layer.type===activeResultType))types.add(layer.type);
    });
    return types.size;
  }

  function updateFinalSummary(){
    const objectCount=visibleResultObjectCount();
    const maskCount=visibleResultMaskCount();
    const classCount=visibleResultClassCount();
    $("summaryObjectCount").textContent=String(objectCount);
    $("summaryMaskCount").textContent=String(maskCount);
    $("summaryClassCount").textContent=String(classCount);
    $("matchScore").textContent=lastOverlapPercent===null?"--":`${lastOverlapPercent} %`;
    $("matchScoreLabel").textContent=scoreLabel(lastOverlapPercent);
    $("finalSummaryText").textContent=scoreSummaryText(lastOverlapPercent,objectCount,maskCount,classCount);
  }

  function updateFinalTitle(){
    const base=$("mapTitle").value.trim()||"Mitt GeoAI-kart";
    const team=$("participantName").value.trim();
    $("finalTitle").textContent=team?`${base} – ${team}`:base;
  }

  function rerenderResultForFilter(){
    if(lastResultFeatures.length){
      renderResultFeatures(lastResultFeatures,lastResultData,lastResultSourceLabel,lastResultUseDrawnView);
    }else{
      renderResultTypeFilter();
      renderOverlayLegend();
    }
    if(maskLayers.length)processMasks();
  }

  // Tegner det digitaliserte kartet i resultatfanen. Brukes både av
  // filopplasting og av den automatiske innhentingen fra fane 2.
  // Åpner resultatkartet på nøyaktig samme kvadratiske område som ortofotoet
  // og masken dekker, slik at alle fire resultatrutene viser samme utsnitt.
  function applyOrthophotoBounds(){
    let b=null;
    try{b=JSON.parse(localStorage.getItem("geoai-v20-map-bounds")||"null")}catch(_){}
    if(!Array.isArray(b)||b.length!==2)return false;
    const bounds=L.latLngBounds(b[0],b[1]);
    resultMap.invalidateSize(true);
    resultMap.fitBounds(bounds,{animate:false,padding:[0,0]});
    setTimeout(()=>{
      resultMap.invalidateSize(true);
      resultMap.fitBounds(bounds,{animate:false,padding:[0,0]});
    },120);
    return true;
  }

  // Reserveløsning: åpner resultatkartet med samme senter og zoom som fane 2
  // hadde da kartet ble tegnet. Returnerer false hvis vi ikke kjenner utsnittet.
  function applyDrawnView(){
    let view=null;
    try{view=JSON.parse(localStorage.getItem("geoai-v20-map-view")||"null")}catch(_){}
    if(!view){try{const c=digitizeMap.getCenter();view={lat:c.lat,lng:c.lng,zoom:digitizeMap.getZoom()}}catch(_){}}
    if(!view)return false;
    resultMap.invalidateSize(true);
    resultMap.setView([view.lat,view.lng],view.zoom,{animate:false});
    setTimeout(()=>{
      resultMap.invalidateSize(true);
      resultMap.setView([view.lat,view.lng],view.zoom,{animate:false});
    },120);
    return true;
  }

  function renderResultFeatures(features,data,sourceLabel,useDrawnView){
    lastResultFeatures=features;
    lastResultData=data||null;
    lastResultSourceLabel=sourceLabel;
    lastResultUseDrawnView=!!useDrawnView;
    renderResultTypeFilter();
    const visibleFeatures=filteredResultFeatures();
    resultFeatureGroup.clearLayers();
    L.geoJSON({type:"FeatureCollection",features:visibleFeatures},{
      style:resultStyle,
      onEachFeature:(feature,layer)=>{
        const type=feature.properties?.objekttype;
        layer.bindTooltip(CONFIG[type]?.label||"Kartobjekt");
        resultFeatureGroup.addLayer(layer);
      }
    });
    // Bruk samme utsnitt som i fane 2 når kartet hentes automatisk. For en
    // manuelt opplastet fil zoomer vi i stedet til å ramme inn objektene.
    const appliedView=useDrawnView&&(applyOrthophotoBounds()||applyDrawnView());
    if(!appliedView&&resultFeatureGroup.getLayers().length){
      lastResultBounds=resultFeatureGroup.getBounds().pad(.15);
      resultMap.invalidateSize(true);
      resultMap.fitBounds(lastResultBounds,{animate:false});
      setTimeout(()=>{
        resultMap.invalidateSize(true);
        resultMap.fitBounds(lastResultBounds,{animate:false});
      },120);
    }
    const c={};
    visibleFeatures.forEach(f=>{const t=f.properties?.objekttype||"annet";c[t]=(c[t]||0)+1});
    const labels=Object.entries(c).map(([t,n])=>`${n} ${CONFIG[t]?.label?.toLowerCase()||t}`).join(" · ");
    $("resultObjectSummary").textContent=labels||(
      activeResultType==="all"?`${features.length} objekter`:`Ingen ${resultFilterLabel().toLowerCase()} tegnet`
    );
    $("resultMapStatus").textContent=`${features.length} objekter ${sourceLabel}. Viser ${resultFilterLabel().toLowerCase()}.`;
    resultParts.geojson=true;checkResultReady();
    if(data?.properties?.kartnavn){
      $("mapTitle").value=data.properties.kartnavn;
      updateFinalTitle();
    }
    renderComparison();
  }

  // Henter det digitaliserte kartet (vann, bygg …) automatisk fra
  // autolagringen i fane 2, slik at deltakeren slipper å laste opp GeoJSON.
  function hydrateGeoJSONFromAutosave(){
    if(resultParts.geojson)return false;
    let data=null;
    try{data=JSON.parse(localStorage.getItem("geoai-v20-map")||"null")}catch(_){}
    if(!data?.features?.length)return false;
    renderResultFeatures(data.features,data,"hentet automatisk fra steg 2",true);
    return true;
  }

  $("resultGeoJSON").addEventListener("change",async event=>{
    const file=event.target.files?.[0];if(!file)return;
    try{
      const data=JSON.parse(await file.text());
      restoreCustomTypes(data.properties?.customTypes);
      renderTypeButtons();renderMaskTypeButtons();updateCustomTypeUi();
      const features=data.type==="FeatureCollection"?data.features:[data];
      renderResultFeatures(features,data,`lastet inn fra ${file.name}`,false);
    }catch(error){
      console.error(error);$("resultMapStatus").textContent="GeoJSON-filen kunne ikke leses.";
    }
    event.target.value="";
  });
  $("resultTypeFilter").addEventListener("change",event=>{
    activeResultType=event.target.value||"all";
    rerenderResultForFilter();
  });

  let cutoutDataUrl="";
  let processedMaskDataUrl="";

  function markResultIncomplete(){
    if(!missionState.result)return;
    missionState.result=false;
    updateOverallProgress();
  }

  function invalidateResultGeoJSON(){
    resultParts.geojson=false;
    markResultIncomplete();
  }

  function syncCapturedCutoutToResult(dataUrl){
    cutoutDataUrl=dataUrl;
    resultParts.cutout=true;
    resultParts.geojson=false;
    markResultIncomplete();

    const img=$("cutoutPreview");
    if(img){
      img.src=cutoutDataUrl;
      img.parentElement.classList.add("has-image");
    }
    $("cutoutStatus").textContent="Kartutsnittet fra steg 1 ble oppdatert.";

    const hadMasks=maskLayers.length>0;
    if(hadMasks){
      maskLayers.length=0;
      maskAlphaByType={};
    }
    processMasks();
    if(hadMasks){
      $("maskStatus").textContent="Kartutsnittet ble endret. Last inn nye masker fra WebSAM.";
    }
  }

  function readImageFile(file){
    return new Promise((resolve,reject)=>{
      const reader=new FileReader();
      reader.onerror=()=>reject(new Error("Filen kunne ikke leses."));
      reader.onload=()=>resolve(reader.result);
      reader.readAsDataURL(file);
    });
  }

  function loadImage(dataUrl){
    return new Promise((resolve,reject)=>{
      const image=new Image();
      image.onload=()=>resolve(image);
      image.onerror=()=>reject(new Error("Bildet kunne ikke åpnes."));
      image.src=dataUrl;
    });
  }

  function chooseMaskMode(data){
    let transparent=0,dark=0,light=0,visible=0;
    const step=Math.max(4,Math.floor(data.length/200000/4)*4);
    for(let i=0;i<data.length;i+=step){
      const r=data[i],g=data[i+1],b=data[i+2],a=data[i+3];
      if(a<80){transparent++;continue}
      visible++;
      const lum=.2126*r+.7152*g+.0722*b;
      if(lum<105)dark++;
      if(lum>150)light++;
    }
    if(transparent>Math.max(20,visible*.08))return {kind:"alpha",foreground:"visible"};
    return {kind:"luminance",foreground:dark<light?"dark":"light"};
  }

  // Hver maske knyttes til en av de fire objekttypene fra steg 2. Da kan KI-ens
  // maske sammenlignes med deltakerens egne objekter av samme type, og masken
  // arver fargen deltakeren allerede bruker på kartet.
  const maskLayers=[];
  if(missionState.analyse||missionState.result){
    missionState.analyse=false;
    missionState.result=false;
    updateOverallProgress();
  }
  function hexToRgb(hex){
    const v=parseInt(hex.replace("#",""),16);
    return [(v>>16)&255,(v>>8)&255,v&255];
  }
  function maskColor(type){
    return selectedColors[type]||CONFIG[type]?.defaultColor||"#39a9dc";
  }

  // Henter ortofotoet automatisk fra kartutsnittet som ble laget i fane 1,
  // slik at deltakeren slipper å laste det opp på nytt i resultatfanen.
  function hydrateCutoutFromSession(){
    if(cutoutDataUrl)return false;
    let saved="";
    try{saved=sessionStorage.getItem("geoai-v20-map-image")||""}catch(_){}
    if(!saved)return false;
    cutoutDataUrl=saved;
    const img=$("cutoutPreview");
    img.src=cutoutDataUrl;
    img.parentElement.classList.add("has-image");
    $("cutoutStatus").textContent="Kartutsnittet fra steg 1 ble hentet automatisk.";
    resultParts.cutout=true;
    checkResultReady();
    return true;
  }

  // Gjør om én maske (skalert til referansestørrelsen W×H) til et sett
  // forgrunnspiksler (255) og bakgrunn (0).
  async function maskToForeground(dataUrl,W,H){
    const image=await loadImage(dataUrl);
    const canvas=document.createElement("canvas");
    canvas.width=W;canvas.height=H;
    const ctx=canvas.getContext("2d",{willReadFrequently:true});
    ctx.drawImage(image,0,0,W,H);
    const pixels=ctx.getImageData(0,0,W,H);
    const mode=chooseMaskMode(pixels.data);
    const alpha=new Uint8ClampedArray(W*H);
    let count=0;
    for(let i=0,p=0;i<pixels.data.length;i+=4,p++){
      const r=pixels.data[i],g=pixels.data[i+1],b=pixels.data[i+2],a=pixels.data[i+3];
      const lum=.2126*r+.7152*g+.0722*b;
      let foreground;
      if(mode.kind==="alpha")foreground=a>=80;
      else foreground=mode.foreground==="dark"?lum<128:lum>=128;
      if(foreground){alpha[p]=255;count++}
    }
    return {alpha,count};
  }

  // Objekttypen er navnet deltakeren ser. Filnavnet staar smaatt ved siden av,
  // slik at det fortsatt gaar an aa se hvilken fil som ble lastet inn.
  function renderMaskLayerList(){
    const list=$("maskLayerList");
    list.innerHTML="";
    maskLayers.forEach((layer,index)=>{
      const li=document.createElement("li");
      li.innerHTML=`<span class="mask-swatch" style="background:${maskColor(layer.type)}"></span>`+
        `<span class="mask-layer-name">${escapeHtml(CONFIG[layer.type]?.label||"Maske")}</span>`+
        `<span class="mask-layer-file">${escapeHtml(layer.file)}</span>`+
        `<button type="button" class="mask-remove" data-index="${index}" aria-label="Fjern masken">✕</button>`;
      list.appendChild(li);
    });
  }

  // Typene som faktisk har en maske, i den rekkefolgen CONFIG definerer dem.
  function maskTypesPresent(){
    const types=Object.keys(CONFIG).filter(type=>maskLayers.some(l=>l.type===type));
    return activeResultType==="all"?types:types.filter(type=>type===activeResultType);
  }

  function renderOverlayLegend(){
    const legend=$("overlayLegend");
    const types=maskTypesPresent();
    if(!types.length){
      legend.textContent=activeResultType==="all"
        ?"Hver maske får fargen til objekttypen sin."
        :`Ingen KI-maske for ${resultFilterLabel().toLowerCase()}.`;
      return;
    }
    legend.innerHTML=types.map(type=>
      `<span class="legend-item"><i style="background:${maskColor(type)}"></i>${escapeHtml(CONFIG[type].label)}</span>`
    ).join("");
  }

  // Kombinerer alle innlagte masker til én sort/hvit maske og ett fargelagt
  // overlegg der hver maske har sin egen farge.
  async function processMasks(){
    hydrateCutoutFromSession();
    renderMaskLayerList();
    renderResultTypeFilter();
    renderOverlayLegend();

    const hasMasks=maskLayers.length>0;
    $("clearMasks").disabled=!hasMasks;
    $("downloadProcessedMask").disabled=!hasMasks;
    resultParts.mask=hasMasks;
    // Den eneste ekte kontrollen av KI-steget: masken finnes faktisk.
    if(hasMasks&&!missionState.analyse){missionState.analyse=true;updateOverallProgress()}

    if(!hasMasks){
      if(missionState.analyse){
        missionState.analyse=false;
        updateOverallProgress();
      }
      markResultIncomplete();
      processedMaskDataUrl="";
      unionAlpha=null;
      $("maskPreview").removeAttribute("src");
      $("maskPreview").parentElement.classList.remove("has-image");
      $("overlayPreview").removeAttribute("src");
      $("overlayPreview").parentElement.classList.remove("has-image");
      $("maskStatus").textContent="Ingen masker lastet opp ennå.";
      renderComparison();
      checkResultReady();
      return;
    }

    try{
      // Referansestørrelse: bruk ortofotoet hvis vi har det, ellers første maske.
      let W,H;
      if(cutoutDataUrl){
        const cutout=await loadImage(cutoutDataUrl);
        W=cutout.naturalWidth||cutout.width;H=cutout.naturalHeight||cutout.height;
      }else{
        const first=await loadImage(maskLayers[0].dataUrl);
        W=first.naturalWidth||first.width;H=first.naturalHeight||first.height;
      }
      const cap=1600;
      if(W>cap||H>cap){const s=cap/Math.max(W,H);W=Math.round(W*s);H=Math.round(H*s)}

      // Regn ut forgrunn for hver maske, og slaa sammen maskene som hoerer til
      // samme objekttype. Da kan hver type sammenlignes for seg etterpaa.
      const layerAlphas=[];
      const byType={};
      for(const layer of maskLayers){
        const alpha=(await maskToForeground(layer.dataUrl,W,H)).alpha;
        layerAlphas.push(alpha);
        if(!byType[layer.type])byType[layer.type]=new Uint8ClampedArray(W*H);
        const target=byType[layer.type];
        for(let p=0;p<W*H;p++)if(alpha[p])target[p]=255;
      }
      maskAlphaByType=byType;
      renderResultTypeFilter();
      const visibleLayerIndexes=maskLayers.map((layer,index)=>({layer,index}))
        .filter(({layer})=>activeResultType==="all"||layer.type===activeResultType)
        .map(({index})=>index);

      // Sort/hvit union av alle maskene.
      const binary=document.createElement("canvas");
      binary.width=W;binary.height=H;
      const binaryCtx=binary.getContext("2d");
      const output=binaryCtx.createImageData(W,H);
      const union=new Uint8ClampedArray(W*H);
      let unionCount=0;
      for(let p=0,i=0;p<W*H;p++,i+=4){
        let on=false;
        for(const index of visibleLayerIndexes){if(layerAlphas[index][p]){on=true;break}}
        if(on){unionCount++;union[p]=255}
        const v=on?255:0;
        output.data[i]=v;output.data[i+1]=v;output.data[i+2]=v;output.data[i+3]=255;
      }
      if(!unionCount){
        if(activeResultType==="all")resultParts.mask=false;
        if(activeResultType==="all"&&missionState.analyse){
          missionState.analyse=false;
          updateOverallProgress();
        }
        if(activeResultType==="all")markResultIncomplete();
        processedMaskDataUrl="";
        unionAlpha=null;unionW=0;unionH=0;
        if(activeResultType==="all")maskAlphaByType={};
        $("downloadProcessedMask").disabled=true;
        $("maskPreview").removeAttribute("src");
        $("maskPreview").parentElement.classList.remove("has-image");
        $("overlayPreview").removeAttribute("src");
        $("overlayPreview").parentElement.classList.remove("has-image");
        $("maskStatus").textContent=activeResultType==="all"
          ?"Maskene ser tomme ut. Kontroller at PNG-fila inneholder et valgt område fra WebSAM."
          :`Ingen KI-maske for ${resultFilterLabel().toLowerCase()}.`;
        renderComparison();
        return;
      }
      // Ta vare på unionen slik at sammenligningsruta kan bruke den.
      unionAlpha=union;unionW=W;unionH=H;
      binaryCtx.putImageData(output,0,0);
      processedMaskDataUrl=binary.toDataURL("image/png");
      const maskPreview=$("maskPreview");
      maskPreview.src=processedMaskDataUrl;
      maskPreview.parentElement.classList.add("has-image");

      // Fargelagt overlegg over ortofotoet, én farge per maske.
      const overlay=document.createElement("canvas");
      overlay.width=W;overlay.height=H;
      const overlayCtx=overlay.getContext("2d");
      if(cutoutDataUrl){
        const cutout=await loadImage(cutoutDataUrl);
        overlayCtx.drawImage(cutout,0,0,W,H);
      }else{
        overlayCtx.fillStyle="#f2f2f4";
        overlayCtx.fillRect(0,0,W,H);
      }
      const overlayPixels=overlayCtx.getImageData(0,0,W,H);
      const opacity=.6;
      for(let p=0,i=0;p<W*H;p++,i+=4){
        // Den øverste masken som dekker pikselet bestemmer fargen.
        let color=null;
        for(let v=visibleLayerIndexes.length-1;v>=0;v--){
          const l=visibleLayerIndexes[v];
          if(layerAlphas[l][p]){color=hexToRgb(maskColor(maskLayers[l].type));break}
        }
        if(!color)continue;
        overlayPixels.data[i]=Math.round(overlayPixels.data[i]*(1-opacity)+color[0]*opacity);
        overlayPixels.data[i+1]=Math.round(overlayPixels.data[i+1]*(1-opacity)+color[1]*opacity);
        overlayPixels.data[i+2]=Math.round(overlayPixels.data[i+2]*(1-opacity)+color[2]*opacity);
      }
      overlayCtx.putImageData(overlayPixels,0,0);
      const overlayPreview=$("overlayPreview");
      overlayPreview.src=overlay.toDataURL("image/png");
      overlayPreview.parentElement.classList.add("has-image");

      const share=Math.round(unionCount/(W*H)*100);
      const count=maskLayers.length;
      $("maskStatus").textContent=`${count} ${count===1?"maske":"masker"} slått sammen. Viser ${resultFilterLabel().toLowerCase()}; KI-området dekker omtrent ${share} % av bildet.`;
      await renderComparison();
      checkResultReady();
    }catch(error){
      console.error(error);
      $("maskStatus").textContent="Maskene kunne ikke behandles. Prøv PNG-filer direkte fra WebSAM.";
    }
  }

  // ---- Sammenligning: KI-en mot deltakerens eget kart ----
  // KI-masken er piksler i kartutsnittets rutenett, mens objektene deltakeren
  // tegnet er lat/lon. Vi projiserer objektene inn i det samme rutenettet med
  // Web Mercator – altså nøyaktig samme projeksjon som kartet bruker – slik at
  // de to kan sammenlignes piksel for piksel.
  let unionAlpha=null,unionW=0,unionH=0,lastOverlapPercent=null;
  let maskAlphaByType={},lastTypeScores=[];
  const COMPARE_COLORS={
    both:[46,156,91],   // grønn: KI-en og deltakeren er enige
    ai:[236,91,145],    // rosa: bare KI-en tok med området
    user:[57,169,220]   // blå: bare deltakeren tegnet området
  };

  function cutoutBounds(){
    try{
      const bounds=JSON.parse(localStorage.getItem("geoai-v20-map-bounds")||"null");
      if(Array.isArray(bounds)&&bounds.length===2)return bounds;
    }catch(_){}
    return null;
  }

  // Tegner deltakerens objekter inn i kartutsnittets pikselrutenett.
  function rasterizeDrawnFeatures(features,W,H,bounds){
    const nw=L.CRS.EPSG3857.project(L.latLng(bounds[0]));
    const se=L.CRS.EPSG3857.project(L.latLng(bounds[1]));
    const spanX=se.x-nw.x,spanY=se.y-nw.y;
    if(!spanX||!spanY)return null;
    // GeoJSON-koordinater er [lengdegrad, breddegrad].
    const toPoint=coord=>{
      const p=L.CRS.EPSG3857.project(L.latLng(coord[1],coord[0]));
      return [(p.x-nw.x)/spanX*W,(p.y-nw.y)/spanY*H];
    };
    const canvas=document.createElement("canvas");
    canvas.width=W;canvas.height=H;
    const ctx=canvas.getContext("2d",{willReadFrequently:true});
    ctx.fillStyle="#fff";ctx.strokeStyle="#fff";
    ctx.lineJoin="round";ctx.lineCap="round";
    // Veier og bekker er linjer uten bredde. De får en synlig bredde her, ellers
    // ville de aldri kunne overlappe et flateområde fra KI-en.
    ctx.lineWidth=Math.max(3,Math.round(Math.min(W,H)/110));
    const drawPath=(ring,close)=>{
      if(!ring?.length)return;
      ctx.beginPath();
      ring.forEach((coord,index)=>{
        const [x,y]=toPoint(coord);
        if(index)ctx.lineTo(x,y);else ctx.moveTo(x,y);
      });
      if(close){ctx.closePath();ctx.fill()}else{ctx.stroke()}
    };
    features.forEach(feature=>{
      const geometry=feature.geometry;
      if(!geometry)return;
      if(geometry.type==="Polygon")geometry.coordinates.forEach(ring=>drawPath(ring,true));
      else if(geometry.type==="MultiPolygon")geometry.coordinates.forEach(poly=>poly.forEach(ring=>drawPath(ring,true)));
      else if(geometry.type==="LineString")drawPath(geometry.coordinates,false);
      else if(geometry.type==="MultiLineString")geometry.coordinates.forEach(line=>drawPath(line,false));
    });
    const data=ctx.getImageData(0,0,W,H).data;
    const alpha=new Uint8ClampedArray(W*H);
    for(let p=0,i=3;p<W*H;p++,i+=4)if(data[i]>40)alpha[p]=255;
    return alpha;
  }

  // Sammenligner KI-masken og deltakerens objekter én objekttype om gangen, slik
  // at det gaar an aa se at KI-en for eksempel traff vann bedre enn bygg.
  function renderTypeScores(features,W,H,bounds){
    const box=$("compareStats");
    lastTypeScores=[];
    const rows=[];
    const typeOrder=activeResultType==="all"?Object.keys(CONFIG):[activeResultType];
    for(const type of typeOrder){
      if(!CONFIG[type])continue;
      const aiAlpha=maskAlphaByType[type];
      if(!aiAlpha)continue;                       // ingen maske for denne typen
      const own=features.filter(f=>f.properties?.objekttype===type);
      const label=CONFIG[type].label;
      const safeLabel=escapeHtml(label);
      const color=maskColor(type);
      if(!own.length){
        rows.push(`<div class="stat-row"><span class="stat-label"><i style="background:${color}"></i>${safeLabel}</span>`+
          `<span class="stat-missing">Du tegnet ingen ${escapeHtml(label.toLowerCase())}</span></div>`);
        continue;
      }
      const userAlpha=rasterizeDrawnFeatures(own,W,H,bounds);
      if(!userAlpha)continue;
      let both=0,covered=0;
      for(let p=0;p<W*H;p++){
        const a=!!aiAlpha[p],u=!!userAlpha[p];
        if(a&&u)both++;
        if(a||u)covered++;
      }
      const percent=covered?Math.round(both/covered*100):0;
      lastTypeScores.push({label,percent});
      rows.push(`<div class="stat-row"><span class="stat-label"><i style="background:${color}"></i>${safeLabel}</span>`+
        `<span class="stat-bar"><i style="width:${percent}%;background:${color}"></i></span>`+
        `<strong>${percent} %</strong></div>`);
    }
    box.innerHTML=rows.join("");
  }

  async function renderComparison(){
    const preview=$("comparePreview"),image=$("compareImg"),note=$("compareNote");
    const features=resultFeatureGroup.toGeoJSON().features;
    const bounds=cutoutBounds();

    const missing=[];
    if(!unionAlpha)missing.push("en KI-maske fra WebSAM");
    if(!features.length)missing.push("objekter tegnet i steg 2");
    if(!bounds)missing.push("et lagret kartutsnitt fra steg 1");
    if(missing.length){
      lastOverlapPercent=null;lastTypeScores=[];
      $("compareStats").innerHTML="";
      image.removeAttribute("src");
      preview.classList.remove("has-image");
      note.textContent=`Mangler ${missing.join(" og ")}.`;
      updateFinalSummary();
      return;
    }

    try{
      const W=unionW,H=unionH;
      const userAlpha=rasterizeDrawnFeatures(features,W,H,bounds);
      if(!userAlpha){note.textContent="Kartutsnittet mangler geografiske grenser.";return}

      const canvas=document.createElement("canvas");
      canvas.width=W;canvas.height=H;
      const ctx=canvas.getContext("2d",{willReadFrequently:true});
      if(cutoutDataUrl){
        const cutout=await loadImage(cutoutDataUrl);
        ctx.drawImage(cutout,0,0,W,H);
      }else{
        ctx.fillStyle="#eef1f4";ctx.fillRect(0,0,W,H);
      }
      const pixels=ctx.getImageData(0,0,W,H);
      const data=pixels.data;
      const opacity=.62;
      let both=0,aiOnly=0,userOnly=0;
      for(let p=0,i=0;p<W*H;p++,i+=4){
        const ai=!!unionAlpha[p],user=!!userAlpha[p];
        let color=null;
        if(ai&&user){color=COMPARE_COLORS.both;both++}
        else if(ai){color=COMPARE_COLORS.ai;aiOnly++}
        else if(user){color=COMPARE_COLORS.user;userOnly++}
        if(!color){
          // Gråtone bakgrunnen litt, slik at de tre fargene leses tydelig.
          const grey=data[i]*.3+data[i+1]*.59+data[i+2]*.11;
          data[i]=Math.round(data[i]*.45+grey*.55);
          data[i+1]=Math.round(data[i+1]*.45+grey*.55);
          data[i+2]=Math.round(data[i+2]*.45+grey*.55);
          continue;
        }
        data[i]=Math.round(data[i]*(1-opacity)+color[0]*opacity);
        data[i+1]=Math.round(data[i+1]*(1-opacity)+color[1]*opacity);
        data[i+2]=Math.round(data[i+2]*(1-opacity)+color[2]*opacity);
      }
      ctx.putImageData(pixels,0,0);
      image.src=canvas.toDataURL("image/png");
      preview.classList.add("has-image");

      const covered=both+aiOnly+userOnly;
      lastOverlapPercent=covered?Math.round(both/covered*100):0;
      note.innerHTML=`KI-en og kartet ditt er enige om <b>${lastOverlapPercent} %</b> av området de til sammen dekker. `+
        "Bare det som ligger innenfor kartutsnittet fra steg 1 blir sammenlignet.";

      renderTypeScores(features,W,H,bounds);
      updateFinalSummary();
    }catch(error){
      console.error(error);
      lastOverlapPercent=null;
      note.textContent="Sammenligningen kunne ikke lages.";
      updateFinalSummary();
    }
  }

  // Leser inn nye maskefiler (fra filvelger eller drag-and-drop) og
  // slår dem sammen med de som allerede ligger inne.
  // Deltakeren trykker foerst paa objekttypen, saa velges fila. Da vet vi hva
  // masken forestiller uten aa maatte gjette ut fra filnavnet.
  let pendingMaskType=null;
  async function addMaskFiles(fileList,type){
    if(!CONFIG[type]){$("maskStatus").textContent="Velg først hva masken viser.";return}
    const files=[...(fileList||[])].filter(f=>f.type.startsWith("image/"));
    if(!files.length){$("maskStatus").textContent="Velg PNG-bildefiler fra WebSAM.";return}
    $("maskStatus").textContent="Behandler maskene …";
    for(const file of files){
      try{
        const dataUrl=await readImageFile(file);
        maskLayers.push({dataUrl,type,file:file.name||"maske.png"});
      }catch(_){/* hopp over filer som ikke kan leses */}
    }
    await processMasks();
  }

  $("resultCutout").addEventListener("change",async event=>{
    const file=event.target.files?.[0];if(!file)return;
    if(!file.type.startsWith("image/")){$("cutoutStatus").textContent="Velg en bildefil.";return}
    try{
      cutoutDataUrl=await readImageFile(file);
      const img=$("cutoutPreview");img.src=cutoutDataUrl;
      img.parentElement.classList.add("has-image");
      $("cutoutStatus").textContent=`${file.name} er lastet inn manuelt.`;
      resultParts.cutout=true;checkResultReady();
      if(maskLayers.length)await processMasks();
    }catch(error){
      $("cutoutStatus").textContent="Ortofotoet kunne ikke leses.";
    }
  });

  $("maskTypeButtons").addEventListener("click",event=>{
    const button=event.target.closest(".mask-type-btn");
    if(!button)return;
    pendingMaskType=button.dataset.maskType;
    $("resultMask").click();
  });
  $("resultMask").addEventListener("change",event=>{
    addMaskFiles(event.target.files,pendingMaskType);
    event.target.value="";
  });

  $("maskLayerList").addEventListener("click",e=>{
    const btn=e.target.closest(".mask-remove");if(!btn)return;
    const idx=Number(btn.dataset.index);
    if(Number.isInteger(idx)){maskLayers.splice(idx,1);processMasks();}
  });

  $("clearMasks").addEventListener("click",()=>{
    maskLayers.length=0;maskAlphaByType={};processMasks();
  });


  // Fyll inn ortofotoet automatisk ved oppstart hvis det allerede finnes.
  hydrateCutoutFromSession();

  $("downloadProcessedMask").addEventListener("click",()=>{
    if(!processedMaskDataUrl)return;
    const a=document.createElement("a");
    a.href=processedMaskDataUrl;
    a.download="websam-maske-sort-hvit.png";
    document.body.appendChild(a);a.click();a.remove();
  });

  $("participantName").addEventListener("input",updateFinalTitle);
  function prepareResultMapForScreen(){
    resultMap.invalidateSize(true);
  }

  function waitForImage(image){
    if(image.complete&&image.naturalWidth)return Promise.resolve();
    return new Promise((resolve,reject)=>{
      image.addEventListener("load",resolve,{once:true});
      image.addEventListener("error",()=>reject(new Error("Kartbildet kunne ikke lastes.")),{once:true});
    });
  }

  function waitForTileImages(mapElement,timeoutMs=5000){
    const started=Date.now();
    return new Promise(resolve=>{
      const check=()=>{
        const tiles=[...mapElement.querySelectorAll("img.leaflet-tile")];
        const pending=tiles.filter(img=>!img.complete||!img.naturalWidth);
        if(!pending.length||Date.now()-started>timeoutMs)return resolve(tiles);
        setTimeout(check,100);
      };
      check();
    });
  }

  function drawLatLngPath(ctx,latlngs,map,scale,closePath){
    if(!latlngs?.length)return;
    ctx.beginPath();
    latlngs.forEach((latlng,index)=>{
      const point=map.latLngToContainerPoint(latlng);
      const x=point.x*scale,y=point.y*scale;
      if(index===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);
    });
    if(closePath)ctx.closePath();
  }

  function drawLeafletLayer(ctx,layer,map,scale){
    const options=layer.options||{};
    const latlngs=typeof layer.getLatLngs==="function"?layer.getLatLngs():null;
    if(!latlngs)return;
    const isPolygon=layer instanceof L.Polygon;
    const paths=[];
    const collect=value=>{
      if(!Array.isArray(value)||!value.length)return;
      if(value[0]&&typeof value[0].lat==="number")paths.push(value);
      else value.forEach(collect);
    };
    collect(latlngs);
    ctx.save();
    ctx.lineJoin="round";ctx.lineCap="round";
    ctx.strokeStyle=options.color||"#6f43d6";
    ctx.lineWidth=(options.weight||4)*scale;
    ctx.globalAlpha=options.opacity??1;
    for(const path of paths){
      drawLatLngPath(ctx,path,map,scale,isPolygon);
      if(isPolygon){
        ctx.save();
        ctx.globalAlpha=options.fillOpacity??0.35;
        ctx.fillStyle=options.fillColor||options.color||"#6f43d6";
        ctx.fill();
        ctx.restore();
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  async function captureResultMapExactly(mapElement,scale=2){
    // Tegn de kartflisene som allerede er synlige i nettleseren på et nytt canvas.
    // Posisjonene leses fra skjermen, mens objektene tegnes med Leaflets
    // lat/lon-til-pikselberegning. Dette gir samme utsnitt uten ekstern export-URL.
    resultMap.invalidateSize(true);
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    const tiles=await waitForTileImages(mapElement);
    const mapRect=mapElement.getBoundingClientRect();
    const width=Math.max(1,Math.round(mapRect.width));
    const height=Math.max(1,Math.round(mapRect.height));
    const canvas=document.createElement("canvas");
    canvas.width=width*scale;canvas.height=height*scale;
    const ctx=canvas.getContext("2d");
    ctx.fillStyle="#e7ebef";ctx.fillRect(0,0,canvas.width,canvas.height);

    let drawnTiles=0;
    for(const tile of tiles){
      if(!tile.complete||!tile.naturalWidth)continue;
      const rect=tile.getBoundingClientRect();
      const x=(rect.left-mapRect.left)*scale;
      const y=(rect.top-mapRect.top)*scale;
      const w=rect.width*scale;
      const h=rect.height*scale;
      try{ctx.drawImage(tile,x,y,w,h);drawnTiles++;}catch(error){console.warn("Kartflis kunne ikke tegnes",error);}
    }
    if(!drawnTiles)throw new Error("Ingen ferdig lastede kartfliser ble funnet.");

    resultFeatureGroup.eachLayer(layer=>drawLeafletLayer(ctx,layer,resultMap,scale));
    return canvas;
  }

  async function createResultMapPrintSnapshot(){
    const printImage=$("resultMapPrintImage");
    const canvas=await captureResultMapExactly($("resultMap"),2);
    printImage.src=canvas.toDataURL("image/png");
    await waitForImage(printImage);
    printImage.classList.add("ready");
  }

  window.addEventListener("afterprint",()=>{
    setTimeout(prepareResultMapForScreen,100);
  });

  function copyLiveFormValues(sourceRoot,cloneRoot){
    const sourceFields=[...sourceRoot.querySelectorAll("input,textarea,select")];
    const cloneFields=[...cloneRoot.querySelectorAll("input,textarea,select")];
    sourceFields.forEach((field,index)=>{
      const copy=cloneFields[index];
      if(!copy)return;
      if(field instanceof HTMLTextAreaElement){copy.textContent=field.value;}
      else if(field instanceof HTMLSelectElement){
        [...copy.options].forEach((option,i)=>option.selected=field.options[i]?.selected||false);
      }else if(field.type==="checkbox"||field.type==="radio"){
        if(field.checked)copy.setAttribute("checked","");else copy.removeAttribute("checked");
      }else{copy.setAttribute("value",field.value||"");}
    });
  }

  $("printResult").addEventListener("click",async()=>{
    const button=$("printResult");
    const original=button.textContent;
    button.disabled=true;
    button.textContent="⏳ Klargjør kartbildet …";
    try{
      // Lag kartbildet mens resultatkartet fortsatt er synlig og har riktig størrelse.
      await createResultMapPrintSnapshot();
      // Gi nettleseren tid til å oppdatere utskriftsbildet før utskriftsdialogen åpnes.
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      window.print();
    }catch(error){
      console.error(error);
      alert("Kartbildet kunne ikke klargjøres. Vent et øyeblikk til kartet er ferdig lastet og prøv igjen.\n\nTeknisk informasjon: "+(error?.message||error));
    }finally{
      button.disabled=false;
      button.textContent=original;
    }
  });


  function showCompletion(){
    missionState.result=true;updateOverallProgress();
    const overlay=$("completionOverlay");overlay.classList.add("open");overlay.setAttribute("aria-hidden","false");
    const colors=["#ec5b91","#6f43d6","#39a9dc","#ffd55a","#42b870"],area=$("confettiArea");area.innerHTML="";
    for(let i=0;i<55;i++){const piece=document.createElement("i");piece.className="confetti-piece";piece.style.left=`${Math.random()*100}%`;piece.style.background=colors[i%colors.length];piece.style.animationDelay=`${Math.random()*.8}s`;area.appendChild(piece)}
  }
  $("finishChallenge").addEventListener("click",showCompletion);
  $("closeCompletion").addEventListener("click",()=>{$("completionOverlay").classList.remove("open");$("completionOverlay").setAttribute("aria-hidden","true")});
  $("completionOverlay").addEventListener("click",e=>{if(e.target===$("completionOverlay"))$("closeCompletion").click()});

  $("downloadReport").addEventListener("click",()=>{
    const value=id=>$(id).value.trim()||"Ikke besvart";
    const maskLine=maskLayers.length
      ? `${maskLayers.length} maske(r): ${maskLayers.map(l=>CONFIG[l.type]?.label||"Maske").join(", ")}`
      : "Ingen masker lastet opp";
    const report=[
      "GEOAI CHALLENGE – TENK TECH CAMP KRISTIANSAND",
      "=============================================",
      "",
      `Lag: ${value("participantName")}`,
      `Kartnavn: ${$("mapTitle").value.trim()||"Mitt digitale kart"}`,
      `Dato: ${new Date().toLocaleDateString("no-NO")}`,
      "",
      "STEG 1 – OMRÅDE",
      `Hypotese: ${value("hypothesis")}`,
      "",
      "STEG 2 – DIGITALT KART",
      objectSummaryText(),
      "",
      "STEG 3 – KI I WEBSAM",
      maskLine,
      "",
      "KI-EN MOT DITT KART",
      lastOverlapPercent===null
        ? "Sammenligningen ble ikke laget."
        : `Segmenteringstreff: ${lastOverlapPercent} % (${scoreLabel(lastOverlapPercent).toLowerCase()}).`,
      lastOverlapPercent===null
        ? ""
        : `Totalt er KI-en og kartet ditt enige om ${lastOverlapPercent} % av området de til sammen dekker.`,
      ...lastTypeScores.map(s=>`  ${s.label}: ${s.percent} % overlapp`),
      "",
      "STEG 4 – REFLEKSJON",
      `Hva klarte du bedre enn KI-en? ${value("reflection")}`,
      `Vurdert nøyaktighet: ${$("quality").value}`,
      ""
    ].join("\n");
    download("geoai-rapport.txt",report,"text/plain;charset=utf-8");
  });

  $("mapTitle").addEventListener("input",()=>{
    saveAutosave();
    updateFinalTitle();
  });
  updateStats();
  const restoredObjects=restoreAutosave();
  updateFinalSummary();
  setTimeout(()=>{
    digitizeMap.invalidateSize(true);
    const tilePane=digitizeMap.getPane("tilePane");
    if(!(tilePane&&getComputedStyle(tilePane).position==="absolute")){
      setStatus("Kartstilen ble ikke lastet korrekt. Last siden på nytt.");
      return;
    }
    setStatus(restoredObjects
      ?`Kartet ditt fra sist ble hentet fram igjen (${restoredObjects} objekter). Velg en objekttype for å tegne videre.`
      :"Digitaliseringsverktøyet er klart. Velg en objekttype.");
  },250);
});
