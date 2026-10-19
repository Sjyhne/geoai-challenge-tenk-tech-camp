/* Girl Tech Fest: explore, draw, and show your own map. */
(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const KEY = 'girl-tech-fest-map-v1';
  // Esri has no level 19/20 imagery in the workshop area. Never request those levels.
  const IMAGE_MAX_ZOOM = 18;
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(KEY) || '{}') || {};
  } catch {}
  const types = {
    building: {
      label: 'Hus',
      color: '#ec4899',
      icon: '🏠'
    },
    road: {
      label: 'Vei',
      color: '#facc15',
      icon: '🛣️'
    },
    forest: {
      label: 'Skog',
      color: '#22a65a',
      icon: '🌲'
    },
    water: {
      label: 'Vann',
      color: '#369bd3',
      icon: '💧'
    }
  };
  for (const t of saved.customTypes || []) if (/^custom_\d+$/.test(t.id)) types[t.id] = t;
  for (const [id, color] of Object.entries(saved.colors || {})) if (types[id] && /^#[0-9a-f]{6}$/i.test(color)) types[id].color = color;
  const maps = {};
  let chosenBounds = saved.chosenBounds || null;
  let drawingFrameChanged = true;
  let features = Array.isArray(saved.features) ? saved.features : [],
    current = null,
    points = [],
    selected = null,
    sketch = null,
    markers = [],
    editing = false;
  if (!window.L) {
    $('status').textContent = 'Kartet kunne ikke lastes. Sjekk nettet og last siden på nytt.';
    return;
  }
  function imageryLayer() {
    return L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: IMAGE_MAX_ZOOM, maxNativeZoom: IMAGE_MAX_ZOOM, crossOrigin: true,
      attribution: 'Bilder © Esri, Maxar og bidragsytere'
    });
  }
  const layers = L.featureGroup(),
    results = L.featureGroup();
  for (const [id, name] of [['exploreMap', 'explore'], ['digitizeMap', 'digitize'], ['resultMap', 'result']]) {
    const m = maps[name] = L.map(id, {
      doubleClickZoom: false,
      maxZoom: IMAGE_MAX_ZOOM,
      zoomSnap: name === 'digitize' ? 0 : 1,
      zoomControl: true,
      dragging: true,
      scrollWheelZoom: true,
      touchZoom: true,
      boxZoom: name !== 'digitize',
      keyboard: true,
      maxBoundsViscosity: 1,
      zoomAnimation: name !== 'digitize'
    }).setView(saved.center || [58.1467, 7.9956], Math.min(saved.zoom || 17, IMAGE_MAX_ZOOM));
    imageryLayer().addTo(m);
  }
  layers.addTo(maps.digitize);
  results.addTo(maps.result);
  $('mapTitle').value = saved.title || '';
  $('reflection').value = saved.reflection || '';
  $('participantName').value = saved.name || '';
  function persist() {
    try {
      localStorage.setItem(KEY, JSON.stringify({
        features,
        chosenBounds,
        colors: Object.fromEntries(Object.entries(types).map(([id, t]) => [id, t.color])),
        customTypes: Object.entries(types).filter(([id]) => id.startsWith('custom_')).map(([id, t]) => ({
          id,
          ...t
        })),
        title: $('mapTitle').value,
        reflection: $('reflection').value,
        name: $('participantName').value,
        center: [maps.explore.getCenter().lat, maps.explore.getCenter().lng],
        zoom: maps.explore.getZoom()
      }));
    } catch {
      $('status').textContent = 'Nettleseren har ikke plass til å lagre mer. Hold siden åpen for å beholde kartet.';
    }
  }
  function ask(message) {
    return new Promise(resolve => {
      const dialog = document.createElement('dialog');
      const text = document.createElement('p');
      text.textContent = message;
      const yes = document.createElement('button');
      const no = document.createElement('button');
      yes.textContent = 'Ja, slett';
      no.textContent = 'Nei, behold';
      no.className = 'secondary';
      yes.onclick = () => { dialog.close(); dialog.remove(); resolve(true); };
      no.onclick = () => { dialog.close(); dialog.remove(); resolve(false); };
      dialog.oncancel = () => { dialog.remove(); resolve(false); };
      dialog.append(text, no, yes);
      document.body.append(dialog);
      dialog.showModal();
      no.focus();
    });
  }
  function go(tab) {
    if (tab !== 'digitize' && points.length) {
      $('status').textContent = 'Gjør ferdig tegningen, eller trykk Avbryt først.';
      return;
    }
    const previousTab = document.querySelector('.tab.active')?.id;
    if (tab === 'digitize' && !chosenBounds && previousTab !== 'explore') {
      go('explore');
      return;
    }
    if (tab === 'digitize' && (previousTab === 'explore' || !chosenBounds)) {
      const bounds = maps.explore.getBounds();
      chosenBounds = [[bounds.getSouth(), bounds.getWest()], [bounds.getNorth(), bounds.getEast()]];
      drawingFrameChanged = true;
      persist();
    }
    document.querySelectorAll('.tab').forEach(e => e.classList.toggle('active', e.id === tab));
    document.querySelectorAll('[data-tab]').forEach(e => e.classList.toggle('active', e.dataset.tab === tab));
    if (tab === 'result') renderResults();
    requestAnimationFrame(() => {
      maps[tab]?.invalidateSize({pan:false});
      if (tab === 'digitize') fitDrawingArea();
    });
  }
  // Keep the chosen geographic frame and its proportions, even after resizing.
  function fitDrawingArea() {
    if (!chosenBounds || !document.getElementById('digitize').classList.contains('active')) return;
    const bounds = L.latLngBounds(chosenBounds);
    const nw = L.CRS.EPSG3857.project(bounds.getNorthWest());
    const se = L.CRS.EPSG3857.project(bounds.getSouthEast());
    const ratio = (se.x - nw.x) / (nw.y - se.y);
    const previousCenter = maps.digitize.getCenter();
    const previousZoom = maps.digitize.getZoom();
    const previousMinZoom = maps.digitize.getMinZoom();
    const map = $('digitizeMap');
    // Reset the map to measure the full space available in the flex card.
    map.style.width = '100%';
    map.style.height = '';
    map.style.flex = '1 1 0';
    const available = map.getBoundingClientRect();
    const nativeWidth = maps.digitize.project(bounds.getNorthEast(), IMAGE_MAX_ZOOM).x - maps.digitize.project(bounds.getNorthWest(), IMAGE_MAX_ZOOM).x;
    const width = Math.min(available.width, available.height * ratio, nativeWidth);
    map.style.flex = '0 0 auto';
    map.style.width = width + 'px';
    map.style.height = width / ratio + 'px';
    maps.digitize.invalidateSize({pan:false});
    const minimumZoom = Math.min(IMAGE_MAX_ZOOM, Math.round(maps.digitize.getBoundsZoom(bounds) * 1e6) / 1e6);
    maps.digitize.setMinZoom(minimumZoom);
    maps.digitize.setMaxBounds(bounds);
    if (drawingFrameChanged) {
      maps.digitize.fitBounds(bounds, {animate:false, padding:[0,0]});
      drawingFrameChanged = false;
    } else {
      maps.digitize.setView(previousCenter, Math.max(minimumZoom, previousZoom + minimumZoom - previousMinZoom), {animate:false});
      maps.digitize.panInsideBounds(bounds, {animate:false});
    }
  }
  const drawingResize = new ResizeObserver(() => requestAnimationFrame(fitDrawingArea));
  drawingResize.observe($('digitizeMap').parentElement);
  document.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => go(b.dataset.tab));
  document.querySelectorAll('[data-next]').forEach(b => b.onclick = () => go(b.dataset.next));
  $('startMission').onclick = () => go('explore');
  $('goPlace').onclick = () => {
    const [lat, lng, z] = $('placeSelect').value.split(',').map(Number);
    maps.explore.setView([lat, lng], z);
    persist();
  };
  maps.explore.on('moveend', persist);
  let searchVersion = 0;
  $('placeSearchForm').onsubmit = async e => {
    e.preventDefault();
    const q = $('placeSearchInput').value.trim(),
      version = ++searchVersion;
    if (!q) return;
    $('placeSearchStatus').textContent = 'Leter etter stedet …';
    $('placeSearchResults').replaceChildren();
    $('placeSearchResults').hidden = true;
    try {
      const r = await fetch('https://ws.geonorge.no/adresser/v1/sok?sok=' + encodeURIComponent(q) + '&treffPerSide=5');
      if (!r.ok) throw Error();
      const data = await r.json();
      let places = (data.adresser || []).map(a => ({
        name: a.adressetekst + ', ' + a.poststed,
        lat: a.representasjonspunkt.lat,
        lng: a.representasjonspunkt.lon
      }));
      if (!places.length) {
        const r = await fetch('https://ws.geonorge.no/stedsnavn/v1/sted?sok=' + encodeURIComponent(q) + '&treffPerSide=5');
        if (!r.ok) throw Error();
        const d = await r.json();
        places = (d.navn || []).map(a => ({
          name: a.skrivemåte,
          lat: a.representasjonspunkt.nord,
          lng: a.representasjonspunkt.øst
        }));
      }
      if (version !== searchVersion) return;
      $('placeSearchStatus').textContent = places.length ? 'Trykk på stedet du vil se.' : 'Fant ikke stedet. Prøv et annet navn.';
      for (const p of places) {
        const li = document.createElement('li'),
          b = document.createElement('button');
        b.textContent = p.name;
        b.onclick = () => maps.explore.setView([p.lat, p.lng], 18);
        li.append(b);
        $('placeSearchResults').append(li);
      }
      $('placeSearchResults').hidden = !places.length;
    } catch {
      if (version === searchVersion) $('placeSearchStatus').textContent = 'Søket virker ikke akkurat nå. Velg et sted fra lista, eller flytt kartet selv.';
    }
  };
  function style(f, highlight = false) {
    return {
      color: highlight ? '#831843' : f.color,
      weight: f.type === 'road' ? highlight ? 10 : 7 : highlight ? 5 : 3,
      fillColor: f.color,
      fillOpacity: highlight ? .65 : .4
    };
  }
  function layerFor(f, highlight = false) {
    return f.type === 'road' ? L.polyline(f.points, style(f, highlight)) : L.polygon(f.points, style(f, highlight));
  }
  function render() {
    layers.clearLayers();
    features.forEach(f => {
      const l = layerFor(f, f.id === selected);
      l.on('click', e => {
        L.DomEvent.stopPropagation(e);
        if (current) return;
        selected = f.id;
        editing = false;
        clearMarkers();
        render();
        $('status').textContent = types[f.type].label + ' er valgt. Du kan slette den eller flytte på hjørnene.';
      });
      layers.addLayer(l);
    });
    const counts = {};
    features.forEach(f => counts[f.type] = (counts[f.type] || 0) + 1);
    $('mapLegend').textContent = Object.entries(counts).map(([t, n]) => `${types[t].icon} ${types[t].label}: ${n}`).join(' · ');
    $('missionProgress').textContent = features.length ? `Du har tegnet ${features.length} ting. Hva mer kan du finne?` : 'Prøv å tegne et hus, en vei og litt skog eller vann.';
    $('challengePercent').textContent = features.length + ' tegnet';
    $('challengeMeterBar').style.width = Math.min(features.length / 4 * 100, 100) + '%';
    $('editSelected').disabled = !selected;
    $('deleteSelected').disabled = !selected;
    requestAnimationFrame(fitDrawingArea);
    persist();
  }
  function clearMarkers() {
    markers.forEach(m => m.remove());
    markers = [];
  }
  function cancel() {
    points = [];
    current = null;
    editing = false;
    clearMarkers();
    if (sketch) sketch.remove();
    sketch = null;
    document.querySelectorAll('.object-btn').forEach(b => b.classList.remove('selected'));
    updateSketch();
  }
  function updateSketch() {
    $('digitizeMap').classList.toggle('drawing-mode', Boolean(current));
    if (sketch) sketch.remove();
    sketch = null;
    if (points.length) sketch = (current === 'road' ? L.polyline(points, {
      color: types[current].color,
      weight: 7
    }) : L.polygon(points, {
      color: types[current].color
    })).addTo(maps.digitize);
    $('finishObject').disabled = !current || points.length < (current === 'road' ? 2 : 3);
    $('undoPoint').disabled = !points.length;
    $('cancelObject').disabled = !current;
    $('status').textContent = current ? `Tegn ${types[current].label.toLowerCase()}: klikk ${current === 'road' ? 'langs veien' : 'rundt kanten'}. ${points.length} klikk.` : 'Velg hus, vei, skog eller vann for å tegne.';
  }
  function bindTypes() {
    document.querySelectorAll('[data-object-type]').forEach(b => b.onclick = e => {
      if (e.target.type === 'color') return;
      cancel();
      selected = null;
      current = b.dataset.objectType;
      b.classList.add('selected');
      render();
      updateSketch();
    });
    document.querySelectorAll('[data-color-type]').forEach(i => {
      const t = i.dataset.colorType;
      i.value = types[t].color;
      i.closest('.object-choice').querySelector('button').style.setProperty('--object-color', types[t].color);
      i.oninput = () => {
        types[t].color = i.value;
        i.closest('.object-choice').querySelector('button').style.setProperty('--object-color', i.value);
        features.filter(f => f.type === t).forEach(f => f.color = i.value);
        render();
        updateSketch();
      };
      i.onclick = e => e.stopPropagation();
    });
  }
  maps.digitize.on('click', e => {
    if (current) {
      points.push([e.latlng.lat, e.latlng.lng]);
      updateSketch();
    }
  });
  $('undoPoint').onclick = () => {
    points.pop();
    updateSketch();
  };
  $('cancelObject').onclick = cancel;
  $('finishObject').onclick = () => {
    if ($('finishObject').disabled) return;
    features.push({
      id: crypto.randomUUID(),
      type: current,
      color: types[current].color,
      points: points.map(p => [...p])
    });
    cancel();
    render();
  };
  $('deleteSelected').onclick = () => {
    features = features.filter(f => f.id !== selected);
    selected = null;
    cancel();
    render();
  };
  $('editSelected').onclick = () => {
    const f = features.find(f => f.id === selected);
    if (!f) return;
    cancel();
    editing = true;
    f.points.forEach((p, i) => {
      const m = L.marker(p, {
        draggable: true
      }).addTo(maps.digitize);
      m.on('drag', () => {
        f.points[i] = [m.getLatLng().lat, m.getLatLng().lng];
        render();
      });
      markers.push(m);
    });
    $('status').textContent = 'Dra i markørene for å flytte på hjørnene. Velg en tegnefarge når du er ferdig.';
  };
  $('clearAll').onclick = async () => {
    if (await ask('Vil du slette alle tegningene?')) {
      features = [];
      selected = null;
      cancel();
      render();
    }
  };
  function customList() {
    const custom = Object.entries(types).filter(([id]) => id.startsWith('custom_'));
    $('customTypeCount').textContent = custom.length + '/3';
    $('customTypeList').replaceChildren();
    for (const [id, t] of custom) {
      const li = document.createElement('li'),
        b = document.createElement('button');
      b.textContent = 'Slett ' + t.label;
      b.className = 'secondary';
      b.onclick = async () => {
        if (features.some(f => f.type === id) && !(await ask('Vil du slette denne typen og tegningene som hører til?'))) return;
        features = features.filter(f => f.type !== id);
        delete types[id];
        document.querySelector(`[data-object-type="${id}"]`).closest('.object-choice').remove();
        selected = null;
        cancel();
        customList();
        render();
      };
      li.append(b);
      $('customTypeList').append(li);
    }
  }
  function addTypeButton(id, t) {
    const b = document.createElement('button');
    b.className = 'object-btn';
    b.dataset.objectType = id;
    const label = document.createElement('span');
    label.textContent = t.label;
    const input = document.createElement('input');
    input.type = 'color';
    input.className = 'object-color';
    input.dataset.colorType = id;
    input.setAttribute('aria-label', 'Velg farge for ' + t.label);
    b.append(label);
    const choice = document.createElement('div');
    choice.className = 'object-choice';
    choice.append(b, input);
    $('typeButtons').append(choice);
  }
  $('addCustomType').onclick = () => {
    const name = $('customTypeName').value.trim();
    if (!name) {
      $('customTypeStatus').textContent = 'Skriv hva du vil tegne først.';
      return;
    }
    if (Object.keys(types).length >= 7) {
      $('customTypeStatus').textContent = 'Du kan legge til tre egne typer.';
      return;
    }
    const id = 'custom_' + Date.now(),
      t = {
        label: name,
        color: $('customTypeColor').value,
        icon: '⭐'
      };
    types[id] = t;
    addTypeButton(id, t);
    bindTypes();
    customList();
    $('customTypeName').value = '';
    $('customTypeStatus').textContent = 'Nå kan du tegne ' + name.toLowerCase() + '.';
    persist();
  };
  for (const [id, t] of Object.entries(types)) if (id.startsWith('custom_')) addTypeButton(id, t);
  function renderResults() {
    results.clearLayers();
    $('objectList').replaceChildren();
    $('finalTitle').textContent = $('mapTitle').value || 'Kartet mitt';
    $('resultSummary').textContent = features.length ? `Du har tegnet ${features.length} ting på kartet ditt. Bra jobbet!` : 'Kartet er tomt ennå. Gå til Bygg kart og tegn noe først.';
    const count = {};
    features.forEach(f => {
      count[f.type] = (count[f.type] || 0) + 1;
      const name = types[f.type].label + ' ' + count[f.type],
        l = layerFor(f).addTo(results);
      l.bindTooltip(name);
      const b = document.createElement('button');
      b.className = 'object-item';
      b.textContent = types[f.type].icon + ' ' + name;
      b.style.borderLeftColor = f.color;
      b.onclick = () => {
        results.eachLayer(x => x.setStyle(style(x.featureData)));
        l.setStyle(style(f, true));
        maps.result.fitBounds(l.getBounds(), {
          padding: [70, 70],
          maxZoom: IMAGE_MAX_ZOOM
        });
        l.openTooltip();
        document.querySelectorAll('.object-item').forEach(x => x.classList.toggle('selected', x === b));
      };
      l.featureData = f;
      l.on('click', () => b.click());
      $('objectList').append(b);
    });
    $('resultLegend').textContent = $('mapLegend').textContent;
    requestAnimationFrame(() => {
      maps.result.invalidateSize();
      if (features.length) maps.result.fitBounds(results.getBounds(), {
        padding: [35, 35],
        maxZoom: IMAGE_MAX_ZOOM
      });else maps.result.setView(maps.explore.getCenter(), maps.explore.getZoom());
    });
  }
  $('showAll').onclick = renderResults;
  function updatePosterText() {
    $('posterTitle').textContent = $('mapTitle').value.trim() || 'Se hva jeg har laget!';
    const name = $('participantName').value.trim();
    $('posterAuthor').textContent = name ? 'Laget av ' + name : 'Mitt kart fra Girl Tech Fest';
    $('posterReflection').textContent = $('reflection').value.trim() || 'Jeg har funnet et sted, sett nøye etter og laget mitt eget kart.';
    $('posterTotal').textContent = features.length;
    $('posterTypes').replaceChildren();
    for (const [id, type] of Object.entries(types)) {
      const count = features.filter(f => f.type === id).length;
      if (!count) continue;
      const row = document.createElement('div');
      row.className = 'poster-type';
      const dot = document.createElement('i');
      dot.style.background = type.color;
      const label = document.createElement('span');
      label.textContent = type.label;
      const number = document.createElement('b');
      number.textContent = count;
      row.append(dot, label, number);
      $('posterTypes').append(row);
    }
  }
  async function capturePosterMap() {
    // Render a static image so printing cannot resize or crop the interactive map.
    const container = document.createElement('div');
    container.style.cssText = 'position:fixed;left:-10000px;top:0;width:1200px;height:700px;';
    document.body.append(container);
    const posterMap = L.map(container, {zoomControl:false, attributionControl:false, zoomAnimation:false, zoomSnap:0, maxZoom:IMAGE_MAX_ZOOM});
    imageryLayer().addTo(posterMap);
    const drawings = L.featureGroup(features.map(f => layerFor(f))).addTo(posterMap);
    if (features.length) posterMap.fitBounds(drawings.getBounds(), {padding:[45,45],maxZoom:IMAGE_MAX_ZOOM});
    else if (chosenBounds) posterMap.fitBounds(chosenBounds);
    else posterMap.setView(maps.explore.getCenter(), maps.explore.getZoom());
    try {
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const tiles = [...container.querySelectorAll('.leaflet-tile')];
    await Promise.all(tiles.map(img => img.complete ? Promise.resolve() : new Promise(resolve => {
      const timer = setTimeout(resolve, 25000);
      const done = () => { clearTimeout(timer); resolve(); };
      img.addEventListener('load', done, {once:true});
      img.addEventListener('error', done, {once:true});
    })));
    const rect = container.getBoundingClientRect();
    const canvas = document.createElement('canvas');
    const scale = 2;
    canvas.width = Math.round(rect.width * scale);
    canvas.height = Math.round(rect.height * scale);
    const ctx = canvas.getContext('2d');
    ctx.scale(scale, scale);
    ctx.fillStyle = '#f3eef1';
    ctx.fillRect(0, 0, rect.width, rect.height);
    for (const img of tiles) {
      if (!img.complete || !img.naturalWidth) throw new Error('Kartbildene er ikke ferdig lastet. Prøv igjen om litt.');
      const tile = img.getBoundingClientRect();
      ctx.drawImage(img, tile.left - rect.left, tile.top - rect.top, tile.width, tile.height);
    }
    for (const svg of container.querySelectorAll('.leaflet-overlay-pane svg')) {
      const box = svg.getBoundingClientRect();
      const clone = svg.cloneNode(true);
      clone.removeAttribute('style');
      clone.removeAttribute('class');
      clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      clone.setAttribute('width', box.width);
      clone.setAttribute('height', box.height);
      const image = new Image();
      const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)], {type:'image/svg+xml'}));
      try {
        await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; image.src = url; });
        ctx.drawImage(image, box.left - rect.left, box.top - rect.top, box.width, box.height);
      } finally { URL.revokeObjectURL(url); }
    }
    return canvas.toDataURL('image/png');
    } finally { posterMap.remove(); container.remove(); }
  }
  $('printMap').onclick = async () => {
    const button = $('printMap');
    button.disabled = true;
    button.textContent = 'Lager kartplakaten …';
    try {
      renderResults();
      updatePosterText();
      $('posterMap').src = await capturePosterMap();
      $('printPreview').showModal();
    } catch (error) {
      $('resultSummary').textContent = error.message || 'Kunne ikke lage plakaten. Prøv igjen.';
    } finally {
      button.disabled = false;
      button.textContent = 'Skriv ut eller lagre som PDF';
    }
  };
  $('closePrintPreview').onclick = () => $('printPreview').close();
  $('printPoster').onclick = () => window.print();
  $('finishChallenge').onclick = () => $('completion').showModal();
  $('closeCompletion').onclick = () => $('completion').close();
  $('restartChallenge').onclick = async () => {
    if (await ask('Vil du starte på nytt og slette kartet ditt?')) {
      localStorage.removeItem(KEY);
      location.reload();
    }
  };
  for (const id of ['mapTitle', 'reflection', 'participantName']) $(id).oninput = () => {
    $('finalTitle').textContent = $('mapTitle').value || 'Kartet mitt';
    persist();
  };
  window.addEventListener('beforeprint', updatePosterText);
  window.addEventListener('afterprint', () => maps.result.invalidateSize());
  bindTypes();
  customList();
  render();
  updateSketch();
})();
